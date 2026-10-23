import type { AudioScore, Category } from "../game/types";
import { unavailableScore } from "../game/rules";

export interface LocalAudioScorer {
  compare(
    reference: Float32Array,
    attempt: Float32Array,
    sampleRate: number,
    category: Category,
  ): AudioScore;
}

interface AcousticFeatures {
  duration: number;
  envelope: number[];
  pitch: number[];
  onsets: number[];
  spectrum: number[];
  peak: number;
  rms: number;
  clipping: number;
}

const SPEECH = { duration: 0.1, envelope: 0.35, pitch: 0.25, onsets: 0.25, spectrum: 0.05 };
const MUSIC = { duration: 0.1, envelope: 0.25, pitch: 0.35, onsets: 0.2, spectrum: 0.1 };
const CREATURE = { duration: 0.15, envelope: 0.25, pitch: 0.2, onsets: 0.2, spectrum: 0.2 };
const MACHINE = { duration: 0.15, envelope: 0.25, pitch: 0.1, onsets: 0.2, spectrum: 0.3 };
const MIXED = { duration: 0.15, envelope: 0.3, pitch: 0.2, onsets: 0.2, spectrum: 0.15 };

export const CATEGORY_WEIGHTS: Record<Category, typeof MIXED> = {
  "malayalam-movies": SPEECH,
  "meme-classics": MIXED,
  "viral-reactions": MIXED,
  "cartoon-chaos": MIXED,
  music: MUSIC,
  "daily-drama": SPEECH,
  "wild-calls": CREATURE,
  "machine-room": MACHINE,
  mimicry: SPEECH,
  mixed: MIXED,
  // Host clips can be speech or any sound, so they use the balanced mix.
  custom: MIXED,
};

function extract(samples: Float32Array, sampleRate: number): AcousticFeatures {
  if (sampleRate >= 32000) {
    const reduced = new Float32Array(Math.floor(samples.length / 2));
    for (let index = 0; index < reduced.length; index++) {
      reduced[index] = (samples[index * 2] + samples[index * 2 + 1]) / 2;
    }
    return extract(reduced, sampleRate / 2);
  }
  let peak = 0;
  let squareSum = 0;
  let clipped = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    squareSum += sample * sample;
    if (Math.abs(sample) > 0.985) clipped++;
  }
  const threshold = Math.max(0.008, peak * 0.06);
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const active = samples.subarray(start, end + 1);
  const frameSize = 512;
  const hop = 256;
  const energies: number[] = [];
  const pitch: number[] = [];
  const spectrum = [0, 0, 0, 0];
  for (let offset = 0; offset + frameSize <= active.length; offset += hop) {
    let energy = 0;
    let changes = 0;
    for (let index = 0; index < frameSize; index++) {
      const sample = active[offset + index];
      energy += sample * sample;
      if (index > 0 && sample * active[offset + index - 1] < 0) changes++;
    }
    energies.push(Math.sqrt(energy / frameSize) / Math.max(peak, 0.001));
    const brightness = changes / frameSize;
    spectrum[Math.min(3, Math.floor(brightness * 12))]++;
    let bestCorrelation = 0.65;
    let bestLag = 0;
    if (energies.length % 3 === 1 && energy / frameSize > 0.0001) {
      for (
        let lag = Math.floor(sampleRate / 800);
        lag < Math.min(frameSize / 2, sampleRate / 70);
        lag += 2
      ) {
        let correlation = 0;
        let firstEnergy = 0;
        let secondEnergy = 0;
        for (let index = 0; index < frameSize - lag; index += 2) {
          const first = active[offset + index];
          const second = active[offset + index + lag];
          correlation += first * second;
          firstEnergy += first * first;
          secondEnergy += second * second;
        }
        const normalized =
          correlation / Math.sqrt(firstEnergy * secondEnergy || 1);
        if (normalized > bestCorrelation) {
          bestCorrelation = normalized;
          bestLag = lag;
        }
      }
    }
    if (bestLag) pitch.push(Math.log2(sampleRate / bestLag));
  }
  const maxEnergy = Math.max(...energies, 0.001);
  const onsets: number[] = [];
  for (let index = 1; index < energies.length; index++) {
    if (
      energies[index] > maxEnergy * 0.3 &&
      energies[index - 1] <= maxEnergy * 0.3 &&
      (onsets.length === 0 ||
        index / energies.length - onsets[onsets.length - 1] > 0.05)
    )
      onsets.push(index / energies.length);
  }
  const envelope = Array.from({ length: 32 }, (_, index) => {
    const from = Math.floor((index * energies.length) / 32);
    const to = Math.max(
      from + 1,
      Math.floor(((index + 1) * energies.length) / 32),
    );
    return (
      energies.slice(from, to).reduce((sum, energy) => sum + energy, 0) /
      Math.max(1, to - from) /
      maxEnergy
    );
  });
  const meanPitch =
    pitch.reduce((sum, frequency) => sum + frequency, 0) / (pitch.length || 1);
  return {
    duration: active.length / sampleRate,
    envelope,
    pitch: pitch.map((frequency) => frequency - meanPitch),
    onsets,
    spectrum: spectrum.map((count) => count / (energies.length || 1)),
    peak,
    rms: Math.sqrt(squareSum / (samples.length || 1)),
    clipping: clipped / (samples.length || 1),
  };
}

function similarity(first: number[], second: number[]): number {
  if (!first.length || !second.length) return 0;
  let difference = 0;
  for (let index = 0; index < 32; index++) {
    difference += Math.abs(
      first[
        Math.min(first.length - 1, Math.floor((index * first.length) / 32))
      ] -
        second[
          Math.min(second.length - 1, Math.floor((index * second.length) / 32))
        ],
    );
  }
  return Math.max(0, Math.min(100, Math.round(100 * (1 - difference / 32))));
}

export class AcousticScorer implements LocalAudioScorer {
  public compare(
    reference: Float32Array,
    attempt: Float32Array,
    sampleRate: number,
    category: Category,
  ): AudioScore {
    if (
      !sampleRate ||
      attempt.length < sampleRate * 0.2 ||
      reference.length < sampleRate * 0.2
    )
      return unavailableScore("Recording is too short to compare.");
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate <= 0 ||
      attempt.some((sample) => !Number.isFinite(sample)) ||
      reference.some((sample) => !Number.isFinite(sample))
    )
      return unavailableScore("Invalid audio samples.");
    const target = extract(reference, sampleRate);
    const recorded = extract(attempt, sampleRate);
    if (recorded.rms < 0.003 || recorded.peak < 0.012)
      return unavailableScore("Too quiet to score. Check your microphone.");
    if (target.rms < 0.003)
      return unavailableScore("Reference audio is too quiet.");
    const features = {
      duration: Math.round(
        (100 * Math.min(target.duration, recorded.duration)) /
          Math.max(target.duration, recorded.duration),
      ),
      envelope: similarity(target.envelope, recorded.envelope),
      pitch:
        target.pitch.length >= 8 && recorded.pitch.length >= 8
          ? similarity(target.pitch, recorded.pitch)
          : null,
      onsets: Math.round(
        Math.max(
          0,
          100 -
            Math.abs(target.onsets.length - recorded.onsets.length) * 18 -
            (target.onsets.length && recorded.onsets.length
              ? (100 - similarity(target.onsets, recorded.onsets)) * 0.5
              : 0),
        ),
      ),
      spectrum: similarity(target.spectrum, recorded.spectrum),
    };
    const weights = CATEGORY_WEIGHTS[category];
    let total = 0;
    let weightSum = 0;
    for (const key of [
      "duration",
      "envelope",
      "pitch",
      "onsets",
      "spectrum",
    ] as const) {
      if (features[key] !== null) {
        total += features[key]! * weights[key];
        weightSum += weights[key];
      }
    }
    const low =
      recorded.clipping > 0.01 ||
      recorded.duration < 0.4 ||
      features.pitch === null;
    return {
      overall: Math.round(total / weightSum),
      reliability: low ? "low" : "good",
      reason:
        recorded.clipping > 0.01
          ? "Clipping detected; comparison may be unreliable."
          : CATEGORY_WEIGHTS[category] === SPEECH
            ? "Compares delivery rhythm, not words, accent or comedy."
            : low
              ? "Pitch was unreliable; temporal and texture features were used."
              : "Approximate acoustic similarity, not an AI judgment.",
      features,
      method: "local-acoustic-v1",
    };
  }
}
