/**
 * Global search — local data (tasks, notes from IndexedDB) plus real mail from
 * every connected Gmail account.
 *
 * Local matching is plain case-insensitive substring matching; the dataset is a
 * personal task list, so no index and no fuzzy-search dependency is warranted.
 * Mail is NOT searched locally: the query is handed to Gmail's own search
 * engine through the backend, so the whole mailbox is searchable without ever
 * downloading it. Nothing unimplemented (Calendar, LinkedIn, News) is searched
 * or faked here.
 */

import { listTasks } from "./tasks.js";
import { listNotes, noteTitle } from "./notes.js";
import * as mail from "../services/mail-service.js";

const norm = (value) => String(value || "").toLowerCase();

function matches(haystacks, query) {
  return haystacks.some((value) => norm(value).includes(query));
}

/**
 * Local-only search. Returns instantly so the UI can paint task/note results
 * without waiting on the network.
 *
 * Returns { query, tasks, notes, total } — empty groups are still returned so
 * callers can render counts without extra checks.
 */
export async function search(rawQuery) {
  const query = norm(rawQuery).trim();
  if (!query) return { query: "", tasks: [], notes: [], total: 0 };

  const [tasks, notes] = await Promise.all([listTasks(), listNotes()]);

  const taskHits = tasks.filter((task) => matches([task.title, task.description], query));
  const noteHits = notes.filter((note) => matches([note.content], query));

  return { query, tasks: taskHits, notes: noteHits, total: taskHits.length + noteHits.length };
}

/**
 * Mail search, run separately and awaited on its own so a slow or offline
 * mailbox never delays local results. Failures resolve to an empty group with
 * a reason instead of throwing — search must always render something.
 */
export async function searchMail(rawQuery, { limit = 10 } = {}) {
  const query = String(rawQuery || "").trim();
  if (!query) return { query: "", messages: [], accountsSearched: 0, error: null };
  if (!(await mail.isMailReady())) return { query, messages: [], accountsSearched: 0, error: null };

  try {
    const data = await mail.searchMail(query, { limit });
    return { ...data, error: null };
  } catch (error) {
    return {
      query,
      messages: [],
      accountsSearched: 0,
      error: error.offline ? "Mail search needs a connection." : error.message,
    };
  }
}

export { noteTitle };
