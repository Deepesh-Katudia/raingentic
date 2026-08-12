import { ArrowRight } from "lucide-react";

type FlowButtonProps = {
  text?: string;
  onClick?: () => void;
  className?: string;
  /** light = dark ink on pale surfaces; dark = light ink on dark surfaces */
  tone?: "light" | "dark";
};

export function FlowButton({
  text = "Modern Button",
  onClick,
  className = "",
  tone = "light",
}: FlowButtonProps) {
  const isDark = tone === "dark";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group relative flex items-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] bg-transparent px-8 py-3 text-sm font-semibold cursor-pointer transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-transparent hover:rounded-[12px] active:scale-[0.95]",
        isDark
          ? "border-white/35 text-white hover:text-[#111111]"
          : "border-[#333333]/40 text-[#111111] hover:text-white",
        className,
      ].join(" ")}
    >
      <ArrowRight
        className={[
          "absolute z-[9] left-[-25%] h-4 w-4 fill-none transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:left-4",
          isDark
            ? "stroke-white group-hover:stroke-[#111111]"
            : "stroke-[#111111] group-hover:stroke-white",
        ].join(" ")}
      />

      <span className="relative z-[1] -translate-x-3 transition-all duration-[800ms] ease-out group-hover:translate-x-3">
        {text}
      </span>

      <span
        className={[
          "absolute top-1/2 left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:h-[220px] group-hover:w-[220px] group-hover:opacity-100",
          isDark ? "bg-white" : "bg-[#111111]",
        ].join(" ")}
      />

      <ArrowRight
        className={[
          "absolute z-[9] right-4 h-4 w-4 fill-none transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:right-[-25%]",
          isDark
            ? "stroke-white group-hover:stroke-[#111111]"
            : "stroke-[#111111] group-hover:stroke-white",
        ].join(" ")}
      />
    </button>
  );
}
