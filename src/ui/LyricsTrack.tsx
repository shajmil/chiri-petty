"use client";

import type { CSSProperties } from "react";
import { timeLyrics } from "../game/lyrics";

/** Karaoke-style cue: each piece fills in as the clip (or your take) reaches it. */
export default function LyricsTrack({
  cue,
  shape,
  durationSeconds,
  elapsedSeconds,
}: {
  cue: string;
  shape: number[];
  durationSeconds: number;
  elapsedSeconds: number | null;
}) {
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
