# Wall Deduction, Movement & Overlap Fixes

Implemented geometry-aware, dynamic deduction and overlap handling in Pro Mode (`takeoff_pro.js`).

## 1. Automatic wall thickness standardization
- New `standardizeWallThickness(el)` snaps measured thickness to construction standards via existing `classifyWallMasonry` + `WALL_TYPE_OPTIONS`:
  - ~149–161 mm → **150 mm Block**
  - ~220–230 mm → **225 mm Brick**
  - 100 / 150 / 200 mm block and 110 / 225 mm brick retained
- Applied on:
  - Manual line wall creation (`createLineElement`)
  - AI wall detection (prefers measured short-side metres when realistic, then standardizes)
  - Property thickness edit (`prop-thk`)
  - Wall Type select
  - `sanitizeLineThicknesses` after calibrate
- Sets `el.wallType` and syncs attached cutout/deduction thickness.

## 2. Deductions move / rotate / resize with the wall
- Selection already expands via `expandSelectionWithChildren` (drag moves children).
- `moveElementBy`: also moves unselected attached children of walls.
- Free-rotate handle: `transformAttachedChildren` rotates deductions with the wall.
- Endpoint reshape & Properties length change: `realignAttachedDeductionsToWall` rebuilds cutout polygons on the wall centerline using current thickness.
- Thickness / wallType change: `syncAttachedDeductionThickness` + realign.

## 3. Wall–wall overlap
- `wallWallOverlapLengthDraw` + `computeWallWallOverlapDeductions`
- Shared centerline footprint split 50/50; deducted from net face area in `computeQuantities`.

## 4. Slab–slab overlap
- `computeSlabSlabOverlapDeductions` (AABB / plan overlap, 50/50)
- Applied in `processHorizontal` so overlapping slab area is not double-counted.

## 5. Beam–wall intersection
- In beam quantity loop: geometric intersection with walls deducts shared length × beam section from beam volume.

## 6. Dynamic recalculation
- All paths still call `renderAll` / `renderQuantityTable` / research sync on geometry edits.
- Quantities always derived from current geometry + linked deductions + pairwise overlaps.

## Preserved
- Existing detection, BOQ material estimate (gross face for BOQ vs net in live table), UI, manual editing, parentId / cutouts linkage.
