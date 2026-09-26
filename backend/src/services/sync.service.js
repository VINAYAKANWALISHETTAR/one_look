/**
 * Sync service — deliberately simple two-way sync.
 *
 * PUSH: the client sends every local record marked `pending` together with the
 * watermark (`since`) it last pulled at.
 *   - no server row              → insert
 *   - server row untouched since watermark → apply the client version
 *   - server row changed after the watermark AND the client also changed it
 *     → CONFLICT: server row is kept, nothing is overwritten, and the client is
 *       told so it can mark the record syncStatus = "conflict".
 *
 * PULL: every row (including tombstones) whose updated_at > since, so deletes
 * propagate too. Records are matched by (user_id, client_id) which makes the
 * whole operation idempotent — replaying a push never duplicates data.
 */

import { query } from "../db/database.js";
import * as tasks from "./task.service.js";
import * as notes from "./note.service.js";

async function existingRow(table, userId, clientId) {
  const { rows } = await query(
    `select id, client_id, updated_at, deleted_at from ${table === "tasks" ? "tasks" : "notes"}
      where user_id = $1 and client_id = $2`,
    [userId, clientId],
  );
  return rows[0] || null;
}

async function pushGroup({ table, service, userId, records, since }) {
  const applied = [];
  const conflicts = [];
  const sinceDate = since ? new Date(since) : null;

  for (const record of records) {
    const existing = await existingRow(table, userId, record.clientId);
    const clientUpdated = record.updatedAt ? new Date(record.updatedAt) : new Date();

    if (existing) {
      const serverUpdated = new Date(existing.updated_at);
      const serverChangedSinceWatermark = !sinceDate || serverUpdated > sinceDate;
      const clientIsNewer = clientUpdated > serverUpdated;

      // Both sides moved on since the client's last pull → surface, never merge.
      if (serverChangedSinceWatermark && !clientIsNewer) {
        conflicts.push({
          clientId: record.clientId,
          reason: "both_changed",
          server:
            table === "tasks"
              ? await tasks.getRawApi(userId, existing.id)
              : await notes.getRawApi(userId, existing.id),
        });
        continue;
      }
    }

    const saved = await service.upsert(userId, record);
    applied.push({ clientId: saved.clientId, id: saved.id, updatedAt: saved.updatedAt });
  }

  return { applied, conflicts };
}

/**
 * @param {string} userId
 * @param {{ since?: string|null, tasks?: object[], notes?: object[] }} payload
 */
export async function sync(userId, payload) {
  const since = payload.since || null;
  const serverTime = new Date().toISOString();

  const taskPush = await pushGroup({
    table: "tasks",
    service: tasks,
    userId,
    records: payload.tasks || [],
    since,
  });
  const notePush = await pushGroup({
    table: "notes",
    service: notes,
    userId,
    records: payload.notes || [],
    since,
  });

  // Pull after push so the client immediately sees its own accepted writes.
  const [serverTasks, serverNotes] = await Promise.all([
    tasks.list(userId, { includeDeleted: true, since }),
    notes.list(userId, { includeDeleted: true, since }),
  ]);

  return {
    serverTime,
    tasks: { applied: taskPush.applied, conflicts: taskPush.conflicts, changed: serverTasks },
    notes: { applied: notePush.applied, conflicts: notePush.conflicts, changed: serverNotes },
  };
}
