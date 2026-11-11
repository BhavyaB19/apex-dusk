import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { attachRooms } from './rooms';

/** Production server: serves the built game from dist/ and hosts multiplayer rooms on /ws. */

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const port = Number(process.env.PORT) || 3000;

const app = express();
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});
app.use(express.static(dist));

const server = createServer(app);
attachRooms(server);
server.listen(port, () => {
  console.log(`Apex Dusk running on http://localhost:${port}`);
});
