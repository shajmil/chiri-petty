import * as THREE from "three";

function material(color: number, roughness = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** An acoustic guitar a performer sometimes plays, sized for a character's hands. */
export function buildGuitar(): THREE.Group {
  const guitar = new THREE.Group();
  const wood = material(0xc9732f, 0.45);
  const dark = material(0x3b2214, 0.5);
  const lowerBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 28), wood);
  lowerBody.rotation.x = Math.PI / 2;
  const upperBody = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.16, 28), wood);
  upperBody.rotation.x = Math.PI / 2;
  upperBody.position.y = 0.42;
  const soundHole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.17, 20), dark);
  soundHole.rotation.x = Math.PI / 2;
  soundHole.position.y = 0.2;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.07), dark);
  neck.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.08), wood);
  head.position.y = 1.6;
  guitar.add(lowerBody, upperBody, soundHole, neck, head);
  for (const mesh of [lowerBody, upperBody, neck, head]) mesh.castShadow = true;
  // Held across the belly with the neck rising to the player's left, away from the mic stand,
  // at the angle where the fretting hand lands near the top of the neck.
  guitar.position.set(-0.15, 1.45, 0.55);
  guitar.rotation.set(0, 0, -1.135);
  guitar.scale.setScalar(1.1);
  return guitar;
}

/** A shiny tomato with a little green crown of leaves. */
export function buildTomato(): THREE.Group {
  const tomato = new THREE.Group();
  const flesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xd6281c, roughness: 0.25 }),
  );
  flesh.scale.y = 0.85;
  flesh.castShadow = true;
  tomato.add(flesh);
  const leaf = material(0x2f8f3a);
  for (let index = 0; index < 5; index++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), leaf);
    const angle = (index / 5) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 0.08, 0.22, Math.sin(angle) * 0.08);
    blade.rotation.set(Math.sin(angle) * 1.2, 0, -Math.cos(angle) * 1.2);
    tomato.add(blade);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.12, 6), leaf);
  stem.position.y = 0.28;
  tomato.add(stem);
  return tomato;
}

export interface Burst {
  pieces: THREE.Mesh[];
  velocities: THREE.Vector3[];
  startedAt: number;
}

/** A burst of tomato juice or confetti that flies out and falls with gravity. */
export function buildBurst(
  at: THREE.Vector3,
  materials: THREE.Material[],
  startedAt: number,
): Burst {
  const pieces: THREE.Mesh[] = [];
  const velocities: THREE.Vector3[] = [];
  for (let index = 0; index < 14; index++) {
    const size = 0.05 + Math.random() * 0.05;
    const piece = new THREE.Mesh(
      new THREE.SphereGeometry(size, 8, 6),
      materials[index % materials.length],
    );
    piece.position.copy(at);
    pieces.push(piece);
    const angle = Math.random() * Math.PI * 2;
    // Pieces lean toward the camera so the burst reads clearly from the front.
    velocities.push(
      new THREE.Vector3(Math.cos(angle) * 2.2, 1.5 + Math.random() * 2, Math.sin(angle) * 1.2 + 1),
    );
  }
  return { pieces, velocities, startedAt };
}
