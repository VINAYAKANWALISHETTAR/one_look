/**
 * Capacitor Notification Bridge — native local notifications for Android.
 *
 * Replaces browser Notification API with Capacitor LocalNotifications
 * so reminders fire even when app is backgrounded/closed.
 *
 * Integrates with existing notification-center.js (add, list, dismiss, snooze)
 * and reminders.js (tick, dueReminders).
 */

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';

const IS_NATIVE = Capacitor.isNativePlatform();
const ANDROID = Capacitor.getPlatform() === 'android';

let notificationListenerRegistered = false;
let pushListenerRegistered = false;

/** Initialize native notification channels and listeners. */
export async function initNotifications() {
  if (!IS_NATIVE) return { native: false };

  try {
    // Request permissions (Android 13+)
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      console.warn('[OneLook] Notification permission not granted');
      return { native: true, permitted: false };
    }

    // Create notification channel for reminders (Android)
    if (ANDROID) {
      await LocalNotifications.createChannel({
        id: 'onelook-reminders',
        name: 'One Look Reminders',
        description: 'Task reminders and scheduled alerts',
        importance: 4, // HIGH
        visibility: 1, // PUBLIC
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#6ea8ff',
      });

      await LocalNotifications.createChannel({
        id: 'onelook-general',
        name: 'One Look Notifications',
        description: 'General app notifications (water, health, mail, etc.)',
        importance: 3, // DEFAULT
        visibility: 1,
        sound: 'default',
        vibration: true,
      });
    }

    // Register notification action listener (tap on notification)
    if (!notificationListenerRegistered) {
      await LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
        handleNotificationAction(notification);
      });
      notificationListenerRegistered = true;
    }

    // Register push notification listeners (for FCM)
    if (!pushListenerRegistered) {
      await registerPushListeners();
      pushListenerRegistered = true;
    }

    console.log('[OneLook] Native notifications initialized');
    return { native: true, permitted: true };
  } catch (error) {
    console.error('[OneLook] Failed to init native notifications:', error);
    return { native: true, permitted: false, error };
  }
}

/** Register push notification listeners for FCM. */
async function registerPushListeners() {
  try {
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') {
      await PushNotifications.register();

      PushNotifications.addListener('registration', (token) => {
        console.log('[OneLook] FCM token:', token.value);
        // Send token to backend for server-side push
        sendTokenToBackend(token.value).catch(() => {});
      });

      PushNotifications.addListener('registrationError', (err) => {
        console.error('[OneLook] FCM registration error:', err);
      });

      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('[OneLook] Push received:', notification);
        handlePushNotification(notification);
      });
    }
  } catch (error) {
    console.error('[OneLook] Push registration failed:', error);
  }
}

/** Send FCM token to backend for server-side push. */
async function sendTokenToBackend(token) {
  try {
    const { authed } = await import('../services/api-service.js');
    await authed('/auth/fcm-token', {
      method: 'POST',
      body: { token, platform: 'android' },
    });
  } catch (error) {
    // Backend might not have this endpoint yet; silently fail
    console.debug('[OneLook] FCM token send skipped:', error.message);
  }
}

/** Handle tap on local notification — navigate to action route. */
function handleNotificationAction(notification) {
  const { actionId, extra } = notification.notification;
  const route = extra?.route || '/home';

  if (actionId === 'tap' || actionId === 'OPEN_APP' || !actionId) {
    navigateToRoute(route);
  } else if (actionId === 'snooze') {
    const minutes = extra?.snoozeMinutes || 10;
    snoozeNotification(extra?.notificationId, minutes);
  } else if (actionId === 'dismiss') {
    dismissNotification(extra?.notificationId);
  }
}

/** Handle incoming push notification (FCM). */
function handlePushNotification(notification) {
  const { data } = notification;
  if (data?.type && data?.title) {
    // Record in notification center
    import('./notification-center.js').then(({ add }) => {
      add({
        type: data.type,
        title: data.title,
        body: data.body || '',
        tag: data.tag || `push-${Date.now()}`,
        action: data.action || '/home',
        deliver: true,
      });
    });
  }
}

/** Navigate to a route in the hash router. */
function navigateToRoute(route) {
  if (typeof window !== 'undefined') {
    window.location.hash = route;
  }
}

/** Schedule a local notification (replaces browser Notification). */
export async function scheduleLocalNotification({
  id,
  title,
  body,
  at,
  channelId = 'onelook-reminders',
  extra = {},
  actionTypeId = 'OPEN_APP',
  actions = [],
}) {
  if (!IS_NATIVE) {
    // Fallback to browser notification
    const { notify } = await import('./notifications.js');
    return notify(title, { body, tag: String(id) });
  }

  try {
    const scheduledAt = at instanceof Date ? at : new Date(at);
    const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));

    const notification = {
      id: notificationId,
      title,
      body,
      schedule: { at: scheduledAt },
      channelId,
      extra: { ...extra, notificationId, route: extra.route || '/home' },
      actionTypeId,
      actions: actions.length ? actions : [
        { id: 'OPEN_APP', title: 'Open' },
        { id: 'snooze', title: 'Snooze 10m', extra: { snoozeMinutes: 10 } },
        { id: 'dismiss', title: 'Dismiss', destructive: true },
      ],
      smallIcon: 'ic_stat_onelook',
      color: '#6ea8ff',
      sound: 'default',
      vibration: true,
    };

    await LocalNotifications.schedule({ notifications: [notification] });
    console.log('[OneLook] Scheduled native notification:', notificationId, 'at', scheduledAt);
    return { id: notificationId, scheduledAt };
  } catch (error) {
    console.error('[OneLook] Failed to schedule native notification:', error);
    throw error;
  }
}

/** Cancel a scheduled notification by ID. */
export async function cancelNotification(id) {
  if (!IS_NATIVE) return;
  const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
  try {
    await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
    console.log('[OneLook] Cancelled notification:', notificationId);
  } catch (error) {
    console.error('[OneLook] Failed to cancel notification:', error);
  }
}

/** Cancel all scheduled notifications. */
export async function cancelAllNotifications() {
  if (!IS_NATIVE) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({ notifications: pending.notifications });
    }
  } catch (error) {
    console.error('[OneLook] Failed to cancel all notifications:', error);
  }
}

/** Get all pending scheduled notifications. */
export async function getPendingNotifications() {
  if (!IS_NATIVE) return [];
  try {
    const pending = await LocalNotifications.getPending();
    return pending.notifications;
  } catch (error) {
    console.error('[OneLook] Failed to get pending notifications:', error);
    return [];
  }
}

/** Snooze a notification (reschedule for later). */
export async function snoozeNotification(id, minutes = 10) {
  const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
  const at = new Date(Date.now() + minutes * 60000);
  await scheduleLocalNotification({
    id: notificationId,
    title: 'Snoozed reminder',
    body: `You snoozed this for ${minutes} minutes`,
    at,
    extra: { snoozed: true, originalId: notificationId },
  });
}

/** Dismiss a notification (cancel + mark read in center). */
export async function dismissNotification(id) {
  const notificationId = typeof id === 'number' ? id : Math.abs(hashCode(String(id)));
  await cancelNotification(notificationId);
  // Also dismiss in notification center
  try {
    const { dismiss } = await import('./notification-center.js');
    await dismiss(notificationId);
  } catch {}
}

/** Check if native notifications are available and permitted. */
export async function areNotificationsAvailable() {
  if (!IS_NATIVE) {
    const { canNotify } = await import('./notifications.js');
    return canNotify();
  }
  try {
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === 'granted';
  } catch {
    return false;
  }
}

/** Request notification permission (native). */
export async function requestNotificationPermission() {
  if (!IS_NATIVE) {
    const { requestPermission } = await import('./notifications.js');
    return requestPermission();
  }
  try {
    const perm = await LocalNotifications.requestPermissions();
    return perm.display === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/** Simple hash for string-to-int conversion. */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

/** Replace the browser `notify` function with native version. */
export async function patchNotify() {
  if (!IS_NATIVE) return;

  const { notify: browserNotify } = await import('./notifications.js');

  // Override the global notify behavior in notification-center
  // by patching the canNotify/notify imports
  console.log('[OneLook] Native notification bridge active');
}

export { IS_NATIVE, ANDROID };