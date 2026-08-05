import { describe, expect, it } from 'vitest';
import {
  addMailbox, canAddMore, forUser, fromLegacy, mailboxId, mailboxLabel,
  MAX_MAILBOXES, needsRefresh, removeMailbox, updateTokens, type Mailbox,
} from './mailboxes';

const NOW = 1_800_000_000_000;

function box(over: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'work@gmail.com',
    email: 'work@gmail.com',
    userId: 'user-1',
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: NOW + 3_600_000,
    connectedAt: NOW,
    ...over,
  };
}

describe('mailboxId', () => {
  it('is the lowercased address', () => {
    expect(mailboxId('Work@Gmail.com', 'x')).toBe('work@gmail.com');
    expect(mailboxId('  work@gmail.com  ', 'x')).toBe('work@gmail.com');
  });

  it('falls back when Google told us no address', () => {
    expect(mailboxId(undefined, 'fallback-1')).toBe('fallback-1');
    expect(mailboxId('', 'fallback-1')).toBe('fallback-1');
  });
});

describe('addMailbox', () => {
  it('appends a new inbox', () => {
    const list = addMailbox([box()], box({ id: 'personal@gmail.com', email: 'personal@gmail.com' }));
    expect(list.map((m) => m.id)).toEqual(['work@gmail.com', 'personal@gmail.com']);
  });

  /**
   * Two grants for one address means every message is read twice and every
   * candidate found twice. Reconnecting has to replace, not append.
   */
  it('replaces the grant for an address already connected', () => {
    const list = addMailbox([box()], box({ accessToken: 'newer' }));
    expect(list).toHaveLength(1);
    expect(list[0].accessToken).toBe('newer');
  });

  it('keeps the original position and connection date when replacing', () => {
    const first = box();
    const second = box({ id: 'b@gmail.com', email: 'b@gmail.com', connectedAt: NOW + 5000 });
    const list = addMailbox([first, second], box({ accessToken: 'newer', connectedAt: NOW + 9999 }));

    expect(list.map((m) => m.id)).toEqual(['work@gmail.com', 'b@gmail.com']);
    expect(list[0].connectedAt).toBe(NOW);
  });
});

describe('removeMailbox', () => {
  it('drops one and keeps the rest', () => {
    const list = [box(), box({ id: 'b@gmail.com' })];
    expect(removeMailbox(list, 'work@gmail.com').map((m) => m.id)).toEqual(['b@gmail.com']);
  });

  it('removing something absent is a no-op', () => {
    const list = [box()];
    expect(removeMailbox(list, 'nope')).toEqual(list);
  });
});

describe('forUser', () => {
  /** A device may have been shared. Another account's grant must never be read. */
  it('never returns another account\'s mailboxes', () => {
    const list = [box(), box({ id: 'other', userId: 'user-2' })];
    expect(forUser(list, 'user-1').map((m) => m.id)).toEqual(['work@gmail.com']);
    expect(forUser(list, 'user-3')).toEqual([]);
  });
});

describe('needsRefresh', () => {
  it('is false while the token has time left', () => {
    expect(needsRefresh(box({ expiresAt: NOW + 600_000 }), NOW)).toBe(false);
  });

  it('is true once expired', () => {
    expect(needsRefresh(box({ expiresAt: NOW - 1 }), NOW)).toBe(true);
  });

  /** Refresh early, so a scan never starts on a token that dies mid-run. */
  it('is true inside the safety margin', () => {
    expect(needsRefresh(box({ expiresAt: NOW + 60_000 }), NOW)).toBe(true);
  });
});

describe('updateTokens', () => {
  it('replaces tokens on the right mailbox only', () => {
    const list = [box(), box({ id: 'b@gmail.com', accessToken: 'b-tok' })];
    const next = updateTokens(list, 'work@gmail.com', {
      accessToken: 'fresh', refreshToken: 'fresh-ref', expiresAt: NOW + 7_200_000,
    });

    expect(next[0]).toMatchObject({ accessToken: 'fresh', refreshToken: 'fresh-ref' });
    expect(next[1].accessToken).toBe('b-tok');
  });

  /**
   * Google usually omits the refresh token when refreshing. Overwriting with
   * undefined would throw away the only thing that keeps the grant alive.
   */
  it('keeps the existing refresh token when none comes back', () => {
    const next = updateTokens([box()], 'work@gmail.com', {
      accessToken: 'fresh', expiresAt: NOW + 7_200_000,
    });
    expect(next[0].refreshToken).toBe('ref');
  });
});

describe('canAddMore', () => {
  it('allows up to the limit', () => {
    const list = Array.from({ length: MAX_MAILBOXES - 1 }, (_, i) => box({ id: `m${i}` }));
    expect(canAddMore(list, 'user-1')).toBe(true);
  });

  it('stops at the limit', () => {
    const list = Array.from({ length: MAX_MAILBOXES }, (_, i) => box({ id: `m${i}` }));
    expect(canAddMore(list, 'user-1')).toBe(false);
  });

  it('counts only this user\'s', () => {
    const list = Array.from({ length: MAX_MAILBOXES }, (_, i) =>
      box({ id: `m${i}`, userId: 'someone-else' }));
    expect(canAddMore(list, 'user-1')).toBe(true);
  });
});

describe('mailboxLabel', () => {
  it('is the address when there is one', () => {
    expect(mailboxLabel(box())).toBe('work@gmail.com');
  });

  it('says something rather than nothing when there is not', () => {
    expect(mailboxLabel(box({ email: undefined }))).toBe('Connected inbox');
  });
});

/**
 * Anyone who connected Gmail before this existed keeps their connection.
 * Making them reconnect for an upgrade they did not ask for is a bad trade,
 * and the token is perfectly good.
 */
describe('fromLegacy', () => {
  it('adopts a single-grant record', () => {
    const raw = JSON.stringify({
      userId: 'user-1', email: 'old@gmail.com', accessToken: 'tok',
      refreshToken: 'ref', expiresAt: NOW + 1000,
    });
    expect(fromLegacy(raw, NOW)).toEqual([{
      id: 'old@gmail.com', email: 'old@gmail.com', userId: 'user-1',
      accessToken: 'tok', refreshToken: 'ref', expiresAt: NOW + 1000, connectedAt: NOW,
    }]);
  });

  it('copes with a grant that never learned its address', () => {
    const raw = JSON.stringify({ userId: 'user-1', accessToken: 'tok', expiresAt: 0 });
    const out = fromLegacy(raw, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('legacy');
    expect(out[0].email).toBeUndefined();
  });

  it('refuses anything without the two fields that matter', () => {
    expect(fromLegacy(JSON.stringify({ email: 'a@b.com' }), NOW)).toEqual([]);
    expect(fromLegacy(JSON.stringify({ userId: 'user-1' }), NOW)).toEqual([]);
    expect(fromLegacy('not json', NOW)).toEqual([]);
    expect(fromLegacy(null, NOW)).toEqual([]);
  });
});
