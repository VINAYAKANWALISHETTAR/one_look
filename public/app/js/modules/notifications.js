/**
 * Unified Notifications — works on Web (browser Notification API) and Native (Capacitor LocalNotifications).
 *
 * Single API for both platforms. On native Android, uses Capacitor for background delivery.
 * On web, uses browser Notification API (foreground only).
 */

import { Capacitor } from '@capacitor/core';
import { STORES, writeValue } from "../db/indexeddb.js";

const IS_NATIVE = Capacitor.isNativePlatform();
const ASKED_KEY = "notificationsAsked";

let nativeBridge = null;

/** Initialize native bridge if available. */
async function getNativeBridge() {
  if (!IS_NATIVE) return null;
  if (nativeBridge) return nativeBridge;
  try {
    const mod = await import('../services/capacitor-notifications.js');
    nativeBridge = mod;
    await mod.initNotifications();
    return nativeBridge;
  } catch (error) {
    console.warn('[OneLook] Native bridge unavailable:', error);
    return null;
  }
}

/** granted | denied | default | unsupported */
export async function status() {
  const bridge = await getNativeBridge();
  if (bridge) {
    const perm = await bridge.areNotificationsAvailable();
    return perm ? 'granted' : 'denied';
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function isSupported() {
  return IS_NATIVE || "Notification" in window;
}

export async function canNotify() {
  return (await status()) === "granted";
}

/** Must be called from a click handler. */
export async function requestPermission() {
  const bridge = await getNativeBridge();
  if (bridge) {
    return bridge.requestNotificationPermission();
  }
  if (!isSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  await writeValue(STORES.settings, ASKED_KEY, true);
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Fires a notification. Returns true only when it actually went out. */
export async function notify(title, { body = "", tag, icon = "/app/assets/icons/icon-192.png" } = {}) {
  const bridge = await getNativeBridge();
  if (bridge) {
    try {
      await bridge.scheduleLocalNotification({
        id: tag || `notif-${Date.now()}`,
        title,
        body,
        at: new Date(), // immediate
        channelId: 'onelook-general',
        extra: { tag },
      });
      return true;
    } catch (error) {
      console.error('[OneLook] Native notify failed:', error);
      return false;
    }
  }

  // Web fallback
  if (!(await canNotify())) return false;
  try {
    new Notification(title, { body, tag, icon });
    return true;
  } catch {
    return false;
  }
}

/** Schedule a notification for a specific time (for reminders). */
export async function scheduleNotification({ id, title, body, at, channelId = 'onelook-reminders', extra = {}, actions }) {
  const bridge = await getNativeBridge();
  if (bridge) {
    return bridge.scheduleLocalNotification({ id, title, body, at, channelId, extra, actions });
  }
  // Web: can't schedule future notifications without service worker
  console.warn('[OneLook] Web cannot schedule future notifications; use native build');
  return null;
}

/** Cancel a scheduled notification. */
export async function cancelNotification(id) {
  const bridge = await getNativeBridge();
  if (bridge) return bridge.cancelNotification(id);
}

/** Cancel all scheduled notifications. */
export async function cancelAllNotifications() {
  const bridge = await getNativeBridge();
  if (bridge) return bridge.cancelAllNotifications();
}

export function statusLabel(state) {
  const labels = {
    granted: "On — reminders appear even when app is closed",
    denied: "Turned off in your device settings",
    unsupported: "This device cannot show notifications",
    default: "Not enabled yet",
  };
  return labels[state] || labels.default;
}