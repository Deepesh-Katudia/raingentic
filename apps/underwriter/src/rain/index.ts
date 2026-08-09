import { rainConfig } from "@float/shared";
import { MockRainClient } from "./mock.js";
import { LiveRainClient } from "./live.js";
import type { RainClient } from "./types.js";

export type { CardScope, IssuedCard, RainClient } from "./types.js";
export { MockRainClient } from "./mock.js";
export { parseAuthorization } from "./live.js";

/** The single place client selection happens. */
export function createRainClient(): { client: RainClient; mode: "mock" | "live" } {
  const cfg = rainConfig();
  if (cfg.mode === "live") {
    console.log(`[rain] LIVE against ${cfg.apiBase} as user ${cfg.userId}`);
    return { client: new LiveRainClient(cfg.apiBase, cfg.apiKey, cfg.userId), mode: "live" };
  }
  console.log("[rain] MOCK — no credentials used");
  return { client: new MockRainClient(), mode: "mock" };
}
