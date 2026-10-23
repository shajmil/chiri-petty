"use client";
import { useEffect, useRef, useState } from "react";
import type { AudioManager } from "../core/AudioManager";

const BARS = 80;

export interface ShapeTimeline {
  /** Clock time (milliseconds) when the clip or take starts. */
  startAt: number;
  durationSeconds: number;
}

export default function VoiceShape({
  audio,
  timeline,
  clock,
  isRecording,
}: {
  audio: AudioManager;
  timeline: ShapeTimeline | null;
  clock: () => number;
  isRecording: boolean;
}) {
  const [reference, setReference] = useState<number[]>([]);
  const [take, setTake] = useState<number[]>([]);
  const latest = useRef({ timeline, clock, isRecording });
  const wasRecording = useRef(false);
  const playheads = useRef<(HTMLElement | null)[]>([]);
  latest.current = { timeline, clock, isRecording };

  function currentProgress(): number | null {
    const current = latest.current;
    if (!current.timeline) return null;
    return (current.clock() - current.timeline.startAt) / 1000 / current.timeline.durationSeconds;
  }

  // The playhead moves every animation frame by writing its position directly, so it glides smoothly
  // without re-rendering all the waveform bars.
  useEffect(() => {
    let frame = 0;
    const movePlayheads = () => {
      const progress = currentProgress();
      for (const playhead of playheads.current) {
        if (!playhead) continue;
        playhead.style.display = progress === null ? "none" : "block";
        playhead.style.left = `${Math.min(100, Math.max(0, (progress ?? 0) * 100))}%`;
      }
      frame = requestAnimationFrame(movePlayheads);
    };
    frame = requestAnimationFrame(movePlayheads);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setReference([...audio.referenceShape]);
      const progress = currentProgress();
      if (latest.current.isRecording && progress !== null) {
        // Draw the live take under the reference at the same point in time.
        const startsNewTake = !wasRecording.current;
        wasRecording.current = true;
        const bar = Math.min(BARS - 1, Math.max(0, Math.floor(progress * BARS)));
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
            : timeline
              ? "LISTEN TO THE SHAPE"
              : "LISTEN · MIMIC · REPLAY"}
        </span>
      </strong>
      {(
        [
          ["Reference", reference],
          ["Your take", take],
        ] as const
      ).map(([label, samples], lane) => (
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
            <b
              className="playhead"
              ref={(element) => {
                playheads.current[lane] = element;
              }}
              style={{ display: "none" }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
