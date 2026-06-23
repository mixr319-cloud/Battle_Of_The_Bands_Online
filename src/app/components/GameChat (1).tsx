/**
 * GameChat — Twitch-style transparent overlay chat.
 * Anchored bottom-left. Always open during match.
 * Everyone sees messages; only premium members can send.
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
      className="fixed bottom-4 left-4 z-50 flex flex-col"
      style={{ width: "220px", maxHeight: "380px", pointerEvents: "none" }}
    >
      {/* Message list — transparent overlay, no background, Twitch style */}
      <div
        className="flex-1 overflow-hidden flex flex-col justify-end gap-1 pb-2"
        style={{ maxHeight: "310px" }}
      >
        {messages.slice(-30).map(msg => (
          <div
            key={msg.id}
            className="flex items-baseline gap-1.5 leading-snug"
            style={{ pointerEvents: "auto" }}
          >
            {/* Name badge */}
            <span
              className="text-[11px] font-bold shrink-0 drop-shadow"
              style={{
                color: msg.avatarColor,
                textShadow: "0 1px 4px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.7)",
              }}
            >
              {msg.displayName}:
            </span>
            {/* Message text */}
            <span
              className="text-[11px] text-white break-words"
              style={{
                textShadow: "0 1px 4px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Emoji palette */}
      {showEmojis && isPremium && (
        <div
          className="flex flex-wrap gap-1 px-2 py-1.5 mb-1 rounded-xl"
          style={{
            background: "rgba(10,7,22,0.85)",
            border: "1px solid rgba(168,85,247,0.25)",
            backdropFilter: "blur(12px)",
            pointerEvents: "auto",
          }}
        >
          {EMOJI_PALETTE.map(e => (
            <button
              key={e}
              onClick={() => insertEmoji(e)}
              className="text-sm hover:scale-125 transition-transform active:scale-95"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{ pointerEvents: "auto" }}>
        {isPremium ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl"
            style={{
              background: "rgba(10,7,22,0.75)",
              border: "1px solid rgba(168,85,247,0.3)",
              backdropFilter: "blur(16px)",
            }}
          >
            <button
              onClick={() => setShowEmojis(s => !s)}
              className="text-sm hover:scale-110 transition-transform shrink-0"
              title="Emojis"
            >
              😄
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.slice(0, 200))}
              onKeyDown={e => { if (e.key === "Enter") handleSend(); }}
              placeholder="Send a message…"
              className="flex-1 bg-transparent text-white text-xs outline-none min-w-0"
              style={{ "::placeholder": { color: "rgba(255,255,255,0.3)" } } as React.CSSProperties}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="text-sm disabled:opacity-30 hover:scale-110 transition-transform shrink-0"
            >
              🎵
            </button>
          </div>
        ) : (
          <div
            className="px-2.5 py-1.5 rounded-xl text-center"
            style={{
              background: "rgba(10,7,22,0.65)",
              border: "1px solid rgba(168,85,247,0.2)",
              backdropFilter: "blur(12px)",
            }}
          >
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.4)" }}>
              👑 <span style={{ color: "#c084fc" }}>Premium</span> to chat
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
