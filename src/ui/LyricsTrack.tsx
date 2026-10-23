"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { timeLyrics } from "../game/lyrics";

/**
 * Karaoke-style cue: each piece fills in as the clip (or your take) reaches it.
 * It redraws every animation frame from `startAt`, so the fill moves smoothly
 * instead of jumping whenever the rest of the page happens to update.
 */
export default function LyricsTrack({
  cue,
  shape,
  durationSeconds,
  startAt,
  clock,
}: {
  cue: string;
  shape: number[];
  durationSeconds: number;
  /** Clock time (in `clock()` units, milliseconds) when the clip or take starts; null before it starts. */
  startAt: number | null;
  clock: () => number;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  const latestClock = useRef(clock);
  latestClock.current = clock;

  useEffect(() => {
    if (startAt === null) {
      setElapsedSeconds(null);
      return;
    }
    let frame = 0;
    const update = () => {
      setElapsedSeconds((latestClock.current() - startAt) / 1000);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [startAt]);

  const parts = timeLyrics(cue, shape, durationSeconds);
  const isMalayalam = /[ഀ-ൿ]/.test(cue);
  return (
    <p className="lyrics" lang={isMalayalam ? "ml" : "en"} aria-label={cue}>
      {parts.map((part, index) => {
        const fill =
          elapsedSeconds === null
            ? 0
            : Math.min(
                1,
                Math.max(
                  0,
                  (elapsedSeconds - part.startSeconds) /
                    Math.max(0.01, part.endSeconds - part.startSeconds),
                ),
              );
        const isCurrent = fill > 0 && fill < 1;
        return (
          <span
            key={index}
            aria-hidden="true"
            className={isCurrent ? "lyric-part current" : "lyric-part"}
            style={{ "--fill": `${fill * 100}%` } as CSSProperties}
          >
            {part.text}
          </span>
        );
      })}
    </p>
  );
}
