# Apex Dusk

A 3D arcade racing game that runs in the browser. Race AI rivals on your own, or open a room and race up to five friends, drifting through corners to fill a boost meter.

Built with Three.js, TypeScript and Vite, with a small Node server for multiplayer rooms. Everything on screen is generated in code: the tracks, terrain, cars, sky, textures and sound. There are no image, model or audio files.

## Play it

- **Full game, with multiplayer:** https://apex-dusk.onrender.com (can take up to a minute to wake after being idle)
- **Solo only, loads instantly:** https://apex-dusk.netlify.app

## Run it

```bash
npm install
npm run dev
```

`npm run dev` serves the game and the multiplayer room server together.

For production, build the game and start the Node server, which serves the built files and the rooms from one process:

```bash
npm run build
npm start
```

It listens on `PORT` (default 3000). A static host such as Netlify can serve `dist` for solo play, but multiplayer needs the Node server running somewhere. If the two are hosted separately, set `VITE_SERVER_URL` (for example `wss://your-server.example/ws`) when building.

## Controls

| Key | Action |
| --- | --- |
| W A S D or arrows | Drive |
| Space | Drift (fills boost) |
| Shift | Boost |
| R | Reset to the track centre |
| C | Switch camera |
| Esc or P | Race menu: resume or quit (pauses a solo race) |
| M | Mute |

## What's in it

- Two circuits: Sunset Pass (1.9 km, dusk) and Aurora Ridge (2.1 km, night)
- Races of 1, 2, 3, 5, 7 or 10 laps
- Multiplayer rooms for up to 6 players, joined with a four-letter code
- Arcade handling with drifting, boost, and wall and car-to-car collisions
- AI rivals that brake for corners, take a racing line and avoid traffic
- Lap timing with a saved best lap per track, live position, minimap and results table
- Bloom, speed blur, real-time shadows and a synthesised engine sound

## Multiplayer

Choose Multiplayer, then create a room and share its code, or join with a code. The host picks the track, the lap count and whether AI rivals fill the empty grid slots, then starts the race.

Each browser simulates its own car and sends its position about 20 times a second; the server only relays those messages between players in a room. The host's browser also drives the AI rivals. If the host leaves, the next player takes over.

## Folder structure

```
server/            Node server
  index.ts           serves dist/ and hosts rooms (production)
  rooms.ts           room membership and message relay
shared/
  protocol.ts        message types and limits used by client and server
src/
  main.ts            entry point
  core/              input, audio, maths helpers
  world/             track definitions and themes, track mesh, scenery, particles
  cars/              car model, player physics, AI rivals, remote players, liveries
  game/              game loop and race state, camera, collisions
  render/            post-processing
  net/               WebSocket client
  ui/                HUD, menus and lobby, styles
```

To add a track, add an entry to `src/world/tracks.ts` (control points, boost pads and a colour theme) and its id to `TRACK_IDS` in `shared/protocol.ts`.

## Ideas for later

- Touch and gamepad controls
- More circuits
- Car select with different handling
- Difficulty levels
- Time trial mode with a ghost of your best lap
- Chat or quick emotes in the lobby
- Skid marks and more detailed car models
- Weather variants
- Music
- Online leaderboard
- Graphics quality setting for slower machines

## Credits

Made by Claude, directed by Bhavya.
