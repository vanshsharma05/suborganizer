/**
 * Applying scan results.
 *
 * The case worth pinning is two candidates that share a display name. Keys are
 * `domain:product`, so "Google" can legitimately appear twice — google.com:one
 * and google.com:workspace. When the outcome reported failures by name, one
 * failing marked its namesake failed too, the caller kept the successful one on
 * screen and ticked, and the retry inserted a second row for a subscription
 * already written. Duplicated spending is the kind of bug people notice on
 * their own dashboard.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createSubscription, patchSubscription } = vi.hoisted(() => ({
  createSubscription: vi.fn(),
  patchSubscription: vi.fn(),
}));

vi.mock('../api', () => ({ createSubscription, patchSubscription }));

/* eslint-disable import/first -- vi.mock is hoisted above every import in
   the file, so the module under test has to be imported after the mock is
   declared or it binds to the real dependency. Reordering breaks the test. */
import { applyCandidates } from './apply';
import type { Candidate } from './scan';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    key: 'example.com:thing',
    name: 'Example',
    amount: 499,
    currency: 'INR',
    billing_cycle: 'monthly',
    category: 'Other',
    next_renewal: '2026-09-01',
    status: 'active',
    events: [],
    reasons: [],
    ...over,
  } as Candidate;
}

beforeEach(() => {
  createSubscription.mockReset().mockResolvedValue({ id: 'new' });
  patchSubscription.mockReset().mockResolvedValue({ id: 'patched' });
});

describe('applyCandidates', () => {
  it('reports failures by key, so a shared name cannot mark the wrong one', async () => {
    const one = candidate({ key: 'google.com:one', name: 'Google' });
    const workspace = candidate({ key: 'google.com:workspace', name: 'Google' });

    // The first fails, the second is written.
    createSubscription
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'written' });

    const outcome = await applyCandidates([one, workspace]);

    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toEqual([{ key: 'google.com:one', name: 'Google' }]);

    // The whole point: the key that succeeded is not in the failed set, so the
    // caller drops it and a second tap cannot write it again.
    const failedKeys = new Set(outcome.failed.map((f) => f.key));
    expect(failedKeys.has('google.com:workspace')).toBe(false);
  });

  it('keeps going after one candidate throws', async () => {
    createSubscription
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'b' })
      .mockResolvedValueOnce({ id: 'c' });

    const outcome = await applyCandidates([
      candidate({ key: 'a:1', name: 'A' }),
      candidate({ key: 'b:1', name: 'B' }),
      candidate({ key: 'c:1', name: 'C' }),
    ]);

    expect(outcome.imported).toBe(2);
    expect(outcome.failed.map((f) => f.key)).toEqual(['a:1']);
  });

  it('reconciles an existing row rather than inserting a second one', async () => {
    const outcome = await applyCandidates([
      candidate({ existingId: 'sub-1', drift: 'amount-changed', amount: 599 }),
    ]);

    expect(createSubscription).not.toHaveBeenCalled();
    expect(patchSubscription).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ imported: 0, reconciled: 1 });
  });

  it('does nothing at all for a tracked row that has not drifted', async () => {
    const outcome = await applyCandidates([candidate({ existingId: 'sub-1', drift: undefined })]);

    expect(createSubscription).not.toHaveBeenCalled();
    expect(patchSubscription).not.toHaveBeenCalled();
    expect(outcome).toEqual({ imported: 0, reconciled: 0, failed: [] });
  });
});
