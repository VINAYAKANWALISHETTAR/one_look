/**
 * Theme — dark first.
 *
 * One Look defaults to its dark palette; the user can switch to light or follow
 * the system in More. The choice lives in IndexedDB (no localStorage anywhere in
 * this app) and is applied to <html data-theme> so CSS owns every colour value.
 */

import { STORES, readValue, writeValue } from "../db/indexeddb.js";

const KEY = "theme";
export const THEMES = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match system" },
];

let current = "dark";

function apply(theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0b0c0f");
}

export function getTheme() {
  return current;
}

export async function loadTheme() {
  const saved = await readValue(STORES.settings, KEY, "dark");
  apply(THEMES.some((entry) => entry.value === saved) ? saved : "dark");
  return current;
}

export async function setTheme(theme) {
  const next = THEMES.some((entry) => entry.value === theme) ? theme : "dark";
  await writeValue(STORES.settings, KEY, next);
  apply(next);
  return next;
}

export function themeLabel(theme = current) {
  return THEMES.find((entry) => entry.value === theme)?.label || "Dark";
}
