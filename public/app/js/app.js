/**
 * One Look — application bootstrap.
 *
 * Vanilla ES modules only. Screens are rendered into #screen; auth/lock owns
 * #auth-view. Everything persistent goes through js/db/indexeddb.js.
 */

import * as router from "./router.js";
import {
  el,
  clear,
  row,
  disclosure,
  emptyState,
  toast,
  openSheet,
  closeSheet,
  confirmSheet,
} from "./modules/ui.js";
import { todayISO, formatDayLabel } from "./modules/format.js";

import * as tasksModule from "./modules/tasks.js";
import { renderHome, taskRow } from "./modules/dashboard.js";
import { renderAuth, offerBiometricEnrollment } from "./modules/auth.js";
import * as auth from "./services/auth-service.js";
import * as biometric from "./modules/biometric.js";
import * as reminders from "./modules/reminders.js";
import * as notifications from "./modules/notifications.js";
import * as notesModule from "./modules/notes.js";
import * as weatherUI from "./modules/weather.js";
import { WEATHER_PROVIDER } from "./services/weather-service.js";
import * as google from "./services/google-auth-service.js";
import { STORES, clear as clearStore } from "./db/indexeddb.js";
import { IS_DEV, APP_VERSION } from "./config.js";
import * as search from "./modules/search.js";
import * as mailModule from "./modules/mail.js";
import * as mailService from "./services/mail-service.js";
import * as connectivity from "./modules/connectivity.js";
import * as install from "./modules/install.js";
import * as api from "./services/api-service.js";
import * as sync from "./services/sync-service.js";
import * as theme from "./modules/theme.js";
import * as hub from "./modules/hub-scheduler.js";
import * as calendarModule from "./modules/calendar.js";
import * as newsModule from "./modules/news.js";
import * as newsService from "./services/news-service.js";
import * as notificationsView from "./modules/notifications-view.js";
import * as notificationCenter from "./modules/notification-center.js";
import * as shortcutsView from "./modules/shortcuts-view.js";
import * as shortcuts from "./modules/shortcuts.js";
import * as waterView from "./modules/water-view.js";
import * as water from "./modules/water.js";
import * as health from "./modules/health.js";

const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const screen = document.getElementById("screen");

const state = {
  session: null,
  filter: "today",
};

/* ---------- Task editor ---------- */
function openTaskEditor(task = null) {
  const isEdit = Boolean(task);
  let priority = task?.priority || "medium";

  const titleInput = el("input", {
    class: "input",
    type: "text",
    required: true,
    placeholder: "What needs doing?",
    value: task?.title || "",
  });
  const descInput = el(
    "textarea",
    { class: "textarea", placeholder: "Optional details" },
    task?.description || "",
  );
  const dateInput = el("input", { class: "input", type: "date", value: task?.date || todayISO() });
  const timeInput = el("input", { class: "input", type: "time", value: task?.time || "" });
  const reminderSelect = el(
    "select",
    { class: "input", "aria-label": "Reminder" },
    tasksModule.REMINDER_OPTIONS.map((option) =>
      el(
        "option",
        { value: option.value, selected: (task?.reminderOffset || "none") === option.value },
        option.label,
      ),
    ),
  );
  const reminderInput = el("input", {
    class: "input",
    type: "time",
    value: task?.reminderTime || "",
  });
  const customField = el("label", { class: "field" }, [
    el("span", { text: "Reminder time" }),
    reminderInput,
  ]);
  const reminderHint = el("p", { class: "tiny faint", style: "margin:-8px 0 16px" });

  const syncReminder = () => {
    const choice = reminderSelect.value;
    customField.hidden = choice !== "custom";
    const needsTime = choice !== "none" && choice !== "custom" && !timeInput.value;
    reminderHint.textContent = needsTime
      ? "Set a task time first — this reminder counts back from it."
      : choice === "none"
        ? "No reminder for this task."
        : "One Look shows a notification at the reminder time while the app is open.";
  };
  reminderSelect.addEventListener("change", syncReminder);
  timeInput.addEventListener("change", syncReminder);
  syncReminder();

  const segment = el(
    "div",
    { class: "segment" },
    tasksModule.PRIORITIES.map((value) =>
      el(
        "button",
        {
          type: "button",
          "data-active": String(priority === value),
          onClick: (event) => {
            priority = value;
            for (const sibling of event.currentTarget.parentNode.children) {
              sibling.setAttribute("data-active", String(sibling === event.currentTarget));
            }
          },
        },
        value[0].toUpperCase() + value.slice(1),
      ),
    ),
  );

  const error = el("div", { class: "form-error", hidden: true });
  const save = el(
    "button",
    { class: "btn grow", "data-variant": "primary", type: "submit" },
    isEdit ? "Save" : "Add task",
  );

  const actions = el("div", { class: "row", style: "gap:8px" }, [save]);

  if (isEdit) {
    actions.prepend(
      el(
        "button",
        {
          class: "btn",
          "data-variant": "danger",
          type: "button",
          onClick: async () => {
            const ok = await confirmSheet({
              title: "Delete task?",
              message: `"${task.title}" will be removed from this device.`,
              confirmLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            await tasksModule.deleteTask(task.id);
            toast("Task deleted");
            router.resolve();
          },
        },
        "Delete",
      ),
    );
  }

  const form = el(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        save.disabled = true;
        const payload = {
          title: titleInput.value,
          description: descInput.value,
          date: dateInput.value,
          time: timeInput.value,
          reminderOffset: reminderSelect.value,
          reminderTime: reminderInput.value,
          priority,
        };
        try {
          if (isEdit) await tasksModule.updateTask(task.id, payload);
          else await tasksModule.createTask(payload);
          closeSheet();
          toast(isEdit ? "Task updated" : "Task added");
          await router.resolve();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          save.disabled = false;
        }
      },
    },
    [
      el("label", { class: "field" }, [el("span", { text: "Title" }), titleInput]),
      el("label", { class: "field" }, [el("span", { text: "Description" }), descInput]),
      el("div", { class: "field-grid" }, [
        el("label", { class: "field" }, [el("span", { text: "Date" }), dateInput]),
        el("label", { class: "field" }, [el("span", { text: "Time" }), timeInput]),
      ]),
      el("label", { class: "field" }, [el("span", { text: "Priority" }), segment]),
      el("label", { class: "field" }, [el("span", { text: "Reminder" }), reminderSelect]),
      customField,
      reminderHint,
      notifications.status() === "granted"
        ? null
        : el("p", {
            class: "tiny faint",
            style: "margin:-8px 0 16px",
            text:
              notifications.status() === "denied"
                ? "Notifications are blocked in your browser, so reminders won't pop up."
                : "Turn on notifications under More to see reminders pop up.",
          }),
      isEdit
        ? el("p", {
            class: "tiny faint",
            style: "margin:-8px 0 16px",
            text: `Status: ${task.displayStatus}`,
          })
        : null,
      error,
      actions,
    ],
  );

  openSheet({ title: isEdit ? "Edit task" : "New task", body: form });
}

const taskCtx = {
  get session() {
    return state.session;
  },
  onToggle: async (task) => {
    await tasksModule.toggleTask(task.id);
    toast(task.status === "completed" ? "Task reopened" : "Task completed");
    await router.resolve();
  },
  onOpen: (task) => openTaskEditor(task),
  onCreate: () => openTaskEditor(),
  onShowOverdue: () => {
    state.filter = "overdue";
    router.navigate("/tasks");
  },
  onOpenNotes: () => router.navigate("/notes"),
  onOpenSearch: () => router.navigate("/search"),
  onGo: (path) => router.navigate(path || "/home"),
};

/* ---------- Quick notes ---------- */
function openNoteEditor(note = null) {
  const isEdit = Boolean(note);
  const textarea = el(
    "textarea",
    { class: "textarea", placeholder: "Write it down…", rows: "6" },
    note?.content || "",
  );
  const error = el("div", { class: "form-error", hidden: true });
  const save = el(
    "button",
    { class: "btn grow", "data-variant": "primary", type: "submit" },
    isEdit ? "Save" : "Add note",
  );
  const actions = el("div", { class: "row", style: "gap:8px" }, [save]);

  if (isEdit) {
    actions.prepend(
      el(
        "button",
        {
          class: "btn",
          "data-variant": "danger",
          type: "button",
          onClick: async () => {
            const ok = await confirmSheet({
              title: "Delete note?",
              message: "This note will be removed from this device.",
              confirmLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            await notesModule.deleteNote(note.id);
            closeSheet();
            toast("Note deleted");
            await router.resolve();
          },
        },
        "Delete",
      ),
    );
  }

  const form = el(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        save.disabled = true;
        try {
          if (isEdit) await notesModule.updateNote(note.id, textarea.value);
          else await notesModule.createNote(textarea.value);
          closeSheet();
          toast(isEdit ? "Note updated" : "Note saved");
          await router.resolve();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          save.disabled = false;
        }
      },
    },
    [el("label", { class: "field" }, [el("span", { text: "Note" }), textarea]), error, actions],
  );

  openSheet({ title: isEdit ? "Edit note" : "New note", body: form });
}

async function notesScreen() {
  clear(screen);
  const notes = await notesModule.listNotes();

  const search = el("input", {
    class: "input",
    type: "search",
    placeholder: "Search notes…",
    "aria-label": "Search notes",
  });

  screen.append(
    el("header", { class: "spread" }, [
      el("div", {}, [
        el("h1", { class: "page-title", text: "Quick notes" }),
        el("p", {
          class: "page-sub",
          text: `${notes.length} note${notes.length === 1 ? "" : "s"} on this device`,
        }),
      ]),
      el("button", { class: "add-inline", type: "button", onClick: () => openNoteEditor() }, [
        "+ Add note",
      ]),
    ]),
    el("div", { class: "field", style: "margin-top:16px" }, [search]),
  );

  const list = el("div", { class: "panel" });

  const draw = () => {
    clear(list);
    const rows = notesModule.searchNotes(notes, search.value);
    if (!rows.length) {
      list.append(
        el("div", {
          class: "empty",
          text: notes.length
            ? "No notes match that search."
            : "No notes yet. Capture a thought from Home or with + Add note.",
        }),
      );
      return;
    }
    for (const note of rows) {
      list.append(
        el("button", { class: "note-row", type: "button", onClick: () => openNoteEditor(note) }, [
          el("span", { class: "note-text", text: notesModule.noteTitle(note, 90) }),
          el("span", {
            class: "note-meta",
            text: `Updated ${new Date(note.updatedAt).toLocaleString(undefined, {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`,
          }),
        ]),
      );
    }
  };

  search.addEventListener("input", draw);
  screen.append(list);
  draw();

  screen.append(
    el(
      "button",
      { class: "fab", type: "button", "aria-label": "New note", onClick: () => openNoteEditor() },
      ["+"],
    ),
  );
  setActiveTab("more");
}

/* ---------- Global search (tasks + notes only) ---------- */
async function searchScreen({ params } = {}) {
  clear(screen);

  const input = el("input", {
    class: "input",
    type: "search",
    placeholder: "Search tasks, notes, mail, calendar…",
    "aria-label": "Search tasks, notes, mail, calendar and news",
    value: params?.get("q") || "",
    autocomplete: "off",
  });

  const count = el("p", { class: "page-sub" });
  const results = el("div", {});
  // Network-backed results land in their own containers so slow responses never
  // delay or re-render the instant local results.
  const mailResults = el("div", {});
  const extraResults = el("div", {});

  screen.append(
    el("header", {}, [
      el("h1", { class: "page-title", text: "Search" }),
      el("p", {
        class: "page-sub",
        text: "Your tasks and notes on this device, plus your connected mail, calendar and saved news.",
      }),
    ]),
    el("div", { class: "field", style: "margin-top:12px" }, [input]),
    count,
    results,
    mailResults,
    extraResults,
  );

  const group = (label, children) =>
    el("section", { class: "section" }, [
      el("span", { class: "section-label", text: label }),
      el("div", { class: "panel", style: "margin-top:8px" }, children),
    ]);

  /* ---- Mail search: debounced, and stale replies are discarded ---- */
  let mailToken = 0;
  let mailTimer = null;

  const drawMail = (query) => {
    window.clearTimeout(mailTimer);
    clear(mailResults);
    if (!query || !mailService.isMailAvailable()) return;

    const token = ++mailToken;
    mailResults.append(
      el("p", { class: "tiny faint", style: "margin-top:8px", text: "Searching mail…" }),
    );

    mailTimer = window.setTimeout(async () => {
      const hits = await search.searchMail(query, { limit: 12 });
      if (token !== mailToken) return; // a newer query already ran
      clear(mailResults);

      if (hits.error) {
        mailResults.append(
          el("p", { class: "tiny faint", style: "margin-top:8px", text: hits.error }),
        );
        return;
      }
      if (!hits.accountsSearched) return; // no Gmail connected — say nothing
      if (!hits.messages.length) {
        mailResults.append(
          el("p", { class: "tiny faint", style: "margin-top:8px", text: "No mail matches that." }),
        );
        return;
      }

      mailResults.append(
        group(
          `Mail · ${hits.messages.length}`,
          el(
            "div",
            { class: "mail-list" },
            hits.messages.map((message) => mailModule.messageRow(message)),
          ),
        ),
      );
    }, 350);
  };

  /* ---- Calendar + news search: also debounced, also discard-on-stale ---- */
  let extraToken = 0;
  let extraTimer = null;

  const drawExtras = (query) => {
    window.clearTimeout(extraTimer);
    clear(extraResults);
    if (!query) return;

    const token = ++extraToken;
    extraTimer = window.setTimeout(async () => {
      const [events, stories] = await Promise.all([
        calendarModule.searchEvents(query, { limit: 10 }).catch(() => ({ events: [] })),
        newsService.searchStories(query).catch(() => []),
      ]);
      if (token !== extraToken) return;
      clear(extraResults);

      if (events.events?.length) {
        extraResults.append(
          group(
            `Calendar · ${events.events.length}`,
            el(
              "div",
              { class: "list" },
              events.events.map((event) => calendarModule.eventRow(event, { withDay: true })),
            ),
          ),
        );
      } else if (events.error) {
        extraResults.append(
          el("p", { class: "tiny faint", style: "margin-top:8px", text: events.error }),
        );
      }

      if (stories.length) {
        extraResults.append(
          group(
            `News · ${stories.length}`,
            el(
              "div",
              { class: "list" },
              stories.slice(0, 10).map((story) => newsModule.storyRow(story)),
            ),
          ),
        );
      }
    }, 350);
  };

  const draw = async () => {
    const query = input.value;
    const hits = await search.search(query);

    clear(results);
    drawMail(hits.query ? query.trim() : "");
    drawExtras(hits.query ? query.trim() : "");

    if (!hits.query) {
      count.textContent = "";
      results.append(
        el("div", { class: "panel" }, [
          emptyState("Search everything", "Tasks, notes, mail, calendar and news."),
        ]),
      );
      return;
    }

    count.textContent = `${hits.total} local result${hits.total === 1 ? "" : "s"} for “${hits.query}”`;

    if (!hits.total) {
      results.append(
        el("div", { class: "panel" }, [
          emptyState("No matches", "Try a shorter or different word."),
        ]),
      );
    }

    if (hits.tasks.length) {
      results.append(
        group(
          `Tasks · ${hits.tasks.length}`,
          el(
            "div",
            { class: "list" },
            hits.tasks.map((task) => taskRow(task, taskCtx)),
          ),
        ),
      );
    }

    if (hits.notes.length) {
      results.append(
        group(
          `Notes · ${hits.notes.length}`,
          hits.notes.map((note) =>
            el(
              "button",
              { class: "note-row", type: "button", onClick: () => openNoteEditor(note) },
              [
                el("span", { class: "note-text", text: notesModule.noteTitle(note, 90) }),
                el("span", {
                  class: "note-meta",
                  text: `Updated ${formatDayLabel(note.updatedAt.slice(0, 10))}`,
                }),
              ],
            ),
          ),
        ),
      );
    }
  };

  // Search runs as the user types; the local dataset is tiny, and mail is
  // debounced inside drawMail.
  input.addEventListener("input", () => {
    draw().catch(() => {});
  });
  await draw();
  input.focus();

  setActiveTab("search");
}

/** Small header entry point used by Home and Tasks. */
function searchButton() {
  return el(
    "button",
    {
      class: "icon-btn",
      type: "button",
      "aria-label": "Search",
      onClick: () => router.navigate("/search"),
      html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    },
    [],
  );
}

/* ---------- Screens ---------- */
function fab(label = "New task") {
  return el(
    "button",
    { class: "fab", type: "button", "aria-label": label, onClick: () => openTaskEditor() },
    ["+"],
  );
}

async function homeScreen() {
  clear(screen);
  await renderHome(screen, taskCtx);
  // Mail signal is appended after Home paints and loads on its own, so a slow
  // Gmail response never delays the dashboard.
  const mailSignal = el("div", {});
  screen.append(mailSignal, fab());
  mailModule.renderHomeSignal(mailSignal).catch(() => {});
  setActiveTab("home");
}

const FILTER_LABELS = {
  today: "Today",
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
  all: "All",
};

const EMPTY_MESSAGES = {
  today: ["Nothing due today", "Add a task to plan your day."],
  upcoming: ["No upcoming tasks", "Anything with a future date shows up here."],
  overdue: ["Nothing overdue", "You're on top of it."],
  completed: ["No completed tasks yet", "Finished tasks are kept here."],
  all: ["No tasks yet", "Add your first one with the + button."],
};

async function tasksScreen() {
  clear(screen);
  const all = await tasksModule.listTasks();
  const open = all.filter((t) => t.status === "pending").length;

  const addBtn = el(
    "button",
    { class: "add-inline", type: "button", onClick: () => openTaskEditor() },
    ["+ Add task"],
  );

  screen.append(
    el("header", { class: "spread" }, [
      el("div", {}, [
        el("h1", { class: "page-title", text: "Tasks" }),
        el("p", { class: "page-sub", text: `${open} open · ${all.length} total` }),
      ]),
      el("div", { class: "row", style: "gap:8px" }, [searchButton(), addBtn]),
    ]),
  );

  const list = el("div", { class: "panel", style: "margin-top:16px" });

  const drawList = () => {
    clear(list);
    const rows = tasksModule.filterTasks(all, state.filter);
    if (!rows.length) {
      list.append(emptyState(...EMPTY_MESSAGES[state.filter]));
      return;
    }

    let lastDate = null;
    const container = el("div", { class: "list" });
    for (const task of rows) {
      if (state.filter !== "today" && task.date !== lastDate) {
        lastDate = task.date;
        container.append(
          el("div", {
            class: "section-label",
            style: "padding:10px 16px 4px;border-bottom:1px solid var(--line)",
            text: formatDayLabel(task.date),
          }),
        );
      }
      container.append(taskRow(task, taskCtx));
    }
    list.append(container);
  };

  const filters = el(
    "div",
    { class: "filters" },
    tasksModule.FILTERS.map((value) =>
      el(
        "button",
        {
          class: "filter",
          type: "button",
          "data-active": String(state.filter === value),
          onClick: (event) => {
            state.filter = value;
            for (const sibling of event.currentTarget.parentNode.children) {
              sibling.setAttribute("data-active", String(sibling === event.currentTarget));
            }
            drawList();
          },
        },
        FILTER_LABELS[value],
      ),
    ),
  );

  screen.append(filters, list, fab());
  drawList();
  setActiveTab("tasks");
}

function laterRow(title, note) {
  return el("div", { class: "setting" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "small", text: title }),
      note ? el("div", { class: "tiny faint", text: note }) : null,
    ]),
    el("span", { class: "badge", "data-tone": "later", text: "Coming later" }),
  ]);
}

/**
 * Inbox — real Gmail across every connected account (mail.js), plus the
 * still-unimplemented signals kept honestly labelled.
 */
async function inboxScreen() {
  clear(screen);

  const mailRoot = el("div", {});
  screen.append(mailRoot);

  await mailModule.renderInbox(mailRoot);

  screen.append(
    el("section", { class: "section" }, [
      el("span", { class: "section-label", text: "Also planned" }),
      el("div", { class: "panel", style: "margin-top:8px" }, [
        laterRow("Possible tasks from email", "Detected deadlines you can turn into tasks"),
        laterRow("LinkedIn alerts", "Messages, connections, career notifications"),
      ]),
    ]),
    el("p", {
      class: "tiny faint",
      style: "margin-top:16px",
      text: "Gmail is read through the One Look backend with read-only access. Your Google password is never asked for or stored, and One Look cannot send or delete mail.",
    }),
  );

  setActiveTab("inbox");
}

/* ---------- Cloud account (Phase 4 backend) ---------- */
/**
 * Connecting is optional: One Look works fully offline on this device. Signing
 * in only adds cloud backup and multi-device sync through the REST API.
 */
function cloudSheet(mode) {
  const isRegister = mode === "register";
  const email = el("input", {
    class: "input",
    type: "email",
    placeholder: "you@example.com",
    autocomplete: "email",
  });
  const password = el("input", {
    class: "input",
    type: "password",
    placeholder: "Password",
    autocomplete: isRegister ? "new-password" : "current-password",
  });
  const name = el("input", { class: "input", type: "text", placeholder: "Display name" });
  const error = el("p", { class: "tiny", style: "color:var(--danger);min-height:16px" });

  const submit = el(
    "button",
    {
      class: "btn grow",
      "data-variant": "primary",
      type: "submit",
    },
    isRegister ? "Create cloud account" : "Connect",
  );

  const form = el(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.textContent = "";
        submit.disabled = true;
        try {
          const payload = { email: email.value.trim(), password: password.value };
          if (isRegister) await api.registerCloud({ ...payload, displayName: name.value.trim() });
          else await api.loginCloud(payload);
          await sync.resetWatermark();
          closeSheet();
          toast(isRegister ? "Cloud account created" : "Cloud sync connected");
          await sync.syncNow();
          await router.resolve();
        } catch (err) {
          error.textContent = err.offline ? "Cloud server is unreachable right now." : err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
    [
      el("p", {
        class: "small muted",
        style: "margin-bottom:16px",
        text: "Your data stays on this device. Cloud sync adds backup and other devices.",
      }),
      isRegister
        ? el("label", { class: "field" }, [el("span", { class: "label", text: "Name" }), name])
        : null,
      el("label", { class: "field" }, [el("span", { class: "label", text: "Email" }), email]),
      el("label", { class: "field" }, [el("span", { class: "label", text: "Password" }), password]),
      error,
      el("div", { class: "row", style: "gap:8px" }, [submit]),
    ],
  );

  openSheet({ title: isRegister ? "Create cloud account" : "Connect cloud sync", body: form });
}

async function cloudSection() {
  const configured = api.isConfigured();
  const cloudSession = configured ? await api.getCloudSession() : null;
  const snapshot = sync.getStatus();

  const panel = el("div", { class: "panel", style: "margin-top:8px" }, [
    el("div", { class: "setting" }, [
      el("div", { class: "grow" }, [
        el("div", { class: "small", text: cloudSession ? cloudSession.email : "Not connected" }),
        el("div", {
          class: "tiny faint",
          text: configured
            ? cloudSession
              ? sync.statusLabel(snapshot) +
                (snapshot.pendingCount ? ` · ${snapshot.pendingCount} waiting` : "")
              : "Everything is stored on this device only"
            : "No cloud server configured for this build",
        }),
      ]),
      el("span", {
        class: "badge",
        text: cloudSession ? sync.statusLabel(snapshot) : "Local only",
      }),
    ]),
  ]);

  if (configured && !cloudSession) {
    panel.append(
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "Connect cloud sync" }),
          el("div", { class: "tiny faint", text: "Optional backup across devices" }),
        ]),
        el("div", { class: "row", style: "gap:8px" }, [
          el(
            "button",
            { class: "btn", type: "button", onClick: () => cloudSheet("login") },
            "Connect",
          ),
          el(
            "button",
            {
              class: "btn",
              "data-variant": "primary",
              type: "button",
              onClick: () => cloudSheet("register"),
            },
            "Create",
          ),
        ]),
      ]),
    );
  }

  if (configured && cloudSession) {
    panel.append(
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "Sync now" }),
          el("div", {
            class: "tiny faint",
            text: snapshot.lastSyncedAt
              ? `Last synced ${new Date(snapshot.lastSyncedAt).toLocaleTimeString()}`
              : snapshot.lastError || "Not synced yet",
          }),
        ]),
        el(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: async () => {
              toast("Syncing…");
              const result = await sync.syncNow();
              toast(sync.statusLabel(result));
              await router.resolve();
            },
          },
          "Sync",
        ),
      ]),
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "Disconnect cloud" }),
          el("div", { class: "tiny faint", text: "Keeps local data, stops syncing" }),
        ]),
        el(
          "button",
          {
            class: "btn",
            "data-variant": "danger",
            type: "button",
            onClick: async () => {
              const ok = await confirmSheet({
                title: "Disconnect cloud sync?",
                message:
                  "Your tasks and notes stay on this device. Syncing stops until you connect again.",
                confirmLabel: "Disconnect",
                danger: true,
              });
              if (!ok) return;
              await api.logoutCloud();
              await sync.resetWatermark();
              toast("Cloud sync disconnected");
              await router.resolve();
            },
          },
          "Disconnect",
        ),
      ]),
    );
  }

  return Array.from(panel.children);

}

async function moreScreen() {
  clear(screen);

  const [
    bioAvailable,
    bioEnrolled,
    upcoming,
    weatherSummary,
    savedLocation,
    noteCount,
    cloudRows,
    healthSettings,
    healthOn,
    shortcutCount,
    waterProgress,
    unreadNotifs,
  ] = await Promise.all([
    biometric.isAvailable(),
    biometric.isEnrolled(),
    reminders.upcomingReminders(),
    weatherUI.locationSummary(),
    weatherUI.locationDenied(),
    notesModule.listNotes().then((list) => list.length),
    cloudSection(),
    health.getSettings(),
    health.enabledCount(),
    shortcuts.listShortcuts().then((list) => list.length),
    water.todayProgress(),
    notificationCenter.unreadCount(),
  ]);

  const notifState = notifications.status();
  const installState = install.getState();

  screen.append(
    el("header", {}, [
      el("h1", { class: "page-title", text: "More" }),
      el("p", { class: "page-sub", text: state.session?.email || "" }),
    ]),
  );

  /* ---------- Account ---------- */
  const bioSwitch = el("button", {
    class: "switch",
    type: "button",
    role: "switch",
    "aria-checked": String(bioEnrolled),
    "data-on": String(bioEnrolled),
    "aria-label": "Biometric unlock",
    onClick: async () => {
      try {
        if (bioSwitch.getAttribute("data-on") === "true") {
          await biometric.unenroll();
          toast("Biometric unlock turned off");
        } else {
          await biometric.enroll(state.session || {});
          toast("Biometric unlock enabled");
        }
        await router.resolve();
      } catch (err) {
        toast(err.message || "Could not change biometric unlock");
      }
    },
  });

  screen.append(
    disclosure(
      "Account",
      [
        row({
          title: state.session?.name || "Signed in",
          detail:
            state.session?.provider === "google"
              ? `Signed in with Google · ${state.session.email}`
              : "Stored on this device only",
        }),
        row({
          title: "Face / fingerprint unlock",
          detail: bioAvailable
            ? "Uses your device's built-in biometrics"
            : "Not available on this device or browser",
          control: bioAvailable ? bioSwitch : el("span", { class: "badge", text: "Unavailable" }),
        }),
        row({
          title: "Connected Gmail accounts",
          detail: "Read-only. One Look never sees your Google password.",
          control: el(
            "button",
            { class: "btn btn-sm", type: "button", onClick: () => mailModule.openAccountManager() },
            "Manage",
          ),
        }),
        ...cloudRows,
        row({
          title: "Lock now",
          control: el(
            "button",
            {
              class: "btn btn-sm",
              type: "button",
              onClick: async () => {
                await auth.lock();
                await boot();
              },
            },
            "Lock",
          ),
        }),
        row({
          title: "Sign out",
          control: el(
            "button",
            {
              class: "btn btn-sm",
              "data-variant": "danger",
              type: "button",
              onClick: async () => {
                const ok = await confirmSheet({
                  title: "Sign out?",
                  message:
                    "Your tasks stay on this device. You'll need your passcode to get back in.",
                  confirmLabel: "Sign out",
                  danger: true,
                });
                if (!ok) return;
                google.signOut();
                await auth.signOut();
                await boot();
              },
            },
            "Sign out",
          ),
        }),
      ],
      { open: true },
    ),
  );

  /* ---------- Appearance ---------- */
  const currentTheme = theme.getTheme();
  screen.append(
    disclosure("Appearance", [
      row({
        title: "Theme",
        detail: `Currently ${theme.themeLabel().toLowerCase()}`,
        control: el(
          "select",
          {
            class: "input compact",
            "aria-label": "Theme",
            onChange: async (event) => {
              await theme.setTheme(event.target.value);
              toast("Theme updated");
            },
          },
          theme.THEMES.map((entry) =>
            el(
              "option",
              { value: entry.value, selected: entry.value === currentTheme },
              entry.label,
            ),
          ),
        ),
      }),
    ]),
  );

  /* ---------- Health ---------- */
  const healthRows = health.KINDS.map((kind) => {
    const config = healthSettings[kind.id];
    const toggle = el("button", {
      class: "switch",
      type: "button",
      role: "switch",
      "aria-checked": String(config.enabled),
      "data-on": String(config.enabled),
      "aria-label": kind.label,
      onClick: async () => {
        const on = toggle.getAttribute("data-on") !== "true";
        await health.saveSettings({ [kind.id]: { ...config, enabled: on } });
        toggle.setAttribute("data-on", String(on));
        toggle.setAttribute("aria-checked", String(on));
        toast(on ? `${kind.label} reminders on` : `${kind.label} reminders off`);
      },
    });

    return row({
      title: kind.label,
      detail: `${kind.body} Every ${config.everyMin} min.`,
      control: toggle,
    });
  });

  healthRows.push(
    row({
      title: "When these fire",
      detail:
        healthOn > 0
          ? `Between ${healthSettings.fromHour}:00 and ${healthSettings.toHour}:00 while One Look is open`
          : "All health reminders are off",
    }),
    row({
      title: "Water",
      detail: water.summaryLine(waterProgress),
      value: `${waterProgress.percent}%`,
      onClick: () => router.navigate("/water"),
    }),
  );

  screen.append(disclosure("Health", healthRows));

  /* ---------- Productivity ---------- */
  screen.append(
    disclosure("Productivity", [
      row({
        title: "Notifications",
        detail: notifications.statusLabel(notifState),
        value: unreadNotifs ? `${unreadNotifs} unread` : "",
        onClick: () => router.navigate("/notifications"),
      }),
      notifState === "default"
        ? row({
            title: "Enable browser notifications",
            detail: "Reminders appear while One Look is open",
            control: el(
              "button",
              {
                class: "btn btn-sm",
                "data-variant": "primary",
                type: "button",
                onClick: async () => {
                  const result = await notifications.requestPermission();
                  toast(
                    result === "granted"
                      ? "Notifications enabled"
                      : result === "denied"
                        ? "Notifications stay off"
                        : "Notifications unchanged",
                  );
                  if (result === "granted") reminders.start();
                  await router.resolve();
                },
              },
              "Enable",
            ),
          })
        : null,
      row({
        title: "Task reminders",
        detail: upcoming.length
          ? `${upcoming.length} reminder${upcoming.length === 1 ? "" : "s"} set on open tasks`
          : "No reminders set yet — add one when you create a task",
        onClick: () => router.navigate("/tasks"),
      }),
      row({
        title: "Calendar",
        detail: "Read-only Google Calendar",
        onClick: () => router.navigate("/calendar"),
      }),
      row({
        title: "Shortcuts",
        detail: shortcutCount
          ? `${shortcutCount} saved · up to ${shortcuts.MAX_PINNED} on Home`
          : "Pin the sites you open every day",
        onClick: () => router.navigate("/shortcuts"),
      }),
      row({
        title: "Quick notes",
        detail: noteCount
          ? `${noteCount} note${noteCount === 1 ? "" : "s"} on this device`
          : "Nothing saved yet",
        onClick: () => router.navigate("/notes"),
      }),
      row({
        title: "News",
        detail: `Top stories from ${newsService.NEWS_PROVIDER}`,
        onClick: () => router.navigate("/news"),
      }),
      row({
        title: "Search",
        detail: "Tasks, notes, mail, calendar and news",
        onClick: () => router.navigate("/search"),
      }),
      row({
        title: "Weather location",
        detail: weatherSummary,
        control: el("div", { class: "row", style: "gap:8px" }, [
          el(
            "button",
            {
              class: "btn btn-sm",
              type: "button",
              onClick: async () => {
                const result = await weatherUI.shareLocation();
                toast(
                  result.ok
                    ? "Location updated"
                    : result.reason === "denied"
                      ? "Location permission was blocked"
                      : "Could not get your location",
                );
                await router.resolve();
              },
            },
            savedLocation ? "Try again" : "Use location",
          ),
          el(
            "button",
            {
              class: "btn btn-sm",
              "data-variant": "ghost",
              type: "button",
              onClick: async () => {
                await weatherUI.forgetLocation();
                toast("Location removed");
                await router.resolve();
              },
            },
            "Forget",
          ),
        ]),
      }),
    ]),
  );

  /* ---------- About ---------- */
  const aboutRows = [
    row({
      title: "Connection",
      detail: connectivity.isOnline() ? "Online" : "Offline — your tasks and notes still work",
    }),
    row({ title: "Offline ready", detail: install.statusLabel(installState) }),
  ];

  if (installState.canPrompt) {
    aboutRows.push(
      row({
        title: "Install One Look",
        detail: "Add it to your home screen",
        control: el(
          "button",
          {
            class: "btn btn-sm",
            "data-variant": "primary",
            type: "button",
            onClick: async () => {
              const outcome = await install.promptInstall();
              if (outcome === "accepted") toast("Installing One Look");
              await router.resolve();
            },
          },
          "Install",
        ),
      }),
    );
  }

  aboutRows.push(
    row({ title: "Version", value: APP_VERSION }),
    row({ title: "Weather data", detail: WEATHER_PROVIDER }),
    row({ title: "Not built yet", detail: "AI assistant, voice input, LinkedIn alerts" }),
  );

  screen.append(disclosure("About", aboutRows));

  /* ---------- Developer (hidden in production — see config.js IS_DEV) ---------- */
  if (IS_DEV) {
    screen.append(
      disclosure("Developer", [
        row({
          title: "Clear all tasks",
          detail: "Removes every task from this device",
          control: el(
            "button",
            {
              class: "btn btn-sm",
              "data-variant": "danger",
              type: "button",
              onClick: async () => {
                const ok = await confirmSheet({
                  title: "Clear all tasks?",
                  message: "Every task on this device is deleted. This cannot be undone.",
                  confirmLabel: "Clear",
                  danger: true,
                });
                if (!ok) return;
                await clearStore(STORES.tasks);
                toast("All tasks cleared");
                await router.resolve();
              },
            },
            "Clear",
          ),
        }),
      ]),
    );
  }

  screen.append(
    el("p", {
      class: "tiny faint",
      style: "margin-top:var(--sp-6)",
      text: "One Look · your data stays on this device",
    }),
  );

  setActiveTab("more");
}

function setActiveTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.setAttribute("data-active", String(tab.dataset.tab === name));
  }
  screen.scrollIntoView({ block: "start" });
}

/* ---------- Phase 6 screens ---------- */
async function calendarScreen() {
  clear(screen);
  await calendarModule.renderCalendar(screen);
  setActiveTab("more");
}

async function newsScreen() {
  clear(screen);
  await newsModule.renderNews(screen);
  setActiveTab("more");
}

async function notificationsScreen() {
  clear(screen);
  await notificationsView.renderNotifications(screen);
  setActiveTab("more");
}

async function shortcutsScreen() {
  clear(screen);
  await shortcutsView.renderShortcuts(screen);
  setActiveTab("more");
}

async function waterScreen() {
  clear(screen);
  await waterView.renderWaterScreen(screen);
  setActiveTab("more");
}

/* ---------- Boot ---------- */
async function showApp(session) {
  state.session = session;
  authView.hidden = true;
  appView.hidden = false;
  reminders.start();
  hub.start();
  sync.start();

  // Initialize native notifications (Capacitor) for background delivery
  try {
    const { initNotifications } = await import('./services/capacitor-notifications.js');
    await initNotifications();
  } catch (error) {
    console.debug('[OneLook] Native notifications not available:', error?.message);
  }

  await router.resolve();
}

async function boot() {
  closeSheet();
  await theme.loadTheme();
  const session = await auth.getSession();

  if (!session) {
    reminders.stop();
    hub.stop();
    sync.stop();
    appView.hidden = true;
    authView.hidden = false;
    await renderAuth(authView, {
      onAuthenticated: async (newSession, { firstRun }) => {
        if (firstRun) await offerBiometricEnrollment(newSession);
        await showApp(newSession);
      },
    });
    return;
  }

  await showApp(session);
}

router.register("/home", homeScreen);
router.register("/tasks", tasksScreen);
router.register("/inbox", inboxScreen);
router.register("/more", moreScreen);
router.register("/notes", notesScreen);
router.register("/search", searchScreen);
router.register("/calendar", calendarScreen);
router.register("/news", newsScreen);
router.register("/notifications", notificationsScreen);
router.register("/shortcuts", shortcutsScreen);
router.register("/water", waterScreen);
router.setFallback(homeScreen);

router.listen(() => Boolean(state.session));

if (!window.location.hash) window.location.hash = "/home";

// Offline shell + connection status. Both are safe no-ops where unsupported.
connectivity.start();
install.registerServiceWorker().catch(() => {});

window.addEventListener("error", (event) => {
  console.error("[One Look]", event.error || event.message);
});

boot().catch((err) => {
  console.error(err);
  appView.hidden = true;
  authView.hidden = false;
  clear(authView).append(
    el("div", { class: "auth-card" }, [
      el("h1", { class: "auth-title", text: "One Look could not start" }),
      el("p", {
        class: "auth-sub",
        text: err.message || "Local storage is unavailable in this browser.",
      }),
    ]),
  );
});
