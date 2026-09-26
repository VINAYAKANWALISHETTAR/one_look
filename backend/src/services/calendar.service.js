/**
 * Google Calendar service — read-only, the only place the backend calls the
 * Calendar API.
 *
 * Scope: https://www.googleapis.com/auth/calendar.readonly. There is no create,
 * update, delete or RSVP function here by design — One Look shows the day, it
 * does not manage calendars.
 *
 * Nothing from Calendar is written to PostgreSQL: Google stays the source of
 * truth and the frontend caches only what it needs for offline display.
 */

import { googleClient } from "./google-client.service.js";

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

const client = (userId, accountId) =>
  googleClient(userId, accountId, {
    baseUrl: CALENDAR_BASE,
    label: "Google Calendar",
    scope: CALENDAR_SCOPE,
  });

/* ---------- Calendars ---------- */

/** Every calendar the account can read, with its selected/primary flags. */
export async function listCalendars(userId, accountId) {
  const { call } = await client(userId, accountId);
  const data = await call("/users/me/calendarList", { minAccessRole: "reader", maxResults: 250 });
  return (data.items || []).map((item) => ({
    id: item.id,
    name: item.summaryOverride || item.summary || item.id,
    description: item.description || "",
    primary: Boolean(item.primary),
    selected: item.selected !== false,
    color: item.backgroundColor || null,
    timeZone: item.timeZone || null,
    accessRole: item.accessRole || "reader",
  }));
}

/* ---------- Events ---------- */

/**
 * A meeting link is only reported when Google actually provides one. Nothing is
 * guessed from the description unless it is a real conferencing URL.
 */
function meetingLink(event) {
  if (event.hangoutLink) return { url: event.hangoutLink, kind: "Google Meet" };

  for (const entry of event.conferenceData?.entryPoints || []) {
    if (entry.entryPointType === "video" && entry.uri) {
      return { url: entry.uri, kind: event.conferenceData?.conferenceSolution?.name || "Video call" };
    }
  }

  const known =
    /https:\/\/(?:[\w-]+\.)?(?:zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com|whereby\.com)\/\S+/i;
  const found =
    known.exec(event.location || "")?.[0] || known.exec(event.description || "")?.[0] || null;
  return found ? { url: found, kind: "Video call" } : null;
}

function selfResponse(event) {
  const me = (event.attendees || []).find((attendee) => attendee.self);
  return me?.responseStatus || (event.organizer?.self ? "accepted" : null);
}

function toEvent(event, { calendar, account }) {
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const start = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00` : null);
  const end = event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00` : null);

  return {
    id: event.id,
    accountId: account.id,
    accountEmail: account.email,
    calendarId: calendar.id,
    calendarName: calendar.name,
    color: calendar.color,
    title: event.summary || "(no title)",
    description: (event.description || "").slice(0, 2000),
    location: event.location || "",
    allDay,
    start,
    end,
    timeZone: event.start?.timeZone || calendar.timeZone || null,
    status: event.status || "confirmed",
    organizer: event.organizer?.displayName || event.organizer?.email || "",
    attendeeCount: (event.attendees || []).length,
    myResponse: selfResponse(event),
    meeting: meetingLink(event),
    htmlLink: event.htmlLink || null,
  };
}

async function eventsForAccount(
  userId,
  account,
  { timeMin, timeMax, q = "", maxResults = 25, calendarIds = null },
) {
  const { call, account: publicAcc } = await client(userId, account.id);
  const calendars = (await listCalendars(userId, account.id)).filter((calendar) =>
    calendarIds ? calendarIds.includes(calendar.id) : calendar.selected,
  );

  const pages = await Promise.all(
    calendars.map((calendar) =>
      call(`/calendars/${encodeURIComponent(calendar.id)}/events`, {
        timeMin,
        timeMax,
        q: q || undefined,
        // Recurring events are expanded by Google so we never re-implement RRULE.
        singleEvents: "true",
        orderBy: "startTime",
        maxResults,
      })
        .then((data) => ({ calendar, items: data.items || [] }))
        .catch(() => ({ calendar, items: [] })),
    ),
  );

  return pages.flatMap(({ calendar, items }) =>
    items
      .filter((event) => event.status !== "cancelled")
      .map((event) => toEvent(event, { calendar, account: publicAcc })),
  );
}

const byStart = (a, b) => new Date(a.start || 0) - new Date(b.start || 0);

/**
 * Merged events across every connected account that granted Calendar access.
 * A failing or unauthorized account is reported in `accounts` instead of
 * breaking the whole response.
 */
export async function listEvents(userId, connectedAccounts, { timeMin, timeMax, q, maxResults }) {
  const reports = [];
  const results = await Promise.all(
    connectedAccounts.map(async (account) => {
      if (account.status !== "connected") {
        reports.push({ accountId: account.id, email: account.email, error: "reauth_required" });
        return [];
      }
      try {
        return await eventsForAccount(userId, account, { timeMin, timeMax, q, maxResults });
      } catch (error) {
        reports.push({
          accountId: account.id,
          email: account.email,
          error: error.code || "calendar_error",
          message: error.expose === false ? undefined : error.message,
        });
        return [];
      }
    }),
  );

  return {
    events: results.flat().sort(byStart),
    accounts: reports,
    accountsRead: connectedAccounts.length - reports.length,
  };
}
