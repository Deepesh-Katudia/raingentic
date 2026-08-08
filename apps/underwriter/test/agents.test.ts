import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { AgentRepo } from "../src/agents/repo.js";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

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

test("deactivated agents are excluded from the active list", () => {
  const repo = new AgentRepo(openDb(":memory:"));
  repo.upsert({ address: A, name: "price", kind: "price", active: true });
  repo.upsert({ address: B, name: "scrape", kind: "scrape", active: true });

  repo.deactivate(A);

  assert.equal(repo.list().length, 2);
  assert.equal(repo.list(true).length, 1);
  assert.equal(repo.list(true)[0]?.address, B);
});
