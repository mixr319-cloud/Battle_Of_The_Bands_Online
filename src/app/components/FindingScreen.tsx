import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";
import { GlowTitle } from "./GlowTitle";
import { SceneFX } from "./SceneFX";
import { StageCharacter } from "./StageCharacter";

interface Props {
  teamSize: number;
  genre: Genre;
  userId: string;
  displayName: string;
  avatarColor: string;
  level: number;
  xp: number;
  xpToNext: number;
  onGameStart: (gameState: Record<string, unknown>) => void;
  send: (msg: Record<string, unknown>) => void;
  onMessage: (handler: (msg: Record<string, unknown>) => void) => () => void;
}

export function FindingScreen({
  teamSize, genre, userId, displayName, avatarColor, level, xp, xpToNext,
  onGameStart, send, onMessage
}: Props) {
  const [joined, setJoined] = useState<string[]>([displayName]);
  const [status, setStatus] = useState("Searching for players...");
  const sentRef = useRef(false);
  const totalNeeded = teamSize * 2;

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    // Join matchmaking queue via WebSocket
    send({
      type: "join_queue",
      teamSize,
      genre,
      userId,
      displayName,
      color: avatarColor,
      level,
      xp,
      xpToNext,
    });
  }, []);

  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === "queued") {
        const needed = msg.playersNeeded as number;
        const found = msg.playersJoined as number;
        setStatus(`Found ${found} of ${needed} players...`);
      }
      if (msg.type === "player_joined") {
        const name = msg.displayName as string;
        setJoined(prev => [...prev, name]);
        setStatus(`${msg.playersJoined} of ${msg.playersNeeded} players ready`);
      }
      if (msg.type === "game_start") {
        onGameStart(msg as Record<string, unknown>);
      }
    });

    return () => { unsub(); };
  }, [onMessage, onGameStart]);

  const placeholders = Array.from({ length: totalNeeded - 1 }, (_, i) => i);

  return (
    <div className="relative size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <SceneFX />

      <StageCharacter character="guitarist" side="right" width={280} className="hidden lg:block opacity-90" />
      <StageCharacter character="singer" side="left" width={260} className="hidden lg:block opacity-90" />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.05, duration: 0.6 } }}
        className="relative z-10 mb-10"
      >
        <GlowTitle size="md" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 flex flex-col lg:flex-row items-center gap-12 lg:gap-20"
      >
        {/* Left: big pulsing radar avatar + status */}
        <div className="flex flex-col items-center w-full lg:w-[380px] shrink-0">
          <div className="relative w-44 h-44 mb-9">
            {[0, 1, 2].map(i => (
              <motion.div
                key={i}
                className="absolute inset-0 rounded-full"
                style={{ border: `2px solid ${["rgba(236,72,153,0.55)", "rgba(168,85,247,0.5)", "rgba(34,211,238,0.45)"][i]}` }}
                animate={{ scale: [0.5, 1.6], opacity: [0.9, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
              />
            ))}
            <motion.div
              className="absolute rounded-full flex items-center justify-center"
              style={{
                inset: 32,
                background:
                  "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.25), transparent 60%)," +
                  "linear-gradient(150deg, #ec4899, #a855f7 55%, #6366f1)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.25) inset, 0 0 50px rgba(236,72,153,0.55), 0 0 90px rgba(168,85,247,0.4)",
              }}
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            >
              <span className="text-5xl" style={{ textShadow: "0 0 14px rgba(255,255,255,0.7)" }}>🎙</span>
            </motion.div>
          </div>

          <p
            className="font-black text-2xl text-center text-white mb-2"
            style={{ fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 18px rgba(168,85,247,0.6)" }}
          >
            {status}
          </p>
          <p className="text-white/45 text-sm font-semibold mb-8 flex items-center gap-2">
            {teamSize}v{teamSize} <span className="text-cyan-400">●</span> {genre}
          </p>

          <div className="w-full max-w-xs">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "rgba(255,255,255,0.4)" }}>
              <span>Band filling up</span>
              <span style={{ color: "#f9a8d4", textShadow: "0 0 8px rgba(236,72,153,0.6)" }}>
                {Math.round((joined.length / totalNeeded) * 100)}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden relative">
              <motion.div
                className="h-full rounded-full relative overflow-hidden"
                style={{ background: "linear-gradient(90deg, #ec4899, #a855f7, #6366f1)", boxShadow: "0 0 14px rgba(168,85,247,0.85)" }}
                animate={{ width: `${(joined.length / totalNeeded) * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              >
                <div
                  className="absolute inset-y-0 w-[35%]"
                  style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)", animation: "bb-sweep 2.2s ease-in-out infinite" }}
                />
              </motion.div>
            </div>
          </div>
        </div>

        {/* Right: roster card */}
        <div className="bb-card w-full max-w-md p-6">
          <p className="text-xs uppercase tracking-widest text-center font-bold mb-4" style={{ color: "rgba(255,255,255,0.4)" }}>
            Lineup
          </p>
          <div className="space-y-2.5">
            <PlayerSlot name={displayName} ready isYou />
            {placeholders.map((i) => (
              <PlayerSlot key={i} name={joined[i + 1] ?? "..."} ready={i + 1 < joined.length} />
            ))}
          </div>

          <p className="text-white/35 text-sm text-center mt-5 font-medium">
            {totalNeeded - joined.length > 0 ? (
              <>Waiting for <span className="font-bold" style={{ color: "#d8b4fe" }}>
                {totalNeeded - joined.length} more player{totalNeeded - joined.length !== 1 ? "s" : ""}
              </span>…</>
            ) : (
              "Starting soon!"
            )}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

function PlayerSlot({ name, ready, isYou }: { name: string; ready: boolean; isYou?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3.5 rounded-2xl px-4 py-3.5 relative overflow-hidden"
      style={{
        background: ready
          ? "linear-gradient(160deg, rgba(236,72,153,0.14), rgba(168,85,247,0.06))"
          : "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
        border: ready ? "1px solid rgba(236,72,153,0.4)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: ready ? "0 0 18px -6px rgba(236,72,153,0.45)" : "none",
      }}
    >
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0 transition-colors duration-300"
        style={{
          background: ready ? "#ec4899" : "rgba(255,255,255,0.18)",
          boxShadow: ready ? "0 0 8px #ec4899, 0 0 16px rgba(236,72,153,0.6)" : "none",
        }}
      />
      <span className="text-sm font-semibold flex-1 text-left truncate" style={{ color: ready ? "#fce7f3" : "rgba(255,255,255,0.8)" }}>
        {name}
      </span>
      {isYou && (
        <span
          className="text-[10.5px] font-bold px-2 py-1 rounded-full shrink-0"
          style={{ background: "rgba(34,211,238,0.18)", color: "#a5f3fc", border: "1px solid rgba(34,211,238,0.4)", textShadow: "0 0 6px rgba(34,211,238,0.5)" }}
        >
          YOU
        </span>
      )}
      {ready ? (
        <span className="text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: "#f9a8d4" }}>Ready</span>
      ) : (
        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}
          className="text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>
          Joining…
        </motion.span>
      )}
    </motion.div>
  );
}
