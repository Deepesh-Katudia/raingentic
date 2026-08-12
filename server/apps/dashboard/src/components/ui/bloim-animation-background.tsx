import { type ReactNode } from "react";
import { motion } from "framer-motion";

type BloimAnimationBackgroundProps = {
  children?: ReactNode;
  className?: string;
  /** Accent for blooms / corner ticks — seller green or underwriter blue */
  accent?: string;
};

/**
 * Bloom animation background (21st.dev bloim-animation-background style).
 * Soft expanding blooms + corner ticks — meant to sit behind agent panels.
 */
export function BloimAnimationBackground({
  children,
  className = "",
  accent = "#3fdc84",
}: BloimAnimationBackgroundProps) {
  return (
    <div className={`relative isolate overflow-hidden ${className}`}>
      <div className="pointer-events-none absolute inset-0 bg-[#070b10]" />

      {/* Corner blooms */}
      <BloomOrb accent={accent} className="-left-[18%] -top-[22%]" delay={0} size="42%" />
      <BloomOrb accent={accent} className="-right-[20%] -bottom-[24%]" delay={1.2} size="48%" />
      <BloomOrb accent={accent} className="-left-[10%] -bottom-[28%]" delay={2.4} size="34%" opacity={0.35} />
      <BloomOrb accent={accent} className="-right-[12%] -top-[18%]" delay={0.6} size="30%" opacity={0.3} />

      {/* Expanding bloom rings from center */}
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full border"
          style={{
            borderColor: accent,
            width: 80,
            height: 80,
            marginLeft: -40,
            marginTop: -40,
          }}
          initial={{ scale: 0.4, opacity: 0.45 }}
          animate={{ scale: [0.4, 3.2], opacity: [0.4, 0] }}
          transition={{
            duration: 5.5,
            repeat: Number.POSITIVE_INFINITY,
            delay: i * 1.8,
            ease: "easeOut",
          }}
        />
      ))}

      {/* Soft vignette so content stays readable */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(5,7,10,0.72)_100%)]" />

      {/* Box corners */}
      <Corner accent={accent} placement="tl" />
      <Corner accent={accent} placement="tr" />
      <Corner accent={accent} placement="bl" />
      <Corner accent={accent} placement="br" />

      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}

/** Registry-style default export name used by 21st.dev demos */
export function Component(props: BloimAnimationBackgroundProps) {
  return <BloimAnimationBackground {...props} />;
}

function BloomOrb({
  accent,
  className,
  delay,
  size,
  opacity = 0.55,
}: {
  accent: string;
  className: string;
  delay: number;
  size: string;
  opacity?: number;
}) {
  return (
    <motion.div
      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${accent} 0%, transparent 68%)`,
        opacity,
      }}
      animate={{
        scale: [1, 1.18, 0.94, 1],
        opacity: [opacity * 0.7, opacity, opacity * 0.55, opacity * 0.7],
      }}
      transition={{
        duration: 9,
        repeat: Number.POSITIVE_INFINITY,
        delay,
        ease: "easeInOut",
      }}
    />
  );
}

function Corner({
  accent,
  placement,
}: {
  accent: string;
  placement: "tl" | "tr" | "bl" | "br";
}) {
  const pos =
    placement === "tl"
      ? "left-3 top-3"
      : placement === "tr"
        ? "right-3 top-3"
        : placement === "bl"
          ? "bottom-3 left-3"
          : "bottom-3 right-3";

  const borders =
    placement === "tl"
      ? "border-l-2 border-t-2 rounded-tl-md"
      : placement === "tr"
        ? "border-r-2 border-t-2 rounded-tr-md"
        : placement === "bl"
          ? "border-b-2 border-l-2 rounded-bl-md"
          : "border-b-2 border-r-2 rounded-br-md";

  return (
    <motion.span
      className={`pointer-events-none absolute z-[2] h-7 w-7 ${pos} ${borders}`}
      style={{ borderColor: accent }}
      animate={{ opacity: [0.35, 0.95, 0.35] }}
      transition={{ duration: 3.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
    />
  );
}
