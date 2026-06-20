import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import slide1 from "../../imports/tutorial_slide_1.jpg";
import slide2 from "../../imports/tutorial_slide_2.jpg";
import slide3 from "../../imports/tutorial_slide_3.jpg";
import slide4 from "../../imports/tutorial_slide_4.jpg";
import slide5 from "../../imports/tutorial_slide_5.jpg";

const SLIDES = [
  { img: slide1, accent: "#a855f7" },
  { img: slide2, accent: "#22d3ee" },
  { img: slide3, accent: "#34d399" },
  { img: slide4, accent: "#fb923c" },
  { img: slide5, accent: "#f472b6" },
];

const STORAGE_KEY = "botb_tutorial_seen";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function TutorialModal({ open, onClose }: Props) {
  const [slide, setSlide] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    if (open) setSlide(0);
  }, [open]);

  function close() {
    localStorage.setItem(STORAGE_KEY, "1");
    onClose();
  }

  function goTo(next: number, direction: number) {
    setDir(direction);
    setSlide(next);
  }

  function next() {
    if (slide < SLIDES.length - 1) goTo(slide + 1, 1);
    else close();
  }

  function prev() {
    if (slide > 0) goTo(slide - 1, -1);
  }

  const s = SLIDES[slide];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="tutorial-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          style={{ background: "rgba(0,0,0,0.82)", backdropFilter: "blur(18px)" }}
          onClick={close}
        >
          {/* Card — stop click propagation so clicking inside doesn't close */}
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ scale: 0.93, opacity: 0, y: 28 }}
            animate={{ scale: 1, opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } }}
            exit={{ scale: 0.95, opacity: 0, y: 20, transition: { duration: 0.2 } }}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col"
            style={{
              background: "rgba(10, 7, 22, 0.97)",
              border: `1px solid ${s.accent}44`,
              boxShadow: `0 0 60px ${s.accent}22, 0 40px 80px rgba(0,0,0,0.85)`,
              transition: "border-color 0.35s, box-shadow 0.35s",
            }}
          >
            {/* Top accent line */}
            <div
              className="h-0.5 w-full"
              style={{ background: `linear-gradient(90deg, transparent, ${s.accent}, transparent)`, transition: "background 0.35s" }}
            />

            {/* Header bar */}
            <div className="flex items-center justify-between px-5 py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-sm tracking-wide">
                  BATTLE OF THE BANDS
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: `${s.accent}22`, color: s.accent, border: `1px solid ${s.accent}44` }}>
                  Tutorial
                </span>
              </div>

              {/* Slide counter + close */}
              <div className="flex items-center gap-3">
                <span className="text-white/30 text-xs tabular-nums">
                  {slide + 1} / {SLIDES.length}
                </span>
                <button
                  onClick={close}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/40 hover:text-white/80 transition-colors"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Slide image */}
            <div className="relative overflow-hidden bg-black" style={{ aspectRatio: "16/9" }}>
              <AnimatePresence mode="wait" custom={dir}>
                <motion.img
                  key={slide}
                  src={s.img}
                  alt={`Tutorial slide ${slide + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  custom={dir}
                  variants={{
                    enter: (d: number) => ({ opacity: 0, x: d * 60 }),
                    center: { opacity: 1, x: 0 },
                    exit: (d: number) => ({ opacity: 0, x: d * -60 }),
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.22, ease: "easeInOut" }}
                />
              </AnimatePresence>

              {/* Click zones for prev/next on the image itself */}
              {slide > 0 && (
                <button
                  onClick={prev}
                  className="absolute left-0 top-0 h-full w-1/4 flex items-center justify-start pl-3 opacity-0 hover:opacity-100 transition-opacity"
                  style={{ background: "linear-gradient(to right, rgba(0,0,0,0.35), transparent)" }}
                >
                  <span className="text-white text-2xl">‹</span>
                </button>
              )}
              {slide < SLIDES.length - 1 && (
                <button
                  onClick={next}
                  className="absolute right-0 top-0 h-full w-1/4 flex items-center justify-end pr-3 opacity-0 hover:opacity-100 transition-opacity"
                  style={{ background: "linear-gradient(to left, rgba(0,0,0,0.35), transparent)" }}
                >
                  <span className="text-white text-2xl">›</span>
                </button>
              )}
            </div>

            {/* Footer nav */}
            <div className="flex items-center gap-4 px-5 py-4"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              {/* Dot indicators */}
              <div className="flex gap-1.5 flex-1">
                {SLIDES.map((sl, i) => (
                  <button
                    key={i}
                    onClick={() => goTo(i, i > slide ? 1 : -1)}
                    className="rounded-full transition-all"
                    style={{
                      width: i === slide ? "22px" : "7px",
                      height: "7px",
                      background: i === slide ? s.accent : "rgba(255,255,255,0.18)",
                    }}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex gap-2 shrink-0">
                {slide > 0 && (
                  <button
                    onClick={prev}
                    className="px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95"
                    style={{
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    ← Back
                  </button>
                )}
                <button
                  onClick={next}
                  className="px-5 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
                  style={{
                    background: `linear-gradient(135deg, ${s.accent}, #6366f1)`,
                    boxShadow: `0 0 20px ${s.accent}44`,
                    minWidth: "110px",
                  }}
                >
                  {slide < SLIDES.length - 1 ? "Next →" : "Let's Play 🎸"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const TUTORIAL_STORAGE_KEY = STORAGE_KEY;
