import { motion } from "motion/react";

/**
 * Shared decorative layer for the main game screens (lobby, finding, game, voting):
 * a faint grain texture, vignette, and a few slow-floating music notes.
 * Purely decorative — sits behind content, ignores pointer events.
 */
export function SceneFX() {
  const notes = [
    { top: "8%", left: "4%", size: 22, delay: 0, glyph: "♪" },
    { top: "14%", left: "92%", size: 16, delay: 1.2, glyph: "♫" },
    { top: "80%", left: "7%", size: 16, delay: 2.4, glyph: "♬" },
    { top: "84%", left: "91%", size: 20, delay: 3.6, glyph: "♪" },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden" aria-hidden="true">
      {/* Grain */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.035,
          mixBlendMode: "overlay",
          backgroundImage: "repeating-linear-gradient(0deg, #fff 0px, transparent 1px, transparent 2px)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse 75% 70% at 50% 35%, transparent 45%, rgba(0,0,0,0.45) 100%)",
        }}
      />
      {/* Floating notes */}
      {notes.map((n, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            top: n.top,
            left: n.left,
            fontSize: n.size,
            color: "rgba(168,85,247,0.35)",
            filter: "drop-shadow(0 0 8px rgba(168,85,247,0.6))",
          }}
          animate={{ y: [0, -26, 0], rotate: [-4, 4, -4], opacity: [0.2, 0.55, 0.2] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: n.delay }}
        >
          {n.glyph}
        </motion.div>
      ))}
    </div>
  );
}
