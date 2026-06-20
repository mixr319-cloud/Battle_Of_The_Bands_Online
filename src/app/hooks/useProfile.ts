import { useState, useCallback, useEffect } from "react";
import { registerGuest, fetchUserProfile } from "./useGameSocket";

export type AuthType = "guest" | "discord" | "google";

export interface Profile {
  id: string;
  oauthId: string;
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
  // Backend may return snake_case or camelCase depending on the endpoint route. Map both safely.
  return {
    id: (data.id || "") as string,
    oauthId: (data.oauthId || data.oauth_id || "") as string,
    username: (data.username || "") as string,
    displayName: (data.displayName || data.display_name || data.username || "Player") as string,
    authType: (data.authType || data.auth_type || "guest") as AuthType,
    level: (data.level || 1) as number,
    xp: (data.xp || 0) as number,
    xpToNext: (data.xpToNext || data.xp_to_next || 650) as number,
    wins: (data.wins || 0) as number,
    battles: (data.battles || 0) as number,
    mvps: (data.mvps || 0) as number,
    avatarColor: (data.avatarColor || data.avatar_color || "#a855f7") as string,
  };
}

export function useProfile() {
  const [profile, setProfileState] = useState<Profile | null>(loadProfile);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Called after Discord/Google OAuth redirect with query params
  const loginFromOAuth = useCallback((params: URLSearchParams) => {
    // Clear any stale guest or prior session so OAuth always wins over cached state
    localStorage.removeItem(STORAGE_KEY);
    const p: Profile = {
      id: params.get("userId") ?? "",
      oauthId: params.get("oauthId") ?? "",
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
    } catch (e: unknown) {
      // If the server returns 404 the stored user_id no longer exists in the DB
      // (e.g. DB was reset, or the user cleared storage on another device and
      // re-registered with a different UUID).  Clear local storage so the auth
      // modal appears rather than leaving the user stuck with a phantom profile.
      const isNotFound =
        (e instanceof Response && e.status === 404) ||
        (e instanceof Error && e.message.includes(": 404"));
      if (isNotFound) {
        localStorage.removeItem(STORAGE_KEY);
        setProfileState(null);
      }
      // All other errors (network timeouts, 5xx) are swallowed so a brief
      // connectivity blip doesn't log the user out.
    }
  }, []);

  // Sync profile with server on initial app load so we don't rely on stale localStorage
  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfileState(null);
  }, []);

  return { profile, loading, authError, loginFromOAuth, loginGuest, refreshProfile, logout };
}
