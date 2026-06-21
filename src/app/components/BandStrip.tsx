import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

import rockGuitarist from "../../imports/bands/rock/anim_webp/guitarist.webp";
import rockDrummer from "../../imports/bands/rock/anim_webp/drummer.webp";
import rockSinger from "../../imports/bands/rock/anim_webp/singer.webp";
import rockBassist from "../../imports/bands/rock/anim_webp/bassist.webp";

// Static PNGs used when a member is not performing (webps are animated and can't be paused)
import rockGuitaristStill from "../../imports/bands/rock/guitarist.png";
import rockDrummerStill from "../../imports/bands/rock/drummer.png";
import rockSingerStill from "../../imports/bands/rock/singer.png";
import rockBassistStill from "../../imports/bands/rock/bassist.png";

type PerformStyle = "strum" | "drum" | "sing";

interface BandMember {
  id: string;
  src: string;
  /** Static PNG used when this member is idle — animated webp can't be paused by the browser. */
  staticSrc: string;
  /** Native pixel size of the animated webp. */
  w: number;
  h: number;
  /** Native pixel size of the static PNG (may differ from webp). */
  sw: number;
  sh: number;
  style: PerformStyle;
  /** Where the rotation/lean pivots from, e.g. feet for a standing player, hips for a seated drummer. */
  origin: string;
}

// One roster per genre. Add new genres here as their art is produced —
// anything missing falls back to the Rock set in getBandSet().
const BAND_SETS: Partial<Record<Genre, BandMember[]>> = {
  Rock: [
    { id: "guitarist", src: rockGuitarist, staticSrc: rockGuitaristStill, w: 263, h: 504, sw: 302, sh: 604, style: "strum", origin: "50% 100%" },
    { id: "drummer", src: rockDrummer, staticSrc: rockDrummerStill, w: 384, h: 383, sw: 474, sh: 456, style: "drum", origin: "50% 75%" },
    { id: "singer", src: rockSinger, staticSrc: rockSingerStill, w: 246, h: 469, sw: 304, sh: 564, style: "sing", origin: "50% 100%" },
    { id: "bassist", src: rockBassist, staticSrc: rockBassistStill, w: 253, h: 458, sw: 312, sh: 551, style: "strum", origin: "50% 100%" },
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
  /** 3 for 3v3, 4 for 4v4 — controls how many band members are shown. */
  teamSize: number;
}

const TARGET_HEIGHT = 504; // px, height of the tallest (standing) member, scaled to match the app's 1.5x base UI scale

export function BandStrip({ genre, bpm, isRecording, recordingSignature, teamSize }: Props) {
  const members = getBandSet(genre).slice(0, teamSize);
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
      className="mt-3 flex items-end justify-center gap-8 sm:gap-16 pointer-events-none select-none shrink-0"
      style={{ height: TARGET_HEIGHT }}
      aria-hidden="true"
    >
      {members.map((m, i) => {
        const isActive = i === activeIdx;
        const dimmed = isRecording && !isActive;
        const perf = getPerformAnimation(m.style, beatSec);

        const sharedStyle: React.CSSProperties = {
          width: Math.round(m.w * scale),
          height: Math.round(m.h * scale),
          opacity: dimmed ? 0.4 : 1,
          display: "block",
        };

        if (isActive) {
          return (
            <motion.img
              key={`${m.id}-active`}
              src={m.src}
              alt=""
              draggable={false}
              style={{
                ...sharedStyle,
                transformOrigin: m.origin,
                filter: "drop-shadow(0 0 10px rgba(168,85,247,0.7)) drop-shadow(0 0 26px rgba(168,85,247,0.4))",
              }}
              animate={perf.animate}
              transition={perf.transition}
            />
          );
        }

        return (
          <img
            key={`${m.id}-idle`}
            src={m.staticSrc}
            alt=""
            draggable={false}
            style={{
              ...sharedStyle,
              width: Math.round(m.sw * scale),
              height: Math.round(m.sh * scale),
            }}
          />
        );
      })}
    </div>
  );
}

function getPerformAnimation(style: PerformStyle, beatSec: number) {
  switch (style) {
    case "strum":
      // Gentle lean on the beat — subtle down-stroke and recovery.
      return {
        animate: { rotate: [0, -3, 1, -2, 0], y: [0, 1, 0, 0.5, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: "easeInOut", times: [0, 0.25, 0.5, 0.75, 1] },
      };
    case "drum":
      // Soft nod downward on the beat, gentle recovery.
      return {
        animate: { y: [0, 4, 0], rotate: [0, 1.5, 0] },
        transition: { duration: beatSec, repeat: Infinity, ease: ["easeOut", "easeIn"], times: [0, 0.35, 1] },
      };
    case "sing":
      // Slow, subtle sway side-to-side.
      return {
        animate: { x: [0, -3, 3, 0], rotate: [0, -1.5, 1.5, 0], y: [0, -2, -2, 0] },
        transition: { duration: beatSec * 2, repeat: Infinity, ease: "easeInOut" },
      };
  }
}

