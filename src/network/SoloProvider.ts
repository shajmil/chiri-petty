import type { RealtimeProvider, RoomEvent, RoomState } from "../game/types";
import { createPlayer, createRoom, SOLO_ROUNDS } from "../game/rules";

/** A room for one player on this device: nothing is sent anywhere, and takes stay in memory. */
export class SoloProvider implements RealtimeProvider {
  public readonly kind = "solo" as const;
  public readonly playerId = crypto.randomUUID();
  public clockOffset = 0;
  private readonly takes = new Map<string, Blob>();

  public async open(_code: string | null, name: string, avatar: number): Promise<RoomState> {
    const room = createRoom("SOLOROOM", createPlayer(this.playerId, name, avatar, Date.now()));
    room.settings.maxPlayers = 1;
    room.settings.rounds = SOLO_ROUNDS;
    return room;
  }

  public async subscribe(
    _listener: (event: RoomEvent) => void,
    connection: (connected: boolean) => void,
  ): Promise<void> {
    connection(true);
  }

  // With nobody else in the room, there is nothing to send or save.
  public async send(): Promise<void> {}

  public async sendVoice(): Promise<void> {}

  public onVoice(): void {}

  public async save(): Promise<void> {}

  public async recover(): Promise<boolean> {
    return true;
  }

  public async upload(path: string, blob: Blob): Promise<void> {
    this.takes.set(path, blob);
  }

  public async download(path: string): Promise<Blob> {
    const blob = this.takes.get(path);
    if (!blob) throw new Error("Recording was not found.");
    return blob;
  }

  public async close(): Promise<void> {
    this.takes.clear();
  }
}
