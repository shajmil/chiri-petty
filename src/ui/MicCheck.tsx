"use client";

import { useState } from "react";
import type { AudioManager } from "../core/AudioManager";
import { PROMPTS } from "../game/prompts";
import { recordingWindowSeconds } from "../game/rules";
import type { AudioScore } from "../game/types";
import LyricsTrack from "./LyricsTrack";
import { MicIcon } from "./StageView";

type Step = "intro" | "listening" | "count-in" | "recording" | "result";

const SAMPLE =
  PROMPTS.find((prompt) => prompt.id === "i-like-turtles") ??
  PROMPTS.find((prompt) => prompt.difficulty === "easy") ??
  PROMPTS[0];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** A short practice round everyone must pass before readying up, so silent mics are caught early. */
export default function MicCheck({
  audio,
  micLevel,
  enableMic,
  deviceId,
  onDeviceChange,
  onPassed,
  onClose,
}: {
  audio: AudioManager;
  micLevel: number;
  enableMic: () => Promise<boolean>;
  deviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onPassed: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [count, setCount] = useState(3);
  const [startedAt, setStartedAt] = useState(0);
  const [score, setScore] = useState<AudioScore | null>(null);
  const [failure, setFailure] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [take, setTake] = useState<Blob | null>(null);
  const recordSeconds = recordingWindowSeconds(SAMPLE.duration);
  const passed = score !== null && score.overall !== null;

  async function runTest() {
    setScore(null);
    setTake(null);
    setFailure("");
    if (!(await enableMic())) return;
    setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput"));
    try {
      setStep("listening");
      await audio.playReference(SAMPLE);
      setStartedAt(performance.now());
      await wait(SAMPLE.duration * 1000 + 500);
      setStep("count-in");
      for (const number of [3, 2, 1]) {
        setCount(number);
        audio.beep(number === 1 ? 880 : 660);
        await wait(1000);
      }
      setStep("recording");
      setStartedAt(performance.now());
      const attempt = await audio.record(recordSeconds, SAMPLE);
      setScore(attempt.score);
      setTake(attempt.blob);
      setStep("result");
      if (attempt.score.overall !== null) onPassed();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Recording failed.");
      setStep("result");
    }
  }

  const elapsedSeconds =
    step === "listening" || step === "recording"
      ? (performance.now() - startedAt) / 1000
      : null;

  return (
    <div className="mic-check">
      <button className="secondary" disabled={step !== "intro" && step !== "result"} onClick={async () => {
        if (await enableMic()) setDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput"));
      }}>Choose microphone</button>
      <label>Microphone
        <select value={deviceId} disabled={step !== "intro" && step !== "result"} onChange={event => {
          onDeviceChange(event.target.value);
          void audio.enableMicrophone(event.target.value).catch(error => setFailure(error.message));
        }}>
          <option value="">System default</option>
          {devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || "Microphone"}</option>)}
        </select>
      </label>
      <p>
        Everyone does one quick test before readying up. Listen to the sample,
        wait for 3-2-1, then copy it into your microphone.
      </p>
      <div className="mic-check-stage">
        <span className="mic-check-step">
          {step === "intro" && "Ready when you are"}
          {step === "listening" && "Listen…"}
          {step === "count-in" && "Get ready"}
          {step === "recording" && (
            <span className="rec-pill">
              <MicIcon /> REC · {recordSeconds}s
            </span>
          )}
          {step === "result" && (passed ? "Mic check passed" : "We couldn’t hear you")}
        </span>
        {step === "count-in" && (
          <strong key={count} className="count-in">
            {count}
          </strong>
        )}
        <LyricsTrack
          cue={SAMPLE.cue}
          shape={audio.referenceShape}
          durationSeconds={SAMPLE.duration}
          elapsedSeconds={elapsedSeconds}
        />
        <div className="audio-meter" aria-label="Microphone activity">
          <span style={{ width: `${Math.max(2, micLevel * 100)}%` }} />
        </div>
      </div>
      {step === "result" && (
        <p className="muted">Listen back. If it sounds muffled or quiet, choose another microphone, move closer, and record again.</p>
      )}
      {step === "result" && (
        <p role="status" className={passed ? "mic-check-pass" : "mic-check-fail"}>
          {passed
            ? `✓ ${score?.overall}/100 — your mic works. You’re ready!`
            : failure || score?.reason || "No sound was recorded."}
        </p>
      )}
      <div className="lobby-buttons">
        {take && <button className="secondary" onClick={() => void audio.playBlob(take).catch(error => setFailure(error.message))}>Hear my recording</button>}
        {passed && <button className="secondary" onClick={() => void runTest()}>Record again</button>}
        {passed ? (
          <button className="primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <button
            className="primary"
            disabled={step !== "intro" && step !== "result"}
            onClick={() => void runTest()}
          >
            {step === "result" ? "Try again" : "Start the mic test"}
          </button>
        )}
      </div>
    </div>
  );
}
