import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Team, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";
import { SceneFX } from "./SceneFX";
import { StageCharacter } from "./StageCharacter";
import { PremiumAvatarFrame } from "./PremiumAvatarFrame";

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

  // Guards so a manual click and the auto-timeout submit can't both fire
  const songSubmittedRef = useRef(false);
  const mvpSubmittedRef = useRef(false);

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

  // Listen for song_vote_ack to advance to MVP phase. Also listen for
  // end_vote_timeout / results — if either of those arrives, the server has
  // already finished tallying, so we must NOT let a late/in-flight
  // song_vote_ack push us into the MVP phase afterward (that's what
  // previously left players stuck on the MVP screen forever).
  const votingEndedRef = useRef(false);
  useEffect(() => {
    const unsub = onMessage((msg) => {
      if (msg.type === "end_vote_timeout" || msg.type === "results") {
        votingEndedRef.current = true;
        setVotePhase("waiting");
        return;
      }
      if (msg.type === "song_vote_ack" && !votingEndedRef.current) {
        setVotePhase("mvp");
      }
    });
    return unsub;
  }, [onMessage]);

  // Countdown timer — restarts for each phase (song -> mvp) so a slow/AFK
  // player still gets auto-submitted out of BOTH phases instead of just the
  // first one. Stops once the player reaches the waiting phase.
  useEffect(() => {
    if (votePhase === "waiting") return;
    setSecondsLeft(timeoutSecs);
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(interval);
          handleTimeUp();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutSecs, votePhase]); // reset whenever the phase changes too

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

  // `forced` = true means the timer ran out — submit anyway using defaults
  // (2 stars for any song not yet rated) instead of blocking on validation.
  function handleSongSubmit(forced = false) {
    const a = forced && ratingA === 0 ? 2 : ratingA;
    const b = forced && ratingB === 0 ? 2 : ratingB;
    if (!forced && (a === 0 || b === 0)) return;
    if (songSubmittedRef.current) return;
    songSubmittedRef.current = true;
    stopAll();
    send({ type: "song_vote", matchId, ratingA: a, ratingB: b });
    // Phase advances when server sends song_vote_ack
  }

  // `forced` = true means the timer ran out — submit anyway even with no
  // pick made (an empty pick simply counts as no MVP vote for that team,
  // so anyone picked by other players still has a fair shot at winning it).
  function handleMvpSubmit(forced = false) {
    if (!forced && (!mvpPickA || !mvpPickB)) return;
    if (mvpSubmittedRef.current) return;
    mvpSubmittedRef.current = true;
    stopAll();
    send({ type: "mvp_vote", matchId, pickA: mvpPickA, pickB: mvpPickB });
    setVotePhase("waiting");
  }

  // Always-fresh references to the latest submit handlers + phase, so the
  // timer (set up once) can trigger an accurate auto-submit no matter how
  // long it's been running or what's changed since.
  const latestRef = useRef({ handleSongSubmit, handleMvpSubmit, votePhase });
  useEffect(() => {
    latestRef.current = { handleSongSubmit, handleMvpSubmit, votePhase };
  });

  const handleTimeUp = useCallback(() => {
    const { handleSongSubmit, handleMvpSubmit, votePhase } = latestRef.current;
    if (votePhase === "song") handleSongSubmit(true);
    else if (votePhase === "mvp") handleMvpSubmit(true);
  }, []);

  const recA = recordings.filter(r => r.teamId === "A");
  const recB = recordings.filter(r => r.teamId === "B");
  const canRate = listenedA && listenedB;

  if (votePhase === "waiting") {
    return (
      <div className="relative size-full flex flex-col items-center justify-center">
        <SceneFX />
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 text-center">
          <div className="text-5xl mb-4" style={{ filter: "drop-shadow(0 0 16px rgba(168,85,247,0.6))" }}>🎵</div>
          <p
            className="font-black text-2xl text-white"
            style={{ fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 18px rgba(168,85,247,0.6)" }}
          >
            Votes submitted!
          </p>
          <p className="text-white/40 text-sm mt-2 font-medium">Waiting for everyone else…</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative size-full flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
      <SceneFX />

      <StageCharacter character="bassist" side="left" width={230} className="hidden lg:block opacity-40 grayscale-[20%]" />
      <StageCharacter character="guitarist" side="right" width={230} className="hidden lg:block opacity-40 grayscale-[20%]" />

      {/* Timer bar — along top edge, hidden once player submits */}
      <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden z-20">
        <motion.div
          className="h-full"
          style={{ background: "linear-gradient(90deg, #22d3ee, #c084fc)", boxShadow: "0 0 12px rgba(168,85,247,0.8)" }}
          animate={{ width: `${timerPct}%` }}
          transition={{ duration: 0.9, ease: "linear" }}
        />
      </div>

      {myPlayer && (
        <div className="relative z-10 w-full max-w-md mb-5 text-center">
          <div
            className="inline-flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full text-sm font-bold"
            style={{
              background: "linear-gradient(120deg, rgba(236,72,153,0.18), rgba(168,85,247,0.12))",
              border: "1px solid rgba(236,72,153,0.4)",
              boxShadow: "0 0 24px -6px rgba(236,72,153,0.5)",
              color: "#fce7f3",
            }}
          >
            <PremiumAvatarFrame isPremium={myPlayer.isPremium} rounded="rounded-full" crownSize="text-[8px]">
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg, #ec4899, #a855f7)", boxShadow: "0 0 10px rgba(236,72,153,0.6)" }}
              >
                {myPlayer.name[0]}
              </span>
            </PremiumAvatarFrame>
            {myPlayer.name} — Your Vote
          </div>
          {/* Countdown below player badge */}
          <motion.p
            key={secondsLeft}
            initial={{ scale: timerUrgent ? 1.15 : 1 }}
            animate={{ scale: 1 }}
            className="text-xs font-bold tabular-nums mt-2"
            style={{ color: timerColor, textShadow: timerUrgent ? "none" : "0 0 10px rgba(34,211,238,0.6)" }}
          >
            {secondsLeft}s remaining
          </motion.p>
        </div>
      )}

      <AnimatePresence mode="wait">

        {/* ===== SONG VOTE ===== */}
        {votePhase === "song" && (
          <motion.div key="song" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="relative z-10 w-full max-w-md">
            <div className="text-center mb-6">
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide mb-3"
                style={{
                  background: "linear-gradient(120deg, rgba(168,85,247,0.2), rgba(99,102,241,0.15))",
                  border: "1px solid rgba(168,85,247,0.4)",
                  boxShadow: "0 0 18px -4px rgba(168,85,247,0.5)",
                  color: "#d8b4fe",
                }}
              >
                🎵 Round 1 — Best Song
              </div>
              <p className="text-white/40 text-sm mt-2 font-medium">Listen to both songs, then rate 1–4 stars</p>
            </div>

            <div className="space-y-3.5 mb-6">
              {(["A", "B"] as const).map(teamId => {
                const team = teams[teamId];
                const recs = teamId === "A" ? recA : recB;
                const listened = teamId === "A" ? listenedA : listenedB;
                const isPlaying = playingTeam === teamId;
                const accent = teamId === "A"
                  ? { grad: "linear-gradient(135deg, #ec4899, #a855f7)", glow: "rgba(236,72,153,", text: "#fce7f3" }
                  : { grad: "linear-gradient(135deg, #22d3ee, #6366f1)", glow: "rgba(34,211,238,", text: "#e0fbff" };
                return (
                  <div key={teamId} className="rounded-2xl p-4 transition-all"
                    style={{
                      background: listened
                        ? "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))"
                        : isPlaying
                        ? `linear-gradient(160deg, ${accent.glow}0.12), rgba(99,102,241,0.06))`
                        : "linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.015))",
                      border: listened
                        ? `1px solid ${accent.glow}0.45)`
                        : isPlaying
                        ? `1px solid ${accent.glow}0.55)`
                        : "1px solid rgba(255,255,255,0.08)",
                      boxShadow: listened
                        ? `0 0 28px -8px ${accent.glow}0.5)`
                        : isPlaying
                        ? `0 0 28px -8px ${accent.glow}0.5)`
                        : "none",
                    }}>
                    <div className="flex items-center gap-3.5 mb-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold text-lg shrink-0"
                        style={{ background: accent.grad, boxShadow: `0 0 18px ${accent.glow}0.55)` }}>{teamId}</div>
                      <div className="flex-1">
                        <p className="text-white font-bold text-base">{team.name}</p>
                        <p className="text-white/40 text-xs mt-0.5">{recs.length} loop{recs.length !== 1 ? "s" : ""}</p>
                      </div>
                      {listened && <span className="text-xs font-bold shrink-0" style={{ color: "#f9a8d4" }}>✓ Heard</span>}
                      {isPlaying && (
                        <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ duration: 0.9, repeat: Infinity }}
                          className="text-xs font-bold shrink-0" style={{ color: "#a5f3fc" }}>▶ Playing</motion.span>
                      )}
                    </div>
                    {recs.length > 0 && (
                      <div className="space-y-2 mb-3.5">
                        {recs.map((r, i) => (
                          <div key={i} className="flex items-center gap-3">
                            <span className="text-xs w-16 truncate shrink-0" style={{ color: "rgba(255,255,255,0.32)" }}>{r.playerName}</span>
                            <div className="flex items-center gap-px h-6 flex-1 rounded overflow-hidden">
                              {r.waveform.map((h, j) => (
                                <div key={j} className="flex-1 rounded-sm"
                                  style={{
                                    height: `${Math.max(10, h * 100)}%`,
                                    background: isPlaying ? `${accent.glow}0.7)` : listened ? `${accent.glow}0.45)` : "rgba(255,255,255,0.18)",
                                  }} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={() => playTeam(teamId)}
                      className="w-full py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                      style={{
                        background: isPlaying ? `linear-gradient(120deg, ${accent.glow}0.3), rgba(99,102,241,0.2))` : "rgba(255,255,255,0.06)",
                        border: isPlaying ? `1px solid ${accent.glow}0.5)` : "1px solid rgba(255,255,255,0.1)",
                        boxShadow: isPlaying ? `0 0 20px -4px ${accent.glow}0.5)` : "none",
                        color: isPlaying ? accent.text : "rgba(255,255,255,0.7)",
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
                  style={{
                    background: "linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))",
                    border: "1px solid rgba(255,255,255,0.1)",
                    boxShadow: "0 0 34px -10px rgba(168,85,247,0.3)",
                  }}>
                  <p className="text-white font-bold text-base text-center mb-5">Rate each team's song</p>
                  <div className="space-y-5">
                    {(["A", "B"] as const).map(teamId => {
                      const rating = teamId === "A" ? ratingA : ratingB;
                      const setRating = teamId === "A" ? setRatingA : setRatingB;
                      const starAccent = teamId === "A"
                        ? { glow: "rgba(236,72,153,", text: "#f9a8d4" }
                        : { glow: "rgba(34,211,238,", text: "#a5f3fc" };
                      return (
                        <div key={teamId}>
                          <div className="flex items-center justify-between mb-2.5">
                            <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.7)" }}>Team {teamId}</span>
                            <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>
                              {rating > 0 ? `${rating} star${rating !== 1 ? "s" : ""}` : "not rated"}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            {[1, 2, 3, 4].map(star => {
                              const lit = rating >= star;
                              return (
                                <button key={star} onClick={() => setRating(star)}
                                  className="flex-1 py-3 rounded-xl text-xl transition-all active:scale-90"
                                  style={{
                                    background: lit ? `linear-gradient(160deg, ${starAccent.glow}0.25), rgba(168,85,247,0.15))` : "rgba(255,255,255,0.05)",
                                    border: lit ? `1px solid ${starAccent.glow}0.5)` : "1px solid rgba(255,255,255,0.1)",
                                    boxShadow: lit ? `0 0 16px -3px ${starAccent.glow}0.55)` : "none",
                                    color: lit ? starAccent.text : "rgba(255,255,255,0.25)",
                                    textShadow: lit ? `0 0 8px ${starAccent.glow}0.7)` : "none",
                                  }}>
                                  {lit ? "★" : "☆"}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => handleSongSubmit(false)} disabled={ratingA === 0 || ratingB === 0}
                    className="relative w-full mt-5 py-4 rounded-2xl text-white font-bold text-base overflow-hidden transition-all active:scale-95 disabled:opacity-30"
                    style={{
                      background: "linear-gradient(120deg, #ec4899, #a855f7 50%, #22d3ee)",
                      animation: ratingA > 0 && ratingB > 0 ? "bb-cta-breathe 2.4s ease-in-out infinite" : "none",
                      boxShadow: ratingA > 0 && ratingB > 0 ? "0 0 0 1px rgba(255,255,255,0.18) inset, 0 12px 30px -6px rgba(168,85,247,0.6), 0 0 55px -10px rgba(236,72,153,0.45)" : "none",
                    }}>
                    {ratingA > 0 && ratingB > 0 && (
                      <span
                        className="absolute top-0 h-full w-[30%]"
                        style={{ left: "-30%", background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.32), transparent)", animation: "bb-cta-shine 3s ease-in-out infinite" }}
                      />
                    )}
                    <span className="relative">Submit Song Ratings →</span>
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
          <motion.div key="mvp" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="relative z-10 w-full max-w-md">
            <div className="text-center mb-6">
              <div
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide mb-3"
                style={{
                  background: "linear-gradient(120deg, rgba(251,191,36,0.2), rgba(245,158,11,0.12))",
                  border: "1px solid rgba(251,191,36,0.4)",
                  boxShadow: "0 0 18px -4px rgba(251,191,36,0.45)",
                  color: "#fbbf24",
                }}
              >
                ⭐ Round 2 — MVP Vote
              </div>
              <p className="text-white/40 text-sm mt-2 font-medium">Who had the best loop on each team?</p>
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
                            <PremiumAvatarFrame isPremium={p.isPremium} rounded="rounded-lg" className="shrink-0" crownSize="text-[8px]">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white"
                                style={{ background: selected ? p.color : `${p.color}44` }}>
                                {p.name[0]}
                              </div>
                            </PremiumAvatarFrame>
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

            <button onClick={() => handleMvpSubmit(false)} disabled={!mvpPickA || !mvpPickB}
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
