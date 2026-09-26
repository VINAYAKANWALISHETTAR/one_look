/** Notes controller — text-only notes for the authenticated user. */

import * as noteService from "../services/note.service.js";
import { asyncHandler } from "../utils/http-error.js";
import { isoTimestamp, parse, uuid, z } from "../utils/validate.js";

export const noteInput = z.object({
  clientId: z.string().min(1).max(128).optional(),
  content: z.string().trim().min(1, "A note needs some text.").max(10000),
  createdAt: isoTimestamp.optional(),
  updatedAt: isoTimestamp.optional(),
  deletedAt: z.union([isoTimestamp, z.null()]).optional(),
});

const patchInput = noteInput.partial().omit({ clientId: true });

export const list = asyncHandler(async (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : null;
  res.json({ data: await noteService.list(req.user.id, { since }) });
});

export const getOne = asyncHandler(async (req, res) => {
  res.json({ data: await noteService.getById(req.user.id, parse(uuid, req.params.id)) });
});

export const create = asyncHandler(async (req, res) => {
  res.status(201).json({ data: await noteService.upsert(req.user.id, parse(noteInput, req.body)) });
});

export const update = asyncHandler(async (req, res) => {
  const id = parse(uuid, req.params.id);
  res.json({ data: await noteService.patch(req.user.id, id, parse(patchInput, req.body)) });
});

export const remove = asyncHandler(async (req, res) => {
  res.json({ data: await noteService.softDelete(req.user.id, parse(uuid, req.params.id)) });
});
