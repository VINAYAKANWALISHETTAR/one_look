/**
 * Hub scheduler — the single background loop for everything that is not a task
 * reminder (those stay owned by modules/reminders.js).
 *
 * Each minute it asks the water tracker and the health reminders whether
 * anything is due, records what comes back in the Notification Center (which
 * also delivers the browser notification), wakes snoozed alerts, and trims old
 * history once a day.
 *
 * Foreground only, like the rest of One Look's alerts: nothing here promises
 * delivery while the app is closed.
 */

import * as center from "./notification-center.js";
import * as water from "./water.js";
import * as health from "./health.js";

const TICK_MS = 60_000;

let timer = null;
let lastPurge = 0;

export async function tick(now = new Date()) {
  const pending = [];

  const waterReminder = await water.dueReminder(now).catch(() => null);
  if (waterReminder) pending.push(waterReminder);

  const healthReminders = await health.dueReminders(now).catch(() => []);
  pending.push(...healthReminders);

  for (const item of pending) await center.add(item).catch(() => {});

  await center.tickSnoozed(now).catch(() => {});

  if (now.getTime() - lastPurge > 24 * 60 * 60 * 1000) {
    lastPurge = now.getTime();
    await center.purgeOld(now).catch(() => {});
  }

  return pending;
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
