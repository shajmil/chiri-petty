"use client";

import type { Player } from "../game/types";
import { MicIcon, MicOffIcon } from "./StageView";

/** Your mic switch and a volume for each player's live voice. It changes only what you hear. */
export default function VoiceMixer({
  players,
  myId,
  volumes,
  isMicOn,
  isSpeaking,
  isLinked,
  onToggleMic,
  onVolumeChange,
}: {
  players: Player[];
  myId: string;
  volumes: Record<string, number>;
  isMicOn: boolean;
  isSpeaking: (playerId: string) => boolean;
  isLinked: (playerId: string) => boolean;
  onToggleMic: () => void;
  onVolumeChange: (playerId: string, volume: number) => void;
}) {
  const others = players.filter((player) => player.connected && player.id !== myId);

  return (
    <div className="voice-mixer">
      <button
        className={isMicOn ? "primary" : "secondary"}
        aria-pressed={isMicOn}
        onClick={onToggleMic}
      >
        {isMicOn ? <MicIcon /> : <MicOffIcon />}
        {isMicOn ? "Your mic is on" : "Your mic is muted"}
      </button>
      {others.length === 0 ? (
        <p className="voice-note">Nobody else is here yet.</p>
      ) : (
        <ul>
          {others.map((player) => {
            const volume = volumes[player.id] ?? 1;
            return (
              <li key={player.id} className={isSpeaking(player.id) ? "speaking" : ""}>
                <div>
                  <strong>{player.name}</strong>
                  <small>
                    {!isLinked(player.id)
                      ? "Connecting…"
                      : volume === 0
                        ? "Muted for you"
                        : `${Math.round(volume * 100)}%`}
                  </small>
                </div>
                <button
                  className="voice-mute"
                  aria-label={volume === 0 ? `Unmute ${player.name}` : `Mute ${player.name}`}
                  onClick={() => onVolumeChange(player.id, volume === 0 ? 1 : 0)}
                >
                  {volume === 0 ? "🔇" : "🔊"}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  aria-label={`${player.name}’s voice volume`}
                  onChange={(event) => onVolumeChange(player.id, Number(event.target.value))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <p className="voice-note">
        Voices get quieter during each performance and pause while everyone records. These
        settings only change what you hear, never anyone’s performance.
      </p>
    </div>
  );
}

export function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}
