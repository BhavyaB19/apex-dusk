# Apex Dusk

A 3D arcade racing game that runs in the browser. You race five rivals over three laps of a twilight mountain circuit, drifting through corners to fill a boost meter.

Built with Three.js, TypeScript and Vite. Everything on screen is generated in code: the track, terrain, cars, sky, textures and sound. There are no image, model or audio files.

## Run it

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist`, which can be hosted anywhere.

## Controls

| Key | Action |
| --- | --- |
| W A S D or arrows | Drive |
| Space | Drift (fills boost) |
| Shift | Boost |
| R | Reset to the track centre |
| C | Switch camera |
| P or Esc | Pause |
| M | Mute |

## What's in it

- A 1.9 km banked circuit with elevation, boost pads and neon barriers
- Arcade handling with drifting, boost, and wall and car-to-car collisions
- Five rivals that brake for corners, take a racing line and avoid traffic
- Lap timing with a saved best lap, live position, minimap and results table
- Bloom, speed blur, real-time shadows and a synthesised engine sound

## Where things live

| File | What it does |
| --- | --- |
| `src/main.ts` | Game loop, race state, camera, collisions |
| `src/track.ts` | Circuit shape, road and barrier meshes |
| `src/world.ts` | Sky, lighting, terrain, water, scenery |
| `src/car.ts` | Car model |
| `src/player.ts` | Player physics |
| `src/ai.ts` | Rival drivers |
| `src/post.ts` | Post-processing effects |
| `src/hud.ts`, `src/style.css` | HUD and menus |
| `src/audio.ts` | Sound synthesis |

## Ideas for later

- Touch and gamepad controls
- More circuits, and a track select screen
- Car select with different handling
- Difficulty levels
- Time trial mode with a ghost of your best lap
- Skid marks and more detailed car models
- Day, night and weather variants
- Music
- Online leaderboard or multiplayer
- Graphics quality setting for slower machines

## Credits

Made by Claude, directed by Bhavya.
