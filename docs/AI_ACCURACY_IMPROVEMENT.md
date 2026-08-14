# MeasureCraft AI Detection Accuracy Improvement

## What was limiting accuracy

The current application sends one compressed plan image to Gemini and asks for all walls, slabs, columns, beams, doors, and windows in one response. It already validates boxes and records manual review data, but the model had no structured way to receive a project's drawing legend. In addition, re-running detection previously removed manual measurements, which made accurate QS work difficult to use as ground truth.

## Changes included in this revision

The AI Detection step now includes an optional **Drawing legend / QS guidance** field. Users can describe colours, line styles, symbols, and items to ignore. The server passes this context to the vision prompt, tells the model to use it as a mapping only after confirming the symbol is visible, and explicitly excludes title blocks, dimensions, furniture, hatching, and legend swatches unless the user identifies them as target elements.

Re-running AI detection now preserves manual measurements and QS-edited AI items. Only unreviewed AI proposals are replaced. This allows a QS to mark accurate geometry manually, run AI again to find missing elements, and compare the two without losing the manual reference.

The research store already supports human-reviewed measurements and an offline training export. It does **not** automatically fine-tune Gemini, which is intentional: the exported drawings and labels should be reviewed, anonymised where necessary, and split into training and evaluation sets before any model training or prompt-library work.

## Recommended operating procedure

| Stage | QS action | Purpose |
|---|---|---|
| 1 | Upload the highest-resolution original drawing available | Preserve small doors, windows, columns, and line gaps. |
| 2 | Enter the drawing legend and exclusions | Reduce symbol and annotation confusion. |
| 3 | Run AI detection and accept only correct proposals | Build reviewed labels rather than trusting confidence alone. |
| 4 | Add or correct missing elements manually | Create the ground-truth geometry. |
| 5 | Re-run AI if necessary | New proposals are added while manual/QS-reviewed items remain. |
| 6 | Export research records and review them | Measure precision, recall, and quantity error by element type. |

## What will improve accuracy most

The strongest long-term improvement is a curated set of drawings with human-corrected boxes or line geometry. Use the existing research dashboard and training export to collect examples, then evaluate on drawings that were not used for prompt development. A small, clean dataset covering the actual drawing standards used by the company is usually more valuable than a large mixed dataset with inconsistent labels.

For difficult dense plans, the next engineering phase should add a two-pass or tiled detector: first detect large regions and rooms, then crop those regions and detect small openings, columns, and doors at higher resolution. The result should be merged with non-maximum suppression and reviewed against the manual ground truth. This is more reliable than asking one model response to localise every object on a very dense full-sheet drawing.

## Render configuration

No new API key is required. Keep `GEMINI_API_KEY` in Render Environment Variables. `GEMINI_MODEL=gemini-3.1-pro` may improve localisation where available, at higher latency and cost; `gemini-3.5-flash` remains a faster option. The legend text is sent as request data and is capped at 4,000 characters on the server.

## Important limitation

A legend, manual drawing, or corrected box does not automatically train the hosted Gemini model. It improves the prompt for that request and creates valuable labelled data for later evaluation or a dedicated detector. Automatic learning should only be added after the research data has been reviewed and the ground-truth policy is agreed.

## Suggested evaluation metrics

Track detection **precision** (how many proposed elements are correct), **recall** (how many true elements were found), box overlap such as IoU, and quantity error percentage after scale calibration. Report these separately for walls, slabs, columns, beams, doors, and windows; a single overall accuracy number can hide poor performance on small openings.

## Render deployment

Commit the modified `server.js`, `public/measurecraft_quantity_only.html`, and this document. Push to the branch connected to Render and redeploy. No database migration is needed for the legend field. Existing research files remain compatible.
