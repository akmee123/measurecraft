# Fix: Simple Mode vs Pro Mode BOQ quantities (same calibration / same measurements)

## Symptom
Same drawing, same scale string (`1 unit = 0.004380 m`), same accepted elements — Excel BOQ from Simple and Pro still differed (e.g. Cement 117.70 vs 109.40, Tiles 236 vs 201).

## Root causes (multiple)

| Rule | Simple (old) | Pro |
|------|--------------|-----|
| Wall face | Gross length × height | **Net** (openings + columns deducted) |
| Wall volume | Gross | **Net face × thickness** |
| Slab area / volume | Gross slab | **Net** (cutouts + wall/column footprints on slab) |
| Floor / tiling | Full slab area | **Net slab − wall footprint + 100 mm skirting** |
| Beam default width | **0.23 m** | **0.20 m** |
| Height field | `height` only | Prefer `zHeight`, else `height` |

Example from export notes:
- Simple used slab **80.82 m²** → adhesive 20.21, tiles 236  
- Pro used floor finish **68.61 m²** → adhesive 17.15, tiles 201  
- Cement gap ~8 bags ≈ concrete volume gap from slab structural netting (~1.2 m³) + smaller plaster/masonry netting

Calibration was never the bug — the **quantity formulas** differed.

## Fix (this package)

### Simple (`public/js/measurecraft_quantity_only.js`)
1. Net wall face via `simpleCollectWallDeductions` (openings + columns, parented or overlapping).
2. Wall volume = net face × thickness (match Pro).
3. Slab net area = gross − cutouts − wall/column plan footprints on the slab.
4. Floor finish = net slab − wall footprint + skirting 0.10 m.
5. Beam default width **0.20 m** (was 0.23).
6. Height resolution: `zHeight` → `height` → default.

### Pro (`public/js/takeoff_pro.js`)
1. Wall / opening / slab / column height falls back to `height` when `zHeight` missing (transfer safety).

## Verify after deploy
1. Hard-refresh both modes (Ctrl+Shift+R) so cached JS is not stale.
2. Same project / transfer Simple → Pro **without editing** elements.
3. Confirm scale line is identical.
4. Export Excel from both; compare Cement, Sand, Aggregate, Brick, Adhesive, Tiles and Element Quantities (Wall m², Floor / tiling area).

Small residual differences can remain on **diagonal line walls** (Pro uses polygon intersection; Simple uses AABB). Axis-aligned takeoffs should match within normal `Math.ceil` rounding on bricks/tiles.
