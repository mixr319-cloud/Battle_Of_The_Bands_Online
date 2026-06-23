import { useState, useEffect } from "react";
import { motion } from "motion/react";
import type { TeamSize } from "../App";
import type { Profile } from "../hooks/useProfile";
import { getRank } from "../hooks/useProfile";
import { GlowTitle } from "./GlowTitle";
import { SceneFX } from "./SceneFX";
import { StageCharacter } from "./StageCharacter";

export type Genre = "Rock" | "Hip-Hop" | "Pop" | "R&B" | "Freestyle";

interface Props {
  profile: Profile;
  onStart: (size: TeamSize, genre: Genre) => void;
  send: (msg: any) => void;
  onMessage: (handler: (msg: any) => void) => () => void;
}

const GENRES: { id: Genre; emoji: string; color: string }[] = [
  { id: "Rock",      emoji: "🎸", color: "#f87171" },
  { id: "Hip-Hop",   emoji: "🎤", color: "#fb923c" },
  { id: "Pop",       emoji: "✨", color: "#f472b6" },
  { id: "R&B",       emoji: "🎷", color: "#a855f7" },
  { id: "Freestyle", emoji: "🌀", color: "#22d3ee" },
];

// Hook to fetch real queue counts from server
function useGenreCounts(send: (msg: any) => void, onMessage: (handler: (msg: any) => void) => () => void) {
  const [counts, setCounts] = useState<Record<Genre, number>>({
    Rock: 0,
    "Hip-Hop": 0,
    Pop: 0,
    "R&B": 0,
    Freestyle: 0,
  });

  useEffect(() => {
    // Request queue counts from server immediately
    send({ type: "get_queue_counts" });

    // Listen for queue count updates
    const unsub = onMessage((msg) => {
      if (msg.type === "queue_counts") {
        setCounts(msg.counts as Record<Genre, number>);
      }
    });

    // Poll for updated counts every 3 seconds
    const interval = setInterval(() => {
      send({ type: "get_queue_counts" });
    }, 3000);

    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [send, onMessage]);

  return counts;
}

export function LobbyScreen({ profile, onStart, send, onMessage }: Props) {
  const [selectedSize, setSelectedSize] = useState<TeamSize>(4);
  const [selectedGenre, setSelectedGenre] = useState<Genre>("Hip-Hop");
  const counts = useGenreCounts(send, onMessage);
  const rank = getRank(profile.level);
  const xpPct = (profile.xp / profile.xpToNext) * 100;

  return (
    <div className="relative size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <SceneFX />

      {/* Symmetric flanking characters — mirrored, same size on both sides */}
      <StageCharacter character="guitarist" side="left" width={260} className="hidden lg:block" />
      <StageCharacter character="singer" side="right" width={260} className="hidden lg:block" />

      <div className="relative z-10 w-full flex flex-col items-center">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.1, duration: 0.6 } }}
          className="mb-9"
        >
          <GlowTitle tagline="Team Battle · Live Loop Creation" />
        </motion.div>

        {/* Player Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transition: { delay: 0.15, duration: 0.5 } }}
          className="bb-card w-full max-w-sm p-5 mb-5"
        >
          <div className="flex items-center gap-4 mb-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
              style={{
                background: `linear-gradient(135deg, ${profile.avatarColor}, #6366f1)`,
                boxShadow: "0 0 24px rgba(168,85,247,0.55), inset 0 0 0 1px rgba(255,255,255,0.25)",
              }}
            >
              {profile.displayName[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-semibold truncate">{profile.displayName}</div>
              <div
                className="text-xs font-semibold uppercase tracking-wide mt-0.5"
                style={{
                  background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                }}
              >
                {rank}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div
                className="font-black text-2xl leading-none text-white"
                style={{ fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 18px rgba(168,85,247,0.7)" }}
              >
                Lv.{profile.level}
              </div>
              <div className="text-white/40 text-xs mt-0.5">{profile.wins}W / {profile.battles - profile.wins}L</div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs text-white/35 mb-1.5">
              <span>XP</span>
              <span>{profile.xp} / {profile.xpToNext}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden relative">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpPct}%` }}
                transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
                className="h-full rounded-full relative overflow-hidden"
                style={{
                  background: `linear-gradient(90deg, ${profile.avatarColor}, #a855f7, #6366f1)`,
                  boxShadow: "0 0 12px rgba(168,85,247,0.8)",
                }}
              >
                <div
                  className="absolute inset-y-0 w-2/5"
                  style={{
                    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
                    animation: "bb-sweep 2.5s ease-in-out infinite",
                  }}
                />
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* Genre Picker */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.2, duration: 0.5 } }}
          className="bb-card w-full max-w-sm p-5 mb-5"
        >
          <p className="text-xs uppercase tracking-widest mb-3 text-center font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Genre</p>
          <div className="grid grid-cols-5 gap-2">
            {GENRES.map(g => {
              const active = selectedGenre === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setSelectedGenre(g.id)}
                  className="flex flex-col items-center gap-1.5 rounded-xl py-3 px-1 transition-all duration-200 active:scale-95"
                  style={{
                    background: active
                      ? "linear-gradient(160deg, rgba(236,72,153,0.22), rgba(168,85,247,0.12))"
                      : "rgba(255,255,255,0.035)",
                    border: active ? "1px solid rgba(236,72,153,0.55)" : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: active ? "0 0 24px -4px rgba(236,72,153,0.55), inset 0 0 0 1px rgba(236,72,153,0.2)" : "none",
                    transform: active ? "translateY(-2px)" : "none",
                  }}
                >
                  <span style={{ fontSize: "1.25rem" }}>{g.emoji}</span>
                  <span
                    className="text-xs font-bold leading-tight text-center"
                    style={{
                      color: active ? "#f9a8d4" : "rgba(255,255,255,0.45)",
                      fontSize: "0.65rem",
                      textShadow: active ? "0 0 10px rgba(236,72,153,0.6)" : "none",
                    }}
                  >
                    {g.id}
                  </span>
                  <motion.span
                    key={counts[g.id]}
                    initial={{ scale: 1.3 }}
                    animate={{ scale: 1 }}
                    className="text-xs font-bold leading-none"
                    style={{ color: active ? "#f9a8d4" : "rgba(255,255,255,0.25)" }}
                  >
                    {counts[g.id]}
                  </motion.span>
                </button>
              );
            })}
          </div>
          <p className="text-white/20 text-xs text-center mt-2">Players searching · updates live</p>
        </motion.div>

        {/* Format Select */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.28, duration: 0.5 } }}
          className="w-full max-w-sm mb-5"
        >
          <p className="text-xs uppercase tracking-widest mb-3 text-center font-bold" style={{ color: "rgba(255,255,255,0.5)" }}>Battle Format</p>
          <div className="grid grid-cols-2 gap-3">
            {([3, 4] as TeamSize[]).map(size => (
              <button
                key={size}
                onClick={() => setSelectedSize(size)}
                className="bb-card relative p-4 text-center transition-all duration-200 active:scale-95"
                style={{
                  background: selectedSize === size
                    ? "linear-gradient(160deg, rgba(34,211,238,0.16), rgba(99,102,241,0.12))"
                    : "rgba(255,255,255,0.05)",
                  borderColor: selectedSize === size ? "rgba(34,211,238,0.5)" : undefined,
                  boxShadow: selectedSize === size ? "0 0 24px -4px rgba(34,211,238,0.45), inset 0 0 0 1px rgba(34,211,238,0.25)" : undefined,
                }}
              >
                <div
                  className="text-2xl font-black"
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    color: selectedSize === size ? "#a5f3fc" : "#fff",
                    textShadow: selectedSize === size ? "0 0 16px rgba(34,211,238,0.85)" : "none",
                  }}
                >
                  {size}v{size}
                </div>
                <div
                  className="text-xs mt-0.5"
                  style={{ color: selectedSize === size ? "rgba(165,243,252,0.7)" : "rgba(255,255,255,0.4)" }}
                >
                  {size === 3 ? "Quick Match" : "Full Battle"}
                </div>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Play Button */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.35, duration: 0.5 } }}
          className="w-full max-w-sm"
        >
          <button
            onClick={() => onStart(selectedSize, selectedGenre)}
            className="relative w-full py-4 rounded-xl text-white font-bold text-base tracking-wide overflow-hidden active:scale-95"
            style={{
              background: "linear-gradient(120deg, #ec4899, #a855f7 50%, #6366f1)",
              animation: "bb-cta-breathe 2.4s ease-in-out infinite",
            }}
          >
            <span
              className="absolute top-0 h-full w-[30%]"
              style={{
                left: "-30%",
                background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.35), transparent)",
                animation: "bb-cta-shine 3s ease-in-out infinite",
              }}
            />
            <span className="relative">Find Battle · {selectedGenre}</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
