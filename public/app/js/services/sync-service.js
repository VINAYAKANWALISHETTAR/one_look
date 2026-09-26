/**
 * Sync engine — IndexedDB stays the source of truth for the UI; PostgreSQL is
 * the cloud source of truth across devices.
 *
 *   local write → syncStatus "pending"
 *   online + signed in to cloud → POST /api/sync (push pending + pull changes)
 *   server accepted → syncStatus "synced" (tombstones then purged locally)
 *   both sides changed → syncStatus "conflict" (nothing overwritten, nothing lost)
 *
 * Everything here is best-effort: if the backend is unavailable the app keeps
 * working entirely offline and the pending records simply wait.
 */

import { CONFIG } from "../config.js";
import { STORES, readValue, writeValue } from "../db/indexeddb.js";
import * as api from "./api-service.js";
import * as tasks from "../modules/tasks.js";
import * as notes from "../modules/notes.js";
import * as connectivity from "../modules/connectivity.js";

const WATERMARK_KEY = "syncWatermark";

/** Global status: idle | syncing | synced | offline | error | conflict | disabled */
let status = "idle";
let lastSyncedAt = null;
let lastError = null;
let pendingCount = 0;
let conflictCount = 0;
let timer = null;
let inFlight = null;

const listeners = new Set();

export function getStatus() {
  return { status, lastSyncedAt, lastError, pendingCount, conflictCount };
}

function emit(next) {
  if (next) status = next;
  const snapshot = getStatus();
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* a listener must never break syncing */
    }
  }
}

/** Human label for the small global indicator. */
export function statusLabel(snapshot = getStatus()) {
  switch (snapshot.status) {
    case "syncing":
      return "Syncing…";
    case "synced":
      return snapshot.conflictCount ? "Sync issue" : "Synced";
    case "conflict":
      return "Sync issue";
    case "offline":
      return "Offline";
    case "error":
      return "Sync issue";
    case "disabled":
      return "Local only";
    default:
      return snapshot.pendingCount ? "Waiting to sync" : "Local only";
  }
}

async function refreshCounts() {
  const [taskCount, noteCount] = await Promise.all([
    tasks.countUnsyncedTasks(),
    notes.countUnsyncedNotes(),
  ]);
  pendingCount = taskCount + noteCount;
}

const taskToWire = (task) => ({
  clientId: task.id,
  title: task.title,
  description: task.description || "",
  date: task.date,
  time: task.time || "",
  priority: task.priority || "medium",
  status: task.status || "pending",
  reminderOffset: task.reminderOffset || "none",
  reminderAt: task.reminderAt || null,
  completedAt: task.completedAt || null,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  deletedAt: task.deletedAt || null,
});

const noteToWire = (note) => ({
  clientId: note.id,
  content: note.content,
  createdAt: note.createdAt,
  updatedAt: note.updatedAt,
  deletedAt: note.deletedAt || null,
});

/**
 * One sync pass. Never throws — callers treat sync as optional.
 * @returns {Promise<object>} the resulting status snapshot
 */
export async function syncNow({ silent = true } = {}) {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    if (!api.isConfigured() || !(await api.isSignedInToCloud())) {
      await refreshCounts();
      emit("disabled");
      return getStatus();
    }

    if (!connectivity.isOnline()) {
      await refreshCounts();
      emit("offline");
      return getStatus();
    }

    emit("syncing");

    try {
      const since = await readValue(STORES.settings, WATERMARK_KEY, null);
      const [pendingTasks, pendingNotes] = await Promise.all([
        tasks.listPendingTasks(),
        notes.listPendingNotes(),
      ]);

      const result = await api.pushSync({
        since,
        tasks: pendingTasks.map(taskToWire),
        notes: pendingNotes.map(noteToWire),
      });

      // 1. Accepted pushes become "synced".
      for (const entry of result.tasks.applied) {
        await tasks.setTaskSyncStatus(entry.clientId, "synced", { remoteId: entry.id });
      }
      for (const entry of result.notes.applied) {
        await notes.setNoteSyncStatus(entry.clientId, "synced", { remoteId: entry.id });
      }

      // 2. Conflicts are marked, never merged and never overwritten.
      conflictCount = result.tasks.conflicts.length + result.notes.conflicts.length;
      for (const entry of result.tasks.conflicts) {
        await tasks.setTaskSyncStatus(entry.clientId, "conflict", { serverVersion: entry.server });
      }
      for (const entry of result.notes.conflicts) {
        await notes.setNoteSyncStatus(entry.clientId, "conflict", { serverVersion: entry.server });
      }

      // 3. Pull: apply server changes, skipping anything left in conflict.
      const conflicted = new Set([
        ...result.tasks.conflicts.map((entry) => entry.clientId),
        ...result.notes.conflicts.map((entry) => entry.clientId),
      ]);
      for (const remote of result.tasks.changed) {
        if (!conflicted.has(remote.clientId)) await tasks.applyServerTask(remote);
      }
      for (const remote of result.notes.changed) {
        if (!conflicted.has(remote.clientId)) await notes.applyServerNote(remote);
      }

      // 4. Confirmed tombstones can go.
      await tasks.purgeSyncedTombstones();
      await notes.purgeSyncedTombstones();

      await writeValue(STORES.settings, WATERMARK_KEY, result.serverTime);
      lastSyncedAt = result.serverTime;
      lastError = null;
      await refreshCounts();
      emit(conflictCount ? "conflict" : "synced");
    } catch (error) {
      lastError = error.offline ? "Server unreachable" : error.message;
      await refreshCounts();
      emit(error.offline ? "offline" : "error");
      if (!silent) throw error;
    }

    return getStatus();
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Clears the pull watermark, e.g. after signing in to a different account. */
export async function resetWatermark() {
  await writeValue(STORES.settings, WATERMARK_KEY, null);
}

export function start() {
  stop();
  refreshCounts().then(() => emit());
  syncNow().catch(() => {});
  timer = window.setInterval(() => syncNow().catch(() => {}), CONFIG.syncIntervalMs);
  connectivity.onChange((online) => {
    if (online) syncNow().catch(() => {});
    else emit("offline");
  });
}

export function stop() {
  if (timer) window.clearInterval(timer);
  timer = null;
}
