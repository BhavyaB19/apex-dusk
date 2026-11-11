import type { Player } from '../cars/player';
import type { Particles } from '../world/particles';

/** Another car, treated as a 4.3 m by 2 m box aligned with its forward vector. */
export interface Body {
  x: number;
  z: number;
  fx: number;
  fz: number;
  speed: number;
  nudge(dLat: number, dSpeed: number): void;
}

/**
 * Pushes the player out of any car it overlaps and trades some speed.
 * Returns the hardest hit this frame, 0 to 1, for camera shake and sound.
 */
export function collidePlayer(player: Player, bodies: Iterable<Body>, particles: Particles): number {
  let hit = 0;
  for (const b of bodies) {
    const dx = player.x - b.x;
    const dz = player.z - b.z;
    if (dx * dx + dz * dz > 30) continue;
    const tx = b.fx;
    const tz = b.fz;
    const rx = -tz;
    const rz = tx;
    const along = dx * tx + dz * tz;
    const across = dx * rx + dz * rz;
    const penAlong = 4.3 - Math.abs(along);
    const penAcross = 2.0 - Math.abs(across);
    if (penAlong <= 0 || penAcross <= 0) continue;

    let impact = 0;
    if (penAcross < penAlong) {
      // Side contact
      const sg = across >= 0 ? 1 : -1;
      player.x += rx * sg * penAcross * 0.6;
      player.z += rz * sg * penAcross * 0.6;
      b.nudge(-sg * penAcross * 0.4, 0);
      const vrel = (player.vx * rx + player.vz * rz) * sg;
      if (vrel < 0) {
        player.vx -= rx * sg * vrel * 1.25;
        player.vz -= rz * sg * vrel * 1.25;
        impact = Math.min(1, -vrel / 12);
      }
    } else {
      // Nose to tail
      const sg = along >= 0 ? 1 : -1;
      player.x += tx * sg * penAlong * 0.7;
      player.z += tz * sg * penAlong * 0.7;
      const closing = (player.vx * tx + player.vz * tz - b.speed) * -sg;
      if (closing > 0) {
        player.vx += tx * sg * closing * 0.75;
        player.vz += tz * sg * closing * 0.75;
        b.nudge(0, -sg * closing * 0.35);
        impact = Math.min(1, closing / 18);
      }
    }

    if (impact > 0.15) {
      for (let j = 0; j < 8; j++) {
        particles.emit(
          (player.x + b.x) / 2 + (Math.random() - 0.5),
          player.y + 0.5,
          (player.z + b.z) / 2 + (Math.random() - 0.5),
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
    hit = Math.max(hit, impact);
  }
  return hit;
}
