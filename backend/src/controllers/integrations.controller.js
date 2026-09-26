/**
 * Google integration controller — OAuth start + callback.
 *
 * `connect` requires a One Look access token and returns an authorize URL; the
 * browser opens it. `callback` is an unauthenticated Google redirect whose
 * identity comes from the signed `state` value, never from the query string.
 */

import { config } from "../config.js";
import * as accountService from "../services/connected-account.service.js";
import * as oauth from "../services/google-oauth.service.js";
import { asyncHandler, badRequest } from "../utils/http-error.js";
import { logger } from "../utils/logger.js";
import { parse, z } from "../utils/validate.js";

const connectQuery = z.object({
  returnTo: z.string().max(500).optional(),
  loginHint: z.string().email().max(320).optional(),
});

export const status = asyncHandler(async (_req, res) => {
  res.json({
    data: {
      configured: oauth.isGoogleOAuthConfigured(),
      scopes: oauth.GOOGLE_SCOPES,
    },
  });
});

export const connect = asyncHandler(async (req, res) => {
  const input = parse(connectQuery, req.query);
  const authorizeUrl = oauth.buildAuthorizeUrl({
    userId: req.user.id,
    returnTo: input.returnTo,
    loginHint: input.loginHint,
  });
  res.json({ data: { authorizeUrl, scopes: oauth.GOOGLE_SCOPES } });
});

/** Tiny self-closing page: tells the opener the result, then closes. */
function resultPage({ ok, message, email }) {
  const payload = JSON.stringify({
    source: "onelook-google-oauth",
    ok,
    message,
    email: email || null,
  });
  const safe = String(message).replace(
    /[&<>]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch],
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>One Look</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1f24;background:#f7f8fa}
main{max-width:320px;padding:24px;text-align:center}p{color:#5b6572}</style></head>
<body><main><h1 style="font-size:17px;margin:0 0 8px">One Look</h1><p>${safe}</p></main>
<script>
  // The opener lives on the app origin, which may differ from this API origin,
  // so the target origin is explicit — never "*".
  try {
    if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(config.appOrigin || "")} || window.location.origin);
  } catch (e) {}
  setTimeout(function () { window.close(); }, ${ok ? 600 : 3500});
</script></body></html>`;
}

function html(res, code, body) {
  // This one page needs its own inline script, and it must keep window.opener
  // so it can report the result back to the app. Both are scoped to this
  // response only; the rest of the API keeps helmet's stricter defaults.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "unsafe-none");
  res.setHeader("Referrer-Policy", "no-referrer");
  // The URL contains an authorization code — never let it be cached.
  res.setHeader("Cache-Control", "no-store");
  return res.status(code).type("html").send(body);
}

export const callback = asyncHandler(async (req, res) => {
  // The user cancelled at Google's consent screen — not an error worth logging.
  if (req.query.error) {
    return html(
      res,
      200,
      resultPage({ ok: false, message: "Google sign-in was cancelled. Nothing was connected." }),
    );
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) throw badRequest("Google did not return an authorization code.");

  const { userId } = oauth.readState(req.query.state);

  let tokens;
  try {
    tokens = await oauth.exchangeCode(code);
  } catch (error) {
    logger.warn("google code exchange failed", { googleCode: error.googleCode });
    return html(
      res,
      200,
      resultPage({ ok: false, message: "Google would not complete the connection. Try again." }),
    );
  }

  const profile = await oauth.fetchUserInfo(tokens.accessToken);
  if (!profile.email) {
    return html(
      res,
      200,
      resultPage({ ok: false, message: "Google did not share an email address." }),
    );
  }

  const account = await accountService.upsertGmailAccount(userId, {
    providerAccountId: profile.sub,
    email: profile.email,
    displayName: profile.name || profile.email.split("@")[0],
    tokens,
  });

  // Never log the full address or any token.
  logger.info("gmail account connected", { userId, accountId: account.id });

  return html(
    res,
    200,
    resultPage({
      ok: true,
      email: account.email,
      message: `${account.email} connected. You can close this window.`,
    }),
  );
});
