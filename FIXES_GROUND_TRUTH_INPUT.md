# Ground-truth (reference quantity) input — the missing write path

## What was broken

The research/accuracy pipeline in `research-store.js` was fully built: `logMeasurement`
already computed `difference` and `differencePct` against a `referenceMeasurement`
(`resolveReferenceMeasurement`), the dashboard had a form to set a per-drawing+type
ground truth (`setReferenceQuantity`, `POST /api/research/reference-quantities`), and
the live Pro-mode sync (`syncResearchQuantities` in `takeoff_pro.js`) already *read*
`el.referenceQty` per element and sent it as `referenceMeasurement`.

But nothing in the app ever *wrote* `el.referenceQty`. It was a dead field — read in
two places, set nowhere. That is the actual reason the shipped research dataset
(`data/research/measurements.jsonl`) has 183 records and not one non-null
`referenceMeasurement`: there was no way for a QS to tell the app what the real,
known quantity for an element was.

## What changed

- `public/takeoff_pro.html` — added a "Ref (GT)" column header to the live quantity
  table.
- `public/js/takeoff_pro.js` (`renderQuantityTable`) — each element-level row now
  gets a small number input bound to `el.referenceQty`. Leaving it blank does
  nothing; typing a value stores it on the element and immediately calls
  `scheduleResearchQuantitySync()` so the value reaches
  `/api/research/measurement` on the next sync tick. Aggregate rollup rows (no
  single `elementId`) show a dash — there's no single ground truth for a rollup.

No backend changes were needed: `logMeasurement`'s `resolveReferenceMeasurement`
and `differencePct` math already handle a `referenceMeasurement` correctly once one
actually arrives. No document-model changes were needed either —
`normalizeElement` does `Object.assign({}, raw, {...})`, so `referenceQty` already
survives save, autosave, and reload as an ordinary element field.

## What this does not fix

This only wires up the per-element path. The dashboard's per-drawing+type
`setReferenceQuantity` path is separate and still depends on a drawing actually
being registered (`MCResearch.registerDrawing`, which populates `drawingId`) before
any measurement referencing that drawing is logged — worth checking if you still
see `drawingId: null` rows after this change.

## Validation

`node --check public/js/takeoff_pro.js` passes. Not run against a live browser
session in this environment — recommend a quick manual pass: open Pro mode, draw an
element, type a value into its Ref (GT) cell, and confirm a following
`POST /api/research/measurement` payload carries `referenceMeasurement` and that
`differencePct` appears on the new record in `measurements.jsonl`.
