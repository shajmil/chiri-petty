import { AcousticScorer } from "./LocalAudioScorer";
import type { AudioScore, Prompt } from "../game/types";

export class AudioManager {
  public level = 0;
  public volume = 0.7;
  public recording = false;
  public referenceShape: number[] = [];
  public takeShape: number[] = [];
  public loadCustomClip: ((path: string) => Promise<Blob>) | null = null;

  private waveform(buffer: AudioBuffer): number[] {
    const samples = buffer.getChannelData(0);
    return Array.from({ length: 80 }, (_, bar) => {
      const start = Math.floor(bar * samples.length / 80);
      const end = Math.floor((bar + 1) * samples.length / 80);
      let peak = 0;
      for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(samples[i]));
      return peak;
    });
  }
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private playbackAnalyser: AnalyserNode | null = null;
  private microphoneSource: MediaStreamAudioSourceNode | null = null;
  private playback: AudioBufferSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly scorer = new AcousticScorer();
  private readonly references = new Map<string, AudioBuffer>();

  /** True until the browser lets this page play sound, which needs a tap first on some phones. */
  public get isLocked(): boolean {
    return this.context?.state !== "running";
  }

  public async unlock(): Promise<void> {
    this.context ??= new AudioContext({ sampleRate: 44100 });
    if (this.context.state === "suspended") await this.context.resume();
  }

  public async enableMicrophone(deviceId?: string): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw new Error(
        "Recording needs a supported browser on HTTPS or localhost.",
      );
    await this.unlock();
    if (this.stream && deviceId === undefined) return;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.microphoneSource?.disconnect();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    });
    this.analyser = this.context!.createAnalyser();
    this.analyser.fftSize = 256;
    this.microphoneSource = this.context!.createMediaStreamSource(this.stream);
    this.microphoneSource.connect(this.analyser);
  }

  public microphoneTrack(): MediaStreamTrack | null {
    return this.stream?.getAudioTracks()[0] ?? null;
  }

  /** Measures how loud a live stream is, for speaking indicators. Call stop() when the stream goes away. */
  public watchStreamLevel(stream: MediaStream): { read: () => number; stop: () => void } {
    if (!this.context) return { read: () => 0, stop: () => {} };
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 256;
    const source = this.context.createMediaStreamSource(stream);
    source.connect(analyser);
    return { read: () => this.measureLevel(analyser), stop: () => source.disconnect() };
  }

  public readLevel(): number {
    this.level = this.measureLevel(this.analyser);
    return this.level;
  }

  public readPlaybackLevel(): number {
    return this.playback ? this.measureLevel(this.playbackAnalyser) : 0;
  }

  private measureLevel(analyser: AnalyserNode | null): number {
    if (!analyser) return 0;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    return Math.min(
      1,
      Math.sqrt(
        samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) /
          samples.length,
      ) * 4,
    );
  }

  public async reference(prompt: Prompt): Promise<AudioBuffer> {
    await this.unlock();
    const cached = this.references.get(prompt.reference);
    if (cached) return cached;
    let bytes: ArrayBuffer;
    if (prompt.referenceKind === "custom") {
      if (!this.loadCustomClip) throw new Error("Room clips are unavailable.");
      bytes = await (await this.loadCustomClip(prompt.reference)).arrayBuffer();
    } else {
      const response = await fetch(prompt.reference);
      if (!response.ok) throw new Error("Reference sound could not be loaded.");
      bytes = await response.arrayBuffer();
    }
    const buffer = await this.context!.decodeAudioData(bytes);
    this.references.set(prompt.reference, buffer);
    return buffer;
  }

  public async decodeFile(file: Blob): Promise<AudioBuffer> {
    await this.unlock();
    try {
      return await this.context!.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new Error("This file is not audio the browser can play.");
    }
  }

  // Re-encoding keeps only the chosen seconds and strips the original file's metadata.
  public async trimToWav(
    source: AudioBuffer,
    startSeconds: number,
    endSeconds: number,
  ): Promise<Blob> {
    const sampleRate = 22050;
    const seconds = endSeconds - startSeconds;
    const offline = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
    const player = offline.createBufferSource();
    player.buffer = source;
    player.connect(offline.destination);
    player.start(0, startSeconds, seconds);
    const samples = (await offline.startRendering()).getChannelData(0);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
    if (peak < 0.01) throw new Error("This part of the clip is silent.");
    const wav = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const writeText = (offset: number, text: string) =>
      [...text].forEach((letter, index) => wav.setUint8(offset + index, letter.charCodeAt(0)));
    writeText(0, "RIFF");
    wav.setUint32(4, wav.byteLength - 8, true);
    writeText(8, "WAVEfmt ");
    wav.setUint32(16, 16, true);
    wav.setUint16(20, 1, true);
    wav.setUint16(22, 1, true);
    wav.setUint32(24, sampleRate, true);
    wav.setUint32(28, sampleRate * 2, true);
    wav.setUint16(32, 2, true);
    wav.setUint16(34, 16, true);
    writeText(36, "data");
    wav.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
      const fade = Math.min(1, index / 220, (samples.length - 1 - index) / 220);
      wav.setInt16(44 + index * 2, Math.round((sample / peak) * 0.89 * fade * 32767), true);
    });
    return new Blob([wav], { type: "audio/wav" });
  }

  public async playReference(prompt: Prompt): Promise<void> {
    const buffer = await this.reference(prompt);
    this.referenceShape = this.waveform(buffer);
    this.takeShape = [];
    this.playBuffer(buffer);
  }

  private playBuffer(buffer: AudioBuffer, offset = 0): void {
    this.stopPlayback();
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = this.volume;
    source.connect(gain).connect(context.destination);
    this.playbackAnalyser ??= context.createAnalyser();
    this.playbackAnalyser.fftSize = 256;
    gain.connect(this.playbackAnalyser);
    this.playback = source;
    source.start(0, Math.min(offset, Math.max(0, buffer.duration - 0.05)));
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }

  public async playBlob(blob: Blob, offset = 0): Promise<void> {
    await this.unlock();
    const buffer = await this.context!.decodeAudioData(
      await blob.arrayBuffer(),
    );
    this.playBuffer(buffer, offset);
  }

  public beep(frequency: number): void {
    if (!this.context) return;
    const startsAt = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.2 * this.volume, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startsAt + 0.12);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + 0.12);
  }

  /** A short wet "splat" for a tomato landing: fading noise through a low-pass filter. */
  public splat(): void {
    // A splat during your recording would end up in your take.
    if (!this.context || this.recording) return;
    const context = this.context;
    const length = Math.floor(context.sampleRate * 0.18);
    const noise = context.createBuffer(1, length, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < length; index++)
      samples[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3;
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = context.createGain();
    gain.gain.value = 0.5 * this.volume;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  public stopPlayback(): void {
    try {
      this.playback?.stop();
    } catch {
      /* Source may already have ended. */
    }
    this.playback = null;
  }

  public async record(
    seconds: number,
    prompt: Prompt,
  ): Promise<{ blob: Blob; duration: number; startOffset: number; score: AudioScore }> {
    await this.enableMicrophone();
    if (this.recording) throw new Error("A recording is already in progress.");
    this.stopPlayback();
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    this.recorder = new MediaRecorder(
      this.stream!,
      mimeType ? { mimeType } : undefined,
    );
    const recorder = this.recorder;
    this.recording = true;
    const chunks: Blob[] = [];
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.recording = false;
        reject(new Error("The microphone recording failed."));
      };
      recorder.onstop = () => {
        this.recording = false;
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
      recorder.start();
      this.stopTimer = setTimeout(
        () => {
          if (recorder.state === "recording") recorder.stop();
        },
        Math.max(200, seconds * 1000),
      );
    });
    const attempt = await this.context!.decodeAudioData(
      await blob.arrayBuffer(),
    );
    this.takeShape = this.waveform(attempt);
    const reference = await this.reference(prompt);
    const mono = (buffer: AudioBuffer) => {
      if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
      const samples = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const input = buffer.getChannelData(channel);
        for (let index = 0; index < samples.length; index++)
          samples[index] += input[index] / buffer.numberOfChannels;
      }
      return samples;
    };
    const attemptSamples = mono(attempt);
    return {
      blob,
      duration: attempt.duration,
      startOffset: quietStartSeconds(attemptSamples, attempt.sampleRate),
      score: this.scorer.compare(
        mono(reference),
        attemptSamples,
        attempt.sampleRate,
        prompt.category,
      ),
    };
  }

  public cancelRecording(): void {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recording = false;
  }

  public dispose(): void {
    this.references.clear();
    this.cancelRecording();
    this.stopPlayback();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.microphoneSource?.disconnect();
    void this.context?.close();
    this.context = null;
    this.playbackAnalyser = null;
  }
}

/**
 * Seconds of quiet before the first real sound in a take (within 20 dB of its loudest moment),
 * minus a small margin so the start of the sound is never cut.
 */
function quietStartSeconds(samples: Float32Array, sampleRate: number): number {
  const windowSize = Math.max(1, Math.round(sampleRate * 0.02));
  const levels: number[] = [];
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0;
    for (let index = start; index < start + windowSize; index++) sum += samples[index] ** 2;
    levels.push(Math.sqrt(sum / windowSize));
  }
  const loudest = Math.max(0, ...levels);
  if (!loudest) return 0;
  const firstSound = levels.findIndex((level) => level >= loudest * 0.1);
  return Math.max(0, (firstSound * windowSize) / sampleRate - 0.15);
}
