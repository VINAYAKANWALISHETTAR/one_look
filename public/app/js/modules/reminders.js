/**
 * Reminders — derived from tasks, never a separate source of truth.
 *
 * Each task carries `reminderOffset` + `reminderAt` (see modules/tasks.js), so
 * editing or deleting a task automatically updates or removes its reminder:
 * there is nothing else to keep in sync.
 *
 * This module owns the scheduling loop and hands every due reminder to the
 * Notification Center, which records it and delivers the browser notification.
 *
 * Legacy note: the loop It polls IndexedDB every 30s (and on
 * tab focus) and hands anything due to modules/notifications.js. Delivered keys
 * live in the `settings` store so a refresh never re-fires the same reminder.
 *
 * Foreground only. Background delivery = PWA/service-worker phase.
 */

import { listTasks } from "./tasks.js";
import { STORES, readValue, writeValue } from "../db/indexeddb.js";
import { formatTime } from "./format.js";
import * as center from "./notification-center.js";

const DELIVERED_KEY = "remindersDelivered";
const TICK_MS = 30000;
/** Reminders missed while the app was closed only fire if recent. */
const GRACE_MS = 60 * 60 * 1000;

let timer = null;

export function reminderKey(task) {
  return `${task.id}@${task.reminderAt}`;
}

async function delivered() {
  const list = await readValue(STORES.settings, DELIVERED_KEY, []);
  return Array.isArray(list) ? list : [];
}

async function markDelivered(keys) {
  if (!keys.length) return;
  const seen = await delivered();
  await writeValue(STORES.settings, DELIVERED_KEY, [...seen, ...keys].slice(-300));
}

/** Open tasks that have a reminder still ahead of `now`. */
export async function upcomingReminders(now = new Date()) {
  const tasks = await listTasks();
  return tasks
    .filter((t) => t.status === "pending" && t.reminderAt && new Date(t.reminderAt) > now)
    .sort((a, b) => new Date(a.reminderAt) - new Date(b.reminderAt));
}

/** Open tasks whose reminder moment has already arrived. */
export async function dueReminders(now = new Date()) {
  const tasks = await listTasks();
  return tasks.filter(
    (task) => task.status === "pending" && task.reminderAt && new Date(task.reminderAt) <= now,
  );
}

/** Text for the notification body: "Starts in 15 minutes". */
export function reminderBody(task, now = new Date()) {
  if (!task.time) return "Due today";
  const start = new Date(task.date + "T" + task.time + ":00");
  const mins = Math.round((start - now) / 60000);
  if (mins > 1440) return `Due ${formatTime(task.time)} on ${task.date}`;
  if (mins >= 60) {
    const h = Math.round(mins / 60);
    return `Starts in ${h} hour${h === 1 ? "" : "s"}`;
  }
  if (mins >= 2) return `Starts in ${mins} minutes`;
  if (mins >= 0) return "Starting now";
  return `Was due at ${formatTime(task.time)}`;
}

export async function tick(now = new Date()) {
  const seen = await delivered();
  const due = (await dueReminders(now)).filter((task) => !seen.includes(reminderKey(task)));
  if (!due.length) return [];

  const fired = [];
  const skipped = [];

  for (const task of due) {
    const late = now - new Date(task.reminderAt) > GRACE_MS;
    if (late) {
      skipped.push(reminderKey(task));
      continue;
    }
    // The Notification Center records the alert (so it has a history even when
    // notifications are off) and delivers the browser notification itself.
    const recorded = await center.add({
      type: "task",
      title: task.title,
      body: reminderBody(task, now),
      tag: reminderKey(task),
      action: "/tasks",
    });
    if (recorded) fired.push(task);
  }

  await markDelivered([...skipped, ...fired.map(reminderKey)]);
  return fired;
}


function onVisible() {
  if (!document.hidden) tick().catch(() => {});
}

export function start() {
  stop();
  tick().catch(() => {});
  timer = window.setInterval(() => tick().catch(() => {}), TICK_MS);
  document.addEventListener("visibilitychange", onVisible);
}

export function stop() {
  if (timer) window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
}
