/** Tasks controller. `req.user.id` comes from the verified access token. */

import * as taskService from "../services/task.service.js";
import { asyncHandler } from "../utils/http-error.js";
import { clockTime, isoDate, isoTimestamp, parse, uuid, z } from "../utils/validate.js";

export const taskInput = z.object({
  clientId: z.string().min(1).max(128).optional(),
  title: z.string().trim().min(1, "A task needs a title.").max(200),
  description: z.string().max(2000).optional(),
  date: isoDate,
  time: z.union([clockTime, z.literal("")]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["pending", "completed"]).optional(),
  reminderOffset: z.enum(["none", "at", "5", "10", "15", "30", "60", "1440", "custom"]).optional(),
  reminderAt: z.union([isoTimestamp, z.null()]).optional(),
  completedAt: z.union([isoTimestamp, z.null()]).optional(),
  createdAt: isoTimestamp.optional(),
  updatedAt: isoTimestamp.optional(),
  deletedAt: z.union([isoTimestamp, z.null()]).optional(),
});

const patchInput = taskInput.partial().omit({ clientId: true });

export const list = asyncHandler(async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : null;
  res.json({ data: await taskService.list(req.user.id, { since }) });
});

export const getOne = asyncHandler(async (req, res) => {
  const id = parse(uuid, req.params.id);
  res.json({ data: await taskService.getById(req.user.id, id) });
});

export const create = asyncHandler(async (req, res) => {
  const input = parse(taskInput, req.body);
  res.status(201).json({ data: await taskService.upsert(req.user.id, input) });
});

export const update = asyncHandler(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const input = parse(patchInput, req.body);
  res.json({ data: await taskService.patch(req.user.id, id, input) });
});

export const remove = asyncHandler(async (req, res) => {
  const id = parse(uuid, req.params.id);
  res.json({ data: await taskService.softDelete(req.user.id, id) });
});
