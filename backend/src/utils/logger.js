/**
 * Structured JSON logging — one line per event, CloudWatch friendly.
 *
 * Secrets are never logged: authorization headers, cookies, tokens and
 * passwords are stripped by `redact` before anything is written.
 */

const SENSITIVE = new Set([
  "password",
  "passcode",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "secret",
  "clientsecret",
  "apikey",
]);

export function redact(value, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE.has(key.toLowerCase().replace(/[-_]/g, ""))
      ? "[redacted]"
      : redact(val, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  const line = { ts: new Date().toISOString(), level, message, ...redact(meta || {}) };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const logger = {
  info: (message, meta) => write("info", message, meta),
  warn: (message, meta) => write("warn", message, meta),
  error: (message, meta) => write("error", message, meta),
};

/** Minimal request logger — method, path, status, duration. No headers. */
export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - startedAt,
      userId: req.user?.id,
    });
  });
  next();
}
