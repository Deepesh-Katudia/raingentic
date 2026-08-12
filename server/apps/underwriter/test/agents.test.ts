import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { AgentRepo } from "../src/agents/repo.js";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

/** One wallet, written the two ways a client might send it. */
const MIXED = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01" as const;
const MIXED_LOWER = MIXED.toLowerCase() as `0x${string}`;

test("registers and lists agents", () => {
  const repo = new AgentRepo(openDb(":memory:"));

  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: B, name: "scrape", kind: "scrape", active: true });

  assert.equal(repo.list().length, 2);
});

test("upsert replaces rather than duplicating", () => {
  const repo = new AgentRepo(openDb(":memory:"));

  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: A, name: "price-v2", kind: "price", active: true });

  const all = repo.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.name, "price-v2");
});

// `address` is the primary key and SQLite compares TEXT case-sensitively, so
// without normalization a checksummed and a raw address are two agents for one
// wallet — and both would be credited the same pooled earnings.
test("the same wallet in two casings is one agent, stored lower-cased", () => {
  const repo = new AgentRepo(openDb(":memory:"));

  const created = repo.upsert({ address: MIXED, name: "price", kind: "price", active: true });
  repo.upsert({ address: MIXED_LOWER, name: "price-v2", kind: "price", active: true });

  assert.equal(created.address, MIXED_LOWER);

  const all = repo.list();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.address, MIXED_LOWER);
  assert.equal(all[0]?.name, "price-v2");
});

test("deactivate matches a wallet registered in a different casing", () => {
  const repo = new AgentRepo(openDb(":memory:"));
  repo.upsert({ address: MIXED_LOWER, name: "price", kind: "price", active: true });

  assert.equal(repo.deactivate(MIXED), true);
  assert.equal(repo.list(true).length, 0);
});

test("deactivated agents are excluded from the active list", () => {
  const repo = new AgentRepo(openDb(":memory:"));
  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: B, name: "scrape", kind: "scrape", active: true });

  repo.deactivate(A);

  assert.equal(repo.list().length, 2);
  assert.equal(repo.list(true).length, 1);
  assert.equal(repo.list(true)[0]?.address, B);
});
