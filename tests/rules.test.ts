import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptSubmission,
  awardRound,
  canStart,
  createPlayer,
  recordingWindowSeconds,
  createRoom,
  createCustomClip,
  CUSTOM_CLIP_LIMIT,
  addStageEvent,
  LAUGH_EMOTE,
  STAGE_EVENT_LIMIT,
  unavailableScore,
} from "../src/game/rules";
import type { Submission } from "../src/game/types";
import { createDeck, findPrompt } from "../src/game/prompts";

function match() {
  const room = createRoom("ABCDEFGH", createPlayer("host", "Anu", 0, 1000));
  room.players.push(createPlayer("friend", "Manu", 1, 1001));
  room.players.forEach((player) => {
    player.ready = true;
  });
  return room;
}

test("starting requires two connected, ready players", () => {
  const room = match();
  assert.equal(canStart(room), true);
  room.players[1].ready = false;
  assert.equal(canStart(room), false);
  room.players[1].connected = false;
  assert.equal(canStart(room), false);
});

test("one submission per player; reject wrong round, sender, deadline and invalid score", () => {
  const room = match();
  room.phase = "RECORDING";
  room.roundId = "round";
  room.recordAt = 100;
  room.deadline = 1000;
  room.recordSeconds = 5;
  const submission: Submission = {
    playerId: "host",
    roundId: "round",
    duration: 5,
    path: null,
    score: { ...unavailableScore("test"), overall: 75 },
    reactionCount: 0,
    tomatoes: 0,
  };
  assert.equal(acceptSubmission(room, "host", submission, 500), true);
  assert.equal(acceptSubmission(room, "friend", submission, 500), false);
  assert.equal(acceptSubmission(room, "host", submission, 13001), false);
  assert.equal(acceptSubmission(room, "host", submission, 1001), true);
  room.phase = "SUBMISSION_LOCK";
  assert.equal(acceptSubmission(room, "host", submission, 1001), false);
  room.phase = "RECORDING";
  assert.equal(acceptSubmission(room, "host", submission, 99), false);
  assert.equal(
    acceptSubmission(room, "host", { ...submission, roundId: "stale" }, 500),
    false,
  );
  assert.equal(
    acceptSubmission(
      room,
      "host",
      { ...submission, score: { ...submission.score, overall: 200 } },
      500,
    ),
    false,
  );
  assert.equal(
    acceptSubmission(room, "host", { ...submission, duration: 6.5 }, 500),
    false,
  );
  room.submissions.push(submission);
  assert.equal(acceptSubmission(room, "host", submission, 500), false);
});

test("round points equal the take score and are awarded only once", () => {
  const room = match();
  room.phase = "SCORING";
  room.round = 1;
  room.deck = ["bruh"];
  room.submissions.push({
    playerId: "host",
    roundId: "",
    duration: 2,
    path: null,
    score: { ...unavailableScore("test"), overall: 70 },
    reactionCount: 0,
    tomatoes: 0,
  });
  awardRound(room);
  awardRound(room);
  assert.equal(room.players[0].total, 70);
  assert.equal(room.players[1].total, 0);
  assert.equal(room.results.length, 1);
});

test("the recording window is the clip length plus half a second", () => {
  assert.equal(recordingWindowSeconds(1.0), 1.5);
  assert.equal(recordingWindowSeconds(0.39), 0.9);
  assert.equal(recordingWindowSeconds(4.5), 5);
});

test("only the host adds valid room clips in the lobby; custom pack needs a clip", () => {
  const room = match();
  const path = "ABCDEFGH/custom/host-0a1b2c3d.wav";
  room.settings.category = "custom";
  assert.equal(canStart(room), false);
  assert.equal(createCustomClip(room, "friend", "Ayyo", "ABCDEFGH/custom/friend-0a1b2c3d.wav", 2), null);
  assert.equal(createCustomClip(room, "host", "Ayyo", "OTHERROOM/custom/host-0a1b2c3d.wav", 2), null);
  assert.equal(createCustomClip(room, "host", "Ayyo", "ABCDEFGH/custom/host-0a1b2c3d.mp3", 2), null);
  assert.equal(createCustomClip(room, "host", "   ", path, 2), null);
  assert.equal(createCustomClip(room, "host", "Ayyo", path, 0.2), null);
  assert.equal(createCustomClip(room, "host", "Ayyo", path, 6.5), null);
  const clip = createCustomClip(room, "host", "  Ayyo  ", path, 2);
  assert.equal(clip?.title, "Ayyo");
  assert.equal(clip?.referenceKind, "custom");
  room.customClips.push(clip!);
  assert.equal(createCustomClip(room, "host", "Again", path, 2), null);
  assert.equal(canStart(room), true);
  assert.deepEqual(createDeck("custom", 3, room.customClips), [path, path, path]);
  assert.equal(findPrompt(path, room.customClips).title, "Ayyo");
  room.phase = "ANNOUNCING";
  assert.equal(createCustomClip(room, "host", "Late", "ABCDEFGH/custom/host-11111111.wav", 2), null);
});

test("a room holds at most the clip limit", () => {
  const room = match();
  for (let index = 0; index < CUSTOM_CLIP_LIMIT; index++) {
    const path = `ABCDEFGH/custom/host-${index.toString(16).padStart(8, "0")}.wav`;
    room.customClips.push(createCustomClip(room, "host", `Clip ${index}`, path, 1)!);
  }
  assert.equal(createCustomClip(room, "host", "One more", "ABCDEFGH/custom/host-ffffffff.wav", 1), null);
});

function performance(room: ReturnType<typeof match>) {
  room.phase = "PLAYBACK";
  room.submissions = [
    {
      playerId: "host",
      roundId: room.roundId,
      duration: 2,
      path: null,
      score: unavailableScore("test"),
      reactionCount: 0,
      tomatoes: 0,
    },
  ];
  room.playbackIndex = 0;
  return room.submissions[0];
}

test("stage reactions: emotes are validated and rate-limited per player", () => {
  const room = match();
  assert.equal(addStageEvent(room, "friend", "emote", "🔥", "e1", 1000), true);
  assert.equal(addStageEvent(room, "friend", "emote", "🔥", "e2", 1200), false);
  assert.equal(addStageEvent(room, "friend", "dance", "", "e3", 1700), true);
  assert.equal(addStageEvent(room, "friend", "emote", "💩", "e4", 3000), false);
  assert.equal(addStageEvent(room, "stranger", "emote", "🔥", "e5", 3000), false);
  room.players[1].connected = false;
  assert.equal(addStageEvent(room, "friend", "emote", "🔥", "e6", 5000), false);
  assert.deepEqual(room.stageEvents.map((event) => event.kind), ["emote", "dance"]);
});

test("tomatoes hit only someone else's performance; first tomato and laugh count once", () => {
  const room = match();
  assert.equal(addStageEvent(room, "friend", "tomato", "", "t0", 1000), false);
  const take = performance(room);
  assert.equal(addStageEvent(room, "host", "tomato", "", "t1", 2000), false);
  assert.equal(addStageEvent(room, "friend", "tomato", "", "t2", 3000), true);
  assert.equal(addStageEvent(room, "friend", "tomato", "", "t3", 4000), true);
  assert.equal(room.stageEvents.at(-1)?.targetId, "host");
  assert.equal(take.tomatoes, 1);
  assert.equal(room.players[0].tomatoes, 1);
  assert.equal(addStageEvent(room, "friend", "emote", LAUGH_EMOTE, "l1", 5000), true);
  assert.equal(addStageEvent(room, "friend", "emote", LAUGH_EMOTE, "l2", 6000), true);
  assert.equal(take.reactionCount, 1);
  assert.equal(room.players[0].laughs, 1);
});

test("stage event history stays bounded", () => {
  const room = match();
  for (let index = 0; index < STAGE_EVENT_LIMIT + 10; index++)
    addStageEvent(room, "friend", "dance", "", `d${index}`, index * 1000);
  assert.equal(room.stageEvents.length, STAGE_EVENT_LIMIT);
  assert.equal(room.stageEvents[0].id, "d10");
});
