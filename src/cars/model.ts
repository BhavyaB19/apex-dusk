import * as THREE from 'three';

export interface CarModel {
  root: THREE.Group;
  /** Body, rolls and pitches independently of the wheels. */
  chassis: THREE.Group;
  wheels: THREE.Object3D[];
  steerPivots: THREE.Group[];
  flames: THREE.Mesh[];
  tailMat: THREE.MeshBasicMaterial;
}

let glowTex: THREE.CanvasTexture | null = null;
function underglowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}

/** Extrudes a side profile (x = length, y = height) across the car's width. Forward is +Z. */
function extrudeProfile(points: Array<[number, number]>, width: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export function buildCar(paintHex: number, accent: [number, number, number]): CarModel {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paint = new THREE.MeshPhysicalMaterial({
    color: paintHex,
    metalness: 0.65,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.5,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x05070d,
    metalness: 1,
    roughness: 0.08,
    envMapIntensity: 0.9,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.6, metalness: 0.4 });
  const accentMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(accent[0], accent[1], accent[2]) });

  const add = (mesh: THREE.Mesh, parent: THREE.Object3D = chassis, shadow = true): THREE.Mesh => {
    mesh.castShadow = shadow;
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };

  // Main body: a low wedge.
  add(
    new THREE.Mesh(
      extrudeProfile(
        [
          [-2.15, 0.3],
          [-2.2, 0.64],
          [-2.05, 0.88],
          [-1.1, 0.85],
          [0.55, 0.77],
          [1.55, 0.62],
          [2.12, 0.46],
          [2.22, 0.31],
          [2.0, 0.2],
          [-1.95, 0.2],
        ],
        1.72,
        0.1,
      ),
      paint,
    ),
  );
  // Canopy
  add(
    new THREE.Mesh(
      extrudeProfile(
        [
          [-1.5, 0.8],
          [-0.72, 1.15],
          [0.02, 1.17],
          [0.88, 0.74],
          [-1.5, 0.74],
        ],
        1.3,
        0.07,
      ),
      glass,
    ),
  );
  add(box(1.02, 0.035, 0.95, paint, 0, 1.175, -0.36));

  // Wide arches over the wheels
  for (const sx of [-1, 1]) {
    add(box(0.36, 0.2, 1.15, paint, sx * 0.9, 0.7, 1.32));
    add(box(0.38, 0.24, 1.2, paint, sx * 0.9, 0.74, -1.32));
    // Side intake and skirt light
    add(box(0.06, 0.2, 0.7, trim, sx * 0.87, 0.5, -0.45));
    add(box(0.035, 0.045, 2.2, accentMat, sx * 0.875, 0.26, 0), chassis, false);
  }

  // Aero
  add(box(1.86, 0.05, 0.42, trim, 0, 0.19, 2.08));
  add(box(1.7, 0.1, 0.4, trim, 0, 0.24, -2.02));
  add(box(1.86, 0.05, 0.4, paint, 0, 1.2, -1.98));
  for (const sx of [-1, 1]) {
    add(box(0.06, 0.34, 0.24, trim, sx * 0.62, 1.03, -1.96));
    add(box(0.05, 0.22, 0.46, paint, sx * 0.93, 1.25, -1.98));
  }

  // Lights
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.2, 2.9, 2.3) });
  for (const sx of [-1, 1]) add(box(0.42, 0.07, 0.1, headMat, sx * 0.58, 0.5, 2.1), chassis, false);
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(2.4, 0.1, 0.18) });
  add(box(1.6, 0.07, 0.06, tailMat, 0, 0.72, -2.2), chassis, false);

  // Exhaust flames, shown only while boosting
  const flames: THREE.Mesh[] = [];
  const flameGeo = new THREE.ConeGeometry(0.13, 1.4, 8, 1, true);
  flameGeo.translate(0, 0.7, 0);
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.6, 1.8, 3.4),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const sx of [-1, 1]) {
    add(box(0.2, 0.12, 0.2, trim, sx * 0.42, 0.34, -2.14));
    const fl = new THREE.Mesh(flameGeo, flameMat);
    fl.position.set(sx * 0.42, 0.34, -2.24);
    fl.visible = false;
    chassis.add(fl);
    flames.push(fl);
  }

  // Wheels
  const tireGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.32, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.85 });
  const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.33, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0b0, roughness: 0.3, metalness: 0.9 });
  const spokeGeo = new THREE.BoxGeometry(0.34, 0.46, 0.07);
  const ringGeo = new THREE.TorusGeometry(0.27, 0.022, 6, 22);
  ringGeo.rotateY(Math.PI / 2);

  const wheels: THREE.Object3D[] = [];
  const steerPivots: THREE.Group[] = [];
  const spots: Array<[number, number, boolean]> = [
    [0.9, 1.34, true],
    [-0.9, 1.34, true],
    [0.9, -1.34, false],
    [-0.9, -1.34, false],
  ];
  for (const [x, z, front] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.37, z);
    root.add(pivot);
    const wheel = new THREE.Group();
    pivot.add(wheel);
    add(new THREE.Mesh(tireGeo, tireMat), wheel);
    add(new THREE.Mesh(rimGeo, rimMat), wheel, false);
    const s1 = add(new THREE.Mesh(spokeGeo, trim), wheel, false);
    const s2 = add(new THREE.Mesh(spokeGeo, trim), wheel, false);
    s2.rotation.x = Math.PI / 2;
    s1.scale.x = s2.scale.x = 1.01;
    const ring = new THREE.Mesh(ringGeo, accentMat);
    ring.position.x = Math.sign(x) * 0.165;
    wheel.add(ring);
    wheels.push(wheel);
    if (front) steerPivots.push(pivot);
  }

  // Underglow
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 6.2),
    new THREE.MeshBasicMaterial({
      map: underglowTexture(),
      color: new THREE.Color().setRGB(accent[0] * 0.5, accent[1] * 0.5, accent[2] * 0.5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.07;
  root.add(glow);

  return { root, chassis, wheels, steerPivots, flames, tailMat };
}
