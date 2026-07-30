import * as Notifications from 'expo-notifications';
import { Subscription } from './api';
import { fmtMoney } from './currency';
import { TRIAL_WARNING_DAYS, trialDaysLeft } from './trials';
import { parseISO, subDays, isAfter } from 'date-fns';

// Set up a foreground handler once.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  } as any),
});

const LOCAL_ID_PREFIX = 'suborg-';

export type NotifPermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined' | 'unsupported';

export async function getNotifPermission(): Promise<{ state: NotifPermissionState; canAskAgain: boolean }> {
  try {
    const s = await Notifications.getPermissionsAsync();
    const state: NotifPermissionState =
      s.status === 'granted' ? 'granted'
      : s.status === 'denied' ? (s.canAskAgain ? 'denied' : 'blocked')
      : 'undetermined';
    return { state, canAskAgain: s.canAskAgain };
  } catch {
    return { state: 'unsupported', canAskAgain: false };
  }
}

export async function requestNotifPermission(): Promise<NotifPermissionState> {
  try {
    const r = await Notifications.requestPermissionsAsync();
    if (r.status === 'granted') return 'granted';
    if (!r.canAskAgain) return 'blocked';
    return 'denied';
  } catch {
    return 'unsupported';
  }
}

/** 9 AM local — early enough to act on, late enough not to wake anyone. */
function at9am(d: Date): Date {
  const fire = new Date(d);
  fire.setHours(9, 0, 0, 0);
  return fire;
}

/**
 * Schedule (or re-schedule) local reminders for a user's active subs.
 *
 * Two kinds:
 *
 * *Renewal* — one notification, `reminder_days_before` days ahead of the charge.
 *
 * *Trial ending* — up to three, at 7 / 2 / 0 days before the trial converts,
 * because a single reminder is exactly what people miss and being charged for a
 * trial you meant to cancel is the most annoying way this app can fail you.
 *
 * Everything is cleared and rebuilt on each call, so identifiers must be unique
 * per notification, not per subscription — hence the day suffix on trial ones.
 *
 * Silently no-ops when permission is not granted.
 */
export async function rescheduleReminders(subs: Subscription[]): Promise<number> {
  const { state } = await getNotifPermission();
  if (state !== 'granted') return 0;
  try {
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      existing
        .filter((n) => (n.identifier || '').startsWith(LOCAL_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );

    const now = new Date();
    let scheduled = 0;

    for (const s of subs) {
      if (s.status !== 'active') continue;

      const money = fmtMoney(s.amount, s.currency);

      // --- trial conversion ------------------------------------------------
      const left = trialDaysLeft(s, now);
      if (left !== null && left >= 0 && s.trial_ends) {
        const ends = parseISO(s.trial_ends);

        for (const daysAhead of TRIAL_WARNING_DAYS) {
          const fireDate = at9am(subDays(ends, daysAhead));
          if (!isAfter(fireDate, now)) continue;

          await Notifications.scheduleNotificationAsync({
            identifier: `${LOCAL_ID_PREFIX}trial-${s.id}-${daysAhead}`,
            content: {
              title:
                daysAhead === 0
                  ? `${s.name} trial ends today`
                  : `${s.name} trial ends in ${daysAhead} day${daysAhead === 1 ? '' : 's'}`,
              body: `You'll start paying ${money} unless you cancel.`,
              data: { subId: s.id, kind: 'trial-ending' },
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: fireDate,
            } as any,
          });
          scheduled += 1;
        }

        // No renewal reminder on top — the trial warnings cover this period,
        // and two notifications about the same money is nagging.
        continue;
      }

      // --- ordinary renewal ------------------------------------------------
      const renew = parseISO(s.next_renewal);
      const daysBefore = s.reminder_days_before ?? 3;
      const fireDate = at9am(subDays(renew, daysBefore));
      if (!isAfter(fireDate, now)) continue;

      await Notifications.scheduleNotificationAsync({
        identifier: `${LOCAL_ID_PREFIX}${s.id}`,
        content: {
          title: `${s.name} charges in ${daysBefore} day${daysBefore === 1 ? '' : 's'}`,
          body: `You're about to be charged ${money}. Keep or cancel?`,
          data: { subId: s.id, kind: 'renewal-reminder' },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate } as any,
      });
      scheduled += 1;
    }

    return scheduled;
  } catch {
    return 0;
  }
}
