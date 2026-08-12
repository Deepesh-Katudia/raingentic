import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db/index.js";
import { BillRepo } from "../src/bills/repo.js";
import { validateBillInput } from "../src/bills/validate.js";

function repo() {
  return new BillRepo(openDb(":memory:"));
}

const VALID = {
  name: "Rent",
  merchantId: "mrc_landlord",
  mcc: "6513",
  amountMicro: "1200000000",
  cadence: "monthly",
  dueDay: 5,
  priority: 0,
};

test("accepts a well-formed bill", () => {
  const result = validateBillInput(VALID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.amountMicro, 1_200_000_000n);
    assert.equal(result.value.toleranceBps, 500);
  }
});

test("rejects a non-positive amount", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "0" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /amountMicro/);
});

test("rejects a fractional amount string", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "12.50" });
  assert.equal(result.ok, false);
});

test("rejects an unknown cadence", () => {
  const result = validateBillInput({ ...VALID, cadence: "yearly" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /cadence/);
});

test("rejects a monthly due day outside 1..28", () => {
  assert.equal(validateBillInput({ ...VALID, dueDay: 0 }).ok, false);
  assert.equal(validateBillInput({ ...VALID, dueDay: 29 }).ok, false);
  assert.equal(validateBillInput({ ...VALID, dueDay: 28 }).ok, true);
});

test("rejects a weekly due day outside 0..6", () => {
  const weekly = { ...VALID, cadence: "weekly" };
  assert.equal(validateBillInput({ ...weekly, dueDay: 7 }).ok, false);
  assert.equal(validateBillInput({ ...weekly, dueDay: 6 }).ok, true);
});

test("round-trips a bill through the database", () => {
  const r = repo();
  const created = r.create(validateOrThrow(VALID));

  assert.ok(created.id > 0);
  assert.equal(created.amountMicro, 1_200_000_000n);
  assert.equal(created.active, true);

  const fetched = r.get(created.id);
  assert.equal(fetched?.name, "Rent");
  assert.equal(fetched?.amountMicro, 1_200_000_000n);
});

test("lists only active bills when asked", () => {
  const r = repo();
  const a = r.create(validateOrThrow(VALID));
  r.create(validateOrThrow({ ...VALID, name: "Netflix", merchantId: "mrc_netflix" }));

  r.deactivate(a.id);

  assert.equal(r.list().length, 2);
  assert.equal(r.list(true).length, 1);
  assert.equal(r.list(true)[0]?.name, "Netflix");
});

test("updates an amount and keeps it a bigint", () => {
  const r = repo();
  const created = r.create(validateOrThrow(VALID));

  const updated = r.update(created.id, { amountMicro: 1_500_000_000n });

  assert.equal(updated?.amountMicro, 1_500_000_000n);
});

test("update() rejects a cadence/dueDay combination it would create", () => {
  const r = repo();
  // dueDay 25 is valid for monthly, but out of range once cadence flips to weekly.
  const created = r.create(validateOrThrow({ ...VALID, dueDay: 25 }));

  assert.throws(() => r.update(created.id, { cadence: "weekly" }));

  // The bad patch must not have been persisted.
  const unchanged = r.get(created.id);
  assert.equal(unchanged?.cadence, "monthly");
  assert.equal(unchanged?.dueDay, 25);
});

test("rejects an amount over the maximum", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "1000000000001" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /amountMicro/);
});

test("accepts an amount at the maximum", () => {
  const result = validateBillInput({ ...VALID, amountMicro: "1000000000000" });
  assert.equal(result.ok, true);
});

test("rejects an over-length name", () => {
  const result = validateBillInput({ ...VALID, name: "a".repeat(201) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /name/);
});

function validateOrThrow(raw: unknown) {
  const res = validateBillInput(raw);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}
