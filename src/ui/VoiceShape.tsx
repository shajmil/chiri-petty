"use client";
import { useEffect, useRef, useState } from "react";
import type { AudioManager } from "../core/AudioManager";

const BARS = 80;

export default function VoiceShape({
  audio,
  progress,
  isRecording,
}: {
  audio: AudioManager;
  progress: number | null;
  isRecording: boolean;
}) {
  const [reference, setReference] = useState<number[]>([]);
  const [take, setTake] = useState<number[]>([]);
  const latest = useRef({ progress, isRecording });
  const wasRecording = useRef(false);
  latest.current = { progress, isRecording };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReference([...audio.referenceShape]);
      const current = latest.current;
      if (current.isRecording && current.progress !== null) {
        // Draw the live take under the reference at the same point in time.
        const startsNewTake = !wasRecording.current;
        wasRecording.current = true;
        const bar = Math.min(BARS - 1, Math.floor(current.progress * BARS));
        const level = audio.readLevel();
        setTake((previous) => {
          const next = startsNewTake ? new Array(BARS).fill(0) : [...previous];
          next[bar] = Math.max(next[bar] ?? 0, level);
          return next;
        });
      } else {
        wasRecording.current = false;
        setTake([...audio.takeShape]);
      }
    }, 50);
    return () => clearInterval(timer);
  }, [audio]);

  const playheadLeft =
    progress === null ? null : `${Math.min(100, Math.max(0, progress * 100))}%`;

  return (
    <section
      className="voice-shape"
      aria-label="Reference and your recording waveforms"
    >
      <strong>
        VOICE SHAPE{" "}
        <span>
          {isRecording
            ? "MIC LIVE · FOLLOW THE LINE"
            : progress !== null
              ? "LISTEN TO THE SHAPE"
              : "LISTEN · MIMIC · REPLAY"}
        </span>
      </strong>
      {(
        [
          ["Reference", reference],
          ["Your take", take],
        ] as const
      ).map(([label, samples]) => (
        <div className="wave-lane" key={label}>
          <span>{label}</span>
          <div aria-label={`${label} waveform`} role="img">
            {Array.from({ length: BARS }, (_, index) => (
              <i
                key={index}
                style={{
                  height: `${Math.max(2, (samples[index] ?? 0) * 36)}px`,
                }}
              />
            ))}
            {playheadLeft && (
              <b className="playhead" style={{ left: playheadLeft }} />
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
