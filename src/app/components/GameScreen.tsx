import { motion } from "motion/react";
import type { Team } from "../App";
import type { Genre } from "./LobbyScreen";
import { BandStrip } from "./BandStrip";
import { SceneFX } from "./SceneFX";
import { PremiumAvatarFrame } from "./PremiumAvatarFrame";

interface CurrentTurnInfo {
  teamId: "A" | "B";
  playerIdx: number;
  userId?: string;
  done?: boolean;
}

interface Props {
  teams: { A: Team; B: Team };
  currentTurn: { teamId: "A" | "B"; playerIdx: number } | null;
  currentTurns?: Record<string, CurrentTurnInfo>;  // per-team turns (parallel mode)
  teamSize: number;
  bpm: number;
  genre: Genre;
  /** User IDs of players currently flagged as disconnected (mid-grace-period or fully gone). */
  disconnectedPlayers?: Set<string>;
}

export function GameScreen({ teams, currentTurn, currentTurns, teamSize, bpm, genre, disconnectedPlayers }: Props) {
  const totalRecorded = [...teams.A.players, ...teams.B.players].filter(p => p.hasRecorded).length;
  const total = teamSize * 2;
  const progress = totalRecorded / total;

  // Determine which player is currently recording for each team
  const getTeamActiveTurn = (teamId: "A" | "B"): CurrentTurnInfo | null => {
    if (currentTurns?.[teamId] && !currentTurns[teamId].done) {
      return currentTurns[teamId];
    }
    // Fallback to legacy single currentTurn
    if (currentTurn?.teamId === teamId) return currentTurn;
    return null;
  };

  const activeA = getTeamActiveTurn("A");
  const activeB = getTeamActiveTurn("B");
  const isAnyRecording = !!activeA || !!activeB;
  const recordingSignature = `${activeA?.teamId ?? ""}-${activeA?.playerIdx ?? ""}|${activeB?.teamId ?? ""}-${activeB?.playerIdx ?? ""}`;


  return (
    <div className="relative size-full flex flex-col px-4 py-6 overflow-y-auto">
      <SceneFX />

      {/* Light beams behind the band strip */}
      <div className="absolute bottom-0 left-0 right-0 h-[60%] z-0 pointer-events-none opacity-80 overflow-hidden">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            className="absolute bottom-0"
            style={{
              left: `${20 + i * 30}%`,
              width: 170,
              height: "100%",
              background: [
                "linear-gradient(180deg, transparent, rgba(168,85,247,0.22) 40%, rgba(168,85,247,0.08) 100%)",
                "linear-gradient(180deg, transparent, rgba(236,72,153,0.2) 40%, rgba(236,72,153,0.07) 100%)",
                "linear-gradient(180deg, transparent, rgba(34,211,238,0.18) 40%, rgba(34,211,238,0.06) 100%)",
              ][i],
              filter: "blur(6px)",
              transformOrigin: "bottom center",
            }}
            animate={{ rotate: [-4, 4, -4] }}
            transition={{ duration: 6, repeat: Infinity, delay: i * 1.5, ease: "easeInOut" }}
          />
        ))}
      </div>

      {/* Header */}
      <div className="relative z-10 text-center mb-4 shrink-0">
        <h2
          className="font-black text-2xl tracking-tight text-white"
          style={{ fontFamily: "'Space Grotesk', sans-serif", textShadow: "0 0 10px rgba(255,255,255,0.4), 0 0 24px rgba(168,85,247,0.6)" }}
        >
          BATTLE OF THE BANDS
        </h2>
        <p className="text-white/40 text-xs mt-0.5 uppercase tracking-widest font-semibold">
          Loop {totalRecorded + 1} of {total}
        </p>
        <div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden max-w-xs mx-auto">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #ec4899, #a855f7, #6366f1)", boxShadow: "0 0 12px rgba(168,85,247,0.8)" }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Teams — both recording simultaneously */}
      <div className="relative z-10 flex-1 flex gap-8 shrink-0">
        <TeamColumn team={teams.A} activeTurn={activeA} disconnectedPlayers={disconnectedPlayers} variant="a" />
        <div className="flex flex-col items-center justify-center gap-2.5 shrink-0 w-10">
          <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.18), transparent)" }} />
          <span
            className="font-bold text-base"
            style={{ fontFamily: "'Space Grotesk', sans-serif", color: "rgba(255,255,255,0.3)", textShadow: "0 0 14px rgba(168,85,247,0.4)" }}
          >
            VS
          </span>
          <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.18), transparent)" }} />
        </div>
        <TeamColumn team={teams.B} activeTurn={activeB} disconnectedPlayers={disconnectedPlayers} variant="b" />
      </div>

      {/* Status indicator */}
      <div className="relative z-10 mt-5 text-center shrink-0">
        <motion.p
          animate={{ opacity: [0.65, 1, 0.65] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-sm font-semibold"
          style={{ color: "#d8b4fe", textShadow: "0 0 12px rgba(168,85,247,0.5)" }}
        >
          🎙 Both teams are recording simultaneously...
        </motion.p>
      </div>

      {/* Genre band strip — one member animates at random to represent whoever's recording */}
      <div className="relative z-10">
        <BandStrip genre={genre} bpm={bpm} isRecording={isAnyRecording} recordingSignature={recordingSignature} teamSize={teamSize} />
      </div>
    </div>
  );
}

function TeamColumn({ team, activeTurn, disconnectedPlayers, variant }: { team: Team; activeTurn: CurrentTurnInfo | null; disconnectedPlayers?: Set<string>; variant: "a" | "b" }) {
  const isActive = activeTurn !== null;
  const accent = variant === "a"
    ? { glow: "rgba(236,72,153,", text: "#f9a8d4", soft: "rgba(236,72,153,0.14)" }
    : { glow: "rgba(34,211,238,", text: "#a5f3fc", soft: "rgba(34,211,238,0.14)" };

  return (
    <div className="flex-1 flex flex-col gap-3">
      <div className="text-center">
        <span
          className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full"
          style={{
            background: isActive
              ? `linear-gradient(120deg, ${accent.glow}0.22), rgba(168,85,247,0.14))`
              : "rgba(255,255,255,0.06)",
            color: isActive ? accent.text : "rgba(255,255,255,0.4)",
            border: `1px solid ${isActive ? accent.glow + "0.45)" : "rgba(255,255,255,0.08)"}`,
            boxShadow: isActive ? `0 0 20px -4px ${accent.glow}0.5)` : "none",
          }}
        >
          {team.name}
        </span>
      </div>

      <div className="flex flex-col gap-2.5 flex-1">
        {team.players.map((player, idx) => {
          const isCurrentPlayer = activeTurn !== null && idx === activeTurn.playerIdx;
          const isDisconnected = !!disconnectedPlayers?.has(player.id);
          return (
            <motion.div
              key={player.id}
              layout
              className="relative rounded-2xl p-4 flex flex-col gap-2.5 overflow-hidden"
              style={{
                background: isCurrentPlayer
                  ? `linear-gradient(160deg, ${accent.soft}, rgba(168,85,247,0.06))`
                  : player.hasRecorded
                  ? "rgba(255,255,255,0.045)"
                  : "linear-gradient(160deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))",
                border: isDisconnected
                  ? "1px solid rgba(248,113,113,0.4)"
                  : isCurrentPlayer
                  ? `1px solid ${accent.glow}0.55)`
                  : player.hasRecorded
                  ? "1px solid rgba(255,255,255,0.09)"
                  : "1px solid rgba(255,255,255,0.07)",
                boxShadow: isCurrentPlayer ? `0 0 26px -6px ${accent.glow}0.55)` : "none",
                opacity: isDisconnected ? 0.6 : 1,
              }}
            >
              {isCurrentPlayer && (
                <motion.div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  animate={{ opacity: [0, 1, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ background: accent.soft }}
                />
              )}

              <div className="flex items-center gap-3 relative z-10">
                <PremiumAvatarFrame isPremium={player.isPremium} rounded="rounded-xl" className="shrink-0" crownSize="text-[9px]">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold relative overflow-hidden"
                    style={{ background: player.color + "22", border: `1px solid ${player.color}44`, color: player.color }}
                  >
                    {player.isPremium && player.avatarUrl ? (
                      <img src={player.avatarUrl} alt={player.name} className="w-full h-full object-cover" />
                    ) : (
                      player.name[0]
                    )}
                    {isDisconnected && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
                        style={{ background: "#f87171", border: "1.5px solid rgba(10,7,22,0.9)" }}
                        title="Connection lost"
                      />
                    )}
                  </div>
                </PremiumAvatarFrame>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{player.name}</div>
                  <div className="text-white/30 text-xs">Lv.{player.level}</div>
                </div>
                <StatusBadge player={player} isCurrent={isCurrentPlayer} isDisconnected={isDisconnected} variant={variant} />
              </div>

              <div className="h-[3px] rounded-full bg-white/10 overflow-hidden relative z-10">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(player.xp / player.xpToNext) * 100}%`, background: player.color }}
                />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ player, isCurrent, isDisconnected, variant }: { player: { hasRecorded: boolean; isRecording: boolean }; isCurrent: boolean; isDisconnected?: boolean; variant: "a" | "b" }) {
  if (isDisconnected) {
    return (
      <motion.span
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="text-xs font-bold px-2.5 py-1 rounded-full text-red-300 shrink-0"
        style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.35)" }}
      >
        Reconnecting…
      </motion.span>
    );
  }
  if (player.hasRecorded) {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/10 text-white/50 shrink-0">Done ✓</span>;
  }
  if (player.isRecording || isCurrent) {
    const recStyle = variant === "a"
      ? { color: "#fbcfe8", background: "rgba(236,72,153,0.22)", border: "1px solid rgba(236,72,153,0.4)" }
      : { color: "#bae6fd", background: "rgba(34,211,238,0.2)", border: "1px solid rgba(34,211,238,0.4)" };
    return (
      <motion.span
        animate={{ opacity: [0.45, 1, 0.45] }}
        transition={{ duration: 0.8, repeat: Infinity }}
        className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0"
        style={recStyle}
      >
        🔴 REC
      </motion.span>
    );
  }
  return <span className="text-xs text-white/20 shrink-0">Waiting</span>;
}
