import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Toaster, toast } from "sonner";
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
import { LegalModal } from "./components/LegalModal";
import { AuthModal } from "./components/AuthModal";
import { ProfileIcon } from "./components/ProfileIcon";
import { PremiumModal } from "./components/PremiumModal";
import { UserProfileModal } from "./components/UserProfileModal";
import { GameChat } from "./components/GameChat";
import type { ChatMessage } from "./components/GameChat";
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
  /** XP awarded for this specific match — sent by the server alongside the post-match xp/level. */
  earnedXp?: number;
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
  /** Base64-encoded audio data — provided by the server for instant in-session playback
   *  without an HTTP round-trip. Takes priority over `url` in fetchRecordingArrayBuffer. */
  audiob64?: string;
  waveform: number[];
  playerName: string;
  teamId: "A" | "B";
}

const TURN_LIMIT_SECS = 180;

export default function App() {
  const { profile, loading: profileLoading, authError, loginFromOAuth, loginGuest, refreshProfile, patchProfile, startPremiumCheckout, logout } = useProfile();
  const { send, onMessage, connected } = useGameSocket(profile?.id ?? null);

  const [screen, setScreen] = useState<Screen>("lobby");
  const [tutorialOpen, setTutorialOpen] = useState(() => !localStorage.getItem(TUTORIAL_STORAGE_KEY));
  const [legalOpen, setLegalOpen] = useState(false);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [teamSize, setTeamSize] = useState<TeamSize>(4);
  const [selectedGenre, setSelectedGenre] = useState<Genre>("Hip-Hop");

  // Other players' connection status (separate from `connected` above,
  // which is about THIS client's own socket). Populated by
  // player_disconnected / player_reconnected server messages and surfaced
  // both as toasts and as a badge on the affected player's card in-game.
  const [disconnectedPlayers, setDisconnectedPlayers] = useState<Set<string>>(new Set());

  // Game state
  const [matchId, setMatchId] = useState<string | null>(null);
  const [teams, setTeams] = useState<{ A: Team; B: Team } | null>(null);
  const [battleKey, setBattleKey] = useState<BattleKey | null>(null);
  const [bpm, setBpm] = useState<number>(90);
  const [currentTurn, setCurrentTurn] = useState<{ teamId: "A" | "B"; playerIdx: number } | null>(null);
  const [turnIdx, setTurnIdx] = useState(0);
  const [totalTurns, setTotalTurns] = useState(0);
  const [currentTurns, setCurrentTurns] = useState<Record<string, { teamId: string; playerIdx: number; userId: string; done: boolean }> | null>(null);
  const [showRecording, setShowRecording] = useState(false);
  const [voteResult, setVoteResult] = useState<"A" | "B" | null>(null);
  const [votes, setVotes] = useState({ A: 0, B: 0 });
  const [mvpResult, setMvpResult] = useState<{ A: string; B: string } | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [xpSaveWarning, setXpSaveWarning] = useState(false);
  const [endVoteTimeoutSecs, setEndVoteTimeoutSecs] = useState(30);

  // Loop vote state
  // pendingUpload: the recorder's local recording waiting to be sent for a vote
  const [pendingUpload, setPendingUpload] = useState<{ recording: Recording; teamId: "A" | "B" } | null>(null);
  // loopVoteData: shown to both recorder (waiting) and teammates (voting)
  const [loopVoteData, setLoopVoteData] = useState<{
    recording: Recording;
    recorderId: string;
    recorderName: string;
    teamId: "A" | "B";
    timeoutSecs: number;
    alreadyVoted?: boolean;
  } | null>(null);
  const [loopVoteResult, setLoopVoteResult] = useState<{
    kept: boolean; keepCount: number; dropCount: number;
  } | null>(null);

  const recordingsRef = useRef<Recording[]>([]);
  const teamsRef = useRef<{ A: Team; B: Team } | null>(null);
  const isMyTurnRef = useRef(false);
  // Store the recording blob-only version for teammates who don't have a local blob
  const pendingRecordingRef = useRef<Recording | null>(null);
  const loopVoteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check for OAuth redirect params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth")) {
      loginFromOAuth(params);
    }
  }, [loginFromOAuth]);

  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);

  // Handle server messages
  useEffect(() => {
    const unsub = onMessage((msg) => {
      const type = msg.type as string;

      if (type === "player_disconnected" || type === "player_reconnected") {
        const playerId = msg.userId as string;
        // Look up a display name from whatever team roster we currently
        // have, falling back to a generic label if we don't (e.g. a
        // teammate dropping before game_start has populated teams yet).
        const allPlayers = teamsRef.current
          ? [...teamsRef.current.A.players, ...teamsRef.current.B.players]
          : [];
        const name = allPlayers.find(p => p.id === playerId)?.name ?? "A teammate";

        // Don't show anything for the local player's own connection — the
        // `connected` banner already covers that, and a toast about
        // yourself reconnecting reads as confusing noise.
        if (playerId === profile?.id) return;

        if (type === "player_disconnected") {
          setDisconnectedPlayers(prev => {
            const next = new Set(prev);
            next.add(playerId);
            return next;
          });
          toast(`${name} lost connection`, { description: "Reconnecting...", duration: 4000 });
        } else {
          setDisconnectedPlayers(prev => {
            if (!prev.has(playerId)) return prev;
            const next = new Set(prev);
            next.delete(playerId);
            return next;
          });
          toast.success(`${name} is back`, { duration: 3000 });
        }
        return;
      }

      // ── REMOVED FROM MATCH (our own grace window expired while we ────
      // were gone — the server already skipped our turn / excluded our
      // votes and isn't letting us back into this match) ──────────────
      if (type === "removed_from_match") {
        toast.error("You were disconnected too long and were removed from the match.", {
          duration: 6000,
        });
        // Same reset as "Play Again" (see onPlayAgain) — but done with the
        // setState functions directly rather than calling onPlayAgain()
        // itself, since this effect doesn't track matchId/screen in its
        // dependency array and a closure over those would go stale. The
        // setters below are stable across renders regardless, so this is
        // safe; there's also nothing left to tell the server — it already
        // removed us from the room before sending this message.
        if (loopVoteTimeoutRef.current) {
          clearTimeout(loopVoteTimeoutRef.current);
          loopVoteTimeoutRef.current = null;
        }
        setTeams(null);
        setCurrentTurn(null);
        setVoteResult(null);
        setVotes({ A: 0, B: 0 });
        setMvpResult(null);
        setBattleKey(null);
        setRecordings([]);
        recordingsRef.current = [];
        setPendingUpload(null);
        setLoopVoteData(null);
        setLoopVoteResult(null);
        pendingRecordingRef.current = null;
        setMatchId(null);
        setCurrentTurns(null);
        setDisconnectedPlayers(new Set());
        setScreen("lobby");
        return;
      }

      if (type === "game_start" || type === "turn_advance" || type === "team_turn_advance") {
        // We no longer clear loop vote data here on turn_advance. 
        // The 2.5s timeout in loop_vote_result will handle clearing it 
        // so the user can actually see the result before it disappears.
        const serverTeams = msg.teams as Record<string, unknown>;
        const teamA = serverTeams.A as { id: string; name: string; players: Player[] };
        const teamB = serverTeams.B as { id: string; name: string; players: Player[] };
        setTeams({ A: teamA as Team, B: teamB as Team });
        if (msg.battleKey) setBattleKey(msg.battleKey as BattleKey);
        if (msg.bpm) setBpm(msg.bpm as number);
        const newTurn = msg.currentTurn as { teamId: "A" | "B"; playerIdx: number } | null;
        if (newTurn !== null) { setCurrentTurn(newTurn); }
        setTurnIdx(msg.turnIdx as number);
        setTotalTurns(msg.totalTurns as number);

        if (msg.recordings) {
          const serverRecs = msg.recordings as Recording[];
          // Merge: keep local blobs and any audiob64 we already have;
          // the server may attach audiob64 to recordings for instant playback.
          const merged = serverRecs.map(serverRec => {
            const existing = recordingsRef.current.find(r => r.id === serverRec.id);
            return {
              ...serverRec,
              // Preserve local blob if we have it (recorder's own browser)
              blob: existing?.blob ?? serverRec.blob,
              // Prefer existing audiob64 we already cached, fall back to server's
              audiob64: existing?.audiob64 ?? serverRec.audiob64,
            };
          });
          recordingsRef.current = merged;
          setRecordings(merged);
        }

        if (msg.currentTurns) {
          setCurrentTurns(msg.currentTurns as Record<string, { teamId: string; playerIdx: number; userId: string; done: boolean }>);
        }

        if (type === "game_start") {
          setMatchId(msg.matchId as string);
          setScreen("game");

          // We reconnected while our team had a loop vote in flight. The
          // turn index doesn't advance until that vote resolves, so the
          // normal "is it my turn" check below would still say yes and
          // pop the recording screen again — letting the recorder record
          // and submit a SECOND loop on top of the one their teammates
          // are already voting on. Restore the correct modal instead and
          // skip the normal turn check entirely for this message.
          const pendingLoopVote = msg.pendingLoopVote as {
            role: "recorder" | "voter";
            teamId: "A" | "B";
            recorderId: string;
            recorderName: string;
            recording: (Recording & { id?: string; audiob64?: string }) | null;
            teamStack?: Recording[];
            timeoutSecs?: number;
            alreadyVoted?: boolean;
          } | undefined;

          if (pendingLoopVote && pendingLoopVote.recording) {
            const rec: Recording = {
              ...pendingLoopVote.recording,
              teamId: pendingLoopVote.teamId,
            };
            pendingRecordingRef.current = rec;

            const serverStack = pendingLoopVote.teamStack;
            if (serverStack && serverStack.length > 0) {
              const merged = [...recordingsRef.current];
              for (const serverRec of serverStack) {
                const idx = merged.findIndex(r => r.id === serverRec.id);
                if (idx >= 0) {
                  if (serverRec.audiob64 && !merged[idx].audiob64) {
                    merged[idx] = { ...merged[idx], audiob64: serverRec.audiob64 };
                  }
                } else {
                  merged.push(serverRec);
                }
              }
              recordingsRef.current = merged;
              setRecordings([...merged]);
            }

            setLoopVoteData({
              recording: rec,
              recorderId: pendingLoopVote.recorderId,
              recorderName: pendingLoopVote.recorderName,
              teamId: pendingLoopVote.teamId,
              timeoutSecs: pendingLoopVote.timeoutSecs ?? 30,
              alreadyVoted: pendingLoopVote.alreadyVoted ?? false,
            });
            setLoopVoteResult(null);
            setShowRecording(false);
            isMyTurnRef.current = false;
            return;
          }
        }

        // Check if it's MY turn — support both legacy currentTurn and new per-team currentTurns
        if (profile) {
          const myPlayer = teamA.players.find(p => p.id === profile.id)
            || teamB.players.find(p => p.id === profile.id);
          if (myPlayer) {
            // New parallel mode: check per-team turns
            const perTeamTurns = msg.currentTurns as Record<string, { teamId: string; playerIdx: number; userId: string; done: boolean }> | undefined;
            const myTeamTurn = perTeamTurns?.[myPlayer.teamId as string];
            const isMyTurnNew = myTeamTurn && !myTeamTurn.done && myTeamTurn.userId === profile.id;
            // Fallback: legacy single-turn check
            const turn = msg.currentTurn as { teamId: "A" | "B"; playerIdx: number; userId?: string } | null;
            const isMyTurnLegacy = turn && myPlayer.teamId === turn.teamId && myPlayer.playerIdx === turn.playerIdx;
            const isMe = isMyTurnNew || isMyTurnLegacy;
            isMyTurnRef.current = !!isMe;
            if (isMe) {
              setTimeout(() => setShowRecording(true), type === "game_start" ? 800 : 600);
            } else if (type === "team_turn_advance") {
              // Only hide recording if this advance is for MY team
              const advancedTeam = msg.teamId as string | undefined;
              if (advancedTeam === myPlayer.teamId) {
                setShowRecording(false);
              }
            } else {
              setShowRecording(false);
            }
          }
        }
      }

      // ── LOOP VOTE REQUEST (server → teammates) ─────────────────
      if (type === "loop_vote_request" && profile) {
        if (loopVoteTimeoutRef.current) {
          clearTimeout(loopVoteTimeoutRef.current);
          loopVoteTimeoutRef.current = null;
        }
        const rawRec = msg.recording as (Recording & { id?: string; url?: string; audiob64?: string }) | null;
        if (!rawRec) return;
        // Build a Recording with no local blob (teammate fetches from URL or uses base64)
        const rec: Recording = {
          id: rawRec.id,
          url: rawRec.url,
          audiob64: rawRec.audiob64,
          waveform: rawRec.waveform ?? [],
          playerName: rawRec.playerName,
          teamId: rawRec.teamId,
        };
        pendingRecordingRef.current = rec;

        // The server also sends the full prior team stack with audiob64 attached.
        // Merge these into recordingsRef so the LoopVoteModal and subsequent
        // RecordingModal can play back all layers instantly without HTTP fetches.
        const serverStack = msg.teamStack as Recording[] | undefined;
        if (serverStack && serverStack.length > 0) {
          // Merge: update existing recordings with audiob64 if newly provided
          const merged = [...recordingsRef.current];
          for (const serverRec of serverStack) {
            const idx = merged.findIndex(r => r.id === serverRec.id);
            if (idx >= 0) {
              if (serverRec.audiob64 && !merged[idx].audiob64) {
                merged[idx] = { ...merged[idx], audiob64: serverRec.audiob64 };
              }
            } else {
              merged.push(serverRec);
            }
          }
          recordingsRef.current = merged;
          setRecordings([...merged]);
        }

        setLoopVoteData({
          recording: rec,
          recorderId: msg.recorderId as string,
          recorderName: msg.recorderName as string,
          teamId: rec.teamId,
          timeoutSecs: (msg.timeoutSecs as number | undefined) ?? 30,
        });
        setLoopVoteResult(null);
      }

      // ── LOOP VOTE RESULT (server → everyone) ───────────────────
      if (type === "loop_vote_result") {
        const kept = msg.kept as boolean;
        const keepCount = msg.keepCount as number;
        const dropCount = msg.dropCount as number;
        setLoopVoteResult({ kept, keepCount, dropCount });

        // Update local recordings list if kept.
        // Prefer the recording embedded in the message (authoritative for all clients).
        // Fall back to pendingRecordingRef for the recorder's client (has the local blob).
        if (kept) {
          const msgRec = msg.recording as Recording | null | undefined;
          // Use pendingRecordingRef if available (recorder has blob + audiob64)
          // Otherwise use msgRec, enriching it with any audiob64 we have cached
          const recToAdd = pendingRecordingRef.current
            ? pendingRecordingRef.current
            : msgRec
              ? { ...msgRec, audiob64: (msgRec as Recording).audiob64 }
              : null;
          if (recToAdd) {
            recordingsRef.current = [...recordingsRef.current, recToAdd];
            setRecordings([...recordingsRef.current]);
          }
        }

        if (loopVoteTimeoutRef.current) {
          clearTimeout(loopVoteTimeoutRef.current);
        }

        // Clear everything after 2.5s
        loopVoteTimeoutRef.current = setTimeout(() => {
          setLoopVoteData(null);
          setLoopVoteResult(null);
          setPendingUpload(null);
          pendingRecordingRef.current = null;
        }, 2500);
      }

      // ── TEAM RECORDING DONE (this team finished all their turns) ──
      if (type === "team_recording_done") {
        const doneTeamId = msg.teamId as string;
        setCurrentTurns(prev => {
          if (!prev) return prev;
          return { ...prev, [doneTeamId]: { ...prev[doneTeamId], done: true } };
        });
      }

      if (type === "voting_start") {
        const serverRecs = msg.recordings as Recording[];
        const merged = serverRecs.map(serverRec => {
          const existing = recordingsRef.current.find(r => r.id === serverRec.id);
          return {
            ...serverRec,
            blob: existing?.blob ?? serverRec.blob,
            audiob64: existing?.audiob64 ?? serverRec.audiob64,
          };
        });
        recordingsRef.current = merged;
        setRecordings(merged);
        setTeams(msg.teams as { A: Team; B: Team });
        setMatchId(msg.matchId as string);
        setEndVoteTimeoutSecs((msg.timeoutSecs as number | undefined) ?? 30);
        setTimeout(() => setScreen("voting"), 400);
      }

      // ── LOOP VOTE TIMEOUT (server → everyone, time ran out) ────
      if (type === "loop_vote_timeout") {
        // The server is about to resolve with partial votes (kept = tie/empty → keep).
        // Show a "time's up" result briefly so the UI doesn't just silently flip.
        // The real loop_vote_result will arrive right after and replace this.
        // Nothing to do on the client — the upcoming loop_vote_result handles it.
      }

      if (type === "results") {
        setVoteResult(msg.winner as "A" | "B");
        setVotes(msg.votes as { A: number; B: number });
        setMvpResult(msg.mvp as { A: string; B: string });
        const serverRecs = msg.recordings as Recording[];
        const merged = serverRecs.map(serverRec => {
          const existing = recordingsRef.current.find(r => r.id === serverRec.id);
          return {
            ...serverRec,
            blob: existing?.blob ?? serverRec.blob,
            audiob64: existing?.audiob64 ?? serverRec.audiob64,
          };
        });
        recordingsRef.current = merged;
        setRecordings(merged);
        setTeams(msg.teams as { A: Team; B: Team });
        setScreen("results");
        if (msg.xpSaveError) {
          // XP failed to persist on the server — warn the user so they know
          // their progress wasn't saved, rather than silently showing stale data.
          console.error("[BotB] XP save failed for one or more players. Server logs will have details.");
          setXpSaveWarning(true);
          // Still attempt a refresh in case only some players were affected.
          setTimeout(() => refreshProfile(), 1000);
        } else {
          setXpSaveWarning(false);
          // Happy path: DB write succeeded, fetch the authoritative updated profile.
          setTimeout(() => refreshProfile(), 1000);
        }
      }

      if (type === "bpm_changed") {
        setBpm(msg.bpm as number);
      }

      // Premium in-game chat
      if (type === "chat_message") {
        const chatMsg: ChatMessage = {
          id: (msg.id as string) || `${Date.now()}-${Math.random()}`,
          userId: msg.userId as string,
          displayName: msg.displayName as string,
          avatarColor: (msg.avatarColor as string) || "#a855f7",
          content: msg.content as string,
          timestamp: (msg.timestamp as number) || Date.now(),
        };
        setChatMessages(prev => [...prev.slice(-99), chatMsg]);
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
  }

  async function onRecordDone(audioBlob?: Blob, waveform?: number[]) {
    setShowRecording(false);
    if (!teams || !matchId || !profile) return;

    // In parallel mode, find my team's current active turn
    const myPlayer = teams.A.players.find(p => p.id === profile.id)
      || teams.B.players.find(p => p.id === profile.id);
    if (!myPlayer) return;
    const teamId = myPlayer.teamId as "A" | "B";

    // Find which player from my team is currently up (should be me)
    const myTeamTurn = currentTurns?.[teamId];
    const playerIdx = myTeamTurn ? myTeamTurn.playerIdx : (currentTurn?.playerIdx ?? 0);
    const activePlayer = teams[teamId].players[playerIdx];
    if (!activePlayer) return;
    const myPlayerForRecording = activePlayer;

    if (audioBlob && waveform) {
      let recordingId = "";
      let url: string | undefined;
      let uploadFailed = false;

      try {
        const res = await uploadRecording(
          audioBlob, waveform, matchId, profile.id, teamId, myPlayerForRecording.name
        );
        recordingId = res.id;
        url = res.url;
      } catch (e) {
        console.error("Upload failed, falling back to base64:", e);
        recordingId = "temp-" + Date.now();
        uploadFailed = true;
      }

      const newRec: Recording = {
        id: recordingId,
        url,
        blob: audioBlob,
        waveform,
        playerName: myPlayerForRecording.name,
        teamId,
      };

      if (loopVoteTimeoutRef.current) {
        clearTimeout(loopVoteTimeoutRef.current);
        loopVoteTimeoutRef.current = null;
      }

      // Show the recorder the "waiting for teammates" state
      pendingRecordingRef.current = newRec;
      setLoopVoteData({
        recording: newRec,
        recorderId: profile.id,
        recorderName: myPlayerForRecording.name,
        teamId,
        timeoutSecs: 30,
      });
      setLoopVoteResult(null);

      // Tell the server to fan out loop_vote_request to teammates
      // Convert the blob to base64 so the server can relay it to teammates instantly
      // (they won't need to make an HTTP request to hear the loop)
      let audiob64: string | undefined;
      try {
        const arrayBuf = await audioBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        audiob64 = btoa(binary);
      } catch {
        // Non-fatal: teammates will fall back to fetching via HTTP URL
      }

      if (uploadFailed && !audiob64) {
        // Total failure, must skip
        setLoopVoteData(null);
        pendingRecordingRef.current = null;
        send({ type: "loop_vote_request", matchId, recording: null });
        return;
      }

      send({
        type: "loop_vote_request",
        matchId,
        teamId,
        recording: {
          id: recordingId,
          url,
          waveform,
          playerName: myPlayerForRecording.name,
          teamId,
        },
        ...(audiob64 ? { audiob64 } : {}),
      });
    } else {
      // Skipped — no recording, advance turn without a vote
      send({
        type: "loop_vote_request",
        matchId,
        teamId,
        recording: null,
      });
    }
  }

  function onLoopVoteCast(vote: "keep" | "drop") {
    if (!matchId || !loopVoteData) return;
    send({
      type: "loop_vote_cast",
      matchId,
      teamId: loopVoteData.teamId,
      vote,
      recording: pendingRecordingRef.current
        ? {
            id: pendingRecordingRef.current.id,
            url: pendingRecordingRef.current.url,
            waveform: pendingRecordingRef.current.waveform,
            playerName: pendingRecordingRef.current.playerName,
            teamId: pendingRecordingRef.current.teamId,
          }
        : null,
    });
  }

  function sendChat(content: string) {
    if (!profile?.isPremium || !matchId) return;
    send({
      type: "chat_message",
      matchId,
      content: content.slice(0, 200),
      userId: profile.id,
      displayName: profile.displayName,
      avatarColor: profile.avatarColor,
    });
    // Optimistically add our own message
    setChatMessages(prev => [...prev.slice(-99), {
      id: `local-${Date.now()}`,
      userId: profile.id,
      displayName: profile.displayName,
      avatarColor: profile.avatarColor,
      content,
      timestamp: Date.now(),
    }]);
  }

  function onPlayAgain() {
    // Tell the server we're done with this room — otherwise it keeps
    // treating us as a member of the finished match: our next page
    // refresh gets auto-routed straight back into it instead of letting
    // us search fresh, and we keep getting its broadcasts (e.g. a former
    // teammate's "reconnected" toast) while we're off queueing for a new
    // game. Must fire before matchId is cleared below.
    if (matchId) {
      send({ type: "leave_match", matchId });
    }
    if (loopVoteTimeoutRef.current) {
      clearTimeout(loopVoteTimeoutRef.current);
      loopVoteTimeoutRef.current = null;
    }
    setTeams(null);
    setCurrentTurn(null);
    setVoteResult(null);
    setVotes({ A: 0, B: 0 });
    setMvpResult(null);
    setBattleKey(null);
    setRecordings([]);
    recordingsRef.current = [];
    setPendingUpload(null);
    setLoopVoteData(null);
    setLoopVoteResult(null);
    pendingRecordingRef.current = null;
    setMatchId(null);
    setCurrentTurns(null);
    setDisconnectedPlayers(new Set());
    setScreen("lobby");
  }

  const myTeamId = profile
    ? (teams?.A.players.find(p => p.id === profile.id) ? "A"
      : teams?.B.players.find(p => p.id === profile.id) ? "B"
      : currentTurn?.teamId)
    : currentTurn?.teamId;

  const currentTeamStack = myTeamId
    ? recordingsRef.current.filter(r => r.teamId === myTeamId)
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
              <LobbyScreen profile={profile} onStart={startGame} send={send} onMessage={onMessage} />
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
                currentTurns={currentTurns ?? undefined}
                teamSize={teamSize}
                battleKey={battleKey}
                bpm={bpm}
                genre={selectedGenre}
                disconnectedPlayers={disconnectedPlayers}
              />
            </motion.div>
          )}
          {screen === "voting" && teams && matchId && (
            <motion.div key="voting" {...fadeSlide} className="size-full">
              <VotingScreen
                teams={teams}
                recordings={recordings}
                myPlayerId={profile.id}
                send={send}
                matchId={matchId}
                onMessage={onMessage}
                timeoutSecs={endVoteTimeoutSecs}
              />
            </motion.div>
          )}
          {screen === "results" && teams && voteResult && mvpResult && (
            <motion.div key="results" {...fadeSlide} className="size-full">
              <ResultsScreen
                teams={teams} winner={voteResult} votes={votes}
                mvp={mvpResult} recordings={recordings} onPlayAgain={onPlayAgain}
                xpSaveWarning={xpSaveWarning} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <ProfileIcon
        profile={profile}
        onLogout={logout}
        onOpenPremium={() => setPremiumOpen(true)}
        onOpenProfile={() => setProfileModalOpen(true)}
      />

      <Toaster theme="dark" position="top-center" richColors />

      <AnimatePresence>
        {!connected && screen !== "lobby" && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold"
            style={{
              background: "rgba(120,30,30,0.85)",
              border: "1px solid rgba(248,113,113,0.4)",
              color: "#fecaca",
              backdropFilter: "blur(12px)",
            }}
          >
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1, repeat: Infinity }}
            >
              ⚠
            </motion.span>
            Reconnecting...
          </motion.div>
        )}
      </AnimatePresence>

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

      <LegalModal open={legalOpen} onClose={() => setLegalOpen(false)} />

      <PremiumModal
        open={premiumOpen}
        onClose={() => setPremiumOpen(false)}
        onCheckout={startPremiumCheckout}
      />

      {profile && (
        <UserProfileModal
          targetUserId={null}
          viewerProfile={profile}
          open={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          onPatchProfile={patchProfile}
        />
      )}

      {profile?.isPremium && screen !== "lobby" && screen !== "finding" && matchId && (
        <GameChat
          messages={chatMessages}
          onSend={sendChat}
          currentUserId={profile.id}
        />
      )}

      <motion.button
        onClick={() => setLegalOpen(true)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        className="fixed bottom-5 left-5 z-50 flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold"
        style={{
          background: "rgba(10,7,22,0.85)",
          border: "1px solid rgba(168,85,247,0.35)",
          color: "rgba(168,85,247,0.85)",
          backdropFilter: "blur(12px)",
          boxShadow: "0 0 18px rgba(168,85,247,0.18)",
        }}
      >
        <span style={{ fontSize: "0.85rem" }}>§</span>
        Legal
      </motion.button>

      <AnimatePresence>
        {showRecording && teams && battleKey && profile && (() => {
          // In parallel mode, find the current user's own player object
          const myRecordingPlayer = teams.A.players.find(p => p.id === profile.id)
            || teams.B.players.find(p => p.id === profile.id);
          if (!myRecordingPlayer) return null;
          return (
            <RecordingModal
              player={myRecordingPlayer}
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
          );
        })()}
        {loopVoteData && teams && (
          <LoopVoteModal
            loop={loopVoteData.recording}
            myPlayerId={profile.id}
            recorderId={loopVoteData.recorderId}
            recorderName={loopVoteData.recorderName}
            teamPlayers={teams[loopVoteData.teamId].players}
            teamStack={recordingsRef.current.filter(r => r.teamId === loopVoteData.teamId)}
            onVote={onLoopVoteCast}
            result={loopVoteResult}
            timeoutSecs={loopVoteData.timeoutSecs}
            alreadyVoted={loopVoteData.alreadyVoted ?? false}
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
