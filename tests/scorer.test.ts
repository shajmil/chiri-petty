import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AcousticScorer } from "../src/core/LocalAudioScorer";

const scorer = new AcousticScorer();

function libraryClip(id: string): { samples: Float32Array; rate: number } {
  const file = readFileSync(`public/audio/library/${id}.wav`);
  return {
    rate: file.readUInt32LE(24),
    samples: Float32Array.from(
      { length: (file.length - 44) / 2 },
      (_, index) => file.readInt16LE(44 + index * 2) / 32768,
    ),
  };
}

// A take as a phone records it: a pause first, quieter, with a little steady hiss.
function asATake(samples: Float32Array, rate: number): Float32Array {
  const take = new Float32Array(samples.length + Math.round(rate * 1.4));
  let seed = 1;
  for (let index = 0; index < take.length; index++) {
    seed = (seed * 16807) % 2147483647;
    take[index] = ((seed / 2147483647) * 2 - 1) * 0.004;
  }
  samples.forEach((sample, index) => {
    take[index + rate] += sample * 0.4;
  });
  return take;
}

// Playing a clip faster also raises its pitch, like a squeaky imitation.
function fasterAndHigher(samples: Float32Array, factor: number): Float32Array {
  return Float32Array.from({ length: Math.floor(samples.length / factor) }, (_, index) => {
    const position = index * factor;
    const before = Math.floor(position);
    const mix = position - before;
    return samples[before] * (1 - mix) + (samples[before + 1] ?? 0) * mix;
  });
}

const sampleRate = 22050;
function tone(frequency = 220, amplitude = 0.4): Float32Array {
  return Float32Array.from(
    { length: sampleRate * 2 },
    (_, index) =>
      Math.sin((index / sampleRate) * frequency * Math.PI * 2) *
      amplitude *
      (Math.sin((index / sampleRate) * Math.PI * 2) > -0.1 ? 1 : 0.1),
  );
}

test("copying the reference after a pause scores full marks, even quieter and with hiss", () => {
  const { samples, rate } = libraryClip("a-few-moments-later");
  const score = scorer.compare(samples, asATake(samples, rate), rate, "meme-classics");
  assert.ok(score.overall !== null && score.overall >= 95, String(score.overall));
  assert.ok(score.features.rhythm >= 90);
  assert.equal(score.reliability, "good");
  assert.equal(score.method, "local-acoustic-v2");
});

test("a faster, squeakier copy keeps its shape and still scores high", () => {
  const { samples, rate } = libraryClip("a-few-moments-later");
  const score = scorer.compare(samples, asATake(fasterAndHigher(samples, 1.12), rate), rate, "meme-classics");
  assert.ok(score.overall !== null && score.overall >= 85, String(score.overall));
});

test("an unrelated sound scores far below a copy", () => {
  const { samples, rate } = libraryClip("a-few-moments-later");
  const unrelated = libraryClip("metal-pipe-clang");
  const copy = scorer.compare(samples, asATake(samples, rate), rate, "meme-classics").overall!;
  const wrong = scorer.compare(samples, asATake(unrelated.samples, rate), rate, "meme-classics").overall!;
  assert.ok(wrong <= 40, String(wrong));
  assert.ok(copy - wrong >= 50, `${copy} vs ${wrong}`);
});

test("invalid reference audio does not produce a score", () => {
  const reference = tone();
  reference[100] = NaN;
  assert.equal(scorer.compare(reference, tone(), sampleRate, "machine-room").overall, null);
});

test("silence, invalid samples and short clips do not receive invented scores", () => {
  const reference = tone();
  assert.equal(
    scorer.compare(reference, new Float32Array(sampleRate), sampleRate, "cartoon-chaos").overall,
    null,
  );
  const invalid = tone();
  invalid[1000] = NaN;
  assert.equal(scorer.compare(reference, invalid, sampleRate, "cartoon-chaos").overall, null);
  assert.equal(scorer.compare(reference, new Float32Array(10), sampleRate, "cartoon-chaos").overall, null);
});

test("clipping reduces confidence and dialogue discloses lack of semantic judgment", () => {
  const clipped = Float32Array.from(tone(), (sample) => (sample >= 0 ? 1 : -1));
  assert.equal(scorer.compare(tone(), clipped, sampleRate, "cartoon-chaos").reliability, "low");
  assert.match(scorer.compare(tone(), tone(), sampleRate, "daily-drama").reason, /not words/);
});
