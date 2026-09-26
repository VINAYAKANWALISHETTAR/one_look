/**
 * Gmail API service — the ONLY place in the backend that talks to Gmail.
 *
 * Responsibilities: build an authenticated client for a connected account,
 * refresh the access token when it expires, list/query messages, read message
 * metadata and content, read label counts, and translate Google failures into
 * HttpErrors the UI can act on ("Reconnect Gmail" rather than a crash).
 *
 * Read-only: no send, no delete, no label modification.
 *
 * Privacy: message bodies, addresses and tokens are never logged, and nothing
 * here writes mailbox content to PostgreSQL. Gmail stays the source of truth.
 */

import { badRequest } from "../utils/http-error.js";
import * as accounts from "./connected-account.service.js";
import { googleClient } from "./google-client.service.js";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const SUMMARY_LABELS = ["INBOX", "UNREAD", "IMPORTANT", "SPAM", "STARRED"];

/**
 * Authenticated Gmail client for one account. Token refresh, ownership checks
 * and Google error translation all live in google-client.service.js, shared
 * with Google Calendar.
 */
export async function clientForAccount(userId, accountId) {
  return googleClient(userId, accountId, {
    baseUrl: GMAIL_BASE,
    label: "Gmail",
    scope: GMAIL_SCOPE,
  });
}


/* ---------- Labels & summary ---------- */

export async function labelCounts(userId, accountId) {
  const { account, call } = await clientForAccount(userId, accountId);
  const results = await Promise.all(
    SUMMARY_LABELS.map(
      (id) => call(`/labels/${id}`).catch(() => null), // a mailbox may not expose every system label
    ),
  );

  const byId = {};
  results.forEach((label, index) => {
    if (label) byId[SUMMARY_LABELS[index]] = label;
  });

  await accounts.touchSynced(accountId);

  return {
    accountId,
    email: account.email,
    displayName: account.displayName,
    status: account.status,
    counts: {
      inbox: byId.INBOX?.messagesTotal ?? 0,
      // Unread that actually sits in the inbox — the number the user cares about.
      unread: byId.INBOX?.messagesUnread ?? byId.UNREAD?.messagesTotal ?? 0,
      important: byId.IMPORTANT?.messagesUnread ?? 0,
      spam: byId.SPAM?.messagesTotal ?? 0,
      starred: byId.STARRED?.messagesTotal ?? 0,
    },
  };
}

export async function listLabels(userId, accountId) {
  const { call } = await clientForAccount(userId, accountId);
  const data = await call("/labels");
  return (data.labels || []).map((label) => ({ id: label.id, name: label.name, type: label.type }));
}

/* ---------- Messages ---------- */

const header = (headers, name) =>
  headers?.find((entry) => entry.name?.toLowerCase() === name.toLowerCase())?.value || "";

/** Splits `Display Name <addr@example.com>` without losing either half. */
function parseAddress(raw) {
  const match = String(raw || "").match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "") || match[2], email: match[2] };
  const value = String(raw || "").trim();
  return { name: value, email: value };
}

/**
 * Metadata-only row. Everything a later phase needs to identify LinkedIn (or
 * any other) notification mail is preserved: id, threadId, accountId, sender
 * address, subject, snippet, date and labelIds.
 */
function toListItem(message, account) {
  const headers = message.payload?.headers || [];
  const from = parseAddress(header(headers, "From"));
  const labelIds = message.labelIds || [];
  return {
    id: message.id,
    threadId: message.threadId,
    accountId: account.id,
    accountEmail: account.email,
    accountLabel: account.displayName,
    from,
    subject: header(headers, "Subject") || "(no subject)",
    snippet: message.snippet || "",
    date: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    labelIds,
    unread: labelIds.includes("UNREAD"),
    important: labelIds.includes("IMPORTANT"),
    starred: labelIds.includes("STARRED"),
    spam: labelIds.includes("SPAM"),
  };
}

/**
 * One page of messages for one account. `maxResults` is clamped so a caller can
 * never trigger a mailbox-wide download, and page tokens are passed through to
 * Gmail rather than re-implemented.
 */
export async function listMessages(
  userId,
  accountId,
  { view = "inbox", q = "", pageToken = "", maxResults = 25 } = {},
) {
  const { account, call } = await clientForAccount(userId, accountId);
  const limit = Math.min(Math.max(Number(maxResults) || 25, 5), 30);

  const views = {
    inbox: { labelIds: ["INBOX"] },
    unread: { labelIds: ["INBOX", "UNREAD"] },
    important: { labelIds: ["IMPORTANT"] },
    starred: { labelIds: ["STARRED"] },
    spam: { labelIds: ["SPAM"] },
    search: {},
  };
  const selector = views[view];
  if (!selector) throw badRequest("Unknown mail view.");

  const page = await call("/messages", {
    maxResults: limit,
    pageToken: pageToken || undefined,
    // Gmail's own query engine does the searching — we never pull the mailbox
    // down to filter locally.
    q: q || undefined,
    labelIds: selector.labelIds,
    // Spam/trash are only included when that is the view being asked for.
    includeSpamTrash: view === "spam" || undefined,
  });

  const ids = (page.messages || []).map((entry) => entry.id);
  const messages = await Promise.all(
    ids.map((id) =>
      call(`/messages/${id}`, {
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date", "To"],
      }).catch(() => null),
    ),
  );

  await accounts.touchSynced(accountId);

  return {
    accountId,
    view,
    messages: messages.filter(Boolean).map((message) => toListItem(message, account)),
    nextPageToken: page.nextPageToken || null,
    estimatedTotal: page.resultSizeEstimate ?? null,
  };
}

/* ---------- Message detail ---------- */

const decodeBody = (data) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

/** Walks the MIME tree collecting the plain-text and HTML alternatives. */
function collectBodies(part, out = { text: "", html: "", attachments: [] }) {
  if (!part) return out;
  const mime = part.mimeType || "";
  if (mime === "text/plain" && part.body?.data) out.text += decodeBody(part.body.data);
  else if (mime === "text/html" && part.body?.data) out.html += decodeBody(part.body.data);
  else if (part.filename && part.body?.attachmentId) {
    out.attachments.push({ filename: part.filename, mimeType: mime, size: part.body.size ?? null });
  }
  for (const child of part.parts || []) collectBodies(child, out);
  return out;
}

export async function getMessage(userId, accountId, messageId) {
  const { account, call } = await clientForAccount(userId, accountId);
  const message = await call(`/messages/${messageId}`, { format: "full" });

  const headers = message.payload?.headers || [];
  const bodies = collectBodies(message.payload);
  const base = toListItem(message, account);

  return {
    ...base,
    to: header(headers, "To"),
    cc: header(headers, "Cc"),
    replyTo: header(headers, "Reply-To"),
    // Both alternatives are returned; the client decides what is safe to show.
    bodyText: bodies.text.slice(0, 200_000),
    bodyHtml: bodies.html.slice(0, 400_000),
    attachments: bodies.attachments,
    // Deep link into the real Gmail UI for the right account.
    gmailUrl: `https://mail.google.com/mail/u/${encodeURIComponent(account.email)}/#all/${encodeURIComponent(message.id)}`,
  };
}
