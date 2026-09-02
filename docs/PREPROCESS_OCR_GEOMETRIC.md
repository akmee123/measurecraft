# Preprocess + OCR + Geometric Filters (Accuracy Pass)

This revision adds the three highest-ROI classical-CV style improvements on top of the existing Gemini tiled detector.

## A — High-contrast / sharpen preprocessing (`sharp`)

When `sharp` is installed (optionalDependency):

- Full image and each tile are run through `normalize()` + mild `modulate` + light `sharpen`.
- Colour is preserved (important for legend swatches).
- Controlled per request with `preprocess: false` in the body.

## B — OCR scale-bar & label assist (`tesseract.js`)

When `tesseract.js` is installed:

- A downscaled grayscale version of the plan is OCR’d.
- Scale patterns (`1:100`, `SCALE 1:50`, `25mm = 1m`, …) are extracted and returned as `scale: { ratio, text, source: "ocr" }` and also injected into the Gemini prompt as context.
- High-confidence text fragments (C1, COL, S1, …) are mapped back to pixel boxes.
- After Gemini returns detections, any box that contains a matching label is hard-corrected to the corresponding type and receives a small confidence boost (`ocrForced: true`).

Disable with `ocr_assist: false`.

## C — Geometric sanity filters

Always active (pure JS):

| Rule | Effect |
|------|--------|
| Minimum relative area | Drops tiny noise / text boxes |
| Column aspect ≤ 2.8 and max side ≤ 22 % of sheet short edge | Stops long thin boxes being called columns |
| Wall / beam aspect ≥ 2.2 | Stops near-square rooms being called walls |
| Door / window size & aspect caps | Rejects oversized or extreme openings |
| Soft confidence penalty | Borderline aspect ratios are de-prioritised for QS review |

Rejected counts are returned in `validation.geometricRejected` for debugging.

## Install (optional)

```bash
npm install          # already pulls optionalDependencies when possible
# or explicitly:
npm install sharp tesseract.js
```

`GET /api/health` now reports:

```json
{
  "sharp": true,
  "ocr": true,
  "features": {
    "preprocess": true,
    "realTileCrop": true,
    "ocrAssist": true,
    "geometricFilters": true
  }
}
```

## Request flags (all optional)

```json
{
  "image_base64": "...",
  "mime_type": "image/png",
  "pixel_w": 4200,
  "pixel_h": 2970,
  "mode": "tiled",
  "preprocess": true,
  "ocr_assist": true,
  "legend_notes": "..."
}
```

No client changes are required — existing callers continue to work and automatically benefit when the optional packages are present.
