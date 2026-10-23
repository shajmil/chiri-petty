import type { AudioManager } from "../core/AudioManager";
import type {
  Command,
  Prompt,
  RealtimeProvider,
  RoomEvent,
  RoomState,
  Submission,
} from "./types";
import {
  acceptSubmission,
  addStageEvent,
  awardRound,
  canStart,
  createCustomClip,
  createPlayer,
  DEFAULT_ROUNDS,
  ROUND_CHOICES,
  recordingWindowSeconds,
  SCORE_REVEAL_MS,
  unavailableScore,
  UPLOAD_GRACE_MS,
  WALK_TO_MIC_MS,
} from "./rules";
import { createDeck, findPrompt, PLAYABLE_PACKS } from "./prompts";

export class Game {
  public state: RoomState | null = null;
  public connected = false;
  public error = "";
  public submissionStatus = "";
  /** When the reference started playing on this device, so the lyrics follow what this player hears. */
  public referenceStartedAt = 0;
  private readonly listeners = new Set<() => void>();
  private readonly seenEvents = new Set<string>();
  private readonly lastSeen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastHello = 0;
  private lastSnapshot = 0;
  private lastHostSeen = 0;
  private lastPhaseKey = "";
  private recordedRound = "";
  private lastBeepKey = "";
  private playbackKey = "";
  private playbackRequest = 0;
  private pendingTake: { blob: Blob; duration: number } | null = null;
  private recoveryPending = false;
  private closed = false;
  private name = "";
  private avatar = 0;

  public constructor(
    public readonly provider: RealtimeProvider,
    public readonly audio: AudioManager,
  ) {}

  public get playerId(): string {
    return this.provider.playerId;
  }
  public get isHost(): boolean {
    return this.state?.hostId === this.playerId;
  }
  public get now(): number {
    return Date.now() + this.provider.clockOffset;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  public async open(
    code: string | null,
    name: string,
    avatar: number,
  ): Promise<void> {
    this.name = name;
    this.avatar = avatar;
    this.state = await this.provider.open(code, name, avatar);
    this.audio.loadCustomClip = (path) => this.provider.download(path);
    this.lastHostSeen = this.now;
    await this.provider.subscribe(
      (event) => this.receive(event),
      (connected) => {
        this.connected = connected;
        this.notify();
      },
    );
    this.timer = setInterval(() => this.tick(), 150);
    await this.command({ type: "hello", name, avatar });
    this.notify();
  }

  private envelope(): RoomEvent {
    return {
      version: 1,
      id: crypto.randomUUID(),
      sender: this.playerId,
      code: this.state!.code,
      matchId: this.state!.matchId,
      roundId: this.state!.roundId,
      sentAt: this.now,
    };
  }

  public async command(command: Command): Promise<void> {
    if (!this.state || this.closed) return;
    const event = { ...this.envelope(), command };
    if (this.isHost) this.receive(event);
    else await this.provider.send(event).catch((error) => this.report(error));
  }

  private receive(event: RoomEvent): void {
    const room = this.state;
    if (
      !room ||
      !event ||
      event.version !== 1 ||
      typeof event.id !== "string" ||
      typeof event.sender !== "string" ||
      event.code !== room.code ||
      this.seenEvents.has(event.id)
    )
      return;
    if (event.command?.type === "hello")
      this.lastSeen.set(event.sender, this.now);
    this.seenEvents.add(event.id);
    if (this.seenEvents.size > 3000)
      this.seenEvents.delete(this.seenEvents.values().next().value!);
    if (event.state) {
      if (
        event.state.protocol !== 1 ||
        !Array.isArray(event.state.players) ||
        !event.state.settings ||
        !Array.isArray(event.state.deck) ||
        !Array.isArray(event.state.customClips) ||
        !Array.isArray(event.state.stageEvents)
      )
        return;
      if (
        event.sender !== room.hostId &&
        !(
          event.state.phase === "LOBBY" &&
          event.state.notice.startsWith("Host left")
        )
      )
        return;
      this.lastHostSeen = this.now;
      if (event.state.revision > room.revision) {
        this.state = event.state;
        this.notify();
      }
      return;
    }
    if (!event.command || !this.isHost) return;
    if (event.command.type === "hello") {
      if (
        typeof event.command.name !== "string" ||
        !Number.isFinite(event.command.avatar)
      )
        return;
      this.lastSeen.set(event.sender, this.now);
      let player = room.players.find((entry) => entry.id === event.sender);
      if (
        !player &&
        room.phase === "LOBBY" &&
        room.players.length < room.settings.maxPlayers
      ) {
        player = createPlayer(
          event.sender,
          event.command.name,
          event.command.avatar,
          this.now,
        );
        room.players.push(player);
      }
      if (player) player.connected = true;
      void this.publish();
      return;
    }
    const player = room.players.find((entry) => entry.id === event.sender);
    if (!player) return;
    if (
      ![
        "ready",
        "settings",
        "start",
        "again",
        "leave",
        "addClip",
        "removeClip",
        "emote",
        "dance",
      ].includes(
        event.command.type,
      ) &&
      (event.matchId !== room.matchId || event.roundId !== room.roundId)
    )
      return;
    const command = event.command;
    switch (command.type) {
      case "ready":
        if (room.phase === "LOBBY") player.ready = Boolean(command.ready);
        break;
      case "settings":
        if (event.sender === room.hostId && room.phase === "LOBBY") {
          room.settings.category = PLAYABLE_PACKS.some(
            (pack) => pack.id === command.category,
          )
            ? command.category
            : "mixed";
          room.settings.rounds = ROUND_CHOICES.includes(command.rounds)
            ? command.rounds
            : DEFAULT_ROUNDS;
        }
        break;
      case "addClip": {
        const clip = createCustomClip(
          room,
          event.sender,
          command.title,
          command.path,
          command.duration,
        );
        if (clip) room.customClips.push(clip);
        break;
      }
      case "removeClip":
        if (event.sender === room.hostId && room.phase === "LOBBY")
          room.customClips = room.customClips.filter(
            (clip) => clip.id !== command.clipId,
          );
        break;
      case "start":
        if (event.sender === room.hostId && canStart(room)) {
          room.players = room.players.filter((entry) => entry.connected);
          room.matchId = crypto.randomUUID();
          room.startedAt = this.now;
          room.deck = createDeck(
            room.settings.category,
            room.settings.rounds,
            room.customClips,
            room.deck,
          );
          room.results = [];
          room.round = 0;
          for (const entry of room.players) {
            entry.total = 0;
            entry.laughs = 0;
            entry.tomatoes = 0;
          }
          room.stageEvents = [];
          this.nextRound();
        }
        break;
      case "submit":
        if (
          acceptSubmission(room, event.sender, command.submission, this.now)
        ) {
          const submission = structuredClone(command.submission);
          const validPrefix = `${room.code}/${room.matchId}/${room.roundId}/${event.sender}.`;
          if (submission.path && !submission.path.startsWith(validPrefix))
            return;
          submission.reactionCount = 0;
          submission.tomatoes = 0;
          room.submissions.push(submission);
        }
        break;
      case "emote":
      case "dance":
      case "tomato":
        if (
          !addStageEvent(
            room,
            event.sender,
            command.type,
            command.type === "emote" ? command.emote : "",
            event.id,
            this.now,
          )
        )
          return;
        // Reactions are short-lived, so they are broadcast without a database save.
        void this.publish(false);
        return;
      case "again":
        if (event.sender === room.hostId && room.phase === "FINISHED") {
          room.phase = "LOBBY";
          room.notice = "One more round? Everyone ready up.";
          room.players = room.players.filter((entry) => entry.connected);
          room.players.forEach((entry) => {
            entry.ready = false;
          });
        }
        break;
      case "leave":
        player.connected = false;
        player.ready = false;
        this.lastSeen.delete(player.id);
        break;
    }
    void this.publish();
  }

  private async publish(saveToDatabase = true): Promise<void> {
    if (!this.state || this.closed) return;
    this.state.revision++;
    this.lastSnapshot = this.now;
    this.lastHostSeen = this.now;
    this.notify();
    const snapshot = structuredClone(this.state);
    await this.provider
      .send({ ...this.envelope(), state: snapshot })
      .catch((error) => this.report(error));
    if (saveToDatabase)
      await this.provider.save(snapshot).catch((error) => this.report(error));
  }

  private report(error: unknown): void {
    this.error =
      error instanceof Error ? error.message : "Something went wrong.";
    this.notify();
  }

  private nextRound(): void {
    const room = this.state!;
    room.round++;
    room.roundId = crypto.randomUUID();
    room.submissions = [];
    room.reactions = [];
    room.playbackIndex = 0;
    room.notice = "";
    this.setPhase("ANNOUNCING", 3);
  }

  // Each performer walks to the mic, their take plays, then their score is revealed.
  private startPerformance(): void {
    const room = this.state!;
    const take = room.submissions[room.playbackIndex];
    room.reactions = [];
    room.phase = "PLAYBACK";
    room.playbackStartAt = this.now + WALK_TO_MIC_MS;
    room.deadline =
      room.playbackStartAt + (take?.duration ?? 0) * 1000 + SCORE_REVEAL_MS;
  }

  private setPhase(phase: RoomState["phase"], seconds: number): void {
    this.state!.phase = phase;
    this.state!.deadline = this.now + seconds * 1000;
  }

  private advance(): void {
    const room = this.state!;
    switch (room.phase) {
      case "ANNOUNCING":
        this.setPhase(
          "LISTENING",
          this.currentPrompt().duration + 2,
        );
        break;
      case "LISTENING":
        room.recordSeconds = recordingWindowSeconds(this.currentPrompt().duration);
        room.recordAt = this.now + 3000;
        this.setPhase("RECORDING", room.recordSeconds + 3);
        break;
      case "RECORDING":
        room.phase = "SUBMISSION_LOCK";
        room.deadline += UPLOAD_GRACE_MS;
        break;
      case "SUBMISSION_LOCK":
        room.submissions.sort(
          (first, second) =>
            room.players.findIndex((player) => player.id === first.playerId) -
            room.players.findIndex((player) => player.id === second.playerId),
        );
        room.playbackIndex = 0;
        this.startPerformance();
        break;
      case "PLAYBACK":
        if (room.playbackIndex + 1 < room.submissions.length) {
          room.playbackIndex++;
          this.startPerformance();
        } else {
          awardRound(room);
          // Short and lively: the round winner celebrates at the mic while scores show.
          this.setPhase("SCORING", 4);
        }
        break;
      case "SCORING":
        this.setPhase(
          room.round >= room.settings.rounds ? "FINISHED" : "NEXT_ROUND",
          1.5,
        );
        break;
      case "NEXT_ROUND":
        this.nextRound();
        break;
    }
    void this.publish();
  }

  private tick(): void {
    if (!this.state || this.closed) return;
    const room = this.state;
    if (this.now - this.lastHello > 2500) {
      this.lastHello = this.now;
      void this.command({
        type: "hello",
        name: this.name,
        avatar: this.avatar,
      });
    }
    if (this.isHost) {
      for (const player of room.players) {
        if (
          player.id !== this.playerId &&
          this.now - (this.lastSeen.get(player.id) ?? player.joinedAt) > 11000
        ) {
          player.connected = false;
          player.ready = false;
        }
      }
      if (
        !["LOBBY", "FINISHED"].includes(room.phase) &&
        this.now >= room.deadline
      )
        this.advance();
      if (
        room.phase === "SUBMISSION_LOCK" &&
        room.players
          .filter((player) => player.connected)
          .every((player) =>
            room.submissions.some((entry) => entry.playerId === player.id),
          )
      )
        this.advance();
      if (this.now - this.lastSnapshot > 2500) void this.publish();
    } else if (
      this.connected &&
      this.now - this.lastHostSeen > 12000 &&
      !this.recoveryPending
    ) {
      const candidates = room.players
        .filter(
          (player) =>
            player.id !== room.hostId &&
            player.connected &&
            (player.id === this.playerId ||
              this.now - (this.lastSeen.get(player.id) ?? player.joinedAt) <
                11000),
        )
        .sort(
          (first, second) =>
            first.joinedAt - second.joinedAt ||
            first.id.localeCompare(second.id),
        );
      if (candidates[0]?.id === this.playerId) void this.recover();
    }
    this.handleAudio();
    this.notify();
  }

  private async recover(): Promise<void> {
    this.recoveryPending = true;
    try {
      if (this.state && (await this.provider.recover(this.state))) {
        const oldHost = this.state.players.find(
          (player) => player.id === this.state!.hostId,
        );
        if (oldHost) oldHost.connected = false;
        this.state.hostId = this.playerId;
        this.state.phase = "LOBBY";
        this.state.notice =
          "Host left. Room recovered; ready up to restart the match.";
        this.state.players.forEach((player) => {
          player.ready = false;
        });
        this.audio.cancelRecording();
        this.audio.stopPlayback();
        await this.publish();
      }
    } finally {
      this.recoveryPending = false;
    }
  }

  private currentPrompt(): Prompt {
    const room = this.state!;
    return findPrompt(room.deck[room.round - 1], room.customClips);
  }

  public async addCustomClip(
    title: string,
    clip: Blob,
    duration: number,
  ): Promise<void> {
    const room = this.state!;
    const fileId = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
    const path = `${room.code}/custom/${this.playerId}-${fileId}.wav`;
    await this.provider.upload(path, clip);
    await this.command({ type: "addClip", title, path, duration });
  }

  private handleAudio(): void {
    const room = this.state!;
    const phaseKey = `${room.roundId}:${room.phase}`;
    if (phaseKey !== this.lastPhaseKey) {
      this.lastPhaseKey = phaseKey;
      this.audio.stopPlayback();
      this.playbackRequest++;
      this.pendingTake = null;
      if (room.phase === "LISTENING")
        void this.audio
          .playReference(this.currentPrompt())
          .then(() => {
            this.referenceStartedAt = this.now;
          })
          .catch((error) => this.report(error));
      if (room.phase === "ANNOUNCING") {
        this.error = "";
        this.submissionStatus = "";
        this.referenceStartedAt = 0;
        // Download the reference early so listening starts on time.
        void this.audio.reference(this.currentPrompt()).catch(() => undefined);
      }
    }
    // One beep per count-in second; they end before recording so they are not in the take.
    if (room.phase === "RECORDING" && this.now < room.recordAt) {
      const secondsLeft = Math.ceil((room.recordAt - this.now) / 1000);
      const beepKey = `${room.roundId}:${secondsLeft}`;
      if (beepKey !== this.lastBeepKey && secondsLeft <= 3) {
        this.lastBeepKey = beepKey;
        this.audio.beep(secondsLeft === 1 ? 880 : 660);
      }
    }
    if (
      room.phase === "RECORDING" &&
      this.now >= room.recordAt &&
      this.now < room.deadline &&
      this.recordedRound !== room.roundId
    ) {
      this.recordedRound = room.roundId;
      void this.recordAttempt();
    }
    const playbackKey = `${room.roundId}:${room.playbackIndex}`;
    if (room.phase === "PLAYBACK" && this.playbackKey !== playbackKey) {
      this.playbackKey = playbackKey;
      this.pendingTake = null;
      const submission = room.submissions[room.playbackIndex];
      const request = ++this.playbackRequest;
      this.audio.stopPlayback();
      if (submission?.path)
        void this.provider
          .download(submission.path)
          .then((blob) => {
            if (request !== this.playbackRequest) return;
            this.pendingTake = { blob, duration: submission.duration };
          })
          .catch((error) => this.report(error));
    }
    // A take starts once its performer reaches the mic. A late download skips ahead to stay in sync.
    if (
      this.pendingTake &&
      room.phase === "PLAYBACK" &&
      this.now >= room.playbackStartAt
    ) {
      const take = this.pendingTake;
      this.pendingTake = null;
      const offset = (this.now - room.playbackStartAt) / 1000;
      if (offset < take.duration)
        void this.audio
          .playBlob(take.blob, offset)
          .catch((error) => this.report(error));
    }
  }

  private async recordAttempt(): Promise<void> {
    const room = this.state!;
    const roundId = room.roundId;
    const matchId = room.matchId;
    const recordingSeconds = Math.max(0.2, (room.deadline - this.now) / 1000);
    const submission: Submission = {
      playerId: this.playerId,
      roundId,
      path: null,
      duration: 0,
      score: unavailableScore("No recording submitted."),
      reactionCount: 0,
      tomatoes: 0,
    };
    this.submissionStatus = "Recording…";
    try {
      const attempt = await this.audio.record(
        recordingSeconds,
        this.currentPrompt(),
      );
      if (
        this.closed ||
        this.state?.roundId !== roundId ||
        this.state.phase === "LOBBY"
      )
        return;
      this.submissionStatus = "Uploading your one take…";
      this.notify();
      const extension = attempt.blob.type.includes("mp4") ? "mp4" : "webm";
      const path = `${room.code}/${matchId}/${roundId}/${this.playerId}.${extension}`;
      await this.provider.upload(path, attempt.blob);
      submission.path = path;
      submission.duration = attempt.duration;
      submission.score = attempt.score;
      this.submissionStatus = "Take submitted. No second takes!";
    } catch (error) {
      this.submissionStatus =
        error instanceof Error ? error.message : "Recording failed.";
      submission.score = unavailableScore(this.submissionStatus);
    }
    if (this.state?.roundId === roundId)
      await this.command({ type: "submit", submission });
    this.notify();
  }

  public async close(): Promise<void> {
    await this.command({ type: "leave" });
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.playbackRequest++;
    this.audio.cancelRecording();
    this.audio.stopPlayback();
    await this.provider.close();
  }
}
