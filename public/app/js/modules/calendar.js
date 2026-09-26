/**
 * Google Calendar UI — read-only.
 *
 * Shows today's schedule and what is coming up across every connected account,
 * with the real meeting link when Google provides one. Nothing here can create,
 * edit or delete an event, and no event is ever invented: when Calendar is not
 * connected the UI says exactly that.
 */

import { el, clear, emptyState } from "./ui.js";
import * as router from "../router.js";
import * as calendarService from "../services/calendar-service.js";

const line = (text, cls = "tiny faint") => el("div", { class: cls, text });

function timeRange(event) {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : null;
  const fmt = (date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return end ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

function dayLabel(event) {
  return new Date(event.start).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

const RESPONSE_LABELS = {
  needsAction: "Not answered",
  declined: "You declined",
  tentative: "Maybe",
};

/** One event row. `withDay` adds the date, used in the upcoming list. */
export function eventRow(event, { withDay = false } = {}) {
  const meta = [
    event.calendarName,
    event.location && !event.meeting ? event.location : "",
    event.attendeeCount > 1 ? `${event.attendeeCount} people` : "",
    RESPONSE_LABELS[event.myResponse] || "",
  ]
    .filter(Boolean)
    .join(" · ");

  return el("div", { class: "event-row" }, [
    el("div", { class: "event-when tabular" }, [
      withDay ? el("div", { class: "tiny faint", text: dayLabel(event) }) : null,
      el("div", { class: "small", text: timeRange(event) }),
    ]),
    el("div", { class: "grow" }, [
      el("div", { class: "title truncate", text: event.title }),
      meta ? el("div", { class: "tiny faint truncate", text: meta }) : null,
    ]),
    event.meeting
      ? el(
          "a",
          {
            class: "btn",
            "data-variant": "primary",
            href: event.meeting.url,
            target: "_blank",
            rel: "noopener noreferrer",
          },
          "Join",
        )
      : event.htmlLink
        ? el(
            "a",
            { class: "link-btn", href: event.htmlLink, target: "_blank", rel: "noopener noreferrer" },
            "Open",
          )
        : null,
  ]);
}

/** Shared gating state: says why there is nothing to show, never fakes events. */
async function gate() {
  if (!calendarService.isCalendarAvailable()) {
    return { ok: false, message: "Calendar needs the One Look cloud account, which this build has no server for." };
  }
  if (!(await calendarService.isCalendarReady())) {
    return { ok: false, message: "Connect your cloud account in More to see your calendar.", action: "/more" };
  }
  return { ok: true };
}

function accountNotices(accounts) {
  const notices = (accounts || []).filter((entry) => entry.error);
  if (!notices.length) return null;
  return el(
    "div",
    { class: "stack", style: "gap:4px;margin-top:8px" },
    notices.map((entry) =>
      line(
        entry.error === "reauth_required" || entry.error === "scope_required"
          ? `${entry.email}: reconnect this account in More to read its calendar.`
          : `${entry.email}: calendar unavailable right now.`,
        "tiny warn",
      ),
    ),
  );
}

/**
 * Home card: today's schedule. Loads itself so a slow Calendar response never
 * delays the dashboard.
 */
export async function renderSchedule(container) {
  clear(container);
  const paint = (children) => {
    clear(container);
    for (const child of [].concat(children)) if (child) container.append(child);
  };

  const head = el("div", { class: "spread", style: "margin-bottom:8px" }, [
    el("span", { class: "section-label", text: "Today's schedule" }),
    el("button", {
      class: "link-btn",
      type: "button",
      text: "Calendar",
      onClick: () => router.navigate("/calendar"),
    }),
  ]);

  const state = await gate();
  if (!state.ok) {
    paint([
      head,
      el("div", { class: "panel panel-pad" }, [line(state.message, "small muted")]),
    ]);
    return;
  }

  paint([head, el("div", { class: "panel panel-pad" }, [line("Loading your schedule…", "small muted")])]);

  try {
    const data = await calendarService.listEvents({ days: 7 });
    const { today } = calendarService.splitByDay(data.events);

    if (!data.accountsConnected) {
      paint([
        head,
        el("div", { class: "panel panel-pad" }, [
          line("No Google account connected yet.", "small muted"),
          el("button", {
            class: "link-btn",
            type: "button",
            text: "Connect an account",
            onClick: () => router.navigate("/more"),
          }),
        ]),
      ]);
      return;
    }

    const panel = el("div", { class: "panel" });
    if (today.length) {
      panel.append(
        el(
          "div",
          { class: "list" },
          today.slice(0, 4).map((event) => eventRow(event)),
        ),
      );
      if (today.length > 4) {
        panel.append(
          el("button", {
            class: "link-btn",
            style: "margin:10px 16px",
            type: "button",
            text: `See all ${today.length} events`,
            onClick: () => router.navigate("/calendar"),
          }),
        );
      }
    } else {
      panel.append(emptyState("Nothing scheduled for today"));
    }

    paint([
      head,
      panel,
      data.stale ? line("Last known schedule — you are offline.", "tiny warn") : null,
      accountNotices(data.accounts),
    ]);
  } catch (error) {
    paint([
      head,
      el("div", { class: "panel panel-pad" }, [
        line(
          error.offline
            ? "Your schedule needs a connection."
            : error.message || "Calendar is unavailable right now.",
          "small muted",
        ),
      ]),
    ]);
  }
}

/** Full Calendar screen: today, upcoming, and which calendars are read. */
export async function renderCalendar(container) {
  clear(container);

  container.append(
    el("header", {}, [
      el("h1", { class: "page-title", text: "Calendar" }),
      el("p", {
        class: "page-sub",
        text: "Read-only view of your Google calendars. One Look never changes an event.",
      }),
    ]),
  );

  const state = await gate();
  if (!state.ok) {
    container.append(
      el("div", { class: "panel panel-pad", style: "margin-top:16px" }, [
        line(state.message, "small muted"),
        state.action
          ? el("button", {
              class: "link-btn",
              type: "button",
              text: "Open More",
              onClick: () => router.navigate(state.action),
            })
          : null,
      ]),
    );
    return;
  }

  const body = el("div", {});
  container.append(body);
  body.append(el("div", { class: "panel panel-pad" }, [line("Loading your calendar…", "small muted")]));

  let data;
  try {
    data = await calendarService.listEvents({ days: 14 });
  } catch (error) {
    clear(body).append(
      el("div", { class: "panel panel-pad" }, [
        line(
          error.offline
            ? "Your calendar needs a connection."
            : error.message || "Calendar is unavailable right now.",
          "small muted",
        ),
      ]),
    );
    return;
  }

  const { today, upcoming } = calendarService.splitByDay(data.events);
  clear(body);

  const section = (label, children) =>
    el("section", { class: "section" }, [
      el("span", { class: "section-label", text: label }),
      el("div", { class: "panel", style: "margin-top:8px" }, children),
    ]);

  body.append(
    section(
      "Today",
      today.length
        ? el(
            "div",
            { class: "list" },
            today.map((event) => eventRow(event)),
          )
        : emptyState("Nothing scheduled for today"),
    ),
    section(
      "Next 14 days",
      upcoming.length
        ? el(
            "div",
            { class: "list" },
            upcoming.map((event) => eventRow(event, { withDay: true })),
          )
        : emptyState("No upcoming events", "Nothing in the next two weeks."),
    ),
  );

  if (data.stale) body.append(line("Last known calendar — you are offline.", "tiny warn"));
  const notices = accountNotices(data.accounts);
  if (notices) body.append(notices);

  body.append(
    el("p", {
      class: "tiny faint",
      style: "margin-top:16px",
      text: `Reading ${data.accountsConnected} connected account${data.accountsConnected === 1 ? "" : "s"} with read-only Google Calendar access.`,
    }),
  );
}

/** Calendar results for global search. Failures resolve to an empty group. */
export async function searchEvents(query, { limit = 10 } = {}) {
  if (!(await calendarService.isCalendarReady())) {
    return { events: [], accountsSearched: 0, error: null };
  }
  try {
    const data = await calendarService.searchEvents(query, { limit });
    return { ...data, error: null };
  } catch (error) {
    return {
      events: [],
      accountsSearched: 0,
      error: error.offline ? "Calendar search needs a connection." : error.message,
    };
  }
}
