/**
 * More than one inbox.
 *
 * The scan was built around a single Gmail grant, which quietly assumed
 * something untrue: that a person keeps their whole life in one mailbox. Almost
 * nobody does. Work receipts land in the work address, personal ones in the
 * personal address, and a subscription tracker that can only read one of them
 * reports a total that is confidently wrong — and wrong in the direction that
 * makes the app look useless, because the missing subscriptions are exactly the
 * ones the user already forgot about.
 *
 * Signing in with Apple made it worse. Apple hands back an address that is often
 * a relay and never a Gmail one, so the account identity and the mailboxes have
 * to be separate things. They are: a mailbox belongs to a Supabase user, but a
 * user's own email has nothing to do with which mailboxes they connect.
 *
 * The store is a list rather than a map so its order is stable and meaningful —
 * mailboxes appear in the order they were connected, and a scan reads them in
 * that order, so results do not shuffle between runs.
 *
 * Pure operations here; AsyncStorage lives at the bottom and does nothing but
 * read and write the list.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'gmail.mailboxes.v1';

/** The single-grant key this replaces. Read once, then removed. */
const LEGACY_KEY = 'gmail.connection.v1';

export type Mailbox = {
  /**
   * Stable identity. The lowercased address when Google told us one, which is
   * what makes reconnecting the same inbox an update rather than a duplicate.
   */
  id: string;
  email?: string;
  /** Supabase user this grant belongs to — guards against a shared device. */
  userId: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  /** Epoch ms, for ordering and for showing "connected on". */
  connectedAt: number;
};

/** Refresh a little early, so a scan never starts on a token about to expire. */
export const EXPIRY_SKEW_MS = 120_000;

/**
 * How many inboxes one account may connect.
 *
 * Not a licensing limit — a protection. Every mailbox multiplies the number of
 * Gmail requests a scan makes, and Google's per-user rate limit is shared across
 * them. Five covers work, personal and the two nobody admits to.
 */
export const MAX_MAILBOXES = 5;

/** The id a mailbox should have, given what Google told us about it. */
export function mailboxId(email: string | undefined, fallback: string): string {
  const clean = (email ?? '').trim().toLowerCase();
  return clean || fallback;
}

/**
 * Adds a mailbox, or replaces the existing grant for the same address.
 *
 * Reconnecting an inbox must not append a second copy: two grants for one
 * address means every message is read twice, every candidate is found twice,
 * and the deduplication downstream has to clean up after a mess made here.
 *
 * A replacement keeps its original position and its original `connectedAt`, so
 * re-authorising does not shuffle the list under the user.
 */
export function addMailbox(list: readonly Mailbox[], next: Mailbox): Mailbox[] {
  const at = list.findIndex((m) => m.id === next.id);
  if (at === -1) return [...list, next];

  const out = [...list];
  out[at] = { ...next, connectedAt: list[at].connectedAt };
  return out;
}

export function removeMailbox(list: readonly Mailbox[], id: string): Mailbox[] {
  return list.filter((m) => m.id !== id);
}

/**
 * Only the mailboxes belonging to this user.
 *
 * The device may have been used by somebody else. A grant left behind by a
 * previous account must never be read, and this is the single place that
 * decision is made.
 */
export function forUser(list: readonly Mailbox[], userId: string): Mailbox[] {
  return list.filter((m) => m.userId === userId);
}

/** Whether this grant's access token is expired, or close enough to count. */
export function needsRefresh(m: Mailbox, now: number = Date.now()): boolean {
  return m.expiresAt - EXPIRY_SKEW_MS <= now;
}

/** Replaces one mailbox's tokens, leaving everything else alone. */
export function updateTokens(
  list: readonly Mailbox[],
  id: string,
  tokens: { accessToken: string; refreshToken?: string; expiresAt: number },
): Mailbox[] {
  return list.map((m) =>
    m.id === id
      ? {
          ...m,
          accessToken: tokens.accessToken,
          // Google usually omits the refresh token on refresh; keep the one we
          // have rather than replacing it with undefined and losing the grant.
          refreshToken: tokens.refreshToken ?? m.refreshToken,
          expiresAt: tokens.expiresAt,
        }
      : m,
  );
}

/** Whether another mailbox may be connected. */
export function canAddMore(list: readonly Mailbox[], userId: string): boolean {
  return forUser(list, userId).length < MAX_MAILBOXES;
}

/** What to show for a mailbox that has no address — rare, but not impossible. */
export function mailboxLabel(m: Mailbox): string {
  return m.email ?? 'Connected inbox';
}

// ------------------------------------------------------------------ store --

function parse(raw: string | null): Mailbox[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Every field is checked because this is user-writable storage in practice:
    // a partially written record must not become a mailbox with no token.
    return parsed.filter((m): m is Mailbox =>
      typeof m === 'object' && m !== null &&
      typeof (m as Mailbox).id === 'string' &&
      typeof (m as Mailbox).userId === 'string' &&
      typeof (m as Mailbox).accessToken === 'string' &&
      typeof (m as Mailbox).expiresAt === 'number' &&
      typeof (m as Mailbox).connectedAt === 'number');
  } catch {
    return [];
  }
}

/**
 * Turns a grant written by the single-mailbox version into a list of one.
 *
 * Exported for its tests. Anyone who connected Gmail before this existed keeps
 * their connection — asking them to reconnect for an upgrade they did not ask
 * for is a bad trade, and the token is perfectly good.
 */
export function fromLegacy(raw: string | null, now: number = Date.now()): Mailbox[] {
  if (!raw) return [];
  try {
    const c = JSON.parse(raw) as {
      userId?: unknown; email?: unknown; accessToken?: unknown;
      refreshToken?: unknown; expiresAt?: unknown;
    };
    if (typeof c.userId !== 'string' || typeof c.accessToken !== 'string') return [];

    const email = typeof c.email === 'string' ? c.email : undefined;
    return [{
      id: mailboxId(email, 'legacy'),
      email,
      userId: c.userId,
      accessToken: c.accessToken,
      refreshToken: typeof c.refreshToken === 'string' ? c.refreshToken : undefined,
      expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : 0,
      connectedAt: now,
    }];
  } catch {
    return [];
  }
}

export async function readMailboxes(): Promise<Mailbox[]> {
  const current = parse(await AsyncStorage.getItem(STORE_KEY));
  if (current.length > 0) return current;

  // First run after the upgrade: adopt the old single grant, then retire it so
  // this only ever happens once.
  const legacy = fromLegacy(await AsyncStorage.getItem(LEGACY_KEY));
  if (legacy.length === 0) return [];

  await writeMailboxes(legacy);
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
  return legacy;
}

export async function writeMailboxes(list: readonly Mailbox[]): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(list)).catch(() => {
    // Storage full or unavailable. The list still holds for this session; the
    // worst case is being asked to reconnect next launch.
  });
}
