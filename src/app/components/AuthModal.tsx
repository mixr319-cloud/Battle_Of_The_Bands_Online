import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

interface Props {
  onGuestAuth: (username: string) => Promise<void>;
  authError: string | null;
  loading: boolean;
}

export function AuthModal({ onGuestAuth, authError, loading }: Props) {
  const [step, setStep] = useState<"choose" | "username">("choose");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");

  function handleDiscord() {
    // Real OAuth redirect — browser goes to backend → Discord → back to frontend
    window.location.href = `${API_URL}/auth/discord`;
  }

  function handleGoogle() {
    window.location.href = `${API_URL}/auth/google`;
  }

  async function handleGuestSubmit() {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length < 2) { setError("Name must be at least 2 characters"); return; }
    if (trimmed.length > 20) { setError("Name must be 20 characters or less"); return; }
    setError("");
    try {
      await onGuestAuth(trimmed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(20px)" }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 24 }}
        animate={{ scale: 1, opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } }}
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{
          background: "rgba(10,7,22,0.97)",
          border: "1px solid rgba(168,85,247,0.25)",
          boxShadow: "0 0 80px rgba(168,85,247,0.15), 0 40px 80px rgba(0,0,0,0.8)",
        }}
      >
        <div className="h-0.5" style={{ background: "linear-gradient(90deg, transparent, #a855f7, transparent)" }} />

        <div className="p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-white tracking-tight">
              BATTLE<span style={{ color: "#a855f7" }}> OF THE</span> BANDS
            </h1>
            <p className="text-white/35 text-xs mt-1 tracking-widest uppercase">Team Battle · Live Loop Creation</p>
          </div>

          <AnimatePresence mode="wait">
            {step === "choose" && (
              <motion.div key="choose" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <p className="text-white/60 text-sm text-center mb-6">Sign in to save your level & XP</p>

                <div className="space-y-3 mb-4">
                  {/* Discord — real OAuth */}
                  <button
                    onClick={handleDiscord}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-95 hover:brightness-110"
                    style={{ background: "#5865F2", color: "white" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.03.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
                    </svg>
                    Continue with Discord
                    <span className="ml-auto text-white/50 text-xs">↗ Opens Discord</span>
                  </button>

                  {/* Google — real OAuth */}
                  <button
                    onClick={handleGoogle}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-95 hover:brightness-110"
                    style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                    <span className="ml-auto text-white/50 text-xs">↗ Opens Google</span>
                  </button>
                </div>

                <div className="relative flex items-center gap-3 my-5">
                  <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
                  <span className="text-white/25 text-xs">or</span>
                  <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
                </div>

                <button
                  onClick={() => setStep("username")}
                  className="w-full py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}
                >
                  Continue as Guest
                </button>
                <p className="text-white/25 text-xs text-center mt-3">Guests' XP is saved locally only</p>
              </motion.div>
            )}

            {step === "username" && (
              <motion.div key="username" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="flex items-center gap-2 mb-6">
                  <button onClick={() => setStep("choose")} className="text-white/40 hover:text-white/70 transition-colors text-sm">← Back</button>
                  <span className="text-white/20 text-sm">·</span>
                  <span className="text-white/40 text-sm">Playing as guest</span>
                </div>

                <p className="text-white font-semibold text-lg mb-1">Choose your name</p>
                <p className="text-white/40 text-sm mb-6">This is how other players will see you</p>

                <input
                  autoFocus
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleGuestSubmit()}
                  placeholder="e.g. BassDropKing"
                  maxLength={20}
                  className="w-full px-4 py-3.5 rounded-xl text-white text-sm mb-2 outline-none transition-all"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: (error || authError) ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.15)",
                    caretColor: "#a855f7",
                  }}
                />
                {(error || authError) && <p className="text-red-400 text-xs mb-3">{error || authError}</p>}

                <button
                  onClick={handleGuestSubmit}
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl text-white font-bold text-sm mt-3 transition-all active:scale-95 disabled:opacity-50"
                  style={{
                    background: "linear-gradient(135deg, #a855f7, #6366f1)",
                    boxShadow: "0 0 30px rgba(168,85,247,0.4)",
                  }}
                >
                  {loading ? "Joining..." : "Let's Battle 🎸"}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
