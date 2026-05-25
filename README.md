# BlueChicken — The Hatchling World

A small, dependency-free web app: nine eggs, nine very different souls inside, and a dynamic world to play with them in. Tap an egg six times to hatch what's in it. Each hatchling does something nobody else can do, and the world (sky, weather, day, night) shifts around them.

## Run

Open `index.html` in any modern browser. There is no build step and no server required.

```
xdg-open index.html         # Linux
open index.html             # macOS
start index.html            # Windows
```

## The roster

| #  | Name      | What hatches                | What only they can do                          |
|----|-----------|-----------------------------|------------------------------------------------|
| 1  | Aurora    | Sky-Whale                   | Sings a constellation into the night sky       |
| 2  | Magma     | Lava Pup                    | Dashes across the world leaving scorch trails  |
| 3  | Glimmer   | Crystal Fox                 | Refracts the sun into a seven-band rainbow     |
| 4  | Mossback  | Garden Turtle               | Plants grow on her shell over time             |
| 5  | Whisper   | Shadow Cat                  | Teleports between shadows, leaving riddles     |
| 6  | Pip       | Storm Sparrow               | Pocket rain cloud that makes flowers bloom     |
| 7  | Bubble    | Deep Jelly                  | Releases memory bubbles you can pop            |
| 8  | Ember     | Phoenix Chick               | Reborn from flame in a new feather color       |
| 9  | Solis     | The First Egg               | Hidden — appears when the other eight are joyful |

## Controls

- **Tap an egg** — six taps to hatch. The egg wiggles and cracks along the way.
- **Click a hatchling** — pet them (joy goes up) and open their journal.
- **Drag a hatchling** — carry them around. Aurora floats; Bubble bobs.
- **Roster pip (the gold dot)** — fire that character's special directly.

## Files

- `index.html` — stage layout, SVG defs, HUD, roster, inspector
- `styles.css` — sky gradients, animations, HUD chrome
- `characters.js` — all nine characters: art, story, palette, special ability
- `world.js` — time/weather, actors, special-ability effects, inspector wiring
- `main.js` — boot, layout, input (tap/drag/pet), game loop, Solis gate
