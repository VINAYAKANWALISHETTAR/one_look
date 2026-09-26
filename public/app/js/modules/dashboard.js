/**
 * Home dashboard — answers "what needs my attention right now?".
 *
 * Fixed order, nothing else: greeting, Today's focus (one signal), today's
 * tasks, today's schedule, important mail, weather, quick note, water, pinned
 * shortcuts, news briefing, notification summary.
 *
 * Real data only. Tasks, notes, water and shortcuts come from IndexedDB;
 * weather, calendar, mail and news come from their providers and each card
 * renders its own "not connected" or "offline" state. Nothing is invented.
 */

import { el, card, section, sectionHead, emptyState, CHECK_SVG, toast } from "./ui.js";
import { greeting, formatLongDate, formatTime } from "./format.js";
import { listTasks, summarize, reminderLabel } from "./tasks.js";
import { weatherCard } from "./weather.js";
import { createNote } from "./notes.js";
import { buildFocus } from "./focus.js";
import { renderSchedule } from "./calendar.js";
import { renderBriefing } from "./news.js";
import { renderWater } from "./water-view.js";
import { renderPinned } from "./shortcuts-view.js";
import { bellButton } from "./notifications-view.js";
import { renderHomeSignal } from "./mail.js";
import * as router from "../router.js";
import * as center from "./notification-center.js";
import * as calendarService from "../services/calendar-service.js";
import * as mailService from "../services/mail-service.js";

const SEARCH_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>';

function taskRow(task, { onToggle, onOpen }) {
  const check = el(
    "button",
    {
      class: "check",
      "data-checked": String(task.status === "completed"),
      "aria-label": task.status === "completed" ? "Reopen task" : "Complete task",
      html: CHECK_SVG,
      onClick: (event) => {
        event.stopPropagation();
        onToggle(task);
      },
    },
    [],
  );

  const reminder = task.status === "pending" ? reminderLabel(task) : "";

  return el(
    "div",
    {
      class: "list-row",
      "data-done": String(task.status === "completed"),
      role: "button",
      tabindex: "0",
      onClick: () => onOpen(task),
      onKeydown: (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(task);
        }
      },
    },
    [
      check,
      el("span", { class: "time tabular", text: formatTime(task.time) || "—" }),
      el("div", { class: "grow" }, [
        el("div", { class: "title truncate", text: task.title }),
        task.description ? el("div", { class: "desc truncate", text: task.description }) : null,
        reminder ? el("div", { class: "reminder-line", text: reminder }) : null,
      ]),
      task.overdue ? el("span", { class: "badge", "data-tone": "overdue", text: "Overdue" }) : null,
      el("span", { class: "dot", "data-p": task.priority }),
    ],
  );
}

function quickNotePanel(ctx) {
  const input = el("input", {
    class: "input",
    type: "text",
    placeholder: "Quick note…",
    "aria-label": "Quick note",
  });

  const save = el("button", { class: "btn", "data-variant": "primary", type: "submit" }, "Save");

  const form = el(
    "form",
    {
      class: "quick-note",
      onSubmit: async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        save.disabled = true;
        try {
          await createNote(text);
          input.value = "";
          toast("Note saved");
        } catch (err) {
          toast(err.message || "Could not save the note");
        } finally {
          save.disabled = false;
        }
      },
    },
    [input, save],
  );

  return card(form);
}

/**
 * Today's Focus — exactly one signal, the highest-ranked one. Calendar and mail
 * load in the background so the card upgrades itself once those answer; it
 * never blocks the dashboard, and it never repeats a card shown below.
 */
function focusCard(ctx) {
  const panel = card(el("div", { class: "tiny faint", text: "Reading your day…" }), {
    pad: false,
    className: "focus-card",
  });

  const paint = (focus) => {
    panel.replaceChildren();
    panel.setAttribute("data-tone", focus.primary?.tone || "none");

    if (!focus.primary) {
      panel.append(
        el("span", { class: "focus-rail", "aria-hidden": "true" }),
        el("div", { class: "grow" }, [
          el("div", { class: "focus-title", text: focus.headline }),
          el("div", { class: "focus-detail", text: "Nothing is overdue and nothing starts soon." }),
        ]),
      );
      return;
    }

    const item = focus.primary;
    panel.append(
      el("span", { class: "focus-rail", "aria-hidden": "true" }),
      el("div", { class: "grow" }, [
        el("div", { class: "focus-title", text: item.title }),
        item.detail ? el("div", { class: "focus-detail truncate", text: item.detail }) : null,
      ]),
      item.link
        ? el(
            "a",
            {
              class: "btn btn-sm",
              "data-variant": "primary",
              href: item.link,
              target: "_blank",
              rel: "noopener noreferrer",
            },
            "Join",
          )
        : el(
            "button",
            { class: "btn btn-sm", type: "button", onClick: () => ctx.onGo(item.action) },
            "Open",
          ),
    );
  };

  // First pass from local signals only, then again with calendar and mail.
  buildFocus({})
    .then(paint)
    .catch(() => paint({ primary: null, headline: "Nothing needs your attention right now" }));

  Promise.all([
    calendarService
      .isCalendarReady()
      .then((ready) => (ready ? calendarService.listEvents({ days: 2 }) : null))
      .catch(() => null),
    mailService
      .isMailReady()
      .then((ready) => (ready ? mailService.summary() : null))
      .catch(() => null),
  ])
    .then(([calendar, mail]) => {
      if (!calendar && !mail) return;
      return buildFocus({ events: calendar?.events || [], mail }).then(paint);
    })
    .catch(() => {});

  return panel;
}

/** Notification summary — one row, the count plus the newest alert. */
async function notificationSummary(container) {
  const [items, unread] = await Promise.all([
    center.list().catch(() => []),
    center.unreadCount().catch(() => 0),
  ]);

  const newest = items[0];
  container.append(
    section(
      "Notifications",
      card(
        el(
          "button",
          { class: "setting", type: "button", onClick: () => router.navigate("/notifications") },
          [
            el("div", { class: "grow" }, [
              el("div", {
                class: "small truncate",
                text: unread
                  ? `${unread} unread notification${unread === 1 ? "" : "s"}`
                  : items.length
                    ? "All caught up"
                    : "No notifications yet",
              }),
              newest
                ? el("div", { class: "tiny faint truncate", text: newest.title })
                : el("div", {
                    class: "tiny faint",
                    text: "Task reminders, water and breaks appear here",
                  }),
            ]),
            unread ? el("span", { class: "badge", text: String(unread) }) : null,
          ],
        ),
        { pad: false },
      ),
    ),
  );
}

export async function renderHome(root, ctx) {
  const tasks = await listTasks();
  const stats = summarize(tasks);
  const firstName = (ctx.session?.name || "").split(" ")[0];

  /* GREETING */
  root.append(
    el("header", { class: "spread" }, [
      el("div", { class: "grow" }, [
        // Greeting and date are computed at render time from the device clock.
        el("h1", { class: "greeting truncate", text: `${greeting()}${firstName ? `, ${firstName}` : ""}` }),
        el("p", { class: "page-sub", text: formatLongDate() }),
      ]),
      el("div", { class: "row", style: "gap:8px;flex:0 0 auto" }, [
        el(
          "button",
          {
            class: "icon-btn",
            type: "button",
            "aria-label": "Search",
            onClick: () => ctx.onOpenSearch(),
            html: SEARCH_SVG,
          },
          [],
        ),
        await bellButton(),
      ]),
    ]),
  );

  /* TODAY'S FOCUS — one deterministic signal, never a stack of cards. */
  root.append(section("Today's focus", focusCard(ctx)));

  /* TODAY'S TASKS */
  const dueList = stats.dueToday;
  root.append(
    el("section", { class: "section" }, [
      sectionHead(
        "Today's tasks",
        el("div", { class: "row", style: "gap:10px" }, [
          el("span", {
            class: "tiny faint",
            text: stats.remaining === 0 ? "Nothing left" : `${stats.remaining} left`,
          }),
          el("button", { class: "add-inline", type: "button", onClick: () => ctx.onCreate() }, [
            "+ Add task",
          ]),
        ]),
      ),
      card(
        dueList.length
          ? el(
              "div",
              { class: "list" },
              dueList.map((task) => taskRow(task, ctx)),
            )
          : emptyState("No tasks due today", "Add one to get started."),
        { pad: false },
      ),
    ]),
  );

  /* TODAY'S SCHEDULE — read-only Google Calendar, loads on its own. */
  const schedule = el("section", { class: "section" });
  root.append(schedule);
  renderSchedule(schedule).catch(() => {});

  /* IMPORTANT MAIL — renders nothing when no account is connected. */
  const mail = el("div", {});
  root.append(mail);
  renderHomeSignal(mail).catch(() => {});

  /* WEATHER — real data, renders its own error states. */
  root.append(section("Weather", weatherCard()));

  /* QUICK NOTE */
  root.append(
    section(
      "Quick note",
      quickNotePanel(ctx),
      el("button", {
        class: "link-btn",
        type: "button",
        text: "All notes",
        onClick: () => ctx.onOpenNotes(),
      }),
    ),
  );

  /* WATER PROGRESS */
  const water = el("section", { class: "section" });
  root.append(water);
  renderWater(water).catch(() => {});

  /* PINNED SHORTCUTS */
  const shortcuts = el("section", { class: "section" });
  root.append(shortcuts);
  renderPinned(shortcuts).catch(() => {});

  /* NEWS BRIEFING */
  const news = el("section", { class: "section" });
  root.append(news);
  renderBriefing(news).catch(() => {});

  /* NOTIFICATION SUMMARY */
  await notificationSummary(root).catch(() => {});
}

export { taskRow };
