import type { Track } from '../world/track';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function fmtTime(t: number): string {
  if (!isFinite(t) || t <= 0) return '–:––.–––';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const SUFFIX = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th', 'th', 'th', 'th'];
export const ordinal = (n: number): string => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : SUFFIX[n % 10]);

export interface MapDot {
  x: number;
  z: number;
  color: string;
  player?: boolean;
}

export interface ResultRow {
  name: string;
  color: string;
  time: number;
  /** Still racing: the time is a projection. */
  pending: boolean;
  you: boolean;
}

/** In-race overlay: position, laps, times, speed gauge, boost bar, minimap and messages. */
export class Hud {
  private root = $('hud');
  private pos = $('pos');
  private posSuf = $('posSuf');
  private posTotal = $('posTotal');
  private lap = $('lap');
  private lapTotal = $('lapTotal');
  private time = $('time');
  private last = $('last');
  private best = $('best');
  private spd = $('spd');
  private arc = $('gArc') as unknown as SVGPathElement;
  private gaugeBox = document.querySelector('.br') as HTMLElement;
  private boostFill = $('boostFill');
  private msg = $('msg');
  private wrong = $('wrong');
  private map = $<HTMLCanvasElement>('map');
  private mapBg = document.createElement('canvas');
  private mapScale = 1;
  private mapOx = 0;
  private mapOz = 0;
  private arcLen: number;
  private lastSpeed = -1;
  private lastPos = -1;
  private lastLap = -1;

  constructor() {
    this.arcLen = this.arc.getTotalLength() || 387;
    this.arc.style.strokeDasharray = `${this.arcLen}`;
    this.mapBg.width = this.map.width;
    this.mapBg.height = this.map.height;
  }

  /** Pre-renders the circuit outline for the minimap. */
  setTrack(track: Track): void {
    const size = this.map.width;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      const x = track.P[i * 3];
      const z = track.P[i * 3 + 2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const pad = 16;
    this.mapScale = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.mapOx = size / 2 - ((minX + maxX) / 2) * this.mapScale;
    this.mapOz = size / 2 - ((minZ + maxZ) / 2) * this.mapScale;
    const g = this.mapBg.getContext('2d')!;
    g.clearRect(0, 0, size, size);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const path = (): void => {
      g.beginPath();
      for (let i = 0; i <= track.n; i += 2) {
        const k = (i % track.n) * 3;
        const px = track.P[k] * this.mapScale + this.mapOx;
        const pz = track.P[k + 2] * this.mapScale + this.mapOz;
        if (i === 0) g.moveTo(px, pz);
        else g.lineTo(px, pz);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = 'rgba(10,6,22,0.7)';
    g.lineWidth = 11;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 4;
    g.stroke();
    // Start line tick
    g.fillStyle = '#ffb347';
    g.fillRect(track.P[0] * this.mapScale + this.mapOx - 2, track.P[2] * this.mapScale + this.mapOz - 8, 4, 16);
  }

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
  }

  /** Sets the totals shown beside lap and position, and clears the previous race's values. */
  setRace(laps: number, cars: number): void {
    this.lapTotal.textContent = ` / ${laps}`;
    this.posTotal.textContent = `/ ${cars}`;
    this.lastPos = -1;
    this.lastLap = -1;
    this.msg.classList.remove('show');
    this.setWrongWay(false);
  }

  setSpeed(kmh: number, frac: number, boosting: boolean): void {
    const v = Math.round(kmh);
    if (v !== this.lastSpeed) {
      this.lastSpeed = v;
      this.spd.textContent = String(v);
    }
    this.arc.style.strokeDashoffset = `${this.arcLen * (1 - Math.min(Math.max(frac, 0), 1))}`;
    this.gaugeBox.classList.toggle('boosting', boosting);
  }

  setBoost(v: number): void {
    this.boostFill.style.width = `${Math.round(v * 100)}%`;
  }

  setPosition(p: number): void {
    if (p === this.lastPos) return;
    this.lastPos = p;
    this.pos.textContent = String(p);
    this.posSuf.textContent = ordinal(p);
  }

  setLap(l: number): void {
    if (l === this.lastLap) return;
    this.lastLap = l;
    this.lap.textContent = String(l);
  }

  setTimes(current: number, last: number, best: number): void {
    this.time.textContent = current <= 0 ? '0:00.000' : fmtTime(current);
    this.last.textContent = fmtTime(last);
    this.best.textContent = fmtTime(best);
  }

  setWrongWay(on: boolean): void {
    this.wrong.classList.toggle('hidden', !on);
  }

  message(text: string, small = false): void {
    const m = this.msg;
    m.textContent = text;
    m.classList.remove('show');
    m.classList.toggle('small', small);
    void m.offsetWidth; // restart the animation
    m.classList.add('show');
  }

  drawMap(dots: MapDot[]): void {
    const g = this.map.getContext('2d')!;
    const size = this.map.width;
    g.clearRect(0, 0, size, size);
    g.drawImage(this.mapBg, 0, 0);
    for (const d of dots) {
      const x = d.x * this.mapScale + this.mapOx;
      const z = d.z * this.mapScale + this.mapOz;
      g.beginPath();
      g.arc(x, z, d.player ? 6.5 : 4.5, 0, Math.PI * 2);
      g.fillStyle = d.color;
      g.fill();
      if (d.player) {
        g.lineWidth = 2.5;
        g.strokeStyle = '#fff';
        g.stroke();
      }
    }
  }

  /** Fills the results table. Called again as other cars finish. */
  showResults(place: number, rows: ResultRow[], bestLap: number, newBest: boolean): void {
    $('resTitle').textContent = `${place}${ordinal(place)} place`;
    $('resKicker').textContent = newBest
      ? `New best lap · ${fmtTime(bestLap)}`
      : `Race complete · best lap ${fmtTime(bestLap)}`;
    $('resList').replaceChildren(
      ...rows.map((r, i) => {
        const li = document.createElement('li');
        if (r.you) li.classList.add('you');
        if (r.pending) li.classList.add('pending');
        const n = document.createElement('i');
        n.textContent = String(i + 1);
        const dot = document.createElement('em');
        dot.style.background = r.color;
        const name = document.createElement('span');
        name.textContent = r.name;
        const t = document.createElement('b');
        t.textContent = r.pending ? 'racing' : fmtTime(r.time);
        li.append(n, dot, name, t);
        return li;
      }),
    );
    $('results').classList.remove('hidden');
  }

  hideResults(): void {
    $('results').classList.add('hidden');
  }
}
