/**
 * Today's Focus — a deterministic priority engine, not AI.
 *
 * It reads the signals One Look already has (tasks, calendar, mail, reminders,
 * weather, water) and ranks them with fixed, readable rules. Every item points
 * at something real: an overdue task, a meeting that starts soon, unread
 * important mail. If a source is missing or not connected it simply contributes
 * nothing — the engine never invents a reason to worry.
 *
 * Ranking (highest first):
 *   100  overdue tasks
 *    95  meeting starting within the next hour
 *    85  high-priority task due today
 *    70  unread important mail
 *    60  remaining tasks due today
 *    55  reminder coming up in the next two hours
 *    40  weather worth knowing about before leaving
 *    30  water intake behind the day's pace
 */

import { listTasks, summarize } from "./tasks.js";
import { upcomingReminders } from "./reminders.js";
import { formatTime } from "./format.js";
import * as calendarService from "../services/calendar-service.js";
import * as water from "./water.js";
import { getCurrentWeather } from "../services/weather-service.js";

const MINUTE = 60000;

function minutesUntil(value, now) {
  return Math.round((new Date(value) - now) / MINUTE);
}

function eventTimeLabel(event, now) {
  if (event.allDay) return "All day";
  const mins = minutesUntil(event.start, now);
  if (mins <= 0) return "Happening now";
  if (mins < 60) return `In ${mins} min`;
  const time = new Date(event.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `At ${time}`;
}

/**
 * @param {object} input
 * @param {Array}  input.events  merged calendar events (may be empty)
 * @param {object} input.mail    mail summary payload or null
 * @returns {{ items: Array, headline: string }}
 */
export async function buildFocus({ events = [], mail = null, now = new Date() } = {}) {
  const [tasks, progress, weather] = await Promise.all([
    listTasks().catch(() => []),
    water.todayProgress().catch(() => null),
    getCurrentWeather().catch(() => ({ available: false })),
  ]);

  const stats = summarize(tasks);
  const reminders = await upcomingReminders(now).catch(() => []);
  const items = [];

  /* 100 — overdue */
  if (stats.overdue.length) {
    items.push({
      score: 100,
      kind: "task",
      tone: "urgent",
      title:
        stats.overdue.length === 1
          ? stats.overdue[0].title
          : `${stats.overdue.length} overdue tasks`,
      detail: stats.overdue.length === 1 ? "Overdue" : "Past their due time",
      action: "/tasks",
    });
  }

  /* 95 — a meeting within the hour */
  const next = calendarService.nextEvent(events, now);
  if (next) {
    const mins = minutesUntil(next.start, now);
    if (mins <= 60) {
      items.push({
        score: 95,
        kind: "calendar",
        tone: "urgent",
        title: next.title,
        detail: [eventTimeLabel(next, now), next.meeting ? next.meeting.kind : next.location]
          .filter(Boolean)
          .join(" · "),
        action: "/calendar",
        link: next.meeting?.url || null,
      });
    }
  }

  /* 85 — high priority today */
  const highToday = stats.dueToday.filter((task) => task.priority === "high" && !task.overdue);
  if (highToday.length) {
    items.push({
      score: 85,
      kind: "task",
      tone: "high",
      title: highToday.length === 1 ? highToday[0].title : `${highToday.length} high-priority tasks`,
      detail: highToday.length === 1 ? formatTime(highToday[0].time) || "Due today" : "Due today",
      action: "/tasks",
    });
  }

  /* 70 — important mail */
  const important = mail?.total?.important || 0;
  const unread = mail?.total?.unread || 0;
  if (important || unread) {
    items.push({
      score: 70,
      kind: "mail",
      tone: important ? "high" : "normal",
      title: important
        ? `${important} important email${important === 1 ? "" : "s"}`
        : `${unread} unread email${unread === 1 ? "" : "s"}`,
      detail: important && unread ? `${unread} unread in total` : "Across your connected accounts",
      action: "/inbox",
    });
  }

  /* 60 — the rest of today */
  const remainingToday = stats.dueToday.filter(
    (task) => !task.overdue && task.priority !== "high",
  ).length;
  if (remainingToday) {
    items.push({
      score: 60,
      kind: "task",
      tone: "normal",
      title: `${remainingToday} task${remainingToday === 1 ? "" : "s"} left today`,
      detail: stats.next ? `Next: ${stats.next.title}` : "Due today",
      action: "/tasks",
    });
  }

  /* 55 — a reminder in the next two hours */
  const soon = reminders.find((task) => minutesUntil(task.reminderAt, now) <= 120);
  if (soon) {
    items.push({
      score: 55,
      kind: "task",
      tone: "normal",
      title: `Reminder: ${soon.title}`,
      detail: `In ${minutesUntil(soon.reminderAt, now)} min`,
      action: "/tasks",
    });
  }

  /* 40 — weather worth acting on */
  if (weather?.available) {
    const cold = Number.isFinite(weather.low) && weather.low <= 5;
    const hot = Number.isFinite(weather.high) && weather.high >= 35;
    const rain = weather.rainNote || (weather.rainChance ?? 0) >= 60;
    if (rain || cold || hot) {
      items.push({
        score: 40,
        kind: "weather",
        tone: "normal",
        title: weather.rainNote || `${weather.temp}°C · ${weather.condition || "Weather"}`,
        detail: cold
          ? `Cold today · low ${weather.low}°`
          : hot
            ? `Hot today · high ${weather.high}°`
            : `Rain chance ${weather.rainChance}%`,
        action: "/home",
      });
    }
  }

  /* 30 — water behind pace */
  if (progress && !progress.reached) {
    const hour = now.getHours();
    // Expected intake by now, spread across a 8:00–22:00 day.
    const elapsed = Math.min(Math.max((hour - 8) / 14, 0), 1);
    const expected = Math.round(progress.goalMl * elapsed);
    if (expected > 0 && progress.ml < expected * 0.75) {
      items.push({
        score: 30,
        kind: "water",
        tone: "normal",
        title: "Drink some water",
        detail: water.summaryLine(progress),
        action: "/water",
      });
    }
  }

  /* Home shows exactly ONE focus: the single highest-ranked signal. Everything
   * else already has its own card further down the dashboard, so repeating it
   * here would only duplicate information. */
  const ranked = items.sort((a, b) => b.score - a.score);
  const primary = ranked[0] || null;

  return {
    primary,
    empty: !primary,
    headline: primary
      ? primary.title
      : stats.completedToday
        ? "Everything for today is done"
        : "Nothing needs your attention right now",
  };
}

