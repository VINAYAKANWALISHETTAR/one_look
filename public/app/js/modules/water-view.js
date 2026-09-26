/**
 * Water tracker UI — Home progress row, the full screen, and the settings rows
 * used on the More page.
 *
 * Only real logged intake is shown. Nothing is estimated, and the goal is the
 * user's own number.
 */

import { el, clear, card, section, sectionHead, row, emptyState, toast } from "./ui.js";
import * as router from "../router.js";
import * as water from "./water.js";
import * as notifications from "./notifications.js";

function bar(progress) {
  return el("div", { class: "meter", "aria-hidden": "true" }, [
    el("span", { class: "meter-fill", style: `width:${progress.percent}%` }),
  ]);
}

/** Compact Home card: progress plus one-tap logging. */
export async function renderWater(container) {
  clear(container);

  const head = sectionHead(
    "Water",
    el("button", {
      class: "link-btn",
      type: "button",
      text: "Details",
      onClick: () => router.navigate("/water"),
    }),
  );

  const panel = card([]);
  container.append(head, panel);

  const draw = async () => {
    const progress = await water.todayProgress();
    clear(panel);
    panel.append(
      el("div", { class: "spread" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small truncate", text: water.summaryLine(progress) }),
          bar(progress),
        ]),
        el("span", { class: "water-percent tabular", text: `${progress.percent}%` }),
      ]),
      el("div", { class: "row", style: "gap:8px;margin-top:12px;flex-wrap:wrap" }, [
        ...water.QUICK_AMOUNTS.map((ml) =>
          el(
            "button",
            {
              class: "btn btn-sm",
              type: "button",
              onClick: async () => {
                await water.addWater(ml);
                await draw();
              },
            },
            `+${ml} ml`,
          ),
        ),
        el(
          "button",
          {
            class: "btn btn-sm",
            "data-variant": "ghost",
            type: "button",
            onClick: async () => {
              await water.undoLast();
              await draw();
            },
          },
          "Undo",
        ),
      ]),
    );
  };

  await draw();
}

export async function renderWaterScreen(container) {
  clear(container);

  container.append(
    el("header", {}, [
      el("h1", { class: "page-title", text: "Water" }),
      el("p", { class: "page-sub", text: "Your logged intake, on this device." }),
    ]),
  );

  const today = el("div", { style: "margin-top:var(--sp-5)" });
  const historyPanel = card([], { pad: false });
  const settingsPanel = card([], { pad: false });

  const drawToday = async () => {
    clear(today);
    await renderWater(today);
  };

  const drawHistory = async () => {
    clear(historyPanel);
    const rows = await water.history(7);
    const settings = await water.getSettings();
    if (!rows.length) {
      historyPanel.append(emptyState("Nothing logged yet", "Use the quick buttons above."));
      return;
    }
    for (const entry of rows) {
      historyPanel.append(
        el("div", { class: "setting" }, [
          el("div", { class: "grow" }, [
            el("div", {
              class: "small",
              text: new Date(`${entry.date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
            }),
            el("div", {
              class: "tiny faint",
              text: `${entry.entries.length} log${entry.entries.length === 1 ? "" : "s"}`,
            }),
          ]),
          el("span", {
            class: "badge",
            "data-tone": entry.ml >= settings.goalMl ? "ok" : "later",
            text: `${entry.ml} ml`,
          }),
        ]),
      );
    }
  };

  const drawSettings = async () => {
    clear(settingsPanel);
    const settings = await water.getSettings();

    const goal = el("input", {
      class: "input compact",
      type: "number",
      min: "250",
      max: "8000",
      step: "50",
      "aria-label": "Daily goal in millilitres",
      value: String(settings.goalMl),
    });
    const cup = el("input", {
      class: "input compact",
      type: "number",
      min: "50",
      max: "1000",
      step: "10",
      "aria-label": "Cup size in millilitres",
      value: String(settings.cupMl),
    });
    const every = el(
      "select",
      { class: "input compact", "aria-label": "Reminder interval" },
      [0, 30, 60, 90, 120].map((minutes) =>
        el(
          "option",
          { value: String(minutes), selected: settings.reminderEveryMin === minutes },
          minutes ? `Every ${minutes} min` : "Off",
        ),
      ),
    );

    const save = async (patch) => {
      await water.saveSettings(patch);
      toast("Water settings saved");
      await drawToday();
      await drawHistory();
    };

    goal.addEventListener("change", () => save({ goalMl: goal.value }));
    cup.addEventListener("change", () => save({ cupMl: cup.value }));
    every.addEventListener("change", () => save({ reminderEveryMin: every.value }));

    settingsPanel.append(
      row({ title: "Daily goal (ml)", detail: "Used for progress and reminders", control: goal }),
      row({ title: "Cup size (ml)", control: cup }),
      row({
        title: "Reminders",
        detail:
          notifications.status() === "granted"
            ? "Between 8:00 and 22:00 while One Look is open"
            : "Turn on notifications in More for pop-ups",
        control: every,
      }),
    );
  };

  container.append(
    today,
    section("Last 7 logged days", historyPanel),
    section("Settings", settingsPanel),
  );

  await drawToday();
  await drawHistory();
  await drawSettings();
}
