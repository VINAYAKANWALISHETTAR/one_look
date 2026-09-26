-- 001_init.sql — One Look core schema (users, tasks, notes, user_settings).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- users ----
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  display_name  text not null,
  password_hash text,
  auth_provider text not null default 'local'
                check (auth_provider in ('local', 'google')),
  google_sub    text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint users_email_lower check (email = lower(email)),
  constraint users_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint users_credential_present check (password_hash is not null or google_sub is not null)
);

create unique index if not exists users_email_key on users (email);

-- ------------------------------------------------------- refresh tokens ----
-- Only a SHA-256 hash of each refresh token is stored, never the token.
create table if not exists refresh_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_user_idx on refresh_tokens (user_id);

-- ---------------------------------------------------------------- tasks ----
-- `client_id` is the id the offline client generated. Unique per user so a
-- retried sync updates the same row instead of creating duplicates.
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users (id) on delete cascade,
  client_id       text not null,
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text not null default '' check (length(description) <= 2000),
  due_date        date not null,
  due_time        time,
  priority        text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status          text not null default 'pending' check (status in ('pending', 'completed')),
  reminder_offset text not null default 'none',
  reminder_at     timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint tasks_client_id_len check (length(client_id) between 1 and 128)
);

create unique index if not exists tasks_user_client_key on tasks (user_id, client_id);
create index if not exists tasks_user_updated_idx on tasks (user_id, updated_at);
create index if not exists tasks_user_due_idx on tasks (user_id, due_date) where deleted_at is null;
create index if not exists tasks_reminder_idx on tasks (reminder_at) where deleted_at is null and status = 'pending';

-- ---------------------------------------------------------------- notes ----
create table if not exists notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  client_id  text not null check (length(client_id) between 1 and 128),
  content    text not null check (length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists notes_user_client_key on notes (user_id, client_id);
create index if not exists notes_user_updated_idx on notes (user_id, updated_at);

-- -------------------------------------------------------- user settings ----
create table if not exists user_settings (
  user_id    uuid primary key references users (id) on delete cascade,
  timezone   text not null default 'UTC' check (length(timezone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------- updated_at trigger ----
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on users;
create trigger users_updated_at before update on users
  for each row execute function set_updated_at();

drop trigger if exists user_settings_updated_at on user_settings;
create trigger user_settings_updated_at before update on user_settings
  for each row execute function set_updated_at();
