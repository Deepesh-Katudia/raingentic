import { Router } from "express";
import type { AgentRepo, AgentRecord } from "../agents/repo.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * @param earnings - returns per-agent total earned micro-USD keyed by lowercase
 *                   address, sourced from the chain watcher.
 */
export function createAgentsRouter(
  repo: AgentRepo,
  earnings: () => Record<string, string>,
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const earned = earnings();
    res.json(
      repo.list().map((a) => ({
        ...a,
        totalEarnedMicro: earned[a.address.toLowerCase()] ?? "0",
      })),
    );
  });

  router.post("/", (req, res) => {
    const b = req.body as Partial<AgentRecord>;
    if (typeof b.address !== "string" || !ADDRESS_RE.test(b.address)) {
      res.status(400).json({ error: "address must be a 0x-prefixed 20-byte address" });
      return;
    }
    if (typeof b.name !== "string" || b.name.trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const record: AgentRecord = {
      address: b.address as `0x${string}`,
      name: b.name.trim(),
      kind: typeof b.kind === "string" && b.kind.trim() ? b.kind.trim() : "unknown",
      active: b.active !== false,
    };
    res.status(201).json(repo.upsert(record));
  });

  router.delete("/:address", (req, res) => {
    if (!repo.deactivate(req.params.address)) {
      res.status(404).json({ error: "no such agent" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
