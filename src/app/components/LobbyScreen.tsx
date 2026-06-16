import { useState, useEffect } from "react";
import { motion } from "motion/react";
import type { TeamSize } from "../App";
import type { Profile } from "../hooks/useProfile";
import { getRank } from "../hooks/useProfile";

export type Genre = "Rock" | "Hip-Hop" | "Pop" | "R&B" | "Freestyle";

interface Props {
  profile: Profile;
  onStart: (size: TeamSize, genre: Genre) => void;
}

const GENRES: { id: Genre; emoji: string; color: string }[] = [
  { id: "Rock",      emoji: "🎸", color: "#f87171" },
  { id: "Hip-Hop",   emoji: "🎤", color: "#fb923c" },
  { id: "Pop",       emoji: "✨", color: "#f472b6" },
  { id: "R&B",       emoji: "🎷", color: "#a855f7" },
  { id: "Freestyle", emoji: "🌀", color: "#22d3ee" },
];

// Simulated player counts that fluctuate a bit to feel alive
function useGenreCounts() {
  const base: Record<Genre, number> = { Rock: 14, "Hip-Hop": 22, Pop: 18, "R&B": 11, Freestyle: 8 };
  const [counts, setCounts] = useState(base);

  useEffect(() => {
    const id = setInterval(() => {
      setCounts(prev => {
        const next = { ...prev };
        (Object.keys(next) as Genre[]).forEach(g => {
          const delta = Math.floor(Math.random() * 3) - 1; // -1, 0, or +1
          next[g] = Math.max(3, next[g] + delta);
        });
        return next;
      });
    }, 3000);
    return () => clearInterval(id);
  }, []);

  return counts;
}

export function LobbyScreen({ profile, onStart }: Props) {
  const [selectedSize, setSelectedSize] = useState<TeamSize>(4);
  const [selectedGenre, setSelectedGenre] = useState<Genre>("Hip-Hop");
  const counts = useGenreCounts();
  const rank = getRank(profile.level);
  const xpPct = (profile.xp / profile.xpToNext) * 100;

  return (
    <div className="size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.1, duration: 0.6 } }}
        className="text-center mb-8"
      >
        <h1 className="text-5xl font-black tracking-tighter text-white" style={{ letterSpacing: "-0.04em" }}>
          BATTLE<span style={{ color: "#a855f7" }}> OF THE BANDS</span>
        </h1>
        <p className="text-white/40 text-xs mt-1 tracking-widest uppercase">Team Battle · Live Loop Creation</p>
      </motion.div>

      {/* Player Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1, transition: { delay: 0.15, duration: 0.5 } }}
        className="w-full max-w-sm rounded-2xl p-5 mb-5"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(24px)" }}
      >
        <div className="flex items-center gap-4 mb-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${profile.avatarColor}, #6366f1)` }}
          >
            {profile.displayName[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-semibold truncate">{profile.displayName}</div>
            <div className="text-white/40 text-xs">{rank}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-white font-black text-2xl leading-none">Lv.{profile.level}</div>
            <div className="text-white/40 text-xs mt-0.5">{profile.wins}W / {profile.battles - profile.wins}L</div>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-white/35 mb-1.5">
            <span>XP</span>
            <span>{profile.xp} / {profile.xpToNext}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${xpPct}%` }}
              transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${profile.avatarColor}, #6366f1)` }}
            />
          </div>
        </div>
      </motion.div>

      {/* Genre Picker */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.2, duration: 0.5 } }}
        className="w-full max-w-sm mb-5"
      >
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3 text-center">Genre</p>
        <div className="grid grid-cols-5 gap-2">
          {GENRES.map(g => {
            const active = selectedGenre === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setSelectedGenre(g.id)}
                className="flex flex-col items-center gap-1.5 rounded-xl py-3 px-1 transition-all duration-200 active:scale-95"
                style={{
                  background: active ? `${g.color}22` : "rgba(255,255,255,0.04)",
                  border: active ? `1px solid ${g.color}66` : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span style={{ fontSize: "1.25rem" }}>{g.emoji}</span>
                <span className="text-xs font-semibold leading-tight text-center"
                  style={{ color: active ? g.color : "rgba(255,255,255,0.45)", fontSize: "0.65rem" }}>
                  {g.id}
                </span>
                <motion.span
                  key={counts[g.id]}
                  initial={{ scale: 1.3 }}
                  animate={{ scale: 1 }}
                  className="text-xs font-bold leading-none"
                  style={{ color: active ? g.color : "rgba(255,255,255,0.25)" }}
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
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3 text-center">Battle Format</p>
        <div className="grid grid-cols-2 gap-3">
          {([3, 4] as TeamSize[]).map(size => (
            <button
              key={size}
              onClick={() => setSelectedSize(size)}
              className="relative rounded-xl p-4 text-center transition-all duration-200 active:scale-95"
              style={{
                background: selectedSize === size ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.05)",
                border: selectedSize === size ? "1px solid rgba(168,85,247,0.6)" : "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="text-2xl font-black text-white">{size}v{size}</div>
              <div className="text-white/40 text-xs mt-0.5">{size === 3 ? "Quick Match" : "Full Battle"}</div>
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
          className="w-full py-4 rounded-xl text-white font-bold text-base tracking-wide transition-all duration-200 active:scale-95"
          style={{
            background: "linear-gradient(135deg, #a855f7, #6366f1)",
            boxShadow: "0 0 40px rgba(168,85,247,0.4)",
          }}
        >
          Find Battle · {selectedGenre}
        </button>
      </motion.div>
    </div>
  );
}
