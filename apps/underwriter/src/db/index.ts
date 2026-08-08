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
 */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export type Db = DatabaseSync;
