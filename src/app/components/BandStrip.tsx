import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

import rockGuitarist from "../../imports/bands/rock/anim_webp/guitarist.webp";
import rockDrummer from "../../imports/bands/rock/anim_webp/drummer.webp";
import rockSinger from "../../imports/bands/rock/anim_webp/singer.webp";
import rockBassist from "../../imports/bands/rock/anim_webp/bassist.webp";

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
    { id: "guitarist", src: rockGuitarist, w: 263, h: 504, style: "strum", origin: "50% 100%" },
    { id: "drummer", src: rockDrummer, w: 384, h: 383, style: "drum", origin: "50% 75%" },
    { id: "singer", src: rockSinger, w: 246, h: 469, style: "sing", origin: "50% 100%" },
    { id: "bassist", src: rockBassist, w: 253, h: 458, style: "strum", origin: "50% 100%" },
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
}

const TARGET_HEIGHT = 168; // px, height of the tallest (standing) member

export function BandStrip({ genre, bpm, isRecording, recordingSignature }: Props) {
  const members = getBandSet(genre);
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

  const maxH = Math.max(...members.map(m => m.h));
  const scale = TARGET_HEIGHT / maxH;
  const beatSec = 60 / Math.max(40, Math.min(220, bpm || 100));

  return (
    <div
      className="mt-3 flex items-end justify-center gap-4 sm:gap-8 pointer-events-none select-none"
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
            animate={
              isActive
                ? perf.animate
                : { y: 0, x: 0, rotate: 0, scale: [1, 1.012, 1] }
            }
            transition={
              isActive
                ? perf.transition
                : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }
            }
          />
        );
      })}
    </div>
  );
}

function getPerformAnimation(style: PerformStyle, beatSec: number) {
  switch (style) {
    case "strum":
      // Two strums per beat: a quick down-stroke lean, snap back, up-stroke lean.
      return {
        animate: { rotate: [0, -7, 3, -6, 0], y: [0, 2, 0, 1, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: "easeInOut", times: [0, 0.25, 0.5, 0.75, 1] },
      };
    case "drum":
      // One sharp hit per beat — quick downward snap, slower recovery up, like striking a drum.
      return {
        animate: { y: [0, 7, 0], rotate: [0, 3, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: ["easeOut", "easeIn"], times: [0, 0.35, 1] },
      };
    case "sing":
      // Bigger, slower sway — leaning into the mic on the beat.
      return {
        animate: { x: [0, -5, 5, 0], rotate: [0, -3, 3, 0], y: [0, -5, -5, 0] },
        transition: { duration: beatSec * 2, repeat: Infinity, ease: "easeInOut" },
      };
  }
}

