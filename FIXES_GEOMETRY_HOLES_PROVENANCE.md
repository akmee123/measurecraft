# Geometry module · real hole cutouts · provenance

Three changes, in the order they depend on each other.

---

## 1. Pure geometry module — `public/js/modules/geometry.js`

### The problem

`tests/wall-wall-polygon-overlap.js` opened with:

> Pure geometry helpers (copied from takeoff_pro.js – keep in sync)

The tests were exercising a **fork** of the shipped maths. `polygonArea`,
`polygonIntersectionArea`, `getWallFootprintVertices` and
`wallWallOverlapLengthDraw` lived at four separate places inside a 13.7k-line
file and again inside the test. Any edit to one could leave the suite green
while the app was wrong.

### What changed

All pure plan geometry now lives in one dependency-free UMD module —
`window.MCGeometry` in the browser, `require()` in Node, no build step.

`takeoff_pro.js` keeps its old function names as thin wrappers that delegate to
the module (with the previous implementation retained as a fallback only for the
case where the module script fails to load). The tests require the module
directly.

Exported: `polygonArea`, `polygonSignedArea`, `polygonPerimeter`,
`polygonBounds`, `polygonCentroid`, `pointInPolygon`, `pointOnPolygonBoundary`,
`distancePointToSegment`, `polygonIntersection`, `polygonIntersectionArea`,
`getAbsolutePlanVertices`, `getWallFootprintVertices`, `getElementPlanVertices`,
`overlapLengthFromFootprints`, `wallWallOverlapLengthDraw`,
`computeWallWallOverlapDeductions`, `clipHolesToParent`, `netAreaWithHoles`,
`netPerimeterWithHoles`, `areaWithCutouts`.

### Behaviour

Unchanged. The wall–wall polygon fix behaves exactly as shipped; the legacy
centreline heuristic is still there under the name
`wallWallOverlapLengthLegacy` and is passed to the module as a `fallback` for
elements with no usable footprint.

One latent bug was fixed on the way: the element factory hard-coded
`method: 'manual_draw'`, which meant `MCDocument.inferMethod` could never see an
AI-detected element and label it `ai_detect`. The default is now left null so
`source` decides.

---

## 2. Real hole cutouts on area elements

### The problem

Openings were subtracted arithmetically:

```js
aM2 = polygonArea(openingVertices) * cf * cf;   // full drawn area, always
cutAreaM2 += aM2;
```

Two consequences on real drawings:

* An opening drawn overlapping a slab **edge** deducted its whole area, including
  the part hanging off the slab. A 4×4 opening half over the edge removed 16 m²
  instead of 8 m².
* Two **overlapping** openings each deducted in full, so the shared region came
  off twice.

Neither shows up on a tidy test plan. Both show up on a real one.

### What changed

Openings are still sibling elements in the document — **nothing to migrate** —
but their quantities are now computed as true holes in the parent ring:

1. every candidate opening is clipped to the parent polygon;
2. rings that miss the parent entirely are dropped;
3. overlaps between openings are removed by pairwise inclusion–exclusion.

`computeAreaCutouts(el, openingsAll)` in `takeoff_pro.js` is the single entry
point, used by **both** the Live Quantities path and the Export path, so the two
cannot disagree.

### Perimeter

The module also returns the measured boundary once holes are cut, which the
arithmetic approach could not express at all:

* a void fully inside the slab **adds** its whole boundary;
* an edge notch **removes** the covered span of the slab edge and adds the notch
  sides.

Exposed as `el.netPerimeterM`. Nothing in the UI consumes it yet — it is there
for slab edge formwork / LF items.

### Accuracy limits (deliberate, documented in the module header)

Clipping is Sutherland–Hodgman, exact when the *clip* polygon is convex. Holes
are clipped by passing the **opening** as the clip polygon and the slab as the
subject, so a concave L-shaped slab is still measured exactly — openings are the
convex side in practice. Three-way hole overlaps are slightly conservative;
two-way (the realistic case) is exact.

No `@turf/*` or `jsts`. No build step, no CDN.

---

## 3. Provenance — `public/js/modules/provenance.js`

`reviewStatus` answers *"has a QS signed this off?"*. Provenance answers the
questions underneath it:

| Field | Meaning |
|---|---|
| `method` | `manual_draw` / `ai_detect` / `ai_agent` / `import` / `derived` |
| `role`, `actor`, `model` | who or what produced it, and who last touched it |
| `confidence` | detector confidence at creation |
| `editCount` | how many times a human has moved it since |
| `createdAt`, `lastEditedAt`, `reviewedAt`, `reviewedBy` | timeline |
| `geometrySnapshot` | **frozen** as-created ring — never overwritten |
| `snapshotAtEdit` | true when the snapshot could only be taken post-edit (legacy elements), so an audit does not trust it as the original |
| `history` | bounded trail, first correction always kept |

The frozen snapshot is the point. An AI proposal stays comparable against the
QS-corrected figure however many times it is subsequently edited — which is
exactly the raw material a holdout MAPE is computed from.

### Wiring

* element factory → `MCProvenance.create` on every new element
* `markElementEdited` → `recordEdit` (counts the correction, freezes the ring)
* `markElementReviewed` → `recordReview`
* `MCDocument.normalizeElement` → `MCProvenance.normalize`, so projects saved
  before this change are repaired on load rather than dropped
* the research/audit payload now carries `method` and `MCProvenance.summarize(el)`

`wasCorrectedByHuman(el)` distinguishes an untouched AI proposal from a
corrected one, and does not count a QS editing their own line.

---

## Tests

`npm run check` — syntax check on all three files, then:

| Suite | Count | Covers |
|---|---|---|
| `tests/wall-identity-regression.js` | – | stable element IDs (unchanged) |
| `tests/wall-wall-polygon-overlap.js` | 11 | T-junctions, collinear runs, cf scaling, fallback, ownership |
| `tests/area-cutout-holes.js` | 13 | edge-hanging holes, overlapping holes, notch perimeter, concave slabs |
| `tests/provenance.js` | 18 | snapshot freezing, edit counting, legacy repair |
| `tests/module-wiring.js` | 5 | the app really delegates; no test re-implements a helper |

`tests/module-wiring.js` is the anti-drift guard: it fails if a test file ever
defines its own `polygonIntersectionArea` or `getWallFootprintVertices` again,
or if `takeoff_pro.html` stops loading the modules before the app.

---

## Not done

* Slab edge formwork / LF is computed (`el.netPerimeterM`) but not surfaced in
  the BOQ or the inspector.
* Provenance is stored and exported but has no UI panel yet — `describe(el)`
  returns the one-liner ("AI detected · 2 edits") when you want one.
* The accuracy holdout itself. The data path is now complete end to end; what
  remains is running real projects through it and publishing the number.
