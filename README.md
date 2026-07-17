# 🎮 GamingX

A free browser gaming platform with **12 complete games** — one 2D canvas flagship, ten 3D titles built on **three.js**, and **Project Nexus**, a full nation-builder/strategy sim — plus **two creation tools**: GX Forge (2D game maker) and **GX Studio**, a real-time 3D game engine with physics, scripting and a full editor. No build step, no downloads, no sign-ups. Open `index.html` and play.

## ⚽ Soccer Pro '26 (flagship title)

A complete FIFA-style arcade football game, 11v11, fully playable on desktop and mobile.

**Play it:** open `games/soccer/index.html` (or click *Play Soccer Pro '26* from the hub).

### Features

- **Full match flow** — kickoff, two halves, running 0–90' match clock, half-time and full-time screens
- **8 selectable clubs** with distinct kits, crests and overall ratings (auto alt-kit on colour clash)
- **3 difficulty levels** (Amateur / Pro / Legend) and 3 match lengths (4 / 6 / 8 minutes)
- **11v11 AI** — formation-based positioning (4-4-2), chasing, dribbling with defender avoidance, pass-option scoring with interception risk, shooting decisions
- **Goalkeepers** — shot tracking, saves and parries based on shot power, catches, holds and long punts
- **Real set pieces** — throw-ins, corners (driven into the box) and goal kicks, with last-touch detection
- **Player controls** — move, sprint, directional passing, charged shots with power bar, slide tackles, manual + automatic player switching
- **Presentation** — camera follow, mowed-stripe pitch, goal nets, minimap radar, scoreboard, goal banners, WebAudio crowd/whistle/kick sounds
- **Touch support** — virtual stick + PASS / SHOT / SPRINT / SWITCH buttons on mobile
- **Persistent stats** — wins, draws, losses, goals and biggest win stored in `localStorage` and shown on the GamingX hub

### Controls (keyboard)

| Action | Keys |
|---|---|
| Move | WASD / Arrow keys |
| Sprint | Shift (hold) |
| Pass / Tackle | X or K |
| Shoot / Slide | C or L (hold to charge power) |
| Switch player | Z or J |
| Pause | P or Esc |

### Tips

- Hold **Shoot** longer for more power — but low-power placed shots are easier for you to keep on target.
- When defending, press **Pass** near the ball carrier for a standing tackle, or **Shoot** for a slide.
- Aim your passes with the movement keys — the best-placed teammate in that direction receives it.

### Dev notes

- World units: 1 m = 10 u, pitch 1050×680. All physics is delta-time based.
- Append `?half=SECONDS` to the soccer URL to override half length (useful for quick testing, e.g. `?half=20`).

## 🕹️ The 3D arcade (three.js)

All ten 3D games share the GamingX UI kit (`assets/css/game-ui.css` + `assets/js/gx.js`: overlays, HUD chips, WebAudio synth, localStorage high scores) and a vendored `three.min.js` (r128) — so everything works offline from `file://`.

| Game | Folder | Genre | The pitch |
|---|---|---|---|
| 🏎️ **Nitro Rush** | `games/nitro` | Endless racer | 4-lane highway, traffic AI, nitro meter, chase cam, distance score |
| 🚀 **Void Strikers** | `games/void` | Wave shooter | Drones/weavers/homing hunters, twin lasers, waves, lives, starfield |
| 🏗️ **Sky Stack** | `games/stack` | One-tap arcade | Sliding blocks, overhang trimming, falling debris, perfect-combo scoring |
| 🔮 **Orb Runner** | `games/runner` | Lane runner | Jump bars, wall gaps, coin arcs, speed ramp, rolling physics |
| 🧱 **Cube Breaker** | `games/breaker` | Breakout | Angled paddle rebounds, 2-hit armored bricks, endless levels |
| 🥅 **Penalty Kings** | `games/penalty` | Sports | Best-of-5 shootout: aim reticle, power bar, diving keeper, sudden death |
| 🐍 **Snake 3D** | `games/snake` | Classic | Neon grid, tick-based movement, swipe support, speed-up per meal |
| 🌀 **Maze Escape** | `games/maze` | First-person | Procedural mazes (recursive backtracker), pointer-lock look, timer runs |
| 🏀 **Hoop Shot** | `games/hoop` | Sports | Projectile + rim/backboard physics, 2pt/3pt spots, swish bonus, 60s |
| 🤖 **Whack-a-Bot** | `games/whack` | Reaction | Raycast clicking, combo multiplier, red bomb bots, 45s shifts |

Every game has: start/how-to overlay, live HUD, sound effects, game-over screen with replay, a persistent local high score (shown on its hub card), and keyboard + mouse/touch controls.

## 🛠️ GX Forge — create your own games

GX Forge (`games/create/`) is a complete game-creation suite built on the **GX Engine**, GamingX's own 2D runtime:

**The engine** (`engine.js`, dependency-free and portable):
- Tile-based worlds with two physics modes: **platformer** (gravity, variable-height jumps, coyote time, jump buffering, enemy stomping) and **top-down** (free 8-way movement)
- Entities: patrolling walker bots (edge + wall detection), sine-wave flyer bots
- Tiles: solid blocks, spikes, coins, goal flags, bounce pads, player spawn
- Camera follow with level clamping, parallax backdrop, four color themes, canvas HUD, built-in WebAudio SFX, keyboard + touch input, lives/score/timer, win/lose callbacks
- One call to run a game: `GXEngine.run(canvas, levelData, { onEnd })`

**The editor** (`index.html` + `editor.js`):
- Paint tiles on the grid (drag to paint, right-click to erase, Ctrl+Z undo)
- The palette and grid render with the exact same `drawTile` code as the runtime — what you paint is what you play
- New-game wizard: mode, three level sizes, blank canvas or remixable demo level (*Neon Canyon* / *Vault Dungeon*)
- Theme swatches, "collect all coins to finish" rule, instant fullscreen **Playtest**, autosaved drafts
- **My Games** manager (save/load/delete), **Share codes** (export/import games as JSON)
- **Publish** puts your game on the GamingX hub under **My Creations**, playable via `games/create/play.html?id=…` with per-game high scores

## 🧊 GX Studio — a real-time 3D game engine

GX Studio (`games/studio/`) is GamingX's 3D engine and editor: a genuine component-based, physics-driven, scriptable engine in the spirit of Unity/PlayCanvas — built entirely on **three.js** + **cannon-es**, with zero build step. (It's not chasing Unreal-grade fidelity — no Nanite/Lumen/AAA asset pipeline is realistic for a from-scratch browser engine — but the architecture underneath is the real thing: a scene graph, components, rigid-body physics, and live scripting.)

**The engine** (`engine.js`):
- **Entities** with a fixed Unity-style component model: Transform (always present), Mesh Renderer, Light, Camera, RigidBody, and any number of Scripts, arranged in a parent/child hierarchy
- **Rendering**: PBR materials (color/metalness/roughness/emissive/opacity/wireframe), directional/point/spot/ambient lights with shadow mapping, a procedural sky gradient + exponential fog, ACES filmic tone mapping, and a genuine **UnrealBloomPass** glow pass (the proper two-composer selective-bloom technique, not just a naive single pass)
- **Physics**: full rigid-body simulation via `cannon-es` — mass, box/sphere/cylinder colliders, friction, restitution, fixed rotation, collision events — stepped on a fixed timestep accumulator
- **Scripting**: attach any number of plain-JS scripts to any entity. Each gets an `onStart`/`onUpdate`/`onCollide` and a rich `api`: read/write transform, RigidBody velocity, `isGrounded()`, `find()`/`findAll()` by name/tag, `distance()`, `spawn()`/`destroy()`, a built-in `score`, `end({win, message})` to finish the game, and `log()` piped to an in-editor console. Top-level variables in a script persist as that script instance's state, closure-style
- Scene (de)serialization to JSON for save/load/publish, exactly like GX Forge

**The editor** (`index.html` + `editor.js`):
- A real 3-pane layout: **Hierarchy** (scene tree), **Viewport** (orbit camera, click-to-select, move/rotate/scale gizmos via `TransformControls`, Q/W/E/R hotkeys), **Inspector** (Transform + per-component fields, add/remove components, per-script code editor with an API cheat-sheet)
- **Scene Settings** tab: sky colors, fog, ambient light, gravity, shadows, bloom strength
- **Add Object** menu: primitives, lights, camera, and ready-made **game prefabs** (Player Controller, Camera Follow, Coin Pickup, Patrol Enemy, Moving Platform, Win Zone, Physics Crate) — each just an entity with a plain-JS script attached, fully editable
- **Play-in-editor**: press Play to run physics + scripts live in the same viewport (camera switches to the scene's Main Camera); Stop restores the exact pre-Play scene state; a console panel surfaces script errors and `log()` output
- New-scene templates (Empty / Physics Playground / Arena Adventure), undo, duplicate, My Projects manager, JSON share codes, and **Publish** to the hub's **My Creations**, playable via `games/studio/play.html?id=…`

## 🌐 Project Nexus — nation-builder strategy sim

Project Nexus (`games/nexus/`) is GamingX's grand-strategy title: start with a tiny settlement and grow it into a world power, on a procedurally generated planet shared with rival AI nations. It's a genuinely wide simulation — economy, politics, research, diplomacy and world events all feed into each other every tick — built to keep growing over future updates rather than a from-scratch AAA studio deliverable (that scope realistically takes years, not one build).

**World generation** (`worldgen.js`) — seeded value-noise elevation/moisture normalized to a full range, biomes (ocean, coast, plains, forest, hills, mountains, desert, tundra, wetland), resource deposits (iron, coal, oil, gold, fertile soil), downhill-flow rivers, and starting territory claimed for the player plus 4 AI nations, spaced apart on the same map.

**Simulation** (`simulation.js`) — one tick = one week:
- **Economy**: population growth toward housing capacity, employment vs. available jobs, GDP from built industry/commerce/agriculture, blended tax revenue, building upkeep, debt and compounding interest, inflation driven by debt pressure and deficit spending
- **Politics**: happiness and approval computed from services/tax burden/pollution/corruption and smoothed over time, elections (for electing governments) that can cost or renew your mandate, 5 AI political parties with shifting support, 6 toggleable laws
- **Tech**: 6 categories (Energy, Construction, Agriculture, Medicine, Manufacturing, Computing) of interlocking research, unlocking buildings and permanent bonuses
- **Diplomacy**: 4 AI nations simulated in the background (their own GDP/population/approval), trade agreements, alliances, non-aggression pacts and foreign aid, with a persistent relation score
- **~30 random events** (earthquakes, pandemics, scandals, breakthroughs, market crashes...) with weighted odds that react to your nation's actual state, each with multiple consequence-bearing choices
- 21 building types across 10 categories, real construction time, and a JSON save format with a version field for future migrations

**UI** (`ui.js` + `nexus.js`) — a pannable/zoomable canvas map with click-to-place buildings, a tabbed dashboard (Overview, Build, Economy, Politics, Tech, World, Territory, Events) with live sparkline graphs, an event-choice modal, toast notifications, speed controls (pause/1×/2×/3×), and localStorage save slots with autosave.

## Running locally

No server needed — everything works from `file://`. For a nicer setup:

```bash
cd gamingX
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
index.html                  GamingX hub (game library, stats, high scores)
assets/css/platform.css     Hub styling
assets/css/game-ui.css      Shared 3D-game UI (HUD, overlays, meters)
assets/js/three.min.js      Vendored three.js r128
assets/js/gx.js             Shared helpers: overlays, HUD, hi-scores, audio
assets/js/vendor/           Vendored OrbitControls, TransformControls, the
                            EffectComposer/bloom post-processing chain, and
                            cannon-es (physics), all as plain classic scripts
games/soccer/               Soccer Pro '26 (2D canvas flagship)
games/nitro|void|stack|runner|breaker|
      penalty|snake|maze|hoop|whack/   Ten 3D games (index.html + game.js each)
games/create/               GX Forge: engine.js (GX Engine 2D runtime),
                            index.html + editor.js/css (level editor),
                            play.html (plays published creations)
games/studio/                GX Studio: engine.js (3D engine + physics +
                            scripting runtime), index.html + editor.js/css
                            (3D scene editor), play.html (plays published
                            3D scenes)
games/nexus/                Project Nexus: data.js (buildings/tech/events/
                            governments), worldgen.js (procedural planet),
                            simulation.js (economy/politics/diplomacy tick
                            engine), ui.js (map + dashboards), nexus.js
                            (menus, game loop, save system), index.html/css
```
