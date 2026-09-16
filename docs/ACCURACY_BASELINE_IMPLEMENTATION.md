# AI Detection Accuracy Baseline Implementation

## Implemented capability

MeasureCraft now preserves the raw AI proposal set when a participant exports a reviewed drawing. The final QS-reviewed geometry remains the ground truth, while the original AI-origin elements are stored separately in the annotation record as `aiElements`. Existing records remain readable; records created before this change simply do not contribute to the geometry-based baseline until they are re-exported.

The protected endpoint `GET /api/research/accuracy-baseline` calculates a baseline separately for walls, doors, windows, columns, beams, and slabs. The default matching threshold is an intersection-over-union (IoU) of 0.50 and may be changed with the `iouThreshold` query parameter. Matching is one-to-one within each element type, preventing one large proposal from receiving credit for multiple ground-truth elements.

The researcher dashboard now includes a baseline report table with the number of drawings, AI-marked elements, confirmed elements, precision, recall, and quantity error for each element type. Quantity error is calculated from reviewed measurement records using the absolute percentage difference between the final accepted value and the reference value, or the AI value when a reference is unavailable.

## Render deployment configuration

Set the following variables in the Render service environment before inviting participants:

| Variable | Requirement | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Required | Server-side AI detection and assistant features. |
| `GEMINI_MODEL` | Recommended | Use `gemini-3.5-flash` for speed or the project’s tested higher-accuracy model when available. |
| `RESEARCH_ADMIN_TOKEN` | Required | Protects the researcher dashboard and all admin research endpoints. Use a long, randomly generated secret. |
| `RESEARCH_STORAGE` | `s3` | Enables cloud persistence for research data. |
| `RESEARCH_S3_BUCKET` | Required with S3 | Bucket name. |
| `RESEARCH_S3_REGION` | Required with S3 | `auto` for compatible object storage where applicable. |
| `RESEARCH_S3_ENDPOINT` | Required for non-AWS S3-compatible storage | Object-storage endpoint. |
| `RESEARCH_S3_PREFIX` | Recommended | Defaults to `measurecraft-research`; use a project-specific prefix. |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Required with private bucket | Credentials with access limited to the research prefix. |

The dashboard fails closed when `RESEARCH_ADMIN_TOKEN` is absent. An open dashboard is permitted only for an explicitly opted-in non-production local run with `ALLOW_OPEN_RESEARCH_ADMIN=true`; this variable should not be set on Render.

## Operating procedure

First deploy the service and verify that the health endpoint reports the expected AI configuration. Then verify that the research dashboard rejects an empty or incorrect admin token and accepts the configured token. Upload a high-resolution drawing, enter its legend and exclusions, run detection, review every proposal, add missing elements manually, and export the reviewed drawing. Repeat this process across the six element types and across drawings that reflect the actual construction-document standards used in the study.

After several reviewed drawings have been collected, load the dashboard’s **AI detection baseline** report and record the per-type results. Do not combine the six types into one headline figure, because large wall or slab counts can hide poor door and window performance. For prompt changes or two-pass detection experiments, hold out drawings that were not used to develop the change, then compare the held-out precision, recall, and quantity-error results with the stored baseline.

## Limitations

The baseline is an evaluation report, not automatic model training. Existing historical annotation files without `aiElements` must be re-exported if geometry-level precision and recall are required. Quantity error remains dependent on the quality of scale calibration and on the project’s measurement records. Bounding-box IoU is appropriate for the current detector output, while line-based wall or beam evaluation may later benefit from a dedicated centreline or distance-tolerance metric.
