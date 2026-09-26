/**
 * Tasks module — the only place task records are created or mutated.
 *
 * Record shape:
 *   { id, title, description, date (YYYY-MM-DD), time (HH:MM|""),
 *     priority: high|medium|low, status: pending|completed,
 *     reminderOffset: none|at|5|10|15|30|60|1440|custom,
 *     reminderTime (HH:MM|"" — only used when reminderOffset === "custom"),
 *     reminderAt (ISO string|null — DERIVED, what the scheduler reads),
 *     createdAt, updatedAt, completedAt }
 *
 * `overdue` is DERIVED on read from date+time, never stored, so it stays
 * correct without any background job. `reminderAt` is recomputed on every
 * write, so editing a task's date/time moves its reminder and deleting the
 * task removes it — there is no second record to keep in sync.
 */

import { STORES, getAll, get, put, remove, uid } from "../db/indexeddb.js";
import { todayISO, toDateTime, formatTime } from "./format.js";
import { scheduleAllReminders, cancelReminder } from "./reminders.js";

export const PRIORITIES = ["high", "medium", "low"];
export const FILTERS = ["today", "upcoming", "overdue", "completed", "all"];

/** Reminder choices offered in the task editor. */
export const REMINDER_OPTIONS = [
  { value: "none", label: "No reminder" },
  { value: "at", label: "At task time" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
  { value: "custom", label: "Custom time" },
];

const REMINDER_VALUES = REMINDER_OPTIONS.map((o) => o.value);

function decorate(task, now = new Date()) {
  const overdue = task.status === "pending" && toDateTime(task.date, task.time) < now;
  return {
    ...task,
    overdue,
    displayStatus: task.status === "completed" ? "completed" : overdue ? "overdue" : "pending",
  };
}

function sortTasks(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time || "99:99";
  const bt = b.time || "99:99";
  if (at !== bt) return at < bt ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export async function listTasks() {
  const rows = await getAll(STORES.tasks);
  const now = new Date();
  // Tombstones (deletedAt set) stay in IndexedDB until their deletion has
  // synced, but they are never shown to the user.
  return rows
    .filter((row) => !row.deletedAt)
    .map((row) => decorate(row, now))
    .sort(sortTasks);
}

export function filterTasks(tasks, filter) {
  const today = todayISO();
  switch (filter) {
    case "today":
      // Due today, plus anything still pending from earlier days.
      return tasks.filter((t) => t.status === "pending" && t.date <= today);
    case "upcoming":
      return tasks.filter((t) => t.status === "pending" && t.date > today);
    case "overdue":
      return tasks.filter((t) => t.status === "pending" && t.overdue);
    case "completed":
      return tasks.filter((t) => t.status === "completed");
    default:
      return tasks;
  }
}

/* ---------- Reminders (derived from the task itself) ---------- */
function computeReminderAt({ date, time, reminderOffset, reminderTime }) {
  if (reminderOffset === "none" || !reminderOffset) return null;

  if (reminderOffset === "custom") {
    return reminderTime ? toDateTime(date, reminderTime).toISOString() : null;
  }

  // Every relative option needs a task time to count back from.
  if (!time) return null;
  const start = toDateTime(date, time);
  const minutes = reminderOffset === "at" ? 0 : Number(reminderOffset);
  if (!Number.isFinite(minutes)) return null;
  return new Date(start.getTime() - minutes * 60000).toISOString();
}

/** "Reminder · 13:45" — returns "" when the task has no reminder. */
export function reminderLabel(task) {
  if (!task?.reminderAt) return "";
  const d = new Date(task.reminderAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const sameDay = task.date === todayISO(d);
  const time = formatTime(`${hh}:${mm}`);
  return sameDay
    ? `Reminder · ${time}`
    : `Reminder · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function normalize(input) {
  const priority = PRIORITIES.includes(input.priority) ? input.priority : "medium";
  const time = /^\d{2}:\d{2}$/.test(input.time || "") ? input.time : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date || "") ? input.date : todayISO();
  const reminderTime = /^\d{2}:\d{2}$/.test(input.reminderTime || "") ? input.reminderTime : "";

  let reminderOffset = REMINDER_VALUES.includes(input.reminderOffset) ? input.reminderOffset : null;
  if (!reminderOffset) reminderOffset = reminderTime ? "custom" : "none";
  // A relative reminder is meaningless without a task time.
  if (reminderOffset !== "none" && reminderOffset !== "custom" && !time) reminderOffset = "none";

  const fields = {
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    date,
    time,
    priority,
    reminderOffset,
    reminderTime: reminderOffset === "custom" ? reminderTime : "",
  };

  return { ...fields, reminderAt: computeReminderAt(fields) };
}

export async function createTask(input) {
  const fields = normalize(input);
  if (!fields.title) throw new Error("A task needs a title.");
  const now = new Date().toISOString();
  const task = {
    id: uid("task"),
    ...fields,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    deletedAt: null,
    // Every local write starts as "pending" so the sync engine can find it.
    syncStatus: "pending",
  };
  await put(STORES.tasks, task);
  await scheduleAllReminders().catch(() => {});
  return decorate(task);
}

export async function updateTask(id, input) {
  const existing = await get(STORES.tasks, id);
  if (!existing) throw new Error("Task not found.");
  const fields = normalize({ ...existing, ...input });
  if (!fields.title) throw new Error("A task needs a title.");
  const task = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };
  await put(STORES.tasks, task);
  await scheduleAllReminders().catch(() => {});
  return decorate(task);
}

export async function setTaskStatus(id, status) {
  const existing = await get(STORES.tasks, id);
  if (!existing) throw new Error("Task not found.");
  const task = {
    ...existing,
    status: status === "completed" ? "completed" : "pending",
    completedAt: status === "completed" ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };
  await put(STORES.tasks, task);
  // Completed tasks keep reminderAt for history but the scheduler skips them.
  return decorate(task);
}

export async function toggleTask(id) {
  const task = await get(STORES.tasks, id);
  if (!task) throw new Error("Task not found.");
  return setTaskStatus(id, task.status === "completed" ? "pending" : "completed");
}

/**
 * Soft delete. The record becomes a tombstone (deletedAt + pending) so the
 * deletion can reach PostgreSQL; `purgeSyncedTombstones` removes it locally
 * once the server has confirmed it. Deleting the task still deletes its
 * reminder, because reminderAt lives on this record and the scheduler ignores
 * tombstoned tasks.
 */
export async function deleteTask(id) {
  const existing = await get(STORES.tasks, id);
  if (!existing) return;
  const now = new Date().toISOString();
  await put(STORES.tasks, { ...existing, deletedAt: now, updatedAt: now, syncStatus: "pending" });
}

/* ---------- Sync support (see services/sync-service.js) ---------- */

/** Records that still need to be pushed, tombstones included. */
export async function listPendingTasks() {
  const rows = await getAll(STORES.tasks);
  return rows.filter((row) => (row.syncStatus || "pending") === "pending");
}

export async function countUnsyncedTasks() {
  const rows = await getAll(STORES.tasks);
  return rows.filter((row) => (row.syncStatus || "pending") !== "synced").length;
}

export async function setTaskSyncStatus(id, syncStatus, extra = {}) {
  const existing = await get(STORES.tasks, id);
  if (!existing) return null;
  const task = { ...existing, ...extra, syncStatus };
  await put(STORES.tasks, task);
  return task;
}

/** Applies a server record pulled during sync. Server data wins on pull. */
export async function applyServerTask(remote) {
  const id = remote.clientId || remote.id;
  const existing = await get(STORES.tasks, id);

  if (remote.deletedAt) {
    if (existing) await remove(STORES.tasks, id);
    return null;
  }

  const task = {
    id,
    remoteId: remote.id,
    title: remote.title,
    description: remote.description || "",
    date: remote.date,
    time: remote.time || "",
    priority: remote.priority || "medium",
    status: remote.status || "pending",
    reminderOffset: remote.reminderOffset || "none",
    reminderTime: existing?.reminderTime || "",
    reminderAt: remote.reminderAt || null,
    completedAt: remote.completedAt || null,
    createdAt: remote.createdAt || existing?.createdAt || new Date().toISOString(),
    updatedAt: remote.updatedAt,
    deletedAt: null,
    syncStatus: "synced",
  };
  await put(STORES.tasks, task);
  return task;
}

/** Removes tombstones the server has confirmed. */
export async function purgeSyncedTombstones() {
  const rows = await getAll(STORES.tasks);
  for (const row of rows) {
    if (row.deletedAt && row.syncStatus === "synced") await remove(STORES.tasks, row.id);
  }
}

/* ---------- Home summary ---------- */
export function summarize(tasks) {
  const today = todayISO();
  const now = new Date();
  const todays = tasks.filter((t) => t.date === today);
  const dueToday = tasks.filter((t) => t.status === "pending" && t.date <= today);

  // "Next" = nearest upcoming incomplete task by date+time, across all dates.
  // Overdue tasks are never "next"; they are surfaced as overdue instead.
  const next =
    tasks
      .filter((t) => t.status === "pending" && toDateTime(t.date, t.time) >= now)
      .sort((a, b) => toDateTime(a.date, a.time) - toDateTime(b.date, b.time))[0] || null;

  return {
    todays: todays.sort(sortTasks),
    dueToday,
    remaining: dueToday.length,
    overdue: tasks.filter((t) => t.status === "pending" && t.overdue),
    completedToday: todays.filter((t) => t.status === "completed").length,
    next,
  };
}
