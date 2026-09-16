# MeasureCraft AI Accuracy Architecture

**Goal:** Raise reliable detection of walls, doors, windows, columns, beams and slabs on Sri Lankan residential architectural drawings to a level usable by Quantity Surveyors (target ≥ 90 % usable detections after one review pass).

## Current State (as of this revision)

- Single full-sheet Gemini vision call.
- Optional legend / QS guidance text + up to 4 legend reference images.
- Server-side normalisation, coordinate clipping, confidence (0–1), near-duplicate removal (IoU ≥ 0.82).
- Frontend preserves AI_GENERATED / QS_REVIEWED / MANUAL / FINAL provenance.
- Research store records original AI boxes, human corrections, scale, legend, drawing ID for offline evaluation and future training.

## Target Pipeline

```
Upload Drawing (PDF / image)
        │
        ▼
1. Client Pre-flight
   • File size & type check
   • Approximate resolution / aspect
   • Rotation hint (optional)
   • “Looks like a floor plan?” heuristic
        │
        ▼
2. Server Quality Gate
   • Minimum pixel dimensions
   • Basic blur / contrast heuristics (optional)
   • Reject obviously unusable images early
        │
        ▼
3. Scale Detection (client + optional server OCR assist)
   • Auto-read “1:50”, “1:100”, scale bars
   • Fallback: two-point calibration with clear UI warning
        │
        ▼
4. Coarse Pass (full image, possibly downscaled)
   • Large structures: slabs, long wall runs, major beams
        │
        ▼
5. Fine / Tiled Pass
   • Divide drawing into overlapping tiles (e.g. 2×2 or 3×3 with 15–25 % overlap)
   • Higher effective resolution on each tile
   • Focus on small elements: doors, windows, columns
        │
        ▼
6. Merge + Non-Maximum Suppression (NMS)
   • Convert tile coordinates back to full-image space
   • IoU-based de-duplication
   • Confidence re-calibration (optional)
        │
        ▼
7. Optional Gemini Verifier Pass
   • Send ambiguous / low-confidence boxes back to Gemini with cropped context
        │
        ▼
8. QS Review UI
   • Accept / Edit / Reject per element
   • Colour coding by confidence + review status
   • Only accepted + manual elements enter quantities / BOQ
        │
        ▼
9. Research Loop
   • Store original AI, accepted, edited, rejected, ground-truth geometry
   • Compute per-class Precision, Recall, IoU, Quantity Error
   • Export YOLO / COCO format for offline training
```

## Phase Implementation Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Improved single-pass + legend + provenance | Done |
| 2 | Tiled / two-pass Gemini detection on server | Implemented in this revision |
| 3 | Stronger Accept/Reject/Edit UI + confidence colours | Enhanced in this revision |
| 4 | Pre-flight quality + scale checks | Implemented in this revision |
| 5 | YOLO specialised detector + Gemini verifier | Future (data format prepared) |
| 6 | Automatic scale OCR | Future |
| 7 | Production research storage (Postgres + S3) | Partial (S3 support exists) |

## Tiled Detection Design (current server implementation)

- **Coarse pass**: full image, prompt optimised for large elements (slab, long wall, beam).
- **Fine pass**: image divided into overlapping tiles (default 2×2 with ~20 % overlap). Each tile sent with a prompt focused on small elements (door, window, column) plus any large elements that fall inside the tile.
- Coordinates are offset back to full-image space.
- All results go through the existing `normalizeDetectedElements` + IoU NMS.
- Client can request `mode: "tiled"` (default) or `mode: "single"` for faster/cheaper runs.
- Tile size and overlap are configurable via request body for experimentation.

## YOLO Training Data Format (future)

When enough reviewed drawings exist, export in standard YOLO format:

```
dataset/
├── images/
│   ├── drawing_001.jpg
│   ├── drawing_002.jpg
│   └── ...
├── labels/
│   ├── drawing_001.txt
│   ├── drawing_002.txt
│   └── ...
└── data.yaml
```

`data.yaml` example:

```yaml
path: ./dataset
train: images
val: images   # split later
nc: 6
names: ['wall', 'door', 'window', 'column', 'beam', 'slab']
```

Each `.txt` label file (one line per object):

```
class_id x_center y_center width height
```

All values normalised 0–1 relative to image width/height.

**Class IDs**

| ID | Class  |
|----|--------|
| 0  | wall   |
| 1  | door   |
| 2  | window |
| 3  | column |
| 4  | beam   |
| 5  | slab   |

The existing research export already contains the required geometry; a conversion script can map `AI_GENERATED` / `QS_REVIEWED` / `MANUAL` boxes into this format after human final review.

## Evaluation Metrics (already partially implemented)

Report **per class**, never a single overall number:

- Precision = TP / (TP + FP)
- Recall = TP / (TP + FN)
- Mean IoU of matched boxes
- Quantity error % (after scale calibration) for length/area/volume

A true positive is defined by IoU ≥ 0.5 (or configurable) against ground-truth geometry of the same class.

## Confidence Policy

- Confidence is a **triage aid only**, never treated as accuracy.
- Suggested operational bands (UI):
  - ≥ 0.90 → High (green)
  - 0.70–0.89 → Review recommended (amber)
  - < 0.70 → Manual verification required (red)
- QS can still Accept / Edit / Reject any box regardless of confidence.

## Security & Cost Notes

- All Gemini calls remain server-side.
- Rate limiting and optional `MC_API_TOKEN` already present.
- Tiled mode increases cost and latency (multiple model calls). Expose a “Fast / Accurate” toggle in the UI.
- Keep research data private; never auto-train the hosted Gemini model from user data.

## Next Concrete Steps After This Revision

1. Collect 50–100 reviewed Sri Lankan house drawings via the research dashboard.
2. Convert reviewed boxes to YOLO format and train a baseline detector.
3. Replace or augment the coarse/fine Gemini passes with the specialised model.
4. Add automatic scale-bar / text OCR.
5. Move authentication fully server-side before any public release.

---

This document should be kept in sync with `server.js` and the AI-related sections of Simple Mode / Pro Mode.
