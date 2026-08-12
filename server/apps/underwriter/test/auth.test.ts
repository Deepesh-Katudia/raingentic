import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/state.js";
import { decideAuth, type AuthPolicy } from "../src/auth.js";
import { openDb } from "../src/db/index.js";
import { BillRepo } from "../src/bills/repo.js";
import { Planner } from "../src/planner/index.js";

const PARAMS = { capMicro: 200_000_000n };

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

test("spends down accumulated earnings and declines once they run out", () => {
  // $10 earned is $10 spendable — the limit is banked money, not a projection.
  const store = storeEarning(10_000_000n, 1);
  assert.equal(store.availableMicro, 10_000_000n);

  const approved = decideAuth(store, auth(4_000_000n), POLICY, NO_RESERVATIONS);
  assert.equal(approved.approved, true);
  assert.equal(store.availableMicro, 6_000_000n);

  decideAuth(store, auth(4_000_000n), POLICY, NO_RESERVATIONS);
  assert.equal(store.availableMicro, 2_000_000n);

  // $2 left cannot cover another $4.
  const declined = decideAuth(store, auth(4_000_000n), POLICY, NO_RESERVATIONS);
  assert.equal(declined.approved, false);
});

test("payer diversity does not change what has already been earned", () => {
  // Concentration is a risk to future income, and this number contains none.
  const concentrated = storeEarning(10_000_000n, 1);
  const diverse = storeEarning(10_000_000n, 5);

  assert.equal(concentrated.availableMicro, 10_000_000n);
  assert.equal(diverse.availableMicro, 10_000_000n);
});

test("caps the limit however much has been earned", () => {
  // $500 earned against a $200 cap.
  const store = storeEarning(500_000_000n, 5);

  assert.equal(store.limitState.projectedMicro, 500_000_000n);
  assert.equal(store.limitState.limitMicro, 200_000_000n);
  assert.equal(store.availableMicro, 200_000_000n);
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
