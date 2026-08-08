import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "./schema.js";

/**
 * Opens the treasury database and applies the schema idempotently.
 *
 * DatabaseSync is deliberate: every read on the authorization path must be
 * synchronous so the decision never awaits I/O. node:sqlite is used instead of
 * better-sqlite3 because the latter needs a node-gyp native build that fails on
 * the build machine.
 *
 * WAL is skipped for `:memory:` databases — SQLite does not support WAL mode
 * on in-memory connections, and setting it there throws. Tests (this task and
 * later ones) open `:memory:` directly, so this must not throw.
 *
 * The pragmas and schema application are wrapped in try/catch: if any of them
 * throws (locked file, disk full, a future schema edit with bad SQL), the
 * already-open handle is closed before the exception propagates. Without
 * this, a failed open leaks the handle and the OS-level file/WAL lock stays
 * held — every later task's tests open and reopen this database repeatedly,
 * so a leaked lock would cascade into unrelated test failures.
 */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    if (path !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL");
    }
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

export type Db = DatabaseSync;
