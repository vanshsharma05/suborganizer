import * as Notifications from 'expo-notifications';
import { Subscription } from './api';
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

/**
 * Schedule (or re-schedule) local reminders for a user's active subs.
 * Fires at 9 AM local time, `reminder_days_before` days before renewal.
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
      const renew = parseISO(s.next_renewal);
      const daysBefore = s.reminder_days_before ?? 3;
      const fireDate = subDays(renew, daysBefore);
      fireDate.setHours(9, 0, 0, 0);
      if (!isAfter(fireDate, now)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${LOCAL_ID_PREFIX}${s.id}`,
        content: {
          title: `${s.name} charges in ${daysBefore} day${daysBefore === 1 ? '' : 's'}`,
          body: `You're about to be charged $${s.amount.toFixed(2)}. Keep or cancel?`,
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
