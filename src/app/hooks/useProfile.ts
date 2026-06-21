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
  // Premium fields
  isPremium: boolean;
  avatarUrl?: string | null;
  tiktokHandle?: string | null;
  instagramHandle?: string | null;
  bio?: string | null;
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
    isPremium: (data.isPremium || data.is_premium || false) as boolean,
    avatarUrl: (data.avatarUrl || data.avatar_url || null) as string | null,
    tiktokHandle: (data.tiktokHandle || data.tiktok_handle || null) as string | null,
    instagramHandle: (data.instagramHandle || data.instagram_handle || null) as string | null,
    bio: (data.bio || null) as string | null,
  };
}

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export function useProfile() {
  const [profile, setProfileState] = useState<Profile | null>(loadProfile);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const setProfile = useCallback((p: Profile | null) => {
    if (p) saveProfile(p);
    setProfileState(p);
  }, []);

  const loginFromOAuth = useCallback((params: URLSearchParams) => {
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
      isPremium: params.get("isPremium") === "true",
      avatarUrl: params.get("avatarUrl") || null,
      tiktokHandle: null,
      instagramHandle: null,
      bio: null,
    };
    saveProfile(p);
    setProfileState(p);
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

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

  const refreshProfile = useCallback(async () => {
    const cached = loadProfile();
    if (!cached?.id) return;
    try {
      const data = await fetchUserProfile(cached.id);
      const current = loadProfile();
      if (current?.id !== cached.id) return;
      const p = serverToProfile(data);
      saveProfile(p);
      setProfileState(p);
    } catch (e: unknown) {
      const isNotFound =
        (e instanceof Response && e.status === 404) ||
        (e instanceof Error && e.message.includes(": 404"));
      if (isNotFound) {
        localStorage.removeItem(STORAGE_KEY);
        setProfileState(null);
      }
    }
  }, []);

  /** Update the local cached profile with partial changes (e.g. after premium upgrade). */
  const patchProfile = useCallback((patch: Partial<Profile>) => {
    setProfileState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      saveProfile(updated);
      return updated;
    });
  }, []);

  /** Kick off a Stripe Checkout session for BOTB Premium. */
  const startPremiumCheckout = useCallback(async () => {
    const cached = loadProfile();
    if (!cached?.id) throw new Error("Not logged in");
    const res = await fetch(`${API_BASE}/premium/create-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: cached.id }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to start checkout");
    }
    const { checkoutUrl } = await res.json();
    window.location.href = checkoutUrl;
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth")) return;
    refreshProfile();
  }, [refreshProfile]);

  // Handle ?premium=success redirect from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("premium") === "success") {
      window.history.replaceState({}, "", window.location.pathname);
      // Refresh after a short delay so the webhook has time to process
      setTimeout(() => refreshProfile(), 2000);
    }
  }, [refreshProfile]);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setProfileState(null);
  }, []);

  return {
    profile,
    loading,
    authError,
    loginFromOAuth,
    loginGuest,
    refreshProfile,
    patchProfile,
    startPremiumCheckout,
    logout,
    setProfile,
  };
}
