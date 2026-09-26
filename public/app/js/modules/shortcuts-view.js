/**
 * Shortcuts UI — pinned grid for Home plus the full management screen.
 *
 * Data lives in modules/shortcuts.js; this file only renders. Links open in a
 * new tab, so One Look is never replaced by the site being opened.
 */

import { el, clear, card, sectionHead, emptyState, toast, openSheet, closeSheet, confirmSheet } from "./ui.js";
import * as router from "../router.js";
import * as shortcuts from "./shortcuts.js";

function tile(shortcut) {
  const icon = el("img", {
    class: "shortcut-icon",
    src: shortcuts.iconFor(shortcut),
    alt: "",
    loading: "lazy",
    width: "28",
    height: "28",
  });
  // No favicon (or offline): fall back to initials rather than a broken image.
  icon.addEventListener("error", () => {
    const initials = el("span", { class: "shortcut-initials", text: shortcuts.initialsFor(shortcut) });
    icon.replaceWith(initials);
  });

  return el(
    "a",
    {
      class: "shortcut-tile",
      href: shortcut.url,
      target: "_blank",
      rel: "noopener noreferrer",
      title: shortcut.url,
    },
    [icon, el("span", { class: "shortcut-label truncate", text: shortcut.title })],
  );
}

function editor(shortcut, onDone) {
  const title = el("input", {
    class: "input",
    type: "text",
    placeholder: "LinkedIn",
    value: shortcut?.title || "",
  });
  const url = el("input", {
    class: "input",
    type: "url",
    placeholder: "https://www.linkedin.com/feed/",
    value: shortcut?.url || "",
  });
  const error = el("div", { class: "form-error", hidden: true });
  const save = el(
    "button",
    { class: "btn grow", "data-variant": "primary", type: "submit" },
    shortcut ? "Save" : "Add shortcut",
  );

  const form = el(
    "form",
    {
      onSubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        save.disabled = true;
        try {
          if (shortcut) await shortcuts.updateShortcut(shortcut.id, { title: title.value, url: url.value });
          else await shortcuts.createShortcut({ title: title.value, url: url.value });
          closeSheet();
          toast(shortcut ? "Shortcut updated" : "Shortcut added");
          await onDone();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
          save.disabled = false;
        }
      },
    },
    [
      el("label", { class: "field" }, [el("span", { text: "Name" }), title]),
      el("label", { class: "field" }, [el("span", { text: "Link" }), url]),
      error,
      el("div", { class: "row", style: "gap:8px" }, [save]),
    ],
  );

  openSheet({ title: shortcut ? "Edit shortcut" : "New shortcut", body: form });
}

/** Home grid of pinned shortcuts (up to six). */
export async function renderPinned(container) {
  clear(container);
  const pinned = await shortcuts.pinnedShortcuts();

  const head = sectionHead(
    "Shortcuts",
    el("button", {
      class: "link-btn",
      type: "button",
      text: pinned.length ? "View all" : "Add",
      onClick: () => router.navigate("/shortcuts"),
    }),
  );

  const panel = card([]);
  if (pinned.length) {
    panel.append(
      el(
        "div",
        { class: "shortcut-grid" },
        pinned.map((shortcut) => tile(shortcut)),
      ),
    );
  } else {
    panel.append(
      el("div", { class: "tiny faint", text: "No shortcuts pinned yet — add the sites you open every day." }),
    );
  }

  container.append(head, panel);
}

function manageRow(shortcut, { onChanged, pinnedFull }) {
  return el("div", { class: "setting" }, [
    el("div", { class: "grow" }, [
      el("div", { class: "small truncate", text: shortcut.title }),
      el("div", { class: "tiny faint truncate", text: shortcut.url }),
    ]),
    el("div", { class: "row", style: "gap:6px" }, [
      el("button", {
        class: "icon-btn small-icon",
        type: "button",
        "aria-label": "Move up",
        text: "↑",
        onClick: async () => {
          await shortcuts.reorder(shortcut.id, "up");
          await onChanged();
        },
      }),
      el("button", {
        class: "icon-btn small-icon",
        type: "button",
        "aria-label": "Move down",
        text: "↓",
        onClick: async () => {
          await shortcuts.reorder(shortcut.id, "down");
          await onChanged();
        },
      }),
      el(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          "data-variant": shortcut.pinned ? "primary" : null,
          onClick: async () => {
            const result = await shortcuts.togglePin(shortcut.id);
            if (!result) {
              toast(`Only ${shortcuts.MAX_PINNED} shortcuts fit on Home`);
              return;
            }
            await onChanged();
          },
        },
        shortcut.pinned ? "Pinned" : pinnedFull ? "Home full" : "Pin",
      ),
      el(
        "button",
        { class: "btn btn-sm", type: "button", onClick: () => editor(shortcut, onChanged) },
        "Edit",
      ),
      el(
        "button",
        {
          class: "btn btn-sm",
          "data-variant": "danger",
          type: "button",
          onClick: async () => {
            const ok = await confirmSheet({
              title: "Delete shortcut?",
              message: `"${shortcut.title}" is removed from this device.`,
              confirmLabel: "Delete",
              danger: true,
            });
            if (!ok) return;
            await shortcuts.deleteShortcut(shortcut.id);
            toast("Shortcut deleted");
            await onChanged();
          },
        },
        "Delete",
      ),
    ]),
  ]);
}

export async function renderShortcuts(container) {
  clear(container);

  const header = el("header", { class: "spread" }, [
    el("div", { class: "grow" }, [
      el("h1", { class: "page-title", text: "Shortcuts" }),
      el("p", { class: "page-sub" }),
    ]),
    el("button", { class: "add-inline", type: "button", onClick: () => editor(null, draw) }, [
      "+ Add",
    ]),
  ]);
  const body = el("div", { style: "margin-top:12px" });
  container.append(header, body);
  const sub = header.querySelector(".page-sub");

  async function draw() {
    const all = await shortcuts.listShortcuts();
    const pinnedCount = all.filter((item) => item.pinned).length;
    sub.textContent = `${all.length} saved · ${pinnedCount} of ${shortcuts.MAX_PINNED} pinned to Home`;

    clear(body);

    const panel = card([], { pad: false });
    if (all.length) {
      for (const shortcut of all) {
        panel.append(
          manageRow(shortcut, { onChanged: draw, pinnedFull: pinnedCount >= shortcuts.MAX_PINNED }),
        );
      }
    } else {
      panel.append(emptyState("No shortcuts yet", "Add one, or pick a suggestion below."));
    }
    body.append(panel);

    /* Suggestions — nothing exists until the user taps one. */
    const existing = new Set(all.map((item) => item.url));
    const options = shortcuts.SUGGESTIONS.filter((entry) => !existing.has(entry.url));
    if (options.length) {
      body.append(
        el("section", { class: "section" }, [
          el("span", { class: "section-label", text: "Suggestions" }),
          el(
            "div",
            { class: "panel panel-pad chip-row" },
            options.map((entry) =>
              el(
                "button",
                {
                  class: "chip",
                  type: "button",
                  onClick: async () => {
                    try {
                      await shortcuts.createShortcut(entry);
                      toast(`${entry.title} added`);
                      await draw();
                    } catch (err) {
                      toast(err.message || "Could not add that shortcut");
                    }
                  },
                },
                `+ ${entry.title}`,
              ),
            ),
          ),
        ]),
        el("p", {
          class: "tiny faint",
          style: "margin-top:8px",
          text: "LinkedIn is a shortcut only — One Look does not read LinkedIn data.",
        }),
      );
    }
  }

  await draw();
}
