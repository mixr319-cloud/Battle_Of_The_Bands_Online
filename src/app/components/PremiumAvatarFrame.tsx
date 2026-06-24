/**
 * PremiumAvatarFrame — wraps any avatar element (the colored initial circle,
 * an <img>, whatever) and, when isPremium is true, dresses it up with an
 * animated gold ring, a soft glow, and a small crown badge. Non-premium
 * avatars pass through untouched.
 *
 * Usage: just wrap the existing avatar markup —
 *   <PremiumAvatarFrame isPremium={player.isPremium} rounded="rounded-lg">
 *     <div className="w-8 h-8 rounded-lg ...">{player.name[0]}</div>
 *   </PremiumAvatarFrame>
 *
 * `rounded` should match the inner avatar's own corner-radius class so the
 * ring traces it exactly (rounded-full / rounded-lg / rounded-xl / rounded-2xl).
 */
import { motion } from "motion/react";
import type { ReactNode } from "react";

interface Props {
  isPremium?: boolean;
  rounded?: string;
  /** Tailwind text-size class for the crown emoji, e.g. "text-[10px]" or "text-sm". */
  crownSize?: string;
  /** Nudge the crown badge if the default corner placement clips against other UI. */
  crownClassName?: string;
  className?: string;
  children: ReactNode;
}

export function PremiumAvatarFrame({
  isPremium,
  rounded = "rounded-full",
  crownSize = "text-[10px]",
  crownClassName = "-top-1.5 -right-1.5",
  className = "",
  children,
}: Props) {
  if (!isPremium) return <>{children}</>;

  return (
    <div className={`relative inline-block ${className}`}>
      {children}

      {/* Animated gold ring traced around the avatar's own shape */}
      <motion.div
        className={`pointer-events-none absolute inset-0 ${rounded}`}
        style={{
          boxShadow: "0 0 0 2px #fcd34d, 0 0 0 3px rgba(0,0,0,0.35)",
        }}
        animate={{
          boxShadow: [
            "0 0 0 2px #fcd34d, 0 0 0 3px rgba(0,0,0,0.35), 0 0 10px 1px rgba(251,191,36,0.5)",
            "0 0 0 2px #fde68a, 0 0 0 3px rgba(0,0,0,0.35), 0 0 16px 3px rgba(251,191,36,0.85)",
            "0 0 0 2px #fcd34d, 0 0 0 3px rgba(0,0,0,0.35), 0 0 10px 1px rgba(251,191,36,0.5)",
          ],
        }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Crown badge */}
      <span
        className={`absolute ${crownClassName} ${crownSize} leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]`}
        title="BOTB Premium"
      >
        👑
      </span>
    </div>
  );
}
