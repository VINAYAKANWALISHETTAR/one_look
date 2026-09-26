/**
 * Task service — every statement is scoped by user_id, so one user's query can
 * never touch another user's row even if an id is guessed.
 */

import { randomUUID } from "node:crypto";

import { query } from "../db/database.js";
import { notFound } from "../utils/http-error.js";

export function toApi(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    description: row.description,
    date: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : row.due_date,
    time: row.due_time ? String(row.due_time).slice(0, 5) : "",
    priority: row.priority,
    status: row.status,
    reminderOffset: row.reminder_offset,
    reminderAt: row.reminder_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const COLUMNS = `id, user_id, client_id, title, description, due_date, due_time, priority, status,
                 reminder_offset, reminder_at, completed_at, created_at, updated_at, deleted_at`;

export async function list(userId, { includeDeleted = false, since = null } = {}) {
  const { rows } = await query(
    `select ${COLUMNS} from tasks
      where user_id = $1
        and ($2::boolean or deleted_at is null)
        and ($3::timestamptz is null or updated_at > $3)
      order by due_date asc, due_time asc nulls last, created_at asc`,
    [userId, includeDeleted, since],
  );
  return rows.map(toApi);
}

export async function getById(userId, id) {
  const { rows } = await query(`select ${COLUMNS} from tasks where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
  if (!rows[0] || rows[0].deleted_at) throw notFound("Task not found.");
  return toApi(rows[0]);
}

/** Insert-or-update by (user_id, client_id) — idempotent for sync retries. */
export async function upsert(userId, input) {
  const clientId = input.clientId || randomUUID();
  const { rows } = await query(
    `insert into tasks (user_id, client_id, title, description, due_date, due_time, priority, status,
                        reminder_offset, reminder_at, completed_at, created_at, updated_at, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             coalesce($12::timestamptz, now()), coalesce($13::timestamptz, now()), $14)
     on conflict (user_id, client_id) do update set
        title = excluded.title,
        description = excluded.description,
        due_date = excluded.due_date,
        due_time = excluded.due_time,
        priority = excluded.priority,
        status = excluded.status,
        reminder_offset = excluded.reminder_offset,
        reminder_at = excluded.reminder_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
     returning ${COLUMNS}`,
    [
      userId,
      clientId,
      input.title,
      input.description ?? "",
      input.date,
      input.time || null,
      input.priority ?? "medium",
      input.status ?? "pending",
      input.reminderOffset ?? "none",
      input.reminderAt ?? null,
      input.completedAt ?? null,
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

/** Soft delete (tombstone) so the deletion itself can synchronize. */
export async function softDelete(userId, id) {
  const { rows } = await query(
    `update tasks set deleted_at = now(), updated_at = now()
      where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id],
  );
  if (!rows[0]) throw notFound("Task not found.");
  return toApi(rows[0]);
}

/** Raw fetch including tombstones — used by the sync engine for conflicts. */
export async function getRawApi(userId, id) {
  const { rows } = await query(`select ${COLUMNS} from tasks where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
  return rows[0] ? toApi(rows[0]) : null;
}
