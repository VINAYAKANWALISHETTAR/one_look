/**
 * Calendar API client — the ONLY place the frontend talks to the calendar
 * endpoints.
 *
 * Every call goes to the One Look backend, never to Google directly, so the
 * browser never holds a Google token. Read-only: there is no create, edit,
 * delete or RSVP function here.
 *
 * Day boundaries are computed on this device and sent as ISO timestamps, so
 * "today" always means the user's real day, whatever the server's time zone is.
 */

import { ApiError, authed, isConfigured, isSignedInToCloud } from "./api-service.js";
import { STORES, readValue, writeValue } from "../db/indexeddb.js";

const CACHE_PREFIX = "calendar:";

export const isCalendarAvailable = () => isConfigured();

/** Calendar hangs off the cloud account, exactly like mail. */
export const isCalendarReady = async () => isConfigured() && (await isSignedInToCloud());

async function readCache(name) {
  try {
    return (await readValue(STORES.settings, `${CACHE_PREFIX}${name}`)) || null;
  } catch {
    return null;
  }
}

async function writeCache(name, data) {
  try {
    await writeValue(STORES.settings, `${CACHE_PREFIX}${name}`, {
      data,
      cachedAt: new Date().toISOString(),
    });
  } catch {
    /* cache is best-effort */
  }
}

/**
 * Serves the last successful response when the network is unavailable, always
 * flagged as stale so the UI can label it. Never invents events.
 */
async function withCache(name, fetcher) {
  try {
    const fresh = await fetcher();
    await writeCache(name, fresh);
    return { ...fresh, stale: false, cachedAt: null };
  } catch (error) {
    if (error instanceof ApiError && (error.offline || error.status === 503)) {
      const cached = await readCache(name);
      if (cached) return { ...cached.data, stale: true, cachedAt: cached.cachedAt };
    }
    throw error;
  }
}

const iso = (date) => date.toISOString();

export function dayWindow(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { timeMin: iso(start), timeMax: iso(end) };
}

/**
 * Today's events plus the next `days` days, in one request.
 * Returns { events, accounts, accountsConnected, configured, stale }.
 */
export async function listEvents({ days = 7 } = {}) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const params = new URLSearchParams({ timeMin: iso(start), timeMax: iso(end), maxResults: "50" });
  return withCache(`events:${days}`, () => authed(`/calendar/events?${params}`));
}

/** Calendars for one connected account (used by the Calendar screen). */
export async function listCalendars(accountId) {
  return authed(`/calendar/accounts/${accountId}/calendars`);
}

export async function searchEvents(query, { limit = 15 } = {}) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return authed(`/calendar/search?${params}`);
}

/** Splits a merged event list into today / upcoming, using this device's clock. */
export function splitByDay(events, now = new Date()) {
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const today = [];
  const upcoming = [];
  for (const event of events || []) {
    if (!event.start) continue;
    const start = new Date(event.start);
    if (start <= todayEnd) today.push(event);
    else upcoming.push(event);
  }
  return { today, upcoming };
}

/** The next event that has not finished yet — the one the user needs now. */
export function nextEvent(events, now = new Date()) {
  return (
    (events || [])
      .filter((event) => new Date(event.end || event.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start))[0] || null
  );
}
