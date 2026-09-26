/** Note service — text-only notes, always scoped to the authenticated user. */

import { randomUUID } from "node:crypto";

import { query } from "../db/database.js";
import { notFound } from "../utils/http-error.js";

const COLUMNS = `id, user_id, client_id, content, created_at, updated_at, deleted_at`;

export function toApi(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export async function list(userId, { includeDeleted = false, since = null } = {}) {
  const { rows } = await query(
    `select ${COLUMNS} from notes
      where user_id = $1
        and ($2::boolean or deleted_at is null)
        and ($3::timestamptz is null or updated_at > $3)
      order by updated_at desc`,
    [userId, includeDeleted, since],
  );
  return rows.map(toApi);
}

export async function getById(userId, id) {
  const { rows } = await query(`select ${COLUMNS} from notes where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
  if (!rows[0] || rows[0].deleted_at) throw notFound("Note not found.");
  return toApi(rows[0]);
}

export async function upsert(userId, input) {
  const clientId = input.clientId || randomUUID();
  const { rows } = await query(
    `insert into notes (user_id, client_id, content, created_at, updated_at, deleted_at)
     values ($1, $2, $3, coalesce($4::timestamptz, now()), coalesce($5::timestamptz, now()), $6)
     on conflict (user_id, client_id) do update set
        content = excluded.content,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
     returning ${COLUMNS}`,
    [
      userId,
      clientId,
      input.content,
      input.createdAt ?? null,
      input.updatedAt ?? null,
      input.deletedAt ?? null,
    ],
  );
  return toApi(rows[0]);
}

export async function patch(userId, id, input) {
  const current = await getById(userId, id);
  return upsert(userId, {
    ...current,
    ...input,
    clientId: current.clientId,
    updatedAt: new Date().toISOString(),
  });
}

export async function softDelete(userId, id) {
  const { rows } = await query(
    `update notes set deleted_at = now(), updated_at = now()
      where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id],
  );
  if (!rows[0]) throw notFound("Note not found.");
  return toApi(rows[0]);
}

/** Raw fetch including tombstones — used by the sync engine for conflicts. */
export async function getRawApi(userId, id) {
  const { rows } = await query(`select ${COLUMNS} from notes where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
  return rows[0] ? toApi(rows[0]) : null;
}
