/**
 * Drives the full treasury story against a running stack.
 *
 *   terminal 1:  pnpm dev
 *   terminal 2:  pnpm demo
 *
 * Works with zero testnet funds by injecting a simulated treasury balance.
 * That injection is refused once CREDIT_FILE_ADDRESS is set — after you deploy,
 * the chain is the only source of earnings and this script switches to reading
 * whatever the agents have genuinely earned.
 */
const UW = process.env.UNDERWRITER_URL ?? "http://localhost:3003";
const BILLER = process.env.BILLER_URL ?? "http://localhost:3004";

const usd = (micro: string | bigint) => `$${(Number(BigInt(micro)) / 1e6).toFixed(2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(url: string, method = "GET", body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: text as unknown };
  }
}

function heading(n: number, text: string) {
  console.log(`\n\x1b[1m${n}. ${text}\x1b[0m`);
}

async function waitForUnderwriter(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${UW}/health`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error(`Underwriter never came up at ${UW}. Is \`pnpm dev\` running?`);
}

async function main() {
  console.log(`Waiting for the underwriter at ${UW} ...`);
  await waitForUnderwriter();

  // --- 1. income ------------------------------------------------------------
  heading(1, "Agent income accrues");
  const earn = await call(`${UW}/api/demo/earnings`, "POST", {
    totalEarnedMicro: "40000000",
    distinctPayers: 3,
  });

  if (earn.status === 409) {
    console.log("   A contract is deployed, so simulated earnings are refused (correct).");
    console.log("   Reading real onchain earnings instead.");
    const state = (await call(`${UW}/api/state`)).json as { profile: { totalEarnedMicro: string } };
    console.log(`   earned onchain: ${usd(state.profile.totalEarnedMicro)}`);
    if (BigInt(state.profile.totalEarnedMicro) === 0n) {
      console.log("\n   No earnings yet. Start the buyers:  curl -X POST localhost:3002/control/start");
      return;
    }
  } else {
    console.log(`   simulated ${usd("40000000")} accrued from ~800 calls at $0.05`);
  }

  // --- 2. bills -------------------------------------------------------------
  heading(2, "User sets the bills they want covered");
  const bills = [
    { name: "Netflix", merchantId: "mrc_netflix", mcc: "5734", amountMicro: "15000000", cadence: "monthly", dueDay: 12, priority: 0 },
    { name: "Spotify", merchantId: "mrc_spotify", mcc: "5734", amountMicro: "12000000", cadence: "monthly", dueDay: 20, priority: 1 },
  ];
  const created: number[] = [];
  for (const b of bills) {
    const r = await call(`${UW}/api/bills`, "POST", b);
    const row = r.json as { id: number };
    created.push(row.id);
    console.log(`   #${row.id} ${b.name.padEnd(8)} ${usd(b.amountMicro).padStart(7)}  priority ${b.priority}`);
  }

  // --- 3. plan --------------------------------------------------------------
  heading(3, "Planner reserves income against the bills");
  await sleep(6000);
  const plan = (await call(`${UW}/api/plan`)).json as {
    reservedMicro: string;
    discretionaryMicro: string;
    reservations: { billId: number; merchantId: string; amountMicro: string; status: string }[];
    forecast: { name: string; covered: boolean; shortfallMicro: string }[];
  };
  for (const r of plan.reservations) {
    console.log(`   bill #${r.billId} ${r.merchantId.padEnd(14)} ${usd(r.amountMicro).padStart(7)}  ${r.status}`);
  }
  console.log(`   reserved ${usd(plan.reservedMicro)}   discretionary ${usd(plan.discretionaryMicro)}`);
  for (const f of plan.forecast) {
    console.log(`   forecast ${f.name.padEnd(8)} ${f.covered ? "covered" : `SHORT by ${usd(f.shortfallMicro)}`}`);
  }

  const netflixId = created[0];
  const spotifyId = created[1];

  // --- 4. overcharge --------------------------------------------------------
  heading(4, "A biller overcharges — per-merchant cap stops it");
  const bad = (await call(`${BILLER}/control/charge-excess/${spotifyId}`, "POST")).json as {
    approved: boolean;
    reason: string;
  };
  console.log(`   ${bad.approved ? "APPROVED" : "DECLINED"}  ${bad.reason}`);

  // --- 5. legitimate charge -------------------------------------------------
  heading(5, "The real bill charges and is paid from earned income");
  const good = (await call(`${BILLER}/control/charge/${netflixId}`, "POST")).json as {
    approved: boolean;
    reason: string;
  };
  console.log(`   ${good.approved ? "APPROVED" : "DECLINED"}  ${good.reason}`);

  // --- 6. invariant ---------------------------------------------------------
  heading(6, "Reservation consumed — discretionary credit untouched");
  const after = (await call(`${UW}/api/plan`)).json as {
    reservedMicro: string;
    discretionaryMicro: string;
  };
  console.log(`   reserved ${usd(plan.reservedMicro)} -> ${usd(after.reservedMicro)}`);
  console.log(`   discretionary ${usd(plan.discretionaryMicro)} -> ${usd(after.discretionaryMicro)}`);
  console.log(
    after.discretionaryMicro === plan.discretionaryMicro
      ? "   Paying a reserved bill did not touch discretionary credit."
      : "   WARNING: discretionary credit moved; the reservation split is wrong.",
  );

  console.log(`\nDashboard: http://localhost:5173\n`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
