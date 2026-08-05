/**
 * Writing scan results back into the subscriptions table.
 *
 * Nothing here runs without an explicit tap in app/scan.tsx — a mailbox reading
 * is a suggestion, and silently rewriting someone's tracked spending on the
 * strength of a regex would be the wrong kind of clever.
 */

import { format } from 'date-fns';
import {
  createSubscription,
  patchSubscription,
  Subscription,
  SubscriptionInput,
} from '../api';
import { packPaymentMethod } from './payment-method';
import type { Candidate } from './scan';

/** Traceability: which emails produced this row, in the row itself. */
function noteFor(candidate: Candidate): string {
  const lines = [`Found by Gmail scan on ${format(new Date(), 'd MMM yyyy')}.`];

  lines.push(`${candidate.events.length} matching email${candidate.events.length === 1 ? '' : 's'}.`);
  if (candidate.lastChargeAt) {
    lines.push(`Last charge ${format(new Date(candidate.lastChargeAt), 'd MMM yyyy')}.`);
  }
  if (candidate.cancelledAt) {
    lines.push(`Cancelled ${format(new Date(candidate.cancelledAt), 'd MMM yyyy')}.`);
  }
  if (candidate.restartedAt) {
    lines.push(`Restarted ${format(new Date(candidate.restartedAt), 'd MMM yyyy')}.`);
  }
  lines.push(...candidate.reasons.map((r) => `• ${r}`));

  return lines.join('\n');
}

export function toSubscriptionInput(candidate: Candidate): SubscriptionInput {
  return {
    name: candidate.name,
    // A candidate with no amount is still worth tracking; 0 makes it obvious
    // in the list that a price needs filling in.
    amount: candidate.amount ?? 0,
    currency: candidate.currency,
    billing_cycle: candidate.billing_cycle,
    category: candidate.category,
    next_renewal: candidate.next_renewal,
    domain: candidate.domain ?? null,
    brand_color: null,
    notes: noteFor(candidate),
    status: candidate.status,
    reminder_days_before: 3,
    snoozed_until: null,
    // Null rather than omitted, so a subscription whose receipts never named an
    // instrument reads as "we do not know" instead of inheriting a stale value.
    payment_method: packPaymentMethod(candidate.payment),
  };
}

export async function importCandidate(candidate: Candidate): Promise<Subscription> {
  return createSubscription(toSubscriptionInput(candidate));
}

/**
 * Bring an already-tracked subscription in line with what the mailbox says.
 * Only the drifted fields move — the user's own category, reminder window and
 * notes are theirs, not the scanner's to overwrite.
 */
export async function reconcileCandidate(candidate: Candidate): Promise<Subscription> {
  if (!candidate.existingId) throw new Error('Nothing to reconcile');

  const patch: Partial<SubscriptionInput> = {};

  switch (candidate.drift) {
    case 'cancelled-in-gmail':
      patch.status = 'cancelled';
      break;
    case 'active-again':
      patch.status = 'active';
      patch.next_renewal = candidate.next_renewal;
      break;
    case 'amount-changed':
      if (candidate.amount !== undefined) {
        patch.amount = candidate.amount;
        patch.currency = candidate.currency;
      }
      break;
    default:
      break;
  }

  // The payment method moves whenever the scan learned one, whatever the drift
  // was. It is not the user's own field to defend — unlike category or notes,
  // nobody types it — and a card that changed is exactly what they want to see.
  const payment = packPaymentMethod(candidate.payment);
  if (payment) patch.payment_method = payment;

  return patchSubscription(candidate.existingId, patch);
}

export type ImportOutcome = { imported: number; reconciled: number; failed: string[] };

/** Applies a selection, keeping going past individual failures. */
export async function applyCandidates(candidates: Candidate[]): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, reconciled: 0, failed: [] };

  for (const candidate of candidates) {
    try {
      if (candidate.existingId) {
        if (!candidate.drift) continue;
        await reconcileCandidate(candidate);
        outcome.reconciled++;
      } else {
        await importCandidate(candidate);
        outcome.imported++;
      }
    } catch {
      outcome.failed.push(candidate.name);
    }
  }

  return outcome;
}
