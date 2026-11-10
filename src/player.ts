import * as THREE from 'three';
import { Track, ROAD_HALF, makeFrame } from './track';
import type { CarModel } from './car';
import type { Particles } from './particles';
import { clamp, lerp, wrapAngle } from './noise';

export const V_MAX = 78; // m/s, about 280 km/h
export const V_BOOST = 99;

export interface Controls {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

export class Player {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vz = 0;
  /** Fractional sample coordinate along the track, and lateral offset from the centre line. */
  s = 0;
  lat = 0;
  /** Cumulative progress in samples; negative before the first crossing of the line. */
  prog = 0;
  speed = 0;
  forwardSpeed = 0;
  boost = 0.5;
  boosting = false;
  drift = 0;
  steer = 0;
  /** Set when something hits the car this step; the game loop turns it into shake and sound. */
  impact = 0;
  padHit = false;
  wrongWay = false;
  private padTimer = 0;
  private wheelSpin = 0;
  private accelVis = 0;
  private grind = 0;
  private frame = makeFrame();

  constructor(
    readonly car: CarModel,
    private track: Track,
    private particles: Particles,
  ) {}

  /** Puts the car on the track at sample s with a lateral offset, stationary and facing forward. */
  place(s: number, lat: number, keepProgress = false): void {
    const f = this.track.frame(s, this.frame);
    this.x = f.pos.x + f.right.x * lat;
    this.z = f.pos.z + f.right.z * lat;
    this.y = f.pos.y + f.right.y * lat;
    this.yaw = Math.atan2(f.tan.x, f.tan.z);
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.drift = 0;
    this.steer = 0;
    this.lat = lat;
    const n = this.track.n;
    const sm = ((s % n) + n) % n;
    if (!keepProgress) {
      this.prog = s;
      this.boost = 0.5;
    }
    this.s = sm;
    this.padTimer = 0;
    this.syncModel(1, 0);
  }

  step(dt: number, c: Controls): void {
    const track = this.track;
    const fX = Math.sin(this.yaw);
    const fZ = Math.cos(this.yaw);
    let vF = this.vx * fX + this.vz * fZ;
    const sp = Math.abs(vF);

    // --- Steering ---
    this.steer += (c.steer - this.steer) * Math.min(1, dt * 9);
    const wantDrift = c.handbrake && sp > 14;
    const maxYaw = lerp(2.3, 1.02, clamp(sp / 82, 0, 1)) * (1 + this.drift * 0.38);
    const yawRate = -this.steer * Math.min(maxYaw, sp / 5.5) * (vF < -0.5 ? -1 : 1);
    this.yaw += yawRate * dt;

    // --- Decompose velocity in the new heading ---
    const f2X = Math.sin(this.yaw);
    const f2Z = Math.cos(this.yaw);
    const rX = -f2Z;
    const rZ = f2X;
    vF = this.vx * f2X + this.vz * f2Z;
    let vL = this.vx * rX + this.vz * rZ;
    const before = Math.hypot(vF, vL);

    // --- Drift state and grip ---
    const sliding = Math.abs(vL) > 5.5;
    const driftTarget = wantDrift ? 1 : sliding && this.drift > 0.2 ? Math.min(this.drift, 0.8) : 0;
    this.drift += (driftTarget - this.drift) * Math.min(1, dt * (driftTarget > this.drift ? 7 : 2.6));
    const grip = lerp(11.5, 2.4, this.drift);
    vL *= Math.exp(-grip * dt);

    // Give back most of the speed that tyre scrub removed, so corners flow.
    const after = Math.hypot(vF, vL);
    if (after > 0.01) {
      const keep = lerp(0.72, 0.93, this.drift);
      const k = lerp(after, before, keep) / after;
      vF *= k;
      vL *= k;
    }

    // --- Boost ---
    this.padHit = false;
    this.padTimer = Math.max(0, this.padTimer - dt);
    this.boosting = c.boost && this.boost > 0.01;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt * 0.3);
    else this.boost = Math.min(1, this.boost + dt * 0.022);
    if (this.drift > 0.3 && Math.abs(vL) > 3 && sp > 14) {
      this.boost = Math.min(1, this.boost + dt * 0.13 * clamp(Math.abs(vL) / 9, 0.3, 1.5));
    }
    const boosted = this.boosting || this.padTimer > 0;
    const vmax = this.padTimer > 0 ? V_BOOST + 6 : this.boosting ? V_BOOST : V_MAX;

    // --- Longitudinal forces ---
    let acc = 0;
    const throttle = Math.max(c.throttle, boosted ? 1 : 0);
    if (throttle > 0) acc += throttle * 27 * Math.max(0, 1 - vF / vmax);
    if (boosted) acc += 20 * Math.max(0, 1 - vF / vmax);
    if (c.brake > 0) {
      if (vF > 1.5) acc -= 44 * c.brake;
      else if (vF > -20) acc -= 14 * c.brake;
    }
    if (throttle === 0 && c.brake === 0) acc -= vF * 0.32;
    if (vF > vmax) acc -= (vF - vmax) * 1.6;
    if (c.handbrake) acc -= Math.sign(vF) * 5;
    vF += acc * dt;
    this.accelVis += (acc - this.accelVis) * Math.min(1, dt * 6);

    this.vx = f2X * vF + rX * vL;
    this.vz = f2Z * vF + rZ * vL;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- Track constraint ---
    const n = track.n;
    const i = track.nearest(this.x, this.z, Math.round(this.s) % n, 28);
    const k = i * 3;
    let tfx = track.T[k];
    let tfz = track.T[k + 2];
    const tl = Math.hypot(tfx, tfz) || 1;
    tfx /= tl;
    tfz /= tl;
    // Flat right vector is the tangent rotated a quarter turn.
    const frx = -tfz;
    const frz = tfx;
    const dx = this.x - track.P[k];
    const dz = this.z - track.P[k + 2];
    let d = dx * frx + dz * frz;
    const along = dx * tfx + dz * tfz;
    const sNew = i + clamp(along / track.ds, -0.9, 0.9);
    let delta = sNew - this.s;
    if (delta > n / 2) delta -= n;
    else if (delta < -n / 2) delta += n;
    this.prog += delta;
    this.s = ((sNew % n) + n) % n;

    const limit = ROAD_HALF - 1.0;
    this.impact = 0;
    if (Math.abs(d) > limit) {
      const sg = Math.sign(d);
      const pen = Math.abs(d) - limit;
      this.x -= frx * sg * pen;
      this.z -= frz * sg * pen;
      d = sg * limit;
      const vn = (this.vx * frx + this.vz * frz) * sg;
      if (vn > 0) {
        this.vx -= frx * sg * vn * 1.28;
        this.vz -= frz * sg * vn * 1.28;
        const loss = 1 - Math.min(0.3, vn * 0.011);
        this.vx *= loss;
        this.vz *= loss;
        if (vn > 3) this.impact = Math.min(1, vn / 22);
      }
      // Scrape friction, plus a nudge of the nose back along the track.
      const scrape = Math.exp(-0.55 * dt);
      this.vx *= scrape;
      this.vz *= scrape;
      const want = Math.atan2(tfx, tfz);
      const diff = wrapAngle(want - this.yaw);
      if (Math.abs(diff) < 2.5) this.yaw += diff * Math.min(1, dt * (this.speed < 12 ? 5 : 3.2));
      this.grind = 0.12;
      if (this.speed > 12) this.sparks(frx * sg, frz * sg, vn);
    }
    this.grind = Math.max(0, this.grind - dt);
    this.lat = d;

    this.speed = Math.hypot(this.vx, this.vz);
    this.forwardSpeed = vF;
    this.wrongWay = this.vx * tfx + this.vz * tfz < -6;

    // --- Boost pads ---
    for (const pad of track.pads) {
      let ds = this.s - pad.s;
      if (ds > n / 2) ds -= n;
      else if (ds < -n / 2) ds += n;
      if (Math.abs(ds) < 4.5 && Math.abs(d - pad.lat) < 3.1 && this.padTimer < 0.6 && vF > 8) {
        this.padTimer = 1.3;
        this.boost = Math.min(1, this.boost + 0.3);
        this.padHit = true;
        const kick = Math.min(12, Math.max(0, V_BOOST + 6 - vF));
        this.vx += f2X * kick;
        this.vz += f2Z * kick;
      }
    }

    this.wheelSpin += (vF * dt) / 0.37;
    this.effects(f2X, f2Z, rX, rZ, vL, boosted);
    this.syncModel(dt, yawRate);
  }

  get boostActive(): boolean {
    return this.boosting || this.padTimer > 0;
  }

  private sparks(nx: number, nz: number, vn: number): void {
    const p = this.particles;
    const count = vn > 3 ? 10 : 2;
    for (let i = 0; i < count; i++) {
      const r = Math.random;
      p.emit(
        this.x + nx * 0.95 + (r() - 0.5) * 1.5,
        this.y + 0.25 + r() * 0.5,
        this.z + nz * 0.95 + (r() - 0.5) * 1.5,
        this.vx * 0.55 - nx * (2 + r() * 7) + (r() - 0.5) * 6,
        2 + r() * 7,
        this.vz * 0.55 - nz * (2 + r() * 7) + (r() - 0.5) * 6,
        3.2,
        1.5 + r() * 0.8,
        0.35,
        0.05 + r() * 0.06,
        0.35 + r() * 0.4,
        18,
        0.6,
      );
    }
  }

  private effects(fX: number, fZ: number, rX: number, rZ: number, vL: number, boosted: boolean): void {
    const p = this.particles;
    const r = Math.random;
    // Tyre haze from the rear wheels while sliding
    if (this.drift > 0.35 && this.speed > 12 && Math.abs(vL) > 2.5) {
      for (const side of [-1, 1]) {
        if (r() > 0.75) continue;
        p.emit(
          this.x - fX * 1.4 + rX * side * 0.9,
          this.y + 0.2,
          this.z - fZ * 1.4 + rZ * side * 0.9,
          this.vx * 0.25 + (r() - 0.5) * 2,
          0.8 + r() * 1.4,
          this.vz * 0.25 + (r() - 0.5) * 2,
          0.2,
          0.13,
          0.24,
          0.55 + r() * 0.5,
          0.5 + r() * 0.35,
          -0.6,
          1.4,
        );
      }
    }
    // Exhaust plume while boosting
    if (boosted) {
      for (const side of [-1, 1]) {
        p.emit(
          this.x - fX * 2.5 + rX * side * 0.42,
          this.y + 0.38,
          this.z - fZ * 2.5 + rZ * side * 0.42,
          this.vx * 0.72 + (r() - 0.5) * 1.5,
          (r() - 0.3) * 1.5,
          this.vz * 0.72 + (r() - 0.5) * 1.5,
          0.5,
          1.5,
          3.0,
          0.14 + r() * 0.1,
          0.22 + r() * 0.16,
          0,
          1.5,
        );
      }
    }
    const car = this.car;
    for (const fl of car.flames) {
      fl.visible = boosted;
      if (boosted) fl.scale.set(1 + r() * 0.3, 1 + r() * 0.3, 0.8 + r() * 0.6);
    }
  }

  private syncModel(dt: number, yawRate: number): void {
    const f = this.track.frame(this.s, this.frame);
    const flat = Math.hypot(f.right.x, f.right.z) || 1;
    const targetY = f.pos.y + (this.lat * f.right.y) / flat;
    this.y = targetY;

    _n.copy(f.normal);
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _x.crossVectors(_n, _f).normalize();
    _m.makeBasis(_x, _n, _f);
    _q.setFromRotationMatrix(_m);

    const car = this.car;
    car.root.position.set(this.x, this.y, this.z);
    car.root.quaternion.slerp(_q, Math.min(1, dt * 18));

    // Body roll into corners and squat/dive under acceleration.
    const roll = clamp(yawRate * this.speed * 0.0016, -0.09, 0.09);
    const pitch = clamp(-this.accelVis * 0.0012, -0.045, 0.05);
    car.chassis.rotation.z += (roll - car.chassis.rotation.z) * Math.min(1, dt * 8);
    car.chassis.rotation.x += (pitch - car.chassis.rotation.x) * Math.min(1, dt * 8);
    for (const w of car.wheels) w.rotation.x = this.wheelSpin;
    for (const pv of car.steerPivots) pv.rotation.y = -this.steer * 0.42;
  }

  setBrakeLight(on: boolean): void {
    const c = this.car.tailMat.color;
    if (on) c.setRGB(6, 0.25, 0.35);
    else c.setRGB(2.4, 0.1, 0.18);
  }
}
