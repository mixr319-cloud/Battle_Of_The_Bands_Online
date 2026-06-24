/**
 * UserProfileModal — displays a premium user's public profile.
 * Used both for viewing your own profile and browsing others.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Profile } from "../hooks/useProfile";
import { getRank } from "../hooks/useProfile";
import { PremiumAvatarFrame } from "./PremiumAvatarFrame";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  level: number;
  wins: number;
  battles: number;
  mvps: number;
  bio?: string | null;
  tiktokHandle?: string | null;
  instagramHandle?: string | null;
  isPremium: boolean;
}

interface Props {
  targetUserId: string | null; // null = view own profile
  viewerProfile: Profile;
  open: boolean;
  onClose: () => void;
  onPatchProfile?: (patch: Partial<Profile>) => void; // for own-profile edits
}

export function UserProfileModal({ targetUserId, viewerProfile, open, onClose, onPatchProfile }: Props) {
  const isOwnProfile = !targetUserId || targetUserId === viewerProfile.id;
  const [profileData, setProfileData] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // Edit form state (own profile only)
  const [editBio, setEditBio] = useState("");
  const [editTiktok, setEditTiktok] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const uid = isOwnProfile ? viewerProfile.id : targetUserId!;
      const url = `${API_BASE}/profiles/${uid}?viewer_id=${viewerProfile.id}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error((await res.json()).detail || "Failed to load profile");
      const data: PublicProfile = await res.json();
      setProfileData(data);
      if (isOwnProfile) {
        setEditBio(data.bio || "");
        setEditTiktok(data.tiktokHandle || "");
        setEditInstagram(data.instagramHandle || "");
        setEditAvatarUrl(data.avatarUrl || "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [open, isOwnProfile, targetUserId, viewerProfile.id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  async function saveProfile() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API_BASE}/profiles/${viewerProfile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: editBio || null,
          tiktokHandle: editTiktok || null,
          instagramHandle: editInstagram || null,
          avatarUrl: editAvatarUrl || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Save failed");
      const updated: PublicProfile = await res.json();
      setProfileData(updated);
      onPatchProfile?.({
        bio: updated.bio,
        tiktokHandle: updated.tiktokHandle,
        instagramHandle: updated.instagramHandle,
        avatarUrl: updated.avatarUrl,
      });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const rank = profileData ? getRank(profileData.level) : "";
  const winRate = profileData && profileData.battles > 0
    ? Math.round((profileData.wins / profileData.battles) * 100) : 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm"
          />
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.93, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } }}
            exit={{ opacity: 0, scale: 0.93, y: 20, transition: { duration: 0.16 } }}
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-sm rounded-2xl overflow-hidden"
              style={{
                background: "rgba(10,7,22,0.98)",
                border: `1px solid ${profileData?.avatarColor ?? "#a855f7"}44`,
                boxShadow: `0 0 50px ${profileData?.avatarColor ?? "#a855f7"}18, 0 24px 60px rgba(0,0,0,0.85)`,
              }}
            >
              <div className="h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${profileData?.avatarColor ?? "#a855f7"}, transparent)` }} />

              <div className="p-5">
                {/* Header */}
                <div className="flex justify-between items-start mb-5">
                  <h3 className="text-white font-black text-base">
                    {isOwnProfile ? "Your Profile" : "Player Profile"}
                  </h3>
                  <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors text-lg">✕</button>
                </div>

                {loading && <p className="text-white/40 text-sm text-center py-8">Loading…</p>}
                {error && <p className="text-red-400 text-sm text-center py-4">{error}</p>}

                {profileData && !loading && !editing && (
                  <>
                    {/* Avatar + name */}
                    <div className="flex items-center gap-4 mb-5">
                      <PremiumAvatarFrame isPremium={profileData.isPremium} rounded="rounded-2xl" crownSize="text-sm" crownClassName="-top-2 -right-2">
                        {profileData.avatarUrl ? (
                          <img
                            src={profileData.avatarUrl}
                            alt="avatar"
                            className="w-16 h-16 rounded-2xl object-cover shrink-0"
                            style={{ border: `2px solid ${profileData.avatarColor}55` }}
                            onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        ) : (
                          <div
                            className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black text-white shrink-0"
                            style={{ background: `linear-gradient(135deg, ${profileData.avatarColor}, #6366f1)` }}
                          >
                            {profileData.displayName[0].toUpperCase()}
                          </div>
                        )}
                      </PremiumAvatarFrame>
                      <div>
                        <div className="text-white font-black text-lg leading-tight">{profileData.displayName}</div>
                        <div className="text-white/40 text-xs">@{profileData.username}</div>
                        <div className="text-white/30 text-xs mt-0.5">{rank} · Lv. {profileData.level}</div>
                      </div>
                    </div>

                    {/* Bio */}
                    {profileData.bio && (
                      <div
                        className="rounded-xl p-3 mb-4 text-white/60 text-xs leading-relaxed"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
                      >
                        {profileData.bio}
                      </div>
                    )}

                    {/* Social links */}
                    {(profileData.tiktokHandle || profileData.instagramHandle) && (
                      <div className="flex gap-2 mb-4 flex-wrap">
                        {profileData.tiktokHandle && (
                          <a
                            href={`https://tiktok.com/@${profileData.tiktokHandle}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", color: "#f0f0f0" }}
                          >
                            <span>🎵</span> @{profileData.tiktokHandle}
                          </a>
                        )}
                        {profileData.instagramHandle && (
                          <a
                            href={`https://instagram.com/${profileData.instagramHandle}`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-opacity hover:opacity-80"
                            style={{ background: "rgba(131,58,180,0.25)", border: "1px solid rgba(131,58,180,0.4)", color: "#e879f9" }}
                          >
                            <span>📸</span> @{profileData.instagramHandle}
                          </a>
                        )}
                      </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      {[
                        { label: "Battles", value: profileData.battles },
                        { label: "Wins", value: profileData.wins },
                        { label: "MVPs", value: profileData.mvps },
                      ].map(s => (
                        <div key={s.label} className="rounded-xl p-3 text-center"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <div className="text-white font-black text-lg leading-none">{s.value}</div>
                          <div className="text-white/35 text-xs mt-0.5">{s.label}</div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between px-1 mb-4">
                      <span className="text-white/40 text-xs">Win Rate</span>
                      <span className="font-bold text-sm" style={{ color: winRate >= 50 ? "#34d399" : "rgba(255,255,255,0.5)" }}>
                        {winRate}%
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {isOwnProfile && (
                        <button
                          onClick={() => setEditing(true)}
                          className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                          style={{ background: "rgba(168,85,247,0.15)", border: "1px solid rgba(168,85,247,0.35)", color: "#c084fc" }}
                        >
                          ✏️ Edit Profile
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* Edit mode */}
                {editing && isOwnProfile && (
                  <>
                    <div className="space-y-3 mb-4">
                      <div>
                        <label className="text-white/40 text-xs block mb-1">Profile Picture URL</label>
                        <input
                          value={editAvatarUrl}
                          onChange={e => setEditAvatarUrl(e.target.value)}
                          placeholder="https://… (image URL)"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-purple-500/60 placeholder-white/20"
                        />
                        <p className="text-white/25 text-[10px] mt-1">Paste a publicly-accessible image URL. Right Click the image and copy the address. If the link doesn't work, try clicking open in a new tab.</p>
                      </div>
                      <div>
                        <label className="text-white/40 text-xs block mb-1">Bio (280 chars)</label>
                        <textarea
                          value={editBio}
                          onChange={e => setEditBio(e.target.value.slice(0, 280))}
                          placeholder="Tell the world about your sound…"
                          rows={3}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-purple-500/60 placeholder-white/20 resize-none"
                        />
                        <p className="text-white/25 text-[10px] text-right">{editBio.length}/280</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-white/40 text-xs block mb-1">🎵 TikTok</label>
                          <input
                            value={editTiktok}
                            onChange={e => setEditTiktok(e.target.value.replace(/^@/, "").slice(0, 50))}
                            placeholder="yourusername"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-purple-500/60 placeholder-white/20"
                          />
                        </div>
                        <div>
                          <label className="text-white/40 text-xs block mb-1">📸 Instagram</label>
                          <input
                            value={editInstagram}
                            onChange={e => setEditInstagram(e.target.value.replace(/^@/, "").slice(0, 50))}
                            placeholder="yourusername"
                            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-white text-xs outline-none focus:border-purple-500/60 placeholder-white/20"
                          />
                        </div>
                      </div>
                    </div>

                    {saveError && <p className="text-red-400 text-xs mb-3">{saveError}</p>}

                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditing(false); setSaveError(null); }}
                        className="flex-1 py-2.5 rounded-xl text-xs font-medium"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveProfile}
                        disabled={saving}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)", color: "white" }}
                      >
                        {saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
