# 🎮 GamingX

A free browser gaming platform with **11 complete games** — one 2D canvas flagship and ten 3D titles built on **three.js** — plus **GX Forge**, a full game engine and no-code game maker. No build step, no downloads, no sign-ups. Open `index.html` and play.

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
games/soccer/               Soccer Pro '26 (2D canvas flagship)
games/nitro|void|stack|runner|breaker|
      penalty|snake|maze|hoop|whack/   Ten 3D games (index.html + game.js each)
games/create/               GX Forge: engine.js (GX Engine runtime),
                            index.html + editor.js/css (level editor),
                            play.html (plays published creations)
```
