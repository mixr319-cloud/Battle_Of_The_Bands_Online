import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

// Static still-frame art for every band member. All movement (idle stillness,
// the active performer's sway/bounce) is driven purely by Framer Motion on
// this single clean image — the old animated webp sprites had a ghosting
// artifact baked into the source frames themselves, so they're no longer used.
import rockGuitarist from "../../imports/bands/rock/guitarist.png";
import rockDrummer from "../../imports/bands/rock/drummer.png";
import rockSinger from "../../imports/bands/rock/singer.png";
import rockBassist from "../../imports/bands/rock/bassist.png";

type PerformStyle = "strum" | "drum" | "sing";

interface BandMember {
  id: string;
  src: string;
  /** Native pixel size of the source art, used to keep true relative scale between members. */
  w: number;
  h: number;
  style: PerformStyle;
  /** Where the rotation/lean pivots from, e.g. feet for a standing player, hips for a seated drummer. */
  origin: string;
}

// One roster per genre. Add new genres here as their art is produced —
// anything missing falls back to the Rock set in getBandSet().
const BAND_SETS: Partial<Record<Genre, BandMember[]>> = {
  Rock: [
    { id: "guitarist", src: rockGuitarist, w: 302, h: 604, style: "strum", origin: "50% 100%" },
    { id: "drummer", src: rockDrummer, w: 474, h: 456, style: "drum", origin: "50% 75%" },
    { id: "singer", src: rockSinger, w: 304, h: 564, style: "sing", origin: "50% 100%" },
    { id: "bassist", src: rockBassist, w: 312, h: 551, style: "strum", origin: "50% 100%" },
  ],
};

function getBandSet(genre: Genre): BandMember[] {
  return BAND_SETS[genre] ?? BAND_SETS.Rock!;
}

interface Props {
  genre: Genre;
  bpm: number;
  /** True whenever at least one player is actively recording. */
  isRecording: boolean;
  /** Changes whenever the set of currently-recording players changes (re-rolls the random performer). */
  recordingSignature: string;
  /** Number of players per team (3 for 3v3, 4 for 4v4) — controls how many band members are shown. */
  teamSize: number;
}

const TARGET_HEIGHT = 336; // px, height of the tallest (standing) member — doubled from the original 168

// Gap between members, keyed by how many are on screen. The 4-member gap is the
// original spacing; the 3-member gap is widened so the *total* row width stays
// about the same even with one fewer member between the same outer edges.
const GAP_BY_COUNT: Record<number, string> = {
  4: "gap-8 sm:gap-14",
  3: "gap-12 sm:gap-20",
};

export function BandStrip({ genre, bpm, isRecording, recordingSignature, teamSize }: Props) {
  const fullSet = getBandSet(genre);
  // Show one band member per player on a team (3 for 3v3, 4 for 4v4), capped to the available roster.
  const visibleCount = Math.min(Math.max(teamSize, 1), fullSet.length);
  const members = fullSet.slice(0, visibleCount);
  const gapClass = GAP_BY_COUNT[visibleCount] ?? GAP_BY_COUNT[4];

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const lastSignature = useRef<string>("");

  useEffect(() => {
    if (!isRecording) {
      setActiveIdx(null);
      lastSignature.current = "";
      return;
    }
    // Pick a new random "performer" whenever recording starts or the recording lineup changes.
    if (recordingSignature !== lastSignature.current) {
      lastSignature.current = recordingSignature;
      setActiveIdx(Math.floor(Math.random() * members.length));
    }
  }, [isRecording, recordingSignature, members.length]);

  // Scale every member relative to the tallest one so they keep correct relative proportions.
  const maxH = Math.max(...members.map(m => m.h));
  const scale = TARGET_HEIGHT / maxH;
  const beatSec = 60 / Math.max(40, Math.min(220, bpm || 100));

  return (
    <div
      className={`mt-3 flex items-end justify-center ${gapClass} pointer-events-none select-none`}
      style={{ height: TARGET_HEIGHT }}
      aria-hidden="true"
    >
      {members.map((m, i) => {
        const isActive = i === activeIdx;
        const dimmed = isRecording && !isActive;
        const perf = getPerformAnimation(m.style, beatSec);
        return (
          <motion.img
            key={m.id}
            src={m.src}
            alt=""
            draggable={false}
            style={{
              width: Math.round(m.w * scale),
              height: Math.round(m.h * scale),
              transformOrigin: m.origin,
              opacity: dimmed ? 0.4 : 1,
              filter: isActive
                ? "drop-shadow(0 0 10px rgba(168,85,247,0.7)) drop-shadow(0 0 26px rgba(168,85,247,0.4))"
                : "none",
            }}
            animate={isActive ? perf.animate : { y: 0, scale: 1 }}
            transition={isActive ? perf.transition : { duration: 0.3 }}
          />
        );
      })}
    </div>
  );
}

function getPerformAnimation(style: PerformStyle, beatSec: number) {
  switch (style) {
    case "strum":
      // Subtle sway in time with the beat.
      return {
        animate: { scale: [1, 1.04, 1], y: [0, -2, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: "easeInOut" },
      };
    case "drum":
      // Gentle pulse on the beat, much softer than a full hit-snap.
      return {
        animate: { scale: [1, 1.035, 1], y: [0, 1.5, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: "easeInOut" },
      };
    case "sing":
      // Slow, soft sway.
      return {
        animate: { scale: [1, 1.03, 1], y: [0, -3, 0] },
        transition: { duration: beatSec * 2, repeat: Infinity, ease: "easeInOut" },
      };
  }
}

