import rockSinger from "../../imports/bands/rock/singer.png";
import rockGuitarist from "../../imports/bands/rock/guitarist.png";
import rockBassist from "../../imports/bands/rock/bassist.png";

const CHARACTERS = {
  singer: { src: rockSinger, glow: "rgba(236,72,153,0.4)" },
  guitarist: { src: rockGuitarist, glow: "rgba(34,211,238,0.3)" },
  bassist: { src: rockBassist, glow: "rgba(34,211,238,0.3)" },
} as const;

interface Props {
  character: keyof typeof CHARACTERS;
  side: "left" | "right";
  /** Width in px at the base 1x scale. */
  width?: number;
  className?: string;
}

/**
 * Decorative character cutout anchored to the bottom-left/right edge of a screen,
 * with a soft colored glow. Purely atmospheric — hidden on narrow viewports via className.
 */
export function StageCharacter({ character, side, width = 280, className = "" }: Props) {
  const { src, glow } = CHARACTERS[character];
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      aria-hidden="true"
      className={`pointer-events-none select-none absolute bottom-0 ${side === "left" ? "left-0" : "right-0"} ${className}`}
      style={{
        width,
        opacity: 0.95,
        filter: `drop-shadow(0 0 30px ${glow}) drop-shadow(0 0 60px rgba(168,85,247,0.25))`,
      }}
    />
  );
}
