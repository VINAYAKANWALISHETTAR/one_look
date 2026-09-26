/**
 * Quick Notes — deliberately simple text capture in IndexedDB.
 *
 * Record shape: { id, content, createdAt, updatedAt, deletedAt, syncStatus }
 * No folders, no rich text, no editor. The point is to capture an idea in a
 * few seconds. Notes work fully offline; `syncStatus` and `deletedAt` exist
 * only so the sync engine can move them to PostgreSQL later.
 */

import { STORES, getAll, get, put, remove, uid } from "../db/indexeddb.js";

function sortNotes(a, b) {
  return a.updatedAt < b.updatedAt ? 1 : -1; // newest first
}

export async function listNotes() {
  const rows = await getAll(STORES.notes);
  return rows.filter((row) => !row.deletedAt).sort(sortNotes);
}

export async function createNote(content) {
  const text = String(content || "").trim();
  if (!text) throw new Error("A note needs some text.");
  const now = new Date().toISOString();
  const note = {
    id: uid("note"),
    content: text,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    syncStatus: "pending",
  };
  await put(STORES.notes, note);
  return note;
}

export async function updateNote(id, content) {
  const existing = await get(STORES.notes, id);
  if (!existing) throw new Error("Note not found.");
  const text = String(content || "").trim();
  if (!text) throw new Error("A note needs some text.");
  const note = {
    ...existing,
    content: text,
    updatedAt: new Date().toISOString(),
    syncStatus: "pending",
  };
  await put(STORES.notes, note);
  return note;
}

/** Soft delete so the deletion can synchronize (see sync-service.js). */
export async function deleteNote(id) {
  const existing = await get(STORES.notes, id);
  if (!existing) return;
  const now = new Date().toISOString();
  await put(STORES.notes, { ...existing, deletedAt: now, updatedAt: now, syncStatus: "pending" });
}

/** Case-insensitive substring search over note content. */
export function searchNotes(notes, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return notes;
  return notes.filter((note) => note.content.toLowerCase().includes(q));
}

export function noteTitle(note, max = 60) {
  const firstLine = note.content.split("\n")[0].trim();
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/* ---------- Sync support ---------- */
export async function listPendingNotes() {
  const rows = await getAll(STORES.notes);
  return rows.filter((row) => (row.syncStatus || "pending") === "pending");
}

export async function countUnsyncedNotes() {
  const rows = await getAll(STORES.notes);
  return rows.filter((row) => (row.syncStatus || "pending") !== "synced").length;
}

export async function setNoteSyncStatus(id, syncStatus, extra = {}) {
  const existing = await get(STORES.notes, id);
  if (!existing) return null;
  const note = { ...existing, ...extra, syncStatus };
  await put(STORES.notes, note);
  return note;
}

/** Applies a server record pulled during sync. */
export async function applyServerNote(remote) {
  const id = remote.clientId || remote.id;
  if (remote.deletedAt) {
    await remove(STORES.notes, id);
    return null;
  }
  const existing = await get(STORES.notes, id);
  const note = {
    id,
    remoteId: remote.id,
    content: remote.content,
    createdAt: remote.createdAt || existing?.createdAt || new Date().toISOString(),
    updatedAt: remote.updatedAt,
    deletedAt: null,
    syncStatus: "synced",
  };
  await put(STORES.notes, note);
  return note;
}

export async function purgeSyncedTombstones() {
  const rows = await getAll(STORES.notes);
  for (const row of rows) {
    if (row.deletedAt && row.syncStatus === "synced") await remove(STORES.notes, row.id);
  }
}
