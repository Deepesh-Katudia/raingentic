import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { decideAuth, type AuthPolicy } from "../src/auth.js";
import { openDb } from "../src/db/index.js";
import { BillRepo } from "../src/bills/repo.js";
import { Planner } from "../src/planner/index.js";

const PARAMS = {
  earningsWindowSecs: 120,
  horizonSecs: 600,
  capMicro: 200_000_000n,
};

const POLICY: AuthPolicy = { allowedMerchants: ["*"], timeoutMs: 800 };

/** No bills, so no reservations: every charge here is discretionary. */
const NO_RESERVATIONS = new Planner(openDb(":memory:"), new BillRepo(openDb(":memory:")), 35);

/** Earn `micro` over the window from `payers` distinct payers. */
function storeEarning(earnedInWindowMicro: bigint, distinctPayers: number): Store {
  const store = new Store(PARAMS);
  store.setProfile({
    earnedInWindowMicro,
    distinctPayers,
    totalEarnedMicro: earnedInWindowMicro,
    perAgent: [],
    readAt: Date.now(),
  });
  return store;
}

function auth(amountMicro: bigint) {
  return { authId: "t1", amountMicro, merchantId: "mrc_demo_supplies", mcc: "5734" };
}

test("declines every authorization when nothing has been earned", () => {
  const store = storeEarning(0n, 0);

  const decision = decideAuth(store, auth(1_000_000n), POLICY, NO_RESERVATIONS);

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /insufficient earned credit/);
});

test("approves an amount within the earned limit and declines one above it", () => {
  // $2 earned over 120s projects to $10 across a 600s horizon, discounted to $6
  // because a single payer scores the lowest diversity multiplier (0.6).
  const store = storeEarning(2_000_000n, 1);
  assert.equal(store.availableMicro, 6_000_000n);

  const approved = decideAuth(store, auth(4_000_000n), POLICY, NO_RESERVATIONS);
  assert.equal(approved.approved, true);

  // $4 is now outstanding, leaving $2 — the next $4 must decline.
  assert.equal(store.availableMicro, 2_000_000n);
  const declined = decideAuth(store, auth(4_000_000n), POLICY, NO_RESERVATIONS);
  assert.equal(declined.approved, false);
});

test("counts payer diversity toward the limit", () => {
  const concentrated = storeEarning(2_000_000n, 1);
  const diverse = storeEarning(2_000_000n, 5);

  // 0.6x at one payer, 1.0x at five or more.
  assert.equal(concentrated.availableMicro, 6_000_000n);
  assert.equal(diverse.availableMicro, 10_000_000n);
});

test("declines a merchant outside the card scope even when funds are available", () => {
  const store = storeEarning(20_000_000n, 5);
  const strict: AuthPolicy = { allowedMerchants: ["mrc_allowed"], timeoutMs: 800 };

  const decision = decideAuth(store, auth(1_000_000n), strict, NO_RESERVATIONS);

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /not in scope/);
});

test("decides well inside the authorization window", () => {
  const store = storeEarning(20_000_000n, 5);

  const decision = decideAuth(store, auth(1_000_000n), POLICY, NO_RESERVATIONS);

  assert.ok(decision.elapsedMs < 800, `took ${decision.elapsedMs}ms`);
});
