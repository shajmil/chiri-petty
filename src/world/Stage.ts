import * as THREE from "three";
import type { StageEvent } from "../game/types";
import {
  box,
  buildCharacter,
  CHARACTER_SCALE,
  disposeObject,
  emojiSprite,
  HEAD_HEIGHT,
  HEAD_RADIUS,
  LEG_LENGTH,
  sphere,
  type Character,
  type SharedMaterials,
  type StageActor,
} from "./Character";

const MIC_SPOT = new THREE.Vector3(0, 0, 1.6);
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
  public closeUp = false;
  private readonly wideCamera = new THREE.Vector3();
  private wideLookHeight = 2.3;
  public reducedMotion = false;
  private isRoundFraming = false;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, innerWidth < 600 ? 1.25 : 1.75),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = innerWidth > 600;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x55594e, 3));
    const key = new THREE.DirectionalLight(0xfff4e2, 5);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 2);
    fill.position.set(-5, 4, -1);
    this.scene.add(fill);
    this.scene.add(this.world);
    this.materials = {
      ink: this.material(0x241e29),
      cream: this.material(0xffedc0),
      you: this.material(0xc6f24e),
    };
    this.tomatoMaterial = this.material(0xc8281e);
    this.buildRoom();
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

  private buildRoom(): void {
    this.scene.background = new THREE.Color(0x58362e);
    const wood = this.material(0xb76d3e);
    const { cream, ink } = this.materials;
    box(this.world, [22, 12, 0.2], [0, 4, -4], this.material(0x744538));
    for (let i = -10; i <= 10; i++)
      box(this.world, [0.97, 0.15, 15], [i, -0.1, 0], wood, 0.01);
    const rug = new THREE.Mesh(
      new THREE.CylinderGeometry(3.9, 3.9, 0.05, 64),
      this.material(0x287c79),
    );
    rug.position.set(0, 0.04, 0.4);
    this.world.add(rug);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.035, 8, 80), cream);
    edge.rotation.x = Math.PI / 2;
    edge.position.set(0, 0.08, 0.4);
    this.world.add(edge);
    for (let i = 0; i < 17; i++) {
      const x = -8 + i;
      const y = 5.7 - 0.3 * Math.cos(x * 0.65);
      sphere(this.world, 0.12, [x, y, -2], this.material(i % 2 ? 0xffc866 : 0xf39f9b));
    }
    const wire = new THREE.CatmullRomCurve3(
      Array.from({ length: 65 }, (_, i) => {
        const x = -8 + i / 4;
        return new THREE.Vector3(x, 5.84 - 0.3 * Math.cos(x * 0.65), -2);
      }),
    );
    this.world.add(new THREE.Mesh(new THREE.TubeGeometry(wire, 80, 0.018, 6, false), ink));
    for (const side of [-1, 1]) {
      box(this.world, [0.9, 7, 0.65], [side * 7, 3, -2.5], this.material(0x9c3c4a));
      for (const height of [1.9, 3.3]) {
        box(this.world, [2.2, 0.12, 0.7], [side * 5, height, -3.5], wood);
        for (let n = 0; n < 3; n++)
          sphere(
            this.world,
            0.25,
            [side * 5 - 0.7 + n * 0.7, height + 0.32, -3.4],
            this.material([0xf6ba55, 0x5da79a, 0xe7787f][n]),
          );
      }
    }
    box(this.world, [7, 0.5, 1.4], [0, 0.25, -2.7], this.material(0x8a5233), 0.05);
    const microphone = new THREE.Group();
    microphone.position.set(-0.85, 0, MIC_SPOT.z + 0.75);
    box(microphone, [0.08, 1.9, 0.08], [0, 0.95, 0], ink);
    box(microphone, [0.5, 0.08, 0.4], [0, 0.04, 0], ink);
    box(microphone, [0.26, 0.46, 0.26], [0, 2.05, 0], cream, 0.12);
    for (let i = 0; i < 4; i++)
      box(microphone, [0.22, 0.02, 0.03], [0, 1.92 + i * 0.08, 0.13], ink, 0.005);
    this.world.add(microphone);
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
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), this.tomatoMaterial);
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
    const halfWidthToShow = 5.8;
    const distance = halfWidthToShow / (Math.tan((17.5 * Math.PI) / 180) * this.camera.aspect);
    // During rounds text covers the top of the stage, so aim higher to keep the cast in the lower part.
    // Wide laptop panels can aim highest; tall phone panels already have room above the cast.
    const lookAtHeight = !this.isRoundFraming ? 2.3 : this.camera.aspect >= 1.2 ? 3.8 : 2.9;
    const minimumDistance = this.isRoundFraming && this.camera.aspect < 1.2 ? 14 : 13.5;
    this.camera.position.set(0, 4.6, Math.min(34, Math.max(minimumDistance, distance)));
    this.wideCamera.copy(this.camera.position);
    this.wideLookHeight = lookAtHeight;
    this.camera.lookAt(0, lookAtHeight, 0);
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
    this.castOrder.forEach((id, index) => {
      const character = this.characters.get(id);
      if (character) this.animateCharacter(character, index, delta);
    });
    this.animateTomatoes();
    this.animateEmotes();
    const focus = this.characters.get(this.performerId)?.root.position;
    const targetCamera = this.closeUp && focus
      ? new THREE.Vector3(focus.x, 3.1, focus.z + 7)
      : this.wideCamera;
    this.camera.position.lerp(targetCamera, this.reducedMotion ? 1 : Math.min(1, delta * 3));
    this.camera.lookAt(this.closeUp && focus ? focus.x : 0, this.closeUp ? 2.5 : this.wideLookHeight, this.closeUp && focus ? focus.z : 0);
    this.renderer.render(this.scene, this.camera);
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
    character.body.position.y = this.reducedMotion ? 0 : Math.sin(this.time * 2 + index) * 0.02;
    const armSwing = -legSwing * 0.8;
    // A talking performer gestures with the arm away from the mic.
    const gesture = isTalking ? -this.level * 1.4 : 0;
    character.leftArm.rotation.set(armSwing, 0, 0);
    character.rightArm.rotation.set(-armSwing + gesture, 0, 0);
  }

  private animateTomatoes(): void {
    for (const tomato of [...this.tomatoes]) {
      const target = this.characters.get(tomato.targetId);
      const progress = (this.time - tomato.startedAt) / TOMATO_FLIGHT_SECONDS;
      if (!target || progress >= 1) {
        if (target) this.splat(target);
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
