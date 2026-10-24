import type { AudioManager } from "../core/AudioManager";
import type { RealtimeProvider, VoiceSignal } from "../game/types";

// STUN finds each player's public address. Some networks also need a relay (TURN) server,
// which can be configured with these optional environment variables.
const ONLINE_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [
        {
          urls: process.env.NEXT_PUBLIC_TURN_URL,
          username: process.env.NEXT_PUBLIC_TURN_USERNAME,
          credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
        },
      ]
    : []),
];
// Network addresses are collected before an offer or answer is sent, so a link needs only two messages.
const GATHER_TIMEOUT_MS = 3000;

interface Peer {
  connection: RTCPeerConnection;
  linkId: string;
  speaker: HTMLAudioElement;
  level: { read: () => number; stop: () => void } | null;
}

/** Live voice chat: a direct audio link to every other player, set up through the room channel. */
export class VoiceChat {
  private readonly peers = new Map<string, Peer>();
  private readonly playerVolumes = new Map<string, number>();
  /** A copy of the mic track, so closing the chat mic never silences a recording. */
  private microphone: MediaStreamTrack | null = null;
  private isMicrophoneOpen = true;
  private roundVolume = 1;
  private closed = false;

  public constructor(
    private readonly provider: RealtimeProvider,
    private readonly audio: AudioManager,
  ) {}

  private get myId(): string {
    return this.provider.playerId;
  }

  public start(): void {
    this.provider.onVoice((signal) => void this.receive(signal));
    void this.signal("", "hello");
  }

  public useMicrophone(track: MediaStreamTrack | null): void {
    this.microphone?.stop();
    this.microphone = track ? track.clone() : null;
    if (this.microphone) this.microphone.enabled = this.isMicrophoneOpen;
    for (const peer of this.peers.values())
      for (const sender of peer.connection.getSenders())
        void sender.replaceTrack(this.microphone).catch(() => {});
  }

  public setMicrophoneOpen(isOpen: boolean): void {
    this.isMicrophoneOpen = isOpen;
    if (this.microphone) this.microphone.enabled = isOpen;
  }

  /** Your own volume for one player's live voice. Their performances are not affected. */
  public setPlayerVolume(playerId: string, volume: number): void {
    this.playerVolumes.set(playerId, volume);
    this.applyVolume(playerId);
  }

  /** Fades every live voice during parts of the round, such as a performance. */
  public setRoundVolume(volume: number): void {
    if (volume === this.roundVolume) return;
    this.roundVolume = volume;
    for (const peerId of this.peers.keys()) this.applyVolume(peerId);
  }

  public level(playerId: string): number {
    return this.peers.get(playerId)?.level?.read() ?? 0;
  }

  public isConnected(playerId: string): boolean {
    return this.peers.get(playerId)?.connection.connectionState === "connected";
  }

  /** Drops links to players who left the room. */
  public keepOnly(playerIds: string[]): void {
    for (const peerId of [...this.peers.keys()])
      if (!playerIds.includes(peerId)) this.disconnect(peerId);
  }

  public close(): void {
    if (this.closed) return;
    void this.signal("", "bye");
    this.closed = true;
    for (const peerId of [...this.peers.keys()]) this.disconnect(peerId);
    this.microphone?.stop();
  }

  private async receive(signal: VoiceSignal): Promise<void> {
    if (this.closed || signal.from === this.myId || (signal.to && signal.to !== this.myId)) return;
    try {
      if (signal.kind === "hello") {
        // They just joined or rejoined, so any older link to them is stale.
        this.disconnect(signal.from);
        await this.connect(signal.from);
      } else if (signal.kind === "here") {
        if (!this.peers.has(signal.from)) await this.connect(signal.from);
      } else if (signal.kind === "offer" && signal.description) {
        await this.answer(signal.from, signal.linkId, signal.description);
      } else if (signal.kind === "answer" && signal.description) {
        const peer = this.peers.get(signal.from);
        if (peer?.linkId === signal.linkId)
          await peer.connection.setRemoteDescription(signal.description);
      } else if (signal.kind === "bye") {
        this.disconnect(signal.from);
      }
    } catch {
      // A failed link only loses that player's voice; the game carries on.
      this.disconnect(signal.from);
    }
  }

  // In each pair of players the one with the smaller id makes the offer, so two offers never cross.
  private async connect(peerId: string): Promise<void> {
    if (this.myId > peerId) {
      await this.signal(peerId, "here");
      return;
    }
    const linkId = crypto.randomUUID();
    const connection = this.createPeer(peerId, linkId);
    const transceiver = connection.addTransceiver("audio", { direction: "sendrecv" });
    await transceiver.sender.replaceTrack(this.microphone);
    await connection.setLocalDescription(await connection.createOffer());
    await this.signal(peerId, "offer", linkId, await this.gatheredDescription(connection));
  }

  private async answer(
    peerId: string,
    linkId: string,
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    this.disconnect(peerId);
    const connection = this.createPeer(peerId, linkId);
    await connection.setRemoteDescription(offer);
    const transceiver = connection.getTransceivers()[0];
    transceiver.direction = "sendrecv";
    await transceiver.sender.replaceTrack(this.microphone);
    await connection.setLocalDescription(await connection.createAnswer());
    await this.signal(peerId, "answer", linkId, await this.gatheredDescription(connection));
  }

  private createPeer(peerId: string, linkId: string): RTCPeerConnection {
    const connection = new RTCPeerConnection({
      // Tabs in one browser reach each other directly; only online rooms need STUN or TURN.
      iceServers: this.provider.kind === "online" ? ONLINE_ICE_SERVERS : [],
    });
    // Playing through an audio element lets the browser's echo cancellation hear it.
    const speaker = new Audio();
    speaker.autoplay = true;
    const peer: Peer = { connection, linkId, speaker, level: null };
    connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      speaker.srcObject = stream;
      void speaker.play().catch(() => {});
      peer.level?.stop();
      peer.level = this.audio.watchStreamLevel(stream);
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") this.disconnect(peerId);
    };
    this.peers.set(peerId, peer);
    this.applyVolume(peerId);
    return connection;
  }

  private gatheredDescription(connection: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
    return new Promise((resolve) => {
      const finish = () => resolve(connection.localDescription!.toJSON());
      if (connection.iceGatheringState === "complete") return finish();
      const timer = setTimeout(finish, GATHER_TIMEOUT_MS);
      connection.addEventListener("icegatheringstatechange", () => {
        if (connection.iceGatheringState !== "complete") return;
        clearTimeout(timer);
        finish();
      });
    });
  }

  private applyVolume(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    const volume = (this.playerVolumes.get(peerId) ?? 1) * this.roundVolume;
    peer.speaker.volume = volume;
    // iPhones ignore volume changes, so silence also mutes.
    peer.speaker.muted = volume === 0;
  }

  private disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.connection.close();
    peer.speaker.srcObject = null;
    peer.level?.stop();
    this.peers.delete(peerId);
  }

  private async signal(
    to: string,
    kind: VoiceSignal["kind"],
    linkId = "",
    description?: RTCSessionDescriptionInit,
  ): Promise<void> {
    if (this.closed) return;
    await this.provider
      .sendVoice({ from: this.myId, to, kind, linkId, description })
      .catch(() => {});
  }
}
