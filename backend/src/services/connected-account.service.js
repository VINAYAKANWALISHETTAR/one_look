/**
 * Connected mail accounts — ownership is enforced here, once.
 *
 * Every read/write is scoped by `user_id`, so a caller can never reach another
 * One Look user's Gmail connection even by guessing an account id.
 *
 * `publicAccount` is the ONLY shape that leaves the backend: id, email,
 * display name, provider, status, scopes and sync metadata. Access and refresh
 * tokens never appear in an API response.
 */

import { query } from "../db/database.js";
import { notFound } from "../utils/http-error.js";
import { decryptToken, encryptToken } from "./token-crypto.service.js";

export const publicAccount = (row) => ({
  id: row.id,
  provider: row.provider,
  email: row.email_address,
  displayName: row.display_name || row.email_address,
  status: row.status,
  statusDetail: row.status_detail || null,
  scopes: row.scopes || [],
  lastSyncAt: row.last_sync_at,
  createdAt: row.created_at,
});

export async function list(userId) {
  const { rows } = await query(
    `select * from connected_accounts where user_id = $1 order by created_at asc`,
    [userId],
  );
  return rows.map(publicAccount);
}

/** Internal use only — the row still holds ciphertext. */
export async function findOwnedRow(userId, accountId) {
  const { rows } = await query(`select * from connected_accounts where id = $1 and user_id = $2`, [
    accountId,
    userId,
  ]);
  if (!rows[0]) throw notFound("That mail account is not connected.");
  return rows[0];
}

/**
 * Upsert on (user, provider, provider account). Re-authorizing an account
 * already connected refreshes its tokens instead of creating a duplicate, and
 * never touches the user's other accounts.
 */
export async function upsertGmailAccount(
  userId,
  { providerAccountId, email, displayName, tokens },
) {
  const refreshEncrypted = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
  const { rows } = await query(
    `insert into connected_accounts
       (user_id, provider, provider_account_id, email_address, display_name,
        access_token_encrypted, refresh_token_encrypted, token_expires_at, scopes, status, status_detail)
     values ($1, 'gmail', $2, $3, $4, $5, $6, $7, $8, 'connected', null)
     on conflict (user_id, provider, provider_account_id) do update
       set email_address           = excluded.email_address,
           display_name            = excluded.display_name,
           access_token_encrypted  = excluded.access_token_encrypted,
           -- Google only returns a refresh token on first consent; keep the old
           -- one when this grant did not include a new one.
           refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, connected_accounts.refresh_token_encrypted),
           token_expires_at        = excluded.token_expires_at,
           scopes                  = excluded.scopes,
           status                  = 'connected',
           status_detail           = null,
           updated_at              = now()
     returning *`,
    [
      userId,
      providerAccountId,
      String(email).toLowerCase(),
      displayName,
      encryptToken(tokens.accessToken),
      refreshEncrypted,
      tokens.expiresAt,
      tokens.scopes || [],
    ],
  );
  return publicAccount(rows[0]);
}

export async function saveRefreshedAccessToken(accountId, { accessToken, expiresAt }) {
  await query(
    `update connected_accounts
        set access_token_encrypted = $2, token_expires_at = $3,
            status = 'connected', status_detail = null, updated_at = now()
      where id = $1`,
    [accountId, encryptToken(accessToken), expiresAt],
  );
}

export async function markReauthRequired(accountId, detail) {
  await query(
    `update connected_accounts
        set status = 'reauth_required', status_detail = $2,
            access_token_encrypted = null, updated_at = now()
      where id = $1`,
    [accountId, String(detail || "Authorization is no longer valid.").slice(0, 300)],
  );
}

export async function touchSynced(accountId) {
  await query(
    `update connected_accounts set last_sync_at = now(), updated_at = now() where id = $1`,
    [accountId],
  );
}

/** Returns the decrypted refresh token so it can be revoked, then deletes. */
export async function removeOwned(userId, accountId) {
  const row = await findOwnedRow(userId, accountId);
  let refreshToken = null;
  try {
    refreshToken = decryptToken(row.refresh_token_encrypted);
  } catch {
    refreshToken = null; // unreadable ciphertext must not block disconnecting
  }
  await query(`delete from connected_accounts where id = $1 and user_id = $2`, [accountId, userId]);
  return { account: publicAccount(row), refreshToken };
}
