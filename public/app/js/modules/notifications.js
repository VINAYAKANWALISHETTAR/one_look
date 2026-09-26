/**
 * Browser notification permission + delivery.
 *
 * Single owner of the Notification API. Permission is ONLY requested from an
 * explicit user gesture (the "Enable notifications" button). Once the browser
 * reports "denied" we never ask again — the browser would ignore it anyway and
 * repeated prompts are hostile.
 *
 * Foreground only: notifications fire while One Look is open in a tab.
 * Background delivery needs a service worker and is a later phase.
 */

import { STORES, writeValue } from "../db/indexeddb.js";

const ASKED_KEY = "notificationsAsked";

/** granted | denied | default | unsupported */
export function status() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function isSupported() {
  return "Notification" in window;
}

export function canNotify() {
  return status() === "granted";
}

/** Must be called from a click handler. */
export async function requestPermission() {
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
export function notify(title, { body = "", tag, icon = "/app/assets/icons/icon-192.png" } = {}) {
  if (!canNotify()) return false;
  try {
    new Notification(title, { body, tag, icon });
    return true;
  } catch {
    // Some mobile browsers only allow notifications through a service worker.
    return false;
  }
}

export function statusLabel(state = status()) {
  switch (state) {
    case "granted":
      return "On — reminders appear while One Look is open";
    case "denied":
      return "Turned off in your browser settings";
    case "unsupported":
      return "This browser cannot show notifications";
    default:
      return "Not enabled yet";
  }
}
