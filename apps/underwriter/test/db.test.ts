import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";

test("applies schema and persists a row across reopen", () => {
  const path = `./test-${Date.now()}.db`;
  const db = openDb(path);

  db.prepare(
    "INSERT INTO bills (name, merchant_id, mcc, amount_micro, cadence, due_day, priority) VALUES (?,?,?,?,?,?,?)",
  ).run("Rent", "mrc_landlord", "6513", "1200000000", "monthly", 5, 0);
  db.close();

  const reopened = openDb(path);
  const rows = reopened.prepare("SELECT name, amount_micro FROM bills").all();
  reopened.close();

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { name: string }).name, "Rent");
  assert.equal((rows[0] as { amount_micro: string }).amount_micro, "1200000000");
});

test("opening twice does not error on existing tables", () => {
  const path = `./test-idem-${Date.now()}.db`;
  openDb(path).close();
  const second = openDb(path);
  const tables = second.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  second.close();

  const names = tables.map((t) => (t as { name: string }).name);
  for (const expected of ["agents", "bills", "reservations", "authorizations"]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
});
