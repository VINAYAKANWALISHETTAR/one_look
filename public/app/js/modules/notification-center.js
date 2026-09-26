/**
 * Notification Center — one inbox for everything One Look tells the user.
 *
 * Every alert the app produces (task reminders, water, health breaks, calendar
 * events, mail signals, weather warnings, news) is recorded here first, then
 * optionally delivered as a browser notification. That gives a WhatsApp-style
 * history: unread badge, read/unread state, dismiss, snooze, and a full list
 * even when the OS notification was missed.
 *
 * Record shape:
 *   { id, type, title, body, tag, createdAt, readAt, dismissedAt,
 *     snoozeUntil, action }
 *
 * `tag` makes an alert idempotent: the same reminder can be handed in twice
 * (two ticks, two tabs) and only one record exists. `action` is a plain route
 * string like "/tasks" so the UI can offer "Open" without storing callbacks.
 *
 * Local only — notifications are device state and are never pushed to the API.
 */

import { STORES, getAll, get, put, remove, uid, readValue, writeValue } from "../db/indexeddb.js";
import { canNotify, notify } from "./notifications.js";

const KEEP_DAYS = 30;
const MAX_ITEMS = 300;
const SEEN_KEY = "notificationCenterSeenTags";

export const TYPES = {
  task: { label: "Tasks" },
  calendar: { label: "Calendar" },
  mail: { label: "Mail" },
  water: { label: "Water" },
  health: { label: "Health" },
  weather: { label: "Weather" },
  news: { label: "News" },
};

export function typeLabel(type) {
  return TYPES[type]?.label || "One Look";
}

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : -1);

async function seenTags() {
  const list = await readValue(STORES.settings, SEEN_KEY, []);
  return Array.isArray(list) ? list : [];
}

/**
 * Records an alert. Returns the stored record, or null when `tag` has already
 * been recorded (so callers can simply call this on every tick).
 * `deliver: true` also fires a browser notification when permission allows.
 */
export async function add({ type, title, body = "", tag, action = "", deliver = true }) {
  if (!title) return null;

  if (tag) {
    const seen = await seenTags();
    if (seen.includes(tag)) return null;
    await writeValue(STORES.settings, SEEN_KEY, [...seen, tag].slice(-MAX_ITEMS));
  }

  const item = {
    id: uid("notif"),
    type: TYPES[type] ? type : "task",
    title,
    body,
    tag: tag || null,
    action,
    createdAt: new Date().toISOString(),
    readAt: null,
    dismissedAt: null,
    snoozeUntil: null,
  };

  await put(STORES.notifications, item);
  if (deliver && canNotify()) notify(title, { body, tag: tag || item.id });
  return item;
}

/** Visible history, newest first. Dismissed items are hidden by default. */
export async function list({ includeDismissed = false, type = "all" } = {}) {
  const rows = await getAll(STORES.notifications);
  return rows
    .filter((row) => (includeDismissed ? true : !row.dismissedAt))
    .filter((row) => (type === "all" ? true : row.type === type))
    .sort(newestFirst);
}

export async function unreadCount() {
  const rows = await getAll(STORES.notifications);
  return rows.filter((row) => !row.readAt && !row.dismissedAt).length;
}

export async function markRead(id) {
  const row = await get(STORES.notifications, id);
  if (!row || row.readAt) return row || null;
  const next = { ...row, readAt: new Date().toISOString() };
  await put(STORES.notifications, next);
  return next;
}

export async function markAllRead() {
  const rows = await getAll(STORES.notifications);
  const now = new Date().toISOString();
  for (const row of rows) {
    if (!row.readAt && !row.dismissedAt) await put(STORES.notifications, { ...row, readAt: now });
  }
}

export async function dismiss(id) {
  const row = await get(STORES.notifications, id);
  if (!row) return;
  const now = new Date().toISOString();
  await put(STORES.notifications, { ...row, dismissedAt: now, readAt: row.readAt || now });
}

/** Snoozed items come back through `tickSnoozed` when the time is up. */
export async function snooze(id, minutes) {
  const row = await get(STORES.notifications, id);
  if (!row) return null;
  const next = {
    ...row,
    readAt: new Date().toISOString(),
    snoozeUntil: new Date(Date.now() + Number(minutes) * 60000).toISOString(),
  };
  await put(STORES.notifications, next);
  return next;
}

/** Re-delivers snoozed alerts whose time has arrived. Called by the scheduler. */
export async function tickSnoozed(now = new Date()) {
  const rows = await getAll(STORES.notifications);
  const woken = [];
  for (const row of rows) {
    if (!row.snoozeUntil || row.dismissedAt) continue;
    if (new Date(row.snoozeUntil) > now) continue;
    const next = { ...row, snoozeUntil: null, readAt: null, createdAt: now.toISOString() };
    await put(STORES.notifications, next);
    if (canNotify()) notify(row.title, { body: row.body, tag: `${row.id}:snoozed` });
    woken.push(next);
  }
  return woken;
}

export async function clearAll() {
  const rows = await getAll(STORES.notifications);
  for (const row of rows) await remove(STORES.notifications, row.id);
  await writeValue(STORES.settings, SEEN_KEY, []);
}

/** Keeps the history from growing without bound. */
export async function purgeOld(now = new Date()) {
  const rows = (await getAll(STORES.notifications)).sort(newestFirst);
  const cutoff = now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let index = 0;
  for (const row of rows) {
    index += 1;
    const old = new Date(row.createdAt).getTime() < cutoff;
    if (old || index > MAX_ITEMS) await remove(STORES.notifications, row.id);
  }
}
