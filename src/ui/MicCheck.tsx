"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { AudioManager } from "../core/AudioManager";
import { BRAND } from "../game/prompts";
import { MicIcon } from "./StageView";

type Status = "starting" | "listening" | "passed" | "failed";

// About half a second of clear voice proves the mic works; give up after eight seconds of silence.
const VOICE_LEVEL = 0.12;
const VOICE_NEEDED_MS = 500;
const GIVE_UP_MS = 8000;
const CHECK_EVERY_MS = 100;

/** An optional test before readying up: say something, so a silent or wrong microphone is caught in the lobby. */
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
  const [status, setStatus] = useState<Status>("starting");
  const [attempt, setAttempt] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setStatus("starting");
    void (async () => {
      if (!(await enableMic()) || cancelled) {
        if (!cancelled) setStatus("failed");
        return;
      }
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === "audioinput",
      );
      if (cancelled) return;
      setDevices(inputs);
      setStatus("listening");
      let heardMs = 0;
      let waitedMs = 0;
      timer = window.setInterval(() => {
        waitedMs += CHECK_EVERY_MS;
        if (audio.readLevel() > VOICE_LEVEL) heardMs += CHECK_EVERY_MS;
        if (heardMs >= VOICE_NEEDED_MS) {
          clearInterval(timer);
          setStatus("passed");
          onPassed();
        } else if (waitedMs >= GIVE_UP_MS) {
          clearInterval(timer);
          setStatus("failed");
        }
      }, CHECK_EVERY_MS);
    })();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Restart only when the player retries or picks another microphone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, deviceId]);

  return (
    <div className="mic-check">
      <div
        className={`mic-orb ${status}`}
        style={{ "--level": Math.min(1, micLevel * 1.6) } as CSSProperties}
        aria-hidden="true"
      >
        <MicIcon />
      </div>
      <p className="mic-check-title" role="status">
        {status === "starting" && "Turning on your microphone…"}
        {status === "listening" && `Say hi — “Hello ${BRAND.name}!”`}
        {status === "passed" && "✓ We hear you. You’re ready!"}
        {status === "failed" && "We can’t hear you. Check your mic or pick another one."}
      </p>
      <div className="audio-meter" aria-label="Microphone level">
        <span style={{ width: `${Math.max(2, micLevel * 100)}%` }} />
      </div>
      {devices.length > 1 && status !== "passed" && (
        <label className="mic-select">
          Microphone
          <select
            value={deviceId}
            onChange={(event) => onDeviceChange(event.target.value)}
          >
            <option value="">System default</option>
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="lobby-buttons">
        {status === "passed" && (
          <button className="primary" onClick={onClose}>
            Done
          </button>
        )}
        {status === "failed" && (
          <button className="primary" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
