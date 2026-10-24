"use client";
import VoiceShape, { type ShapeTimeline } from "./VoiceShape";

import { useEffect, useReducer, useRef, useState } from "react";
import { AudioManager } from "../core/AudioManager";
import { Game } from "../game/Game";
import {
  BRAND,
  CHARACTER_LOOKS,
  PACKS,
  PLAYABLE_PACKS,
  PROMPTS,
  findPrompt,
  randomFunnyName,
  randomLookIndex,
  shuffledLookIndexes,
} from "../game/prompts";
import {
  canStart,
  DEFAULT_ROUNDS,
  isSoloRoom,
  RECORDING_LEAD_IN_SECONDS,
  ROUND_CHOICES,
  singingWindowSeconds,
  voiceChatVolume,
} from "../game/rules";
import type { AudioScore, Category, Player, RoomState } from "../game/types";
import type { StageActor } from "../world/Character";
import {
  onlineConfigured,
  SupabaseProvider,
} from "../network/SupabaseProvider";
import { SoloProvider } from "../network/SoloProvider";
import { TabProvider } from "../network/TabProvider";
import { VoiceChat } from "../network/VoiceChat";
import StageView, { MicIcon, MicOffIcon, type StageScene } from "./StageView";
import VoiceMixer, { SpeakerIcon } from "./VoiceMixer";
import CustomClips from "./CustomClips";
import ReactionBar from "./ReactionBar";
import LyricsTrack from "./LyricsTrack";
import MicCheck from "./MicCheck";

// Nameless extras: the home page's crowd, and the crowd that cheers a solo player.
function crowdActors(ids: string[], looks: number[]): StageActor[] {
  return ids.map((id, index) => ({ id, name: "", look: looks[index], isYou: false }));
}
type Dialog =
  | "rules"
  | "packs"
  | "settings"
  | "setup"
  | "ready-check"
  | "mic-check"
  | "voices"
  | null;

// A player counts as speaking above this voice level.
const SPEAKING_LEVEL = 0.08;

export default function Party() {
  const [audio] = useState(() => new AudioManager());
  const [game, setGame] = useState<Game | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [voiceChat, setVoiceChat] = useState<VoiceChat | null>(null);
  const voiceChatRef = useRef<VoiceChat | null>(null);
  const [isChatMicOn, setIsChatMicOn] = useState(true);
  const [voiceVolumes, setVoiceVolumes] = useState<Record<string, number>>({});
  const [, render] = useReducer((count) => count + 1, 0);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(0);
  const [joinCode, setJoinCode] = useState("");
  // Opened from an invitation link: joining comes first and the join button leads.
  const [isInvited, setIsInvited] = useState(false);
  const [mode, setMode] = useState<"online" | "tabs">("online");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [volume, setVolume] = useState(0.7);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [isMicConfirmed, setIsMicConfirmed] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [selectedPack, setSelectedPack] = useState<Category>("mixed");
  // The crowd is drawn at random, so the stage looks different on every visit.
  const [crowdLooks] = useState(shuffledLookIndexes);

  useEffect(() => {
    // A returning player keeps their name; a new one starts as a funny movie character.
    setName(localStorage.getItem("chiri-name") || randomFunnyName());
    setAvatar(randomLookIndex());
    const params = new URLSearchParams(location.search);
    setJoinCode(params.get("room")?.toUpperCase() ?? "");
    setIsInvited(Boolean(params.get("room")));
    if (params.get("mode") === "tabs") setMode("tabs");
    setReducedMotion(matchMedia("(prefers-reduced-motion: reduce)").matches);
    return () => {
      voiceChatRef.current?.close();
      void gameRef.current?.close();
      audio.dispose();
    };
  }, [audio]);

  useEffect(() => game?.subscribe(render), [game]);
  useEffect(() => {
    const timer = setInterval(() => setMicLevel(audio.readLevel()), 100);
    return () => clearInterval(timer);
  }, [audio]);

  const room = game?.state;
  const me = room?.players.find((player) => player.id === game?.playerId);
  const isSolo = room ? isSoloRoom(room) : false;
  const host = room?.players.find((player) => player.id === room.hostId);
  const prompt = room?.round ? findPrompt(room.deck[room.round - 1], room.customClips) : null;
  const connectedPlayers =
    room?.players.filter((player) => player.connected) ?? [];
  const remaining =
    room && game
      ? Math.max(0, Math.ceil((room.deadline - game.now) / 1000))
      : 0;
  const countdown =
    room && game ? Math.ceil((room.recordAt - game.now) / 1000) : 0;
  const isRecordingLive = room?.phase === "RECORDING" && countdown <= 0;
  const gameClock = () => game?.now ?? Date.now();
  const isInMatch = Boolean(
    room && room.phase !== "LOBBY" && room.phase !== "FINISHED",
  );
  const currentTake =
    room?.phase === "PLAYBACK" ? room.submissions[room.playbackIndex] : undefined;
  const currentPerformer = room?.players.find(
    (player) => player.id === currentTake?.playerId,
  );
  const now = game?.now ?? 0;
  const isPerforming = Boolean(room && currentTake && now >= room.playbackStartAt);
  const isScoreRevealed = Boolean(
    room &&
      currentTake &&
      now >= room.playbackStartAt + currentTake.duration * 1000,
  );
  const isTakePlaying = isPerforming && !isScoreRevealed;
  const chatRoundVolume = room ? voiceChatVolume(room.phase, isTakePlaying) : 1;
  const isChatMicSwitchedOn = micReady && isChatMicOn;
  // Everyone's chat mic closes while they record, so no voices end up in the takes.
  const isChatMicOpen = isChatMicSwitchedOn && room?.phase !== "RECORDING";
  const roomPlayerIds = room?.players.map((player) => player.id).join(",") ?? "";

  useEffect(() => {
    voiceChat?.setRoundVolume(chatRoundVolume);
  }, [voiceChat, chatRoundVolume]);
  useEffect(() => {
    voiceChat?.setMicrophoneOpen(isChatMicOpen);
  }, [voiceChat, isChatMicOpen]);
  useEffect(() => {
    voiceChat?.keepOnly(roomPlayerIds.split(","));
  }, [voiceChat, roomPlayerIds]);

  function chatLevel(playerId: string): number {
    if (playerId === game?.playerId) return isChatMicOpen ? micLevel : 0;
    return voiceChat?.level(playerId) ?? 0;
  }
  const currentPack = PACKS.find((pack) => pack.id === prompt?.category);
  const isCountingIn = room?.phase === "RECORDING" && countdown > 0;
  // The recorder starts after 3-2-1; the lyrics and the clock start after a short lead-in.
  const singAt = room ? room.recordAt + RECORDING_LEAD_IN_SECONDS * 1000 : 0;
  const isLeadIn = isRecordingLive && now < singAt;
  const singElapsed = Math.max(0, (now - singAt) / 1000);
  const singSeconds = room ? Math.round((room.recordSeconds - RECORDING_LEAD_IN_SECONDS) * 10) / 10 : 0;
  const promptHintText = room ? promptHint(room) : "";
  const shapeTimeline: ShapeTimeline | null =
    room?.phase === "LISTENING" && game?.referenceStartedAt && prompt
      ? { startAt: game.referenceStartedAt, durationSeconds: prompt.duration }
      : isRecordingLive && prompt
        ? { startAt: singAt, durationSeconds: prompt.duration }
        : null;

  // The crowd never wears a character someone is playing.
  function crowdLooksWithout(playerLooks: number[]): number[] {
    return crowdLooks.filter((look) => !playerLooks.includes(look));
  }

  const homeScene: StageScene = {
    actors: [
      ...crowdActors(["home-left", "home-right"], crowdLooksWithout([avatar])),
      { id: "home-performer", name: "", look: avatar, isYou: false },
    ],
    performerId: "home-performer",
    talkingId: micReady ? "home-performer" : "",
    levelSource: "mic",
    chorus: false,
    events: [],
    clock: Date.now,
    isRound: false,
    focusId: "",
    shot: "wide",
    performanceKey: "",
    finishedId: "",
    celebrationId: "",
    voiceLevel: () => 0,
    showWallLogo: false,
  };
  const roomScene: StageScene = {
    actors: [
      ...connectedPlayers.map((player) => ({
        id: player.id,
        name: player.name,
        look: player.avatar,
        isYou: player.id === game?.playerId,
      })),
      // Playing solo, a small crowd watches and cheers, so the stage never feels empty.
      ...(isSolo
        ? crowdActors(
            ["crowd-left", "crowd-right", "crowd-back"],
            crowdLooksWithout(connectedPlayers.map((player) => player.avatar)),
          )
        : []),
    ],
    // While recording, your own character steps up to the mic on your screen during the count-in.
    performerId:
      room?.phase === "PLAYBACK"
        ? (currentTake?.playerId ?? "")
        : room?.phase === "RECORDING"
          ? (game?.playerId ?? "")
          : room?.phase === "SCORING"
            ? roundWinnerId(room)
            : "",
    // A performer only sings while their take plays: not on the walk up, not during the score reveal.
    talkingId:
      room?.phase === "PLAYBACK"
        ? isPerforming && !isScoreRevealed
          ? (currentTake?.playerId ?? "")
          : ""
        : isRecordingLive
          ? (game?.playerId ?? "")
          : "",
    levelSource: room?.phase === "PLAYBACK" ? "playback" : "mic",
    chorus: isRecordingLive,
    events: room?.stageEvents ?? [],
    clock: () => game?.now ?? Date.now(),
    isRound: isInMatch,
    showWallLogo: true,
    // Only your own recording gets the close-up; performances play back on the wide stage.
    focusId: room?.phase === "RECORDING" ? (game?.playerId ?? "") : "",
    shot: room?.phase === "RECORDING" ? "portrait" : "wide",
    performanceKey:
      room?.phase === "PLAYBACK" && currentTake
        ? `${room.roundId}:${room.playbackIndex}`
        : room?.phase === "RECORDING"
          ? `${room.roundId}:${game?.playerId}`
          : "",
    finishedId: isScoreRevealed ? (currentTake?.playerId ?? "") : "",
    celebrationId: room?.phase === "SCORING" ? roundWinnerId(room) : "",
    voiceLevel: chatLevel,
  };

  async function connect(entry: "create" | "join" | "solo") {
    const join = entry === "join";
    setError("");
    if (!name.trim()) {
      setError(
        entry === "solo"
          ? "First, tell us what to call you."
          : "First, tell your friends what to call you.",
      );
      document.getElementById("player-name")?.focus();
      return;
    }
    if (join && !/^[A-Z2-9]{8}$/.test(joinCode.trim())) {
      setError("Enter the 8-character invitation code.");
      return;
    }
    // Solo play stays on this device, so it works without the online setup.
    if (entry !== "solo" && mode === "online" && !onlineConfigured) {
      setDialog("setup");
      return;
    }
    setBusy(true);
    const nextGame = new Game(
      entry === "solo"
        ? new SoloProvider()
        : mode === "tabs"
          ? new TabProvider()
          : new SupabaseProvider(),
      audio,
    );
    try {
      await audio.unlock();
      localStorage.setItem("chiri-name", name.trim());
      await nextGame.open(join ? joinCode.trim() : null, name.trim(), avatar);
      gameRef.current = nextGame;
      setGame(nextGame);
      if (entry !== "solo") {
        const nextVoiceChat = new VoiceChat(nextGame.provider, audio);
        nextVoiceChat.useMicrophone(audio.microphoneTrack());
        nextVoiceChat.start();
        voiceChatRef.current = nextVoiceChat;
        setVoiceChat(nextVoiceChat);
      }
      if (selectedPack !== "mixed" && !join)
        await nextGame.command({
          type: "settings",
          category: selectedPack,
          rounds: nextGame.state!.settings.rounds,
        });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Could not connect.",
      );
      await nextGame.close();
    } finally {
      setBusy(false);
    }
  }

  async function enableMic() {
    try {
      setError("");
      await audio.enableMicrophone(deviceId || undefined);
      voiceChatRef.current?.useMicrophone(audio.microphoneTrack());
      setMicReady(true);
      setDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === "audioinput",
        ),
      );
      return true;
    } catch (failure) {
      setMicReady(false);
      setError(
        failure instanceof DOMException && failure.name === "NotAllowedError"
          ? "Microphone access was denied. Allow it in your browser’s site settings, then try again."
          : failure instanceof Error
            ? failure.message
            : "Microphone unavailable.",
      );
      return false;
    }
  }

  async function readyUp() {
    if (!game || !me) return;
    if (me.ready) {
      await game.command({ type: "ready", ready: false });
      return;
    }
    // The first ready-up of a visit asks once whether the mic works; the mic test is optional.
    if (!isMicConfirmed) {
      void audio.unlock();
      setDialog("ready-check");
      return;
    }
    await confirmReady();
  }

  async function confirmReady() {
    setDialog(null);
    if (!(await enableMic())) return;
    await audio.unlock();
    setIsMicConfirmed(true);
    await readyAndStartWhenSolo();
  }

  async function passMicCheck() {
    setIsMicConfirmed(true);
    await readyAndStartWhenSolo();
  }

  // Alone there is nobody to wait for, so readying up starts the match.
  async function readyAndStartWhenSolo() {
    await game?.command({ type: "ready", ready: true });
    if (isSolo) await game?.command({ type: "start" });
  }

  async function toggleChatMic() {
    if (!micReady) {
      if (await enableMic()) setIsChatMicOn(true);
      return;
    }
    setIsChatMicOn(!isChatMicOn);
  }

  function changeVoiceVolume(playerId: string, volume: number) {
    setVoiceVolumes((current) => ({ ...current, [playerId]: volume }));
    voiceChat?.setPlayerVolume(playerId, volume);
  }

  async function leave() {
    voiceChat?.close();
    voiceChatRef.current = null;
    setVoiceChat(null);
    await game?.close();
    gameRef.current = null;
    setGame(null);
    setError("");
  }

  async function copyInvite() {
    if (!room) return;
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("room", room.code);
    if (mode === "tabs") url.searchParams.set("mode", "tabs");
    try {
      await navigator.clipboard.writeText(url.href);
      setToast("Invitation link copied. Send it to your friends.");
    } catch {
      setToast(`Room code: ${room.code}`);
    }
  }

  function changeSettings(
    category: Category,
    rounds = room?.settings.rounds ?? DEFAULT_ROUNDS,
  ) {
    setSelectedPack(category);
    if (game) void game.command({ type: "settings", category, rounds });
  }

  function closeDialog() {
    audio.stopPlayback();
    if (dialog === "mic-check") audio.cancelRecording();
    setDialog(null);
    setError("");
  }

  const showError = error || game?.error;

  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            if (room) void leave();
          }}
          aria-label={`${BRAND.name} home`}
        >
          <SmileMark />
          <span>
            {BRAND.name}
            <small>{BRAND.malayalam}</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <button onClick={() => setDialog("rules")}>How to play</button>
          <button onClick={() => setDialog("packs")}>Sound library</button>
        </nav>
        <button
          className="settings-button"
          onClick={() => setDialog("settings")}
          aria-label="Audio and display settings"
        >
          <SettingsIcon />
        </button>
      </header>

      <main
        className={
          isInMatch ? "match-view" : !room && isInvited ? "invited" : undefined
        }
      >
        {!room ? (
          <>
            <section className="home-stage" aria-labelledby="home-title">
              <div className="home-copy">
                <div className="open-mic">
                  <span className="status-dot" />
                  The mic is yours.
                </div>
                <h1 id="home-title">
                  നിന്റെ ശബ്ദം.
                  <br />
                  കൂട്ടുകാരുടെ ചിരി.
                </h1>
                <p className="english-title">
                  Good friends. Terrible impressions.
                </p>
                <p className="intro">
                  A Malayalam voice party for your loudest friends. Hear a
                  sound, give it your best shot, and let the chaos begin.
                </p>
                <div className="game-facts">
                  <span>2–8 friends</span>
                  <span>One take each</span>
                  <span>Any modern browser</span>
                </div>
              </div>
              <div className="scene-wrap">
                <StageView
                  audio={audio}
                  scene={homeScene}
                  reducedMotion={reducedMotion}
                />
                <div className="scene-caption">
                  <span>Made for a little നാടൻ chaos.</span>
                  <span>Volume: questionable.</span>
                </div>
              </div>
            </section>

            <section className="room-entry" aria-labelledby="entry-title">
              <div className="entry-heading">
                <h2 id="entry-title">
                  {isInvited
                    ? `You’re invited to room ${joinCode}`
                    : "Get the gang together."}
                </h2>
                <p>
                  {isInvited
                    ? "Pick a name and a face, then join the party."
                    : "No downloads. No awkward icebreakers."}
                </p>
              </div>
              <div className="entry-form">
                <div className="identity-fields">
                  <label htmlFor="player-name">What should we call you?</label>
                  <div className="name-row">
                    <input
                      id="player-name"
                      maxLength={24}
                      placeholder="Your party name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="nickname"
                    />
                    <button
                      className="dice-button"
                      aria-label="Another funny name"
                      title="Another funny name"
                      onClick={() => setName(randomFunnyName(name))}
                    >
                      🎲
                    </button>
                  </div>
                  <div className="face-picker" role="group" aria-label="Your character">
                    <Avatar index={avatar} />
                    <p>
                      <strong>Your character</strong>
                      <small>
                        {avatar + 1} of {CHARACTER_LOOKS.length}
                      </small>
                    </p>
                    <button
                      className="dice-button"
                      aria-label="Previous character"
                      onClick={() =>
                        setAvatar((avatar + CHARACTER_LOOKS.length - 1) % CHARACTER_LOOKS.length)
                      }
                    >
                      ‹
                    </button>
                    <button
                      className="dice-button"
                      aria-label="Random character"
                      title="Random character"
                      onClick={() => setAvatar(randomLookIndex(avatar))}
                    >
                      🎲
                    </button>
                    <button
                      className="dice-button"
                      aria-label="Next character"
                      onClick={() => setAvatar((avatar + 1) % CHARACTER_LOOKS.length)}
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="room-actions">
                  <button
                    className={isInvited ? "secondary" : "primary"}
                    disabled={busy}
                    onClick={() => void connect("create")}
                  >
                    {busy ? "Connecting…" : "Create a party"} <span>↗</span>
                  </button>
                  <div className="join-row">
                    <label className="sr-only" htmlFor="room-code">
                      8-character room code
                    </label>
                    <input
                      id="room-code"
                      placeholder="Room code"
                      maxLength={8}
                      value={joinCode}
                      onChange={(event) =>
                        setJoinCode(event.target.value.toUpperCase())
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void connect("join");
                      }}
                      autoCapitalize="characters"
                    />
                    <button
                      className={isInvited ? "primary" : "secondary"}
                      disabled={busy}
                      onClick={() => void connect("join")}
                    >
                      Join party
                    </button>
                  </div>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void connect("solo")}
                  >
                    <MicIcon /> Play solo · just you and the mic
                  </button>
                  <p className="mode-label">
                    {mode === "online"
                      ? "Private online rooms · Powered by Supabase"
                      : "Tab test · Same browser profile only"}
                  </p>
                </div>
              </div>
              <div className="connection-choice">
                <label htmlFor="connection-mode">Room connection</label>
                <select
                  id="connection-mode"
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as "online" | "tabs")
                  }
                >
                  <option value="online">Online · separate devices</option>
                  <option value="tabs">
                    Local tab test · this browser only
                  </option>
                </select>
                {!onlineConfigured && (
                  <button onClick={() => setDialog("setup")}>
                    Online setup required ↗
                  </button>
                )}
              </div>
            </section>
            <section className="pack-preview" aria-labelledby="packs-title">
              <div className="section-heading">
                <h2 id="packs-title">Pick your kind of chaos.</h2>
                <button
                  className="text-action"
                  onClick={() => setDialog("packs")}
                >
                  Explore {PROMPTS.length} sounds ↗
                </button>
              </div>
              <PackPicker selected={selectedPack} onSelect={changeSettings} />
            </section>
          </>
        ) : (
          <>
            <div className="room-heading">
              <div>
                <p className="muted">
                  {isSolo
                    ? "Solo · just you and the mic"
                    : mode === "tabs"
                      ? "Local tab test · same browser only"
                      : "Private online party"}
                </p>
                <h1>
                  {room.phase === "LOBBY"
                    ? isSolo
                      ? "ഒറ്റയ്ക്ക് ഒരു കൈ നോക്കാം!"
                      : "കൂട്ടുകാർ റെഡിയാണോ?"
                    : room.phase === "FINISHED"
                      ? "ചിരിയുടെ ചാമ്പ്യൻ!"
                      : `Round ${room.round} of ${room.settings.rounds}`}
                </h1>
              </div>
              <div className="invite-actions">
                {/* Solo rooms have no invitation and no voice chat. */}
                {!isSolo && (
                  <>
                    <button
                      className="room-code"
                      onClick={() => void copyInvite()}
                      title="Copy invitation"
                    >
                      {room.code} <CopyIcon />
                    </button>
                    <button
                      className={`voice-button ${isChatMicSwitchedOn ? "on" : ""} ${
                        isChatMicSwitchedOn && !isChatMicOpen ? "paused" : ""
                      }`}
                      aria-pressed={isChatMicSwitchedOn}
                      aria-label={isChatMicSwitchedOn ? "Mute my mic" : "Unmute my mic"}
                      title={
                        !isChatMicSwitchedOn
                          ? "Voice chat: your mic is muted"
                          : isChatMicOpen
                            ? "Voice chat: your mic is on"
                            : "Voice chat pauses while everyone records"
                      }
                      onClick={() => void toggleChatMic()}
                    >
                      {isChatMicSwitchedOn ? <MicIcon /> : <MicOffIcon />}
                    </button>
                    <button
                      className="voice-button"
                      aria-label="Voice chat volumes"
                      title="Voice chat volumes"
                      onClick={() => setDialog("voices")}
                    >
                      <SpeakerIcon />
                    </button>
                  </>
                )}
                <button
                  className="secondary compact"
                  onClick={() => void leave()}
                >
                  Leave
                </button>
              </div>
            </div>
            {!game.connected && (
              <div className="alert">
                Connection interrupted. Reconnecting; your room may need to
                restart.
              </div>
            )}
            {room.notice && (
              <p className="notice" role="status">
                {room.notice}
              </p>
            )}
            <div className="game-layout">
              <aside className="players-panel">
                <div className="section-heading">
                  <h2>The gang</h2>
                  <span>
                    {connectedPlayers.length}/{room.settings.maxPlayers}
                  </span>
                </div>
                <ul className="player-list">
                  {room.players.map((player) => (
                    <li
                      key={player.id}
                      className={`${!player.connected ? "disconnected" : ""} ${
                        chatLevel(player.id) > SPEAKING_LEVEL ? "speaking" : ""
                      }`}
                    >
                      <Avatar index={player.avatar} />
                      <div>
                        <strong>
                          {player.name}
                          {player.id === game.playerId ? " (you)" : ""}
                        </strong>
                        <small>
                          {player.id === room.hostId ? "Host · " : ""}
                          {!player.connected
                            ? "Disconnected"
                            : room.phase === "LOBBY"
                              ? player.ready
                                ? "Ready to make noise"
                                : "Getting ready"
                              : room.submissions.some(
                                    (submission) =>
                                      submission.playerId === player.id,
                                  )
                                ? "Take submitted"
                                : "In the party"}
                        </small>
                      </div>
                      <span className="player-score">
                        {room.phase === "LOBBY"
                          ? player.ready
                            ? "Ready"
                            : "—"
                          : player.total}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  className="secondary"
                  onClick={() => setDialog("settings")}
                >
                  <MicIcon />
                  {micReady ? "Microphone connected" : "Test your microphone"}
                </button>
                <p className="privacy-note">
                  {isSolo
                    ? "Solo takes stay on this device and are gone when you leave."
                    : "Your gang can hear your takes. Online clips expire after 24 hours when retention is configured."}
                </p>
              </aside>
              <section className="game-panel" aria-label="Party stage">
                {room.phase === "LOBBY" ? (
                  <>
                    <div className="lobby-scene">
                      <StageView
                        audio={audio}
                        scene={roomScene}
                        reducedMotion={reducedMotion}
                      />
                    </div>
                    <div className="lobby-content">
                      <h2>
                        {isSolo ? "Just you and the mic." : "One mic. Many questionable talents."}
                      </h2>
                      <p>
                        {isSolo
                          ? "Pick a pack and how many rounds, then start. Your takes stay on this device."
                          : game.isHost
                            ? "Pick a pack, invite your friends, and get everyone ready."
                            : `${host?.name ?? "Your host"} is putting the party together.`}
                      </p>
                      <div className="match-options">
                        <label>
                          Rounds
                          <select
                            aria-label="Rounds"
                            value={room.settings.rounds}
                            disabled={!game.isHost}
                            onChange={(event) =>
                              changeSettings(
                                room.settings.category,
                                Number(event.target.value),
                              )
                            }
                          >
                            {ROUND_CHOICES.map((rounds) => (
                              <option key={rounds}>{rounds}</option>
                            ))}
                          </select>
                        </label>
                        <p className="window-note">
                          Recording length
                          <strong>Matches each clip</strong>
                        </p>
                      </div>
                      {room.settings.category === "custom" && (
                        <CustomClips
                          game={game}
                          room={room}
                          audio={audio}
                          onError={setError}
                        />
                      )}
                      <div className="lobby-buttons">
                        {isSolo ? (
                          <button
                            className="primary"
                            disabled={room.settings.category === "custom" && room.customClips.length === 0}
                            onClick={() => void readyUp()}
                          >
                            Start ↗
                          </button>
                        ) : (
                          <button
                            className={me?.ready ? "secondary" : "primary"}
                            onClick={() => void readyUp()}
                          >
                            {me?.ready
                              ? "Ready · Change my mind"
                              : "Ready up"}
                          </button>
                        )}
                        {game.isHost && !isSolo && (
                          <button
                            className="primary"
                            disabled={!canStart(room)}
                            onClick={() => void game.command({ type: "start" })}
                          >
                            Start the chaos ↗
                          </button>
                        )}
                      </div>
                      {!canStart(room) && !isSolo && (
                        <p className="muted">
                          {connectedPlayers.length < 2
                            ? "Invite at least one friend to start."
                            : room.settings.category === "custom" &&
                                room.customClips.length === 0
                              ? "Add at least one clip to play “Your clips”."
                              : "Everyone needs to ready up before the host starts."}
                        </p>
                      )}
                      <p className="reaction-hint">
                        Warm up the crowd while you wait:
                      </p>
                      <ReactionBar game={game} room={room} />
                      </div>
                  </>
                ) : room.phase === "FINISHED" ? (
                  <Results
                    room={room}
                    game={game}
                    onShare={async () => {
                      const winner = [...room.players].sort(
                        (first, second) => second.total - first.total,
                      )[0];
                      const summary = `${winner.name} won ${BRAND.name} with ${winner.total} points after ${room.settings.rounds} rounds!`;
                      try {
                        await navigator.clipboard.writeText(summary);
                        setToast("Results copied. Brag responsibly.");
                      } catch {
                        setToast(summary);
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="stage-area">
                      <div className="round-theatre">
                        <StageView
                          audio={audio}
                          scene={roomScene}
                          reducedMotion={reducedMotion}
                        />
                      </div>
                      <div className="phase-heading">
                        <span className="phase-label">
                          <span
                            className={`status-dot ${room.phase === "RECORDING" && countdown <= 0 ? "recording-dot" : ""}`}
                          />
                          {phaseLabel(room.phase, countdown)}
                        </span>
                        <span className="countdown-small">{remaining}s</span>
                      </div>
                      {room.phase === "SCORING" ? (
                        <RoundScores room={room} />
                      ) : room.phase === "PLAYBACK" ? (
                        <div className="playback-screen">
                          <div className="performer-line">
                            <strong>{currentPerformer?.name ?? "No takes this round"}</strong>
                            {currentTake && (
                              <span>
                                {room.playbackIndex + 1} of {room.submissions.length}
                              </span>
                            )}
                            {/* Only other players' laughs and tomatoes count, so solo has none. */}
                            {currentTake && !isSolo && (
                              <span className="crowd-count" aria-live="polite">
                                😂 {currentTake.reactionCount} · 🍅 {currentTake.tomatoes}
                              </span>
                            )}
                            {currentTake && isScoreRevealed && (
                              <ScoreBadge score={currentTake.score} />
                            )}
                          </div>
                          <p className="performance-status sr-only" role="status">
                            {!currentTake
                              ? "Nobody made it to the mic."
                              : !isPerforming
                                ? "Walking up to the mic…"
                                : !isScoreRevealed
                                  ? "Performing · one take, no regrets"
                                  : "And the score is…"}
                          </p>
                          {audio.isLocked && (
                            <button className="audio-unlock" onClick={() => void audio.unlock()}>
                              🔈 Tap to hear the performances
                            </button>
                          )}
                          {prompt && currentTake && isPerforming && !isScoreRevealed && (
                            <LyricsTrack
                              cue={prompt.cue}
                              shape={audio.referenceShape}
                              durationSeconds={prompt.duration}
                              startAt={room.playbackStartAt}
                              clock={gameClock}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="prompt-screen">
                          {prompt && (
                            <p className="clip-line">
                              <span aria-hidden="true">{currentPack?.symbol}</span>
                              <strong>{prompt.title}</strong>
                              <span>
                                {singingWindowSeconds(prompt.duration)}s
                                {prompt.referenceKind === "custom" ? " · host’s private clip" : ""}
                              </span>
                            </p>
                          )}
                          {!isRecordingLive && <p className="prompt-hint">{promptHintText}</p>}
                          {(isCountingIn || isLeadIn) && (
                            <strong key={isLeadIn ? "go" : countdown} className="count-in">
                              {isLeadIn ? "Go!" : countdown}
                            </strong>
                          )}
                          {prompt &&
                            (room.phase === "LISTENING" ||
                              room.phase === "RECORDING") && (
                              <LyricsTrack
                                cue={prompt.cue}
                                shape={audio.referenceShape}
                                durationSeconds={prompt.duration}
                                startAt={
                                  room.phase === "LISTENING"
                                    ? game.referenceStartedAt || null
                                    : isRecordingLive
                                      ? singAt
                                      : null
                                }
                                clock={gameClock}
                              />
                            )}
                          {isRecordingLive && (
                            <div className="recording-panel">
                              <span className="rec-pill">
                                <MicIcon /> REC
                              </span>
                              <div
                                className="record-progress"
                                role="progressbar"
                                aria-label="Recording time"
                                aria-valuemin={0}
                                aria-valuemax={singSeconds}
                                aria-valuenow={Math.min(singSeconds, singElapsed)}
                              >
                                <span
                                  style={{
                                    width: `${Math.min(100, (singElapsed / singSeconds) * 100)}%`,
                                  }}
                                />
                              </div>
                              <span className="record-time">
                                {Math.min(singSeconds, singElapsed).toFixed(1)}s
                                {" / "}
                                {singSeconds}s
                              </span>
                              <div
                                className="audio-meter"
                                aria-label="Microphone activity"
                              >
                                <span
                                  style={{ width: `${Math.max(2, micLevel * 100)}%` }}
                                />
                              </div>
                            </div>
                          )}
                          {!isRecordingLive && (
                            <p role="status" className="take-status">
                              {game.submissionStatus}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="round-controls">
                      <VoiceShape
                        audio={audio}
                        timeline={shapeTimeline}
                        clock={gameClock}
                        isRecording={isRecordingLive}
                      />
                      <ReactionBar game={game} room={room} />
                      <div className="phase-progress">
                        <span
                          style={{
                            width: `${Math.min(100, (room.round / room.settings.rounds) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
            {room.phase === "LOBBY" && (
              <section className="pack-preview">
                <div className="section-heading">
                  <h2>The party playlist</h2>
                  <span className="muted">
                    {game.isHost ? "Host picks the pack" : "Chosen by the host"}
                  </span>
                </div>
                <PackPicker
                  selected={room.settings.category}
                  disabled={!game.isHost}
                  onSelect={changeSettings}
                />
              </section>
            )}
          </>
        )}
        {showError && (
          <div className="alert" role="alert">
            {showError}
            <button
              aria-label="Dismiss error"
              onClick={() => {
                setError("");
                if (game) {
                  game.error = "";
                  render();
                }
              }}
            >
              ×
            </button>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            {toast}
            <button
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              ×
            </button>
          </div>
        )}
      </main>

      <footer>
        <span>
          {BRAND.malayalam}{" "}
          <span className="muted">· A little noise brings us together.</span>
        </span>
        <button onClick={() => setDialog("rules")}>
          Rules, scoring & privacy ↗
        </button>
      </footer>

      {dialog && (
        <DialogShell
          title={
            dialog === "rules"
              ? "The rules are simple."
              : dialog === "packs"
                ? "Pick a sound. Make it yours."
                : dialog === "setup"
                  ? "Connect your online party."
                  : dialog === "mic-check"
                    ? "Mic check"
                    : dialog === "ready-check"
                      ? "Ready?"
                      : dialog === "voices"
                        ? "Voice chat"
                        : "Make yourself heard."
          }
          close={closeDialog}
        >
          {dialog === "voices" && room && game && (
            <VoiceMixer
              players={room.players}
              myId={game.playerId}
              volumes={voiceVolumes}
              isMicOn={isChatMicSwitchedOn}
              isSpeaking={(playerId) => chatLevel(playerId) > SPEAKING_LEVEL}
              isLinked={(playerId) => voiceChat?.isConnected(playerId) ?? false}
              onToggleMic={() => void toggleChatMic()}
              onVolumeChange={changeVoiceVolume}
            />
          )}
          {dialog === "ready-check" && (
            <div className="ready-check">
              <p>Is your mic working? Everyone records at the same time each round.</p>
              <div className="lobby-buttons">
                <button className="primary" onClick={() => void confirmReady()}>
                  Yes, I’m ready
                </button>
                <button className="secondary" onClick={() => setDialog("mic-check")}>
                  Test my mic
                </button>
              </div>
            </div>
          )}
          {dialog === "mic-check" && (
            <MicCheck
              audio={audio}
              micLevel={micLevel}
              enableMic={enableMic}
              deviceId={deviceId}
              onDeviceChange={setDeviceId}
              onPassed={() => void passMicCheck()}
              onClose={closeDialog}
            />
          )}
          {dialog === "rules" && (
            <div className="rules-content">
              <ol>
                <li>
                  <strong>Get the gang in.</strong> Create a private room and
                  share the invitation. Everyone joins on their own device and
                  readies up.
                </li>
                <li>
                  <strong>Listen. Then imitate.</strong> Hear the reference
                  once while its lyrics light up. After the 3-2-1 countdown,
                  everyone records at the same time, following the lyrics. Your
                  take is as long as the clip. One take per person.
                </li>
                <li>
                  <strong>Enjoy the damage.</strong> One by one, each player
                  walks up to the mic and their take plays for everyone. Their
                  score appears right after. Cheer with emotes, dance, or throw
                  a tomato at a performance you didn’t love. Tomatoes are just
                  for fun and never change scores.
                </li>
              </ol>
              <h3>A score with some humility.</h3>
              <p>
                Scores compare measurable sound shape: timing, envelope,
                relative pitch, onsets and texture. They do not understand
                Malayalam words, judge accents, or know what is funny. Quiet or
                invalid takes get no score. Local scoring and host coordination
                are a prototype compromise; modified clients can cheat.
              </p>
              <h3>Your voice, your gang.</h3>
              <p>
                Online takes are uploaded to a private room bucket and can be
                heard by members of that room. Rooms expire after 24 hours; the
                project owner must enable the documented cleanup job to
                physically delete clips. Tab-test clips stay in this browser’s
                IndexedDB until cleared. The mic check records nothing; it only
                measures how loud your voice is.
              </p>
              <button
                className="secondary"
                onClick={() => {
                  indexedDB.deleteDatabase("chiri-tab-audio");
                  setToast("Local test recordings cleared.");
                }}
              >
                Clear local test recordings
              </button>
            </div>
          )}
          {dialog === "packs" && (
            <div className="sound-library">
              {PLAYABLE_PACKS.filter(
                (pack) => pack.id !== "mixed" && pack.id !== "custom",
              ).map((pack) => (
                <section key={pack.id}>
                  <h3>
                    {pack.symbol} {pack.name}{" "}
                    <span className="muted">
                      · {pack.malayalam} ·{" "}
                      {
                        PROMPTS.filter((prompt) => prompt.category === pack.id)
                          .length
                      }{" "}
                      sounds
                    </span>
                  </h3>
                  {PROMPTS.filter((prompt) => prompt.category === pack.id).map(
                    (sound) => (
                      <div className="sound-row" key={sound.id}>
                        <div>
                          <strong>{sound.title}</strong>
                          <small>
                            “{sound.cue}” · {sound.duration.toFixed(1)}s
                            {sound.difficulty ? ` · ${sound.difficulty}` : ""}
                          </small>
                          <details>
                            <summary>Source & license</summary>
                            <small>{sound.license}</small>
                          </details>
                        </div>
                        <button
                          className="secondary compact"
                          disabled={Boolean(room && room.phase !== "LOBBY")}
                          onClick={() =>
                            void audio
                              .playReference(sound)
                              .catch((failure) => setError(failure.message))
                          }
                          aria-label={`Listen to ${sound.title}`}
                        >
                          Listen ▷
                        </button>
                      </div>
                    ),
                  )}
                </section>
              ))}
              <p className="scoring-note">
                Sounds come from public GitHub meme soundboards and Wikimedia
                Commons, trimmed and normalized for the game. “Source & license”
                on each sound shows where it came from and the licence its
                repository declares. Clips a host adds stay private to their
                room.
              </p>
            </div>
          )}
          {dialog === "setup" && (
            <div className="setup-content">
              <p>
                Separate-device play uses Supabase for private rooms and
                recordings. This build has no custom backend.
              </p>
              <ol>
                <li>
                  Create a Supabase project and enable anonymous sign-ins.
                </li>
                <li>
                  Run <code>supabase/migrations/001_party.sql</code> in its SQL
                  editor.
                </li>
                <li>
                  Disable public Realtime access; the app uses private channels.
                </li>
                <li>
                  Set the project URL and public publishable/anon key in{" "}
                  <code>.env.local</code>, then restart or rebuild.
                </li>
                <li>
                  Configure the 24-hour recording cleanup described in{" "}
                  <code>README.md</code>.
                </li>
              </ol>
              <p>
                Never use a service-role key in the browser. Full instructions
                are included in the project README.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setMode("tabs");
                  closeDialog();
                }}
              >
                Try a same-browser tab room ↗
              </button>
              <p className="scoring-note">
                Tab mode tests the loop locally. It cannot connect another phone
                or browser profile.
              </p>
            </div>
          )}
          {dialog === "settings" && (
            <div className="audio-settings">
              <div className="mic-test">
                <div className="mic-test-icon">
                  <MicIcon />
                </div>
                <div>
                  <h3>
                    {micReady ? "Microphone is connected" : "Let’s hear you."}
                  </h3>
                  <p>
                    Permission is requested only when you enable the microphone.
                  </p>
                </div>
              </div>
              <button className="primary" onClick={() => void enableMic()}>
                {micReady ? "Check microphone again" : "Enable microphone"}
              </button>
              <div
                className="audio-meter"
                aria-label={`Microphone level ${Math.round(micLevel * 100)} percent`}
              >
                <span style={{ width: `${micLevel * 100}%` }} />
              </div>
              {devices.length > 0 && (
                <label>
                  Microphone
                  <select
                    value={deviceId}
                    disabled={Boolean(room && room.phase !== "LOBBY")}
                    onChange={(event) => {
                      setDeviceId(event.target.value);
                      void audio
                        .enableMicrophone(event.target.value)
                        .then(() => voiceChat?.useMicrophone(audio.microphoneTrack()))
                        .catch((failure) => setError(failure.message));
                    }}
                  >
                    <option value="">System default</option>
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || "Microphone"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Playback volume · {Math.round(volume * 100)}%
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(event) => {
                    const nextVolume = Number(event.target.value);
                    setVolume(nextVolume);
                    audio.volume = nextVolume;
                  }}
                />
              </label>
              <label className="toggle-row">
                <span>Reduce stage and wheel motion</span>
                <input
                  type="checkbox"
                  checked={reducedMotion}
                  onChange={(event) => setReducedMotion(event.target.checked)}
                />
              </label>
            </div>
          )}
          {showError && (
            <p className="alert" role="alert">
              {showError}
            </p>
          )}
        </DialogShell>
      )}
    </>
  );
}

function PackPicker({
  selected,
  onSelect,
  disabled = false,
}: {
  selected: Category;
  onSelect: (category: Category) => void;
  disabled?: boolean;
}) {
  return (
    <div className="pack-picker">
      {PLAYABLE_PACKS.map((pack) => (
        <button
          key={pack.id}
          className={`pack-choice ${selected === pack.id ? "selected" : ""}`}
          onClick={() => onSelect(pack.id)}
          disabled={disabled}
          aria-pressed={selected === pack.id}
        >
          <span className="pack-symbol">{pack.symbol}</span>
          <strong>{pack.name}</strong>
          <span lang="ml">{pack.malayalam}</span>
          <small>{pack.description}</small>
          <span className="selection-mark">
            {selected === pack.id ? "Selected" : "Pick pack ↗"}
          </span>
        </button>
      ))}
    </div>
  );
}

// A flat drawing of a character's face for lists and menus, matching the 3D character's look.
function Avatar({ index }: { index: number }) {
  const look = CHARACTER_LOOKS[index % CHARACTER_LOOKS.length];
  const style = look.hairStyle;
  const hasHairTop = style !== "bald" && style !== "mohawk" && style !== "scarf";
  return (
    <svg
      className="avatar"
      viewBox="0 0 48 48"
      role="img"
      aria-label={`Party character ${index + 1}`}
    >
      <rect x="2" y="2" width="44" height="44" rx={index % 2 ? 15 : 22} fill={look.shirt} />
      {/* Hair that falls behind the face. */}
      {style === "scarf" && <rect x="7" y="8" width="34" height="40" rx="16" fill={look.hair} />}
      {style === "long" && <rect x="9" y="14" width="30" height="27" rx="9" fill={look.hair} />}
      {style === "bob" && <rect x="9" y="13" width="30" height="21" rx="8" fill={look.hair} />}
      {style === "ponytail" && <ellipse cx="39" cy="24" rx="4" ry="9" fill={look.hair} />}
      {style === "braid" &&
        [30, 35, 40].map((y) => <circle key={y} cx="37" cy={y} r="3" fill={look.hair} />)}
      {style === "pigtails" &&
        [9, 39].map((x) => <circle key={x} cx={x} cy="22" r="5" fill={look.hair} />)}
      <circle cx="24" cy="27" r="13" fill={look.skin} />
      {hasHairTop && (
        <path d="M11 25 Q11 10 24 10 Q37 10 37 25 Q31 17 24 18 Q17 17 11 25Z" fill={look.hair} />
      )}
      {style === "spiky" && (
        <path d="M13 17 L15 7 L19 14 L23 5 L27 13 L32 6 L34 16Z" fill={look.hair} />
      )}
      {style === "bun" && <circle cx="24" cy="8" r="5" fill={look.hair} />}
      {style === "curly" &&
        [13, 19, 24, 29, 35].map((x) => (
          <circle key={x} cx={x} cy={x === 24 ? 9 : 12} r="5" fill={look.hair} />
        ))}
      {style === "band" && <rect x="11" y="17" width="26" height="3.5" rx="1.5" fill="#d9372b" />}
      {style === "mohawk" && <rect x="21" y="4" width="6" height="13" rx="3" fill={look.hair} />}
      {style === "bald" &&
        [12, 36].map((x) => <circle key={x} cx={x} cy="22" r="3" fill={look.hair} />)}
      {style === "cap" && (
        <>
          <path d="M11 20 Q11 7 24 7 Q37 7 37 20Z" fill="#d9372b" />
          <rect x="22" y="17.5" width="19" height="3.5" rx="1.7" fill="#d9372b" />
        </>
      )}
      <ellipse cx="19" cy="26" rx="3.2" ry="3.8" fill="#fff" />
      <ellipse cx="29" cy="26" rx="3.2" ry="3.8" fill="#fff" />
      <circle cx={index % 2 ? 20 : 18.5} cy="26.5" r="1.7" fill="#171917" />
      <circle cx={index % 2 ? 30 : 28.5} cy="26.5" r="1.7" fill="#171917" />
      {look.glasses && (
        <g fill="none" stroke="#171917" strokeWidth="1.4">
          <circle cx="19" cy="26" r="4.6" />
          <circle cx="29" cy="26" r="4.6" />
          <path d="M23.6 26 h0.8" />
        </g>
      )}
      {look.beard && (
        <path d="M13 31 Q24 46 35 31 Q30 37 24 37 Q18 37 13 31Z" fill={look.hair} />
      )}
      {look.moustache && <rect x="19" y="31.5" width="10" height="2.2" rx="1" fill={look.hair} />}
      <path
        d={index % 3 ? "M19 34.5 Q24 38.5 29 34" : "M19 35.5 Q24 32.5 29 35.5"}
        fill="none"
        stroke="#171917"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {look.earrings && [11, 37].map((x) => <circle key={x} cx={x} cy="31" r="1.6" fill="#e2b33c" />)}
      {look.bindi && <circle cx="24" cy="21" r="1.2" fill="#c62828" />}
      {look.flower &&
        [
          [14, 14],
          [17.5, 11.5],
          [21, 10.5],
        ].map(([x, y]) => <circle key={x} cx={x} cy={y} r="1.6" fill="#fffbe8" />)}
    </svg>
  );
}


function SmileMark() {
  return (
    <svg className="smile-mark" viewBox="0 0 44 44" aria-hidden="true">
      <path d="M8 7h28v20c0 8-7 13-14 13S8 35 8 27Z" fill="currentColor" />
      <path
        d="M15 25q7 10 14 0M16 15v3M28 15v3"
        fill="none"
        stroke="#111"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path
        d="m9 3 1-1h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1Z"
        transform="translate(0 0) scale(.95)"
      />
      <circle cx="11.5" cy="11.5" r="3.2" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </svg>
  );
}

function isMalayalam(text = ""): boolean {
  return /[ഀ-ൿ]/.test(text);
}

function mostOf(
  players: Player[],
  count: (player: Player) => number,
): Player | undefined {
  return [...players].sort((first, second) => count(second) - count(first))[0];
}

// The round's top scorer takes the mic while scores are shown.
function roundWinnerId(room: RoomState): string {
  const points = room.results.find((result) => result.round === room.round)
    ?.points;
  if (!points) return "";
  let winnerId = "";
  for (const [playerId, playerPoints] of Object.entries(points))
    if (playerPoints > (points[winnerId] ?? 0)) winnerId = playerId;
  return winnerId;
}

function promptHint(room: RoomState): string {
  switch (room.phase) {
    case "ANNOUNCING":
      return "Listen once, then copy it in one take.";
    case "LISTENING":
      return "Listen closely and follow the lyrics.";
    case "RECORDING":
      return "Copy it when the lyrics start.";
    case "SUBMISSION_LOCK":
      return "Waiting for everyone’s take…";
    default:
      return "Next sound coming up…";
  }
}

const SCORE_FEATURES: [keyof AudioScore["features"], string][] = [
  ["rhythm", "Rhythm"],
  ["melody", "Melody"],
  ["energy", "Energy"],
  ["texture", "Texture"],
];

function ScoreBadge({ score }: { score: AudioScore }) {
  return (
    <details className={`score-badge ${score.reliability}`}>
      <summary aria-label={`Score ${score.overall ?? "unavailable"} out of 100`}>
        <strong>{score.overall ?? "—"}</strong>
        <small>/100</small>
      </summary>
      <div className="score-badge-details">
        {score.overall !== null && (
          <ul className="feature-bars">
            {SCORE_FEATURES.map(([key, label]) => {
              const value = score.features[key];
              if (typeof value !== "number") return null;
              return (
                <li key={key}>
                  <span>{label}</span>
                  <span className="feature-bar">
                    <span style={{ width: `${value}%` }} />
                  </span>
                  <b>{value}</b>
                </li>
              );
            })}
          </ul>
        )}
        <small>{score.reason}</small>
      </div>
    </details>
  );
}

// Scores for the round in one row, best first; a reason shows only when there is no score.
function RoundScores({ room }: { room: RoomState }) {
  const scores = room.players
    .map((player) => ({
      player,
      score: room.submissions.find((entry) => entry.playerId === player.id)?.score ?? null,
    }))
    .sort((first, second) => (second.score?.overall ?? -1) - (first.score?.overall ?? -1));
  return (
    <ol className="round-scores" aria-label="Scores this round">
      {scores.map(({ player, score }, index) => {
        const isWinner = index === 0 && score?.overall != null;
        return (
          <li key={player.id} className={`round-score ${isWinner ? "best" : ""}`}>
            {isWinner && <span aria-hidden="true">👑</span>}
            <Avatar index={player.avatar} />
            <strong>{player.name}</strong>
            <b>
              {score?.overall ?? "—"}
              <small>/100</small>
            </b>
            {score?.overall == null && (
              <small className="score-reason">
                {score?.reason ?? "No take received before the deadline."}
              </small>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function phaseLabel(phase: RoomState["phase"], countdown: number) {
  return {
    LOBBY: "Lobby",
    ANNOUNCING: "Up next",
    LISTENING: "Listen closely",
    RECORDING: countdown > 0 ? "Get ready" : "Recording live",
    SUBMISSION_LOCK: "Takes are coming in",
    PLAYBACK: "Your gang, on stage",
    SCORING: "The scores are in",
    NEXT_ROUND: "Catch your breath",
    FINISHED: "That’s a wrap",
  }[phase];
}

function Results({
  room,
  game,
  onShare,
}: {
  room: RoomState;
  game: Game;
  onShare: () => Promise<void>;
}) {
  const ranked = [...room.players].sort(
    (first, second) =>
      second.total - first.total || first.joinedAt - second.joinedAt,
  );
  const crowdFavourite = mostOf(room.players, (player) => player.laughs);
  const tomatoMagnet = mostOf(room.players, (player) => player.tomatoes);
  let bestRound: { player: Player; points: number; round: number } | null =
    null;
  for (const result of room.results) {
    for (const player of room.players) {
      const points = result.points[player.id] ?? 0;
      if (points > (bestRound?.points ?? 0))
        bestRound = { player, points, round: result.round };
    }
  }
  return (
    <div className="results">
      <div className="winner">
        <Avatar index={ranked[0].avatar} />
        <p className="muted">Top of the party</p>
        <h2>{ranked[0].name}</h2>
        <strong>{ranked[0].total} points</strong>
      </div>
      <ol className="leaderboard">
        {ranked.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <strong>
              {player.total} <small>pts</small>
            </strong>
          </li>
        ))}
      </ol>
      <details>
        <summary>Round-by-round scores</summary>
        <div className="round-history">
          {room.results.map((result) => (
            <div key={result.round}>
              <h3>
                Round {result.round} · {findPrompt(result.promptId, room.customClips).title}
              </h3>
              {room.players.map((player) => (
                <p key={player.id}>
                  {player.name}
                  <span>
                    {result.points[player.id] ?? 0} pts
                  </span>
                </p>
              ))}
            </div>
          ))}
        </div>
      </details>
      <ul className="awards">
        {bestRound && (
          <li>
            🏆 Best single round: {bestRound.player.name} · {bestRound.points}{" "}
            pts in round {bestRound.round}
          </li>
        )}
        {crowdFavourite && crowdFavourite.laughs > 0 && (
          <li>
            😂 Crowd favourite: {crowdFavourite.name} · {crowdFavourite.laughs}{" "}
            laughs
          </li>
        )}
        {tomatoMagnet && tomatoMagnet.tomatoes > 0 && (
          <li>
            🍅 Tomato magnet: {tomatoMagnet.name} · {tomatoMagnet.tomatoes}{" "}
            tomatoes
          </li>
        )}
      </ul>
      <div className="lobby-buttons">
        {game.isHost ? (
          <button
            className="primary"
            onClick={() => void game.command({ type: "again" })}
          >
            One more party ↗
          </button>
        ) : (
          <p>Waiting for the host to start another party.</p>
        )}
        <button className="secondary" onClick={() => void onShare()}>
          Copy results
        </button>
      </div>
    </div>
  );
}

function DialogShell({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            className="close-button"
            aria-label="Close dialog"
            onClick={close}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
