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

type FeatureName = "rhythm" | "energy" | "melody" | "texture";
type Weights = Record<FeatureName, number>;

// Texture (the same sounds in the same order) tells a real imitation from a random noise best,
// and energy least, because lining two recordings up always finds some loud and quiet parts that match.
const SPEECH: Weights = { rhythm: 0.3, energy: 0.15, melody: 0.25, texture: 0.3 };
const MUSIC: Weights = { rhythm: 0.2, energy: 0.1, melody: 0.5, texture: 0.2 };
const CREATURE: Weights = { rhythm: 0.2, energy: 0.15, melody: 0.35, texture: 0.3 };
const MACHINE: Weights = { rhythm: 0.35, energy: 0.15, melody: 0.1, texture: 0.4 };
const MIXED: Weights = { rhythm: 0.3, energy: 0.15, melody: 0.25, texture: 0.3 };

export const CATEGORY_WEIGHTS: Record<Category, Weights> = {
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

// Sound is analysed at 16 kHz in 32 ms frames every 20 ms: plenty of detail for voices, quick on phones.
const ANALYSIS_RATE = 16000;
const FRAME_SIZE = 512;
const HOP_SIZE = 320;
const BAND_COUNT = 16;
// Pitch is found at 8 kHz in 64 ms windows, which covers voices from 70 Hz to 1 kHz.
const PITCH_RATE = 8000;
const PITCH_WINDOW = 512;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 1000;

// The colour of a sound is kept as a smoothed spectrum outline (8 cepstral coefficients), which
// follows vowels and consonants but ignores the fine harmonics that depend on the voice's pitch.
const COLOUR_SIZE = 8;

interface Frame {
  /** 0 is 40 dB below the loudest moment, 1 is the loudest moment. */
  loudness: number;
  /** Semitones above or below the clip's usual pitch, or null when the frame has no clear pitch. */
  pitch: number | null;
  /** The spectrum outline of this moment. */
  colour: number[];
  /** The outline minus the clip's average outline: which sound is being made, whoever makes it. */
  articulation: number[];
}

interface Analysis {
  /** Only the part with sound in it; silence before and after is trimmed. */
  frames: Frame[];
  /** The clip's average spectrum outline: how bright, deep or hissy it sounds overall. */
  averageColour: number[];
  peak: number;
  clipping: number;
  /** How far the loudest moment stands above the background, in dB. */
  dynamicRange: number;
}

export class AcousticScorer implements LocalAudioScorer {
  public compare(
    reference: Float32Array,
    attempt: Float32Array,
    sampleRate: number,
    category: Category,
  ): AudioScore {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0)
      return unavailableScore("Invalid audio samples.");
    if (attempt.length < sampleRate * 0.2 || reference.length < sampleRate * 0.2)
      return unavailableScore("Recording is too short to compare.");
    if (hasInvalidSample(attempt) || hasInvalidSample(reference))
      return unavailableScore("Invalid audio samples.");

    const target = analyse(reference, sampleRate, false);
    const take = analyse(attempt, sampleRate, true);
    if (target.frames.length < 5) return unavailableScore("Reference audio is too quiet.");
    if (take.peak < 0.01 || take.frames.length < 5)
      return unavailableScore("Too quiet to score. Check your microphone.");

    const path = align(target.frames, take.frames);
    const features = {
      rhythm: percent(rhythmMatch(target.frames, take.frames)),
      energy: percent(energyMatch(target.frames, take.frames, path)),
      melody: nullablePercent(melodyMatch(target.frames, take.frames, path)),
      texture: percent(textureMatch(target, take, path)),
    };
    const weights = CATEGORY_WEIGHTS[category];
    let total = 0;
    let weightSum = 0;
    for (const name of ["rhythm", "energy", "melody", "texture"] as const) {
      const value = features[name];
      if (value === null) continue;
      total += value * weights[name];
      weightSum += weights[name];
    }

    // Even unrelated sounds rarely match less than 20, and a near-perfect copy reaches about 92,
    // so that range is spread over the whole 0 to 100.
    const overall = percent(scale(total / weightSum / 100, 0.2, 0.92));
    const isClipped = take.clipping > 0.005;
    const isNoisy = take.dynamicRange < 10;
    return {
      overall,
      reliability: isClipped || isNoisy ? "low" : "good",
      reason: isClipped
        ? "Your take was so loud it distorted, so this score is less certain."
        : isNoisy
          ? "Background noise made this score less certain."
          : weights === SPEECH
            ? "Compares rhythm, energy, melody and texture, not words, accent or comedy."
            : "Compares rhythm, energy, melody and texture, not an AI judgment.",
      features,
      method: "local-acoustic-v2",
    };
  }
}

function hasInvalidSample(samples: Float32Array): boolean {
  return samples.some((sample) => !Number.isFinite(sample));
}

/**
 * A take always begins with a moment of silence, so its quietest part shows the microphone's hiss.
 * A reference clip may have no silence at all, so its quietest part is still part of the sound.
 */
function analyse(samples: Float32Array, sampleRate: number, startsWithSilence: boolean): Analysis {
  let peak = 0;
  let clipped = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    if (Math.abs(sample) > 0.985) clipped++;
  }
  const signal = resample(samples, sampleRate, ANALYSIS_RATE);
  const pitchSignal = resample(samples, sampleRate, PITCH_RATE);

  const loudnessDb: number[] = [];
  for (let offset = 0; offset + FRAME_SIZE <= signal.length; offset += HOP_SIZE)
    loudnessDb.push(decibels(rootMeanSquare(signal.subarray(offset, offset + FRAME_SIZE))));
  const loudest = Math.max(...loudnessDb);
  const background = percentile(loudnessDb, 0.05);
  // Sound is anything within 20 dB of the loudest moment, so a reference and a take are trimmed alike.
  // In a noisy take the sound also has to rise clearly above the hiss, but anything within 10 dB
  // of the loudest moment always counts.
  const threshold = startsWithSilence
    ? Math.min(Math.max(loudest - 20, background + 6), loudest - 10)
    : loudest - 20;
  const isActive = loudnessDb.map((db) => db >= threshold);
  // A single click at either end is not the start of the sound: it starts where two active frames meet.
  const first = isActive.findIndex((active, index) => active && isActive[index + 1]);
  let last = -1;
  for (let index = isActive.length - 1; index > 0; index--)
    if (isActive[index] && isActive[index - 1]) {
      last = index;
      break;
    }

  const window = hannWindow();
  const bandEdges = melBandEdges();
  const frames: Frame[] = [];
  if (first >= 0 && last > first) {
    for (let index = first; index <= last; index++) {
      const offset = index * HOP_SIZE;
      const center = (offset + FRAME_SIZE / 2) * (PITCH_RATE / ANALYSIS_RATE);
      frames.push({
        loudness: clamp((loudnessDb[index] - loudest + 40) / 40),
        pitch: isActive[index] ? detectPitch(pitchSignal, center) : null,
        colour: spectrumOutline(signal.subarray(offset, offset + FRAME_SIZE), window, bandEdges),
        articulation: [],
      });
    }
  }
  makePitchRelative(frames);
  const averageColour = Array.from({ length: COLOUR_SIZE }, (_, coefficient) =>
    frames.reduce((sum, frame) => sum + frame.colour[coefficient], 0) / (frames.length || 1),
  );
  for (const frame of frames)
    frame.articulation = frame.colour.map((value, coefficient) => value - averageColour[coefficient]);
  return {
    frames,
    averageColour,
    peak,
    clipping: clipped / (samples.length || 1),
    dynamicRange: loudest - background,
  };
}

function resample(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  const step = fromRate / toRate;
  const output = new Float32Array(Math.floor(samples.length / step));
  for (let index = 0; index < output.length; index++) {
    // Averaging every input sample an output sample covers also removes most sound above the new limit.
    const from = Math.floor(index * step);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((index + 1) * step)));
    let sum = 0;
    for (let source = from; source < to; source++) sum += samples[source];
    output[index] = sum / (to - from);
  }
  return output;
}

function rootMeanSquare(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function decibels(level: number): number {
  return 20 * Math.log10(level + 1e-5);
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function hannWindow(): Float64Array {
  return Float64Array.from(
    { length: FRAME_SIZE },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FRAME_SIZE - 1)),
  );
}

// 16 bands from 80 Hz to 7.6 kHz, spaced the way hearing spaces pitch, as FFT bin numbers.
function melBandEdges(): number[] {
  const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
  const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const lowest = toMel(80);
  const highest = toMel(7600);
  const edges: number[] = [];
  for (let index = 0; index <= BAND_COUNT; index++) {
    const hz = fromMel(lowest + ((highest - lowest) * index) / BAND_COUNT);
    const bin = Math.round((hz * FRAME_SIZE) / ANALYSIS_RATE);
    edges.push(index === 0 ? bin : Math.max(bin, edges[index - 1] + 1));
  }
  return edges;
}

function spectrumOutline(frame: Float32Array, window: Float64Array, bandEdges: number[]): number[] {
  const real = Float64Array.from(frame, (sample, index) => sample * window[index]);
  const imaginary = new Float64Array(FRAME_SIZE);
  fft(real, imaginary);
  const bands: number[] = [];
  for (let band = 0; band < BAND_COUNT; band++) {
    let energy = 0;
    for (let bin = bandEdges[band]; bin < bandEdges[band + 1]; bin++)
      energy += real[bin] ** 2 + imaginary[bin] ** 2;
    bands.push(10 * Math.log10(energy + 1e-10));
  }
  // Very quiet bands are mostly microphone hiss, so nothing counts as more than 35 dB below the loudest band.
  const loudestBand = Math.max(...bands);
  const flooredBands = bands.map((db) => Math.max(db, loudestBand - 35));
  // The cosine transform turns the 16 bands into a smooth outline; the first value
  // (overall loudness) is skipped because loudness is compared separately.
  return Array.from({ length: COLOUR_SIZE }, (_, index) => {
    const coefficient = index + 1;
    let sum = 0;
    flooredBands.forEach((db, band) => {
      sum += db * Math.cos((Math.PI * coefficient * (band + 0.5)) / BAND_COUNT);
    });
    return (sum * 2) / BAND_COUNT;
  });
}

// In-place radix-2 fast Fourier transform.
function fft(real: Float64Array, imaginary: Float64Array): void {
  const size = real.length;
  for (let index = 1, swap = 0; index < size; index++) {
    let bit = size >> 1;
    for (; swap & bit; bit >>= 1) swap ^= bit;
    swap ^= bit;
    if (index < swap) {
      [real[index], real[swap]] = [real[swap], real[index]];
      [imaginary[index], imaginary[swap]] = [imaginary[swap], imaginary[index]];
    }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (-2 * Math.PI) / length;
    for (let start = 0; start < size; start += length) {
      for (let offset = 0; offset < length / 2; offset++) {
        const cos = Math.cos(angle * offset);
        const sin = Math.sin(angle * offset);
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * cos - imaginary[odd] * sin;
        const oddImaginary = real[odd] * sin + imaginary[odd] * cos;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
      }
    }
  }
}

// YIN pitch detection: find the shortest delay at which the sound repeats itself.
function detectPitch(signal: Float32Array, center: number): number | null {
  const minLag = Math.floor(PITCH_RATE / MAX_PITCH_HZ);
  const maxLag = Math.ceil(PITCH_RATE / MIN_PITCH_HZ);
  const start = Math.round(center - PITCH_WINDOW / 2);
  if (start < 0 || start + PITCH_WINDOW + maxLag > signal.length) return null;
  const normalized = new Float64Array(maxLag + 2).fill(1);
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let difference = 0;
    for (let index = 0; index < PITCH_WINDOW; index++) {
      const delta = signal[start + index] - signal[start + index + lag];
      difference += delta * delta;
    }
    runningSum += difference;
    // Dividing by the running average makes the dip at the true period stand out.
    normalized[lag] = runningSum ? (difference * lag) / runningSum : 1;
  }
  let bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (normalized[lag] >= 0.2) continue;
    while (lag < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
    bestLag = lag;
    break;
  }
  if (!bestLag) return null;
  const before = normalized[bestLag - 1];
  const after = normalized[bestLag + 1];
  const curvature = before + after - 2 * normalized[bestLag];
  const period = curvature > 0 ? bestLag + (before - after) / (2 * curvature) : bestLag;
  return 12 * Math.log2(PITCH_RATE / period / 440) + 69;
}

// Pitch is compared relative to each clip's usual pitch, so a deep voice can imitate a squeaky one.
function makePitchRelative(frames: Frame[]): void {
  // A frame that jumps far from both neighbours is a detection glitch, not a note.
  frames.forEach((frame, index) => {
    const previous = frames[index - 1]?.pitch;
    const next = frames[index + 1]?.pitch;
    if (
      frame.pitch !== null &&
      (previous === null || previous === undefined || Math.abs(frame.pitch - previous) > 7) &&
      (next === null || next === undefined || Math.abs(frame.pitch - next) > 7)
    )
      frame.pitch = null;
  });
  const voiced = frames.flatMap((frame) => (frame.pitch === null ? [] : [frame.pitch]));
  if (!voiced.length) return;
  const usual = percentile(voiced, 0.5);
  for (const frame of frames) if (frame.pitch !== null) frame.pitch -= usual;
}

// Dynamic time warping: pairs every frame of the take with the matching moment of the reference,
// so starting a little late or speaking a little faster does not ruin the comparison.
function align(reference: Frame[], attempt: Frame[]): Array<[number, number]> {
  const rows = reference.length;
  const columns = attempt.length;
  const total = new Float64Array(rows * columns).fill(Infinity);
  const at = (row: number, column: number) =>
    row < 0 || column < 0 ? Infinity : total[row * columns + column];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      // Stay near the diagonal: a take may be faster or slower overall, and drift a little,
      // but a wider corridor would let any two sounds be bent into a match.
      if (Math.abs(row / rows - column / columns) > 0.15) continue;
      const best =
        row === 0 && column === 0
          ? 0
          : Math.min(at(row - 1, column - 1), at(row - 1, column), at(row, column - 1));
      total[row * columns + column] = frameDistance(reference[row], attempt[column]) + best;
    }
  }
  const path: Array<[number, number]> = [];
  let row = rows - 1;
  let column = columns - 1;
  while (row > 0 || column > 0) {
    path.push([row, column]);
    const diagonal = at(row - 1, column - 1);
    const up = at(row - 1, column);
    const left = at(row, column - 1);
    if (diagonal <= up && diagonal <= left) {
      row--;
      column--;
    } else if (up <= left) row--;
    else column--;
  }
  path.push([0, 0]);
  return path.reverse();
}

function frameDistance(first: Frame, second: Frame): number {
  const pitch =
    first.pitch === null || second.pitch === null
      ? first.pitch === second.pitch
        ? 0
        : 0.3
      : Math.min(Math.abs(foldOctaves(first.pitch - second.pitch)), 6) / 6;
  return (
    Math.abs(first.loudness - second.loudness) +
    vectorDistance(first.articulation, second.articulation) / 8 +
    0.5 * pitch
  );
}

function vectorDistance(first: number[], second: number[]): number {
  let sum = 0;
  first.forEach((value, index) => {
    sum += (value - second[index]) ** 2;
  });
  return Math.sqrt(sum / first.length);
}

// A pitch tracker sometimes jumps an octave, so an octave apart counts as the same note.
function foldOctaves(semitones: number): number {
  return semitones - 12 * Math.round(semitones / 12);
}

// Rhythm: stretch the take to the reference's length and check that its beats land in the same places.
function rhythmMatch(reference: Frame[], attempt: Frame[]): number {
  const referenceLoudness = smooth(reference.map((frame) => frame.loudness));
  const attemptLoudness = attempt.map((frame) => frame.loudness);
  const lastFrame = attempt.length - 1;
  // Trimming can keep a quiet breath on one recording but not the other,
  // so the take may start or end slightly earlier or later; the best fit counts.
  let bestFit = -1;
  for (const startShift of [-0.05, 0, 0.05]) {
    for (const endShift of [-0.05, 0, 0.05]) {
      const start = startShift * lastFrame;
      const end = (1 + endShift) * lastFrame;
      const stretched = smooth(
        referenceLoudness.map((_, index) =>
          loudnessAt(attemptLoudness, start + (index * (end - start)) / Math.max(1, reference.length - 1)),
        ),
      );
      bestFit = Math.max(bestFit, correlation(referenceLoudness, stretched));
    }
  }
  const lengthRatio =
    Math.min(reference.length, attempt.length) / Math.max(reference.length, attempt.length);
  return 0.75 * scale(bestFit, 0.25, 0.9) + 0.25 * scale(lengthRatio, 0.35, 0.8);
}

// Before the first frame and after the last one there is silence.
function loudnessAt(loudness: number[], position: number): number {
  if (position < 0 || position > loudness.length - 1) return 0;
  const before = Math.floor(position);
  const after = Math.min(loudness.length - 1, before + 1);
  const mix = position - before;
  return loudness[before] * (1 - mix) + loudness[after] * mix;
}

// Energy: after lining the two up, do they get louder and quieter at the same moments?
function energyMatch(reference: Frame[], attempt: Frame[], path: Array<[number, number]>): number {
  return scale(
    correlation(
      path.map(([row]) => reference[row].loudness),
      path.map(([, column]) => attempt[column].loudness),
    ),
    0.5,
    0.95,
  );
}

// Melody: does the pitch rise and fall the same way, at any key?
function melodyMatch(
  reference: Frame[],
  attempt: Frame[],
  path: Array<[number, number]>,
): number | null {
  const referenceVoiced = reference.filter((frame) => frame.pitch !== null).length;
  // Noises, clicks and whispers have no melody to copy.
  if (referenceVoiced < 8 || referenceVoiced < reference.length * 0.2) return null;
  const referencePitches: number[] = [];
  const attemptPitches: number[] = [];
  let referenceVoicedOnPath = 0;
  for (const [row, column] of path) {
    const referencePitch = reference[row].pitch;
    const attemptPitch = attempt[column].pitch;
    if (referencePitch === null) continue;
    referenceVoicedOnPath++;
    if (attemptPitch === null) continue;
    referencePitches.push(referencePitch);
    attemptPitches.push(attemptPitch);
  }
  if (referencePitches.length < 5) return 0;
  let error = 0;
  referencePitches.forEach((pitch, index) => {
    error += Math.abs(foldOctaves(pitch - attemptPitches[index]));
  });
  error /= referencePitches.length;
  const closeness = scale(error, 5, 1);
  const direction = scale(correlation(referencePitches, attemptPitches), 0, 0.8);
  const coverage = referencePitches.length / referenceVoicedOnPath;
  return (0.5 * closeness + 0.5 * direction) * (0.5 + 0.5 * coverage);
}

// Texture: the same sounds in the same order (vowels, hisses, squeaks), and the same overall colour.
function textureMatch(
  reference: Analysis,
  attempt: Analysis,
  path: Array<[number, number]>,
): number {
  let articulation = 0;
  for (const [row, column] of path)
    articulation += vectorDistance(
      reference.frames[row].articulation,
      attempt.frames[column].articulation,
    );
  articulation /= path.length;
  // Only the first few outline values describe how bright, deep or hissy the whole sound is.
  const colour = vectorDistance(
    reference.averageColour.slice(0, 4),
    attempt.averageColour.slice(0, 4),
  );
  return 0.7 * scale(articulation, 4.2, 1.2) + 0.3 * scale(colour, 4.5, 1);
}

// A light moving average, so a tiny timing difference is not counted as a different beat.
function smooth(values: number[]): number[] {
  return values.map((_, index) => {
    const nearby = values.slice(Math.max(0, index - 1), index + 2);
    return nearby.reduce((sum, value) => sum + value, 0) / nearby.length;
  });
}

function correlation(first: number[], second: number[]): number {
  const count = first.length;
  if (count < 2) return 0;
  const firstMean = first.reduce((sum, value) => sum + value, 0) / count;
  const secondMean = second.reduce((sum, value) => sum + value, 0) / count;
  let product = 0;
  let firstSpread = 0;
  let secondSpread = 0;
  for (let index = 0; index < count; index++) {
    const firstOffset = first[index] - firstMean;
    const secondOffset = second[index] - secondMean;
    product += firstOffset * secondOffset;
    firstSpread += firstOffset ** 2;
    secondSpread += secondOffset ** 2;
  }
  // Two flat lines move together perfectly.
  if (firstSpread < 1e-9 && secondSpread < 1e-9) return 1;
  return product / Math.sqrt(firstSpread * secondSpread || 1);
}

/** Maps value from the range [worst, best] to 0..1. worst may be larger than best for "lower is better". */
function scale(value: number, worst: number, best: number): number {
  return clamp((value - worst) / (best - worst));
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function nullablePercent(value: number | null): number | null {
  return value === null ? null : percent(value);
}
