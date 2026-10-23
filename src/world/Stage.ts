import * as THREE from "three";
import type { StageEvent } from "../game/types";
import { buildRoom } from "./Room";
import { buildBurst, buildGuitar, buildTomato, type Burst } from "./Props";
import {
  buildCharacter,
  CHARACTER_SCALE,
  disposeObject,
  emojiSprite,
  HEAD_HEIGHT,
  HEAD_RADIUS,
  LEG_LENGTH,
  type Character,
  type SharedMaterials,
  type StageActor,
} from "./Character";

export type CameraShot = "wide" | "portrait";

const MIC_SPOT = new THREE.Vector3(0, 0, 1.6);

interface ArmPose {
  leftX: number;
  leftZ: number;
  rightX: number;
  rightZ: number;
}

interface StageMove extends ArmPose {
  sway: number;
  bounce: number;
}

/** Where a character's arms, body and mouth are heading; the character eases toward it every frame. */
interface Pose extends ArmPose {
  lift: number;
  leanForward: number;
  leanSide: number;
  twist: number;
  sideStep: number;
  mouth: number;
}

interface CharacterState {
  isPerformer: boolean;
  isAtMic: boolean;
  isWalking: boolean;
  isTalking: boolean;
  legSwing: number;
  mouth: number;
}

// The mic stand is on the performer's left, so the left hand holds it in most moves.
const PERFORMANCE_MOVES: StageMove[] = [
  { leftX: -1.35, leftZ: -0.15, rightX: -0.4, rightZ: 0.7, sway: 0, bounce: 0.05 }, // hold the mic, other hand open
  { leftX: -1.35, leftZ: -0.15, rightX: -2.35, rightZ: -0.55, sway: 0, bounce: 0.03 }, // hand to face
  { leftX: -1.35, leftZ: -0.15, rightX: -2.9, rightZ: 0.25, sway: 0, bounce: 0.12 }, // arm raised
  { leftX: -0.3, leftZ: -1.15, rightX: -0.3, rightZ: 1.15, sway: 0, bounce: 0.06 }, // arms wide
  { leftX: -1.35, leftZ: -0.15, rightX: -0.2, rightZ: 0.25, sway: 0.14, bounce: 0.04 }, // sway
];
const MOVE_SECONDS = 1.6;

type PerformanceStyle = "mic" | "guitar" | "dance" | "surprise";
// Plain singing is the most common; the others keep each performance a little unpredictable.
const PERFORMANCE_STYLES: PerformanceStyle[] = ["mic", "mic", "guitar", "dance", "surprise"];

// Calm while a performer walks in, watching while someone sings, applause when a performance ends.
type CrowdMood = "calm" | "watching" | "applause";

type AudienceReaction =
  | "watch"
  | "clap"
  | "shocked"
  | "dance"
  | "angry"
  | "laugh"
  | "cheer"
  | "facepalm";
const SINGING_REACTIONS: AudienceReaction[] = [
  "clap",
  "shocked",
  "dance",
  "angry",
  "laugh",
  "cheer",
  "facepalm",
];
const REACTION_EMOJI: Record<AudienceReaction, string> = {
  watch: "",
  clap: "👏",
  shocked: "😱",
  dance: "💃",
  angry: "😡",
  laugh: "😂",
  cheer: "🙌",
  facepalm: "🤦",
};

// The first four players stand on the floor; players five to eight stand on the back riser.
const AUDIENCE_SLOTS = [
  [-2.0, 0, -0.9],
  [2.0, 0, -0.9],
  [-3.3, 0, -0.4],
  [3.3, 0, -0.4],
  [-1.2, 0.5, -2.7],
  [1.2, 0.5, -2.7],
  [-2.6, 0.5, -2.7],
  [2.6, 0.5, -2.7],
];
const WALK_SPEED = 2.6;
// Performers hurry, so even the back row reaches the mic before their voice starts.
const PERFORMER_WALK_SPEED = 4;
const ACCELERATION = 9;
const LEG_SWING = 0.55;
// One step covers the distance the feet travel at full swing, so feet never slide.
const STEP_LENGTH = 2 * LEG_LENGTH * CHARACTER_SCALE * Math.sin(LEG_SWING);
const DANCE_SECONDS = 3;
const SURPRISE_SECONDS = 0.6;
const BOW_SECONDS = 1.4;
const APPLAUSE_SECONDS = 3;
const TOMATO_FLIGHT_SECONDS = 0.75;
const DODGE_SECONDS = 0.7;
const BURST_SECONDS = 0.9;
const FLOOR_SPLAT_SECONDS = 4;
const EMOTE_SECONDS = 2.2;
const MAX_SPLATS = 8;

interface FlyingTomato {
  tomato: THREE.Group;
  from: THREE.Vector3;
  targetId: string;
  /** Where a dodged tomato lands; a tomato that hits follows the target's head instead. */
  missLandsAt: THREE.Vector3 | null;
  startedAt: number;
}

interface Dodge {
  startedAt: number;
  side: number;
}

interface FloorSplat {
  mesh: THREE.Mesh;
  startedAt: number;
}

interface FloatingEmote {
  sprite: THREE.Sprite;
  characterId: string;
  startedAt: number;
}

export class Stage {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private readonly world = new THREE.Group();
  private readonly observer: ResizeObserver;
  private readonly materials: SharedMaterials;
  private readonly characters = new Map<string, Character>();
  private readonly tomatoes: FlyingTomato[] = [];
  private readonly dodges = new Map<string, Dodge>();
  private readonly bursts: Burst[] = [];
  private readonly floorSplats: FloorSplat[] = [];
  private readonly emotes: FloatingEmote[] = [];
  private readonly reactions = new Map<string, { reaction: AudienceReaction; until: number }>();
  private readonly tomatoMaterial: THREE.MeshStandardMaterial;
  private readonly confettiMaterials: THREE.MeshStandardMaterial[];
  private readonly guitar = buildGuitar();
  private guitarOwnerId = "";
  private seenEventIds = new Set<string>();
  private castOrder: string[] = [];
  private lastTime = 0;
  private time = 0;
  private pointerX = 0;
  private pointerY = 0;
  public level = 0;
  public performerId = "";
  public talkingId = "";
  public chorus = false;
  /** Identifies the current performance, so every screen picks the same entrance for it. */
  public performanceKey = "";
  private styledKey = "";
  private performanceStyle: PerformanceStyle = "mic";
  private hasSurprised = false;
  private surpriseStartedAt = -100;
  /** The performer whose voice just ended, who bows while the score is revealed. */
  public finishedId = "";
  /** The round winner, who dances at the mic while the scores show. */
  public celebrationId = "";
  private crownedId = "";
  private crowdMood: CrowdMood = "calm";
  private crowdMoodKey = "";
  private moodStartedAt = 0;
  /** Which character the portrait shot frames. */
  public focusId = "";
  private shot: CameraShot = "wide";
  private portraitStartedAt = 0;
  private readonly wideCamera = new THREE.Vector3();
  private readonly wideLook = new THREE.Vector3();
  private readonly cameraGoal = new THREE.Vector3();
  private readonly lookGoal = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private hasFramed = false;
  private readonly wallLogo: THREE.Mesh;
  /** The home page shows its own big title, so it hides the wall logo. */
  public showWallLogo = true;
  public onTomatoSplat: (() => void) | null = null;
  public reducedMotion = false;
  private isRoundFraming = false;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    // Phones have 2-3x screens; rendering below 2x makes the stage look soft, above 2x costs a lot for little gain.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xfff1e0, 0x3a2620, 2.2));
    const key = new THREE.DirectionalLight(0xffe6c8, 3.2);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.2);
    fill.position.set(-5, 4, -1);
    this.scene.add(fill);
    this.scene.add(this.world);
    this.materials = {
      ink: this.material(0x241e29),
      cream: this.material(0xffedc0),
      you: this.material(0xc6f24e),
    };
    this.tomatoMaterial = new THREE.MeshStandardMaterial({ color: 0xc8281e, roughness: 0.3 });
    this.confettiMaterials = [0xffd23f, 0xff5d8f, 0x4ee6c2, 0xc6f24e].map((color) =>
      this.material(color),
    );
    this.wallLogo = buildRoom(
      this.scene,
      this.world,
      this.materials,
      new THREE.Vector3(-0.85, 0, MIC_SPOT.z + 0.75),
    );
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    canvas.addEventListener("pointermove", this.onPointer);
    canvas.addEventListener("pointerleave", this.onLeave);
    this.resize();
    this.renderer.setAnimationLoop((time) => this.frame(time));
  }

  private material(color: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  }


  private slotPosition(index: number): THREE.Vector3 {
    const [x, y, z] = AUDIENCE_SLOTS[index % AUDIENCE_SLOTS.length];
    return new THREE.Vector3(x, y, z);
  }

  public setCast(actors: StageActor[]): void {
    const wantedIds = new Set(actors.map((actor) => actor.id));
    for (const [id, character] of this.characters) {
      const changed = actors.find((actor) => actor.id === id);
      const isOutdated =
        !wantedIds.has(id) ||
        changed?.name !== character.actor.name ||
        changed?.color !== character.actor.color ||
        changed?.look !== character.actor.look ||
        changed?.isYou !== character.actor.isYou;
      if (isOutdated) {
        // The guitar is reused, so take it back before the character is thrown away.
        if (id === this.guitarOwnerId) {
          this.guitar.removeFromParent();
          this.guitarOwnerId = "";
        }
        this.world.remove(character.root);
        disposeObject(character.root, this.sharedMaterials());
        this.characters.delete(id);
      }
    }
    this.castOrder = actors.map((actor) => actor.id);
    actors.forEach((actor, index) => {
      if (this.characters.has(actor.id)) return;
      const character = buildCharacter(actor, this.materials);
      character.root.position.copy(this.slotPosition(index));
      this.world.add(character.root);
      this.characters.set(actor.id, character);
    });
  }

  public setRoundFraming(isRound: boolean): void {
    if (isRound === this.isRoundFraming) return;
    this.isRoundFraming = isRound;
    this.resize();
  }

  public setShot(shot: CameraShot): void {
    if (shot === "portrait" && this.shot !== "portrait") this.portraitStartedAt = this.time;
    this.shot = shot;
  }

  public showEvents(events: StageEvent[], now: number): void {
    for (const event of events) {
      if (this.seenEventIds.has(event.id)) continue;
      // Events older than a few seconds happened before this stage opened.
      if (now - event.at > 3000) continue;
      if (event.kind === "dance") this.startDance(event.playerId);
      if (event.kind === "emote") this.showEmote(event.playerId, event.emote);
      if (event.kind === "tomato") this.throwTomato(event);
    }
    this.seenEventIds = new Set(events.map((event) => event.id));
  }

  private startDance(playerId: string): void {
    const character = this.characters.get(playerId);
    if (character) character.danceStartedAt = this.time;
  }

  private showEmote(playerId: string, emote: string, size = 0.9): void {
    if (!this.characters.has(playerId)) return;
    const sprite = emojiSprite(emote);
    sprite.scale.setScalar(size);
    this.world.add(sprite);
    this.emotes.push({ sprite, characterId: playerId, startedAt: this.time });
  }

  private headPosition(character: Character): THREE.Vector3 {
    return character.root.position
      .clone()
      .add(new THREE.Vector3(0, (HEAD_HEIGHT + character.body.position.y) * CHARACTER_SCALE, 0));
  }

  private throwTomato(event: StageEvent): void {
    const thrower = this.characters.get(event.playerId);
    const target = this.characters.get(event.targetId);
    if (!target) return;
    if (this.reducedMotion) {
      if (!event.dodged) this.splat(target);
      return;
    }
    const from = thrower
      ? this.headPosition(thrower)
      : new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, 6);
    let missLandsAt: THREE.Vector3 | null = null;
    if (event.dodged) {
      // The tomato sails through where the head was and lands on the floor behind.
      const head = this.headPosition(target);
      const onward = head.clone().sub(from).setY(0).normalize().multiplyScalar(2.2);
      missLandsAt = new THREE.Vector3(head.x + onward.x, target.root.position.y, head.z + onward.z);
      this.dodges.set(event.targetId, {
        startedAt: this.time + TOMATO_FLIGHT_SECONDS * 0.35,
        side: Math.random() < 0.5 ? -1 : 1,
      });
    }
    const tomato = buildTomato();
    tomato.position.copy(from);
    this.world.add(tomato);
    this.tomatoes.push({ tomato, from, targetId: event.targetId, missLandsAt, startedAt: this.time });
  }

  private splat(target: Character): void {
    if (target.splats.length >= MAX_SPLATS) return;
    const x = (Math.random() - 0.5) * 0.7;
    const y = (Math.random() - 0.5) * 0.6;
    const z = Math.sqrt(Math.max(0, HEAD_RADIUS ** 2 - x ** 2 - y ** 2)) + 0.02;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), this.tomatoMaterial);
    mesh.position.set(x, HEAD_HEIGHT + y, z);
    mesh.scale.set(1, 0.8, 0.25);
    const surfaceNormal = new THREE.Vector3(x, y, z).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceNormal);
    // A few smaller blobs around the edge make it look splattered rather than stuck on.
    for (let index = 0; index < 3; index++) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), this.tomatoMaterial);
      const angle = (index / 3) * Math.PI * 2 + Math.random();
      blob.position.set(Math.cos(angle) * 0.28, Math.sin(angle) * 0.3, 0);
      mesh.add(blob);
    }
    target.body.add(mesh);
    target.splats.push(mesh);
  }

  private clearSplats(character: Character): void {
    for (const mesh of character.splats) {
      character.body.remove(mesh);
      disposeObject(mesh, this.sharedMaterials());
    }
    character.splats = [];
  }

  private burst(at: THREE.Vector3, materials: THREE.Material[]): void {
    if (this.reducedMotion) return;
    const burst = buildBurst(at, materials, this.time);
    this.world.add(...burst.pieces);
    this.bursts.push(burst);
  }

  private sharedMaterials(): Set<THREE.Material> {
    return new Set([
      ...Object.values(this.materials),
      this.tomatoMaterial,
      ...this.confettiMaterials,
    ]);
  }

  private readonly onPointer = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointerX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.15;
    this.pointerY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.06;
  };

  private readonly onLeave = (): void => {
    this.pointerX = 0;
    this.pointerY = 0;
  };

  private resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    this.camera.aspect = width / Math.max(1, height);
    // Pull back on narrow screens so the whole audience stays in view.
    // Rounds keep room for up to eight players; the lobby and home stage can frame their cast more closely.
    const halfWidthToShow = this.isRoundFraming ? 5.8 : 4.6;
    const distance = halfWidthToShow / (Math.tan((17.5 * Math.PI) / 180) * this.camera.aspect);
    // During rounds text covers the top of the stage, so aim higher to keep the cast in the lower part.
    // Wide laptop panels can aim highest; tall phone panels already have room above the cast.
    const lookAtHeight = !this.isRoundFraming ? 2.3 : this.camera.aspect >= 1.2 ? 3.8 : 2.9;
    const minimumDistance =
      this.isRoundFraming && this.camera.aspect < 1.2 ? 14 : width < 600 ? 9.5 : 13.5;
    this.wideCamera.set(0, 4.6, Math.min(34, Math.max(minimumDistance, distance)));
    this.wideLook.set(0, lookAtHeight, 0);
    if (!this.hasFramed) {
      this.camera.position.copy(this.wideCamera);
      this.currentLook.copy(this.wideLook);
      this.camera.lookAt(this.currentLook);
      this.hasFramed = true;
    }
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private frame(now: number): void {
    const delta = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.time += delta;
    if (!this.reducedMotion) {
      this.world.rotation.y += (this.pointerX - this.world.rotation.y) * Math.min(1, delta * 5);
      this.world.rotation.x += (this.pointerY - this.world.rotation.x) * Math.min(1, delta * 5);
    }
    this.updatePerformanceStyle();
    this.updateCrowdMood();
    if (!this.celebrationId) this.crownedId = "";
    // Name labels would fill the screen in a close portrait, so they hide.
    const showLabels = this.shot !== "portrait" || this.reducedMotion;
    this.castOrder.forEach((id, index) => {
      const character = this.characters.get(id);
      if (!character) return;
      if (character.label) character.label.visible = showLabels;
      this.animateCharacter(character, index, delta);
    });
    this.animateTomatoes(delta);
    this.animateBursts(delta);
    this.animateFloorSplats();
    this.animateEmotes();
    this.wallLogo.visible = this.showWallLogo;
    this.moveCamera(delta);
    this.renderer.render(this.scene, this.camera);
  }

  private updatePerformanceStyle(): void {
    if (this.performanceKey !== this.styledKey) {
      this.styledKey = this.performanceKey;
      this.performanceStyle =
        this.performanceKey && !this.reducedMotion
          ? PERFORMANCE_STYLES[hashText(this.performanceKey) % PERFORMANCE_STYLES.length]
          : "mic";
      this.hasSurprised = false;
      this.surpriseStartedAt = -100;
    }
    const guitarOwnerId = this.performanceStyle === "guitar" ? this.performerId : "";
    if (guitarOwnerId === this.guitarOwnerId) return;
    this.guitar.removeFromParent();
    this.characters.get(guitarOwnerId)?.body.add(this.guitar);
    this.guitarOwnerId = guitarOwnerId;
  }

  private updateCrowdMood(): void {
    const mood: CrowdMood =
      this.finishedId || this.celebrationId ? "applause" : this.talkingId ? "watching" : "calm";
    // The ids are part of the key, so the crowd applauds again for the round winner
    // even straight after applauding the last performance.
    const moodKey = `${mood}:${this.finishedId}:${this.celebrationId}`;
    if (moodKey === this.crowdMoodKey) return;
    this.crowdMoodKey = moodKey;
    this.crowdMood = mood;
    this.moodStartedAt = this.time;
    this.reactions.clear();
  }

  private moveCamera(delta: number): void {
    const focus = this.characters.get(this.focusId);
    if (this.shot === "wide" || !focus || this.reducedMotion) {
      this.cameraGoal.copy(this.wideCamera);
      this.lookGoal.copy(this.wideLook);
    } else {
      this.framePortrait(focus);
    }
    // Exponential easing: quick to start, gentle to settle, and the same speed at any frame rate.
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
    this.camera.position.lerp(this.cameraGoal, ease);
    this.currentLook.lerp(this.lookGoal, ease);
    this.camera.lookAt(this.currentLook);
  }

  // A three-quarter close-up of the face with the mic head beside it, slowly pushing in like a film shot.
  private framePortrait(focus: Character): void {
    const tanHalfFov = Math.tan((this.camera.fov * Math.PI) / 360);
    const face = focus.root.position.clone();
    face.x -= 0.35;
    face.y += HEAD_HEIGHT * CHARACTER_SCALE;
    const pushIn = 1 - 0.15 * Math.min(1, (this.time - this.portraitStartedAt) / 6);
    const distance = Math.max(5.2, 2.0 / (tanHalfFov * this.camera.aspect)) * pushIn;
    // Text sits over the top of the stage, so keep the face in the lower part of the frame.
    const lift = distance * tanHalfFov * 0.32;
    this.lookGoal.set(face.x, face.y + lift, face.z);
    this.cameraGoal.set(face.x + distance * 0.3, face.y + lift + 0.4, face.z + distance);
  }

  private animateCharacter(character: Character, index: number, delta: number): void {
    const id = character.actor.id;
    const isPerformer = id === this.performerId;
    const target = isPerformer ? MIC_SPOT : this.slotPosition(index);
    const position = character.root.position;
    const toTarget = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    const distance = toTarget.length();

    // Speed up toward walking pace and brake smoothly so the character stops on its mark.
    const walkSpeed = isPerformer ? PERFORMER_WALK_SPEED : WALK_SPEED;
    const desiredSpeed = distance < 0.01 ? 0 : Math.min(walkSpeed, Math.sqrt(2 * ACCELERATION * distance));
    const speedChange = desiredSpeed - character.speed;
    character.speed += Math.sign(speedChange) * Math.min(Math.abs(speedChange), ACCELERATION * delta);
    const step = Math.min(distance, character.speed * delta);
    if (distance > 0) position.addScaledVector(toTarget.normalize(), step);
    // Step up onto or down from the riser while walking.
    position.y += (target.y - position.y) * Math.min(1, delta * 6);
    character.stridePhase += (step / STEP_LENGTH) * Math.PI;
    const swingAmount = LEG_SWING * Math.min(1, character.speed / 0.8);
    const legSwing = Math.sin(character.stridePhase) * swingAmount;
    character.leftLeg.rotation.x = legSwing;
    character.rightLeg.rotation.x = -legSwing;

    const isWalking = step > 0.0005;
    const facing = isWalking
      ? Math.atan2(toTarget.x, toTarget.z)
      : isPerformer || !this.performerId
        ? 0
        : Math.atan2(MIC_SPOT.x - position.x, MIC_SPOT.z - position.z);
    character.root.rotation.y = turnToward(character.root.rotation.y, facing, delta * 8);

    if (!isPerformer && distance < 0.1 && character.splats.length) this.clearSplats(character);

    const isAtMic = isPerformer && distance < 0.2;
    if (isAtMic) this.arriveAtMic(character);
    const isTalking = id === this.talkingId && distance < 0.2;
    const mouth = isTalking
      ? 0.3 + this.level * 2 + Math.abs(Math.sin(this.time * 8)) * this.level
      : this.chorus
        ? 0.3 + Math.abs(Math.sin(this.time * 7 + index)) * 0.5
        : 0.3;
    const pose = this.choosePose(character, index, {
      isPerformer,
      isAtMic,
      isWalking,
      isTalking,
      legSwing,
      mouth,
    });
    this.addDodge(character, pose);
    this.easePose(character, pose, delta);
  }

  // Picks what the character is doing right now, most important first.
  private choosePose(character: Character, index: number, state: CharacterState): Pose {
    const id = character.actor.id;
    const armSwing = -state.legSwing * 0.8;
    const pose: Pose = {
      leftX: armSwing,
      leftZ: 0,
      rightX: -armSwing,
      rightZ: 0,
      lift: Math.sin(this.time * 2 + index) * 0.02,
      leanForward: 0,
      leanSide: 0,
      twist: 0,
      sideStep: 0,
      mouth: state.mouth,
    };
    if (this.reducedMotion) return { ...pose, lift: 0, mouth: Math.min(state.mouth, 0.8) };

    const isDanceEntrance =
      state.isPerformer && state.isWalking && this.performanceStyle === "dance";
    const surpriseProgress = (this.time - this.surpriseStartedAt) / SURPRISE_SECONDS;
    if (isDanceEntrance || this.time - character.danceStartedAt < DANCE_SECONDS)
      return this.dancePose(pose, character, state.isWalking);
    if (state.isPerformer && state.isWalking && this.performanceStyle === "surprise")
      return this.hopPose(pose, character);
    if (state.isPerformer && surpriseProgress >= 0 && surpriseProgress < 1)
      return this.taDaPose(pose, surpriseProgress);
    if (id === this.celebrationId && state.isAtMic) return this.celebratePose(pose);
    if (id === this.finishedId && state.isAtMic) return this.bowPose(pose);
    if (id === this.guitarOwnerId) return this.guitarPose(pose, state.isTalking);
    if (state.isTalking) return this.performPose(pose, index);
    if (this.crowdMood !== "calm" && !state.isWalking && !state.isPerformer)
      return this.reactionPose(pose, this.nextReaction(character, index), index);
    return pose;
  }

  // Special entrances and the winner's crown start once the character reaches the mic.
  private arriveAtMic(character: Character): void {
    const id = character.actor.id;
    if (this.performanceStyle === "surprise" && !this.hasSurprised) {
      this.hasSurprised = true;
      this.surpriseStartedAt = this.time;
      this.showEmote(id, "🎉");
      this.burst(this.headPosition(character), this.confettiMaterials);
    }
    if (id === this.celebrationId && this.crownedId !== id) {
      this.crownedId = id;
      this.showEmote(id, "👑");
      this.burst(this.headPosition(character), this.confettiMaterials);
    }
  }

  private dancePose(pose: Pose, character: Character, isWalking: boolean): Pose {
    const beat = this.time * 9;
    if (!isWalking) {
      character.leftLeg.rotation.x = Math.max(0, Math.sin(beat)) * 0.4;
      character.rightLeg.rotation.x = Math.max(0, -Math.sin(beat)) * 0.4;
    }
    return {
      ...pose,
      lift: Math.abs(Math.sin(beat)) * 0.35,
      twist: this.time * 2.1,
      leftX: 0,
      leftZ: -2.5 - Math.sin(beat) * 0.35,
      rightX: 0,
      rightZ: 2.5 - Math.sin(beat + 1) * 0.35,
    };
  }

  // The surprise entrance: bouncing to the mic with both feet together and arms up, about two hops a second.
  private hopPose(pose: Pose, character: Character): Pose {
    const hop = Math.abs(Math.sin(character.stridePhase / 3));
    character.leftLeg.rotation.x = -hop * 0.3;
    character.rightLeg.rotation.x = -hop * 0.3;
    return { ...pose, lift: hop * 0.5, leftX: 0, leftZ: -2.3, rightX: 0, rightZ: 2.3 };
  }

  // Landing at the mic with a "ta-da!".
  private taDaPose(pose: Pose, progress: number): Pose {
    return {
      ...pose,
      lift: Math.sin(progress * Math.PI) * 0.5,
      mouth: 1.1,
      leftX: 0,
      leftZ: -2.8,
      rightX: 0,
      rightZ: 2.8,
    };
  }

  private celebratePose(pose: Pose): Pose {
    const beat = this.time * 8;
    const pump = Math.sin(beat) * 0.35;
    return {
      ...pose,
      lift: Math.abs(Math.sin(beat)) * 0.3,
      twist: Math.sin(this.time * 2.5) * 0.6,
      mouth: 0.9,
      leftX: 0,
      leftZ: -2.6 + pump,
      rightX: 0,
      rightZ: 2.6 + pump,
    };
  }

  // When the voice ends the performer bows, then waves while the score is revealed.
  private bowPose(pose: Pose): Pose {
    const progress = (this.time - this.moodStartedAt) / BOW_SECONDS;
    if (progress < 1)
      return {
        ...pose,
        leanForward: Math.sin(progress * Math.PI) * 0.35,
        leftX: -0.6,
        leftZ: 0.7,
        rightX: 0.4,
        rightZ: 0,
      };
    return { ...pose, rightX: 0, rightZ: 2.5 + Math.sin(this.time * 9) * 0.35 };
  }

  // One hand strums over the sound hole while the other holds the top of the neck; a louder voice strums harder.
  private guitarPose(pose: Pose, isStrumming: boolean): Pose {
    const strum = isStrumming ? Math.sin(this.time * 16) * (0.12 + this.level * 0.3) : 0;
    return {
      ...pose,
      leftX: -0.94 + strum,
      leftZ: 0.73,
      rightX: -1.83,
      rightZ: 0.75,
      leanSide: isStrumming ? Math.sin(this.time * 4) * 0.06 : 0,
      lift: isStrumming ? Math.abs(Math.sin(this.time * 8)) * 0.05 : 0,
    };
  }

  // A singing performer cycles through stage moves; a louder voice makes bigger moves.
  private performPose(pose: Pose, index: number): Pose {
    const move =
      PERFORMANCE_MOVES[Math.floor(this.time / MOVE_SECONDS + index) % PERFORMANCE_MOVES.length];
    const energy = 0.55 + Math.min(1, this.level * 1.8) * 0.45;
    return {
      ...pose,
      leftX: move.leftX * energy,
      leftZ: move.leftZ * energy,
      rightX: move.rightX * energy,
      rightZ: move.rightZ * energy,
      leanSide: Math.sin(this.time * 3) * move.sway,
      leanForward: Math.sin(this.time * 5) * 0.05 * this.level,
      lift: Math.abs(Math.sin(this.time * 6)) * move.bounce * (0.5 + this.level),
    };
  }

  private nextReaction(character: Character, index: number): AudienceReaction {
    if (this.crowdMood === "applause") {
      // Everyone applauds together, each starting a moment apart, then settles down to watch.
      const sinceApplauseStarted = this.time - this.moodStartedAt - index * 0.15;
      if (sinceApplauseStarted < 0 || sinceApplauseStarted > APPLAUSE_SECONDS) return "watch";
      return index % 3 === 2 ? "cheer" : "clap";
    }
    const id = character.actor.id;
    const current = this.reactions.get(id);
    if (current && this.time < current.until) return current.reaction;
    // Mostly people just watch; now and then someone reacts, then goes back to watching.
    const shouldReact = current?.reaction === "watch" && Math.random() < 0.45;
    if (!shouldReact) {
      const watchSeconds = current ? 1.5 + Math.random() * 2 : 0.5 + Math.random() * 2;
      this.reactions.set(id, { reaction: "watch", until: this.time + watchSeconds });
      return "watch";
    }
    const reaction = SINGING_REACTIONS[Math.floor(Math.random() * SINGING_REACTIONS.length)];
    this.reactions.set(id, { reaction, until: this.time + 1.5 + Math.random() * 1.5 });
    // Bubbles only during rounds, so the lobby and home stage stay calm.
    if (this.isRoundFraming && Math.random() < 0.35)
      this.showEmote(id, REACTION_EMOJI[reaction], 0.65);
    return reaction;
  }

  private reactionPose(pose: Pose, reaction: AudienceReaction, index: number): Pose {
    const beat = this.time * 9 + index;
    if (reaction === "clap") {
      const clap = Math.sin(this.time * 14) * 0.25;
      return { ...pose, leftX: -1, leftZ: 0.45 + clap, rightX: -1, rightZ: -0.45 - clap };
    }
    if (reaction === "shocked")
      return { ...pose, leanForward: -0.15, mouth: 1.2, leftX: -2.35, leftZ: 0.55, rightX: -2.35, rightZ: -0.55 };
    if (reaction === "dance") {
      const wave = Math.sin(beat) * 0.4;
      return {
        ...pose,
        lift: Math.abs(Math.sin(beat)) * 0.25,
        leanSide: Math.sin(beat / 2) * 0.15,
        leftX: 0,
        leftZ: -2.4 - wave,
        rightX: 0,
        rightZ: 2.4 - wave,
      };
    }
    if (reaction === "angry") {
      const shake = Math.sin(this.time * 20) * 0.25;
      return { ...pose, leanForward: 0.12, leftX: -0.2, leftZ: -0.5, rightX: -2.7 + shake, rightZ: 0.2 };
    }
    if (reaction === "laugh") {
      const giggle = Math.abs(Math.sin(this.time * 12));
      return {
        ...pose,
        leanForward: -0.1 + giggle * 0.12,
        mouth: 0.7 + giggle * 0.5,
        leftX: -0.7,
        leftZ: 0.5,
        rightX: -0.7,
        rightZ: -0.5,
      };
    }
    if (reaction === "cheer") {
      const pump = Math.sin(this.time * 10) * 0.3;
      return {
        ...pose,
        lift: Math.max(0, Math.sin(this.time * 10)) * 0.2,
        leftX: -0.3,
        leftZ: -2.6 + pump,
        rightX: -0.3,
        rightZ: 2.6 - pump,
      };
    }
    if (reaction === "facepalm")
      return { ...pose, leanForward: 0.18, leftX: -0.1, leftZ: 0, rightX: -2.35, rightZ: -0.55 };
    return { ...pose, leftX: 0, rightX: 0 };
  }

  // A dodging character hops sideways and leans away, then settles back.
  private addDodge(character: Character, pose: Pose): void {
    const dodge = this.dodges.get(character.actor.id);
    if (!dodge) return;
    const progress = (this.time - dodge.startedAt) / DODGE_SECONDS;
    if (progress >= 1) this.dodges.delete(character.actor.id);
    if (progress < 0 || progress >= 1) return;
    const amount = Math.sin(progress * Math.PI);
    pose.sideStep = dodge.side * amount * 1.1;
    pose.lift += amount * 0.25;
    pose.leanSide = -dodge.side * amount * 0.35;
  }

  // Everything eases toward the pose, so switching between moves never snaps.
  private easePose(character: Character, pose: Pose, delta: number): void {
    const ease = 1 - Math.exp(-delta * 14);
    const { body, leftArm, rightArm, mouth } = character;
    leftArm.rotation.y = 0;
    rightArm.rotation.y = 0;
    leftArm.rotation.x += (pose.leftX - leftArm.rotation.x) * ease;
    leftArm.rotation.z += (pose.leftZ - leftArm.rotation.z) * ease;
    rightArm.rotation.x += (pose.rightX - rightArm.rotation.x) * ease;
    rightArm.rotation.z += (pose.rightZ - rightArm.rotation.z) * ease;
    body.position.x += (pose.sideStep - body.position.x) * ease;
    body.position.y += (pose.lift - body.position.y) * ease;
    body.rotation.x += (pose.leanForward - body.rotation.x) * ease;
    body.rotation.z += (pose.leanSide - body.rotation.z) * ease;
    // Turn the short way round, so finishing a spin never unwinds it.
    const twistLeft = Math.atan2(
      Math.sin(pose.twist - body.rotation.y),
      Math.cos(pose.twist - body.rotation.y),
    );
    body.rotation.y += twistLeft * ease;
    mouth.scale.y += (pose.mouth - mouth.scale.y) * ease;
  }

  private animateTomatoes(delta: number): void {
    for (const flying of [...this.tomatoes]) {
      const target = this.characters.get(flying.targetId);
      const progress = (this.time - flying.startedAt) / TOMATO_FLIGHT_SECONDS;
      if (!target || progress >= 1) {
        if (target) this.landTomato(flying, target);
        this.world.remove(flying.tomato);
        disposeObject(flying.tomato, new Set());
        this.tomatoes.splice(this.tomatoes.indexOf(flying), 1);
        continue;
      }
      const landing = flying.missLandsAt ?? this.headPosition(target);
      flying.tomato.position
        .lerpVectors(flying.from, landing, progress)
        .add(new THREE.Vector3(0, Math.sin(progress * Math.PI) * 1.6, 0));
      flying.tomato.rotation.x += delta * 12;
      flying.tomato.rotation.z += delta * 7;
    }
  }

  private landTomato(flying: FlyingTomato, target: Character): void {
    this.onTomatoSplat?.();
    if (flying.missLandsAt) {
      this.addFloorSplat(flying.missLandsAt);
      this.burst(flying.missLandsAt, [this.tomatoMaterial]);
      this.showEmote(flying.targetId, "😜", 0.65);
      return;
    }
    this.splat(target);
    this.burst(this.headPosition(target), [this.tomatoMaterial]);
  }

  private addFloorSplat(at: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.3 + Math.random() * 0.15, 20),
      this.tomatoMaterial,
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, at.y + 0.02, at.z);
    this.world.add(mesh);
    this.floorSplats.push({ mesh, startedAt: this.time });
  }

  // Floor splats shrink away in their last second.
  private animateFloorSplats(): void {
    for (const splat of [...this.floorSplats]) {
      const timeLeft = FLOOR_SPLAT_SECONDS - (this.time - splat.startedAt);
      if (timeLeft <= 0) {
        this.world.remove(splat.mesh);
        splat.mesh.geometry.dispose();
        this.floorSplats.splice(this.floorSplats.indexOf(splat), 1);
        continue;
      }
      splat.mesh.scale.setScalar(Math.min(1, timeLeft));
    }
  }

  private animateBursts(delta: number): void {
    for (const burst of [...this.bursts]) {
      const age = this.time - burst.startedAt;
      if (age >= BURST_SECONDS) {
        for (const piece of burst.pieces) {
          this.world.remove(piece);
          piece.geometry.dispose();
        }
        this.bursts.splice(this.bursts.indexOf(burst), 1);
        continue;
      }
      burst.pieces.forEach((piece, index) => {
        const velocity = burst.velocities[index];
        velocity.y -= 9.8 * delta;
        piece.position.addScaledVector(velocity, delta);
        piece.rotation.x += delta * 8;
        piece.scale.setScalar(1 - age / BURST_SECONDS);
      });
    }
  }

  private animateEmotes(): void {
    for (const emote of [...this.emotes]) {
      const character = this.characters.get(emote.characterId);
      const progress = (this.time - emote.startedAt) / EMOTE_SECONDS;
      if (!character || progress >= 1) {
        this.world.remove(emote.sprite);
        emote.sprite.material.map?.dispose();
        emote.sprite.material.dispose();
        this.emotes.splice(this.emotes.indexOf(emote), 1);
        continue;
      }
      emote.sprite.position
        .copy(this.headPosition(character))
        .add(new THREE.Vector3(0, 1.4 + (this.reducedMotion ? 0 : progress * 1.2), 0));
      emote.sprite.material.opacity = progress < 0.7 ? 1 : (1 - progress) / 0.3;
    }
  }

  public dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.canvas.removeEventListener("pointermove", this.onPointer);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    disposeObject(this.scene, new Set());
    disposeObject(this.guitar, new Set());
    this.renderer.dispose();
  }
}

function turnToward(current: number, target: number, maxStep: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.sign(difference) * Math.min(Math.abs(difference), maxStep);
}

// A small stable hash, so every screen turns the same text into the same number.
function hashText(text: string): number {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}
