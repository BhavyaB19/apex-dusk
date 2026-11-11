import type { RGB } from '../world/tracks';

/** A car's paint, glow colour and the matching colour for the minimap and lobby. */
export interface Livery {
  css: string;
  paint: number;
  accent: RGB;
}

/** One livery per grid slot. Slot 0 is the solo player's red car. */
export const LIVERIES: Livery[] = [
  { css: '#ff4b55', paint: 0xd9141f, accent: [3.2, 1.45, 0.25] },
  { css: '#4f9bff', paint: 0x1458e8, accent: [0.2, 1.6, 3.2] },
  { css: '#c35cff', paint: 0x8a1ad6, accent: [3.0, 0.3, 1.8] },
  { css: '#3fe08a', paint: 0x10a85a, accent: [0.7, 3.0, 0.4] },
  { css: '#e9ecf5', paint: 0xe6e8f0, accent: [0.4, 0.9, 3.0] },
  { css: '#ffd24a', paint: 0xf2b20c, accent: [3.0, 1.7, 0.2] },
];

export interface BotProfile {
  name: string;
  /** Fraction of the ideal corner speed this driver carries. */
  skill: number;
  topSpeed: number;
  /** Preferred lateral offset from the racing line, in metres. */
  lineBias: number;
}

/** AI rivals, fastest first. They take the front of the grid. */
export const BOTS: BotProfile[] = [
  { name: 'Volt', skill: 0.975, topSpeed: 76.5, lineBias: 0.4 },
  { name: 'Nova', skill: 0.95, topSpeed: 75.5, lineBias: -0.6 },
  { name: 'Hex', skill: 0.925, topSpeed: 74.5, lineBias: 0.8 },
  { name: 'Rune', skill: 0.905, topSpeed: 74, lineBias: -0.9 },
  { name: 'Echo', skill: 0.885, topSpeed: 73, lineBias: 0.2 },
];
