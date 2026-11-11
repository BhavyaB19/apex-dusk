/** Messages and limits shared by the browser client and the room server. */

export const MAX_PLAYERS = 6;
export const TRACK_IDS = ['sunset-pass', 'aurora-ridge'] as const;
export type TrackId = (typeof TRACK_IDS)[number];
export const LAP_CHOICES = [1, 2, 3, 5, 7, 10] as const;
export const NAME_MAX = 14;

export interface RaceSettings {
  track: TrackId;
  laps: number;
  /** Fill empty grid slots with AI rivals. */
  bots: boolean;
}

export const DEFAULT_SETTINGS: RaceSettings = { track: 'sunset-pass', laps: 3, bots: true };

export interface PlayerInfo {
  id: string;
  name: string;
  /** 0-5. Decides car livery and grid order. */
  slot: number;
}

export interface RoomInfo {
  code: string;
  hostId: string;
  phase: 'lobby' | 'race';
  settings: RaceSettings;
  players: PlayerInfo[];
}

/** One car's state, sent about 20 times a second. Each client simulates only its own car. */
export interface CarState {
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  /** Progress along the track in samples, and lateral offset in metres. */
  p: number;
  l: number;
  steer: number;
  boost: boolean;
  /** Finish time in seconds, or -1 while still racing. */
  fin: number;
  /** Host only: [progress, lateral, speed, finish time] for each AI rival. */
  bots?: number[][];
}

export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'settings'; settings: RaceSettings }
  | { t: 'start' }
  | { t: 'lobby' }
  | { t: 'leave' }
  | { t: 'state'; d: CarState };

export type ServerMsg =
  | { t: 'joined'; id: string; room: RoomInfo }
  | { t: 'room'; room: RoomInfo }
  | { t: 'start'; room: RoomInfo }
  | { t: 'left' }
  | { t: 'state'; id: string; d: CarState }
  | { t: 'error'; msg: string };

export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const trimmed = s.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, NAME_MAX);
  return trimmed || 'Driver';
}

export function cleanSettings(raw: unknown): RaceSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const track = TRACK_IDS.find((id) => id === r.track);
  const laps = LAP_CHOICES.find((n) => n === r.laps);
  if (!track || !laps || typeof r.bots !== 'boolean') return null;
  return { track, laps, bots: r.bots };
}
