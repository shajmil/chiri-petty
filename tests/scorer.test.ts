import test from "node:test";
import assert from "node:assert/strict";
import { AcousticScorer } from "../src/core/LocalAudioScorer";

const sampleRate = 22050;
function sound(frequency = 220, amplitude = 0.4): Float32Array {
  return Float32Array.from(
    { length: sampleRate * 2 },
    (_, index) =>
      Math.sin((index / sampleRate) * frequency * Math.PI * 2) *
      amplitude *
      (Math.sin((index / sampleRate) * Math.PI * 2) > -0.1 ? 1 : 0.1),
  );
}
const scorer = new AcousticScorer();

test("invalid reference audio does not produce a score", () => {
  const reference = sound();
  reference[100] = NaN;
  assert.equal(scorer.compare(reference, sound(), sampleRate, "machine-room").overall, null);
});

test("identical audio has high similarity with a feature breakdown", () => {
  const reference = sound();
  const score = scorer.compare(reference, reference, sampleRate, "wild-calls");
  assert.ok(score.overall !== null && score.overall >= 98);
  assert.ok(score.features.envelope >= 98);
  assert.equal(score.method, "local-acoustic-v1");
});

test("amplitude normalization preserves reasonable microphone-level differences", () => {
  const score = scorer.compare(
    sound(),
    sound(220, 0.12),
    sampleRate,
    "wild-calls",
  );
  assert.ok(score.overall !== null && score.overall > 90);
});

test("silence, invalid samples and short clips do not receive invented scores", () => {
  const reference = sound();
  assert.equal(
    scorer.compare(reference, new Float32Array(sampleRate), sampleRate, "cartoon-chaos")
      .overall,
    null,
  );
  const invalid = sound();
  invalid[1000] = NaN;
  assert.equal(
    scorer.compare(reference, invalid, sampleRate, "cartoon-chaos").overall,
    null,
  );
  assert.equal(
    scorer.compare(reference, new Float32Array(10), sampleRate, "cartoon-chaos")
      .overall,
    null,
  );
});

test("clipping reduces confidence and dialogue discloses lack of semantic judgment", () => {
  const clipped = Float32Array.from(sound(), (sample) =>
    sample >= 0 ? 1 : -1,
  );
  assert.equal(
    scorer.compare(sound(), clipped, sampleRate, "cartoon-chaos").reliability,
    "low",
  );
  assert.match(
    scorer.compare(sound(), sound(), sampleRate, "daily-drama").reason,
    /not words/,
  );
});
