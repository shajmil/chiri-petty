import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  MIMICRY_LINES,
  PACKS,
  PLAYABLE_PACKS,
  PROMPTS,
  createDeck,
} from "../src/game/prompts";
import { AcousticScorer } from "../src/core/LocalAudioScorer";
import library from "../src/game/library.json";

const recordedMimicry = MIMICRY_LINES.filter((line) => line.duration !== null);

test("every library clip is a short, normalized, traceable WAV", () => {
  assert.equal(PROMPTS.length, library.filter(clip => clip.world !== "music").length + recordedMimicry.length);
  assert.equal(PROMPTS.filter(clip => clip.category === "malayalam-movies").length, 18);
  assert.ok(!PROMPTS.some(clip => clip.category === "music"));
  assert.equal(new Set(library.map((clip) => clip.id)).size, library.length);
  const scorer = new AcousticScorer();
  for (const clip of library) {
    const file = readFileSync(`public/audio/library/${clip.id}.wav`);
    assert.equal(createHash("sha256").update(file).digest("hex"), clip.fileSha256, clip.id);
    assert.ok(clip.source && clip.sourceUrl.startsWith("https://") && clip.license, clip.id);
    assert.ok(PACKS.some((pack) => pack.id === clip.world), clip.id);
    assert.ok(["easy", "normal", "hard"].includes(clip.difficulty), clip.id);
    const rate = file.readUInt32LE(24);
    const samples = Float32Array.from(
      { length: (file.length - 44) / 2 },
      (_, index) => file.readInt16LE(44 + index * 2) / 32768,
    );
    assert.ok(Math.abs(samples.length / rate - clip.duration) < 0.001, clip.id);
    assert.ok(clip.duration <= 4.51, clip.id);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    assert.ok(peak > 0.1 && peak < 0.91, clip.id);
    if (samples.length / rate >= 0.2) {
      const world = clip.world as (typeof PROMPTS)[number]["category"];
      // A real take starts with a short pause before the player makes the sound.
      const copiedTake = new Float32Array(samples.length + rate / 2);
      copiedTake.set(samples, rate / 2);
      assert.ok((scorer.compare(samples, copiedTake, rate, world).overall ?? 0) >= 90, clip.id);
    }
  }
  assert.ok(createDeck("mixed", 50).every((id) => PROMPTS.some((prompt) => prompt.id === id)));
});

test("only worlds with sounds are offered, plus full chaos and room clips", () => {
  for (const pack of PLAYABLE_PACKS) {
    if (pack.id === "mixed" || pack.id === "custom") continue;
    assert.ok(PROMPTS.some((prompt) => prompt.category === pack.id), pack.id);
  }
  assert.equal(
    PLAYABLE_PACKS.some((pack) => pack.id === "mimicry"),
    recordedMimicry.length > 0,
  );
});

test("mimicry script lines are unique, written in Malayalam and only playable with a recording", () => {
  const ids = new Set(MIMICRY_LINES.map((line) => line.id));
  assert.equal(ids.size, MIMICRY_LINES.length);
  for (const line of MIMICRY_LINES) {
    assert.match(line.malayalam, /[ഀ-ൿ]/, line.id);
    assert.ok(line.title && line.meaning && line.delivery, line.id);
    const recorded = existsSync(`public/audio/mimicry/${line.id}.wav`);
    assert.equal(line.duration !== null, recorded, line.id);
    assert.equal(PROMPTS.some((prompt) => prompt.id === line.id), recorded, line.id);
  }
});

test("full chaos: 3 or 4 Malayalam clips in 7 rounds, nothing else repeats, no identical neighbours", () => {
  const isMalayalam = (id: string) =>
    PROMPTS.find((prompt) => prompt.id === id)?.category === "malayalam-movies";
  const malayalamCounts = new Set<number>();
  for (let match = 0; match < 300; match++) {
    const deck = createDeck("mixed", 7);
    assert.equal(deck.length, 7);
    const malayalam = deck.filter(isMalayalam);
    const others = deck.filter((id) => !isMalayalam(id));
    malayalamCounts.add(malayalam.length);
    assert.ok(malayalam.length === 3 || malayalam.length === 4, deck.join());
    assert.equal(new Set(others).size, others.length, deck.join());
    assert.equal(new Set(malayalam).size, malayalam.length, deck.join());
    for (let index = 1; index < deck.length; index++)
      assert.notEqual(deck[index], deck[index - 1], deck.join());
  }
  assert.deepEqual([...malayalamCounts].sort(), [3, 4]);
});

test("a rematch avoids the previous match's sounds, and decks differ between matches", () => {
  const first = createDeck("mixed", 7);
  const second = createDeck("mixed", 7, [], first);
  assert.equal(second.filter((id) => first.includes(id)).length, 0);
  const decks = new Set(Array.from({ length: 50 }, () => createDeck("mixed", 7).join()));
  assert.ok(decks.size > 45);
});

test("single-world packs never repeat a sound while the world still has fresh ones", () => {
  const deck = createDeck("meme-classics", 10);
  assert.equal(new Set(deck).size, 10);
  assert.ok(deck.every((id) => PROMPTS.find((prompt) => prompt.id === id)?.category === "meme-classics"));
  const malayalamOnly = createDeck("malayalam-movies", 7);
  assert.equal(new Set(malayalamOnly).size, 7);
});
