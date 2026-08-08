import type { Db } from "../db/index.js";

export interface AgentRecord {
  address: `0x${string}`;
  name: string;
  kind: string;
  active: boolean;
}

interface AgentRow {
  address: string;
  name: string;
  kind: string;
  active: number;
}

/**
 * Addresses are stored lower-cased. `address` is the primary key and SQLite
 * TEXT comparison is case-sensitive, so a checksummed "0xAbC…" and a raw
 * "0xabc…" would otherwise register as two distinct agents for the same
 * wallet — and both would then be credited the same pooled earnings, which
 * are keyed by lower-cased address.
 */
function normalize(address: string): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

function toAgent(row: AgentRow): AgentRecord {
  return {
    address: row.address as `0x${string}`,
    name: row.name,
    kind: row.kind,
    active: row.active === 1,
  };
}

export class AgentRepo {
  constructor(private readonly db: Db) {}

  upsert(agent: AgentRecord): AgentRecord {
    const stored: AgentRecord = { ...agent, address: normalize(agent.address) };
    this.db
      .prepare(
        `INSERT INTO agents (address, name, kind, active) VALUES (?,?,?,?)
         ON CONFLICT(address) DO UPDATE SET name=excluded.name, kind=excluded.kind, active=excluded.active`,
      )
      .run(stored.address, stored.name, stored.kind, stored.active ? 1 : 0);
    return stored;
  }

  list(activeOnly = false): AgentRecord[] {
    const sql = activeOnly
      ? "SELECT * FROM agents WHERE active = 1 ORDER BY address"
      : "SELECT * FROM agents ORDER BY address";
    return (this.db.prepare(sql).all() as unknown as AgentRow[]).map(toAgent);
  }

  deactivate(address: string): boolean {
    return (
      this.db.prepare("UPDATE agents SET active = 0 WHERE address = ?").run(normalize(address))
        .changes > 0
    );
  }
}
