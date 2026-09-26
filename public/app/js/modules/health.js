/**
 * Health reminders — walking, stretching and screen breaks.
 *
 * Each reminder is an interval inside the user's active hours; everything is
 * off until the user switches it on, so the app never nags by default. State is
 * just "when did this last fire", which keeps the logic honest across restarts:
 * a closed app simply misses that interval instead of firing a burst on open.
 */

import { STORES, readValue, writeValue } from "../db/indexeddb.js";

const SETTINGS_KEY = "healthSettings";
const LAST_KEY = "healthLastFired";

export const KINDS = [
  {
    id: "walk",
    label: "Walking break",
    body: "Stand up and walk for a few minutes.",
    defaultEveryMin: 60,
  },
  {
    id: "stretch",
    label: "Stretch",
    body: "Roll your shoulders and stretch your back.",
    defaultEveryMin: 90,
  },
  {
    id: "break",
    label: "Screen break",
    body: "Look away from the screen for 20 seconds.",
    defaultEveryMin: 45,
  },
];

export const DEFAULTS = {
  fromHour: 9,
  toHour: 21,
  walk: { enabled: false, everyMin: 60 },
  stretch: { enabled: false, everyMin: 90 },
  break: { enabled: false, everyMin: 45 },
};

export async function getSettings() {
  const saved = (await readValue(STORES.settings, SETTINGS_KEY, null)) || {};
  const merged = { ...DEFAULTS, ...saved };
  for (const kind of KINDS) merged[kind.id] = { ...DEFAULTS[kind.id], ...(saved[kind.id] || {}) };
  return merged;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  next.fromHour = Math.min(Math.max(Number(next.fromHour) || 0, 0), 23);
  next.toHour = Math.min(Math.max(Number(next.toHour) || 0, 0), 23);
  for (const kind of KINDS) {
    const value = { ...current[kind.id], ...(patch[kind.id] || {}) };
    next[kind.id] = {
      enabled: Boolean(value.enabled),
      everyMin: Math.min(Math.max(Number(value.everyMin) || kind.defaultEveryMin, 15), 480),
    };
  }
  await writeValue(STORES.settings, SETTINGS_KEY, next);
  return next;
}

export async function enabledCount() {
  const settings = await getSettings();
  return KINDS.filter((kind) => settings[kind.id].enabled).length;
}

/** Reminders due right now. Delivery is the scheduler's job. */
export async function dueReminders(now = new Date()) {
  const settings = await getSettings();
  const hour = now.getHours();
  if (hour < settings.fromHour || hour > settings.toHour) return [];

  const last = (await readValue(STORES.settings, LAST_KEY, null)) || {};
  const due = [];
  const nextLast = { ...last };

  for (const kind of KINDS) {
    const config = settings[kind.id];
    if (!config.enabled) continue;

    const previous = last[kind.id] ? new Date(last[kind.id]) : null;
    if (previous && now - previous < config.everyMin * 60000) continue;

    nextLast[kind.id] = now.toISOString();
    // First tick after enabling only starts the clock; it does not fire.
    if (!previous) continue;

    const slot = Math.floor(now.getTime() / (config.everyMin * 60000));
    due.push({
      type: "health",
      title: kind.label,
      body: kind.body,
      tag: `health:${kind.id}:${slot}`,
      action: "/more",
    });
  }

  await writeValue(STORES.settings, LAST_KEY, nextLast);
  return due;
}
