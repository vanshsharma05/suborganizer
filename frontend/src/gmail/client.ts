/**
 * Thin wrapper over the Gmail REST API.
 *
 * Only three calls are needed: search for ids, pull headers for each id, and —
 * for the minority of messages whose price never appears in the subject or
 * snippet — pull the body. Everything is read-only.
 */

import { GmailAuthError } from './auth';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Gmail allows ~50 messages.get per second per user; 8 in flight stays clear. */
const CONCURRENCY = 8;

/**
 * Per-request ceiling. A scan makes hundreds of these, and one socket that
 * stalls rather than fails would freeze the progress bar with nothing to report
 * — the pool worker holding it never returns, so the scan never finishes.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export type GmailHeaders = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: number;
  from: string;
  subject: string;
};

type RawMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: RawPart;
};

type RawPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: RawPart[];
};

// ------------------------------------------------------------------ plumbing --

async function call<T>(path: string, token: string, params: Record<string, string | string[]>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // metadataHeaders is repeated, not comma-joined.
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item));
    else qs.append(k, v);
  }

  const url = `${BASE}${path}?${qs.toString()}`;

  // Retry only the failures worth retrying: rate limiting, 5xx, and a timeout.
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch {
      // Timed out or the connection dropped. Both are transient by nature, so
      // back off and try again rather than failing the whole scan.
      if (attempt >= 4) throw new Error('Gmail did not respond. Check your connection and scan again.');
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      /*
       * A 200 is not a promise of JSON.
       *
       * The parse sat outside the try that wraps the fetch, so anything
       * answering 200 with something else threw a raw SyntaxError straight out
       * of here and took the whole scan with it. The case that actually happens
       * is a captive portal — hotel and airport wifi intercept the request and
       * return their own login page with a perfectly good status code.
       *
       * Treated as retryable rather than fatal, because that is what it usually
       * is: the same request a moment later, once the portal is satisfied or the
       * proxy has stopped meddling, returns real JSON. After the last attempt it
       * fails with a sentence about the connection, which is the true cause.
       */
      try {
        return (await res.json()) as T;
      } catch {
        if (attempt >= 4) {
          throw new Error('Gmail sent something we could not read. Check your connection and scan again.');
        }
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
    }

    if (res.status === 401) {
      throw new GmailAuthError('Gmail rejected the access token. Connect again to scan.');
    }
    if (res.status === 403) {
      const body = await res.text();
      if (body.includes('insufficient') || body.includes('ACCESS_TOKEN_SCOPE')) {
        throw new GmailAuthError(
          'This app is not allowed to read Gmail. Reconnect and accept the Gmail permission.',
        );
      }
      if (!body.includes('rateLimitExceeded') && !body.includes('userRateLimitExceeded')) {
        throw new Error(`Gmail refused the request (403): ${body.slice(0, 200)}`);
      }
    } else if (res.status !== 429 && res.status < 500) {
      throw new Error(`Gmail request failed (${res.status})`);
    }

    if (attempt >= 4) throw new Error(`Gmail request failed (${res.status}) after retries`);
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
}

/** Runs `worker` over `items` with a bounded number in flight. */
async function pool<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  onDone?: (completed: number) => void,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  let completed = 0;

  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
      onDone?.(++completed);
    }
  });

  await Promise.all(runners);
  return out;
}

// -------------------------------------------------------------------- calls --

/**
 * Message ids matching a Gmail search query, newest first, capped at `max`.
 * Pages are 100 ids each — the largest Gmail will return.
 */
export async function searchMessageIds(
  token: string,
  query: string,
  max: number,
  onPage?: (found: number) => void,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const page = await call<{ messages?: { id: string }[]; nextPageToken?: string }>(
      '/messages',
      token,
      {
        q: query,
        maxResults: String(Math.min(100, max - ids.length)),
        ...(pageToken ? { pageToken } : {}),
      },
    );

    for (const m of page.messages ?? []) ids.push(m.id);
    onPage?.(ids.length);
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);

  return ids.slice(0, max);
}

function headerOf(msg: RawMessage, name: string): string {
  const found = msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? '';
}

/**
 * Headers + snippet for each id. `format=metadata` skips the body entirely,
 * which is the difference between a scan taking seconds and taking minutes —
 * and Gmail still returns the snippet, where most receipts state the amount.
 */
export async function fetchHeaders(
  token: string,
  ids: string[],
  onProgress?: (completed: number) => void,
): Promise<GmailHeaders[]> {
  const results = await pool(
    ids,
    async (id) => {
      try {
        const msg = await call<RawMessage>(`/messages/${id}`, token, {
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: decodeEntities(msg.snippet ?? ''),
          internalDate: Number(msg.internalDate ?? 0),
          from: headerOf(msg, 'From'),
          subject: headerOf(msg, 'Subject'),
        } satisfies GmailHeaders;
      } catch (e) {
        if (e instanceof GmailAuthError) throw e;
        return null; // one unreadable message must not sink the whole scan
      }
    },
    onProgress,
  );

  return results.filter((r): r is GmailHeaders => r !== null);
}

/** Plain-text body for one message, used only when the amount is still unknown. */
async function fetchBodyText(token: string, id: string): Promise<string> {
  try {
    const msg = await call<RawMessage>(`/messages/${id}`, token, { format: 'full' });
    const text = msg.payload ? extractText(msg.payload) : '';
    return text.slice(0, 20_000);
  } catch (e) {
    if (e instanceof GmailAuthError) throw e;
    return '';
  }
}

export async function fetchBodies(
  token: string,
  ids: string[],
  onProgress?: (completed: number) => void,
): Promise<Map<string, string>> {
  const texts = await pool(ids, (id) => fetchBodyText(token, id), onProgress);
  return new Map(ids.map((id, i) => [id, texts[i]]));
}

// ------------------------------------------------------------------ decoding --

/** Depth-first walk preferring text/plain, falling back to stripped HTML. */
function extractText(part: RawPart): string {
  const mime = part.mimeType ?? '';

  if (mime === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);

  if (part.parts?.length) {
    const plain = part.parts.map(extractText).filter(Boolean);
    if (plain.length) return plain.join('\n');
  }

  if (mime === 'text/html' && part.body?.data) return stripHtml(decodeBase64Url(part.body.data));

  return '';
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * base64url -> UTF-8 string, done by hand rather than via atob().
 *
 * atob() decodes to latin-1, which turns a ₹ into mojibake — fatal for an
 * India-first app whose whole job is reading amounts out of receipts.
 */
function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');

  const bytes: number[] = [];
  for (let i = 0; i < b64.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((k) => B64.indexOf(b64[i + k] ?? 'A'));
    const n = (chunk[0] << 18) | (chunk[1] << 12) | (chunk[2] << 6) | chunk[3];
    bytes.push((n >> 16) & 0xff);
    if (b64[i + 2] !== undefined) bytes.push((n >> 8) & 0xff);
    if (b64[i + 3] !== undefined) bytes.push(n & 0xff);
  }

  // UTF-8 decode
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    let len: number;

    if (b < 0x80) [cp, len] = [b, 1];
    else if (b >= 0xf0) [cp, len] = [b & 0x07, 4];
    else if (b >= 0xe0) [cp, len] = [b & 0x0f, 3];
    else if (b >= 0xc0) [cp, len] = [b & 0x1f, 2];
    else [cp, len] = [0xfffd, 1];

    for (let k = 1; k < len; k++) cp = (cp << 6) | (bytes[i + k] & 0x3f);
    out += String.fromCodePoint(cp > 0x10ffff ? 0xfffd : cp);
    i += len;
  }
  return out;
}
