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
      {/* Tomato goes first so it is never scrolled out of view on a phone. */}
      {canThrowTomato && (
        <button
          className="reaction-button wide tomato"
          aria-label="Tomato"
          title="Throw a tomato"
          onClick={() => void game.command({ type: "tomato" })}
        >
          🍅<span className="reaction-label"> Tomato</span>
        </button>
      )}
      <button
        className="reaction-button wide"
        aria-label="Dance"
        title="Dance"
        onClick={() => void game.command({ type: "dance" })}
      >
        💃<span className="reaction-label"> Dance</span>
      </button>
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
    </div>
  );
}
