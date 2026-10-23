import * as THREE from "three";
import type { StageEvent } from "../game/types";
import { buildRoom } from "./Room";
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

export type CameraShot = "wide" | "portrait" | "medium";

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

// The mic stand is on the performer's left, so the left hand holds it in most moves.
const PERFORMANCE_MOVES: StageMove[] = [
  { leftX: -1.35, leftZ: -0.15, rightX: -0.4, rightZ: 0.7, sway: 0, bounce: 0.05 }, // hold the mic, other hand open
  { leftX: -1.35, leftZ: -0.15, rightX: -2.35, rightZ: -0.55, sway: 0, bounce: 0.03 }, // hand to face
  { leftX: -1.35, leftZ: -0.15, rightX: -2.9, rightZ: 0.25, sway: 0, bounce: 0.12 }, // arm raised
  { leftX: -0.3, leftZ: -1.15, rightX: -0.3, rightZ: 1.15, sway: 0, bounce: 0.06 }, // arms wide
  { leftX: -1.35, leftZ: -0.15, rightX: -0.2, rightZ: 0.25, sway: 0.14, bounce: 0.04 }, // sway
];
const MOVE_SECONDS = 1.6;
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
const ACCELERATION = 7;
const LEG_SWING = 0.55;
// One step covers the distance the feet travel at full swing, so feet never slide.
const STEP_LENGTH = 2 * LEG_LENGTH * CHARACTER_SCALE * Math.sin(LEG_SWING);
const DANCE_SECONDS = 3;
const TOMATO_FLIGHT_SECONDS = 0.75;
const EMOTE_SECONDS = 2.2;
const MAX_SPLATS = 8;

interface FlyingTomato {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  targetId: string;
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
  private readonly emotes: FloatingEmote[] = [];
  private readonly tomatoMaterial: THREE.MeshStandardMaterial;
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
  /** Which character the camera frames, and how closely. */
  public focusId = "";
  public shot: CameraShot = "wide";
  private readonly wideCamera = new THREE.Vector3();
  private readonly wideLook = new THREE.Vector3();
  private readonly cameraGoal = new THREE.Vector3();
  private readonly lookGoal = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private hasFramed = false;
  private readonly wallLogo: THREE.Mesh;
  /** The home page shows its own big title, so it hides the wall logo. */
  public showWallLogo = true;
  public onTomatoHit: (() => void) | null = null;
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
    this.tomatoMaterial = this.material(0xc8281e);
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

  public showEvents(events: StageEvent[], now: number): void {
    for (const event of events) {
      if (this.seenEventIds.has(event.id)) continue;
      // Events older than a few seconds happened before this stage opened.
      if (now - event.at > 3000) continue;
      if (event.kind === "dance") this.startDance(event.playerId);
      if (event.kind === "emote") this.showEmote(event.playerId, event.emote);
      if (event.kind === "tomato") this.throwTomato(event.playerId, event.targetId);
    }
    this.seenEventIds = new Set(events.map((event) => event.id));
  }

  private startDance(playerId: string): void {
    const character = this.characters.get(playerId);
    if (character) character.danceStartedAt = this.time;
  }

  private showEmote(playerId: string, emote: string): void {
    if (!this.characters.has(playerId)) return;
    const sprite = emojiSprite(emote);
    this.world.add(sprite);
    this.emotes.push({ sprite, characterId: playerId, startedAt: this.time });
  }

  private headPosition(character: Character): THREE.Vector3 {
    return character.root.position
      .clone()
      .add(new THREE.Vector3(0, (HEAD_HEIGHT + character.body.position.y) * CHARACTER_SCALE, 0));
  }

  private throwTomato(throwerId: string, targetId: string): void {
    const thrower = this.characters.get(throwerId);
    const target = this.characters.get(targetId);
    if (!target) return;
    if (this.reducedMotion) {
      this.splat(target);
      return;
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 14), this.tomatoMaterial);
    mesh.castShadow = true;
    const from = thrower
      ? this.headPosition(thrower)
      : new THREE.Vector3((Math.random() - 0.5) * 6, 0.5, 6);
    mesh.position.copy(from);
    this.world.add(mesh);
    this.tomatoes.push({ mesh, from, targetId, startedAt: this.time });
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
    target.body.add(mesh);
    target.splats.push(mesh);
  }

  private clearSplats(character: Character): void {
    for (const mesh of character.splats) {
      character.body.remove(mesh);
      mesh.geometry.dispose();
    }
    character.splats = [];
  }

  private sharedMaterials(): Set<THREE.Material> {
    return new Set([...Object.values(this.materials), this.tomatoMaterial]);
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
    // Name labels would fill the screen in a close portrait, and the framed performer's name
    // is already shown as the heading, so those labels hide.
    const showLabels = this.shot !== "portrait" || this.reducedMotion;
    this.castOrder.forEach((id, index) => {
      const character = this.characters.get(id);
      if (!character) return;
      if (character.label)
        character.label.visible =
          showLabels && !(this.shot === "medium" && id === this.focusId && !this.reducedMotion);
      this.animateCharacter(character, index, delta);
    });
    this.animateTomatoes();
    this.animateEmotes();
    this.wallLogo.visible = this.showWallLogo;
    this.moveCamera(delta);
    this.renderer.render(this.scene, this.camera);
  }

  private moveCamera(delta: number): void {
    const focus = this.characters.get(this.focusId);
    if (this.shot === "wide" || !focus || this.reducedMotion) {
      this.cameraGoal.copy(this.wideCamera);
      this.lookGoal.copy(this.wideLook);
    } else {
      const isPortrait = this.shot === "portrait";
      const tanHalfFov = Math.tan((this.camera.fov * Math.PI) / 360);
      // A portrait frames the face with the mic head beside it; a medium shot frames the whole performer.
      const subject = focus.root.position.clone();
      subject.x -= isPortrait ? 0.3 : 0.2;
      subject.y += (isPortrait ? HEAD_HEIGHT : 1.9) * CHARACTER_SCALE;
      const halfWidthNeeded = isPortrait ? 1.5 : 2.8;
      const distance = Math.max(
        isPortrait ? 3.8 : 6.5,
        halfWidthNeeded / (tanHalfFov * this.camera.aspect),
      );
      // Text sits over the top of the stage, so keep the subject in the lower part of the frame.
      const lift = distance * tanHalfFov * 0.42;
      this.lookGoal.set(subject.x, subject.y + lift, subject.z);
      this.cameraGoal.set(subject.x, subject.y + lift + 0.3, subject.z + distance);
    }
    // Exponential easing: quick to start, gentle to settle, and the same speed at any frame rate.
    const ease = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 4.5);
    this.camera.position.lerp(this.cameraGoal, ease);
    this.currentLook.lerp(this.lookGoal, ease);
    this.camera.lookAt(this.currentLook);
  }

  private animateCharacter(character: Character, index: number, delta: number): void {
    const isPerformer = character.actor.id === this.performerId;
    const target = isPerformer ? MIC_SPOT : this.slotPosition(index);
    const position = character.root.position;
    const toTarget = new THREE.Vector3(target.x - position.x, 0, target.z - position.z);
    const distance = toTarget.length();

    // Speed up toward walking pace and brake smoothly so the character stops on its mark.
    const desiredSpeed = distance < 0.01 ? 0 : Math.min(WALK_SPEED, Math.sqrt(2 * ACCELERATION * distance));
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

    const isTalking = character.actor.id === this.talkingId && distance < 0.2;
    const mouthOpen = isTalking
      ? 0.3 + this.level * 2 + Math.abs(Math.sin(this.time * 8)) * this.level
      : this.chorus
        ? 0.3 + Math.abs(Math.sin(this.time * 7 + index)) * 0.5
        : 0.3;
    character.mouth.scale.y = this.reducedMotion ? Math.min(mouthOpen, 0.8) : mouthOpen;

    const danceProgress = (this.time - character.danceStartedAt) / DANCE_SECONDS;
    const isDancing = danceProgress >= 0 && danceProgress < 1;
    if (isDancing) {
      const beat = this.time * 9;
      character.body.position.y = this.reducedMotion ? 0 : Math.abs(Math.sin(beat)) * 0.35;
      character.body.rotation.y = this.reducedMotion ? 0 : danceProgress * Math.PI * 2;
      character.leftArm.rotation.set(0, 0, -2.5 - Math.sin(beat) * 0.35);
      character.rightArm.rotation.set(0, 0, 2.5 - Math.sin(beat + 1) * 0.35);
      if (!isWalking) {
        character.leftLeg.rotation.x = Math.max(0, Math.sin(beat)) * 0.4;
        character.rightLeg.rotation.x = Math.max(0, -Math.sin(beat)) * 0.4;
      }
      return;
    }
    character.body.rotation.y = 0;
    if (isTalking && !this.reducedMotion) {
      this.perform(character, index, delta);
      return;
    }
    character.body.rotation.x = 0;
    character.body.rotation.z = 0;
    character.body.position.y = this.reducedMotion ? 0 : Math.sin(this.time * 2 + index) * 0.02;
    // While someone sings, the audience claps in bursts, each person at a different moment.
    const isClapping =
      Boolean(this.talkingId) &&
      !isWalking &&
      !this.reducedMotion &&
      Math.sin(this.time * 0.9 + index * 1.7) > 0.55;
    const clap = Math.sin(this.time * 14) * 0.25;
    const armSwing = -legSwing * 0.8;
    this.easeArms(
      character,
      isClapping
        ? { leftX: -1, leftZ: 0.45 + clap, rightX: -1, rightZ: -0.45 - clap }
        : { leftX: armSwing, leftZ: 0, rightX: -armSwing, rightZ: 0 },
      delta,
    );
  }

  // A singing performer cycles through stage moves; a louder voice makes bigger moves.
  private perform(character: Character, index: number, delta: number): void {
    const move =
      PERFORMANCE_MOVES[Math.floor(this.time / MOVE_SECONDS + index) % PERFORMANCE_MOVES.length];
    const energy = 0.55 + Math.min(1, this.level * 1.8) * 0.45;
    this.easeArms(
      character,
      {
        leftX: move.leftX * energy,
        leftZ: move.leftZ * energy,
        rightX: move.rightX * energy,
        rightZ: move.rightZ * energy,
      },
      delta,
    );
    character.body.rotation.z = Math.sin(this.time * 3) * move.sway;
    character.body.rotation.x = Math.sin(this.time * 5) * 0.05 * this.level;
    character.body.position.y = Math.abs(Math.sin(this.time * 6)) * move.bounce * (0.5 + this.level);
  }

  // Arms ease toward each pose, so switching moves never snaps.
  private easeArms(character: Character, pose: ArmPose, delta: number): void {
    const ease = 1 - Math.exp(-delta * 14);
    const { leftArm, rightArm } = character;
    leftArm.rotation.y = 0;
    rightArm.rotation.y = 0;
    leftArm.rotation.x += (pose.leftX - leftArm.rotation.x) * ease;
    leftArm.rotation.z += (pose.leftZ - leftArm.rotation.z) * ease;
    rightArm.rotation.x += (pose.rightX - rightArm.rotation.x) * ease;
    rightArm.rotation.z += (pose.rightZ - rightArm.rotation.z) * ease;
  }

  private animateTomatoes(): void {
    for (const tomato of [...this.tomatoes]) {
      const target = this.characters.get(tomato.targetId);
      const progress = (this.time - tomato.startedAt) / TOMATO_FLIGHT_SECONDS;
      if (!target || progress >= 1) {
        if (target) {
          this.splat(target);
          this.onTomatoHit?.();
        }
        this.world.remove(tomato.mesh);
        tomato.mesh.geometry.dispose();
        this.tomatoes.splice(this.tomatoes.indexOf(tomato), 1);
        continue;
      }
      tomato.mesh.position
        .lerpVectors(tomato.from, this.headPosition(target), progress)
        .add(new THREE.Vector3(0, Math.sin(progress * Math.PI) * 1.6, 0));
      tomato.mesh.rotation.x += 0.3;
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
    this.renderer.dispose();
  }
}

function turnToward(current: number, target: number, maxStep: number): number {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.sign(difference) * Math.min(Math.abs(difference), maxStep);
}
