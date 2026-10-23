import type {
  AudioScore,
  Player,
  Prompt,
  RoomState,
  StageEventKind,
  Submission,
} from "./types";

export const UPLOAD_GRACE_MS = 12000;
export const CUSTOM_CLIP_LIMIT = 12;
export const CUSTOM_CLIP_MIN_SECONDS = 0.5;
export const CUSTOM_CLIP_MAX_SECONDS = 6;
export const WALK_TO_MIC_MS = 1800;
export const SCORE_REVEAL_MS = 3500;
export const EMOTES = ["😂", "🔥", "👏", "😱", "🤦", "❤️"];
export const LAUGH_EMOTE = "😂";
export const STAGE_EVENT_GAP_MS = 600;
export const STAGE_EVENT_LIMIT = 30;
// A take may run a little past the reference so players are not cut off mid-sound.
export const RECORDING_SLACK_SECONDS = 0.5;

export function unavailableScore(reason: string): AudioScore {
  return {
    overall: null,
    reliability: "unavailable",
    reason,
    features: { duration: 0, envelope: 0, pitch: null, onsets: 0, spectrum: 0 },
    method: "local-acoustic-v1",
  };
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
      rounds: 3,
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
  return (
    room.phase === "LOBBY" &&
    hasClips &&
    players.length >= 2 &&
    players.every((player) => player.ready)
  );
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
    submission.duration > room.recordSeconds + 1
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

export function recordingWindowSeconds(referenceSeconds: number): number {
  return Math.round((referenceSeconds + RECORDING_SLACK_SECONDS) * 10) / 10;
}

export function addStageEvent(
  room: RoomState,
  playerId: string,
  kind: StageEventKind,
  emote: string,
  eventId: string,
  now: number,
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
  if (kind === "tomato" && !isWatchingSomeoneElse) return false;
  // Only a watcher's first laugh and first tomato per performance count toward awards.
  const countsTowardAwards =
    kind === "tomato" || (kind === "emote" && emote === LAUGH_EMOTE);
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
    targetId: kind === "tomato" && performance ? performance.playerId : "",
    at: now,
  });
  if (room.stageEvents.length > STAGE_EVENT_LIMIT) room.stageEvents.shift();
  return true;
}
