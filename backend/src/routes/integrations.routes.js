import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as controller from "../controllers/integrations.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const integrationRoutes = Router();

// Starting an OAuth flow is cheap but should not be loopable.
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: { code: "rate_limited", message: "Too many connection attempts. Try again later." },
  },
});

integrationRoutes.get("/google/status", controller.status);

// Requires a One Look session: the authorize URL is bound to req.user.id.
integrationRoutes.get("/google/connect", requireAuth, oauthLimiter, controller.connect);

// Google redirects the browser here. Unauthenticated by necessity — identity
// comes from the signed `state` parameter.
integrationRoutes.get("/google/callback", oauthLimiter, controller.callback);
