import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Player, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";

interface Props {
  /** The loop that was just recorded */
  loop: Recording;
  /** The current player (used to determine if they are the recorder) */
  myPlayerId: string;
  /** The ID of whoever recorded the loop */
  recorderId: string;
  /** The name of whoever recorded the loop */
  recorderName: string;
  /** Players on this team */
  teamPlayers: Player[];
  /** Prior recordings from this team (backing stack for playback) */
  teamStack: Recording[];
  /** Called when this player has cast their vote */
  onVote: (vote: "keep" | "drop") => void;
  /** Called when the server comes back with the final result (shown to everyone) */
  result: { kept: boolean; keepCount: number; dropCount: number } | null;
}

export function LoopVoteModal({
  loop, myPlayerId, recorderId, recorderName, teamPlayers, teamStack, onVote, result,
}: Props) {
  const isRecorder = myPlayerId === recorderId;

  const [isPlaying, setIsPlaying] = useState(false);
  const [hasListened, setHasListened] = useState(false);
  const [voted, setVoted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<(AudioBufferSourceNode | null)[]>([]);
  const loopBufRef = useRef<AudioBuffer | null>(null);
  const stackBufsRef = useRef<AudioBuffer[]>([]);
  const decodedRef = useRef(false);

  function getCtx() {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  useEffect(() => {
    if (decodedRef.current) return;
    decodedRef.current = true;
    const ctx = getCtx();

    fetchRecordingArrayBuffer(loop)
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => { loopBufRef.current = decoded; })
      .catch(err => console.error("Failed to decode loop audio:", err));

    if (teamStack.length > 0) {
      Promise.all(
        teamStack.map(r =>
          fetchRecordingArrayBuffer(r)
            .then(b => ctx.decodeAudioData(b))
            .catch(() => null)
        )
      ).then(bufs => {
        stackBufsRef.current = bufs.filter((b): b is AudioBuffer => b !== null);
      });
    }
  }, []);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    nodesRef.current.forEach(n => { try { n?.stop(); } catch {} });
    nodesRef.current = [];
    setIsPlaying(false);
    // If they stopped playback manually they've heard enough — show vote buttons
    setHasListened(true);
  }

  function togglePlay() {
    if (isPlaying) { stopAll(); return; }
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    const startTime = ctx.currentTime + 0.05;
    const allNodes: AudioBufferSourceNode[] = [];

    stackBufsRef.current.forEach(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = false;
      src.connect(ctx.destination);
      src.start(startTime);
      allNodes.push(src);
    });

    if (loopBufRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = loopBufRef.current;
      src.loop = false;
      src.connect(ctx.destination);
      src.start(startTime);
      src.onended = () => { stopAll(); setHasListened(true); };
      allNodes.push(src);
    }

    nodesRef.current = allNodes;
    setIsPlaying(true);

    // Show vote buttons after 1.5s of listening regardless — don't force full playback
    setTimeout(() => setHasListened(true), 1500);
  }

  function castVote(value: "keep" | "drop") {
    setVoted(true);
    onVote(value);
  }

  const accentColor = "#a855f7";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(14px)" }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { type: "spring", stiffness: 280, damping: 28 } }}
        exit={{ y: 80, opacity: 0 }}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl relative overflow-hidden"
        style={{
          background: "rgba(8, 6, 18, 0.97)",
          border: "1px solid rgba(255,255,255,0.09)",
          backdropFilter: "blur(40px)",
          boxShadow: "0 -24px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* Glow */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: result ? (result.kept ? "#34d399" : "#f87171") : accentColor }} />

        <div className="p-6 pb-8">

          {/* ── RESULT OVERLAY ── */}
          <AnimatePresence>
            {result && (
              <motion.div
                key="reveal"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl gap-4"
                style={{ background: "rgba(8,6,18,0.97)" }}
              >
                <motion.div
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1, transition: { type: "spring", stiffness: 260, damping: 20 } }}
                  className="text-6xl"
                >
                  {result.kept ? "✅" : "🗑️"}
                </motion.div>
                <p className="text-white font-black text-2xl">
                  {result.kept ? "Loop Kept!" : "Loop Dropped"}
                </p>
                <p className="text-white/40 text-sm">
                  {result.keepCount} keep · {result.dropCount} drop
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="text-center mb-5">
            <span className="text-xs px-3 py-1 rounded-full font-medium uppercase tracking-widest"
              style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.1)" }}>
              Team Vote
            </span>
            <p className="text-white font-bold text-lg mt-3">
              Keep {recorderName}'s loop?
            </p>
            {isRecorder ? (
              <p className="text-white/35 text-sm mt-0.5">Waiting for your teammates to vote…</p>
            ) : (
              <p className="text-white/35 text-sm mt-0.5">Listen and cast your vote</p>
            )}
          </div>

          {/* Waveform + play — always shown so recorder can hear their own loop */}
          <div className="rounded-2xl p-4 mb-5"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="space-y-1.5 mb-4">
              {teamStack.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-white/25 text-xs w-14 truncate shrink-0">{r.playerName}</span>
                  <div className="flex items-center gap-px h-5 flex-1 rounded overflow-hidden">
                    {r.waveform.map((h, j) => (
                      <div key={j} className="flex-1 rounded-sm"
                        style={{
                          height: `${Math.max(8, h * 100)}%`,
                          background: isPlaying ? "rgba(168,85,247,0.55)" : "rgba(255,255,255,0.18)",
                          transition: "background 0.3s",
                        }} />
                    ))}
                  </div>
                </div>
              ))}
              {/* New loop — highlighted */}
              <div className="flex items-center gap-2">
                <span className="text-xs w-14 truncate shrink-0 font-semibold"
                  style={{ color: accentColor }}>{loop.playerName} ✦</span>
                <div className="flex items-center gap-px h-6 flex-1 rounded overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
                  {loop.waveform.length > 0
                    ? loop.waveform.map((h, j) => (
                        <div key={j} className="flex-1 rounded-sm"
                          style={{
                            height: `${Math.max(8, h * 100)}%`,
                            background: isPlaying ? `${accentColor}cc` : `${accentColor}77`,
                            transition: "background 0.3s",
                          }} />
                      ))
                    : <div className="w-full flex items-center justify-center">
                        <span className="text-white/20 text-xs">silent loop</span>
                      </div>
                  }
                </div>
              </div>
            </div>

            <button onClick={togglePlay}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
              style={{
                background: isPlaying ? `${accentColor}33` : "rgba(255,255,255,0.08)",
                border: `1px solid ${isPlaying ? accentColor + "66" : "rgba(255,255,255,0.1)"}`,
                color: isPlaying ? accentColor : "rgba(255,255,255,0.8)",
              }}>
              {isPlaying ? "⏹ Stop" : hasListened ? "▶ Play Again" : "▶ Listen First"}
            </button>
          </div>

          {/* ── VOTE BUTTONS (teammates only, before voting) ── */}
          <AnimatePresence>
            {!isRecorder && !voted && !result && (
              hasListened ? (
                <motion.div key="vote-btns" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3">
                  <button onClick={() => castVote("drop")}
                    className="flex-1 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95 flex flex-col items-center gap-1"
                    style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#fca5a5" }}>
                    <span className="text-2xl">🗑️</span>
                    Drop It
                  </button>
                  <button onClick={() => castVote("keep")}
                    className="flex-1 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95 flex flex-col items-center gap-1"
                    style={{ background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.35)", color: "#4ade80" }}>
                    <span className="text-2xl">✅</span>
                    Keep It
                  </button>
                </motion.div>
              ) : (
                <motion.p key="listen-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center text-white/30 text-sm py-3">
                  Listen to the loop before voting
                </motion.p>
              )
            )}
            {!isRecorder && voted && !result && (
              <motion.p key="voted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-center text-white/40 text-sm py-3">
                ✓ Vote submitted — waiting for teammates…
              </motion.p>
            )}
            {isRecorder && !result && (
              <motion.p key="recorder-wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-center text-white/30 text-sm py-3">
                Your teammates are listening…
              </motion.p>
            )}
          </AnimatePresence>

        </div>
      </motion.div>
    </motion.div>
  );
}
