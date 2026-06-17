import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Team, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";

interface Props {
  teams: { A: Team; B: Team };
  recordings: Recording[];
  onComplete: (winner: "A" | "B", votes: { A: number; B: number }, mvp: { A: string; B: string }) => void;
}

type VotePhase = "song" | "mvp" | "tallying";

function getAllVoters(teams: { A: Team; B: Team }) {
  return [
    ...teams.A.players.map(p => ({ ...p, teamId: "A" as const })),
    ...teams.B.players.map(p => ({ ...p, teamId: "B" as const })),
  ];
}

export function VotingScreen({ teams, recordings, onComplete }: Props) {
  const allVoters = getAllVoters(teams);
  const [votePhase, setVotePhase] = useState<VotePhase>("song");

  // --- Song vote state ---
  const [songVoterIdx, setSongVoterIdx] = useState(0);
  const [listenedA, setListenedA] = useState(false);
  const [listenedB, setListenedB] = useState(false);
  const [playingTeam, setPlayingTeam] = useState<"A" | "B" | null>(null);
  const [ratingA, setRatingA] = useState(0);
  const [ratingB, setRatingB] = useState(0);
  const [songVotes, setSongVotes] = useState<Array<{ voterId: string; ratingA: number; ratingB: number }>>([]);

  // --- MVP vote state ---
  const [mvpVoterIdx, setMvpVoterIdx] = useState(0);
  const [mvpPickA, setMvpPickA] = useState<string>("");
  const [mvpPickB, setMvpPickB] = useState<string>("");
  const [mvpVotes, setMvpVotes] = useState<Record<string, number>>({});

  // --- Audio ---
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const buffersRef = useRef<{ A: AudioBuffer[]; B: AudioBuffer[] }>({ A: [], B: [] });
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
    const recA = recordings.filter(r => r.teamId === "A");
    const recB = recordings.filter(r => r.teamId === "B");
    const decodeAll = (recs: Recording[]) =>
      Promise.all(
        recs.map(r =>
          fetchRecordingArrayBuffer(r)
            .then(buf => ctx.decodeAudioData(buf))
            .catch(err => {
              console.error("Failed to decode recording audio:", err);
              return null;
            })
        )
      ).then(bufs => bufs.filter((b): b is AudioBuffer => b !== null));
    decodeAll(recA).then(bufs => { buffersRef.current.A = bufs; });
    decodeAll(recB).then(bufs => { buffersRef.current.B = bufs; });
  }, []);

  useEffect(() => () => stopAll(), []);

  useEffect(() => {
    stopAll();
    setListenedA(false);
    setListenedB(false);
    setRatingA(0);
    setRatingB(0);
    setPlayingTeam(null);
  }, [songVoterIdx]);

  function stopAll() {
    playingNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    playingNodesRef.current = [];
    setPlayingTeam(null);
  }

  function playTeam(teamId: "A" | "B") {
    if (playingTeam === teamId) { stopAll(); return; }
    stopAll();
    const buffers = buffersRef.current[teamId];
    if (buffers.length === 0) {
      if (teamId === "A") setListenedA(true);
      else setListenedB(true);
      return;
    }
    const ctx = getCtx();
    const maxDuration = Math.max(...buffers.map(b => b.duration));
    const nodes = buffers.map(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = false;
      src.connect(ctx.destination);
      src.start(ctx.currentTime + 0.05);
      return src;
    });
    playingNodesRef.current = nodes;
    setPlayingTeam(teamId);
    setTimeout(() => {
      stopAll();
      if (teamId === "A") setListenedA(true);
      else setListenedB(true);
    }, (maxDuration + 0.1) * 1000);
  }

  function handleSongSubmit() {
    if (ratingA === 0 || ratingB === 0) return;
    const voter = allVoters[songVoterIdx];
    const newVotes = [...songVotes, { voterId: voter.id, ratingA, ratingB }];
    setSongVotes(newVotes);
    stopAll();
    if (songVoterIdx + 1 >= allVoters.length) {
      // All song votes in — move to MVP round
      setVotePhase("mvp");
    } else {
      setSongVoterIdx(i => i + 1);
    }
  }

  function handleMvpSubmit() {
    if (!mvpPickA || !mvpPickB) return;
    const newMvpVotes = { ...mvpVotes };
    newMvpVotes[mvpPickA] = (newMvpVotes[mvpPickA] ?? 0) + 1;
    newMvpVotes[mvpPickB] = (newMvpVotes[mvpPickB] ?? 0) + 1;
    setMvpVotes(newMvpVotes);

    if (mvpVoterIdx + 1 >= allVoters.length) {
      // All done — tally
      setVotePhase("tallying");
      const totalA = songVotes.reduce((s, v) => s + v.ratingA, 0) + ratingA;
      const totalB = songVotes.reduce((s, v) => s + v.ratingB, 0) + ratingB;

      // Find MVP per team (most votes)
      const mvpA = findMvp(teams.A.players.map(p => p.id), newMvpVotes);
      const mvpB = findMvp(teams.B.players.map(p => p.id), newMvpVotes);

      setTimeout(() => onComplete(
        totalA >= totalB ? "A" : "B",
        { A: totalA, B: totalB },
        { A: mvpA, B: mvpB }
      ), 1800);
    } else {
      setMvpVoterIdx(i => i + 1);
      setMvpPickA("");
      setMvpPickB("");
    }
  }

  function findMvp(playerIds: string[], votes: Record<string, number>): string {
    let best = playerIds[0];
    let bestCount = 0;
    for (const id of playerIds) {
      if ((votes[id] ?? 0) > bestCount) { bestCount = votes[id] ?? 0; best = id; }
    }
    return best;
  }

  const songVoter = allVoters[songVoterIdx];
  const mvpVoter = allVoters[mvpVoterIdx];
  const recA = recordings.filter(r => r.teamId === "A");
  const recB = recordings.filter(r => r.teamId === "B");
  const canRate = listenedA && listenedB;

  if (votePhase === "tallying") {
    return (
      <div className="size-full flex flex-col items-center justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          <div className="text-5xl mb-4">🎵</div>
          <p className="text-white font-black text-2xl">Tallying votes...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <AnimatePresence mode="wait">

        {/* ===== SONG VOTE ===== */}
        {votePhase === "song" && (
          <motion.div key="song" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="w-full max-w-md">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-3"
                style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" }}>
                🎵 Round 1 — Best Song
              </div>
              <div className="text-white/40 text-xs uppercase tracking-widest mb-2">
                Voter {songVoterIdx + 1} of {allVoters.length}
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                style={{ background: `${songVoter.color}22`, border: `1px solid ${songVoter.color}44`, color: songVoter.color }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: songVoter.color }}>{songVoter.name[0]}</span>
                {songVoter.name} — Listen & Rate
              </div>
              <p className="text-white/35 text-sm mt-2">Listen to both songs, then rate 1–4 stars</p>
            </div>

            <div className="space-y-3 mb-6">
              {(["A", "B"] as const).map(teamId => {
                const team = teams[teamId];
                const recs = teamId === "A" ? recA : recB;
                const listened = teamId === "A" ? listenedA : listenedB;
                const isPlaying = playingTeam === teamId;
                return (
                  <div key={teamId} className="rounded-2xl p-4 transition-all"
                    style={{
                      background: listened ? "rgba(52,211,153,0.07)" : isPlaying ? "rgba(168,85,247,0.1)" : "rgba(255,255,255,0.05)",
                      border: listened ? "1px solid rgba(52,211,153,0.3)" : isPlaying ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
                      backdropFilter: "blur(24px)",
                    }}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-lg"
                        style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)" }}>{teamId}</div>
                      <div className="flex-1">
                        <p className="text-white font-semibold text-sm">{team.name}</p>
                        <p className="text-white/40 text-xs">{recs.length} loop{recs.length !== 1 ? "s" : ""}</p>
                      </div>
                      {listened && <span className="text-green-400 text-xs font-medium">✓ Heard</span>}
                      {isPlaying && (
                        <motion.span animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.8, repeat: Infinity }}
                          className="text-purple-300 text-xs">▶ Playing</motion.span>
                      )}
                    </div>
                    {recs.length > 0 && (
                      <div className="space-y-1 mb-3">
                        {recs.map((r, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-white/25 text-xs w-12 truncate shrink-0">{r.playerName}</span>
                            <div className="flex items-center gap-px h-5 flex-1 rounded overflow-hidden">
                              {r.waveform.map((h, j) => (
                                <div key={j} className="flex-1 rounded-sm"
                                  style={{
                                    height: `${Math.max(10, h * 100)}%`,
                                    background: isPlaying ? "rgba(168,85,247,0.7)" : listened ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.2)",
                                  }} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => playTeam(teamId)}
                      className="w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
                      style={{
                        background: isPlaying ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.08)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        color: isPlaying ? "#d8b4fe" : "rgba(255,255,255,0.8)",
                      }}>
                      {isPlaying ? "⏹ Stop" : listened ? "▶ Play Again" : "▶ Play Song"}
                    </button>
                  </div>
                );
              })}
            </div>

            <AnimatePresence>
              {canRate && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl p-5 mb-4"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <p className="text-white font-semibold text-sm text-center mb-4">Rate each team's song</p>
                  <div className="space-y-4">
                    {(["A", "B"] as const).map(teamId => {
                      const rating = teamId === "A" ? ratingA : ratingB;
                      const setRating = teamId === "A" ? setRatingA : setRatingB;
                      return (
                        <div key={teamId}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white/60 text-sm">Team {teamId}</span>
                            <span className="text-white/35 text-xs">{rating > 0 ? `${rating} star${rating !== 1 ? "s" : ""}` : "not rated"}</span>
                          </div>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4].map(star => (
                              <button key={star} onClick={() => setRating(star)}
                                className="flex-1 py-3 rounded-xl text-xl transition-all active:scale-90"
                                style={{
                                  background: rating >= star ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.06)",
                                  border: rating >= star ? "1px solid rgba(168,85,247,0.5)" : "1px solid rgba(255,255,255,0.1)",
                                }}>
                                {rating >= star ? "★" : "☆"}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={handleSongSubmit} disabled={ratingA === 0 || ratingB === 0}
                    className="w-full mt-5 py-3.5 rounded-xl text-white font-bold text-sm transition-all active:scale-95 disabled:opacity-30"
                    style={{
                      background: "linear-gradient(135deg, #a855f7, #6366f1)",
                      boxShadow: ratingA > 0 && ratingB > 0 ? "0 0 30px rgba(168,85,247,0.4)" : "none",
                    }}>
                    {songVoterIdx + 1 < allVoters.length
                      ? `Submit & pass to ${allVoters[songVoterIdx + 1].name} →`
                      : "Submit — Vote for MVPs →"}
                  </button>
                </motion.div>
              )}
              {!canRate && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center text-white/30 text-sm py-2">
                  {!listenedA && !listenedB ? "Listen to both songs before rating"
                    : !listenedA ? "Listen to Team A before rating"
                    : "Listen to Team B before rating"}
                </motion.p>
              )}
            </AnimatePresence>

            <div className="flex justify-center gap-2 mt-4">
              {allVoters.map((v, i) => (
                <div key={v.id} className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    background: i < songVoterIdx ? "rgba(52,211,153,0.8)" : i === songVoterIdx ? v.color : "rgba(255,255,255,0.15)",
                    transform: i === songVoterIdx ? "scale(1.5)" : "scale(1)",
                  }} />
              ))}
            </div>
          </motion.div>
        )}

        {/* ===== MVP VOTE ===== */}
        {votePhase === "mvp" && (
          <motion.div key="mvp" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="w-full max-w-md">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-3"
                style={{ background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}>
                ⭐ Round 2 — MVP Vote
              </div>
              <div className="text-white/40 text-xs uppercase tracking-widest mb-2">
                Voter {mvpVoterIdx + 1} of {allVoters.length}
              </div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
                style={{ background: `${mvpVoter.color}22`, border: `1px solid ${mvpVoter.color}44`, color: mvpVoter.color }}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: mvpVoter.color }}>{mvpVoter.name[0]}</span>
                {mvpVoter.name} — Pick MVPs
              </div>
              <p className="text-white/35 text-sm mt-2">Who had the best loop on each team?</p>
            </div>

            <div className="space-y-4 mb-6">
              {(["A", "B"] as const).map(teamId => {
                const team = teams[teamId];
                const pick = teamId === "A" ? mvpPickA : mvpPickB;
                const setPick = teamId === "A" ? setMvpPickA : setMvpPickB;
                return (
                  <div key={teamId} className="rounded-2xl p-4"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <p className="text-white/50 text-xs uppercase tracking-widest mb-3">Team {teamId} MVP</p>
                    <div className="space-y-2">
                      {team.players.map(p => {
                        const selected = pick === p.id;
                        const hasLoop = recordings.some(r => r.teamId === teamId && r.playerName === p.name);
                        return (
                          <button key={p.id}
                            onClick={() => setPick(p.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-95 text-left"
                            style={{
                              background: selected ? `${p.color}22` : "rgba(255,255,255,0.04)",
                              border: selected ? `1px solid ${p.color}55` : "1px solid rgba(255,255,255,0.07)",
                            }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
                              style={{ background: selected ? p.color : `${p.color}44` }}>
                              {p.name[0]}
                            </div>
                            <div className="flex-1">
                              <span className="text-sm font-medium" style={{ color: selected ? p.color : "rgba(255,255,255,0.7)" }}>
                                {p.name}
                              </span>
                              {!hasLoop && <span className="text-white/20 text-xs ml-2">(no loop)</span>}
                            </div>
                            {selected && <span style={{ color: p.color }}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button onClick={handleMvpSubmit} disabled={!mvpPickA || !mvpPickB}
              className="w-full py-3.5 rounded-xl text-white font-bold text-sm transition-all active:scale-95 disabled:opacity-30"
              style={{
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                boxShadow: mvpPickA && mvpPickB ? "0 0 30px rgba(251,191,36,0.35)" : "none",
              }}>
              {mvpVoterIdx + 1 < allVoters.length
                ? `Submit & pass to ${allVoters[mvpVoterIdx + 1].name} →`
                : "Submit — See Results 🏆"}
            </button>

            <div className="flex justify-center gap-2 mt-4">
              {allVoters.map((v, i) => (
                <div key={v.id} className="w-2 h-2 rounded-full transition-all duration-300"
                  style={{
                    background: i < mvpVoterIdx ? "rgba(251,191,36,0.8)" : i === mvpVoterIdx ? v.color : "rgba(255,255,255,0.15)",
                    transform: i === mvpVoterIdx ? "scale(1.5)" : "scale(1)",
                  }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
