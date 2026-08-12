import { useEffect, useRef, useState } from "react";
import { FlowButton } from "@/components/ui/flow-button";

/** Money arrives as micro-USD strings and stays integral until this function. */
function usd(micro: string | bigint, decimals = 2): string {
  const v = typeof micro === "bigint" ? micro : BigInt(micro || "0");
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const scale = 10n ** BigInt(6 - decimals);
  const scaled = (frac + scale / 2n) / scale;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${scaled.toString().padStart(decimals, "0")}`;
}

type FeedEvent =
  | { type: "receipt"; payer: string; amountMicro: string; timestamp: number }
  | {
      type: "limit";
      limitMicro: string;
      availableMicro: string;
      totalEarnedMicro: string;
      outstandingMicro: string;
      distinctPayers: number;
    }
  | {
      type: "auth";
      authId: string;
      amountMicro: string;
      merchantId: string;
      approved: boolean;
      reason: string;
      elapsedMs: number;
    }
  | { type: "card"; cardId: string; last4: string; limitMicro: string }
  | { type: "log"; level: string; message: string };

interface Snapshot {
  profile: { earnedInWindowMicro: string; distinctPayers: number; totalEarnedMicro: string };
  limit: {
    projectedMicro: string;
    limitMicro: string;
    outstandingMicro: string;
    availableMicro: string;
  };
  card: { cardId: string; last4: string; limitMicro: string } | null;
  events: FeedEvent[];
}

interface Plan {
  reservedMicro: string;
  discretionaryMicro: string;
  reservations: { billId: number; merchantId: string; amountMicro: string; status: string }[];
  forecast: {
    billId: number;
    name: string;
    covered: boolean;
    shortfallMicro: string;
    requiredMicro: string;
  }[];
}

const EMPTY_PLAN: Plan = { reservedMicro: "0", discretionaryMicro: "0", reservations: [], forecast: [] };

type DashboardPageProps = {
  onBack?: () => void;
};

export function DashboardPage({ onBack }: DashboardPageProps) {
  const [totalEarned, setTotalEarned] = useState(0n);
  const [limitMicro, setLimitMicro] = useState(0n);
  const [outstandingMicro, setOutstandingMicro] = useState(0n);
  const [payers, setPayers] = useState(0);
  const [card, setCard] = useState<Snapshot["card"]>(null);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [connected, setConnected] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/plan");
        if (alive && res.ok) setPlan((await res.json()) as Plan);
      } catch {
        /* underwriter restarting; the next tick recovers */
      }
    };
    void load();
    const t = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

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
        setOutstandingMicro(BigInt(s.limit.outstandingMicro));
        setPayers(s.profile.distinctPayers);
        setCard(s.card);
        setFeed(s.events);
        return;
      }

      if (data.type === "limit") {
        setLimitMicro(BigInt(data.limitMicro));
        setOutstandingMicro(BigInt(data.outstandingMicro));
        setTotalEarned(BigInt(data.totalEarnedMicro));
        setPayers(data.distinctPayers);
        return;
      }

      if (data.type === "card") {
        setCard({ cardId: data.cardId, last4: data.last4, limitMicro: data.limitMicro });
      }
      seq.current += 1;
      setFeed((f) => [data, ...f].slice(0, 8));
    };
    return () => es.close();
  }, []);

  const reserved = BigInt(plan.reservedMicro);
  const discretionary = BigInt(plan.discretionaryMicro);
  const denom = limitMicro > 0n ? limitMicro : 1n;
  const pct = (v: bigint) => `${Number((v * 10000n) / denom) / 100}%`;
  const shortfalls = plan.forecast.filter((f) => !f.covered);

  return (
    <div className="stage">
      <header className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="numeral shrink-0 text-2xl font-bold tracking-tight">FLOAT</span>
          <span className="label hidden sm:inline">an agent that earns its own credit</span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="label" style={{ color: connected ? "var(--green)" : "var(--red)" }}>
            {connected ? "● live" : "○ disconnected"}
          </span>
          {onBack && <FlowButton text="Agents" onClick={onBack} tone="dark" className="px-6 py-2.5 text-xs" />}
        </div>
      </header>

      <div className="row-2col">
        <section className="panel justify-center">
          <div className="label">Total earned onchain</div>
          <div className="numeral figure-xl mt-2">
            <span style={{ color: "var(--dim)" }}>$</span>
            {usd(totalEarned)}
          </div>
          <div className="label mt-3">
            {payers} distinct payer{payers === 1 ? "" : "s"} · settled over x402 on Monad
          </div>
        </section>

        <section className="panel justify-between">
          <div>
            <div className="label">Card</div>
            <div className="numeral figure-lg mt-2">•••• {card?.last4 ?? "————"}</div>
            <div className="label mt-1" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {card?.cardId ?? "not issued"}
            </div>
          </div>
          <div className="space-y-1">
            <Stat label="Spendable now" value={usd(discretionary)} color="var(--green)" />
            <Stat label="Reserved for bills" value={usd(reserved)} color="var(--amber)" />
            <Stat label="Spent" value={usd(outstandingMicro)} color="var(--blue)" />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="label">Credit limit</div>
            <div className="numeral figure-lg mt-1" style={{ color: "var(--green)" }}>
              <span style={{ color: "var(--dim)" }}>$</span>
              {usd(limitMicro)}
            </div>
          </div>
          <div className="label" style={{ textAlign: "right", whiteSpace: "normal" }}>
            backed by earnings · falls only when spent
          </div>
        </div>
        <div className="bar mt-3">
          <span style={{ width: pct(reserved), background: "var(--amber)" }} />
          <span style={{ width: pct(outstandingMicro), background: "var(--blue)" }} />
          <span style={{ width: pct(discretionary), background: "var(--green)" }} />
        </div>
        <div className="flex gap-5 mt-2">
          <Key color="var(--amber)" text="reserved" />
          <Key color="var(--blue)" text="spent" />
          <Key color="var(--green)" text="free" />
        </div>
      </section>

      <div className="row-2col" style={{ gridTemplateColumns: "1fr 2fr" }}>
        <section className="panel">
          <div className="label">Bills covered</div>
          <div className="scroller mt-2">
            {plan.reservations.length === 0 && (
              <div className="label" style={{ letterSpacing: "0.1em" }}>
                no reservations yet
              </div>
            )}
            {plan.reservations.slice(0, 5).map((r) => (
              <div key={r.billId} className="numeral feed-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="reason" style={{ textAlign: "left", opacity: 1 }}>
                  {r.merchantId}
                </span>
                <span style={{ color: r.status === "funded" ? "var(--green)" : "var(--amber)" }}>
                  ${usd(r.amountMicro)}
                </span>
              </div>
            ))}
            {shortfalls.length > 0 && (
              <div className="label mt-2" style={{ color: "var(--red)", whiteSpace: "normal" }}>
                {shortfalls.length} bill{shortfalls.length === 1 ? "" : "s"} short by $
                {usd(shortfalls.reduce((s, f) => s + BigInt(f.shortfallMicro), 0n))}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="label">Live feed</div>
          <div className="scroller mt-2">
            {feed.map((e, i) => (
              <FeedRow key={i} event={e} fresh={i === 0} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label">{label}</span>
      <span className="numeral figure-md" style={{ color }}>
        ${value}
      </span>
    </div>
  );
}

function Key({ color, text }: { color: string; text: string }) {
  return (
    <span className="label flex items-center gap-2">
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, display: "inline-block" }} />
      {text}
    </span>
  );
}

function FeedRow({ event, fresh }: { event: FeedEvent; fresh: boolean }) {
  if (event.type === "auth") {
    const ok = event.approved;
    return (
      <div
        className={`numeral feed-row ${!ok && fresh ? "flash-decline" : ""}`}
        style={{ color: ok ? "var(--green)" : "var(--red)" }}
      >
        <span className="font-bold">
          {ok ? "APPROVED" : "DECLINED"} ${usd(event.amountMicro)} · {event.merchantId}
        </span>
        <span className="reason">
          {event.reason} · {event.elapsedMs.toFixed(2)}ms
        </span>
      </div>
    );
  }

  if (event.type === "receipt") {
    return (
      <div className="numeral feed-row" style={{ color: "var(--dim)" }}>
        <span>receipt ${usd(event.amountMicro)}</span>
        <span className="reason">from {event.payer.slice(0, 12)}… · onchain</span>
      </div>
    );
  }

  if (event.type === "card") {
    return (
      <div className="numeral feed-row" style={{ color: "var(--amber)" }}>
        <span>card ••••{event.last4}</span>
        <span className="reason">scope ${usd(event.limitMicro)}</span>
      </div>
    );
  }

  if (event.type === "log") {
    return (
      <div className="numeral feed-row" style={{ color: event.level === "warn" ? "var(--amber)" : "var(--dim)" }}>
        <span>{event.message}</span>
        <span className="reason" />
      </div>
    );
  }

  return null;
}
