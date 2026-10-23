"use client";

import { useEffect, useRef, useState } from "react";
import type { CameraShot, Stage } from "../world/Stage";
import type { StageActor } from "../world/Character";
import type { AudioManager } from "../core/AudioManager";
import type { StageEvent } from "../game/types";

export interface StageScene {
  actors: StageActor[];
  performerId: string;
  talkingId: string;
  levelSource: "mic" | "playback";
  chorus: boolean;
  events: StageEvent[];
  clock: () => number;
  /** True during rounds, when text overlays the top of the stage. */
  isRound: boolean;
  /** Which character the camera frames, and how closely. */
  focusId: string;
  shot: CameraShot;
  /** The home page has its own big title, so it hides the graffiti logo on the wall. */
  showWallLogo: boolean;
}

export default function StageView({
  audio,
  scene,
  reducedMotion,
}: {
  audio: AudioManager;
  scene: StageScene;
  reducedMotion: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage | null>(null);
  const latestScene = useRef(scene);
  const latestReducedMotion = useRef(reducedMotion);
  const [failed, setFailed] = useState(false);
  latestScene.current = scene;
  latestReducedMotion.current = reducedMotion;

  useEffect(() => {
    let cancelled = false;
    import("../world/Stage")
      .then(({ Stage }) => {
        if (cancelled || !canvas.current) return;
        try {
          stage.current = new Stage(canvas.current);
          stage.current.onTomatoHit = () => audio.splat();
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      stage.current?.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!stage.current) return;
      const current = latestScene.current;
      stage.current.setRoundFraming(current.isRound);
      stage.current.showWallLogo = current.showWallLogo;
      stage.current.focusId = current.focusId;
      stage.current.shot = current.shot;
      stage.current.setCast(current.actors);
      stage.current.performerId = current.performerId;
      stage.current.talkingId = current.talkingId;
      stage.current.chorus = current.chorus;
      stage.current.reducedMotion = latestReducedMotion.current;
      stage.current.level =
        current.levelSource === "playback"
          ? audio.readPlaybackLevel()
          : audio.readLevel();
      stage.current.showEvents(current.events, current.clock());
    }, 50);
    return () => clearInterval(timer);
  }, [audio]);

  return (
    <div className="stage-view">
      <canvas
        ref={canvas}
        aria-label="Party stage: each player's character, the microphone and the audience"
        role="img"
      />
      {failed && (
        <div className="stage-fallback">
          <MicIcon />
          <p>
            The stage is taking a break.
            <br />
            Your voice game still works.
          </p>
        </div>
      )}
    </div>
  );
}

export function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="8" y="2" width="8" height="13" rx="4" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
    </svg>
  );
}
