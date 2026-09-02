# MeasureCraft Fixes (27 Aug 2026)

## Shared material rates (Simple ↔ Pro)
- Rates transfer in both directions via `rates` + `materialLibrary` in mode-switch payloads.
- Pro snapshot restore includes materialLibrary and projectOverrides.
- Materials modal: empty cost → null; BOQ export table refreshed on save.

## PDF / underlay quality
- Simple → Pro uses PNG (edge ≤ 4000) or JPEG 0.95 instead of 0.85.

## Wall type
- Properties: Wall Type select (110mm Brick, 225mm Brick, 100/150/200mm Block).
- Stored as `el.wallType`; updates thickness + brick/block material hint.
- `classifyWallMasonry` prefers explicit wallType.

## Research dashboard
- `totalDrawings` = unique drawingId count in summary API.
- Dashboard shows Drawings and Projects separately.

## Slab shape editing (same interaction as columns)
- `ensureElementVertices(el)` assigns rectangle vertices when a slab/column lacks them (AI boxes, size-only elements).
- Called on select/draw, reshape hit-test, hover, and AI create so green vertex handles appear.
- Size handles (gold) still work without Shift; shape (green vertices / Shift+corner) works like columns.
- `planAreaM2` in material estimate uses `polygonArea` when vertices exist so irregular slab area/volume and BOQ update correctly after reshape.

## Material rate in BOQ Excel (Pro Mode)
- Root cause: `exportBoqExcel` wrote an empty string into the Rate column instead of `m.price`.
- Text export and on-screen BOQ already used `m.price` from `computeMaterialEstimate` → `materialLibrary`.
- Excel now writes the same `m.price` into Rate; Amount formula `IFERROR(D*E,0)` still applies.
- No separate rate system; works for manual and AI rates in Simple and Pro (Simple Excel was already correct).
