import { useEffect, useState, useRef } from "react";
import { motion } from "motion/react";
import type { Team, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";

interface Props {
  teams: { A: Team; B: Team };
  winner: "A" | "B";
  votes: { A: number; B: number };
  mvp: { A: string; B: string };
  recordings: Recording[];
  onPlayAgain: () => void;
}

export function ResultsScreen({ teams, winner, votes, mvp, recordings, onPlayAgain }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const winTeam = teams[winner];
  const totalVotes = votes.A + votes.B;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const winBuffersRef = useRef<AudioBuffer[]>([]);
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
    const winRecs = recordings.filter(r => r.teamId === winner);
    Promise.all(
      winRecs.map(r =>
        fetchRecordingArrayBuffer(r)
          .then(b => ctx.decodeAudioData(b))
          .catch(err => {
            console.error("Failed to decode recording audio:", err);
            return null;
          })
      )
    ).then(bufs => {
      winBuffersRef.current = bufs.filter((b): b is AudioBuffer => b !== null);
      // Auto-play after reveal delay
      setTimeout(() => playWinnerSong(), 1200);
    });
    return () => stopAll();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setShowDetails(true), 800);
    return () => clearTimeout(t);
  }, []);

  function stopAll() {
    playingNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    playingNodesRef.current = [];
    setIsPlaying(false);
  }

  function playWinnerSong() {
    if (winBuffersRef.current.length === 0) return;
    stopAll();
    const ctx = getCtx();
    const nodes = winBuffersRef.current.map(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true; // loop it on celebration
      src.connect(ctx.destination);
      src.start(ctx.currentTime + 0.05);
      return src;
    });
    playingNodesRef.current = nodes;
    setIsPlaying(true);
  }

  function togglePlay() {
    if (isPlaying) stopAll();
    else playWinnerSong();
  }

  // Find MVP player objects
  const mvpPlayerA = teams.A.players.find(p => p.id === mvp.A) ?? teams.A.players[0];
  const mvpPlayerB = teams.B.players.find(p => p.id === mvp.B) ?? teams.B.players[0];

  // XP amounts
  const winnerBaseXp = 180;
  const loserBaseXp = 60;
  const mvpBonusXp = 120;

  return (
    <div className="size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1, transition: { type: "spring", stiffness: 200, damping: 25 } }}
        className="w-full max-w-md"
      >
        {/* Winner banner */}
        <div className="text-center mb-6">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0, transition: { delay: 0.2, type: "spring" } }}
            className="text-6xl mb-4"
          >🏆</motion.div>
          <h2 className="text-white font-black text-4xl tracking-tight">{winTeam.name}</h2>
          <p className="text-white/50 text-sm mt-1">Wins the Battle</p>

          <div className="flex justify-center gap-6 mt-4">
            {(["A", "B"] as const).map(id => (
              <div key={id} className="text-center">
                <div className="text-2xl font-black" style={{ color: id === winner ? "#a855f7" : "rgba(255,255,255,0.3)" }}>
                  {votes[id]}
                </div>
                <div className="text-white/30 text-xs">Team {id}</div>
              </div>
            ))}
          </div>

          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-3 max-w-xs mx-auto">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(votes[winner] / Math.max(totalVotes, 1)) * 100}%` }}
              transition={{ delay: 0.5, duration: 0.8, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #a855f7, #6366f1)" }}
            />
          </div>

          {/* Play/Stop winner song */}
          <button
            onClick={togglePlay}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold mx-auto transition-all active:scale-95"
            style={{
              background: isPlaying ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.08)",
              border: `1px solid ${isPlaying ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.12)"}`,
              color: isPlaying ? "#d8b4fe" : "rgba(255,255,255,0.7)",
            }}
          >
            {isPlaying ? (
              <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>▶</motion.span>
            ) : "▶"}
            {isPlaying ? "Playing winning song…" : "Play winning song"}
          </button>
        </div>

        {showDetails && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

            {/* MVP cards */}
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)" }}>
              <p className="text-yellow-400/70 text-xs uppercase tracking-widest mb-3">⭐ MVP of Each Team</p>
              <div className="grid grid-cols-2 gap-3">
                {[{ teamId: "A" as const, player: mvpPlayerA }, { teamId: "B" as const, player: mvpPlayerB }].map(({ teamId, player }) => (
                  <div key={teamId} className="rounded-xl p-3 text-center"
                    style={{ background: `${player.color}11`, border: `1px solid ${player.color}33` }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-black text-white mx-auto mb-2"
                      style={{ background: player.color }}>
                      {player.name[0]}
                    </div>
                    <div className="text-white font-bold text-sm">{player.name}</div>
                    <div className="text-white/40 text-xs">Team {teamId}</div>
                    <div className="text-yellow-400 text-xs font-bold mt-1">+{mvpBonusXp} bonus XP</div>
                  </div>
                ))}
              </div>
            </div>

            {/* XP earned */}
            <div className="rounded-2xl p-5"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", backdropFilter: "blur(24px)" }}>
              <p className="text-white/50 text-xs uppercase tracking-widest mb-4">XP Earned</p>
              <div className="space-y-3">
                {[...teams.A.players, ...teams.B.players].map(player => {
                  const isWinner = teams[winner].players.some(p => p.id === player.id);
                  const isMvpA = player.id === mvpPlayerA.id;
                  const isMvpB = player.id === mvpPlayerB.id;
                  const isMvp = isMvpA || isMvpB;
                  const baseXp = isWinner ? winnerBaseXp : loserBaseXp;
                  const totalXp = baseXp + (isMvp ? mvpBonusXp : 0);
                  return (
                    <div key={player.id} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: `${player.color}33`, color: player.color }}>
                        {player.name[0]}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-white/80 text-sm flex items-center gap-1.5">
                            {player.name}
                            {isMvp && <span className="text-yellow-400 text-xs">⭐ MVP</span>}
                          </span>
                          <span className="font-bold text-xs" style={{ color: isMvp ? "#fbbf24" : "#a855f7" }}>
                            +{totalXp} XP
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                          <motion.div
                            initial={{ width: `${(player.xp / player.xpToNext) * 100}%` }}
                            animate={{ width: `${Math.min(((player.xp + totalXp) / player.xpToNext) * 100, 100)}%` }}
                            transition={{ delay: 0.3 + Math.random() * 0.3, duration: 0.8 }}
                            className="h-full rounded-full"
                            style={{ background: isMvp ? "linear-gradient(90deg, #fbbf24, #f59e0b)" : player.color }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => { stopAll(); onPlayAgain(); }}
              className="w-full py-4 rounded-xl text-white font-bold text-base transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)", boxShadow: "0 0 40px rgba(168,85,247,0.35)" }}
            >
              Play Again
            </button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
