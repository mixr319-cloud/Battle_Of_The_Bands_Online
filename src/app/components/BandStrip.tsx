import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

// Animated sprite (76-frame looping webp) — only ever shown for the one
// randomly-selected "active" performer, since the animation is baked into
// the file itself and can't be paused.
import rockGuitaristAnim from "../../imports/bands/rock/anim_webp/guitarist.webp";
import rockDrummerAnim from "../../imports/bands/rock/anim_webp/drummer.webp";
import rockSingerAnim from "../../imports/bands/rock/anim_webp/singer.webp";
import rockBassistAnim from "../../imports/bands/rock/anim_webp/bassist.webp";

// Static still-frame art — used for every member that is NOT the active
// performer, so they read as genuinely frozen instead of double-animating.
import rockGuitaristStill from "../../imports/bands/rock/guitarist.png";
import rockDrummerStill from "../../imports/bands/rock/drummer.png";
import rockSingerStill from "../../imports/bands/rock/singer.png";
import rockBassistStill from "../../imports/bands/rock/bassist.png";

type PerformStyle = "strum" | "drum" | "sing";

interface BandMember {
  id: string;
  /** Looping animated sprite, shown only while this member is the active performer. */
  animSrc: string;
  /** Still pose, shown while this member is frozen/idle. */
  stillSrc: string;
  /** Native pixel size of the animated sprite, used to keep true relative scale between members. */
  w: number;
  h: number;
  /** Native pixel size of the still art (different crop/padding than the sprite). */
  stillW: number;
  stillH: number;
  style: PerformStyle;
  /** Where the rotation/lean pivots from, e.g. feet for a standing player, hips for a seated drummer. */
  origin: string;
}

// One roster per genre. Add new genres here as their art is produced —
// anything missing falls back to the Rock set in getBandSet().
const BAND_SETS: Partial<Record<Genre, BandMember[]>> = {
  Rock: [
    { id: "guitarist", animSrc: rockGuitaristAnim, stillSrc: rockGuitaristStill, w: 263, h: 504, stillW: 302, stillH: 604, style: "strum", origin: "50% 100%" },
    { id: "drummer", animSrc: rockDrummerAnim, stillSrc: rockDrummerStill, w: 384, h: 383, stillW: 474, stillH: 456, style: "drum", origin: "50% 75%" },
    { id: "singer", animSrc: rockSingerAnim, stillSrc: rockSingerStill, w: 246, h: 469, stillW: 304, stillH: 564, style: "sing", origin: "50% 100%" },
    { id: "bassist", animSrc: rockBassistAnim, stillSrc: rockBassistStill, w: 253, h: 458, stillW: 312, stillH: 551, style: "strum", origin: "50% 100%" },
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

const TARGET_HEIGHT = 336; // px, height of the tallest (standing) member — doubled from the original 168

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

  // Scale the *still* art (the height it occupies almost all the time) to TARGET_HEIGHT,
  // then scale the anim sprite to match that same on-screen height per member.
  const maxStillH = Math.max(...members.map(m => m.stillH));
  const stillScale = TARGET_HEIGHT / maxStillH;
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

        // Frozen members: plain still art, completely static — no motion props at all.
        if (!isActive) {
          return (
            <img
              key={m.id}
              src={m.stillSrc}
              alt=""
              draggable={false}
              style={{
                width: Math.round(m.stillW * stillScale),
                height: Math.round(m.stillH * stillScale),
                opacity: dimmed ? 0.4 : 1,
                filter: "none",
              }}
            />
          );
        }

        // Active performer: the animated sprite already plays its own loop,
        // so we only add a soft glow + gentle scale pulse on top — no extra
        // rotate/shake, which used to double up with the baked-in animation
        // and look like jittery duplicate frames.
        const perf = getPerformAnimation(m.style, beatSec);
        return (
          <motion.img
            key={m.id}
            src={m.animSrc}
            alt=""
            draggable={false}
            style={{
              width: Math.round(m.w * stillScale),
              height: Math.round(m.h * stillScale),
              transformOrigin: m.origin,
              opacity: 1,
              filter: "drop-shadow(0 0 10px rgba(168,85,247,0.7)) drop-shadow(0 0 26px rgba(168,85,247,0.4))",
            }}
            animate={perf.animate}
            transition={perf.transition}
          />
        );
      })}
    </div>
  );
}

function getPerformAnimation(style: PerformStyle, beatSec: number) {
  switch (style) {
    case "strum":
      // Subtle sway in time with the beat — the strumming itself is already
      // baked into the sprite, so this just adds a light highlight bounce.
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
      // Slow, soft sway — barely-there movement layered on the sprite's own animation.
      return {
        animate: { scale: [1, 1.03, 1], y: [0, -3, 0] },
        transition: { duration: beatSec * 2, repeat: Infinity, ease: "easeInOut" },
      };
  }
}

