import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  cleanName,
  cleanSettings,
  type ClientMsg,
  type RaceSettings,
  type RoomInfo,
  type ServerMsg,
} from '../shared/protocol';

/**
 * Room server. It only manages who is in which room and relays car states between them;
 * every browser simulates its own car, so there is no game logic here.
 */

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  slot: number;
  room: Room | null;
  alive: boolean;
  /** Messages received in the current one-second window, for flood protection. */
  burst: number;
}

interface Room {
  code: string;
  hostId: string;
  phase: 'lobby' | 'race';
  settings: RaceSettings;
  clients: Map<string, Client>;
}

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_MESSAGES_PER_SECOND = 60;

export function attachRooms(server: HttpServer, path = '/ws'): void {
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== path) return; // Not ours, e.g. the dev server's hot-reload socket.
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (c: Client, msg: ServerMsg): void => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  };

  const info = (room: Room): RoomInfo => ({
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    settings: room.settings,
    players: [...room.clients.values()]
      .map((c) => ({ id: c.id, name: c.name, slot: c.slot }))
      .sort((a, b) => a.slot - b.slot),
  });

  const broadcast = (room: Room, msg: ServerMsg, except?: Client): void => {
    for (const c of room.clients.values()) if (c !== except) send(c, msg);
  };

  const newCode = (): string => {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
  };

  const freeSlot = (room: Room): number => {
    const used = new Set([...room.clients.values()].map((c) => c.slot));
    for (let s = 0; s < MAX_PLAYERS; s++) if (!used.has(s)) return s;
    return -1;
  };

  const leave = (c: Client): void => {
    const room = c.room;
    if (!room) return;
    c.room = null;
    room.clients.delete(c.id);
    if (room.clients.size === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.hostId === c.id) room.hostId = info(room).players[0].id;
    broadcast(room, { t: 'room', room: info(room) });
  };

  const enter = (c: Client, room: Room, name: unknown): void => {
    leave(c);
    c.name = cleanName(name);
    c.slot = freeSlot(room);
    c.room = room;
    room.clients.set(c.id, c);
    send(c, { t: 'joined', id: c.id, room: info(room) });
    broadcast(room, { t: 'room', room: info(room) }, c);
  };

  const handle = (c: Client, msg: ClientMsg): void => {
    const room = c.room;
    const isHost = room !== null && room.hostId === c.id;
    switch (msg.t) {
      case 'create': {
        const created: Room = {
          code: newCode(),
          hostId: c.id,
          phase: 'lobby',
          settings: { ...DEFAULT_SETTINGS },
          clients: new Map(),
        };
        rooms.set(created.code, created);
        enter(c, created, msg.name);
        break;
      }
      case 'join': {
        const code = typeof msg.code === 'string' ? msg.code.trim().toUpperCase() : '';
        const target = rooms.get(code);
        if (!target) send(c, { t: 'error', msg: 'No room with that code.' });
        else if (target.phase === 'race') send(c, { t: 'error', msg: 'That room is mid-race. Try again shortly.' });
        else if (target.clients.size >= MAX_PLAYERS) send(c, { t: 'error', msg: 'That room is full.' });
        else enter(c, target, msg.name);
        break;
      }
      case 'settings': {
        const settings = cleanSettings(msg.settings);
        if (!room || !isHost || room.phase !== 'lobby' || !settings) break;
        room.settings = settings;
        broadcast(room, { t: 'room', room: info(room) });
        break;
      }
      case 'start': {
        if (!room || !isHost || room.phase !== 'lobby') break;
        room.phase = 'race';
        broadcast(room, { t: 'start', room: info(room) });
        break;
      }
      case 'lobby': {
        if (!room || !isHost || room.phase !== 'race') break;
        room.phase = 'lobby';
        broadcast(room, { t: 'room', room: info(room) });
        break;
      }
      case 'leave': {
        leave(c);
        send(c, { t: 'left' });
        break;
      }
      case 'state': {
        if (!room || room.phase !== 'race' || !msg.d || typeof msg.d !== 'object') break;
        broadcast(room, { t: 'state', id: c.id, d: msg.d }, c);
        break;
      }
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const c: Client = { id: randomUUID().slice(0, 8), ws, name: 'Driver', slot: 0, room: null, alive: true, burst: 0 };
    clients.add(c);
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (data) => {
      if (++c.burst > MAX_MESSAGES_PER_SECOND) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      handle(c, msg);
    });
    ws.on('close', () => {
      leave(c);
      clients.delete(c);
    });
    ws.on('error', () => ws.terminate());
  });

  // Reset flood counters every second; drop connections that stop answering pings.
  const burstTimer = setInterval(() => {
    for (const c of clients) c.burst = 0;
  }, 1000);
  const pingTimer = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 30000);
  server.on('close', () => {
    clearInterval(burstTimer);
    clearInterval(pingTimer);
    wss.close();
  });
}
