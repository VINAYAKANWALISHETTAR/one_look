/**
 * Express application wiring. Security middleware first, then routes, then
 * the 404 handler and the centralized error handler last.
 */

import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

import { config, isProduction } from "./config.js";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware.js";
import { authRoutes } from "./routes/auth.routes.js";
import { calendarRoutes } from "./routes/calendar.routes.js";
import { healthRoutes } from "./routes/health.routes.js";
import { integrationRoutes } from "./routes/integrations.routes.js";
import { mailRoutes } from "./routes/mail.routes.js";
import { noteRoutes } from "./routes/notes.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";
import { taskRoutes } from "./routes/tasks.routes.js";

import { requestLogger } from "./utils/logger.js";

export function createApp() {
  const app = express();

  // Behind App Runner / CloudFront the client IP arrives in X-Forwarded-For.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/native callers send no Origin header.
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        // Any localhost port is fine while developing; production is explicit.
        if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS"));
      },
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }),
  );

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(requestLogger);

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: { code: "rate_limited", message: "Too many requests." } },
    }),
  );

  app.use("/api/health", healthRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/notes", noteRoutes);
  app.use("/api/sync", syncRoutes);
  app.use("/api/integrations", integrationRoutes);
  app.use("/api/mail", mailRoutes);
  app.use("/api/calendar", calendarRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
