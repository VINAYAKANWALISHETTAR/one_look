/**
 * Mail UI — connected Gmail accounts, the attention-focused inbox, and the
 * message reader.
 *
 * One Look is NOT a Gmail client. The list answers one question: which mail
 * needs me? Reading a message is a deliberate second step, and replying,
 * archiving and deleting stay in Gmail (a deep link is offered instead).
 *
 * All data arrives through services/mail-service.js, which talks only to the
 * One Look backend. No Google token ever reaches this file.
 */

import { el, clear, toast, openSheet, closeSheet, confirmSheet, GOOGLE_SVG } from "./ui.js";
import * as mail from "../services/mail-service.js";
import { relativeTime } from "./format.js";

/* ---------- Presentation helpers ---------- */

const initial = (value) =>
  String(value || "?")
    .trim()
    .charAt(0)
    .toUpperCase() || "?";

/** Short, stable colour per account so multiple mailboxes stay distinguishable. */
function accountHue(email) {
  let hash = 0;
  for (const char of String(email || "")) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function accountChip(message) {
  const label = message.accountLabel || message.accountEmail || "";
  return el("span", {
    class: "mail-chip",
    style: `--chip-hue:${accountHue(message.accountEmail)}`,
    text: label.length > 18 ? `${label.slice(0, 17)}…` : label,
    title: message.accountEmail,
  });
}

const emptyState = (title, note) =>
  el("div", { class: "empty" }, [
    el("p", { class: "empty-title", text: title }),
    note ? el("p", { class: "empty-note", text: note }) : null,
  ]);

const spinnerRow = (label = "Loading…") => el("p", { class: "small muted", text: label });

/* ---------- Message reader ----------------------------------------------- */

/**
 * Plain-text rendering only. The HTML alternative is deliberately NOT injected:
 * remote mail HTML would mean tracking pixels, remote CSS and an XSS surface.
 * When a message is HTML-only we strip tags down to readable text instead.
 */
function htmlToReadableText(html) {
  return String(html || "")
    .replace(/<\s*(script|style|head)[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function openMessage(message) {
  const bodyNode = el("div", {}, [spinnerRow("Opening message…")]);

  openSheet({ title: "Message", body: bodyNode });

  let full;
  try {
    full = await mail.getMessage(message.accountId, message.id);
  } catch (error) {
    clear(bodyNode);
    bodyNode.append(
      emptyState(
        error.offline ? "You're offline" : "Could not open this message",
        error.offline
          ? "Message text is never stored on the device, so it needs a connection."
          : error.message,
      ),
    );
    return;
  }

  const text = full.bodyText?.trim() ? full.bodyText : htmlToReadableText(full.bodyHtml);

  clear(bodyNode);
  bodyNode.append(
    el("h3", { class: "mail-read-subject", text: full.subject }),
    el("div", { class: "mail-read-meta" }, [
      el("div", { class: "small", text: full.from.name || full.from.email }),
      el("div", { class: "tiny faint", text: full.from.email }),
      el("div", { class: "tiny faint", text: `To ${full.to || "you"}` }),
      el("div", { class: "tiny faint", text: `${full.accountEmail} · ${relativeTime(full.date)}` }),
    ]),
    full.attachments.length
      ? el("div", { class: "mail-attachments" }, [
          el("span", { class: "tiny faint", text: `${full.attachments.length} attachment(s): ` }),
          el("span", {
            class: "tiny",
            text: full.attachments.map((file) => file.filename).join(", "),
          }),
          el("p", { class: "tiny faint", text: "Open in Gmail to download." }),
        ])
      : null,
    el("pre", { class: "mail-read-body", text: text || "(This message has no text content.)" }),
    el("div", { class: "row", style: "gap:8px;margin-top:16px" }, [
      el(
        "a",
        {
          class: "btn grow",
          "data-variant": "primary",
          href: full.gmailUrl,
          target: "_blank",
          rel: "noopener noreferrer",
        },
        "Reply in Gmail",
      ),
      el("button", { class: "btn grow", onClick: () => closeSheet() }, "Done"),
    ]),
    el("p", {
      class: "tiny faint",
      style: "margin-top:12px",
      text: "Shown as text only — remote images and scripts in mail are never loaded.",
    }),
  );
}

/* ---------- Message row ---------- */

export function messageRow(message, { showAccount = true } = {}) {
  return el(
    "button",
    {
      class: "mail-row",
      type: "button",
      "data-unread": String(Boolean(message.unread)),
      onClick: () => openMessage(message),
    },
    [
      el("span", {
        class: "mail-avatar",
        style: `--chip-hue:${accountHue(message.accountEmail)}`,
        text: initial(message.from.name || message.from.email),
      }),
      el("span", { class: "mail-main" }, [
        el("span", { class: "mail-top" }, [
          el("span", { class: "mail-from", text: message.from.name || message.from.email }),
          el("span", { class: "mail-time tiny faint", text: relativeTime(message.date) }),
        ]),
        el("span", { class: "mail-subject", text: message.subject }),
        el("span", { class: "mail-snippet", text: message.snippet }),
        el("span", { class: "mail-tags" }, [
          message.important
            ? el("span", { class: "badge", "data-tone": "high", text: "Important" })
            : null,
          message.starred ? el("span", { class: "badge", text: "Starred" }) : null,
          showAccount ? accountChip(message) : null,
        ]),
      ]),
    ],
  );
}

/* ---------- Account management ------------------------------------------- */

/** Starts the OAuth popup; resolves when the account list should be reloaded. */
async function connectAccount(onDone) {
  try {
    const result = await mail.connectGoogleAccount();
    if (result?.email) toast(`${result.email} connected`);
    await onDone();
  } catch (error) {
    toast(error.message || "Could not connect Gmail.");
  }
}

export function connectButton(onDone, label = "Connect a Gmail account") {
  return el(
    "button",
    {
      class: "btn btn-block google-btn",
      type: "button",
      html: `${GOOGLE_SVG}<span>${label}</span>`,
      onClick: (event) => {
        // The popup must be opened inside this gesture, so no await before it.
        event.currentTarget.disabled = true;
        const button = event.currentTarget;
        connectAccount(onDone).finally(() => {
          button.disabled = false;
        });
      },
    },
    [],
  );
}

function accountRow(account, { onChanged }) {
  const needsReauth = account.status === "reauth_required";

  return el("div", { class: "setting" }, [
    el("span", {
      class: "mail-avatar",
      style: `--chip-hue:${accountHue(account.email)}`,
      text: initial(account.email),
    }),
    el("div", { class: "grow" }, [
      el("div", { class: "small", text: account.email }),
      el("div", {
        class: "tiny faint",
        text: needsReauth
          ? "Reconnect needed — Google access expired or was revoked."
          : account.lastSyncAt
            ? `Last checked ${relativeTime(account.lastSyncAt)}`
            : "Connected",
      }),
    ]),
    needsReauth
      ? el(
          "button",
          {
            class: "btn",
            "data-variant": "primary",
            type: "button",
            onClick: () => connectAccount(onChanged),
          },
          "Reconnect",
        )
      : null,
    el(
      "button",
      {
        class: "btn",
        "data-variant": "ghost",
        type: "button",
        onClick: async () => {
          const ok = await confirmSheet({
            title: "Disconnect account?",
            message: `One Look will stop reading ${account.email} and will delete its stored authorization. Your emails are not affected.`,
            confirmLabel: "Disconnect",
            danger: true,
          });
          if (!ok) return;
          try {
            await mail.disconnectAccount(account.id);
            toast("Account disconnected");
            await onChanged();
          } catch (error) {
            toast(error.message || "Could not disconnect.");
          }
        },
      },
      "Disconnect",
    ),
  ]);
}

/** "Mail accounts" panel — used on Inbox and on the More page. */
export function accountsPanel({ accounts, configured, onChanged }) {
  const panel = el("div", { class: "panel", style: "margin-top:8px" });

  if (!mail.isMailAvailable()) {
    panel.append(
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "Cloud account required" }),
          el("div", {
            class: "tiny faint",
            text: "Gmail is read through the One Look backend. Connect your cloud account first (More → Cloud sync).",
          }),
        ]),
      ]),
    );
    return panel;
  }

  if (!configured) {
    panel.append(
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "Google is not configured on the server" }),
          el("div", {
            class: "tiny faint",
            text: "Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI to the backend environment.",
          }),
        ]),
      ]),
    );
    return panel;
  }

  for (const account of accounts) panel.append(accountRow(account, { onChanged }));

  if (!accounts.length) {
    panel.append(
      el("div", { class: "setting" }, [
        el("div", { class: "grow" }, [
          el("div", { class: "small", text: "No mail connected yet" }),
          el("div", {
            class: "tiny faint",
            text: "Add your personal, college and work Gmail accounts — as many as you need.",
          }),
        ]),
      ]),
    );
  }

  panel.append(
    el("div", { class: "setting" }, [
      el("div", { class: "grow" }, [
        connectButton(
          onChanged,
          accounts.length ? "Add another account" : "Connect a Gmail account",
        ),
      ]),
    ]),
  );

  return panel;
}

/** Full-screen account manager, opened from More. */
export async function openAccountManager() {
  const body = el("div", {}, [spinnerRow()]);
  openSheet({ title: "Mail accounts", body });

  const draw = async () => {
    clear(body);
    body.append(spinnerRow());
    try {
      const data = await mail.listAccounts();
      clear(body);
      body.append(
        accountsPanel({ accounts: data.accounts, configured: data.configured, onChanged: draw }),
        el("p", {
          class: "tiny faint",
          style: "margin-top:14px",
          text: "One Look asks Google for read-only Gmail access. It cannot send, delete or change your mail, and it never sees your Google password.",
        }),
      );
    } catch (error) {
      clear(body);
      body.append(emptyState("Could not load accounts", error.message));
    }
  };

  await draw();
}

/* ---------- Home dashboard signal ---------------------------------------- */

/**
 * One compact row on Home answering "is there mail that needs me?" across all
 * accounts. Renders nothing at all when no account is connected — Home must not
 * grow placeholder cards for features the user has not switched on.
 */
export async function renderHomeSignal(container) {
  clear(container);
  if (!(await mail.isMailReady())) return;

  let data;
  try {
    data = await mail.summary();
  } catch {
    return; // never let a mail failure disturb the dashboard
  }

  const accounts = data.accounts || [];
  if (!accounts.length) return;

  const total = data.total || { important: 0, unread: 0 };
  const needsReauth = accounts.filter((entry) => entry.status === "reauth_required");

  const headline = needsReauth.length
    ? `${needsReauth.length} account${needsReauth.length === 1 ? "" : "s"} need reconnecting`
    : total.important
      ? `${total.important} important email${total.important === 1 ? "" : "s"}`
      : total.unread
        ? `${total.unread} unread email${total.unread === 1 ? "" : "s"}`
        : "Nothing needs you in your mail";

  container.append(
    el("section", { class: "section" }, [
      el("span", { class: "section-label", text: "Mail" }),
      el("div", { class: "panel", style: "margin-top:8px" }, [
        el(
          "button",
          {
            class: "setting",
            type: "button",
            style: "width:100%;text-align:left;background:none;border:0;cursor:pointer",
            onClick: () => {
              window.location.hash = "#/inbox";
            },
          },
          [
            el("div", { class: "grow" }, [
              el("div", { class: "small", text: headline }),
              el("div", {
                class: "tiny faint",
                text: `${accounts.length} account${accounts.length === 1 ? "" : "s"}${data.stale ? " · cached" : ""}`,
              }),
            ]),
            total.unread
              ? el("span", { class: "badge", "data-tone": "high", text: String(total.unread) })
              : null,
          ],
        ),
      ]),
    ]),
  );
}

/* ---------- Inbox screen ------------------------------------------------- */

const VIEWS = [
  { id: "important", label: "Needs you" },
  { id: "unread", label: "Unread" },
  { id: "inbox", label: "All" },
  { id: "starred", label: "Starred" },
];

/**
 * Renders the Inbox into `container`. Multiple accounts are merged into a
 * single newest-first stream, because the question is "what needs me?" — not
 * "what is in mailbox #2?".
 */
export async function renderInbox(container) {
  clear(container);

  const state = { view: "important", accounts: [], configured: false, blocked: false };

  const header = el("header", {}, [
    el("h1", { class: "page-title", text: "Inbox" }),
    el("p", { class: "page-sub", text: "The mail that needs you, across every account." }),
  ]);

  const accountsSection = el("section", { class: "section" });
  const filterRow = el("div", { class: "filters", role: "tablist" });
  const listSection = el("section", { class: "section" });
  const statusLine = el("p", { class: "tiny faint", style: "margin-top:12px" });

  container.append(header, accountsSection, filterRow, listSection, statusLine);

  const reload = async () => {
    await loadAccounts();
    await loadMessages();
  };

  /* Accounts + counts */
  async function loadAccounts() {
    clear(accountsSection);
    accountsSection.append(
      el("span", { class: "section-label", text: "Mail accounts" }),
      spinnerRow(),
    );

    // No cloud account yet — that's a setup step, not an error.
    if (!(await mail.isMailReady())) {
      clear(accountsSection);
      accountsSection.append(
        el("span", { class: "section-label", text: "Mail accounts" }),
        el("div", { class: "panel", style: "margin-top:8px" }, [
          el("div", { class: "setting" }, [
            el("div", { class: "grow" }, [
              el("div", { class: "small", text: "Cloud account required" }),
              el("div", {
                class: "tiny faint",
                text: "Gmail is read securely through the One Look backend. Sign in under More → Cloud sync, then connect your accounts here.",
              }),
            ]),
          ]),
        ]),
      );
      state.blocked = true;
      return;
    }
    state.blocked = false;

    let data;
    try {
      data = await mail.listAccounts();
    } catch (error) {
      clear(accountsSection);
      accountsSection.append(
        el("span", { class: "section-label", text: "Mail accounts" }),
        emptyState(error.offline ? "You're offline" : "Could not load accounts", error.message),
      );
      return;
    }

    state.accounts = data.accounts || [];
    state.configured = Boolean(data.configured);

    clear(accountsSection);
    accountsSection.append(
      el("span", { class: "section-label", text: "Mail accounts" }),
      accountsPanel({ accounts: state.accounts, configured: state.configured, onChanged: reload }),
    );

    if (data.stale) {
      accountsSection.append(
        el("p", {
          class: "tiny faint",
          style: "margin-top:8px",
          text: "Showing the last known accounts — you're offline.",
        }),
      );
    }

    // Live counts are a separate, non-blocking request: the list must render
    // even if Gmail is slow to answer for one mailbox.
    if (state.accounts.some((account) => account.status === "connected")) {
      mail
        .summary()
        .then((data2) => {
          const total = data2.total || {};
          statusLine.textContent = `${total.important || 0} important · ${total.unread || 0} unread across ${
            (data2.accounts || []).length
          } account(s)${data2.stale ? " (cached)" : ""}`;
        })
        .catch(() => {});
    }
  }

  /* Filters */
  const drawFilters = () => {
    clear(filterRow);
    for (const view of VIEWS) {
      filterRow.append(
        el(
          "button",
          {
            class: "filter",
            type: "button",
            role: "tab",
            "data-active": String(state.view === view.id),
            onClick: () => {
              state.view = view.id;
              drawFilters();
              loadMessages();
            },
          },
          view.label,
        ),
      );
    }
  };

  /* Messages, merged across accounts */
  async function loadMessages() {
    clear(listSection);

    // Blocked before setup: the accounts panel already explains what to do.
    if (state.blocked) {
      filterRow.hidden = true;
      return;
    }

    const connected = state.accounts.filter((account) => account.status === "connected");
    if (!connected.length) {
      filterRow.hidden = true;
      listSection.append(
        emptyState(
          state.accounts.length ? "Reconnect an account to see mail" : "No mail yet",
          state.accounts.length
            ? "Google access expired for every connected account."
            : "Connect a Gmail account above and One Look will surface what needs your attention.",
        ),
      );
      return;
    }

    filterRow.hidden = false;
    listSection.append(
      el("span", { class: "section-label", text: VIEWS.find((v) => v.id === state.view).label }),
      spinnerRow(),
    );

    const pages = await Promise.all(
      connected.map((account) =>
        mail
          .listMessages(account.id, { view: state.view })
          .then((page) => ({ ok: true, page, account }))
          .catch((error) => ({ ok: false, error, account })),
      ),
    );

    const messages = pages
      .filter((entry) => entry.ok)
      .flatMap((entry) => entry.page.messages)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    const failures = pages.filter((entry) => !entry.ok);
    const offline = pages.some((entry) => entry.ok && entry.page.stale);

    clear(listSection);
    listSection.append(
      el("span", { class: "section-label", text: VIEWS.find((v) => v.id === state.view).label }),
    );

    if (!messages.length) {
      listSection.append(
        emptyState(
          state.view === "important" ? "Nothing needs you right now" : "Nothing here",
          state.view === "important" ? "Important and unread mail will appear here first." : null,
        ),
      );
    } else {
      const list = el("div", { class: "panel mail-list", style: "margin-top:8px" });
      for (const message of messages)
        list.append(messageRow(message, { showAccount: connected.length > 1 }));
      listSection.append(list);
    }

    if (offline) {
      listSection.append(
        el("p", {
          class: "tiny faint",
          style: "margin-top:8px",
          text: "Offline — showing the last mail One Look saw.",
        }),
      );
    }

    // One failing mailbox must never hide the others.
    for (const failure of failures) {
      listSection.append(
        el("p", {
          class: "tiny faint",
          style: "margin-top:8px",
          text: `${failure.account.email}: ${failure.error.message}`,
        }),
      );
    }
  }

  drawFilters();
  await reload();
}
