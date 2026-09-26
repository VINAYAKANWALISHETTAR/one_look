/**
 * Authentication middleware.
 *
 * Identity comes ONLY from the Bearer access token's verified signature.
 * A userId in the body, query string or a client-supplied email is ignored.
 */

import { verifyAccessToken } from "../services/auth.service.js";
import { unauthorized } from "../utils/http-error.js";

export function requireAuth(req, _res, next) {
  try {
    const header = req.get("authorization") || "";
    const [scheme, token] = header.split(" ");
    if (!token || scheme.toLowerCase() !== "bearer") throw unauthorized();
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, email: claims.email };
    next();
  } catch (error) {
    next(error);
  }
}
