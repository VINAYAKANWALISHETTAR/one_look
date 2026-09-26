import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as controller from "../controllers/mail.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const mailRoutes = Router();

// Gmail enforces its own per-user quota; this keeps One Look well inside it.
const mailLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Slow down — too many mail requests." } },
});

mailRoutes.use(requireAuth, mailLimiter);

mailRoutes.get("/accounts", controller.listAccounts);
mailRoutes.delete("/accounts/:accountId", controller.removeAccount);

mailRoutes.get("/summary", controller.summary);
mailRoutes.get("/search", controller.search);

mailRoutes.get("/accounts/:accountId/labels", controller.listLabels);
mailRoutes.get("/accounts/:accountId/messages", controller.listMessages);
mailRoutes.get("/accounts/:accountId/messages/:messageId", controller.getMessage);
