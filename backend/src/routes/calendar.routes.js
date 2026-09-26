import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as controller from "../controllers/calendar.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const calendarRoutes = Router();

// One dashboard render fans out to a few calendars; this keeps One Look well
// inside Google's per-user quota even with several accounts connected.
const calendarLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Slow down — too many calendar requests." } },
});

calendarRoutes.use(requireAuth, calendarLimiter);

calendarRoutes.get("/events", controller.listEvents);
calendarRoutes.get("/search", controller.search);
calendarRoutes.get("/accounts/:accountId/calendars", controller.listCalendars);
