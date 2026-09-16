# Reviewed Drawing Dataset Workflow

## What this feature does

When a participant finishes reviewing a drawing and exports the BOQ or marked plan, MeasureCraft now uploads a structured record of the final visible and accepted drawing elements. The record is linked to the Drawing ID and Project ID and includes element geometry, source, review status, scale, and legend guidance.

This creates a reviewed dataset for offline evaluation or dedicated detector training. It does **not** automatically fine-tune Gemini.

## Participant instructions

1. Open the Render application URL.
2. Enter the participant ID supplied by the researcher.
3. Upload the original drawing at the highest available resolution.
4. Calibrate the drawing using a known dimension.
5. Enter the drawing legend and QS guidance in Simple Mode.
6. Run AI detection.
7. Open Professional Mode for detailed review.
8. Accept correct AI elements, edit incorrect elements, delete false detections, and draw missing elements manually.
9. Export the BOQ or marked drawing after the review is complete.
10. Do not refresh or close the page before the export finishes.

The export triggers three research actions: the original drawing remains linked to the Drawing ID, the marked plan is saved for visual review, and the reviewed element annotations are saved for dataset export.

## Researcher instructions

Keep the `RESEARCH_ADMIN_TOKEN` private. Open the protected research dashboard or download the reviewed dataset using the configured token. The reviewed annotation export is available at:

```text
/api/research/annotation-export
```

The combined research export is available at:

```text
/api/research/training-export
```

The combined export includes the legacy measurement samples and a `reviewedAnnotations` collection. Each reviewed drawing record contains the original drawing linkage and an `elements` array.

## Annotation structure

Each element can contain:

- `type`, `label`, and `reviewStatus`;
- `x`, `y`, `w`, and `h` for rectangular elements;
- `p1` and `p2` for wall or beam line geometry;
- `vertices` for polygonal areas such as slabs or rooms;
- `thickness` and `height` where available;
- `source`, indicating manual or AI-origin geometry;
- `accepted`, indicating that the final QS review accepted the element.

## Recommended dataset process

Collect at least 30–50 reviewed drawings with similar drawing standards before training a dedicated detector. Keep a separate group of drawings that is never used during prompt development or training. Use that group for final testing.

Review the exported records before training. Remove drawings with incorrect calibration, incomplete QS review, corrupted images, or missing original files. Group drawings by project and drawing convention so that near-duplicate drawings do not leak between training and testing.

## Storage warning for Render

The default application writes research data under the configured `RESEARCH_DATA_DIR`, or under the project `data/` directory when that variable is not set. A standard Render service filesystem may be replaced during redeployments or restarts. For a real multi-person study, configure a persistent disk or external object storage and database before collecting important drawings.

## What the dataset can be used for

The first use is accuracy evaluation: compare AI detections with the QS-reviewed annotations and calculate precision, recall, overlap, and quantity error by element type. The second use is prompt calibration: identify repeated errors and improve the legend and exclusion instructions. The third use is dedicated model training: convert the reviewed geometry into a YOLO or COCO dataset and train a specialised detector outside the Render web service, then deploy the trained inference service separately.
