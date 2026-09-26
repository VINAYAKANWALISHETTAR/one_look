/** Date/time formatting helpers. Locale-aware, no dependencies. */

export function todayISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso, days) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export function fromISO(iso) {
  const [y, m, d] = String(iso || todayISO())
    .split("-")
    .map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Combines an ISO date and optional HH:MM into a Date. */
export function toDateTime(iso, time) {
  const d = fromISO(iso);
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [h, min] = time.split(":").map(Number);
    d.setHours(h, min, 0, 0);
  } else {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

export function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatDayLabel(iso) {
  const today = todayISO();
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, 1)) return "Tomorrow";
  if (iso === addDaysISO(today, -1)) return "Yesterday";
  const d = fromISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

export function formatTime(time) {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return "";
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Compact "when" label for feeds (mail, alerts): a clock time today, a weekday
 * this week, then a short date. Keeps rows scannable without a date column.
 */
export function relativeTime(value) {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";

  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (then >= startOfToday)
    return then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const daysAgo = Math.floor((startOfToday - then) / 86_400_000);
  if (daysAgo === 0) return "Yesterday";
  if (daysAgo < 6) return then.toLocaleDateString(undefined, { weekday: "short" });
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}
