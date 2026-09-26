/**
 * Centralized error handling. Clients get a stable shape and no internals:
 * SQL text, stack traces and driver details never leave the server.
 */

import { isProduction } from "../config.js";
import { HttpError } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";

export function notFoundHandler(req, res) {
  res
    .status(404)
    .json({ error: { code: "not_found", message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(error, req, res, _next) {
  const isHttp = error instanceof HttpError;
  const status = isHttp ? error.status : mapDbError(error);

  if (status >= 500) {
    logger.error("unhandled error", {
      path: req.path,
      method: req.method,
      error: error.message,
      stack: error.stack,
    });
  } else {
    logger.warn("request rejected", {
      path: req.path,
      method: req.method,
      status,
      code: error.code,
    });
  }

  const body = {
    error: {
      code: isHttp ? error.code : status === 400 ? "bad_request" : "server_error",
      message:
        status >= 500 && isProduction
          ? "Something went wrong."
          : isHttp
            ? error.message
            : safeMessage(error, status),
    },
  };
  if (isHttp && error.details) body.error.details = error.details;
  res.status(status).json(body);
}

function mapDbError(error) {
  switch (error.code) {
    case "23505": // exclusion violation
    case "23514": // check constraint
    case "22P02": // invalid text representation
      return 400;
    case "23503": // foreign key
      return 400;
    case "23205":
      return 409;
    default:
      return error.type === "entity.too.large" ? 413 : 500;
  }
}

function safeMessage(error, status) {
  if (status === 413) return "Request body too large.";
  if (status === 400) return "Invalid request.";
  return error.message || "Something went wrong.";
}
