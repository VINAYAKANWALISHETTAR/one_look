/**
 * Local API smoke test — `node test/api.test.js` with the server running.
 *
 * Covers: health, auth, validation, unknown routes, task/note CRUD, user
 * isolation, and the sync push/pull/tombstone/conflict paths.
 */

const BASE = process.env.API_URL || "http://127.0.0.1:4000/api";

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}

async function call(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  console.log("\nHEALTH & ROUTING");
  const health = await call("/health");
  check("GET /api/health → 200 status ok", health.status === 200 && health.body.status === "ok", health.body);
  check("health reports database up", health.body?.database === "up", health.body);
  const unknown = await call("/nope");
  check("unknown route → 404 json", unknown.status === 404 && unknown.body.error.code === "not_found", unknown.body);

  console.log("\nAUTH");
  const emailA = `a-${unique()}@example.com`;
  const emailB = `b-${unique()}@example.com`;

  const badInput = await call("/auth/register", { method: "POST", body: { email: "nope", password: "x" } });
  check("register invalid input → 400 with details", badInput.status === 400 && Array.isArray(badInput.body.error.details), badInput.body);

  const regA = await call("/auth/register", {
    method: "POST",
    body: { email: emailA, password: "correct horse battery", displayName: "User A" },
  });
  check("register → 201 with tokens", regA.status === 201 && Boolean(regA.body.data.accessToken), regA.body);
  check("register never returns a password hash", !JSON.stringify(regA.body).toLowerCase().includes("scrypt"), null);

  const dupe = await call("/auth/register", {
    method: "POST",
    body: { email: emailA, password: "correct horse battery", displayName: "User A" },
  });
  check("duplicate email → 409", dupe.status === 409, dupe.body);

  const wrongPassword = await call("/auth/login", { method: "POST", body: { email: emailA, password: "wrong password!" } });
  check("wrong password → 401", wrongPassword.status === 401, wrongPassword.body);

  const loginA = await call("/auth/login", { method: "POST", body: { email: emailA, password: "correct horse battery" } });
  check("login → 200 with tokens", loginA.status === 200 && Boolean(loginA.body.data.accessToken), loginA.body);

  const tokenA = loginA.body.data.accessToken;
  const me = await call("/auth/me", { token: tokenA });
  check("GET /auth/me → identity from token", me.status === 200 && me.body.data.email === emailA, me.body);

  const noToken = await call("/tasks");
  check("tasks without token → 401", noToken.status === 401, noToken.body);
  const badToken = await call("/tasks", { token: "not.a.jwt" });
  check("tasks with bad token → 401", badToken.status === 401, badToken.body);

  const refreshed = await call("/auth/refresh", { method: "POST", body: { refreshToken: loginA.body.data.refreshToken } });
  check("refresh → new access token", refreshed.status === 200 && Boolean(refreshed.body.data.accessToken), refreshed.body);
  const reused = await call("/auth/refresh", { method: "POST", body: { refreshToken: loginA.body.data.refreshToken } });
  check("refresh token rotation: reuse rejected", reused.status === 401, reused.body);

  const regB = await call("/auth/register", {
    method: "POST",
    body: { email: emailB, password: "another good passphrase", displayName: "User B" },
  });
  const tokenB = regB.body.data.accessToken;

  console.log("\nTASKS CRUD");
  const created = await call("/tasks", {
    method: "POST",
    token: tokenA,
    body: { clientId: `task_${unique()}`, title: "Ship Phase 4", date: "2026-08-10", time: "09:30", priority: "high" },
  });
  check("POST /tasks → 201", created.status === 201 && created.body.data.title === "Ship Phase 4", created.body);
  const taskId = created.body.data?.id;

  const invalidTask = await call("/tasks", { method: "POST", token: tokenA, body: { title: "", date: "10-08-2026" } });
  check("POST /tasks invalid → 400", invalidTask.status === 400, invalidTask.body);

  const read = await call(`/tasks/${taskId}`, { token: tokenA });
  check("GET /tasks/:id → 200", read.status === 200 && read.body.data.id === taskId, read.body);

  const patched = await call(`/tasks/${taskId}`, { method: "PATCH", token: tokenA, body: { status: "completed" } });
  check("PATCH /tasks/:id → status updated", patched.status === 200 && patched.body.data.status === "completed", patched.body);

  const listA = await call("/tasks", { token: tokenA });
  check("GET /tasks lists the task", listA.status === 200 && listA.body.data.some((t) => t.id === taskId), listA.body);

  console.log("\nUSER ISOLATION");
  const crossRead = await call(`/tasks/${taskId}`, { token: tokenB });
  check("user B cannot read user A's task → 404", crossRead.status === 404, crossRead.body);
  const crossPatch = await call(`/tasks/${taskId}`, { method: "PATCH", token: tokenB, body: { title: "hijacked" } });
  check("user B cannot patch user A's task → 404", crossPatch.status === 404, crossPatch.body);
  const crossDelete = await call(`/tasks/${taskId}`, { method: "DELETE", token: tokenB });
  check("user B cannot delete user A's task → 404", crossDelete.status === 404, crossDelete.body);
  const listB = await call("/tasks", { token: tokenB });
  check("user B's list is empty", listB.status === 200 && listB.body.data.length === 0, listB.body);

  console.log("\nNOTES CRUD");
  const note = await call("/notes", { method: "POST", token: tokenA, body: { clientId: `note_${unique()}`, content: "Backend notes" } });
  check("POST /notes → 201", note.status === 201, note.body);
  const noteId = note.body.data?.id;
  const notePatch = await call(`/notes/${noteId}`, { method: "PATCH", token: tokenA, body: { content: "Backend notes v2" } });
  check("PATCH /notes/:id", notePatch.status === 200 && notePatch.body.data.content === "Backend notes v2", notePatch.body);
  const noteCross = await call(`/notes/${noteId}`, { token: tokenB });
  check("user B cannot read user A's note → 404", noteCross.status === 404, noteCross.body);
  const noteDelete = await call(`/notes/${noteId}`, { method: "DELETE", token: tokenA });
  check("DELETE /notes/:id tombstones", noteDelete.status === 200 && Boolean(noteDelete.body.data.deletedAt), noteDelete.body);
  const notesAfter = await call("/notes", { token: tokenA });
  check("deleted note hidden from list", !notesAfter.body.data.some((n) => n.id === noteId), notesAfter.body);

  console.log("\nSYNC");
  const offlineTaskId = `task_${unique()}`;
  const offlineNoteId = `note_${unique()}`;
  const push = await call("/sync", {
    method: "POST",
    token: tokenB,
    body: {
      since: null,
      tasks: [
        {
          clientId: offlineTaskId,
          title: "Created offline",
          date: "2026-08-11",
          time: "08:00",
          priority: "medium",
          status: "pending",
          updatedAt: new Date().toISOString(),
        },
      ],
      notes: [{ clientId: offlineNoteId, content: "Note created offline", updatedAt: new Date().toISOString() }],
    },
  });
  check("sync push accepts offline records", push.status === 200 && push.body.data.tasks.applied.length === 1 && push.body.data.notes.applied.length === 1, push.body);
  const watermark = push.body.data?.serverTime;

  const replay = await call("/sync", {
    method: "POST",
    token: tokenB,
    body: {
      since: watermark,
      tasks: [{ clientId: offlineTaskId, title: "Created offline", date: "2026-08-11", time: "08:00", updatedAt: new Date().toISOString() }],
    },
  });
  const bTasks = await call("/tasks", { token: tokenB });
  check("replayed push does not duplicate", replay.status === 200 && bTasks.body.data.filter((t) => t.clientId === offlineTaskId).length === 1, bTasks.body);

  const editPush = await call("/sync", {
    method: "POST",
    token: tokenB,
    body: {
      since: replay.body.data.serverTime,
      tasks: [
        {
          clientId: offlineTaskId,
          title: "Edited offline",
          date: "2026-08-11",
          time: "08:00",
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        },
      ],
    },
  });
  check("offline edit syncs", editPush.status === 200 && editPush.body.data.tasks.applied.length === 1, editPush.body);
  const afterEdit = await call("/tasks", { token: tokenB });
  check("edit persisted in PostgreSQL", afterEdit.body.data.find((t) => t.clientId === offlineTaskId)?.title === "Edited offline", afterEdit.body);

  const conflict = await call("/sync", {
    method: "POST",
    token: tokenB,
    body: {
      // Stale watermark + older local change → both sides changed.
      since: new Date(Date.now() - 3_600_000).toISOString(),
      tasks: [
        {
          clientId: offlineTaskId,
          title: "Stale local edit",
          date: "2026-08-11",
          updatedAt: new Date(Date.now() - 7_200_000).toISOString(),
        },
      ],
    },
  });
  check("conflict detected, server version returned", conflict.status === 200 && conflict.body.data.tasks.conflicts.length === 1, conflict.body);
  const afterConflict = await call("/tasks", { token: tokenB });
  check("conflict did not overwrite server data", afterConflict.body.data.find((t) => t.clientId === offlineTaskId)?.title === "Edited offline", afterConflict.body);

  const tombstonePush = await call("/sync", {
    method: "POST",
    token: tokenB,
    body: {
      since: conflict.body.data.serverTime,
      tasks: [
        {
          clientId: offlineTaskId,
          title: "Edited offline",
          date: "2026-08-11",
          updatedAt: new Date(Date.now() + 5000).toISOString(),
          deletedAt: new Date(Date.now() + 5000).toISOString(),
        },
      ],
    },
  });
  const afterTombstone = await call("/tasks", { token: tokenB });
  check("offline delete syncs as tombstone", tombstonePush.status === 200 && !afterTombstone.body.data.some((t) => t.clientId === offlineTaskId), afterTombstone.body);

  const pull = await call("/sync", { method: "POST", token: tokenA, body: { since: null } });
  check("pull returns server changes including tombstones", pull.status === 200 && pull.body.data.notes.changed.some((n) => n.deletedAt), pull.body.data.notes);

  console.log("\nMISC");
  const tooLarge = await call("/notes", { method: "POST", token: tokenA, body: { content: "x".repeat(20000) } });
  check("oversized note rejected", tooLarge.status === 400 || tooLarge.status === 413, tooLarge.body);
  const badUuid = await call("/tasks/not-a-uuid", { token: tokenA });
  check("non-uuid id → 400", badUuid.status === 400, badUuid.body);

  /* ---------------- Phase 5: Google OAuth + Gmail ---------------- */
  console.log("\nGOOGLE OAUTH SURFACE");
  const gStatus = await call("/integrations/google/status");
  check(
    "google status reports read-only scopes",
    gStatus.status === 200 &&
      gStatus.body.data.scopes.includes("https://www.googleapis.com/auth/gmail.readonly") &&
      !gStatus.body.data.scopes.some((s) => /gmail\.(send|modify|compose)|mail\.google\.com/.test(s)),
    gStatus.body,
  );
  const connectAnon = await call("/integrations/google/connect");
  check("connect requires a One Look session", connectAnon.status === 401, connectAnon.body);
  const badState = await call("/integrations/google/callback?code=abc&state=forged");
  check("callback rejects a forged state", badState.status === 401, { status: badState.status });
  const cancelled = await call("/integrations/google/callback?error=access_denied");
  check("callback handles a cancelled consent", cancelled.status === 200, { status: cancelled.status });

  console.log("\nMAIL ACCOUNTS");
  const anonAccounts = await call("/mail/accounts");
  check("mail requires auth", anonAccounts.status === 401, anonAccounts.body);
  const accounts = await call("/mail/accounts", { token: tokenA });
  check(
    "accounts list starts empty and never leaks tokens",
    accounts.status === 200 &&
      Array.isArray(accounts.body.data.accounts) &&
      !JSON.stringify(accounts.body).match(/token/i),
    accounts.body,
  );
  const mailSummary = await call("/mail/summary", { token: tokenA });
  check(
    "summary works with zero connected accounts",
    mailSummary.status === 200 && mailSummary.body.data.total.unread === 0,
    mailSummary.body,
  );
  const strangerAccount = await call(`/mail/accounts/${crypto.randomUUID()}/messages`, { token: tokenA });
  check("unknown account id → 404, not another user's mail", strangerAccount.status === 404, strangerAccount.body);
  const badView = await call(`/mail/accounts/${crypto.randomUUID()}/messages?view=deleteEverything`, { token: tokenA });
  check("unknown mail view rejected", badView.status === 400, badView.body);
  const emptySearch = await call("/mail/search?q=", { token: tokenA });
  check("empty mail search rejected", emptySearch.status === 400, emptySearch.body);
  const okSearch = await call("/mail/search?q=linkedin", { token: tokenA });
  check(
    "mail search returns empty results with no accounts",
    okSearch.status === 200 && okSearch.body.data.messages.length === 0,
    okSearch.body,
  );

  console.log("\nTOKEN ENCRYPTION AT REST");
  const { encryptToken, decryptToken } = await import("../src/services/token-crypto.service.js");
  const secretish = "ya29.a0AfB_fake_access_token_value";
  const sealed = encryptToken(secretish);
  check("encrypted token is not the plaintext", sealed !== secretish && !sealed.includes("ya29"), { sealed });
  check("encrypted token round-trips", decryptToken(sealed) === secretish);
  check("encrypting twice yields different ciphertext (random IV)", encryptToken(secretish) !== sealed);
  let tamperFailed = false;
  try {
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered-ciphertext").toString("base64url");
    decryptToken(parts.join("."));
  } catch {
    tamperFailed = true;
  }
  check("tampered ciphertext is rejected (GCM auth tag)", tamperFailed);
  check("null token stays null", encryptToken(null) === null && decryptToken(null) === null);


  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
