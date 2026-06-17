import { useState, useCallback } from "react";
import { registerGuest, fetchUserProfile } from "./useGameSocket";

export type AuthType = "guest" | "discord" | "google";

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  authType: AuthType;
  level: number;
  xp: number;
  xpToNext: number;
  wins: number;
  battles: number;
  mvps: number;
  avatarColor: string;
}

const COLORS = ["#a855f7","#22d3ee","#f472b6","#34d399","#fb923c","#818cf8","#f87171","#4ade80"];
const STORAGE_KEY = "botb_profile_v2";

const RANK_THRESHOLDS = [
  { level: 1,  rank: "Fresh Noise" },
  { level: 5,  rank: "Rhythm Rider" },
  { level: 10, rank: "Loop Wizard" },
  { level: 20, rank: "Beat Architect" },
  { level: 35, rank: "Sound Sovereign" },
  { level: 50, rank: "Band Legend" },
];

export function getRank(level: number) {
  let rank = RANK_THRESHOLDS[0].rank;
  for (const t of RANK_THRESHOLDS) {
    if (level >= t.level) rank = t.rank;
  }
  return rank;
}

export function xpToNextLevel(level: number) {
  return 500 + level * 150;
}

function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProfile(p: Profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function serverToProfile(data: Record<string, unknown>): Profile {
  return {
    id: data.id as string,
    username: data.username as string,
    displayName: data.displayName as string,
    authType: data.authType as AuthType,
    level: data.level as number,
    xp: data.xp as number,
    xpToNext: data.xpToNext as number,
    wins: data.wins as number,
    battles: data.battles as number,
    mvps: data.mvps as number,
    avatarColor: data.avatarColor as string,
  };
}

export function useProfile() {
  const [profile, setProfileState] = useState<Profile | null>(loadProfile);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Called after Discord/Google OAuth redirect with query params
  const loginFromOAuth = useCallback((params: URLSearchParams) => {
    const p: Profile = {
      id: params.get("userId") ?? "",
      username: params.get("username") ?? "",
      displayName: params.get("displayName") ?? "",
      authType: (params.get("auth") ?? "guest") as AuthType,
      avatarColor: "#" + (params.get("color") ?? "a855f7"),
      level: Number(params.get("level") ?? 1),
      xp: Number(params.get("xp") ?? 0),
      xpToNext: Number(params.get("xpToNext") ?? 650),
      wins: Number(params.get("wins") ?? 0),
      battles: Number(params.get("battles") ?? 0),
      mvps: Number(params.get("mvps") ?? 0),
    };
    saveProfile(p);
    setProfileState(p);
    // Clean URL
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Guest login — registers with backend, persists to DB
  const loginGuest = useCallback(async (username: string) => {
    setLoading(true);
    setAuthError(null);
    try {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const data = await registerGuest(username, color);
      const p = serverToProfile(data);
      saveProfile(p);
      setProfileState(p);
      return p;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Registration failed";
      setAuthError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh profile from server (e.g. after a match to get updated XP)
  const refreshProfile = useCallback(async () => {
    const cached = loadProfile();
    if (!cached?.id) return;
    try {
      const data = await fetchUserProfile(cached.id);
      const p = serverToProfile(data);
      saveProfile(p);
      setProfileState(p);
    } catch {}
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfileState(null);
  }, []);

  return { profile, loading, authError, loginFromOAuth, loginGuest, refreshProfile, logout };
}
