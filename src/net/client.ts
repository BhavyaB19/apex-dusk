import type { ClientMsg, ServerMsg } from '../../shared/protocol';

/**
 * Where the room server lives. By default it is the same host that served the page, on /ws.
 * Set VITE_SERVER_URL at build time when the game and the server are hosted separately.
 */
export function serverUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/** Thin wrapper around one WebSocket connection to the room server. */
export class NetClient {
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket | null = null;

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(timeoutMs = 5000): Promise<void> {
    if (this.open) return Promise.resolve();
    this.close();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serverUrl());
      this.ws = ws;
      let settled = false;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('unreachable'));
      };
      const timer = setTimeout(fail, timeoutMs);
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        fail();
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) return fail();
        if (this.ws === ws) {
          this.ws = null;
          this.onClose();
        }
      };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMsg;
        } catch {
          return;
        }
        if (msg && typeof msg === 'object' && typeof msg.t === 'string') this.onMessage(msg);
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.open) this.ws!.send(JSON.stringify(msg));
  }

  /** Closes quietly, without firing onClose. */
  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
