/**
 * useGameSocket — manages the WebSocket connection to the backend.
 * One socket per user session; reconnects automatically.
 */
import { useRef, useCallback, useEffect, useState } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/matches/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export { API_URL };

type MessageHandler = (msg: Record<string, unknown>) => void;

export function useGameSocket(userId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<MessageHandler[]>([]);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef<number>(0);
  // Exposed so the UI can show a "reconnecting..." indicator for the
  // user's OWN connection (as opposed to player_disconnected/
  // player_reconnected messages, which describe *other* players' status).
  // Starts true on first mount to avoid a flash of "disconnected" before
  // the initial connection has had a chance to open.
  const [connected, setConnected] = useState(true);
  // Messages that couldn't be sent because the socket wasn't OPEN at the
  // time — e.g. the brief window during a heartbeat-triggered reconnect.
  // Previously send() just silently dropped the message in that case. The
  // worst case was `loop_vote_request`: the recorder's client had already
  // optimistically shown "waiting for teammates", so nothing on screen
  // indicated the request never reached the server. The server's turn
  // state never advanced, so a reload would just re-prompt them to
  // record. Queueing and flushing on reconnect fixes that without
  // requiring the caller to know or care about socket state.
  const sendQueueRef = useRef<Record<string, unknown>[]>([]);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const flushQueue = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const queued = sendQueueRef.current;
    sendQueueRef.current = [];
    queued.forEach((msg) => wsRef.current!.send(JSON.stringify(msg)));
  }, []);

  const connect = useCallback(() => {
    if (!userId || wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_URL}/${userId}`);
    ws.onopen = () => {
      lastPongRef.current = Date.now();
      setConnected(true);
      flushQueue();

      // Heartbeat: the only thing that previously told the client a
      // connection had gone bad was ws.onclose firing — but a socket can
      // go silently stale (mobile network idling out, a backgrounded tab,
      // a router hiccup) without ever actually closing. When that
      // happened, the client just sat there forever with no idea any
      // message — like the next recording/loop-vote prompt — had been
      // missed, and a manual page refresh was the only fix. Pinging every
      // 8s and forcing a reconnect if no pong comes back within 20s gives
      // the client a way to notice and self-heal instead.
      clearHeartbeat();
      heartbeatIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastPongRef.current > 20000) {
          wsRef.current.close();
          return;
        }
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }, 8000);
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "pong") {
          lastPongRef.current = Date.now();
          return;
        }
        handlersRef.current.forEach((h) => h(msg));
      } catch {}
    };
    ws.onclose = () => {
      clearHeartbeat();
      setConnected(false);
      // Reconnect after 2s if still have userId
      setTimeout(() => {
        if (userId) connect();
      }, 2000);
    };
    wsRef.current = ws;
  }, [userId, clearHeartbeat, flushQueue]);

  useEffect(() => {
    connect();
    return () => {
      clearHeartbeat();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, clearHeartbeat]);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      sendQueueRef.current.push(msg);
    }
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  return { send, onMessage, connect, connected };
}

// ── HTTP helpers ──────────────────────────────────────────────────

export async function registerGuest(username: string, avatarColor: string) {
  const res = await fetch(`${API_URL}/users/register/guest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, avatar_color: avatarColor }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Registration failed");
  }
  return res.json();
}

export async function uploadRecording(
  blob: Blob,
  waveform: number[],
  matchId: string,
  userId: string,
  teamId: string,
  playerName: string,
): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.append("file", blob, "recording.webm");
  form.append("match_id", matchId);
  form.append("user_id", userId);
  form.append("team_id", teamId);
  form.append("player_name", playerName);
  form.append("waveform", JSON.stringify(waveform));

  const res = await fetch(`${API_URL}/uploads/audio`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function submitVoteResults(
  matchId: string,
  winner: string,
  votesA: number,
  votesB: number,
  mvpAId: string,
  mvpBId: string,
) {
  await fetch(`${API_URL}/ratings/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      match_id: matchId,
      winner_team: winner,
      votes_a: votesA,
      votes_b: votesB,
      mvp_a_user_id: mvpAId,
      mvp_b_user_id: mvpBId,
    }),
  });
}

export async function fetchUserProfile(userId: string) {
  const res = await fetch(`${API_URL}/users/${userId}?_t=${Date.now()}`);
  if (!res.ok) throw new Error(`Failed to fetch profile: ${res.status}`);
  return res.json();
}

/**
 * Get the raw audio bytes for a recording. Priority order:
 * 1. `blob`     — locally recorded in this browser session (instant, no network)
 * 2. `audiob64` — base64 payload sent by the server over WebSocket (instant, no HTTP fetch)
 * 3. `url`      — persisted on the backend; fetch via HTTP (requires a network round-trip)
 */
export async function fetchRecordingArrayBuffer(rec: { blob?: Blob; url?: string; audiob64?: string }): Promise<ArrayBuffer> {
  if (rec.blob) return rec.blob.arrayBuffer();
  if (rec.audiob64) {
    // Decode base64 → ArrayBuffer without any network request
    const binary = atob(rec.audiob64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  if (rec.url) {
    const path = rec.url.startsWith("http") ? rec.url : `${API_URL}${rec.url}`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch recording audio: ${rec.url}`);
    return res.arrayBuffer();
  }
  throw new Error("Recording has neither a blob, audiob64, nor a url");
}
