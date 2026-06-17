# 🌲 Trial Forest

A first-person walk-around of a **very large grassy field** built with
[Three.js](https://threejs.org/). The ground uses the supplied
`forested_floor.glb` as its grass texture, tiled across an enormous plane.

The world is green in every direction, but there is an **invisible limit** the
player cannot pass. A glowing force-field wall, an edge line, and wooden fence
posts mark the boundary — beyond it the grass keeps going (and trees dot the
distance), but movement is hard-clamped so you simply can't cross.

## Run it

It's a static site (ES modules + import maps), so any static server works:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Click to enter, then:

- **W A S D** / arrows — move
- **Mouse** — look
- **Shift** — run
- **Esc** — release the cursor

## Layout

```
index.html              # markup, HUD, overlay, import map
src/main.js             # scene, grass ground, boundary, movement
assets/forested_floor.glb  # supplied GLB, used as the grass texture
```

## Tuning

In `src/main.js`:

- `GROUND_HALF` — how far the visible green field extends.
- `BOUNDARY_HALF` — the limit the player cannot cross.
- `WALK_SPEED` / `RUN_SPEED` — movement speed.
