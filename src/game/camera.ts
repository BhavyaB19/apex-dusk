import * as THREE from 'three';
import { V_MAX, type Player } from '../cars/player';
import { clamp, wrapAngle } from '../core/math';

export type CameraShot = 'chase' | 'menu' | 'results';

/** Chase and bonnet cameras for racing, plus a slow orbit for the menu and results screens. */
export class ChaseCamera {
  /** 0 = chase, 1 = bonnet. */
  mode = 0;
  shake = 0;
  /** Smoothed 0..1 boost amount, also used by the post-processing. */
  boost = 0;
  private yaw = 0;
  private y = 3;
  private look = new THREE.Vector3();
  private tmp = new THREE.Vector3();

  /** Jumps straight behind the car, for the start of a race. */
  snap(player: Player): void {
    this.yaw = player.yaw;
    this.y = player.y + 2.6;
    this.shake = 0;
    this.boost = 0;
  }

  update(camera: THREE.PerspectiveCamera, dt: number, time: number, player: Player, shot: CameraShot): void {
    const px = player.x;
    const py = player.y;
    const pz = player.z;
    const root = player.car.root;
    const sf = clamp(player.speed / V_MAX, 0, 1.35);
    this.boost += ((player.boostActive ? 1 : 0) - this.boost) * Math.min(1, dt * 4);
    this.shake *= Math.exp(-dt * 6);
    let fov = 58;

    if (shot !== 'chase') {
      const results = shot === 'results';
      const a = time * 0.2 + (results ? 0 : 2.5);
      const r = results ? 9.5 : 10.5;
      camera.position.set(px + Math.sin(a) * r, py + 2.3 + Math.sin(time * 0.3) * 0.5, pz + Math.cos(a) * r);
      this.look.set(px, py + 0.75, pz);
      camera.lookAt(this.look);
      fov = 42;
      this.yaw = player.yaw;
      this.y = py + 2.6;
    } else if (this.mode === 1) {
      this.tmp.set(0, 1.08, 0.75).applyQuaternion(root.quaternion);
      camera.position.set(px + this.tmp.x, py + this.tmp.y, pz + this.tmp.z);
      this.tmp.set(0, 0.85, 25).applyQuaternion(root.quaternion);
      this.look.set(px + this.tmp.x, py + this.tmp.y, pz + this.tmp.z);
      camera.lookAt(this.look);
      camera.rotateZ(player.car.chassis.rotation.z * 0.6);
      fov = 70 + sf * 12 + this.boost * 8;
    } else {
      // Aim between where the car points and where it is going, so drifts show the slide.
      let targetYaw = player.yaw;
      if (player.speed > 6 && player.forwardSpeed > 0) {
        targetYaw += wrapAngle(Math.atan2(player.vx, player.vz) - player.yaw) * 0.55;
      }
      this.yaw += wrapAngle(targetYaw - this.yaw) * (1 - Math.exp(-dt * 6.5));
      const dist = 7.3 + sf * 1.7 + this.boost * 1.3;
      const height = 2.5 + sf * 0.3;
      const dx = Math.sin(this.yaw);
      const dz = Math.cos(this.yaw);
      this.y += (py + height - this.y) * (1 - Math.exp(-dt * 9));
      const jitter = this.shake + this.boost * 0.035;
      camera.position.set(
        px - dx * dist + (Math.random() - 0.5) * jitter,
        this.y + (Math.random() - 0.5) * jitter,
        pz - dz * dist,
      );
      this.look.set(px + dx * 7, py + 1.2, pz + dz * 7);
      camera.lookAt(this.look);
      camera.rotateZ(-player.steer * 0.03 * sf);
      fov = 58 + sf * 17 + this.boost * 11;
    }
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
}
