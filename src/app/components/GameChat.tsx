/**
 * GameChat — premium in-game chat component.
 * Shows a collapsible chat drawer anchored to the bottom of the screen.
 * Only visible/usable by premium members.
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  avatarColor: string;
  content: string;
  timestamp: number;
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  currentUserId: string;
}

const EMOJI_PALETTE = [
  "🎸","🥁","🎤","🎹","🎺","🎻","🎷","🎵","🎶","🔥","⚡","💥","🎯","👑",
  "🤘","👏","🙌","💃","🕺","😤","😎","🥳","🤩","💪","✨","🌟","💫","🎊",
];

export function GameChat({ messages, onSend, currentUserId }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track unread when closed
  useEffect(() => {
    if (!open && messages.length > 0) {
      setUnread(c => c + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [open]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    setShowEmojis(false);
    inputRef.current?.focus();
  }

  function insertEmoji(emoji: string) {
    setInput(prev => prev + emoji);
    inputRef.current?.focus();
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Chat bubble toggle */}
      <motion.button
        onClick={() => setOpen(o => !o)}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.93 }}
        className="relative w-12 h-12 rounded-full flex items-center justify-center shadow-lg text-xl"
        style={{ background: "linear-gradient(135deg, #a855f7, #6366f1)", border: "2px solid rgba(255,255,255,0.15)" }}
        title="Band Chat (Premium)"
      >
        {open ? "✕" : "💬"}
        {!open && unread > 0 && (
          <span
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-xs font-black text-white flex items-center justify-center"
            style={{ background: "#ef4444" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </motion.button>

      {/* Chat drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 320, damping: 28 } }}
            exit={{ opacity: 0, y: 16, scale: 0.96, transition: { duration: 0.15 } }}
            className="w-72 rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(10,7,22,0.97)",
              border: "1px solid rgba(168,85,247,0.3)",
              boxShadow: "0 0 40px rgba(168,85,247,0.15), 0 20px 60px rgba(0,0,0,0.8)",
              backdropFilter: "blur(20px)",
              maxHeight: "380px",
            }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 flex items-center gap-2 shrink-0"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(168,85,247,0.08)" }}
            >
              <span className="text-base">🎵</span>
              <span className="text-white font-bold text-sm">Band Chat</span>
              <span
                className="ml-auto text-xs px-1.5 py-0.5 rounded font-medium"
                style={{ background: "rgba(168,85,247,0.2)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)" }}
              >
                👑 Premium
              </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0" style={{ maxHeight: "240px" }}>
              {messages.length === 0 && (
                <p className="text-white/25 text-xs text-center py-4">No messages yet — say hi! 🎸</p>
              )}
              {messages.map(msg => {
                const isOwn = msg.userId === currentUserId;
                return (
                  <div key={msg.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
                    <div
                      className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-black text-white mt-0.5"
                      style={{ background: `linear-gradient(135deg, ${msg.avatarColor}, #6366f1)` }}
                    >
                      {msg.displayName[0].toUpperCase()}
                    </div>
                    <div className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"} max-w-[80%]`}>
                      {!isOwn && <span className="text-white/35 text-[10px] px-1">{msg.displayName}</span>}
                      <div
                        className="px-2.5 py-1.5 rounded-xl text-xs text-white leading-relaxed"
                        style={{
                          background: isOwn ? "linear-gradient(135deg, #a855f7, #6366f1)" : "rgba(255,255,255,0.07)",
                          border: isOwn ? "none" : "1px solid rgba(255,255,255,0.08)",
                          wordBreak: "break-word",
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Emoji palette */}
            <AnimatePresence>
              {showEmojis && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden shrink-0"
                >
                  <div
                    className="px-3 py-2 flex flex-wrap gap-1"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
                  >
                    {EMOJI_PALETTE.map(e => (
                      <button
                        key={e}
                        onClick={() => insertEmoji(e)}
                        className="text-base hover:scale-125 transition-transform active:scale-95"
                        title={e}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input */}
            <div
              className="px-3 py-2.5 flex gap-2 shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
            >
              <button
                onClick={() => setShowEmojis(s => !s)}
                className="text-lg hover:scale-110 transition-transform"
                title="Emojis"
              >
                😄
              </button>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 200))}
                onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
                placeholder="Say something…"
                className="flex-1 bg-transparent text-white text-xs outline-none placeholder-white/25 min-w-0"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="text-base disabled:opacity-30 hover:scale-110 transition-transform"
                title="Send"
              >
                🎵
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
