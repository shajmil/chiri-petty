import type {
  AudioScore,
  Player,
  Prompt,
  RoomState,
  StageEventKind,
  Submission,
} from "./types";
import { CHARACTER_LOOKS } from "./prompts";

export const UPLOAD_GRACE_MS = 12000;
export const ROUND_CHOICES = [2, 3, 5, 7, 10];
export const DEFAULT_ROUNDS = 7;
// A solo try is short, like a quick warm-up.
export const SOLO_ROUNDS = 3;
export const CUSTOM_CLIP_LIMIT = 12;
export const CUSTOM_CLIP_MIN_SECONDS = 0.5;
export const CUSTOM_CLIP_MAX_SECONDS = 6;
export const WALK_TO_MIC_MS = 2000;
export const SCORE_REVEAL_MS = 3500;
export const EMOTES = ["😂", "🔥", "👏", "😱", "🤦", "❤️"];
export const LAUGH_EMOTE = "😂";
export const STAGE_EVENT_GAP_MS = 600;
export const STAGE_EVENT_LIMIT = 30;
// A take may run a little past the reference so players are not cut off mid-sound.
export const RECORDING_SLACK_SECONDS = 0.5;
// After 3-2-1 the recorder starts, and the lyrics follow a second later, so nobody's first sound is cut off.
export const RECORDING_LEAD_IN_SECONDS = 1;

export function unavailableScore(reason: string): AudioScore {
  return {
    overall: null,
    reliability: "unavailable",
    reason,
    features: { rhythm: 0, energy: 0, melody: null, texture: 0 },
    method: "local-acoustic-v2",
  };
}

/** Everyone in a room looks different: a character that is already taken moves on to the next free one. */
export function uniqueAvatar(room: RoomState, wanted: number): number {
  const count = CHARACTER_LOOKS.length;
  const taken = new Set(room.players.map((player) => player.avatar));
  const start = Math.abs(Math.floor(wanted)) % count;
  for (let step = 0; step < count; step++) {
    const candidate = (start + step) % count;
    if (!taken.has(candidate)) return candidate;
  }
  return start;
}

export function createPlayer(
  id: string,
  name: string,
  avatar: number,
  now: number,
): Player {
  return {
    id,
    name: name.trim().slice(0, 24) || "Guest",
    avatar: Math.max(0, Math.min(5, Math.floor(avatar))),
    ready: false,
    connected: true,
    joinedAt: now,
    total: 0,
    laughs: 0,
    tomatoes: 0,
  };
}

export function createRoom(code: string, host: Player): RoomState {
  return {
    protocol: 1,
    code,
    hostId: host.id,
    revision: 0,
    matchId: "",
    phase: "LOBBY",
    deadline: 0,
    recordAt: 0,
    recordSeconds: 0,
    startedAt: 0,
    players: [host],
    settings: {
      category: "mixed",
      rounds: 7,
      maxPlayers: 8,
    },
    deck: [],
    customClips: [],
    round: 0,
    roundId: "",
    submissions: [],
    playbackIndex: 0,
    playbackStartAt: 0,
    stageEvents: [],
    results: [],
    reactions: [],
    notice: "",
  };
}

export function canStart(room: RoomState): boolean {
  const players = room.players.filter((player) => player.connected);
  const hasClips =
    room.settings.category !== "custom" || room.customClips.length > 0;
  // A party needs two players; a solo room has space for one, who can start alone.
  const playersNeeded = Math.min(2, room.settings.maxPlayers);
  return (
    room.phase === "LOBBY" &&
    hasClips &&
    players.length >= playersNeeded &&
    players.every((player) => player.ready)
  );
}

export function isSoloRoom(room: RoomState): boolean {
  return room.settings.maxPlayers === 1;
}

export function createCustomClip(
  room: RoomState,
  sender: string,
  title: string,
  path: string,
  duration: number,
): Prompt | null {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  const expectedPath = new RegExp(
    `^${room.code}/custom/${sender}-[a-f0-9]{8}\\.wav$`,
  );
  if (
    sender !== room.hostId ||
    room.phase !== "LOBBY" ||
    room.customClips.length >= CUSTOM_CLIP_LIMIT ||
    cleanTitle.length < 1 ||
    cleanTitle.length > 40 ||
    typeof path !== "string" ||
    !expectedPath.test(path) ||
    room.customClips.some((clip) => clip.id === path) ||
    !Number.isFinite(duration) ||
    duration < CUSTOM_CLIP_MIN_SECONDS ||
    duration > CUSTOM_CLIP_MAX_SECONDS
  )
    return null;
  return {
    id: path,
    category: "custom",
    title: cleanTitle,
    cue: cleanTitle,
    difficulty: null,
    instruction: "Listen to the host’s clip and imitate its delivery.",
    reference: path,
    duration,
    license: "Added by the host for this private room only.",
    referenceKind: "custom",
  };
}

export function acceptSubmission(
  room: RoomState,
  sender: string,
  submission: Submission,
  now: number,
): boolean {
  if (
    !submission ||
    !submission.score ||
    typeof submission.score.reason !== "string"
  )
    return false;
  const submissionDeadline =
    room.phase === "RECORDING"
      ? room.deadline + UPLOAD_GRACE_MS
      : room.deadline;
  if (
    !["RECORDING", "SUBMISSION_LOCK"].includes(room.phase) ||
    now > submissionDeadline ||
    now < room.recordAt
  )
    return false;
  if (submission.playerId !== sender || submission.roundId !== room.roundId)
    return false;
  if (
    !room.players.some((player) => player.id === sender) ||
    room.submissions.some((entry) => entry.playerId === sender)
  )
    return false;
  if (
    !Number.isFinite(submission.duration) ||
    submission.duration < 0 ||
    submission.duration > room.recordSeconds + 1 ||
    !Number.isFinite(submission.startOffset) ||
    submission.startOffset < 0 ||
    submission.startOffset > room.recordSeconds
  )
    return false;
  if (
    submission.score.overall !== null &&
    (!Number.isFinite(submission.score.overall) ||
      submission.score.overall < 0 ||
      submission.score.overall > 100)
  )
    return false;
  return true;
}

export function awardRound(room: RoomState): void {
  if (room.results.some((result) => result.round === room.round)) return;
  const points: Record<string, number> = {};
  for (const player of room.players) {
    const submission = room.submissions.find(
      (entry) => entry.playerId === player.id,
    );
    points[player.id] = Math.round(submission?.score.overall ?? 0);
    player.total += points[player.id];
  }
  room.results.push({
    round: room.round,
    promptId: room.deck[room.round - 1],
    points,
  });
}

/**
 * How loud live voice chat plays: quieter under the reference and each performance,
 * and silent while everyone records so voices never end up in someone's take.
 */
export function voiceChatVolume(phase: RoomState["phase"], isTakePlaying: boolean): number {
  if (phase === "RECORDING") return 0;
  if (phase === "LISTENING" || isTakePlaying) return 0.25;
  return 1;
}

/** How long players have to sing, from the moment the lyrics start. */
export function singingWindowSeconds(referenceSeconds: number): number {
  return Math.round((referenceSeconds + RECORDING_SLACK_SECONDS) * 10) / 10;
}

/** How long the recorder runs: the short lead-in, then the singing window. */
export function recordingWindowSeconds(referenceSeconds: number): number {
  return singingWindowSeconds(referenceSeconds) + RECORDING_LEAD_IN_SECONDS;
}

export function addStageEvent(
  room: RoomState,
  playerId: string,
  kind: StageEventKind,
  emote: string,
  eventId: string,
  now: number,
  pickRandom = (limit: number) => Math.floor(Math.random() * limit),
): boolean {
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player || !player.connected) return false;
  const lastEvent = room.stageEvents
    .filter((event) => event.playerId === playerId)
    .at(-1);
  if (lastEvent && now - lastEvent.at < STAGE_EVENT_GAP_MS) return false;
  if (kind === "emote" && !EMOTES.includes(emote)) return false;
  const performance =
    room.phase === "PLAYBACK" ? room.submissions[room.playbackIndex] : undefined;
  const isWatchingSomeoneElse =
    performance !== undefined && performance.playerId !== playerId;
  // Tomatoes fly at the current performer, or at a random other player when nobody else is on stage.
  let tomatoTarget = "";
  if (kind === "tomato") {
    const others = room.players.filter(
      (entry) => entry.connected && entry.id !== playerId,
    );
    if (performance && isWatchingSomeoneElse) tomatoTarget = performance.playerId;
    else if (others.length) tomatoTarget = others[pickRandom(others.length)].id;
    else return false;
  }
  // About three tomatoes in ten are dodged. A dodged tomato misses, so it never counts.
  const dodged = kind === "tomato" && pickRandom(10) >= 7;
  // Only a watcher's first laugh and first tomato per performance count toward awards.
  const countsTowardAwards =
    (kind === "tomato" && !dodged) || (kind === "emote" && emote === LAUGH_EMOTE);
  if (performance && isWatchingSomeoneElse && countsTowardAwards) {
    const reactionKey = `${kind}:${emote}:${playerId}`;
    if (!room.reactions.includes(reactionKey)) {
      room.reactions.push(reactionKey);
      const performer = room.players.find(
        (entry) => entry.id === performance.playerId,
      );
      if (kind === "tomato") {
        performance.tomatoes++;
        if (performer) performer.tomatoes++;
      } else {
        performance.reactionCount++;
        if (performer) performer.laughs++;
      }
    }
  }
  room.stageEvents.push({
    id: eventId,
    playerId,
    kind,
    emote: kind === "emote" ? emote : "",
    targetId: tomatoTarget,
    dodged,
    at: now,
  });
  if (room.stageEvents.length > STAGE_EVENT_LIMIT) room.stageEvents.shift();
  return true;
}
