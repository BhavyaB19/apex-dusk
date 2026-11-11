import type { Game } from '../game/game';
import { NetClient } from '../net/client';
import { TRACKS, trackById } from '../world/tracks';
import { LIVERIES } from '../cars/roster';
import {
  DEFAULT_SETTINGS,
  LAP_CHOICES,
  MAX_PLAYERS,
  cleanName,
  type RaceSettings,
  type RoomInfo,
  type ServerMsg,
} from '../../shared/protocol';

type View = 'home' | 'join' | 'lobby';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const NAME_KEY = 'apex-dusk-name';

/** Title screen, room lobby and the buttons under the results table. */
export class Menu {
  private settings: RaceSettings = { ...DEFAULT_SETTINGS };
  private view: View = 'home';
  private net = new NetClient();
  private room: RoomInfo | null = null;
  private selfId = '';
  private busy = false;

  private menu = $('menu');
  private nameInput = $<HTMLInputElement>('name');
  private codeInput = $<HTMLInputElement>('code');

  constructor(private game: Game) {
    this.nameInput.value = localStorage.getItem(NAME_KEY) ?? '';

    $('solo').addEventListener('click', () => this.startSolo());
    $('multi').addEventListener('click', () => this.show('join'));
    $('backHome').addEventListener('click', () => this.show('home'));
    $('create').addEventListener('click', () => void this.enterRoom(null));
    $('join').addEventListener('click', () => void this.enterRoom(this.codeInput.value));
    $('startMulti').addEventListener('click', () => this.net.send({ t: 'start' }));
    $('leave').addEventListener('click', () => this.leaveRoom());
    // Blur after clicking so Space (drift) cannot re-press a focused button.
    $('hudMenu').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.game.setOverlay(true);
    });
    $('resume').addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.game.setOverlay(false);
    });
    $('quit').addEventListener('click', () => this.afterRace(false));
    $('again').addEventListener('click', () => this.afterRace(true));
    $('toMenu').addEventListener('click', () => this.afterRace(false));
    this.codeInput.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.enterRoom(this.codeInput.value);
    });

    for (const row of document.querySelectorAll<HTMLElement>('#options .opt')) {
      for (const btn of row.querySelectorAll<HTMLButtonElement>('.step')) {
        btn.addEventListener('click', () => this.step(row.dataset.opt!, Number(btn.dataset.dir)));
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' || e.repeat || e.target instanceof HTMLInputElement) return;
      if (this.view === 'home' && !this.menu.classList.contains('hidden')) this.startSolo();
      else if (!this.room && !$('results').classList.contains('hidden')) this.afterRace(true);
    });

    this.net.onMessage = (msg) => this.onMessage(msg);
    this.net.onClose = () => this.onDisconnect();
    game.onResults = (multi) => this.showResultButtons(multi);

    game.preview(this.settings.track, 0);
    this.refresh();
  }

  // ---------------------------------------------------------------- options

  private get isHost(): boolean {
    return this.room !== null && this.room.hostId === this.selfId;
  }

  /** Steps a race option. In a room only the host may, and the server confirms the change. */
  private step(opt: string, dir: number): void {
    if (this.room && !this.isHost) return;
    const s = { ...this.settings };
    if (opt === 'track') {
      const i = TRACKS.findIndex((t) => t.id === s.track);
      s.track = TRACKS[(i + dir + TRACKS.length) % TRACKS.length].id;
    } else if (opt === 'laps') {
      const i = LAP_CHOICES.findIndex((n) => n === s.laps);
      s.laps = LAP_CHOICES[Math.min(Math.max(i + dir, 0), LAP_CHOICES.length - 1)];
    } else if (opt === 'bots') {
      s.bots = !s.bots;
    }
    // Applied straight away so quick clicks add up; the server's copy follows.
    if (this.room) this.net.send({ t: 'settings', settings: s });
    this.applySettings(s);
  }

  private applySettings(s: RaceSettings): void {
    const trackChanged = s.track !== this.settings.track;
    this.settings = s;
    if (trackChanged && !this.game.racing) this.game.preview(s.track, this.ownSlot());
    this.refresh();
  }

  private ownSlot(): number {
    return this.room?.players.find((p) => p.id === this.selfId)?.slot ?? 0;
  }

  // ---------------------------------------------------------------- views

  private show(view: View): void {
    this.view = view;
    this.menu.classList.remove('hidden');
    $('netMsg').textContent = '';
    this.refresh();
    if (view === 'join') this.nameInput.focus();
  }

  private refresh(): void {
    const { view, settings, room } = this;
    const def = trackById(settings.track);
    this.menu.classList.toggle('compact', view !== 'home');
    $('viewHome').classList.toggle('hidden', view !== 'home');
    $('viewJoin').classList.toggle('hidden', view !== 'join');
    $('viewLobby').classList.toggle('hidden', view !== 'lobby');
    $('lobbyActions').classList.toggle('hidden', view !== 'lobby');
    $('options').classList.toggle('hidden', view === 'join');
    $('optBotsRow').classList.toggle('hidden', view !== 'lobby');

    $('kicker').textContent = def.tagline;
    $('optTrack').textContent = def.name;
    $('optLaps').textContent = String(settings.laps);
    $('optBots').textContent = settings.bots ? 'On' : 'Off';

    const locked = room !== null && !this.isHost;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#options .step')) btn.disabled = locked;

    if (view === 'lobby' && room) {
      $('roomCode').textContent = room.code;
      $('playerList').replaceChildren(
        ...room.players.map((p) => {
          const li = document.createElement('li');
          const dot = document.createElement('em');
          dot.style.background = LIVERIES[p.slot % LIVERIES.length].css;
          const name = document.createElement('span');
          name.textContent = p.name + (p.id === this.selfId ? ' (you)' : '');
          li.append(dot, name);
          if (p.id === room.hostId) {
            const tag = document.createElement('small');
            tag.textContent = 'Host';
            li.append(tag);
          }
          return li;
        }),
      );
      $('startMulti').classList.toggle('hidden', !this.isHost);
      const count = `${room.players.length} of ${MAX_PLAYERS} players`;
      $('lobbyNote').textContent = this.isHost
        ? `${count}. Start when everyone is in.`
        : `${count}. Waiting for the host to start.`;
    }
  }

  // ---------------------------------------------------------------- solo

  private startSolo(): void {
    this.menu.classList.add('hidden');
    this.game.startRace({ settings: { ...this.settings, bots: true }, multi: null });
  }

  // ---------------------------------------------------------------- rooms

  /** Connects if needed, then creates a room (code null) or joins one. */
  private async enterRoom(code: string | null): Promise<void> {
    if (this.busy) return;
    const note = $('netMsg');
    if (code !== null && code.trim().length !== 4) {
      note.textContent = 'Enter the four-letter room code.';
      return;
    }
    const name = cleanName(this.nameInput.value);
    this.nameInput.value = name;
    localStorage.setItem(NAME_KEY, name);
    this.busy = true;
    note.textContent = 'Connecting…';
    try {
      await this.net.connect();
      note.textContent = '';
      this.net.send(code === null ? { t: 'create', name } : { t: 'join', code: code.trim(), name });
    } catch {
      note.textContent = 'Could not reach the multiplayer server.';
    } finally {
      this.busy = false;
    }
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'joined':
        this.selfId = msg.id;
        this.room = msg.room;
        this.settings = { ...msg.room.settings };
        this.game.preview(this.settings.track, this.ownSlot());
        this.show('lobby');
        break;
      case 'room': {
        const wasRacing = this.room?.phase === 'race';
        this.room = msg.room;
        if (msg.room.phase === 'lobby') {
          // Either a lobby update, or the host has brought everyone back after a race.
          const trackChanged = msg.room.settings.track !== this.settings.track;
          this.settings = { ...msg.room.settings };
          if (wasRacing || this.game.racing || trackChanged) this.game.preview(this.settings.track, this.ownSlot());
          this.show('lobby');
        } else {
          this.game.setRoom(msg.room);
          this.showResultButtons(true);
        }
        break;
      }
      case 'start':
        this.room = msg.room;
        this.settings = { ...msg.room.settings };
        this.menu.classList.add('hidden');
        this.game.startRace({ settings: this.settings, multi: { net: this.net, room: msg.room, selfId: this.selfId } });
        break;
      case 'state':
        this.game.onNetState(msg.id, msg.d);
        break;
      case 'error':
        $('netMsg').textContent = msg.msg;
        break;
      case 'left':
        break;
    }
  }

  private leaveRoom(message = ''): void {
    this.net.send({ t: 'leave' });
    this.net.close();
    this.room = null;
    this.selfId = '';
    this.game.preview(this.settings.track, 0);
    this.show('home');
    $('netMsg').textContent = message;
  }

  private onDisconnect(): void {
    if (!this.room) return;
    this.room = null;
    this.selfId = '';
    this.game.preview(this.settings.track, 0);
    this.show('join');
    $('netMsg').textContent = 'Lost connection to the room.';
  }

  // ---------------------------------------------------------------- results

  /** Sets up the buttons under the results table for a solo race, the host, or a guest. */
  private showResultButtons(multi: boolean): void {
    const again = $('again');
    const toMenu = $('toMenu');
    const note = $('resNote');
    if (!multi) {
      again.textContent = 'Race again';
      again.classList.remove('hidden');
      toMenu.textContent = 'Menu';
      note.textContent = '';
      return;
    }
    again.textContent = 'Back to lobby';
    again.classList.toggle('hidden', !this.isHost);
    toMenu.textContent = 'Leave room';
    note.textContent = this.isHost ? '' : 'Waiting for the host to return to the lobby.';
  }

  /** `primary` is the left button: race again (solo) or back to lobby (host). */
  private afterRace(primary: boolean): void {
    if (!this.room) {
      if (primary) this.startSolo();
      else {
        this.game.preview(this.settings.track, 0);
        this.show('home');
      }
      return;
    }
    if (primary) this.net.send({ t: 'lobby' });
    else this.leaveRoom();
  }
}
