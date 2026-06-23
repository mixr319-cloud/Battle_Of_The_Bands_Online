import { motion } from "motion/react";

interface Props {
  /** Smaller size for in-game headers vs. the full lobby logo. */
  size?: "lg" | "md";
  tagline?: string;
}

/**
 * The glowing "BATTLE OF THE BANDS" wordmark with a soft purple spotlight
 * behind it and a shimmering gradient sweep across "OF THE BANDS".
 * Shared across lobby, finding, game, and voting screens for a consistent identity.
 */
export function GlowTitle({ size = "lg", tagline }: Props) {
  const fontSize = size === "lg" ? "clamp(2.25rem, 4vw, 3.25rem)" : "clamp(1.35rem, 2.4vw, 1.75rem)";
  const spotlightSize = size === "lg" ? { w: 560, h: 280 } : { w: 380, h: 180 };

  return (
    <div className="relative text-center" style={{ marginBottom: tagline ? 8 : 0 }}>
      <motion.div
        className="absolute left-1/2 z-0"
        style={{
          top: -spotlightSize.h * 0.35,
          width: spotlightSize.w,
          height: spotlightSize.h,
          transform: "translateX(-50%)",
          background: "radial-gradient(ellipse at center, rgba(168,85,247,0.4) 0%, rgba(168,85,247,0.14) 40%, transparent 75%)",
          filter: "blur(8px)",
        }}
        animate={{ opacity: [0.7, 1, 0.7], scale: [1, 1.07, 1] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <h1
        className="relative z-10 font-black tracking-tighter text-white"
        style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize,
          letterSpacing: "-0.03em",
          lineHeight: 1.05,
          textShadow: "0 0 10px rgba(255,255,255,0.5), 0 0 28px rgba(168,85,247,0.85), 0 0 56px rgba(168,85,247,0.55)",
        }}
      >
        BATTLE{" "}
        <span
          style={{
            background: "linear-gradient(90deg, #c084fc, #ec4899, #22d3ee)",
            backgroundSize: "200% auto",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            textShadow: "none",
            filter: "drop-shadow(0 0 22px rgba(236,72,153,0.5))",
            animation: "bb-shimmer 5s linear infinite",
          }}
        >
          OF THE BANDS
        </span>
      </h1>
      {tagline && (
        <p
          className="relative z-10 mt-2 text-xs uppercase tracking-widest font-semibold"
          style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.3em" }}
        >
          {tagline}
        </p>
      )}
    </div>
  );
}
