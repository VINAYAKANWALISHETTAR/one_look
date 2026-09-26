/**
 * Mail controller — connected accounts, summaries, message lists and detail.
 *
 * Every handler runs behind requireAuth and passes `req.user.id` down, so
 * ownership is checked on every single request.
 */

import * as accountService from "../services/connected-account.service.js";
import * as gmail from "../services/gmail.service.js";
import * as oauth from "../services/google-oauth.service.js";
import { asyncHandler } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import { parse, z } from "../utils/validate.js";

const idParam = z.object({ accountId: z.string().uuid() });
const messageParams = z.object({
  accountId: z.string().uuid(),
  messageId: z.string().min(1).max(200),
});

const listQuery = z.object({
  view: z.enum(["inbox", "unread", "important", "starred", "spam", "search"]).default("inbox"),
  q: z.string().max(500).optional(),
  pageToken: z.string().max(4000).optional(),
  maxResults: z.coerce.number().int().min(5).max(30).optional(),
});

const searchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  accountId: z.string().uuid().optional(),
});

/* ---------- Accounts ---------- */

export const listAccounts = asyncHandler(async (req, res) => {
  res.json({
    data: {
      configured: oauth.isGoogleOAuthConfigured(),
      accounts: await accountService.list(req.user.id),
    },
  });
});

export const removeAccount = asyncHandler(async (req, res) => {
  const { accountId } = parse(idParam, req.params);
  const { refreshToken } = await accountService.removeOwned(req.user.id, accountId);
  // Best effort: drop the grant at Google too, so "Disconnect" really disconnects.
  await oauth.revokeToken(refreshToken);
  logger.info("gmail account disconnected", { userId: req.user.id, accountId });
  res.json({ data: { disconnected: true, accountId } });
});

/* ---------- Summary ---------- */

/** Per-account counts, plus a combined total for the dashboard signal. */
export const summary = asyncHandler(async (req, res) => {
  const accounts = await accountService.list(req.user.id);
  const results = await Promise.all(
    accounts.map(async (account) => {
      if (account.status !== "connected") {
        return {
          accountId: account.id,
          email: account.email,
          displayName: account.displayName,
          status: account.status,
          counts: null,
          error: "reauth_required",
        };
      }
      try {
        return await gmail.labelCounts(req.user.id, account.id);
      } catch (error) {
        return {
          accountId: account.id,
          email: account.email,
          displayName: account.displayName,
          status: error.code === "reauth_required" ? "reauth_required" : account.status,
          counts: null,
          error: error.code || "gmail_error",
        };
      }
    }),
  );

  const total = results.reduce(
    (acc, entry) => ({
      unread: acc.unread + (entry.counts?.unread || 0),
      important: acc.important + (entry.counts?.important || 0),
      inbox: acc.inbox + (entry.counts?.inbox || 0),
    }),
    { unread: 0, important: 0, inbox: 0 },
  );

  res.json({ data: { accounts: results, total, needsAttention: total.important || total.unread } });
});

/* ---------- Messages ---------- */

export const listMessages = asyncHandler(async (req, res) => {
  const { accountId } = parse(idParam, req.params);
  const input = parse(listQuery, req.query);
  res.json({ data: await gmail.listMessages(req.user.id, accountId, input) });
});

export const getMessage = asyncHandler(async (req, res) => {
  const { accountId, messageId } = parse(messageParams, req.params);
  res.json({ data: await gmail.getMessage(req.user.id, accountId, messageId) });
});

export const listLabels = asyncHandler(async (req, res) => {
  const { accountId } = parse(idParam, req.params);
  res.json({ data: { accountId, labels: await gmail.listLabels(req.user.id, accountId) } });
});

/**
 * Unified search across every connected account. Gmail's own query engine does
 * the work per account; results are merged newest-first. One failing account
 * never blocks the others.
 */
export const search = asyncHandler(async (req, res) => {
  const input = parse(searchQuery, req.query);
  const all = await accountService.list(req.user.id);
  const targets = all.filter(
    (account) =>
      account.status === "connected" && (!input.accountId || account.id === input.accountId),
  );

  const pages = await Promise.all(
    targets.map((account) =>
      gmail
        .listMessages(req.user.id, account.id, {
          view: "search",
          q: input.q,
          maxResults: Math.max(input.limit || 10, 5),
        })
        .then((page) => page.messages)
        .catch(() => []),
    ),
  );

  const messages = pages
    .flat()
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .slice(0, input.limit || 10);

  res.json({ data: { query: input.q, accountsSearched: targets.length, messages } });
});
