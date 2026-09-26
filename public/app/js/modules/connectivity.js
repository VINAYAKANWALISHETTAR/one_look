/**
 * Connectivity — a small, unobtrusive online/offline indicator.
 *
 * Reads navigator.onLine and listens to the browser's online/offline events.
 * Offline shows a persistent pill; coming back online shows a short-lived
 * "Back online" pill that fades itself out. No modals, no blocking UI.
 */

import { el } from "./ui.js";

const listeners = new Set();
let pill = null;
let hideTimer = null;

export function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function ensurePill() {
  if (pill) return pill;
  pill = el("div", { class: "net-pill", role: "status", "aria-live": "polite", hidden: true });
  document.body.append(pill);
  return pill;
}

function show(text, tone, autoHideMs) {
  const node = ensurePill();
  node.textContent = text;
  node.setAttribute("data-tone", tone);
  node.hidden = false;
  if (hideTimer) window.clearTimeout(hideTimer);
  if (autoHideMs) {
    hideTimer = window.setTimeout(() => {
      node.hidden = true;
    }, autoHideMs);
  }
}

function paint(online, { initial = false } = {}) {
  if (!online) show("Offline", "offline");
  else if (initial) ensurePill().hidden = true;
  else show("Back online", "online", 2600);
  for (const fn of listeners) {
    try {
      fn(online);
    } catch {
      /* a listener must never break connectivity handling */
    }
  }
}

export function start() {
  paint(isOnline(), { initial: true });
  window.addEventListener("online", () => paint(true));
  window.addEventListener("offline", () => paint(false));
}
