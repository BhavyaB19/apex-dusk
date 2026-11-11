/** Fully synthesised sound: engine, wind, tyre squeal and a few one-shots. No audio files. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private osc: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private squealGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);
    const types: OscillatorType[] = ['sawtooth', 'square', 'sawtooth'];
    const levels = [0.5, 0.3, 0.3];
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = levels[i];
      o.connect(g).connect(this.engineFilter);
      o.start();
      this.osc.push(o);
    });

    const loop = (freq: number, type: BiquadFilterType, q: number): GainNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return g;
    };
    this.windGain = loop(700, 'lowpass', 0.5);
    this.squealGain = loop(2300, 'bandpass', 6);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  /** speedFrac 0..~1.3, throttle 0..1, drift 0..1. */
  update(speedFrac: number, throttle: number, boosting: boolean, drift: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const gears = 5;
    const g = Math.min(speedFrac, 1.29) * gears;
    const within = g - Math.floor(g);
    const rpm = 0.32 + within * 0.5 + Math.min(speedFrac, 1.3) * 0.2;
    const f = 48 + rpm * 150 + (boosting ? 26 : 0);
    this.osc[0].frequency.setTargetAtTime(f, t, 0.04);
    this.osc[1].frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.osc[2].frequency.setTargetAtTime(f * 1.008 + 1.5, t, 0.04);
    this.engineFilter.frequency.setTargetAtTime(380 + rpm * 1500 + throttle * 900 + (boosting ? 1400 : 0), t, 0.06);
    this.engineGain.gain.setTargetAtTime(active ? 0.07 + throttle * 0.07 + (boosting ? 0.04 : 0) : 0, t, 0.08);
    this.windGain.gain.setTargetAtTime(active ? Math.min(speedFrac * speedFrac, 1.5) * 0.16 : 0, t, 0.1);
    this.squealGain.gain.setTargetAtTime(active ? drift * 0.05 : 0, t, 0.05);
  }

  beep(freq: number, dur: number, vol = 0.25): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  private burst(freq: number, type: BiquadFilterType, dur: number, vol: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur);
  }

  thud(intensity: number): void {
    this.burst(260, 'lowpass', 0.25, Math.min(0.2 + intensity * 0.5, 0.8));
  }

  whoosh(): void {
    this.burst(400, 'bandpass', 0.7, 0.4, 3200);
  }
}
