import * as THREE from 'three';
import { Track, WALL_OFFSET, makeFrame, frameQuat } from './track';
import { fbm, ridged, smoothstep, mulberry32, lerp } from './noise';

const WATER_Y = -5;
const TERRAIN_SIZE = 3800;
const TERRAIN_SEG = 272;

export const SUN_DIR = new THREE.Vector3(0.82, 0.13, 0.42).normalize();
/** Haze colour, shared by the fog and the sky below the horizon (linear RGB). */
export const FOG_COLOR = new THREE.Color().setRGB(0.17, 0.06, 0.19);

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uSun;
  uniform vec3 uFog;
  uniform float uTime;
  uniform float uSunBoost;

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      s += a * noise(p);
      p = p * 2.03 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float hh = clamp(h, 0.0, 1.0);
    float sd = max(dot(d, uSun), 0.0);

    vec3 zenith = vec3(0.010, 0.016, 0.070);
    vec3 mid = vec3(0.15, 0.045, 0.30);
    vec3 warm = vec3(0.86, 0.26, 0.15);
    vec3 cool = vec3(0.22, 0.06, 0.24);

    vec3 col = mix(mid, zenith, smoothstep(0.06, 0.62, hh));
    float sunSide = pow(sd, 2.0);
    vec3 horizon = mix(cool, warm, sunSide);
    col = mix(col, horizon, exp(-hh * 6.5));

    // Sun glow and disk
    col += vec3(1.0, 0.42, 0.16) * pow(sd, 5.0) * 0.28;
    col += vec3(1.0, 0.62, 0.30) * pow(sd, 48.0) * 0.55;
    float disk = smoothstep(0.99835, 0.9990, dot(d, uSun));
    col += vec3(1.0, 0.74, 0.44) * disk * uSunBoost;

    // Stars
    vec3 sp = d * 190.0;
    vec3 cell = floor(sp);
    float st = hash3(cell);
    float star = step(0.9962, st) * smoothstep(0.42, 0.0, length(fract(sp) - 0.5));
    star *= 0.55 + 0.45 * sin(uTime * 2.3 + st * 400.0);
    col += vec3(0.85, 0.9, 1.0) * star * smoothstep(0.12, 0.5, h) * 2.2;

    // Cloud bands, lit from the sun side
    vec2 cp = d.xz / (hh + 0.22) * 1.5;
    float c = fbm(cp * vec2(1.0, 2.2) + vec2(uTime * 0.006, 0.0));
    float cm = smoothstep(0.50, 0.80, c) * smoothstep(0.015, 0.11, h) * (1.0 - smoothstep(0.35, 0.8, h));
    vec3 cloudCol = mix(vec3(0.17, 0.06, 0.24), vec3(1.0, 0.36, 0.24), pow(sd, 1.6) * 0.85 + 0.12);
    col = mix(col, cloudCol, cm * 0.8);

    // Haze below the horizon blends into the fog
    col = mix(col, uFog, smoothstep(0.03, -0.05, h));
    gl_FragColor = vec4(col, 1.0);
  }`;

export class World {
  readonly sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private skyUniforms: { [k: string]: THREE.IUniform };
  private fireflyUniforms = { uTime: { value: 0 } };
  private tmp = new Float32Array(2);
  private lightDir = new THREE.Vector3(SUN_DIR.x, 0.36, SUN_DIR.z).normalize();

  constructor(
    private scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    private track: Track,
  ) {
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.00092);
    scene.background = FOG_COLOR;

    // ----- Sky -----
    this.skyUniforms = {
      uSun: { value: SUN_DIR },
      uFog: { value: FOG_COLOR },
      uTime: { value: 0 },
      uSunBoost: { value: 5 },
    };
    const skyGeo = new THREE.SphereGeometry(1000, 48, 24);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Environment map from a calmer copy of the sky, for paint and wet-road reflections.
    const envMat = skyMat.clone();
    envMat.uniforms = {
      uSun: { value: SUN_DIR },
      uFog: { value: FOG_COLOR },
      uTime: { value: 0 },
      uSunBoost: { value: 2.5 },
    };
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(skyGeo, envMat));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0, 1, 3000).texture;
    scene.environmentIntensity = 0.85;
    pmrem.dispose();

    // ----- Lights -----
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.42, 0.3, 0.72), new THREE.Color(0.07, 0.05, 0.12), 0.95);
    scene.add(hemi);

    this.sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.52, 0.28), 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75;
    sc.right = 75;
    sc.top = 75;
    sc.bottom = -75;
    sc.near = 1;
    sc.far = 420;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildPosts();
    this.buildArches();
    this.buildCrystals();
    this.buildFireflies();
  }

  /** Ground height at a world position, matching the terrain mesh. */
  heightAt(x: number, z: number): number {
    this.track.nearestGlobal(x, z, this.tmp);
    const dTrack = this.tmp[0];
    const trackY = this.tmp[1];
    const hills = fbm(x * 0.0042 + 11.3, z * 0.0042 - 4.1, 5) * 26 - 5;
    const mAmt = smoothstep(250, 820, dTrack);
    const mountains = mAmt * (30 + 250 * ridged(x * 0.00155 + 3.1, z * 0.00155 - 1.7, 5));
    const natural = hills + mountains;
    return lerp(trackY - 1.6, natural, smoothstep(13, 105, dTrack));
  }

  private buildTerrain(): void {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.track.center.x, 0, this.track.center.y);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const low = new THREE.Color().setRGB(0.03, 0.085, 0.09);
    const mid = new THREE.Color().setRGB(0.085, 0.05, 0.15);
    const rock = new THREE.Color().setRGB(0.36, 0.17, 0.34);
    const snow = new THREE.Color().setRGB(1.0, 0.72, 0.78);
    const shore = new THREE.Color().setRGB(0.11, 0.07, 0.13);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const v = fbm(x * 0.02, z * 0.02, 3) * 0.5 + 0.5;
      if (h < WATER_Y + 2.5) c.copy(shore);
      else c.copy(low).lerp(mid, smoothstep(4, 40, h + v * 14));
      c.lerp(rock, smoothstep(45, 150, h + v * 30));
      c.lerp(snow, smoothstep(175, 245, h + v * 40));
      c.multiplyScalar(0.8 + v * 0.45);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.25,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.3, 0.32, 0.5),
      metalness: 1,
      roughness: 0.1,
      envMapIntensity: 1.5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(this.track.center.x, WATER_Y, this.track.center.y);
    this.scene.add(mesh);
  }

  private buildTrees(): void {
    const rnd = mulberry32(2024);
    const geo = new THREE.ConeGeometry(2.4, 10, 6, 2);
    geo.translate(0, 5, 0);
    const mat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, envMapIntensity: 0.2 });
    const max = 1500;
    const mesh = new THREE.InstancedMesh(geo, mat, max);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let count = 0;
    let tries = 0;
    while (count < max && tries < 40000) {
      tries++;
      const x = this.track.center.x + (rnd() - 0.5) * 1500;
      const z = this.track.center.y + (rnd() - 0.5) * 1300;
      if (fbm(x * 0.008 + 40, z * 0.008 + 7, 3) < -0.04) continue;
      this.track.nearestGlobal(x, z, this.tmp, 4);
      const d = this.tmp[0];
      if (d < 17 || d > 480) continue;
      const h = this.heightAt(x, z);
      if (h < WATER_Y + 1.6 || h > 120) continue;
      const k = 0.65 + rnd() * 0.95;
      p.set(x, h - 0.6, z);
      q.setFromAxisAngle(yAxis, rnd() * Math.PI * 2);
      s.set(k * (0.8 + rnd() * 0.4), k, k * (0.8 + rnd() * 0.4));
      m.compose(p, q, s);
      mesh.setMatrixAt(count, m);
      const t = rnd();
      c.setRGB(lerp(0.02, 0.1, t), lerp(0.11, 0.05, t), lerp(0.1, 0.17, t));
      mesh.setColorAt(count, c);
      count++;
    }
    mesh.count = count;
    mesh.castShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildPosts(): void {
    const track = this.track;
    const every = 30;
    const count = Math.floor(track.n / every);
    const poleGeo = new THREE.BoxGeometry(0.2, 7.2, 0.2);
    poleGeo.translate(0, 3.6, 0);
    const armGeo = new THREE.BoxGeometry(2.8, 0.14, 0.3);
    const lampGeo = new THREE.BoxGeometry(1.6, 0.07, 0.24);
    const dark = new THREE.MeshStandardMaterial({ color: 0x15121f, roughness: 0.5, metalness: 0.6 });
    const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.0, 1.7, 0.7) });
    const poles = new THREE.InstancedMesh(poleGeo, dark, count);
    const arms = new THREE.InstancedMesh(armGeo, dark, count);
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, count);
    const f = makeFrame();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const off = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      track.frame(i * every + 9, f);
      frameQuat(f, q);
      p.copy(f.pos).addScaledVector(f.right, side * (WALL_OFFSET + 1.7));
      m.compose(p, q, one);
      poles.setMatrixAt(i, m);
      // Local +X is the left side of the road, so the arm reaches back over the tarmac.
      off.set(side * 1.3, 7.1, 0).applyQuaternion(q).add(p);
      m.compose(off, q, one);
      arms.setMatrixAt(i, m);
      off.set(side * 1.8, 7.0, 0).applyQuaternion(q).add(p);
      m.compose(off, q, one);
      lamps.setMatrixAt(i, m);
    }
    poles.castShadow = true;
    this.scene.add(poles, arms, lamps);
  }

  private buildArches(): void {
    const track = this.track;
    const dark = new THREE.MeshStandardMaterial({ color: 0x18142a, roughness: 0.4, metalness: 0.7 });
    const hues: Array<[number, number, number]> = [
      [0.15, 1.3, 2.8],
      [2.9, 0.25, 1.3],
      [3.0, 1.5, 0.3],
    ];
    const f = makeFrame();
    const half = WALL_OFFSET + 1.3;
    const fractions = [0, 0.14, 0.27, 0.42, 0.55, 0.69, 0.8, 0.92];
    fractions.forEach((frac, i) => {
      const isStart = i === 0;
      const height = isStart ? 10 : 8.5;
      track.frame(frac * track.n + (isStart ? 0 : 0), f);
      const g = new THREE.Group();
      g.position.copy(f.pos);
      frameQuat(f, g.quaternion);

      const pillarGeo = new THREE.BoxGeometry(0.7, height + 8, isStart ? 1.4 : 0.9);
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeo, dark);
        pillar.position.set(sx * half, height / 2 - 4, 0);
        pillar.castShadow = true;
        g.add(pillar);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, isStart ? 2.2 : 0.8, isStart ? 1.4 : 0.9), dark);
      beam.position.set(0, height + (isStart ? 0.7 : 0), 0);
      beam.castShadow = true;
      g.add(beam);

      const hue = hues[i % hues.length];
      const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(hue[0], hue[1], hue[2]) });
      const under = new THREE.Mesh(new THREE.BoxGeometry(half * 2 - 0.4, 0.14, 0.3), glowMat);
      under.position.set(0, height - (isStart ? 0.5 : 0.5), 0);
      g.add(under);
      for (const sx of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, height - 1, 0.3), glowMat);
        strip.position.set(sx * (half - 0.42), (height - 1) / 2 + 0.6, 0);
        g.add(strip);
      }

      if (isStart) {
        const banner = new THREE.Mesh(
          new THREE.PlaneGeometry(half * 2, 2),
          new THREE.MeshBasicMaterial({ map: makeBannerTexture(), toneMapped: false }),
        );
        // Faces back down the track, towards approaching cars.
        banner.position.set(0, height + 0.7, -0.72);
        banner.rotation.y = Math.PI;
        g.add(banner);
      }
      this.scene.add(g);
    });
  }

  private buildCrystals(): void {
    const rnd = mulberry32(77);
    const count = 70;
    const geo = new THREE.OctahedronGeometry(1, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const f = makeFrame();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      this.track.frame(rnd() * this.track.n, f);
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (WALL_OFFSET + 9 + rnd() * 34);
      const x = f.pos.x + f.right.x * lat;
      const z = f.pos.z + f.right.z * lat;
      const k = 1.1 + rnd() * 2.2;
      p.set(x, this.heightAt(x, z) + k * 1.6, z);
      e.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
      q.setFromEuler(e);
      s.set(k * 0.55, k * 3.2, k * 0.55);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const t = rnd();
      if (t < 0.45) c.setRGB(0.12, 1.1, 2.3);
      else if (t < 0.85) c.setRGB(2.2, 0.2, 1.3);
      else c.setRGB(2.4, 1.2, 0.3);
      mesh.setColorAt(i, c);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  }

  private buildFireflies(): void {
    const rnd = mulberry32(5);
    const count = 1600;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const f = makeFrame();
    for (let i = 0; i < count; i++) {
      this.track.frame(rnd() * this.track.n, f);
      const lat = (rnd() - 0.5) * 110;
      pos[i * 3] = f.pos.x + f.right.x * lat;
      pos[i * 3 + 1] = f.pos.y + 0.6 + rnd() * rnd() * 22;
      pos[i * 3 + 2] = f.pos.z + f.right.z * lat;
      seed[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.fireflyUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        varying float vA;
        varying float vSeed;
        void main() {
          vec3 p = position;
          float t = uTime * (0.3 + aSeed * 0.5) + aSeed * 50.0;
          p += vec3(sin(t * 1.3), sin(t * 0.9) * 0.8, cos(t * 1.1)) * 1.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          gl_PointSize = clamp((0.25 + aSeed * 0.3) * 320.0 / dist, 1.0, 14.0);
          vA = (0.5 + 0.5 * sin(t * 3.0)) * smoothstep(420.0, 60.0, dist);
          vSeed = aSeed;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        varying float vSeed;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          vec3 col = mix(vec3(1.8, 0.9, 0.35), vec3(0.4, 1.3, 1.9), step(0.6, vSeed));
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  update(time: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    this.skyUniforms.uTime.value = time;
    this.fireflyUniforms.uTime.value = time;
    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 200);
  }
}

function makeBannerTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 112;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0d0818';
  g.fillRect(0, 0, cv.width, cv.height);
  const sq = 28;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      const on = (x + y) % 2 === 0;
      g.fillStyle = on ? '#f2f2f2' : '#0d0818';
      g.fillRect(x * sq, y * sq, sq, sq);
      g.fillRect(cv.width - (x + 1) * sq, y * sq, sq, sq);
    }
  }
  g.font = 'italic 900 78px Orbitron, "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffb347';
  g.shadowColor = '#ff3d9a';
  g.shadowBlur = 18;
  g.fillText('APEX  DUSK', cv.width / 2, cv.height / 2 + 4);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
