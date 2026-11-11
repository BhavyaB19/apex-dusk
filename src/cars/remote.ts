import * as THREE from 'three';
import { Track, ROAD_HALF, makeFrame } from '../world/track';
import type { CarModel } from './model';
import type { Obstacle } from './rival';
import type { CarState } from '../../shared/protocol';
import { clamp, wrapAngle } from '../core/math';

const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Another player's car. Their browser simulates it; here it is drawn from the states they send,
 * coasting on the last known velocity between packets so it moves smoothly.
 */
export class RemoteCar implements Obstacle {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  prog = 0;
  lat = 0;
  speed = 0;
  fx = 0;
  fz = 1;
  finishTime: number | null = null;
  private nx = 0;
  private nz = 0;
  private nyaw = 0;
  private vx = 0;
  private vz = 0;
  private nprog = 0;
  private steer = 0;
  private boosting = false;
  private wheelSpin = 0;
  private frame = makeFrame();
  private label: THREE.Sprite;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly color: string,
    readonly car: CarModel,
    private track: Track,
  ) {
    this.label = makeLabel(name, color);
    car.root.add(this.label);
  }

  place(s: number, lat: number): void {
    const f = this.track.frame(s, this.frame);
    this.x = this.nx = f.pos.x + f.right.x * lat;
    this.z = this.nz = f.pos.z + f.right.z * lat;
    this.yaw = this.nyaw = Math.atan2(f.tan.x, f.tan.z);
    this.prog = this.nprog = s;
    this.lat = lat;
    this.vx = this.vz = this.speed = 0;
    this.finishTime = null;
    this.sync(1);
  }

  /** Data from another browser is untrusted, so every field is checked and clamped. */
  applyNet(d: CarState): void {
    if (!d || typeof d !== 'object') return;
    this.nx = finite(d.x, this.nx);
    this.nz = finite(d.z, this.nz);
    this.nyaw = finite(d.yaw, this.nyaw);
    this.vx = clamp(finite(d.vx, 0), -150, 150);
    this.vz = clamp(finite(d.vz, 0), -150, 150);
    this.nprog = finite(d.p, this.nprog);
    this.lat = clamp(finite(d.l, this.lat), -ROAD_HALF, ROAD_HALF);
    this.steer = clamp(finite(d.steer, 0), -1, 1);
    this.boosting = d.boost === true;
    const fin = finite(d.fin, -1);
    this.finishTime = fin >= 0 ? fin : null;
    // A big jump means a reset or a late packet burst: snap instead of sliding across the map.
    if (Math.hypot(this.nx - this.x, this.nz - this.z) > 40) {
      this.x = this.nx;
      this.z = this.nz;
      this.yaw = this.nyaw;
      this.prog = this.nprog;
    }
  }

  update(dt: number): void {
    this.nx += this.vx * dt;
    this.nz += this.vz * dt;
    this.speed = Math.hypot(this.vx, this.vz);
    this.nprog += (this.speed * dt) / this.track.ds;
    const k = Math.min(1, dt * 10);
    this.x += this.vx * dt + (this.nx - this.x - this.vx * dt) * k;
    this.z += this.vz * dt + (this.nz - this.z - this.vz * dt) * k;
    this.yaw += wrapAngle(this.nyaw - this.yaw) * k;
    this.prog += (this.nprog - this.prog) * k;
    this.wheelSpin += (this.speed * dt) / 0.37;
    this.sync(dt);
  }

  private sync(dt: number): void {
    const f = this.track.frame(this.prog, this.frame);
    const flat = Math.hypot(f.right.x, f.right.z) || 1;
    this.y = f.pos.y + (this.lat * f.right.y) / flat;
    this.fx = Math.sin(this.yaw);
    this.fz = Math.cos(this.yaw);

    _n.copy(f.normal);
    _f.set(this.fx, 0, this.fz);
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _x.crossVectors(_n, _f).normalize();
    _m.makeBasis(_x, _n, _f);
    _q.setFromRotationMatrix(_m);

    const car = this.car;
    car.root.position.set(this.x, this.y, this.z);
    car.root.quaternion.slerp(_q, Math.min(1, dt * 14));
    for (const w of car.wheels) w.rotation.x = this.wheelSpin;
    for (const pv of car.steerPivots) pv.rotation.y = -this.steer * 0.42;
    for (const fl of car.flames) fl.visible = this.boosting;
  }

  /** Collisions are resolved by each player for their own car, so a remote car never moves here. */
  nudge(): void {}

  dispose(): void {
    this.label.removeFromParent();
    this.label.material.map?.dispose();
    this.label.material.dispose();
    for (const fl of this.car.flames) fl.visible = false;
  }
}

function makeLabel(name: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = '700 34px Rajdhani, "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = Math.min(g.measureText(name).width + 36, 250);
  g.fillStyle = 'rgba(10, 6, 22, 0.7)';
  g.beginPath();
  g.roundRect(128 - w / 2, 10, w, 44, 10);
  g.fill();
  g.fillStyle = color;
  g.fillText(name, 128, 34, 230);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(3.6, 0.9, 1);
  sprite.position.set(0, 2.2, 0);
  return sprite;
}
