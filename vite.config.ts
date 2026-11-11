import type { Server as HttpServer } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { attachRooms } from './server/rooms';

/** Runs the multiplayer room server inside the dev server, so `npm run dev` is all you need. */
function rooms(): Plugin {
  return {
    name: 'apex-dusk-rooms',
    configureServer(server) {
      if (server.httpServer) attachRooms(server.httpServer as HttpServer);
    },
    configurePreviewServer(server) {
      attachRooms(server.httpServer as HttpServer);
    },
  };
}

export default defineConfig({
  plugins: [rooms()],
  build: { chunkSizeWarningLimit: 900 },
});
