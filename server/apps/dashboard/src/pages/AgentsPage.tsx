import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeftRight, Coins, CreditCard, Radio, Sparkles } from "lucide-react";
import { FlowButton } from "@/components/ui/flow-button";
import { BloimAnimationBackground } from "@/components/ui/bloim-animation-background";

type AgentsPageProps = {
  onBack: () => void;
  onContinue: () => void;
};

const LEFT_EVENTS = [
  { id: "l1", label: "x402 settle", detail: "+$0.05 USDC · price lookup" },
  { id: "l2", label: "Receipt batch", detail: "3 calls → CreditFile" },
  { id: "l3", label: "Earnings tick", detail: "window +$0.15" },
];

const RIGHT_EVENTS = [
  { id: "r1", label: "Limit sync", detail: "projected → card scope" },
  { id: "r2", label: "Auth decide", detail: "APPROVED · 0.03ms" },
  { id: "r3", label: "Reserve bill", detail: "rent covered 62%" },
];

export function AgentsPage({ onBack, onContinue }: AgentsPageProps) {
  const [pulse, setPulse] = useState(0);
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setPulse((p) => p + 1);
      setLeftIdx((i) => (i + 1) % LEFT_EVENTS.length);
      setRightIdx((i) => (i + 1) % RIGHT_EVENTS.length);
    }, 2200);
    return () => clearInterval(t);
  }, []);

  const left = LEFT_EVENTS[leftIdx]!;
  const right = RIGHT_EVENTS[rightIdx]!;

  return (
    <div className="agents-stage relative min-h-screen w-full overflow-hidden text-[var(--text)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#05070a_0%,#0a1018_100%)]" />

      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 md:px-10">
        <FlowButton text="Back" onClick={onBack} tone="dark" className="px-6 py-2.5 text-xs" />
        <span className="label flex items-center gap-2 text-[var(--green)]">
          <Radio className="h-3.5 w-3.5 animate-pulse" />
          agents coordinating
        </span>
        <FlowButton text="Open treasury" onClick={onContinue} tone="dark" />
      </header>

      <div className="relative z-10 grid min-h-[calc(100vh-5.5rem)] grid-cols-1 gap-4 px-4 pb-6 md:grid-cols-[1fr_auto_1fr] md:gap-0 md:px-8">
        {/* Left agent box */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="min-h-[420px] md:min-h-0"
        >
          <BloimAnimationBackground
            accent="#3fdc84"
            className="h-full min-h-[420px] rounded-2xl border border-white/10 md:min-h-full"
          >
            <div className="flex h-full flex-col justify-center px-8 py-10 md:px-12">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--green)]/15 text-[var(--green)]">
                  <Coins className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-display text-3xl tracking-tight md:text-4xl">Seller Agent</div>
                  <div className="label mt-1 text-[var(--dim)]">earns onchain · x402</div>
                </div>
              </div>

              <p className="mb-8 max-w-md text-base leading-relaxed text-slate-300/90">
                Sells price lookups, scrapes, and shop queries. Every paid call settles in USDC and lands
                as a receipt on Monad.
              </p>

              <AnimatePresence mode="wait">
                <motion.div
                  key={left.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                  className="rounded-2xl border border-[var(--green)]/30 bg-black/35 px-5 py-4 backdrop-blur-sm"
                >
                  <div className="label text-[var(--green)]">{left.label}</div>
                  <div className="numeral mt-1 text-xl text-[var(--text)]">{left.detail}</div>
                </motion.div>
              </AnimatePresence>

              <ul className="mt-8 space-y-2 text-sm text-slate-400">
                <li>· payTo wallet per service identity</li>
                <li>· batched CreditFile receipts</li>
                <li>· income visible to the underwriter</li>
              </ul>
            </div>
          </BloimAnimationBackground>
        </motion.div>

        {/* Center coordination rail */}
        <div className="relative flex items-center justify-center px-2 py-4 md:px-8">
          <div className="absolute inset-y-10 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/20 to-transparent md:block" />
          <motion.div
            key={pulse}
            initial={{ scale: 0.85, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative z-10 flex flex-col items-center gap-3 rounded-full border border-white/15 bg-[#0c121a]/90 px-4 py-5 shadow-[0_0_40px_rgba(63,220,132,0.12)] backdrop-blur"
          >
            <ArrowLeftRight className="h-5 w-5 text-[var(--amber)]" />
            <span className="label text-center text-[10px] leading-tight text-[var(--dim)]">
              sync
              <br />
              500ms
            </span>
            <Sparkles className="h-4 w-4 text-[var(--blue)]" />
          </motion.div>

          <motion.span
            key={`packet-l-${pulse}`}
            className="pointer-events-none absolute left-[15%] top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--green)] md:block"
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: 80, opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />
          <motion.span
            key={`packet-r-${pulse}`}
            className="pointer-events-none absolute right-[15%] top-1/2 hidden h-2 w-2 -translate-y-1/2 rounded-full bg-[var(--blue)] md:block"
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: -80, opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeInOut", delay: 0.15 }}
          />
        </div>

        {/* Right agent box */}
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.08 }}
          className="min-h-[420px] md:min-h-0"
        >
          <BloimAnimationBackground
            accent="#5aa9ff"
            className="h-full min-h-[420px] rounded-2xl border border-white/10 md:min-h-full"
          >
            <div className="flex h-full flex-col justify-center px-8 py-10 md:px-12">
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--blue)]/15 text-[var(--blue)]">
                  <CreditCard className="h-6 w-6" />
                </div>
                <div>
                  <div className="font-display text-3xl tracking-tight md:text-4xl">Underwriter</div>
                  <div className="label mt-1 text-[var(--dim)]">credit from proofs · Rain</div>
                </div>
              </div>

              <p className="mb-8 max-w-md text-base leading-relaxed text-slate-300/90">
                Watches onchain receipts, projects a spendable limit, syncs a Rain scoped card, and
                decides authorizations inside the auth window.
              </p>

              <AnimatePresence mode="wait">
                <motion.div
                  key={right.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35 }}
                  className="rounded-2xl border border-[var(--blue)]/30 bg-black/35 px-5 py-4 backdrop-blur-sm"
                >
                  <div className="label text-[var(--blue)]">{right.label}</div>
                  <div className="numeral mt-1 text-xl text-[var(--text)]">{right.detail}</div>
                </motion.div>
              </AnimatePresence>

              <ul className="mt-8 space-y-2 text-sm text-slate-400">
                <li>· memory-only auth path</li>
                <li>· bill reservations first</li>
                <li>· decline on timeout, never hang</li>
              </ul>
            </div>
          </BloimAnimationBackground>
        </motion.div>
      </div>
    </div>
  );
}
