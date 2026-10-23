export interface LyricPart {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/** Splits a cue like "ba-dum-TSS" or "oh no... oh no..." into the pieces that light up one by one. */
export function splitLyrics(cue: string): string[] {
  return cue
    .split(/\s+/)
    .flatMap((word) => word.split(/(?<=-)/))
    .filter((part) => part.length > 0);
}

/**
 * Spreads the lyric pieces across the loud part of the reference, longer pieces taking longer.
 * `shape` is the reference waveform as evenly spaced peak levels; we have no word-level timing,
 * so this follows where the sound actually is instead of the whole clip including silence.
 */
export function timeLyrics(
  cue: string,
  shape: number[],
  durationSeconds: number,
): LyricPart[] {
  const parts = splitLyrics(cue);
  const loudest = Math.max(0, ...shape);
  const isLoud = (level: number) => level > loudest * 0.15;
  const firstLoud = shape.findIndex(isLoud);
  const lastLoud = shape.length - 1 - [...shape].reverse().findIndex(isLoud);
  const soundStart =
    firstLoud >= 0 ? (firstLoud / shape.length) * durationSeconds : 0;
  const soundEnd =
    firstLoud >= 0
      ? ((lastLoud + 1) / shape.length) * durationSeconds
      : durationSeconds;
  const letterCounts = parts.map((part) =>
    Math.max(1, part.replace(/[^\p{L}\p{N}]/gu, "").length),
  );
  const totalLetters = letterCounts.reduce((sum, count) => sum + count, 0);
  let lettersBefore = 0;
  return parts.map((text, index) => {
    const startSeconds =
      soundStart + (lettersBefore / totalLetters) * (soundEnd - soundStart);
    lettersBefore += letterCounts[index];
    const endSeconds =
      soundStart + (lettersBefore / totalLetters) * (soundEnd - soundStart);
    return { text, startSeconds, endSeconds };
  });
}
