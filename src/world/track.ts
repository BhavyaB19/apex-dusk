import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/math';
import { disposeTree } from '../core/dispose';
import type { TrackDef } from './tracks';

export const ROAD_HALF = 8;
export const WALL_OFFSET = ROAD_HALF + 0.35;

export interface Frame {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  right: THREE.Vector3;
  normal: THREE.Vector3;
}

export const makeFrame = (): Frame => ({
  pos: new THREE.Vector3(),
  tan: new THREE.Vector3(),
  right: new THREE.Vector3(),
  normal: new THREE.Vector3(),
});

export interface BoostPad {
  s: number;
  lat: number;
}

const _m = new THREE.Matrix4();
const _left = new THREE.Vector3();

/** Orientation whose local +Z is the track direction and local +Y the road normal. */
export function frameQuat(f: Frame, out: THREE.Quaternion): THREE.Quaternion {
  _left.copy(f.right).negate();
  _m.makeBasis(_left, f.normal, f.tan);
  return out.setFromRotationMatrix(_m);
}

export class Track {
  readonly n: number;
  readonly length: number;
  readonly ds: number;
  /** Per-sample centre position, tangent, banked right vector and road normal. */
  readonly P: Float32Array;
  readonly T: Float32Array;
  readonly R: Float32Array;
  readonly N: Float32Array;
  /** Signed curvature (1/m); positive turns right. */
  readonly curv: Float32Array;
  /** Speed the rivals can carry at each sample, with braking zones baked in. */
  readonly vLimit: Float32Array;
  readonly group = new THREE.Group();
  readonly pads: BoostPad[] = [];
  readonly center = new THREE.Vector2();
  private padUniforms = { uTime: { value: 0 } };

  constructor(
    readonly def: TrackDef,
    maxAnisotropy: number,
  ) {
    const pts = def.control.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    curve.arcLengthDivisions = 6000;
    this.length = curve.getLength();
    const n = Math.round(this.length / 1.5);
    this.n = n;
    this.ds = this.length / n;

    this.P = new Float32Array(n * 3);
    this.T = new Float32Array(n * 3);
    this.R = new Float32Array(n * 3);
    this.N = new Float32Array(n * 3);
    this.curv = new Float32Array(n);
    this.vLimit = new Float32Array(n);

    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const heading = new Float32Array(n);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t).normalize();
      this.P.set([p.x, p.y, p.z], i * 3);
      this.T.set([t.x, t.y, t.z], i * 3);
      heading[i] = Math.atan2(t.z, t.x);
      cx += p.x;
      cz += p.z;
    }
    this.center.set(cx / n, cz / n);

    // Curvature from heading change, then smoothed so banking and AI speeds flow.
    let c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = heading[(i + n - 1) % n];
      const b = heading[(i + 1) % n];
      c[i] = wrapAngle(b - a) / (2 * this.ds);
    }
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(n);
      const rad = 10;
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -rad; k <= rad; k++) s += c[(i + k + n) % n];
        o[i] = s / (rad * 2 + 1);
      }
      c = o;
    }
    this.curv.set(c);

    const up = new THREE.Vector3(0, 1, 0);
    const r0 = new THREE.Vector3();
    const n0 = new THREE.Vector3();
    const r = new THREE.Vector3();
    const nn = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      t.fromArray(this.T, i * 3);
      r0.crossVectors(t, up).normalize();
      n0.crossVectors(r0, t).normalize();
      const bank = clamp(c[i] * 9, -0.13, 0.13);
      r.copy(r0).multiplyScalar(Math.cos(bank)).addScaledVector(n0, -Math.sin(bank)).normalize();
      nn.crossVectors(r, t).normalize();
      this.R.set([r.x, r.y, r.z], i * 3);
      this.N.set([nn.x, nn.y, nn.z], i * 3);
    }

    // Corner speed, then a backward sweep so rivals brake before a corner.
    const grip = 66;
    const brake = 24;
    for (let i = 0; i < n; i++) this.vLimit[i] = Math.sqrt(grip / Math.max(Math.abs(c[i]), 1e-4));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const next = this.vLimit[(i + 1) % n];
        const reach = Math.sqrt(next * next + 2 * brake * this.ds);
        if (this.vLimit[i] > reach) this.vLimit[i] = reach;
      }
    }

    this.buildRoad(maxAnisotropy);
    this.buildWalls();
    this.buildStartLine();
    this.buildPads();
  }

  /** Nearest sample to a point, searched around a known previous index. */
  nearest(x: number, z: number, hint: number, range = 24): number {
    const n = this.n;
    const P = this.P;
    let best = hint;
    let bd = Infinity;
    for (let o = -range; o <= range; o++) {
      const i = (((hint + o) % n) + n) % n;
      const dx = x - P[i * 3];
      const dz = z - P[i * 3 + 2];
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Whole-track nearest lookup. Writes [distance, track height] into out. */
  nearestGlobal(x: number, z: number, out: Float32Array, step = 3): void {
    const n = this.n;
    const P = this.P;
    let bd = Infinity;
    let by = 0;
    for (let i = 0; i < n; i += step) {
      const dx = x - P[i * 3];
      const dz = z - P[i * 3 + 2];
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        by = P[i * 3 + 1];
      }
    }
    out[0] = Math.sqrt(bd);
    out[1] = by;
  }

  /** Interpolated frame at fractional sample coordinate s. */
  frame(s: number, out: Frame): Frame {
    const n = this.n;
    const fl = Math.floor(s);
    const f = s - fl;
    const i0 = ((fl % n) + n) % n;
    const i1 = (i0 + 1) % n;
    const a = i0 * 3;
    const b = i1 * 3;
    const g = 1 - f;
    const { P, T, R, N } = this;
    out.pos.set(P[a] * g + P[b] * f, P[a + 1] * g + P[b + 1] * f, P[a + 2] * g + P[b + 2] * f);
    out.tan.set(T[a] * g + T[b] * f, T[a + 1] * g + T[b + 1] * f, T[a + 2] * g + T[b + 2] * f).normalize();
    out.right.set(R[a] * g + R[b] * f, R[a + 1] * g + R[b + 1] * f, R[a + 2] * g + R[b + 2] * f).normalize();
    out.normal.set(N[a] * g + N[b] * f, N[a + 1] * g + N[b + 1] * f, N[a + 2] * g + N[b + 2] * f).normalize();
    return out;
  }

  update(time: number): void {
    this.padUniforms.uTime.value = time;
  }

  dispose(): void {
    disposeTree(this.group);
  }

  private buildRoad(maxAnisotropy: number): void {
    const n = this.n;
    const cnt = n + 1;
    const pos = new Float32Array(cnt * 2 * 3);
    const nor = new Float32Array(cnt * 2 * 3);
    const uv = new Float32Array(cnt * 2 * 2);
    const tile = this.length / Math.round(this.length / 14);
    for (let i = 0; i < cnt; i++) {
      const k = (i % n) * 3;
      for (let s = 0; s < 2; s++) {
        const sg = s === 0 ? -1 : 1;
        const o = (i * 2 + s) * 3;
        pos[o] = this.P[k] + this.R[k] * sg * WALL_OFFSET;
        pos[o + 1] = this.P[k + 1] + this.R[k + 1] * sg * WALL_OFFSET;
        pos[o + 2] = this.P[k + 2] + this.R[k + 2] * sg * WALL_OFFSET;
        nor[o] = this.N[k];
        nor[o + 1] = this.N[k + 1];
        nor[o + 2] = this.N[k + 2];
        uv[(i * 2 + s) * 2] = s;
        uv[(i * 2 + s) * 2 + 1] = (i * this.ds) / tile;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = a + 1;
      const c2 = a + 2;
      const d = a + 3;
      idx.push(a, b, c2, b, d, c2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);

    const { map, emissive } = makeRoadTextures();
    for (const tex of [map, emissive]) {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = maxAnisotropy;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    emissive.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: emissive,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: 1.1,
      roughness: 0.62,
      metalness: 0.05,
      envMapIntensity: 0.9,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildWalls(): void {
    const n = this.n;
    const cnt = n + 1;
    // Profile across the wall: [lateral offset beyond the road edge, height along the normal].
    const profile: Array<[number, number]> = [
      [0, -0.3],
      [0, 1.0],
      [0.55, 1.0],
      [1.4, -7],
    ];
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1a1626,
      roughness: 0.55,
      metalness: 0.35,
      flatShading: true,
      side: THREE.DoubleSide,
    });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

    for (const sg of [-1, 1]) {
      const pv = profile.length;
      const pos = new Float32Array(cnt * pv * 3);
      for (let i = 0; i < cnt; i++) {
        const k = (i % n) * 3;
        for (let j = 0; j < pv; j++) {
          const lat = sg * (WALL_OFFSET + profile[j][0]);
          const h = profile[j][1];
          const o = (i * pv + j) * 3;
          pos[o] = this.P[k] + this.R[k] * lat + this.N[k] * h;
          pos[o + 1] = this.P[k + 1] + this.R[k + 1] * lat + this.N[k + 1] * h;
          pos[o + 2] = this.P[k + 2] + this.R[k + 2] * lat + this.N[k + 2] * h;
        }
      }
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < pv - 1; j++) {
          const a = i * pv + j;
          const b = a + 1;
          const c = a + pv;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const wall = new THREE.Mesh(geo, wallMat);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);

      // Light strip along the inner face, in the theme's colours and hotter in corners.
      const gp = new Float32Array(cnt * 2 * 3);
      const gc = new Float32Array(cnt * 2 * 3);
      const base = sg < 0 ? this.def.theme.wallLeft : this.def.theme.wallRight;
      for (let i = 0; i < cnt; i++) {
        const k = (i % n) * 3;
        const lat = sg * (WALL_OFFSET - 0.04);
        const heat = 1 + Math.min(Math.abs(this.curv[i % n]) * 60, 1.1);
        for (let j = 0; j < 2; j++) {
          const h = j === 0 ? 0.58 : 0.88;
          const o = (i * 2 + j) * 3;
          gp[o] = this.P[k] + this.R[k] * lat + this.N[k] * h;
          gp[o + 1] = this.P[k + 1] + this.R[k + 1] * lat + this.N[k + 1] * h;
          gp[o + 2] = this.P[k + 2] + this.R[k + 2] * lat + this.N[k + 2] * h;
          gc[o] = base[0] * heat;
          gc[o + 1] = base[1] * heat;
          gc[o + 2] = base[2] * heat;
        }
      }
      const gi: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        gi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(gp, 3));
      gg.setAttribute('color', new THREE.BufferAttribute(gc, 3));
      gg.setIndex(gi);
      this.group.add(new THREE.Mesh(gg, glowMat));
    }
  }

  /** A strip that hugs the road between two sample indices, lifted slightly above it. */
  private ribbon(s0: number, s1: number, latMin: number, latMax: number, lift: number): THREE.BufferGeometry {
    const steps = Math.max(1, Math.round(s1 - s0));
    const pos = new Float32Array((steps + 1) * 2 * 3);
    const uv = new Float32Array((steps + 1) * 2 * 2);
    const f = makeFrame();
    for (let i = 0; i <= steps; i++) {
      this.frame(s0 + ((s1 - s0) * i) / steps, f);
      for (let j = 0; j < 2; j++) {
        const lat = j === 0 ? latMin : latMax;
        const o = (i * 2 + j) * 3;
        pos[o] = f.pos.x + f.right.x * lat + f.normal.x * lift;
        pos[o + 1] = f.pos.y + f.right.y * lat + f.normal.y * lift;
        pos[o + 2] = f.pos.z + f.right.z * lat + f.normal.z * lift;
        uv[(i * 2 + j) * 2] = j;
        uv[(i * 2 + j) * 2 + 1] = i / steps;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  private buildStartLine(): void {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 32;
    const g = cv.getContext('2d')!;
    const sq = 16;
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 16; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? '#f4f4f4' : '#101014';
        g.fillRect(x * sq, y * sq, sq, sq);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(this.ribbon(-1, 1, -ROAD_HALF + 0.4, ROAD_HALF - 0.4, 0.02), mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private buildPads(): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.padUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          float v = fract(vUv.y * 3.0 - uTime * 2.2 + abs(vUv.x - 0.5) * 1.4);
          float chev = smoothstep(0.0, 0.08, v) * smoothstep(0.55, 0.42, v);
          float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
          float ends = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          vec3 col = mix(vec3(0.1, 0.6, 2.4), vec3(0.5, 2.4, 2.6), chev);
          float a = (0.16 + chev * 0.95) * edge * ends;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    for (const [frac, lat] of this.def.pads) {
      const s = Math.round(frac * this.n);
      this.pads.push({ s, lat });
      this.group.add(new THREE.Mesh(this.ribbon(s - 4, s + 4, lat - 2.6, lat + 2.6, 0.05), mat));
    }
  }
}

function makeRoadTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const W = 512;
  const H = 512;
  const a = document.createElement('canvas');
  a.width = W;
  a.height = H;
  const g = a.getContext('2d')!;
  g.fillStyle = '#1b1a22';
  g.fillRect(0, 0, W, H);
  // Asphalt grain
  const img = g.getImageData(0, 0, W, H);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() - 0.5) * 20;
    img.data[i] += v;
    img.data[i + 1] += v;
    img.data[i + 2] += v * 1.2;
  }
  g.putImageData(img, 0, 0);
  // Darker rubbered-in lanes
  const lane = g.createLinearGradient(0, 0, W, 0);
  lane.addColorStop(0.0, 'rgba(0,0,0,0)');
  lane.addColorStop(0.28, 'rgba(0,0,0,0.22)');
  lane.addColorStop(0.5, 'rgba(0,0,0,0.04)');
  lane.addColorStop(0.72, 'rgba(0,0,0,0.22)');
  lane.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = lane;
  g.fillRect(0, 0, W, H);

  const b = document.createElement('canvas');
  b.width = W;
  b.height = H;
  const e = b.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);

  const edgeL = 26;
  const edgeR = W - 26 - 9;
  for (const ctx of [g, e]) {
    const em = ctx === e;
    ctx.fillStyle = em ? '#3a6f88' : '#d8e6ee';
    ctx.fillRect(edgeL, 0, 9, H);
    ctx.fillStyle = em ? '#8a3a62' : '#f0dbe4';
    ctx.fillRect(edgeR, 0, 9, H);
    ctx.fillStyle = em ? '#3c3c44' : '#c9c9d2';
    ctx.fillRect(W / 2 - 4, 0, 8, H * 0.42);
  }
  return { map: new THREE.CanvasTexture(a), emissive: new THREE.CanvasTexture(b) };
}
