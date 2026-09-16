# MeasureCraft JS modules

Incremental modularization of the Pro takeoff workspace.

| File | Role |
|------|------|
| `geometry.js` | **Pure plan geometry** — areas, clipping, wall footprints, junction overlap, hole cutouts. No DOM, no globals. |
| `provenance.js` | **Measurement provenance** — origin method, actor, edit count, frozen as-created geometry. No DOM, no globals. |
| `../document-model.js` | Schema v2 normalize / build / review rules |
| `../revisions.js` | Named revision snapshots |
| `../sheets.js` | Multi-sheet model + tab HTML |
| `../autosave.js` | IndexedDB debounced autosave |
| `../takeoff_pro.js` | Canvas, tools, quantities, AI, UI orchestration |

## The rule these modules exist to enforce

`tests/*.js` require `geometry.js` and `provenance.js` **directly** — the same
files the browser loads. Before this split, `tests/wall-wall-polygon-overlap.js`
carried its own copy of the maths under a "keep in sync" comment, so an edit to
`takeoff_pro.js` could break the app while the suite stayed green.

`tests/module-wiring.js` fails if a test ever re-implements a shared helper, or
if `takeoff_pro.html` stops loading the modules before the app.

Run everything with:

```bash
npm run check
```

## Units

`geometry.js` works in **drawing units** and knows nothing about metres.
`calibrationFactor` (cf) converts: `metres = draw * cf`, `m² = draw² * cf²`.
Physical member sizes (wall thickness, slab depth) are stored in metres, so a
thickness in drawing units is `thicknessM / cf`. Callers pass
`{ calibrationFactor, defaultThicknessM }` and convert the result.

## Next extraction targets

- `quantities.js` — material / wall / slab roll-up (still in `takeoff_pro.js`)
- `canvas-render.js` — 2D draw pipeline
- `ai-client.js` — detect / agent / assistant fetch wrappers

Prefer extracting **pure** helpers first; keep DOM and global state in
`takeoff_pro.js` until a React migration.
