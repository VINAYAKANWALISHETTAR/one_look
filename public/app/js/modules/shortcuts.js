/**
 * Shortcuts — the user's own links, nothing pre-installed.
 *
 * Unlimited shortcuts, up to 6 pinned to Home (the rest live on the Shortcuts
 * screen). Icons are favicons fetched from the site itself at render time; no
 * image is stored, so a shortcut record stays tiny and offline-safe.
 *
 * LinkedIn is offered here as a suggestion only. One Look does not read the
 * LinkedIn API — a shortcut is a link, and it is honest about that.
 *
 * Record: { id, title, url, host, pinned, order, createdAt, updatedAt }
 */

import { STORES, getAll, get, put, remove, uid } from "../db/indexeddb.js";

export const MAX_PINNED = 6;

/** One-tap suggestions. Nothing is created until the user picks one. */
export const SUGGESTIONS = [
  { title: "LinkedIn", url: "https://www.linkedin.com/feed/" },
  { title: "Gmail", url: "https://mail.google.com/" },
  { title: "Calendar", url: "https://calendar.google.com/" },
  { title: "Drive", url: "https://drive.google.com/" },
  { title: "GitHub", url: "https://github.com/" },
  { title: "WhatsApp", url: "https://web.whatsapp.com/" },
  { title: "YouTube", url: "https://www.youtube.com/" },
  { title: "X", url: "https://x.com/" },
];

function normalizeUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("A shortcut needs a link.");
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("That does not look like a valid link.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https links are supported.");
  return url;
}

/** Favicon URL for a host. Rendered directly; never downloaded or stored. */
export function iconFor(shortcut) {
  const host = shortcut?.host || "";
  if (!host) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function initialsFor(shortcut) {
  const source = (shortcut?.title || shortcut?.host || "?").trim();
  const words = source.split(/[\s.]+/).filter(Boolean);
  return ((words[0]?.[0] || "") + (words[1]?.[0] || "")).toUpperCase() || source[0].toUpperCase();
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt < b.createdAt ? -1 : 1);

export async function listShortcuts() {
  return (await getAll(STORES.shortcuts)).sort(byOrder);
}

export async function pinnedShortcuts() {
  return (await listShortcuts()).filter((item) => item.pinned).slice(0, MAX_PINNED);
}

export async function countPinned() {
  return (await listShortcuts()).filter((item) => item.pinned).length;
}

export async function createShortcut({ title, url, pinned = true }) {
  const parsed = normalizeUrl(url);
  const all = await listShortcuts();
  const canPin = pinned && all.filter((item) => item.pinned).length < MAX_PINNED;

  const shortcut = {
    id: uid("shortcut"),
    title: String(title || "").trim() || parsed.hostname.replace(/^www\./, ""),
    url: parsed.toString(),
    host: parsed.hostname,
    pinned: canPin,
    order: all.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.shortcuts, shortcut);
  return shortcut;
}

export async function updateShortcut(id, { title, url }) {
  const existing = await get(STORES.shortcuts, id);
  if (!existing) throw new Error("Shortcut not found.");
  const parsed = url === undefined ? null : normalizeUrl(url);
  const next = {
    ...existing,
    title: title === undefined ? existing.title : String(title).trim() || existing.title,
    url: parsed ? parsed.toString() : existing.url,
    host: parsed ? parsed.hostname : existing.host,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.shortcuts, next);
  return next;
}

/** Returns the new pinned state, or null when the pin limit is already used. */
export async function togglePin(id) {
  const existing = await get(STORES.shortcuts, id);
  if (!existing) return null;
  if (!existing.pinned && (await countPinned()) >= MAX_PINNED) return null;
  const next = { ...existing, pinned: !existing.pinned, updatedAt: new Date().toISOString() };
  await put(STORES.shortcuts, next);
  return next;
}

export async function deleteShortcut(id) {
  await remove(STORES.shortcuts, id);
}

/** Moves a shortcut one place up or down in the user's own order. */
export async function reorder(id, direction) {
  const all = await listShortcuts();
  const index = all.findIndex((item) => item.id === id);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= all.length) return false;

  const reordered = [...all];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  for (let i = 0; i < reordered.length; i += 1) {
    await put(STORES.shortcuts, { ...reordered[i], order: i });
  }
  return true;
}
