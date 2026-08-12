/**
 * Money columns are TEXT holding decimal micro-USD strings. SQLite integers are
 * 64-bit signed and would fit today, but strings keep the bigint discipline
 * uniform and remove any chance of a driver coercing a value to float.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  address     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bills (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  merchant_id   TEXT NOT NULL,
  mcc           TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  cadence       TEXT NOT NULL,
  due_day       INTEGER NOT NULL,
  priority      INTEGER NOT NULL,
  tolerance_bps INTEGER NOT NULL DEFAULT 500,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id       INTEGER NOT NULL REFERENCES bills(id),
  amount_micro  TEXT NOT NULL,
  due_at        INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  consumed_at   INTEGER
);

CREATE TABLE IF NOT EXISTS authorizations (
  auth_id       TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  approved      INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  elapsed_ms    REAL NOT NULL,
  bill_id       INTEGER REFERENCES bills(id),
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL,
  direction     TEXT NOT NULL,
  amount_micro  TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_bills_active ON bills(active);
CREATE INDEX IF NOT EXISTS idx_ledger_events_created_at ON ledger_events(created_at);
`;
