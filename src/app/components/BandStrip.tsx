import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

// Animated sprite sheets — each is a horizontal strip of FRAMES_PER_SHEET frames
// extracted from an AI-generated performance loop, background removed to transparent.
import guitaristSheet from "../../imports/bands/rock/anim/guitarist_sheet.webp";
import drummerSheet from "../../imports/bands/rock/anim/drummer_sheet.webp";
import singerSheet from "../../imports/bands/rock/anim/singer_sheet.webp";
import bassistSheet from "../../imports/bands/rock/anim/bassist_sheet.webp";

type PerformStyle = "strum" | "drum" | "sing";

interface BandMember {
  id: string;
  src: string;
  frameCount: number;
  /** Native pixel size of a single frame in the sheet — keeps true relative scale between members. */
  w: number;
  h: number;
  style: PerformStyle;
  /** Where the pop/scale pivots from, e.g. feet for a standing player, hips for a seated drummer. */
  origin: string;
}

const FRAMES_PER_SHEET = 16;

// One roster per genre. Add new genres here as their art is produced —
// anything missing falls back to the Rock set in getBandSet().
const BAND_SETS: Partial<Record<Genre, BandMember[]>> = {
  Rock: [
    { id: "guitarist", src: guitaristSheet, frameCount: FRAMES_PER_SHEET, w: 175, h: 340, style: "strum", origin: "50% 100%" },
    { id: "drummer", src: drummerSheet, frameCount: FRAMES_PER_SHEET, w: 351, h: 340, style: "drum", origin: "50% 75%" },
    { id: "singer", src: singerSheet, frameCount: FRAMES_PER_SHEET, w: 193, h: 340, style: "sing", origin: "50% 100%" },
    { id: "bassist", src: bassistSheet, frameCount: FRAMES_PER_SHEET, w: 189, h: 340, style: "strum", origin: "50% 100%" },
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
      {/* Shared keyframes for every sprite sheet: animating background-position-x from 0% to
          100% walks through exactly one full pass of frames, regardless of each sheet's pixel
          width, because background-size-x is set to (frameCount * 100)% of the element's own
          width. `animation-direction: alternate` then plays it forward/backward for a seamless
          loop without needing the source clip to loop perfectly on its own. */}
      <style>{`
        @keyframes bandSpritePlay {
          from { background-position-x: 0%; }
          to { background-position-x: 100%; }
        }
      `}</style>
      {members.map((m, i) => {
        const isActive = i === activeIdx;
        const dimmed = isRecording && !isActive;
        const cycleSec = getCycleDuration(m.style, beatSec, isActive);
        return (
          <motion.div
            key={m.id}
            animate={{ scale: isActive ? 1.06 : 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            style={{
              width: Math.round(m.w * scale),
              height: Math.round(m.h * scale),
              transformOrigin: m.origin,
              opacity: dimmed ? 0.4 : 1,
              transition: "opacity 0.3s ease, filter 0.3s ease",
              filter: isActive
                ? "drop-shadow(0 0 10px rgba(168,85,247,0.7)) drop-shadow(0 0 26px rgba(168,85,247,0.4))"
                : "none",
            }}
          >
            <div
              style={{
                width: "100%",
                height: "100%",
                backgroundImage: `url(${m.src})`,
                backgroundSize: `${m.frameCount * 100}% 100%`,
                backgroundRepeat: "no-repeat",
                animation: `bandSpritePlay ${cycleSec}s steps(${m.frameCount - 1}) infinite alternate`,
              }}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

/** How long one full pass through the sprite sheet takes. Idle members breathe slowly for
 *  ambient life; whichever member is actively "performing" speeds up to roughly track the beat. */
function getCycleDuration(style: PerformStyle, beatSec: number, isActive: boolean): number {
  if (!isActive) return 2.2;
  switch (style) {
    case "strum":
      return clamp(beatSec, 0.5, 1.6);
    case "drum":
      return clamp(beatSec * 0.8, 0.4, 1.4);
    case "sing":
      return clamp(beatSec * 1.6, 0.7, 2.0);
    default:
      return 1.0;
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
