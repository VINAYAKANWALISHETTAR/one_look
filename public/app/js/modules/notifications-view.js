/**
 * Notification Center UI — a clean history of every alert One Look raised.
 *
 * Grouped Today / Yesterday / Earlier, newest first, with unread state, open,
 * dismiss and snooze. Reading and writing happens through
 * modules/notification-center.js; this file is only presentation.
 */

import { el, clear, card, emptyState, toast, confirmSheet } from "./ui.js";
import * as router from "../router.js";
import * as center from "./notification-center.js";
import * as notifications from "./notifications.js";

const SNOOZE_MINUTES = [10, 30, 60];

/** Three buckets only, so the list stays short and scannable. */
function bucket(iso) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return "Earlier";
}

const clock = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Bell button with the unread count, used in page headers. */
export async function bellButton() {
  const count = await center.unreadCount().catch(() => 0);
  return el(
    "button",
    {
      class: "icon-btn",
      type: "button",
      "aria-label": count ? `Notifications, ${count} unread` : "Notifications",
      "data-badge": count ? String(count > 99 ? "99+" : count) : null,
      onClick: () => router.navigate("/notifications"),
      html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 15V10a6 6 0 1 0-12 0v5l-1.5 2.5h15L18 15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    },
    [],
  );
}

function itemRow(item, { onChanged }) {
  const meta = [center.typeLabel(item.type), clock(item.createdAt)].filter(Boolean).join(" · ");

  const row = el("div", { class: "notif-row", "data-unread": String(!item.readAt) }, [
    el("span", {
      class: "notif-icon",
      "aria-hidden": "true",
      text: center.typeLabel(item.type).slice(0, 1),
    }),
    el("div", { class: "grow" }, [
      el("div", { class: "notif-title truncate", text: item.title }),
      item.body ? el("div", { class: "tiny muted truncate", text: item.body }) : null,
      el("div", { class: "tiny faint", text: item.snoozeUntil ? `${meta} · snoozed to ${clock(item.snoozeUntil)}` : meta }),
      el("div", { class: "row", style: "gap:8px;margin-top:8px;flex-wrap:wrap" }, [
        item.action
          ? el(
              "button",
              {
                class: "btn btn-sm",
                type: "button",
                onClick: async () => {
                  await center.markRead(item.id);
                  router.navigate(item.action);
                },
              },
              "Open",
            )
          : null,
        el(
          "button",
          {
            class: "btn btn-sm",
            "data-variant": "ghost",
            type: "button",
            onClick: async () => {
              await center.dismiss(item.id);
              await onChanged();
            },
          },
          "Dismiss",
        ),
        el(
          "select",
          {
            class: "input compact",
            "aria-label": "Snooze",
            onChange: async (event) => {
              const minutes = Number(event.target.value);
              if (!minutes) return;
              await center.snooze(item.id, minutes);
              toast(`Snoozed for ${minutes} min`);
              await onChanged();
            },
          },
          [
            el("option", { value: "" }, "Snooze"),
            ...SNOOZE_MINUTES.map((minutes) =>
              el("option", { value: String(minutes) }, `${minutes} min`),
            ),
          ],
        ),
      ]),
    ]),
    item.readAt ? null : el("span", { class: "notif-unread", "aria-label": "Unread" }),
  ]);

  if (!item.readAt) {
    row.addEventListener("click", async (event) => {
      if (event.target.closest("button, select, a")) return;
      await center.markRead(item.id);
      row.setAttribute("data-unread", "false");
      row.querySelector(".notif-unread")?.remove();
    });
  }

  return row;
}

export async function renderNotifications(container) {
  clear(container);

  let filter = "all";

  const header = el("header", { class: "spread" }, [
    el("div", { class: "grow" }, [
      el("h1", { class: "page-title", text: "Notifications" }),
      el("p", { class: "page-sub" }),
    ]),
  ]);
  const list = el("div", { style: "margin-top:var(--sp-4)" });
  container.append(header);

  const sub = header.querySelector(".page-sub");

  const draw = async () => {
    const [items, unread] = await Promise.all([center.list({ type: filter }), center.unreadCount()]);
    sub.textContent = items.length
      ? `${items.length} in history · ${unread} unread`
      : "Nothing yet";

    clear(list);

    if (!items.length) {
      list.append(
        card(
          emptyState("No notifications yet", "Task reminders, water and breaks appear here."),
          { pad: false },
        ),
      );
      return;
    }

    let lastBucket = null;
    let panel = null;
    for (const item of items) {
      const heading = bucket(item.createdAt);
      if (heading !== lastBucket) {
        lastBucket = heading;
        list.append(
          el("div", { class: "section-label", style: "margin:var(--sp-5) 4px var(--sp-2)", text: heading }),
        );
        panel = card([], { pad: false });
        list.append(panel);
      }
      panel.append(itemRow(item, { onChanged: draw }));
    }
  };

  const types = [
    { id: "all", label: "All" },
    ...Object.entries(center.TYPES).map(([id, value]) => ({ id, label: value.label })),
  ];

  container.append(
    el(
      "div",
      { class: "filters" },
      types.map((entry) =>
        el(
          "button",
          {
            class: "filter",
            type: "button",
            "data-active": String(filter === entry.id),
            onClick: (event) => {
              filter = entry.id;
              for (const sibling of event.currentTarget.parentNode.children) {
                sibling.setAttribute("data-active", String(sibling === event.currentTarget));
              }
              draw().catch(() => {});
            },
          },
          entry.label,
        ),
      ),
    ),
    el("div", { class: "row", style: "gap:8px;margin-top:var(--sp-4)" }, [
      el(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          onClick: async () => {
            await center.markAllRead();
            toast("All marked as read");
            await draw();
          },
        },
        "Mark all read",
      ),
      el(
        "button",
        {
          class: "btn btn-sm",
          "data-variant": "danger",
          type: "button",
          onClick: async () => {
            const ok = await confirmSheet({
              title: "Clear notification history?",
              message: "Every notification is removed from this device.",
              confirmLabel: "Clear",
              danger: true,
            });
            if (!ok) return;
            await center.clearAll();
            toast("History cleared");
            await draw();
          },
        },
        "Clear all",
      ),
    ]),
    list,
  );

  if (notifications.status() !== "granted") {
    container.append(
      el("p", {
        class: "tiny faint",
        style: "margin-top:var(--sp-5)",
        text:
          notifications.status() === "denied"
            ? "Browser notifications are blocked, so alerts only appear in this list."
            : "Turn on notifications in More to also get these as pop-ups.",
      }),
    );
  }

  await draw();
}
