import { motion } from "motion/react";
import type { Team, BattleKey } from "../App";
import type { Genre } from "./LobbyScreen";
import { BandStrip } from "./BandStrip";

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
  battleKey: BattleKey;
  bpm: number;
  genre: Genre;
  /** User IDs of players currently flagged as disconnected (mid-grace-period or fully gone). */
  disconnectedPlayers?: Set<string>;
}

export function GameScreen({ teams, currentTurn, currentTurns, teamSize, battleKey, bpm, genre, disconnectedPlayers }: Props) {
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
    <div className="size-full flex flex-col px-4 py-6">
      {/* Header */}
      <div className="text-center mb-4">
        <h2 className="text-white font-black text-2xl tracking-tight">BATTLE OF THE BANDS</h2>
        <p className="text-white/40 text-xs mt-0.5 uppercase tracking-widest">
          Loop {totalRecorded + 1} of {total}
        </p>
        <div className="mt-3 h-0.5 rounded-full bg-white/10 overflow-hidden max-w-xs mx-auto">
          <motion.div
            className="h-full rounded-full"
            style={{ background: "linear-gradient(90deg, #a855f7, #6366f1)" }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      </div>

      {/* Shared battle info */}
      <div className="flex items-center justify-center gap-3 mb-5">
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.3)", backdropFilter: "blur(20px)" }}
        >
          <span className="text-purple-300 text-xs uppercase tracking-widest">Key</span>
          <span className="text-white font-bold text-sm">{battleKey.root} {battleKey.mode}</span>
        </div>
        <div
          className="flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(20px)" }}
        >
          <span className="text-white/40 text-xs uppercase tracking-widest">BPM</span>
          <span className="text-white font-bold text-sm">{bpm}</span>
        </div>
      </div>

      {/* Teams — both recording simultaneously */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        <TeamColumn team={teams.A} activeTurn={activeA} disconnectedPlayers={disconnectedPlayers} />
        <div className="flex flex-col items-center justify-center gap-2 shrink-0">
          <div className="w-px flex-1 bg-white/10" />
          <span className="text-white/30 text-xs font-bold">VS</span>
          <div className="w-px flex-1 bg-white/10" />
        </div>
        <TeamColumn team={teams.B} activeTurn={activeB} disconnectedPlayers={disconnectedPlayers} />
      </div>

      {/* Status indicator */}
      <div className="mt-5 text-center">
        <motion.p
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 1.5, repeat: Infinity }}
          className="text-purple-400 text-sm font-medium"
        >
          🎙 Both teams are recording simultaneously...
        </motion.p>
      </div>

      {/* Genre band strip — one member animates at random to represent whoever's recording */}
      <BandStrip genre={genre} isRecording={isAnyRecording} recordingSignature={recordingSignature} />
    </div>
  );
}

function TeamColumn({ team, activeTurn, disconnectedPlayers }: { team: Team; activeTurn: CurrentTurnInfo | null; disconnectedPlayers?: Set<string> }) {
  const isActive = activeTurn !== null;

  return (
    <div className="flex-1 flex flex-col gap-3">
      <div className="text-center">
        <span
          className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full"
          style={{
            background: isActive ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.06)",
            color: isActive ? "#d8b4fe" : "rgba(255,255,255,0.4)",
            border: `1px solid ${isActive ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.08)"}`,
          }}
        >
          {team.name}
        </span>
      </div>

      <div className="flex flex-col gap-2 flex-1">
        {team.players.map((player, idx) => {
          const isCurrentPlayer = activeTurn !== null && idx === activeTurn.playerIdx;
          const isDisconnected = !!disconnectedPlayers?.has(player.id);
          return (
            <motion.div
              key={player.id}
              layout
              className="relative rounded-xl p-4 flex flex-col gap-2"
              style={{
                background: isCurrentPlayer
                  ? "rgba(168,85,247,0.15)"
                  : player.hasRecorded
                  ? "rgba(255,255,255,0.07)"
                  : "rgba(255,255,255,0.04)",
                border: isDisconnected
                  ? "1px solid rgba(248,113,113,0.4)"
                  : isCurrentPlayer
                  ? "1px solid rgba(168,85,247,0.5)"
                  : player.hasRecorded
                  ? "1px solid rgba(255,255,255,0.1)"
                  : "1px solid rgba(255,255,255,0.06)",
                opacity: isDisconnected ? 0.6 : 1,
                backdropFilter: "blur(20px)",
              }}
            >
              {isCurrentPlayer && (
                <motion.div
                  className="absolute inset-0 rounded-xl pointer-events-none"
                  animate={{ opacity: [0, 0.25, 0] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  style={{ background: "rgba(168,85,247,0.3)" }}
                />
              )}

              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 relative"
                  style={{ background: player.color + "22", border: `1px solid ${player.color}44`, color: player.color }}
                >
                  {player.name[0]}
                  {isDisconnected && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full"
                      style={{ background: "#f87171", border: "1.5px solid rgba(10,7,22,0.9)" }}
                      title="Connection lost"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{player.name}</div>
                  <div className="text-white/30 text-xs">Lv.{player.level}</div>
                </div>
                <StatusBadge player={player} isCurrent={isCurrentPlayer} isDisconnected={isDisconnected} />
              </div>

              <div className="h-0.5 rounded-full bg-white/10 overflow-hidden">
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

function StatusBadge({ player, isCurrent, isDisconnected }: { player: { hasRecorded: boolean; isRecording: boolean }; isCurrent: boolean; isDisconnected?: boolean }) {
  if (isDisconnected) {
    return (
      <motion.span
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1, repeat: Infinity }}
        className="text-xs px-2 py-0.5 rounded-full text-red-300 shrink-0"
        style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.35)" }}
      >
        Reconnecting…
      </motion.span>
    );
  }
  if (player.hasRecorded) {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50 shrink-0">Done ✓</span>;
  }
  if (player.isRecording || isCurrent) {
    return (
      <motion.span
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 0.8, repeat: Infinity }}
        className="text-xs px-2 py-0.5 rounded-full text-purple-300 shrink-0"
        style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.3)" }}
      >
        🔴 REC
      </motion.span>
    );
  }
  return <span className="text-xs text-white/20 shrink-0">Waiting</span>;
}
