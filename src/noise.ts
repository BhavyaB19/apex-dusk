/** Small deterministic noise helpers used for terrain and prop placement. */

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iz: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [-1, 1]. */
export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal noise, roughly [-1, 1]. */
export function fbm(x: number, z: number, octaves = 5): number {
  let amp = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    s += amp * vnoise(x * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return s;
}

/** Ridged noise in [0, 1], sharp crests for mountains. */
export function ridged(x: number, z: number, octaves = 5): number {
  let amp = 0.5;
  let f = 1;
  let s = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f));
    s += amp * n * n;
    f *= 2.1;
    amp *= 0.5;
  }
  return s;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
