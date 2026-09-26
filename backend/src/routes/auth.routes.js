import { Router } from "express";
import rateLimit from "express-rate-limit";

import * as controller from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const authRoutes = Router();

// Credential endpoints are the ones worth brute-forcing, so they get their own
// tighter limiter on top of the global one.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many attempts. Try again later." } },
});

authRoutes.post("/register", credentialLimiter, controller.register);
authRoutes.post("/login", credentialLimiter, controller.login);
authRoutes.post("/refresh", credentialLimiter, controller.refresh);
authRoutes.post("/logout", controller.logout);
authRoutes.get("/me", requireAuth, controller.me);

// Phase 5 seam: POST /api/auth/google will verify a Google id token on the
// server and call authService.upsertGoogleUser. Not implemented in Phase 4.
