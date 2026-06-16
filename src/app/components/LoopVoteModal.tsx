import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Player, Recording } from "../App";

interface Props {
  /** The loop that was just recorded */
  loop: Recording;
  /** All players on this team (they all vote) */
  teamPlayers: Player[];
  /** All prior recordings from this team (backing stack for playback) */
  teamStack: Recording[];
  /** Called when voting is complete */
  onResult: (kept: boolean) => void;
}

type VoteValue = "keep" | "drop" | null;

export function LoopVoteModal({ loop, teamPlayers, teamStack, onResult }: Props) {
  const [voterIdx, setVoterIdx] = useState(0);
  const [votes, setVotes] = useState<VoteValue[]>(Array(teamPlayers.length).fill(null));
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasListened, setHasListened] = useState(false);
  const [revealing, setRevealing] = useState(false);

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

  // Decode audio on mount
  useEffect(() => {
    if (decodedRef.current) return;
    decodedRef.current = true;
    const ctx = getCtx();

    loop.blob.arrayBuffer()
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => { loopBufRef.current = decoded; })
      .catch(console.error);

    if (teamStack.length > 0) {
      Promise.all(teamStack.map(r => r.blob.arrayBuffer().then(b => ctx.decodeAudioData(b))))
        .then(bufs => { stackBufsRef.current = bufs; })
        .catch(console.error);
    }
  }, []);

  // Reset listen state when voter changes
  useEffect(() => {
    stopAll();
    setHasListened(false);
  }, [voterIdx]);

  useEffect(() => () => stopAll(), []);

  function stopAll() {
    nodesRef.current.forEach(n => { try { n?.stop(); } catch {} });
    nodesRef.current = [];
    setIsPlaying(false);
  }

  function togglePlay() {
    if (isPlaying) {
      stopAll();
      return;
    }

    const ctx = getCtx();
    const startTime = ctx.currentTime + 0.05;
    const allNodes: AudioBufferSourceNode[] = [];

    // Play stack as backing first
    stackBufsRef.current.forEach(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = false;
      src.connect(ctx.destination);
      src.start(startTime);
      allNodes.push(src);
    });

    // Play the new loop on top
    if (loopBufRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = loopBufRef.current;
      src.loop = false;
      src.connect(ctx.destination);
      src.start(startTime);
      src.onended = () => {
        stopAll();
        setHasListened(true);
      };
      allNodes.push(src);
    } else {
      // No audio buffer yet — still mark as listened
      setTimeout(() => setHasListened(true), 500);
    }

    nodesRef.current = allNodes;
    setIsPlaying(true);
  }

  function castVote(value: "keep" | "drop") {
    const newVotes = [...votes];
    newVotes[voterIdx] = value;
    setVotes(newVotes);

    if (voterIdx + 1 < teamPlayers.length) {
      setVoterIdx(i => i + 1);
    } else {
      // All voted — tally
      setRevealing(true);
      const keepCount = newVotes.filter(v => v === "keep").length;
      const kept = keepCount > newVotes.length / 2; // majority
      setTimeout(() => onResult(kept), 2000);
    }
  }

  const voter = teamPlayers[voterIdx];
  const keepCount = votes.filter(v => v === "keep").length;
  const dropCount = votes.filter(v => v === "drop").length;

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
        {/* Colour glow behind voter */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: revealing ? "#34d399" : voter.color }} />

        <div className="p-6 pb-8">

          {/* Tally reveal overlay */}
          <AnimatePresence>
            {revealing && (
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
                  {keepCount > dropCount ? "✅" : "🗑️"}
                </motion.div>
                <p className="text-white font-black text-2xl">
                  {keepCount > dropCount ? "Loop Kept!" : "Loop Dropped"}
                </p>
                <p className="text-white/40 text-sm">
                  {keepCount} keep · {dropCount} drop
                </p>
                {/* Vote breakdown */}
                <div className="flex gap-2 mt-1">
                  {teamPlayers.map((p, i) => (
                    <div key={p.id} className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: p.color }}>
                        {p.name[0]}
                      </div>
                      <span className="text-sm">{votes[i] === "keep" ? "✓" : "✗"}</span>
                    </div>
                  ))}
                </div>
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
              Keep {loop.playerName}'s loop?
            </p>
            <p className="text-white/35 text-sm mt-0.5">
              Each teammate listens and votes before it joins the stack
            </p>
          </div>

          {/* Voter indicator */}
          <AnimatePresence mode="wait">
            <motion.div key={voterIdx}
              initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
              className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-5"
              style={{
                background: `${voter.color}18`,
                border: `1px solid ${voter.color}44`,
              }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ background: voter.color }}>
                {voter.name[0]}
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">{voter.name}'s vote</p>
                <p className="text-white/40 text-xs">
                  Voter {voterIdx + 1} of {teamPlayers.length}
                </p>
              </div>
              {/* Progress dots */}
              <div className="flex gap-1.5">
                {teamPlayers.map((_, i) => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                    style={{
                      background: votes[i] === "keep" ? "#4ade80"
                        : votes[i] === "drop" ? "#f87171"
                        : i === voterIdx ? voter.color
                        : "rgba(255,255,255,0.15)",
                      transform: i === voterIdx ? "scale(1.5)" : "scale(1)",
                    }} />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Waveform + play */}
          <div className="rounded-2xl p-4 mb-5"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            {/* Stacked waveforms: stack first, then new loop on top */}
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
              {/* The new loop — highlighted */}
              <div className="flex items-center gap-2">
                <span className="text-xs w-14 truncate shrink-0 font-semibold"
                  style={{ color: voter.color }}>{loop.playerName} ✦</span>
                <div className="flex items-center gap-px h-6 flex-1 rounded overflow-hidden"
                  style={{ background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
                  {loop.waveform.length > 0
                    ? loop.waveform.map((h, j) => (
                        <div key={j} className="flex-1 rounded-sm"
                          style={{
                            height: `${Math.max(8, h * 100)}%`,
                            background: isPlaying
                              ? `${voter.color}cc`
                              : `${voter.color}77`,
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
                background: isPlaying ? `${voter.color}33` : "rgba(255,255,255,0.08)",
                border: `1px solid ${isPlaying ? voter.color + "66" : "rgba(255,255,255,0.1)"}`,
                color: isPlaying ? voter.color : "rgba(255,255,255,0.8)",
              }}>
              {isPlaying ? "⏹ Stop" : hasListened ? "▶ Play Again" : "▶ Listen First"}
            </button>
          </div>

          {/* Keep / Drop buttons */}
          <AnimatePresence>
            {hasListened ? (
              <motion.div key="vote-btns" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="flex gap-3">
                <button onClick={() => castVote("drop")}
                  className="flex-1 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95 flex flex-col items-center gap-1"
                  style={{
                    background: "rgba(248,113,113,0.12)",
                    border: "1px solid rgba(248,113,113,0.3)",
                    color: "#fca5a5",
                  }}>
                  <span className="text-2xl">🗑️</span>
                  Drop It
                </button>
                <button onClick={() => castVote("keep")}
                  className="flex-1 py-4 rounded-2xl text-sm font-bold transition-all active:scale-95 flex flex-col items-center gap-1"
                  style={{
                    background: "rgba(74,222,128,0.12)",
                    border: "1px solid rgba(74,222,128,0.35)",
                    color: "#4ade80",
                  }}>
                  <span className="text-2xl">✅</span>
                  Keep It
                </button>
              </motion.div>
            ) : (
              <motion.p key="listen-hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-center text-white/30 text-sm py-3">
                Listen to the loop before voting
              </motion.p>
            )}
          </AnimatePresence>

        </div>
      </motion.div>
    </motion.div>
  );
}
