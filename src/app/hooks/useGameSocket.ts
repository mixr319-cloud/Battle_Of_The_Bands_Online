/**
 * useGameSocket — manages the WebSocket connection to the backend.
 * One socket per user session; reconnects automatically.
 */
import { useRef, useCallback, useEffect } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/matches/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export { API_URL };

type MessageHandler = (msg: Record<string, unknown>) => void;

export function useGameSocket(userId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<MessageHandler[]>([]);

  const connect = useCallback(() => {
    if (!userId || wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(`${WS_URL}/${userId}`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handlersRef.current.forEach((h) => h(msg));
      } catch {}
    };
    ws.onclose = () => {
      // Reconnect after 2s if still have userId
      setTimeout(() => {
        if (userId) connect();
      }, 2000);
    };
    wsRef.current = ws;
  }, [userId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.push(handler);
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  return { send, onMessage, connect };
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
  const res = await fetch(`${API_URL}/users/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

/**
 * Get the raw audio bytes for a recording. Recordings made locally in this
 * browser session carry a `blob` (instant, no network). Recordings that came
 * from the server (e.g. a teammate's loop on another device) only have a
 * `url` pointing at the backend's /uploads/audio endpoint — fetch those.
 */
export async function fetchRecordingArrayBuffer(rec: { blob?: Blob; url?: string }): Promise<ArrayBuffer> {
  if (rec.blob) return rec.blob.arrayBuffer();
  if (rec.url) {
    const path = rec.url.startsWith("http") ? rec.url : `${API_URL}${rec.url}`;
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to fetch recording audio: ${rec.url}`);
    return res.arrayBuffer();
  }
  throw new Error("Recording has neither a blob nor a url");
}
