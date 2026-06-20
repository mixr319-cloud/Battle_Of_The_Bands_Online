import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Genre } from "./LobbyScreen";

import rockGuitarist from "../../imports/bands/rock/guitarist.png";
import rockDrummer from "../../imports/bands/rock/drummer.png";
import rockSinger from "../../imports/bands/rock/singer.png";
import rockBassist from "../../imports/bands/rock/bassist.png";

interface BandMember {
  id: string;
  src: string;
  /** Native pixel size of the source art, used to keep true relative scale between members. */
  w: number;
  h: number;
}

// One roster per genre. Add new genres here as their art is produced —
// anything missing falls back to the Rock set in getBandSet().
const BAND_SETS: Partial<Record<Genre, BandMember[]>> = {
  Rock: [
    { id: "guitarist", src: rockGuitarist, w: 302, h: 604 },
    { id: "drummer", src: rockDrummer, w: 474, h: 456 },
    { id: "singer", src: rockSinger, w: 304, h: 564 },
    { id: "bassist", src: rockBassist, w: 312, h: 551 },
  ],
};

function getBandSet(genre: Genre): BandMember[] {
  return BAND_SETS[genre] ?? BAND_SETS.Rock!;
}

interface Props {
  genre: Genre;
  /** True whenever at least one player is actively recording. */
  isRecording: boolean;
  /** Changes whenever the set of currently-recording players changes (re-rolls the random performer). */
  recordingSignature: string;
}

const TARGET_HEIGHT = 96; // px, height of the tallest (standing) member

export function BandStrip({ genre, isRecording, recordingSignature }: Props) {
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

  return (
    <div
      className="mt-3 flex items-end justify-center gap-3 sm:gap-6 pointer-events-none select-none"
      style={{ height: TARGET_HEIGHT }}
      aria-hidden="true"
    >
      {members.map((m, i) => {
        const isActive = i === activeIdx;
        const dimmed = isRecording && !isActive;
        return (
          <motion.img
            key={m.id}
            src={m.src}
            alt=""
            draggable={false}
            style={{
              width: Math.round(m.w * scale),
              height: Math.round(m.h * scale),
              opacity: dimmed ? 0.45 : 1,
              filter: isActive
                ? "drop-shadow(0 0 10px rgba(168,85,247,0.65)) drop-shadow(0 0 22px rgba(168,85,247,0.35))"
                : "none",
              transition: "opacity 0.3s ease, filter 0.3s ease",
            }}
            animate={
              isActive
                ? { y: [0, -7, 0], rotate: [0, -3, 3, 0] }
                : { y: 0, rotate: 0 }
            }
            transition={
              isActive
                ? { duration: 0.55, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0.25 }
            }
          />
        );
      })}
    </div>
  );
}
