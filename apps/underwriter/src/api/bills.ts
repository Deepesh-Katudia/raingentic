import { Router } from "express";
import type { BillRepo } from "../bills/repo.js";
import { validateBillInput } from "../bills/validate.js";
import type { Bill } from "../bills/types.js";

/** Bills carry bigint money; serialize as strings so JSON never sees a float. */
function serialize(bill: Bill) {
  return { ...bill, amountMicro: bill.amountMicro.toString() };
}

export function createBillsRouter(repo: BillRepo): Router {
  const router = Router();

  router.get("/", (req, res) => {
    const activeOnly = req.query.active === "true";
    res.json(repo.list(activeOnly).map(serialize));
  });

  router.post("/", (req, res) => {
    const result = validateBillInput(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.status(201).json(serialize(repo.create(result.value)));
  });

  router.patch("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id must be an integer" });
      return;
    }

    const existing = repo.get(id);
    if (!existing) {
      res.status(404).json({ error: "no such bill" });
      return;
    }

    // Validate the merged result so a partial update cannot produce an
    // invalid bill, e.g. switching cadence to weekly while dueDay is 28.
    // `repo.update` re-checks the same invariants and throws on violation;
    // validating first turns what would be a 500 into a 400 with a reason.
    const merged = {
      ...serialize(existing),
      ...(req.body as Record<string, unknown>),
    };
    const result = validateBillInput(merged);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }

    // Non-null: `existing` was just read on this synchronous path, so the row
    // is still there and `update` can only return null for a missing bill.
    res.json(serialize(repo.update(id, result.value)!));
  });

  router.delete("/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!repo.deactivate(id)) {
      res.status(404).json({ error: "no such bill" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
