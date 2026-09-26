/** GET /api/health — used locally and by AWS App Runner health checks. */

import { Router } from "express";

import { ping } from "../db/database.js";
import { asyncHandler } from "../utils/http-error.js";

export const healthRoutes = Router();

healthRoutes.get(
  "/",
  asyncHandler(async (_req, res) => {
    let database = "down";
    let latencyMs = null;
    try {
      latencyMs = await ping();
      database = "up";
    } catch {
      database = "down";
    }
    res.status(database === "up" ? 200 : 503).json({
      status: database === "up" ? "ok" : "degraded",
      database,
      latencyMs,
      uptimeSeconds: Math.round(process.uptime()),
    });
  }),
);
