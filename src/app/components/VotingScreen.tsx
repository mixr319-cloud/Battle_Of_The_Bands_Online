import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Team, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";

interface Props {
  teams: { A: Team; B: Team };
  recordings: Recording[];
  myPlayerId: string;
  /** Send a WS message */
  send: (msg: Record<string, unknown>) => void;
  matchId: string;
  /** Called when server broadcasts results */
  onMessage: (handler: (msg: Record<string, unknown>) => void) => () => void;
  /** Seconds allowed for the full vote phase (from server, default 30) */
  timeoutSecs?: number;
}

type VotePhase = "song" | "mvp" | "waiting";

export function VotingScreen({ teams, recordings, myPlayerId, send, matchId, onMessage, timeoutSecs = 30 }: Props) {
  const myPlayer =
    teams.A.players.find(p => p.id === myPlayerId) ||
    teams.B.players.find(p => p.id === myPlayerId);

  const [votePhase, setVotePhase] = useState<VotePhase>("song");

  // Song vote
  const [listenedA, setListenedA] = useState(false);
  const [listenedB, setListenedB] = useState(false);
  const [playingTeam, setPlayingTeam] = useState<"A" | "B" | null>(null);
  const [ratingA, setRatingA] = useState(0);
  const [ratingB, setRatingB] = useState(0);

  // MVP vote
  const [mvpPickA, setMvpPickA] = useState<string>("");
  const [mvpPickB, setMvpPickB] = useState<string>("");

  // Countdown timer
  const [secondsLeft, setSecondsLeft] = useState(timeoutSecs);
  const timerUrgent = secondsLeft <= 10;
  const timerColor = timerUrgent ? "#f87171" : "rgba(255,255,255,0.35)";
  const timerPct = (secondsLeft / timeoutSecs) * 100;

  // Audio
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playingNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const buffersRef = useRef<{ A: AudioBuffer[]; B: AudioBuffer[] }>({ A: [], B: [] });
  // Per-recording buffers, keyed by recording id — used for MVP hover-to-preview playback
  const recordingBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const decodedRef = useRef(false);
  // Tracks which recording is currently playing via hover, so we can stop it
  // (and only it) when the pointer leaves
  const hoverNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const [hoveredRecordingId, setHoveredRecordingId] = useState<string | null>(null);

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
            .then(decoded => {
              recordingBuffersRef.current[r.id] = decoded;
              return decoded;
            })
            .catch(() => null)
        )
      ).then(bufs => bufs.filter((b): b is AudioBuffer => b !== null));
    decodeAll(recA).then(bufs => { buffersRef.current.A = bufs; });
    decodeAll(recB).then(bufs => { buffersRef.current.B = bufs; });
  }, []);

  useEffect(() => () => stopAll(), []);

  // Listen for song_vote_ack to advance to MVP phase
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === "song_vote_ack") {
        setVotePhase("mvp");
      }
    });
    return unsub;
  }, [onMessage]);

  // Countdown timer — stops once player submits MVP votes (waiting phase)
  useEffect(() => {
    if (votePhase === "waiting") return;
    setSecondsLeft(timeoutSecs);
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) { clearInterval(interval); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutSecs]); // only reset on mount / timeoutSecs change

  function stopAll() {
    playingNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    playingNodesRef.current = [];
    setPlayingTeam(null);
    stopHoverPreview();
  }

  function stopHoverPreview() {
    if (hoverNodeRef.current) {
      try { hoverNodeRef.current.stop(); } catch {}
      hoverNodeRef.current = null;
    }
    setHoveredRecordingId(null);
  }

  // Plays a single player's loop on hover (MVP screen). Stops any other
  // hover-preview or team-wide playback first so only one sound plays at a time.
  function playOnHoverStart(recordingId: string) {
    const buffer = recordingBuffersRef.current[recordingId];
    if (!buffer) return;
    if (hoveredRecordingId === recordingId) return; // already playing this one
    stopAll(); // stop any song-vote playback too
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = false;
    src.connect(ctx.destination);
    src.start();
    hoverNodeRef.current = src;
    setHoveredRecordingId(recordingId);
    // Auto-stop the ref once the clip naturally finishes, so a stale node
    // reference doesn't linger if the pointer never leaves
    src.onended = () => {
      if (hoverNodeRef.current === src) {
        hoverNodeRef.current = null;
        setHoveredRecordingId(prev => (prev === recordingId ? null : prev));
      }
    };
  }

  function playOnHoverEnd(recordingId: string) {
    if (hoveredRecordingId !== recordingId) return;
    stopHoverPreview();
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
    if (ctx.state === "suspended") ctx.resume();
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
    stopAll();
    send({ type: "song_vote", matchId, ratingA, ratingB });
    // Phase advances when server sends song_vote_ack
  }

  function handleMvpSubmit() {
    if (!mvpPickA || !mvpPickB) return;
    stopAll();
    send({ type: "mvp_vote", matchId, pickA: mvpPickA, pickB: mvpPickB });
    setVotePhase("waiting");
  }

  const recA = recordings.filter(r => r.teamId === "A");
  const recB = recordings.filter(r => r.teamId === "B");
  const canRate = listenedA && listenedB;

  if (votePhase === "waiting") {
    return (
      <div className="size-full flex flex-col items-center justify-center">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
          <div className="text-5xl mb-4">🎵</div>
          <p className="text-white font-black text-2xl">Votes submitted!</p>
          <p className="text-white/40 text-sm mt-2">Waiting for everyone else…</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8 relative">

      {/* Timer bar — along top edge, hidden once player submits */}
      {votePhase !== "waiting" && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden">
          <motion.div
            className="h-full"
            style={{ background: timerColor }}
            animate={{ width: `${timerPct}%` }}
            transition={{ duration: 0.9, ease: "linear" }}
          />
        </div>
      )}

      {myPlayer && (
        <div className="w-full max-w-md mb-4 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
            style={{ background: `${myPlayer.color}22`, border: `1px solid ${myPlayer.color}44`, color: myPlayer.color }}>
            <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
              style={{ background: myPlayer.color }}>{myPlayer.name[0]}</span>
            {myPlayer.name} — Your Vote
          </div>
          {/* Countdown below player badge */}
          {votePhase !== "waiting" && (
            <motion.p
              key={secondsLeft}
              initial={{ scale: timerUrgent ? 1.15 : 1 }}
              animate={{ scale: 1 }}
              className="text-xs font-bold tabular-nums mt-1"
              style={{ color: timerColor }}
            >
              {secondsLeft}s remaining
            </motion.p>
          )}
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ===== SONG VOTE ===== */}
        {votePhase === "song" && (
          <motion.div key="song" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="w-full max-w-md">
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs mb-3"
                style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", color: "#c084fc" }}>
                🎵 Round 1 — Best Song
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
                    Submit Song Ratings →
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
                        const playerRecording = recordings.find(r => r.teamId === teamId && r.playerName === p.name);
                        const hasLoop = !!playerRecording;
                        const isHoverPlaying = hasLoop && hoveredRecordingId === playerRecording!.id;
                        return (
                          <button key={p.id}
                            onClick={() => setPick(p.id)}
                            onMouseEnter={() => hasLoop && playOnHoverStart(playerRecording!.id)}
                            onMouseLeave={() => hasLoop && playOnHoverEnd(playerRecording!.id)}
                            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all active:scale-95 text-left"
                            style={{
                              background: selected ? `${p.color}22` : isHoverPlaying ? `${p.color}18` : "rgba(255,255,255,0.04)",
                              border: selected ? `1px solid ${p.color}55` : isHoverPlaying ? `1px solid ${p.color}44` : "1px solid rgba(255,255,255,0.07)",
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
                            {hasLoop && (
                              <span
                                className="flex items-center gap-px h-4 shrink-0"
                                style={{ opacity: isHoverPlaying ? 1 : 0.35 }}
                                title="Hover to preview loop"
                              >
                                {playerRecording!.waveform.slice(0, 10).map((h, j) => (
                                  <span key={j} className="w-0.5 rounded-sm"
                                    style={{
                                      height: `${Math.max(20, h * 100)}%`,
                                      background: isHoverPlaying ? p.color : "rgba(255,255,255,0.3)",
                                      transition: "background 0.15s",
                                    }} />
                                ))}
                                <span className="ml-1 text-xs" style={{ color: isHoverPlaying ? p.color : "rgba(255,255,255,0.25)" }}>
                                  {isHoverPlaying ? "▶" : "♪"}
                                </span>
                              </span>
                            )}
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
              Submit MVP Votes 🏆
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
