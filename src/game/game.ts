import * as THREE from 'three';
import { Track } from '../world/track';
import { Environment } from '../world/environment';
import { trackById } from '../world/tracks';
import { Particles } from '../world/particles';
import { buildCar, type CarModel } from '../cars/model';
import { Player, V_MAX, type Controls } from '../cars/player';
import { Rival, type Obstacle } from '../cars/rival';
import { RemoteCar } from '../cars/remote';
import { BOTS, LIVERIES } from '../cars/roster';
import { Post } from '../render/post';
import { Hud, type ResultRow } from '../ui/hud';
import { Input } from '../core/input';
import { GameAudio } from '../core/audio';
import { clamp, smoothstep, wrapAngle } from '../core/math';
import { ChaseCamera } from './camera';
import { collidePlayer } from './collisions';
import type { NetClient } from '../net/client';
import type { CarState, PlayerInfo, RaceSettings, RoomInfo } from '../../shared/protocol';

type Phase = 'menu' | 'countdown' | 'racing' | 'finished';

export interface MultiSetup {
  net: NetClient;
  room: RoomInfo;
  selfId: string;
}

export interface RaceSetup {
  settings: RaceSettings;
  /** Null for a solo race. */
  multi: MultiSetup | null;
}

const SOLO: PlayerInfo = { id: 'solo', name: 'You', slot: 0 };
const SEND_INTERVAL = 0.05;
const NO_INPUT: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: true, boost: false };
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Grid slot k, counted from the front: [track sample, lateral offset]. */
const gridSlot = (k: number): [number, number] => [-(6 + k * 5.5), k % 2 === 0 ? -3.2 : 3.2];

/** Owns the renderer, the current circuit, the cars and the race itself. */
export class Game {
  readonly hud = new Hud();
  readonly audio = new GameAudio();
  /** Called once when the results table first appears. */
  onResults: ((multi: boolean) => void) | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 5000);
  private post: Post;
  private particles: Particles;
  private input = new Input();
  private cam = new ChaseCamera();
  private clock = new THREE.Clock();
  private pauseEl = document.getElementById('pause')!;

  private track!: Track;
  private env!: Environment;
  private models: CarModel[];
  private headlight: THREE.SpotLight;
  private player!: Player;
  private playerColor = LIVERIES[0].css;
  private rivals: Rival[] = [];
  private remotes = new Map<string, RemoteCar>();
  private obstacles: Obstacle[] = [];

  private phase: Phase = 'menu';
  private paused = false;
  private time = 0;
  private raceTime = 0;
  private countdown = 0;
  private cdStage = 4;
  private laps = 3;
  private lapsDone = -1;
  private lapStart = 0;
  private lastLap = 0;
  private bestLap = 0;
  private newBest = false;
  private finishPlace = 0;
  private finishTime = -1;
  private resultsAt = 0;
  private resultsShown = false;
  private resultsRefresh = 0;
  private multi: MultiSetup | null = null;
  private sendTimer = 0;
  private frameNo = 0;
  private autopilot = false;
  private autoPace = 0.9;
  private ctl: Controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
  private focus = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = renderer;

    this.particles = new Particles(this.scene);
    this.post = new Post(renderer, this.scene, this.camera);

    // One car per livery, reused for whoever drives it in each race.
    this.models = LIVERIES.map((l) => {
      const model = buildCar(l.paint, l.accent);
      this.scene.add(model.root);
      return model;
    });
    this.headlight = new THREE.SpotLight(new THREE.Color(1, 0.9, 0.78), 34, 95, 0.5, 0.8, 1.0);
    this.headlight.position.set(0, 0.9, 1.7);
    this.headlight.target.position.set(0, -1.2, 30);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Starts the render loop. */
  run(): void {
    const loop = (): void => {
      requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this.handleKeys();
      if (!this.paused) this.tick(dt);
      this.input.endFrame();
      this.render(dt);
    };
    loop();
  }

  get racing(): boolean {
    return this.phase !== 'menu';
  }

  // ---------------------------------------------------------------- setup

  /** Shows a circuit behind the menu with one car on the grid. Also ends any race in progress. */
  preview(trackId: string, livery = 0): void {
    this.phase = 'menu';
    this.multi = null;
    this.paused = false;
    this.resultsShown = false;
    this.hud.show(false);
    this.hud.hideResults();
    this.pauseEl.classList.add('hidden');
    this.populate(trackId, [{ ...SOLO, slot: livery }], SOLO.id, true);
  }

  startRace(setup: RaceSetup): void {
    this.audio.start();
    const s = setup.settings;
    this.laps = s.laps;
    this.multi = setup.multi;
    if (setup.multi) this.populate(s.track, setup.multi.room.players, setup.multi.selfId, s.bots);
    else this.populate(s.track, [SOLO], SOLO.id, true);
    this.syncHost();

    this.phase = 'countdown';
    this.countdown = 3.5;
    this.cdStage = 4;
    this.raceTime = 0;
    this.lapsDone = -1;
    this.lapStart = 0;
    this.lastLap = 0;
    this.newBest = false;
    this.finishTime = -1;
    this.resultsShown = false;
    this.paused = false;
    this.sendTimer = 0;
    const cars = this.rivals.length + this.remotes.size + 1;
    this.hud.hideResults();
    this.pauseEl.classList.add('hidden');
    this.hud.setRace(this.laps, cars);
    this.hud.setLap(1);
    this.hud.setPosition(cars);
    this.hud.show(true);
  }

  private loadTrack(trackId: string): void {
    const def = trackById(trackId);
    if (this.track && this.track.def.id === def.id) return;
    this.env?.dispose();
    this.track?.dispose();
    this.track = new Track(def, this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(this.track.group);
    this.env = new Environment(this.scene, this.renderer, this.track);
    this.hud.setTrack(this.track);
    this.bestLap = Number(localStorage.getItem(this.bestKey())) || 0;
  }

  private bestKey(): string {
    return `apex-dusk-best-${this.track.def.id}`;
  }

  /** Builds the cars for a race and lines them up: AI rivals in front, then humans in slot order. */
  private populate(trackId: string, humans: PlayerInfo[], selfId: string, bots: boolean): void {
    this.loadTrack(trackId);
    for (const rc of this.remotes.values()) rc.dispose();
    this.remotes.clear();
    for (const m of this.models) {
      m.root.visible = false;
      for (const fl of m.flames) fl.visible = false;
    }

    const ordered = humans
      .map((h) => ({ ...h, slot: clamp(Math.floor(h.slot), 0, LIVERIES.length - 1) }))
      .sort((a, b) => a.slot - b.slot);
    const taken = new Set(ordered.map((h) => h.slot));
    const free = LIVERIES.map((_, i) => i).filter((i) => !taken.has(i));
    const botCount = bots ? Math.min(BOTS.length, free.length) : 0;
    const finishProg = this.track.n * this.laps;

    let grid = 0;
    this.rivals = [];
    for (let i = 0; i < botCount; i++) {
      const livery = free[i];
      const rival = new Rival(BOTS[i], LIVERIES[livery].css, this.models[livery], this.track, finishProg);
      rival.place(...gridSlot(grid++));
      this.models[livery].root.visible = true;
      this.rivals.push(rival);
    }
    for (const h of ordered) {
      const model = this.models[h.slot];
      if (model.root.visible) continue; // Two players on one slot should never happen; skip the extra.
      model.root.visible = true;
      const [s, lat] = gridSlot(grid++);
      if (h.id === selfId) {
        this.player = new Player(model, this.track, this.particles);
        this.player.place(s, lat);
        this.playerColor = LIVERIES[h.slot].css;
        model.root.add(this.headlight, this.headlight.target);
      } else {
        const remote = new RemoteCar(h.id, h.name, LIVERIES[h.slot].css, model, this.track);
        remote.place(s, lat);
        this.remotes.set(h.id, remote);
      }
    }
    this.obstacles = [...this.rivals, ...this.remotes.values(), this.player];
    this.cam.snap(this.player);
  }

  // ---------------------------------------------------------------- multiplayer

  private get isHost(): boolean {
    return !this.multi || this.multi.room.hostId === this.multi.selfId;
  }

  /** Only the host drives the AI rivals; everyone else replays what the host sends. */
  private syncHost(): void {
    const host = this.isHost;
    for (const r of this.rivals) r.puppet = !host;
  }

  /** The room changed mid-race: someone left, or the host moved. */
  setRoom(room: RoomInfo): void {
    if (!this.multi) return;
    this.multi.room = room;
    const present = new Set(room.players.map((p) => p.id));
    for (const [id, remote] of this.remotes) {
      if (present.has(id)) continue;
      remote.dispose();
      remote.car.root.visible = false;
      this.remotes.delete(id);
    }
    this.obstacles = [...this.rivals, ...this.remotes.values(), this.player];
    this.syncHost();
  }

  /** A car state arrived from another player. */
  onNetState(id: string, d: CarState): void {
    if (!this.multi || this.phase === 'menu') return;
    this.remotes.get(id)?.applyNet(d);
    if (id === this.multi.room.hostId && !this.isHost && Array.isArray(d.bots)) {
      this.rivals.forEach((r, i) => {
        const b = d.bots![i];
        if (Array.isArray(b)) r.applyNet(b);
      });
    }
  }

  private sendState(): void {
    if (!this.multi) return;
    const p = this.player;
    const d: CarState = {
      x: round3(p.x),
      z: round3(p.z),
      yaw: round3(p.yaw),
      vx: round3(p.vx),
      vz: round3(p.vz),
      p: round3(p.prog),
      l: round3(p.lat),
      steer: round3(p.steer),
      boost: p.boostActive,
      fin: this.finishTime,
    };
    if (this.isHost && this.rivals.length > 0) {
      d.bots = this.rivals.map((r) => [round3(r.prog), round3(r.lat), round3(r.speed), r.finishTime ?? -1]);
    }
    this.multi.net.send({ t: 'state', d });
  }

  // ---------------------------------------------------------------- race

  /** Drives the player's car along the centre line. Used for the lap of honour after the flag. */
  private autoControls(pace: number): Controls {
    const { track, player, ctl } = this;
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

  private readControls(): Controls {
    if (this.phase === 'finished') return this.autoControls(0.62);
    if (this.phase !== 'racing') return NO_INPUT;
    if (this.autopilot) return this.autoControls(this.autoPace);
    const { ctl, input } = this;
    ctl.throttle = input.throttle;
    ctl.brake = input.brake;
    ctl.steer = input.steer;
    ctl.handbrake = input.handbrake;
    ctl.boost = input.boost;
    return ctl;
  }

  private *bodies(): Generator<Rival | RemoteCar> {
    yield* this.rivals;
    yield* this.remotes.values();
  }

  private simulate(dt: number): void {
    if (this.phase === 'menu') return;
    const { player, hud, audio, track } = this;

    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const stage = Math.ceil(this.countdown);
      if (stage !== this.cdStage && stage <= 3) {
        this.cdStage = stage;
        if (stage > 0) {
          hud.message(String(stage));
          audio.beep(440, 0.18);
        } else {
          hud.message('Go');
          audio.beep(880, 0.55, 0.3);
          this.phase = 'racing';
        }
      }
    } else if (this.phase === 'racing') {
      this.raceTime += dt;
    }

    // Player physics runs in small fixed steps so it behaves the same at any frame rate.
    const controls = this.readControls();
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

    const moving = this.phase === 'racing' || this.phase === 'finished';
    // After the player's flag the rivals keep their own clock running for finish times.
    const clock = this.phase === 'finished' ? this.raceTime + (this.time - this.finishedAt) : this.raceTime;
    for (const r of this.rivals) r.update(dt, this.obstacles, player.prog, moving, clock);
    for (const rc of this.remotes.values()) rc.update(dt);
    impact = Math.max(impact, collidePlayer(player, this.bodies(), this.particles));

    if (impact > 0.05) {
      this.cam.shake = Math.max(this.cam.shake, impact * 0.55);
      if (impact > 0.2) audio.thud(impact);
    }
    if (pad) {
      audio.whoosh();
      hud.message('Boost', true);
    }

    if (this.phase === 'racing') {
      if (this.input.consume('KeyR')) player.place(player.s, 0, true);
      const laps = Math.floor(player.prog / track.n);
      if (laps > this.lapsDone) {
        this.lapsDone = laps;
        if (laps >= 1) {
          this.lastLap = this.raceTime - this.lapStart;
          this.lapStart = this.raceTime;
          if (this.bestLap === 0 || this.lastLap < this.bestLap) {
            this.bestLap = this.lastLap;
            this.newBest = true;
            localStorage.setItem(this.bestKey(), String(this.bestLap));
          }
          if (laps >= this.laps) this.finishRace();
          else {
            hud.message(laps === this.laps - 1 ? 'Final lap' : `Lap ${laps + 1}`, true);
            audio.beep(660, 0.25, 0.15);
          }
        }
      }
    }

    if (this.multi) {
      this.sendTimer -= dt;
      if (this.sendTimer <= 0) {
        this.sendTimer = SEND_INTERVAL;
        this.sendState();
      }
    }

    if (this.phase === 'finished') {
      if (!this.resultsShown && this.time > this.resultsAt) {
        this.resultsShown = true;
        this.hud.show(false);
        this.refreshResults();
        this.onResults?.(this.multi !== null);
      } else if (this.resultsShown && this.time > this.resultsRefresh) {
        this.refreshResults();
      }
    }
  }

  private finishedAt = 0;

  private finishRace(): void {
    this.phase = 'finished';
    this.finishTime = round3(this.raceTime);
    this.finishedAt = this.time;
    let ahead = 0;
    for (const b of this.bodies()) if (b.finishTime !== null) ahead++;
    this.finishPlace = ahead + 1;
    this.resultsAt = this.time + 2.6;
    this.hud.message(this.finishPlace === 1 ? 'Victory' : 'Finish');
    this.audio.beep(1320, 0.5, 0.2);
    this.sendState();
  }

  /** Rebuilds the results table. Cars still racing are listed below the finishers by distance. */
  private refreshResults(): void {
    this.resultsRefresh = this.time + 1;
    const total = this.track.n * this.laps;
    const now = this.raceTime + (this.time - this.finishedAt);
    const rows: ResultRow[] = [];
    for (const b of this.bodies()) {
      const pending = b.finishTime === null;
      // Unfinished cars sort by a projected time, which is always later than any real finish.
      const time = b.finishTime ?? now + (Math.max(0, total - b.prog) * this.track.ds) / 62;
      rows.push({ name: b.name, color: b.color, time, pending, you: false });
    }
    rows.push({ name: 'You', color: this.playerColor, time: this.finishTime, pending: false, you: true });
    rows.sort((a, b) => a.time - b.time);
    this.hud.showResults(this.finishPlace, rows, this.bestLap, this.newBest);
  }

  private updateHud(): void {
    if (this.phase === 'menu' || this.resultsShown) return;
    const { hud, player } = this;
    let place = this.finishPlace;
    if (this.phase !== 'finished') {
      place = 1;
      for (const b of this.bodies()) if (b.prog > player.prog) place++;
    }
    hud.setPosition(place);
    hud.setLap(clamp(this.lapsDone + 1, 1, this.laps));
    hud.setSpeed(player.speed * 3.6, player.speed / 100, player.boostActive);
    hud.setBoost(player.boost);
    hud.setTimes(this.phase === 'countdown' ? 0 : this.raceTime - this.lapStart, this.lastLap, this.bestLap);
    hud.setWrongWay(this.phase === 'racing' && player.wrongWay);
    if (this.frameNo % 2 === 0) {
      const dots = [];
      for (const b of this.bodies()) dots.push({ x: b.x, z: b.z, color: b.color });
      dots.push({ x: player.x, z: player.z, color: this.playerColor, player: true });
      hud.drawMap(dots);
    }
  }

  // ---------------------------------------------------------------- loop

  private handleKeys(): void {
    const { input } = this;
    if (input.consume('KeyM')) this.audio.toggleMute();
    if (input.consume('KeyC')) this.cam.mode = (this.cam.mode + 1) % 2;
    // A shared race cannot be paused.
    const canPause = !this.multi && (this.phase === 'racing' || this.phase === 'countdown');
    if ((input.consume('KeyP') || input.consume('Escape')) && canPause) {
      this.paused = !this.paused;
      this.pauseEl.classList.toggle('hidden', !this.paused);
    }
  }

  private tick(dt: number): void {
    this.frameNo++;
    this.time += dt;
    this.simulate(dt);
    this.particles.update(dt);
    this.track.update(this.time);
    const shot = this.phase === 'menu' ? 'menu' : this.resultsShown ? 'results' : 'chase';
    this.cam.update(this.camera, dt, this.time, this.player, shot);
    this.updateHud();
  }

  private render(dt: number): void {
    const { player } = this;
    this.focus.set(player.x, player.y, player.z);
    this.env.update(this.time, this.camera, this.focus);

    const sf = player.speed / V_MAX;
    const quiet = this.phase === 'menu' || this.resultsShown;
    const moving = this.phase === 'racing' || this.phase === 'finished';
    this.audio.update(sf, this.readControls().throttle, player.boostActive, player.drift, moving && !this.paused && !quiet);
    this.post.render(dt, this.time, quiet ? 0 : smoothstep(0.4, 1.2, sf), this.phase === 'menu' ? 0 : this.cam.boost);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- debug hooks (window.__game)

  /** Steps the simulation without waiting for animation frames. */
  debugAdvance(seconds: number, draw = true): void {
    for (let t = 0; t < seconds - 1e-6; t += 1 / 60) this.tick(1 / 60);
    if (draw) this.render(1 / 60);
  }

  debugAutopilot(on: boolean, pace = 0.9): void {
    this.autopilot = on;
    this.autoPace = pace;
  }

  get debug(): object {
    return {
      phase: this.phase,
      player: this.player,
      rivals: this.rivals,
      remotes: [...this.remotes.values()],
      track: this.track,
      laps: this.laps,
      host: this.isHost,
      resultsShown: this.resultsShown,
    };
  }
}
