/**
 * IndexedDB wrapper for One Look.
 *
 * Single place where persistence happens. Every module goes through these
 * helpers so a later phase can add a remote sync layer without touching
 * feature code. No localStorage anywhere.
 */

const DB_NAME = "onelook";
// v2 added sync metadata indexes (syncStatus/updatedAt).
// v3 adds the productivity-hub stores (shortcuts, notifications, water).
// Existing records are untouched: new stores start empty and every added field
// is a plain property, so there is no data migration to run.
const DB_VERSION = 3;

export const STORES = {
  tasks: "tasks",
  notes: "notes",
  settings: "settings",
  auth: "auth",
  shortcuts: "shortcuts",
  notifications: "notifications",
  water: "water",
};


let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;

      const ensureIndex = (store, name, keyPath) => {
        if (!store.indexNames.contains(name)) store.createIndex(name, keyPath);
      };

      let tasks;
      if (!db.objectStoreNames.contains(STORES.tasks)) {
        tasks = db.createObjectStore(STORES.tasks, { keyPath: "id" });
        tasks.createIndex("date", "date");
        tasks.createIndex("status", "status");
        tasks.createIndex("createdAt", "createdAt");
      } else {
        tasks = tx.objectStore(STORES.tasks);
      }
      // Sync metadata (Phase 4): used to find records still to push.
      ensureIndex(tasks, "syncStatus", "syncStatus");
      ensureIndex(tasks, "updatedAt", "updatedAt");

      let notes;
      if (!db.objectStoreNames.contains(STORES.notes)) {
        notes = db.createObjectStore(STORES.notes, { keyPath: "id" });
        notes.createIndex("updatedAt", "updatedAt");
      } else {
        notes = tx.objectStore(STORES.notes);
      }
      ensureIndex(notes, "syncStatus", "syncStatus");

      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.auth)) {
        db.createObjectStore(STORES.auth, { keyPath: "key" });
      }

      /* Phase 6 — productivity hub stores. */
      if (!db.objectStoreNames.contains(STORES.shortcuts)) {
        const shortcuts = db.createObjectStore(STORES.shortcuts, { keyPath: "id" });
        shortcuts.createIndex("order", "order");
        shortcuts.createIndex("pinned", "pinned");
      }

      if (!db.objectStoreNames.contains(STORES.notifications)) {
        const items = db.createObjectStore(STORES.notifications, { keyPath: "id" });
        items.createIndex("createdAt", "createdAt");
        items.createIndex("type", "type");
      }

      // One row per calendar day: { date: "YYYY-MM-DD", ml, entries[] }.
      if (!db.objectStoreNames.contains(STORES.water)) {
        db.createObjectStore(STORES.water, { keyPath: "date" });
      }
    };


    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(store, value) {
  const db = await openDB();
  await wrap(tx(db, store, "readwrite").put(value));
  return value;
}

export async function get(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(tx(db, store, "readonly").getAll());
}

export async function remove(store, key) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").delete(key));
}

export async function clear(store) {
  const db = await openDB();
  return wrap(tx(db, store, "readwrite").clear());
}

/* Key/value convenience for the `settings` and `auth` stores. */
export async function readValue(store, key, fallback = null) {
  const row = await get(store, key);
  return row ? row.value : fallback;
}

export async function writeValue(store, key, value) {
  await put(store, { key, value });
  return value;
}

export function uid(prefix = "id") {
  const rand =
    window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
