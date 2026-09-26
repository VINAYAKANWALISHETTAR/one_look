-- Phase 5: connected mail accounts (multiple Gmail accounts per One Look user).
--
-- Design notes
--   * The table is intentionally NOT one-row-per-user: the primary key is the
--     connection, and a user may hold many rows for the same provider.
--   * `provider` is text (not an enum) so later providers slot in without a
--     migration to alter a type.
--   * OAuth tokens are stored ENCRYPTED (AES-256-GCM, see
--     services/token-crypto.service.js). The columns hold opaque ciphertext.
--   * Gmail passwords are never stored. There is no column for one.
--   * The Gmail API stays the source of truth for mailbox content: only
--     connection info, tokens and sync metadata live here.

create table if not exists connected_accounts (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references users(id) on delete cascade,
  provider                text not null default 'gmail',
  provider_account_id     text not null,
  email_address           text not null,
  display_name            text,
  access_token_encrypted  text,
  refresh_token_encrypted text,
  token_expires_at        timestamptz,
  scopes                  text[] not null default '{}',
  -- Set when Google refuses to refresh (revoked / expired grant). The UI shows
  -- "Reconnect Gmail" instead of crashing.
  status                  text not null default 'connected',
  status_detail           text,
  last_sync_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint connected_accounts_provider_check check (provider in ('gmail')),
  constraint connected_accounts_status_check check (status in ('connected', 'reauth_required'))
);

-- One connection per (One Look user, provider, provider account). Re-running
-- the OAuth flow for an account already connected updates it in place.
create unique index if not exists connected_accounts_user_provider_account_key
  on connected_accounts (user_id, provider, provider_account_id);

create index if not exists connected_accounts_user_idx on connected_accounts (user_id);
