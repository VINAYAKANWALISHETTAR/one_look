/**
 * Calendar controller — read-only Google Calendar across connected accounts.
 *
 * Every handler runs behind requireAuth and passes `req.user.id` down, so
 * ownership is checked on every request. Time windows are computed from the
 * client's own day boundaries (sent as ISO timestamps) so a user in any time
 * zone sees their real "today".
 */

import * as accountService from "../services/connected-account.service.js";
import * as calendar from "../services/calendar.service.js";
import * as oauth from "../services/google-oauth.service.js";
import { asyncHandler } from "../utils/http-error.js";
import { parse, z } from "../utils/validate.js";

const idParam = z.object({ accountId: z.string().uuid() });

const windowQuery = z.object({
  timeMin: z.string().datetime({ offset: true }).optional(),
  timeMax: z.string().datetime({ offset: true }).optional(),
  days: z.coerce.number().int().min(1).max(31).optional(),
  maxResults: z.coerce.number().int().min(1).max(50).optional(),
});

const searchQuery = z.object({
  q: z.string().trim().min(1).max(300),
  limit: z.coerce.number().int().min(1).max(25).optional(),
});

const connectedAccounts = (userId) =>
  accountService.list(userId).then((rows) => rows.filter((row) => row.provider === "gmail"));

/** GET /api/calendar/accounts/:accountId/calendars */
export const listCalendars = asyncHandler(async (req, res) => {
  const { accountId } = parse(idParam, req.params);
  res.json({
    data: { accountId, calendars: await calendar.listCalendars(req.user.id, accountId) },
  });
});

/**
 * GET /api/calendar/events — merged events in a window.
 * Defaults to now → +7 days when the client sends nothing.
 */
export const listEvents = asyncHandler(async (req, res) => {
  const input = parse(windowQuery, req.query);
  const accounts = await connectedAccounts(req.user.id);

  const timeMin = input.timeMin || new Date().toISOString();
  const timeMax =
    input.timeMax ||
    new Date(Date.now() + (input.days || 7) * 24 * 60 * 60 * 1000).toISOString();

  const result = await calendar.listEvents(req.user.id, accounts, {
    timeMin,
    timeMax,
    maxResults: input.maxResults || 25,
  });

  res.json({
    data: {
      configured: oauth.isGoogleOAuthConfigured(),
      window: { timeMin, timeMax },
      accountsConnected: accounts.length,
      ...result,
    },
  });
});

/** GET /api/calendar/search?q= — searches every readable calendar. */
export const search = asyncHandler(async (req, res) => {
  const input = parse(searchQuery, req.query);
  const accounts = await connectedAccounts(req.user.id);

  // A calendar search is only useful over a bounded range; a year back and a
  // year forward covers everything a personal assistant needs.
  const year = 365 * 24 * 60 * 60 * 1000;
  const result = await calendar.listEvents(req.user.id, accounts, {
    timeMin: new Date(Date.now() - year).toISOString(),
    timeMax: new Date(Date.now() + year).toISOString(),
    q: input.q,
    maxResults: 25,
  });

  res.json({
    data: {
      query: input.q,
      accountsSearched: result.accountsRead,
      events: result.events.slice(0, input.limit || 15),
      accounts: result.accounts,
    },
  });
});
