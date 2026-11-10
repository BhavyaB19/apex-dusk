import * as THREE from 'three';
import { Track, ROAD_HALF, LAPS, makeFrame } from './track';
import type { CarModel } from './car';
import { clamp } from './noise';

export interface Obstacle {
  prog: number;
  lat: number;
  speed: number;
}

const _left = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** A rival that follows the circuit: brakes for corners, hugs the inside and dodges traffic. */
export class Rival implements Obstacle {
  prog = 0;
  lat = 0;
  speed = 0;
  x = 0;
  y = 0;
  z = 0;
  finishTime: number | null = null;
  private latVel = 0;
  private wheelSpin = 0;
  private frame = makeFrame();
  private wobble = Math.random() * 10;

  constructor(
    readonly name: string,
    readonly color: string,
    readonly car: CarModel,
    private track: Track,
    private skill: number,
    private topSpeed: number,
    private lineBias: number,
  ) {}

  place(s: number, lat: number): void {
    this.prog = s;
    this.lat = lat;
    this.speed = 0;
    this.latVel = 0;
    this.finishTime = null;
    this.sync(1);
  }

  update(dt: number, others: Obstacle[], playerProg: number, racing: boolean, raceTime: number): void {
    const track = this.track;
    const n = track.n;
    const i = ((Math.floor(this.prog) % n) + n) % n;

    let target = 0;
    if (racing) {
      target = Math.min(this.topSpeed, track.vLimit[i] * this.skill);
      // Gentle rubber band keeps the pack within reach of the player in both directions.
      const gap = (this.prog - playerProg) * track.ds;
      if (gap > 60) target *= 1 - clamp((gap - 60) / 500, 0, 0.1);
      else if (gap < -60) target *= 1 + clamp((-gap - 60) / 500, 0, 0.08);
      if (this.finishTime !== null) target *= 0.55;
    }

    // Racing line: drift towards the inside of whatever corner is coming.
    const ahead = track.curv[(i + 22) % n];
    this.wobble += dt;
    let latTarget = clamp(ahead * 420, -4.6, 4.6) + this.lineBias + Math.sin(this.wobble * 0.4) * 0.6;

    // Traffic: steer around a car just ahead, and lift if boxed in.
    for (const o of others) {
      if (o === this) continue;
      const gapM = (o.prog - this.prog) * track.ds;
      if (gapM > -2 && gapM < 26) {
        const dl = this.lat - o.lat;
        if (Math.abs(dl) < 2.7) {
          latTarget = o.lat + (dl >= 0 ? 3.4 : -3.4);
          if (Math.abs(latTarget) > ROAD_HALF - 1.6) latTarget = o.lat - (dl >= 0 ? 3.4 : -3.4);
          if (gapM < 8 && gapM > 0 && Math.abs(dl) < 2.1) target = Math.min(target, o.speed * 0.98);
        }
      }
    }
    latTarget = clamp(latTarget, -(ROAD_HALF - 1.5), ROAD_HALF - 1.5);

    const dv = target - this.speed;
    this.speed += clamp(dv, -30 * dt, 24 * dt * Math.max(0.08, 1 - this.speed / (this.topSpeed * 1.07)));
    if (this.speed < 0) this.speed = 0;

    const wantVel = clamp((latTarget - this.lat) * 1.6, -5, 5);
    this.latVel += (wantVel - this.latVel) * Math.min(1, dt * 5);
    this.lat += this.latVel * dt * clamp(this.speed / 20, 0, 1);

    this.prog += (this.speed * dt) / track.ds;
    if (racing && this.finishTime === null && this.prog >= n * LAPS) this.finishTime = raceTime;
    this.wheelSpin += (this.speed * dt) / 0.37;
    this.sync(dt);
  }

  /** Shoved sideways by a collision. */
  nudge(dLat: number, dSpeed: number): void {
    this.lat = clamp(this.lat + dLat, -(ROAD_HALF - 1.2), ROAD_HALF - 1.2);
    this.speed = Math.max(0, this.speed + dSpeed);
  }

  private sync(dt: number): void {
    const f = this.track.frame(this.prog, this.frame);
    this.x = f.pos.x + f.right.x * this.lat;
    this.y = f.pos.y + f.right.y * this.lat;
    this.z = f.pos.z + f.right.z * this.lat;

    // Nose follows the track, angled slightly by any sideways movement.
    const slip = this.speed > 2 ? clamp(this.latVel / Math.max(this.speed, 12), -0.25, 0.25) : 0;
    _fwd.copy(f.tan).addScaledVector(f.right, slip).normalize();
    _up.copy(f.normal);
    _left.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_left, _up).normalize();
    _m.makeBasis(_left, _up, _fwd);
    _q.setFromRotationMatrix(_m);

    const car = this.car;
    car.root.position.set(this.x, this.y, this.z);
    car.root.quaternion.slerp(_q, Math.min(1, dt * 12));
    const n = this.track.n;
    const curv = this.track.curv[((Math.floor(this.prog) % n) + n) % n];
    const roll = clamp(-curv * this.speed * this.speed * 0.0011, -0.07, 0.07);
    car.chassis.rotation.z += (roll - car.chassis.rotation.z) * Math.min(1, dt * 6);
    for (const w of car.wheels) w.rotation.x = this.wheelSpin;
    for (const pv of car.steerPivots) pv.rotation.y = clamp(-curv * 14, -0.4, 0.4);
  }
}
