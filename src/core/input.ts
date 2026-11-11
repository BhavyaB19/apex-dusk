const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  private any(...codes: string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  get throttle(): number {
    return this.any('KeyW', 'ArrowUp') ? 1 : 0;
  }
  get brake(): number {
    return this.any('KeyS', 'ArrowDown') ? 1 : 0;
  }
  /** -1 left, +1 right. */
  get steer(): number {
    return (this.any('KeyD', 'ArrowRight') ? 1 : 0) - (this.any('KeyA', 'ArrowLeft') ? 1 : 0);
  }
  get handbrake(): boolean {
    return this.any('Space');
  }
  get boost(): boolean {
    return this.any('ShiftLeft', 'ShiftRight');
  }

  /** True once per physical key press. */
  consume(code: string): boolean {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
