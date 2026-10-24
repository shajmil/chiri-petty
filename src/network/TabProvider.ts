import type { RealtimeProvider, RoomEvent, RoomState, VoiceSignal } from "../game/types";
import { createPlayer, createRoom } from "../game/rules";

function audioDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("chiri-tab-audio", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("clips");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Browser storage is unavailable."));
  });
}

export class TabProvider implements RealtimeProvider {
  public readonly kind = "tabs" as const;
  public readonly playerId = crypto.randomUUID();
  public clockOffset = 0;
  private code = "";
  private channel: BroadcastChannel | null = null;
  private voiceChannel: BroadcastChannel | null = null;

  public async open(
    code: string | null,
    name: string,
    avatar: number,
  ): Promise<RoomState> {
    this.code =
      code ??
      Array.from(
        crypto.getRandomValues(new Uint8Array(8)),
        (value) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[value % 32],
      ).join("");
    if (code) {
      const stored = localStorage.getItem(`chiri-room-${code}`);
      if (!stored)
        throw new Error(
          "Room not found. Tab test rooms work only in this browser profile.",
        );
      const state = JSON.parse(stored) as RoomState;
      if (state.phase !== "LOBBY")
        throw new Error("This match has started. Join the next one.");
      if (state.players.length >= state.settings.maxPlayers)
        throw new Error("This room is full.");
      return state;
    }
    const room = createRoom(
      this.code,
      createPlayer(this.playerId, name, avatar, Date.now()),
    );
    await this.save(room);
    return room;
  }

  public async subscribe(
    listener: (event: RoomEvent) => void,
    connection: (connected: boolean) => void,
  ): Promise<void> {
    this.channel = new BroadcastChannel(`chiri-party-${this.code}`);
    this.channel.onmessage = (event) => listener(event.data as RoomEvent);
    connection(true);
  }

  public async send(event: RoomEvent): Promise<void> {
    this.channel?.postMessage(event);
  }

  public async sendVoice(signal: VoiceSignal): Promise<void> {
    this.voiceChannel?.postMessage(signal);
  }

  public onVoice(listener: (signal: VoiceSignal) => void): void {
    this.voiceChannel ??= new BroadcastChannel(`chiri-voice-${this.code}`);
    this.voiceChannel.onmessage = (event) => listener(event.data as VoiceSignal);
  }

  public async save(state: RoomState): Promise<void> {
    localStorage.setItem(`chiri-room-${state.code}`, JSON.stringify(state));
  }

  public async recover(state: RoomState): Promise<boolean> {
    const stored = JSON.parse(
      localStorage.getItem(`chiri-room-${state.code}`) ?? "{}",
    ) as RoomState;
    if (stored.hostId !== state.hostId && stored.hostId !== this.playerId)
      return false;
    return true;
  }

  public async upload(path: string, blob: Blob): Promise<void> {
    if (blob.size > 2 * 1024 * 1024) throw new Error("Recording exceeds 2 MB.");
    const database = await audioDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("clips", "readwrite");
      transaction
        .objectStore("clips")
        .put({ blob, createdAt: Date.now() }, path);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error("Recording could not be saved."));
    });
    database.close();
  }

  public async download(path: string): Promise<Blob> {
    const database = await audioDatabase();
    const blob = await new Promise<Blob>((resolve, reject) => {
      const request = database
        .transaction("clips")
        .objectStore("clips")
        .get(path);
      request.onsuccess = () =>
        request.result
          ? resolve(request.result.blob as Blob)
          : reject(new Error("Recording was not found."));
      request.onerror = () => reject(new Error("Recording could not be read."));
    });
    database.close();
    return blob;
  }

  public async close(): Promise<void> {
    this.channel?.close();
    this.voiceChannel?.close();
  }
}
