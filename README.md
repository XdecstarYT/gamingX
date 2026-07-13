# 🎮 GamingX

A free browser gaming platform built with pure HTML5 canvas and JavaScript — no frameworks, no build step, no downloads. Open `index.html` and play.

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

## Running locally

No server needed — everything works from `file://`. For a nicer setup:

```bash
cd gamingX
python3 -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
index.html                  GamingX hub (game library + stats)
assets/css/platform.css     Hub styling
games/soccer/index.html     Soccer Pro '26 (menus + match screen)
games/soccer/soccer.css     Game UI styling
games/soccer/soccer.js      Complete game engine (~1200 lines)
```

## Roadmap

- 🏎️ Nitro Rush — top-down racing
- 🚀 Void Strikers — wave shooter
- 🧩 Hex Mind — puzzle grid
