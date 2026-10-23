import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { RealtimeProvider, RoomEvent, RoomState } from "../game/types";
import { createPlayer, createRoom } from "../game/rules";

const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const onlineConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  supabasePublicKey,
);

export class SupabaseProvider implements RealtimeProvider {
  public readonly kind = "online" as const;
  public playerId = "";
  public clockOffset = 0;
  private readonly client: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private code = "";

  public constructor() {
    if (!onlineConfigured)
      throw new Error(
        "Online rooms need Supabase configuration. See the setup guide.",
      );
    this.client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabasePublicKey!,
    );
  }

  public async open(
    code: string | null,
    name: string,
    avatar: number,
  ): Promise<RoomState> {
    const { data: session } = await this.client.auth.getSession();
    if (!session.session) {
      const { error } = await this.client.auth.signInAnonymously();
      if (error)
        throw new Error(
          `Guest sign-in failed: ${error.message}. Enable anonymous sign-ins in Supabase.`,
        );
    }
    const { data: user } = await this.client.auth.getUser();
    if (!user.user) throw new Error("Guest session could not be created.");
    this.playerId = user.user.id;
    const before = Date.now();
    const { data: serverTime } = await this.client.rpc("party_time");
    if (serverTime)
      this.clockOffset = Number(serverTime) - (before + Date.now()) / 2;
    this.code =
      code ??
      Array.from(
        crypto.getRandomValues(new Uint8Array(8)),
        (value) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[value % 32],
      ).join("");
    if (code) {
      const { data, error } = await this.client.rpc("join_party", {
        room_code: code,
        player_name: name.trim().slice(0, 24),
        player_avatar: avatar,
      });
      if (error) throw new Error(error.message);
      return data as RoomState;
    }
    const room = createRoom(
      this.code,
      createPlayer(this.playerId, name, avatar, Date.now() + this.clockOffset),
    );
    const { error } = await this.client.rpc("create_party", {
      room_code: this.code,
      initial_state: room,
      player_name: name,
      player_avatar: avatar,
    });
    if (error) throw new Error(error.message);
    return room;
  }

  public async subscribe(
    listener: (event: RoomEvent) => void,
    connection: (connected: boolean) => void,
  ): Promise<void> {
    const { data, error } = await this.client.auth.getSession();
    if (error || !data.session) {
      throw new Error("Guest session expired. Refresh and join the room again.");
    }
    await this.client.realtime.setAuth(data.session.access_token);
    this.channel = this.client.channel(`party:${this.code}`, {
      config: {
        private: true,
        broadcast: { self: false, ack: true },
        presence: { key: this.playerId },
      },
    });
    this.channel.on("broadcast", { event: "party" }, ({ payload }) =>
      listener(payload as RoomEvent),
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error("Room connection timed out. Check Realtime policies."),
          ),
        15000,
      );
      this.channel!.subscribe((status, error) => {
        connection(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(
            new Error(
              `Private room connection failed: ${error?.message || status}. Refresh and try again.`,
            ),
          );
        }
      });
    });
    await this.channel.track({ id: this.playerId, connectedAt: Date.now() });
  }

  public async send(event: RoomEvent): Promise<void> {
    const status = await this.channel?.send({
      type: "broadcast",
      event: "party",
      payload: event,
    });
    if (status !== "ok")
      throw new Error("Room message could not be delivered. Reconnecting…");
  }

  public async save(state: RoomState): Promise<void> {
    const { error } = await this.client.rpc("save_party", {
      room_code: state.code,
      new_state: state,
    });
    if (error) throw new Error(error.message);
  }

  public async recover(state: RoomState): Promise<boolean> {
    const { data, error } = await this.client.rpc("recover_party", {
      room_code: state.code,
    });
    if (error) return false;
    return data === this.playerId;
  }

  public async upload(path: string, blob: Blob): Promise<void> {
    if (blob.size > 2 * 1024 * 1024)
      throw new Error("Recording exceeds the 2 MB upload limit.");
    const { error } = await this.client.storage
      .from("party-recordings")
      .upload(path, blob, {
        contentType: blob.type.split(";")[0],
        upsert: false,
      });
    if (error) throw new Error(`Upload failed: ${error.message}`);
  }

  public async download(path: string): Promise<Blob> {
    const { data, error } = await this.client.storage
      .from("party-recordings")
      .download(path);
    if (error) throw new Error(`Playback download failed: ${error.message}`);
    return data;
  }

  public async close(): Promise<void> {
    if (this.channel) {
      await this.channel.untrack();
      await this.client.removeChannel(this.channel);
    }
  }
}
