/** POST /api/sync — push pending local records, pull server changes. */

import { Router } from "express";

import { noteInput } from "../controllers/notes.controller.js";
import { taskInput } from "../controllers/tasks.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { sync } from "../services/sync.service.js";
import { asyncHandler } from "../utils/http-error.js";
import { isoTimestamp, parse, z } from "../utils/validate.js";

export const syncRoutes = Router();

const syncSchema = z.object({
  since: z.union([isoTimestamp, z.null()]).optional(),
  tasks: z
    .array(taskInput.extend({ clientId: z.string().min(1).max(128) }))
    .max(500)
    .optional(),
  notes: z
    .array(noteInput.extend({ clientId: z.string().min(1).max(128) }))
    .max(500)
    .optional(),
});

syncRoutes.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = parse(syncSchema, req.body || {});
    res.json({ data: await sync(req.user.id, payload) });
  }),
);
