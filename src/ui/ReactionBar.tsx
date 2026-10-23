"use client";

import type { Game } from "../game/Game";
import { EMOTES } from "../game/rules";
import type { RoomState } from "../game/types";

const EMOTE_NAMES: Record<string, string> = {
  "😂": "Laugh",
  "🔥": "Fire",
  "👏": "Clap",
  "😱": "Shock",
  "🤦": "Facepalm",
  "❤️": "Love",
};

export default function ReactionBar({
  game,
  room,
}: {
  game: Game;
  room: RoomState;
}) {
  const performance =
    room.phase === "PLAYBACK" ? room.submissions[room.playbackIndex] : undefined;
  const canThrowTomato =
    performance !== undefined && performance.playerId !== game.playerId;

  return (
    <div className="reaction-bar" role="group" aria-label="Stage reactions">
      {EMOTES.map((emote) => (
        <button
          key={emote}
          className="reaction-button"
          onClick={() => void game.command({ type: "emote", emote })}
          aria-label={`Send ${EMOTE_NAMES[emote]} emote`}
          title={EMOTE_NAMES[emote]}
        >
          {emote}
        </button>
      ))}
      <button
        className="reaction-button wide"
        onClick={() => void game.command({ type: "dance" })}
      >
        💃 Dance
      </button>
      {canThrowTomato && (
        <button
          className="reaction-button wide tomato"
          onClick={() => void game.command({ type: "tomato" })}
        >
          🍅 Tomato
        </button>
      )}
    </div>
  );
}
