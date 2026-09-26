/** Tiny DOM + UI helpers (sheets, toasts, confirm). No framework. */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export const CHECK_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>';

export const FACE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M20 8V6a2 2 0 0 0-2-2h-2M4 16v2a2 2 0 0 0 2 2h2M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M9 10v1M15 10v1M9.5 15c.8.7 1.6 1 2.5 1s1.7-.3 2.5-1"/></svg>';

/* Google "G" mark, used only on the Google sign-in button. */
export const GOOGLE_SVG =
  '<svg viewBox="0 0 18 18" aria-hidden="true" class="google-mark"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';

/* One icon style everywhere: 24-box, 1.7 stroke, round caps. */
export const CHEVRON_SVG =
  '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

/* ---------- Shared layout primitives ----------
 * Every screen builds cards from these three helpers, so padding, radius and
 * type sizes cannot drift between features.
 */

/** A card. `pad: false` when the card holds its own rows. */
export function card(children, { pad = true, className = "" } = {}) {
  const classes = ["panel", pad ? "panel-pad" : "", className].filter(Boolean).join(" ");
  return el("div", { class: classes }, children);
}

/** Section label with an optional right-hand action. */
export function sectionHead(label, action = null) {
  return el("div", { class: "section-head" }, [
    el("span", { class: "section-label", text: label }),
    action,
  ]);
}

/** Labelled section wrapper: head + body, consistent vertical rhythm. */
export function section(label, body, action = null) {
  return el("section", { class: "section" }, [sectionHead(label, action), ...[].concat(body)]);
}

/**
 * Compact settings row, iOS-style.
 * `onClick` makes it a button with a chevron; otherwise it is a plain row that
 * can carry a control (switch, select, button) in `control`.
 */
export function row({ title, detail = "", value = "", control = null, onClick = null } = {}) {
  const body = el("div", { class: "grow" }, [
    el("div", { class: "small truncate", text: title }),
    detail ? el("div", { class: "tiny faint truncate", text: detail }) : null,
  ]);

  if (onClick) {
    return el("button", { class: "setting", type: "button", onClick }, [
      body,
      value ? el("span", { class: "setting-value", text: value }) : null,
      el("span", { html: CHEVRON_SVG, "aria-hidden": "true" }).firstChild,
    ]);
  }

  return el("div", { class: "setting" }, [
    body,
    control || (value ? el("span", { class: "setting-value", text: value }) : null),
  ]);
}

/** Collapsible group of rows — keeps long settings pages short. */
export function disclosure(label, rows, { open = false } = {}) {
  return el("details", { class: "section disclosure", open: open || null }, [
    el("summary", {}, [
      el("div", { class: "section-head" }, [
        el("span", { class: "section-label", text: label }),
        el("span", { html: CHEVRON_SVG, "aria-hidden": "true" }).firstChild,
      ]),
    ]),
    card(rows, { pad: false }),
  ]);
}

/** Consistent empty state for any card. */
export function emptyState(title, note = "") {
  return el("div", { class: "empty" }, [
    el("span", { class: "empty-title", text: title }),
    note ? el("span", { class: "empty-note", text: note }) : null,
  ]);
}


/* ---------- Toast ---------- */
export function toast(message) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  const node = el("div", { class: "toast", text: message });
  root.append(node);
  window.setTimeout(() => node.remove(), 2400);
}

/* ---------- Sheet ---------- */
let closeCurrentSheet = null;

export function openSheet({ title, body, onClose }) {
  closeSheet();
  const root = document.getElementById("sheet-root");

  const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, [
    el("div", { class: "sheet-head" }, [
      el("h2", { class: "sheet-title", text: title }),
      el("button", { class: "btn", "data-variant": "ghost", onClick: () => closeSheet() }, "Close"),
    ]),
    body,
  ]);

  const backdrop = el(
    "div",
    {
      class: "sheet-backdrop",
      onClick: (event) => {
        if (event.target === backdrop) closeSheet();
      },
    },
    [sheet],
  );

  const onKey = (event) => {
    if (event.key === "Escape") closeSheet();
  };

  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  root.append(backdrop);

  closeCurrentSheet = () => {
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    backdrop.remove();
    closeCurrentSheet = null;
    if (typeof onClose === "function") onClose();
  };

  const focusable = sheet.querySelector("input, textarea, select, button");
  if (focusable) focusable.focus();

  return closeSheet;
}

export function closeSheet() {
  if (closeCurrentSheet) closeCurrentSheet();
}

/* ---------- Confirm ---------- */
export function confirmSheet({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const body = el("div", {}, [
      el("p", { class: "small muted", text: message, style: "margin-bottom:20px" }),
      el("div", { class: "row", style: "gap:8px" }, [
        el(
          "button",
          {
            class: "btn grow",
            onClick: () => {
              finish(false);
              closeSheet();
            },
          },
          "Cancel",
        ),
        el(
          "button",
          {
            class: "btn grow",
            "data-variant": danger ? "danger" : "primary",
            onClick: () => {
              finish(true);
              closeSheet();
            },
          },
          confirmLabel,
        ),
      ]),
    ]);

    openSheet({ title, body, onClose: () => finish(false) });
  });
}
