/**
 * GameChat — match lobby chat widget.
 * Always open during match. Everyone can read; only premium members can send.
 */
import { useState, useRef, useEffect } from "react";

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
  isPremium: boolean;
}

const EMOJI_PALETTE = [
  "🎸","🥁","🎤","🎹","🎺","🎻","🎷","🎵","🎶","🔥","⚡","💥","🎯","👑",
  "🤘","👏","🙌","💃","🕺","😤","😎","🥳","🤩","💪","✨","🌟","💫","🎊",
];

export function GameChat({ messages, onSend, currentUserId, isPremium }: Props) {
  const [input, setInput] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    if (!isPremium) return;
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
    <div
      className="fixed bottom-4 right-4 z-50 w-64 flex flex-col rounded-2xl overflow-hidden"
      style={{
        background: "rgba(10,7,22,0.97)",
        border: "1px solid rgba(168,85,247,0.3)",
        boxShadow: "0 0 40px rgba(168,85,247,0.15), 0 20px 60px rgba(0,0,0,0.8)",
        backdropFilter: "blur(20px)",
        maxHeight: "340px",
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center gap-2 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(168,85,247,0.08)" }}
      >
        <span className="text-sm">🎵</span>
        <span className="text-white font-bold text-xs">Match Chat</span>
        <span
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: "rgba(168,85,247,0.2)", color: "#c084fc", border: "1px solid rgba(168,85,247,0.3)" }}
        >
          👑 Premium Send
        </span>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0"
        style={{ maxHeight: "220px" }}
      >
        {messages.length === 0 && (
          <p className="text-white/25 text-xs text-center py-4">No messages yet 🎸</p>
        )}
        {messages.map(msg => {
          const isOwn = msg.userId === currentUserId;
          return (
            <div key={msg.id} className={`flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
              <div
                className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black text-white mt-0.5"
                style={{ background: `linear-gradient(135deg, ${msg.avatarColor}, #6366f1)` }}
              >
                {msg.displayName[0].toUpperCase()}
              </div>
              <div className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"} max-w-[80%]`}>
                {!isOwn && (
                  <span className="text-white/35 text-[10px] px-1">{msg.displayName}</span>
                )}
                <div
                  className="px-2 py-1 rounded-xl text-xs text-white leading-relaxed"
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

      {/* Emoji palette — premium only */}
      {showEmojis && isPremium && (
        <div
          className="px-3 py-2 flex flex-wrap gap-1 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
        >
          {EMOJI_PALETTE.map(e => (
            <button
              key={e}
              onClick={() => insertEmoji(e)}
              className="text-sm hover:scale-125 transition-transform active:scale-95"
              title={e}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div
        className="px-3 py-2 flex gap-2 items-center shrink-0"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        {isPremium ? (
          <>
            <button
              onClick={() => setShowEmojis(s => !s)}
              className="text-base hover:scale-110 transition-transform shrink-0"
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
              className="text-base disabled:opacity-30 hover:scale-110 transition-transform shrink-0"
              title="Send"
            >
              🎵
            </button>
          </>
        ) : (
          <p className="text-white/30 text-[10px] text-center w-full py-0.5">
            👑 <span style={{ color: "#c084fc" }}>Upgrade to Premium</span> to chat
          </p>
        )}
      </div>
    </div>
  );
}
