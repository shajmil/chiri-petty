import * as THREE from "three";
import { BRAND } from "../game/prompts";
import { box, type SharedMaterials } from "./Character";

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
}

/** A small seeded random generator so the paint splatter looks the same on every device. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function drawGraffiti(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d")!;
  const random = seededRandom(7);
  context.clearRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 90; index++) {
    context.fillStyle = ["#ffd34d", "#ff4f8b", "#7ee0d0", "#c6f24e"][index % 4];
    context.globalAlpha = 0.25 + random() * 0.5;
    context.beginPath();
    context.arc(random() * 1024, random() * 512, 2 + random() * 9, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;

  const [firstWord, ...otherWords] = BRAND.name.toUpperCase().split(" ");
  const lines = [
    { text: firstWord, color: "#ffd34d", y: 175, tilt: -0.05 },
    { text: otherWords.join(" "), color: "#ff4f8b", y: 330, tilt: 0.03 },
  ];
  for (const line of lines) {
    context.save();
    context.translate(512, line.y);
    context.rotate(line.tilt);
    context.font = "900 168px 'Arial Black', Impact, 'Anek Malayalam', sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 30;
    context.strokeStyle = "#2a0f1f";
    context.strokeText(line.text, 0, 0, 940);
    context.fillStyle = line.color;
    context.fillText(line.text, 0, 0, 940);
    // Paint drips running down from the letters.
    const width = Math.min(940, context.measureText(line.text).width);
    for (let drip = 0; drip < 7; drip++) {
      const x = -width / 2 + random() * width;
      const length = 18 + random() * 50;
      context.beginPath();
      context.roundRect(x, 55, 9, length, 5);
      context.fill();
    }
    context.restore();
  }

  context.font = "600 64px 'Anek Malayalam', sans-serif";
  context.textAlign = "center";
  context.fillStyle = "#fff2d7";
  context.fillText(BRAND.malayalam, 512, 470, 900);
}

/** The game logo sprayed on the back wall. */
function wallLogo(): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  drawGraffiti(canvas);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Redraw once web fonts are ready so the Malayalam line uses Anek Malayalam.
  void document.fonts?.ready.then(() => {
    drawGraffiti(canvas);
    texture.needsUpdate = true;
  });
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(8.4, 4.2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, color: 0xe6e6e6 }),
  );
  logo.position.set(0, 4.3, -3.88);
  return logo;
}

function speaker(side: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(side * 4.9, 0, -2.4);
  group.rotation.y = -side * 0.35;
  const cabinet = material(0x8fb0d6);
  const cone = material(0x34405c);
  const rim = material(0x1f2638);
  box(group, [1.5, 2.4, 1.1], [0, 1.2, 0], cabinet, 0.14);
  for (const [height, radius] of [
    [0.85, 0.44],
    [1.75, 0.27],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.07, 10, 32), rim);
    ring.position.set(0, height, 0.56);
    group.add(ring);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.6, 0.12, 32), cone);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(0, height, 0.5);
    group.add(disc);
  }
  return group;
}

/**
 * The stage: a dark wall with the graffiti logo, speakers either side, a warm wooden floor
 * lit by a spotlight at the mic, the back riser and the mic stand.
 * Returns the logo so the home page can hide it behind its own big title.
 */
export function buildRoom(
  scene: THREE.Scene,
  world: THREE.Group,
  materials: SharedMaterials,
  micPosition: THREE.Vector3,
): THREE.Mesh {
  scene.background = new THREE.Color(0x2b1714);
  box(world, [24, 12, 0.2], [0, 4, -4], material(0x3d211d));
  box(world, [24, 0.35, 0.3], [0, 0.1, -3.85], material(0x2a1613), 0.04);
  const logo = wallLogo();
  world.add(logo);

  const darkPlank = material(0x8f4c24);
  const lightPlank = material(0x9c5428);
  for (let index = -11; index <= 11; index++)
    box(world, [0.96, 0.15, 15], [index, -0.1, 0], index % 2 ? darkPlank : lightPlank, 0.01);

  for (const side of [-1, 1]) world.add(speaker(side));
  box(world, [7, 0.5, 1.4], [0, 0.25, -2.7], material(0x6b3a22), 0.05);

  const spotlight = new THREE.SpotLight(0xffb36b, 90, 0, 0.5, 0.75, 1.6);
  spotlight.position.set(0, 9, 6);
  spotlight.target.position.set(0, 0, micPosition.z - 0.3);
  scene.add(spotlight, spotlight.target);

  const { cream, ink } = materials;
  const microphone = new THREE.Group();
  microphone.position.set(micPosition.x, 0, micPosition.z);
  box(microphone, [0.08, 1.9, 0.08], [0, 0.95, 0], ink);
  box(microphone, [0.5, 0.08, 0.4], [0, 0.04, 0], ink);
  box(microphone, [0.26, 0.46, 0.26], [0, 2.05, 0], cream, 0.12);
  for (let index = 0; index < 4; index++)
    box(microphone, [0.22, 0.02, 0.03], [0, 1.92 + index * 0.08, 0.13], ink, 0.005);
  world.add(microphone);
  return logo;
}
