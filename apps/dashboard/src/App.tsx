import { useEffect, useRef, useState } from "react";

/** Money arrives as micro-USD strings and stays integral until this function. */
function usd(micro: string | bigint, decimals = 2): string {
  const v = typeof micro === "bigint" ? micro : BigInt(micro || "0");
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const scale = 10n ** BigInt(6 - decimals);
  const scaled = (frac + scale / 2n) / scale;
  const s = `${whole}.${scaled.toString().padStart(decimals, "0")}`;
  return (neg ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d)\.)/, ",");
}

interface Snapshot {
  profile: { earnedInWindowMicro: string; distinctPayers: number; totalEarnedMicro: string };
  limit: { limitMicro: string; outstandingMicro: string; availableMicro: string };
  card: { cardId: string; last4: string; limitMicro: string } | null;
  incomeRunning: boolean;
  events: FeedEvent[];
}

type FeedEvent =
  | { type: "receipt"; payer: string; amountMicro: string; timestamp: number }
  | { type: "limit"; limitMicro: string; availableMicro: string; totalEarnedMicro: string; outstandingMicro: string; distinctPayers: number }
  | { type: "auth"; authId: string; amountMicro: string; merchantId: string; approved: boolean; reason: string; elapsedMs: number }
  | { type: "card"; cardId: string; last4: string; limitMicro: string }
  | { type: "log"; level: string; message: string };

/** Gauge is drawn against the underwriting cap ($200). */
const CAP_MICRO: bigint = 200_000_000n;

export default function App() {
  const [totalEarned, setTotalEarned] = useState(0n);
  const [limitMicro, setLimitMicro] = useState(0n);
  const [availableMicro, setAvailableMicro] = useState(0n);
  const [outstandingMicro, setOutstandingMicro] = useState(0n);
  const [payers, setPayers] = useState(0);
  const [card, setCard] = useState<Snapshot["card"]>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const prevLimit = useRef(0n);
  const [rising, setRising] = useState(true);

  function applyLimit(e: Extract<FeedEvent, { type: "limit" }>) {
    const next = BigInt(e.limitMicro);
    setRising(next >= prevLimit.current);
    prevLimit.current = next;
    setLimitMicro(next);
    setAvailableMicro(BigInt(e.availableMicro));
    setOutstandingMicro(BigInt(e.outstandingMicro));
    setTotalEarned(BigInt(e.totalEarnedMicro));
    setPayers(e.distinctPayers);
  }

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const data = JSON.parse(msg.data) as FeedEvent | { type: "snapshot"; snapshot: Snapshot };

      if (data.type === "snapshot") {
        const s = data.snapshot;
        setTotalEarned(BigInt(s.profile.totalEarnedMicro));
        setLimitMicro(BigInt(s.limit.limitMicro));
        setAvailableMicro(BigInt(s.limit.availableMicro));
        setOutstandingMicro(BigInt(s.limit.outstandingMicro));
        setPayers(s.profile.distinctPayers);
        setCard(s.card);
        setFeed(s.events);
        prevLimit.current = BigInt(s.limit.limitMicro);
        return;
      }

      if (data.type === "limit") applyLimit(data);
      if (data.type === "card") setCard({ cardId: data.cardId, last4: data.last4, limitMicro: data.limitMicro });
      if (data.type !== "limit") setFeed((f) => [data, ...f].slice(0, 12));
    };
    return () => es.close();
  }, []);

  const pct = Number((limitMicro * 1000n) / CAP_MICRO) / 10;

  return (
    <div className="h-full flex flex-col gap-5 p-8">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-4">
          <span className="numeral text-3xl font-bold tracking-tight">FLOAT</span>
          <span className="label">an agent that earns its own credit</span>
        </div>
        <span className="label" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
          {connected ? "● live" : "○ disconnected"}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">
        {/* EARNED — the largest thing on screen. */}
        <section className="panel col-span-2 p-8 flex flex-col justify-center">
          <div className="label mb-3">Total earned onchain</div>
          <div className="numeral font-bold leading-none" style={{ fontSize: "clamp(4rem,11vw,10rem)" }}>
            <span style={{ color: "var(--dim)" }}>$</span>
            {usd(totalEarned)}
          </div>
          <div className="label mt-6">
            {payers} distinct payer{payers === 1 ? "" : "s"} · settled over x402 on Monad
          </div>
        </section>

        {/* CARD */}
        <section className="panel p-8 flex flex-col justify-between">
          <div>
            <div className="label mb-3">Card</div>
            <div className="numeral text-5xl font-bold">
              •••• {card?.last4 ?? "————"}
            </div>
            <div className="label mt-2">{card?.cardId ?? "not issued"}</div>
          </div>
          <div className="space-y-3">
            <Row label="Available" value={`$${usd(availableMicro)}`} color="var(--green)" />
            <Row label="Outstanding" value={`$${usd(outstandingMicro)}`} color="var(--amber)" />
          </div>
        </section>
      </div>

      {/* CREDIT LIMIT */}
      <section className="panel p-8">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="label mb-2">Credit limit</div>
            <div
              className="numeral font-bold leading-none"
              style={{ fontSize: "clamp(3rem,7vw,6rem)", color: rising ? "var(--green)" : "var(--red)" }}
            >
              <span style={{ color: "var(--dim)" }}>$</span>
              {usd(limitMicro)}
            </div>
          </div>
          <div className="label">{rising ? "▲ rising with earnings" : "▼ decaying — income stopped"}</div>
        </div>
        <div className="h-4 rounded-full overflow-hidden" style={{ background: "#111823" }}>
          <div
            className="gauge-fill h-full rounded-full"
            style={{
              width: `${Math.min(100, pct)}%`,
              backgroundColor: rising ? "var(--green)" : "var(--red)",
            }}
          />
        </div>
      </section>

      {/* LIVE FEED */}
      <section className="panel p-6 flex-1 min-h-0 overflow-hidden">
        <div className="label mb-3">Live feed</div>
        <div className="space-y-1">
          {feed.map((e, i) => (
            <FeedRow key={i} event={e} fresh={i === 0} />
          ))}
        </div>
      </section>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="label">{label}</span>
      <span className="numeral text-2xl font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function FeedRow({ event, fresh }: { event: FeedEvent; fresh: boolean }) {
  if (event.type === "auth") {
    const ok = event.approved;
    return (
      <div
        className={`numeral flex items-baseline justify-between px-3 py-2 rounded ${!ok && fresh ? "flash-decline" : ""}`}
        style={{ color: ok ? "var(--green)" : "var(--red)", fontSize: "1.35rem" }}
      >
        <span className="font-bold">
          {ok ? "APPROVED" : "DECLINED"} ${usd(event.amountMicro)} · {event.merchantId}
        </span>
        <span style={{ opacity: 0.75 }}>
          {event.reason} · {event.elapsedMs.toFixed(1)}ms
        </span>
      </div>
    );
  }

  if (event.type === "receipt") {
    return (
      <div className="numeral flex items-baseline justify-between px-3 py-1" style={{ color: "var(--dim)", fontSize: "1.1rem" }}>
        <span>receipt ${usd(event.amountMicro)} from {event.payer.slice(0, 10)}…</span>
        <span>onchain</span>
      </div>
    );
  }

  if (event.type === "card") {
    return (
      <div className="numeral px-3 py-1" style={{ color: "var(--amber)", fontSize: "1.1rem" }}>
        card {event.cardId} ••••{event.last4} scope ${usd(event.limitMicro)}
      </div>
    );
  }

  if (event.type === "log") {
    return (
      <div className="numeral px-3 py-1" style={{ color: "var(--dim)", fontSize: "1.1rem" }}>
        {event.message}
      </div>
    );
  }

  return null;
}
