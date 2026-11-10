import * as THREE from 'three';
import { Track, LAPS } from './track';
import { World } from './world';
import { buildCar } from './car';
import { Particles } from './particles';
import { Player, V_MAX, type Controls } from './player';
import { Rival } from './ai';
import { Post } from './post';
import { Hud, type ResultRow } from './hud';
import { Input } from './input';
import { GameAudio } from './audio';
import { clamp, smoothstep, wrapAngle } from './noise';

type State = 'menu' | 'countdown' | 'racing' | 'finished';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 5000);

const track = new Track(renderer.capabilities.getMaxAnisotropy());
scene.add(track.group);
const world = new World(scene, renderer, track);
const particles = new Particles(scene);
const post = new Post(renderer, scene, camera);
const hud = new Hud(track);
const input = new Input();
const audio = new GameAudio();

// ----- Cars -----
const playerCar = buildCar(0xd9141f, [3.2, 1.45, 0.25]);
scene.add(playerCar.root);
const head = new THREE.SpotLight(new THREE.Color(1, 0.9, 0.78), 34, 95, 0.5, 0.8, 1.0);
head.position.set(0, 0.9, 1.7);
head.target.position.set(0, -1.2, 30);
playerCar.root.add(head, head.target);
const player = new Player(playerCar, track, particles);

const RIVALS: Array<{
  name: string;
  css: string;
  paint: number;
  accent: [number, number, number];
  skill: number;
  top: number;
  bias: number;
}> = [
  { name: 'Volt', css: '#4f9bff', paint: 0x1458e8, accent: [0.2, 1.6, 3.2], skill: 0.975, top: 76.5, bias: 0.4 },
  { name: 'Nova', css: '#c35cff', paint: 0x8a1ad6, accent: [3.0, 0.3, 1.8], skill: 0.95, top: 75.5, bias: -0.6 },
  { name: 'Hex', css: '#3fe08a', paint: 0x10a85a, accent: [0.7, 3.0, 0.4], skill: 0.925, top: 74.5, bias: 0.8 },
  { name: 'Rune', css: '#e9ecf5', paint: 0xe6e8f0, accent: [0.4, 0.9, 3.0], skill: 0.905, top: 74, bias: -0.9 },
  { name: 'Echo', css: '#ffd24a', paint: 0xf2b20c, accent: [3.0, 1.7, 0.2], skill: 0.885, top: 73, bias: 0.2 },
];
const rivals = RIVALS.map((r) => {
  const car = buildCar(r.paint, r.accent);
  scene.add(car.root);
  return new Rival(r.name, r.css, car, track, r.skill, r.top, r.bias);
});
const obstacles = [...rivals, player];

// ----- Race state -----
const BEST_KEY = 'apex-dusk-best-lap';
let state: State = 'menu';
let paused = false;
let time = 0;
let raceTime = 0;
let countdown = 0;
let cdStage = 4;
let lapsDone = -1;
let lapStart = 0;
let lastLap = 0;
let bestLap = Number(localStorage.getItem(BEST_KEY)) || 0;
let newBest = false;
let finishPlace = 0;
let resultsAt = 0;
let resultsShown = false;
let autopilot = false;
let autoPace = 0.9;

let camYaw = 0;
let camY = 3;
let camMode = 0;
let shake = 0;
let boostVis = 0;
let frameNo = 0;

const menuEl = document.getElementById('menu')!;
const resultsEl = document.getElementById('results')!;
const pauseEl = document.getElementById('pause')!;

function gridSlot(k: number): [number, number] {
  return [-(6 + k * 5.5), k % 2 === 0 ? -3.2 : 3.2];
}

function placeGrid(): void {
  rivals.forEach((r, k) => r.place(...gridSlot(k)));
  player.place(...gridSlot(rivals.length));
  camYaw = player.yaw;
  camY = player.y + 2.6;
}

function startRace(): void {
  audio.start();
  placeGrid();
  state = 'countdown';
  countdown = 3.5;
  cdStage = 4;
  raceTime = 0;
  lapsDone = -1;
  lapStart = 0;
  lastLap = 0;
  newBest = false;
  resultsShown = false;
  paused = false;
  menuEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  hud.show(true);
  hud.setLap(1);
  hud.setPosition(rivals.length + 1);
}

function finishRace(): void {
  state = 'finished';
  finishPlace = 1 + rivals.filter((r) => r.finishTime !== null).length;
  resultsAt = time + 2.6;
  hud.message(finishPlace === 1 ? 'Victory' : 'Finish');
  audio.beep(1320, 0.5, 0.2);
}

function showResults(): void {
  resultsShown = true;
  const total = track.n * LAPS;
  const rows: Array<ResultRow & { sort: number }> = rivals.map((r) => {
    // Cars still out on track get a projected time from the distance they have left.
    const t = r.finishTime ?? raceTime + ((total - r.prog) * track.ds) / 62;
    return { name: r.name, time: t, you: false, sort: t };
  });
  rows.push({ name: 'You', time: raceTime, you: true, sort: raceTime });
  rows.sort((a, b) => a.sort - b.sort);
  hud.show(false);
  hud.showResults(finishPlace, rows, bestLap, newBest);
}

const NO_INPUT: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false };
const ctl: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };

/** Drives the player car along the centre line. Used for the lap of honour after the flag. */
function autoControls(pace: number): Controls {
  const n = track.n;
  const i = Math.floor(player.s) % n;
  const k = ((i + 12) % n) * 3;
  const want = Math.atan2(track.P[k] - player.x, track.P[k + 2] - player.z);
  const diff = wrapAngle(want - player.yaw);
  const limit = Math.min(track.vLimit[i], V_MAX) * pace;
  ctl.steer = clamp(-diff * 3, -1, 1);
  ctl.throttle = player.speed < limit ? 1 : 0;
  ctl.brake = player.speed > limit * 1.12 ? 1 : 0;
  ctl.handbrake = false;
  ctl.boost = false;
  return ctl;
}

function readControls(): Controls {
  if (state === 'finished') return autoControls(0.62);
  if (state !== 'racing') return NO_INPUT;
  if (autopilot) return autoControls(autoPace);
  ctl.throttle = input.throttle;
  ctl.brake = input.brake;
  ctl.steer = input.steer;
  ctl.handbrake = input.handbrake;
  ctl.boost = input.boost;
  return ctl;
}

function collide(): number {
  let hit = 0;
  const n = track.n;
  for (const r of rivals) {
    const dx = player.x - r.x;
    const dz = player.z - r.z;
    if (dx * dx + dz * dz > 30) continue;
    const k = (((Math.floor(r.prog) % n) + n) % n) * 3;
    let tx = track.T[k];
    let tz = track.T[k + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const rx = -tz;
    const rz = tx;
    const al = dx * tx + dz * tz;
    const ac = dx * rx + dz * rz;
    const penA = 4.3 - Math.abs(al);
    const penC = 2.0 - Math.abs(ac);
    if (penA <= 0 || penC <= 0) continue;
    if (penC < penA) {
      // Side contact
      const sg = ac >= 0 ? 1 : -1;
      player.x += rx * sg * penC * 0.6;
      player.z += rz * sg * penC * 0.6;
      r.nudge(-sg * penC * 0.4, 0);
      const vrel = (player.vx * rx + player.vz * rz) * sg;
      if (vrel < 0) {
        player.vx -= rx * sg * vrel * 1.25;
        player.vz -= rz * sg * vrel * 1.25;
        hit = Math.max(hit, Math.min(1, -vrel / 12));
      }
    } else {
      // Nose to tail
      const sg = al >= 0 ? 1 : -1;
      player.x += tx * sg * penA * 0.7;
      player.z += tz * sg * penA * 0.7;
      const pv = player.vx * tx + player.vz * tz;
      const closing = (pv - r.speed) * -sg;
      if (closing > 0) {
        player.vx += tx * sg * closing * 0.75;
        player.vz += tz * sg * closing * 0.75;
        r.nudge(0, -sg * closing * 0.35);
        hit = Math.max(hit, Math.min(1, closing / 18));
      }
    }
    if (hit > 0.15) {
      for (let j = 0; j < 8; j++) {
        particles.emit(
          (player.x + r.x) / 2 + (Math.random() - 0.5),
          player.y + 0.5,
          (player.z + r.z) / 2 + (Math.random() - 0.5),
          player.vx * 0.6 + (Math.random() - 0.5) * 9,
          2 + Math.random() * 6,
          player.vz * 0.6 + (Math.random() - 0.5) * 9,
          3.2,
          1.8,
          0.4,
          0.07,
          0.4,
          18,
          0.6,
        );
      }
    }
  }
  return hit;
}

function simulate(dt: number): void {
  if (state === 'menu') return;

  if (state === 'countdown') {
    countdown -= dt;
    const stage = Math.ceil(countdown);
    if (stage !== cdStage && stage <= 3) {
      cdStage = stage;
      if (stage > 0) {
        hud.message(String(stage));
        audio.beep(440, 0.18);
      } else {
        hud.message('Go');
        audio.beep(880, 0.55, 0.3);
        state = 'racing';
      }
    }
  } else {
    raceTime += state === 'racing' ? dt : 0;
  }

  const controls = readControls();
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  let impact = 0;
  let pad = false;
  for (let i = 0; i < steps; i++) {
    player.step(h, controls);
    impact = Math.max(impact, player.impact);
    pad = pad || player.padHit;
  }
  player.setBrakeLight(controls.brake > 0 || controls.handbrake);

  const moving = state === 'racing' || state === 'finished';
  for (const r of rivals) r.update(dt, obstacles, player.prog, moving, raceTime);
  impact = Math.max(impact, collide());

  if (impact > 0.05) {
    shake = Math.max(shake, impact * 0.55);
    if (impact > 0.2) audio.thud(impact);
  }
  if (pad) {
    audio.whoosh();
    hud.message('Boost', true);
  }

  if (state === 'racing') {
    if (input.consume('KeyR')) player.place(player.s, 0, true);
    const laps = Math.floor(player.prog / track.n);
    if (laps > lapsDone) {
      lapsDone = laps;
      if (laps >= 1) {
        lastLap = raceTime - lapStart;
        lapStart = raceTime;
        if (bestLap === 0 || lastLap < bestLap) {
          bestLap = lastLap;
          newBest = true;
          localStorage.setItem(BEST_KEY, String(bestLap));
        }
        if (laps >= LAPS) finishRace();
        else {
          hud.message(laps === LAPS - 1 ? 'Final lap' : `Lap ${laps + 1}`, true);
          audio.beep(660, 0.25, 0.15);
        }
      }
    }
  }

  if (state === 'finished' && !resultsShown && time > resultsAt) showResults();
}

function updateHud(): void {
  if (state === 'menu' || resultsShown) return;
  const place = state === 'finished' ? finishPlace : 1 + rivals.filter((r) => r.prog > player.prog).length;
  hud.setPosition(place);
  hud.setLap(clamp(lapsDone + 1, 1, LAPS));
  hud.setSpeed(player.speed * 3.6, player.speed / 100, player.boostActive);
  hud.setBoost(player.boost);
  hud.setTimes(state === 'countdown' ? 0 : raceTime - lapStart, lastLap, bestLap);
  hud.setWrongWay(state === 'racing' && player.wrongWay);
  if (frameNo % 2 === 0) {
    const dots = rivals.map((r) => ({ x: r.x, z: r.z, color: r.color }));
    hud.drawMap([...dots, { x: player.x, z: player.z, color: '#ff4b55', player: true }]);
  }
}

const look = new THREE.Vector3();
const focus = new THREE.Vector3();
const tmpV = new THREE.Vector3();

function updateCamera(dt: number): void {
  const px = player.x;
  const py = player.y;
  const pz = player.z;
  const sf = clamp(player.speed / V_MAX, 0, 1.35);
  boostVis += ((player.boostActive ? 1 : 0) - boostVis) * Math.min(1, dt * 4);
  shake *= Math.exp(-dt * 6);
  let fov = 58;

  if (state === 'menu' || resultsShown) {
    const a = time * 0.2 + (resultsShown ? 0 : 2.5);
    const r = resultsShown ? 9.5 : 10.5;
    camera.position.set(px + Math.sin(a) * r, py + 2.3 + Math.sin(time * 0.3) * 0.5, pz + Math.cos(a) * r);
    look.set(px, py + 0.75, pz);
    camera.lookAt(look);
    fov = 42;
    camYaw = player.yaw;
    camY = py + 2.6;
  } else if (camMode === 1) {
    tmpV.set(0, 1.08, 0.75).applyQuaternion(playerCar.root.quaternion);
    camera.position.set(px + tmpV.x, py + tmpV.y, pz + tmpV.z);
    tmpV.set(0, 0.85, 25).applyQuaternion(playerCar.root.quaternion);
    look.set(px + tmpV.x, py + tmpV.y, pz + tmpV.z);
    camera.lookAt(look);
    camera.rotateZ(playerCar.chassis.rotation.z * 0.6);
    fov = 70 + sf * 12 + boostVis * 8;
  } else {
    let targetYaw = player.yaw;
    if (player.speed > 6 && player.forwardSpeed > 0) {
      targetYaw += wrapAngle(Math.atan2(player.vx, player.vz) - player.yaw) * 0.55;
    }
    camYaw += wrapAngle(targetYaw - camYaw) * (1 - Math.exp(-dt * 6.5));
    const dist = 7.3 + sf * 1.7 + boostVis * 1.3;
    const height = 2.5 + sf * 0.3;
    const dx = Math.sin(camYaw);
    const dz = Math.cos(camYaw);
    camY += (py + height - camY) * (1 - Math.exp(-dt * 9));
    const sx = (Math.random() - 0.5) * (shake + boostVis * 0.035);
    const sy = (Math.random() - 0.5) * (shake + boostVis * 0.035);
    camera.position.set(px - dx * dist + sx, camY + sy, pz - dz * dist);
    look.set(px + dx * 7, py + 1.2, pz + dz * 7);
    camera.lookAt(look);
    camera.rotateZ(-player.steer * 0.03 * sf);
    fov = 58 + sf * 17 + boostVis * 11;
  }
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 5);
  camera.updateProjectionMatrix();
}

function handleKeys(): void {
  if (state === 'menu' && (input.consume('Enter') || input.consume('Space'))) startRace();
  else if (resultsShown && input.consume('Enter')) startRace();
  if (input.consume('KeyM')) audio.toggleMute();
  if (input.consume('KeyC')) camMode = (camMode + 1) % 2;
  if ((input.consume('KeyP') || input.consume('Escape')) && (state === 'racing' || state === 'countdown')) {
    paused = !paused;
    pauseEl.classList.toggle('hidden', !paused);
  }
}

const clock = new THREE.Clock();

function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  frameNo++;
  handleKeys();
  if (!paused) tick(dt);
  input.endFrame();
  render(dt);
}

function tick(dt: number): void {
  time += dt;
  simulate(dt);
  particles.update(dt);
  track.update(time);
  updateCamera(dt);
  updateHud();
}

function render(dt: number): void {

  focus.set(player.x, player.y, player.z);
  world.update(time, camera, focus);

  const sf = player.speed / V_MAX;
  const racing = state === 'racing' || state === 'finished';
  audio.update(sf, readControls().throttle, player.boostActive, player.drift, racing && !paused && !resultsShown);
  const blur = state === 'menu' || resultsShown ? 0 : smoothstep(0.4, 1.2, sf);
  post.render(dt, time, blur, state === 'menu' ? 0 : boostVis);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

document.getElementById('start')!.addEventListener('click', startRace);
document.getElementById('again')!.addEventListener('click', startRace);

placeGrid();
resize();
frame();

// Handy for poking at the game from the console.
Object.assign(window, {
  __game: {
    player,
    rivals,
    track,
    start: startRace,
    /** Steps the simulation forward without waiting for animation frames. */
    advance(seconds: number, draw = true) {
      for (let t = 0; t < seconds - 1e-6; t += 1 / 60) tick(1 / 60);
      if (draw) render(1 / 60);
    },
    get state() {
      return state;
    },
    set autopilot(v: boolean) {
      autopilot = v;
    },
    set pace(v: number) {
      autoPace = v;
    },
  },
});
