import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

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
  const [npcWarning, setNpcWarning] = useState(false);
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

    // If after 10s we haven't started, show NPC warning
    const t = setTimeout(() => {
      setNpcWarning(true);
      setStatus("Filling remaining slots with AI players...");
    }, 10000);

    return () => { unsub(); clearTimeout(t); };
  }, [onMessage, onGameStart]);

  const placeholders = Array.from({ length: totalNeeded - 1 }, (_, i) => i);

  return (
    <div className="size-full flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl p-10 w-full max-w-sm text-center"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", backdropFilter: "blur(24px)" }}
      >
        <div className="relative w-20 h-20 mx-auto mb-6">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="absolute inset-0 rounded-full"
              style={{ border: "1px solid rgba(168,85,247,0.4)" }}
              animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.65, ease: "easeOut" }}
            />
          ))}
          <div className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.5)" }}>
            <span className="text-2xl">🎙</span>
          </div>
        </div>

        <p className="text-white font-semibold text-lg mb-1">{status}</p>
        <p className="text-white/40 text-sm mb-1">{teamSize}v{teamSize} · {genre}</p>

        {npcWarning && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 mb-6 rounded-xl px-4 py-3 text-sm"
            style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}
          >
            Not enough real players found — filling with AI bots!
          </motion.div>
        )}

        <div className="space-y-2 mt-4">
          <PlayerSlot name={displayName} ready />
          {placeholders.map((i) => (
            <PlayerSlot key={i} name={joined[i + 1] ?? "..."} ready={i + 1 < joined.length} />
          ))}
        </div>

        <p className="text-white/25 text-xs mt-6">
          {totalNeeded - joined.length > 0
            ? `Waiting for ${totalNeeded - joined.length} more player${totalNeeded - joined.length !== 1 ? "s" : ""}...`
            : "Starting soon!"}
        </p>
      </motion.div>
    </div>
  );
}

function PlayerSlot({ name, ready }: { name: string; ready: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="w-2 h-2 rounded-full transition-colors duration-300"
        style={{ background: ready ? "#a855f7" : "rgba(255,255,255,0.2)" }} />
      <span className="text-sm text-white/70 flex-1 text-left">{name}</span>
      {ready ? (
        <span className="text-xs text-purple-400">Ready</span>
      ) : (
        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}
          className="text-xs text-white/30">Joining...</motion.span>
      )}
    </motion.div>
  );
}
