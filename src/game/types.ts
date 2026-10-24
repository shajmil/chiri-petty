export type Phase =
  | "LOBBY"
  | "ANNOUNCING"
  | "LISTENING"
  | "RECORDING"
  | "SUBMISSION_LOCK"
  | "PLAYBACK"
  | "SCORING"
  | "NEXT_ROUND"
  | "FINISHED";
export type World =
  | "malayalam-movies"
  | "meme-classics"
  | "viral-reactions"
  | "cartoon-chaos"
  | "music"
  | "daily-drama"
  | "wild-calls"
  | "machine-room";
export type Category = World | "mimicry" | "mixed" | "custom";
export type Difficulty = "easy" | "normal" | "hard";

export interface AudioScore {
  overall: number | null;
  reliability: "good" | "low" | "unavailable";
  reason: string;
  /** Each part of the comparison from 0 to 100; melody is null when the reference has no clear pitch. */
  features: {
    rhythm: number;
    energy: number;
    melody: number | null;
    texture: number;
  };
  method: "local-acoustic-v2";
}

export interface Prompt {
  id: string;
  category: Exclude<Category, "mixed">;
  title: string;
  /** The words or noise shown on the cue card for players to imitate. */
  cue: string;
  difficulty: Difficulty | null;
  instruction: string;
  reference: string;
  duration: number;
  license: string;
  referenceKind: "recorded" | "custom";
}

export interface Player {
  id: string;
  name: string;
  avatar: number;
  ready: boolean;
  connected: boolean;
  joinedAt: number;
  total: number;
  laughs: number;
  tomatoes: number;
}

export interface Submission {
  playerId: string;
  roundId: string;
  path: string | null;
  /** Seconds of the take worth playing, from its first sound. */
  duration: number;
  /** Seconds of silence before the first sound, which playback skips so nobody waits at the mic. */
  startOffset: number;
  score: AudioScore;
  reactionCount: number;
  tomatoes: number;
}

export type StageEventKind = "emote" | "dance" | "tomato";

export interface StageEvent {
  id: string;
  playerId: string;
  kind: StageEventKind;
  emote: string;
  targetId: string;
  /** The target ducked out of the way, so the tomato lands on the floor. */
  dodged: boolean;
  at: number;
}

export interface RoundResult {
  round: number;
  promptId: string;
  points: Record<string, number>;
}

export interface RoomState {
  protocol: 1;
  code: string;
  hostId: string;
  revision: number;
  matchId: string;
  phase: Phase;
  deadline: number;
  recordAt: number;
  /** This round's recording window: the reference length plus a little slack. */
  recordSeconds: number;
  startedAt: number;
  players: Player[];
  settings: {
    category: Category;
    rounds: number;
    maxPlayers: number;
  };
  deck: string[];
  customClips: Prompt[];
  round: number;
  roundId: string;
  submissions: Submission[];
  playbackIndex: number;
  playbackStartAt: number;
  stageEvents: StageEvent[];
  results: RoundResult[];
  reactions: string[];
  notice: string;
}

export type Command =
  | { type: "hello"; name: string; avatar: number }
  | { type: "ready"; ready: boolean }
  | {
      type: "settings";
      category: Category;
      rounds: number;
    }
  | { type: "addClip"; title: string; path: string; duration: number }
  | { type: "removeClip"; clipId: string }
  | { type: "start" }
  | { type: "submit"; submission: Submission }
  | { type: "emote"; emote: string }
  | { type: "dance" }
  | { type: "tomato" }
  | { type: "again" }
  | { type: "leave" };

export interface RoomEvent {
  version: 1;
  id: string;
  sender: string;
  code: string;
  matchId: string;
  roundId: string;
  sentAt: number;
  command?: Command;
  state?: RoomState;
}

/** A message that sets up the live voice link between two players. */
export interface VoiceSignal {
  from: string;
  /** Empty means everyone in the room. */
  to: string;
  kind: "hello" | "here" | "offer" | "answer" | "bye";
  /** Pairs an answer with its offer, so a late answer from an older attempt is ignored. */
  linkId: string;
  description?: RTCSessionDescriptionInit;
}

export interface RealtimeProvider {
  readonly kind: "online" | "tabs";
  readonly playerId: string;
  clockOffset: number;
  open(code: string | null, name: string, avatar: number): Promise<RoomState>;
  subscribe(
    listener: (event: RoomEvent) => void,
    connection: (connected: boolean) => void,
  ): Promise<void>;
  send(event: RoomEvent): Promise<void>;
  sendVoice(signal: VoiceSignal): Promise<void>;
  onVoice(listener: (signal: VoiceSignal) => void): void;
  save(state: RoomState): Promise<void>;
  recover(state: RoomState): Promise<boolean>;
  upload(path: string, blob: Blob): Promise<void>;
  download(path: string): Promise<Blob>;
  close(): Promise<void>;
}
