"use client";

import { useState } from "react";
import type { AudioManager } from "../core/AudioManager";
import type { Game } from "../game/Game";
import {
  CUSTOM_CLIP_LIMIT,
  CUSTOM_CLIP_MAX_SECONDS,
  CUSTOM_CLIP_MIN_SECONDS,
} from "../game/rules";
import { BRAND } from "../game/prompts";
import type { RoomState } from "../game/types";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export default function CustomClips({
  game,
  room,
  audio,
  onError,
}: {
  game: Game;
  room: RoomState;
  audio: AudioManager;
  onError: (message: string) => void;
}) {
  const [sourceAudio, setSourceAudio] = useState<AudioBuffer | null>(null);
  const [title, setTitle] = useState("");
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [hasRights, setHasRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  const clipLength = Math.round((endSeconds - startSeconds) * 100) / 100;
  const trimProblem = !sourceAudio
    ? "Choose an audio file."
    : endSeconds > sourceAudio.duration + 0.01
      ? "The end is past the end of the file."
      : clipLength < CUSTOM_CLIP_MIN_SECONDS
        ? `Make the clip at least ${CUSTOM_CLIP_MIN_SECONDS} seconds.`
        : clipLength > CUSTOM_CLIP_MAX_SECONDS
          ? `Keep the clip to ${CUSTOM_CLIP_MAX_SECONDS} seconds or less.`
          : "";
  const roomIsFull = room.customClips.length >= CUSTOM_CLIP_LIMIT;

  async function chooseFile(file: File | undefined) {
    setSourceAudio(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onError("That file is over 15 MB. Pick a shorter clip.");
      return;
    }
    setBusy(true);
    try {
      const decoded = await audio.decodeFile(file);
      setSourceAudio(decoded);
      setStartSeconds(0);
      setEndSeconds(
        Math.min(CUSTOM_CLIP_MAX_SECONDS, Math.floor(decoded.duration * 10) / 10),
      );
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 40));
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Could not read file.");
    } finally {
      setBusy(false);
    }
  }

  async function previewClip() {
    if (!sourceAudio || trimProblem) return;
    try {
      const wav = await audio.trimToWav(sourceAudio, startSeconds, endSeconds);
      await audio.playBlob(wav);
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Preview failed.");
    }
  }

  async function addClip() {
    if (!sourceAudio || trimProblem || !title.trim() || !hasRights) return;
    setBusy(true);
    try {
      const wav = await audio.trimToWav(sourceAudio, startSeconds, endSeconds);
      await game.addCustomClip(title.trim(), wav, clipLength);
      setSourceAudio(null);
      setTitle("");
      setHasRights(false);
      setFileInputKey((key) => key + 1);
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="custom-clips" aria-labelledby="custom-clips-title">
      <div className="section-heading">
        <h2 id="custom-clips-title">Your clips</h2>
        <span className="muted">
          {room.customClips.length}/{CUSTOM_CLIP_LIMIT}
        </span>
      </div>
      {room.customClips.length === 0 && (
        <p className="muted">
          {game.isHost
            ? "Add at least one clip to play this pack."
            : "Waiting for the host to add clips."}
        </p>
      )}
      {room.customClips.map((clip) => (
        <div className="sound-row" key={clip.id}>
          <div>
            <strong>{clip.title}</strong>
            <small>{clip.duration.toFixed(1)}s · private to this room</small>
          </div>
          <div className="custom-clip-actions">
            <button
              className="secondary compact"
              onClick={() =>
                void audio
                  .playReference(clip)
                  .catch((failure) => onError(failure.message))
              }
              aria-label={`Listen to ${clip.title}`}
            >
              Listen ▷
            </button>
            {game.isHost && (
              <button
                className="secondary compact"
                onClick={() =>
                  void game.command({ type: "removeClip", clipId: clip.id })
                }
                aria-label={`Remove ${clip.title}`}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
      {game.isHost && !roomIsFull && (
        <div className="custom-clip-form">
          <label>
            Audio file
            <input
              key={fileInputKey}
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
          </label>
          {sourceAudio && (
            <>
              <label>
                What should players say?
                <input
                  maxLength={40}
                  value={title}
                  placeholder="Ayyo! / Shivane!"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="match-options">
                <label>
                  Start at (seconds)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={startSeconds}
                    onChange={(event) => setStartSeconds(Number(event.target.value))}
                  />
                </label>
                <label>
                  End at (seconds)
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    max={sourceAudio.duration}
                    value={endSeconds}
                    onChange={(event) => setEndSeconds(Number(event.target.value))}
                  />
                </label>
              </div>
              <p className="muted">
                File length {sourceAudio.duration.toFixed(1)}s · clip{" "}
                {clipLength.toFixed(1)}s (max {CUSTOM_CLIP_MAX_SECONDS}s)
              </p>
              {trimProblem && <p className="muted">{trimProblem}</p>}
              <label className="rights-row">
                <input
                  type="checkbox"
                  checked={hasRights}
                  onChange={(event) => setHasRights(event.target.checked)}
                />
                <span>
                  I have the right to use this clip, and I understand it is
                  shared only with this room.
                </span>
              </label>
              <div className="lobby-buttons">
                <button
                  className="secondary"
                  disabled={busy || Boolean(trimProblem)}
                  onClick={() => void previewClip()}
                >
                  Preview ▷
                </button>
                <button
                  className="primary"
                  disabled={
                    busy || Boolean(trimProblem) || !title.trim() || !hasRights
                  }
                  onClick={() => void addClip()}
                >
                  {busy ? "Adding…" : "Add clip"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <p className="scoring-note">
        Clips are not part of {BRAND.name}. They are uploaded to this private
        room only and deleted when the room expires after 24 hours.
      </p>
    </section>
  );
}
