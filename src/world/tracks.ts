import type { TrackId } from '../../shared/protocol';

export type RGB = [number, number, number];

/** Everything that gives a circuit its look. Colours are linear RGB; values above 1 glow. */
export interface Theme {
  fog: RGB;
  fogDensity: number;
  sky: { zenith: RGB; mid: RGB; warm: RGB; cool: RGB; glow: RGB; disk: RGB; diskBoost: number };
  clouds: { dark: RGB; lit: RGB };
  stars: number;
  aurora: number;
  /** Direction towards the sun or moon. */
  sunDir: RGB;
  sunLight: RGB;
  sunIntensity: number;
  hemiSky: RGB;
  hemiGround: RGB;
  hemiIntensity: number;
  terrain: { shore: RGB; low: RGB; mid: RGB; rock: RGB; snow: RGB };
  water: RGB;
  trees: [RGB, RGB];
  wallLeft: RGB;
  wallRight: RGB;
  lamp: RGB;
  /** Arch lights and crystals cycle through these. */
  accents: RGB[];
}

export interface TrackDef {
  id: TrackId;
  name: string;
  tagline: string;
  /** Offsets the terrain noise so each circuit gets its own landscape. */
  seed: number;
  /** Closed loop of control points as [x, y, z]. The start line sits at the first point. */
  control: Array<[number, number, number]>;
  /** Boost pads as [fraction of lap, lateral offset in metres]. */
  pads: Array<[number, number]>;
  theme: Theme;
}

const SUNSET: Theme = {
  fog: [0.17, 0.06, 0.19],
  fogDensity: 0.00092,
  sky: {
    zenith: [0.01, 0.016, 0.07],
    mid: [0.15, 0.045, 0.3],
    warm: [0.86, 0.26, 0.15],
    cool: [0.22, 0.06, 0.24],
    glow: [1.0, 0.45, 0.18],
    disk: [1.0, 0.74, 0.44],
    diskBoost: 5,
  },
  clouds: { dark: [0.17, 0.06, 0.24], lit: [1.0, 0.36, 0.24] },
  stars: 1,
  aurora: 0,
  sunDir: [0.82, 0.13, 0.42],
  sunLight: [1.0, 0.52, 0.28],
  sunIntensity: 3.0,
  hemiSky: [0.42, 0.3, 0.72],
  hemiGround: [0.07, 0.05, 0.12],
  hemiIntensity: 0.95,
  terrain: {
    shore: [0.11, 0.07, 0.13],
    low: [0.03, 0.085, 0.09],
    mid: [0.085, 0.05, 0.15],
    rock: [0.36, 0.17, 0.34],
    snow: [1.0, 0.72, 0.78],
  },
  water: [0.3, 0.32, 0.5],
  trees: [
    [0.02, 0.11, 0.1],
    [0.1, 0.05, 0.17],
  ],
  wallLeft: [0.1, 1.05, 2.3],
  wallRight: [2.5, 0.22, 1.0],
  lamp: [3.0, 1.7, 0.7],
  accents: [
    [0.15, 1.3, 2.8],
    [2.9, 0.25, 1.3],
    [3.0, 1.5, 0.3],
  ],
};

const AURORA: Theme = {
  fog: [0.03, 0.075, 0.11],
  fogDensity: 0.00085,
  sky: {
    zenith: [0.003, 0.008, 0.03],
    mid: [0.012, 0.04, 0.1],
    warm: [0.16, 0.3, 0.4],
    cool: [0.04, 0.1, 0.16],
    glow: [0.35, 0.55, 0.8],
    disk: [0.92, 0.96, 1.0],
    diskBoost: 4,
  },
  clouds: { dark: [0.02, 0.05, 0.09], lit: [0.3, 0.45, 0.6] },
  stars: 1.8,
  aurora: 1,
  sunDir: [-0.52, 0.4, -0.75],
  sunLight: [0.55, 0.72, 1.0],
  sunIntensity: 1.9,
  hemiSky: [0.2, 0.45, 0.62],
  hemiGround: [0.03, 0.06, 0.09],
  hemiIntensity: 1.15,
  terrain: {
    shore: [0.05, 0.08, 0.1],
    low: [0.03, 0.07, 0.085],
    mid: [0.05, 0.085, 0.14],
    rock: [0.17, 0.24, 0.33],
    snow: [0.85, 0.97, 1.0],
  },
  water: [0.18, 0.36, 0.42],
  trees: [
    [0.015, 0.085, 0.09],
    [0.04, 0.06, 0.13],
  ],
  wallLeft: [0.15, 2.3, 1.1],
  wallRight: [1.3, 0.4, 2.7],
  lamp: [1.5, 2.2, 3.0],
  accents: [
    [0.2, 2.8, 1.5],
    [1.5, 0.5, 3.0],
    [0.6, 2.2, 3.0],
  ],
};

export const TRACKS: TrackDef[] = [
  {
    id: 'sunset-pass',
    name: 'Sunset Pass',
    tagline: 'Fast sweepers at dusk · 1.9 km',
    seed: 0,
    control: [
      [0, 0, 0],
      [160, 0, 0],
      [300, 3, 20],
      [380, 9, 110],
      [340, 17, 220],
      [220, 22, 250],
      [130, 17, 190],
      [40, 11, 240],
      [-40, 6, 340],
      [-170, 2, 360],
      [-280, 0, 290],
      [-300, 5, 170],
      [-220, 11, 100],
      [-270, 8, 10],
      [-210, 3, -30],
      [-110, 0, -4],
    ],
    pads: [
      [0.055, 0],
      [0.335, 3.2],
      [0.6, -3.2],
      [0.845, 0],
    ],
    theme: SUNSET,
  },
  {
    id: 'aurora-ridge',
    name: 'Aurora Ridge',
    tagline: 'Technical climb under the northern lights · 2.1 km',
    seed: 57,
    control: [
      [0, 0, 0],
      [180, 0, 0],
      [330, 3, -30],
      [430, 10, -130],
      [410, 20, -260],
      [290, 27, -320],
      [170, 24, -270],
      [120, 16, -160],
      [20, 12, -120],
      [-80, 18, -200],
      [-200, 24, -250],
      [-320, 16, -190],
      [-350, 8, -60],
      [-270, 3, 30],
      [-150, 0, 10],
    ],
    pads: [
      [0.05, 0],
      [0.27, -3.2],
      [0.52, 3.2],
      [0.76, 0],
    ],
    theme: AURORA,
  },
];

export const trackById = (id: string): TrackDef => TRACKS.find((t) => t.id === id) ?? TRACKS[0];
