/**
 * PremiumModal — shown when user clicks "Upgrade to BOTB Premium"
 * Displays the 3 perks and triggers Stripe Checkout at $4.30/mo.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface Props {
  open: boolean;
  onClose: () => void;
  onCheckout: () => Promise<void>;
}

const PERKS = [
  {
    icon: "💬",
    title: "In-Game Chat",
    desc: "Chat with your bandmates and rivals mid-battle using fun music emojis. Express yourself! 🎸🥁🎤🎹",
  },
  {
    icon: "🖼️",
    title: "Custom Profile Pic",
    desc: "Upload any image as your avatar. Show off your vibe instead of a letter.",
  },
  {
    icon: "🌐",
    title: "Social Profiles",
    desc: "Link your TikTok & Instagram, write a bio, and browse other premium players' profiles — follow your favorites.",
  },
];

export function PremiumModal({ open, onClose, onCheckout }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      await onCheckout();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 280, damping: 26 } }}
            exit={{ opacity: 0, scale: 0.92, y: 24, transition: { duration: 0.18 } }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-md rounded-2xl overflow-hidden"
              style={{
                background: "rgba(10,7,22,0.98)",
                border: "1px solid rgba(168,85,247,0.4)",
                boxShadow: "0 0 60px rgba(168,85,247,0.25), 0 32px 80px rgba(0,0,0,0.9)",
              }}
            >
              {/* Rainbow top bar */}
              <div className="h-1" style={{ background: "linear-gradient(90deg, #a855f7, #6366f1, #22d3ee, #34d399)" }} />

              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl">👑</span>
                      <h2 className="text-white font-black text-xl">BOTB Premium</h2>
                    </div>
                    <p className="text-white/50 text-sm">Unlock the full Band experience</p>
                  </div>
                  <button
                    onClick={onClose}
                    className="text-white/30 hover:text-white/60 transition-colors text-xl leading-none mt-0.5"
                  >
                    ✕
                  </button>
                </div>

                {/* Price badge */}
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-5 text-sm font-bold"
                  style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)", color: "#c084fc" }}
                >
                  <span>$4.30</span>
                  <span className="font-normal text-white/40">/ month</span>
                  <span className="text-white/25">·</span>
                  <span className="font-normal text-white/40">cancel anytime</span>
                </div>

                {/* Perks */}
                <div className="space-y-3 mb-6">
                  {PERKS.map((perk) => (
                    <div
                      key={perk.title}
                      className="flex gap-3 rounded-xl p-3.5"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      <span className="text-xl shrink-0 mt-0.5">{perk.icon}</span>
                      <div>
                        <div className="text-white font-bold text-sm">{perk.title}</div>
                        <div className="text-white/45 text-xs mt-0.5 leading-relaxed">{perk.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="mb-4 px-3 py-2 rounded-lg text-xs text-red-400 bg-red-500/10 border border-red-500/20">
                    {error}
                  </div>
                )}

                {/* CTA */}
                <motion.button
                  onClick={handleCheckout}
                  disabled={loading}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-3.5 rounded-xl font-black text-sm text-white transition-opacity disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)" }}
                >
                  {loading ? "Redirecting to checkout…" : "Upgrade Now — $4.30/mo"}
                </motion.button>

                <p className="text-center text-white/25 text-xs mt-3">
                  Secured by Stripe · Cancel in your account anytime
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
