import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import garageBg from "../imports/ChatGPT_Image_Jun_9__2026__06_31_04_AM.png";
import { LobbyScreen } from "./components/LobbyScreen";
import type { Genre } from "./components/LobbyScreen";
import { FindingScreen } from "./components/FindingScreen";
import { GameScreen } from "./components/GameScreen";
import { RecordingModal } from "./components/RecordingModal";
import { LoopVoteModal } from "./components/LoopVoteModal";
import { VotingScreen } from "./components/VotingScreen";
import { ResultsScreen } from "./components/ResultsScreen";
import { TutorialModal, TUTORIAL_STORAGE_KEY } from "./components/TutorialModal";
import { AuthModal } from "./components/AuthModal";
import { ProfileIcon } from "./components/ProfileIcon";
import { useProfile } from "./hooks/useProfile";
import { useGameSocket, uploadRecording, submitVoteResults } from "./hooks/useGameSocket";

export type Screen = "lobby" | "finding" | "game" | "voting" | "results";
export type TeamSize = 3 | 4;

export interface Player {
  id: string;
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  color: string;
  hasRecorded: boolean;
  isRecording: boolean;
  isNpc?: boolean;
  teamId?: "A" | "B";
  playerIdx?: number;
}

export interface Team {
  id: "A" | "B";
  name: string;
  players: Player[];
}

export interface BattleKey {
  root: string;
  mode: string;
}

export interface Recording {
  id?: string;
  blob?: Blob;
  url?: string;
  waveform: number[];
  playerName: string;
  teamId: "A" | "B";
}

const TURN_LIMIT_SECS = 180;

export default function App() {
  const { profile, loading: profileLoading, authError, loginFromOAuth, loginGuest, refreshProfile, logout } = useProfile();
  const { send, onMessage } = useGameSocket(profile?.id ?? null);

  const [screen, setScreen] = useState<Screen>("lobby");
  const [tutorialOpen, setTutorialOpen] = useState(() => !localStorage.getItem(TUTORIAL_STORAGE_KEY));
  const [teamSize, setTeamSize] = useState<TeamSize>(4);
  const [selectedGenre, setSelectedGenre] = useState<Genre>("Hip-Hop");

  // Game state — now driven by server messages
  const [matchId, setMatchId] = useState<string | null>(null);
  const [teams, setTeams] = useState<{ A: Team; B: Team } | null>(null);
  const [battleKey, setBattleKey] = useState<BattleKey | null>(null);
  const [bpm, setBpm] = useState<number>(90);
  const [currentTurn, setCurrentTurn] = useState<{ teamId: "A" | "B"; playerIdx: number } | null>(null);
  const [turnIdx, setTurnIdx] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const [showRecording, setShowRecording] = useState(false);
  const [pendingLoop, setPendingLoop] = useState<{ recording: Recording; teamId: "A" | "B" } | null>(null);
  const [voteResult, setVoteResult] = useState<"A" | "B" | null>(null);
  const [votes, setVotes] = useState({ A: 0, B: 0 });
  const [mvpResult, setMvpResult] = useState<{ A: string; B: string } | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);

  const recordingsRef = useRef<Recording[]>([]);
  const isMyTurnRef = useRef(false);

  // Check for OAuth redirect params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth")) {
      loginFromOAuth(params);
    }
  }, [loginFromOAuth]);

  // Handle server messages
  useEffect(() => {
    const unsub = onMessage((msg) => {
      const type = msg.type as string;

      if (type === "game_start" || type === "turn_advance") {
        const serverTeams = msg.teams as Record<string, unknown>;
        const teamA = serverTeams.A as { id: string; name: string; players: Player[] };
        const teamB = serverTeams.B as { id: string; name: string; players: Player[] };
        setTeams({ A: teamA as Team, B: teamB as Team });
        setBattleKey(msg.battleKey as BattleKey);
        setBpm(msg.bpm as number);
        setCurrentTurn(msg.currentTurn as { teamId: "A" | "B"; playerIdx: number } | null);
        setTurnIdx(msg.turnIdx as number);
        setTotalTurns(msg.totalTurns as number);

        if (msg.recordings) {
          const recs = msg.recordings as Recording[];
          recordingsRef.current = recs;
          setRecordings(recs);
        }

        if (type === "game_start") {
          setMatchId(msg.matchId as string);
          setScreen("game");
        }

        // Check if it's MY turn
        const turn = msg.currentTurn as { teamId: "A" | "B"; playerIdx: number } | null;
        if (turn && profile) {
          const myPlayer = (type === "game_start" ? teamA : teamA).players.find(
            p => p.id === profile.id
          ) || teamB.players.find(p => p.id === profile.id);
          const isMe = myPlayer && myPlayer.teamId === turn.teamId && myPlayer.playerIdx === turn.playerIdx;
          isMyTurnRef.current = !!isMe;
          if (isMe) {
            setTimeout(() => setShowRecording(true), type === "game_start" ? 800 : 600);
          } else {
            setShowRecording(false);
          }
        }
      }

      if (type === "voting_start") {
        const recs = msg.recordings as Recording[];
        recordingsRef.current = recs;
        setRecordings(recs);
        setTeams(msg.teams as { A: Team; B: Team });
        setTimeout(() => setScreen("voting"), 400);
      }

      if (type === "results") {
        setVoteResult(msg.winner as "A" | "B");
        setVotes(msg.votes as { A: number; B: number });
        setMvpResult(msg.mvp as { A: string; B: string });
        const recs = msg.recordings as Recording[];
        recordingsRef.current = recs;
        setRecordings(recs);
        setTeams(msg.teams as { A: Team; B: Team });
        setScreen("results");
        // Refresh profile to get updated XP from server
        refreshProfile();
      }

      if (type === "bpm_changed") {
        setBpm(msg.bpm as number);
      }
    });
    return unsub;
  }, [onMessage, profile, refreshProfile]);

  function startGame(size: TeamSize, genre: Genre) {
    setTeamSize(size);
    setSelectedGenre(genre);
    setScreen("finding");
  }

  function onGameStart(gameState: Record<string, unknown>) {
    // Handled by the WebSocket message handler above
    // This callback is from FindingScreen and just triggers the WS listener
  }

  async function onRecordDone(audioBlob?: Blob, waveform?: number[]) {
    setShowRecording(false);
    if (!teams || !currentTurn || !matchId || !profile) return;

    const { teamId, playerIdx } = currentTurn;
    const myPlayer = teams[teamId].players[playerIdx];

    if (audioBlob && waveform) {
      // Upload audio to server first
      try {
        const { id: recordingId } = await uploadRecording(
          audioBlob, waveform, matchId, profile.id, teamId, myPlayer.name
        );
        // Store locally with blob for immediate playback in voting
        const newRec: Recording = {
          id: recordingId,
          blob: audioBlob,
          waveform,
          playerName: myPlayer.name,
          teamId,
        };
        setPendingLoop({ recording: newRec, teamId });
      } catch (e) {
        console.error("Upload failed:", e);
        // Still advance turn even if upload fails
        send({ type: "recording_done", matchId, kept: false, teamId, playerName: myPlayer.name });
      }
    } else {
      // Skipped — no recording
      send({
        type: "recording_done",
        matchId,
        kept: false,
        teamId,
        playerName: myPlayer.name,
        waveform: [],
      });
    }
  }

  function onLoopVoteResult(kept: boolean) {
    if (!matchId || !currentTurn || !teams || !profile) return;
    const { teamId, playerIdx } = currentTurn;
    const myPlayer = teams[teamId].players[playerIdx];

    if (kept && pendingLoop) {
      recordingsRef.current = [...recordingsRef.current, pendingLoop.recording];
      setRecordings([...recordingsRef.current]);
    }

    const rec = kept && pendingLoop ? pendingLoop.recording : null;
    send({
      type: "recording_done",
      matchId,
      kept,
      recordingId: rec?.id ?? null,
      waveform: rec?.waveform ?? [],
      teamId,
      playerName: myPlayer.name,
    });

    setPendingLoop(null);
  }

  async function onVotingComplete(
    winner: "A" | "B",
    finalVotes: { A: number; B: number },
    mvp: { A: string; B: string }
  ) {
    if (!matchId) return;

    // Submit results to backend for XP calculation
    await submitVoteResults(matchId, winner, finalVotes.A, finalVotes.B, mvp.A, mvp.B);

    // Tell all clients the results via WebSocket
    send({
      type: "vote_complete",
      matchId,
      winner,
      votesA: finalVotes.A,
      votesB: finalVotes.B,
      mvpAId: mvp.A,
      mvpBId: mvp.B,
    });
  }

  function onPlayAgain() {
    setTeams(null);
    setCurrentTurn(null);
    setVoteResult(null);
    setVotes({ A: 0, B: 0 });
    setMvpResult(null);
    setBattleKey(null);
    setRecordings([]);
    recordingsRef.current = [];
    setPendingLoop(null);
    setMatchId(null);
    setScreen("lobby");
  }

  const currentTeamStack = currentTurn
    ? recordingsRef.current.filter(r => r.teamId === currentTurn.teamId)
    : [];

  // Show auth modal if no profile
  if (!profile) {
    return (
      <div className="relative size-full overflow-hidden">
        <img src={garageBg} alt="Garage band"
          className="absolute inset-0 w-full h-full object-cover scale-105"
          style={{ filter: "blur(10px) brightness(0.28) saturate(1.3)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.3), rgba(0,0,0,0.5))" }} />
        <AuthModal
          onGuestAuth={loginGuest}
          authError={authError}
          loading={profileLoading}
        />
      </div>
    );
  }

  return (
    <div className="relative size-full overflow-hidden">
      <img src={garageBg} alt="Garage band rocking out"
        className="absolute inset-0 w-full h-full object-cover scale-105"
        style={{ filter: "blur(10px) brightness(0.28) saturate(1.3)" }} />
      <div className="absolute inset-0"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.5) 100%)" }} />

      <div className="relative size-full">
        <AnimatePresence mode="wait">
          {screen === "lobby" && (
            <motion.div key="lobby" {...fadeSlide} className="size-full">
              <LobbyScreen profile={profile} onStart={startGame} />
            </motion.div>
          )}
          {screen === "finding" && (
            <motion.div key="finding" {...fadeSlide} className="size-full">
              <FindingScreen
                teamSize={teamSize}
                genre={selectedGenre}
                userId={profile.id}
                displayName={profile.displayName}
                avatarColor={profile.avatarColor}
                level={profile.level}
                xp={profile.xp}
                xpToNext={profile.xpToNext}
                onGameStart={onGameStart}
                send={send}
                onMessage={onMessage}
              />
            </motion.div>
          )}
          {screen === "game" && teams && currentTurn && battleKey && (
            <motion.div key="game" {...fadeSlide} className="size-full">
              <GameScreen
                teams={teams}
                currentTurn={currentTurn}
                teamSize={teamSize}
                battleKey={battleKey}
                bpm={bpm}
                soloMode={false}
              />
            </motion.div>
          )}
          {screen === "voting" && teams && (
            <motion.div key="voting" {...fadeSlide} className="size-full">
              <VotingScreen teams={teams} recordings={recordings} onComplete={onVotingComplete} />
            </motion.div>
          )}
          {screen === "results" && teams && voteResult && mvpResult && (
            <motion.div key="results" {...fadeSlide} className="size-full">
              <ResultsScreen
                teams={teams} winner={voteResult} votes={votes}
                mvp={mvpResult} recordings={recordings} onPlayAgain={onPlayAgain} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ProfileIcon profile={profile} onLogout={logout} />

      <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />

      <motion.button
        onClick={() => setTutorialOpen(true)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold"
        style={{
          background: "rgba(10,7,22,0.85)",
          border: "1px solid rgba(168,85,247,0.35)",
          color: "rgba(168,85,247,0.85)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 0 18px rgba(168,85,247,0.18)",
        }}
      >
        <span style={{ fontSize: "0.85rem" }}>?</span>
        How to Play
      </motion.button>

      <AnimatePresence>
        {showRecording && currentTurn && teams && battleKey && (
          <RecordingModal
            player={teams[currentTurn.teamId].players[currentTurn.playerIdx]}
            turnNumber={turnIdx + 1}
            totalTurns={totalTurns}
            battleKey={battleKey}
            bpm={bpm}
            onBpmChange={(newBpm) => {
              setBpm(newBpm);
              if (matchId) send({ type: "bpm_change", matchId, bpm: newBpm });
            }}
            teamStack={currentTeamStack}
            onDone={onRecordDone}
            turnTimeLimit={TURN_LIMIT_SECS}
          />
        )}
        {pendingLoop && teams && (
          <LoopVoteModal
            loop={pendingLoop.recording}
            teamPlayers={teams[pendingLoop.teamId].players}
            teamStack={recordingsRef.current.filter(r => r.teamId === pendingLoop.teamId)}
            onResult={onLoopVoteResult}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const fadeSlide = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] } },
  exit: { opacity: 0, y: -16, transition: { duration: 0.3 } },
};
