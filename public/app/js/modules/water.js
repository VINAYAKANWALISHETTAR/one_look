/**
 * Water tracker — daily goal, real logged intake, optional reminders.
 *
 * One row per calendar day in the `water` store, so history is real history:
 * nothing is estimated, back-filled or reset silently. The day rolls over by
 * date, not by a timer, so an app that was closed overnight still shows the
 * right day when it opens.
 *
 * Settings: { goalMl, cupMl, reminderEveryMin, fromHour, toHour }
 */

import { STORES, get, put, getAll, readValue, writeValue } from "../db/indexeddb.js";
import { todayISO } from "./format.js";

const SETTINGS_KEY = "waterSettings";
const LAST_REMINDER_KEY = "waterLastReminderAt";

export const DEFAULTS = {
  goalMl: 2000,
  cupMl: 250,
  reminderEveryMin: 0, // 0 = reminders off
  fromHour: 8,
  toHour: 22,
};

/** Quick-add buttons offered next to the progress ring. */
export const QUICK_AMOUNTS = [200, 250, 500];

export async function getSettings() {
  const saved = await readValue(STORES.settings, SETTINGS_KEY, null);
  return { ...DEFAULTS, ...(saved || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  next.goalMl = Math.min(Math.max(Number(next.goalMl) || DEFAULTS.goalMl, 250), 8000);
  next.cupMl = Math.min(Math.max(Number(next.cupMl) || DEFAULTS.cupMl, 50), 1000);
  next.reminderEveryMin = Math.min(Math.max(Number(next.reminderEveryMin) || 0, 0), 480);
  next.fromHour = Math.min(Math.max(Number(next.fromHour) || 0, 0), 23);
  next.toHour = Math.min(Math.max(Number(next.toHour) || 0, 0), 23);
  await writeValue(STORES.settings, SETTINGS_KEY, next);
  return next;
}

async function dayRow(date = todayISO()) {
  return (await get(STORES.water, date)) || { date, ml: 0, entries: [] };
}

/** { date, ml, goalMl, percent, remainingMl, entries, cupMl } */
export async function todayProgress() {
  const settings = await getSettings();
  const row = await dayRow();
  const percent = Math.min(100, Math.round((row.ml / settings.goalMl) * 100));
  return {
    ...row,
    goalMl: settings.goalMl,
    cupMl: settings.cupMl,
    percent,
    remainingMl: Math.max(0, settings.goalMl - row.ml),
    reached: row.ml >= settings.goalMl,
  };
}

export async function addWater(ml) {
  const amount = Math.min(Math.max(Number(ml) || 0, 10), 2000);
  const row = await dayRow();
  const next = {
    ...row,
    ml: row.ml + amount,
    entries: [...row.entries, { ml: amount, at: new Date().toISOString() }].slice(-40),
  };
  await put(STORES.water, next);
  return todayProgress();
}

/** Removes the most recent entry — the only way to correct a mis-tap. */
export async function undoLast() {
  const row = await dayRow();
  if (!row.entries.length) return todayProgress();
  const entries = row.entries.slice(0, -1);
  const last = row.entries[row.entries.length - 1];
  await put(STORES.water, { ...row, ml: Math.max(0, row.ml - last.ml), entries });
  return todayProgress();
}

/** Real logged days, newest first. Days with no intake simply do not exist. */
export async function history(limit = 7) {
  const rows = await getAll(STORES.water);
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
}

export function summaryLine(progress) {
  if (progress.reached) return `Goal reached · ${progress.ml} ml`;
  return `${progress.ml} of ${progress.goalMl} ml · ${progress.remainingMl} ml to go`;
}

/**
 * Returns a reminder to record, or null. The scheduler owns delivery; this
 * function only decides whether one is due (interval elapsed, inside the
 * user's active hours, goal not already reached).
 */
export async function dueReminder(now = new Date()) {
  const settings = await getSettings();
  if (!settings.reminderEveryMin) return null;

  const hour = now.getHours();
  if (hour < settings.fromHour || hour > settings.toHour) return null;

  const progress = await todayProgress();
  if (progress.reached) return null;

  const last = await readValue(STORES.settings, LAST_REMINDER_KEY, null);
  if (last && now - new Date(last) < settings.reminderEveryMin * 60000) return null;

  await writeValue(STORES.settings, LAST_REMINDER_KEY, now.toISOString());
  const slot = Math.floor(now.getTime() / (settings.reminderEveryMin * 60000));
  return {
    type: "water",
    title: "Time for water",
    body: summaryLine(progress),
    tag: `water:${todayISO(now)}:${slot}`,
    action: "/water",
  };
}
