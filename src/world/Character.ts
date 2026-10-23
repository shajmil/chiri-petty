import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CHARACTER_LOOKS, type CharacterLook } from "../game/prompts";

export interface StageActor {
  id: string;
  name: string;
  color: string;
  /** Index into CHARACTER_LOOKS, the same as the player's avatar choice. */
  look: number;
  isYou: boolean;
}

export interface Character {
  actor: StageActor;
  root: THREE.Group;
  body: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  mouth: THREE.Mesh;
  shirt: THREE.MeshStandardMaterial;
  speed: number;
  stridePhase: number;
  danceStartedAt: number;
  splats: THREE.Mesh[];
}

export interface SharedMaterials {
  ink: THREE.Material;
  cream: THREE.Material;
  you: THREE.Material;
}

export const CHARACTER_SCALE = 0.8;
export const HEAD_HEIGHT = 2.85;
export const HEAD_RADIUS = 0.68;
export const LEG_LENGTH = 0.8;

export function box(
  parent: THREE.Object3D,
  size: number[],
  position: number[],
  material: THREE.Material,
  radius = 0.08,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius),
    material,
  );
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function sphere(
  parent: THREE.Object3D,
  radius: number,
  position: number[],
  material: THREE.Material,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// Legs and arms hang from pivot groups at the hip and shoulder so they can swing.
function limb(parent: THREE.Object3D, position: number[]): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(position[0], position[1], position[2]);
  parent.add(pivot);
  return pivot;
}

function material(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
}

function addHair(body: THREE.Group, look: CharacterLook, hair: THREE.Material): void {
  const cap = sphere(body, 0.7, [0, 3.2, -0.07], hair);
  cap.scale.y = look.hairStyle === "band" ? 0.38 : 0.45;
  if (look.hairStyle === "spiky") {
    for (let index = 0; index < 5; index++) {
      const angle = -0.9 + index * 0.45;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 8), hair);
      spike.position.set(Math.sin(angle) * 0.45, 3.42, Math.cos(angle) * 0.1 - 0.05);
      spike.rotation.z = -angle * 0.6;
      body.add(spike);
    }
  }
  if (look.hairStyle === "long") {
    box(body, [1.2, 1.15, 0.26], [0, 2.6, -0.45], hair, 0.12);
    for (const side of [-1, 1]) box(body, [0.2, 0.95, 0.55], [side * 0.64, 2.62, -0.12], hair, 0.08);
  }
  if (look.hairStyle === "bun") sphere(body, 0.28, [0, 3.58, -0.22], hair);
  if (look.hairStyle === "curly") {
    for (let index = 0; index < 9; index++) {
      const angle = (index / 9) * Math.PI * 2;
      sphere(body, 0.27, [Math.cos(angle) * 0.5, 3.28 + (index % 2) * 0.12, Math.sin(angle) * 0.42 - 0.08], hair);
    }
    sphere(body, 0.32, [0, 3.48, -0.05], hair);
  }
  if (look.hairStyle === "band") {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.07, 8, 40), material("#d9372b"));
    band.rotation.x = Math.PI / 2 - 0.12;
    band.position.set(0, 3.12, 0);
    body.add(band);
  }
}

function addOutfit(
  body: THREE.Group,
  look: CharacterLook,
  pants: THREE.Material,
  cream: THREE.Material,
): void {
  if (look.outfit === "placket" || look.outfit === "border")
    box(body, [0.23, 0.95, 0.06], [0.25, 1.7, 0.33], cream);
  if (look.outfit === "patch") box(body, [0.55, 0.45, 0.06], [0, 1.75, 0.33], material("#f6ba55"));
  if (look.outfit === "collar") box(body, [0.78, 0.16, 0.64], [0, 2.22, 0], cream, 0.06);
  if (look.outfit === "stripes")
    for (const height of [1.42, 1.86]) box(body, [1.03, 0.11, 0.63], [0, height, 0], cream, 0.04);
  if (look.outfit === "straps")
    for (const side of [-1, 1]) box(body, [0.15, 1.22, 0.64], [side * 0.27, 1.65, 0], pants, 0.04);
}

export function buildCharacter(
  actor: StageActor,
  materials: SharedMaterials,
): Character {
  const look = CHARACTER_LOOKS[actor.look % CHARACTER_LOOKS.length];
  const shirt = material(actor.color);
  const skin = material(look.skin);
  const hair = material(look.hair);
  const pants = material(look.pants);
  const shoes = material(look.shoes);
  const root = new THREE.Group();
  root.scale.setScalar(CHARACTER_SCALE);
  const body = new THREE.Group();
  root.add(body);

  box(body, [1, 1.2, 0.6], [0, 1.65, 0], shirt, 0.25);
  addOutfit(body, look, pants, materials.cream);
  sphere(body, HEAD_RADIUS, [0, HEAD_HEIGHT, 0], skin);
  addHair(body, look, hair);
  sphere(body, 0.1, [0, 2.78, 0.72], skin);
  const mouth = sphere(body, 0.2, [0, 2.55, 0.61], materials.ink);
  mouth.scale.set(1, 0.3, 0.3);
  if (look.moustache) box(body, [0.42, 0.09, 0.08], [0, 2.67, 0.66], hair, 0.04);

  const legs: THREE.Group[] = [];
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    sphere(body, 0.14, [side * 0.66, HEAD_HEIGHT, 0], skin);
    sphere(body, 0.19, [side * 0.25, 2.95, 0.59], materials.cream);
    sphere(body, 0.09, [side * 0.25, 2.94, 0.75], materials.ink);
    if (look.glasses) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24), materials.ink);
      lens.position.set(side * 0.25, 2.95, 0.78);
      body.add(lens);
    }

    const leg = limb(body, [side * 0.28, LEG_LENGTH + 0.22, 0]);
    box(leg, [0.28, LEG_LENGTH, 0.3], [0, -LEG_LENGTH / 2, 0], pants);
    if (look.outfit === "border")
      box(leg, [0.3, 0.08, 0.32], [0, -LEG_LENGTH + 0.1, 0], material("#e2b33c"), 0.02);
    box(leg, [0.43, 0.2, 0.7], [0, -LEG_LENGTH - 0.07, 0.18], shoes);
    legs.push(leg);

    const arm = limb(body, [side * 0.6, 2.0, 0]);
    const sleeve = box(arm, [0.25, 0.9, 0.3], [side * 0.05, -0.45, 0], shirt);
    sleeve.rotation.z = side * 0.2;
    sphere(arm, 0.18, [side * 0.14, -0.92, 0], skin);
    arms.push(arm);
  }
  if (look.glasses) box(body, [0.12, 0.04, 0.04], [0, 2.97, 0.8], materials.ink, 0.01);

  if (actor.isYou) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.06, 8, 40),
      materials.you,
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    root.add(ring);
  }
  if (actor.name) root.add(labelSprite(actor.name, actor.isYou));

  return {
    actor,
    root,
    body,
    leftLeg: legs[0],
    rightLeg: legs[1],
    leftArm: arms[0],
    rightArm: arms[1],
    mouth,
    shirt,
    speed: 0,
    stridePhase: 0,
    danceStartedAt: -100,
    splats: [],
  };
}

function labelSprite(name: string, isYou: boolean): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = isYou ? "#c6f24e" : "rgba(36, 29, 42, 0.88)";
  context.beginPath();
  context.roundRect(4, 8, 248, 48, 24);
  context.fill();
  context.fillStyle = isYou ? "#171917" : "#fff2d7";
  context.font = "600 28px 'Anek Malayalam', Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(isYou ? `${name} (you)` : name, 128, 34, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }));
  label.scale.set(2, 0.5, 1);
  label.position.y = 4.2;
  return label;
}

export function emojiSprite(emoji: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.font =
    "92px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(emoji, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.setScalar(0.9);
  return sprite;
}

export function disposeObject(object: THREE.Object3D, keep: Set<THREE.Material>): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (!keep.has(material)) material.dispose();
      });
    }
    if (child instanceof THREE.Sprite) {
      child.material.map?.dispose();
      child.material.dispose();
    }
  });
}
