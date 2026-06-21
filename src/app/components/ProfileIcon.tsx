import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Profile } from "../hooks/useProfile";
import { getRank } from "../hooks/useProfile";

interface Props {
  profile: Profile;
  onLogout: () => void;
  onOpenPremium: () => void;
  onOpenProfile: () => void;
}

export function ProfileIcon({ profile, onLogout, onOpenPremium, onOpenProfile }: Props) {
  const [open, setOpen] = useState(false);
  const xpPct = (profile.xp / profile.xpToNext) * 100;
  const winRate = profile.battles > 0 ? Math.round((profile.wins / profile.battles) * 100) : 0;
  const rank = getRank(profile.level);

  const authBadge = profile.authType === "discord" ? { label: "Discord", color: "#5865F2" }
    : profile.authType === "google" ? { label: "Google", color: "#4285F4" }
    : { label: "Guest", color: "rgba(255,255,255,0.3)" };

  return (
    <>
      {/* Avatar button */}
      <motion.button
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        className="fixed top-4 left-4 z-50 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-lg overflow-hidden"
        style={{
          background: profile.avatarUrl
            ? "transparent"
            : `linear-gradient(135deg, ${profile.avatarColor}, #6366f1)`,
          boxShadow: `0 0 16px ${profile.avatarColor}66`,
          border: "2px solid rgba(255,255,255,0.15)",
        }}
        title="Your profile"
      >
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
        ) : (
          <>
            {profile.displayName[0].toUpperCase()}
            {profile.isPremium && (
              <span className="absolute -top-0.5 -right-0.5 text-[10px] leading-none">👑</span>
            )}
          </>
        )}
      </motion.button>

      {/* Panel backdrop */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60]"
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, x: -24, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1, transition: { type: "spring", stiffness: 300, damping: 28 } }}
              exit={{ opacity: 0, x: -24, scale: 0.97, transition: { duration: 0.18 } }}
              className="fixed top-4 left-4 z-[70] w-72 rounded-2xl overflow-hidden"
              style={{
                background: "rgba(10,7,22,0.97)",
                border: `1px solid ${profile.avatarColor}44`,
                boxShadow: `0 0 40px ${profile.avatarColor}22, 0 24px 60px rgba(0,0,0,0.8)`,
                backdropFilter: "blur(40px)",
              }}
            >
              <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${profile.avatarColor}, transparent)` }} />

              <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-lg font-black text-white"
                      style={{ background: `linear-gradient(135deg, ${profile.avatarColor}, #6366f1)` }}
                    >
                      {profile.avatarUrl
                        ? <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                        : profile.displayName[0].toUpperCase()
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <div className="text-white font-bold text-sm leading-tight">{profile.displayName}</div>
                        {profile.isPremium && <span className="text-xs">👑</span>}
                      </div>
                      <div className="text-white/40 text-xs mt-0.5">{rank}</div>
                      <span
                        className="inline-block text-xs px-1.5 py-0.5 rounded mt-1 font-medium"
                        style={{ background: `${authBadge.color}22`, color: authBadge.color, border: `1px solid ${authBadge.color}44` }}
                      >
                        {authBadge.label}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/60 transition-colors text-lg leading-none">✕</button>
                </div>

                {/* Level + XP */}
                <div className="rounded-xl p-4 mb-4"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-white font-black text-2xl">Lv. {profile.level}</span>
                    <span className="text-white/40 text-xs">{profile.xp} / {profile.xpToNext} XP</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${xpPct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className="h-full rounded-full"
                      style={{ background: `linear-gradient(90deg, ${profile.avatarColor}, #6366f1)` }}
                    />
                  </div>
                  <p className="text-white/25 text-xs mt-1.5">{profile.xpToNext - profile.xp} XP to level {profile.level + 1}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 mb-5">
                  {[
                    { label: "Battles", value: profile.battles },
                    { label: "Wins", value: profile.wins },
                    { label: "MVPs", value: profile.mvps },
                  ].map(s => (
                    <div key={s.label} className="rounded-xl p-3 text-center"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-white font-black text-lg leading-none">{s.value}</div>
                      <div className="text-white/35 text-xs mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Win rate */}
                <div className="flex items-center justify-between px-1 mb-4">
                  <span className="text-white/40 text-xs">Win Rate</span>
                  <span className="font-bold text-sm" style={{ color: winRate >= 50 ? "#34d399" : "rgba(255,255,255,0.5)" }}>
                    {winRate}%
                  </span>
                </div>

                {/* Premium CTA or Profile button */}
                {profile.isPremium ? (
                  <button
                    onClick={() => { setOpen(false); onOpenProfile(); }}
                    className="w-full py-2.5 rounded-xl text-xs font-bold mb-3 transition-all active:scale-95"
                    style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(99,102,241,0.2))", border: "1px solid rgba(168,85,247,0.35)", color: "#c084fc" }}
                  >
                    👑 My Premium Profile
                  </button>
                ) : (
                  <button
                    onClick={() => { setOpen(false); onOpenPremium(); }}
                    className="w-full py-2.5 rounded-xl text-xs font-bold mb-3 transition-all active:scale-95"
                    style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)", color: "white" }}
                  >
                    👑 Upgrade to BOTB Premium · $4.30/mo
                  </button>
                )}

                {/* Logout */}
                <button
                  onClick={() => { setOpen(false); onLogout(); }}
                  className="w-full py-2.5 rounded-xl text-xs font-medium transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                >
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
