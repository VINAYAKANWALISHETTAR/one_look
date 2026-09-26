/** Auth controller — HTTP shape only; identity rules live in auth.service. */

import * as authService from "../services/auth.service.js";
import { asyncHandler, unauthorized } from "../utils/http-error.js";
import { parse, z } from "../utils/validate.js";

const credentials = z.object({
  email: z.string().trim().min(3).max(255).email(),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

const registerSchema = credentials.extend({
  displayName: z.string().trim().min(2, "Enter your name.").max(80),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10).max(400) });

export const register = asyncHandler(async (req, res) => {
  const input = parse(registerSchema, req.body);
  res.status(201).json({ data: await authService.register(input) });
});

export const login = asyncHandler(async (req, res) => {
  const input = parse(credentials, req.body);
  res.json({ data: await authService.login(input) });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = parse(refreshSchema, req.body);
  res.json({ data: await authService.refresh(refreshToken) });
});

export const logout = asyncHandler(async (req, res) => {
  const body = req.body || {};
  await authService.logout(typeof body.refreshToken === "string" ? body.refreshToken : null);
  res.status(204).end();
});

/** The only source of "who am I" — read from the verified token, never input. */
export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  if (!user) throw unauthorized();
  res.json({ data: user });
});
