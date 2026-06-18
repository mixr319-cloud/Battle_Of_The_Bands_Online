import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Player, BattleKey, Recording } from "../App";
import { fetchRecordingArrayBuffer } from "../hooks/useGameSocket";

interface Props {
  player: Player;
  turnNumber: number;
  totalTurns: number;
  battleKey: BattleKey;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  /** All recordings from this player's team so far (to play as backing track) */
  teamStack: Recording[];
  onDone: (audioBlob?: Blob, waveform?: number[]) => void;
  /** Turn time limit in seconds, default 180 */
  turnTimeLimit?: number;
}

type Phase = "preview" | "ready" | "countdown" | "recording" | "review";

const BAR_COUNT = 4;
const BEATS_PER_BAR = 4;
const TOTAL_BEATS = BAR_COUNT * BEATS_PER_BAR;
const WAVEFORM_SEGMENTS = 64;

export function RecordingModal({
  player, turnNumber, totalTurns, battleKey, bpm, onBpmChange, teamStack, onDone, turnTimeLimit = 180,
}: Props) {
  const isFirstRecording = teamStack.length === 0;

  const [phase, setPhase] = useState<Phase>(isFirstRecording ? "ready" : "preview");
  const [countdown, setCountdown] = useState(4);
  const [beat, setBeat] = useState(0);
  const [waveformData, setWaveformData] = useState<number[]>(() =>
    Array.from({ length: WAVEFORM_SEGMENTS }, () => 0.05)
  );
  const [savedWaveform, setSavedWaveform] = useState<number[]>([]);
  const [metronomeOn, setMetronomeOn] = useState(true);
  const [bpmInput, setBpmInput] = useState(String(bpm));
  const [micError, setMicError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isPlayingReview, setIsPlayingReview] = useState(false);
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [monitoringOn, setMonitoringOn] = useState(false);
  // NEW: mic pre-arm state
  const [micArmed, setMicArmed] = useState(false);
  const [micArming, setMicArming] = useState(false);
  // Live level meter for pre-arm monitoring
  const [micLevel, setMicLevel] = useState(0);
  // Turn countdown timer
  const [turnSecsLeft, setTurnSecsLeft] = useState(turnTimeLimit);
  const turnTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const beatRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Separate RAF for pre-arm level meter
  const levelRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRef = useRef<number[]>(Array.from({ length: WAVEFORM_SEGMENTS }, () => 0.05));
  // Stack playback nodes (during recording)
  const stackNodesRef = useRef<AudioBufferSourceNode[]>([]);
  // Preview / review playback nodes
  const previewNodesRef = useRef<AudioBufferSourceNode[]>([]);
  // Decoded buffers for the team stack
  const stackBuffersRef = useRef<AudioBuffer[]>([]);
  // Blob URL for review playback of what was just recorded
  const reviewUrlRef = useRef<string | null>(null);
  const reviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);

  const beatDuration = (60 / bpm) * 1000;

  useEffect(() => {
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = monitoringOn ? 1 : 0;
    }
  }, [monitoringOn]);

  function getCtx() {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function playClick(isDownbeat: boolean) {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = isDownbeat ? 1000 : 700;
    gain.gain.setValueAtTime(isDownbeat ? 0.4 : 0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  // Decode all team stack blobs into AudioBuffers once on mount
  useEffect(() => {
    if (teamStack.length === 0) return;
    const ctx = getCtx();
    Promise.all(
      teamStack.map(r =>
        fetchRecordingArrayBuffer(r)
          .then(buf => ctx.decodeAudioData(buf))
          .catch(err => {
            console.error("Failed to decode team stack recording:", err);
            return null;
          })
      )
    ).then(buffers => {
      stackBuffersRef.current = buffers.filter((b): b is AudioBuffer => b !== null);
    });
  }, []);

  // Turn timer — counts down from turnTimeLimit, auto-submits on 0
  useEffect(() => {
    setTurnSecsLeft(turnTimeLimit);
    turnTimerRef.current = setInterval(() => {
      setTurnSecsLeft(prev => {
        if (prev <= 1) {
          clearInterval(turnTimerRef.current!);
          // Auto-submit whatever we have (or nothing)
          handleSkip();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (turnTimerRef.current) clearInterval(turnTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    clearAll();
    stopStackPlayback();
    stopPreviewPlayback();
    stopStream();
    stopLevelMeter();
    if (turnTimerRef.current) clearInterval(turnTimerRef.current);
    if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
  }, []);

  function clearAll() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (beatIntervalRef.current) clearInterval(beatIntervalRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  function stopStackPlayback() {
    stackNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    stackNodesRef.current = [];
  }

  function stopPreviewPlayback() {
    previewNodesRef.current.forEach(n => { try { n.stop(); } catch {} });
    previewNodesRef.current = [];
  }

  function stopLevelMeter() {
    if (levelRafRef.current) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setMicLevel(0);
  }

  // --- NEW: Pre-arm the mic so user can monitor before recording ---
  async function handleToggleMicArm() {
    if (micArmed) {
      // Disarm: stop stream & monitoring
      stopLevelMeter();
      stopStream();
      monitorGainRef.current = null;
      analyserRef.current = null;
      setMicArmed(false);
      setMonitoringOn(false);
      setMicError(null);
      return;
    }

    setMicArming(true);
    setMicError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      streamRef.current = stream;
      const ctx = getCtx();
      const source = ctx.createMediaStreamSource(stream);

      // Analyser for waveform/level
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Monitor gain node
      const monitorGain = ctx.createGain();
      monitorGain.gain.value = 0; // starts off; user toggles it
      source.connect(monitorGain);
      monitorGain.connect(ctx.destination);
      monitorGainRef.current = monitorGain;

      setMicArmed(true);
      startLevelMeter();
    } catch {
      setMicError("Mic access denied. Allow microphone access and try again.");
    } finally {
      setMicArming(false);
    }
  }

  function startLevelMeter() {
    function tick() {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(data);
      const rms = Math.sqrt(
        data.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / data.length
      );
      setMicLevel(Math.min(1, rms * 6));
      levelRafRef.current = requestAnimationFrame(tick);
    }
    levelRafRef.current = requestAnimationFrame(tick);
  }

  // Play the team stack simultaneously (for preview or backing track during recording)
  function startStackPlayback(loop: boolean): number {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume();
    stopPreviewPlayback();
    const startTime = ctx.currentTime + 0.05;
    const nodes = stackBuffersRef.current.map(buf => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.connect(ctx.destination);
      src.start(startTime);
      return src;
    });
    previewNodesRef.current = nodes;
    return startTime;
  }

  function handleTogglePreview() {
    if (isPlayingPreview) {
      stopPreviewPlayback();
      setIsPlayingPreview(false);
    } else {
      if (stackBuffersRef.current.length === 0) return;
      const ctx = getCtx();
      if (ctx.state === "suspended") ctx.resume();
      const nodes = stackBuffersRef.current.map(buf => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = false;
        src.connect(ctx.destination);
        src.onended = () => setIsPlayingPreview(false);
        src.start();
        return src;
      });
      previewNodesRef.current = nodes;
      setIsPlayingPreview(true);
    }
  }

  async function startCountdown() {
    setMicError(null);
    stopPreviewPlayback();
    setIsPlayingPreview(false);

    // If mic isn't already armed, request it now
    if (!micArmed) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          },
        });
        streamRef.current = stream;
        const ctx = getCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        const monitorGain = ctx.createGain();
        monitorGain.gain.value = monitoringOn ? 1 : 0;
        source.connect(monitorGain);
        monitorGain.connect(ctx.destination);
        monitorGainRef.current = monitorGain;
      } catch {
        setMicError("Mic access denied. Allow microphone access and try again.");
        return;
      }
    } else {
      // Mic already armed — stop the level meter RAF (recording loop takes over)
      stopLevelMeter();
      // Keep stream/analyser/monitorGain intact
    }

    setPhase("countdown");
    setCountdown(4);
    let c = 4;

    const tick = () => {
      playClick(true);
      c--;
      if (c <= 0) {
        setCountdown(0);
        startRecording();
      } else {
        setCountdown(c);
        timerRef.current = setTimeout(tick, 1000);
      }
    };
    timerRef.current = setTimeout(tick, 0);
  }

  function startRecording() {
    beatRef.current = 0;
    setBeat(0);
    waveformRef.current = Array.from({ length: WAVEFORM_SEGMENTS }, () => 0.05);
    setWaveformData([...waveformRef.current]);
    setPhase("recording");

    if (stackBuffersRef.current.length > 0) {
      const ctx = getCtx();
      stopStackPlayback();
      const startTime = ctx.currentTime + 0.02;
      const nodes = stackBuffersRef.current.map(buf => {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(ctx.destination);
        src.start(startTime);
        return src;
      });
      stackNodesRef.current = nodes;
    }

    chunksRef.current = [];
    if (streamRef.current) {
      const mr = new MediaRecorder(streamRef.current);
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        if (reviewUrlRef.current) URL.revokeObjectURL(reviewUrlRef.current);
        reviewUrlRef.current = URL.createObjectURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
    }

    beatIntervalRef.current = setInterval(() => {
      beatRef.current++;
      setBeat(beatRef.current);
      if (metronomeOn) playClick(beatRef.current % BEATS_PER_BAR === 0);
      if (beatRef.current >= TOTAL_BEATS) {
        clearInterval(beatIntervalRef.current!);
        finishRecording();
      }
    }, beatDuration);

    function drawWave() {
      if (!analyserRef.current) return;
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteTimeDomainData(data);
      const rms = Math.sqrt(data.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / data.length);
      const filled = Math.floor((beatRef.current / TOTAL_BEATS) * WAVEFORM_SEGMENTS);
      const next = [...waveformRef.current];
      for (let i = Math.max(0, filled - 1); i <= Math.min(filled + 1, WAVEFORM_SEGMENTS - 1); i++) {
        next[i] = Math.max(0.08, Math.min(1, rms * 6 + Math.random() * 0.08));
      }
      waveformRef.current = next;
      setWaveformData([...next]);
      animFrameRef.current = requestAnimationFrame(drawWave);
    }
    animFrameRef.current = requestAnimationFrame(drawWave);
  }

  function finishRecording() {
    clearAll();
    stopStackPlayback();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    stopStream();
    setMicArmed(false);
    setSavedWaveform([...waveformRef.current]);
    setPhase("review");
  }

  function handleToggleReview() {
    if (!reviewUrlRef.current) return;
    if (isPlayingReview) {
      reviewAudioRef.current?.pause();
      if (reviewAudioRef.current) reviewAudioRef.current.currentTime = 0;
      setIsPlayingReview(false);
    } else {
      if (stackBuffersRef.current.length > 0) {
        startStackPlayback(false);
      }
      const audio = new Audio(reviewUrlRef.current);
      reviewAudioRef.current = audio;
      audio.onended = () => {
        stopPreviewPlayback();
        setIsPlayingReview(false);
      };
      audio.play();
      setIsPlayingReview(true);
    }
  }

  function handleRetry() {
    clearAll();
    stopLevelMeter();
    stopStream();
    stopStackPlayback();
    stopPreviewPlayback();
    monitorGainRef.current = null;
    analyserRef.current = null;
    if (reviewUrlRef.current) { URL.revokeObjectURL(reviewUrlRef.current); reviewUrlRef.current = null; }
    setAudioBlob(null);
    setBeat(0);
    waveformRef.current = Array.from({ length: WAVEFORM_SEGMENTS }, () => 0.05);
    setWaveformData([...waveformRef.current]);
    setSavedWaveform([]);
    setMicArmed(false);
    setMonitoringOn(false);
    setMicLevel(0);
    setPhase(isFirstRecording ? "ready" : "preview");
    setIsPlayingReview(false);
  }

  function handleConfirm() {
    clearAll();
    stopLevelMeter();
    stopStream();
    stopStackPlayback();
    stopPreviewPlayback();
    reviewAudioRef.current?.pause();
    onDone(audioBlob ?? undefined, savedWaveform);
  }

  function handleSkip() {
    clearAll();
    stopLevelMeter();
    stopStream();
    stopStackPlayback();
    stopPreviewPlayback();
    onDone();
  }

  function handleTap() {
    const now = Date.now();
    setTapTimes(prev => {
      const recent = [...prev, now].filter(t => now - t < 4000);
      if (recent.length >= 2) {
        const gaps = recent.slice(1).map((t, i) => t - recent[i]);
        const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const clamped = Math.min(200, Math.max(40, Math.round(60000 / avg)));
        onBpmChange(clamped);
        setBpmInput(String(clamped));
      }
      return recent;
    });
  }

  function handleBpmBlur() {
    const val = parseInt(bpmInput);
    if (!isNaN(val) && val >= 40 && val <= 200) onBpmChange(val);
    else setBpmInput(String(bpm));
  }

  const currentBar = Math.floor(beat / BEATS_PER_BAR);
  const currentBeatInBar = beat % BEATS_PER_BAR;
  const progress = beat / TOTAL_BEATS;
  const displayWaveform = phase === "review" ? savedWaveform : waveformData;

  // Level meter bar count for the pre-arm indicator
  const levelBars = 20;
  const litBars = Math.round(micLevel * levelBars);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6"
      style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(12px)" }}
    >
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1, transition: { type: "spring", stiffness: 280, damping: 28 } }}
        exit={{ y: 80, opacity: 0 }}
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl relative overflow-hidden"
        style={{
          background: "rgba(8, 6, 18, 0.95)",
          border: "1px solid rgba(255,255,255,0.09)",
          backdropFilter: "blur(40px)",
          boxShadow: "0 -24px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-72 h-32 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: player.color }} />

        <div className="p-6 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                style={{ background: `${player.color}33`, color: player.color, border: `1px solid ${player.color}55` }}>
                Loop {turnNumber} / {totalTurns}
              </span>
              <span className="text-xs px-2.5 py-1 rounded-full"
                style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {battleKey.root} {battleKey.mode}
              </span>
            </div>
            {/* Turn timer */}
            {(phase === "ready" || phase === "preview" || phase === "countdown") && (
              <div className="flex items-center gap-1.5">
                <motion.span
                  animate={turnSecsLeft <= 30 ? { opacity: [1, 0.4, 1] } : {}}
                  transition={{ duration: 0.7, repeat: Infinity }}
                  className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
                  style={{
                    background: turnSecsLeft <= 30 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${turnSecsLeft <= 30 ? "rgba(239,68,68,0.4)" : "rgba(255,255,255,0.1)"}`,
                    color: turnSecsLeft <= 30 ? "#f87171" : "rgba(255,255,255,0.45)",
                  }}
                >
                  ⏱ {Math.floor(turnSecsLeft / 60)}:{String(turnSecsLeft % 60).padStart(2, "0")}
                </motion.span>
              </div>
            )}
          </div>

          {/* Player tag */}
          <div className="text-center mb-5">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold"
              style={{ background: `${player.color}22`, border: `1px solid ${player.color}44`, color: player.color }}>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ background: player.color }}>{player.name[0]}</span>
              {player.name}'s Turn
            </div>
          </div>

          {micError && (
            <div className="mb-4 px-4 py-3 rounded-xl text-xs text-red-300"
              style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
              {micError}
            </div>
          )}

          {/* Countdown overlay */}
          <AnimatePresence>
            {phase === "countdown" && (
              <motion.div key="cd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-3xl"
                style={{ background: "rgba(8,6,18,0.96)" }}>
                <p className="text-white/40 text-sm uppercase tracking-widest mb-4">Get ready, {player.name}...</p>
                <motion.div key={countdown}
                  initial={{ scale: 1.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="text-white font-black"
                  style={{ fontSize: "7rem", lineHeight: 1, textShadow: `0 0 60px ${player.color}cc` }}>
                  {countdown}
                </motion.div>
                <p className="text-white/30 text-sm mt-4">
                  {teamStack.length > 0 ? `Stack plays when you start · ` : ""}{bpm} BPM
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* === PREVIEW PHASE === */}
          {phase === "preview" && (
            <div className="mb-6">
              <div className="rounded-2xl p-5 mb-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-white/50 text-xs uppercase tracking-widest mb-3">
                  Your team's stack · {teamStack.length} loop{teamStack.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1.5 mb-4">
                  {teamStack.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-white/30 text-xs w-16 truncate shrink-0">{r.playerName}</span>
                      <div className="flex items-center gap-px h-6 flex-1 rounded overflow-hidden">
                        {r.waveform.map((h, j) => (
                          <div key={j} className="flex-1 rounded-sm"
                            style={{
                              height: `${Math.max(10, h * 100)}%`,
                              background: isPlayingPreview ? `${player.color}99` : "rgba(255,255,255,0.2)",
                              transition: "background 0.3s",
                            }} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={handleTogglePreview}
                  className="w-full py-2.5 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{
                    background: isPlayingPreview ? `${player.color}33` : "rgba(255,255,255,0.08)",
                    border: `1px solid ${isPlayingPreview ? player.color + "66" : "rgba(255,255,255,0.1)"}`,
                    color: isPlayingPreview ? player.color : "rgba(255,255,255,0.8)",
                  }}>
                  {isPlayingPreview ? "⏸ Stop Preview" : "▶ Preview Stack"}
                </button>
              </div>

              <button onClick={startCountdown}
                className="w-full py-4 rounded-xl text-white font-bold text-base transition-all active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${player.color}, #6366f1)`,
                  boxShadow: `0 0 40px ${player.color}66`,
                }}>
                🎙 Record My Layer
              </button>
              <p className="text-center text-white/25 text-xs mt-2">
                The stack will play while you record
              </p>
            </div>
          )}

          {/* === READY PHASE (first player only) === */}
          {phase === "ready" && (
            <div className="flex flex-col items-center mb-6">
              <motion.button whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}
                onClick={startCountdown}
                className="w-20 h-20 rounded-full flex items-center justify-center text-3xl relative mb-4"
                style={{ background: `linear-gradient(135deg, ${player.color}, #6366f1)`, boxShadow: `0 0 50px ${player.color}80` }}>
                🎙
              </motion.button>
              <p className="text-white font-semibold text-lg">Tap to Record</p>
              <p className="text-white/35 text-sm mt-0.5">You're laying down the foundation</p>
            </div>
          )}

          {/* === RECORDING PHASE === */}
          {phase === "recording" && (
            <div className="flex flex-col items-center mb-4">
              <div className="relative w-20 h-20 flex items-center justify-center mb-4">
                {[1.4, 1.7, 2.0].map((scale, i) => (
                  <motion.div key={i} className="absolute inset-0 rounded-full"
                    style={{ border: `1px solid ${player.color}66` }}
                    animate={{ scale: [1, scale], opacity: [0.7, 0] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4, ease: "easeOut" }} />
                ))}
                <motion.div animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 60 / bpm, repeat: Infinity, ease: "easeInOut" }}
                  className="w-20 h-20 rounded-full flex items-center justify-center text-3xl"
                  style={{ background: `${player.color}33`, border: `2px solid ${player.color}bb` }}>
                  🎙
                </motion.div>
              </div>
              <p className="text-white font-semibold text-lg">Recording...</p>
              <p className="text-sm mt-0.5" style={{ color: player.color }}>
                Bar {currentBar + 1} · Beat {currentBeatInBar + 1}
                {teamStack.length > 0 && <span className="text-white/30 ml-2">· Stack playing</span>}
              </p>
            </div>
          )}

          {/* === REVIEW PHASE === */}
          {phase === "review" && (
            <div className="flex flex-col items-center mb-4">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1, transition: { type: "spring" } }}
                className="w-20 h-20 rounded-full flex items-center justify-center text-3xl mb-4"
                style={{ background: "rgba(52,211,153,0.15)", border: "2px solid rgba(52,211,153,0.5)" }}>
                ✓
              </motion.div>
              <p className="text-white font-semibold text-lg">Loop Recorded</p>
              <p className="text-white/40 text-sm mt-0.5">
                {teamStack.length > 0 ? `Layer ${teamStack.length + 1} of your team's song` : "Foundation layer set"}
              </p>
            </div>
          )}

          {/* Beat grid — recording + review */}
          {(phase === "recording" || phase === "review") && (
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {Array.from({ length: BAR_COUNT }, (_, barIdx) => (
                <div key={barIdx} className="flex gap-1">
                  {Array.from({ length: BEATS_PER_BAR }, (_, beatIdx) => {
                    const gb = barIdx * BEATS_PER_BAR + beatIdx;
                    const isPast = gb < beat;
                    const isCurrent = gb === beat && phase === "recording";
                    return (
                      <motion.div key={beatIdx} className="flex-1 h-2 rounded-sm"
                        animate={isCurrent ? { opacity: [0.6, 1, 0.6] } : {}}
                        transition={{ duration: 0.3, repeat: isCurrent ? Infinity : 0 }}
                        style={{
                          background: isCurrent ? player.color : isPast ? `${player.color}66` : "rgba(255,255,255,0.08)",
                          boxShadow: isCurrent ? `0 0 8px ${player.color}cc` : "none",
                        }} />
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Waveform */}
          {(phase === "recording" || phase === "review") && (
            <div className="flex items-center gap-px h-16 mb-4 rounded-xl px-3 overflow-hidden"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              {displayWaveform.map((h, i) => {
                const barBoundary = i > 0 && i % (WAVEFORM_SEGMENTS / BAR_COUNT) === 0;
                return (
                  <div key={i} style={{ display: "contents" }}>
                    {barBoundary && <div className="w-px h-full shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />}
                    <div className="flex-1 rounded-sm shrink-0"
                      style={{
                        height: `${Math.max(8, h * 100)}%`,
                        background: phase === "review" ? "rgba(52,211,153,0.6)"
                          : i <= (beat / TOTAL_BEATS) * WAVEFORM_SEGMENTS ? `${player.color}bb` : "rgba(255,255,255,0.1)",
                        transition: "height 0.06s ease",
                      }} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Progress bar */}
          {phase === "recording" && (
            <div className="h-1 rounded-full bg-white/10 overflow-hidden mb-4">
              <motion.div className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${player.color}, #6366f1)` }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.1 }} />
            </div>
          )}

          {/* BPM / Metronome controls — shown before recording */}
          {(phase === "ready" || phase === "preview") && (
            <div className="rounded-xl p-3 mb-4 flex items-center gap-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={() => setMetronomeOn(m => !m)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all"
                style={{
                  background: metronomeOn ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${metronomeOn ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.1)"}`,
                  color: metronomeOn ? "#c084fc" : "rgba(255,255,255,0.5)",
                }}>
                <MetronomeIcon active={metronomeOn} bpm={bpm} />
                {metronomeOn ? "Click On" : "Click Off"}
              </button>
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <span className="text-white/30 text-xs">BPM</span>
                <input type="number" value={bpmInput}
                  onChange={e => setBpmInput(e.target.value)} onBlur={handleBpmBlur}
                  min={40} max={200}
                  className="flex-1 bg-transparent text-white text-sm font-bold text-center outline-none w-12" />
              </div>
              <button onClick={handleTap}
                className="px-3 py-2 rounded-lg text-xs text-white/60 active:scale-95"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Tap
              </button>
            </div>
          )}

          {/* === MIC PRE-ARM + MONITORING PANEL === */}
          {(phase === "ready" || phase === "preview") && (
            <div className="mb-4 rounded-2xl overflow-hidden"
              style={{ border: `1px solid ${micArmed ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.08)"}`, background: "rgba(255,255,255,0.03)" }}>

              {/* Arm / disarm row */}
              <button
                onClick={handleToggleMicArm}
                disabled={micArming}
                className="w-full flex items-center justify-between px-4 py-3 text-sm transition-all active:scale-95"
                style={{ color: micArmed ? "#f87171" : "rgba(255,255,255,0.55)" }}
              >
                <span className="flex items-center gap-2">
                  <motion.span
                    animate={micArmed ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                    transition={{ duration: 1.2, repeat: micArmed ? Infinity : 0, ease: "easeInOut" }}
                    style={{ fontSize: "1rem", display: "inline-block" }}>
                    🎙
                  </motion.span>
                  <span className="font-medium">{micArming ? "Connecting mic…" : micArmed ? "Mic Armed" : "Arm Mic"}</span>
                  {micArmed && (
                    <span className="text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(239,68,68,0.18)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" }}>
                      LIVE
                    </span>
                  )}
                </span>
                <span className="text-xs" style={{ color: micArmed ? "rgba(248,113,113,0.6)" : "rgba(255,255,255,0.25)" }}>
                  {micArmed ? "Tap to disarm" : "Enable before recording"}
                </span>
              </button>

              {/* Level meter + monitoring toggle — only visible when armed */}
              <AnimatePresence>
                {micArmed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    style={{ overflow: "hidden" }}
                  >
                    {/* Divider */}
                    <div style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />

                    <div className="px-4 py-3 flex flex-col gap-3">
                      {/* Level meter */}
                      <div className="flex items-center gap-2">
                        <span className="text-white/30 text-xs w-8 shrink-0">IN</span>
                        <div className="flex gap-0.5 flex-1">
                          {Array.from({ length: levelBars }, (_, i) => {
                            const lit = i < litBars;
                            const isRed = i >= levelBars * 0.85;
                            const isYellow = i >= levelBars * 0.65;
                            return (
                              <motion.div
                                key={i}
                                className="flex-1 rounded-sm"
                                style={{
                                  height: "10px",
                                  background: lit
                                    ? isRed ? "#ef4444" : isYellow ? "#facc15" : "#4ade80"
                                    : "rgba(255,255,255,0.08)",
                                  transition: "background 0.05s",
                                }}
                              />
                            );
                          })}
                        </div>
                        <span className="text-white/20 text-xs w-8 text-right shrink-0">
                          {litBars === 0 ? "—" : litBars >= levelBars * 0.85 ? "HOT" : "OK"}
                        </span>
                      </div>

                      {/* Monitoring toggle */}
                      <button
                        onClick={() => setMonitoringOn(m => !m)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all active:scale-95"
                        style={{
                          background: monitoringOn ? "rgba(34,197,94,0.12)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${monitoringOn ? "rgba(34,197,94,0.35)" : "rgba(255,255,255,0.09)"}`,
                          color: monitoringOn ? "#4ade80" : "rgba(255,255,255,0.45)",
                        }}
                      >
                        <span className="flex items-center gap-2">
                          <span style={{ fontSize: "0.9rem" }}>🎧</span>
                          <span className="font-medium">Monitoring</span>
                          {monitoringOn && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full"
                              style={{ background: "rgba(34,197,94,0.2)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}>
                              On
                            </span>
                          )}
                        </span>
                        <span className="text-xs" style={{ color: monitoringOn ? "rgba(74,222,128,0.6)" : "rgba(255,255,255,0.2)" }}>
                          {monitoringOn ? "Hearing yourself" : "Use headphones"}
                        </span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            {phase === "review" && (
              <>
                <button onClick={handleToggleReview}
                  className="px-4 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{ background: isPlayingReview ? `${player.color}33` : "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                  {isPlayingReview ? "⏸" : "▶"}
                </button>
                <button onClick={handleRetry}
                  className="flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}>
                  ↺ Retry
                </button>
                <button onClick={handleConfirm}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                  style={{ background: `linear-gradient(135deg, ${player.color}, #6366f1)`, boxShadow: `0 0 30px ${player.color}66` }}>
                  Add to Stack ✓
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function MetronomeIcon({ active, bpm }: { active: boolean; bpm: number }) {
  return (
    <motion.div
      animate={active ? { rotate: [12, -12, 12] } : { rotate: 0 }}
      transition={{ duration: 60 / bpm, repeat: active ? Infinity : 0, ease: "easeInOut" }}
      style={{ display: "inline-block", transformOrigin: "bottom center" }}>
      ♩
    </motion.div>
  );
}
