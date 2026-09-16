# MeasureCraft Takeoff Document Schema (v2)

Inspired by OpenTakeoff’s measurement engine contract: every measurement carries **geometry**, **method**, **authorship**, and **review status**. Recalibration updates quantities together; AI proposals never silently become final quantities.

## Document root

```json
{
  "schemaVersion": 2,
  "id": "uuid-or-local-id",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "projectInfo": { "...": "name, client, location, currency, ..." },
  "calibration": {
    "factor": 1.0,
    "unit": "m",
    "method": "two-point | ocr | manual",
    "calibratedAt": "ISO-8601 | null",
    "notes": ""
  },
  "sheets": [
    {
      "id": "sheet-1",
      "name": "Ground Floor",
      "pageIndex": 0,
      "background": { "src": "...", "w": 0, "h": 0, "opacity": 1, "visible": true },
      "calibration": { "factor": 1.0 }
    }
  ],
  "activeSheetId": "sheet-1",
  "layers": ["All", "Structural", "Architectural", "MEP", "Furniture"],
  "elements": [ /* Measurement */ ],
  "revisions": [ /* RevisionSnapshot */ ],
  "nextId": 1,
  "isConfirmed": false,
  "materialLibrary": {},
  "projectOverrides": {}
}
```

## Measurement (element)

| Field | Type | Description |
|-------|------|-------------|
| `id` | number/string | Stable identity within the document |
| `type` | string | `wall`, `slab`, `column`, `beam`, `door`, `window`, `opening`, `deduction`, `cutout`, … |
| `geometry` | object | Box (`x,y,w,h`) and/or line (`p1,p2`, `vertices`, `isLine`) |
| `method` | string | `manual_draw`, `ai_detect`, `ai_agent`, `import`, `traced` |
| `source` | string | `MANUAL`, `AI`, `AI_EDITED`, `AGENT` |
| `authorship` | object | `{ role: "human"\|"agent", actor?: string, at?: ISO }` |
| `reviewStatus` | string | `MANUAL`, `AI_GENERATED`, `QS_REVIEWED`, `FINAL`, `REJECTED` |
| `accepted` | boolean | Only `true` elements contribute to costing/BOQ (AI must be accepted) |
| `reviewedAt` | ISO \| null | When QS accepted/edited |
| `confidence` | 0–1 \| null | Model confidence when AI-origin |
| `layer` | string | Layer name |
| `label` | string | Display name |
| `thickness`, `zHeight`, `sillHeight`, `soffitHeight` | number | Physical props (metres where calibrated) |
| `parentId`, `cutouts` | id refs | Deduction / opening relationships |
| `locked`, `hidden` | boolean | Edit/visibility guards |
| `material`, `costOverride` | any | Optional costing overrides |
| `provenance` | object | Optional extra: `{ model, promptHash, tile, detectedAt }` |

### Review rules (enforced in quantity engine)

1. Manual elements default to `reviewStatus: MANUAL`, `accepted: true`.
2. AI / Agent proposals default to `AI_GENERATED`, `accepted: false`.
3. QS accept → `QS_REVIEWED` + `accepted: true` + `reviewedAt`.
4. Confirm takeoff → eligible elements may move to `FINAL`; document locks edits.
5. Reject → `REJECTED`, excluded from BOQ; geometry retained for audit until deleted.

## Revision snapshot

```json
{
  "id": "rev-...",
  "name": "After AI detect",
  "createdAt": "ISO-8601",
  "author": "human | agent | system",
  "note": "optional",
  "elementCount": 42,
  "payload": { "elements": [], "nextId": 43, "calibrationFactor": 1.0, "isConfirmed": false }
}
```

Revisions are **named checkpoints** (not the undo stack). Restore replaces current elements from `payload` after a confirmation.

## Agent contract (REST)

Agents should prefer these endpoints (token-protected like other AI routes):

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/agent/document` | Current document summary (counts, calibration, review breakdown) |
| `POST` | `/api/agent/accept` | Body `{ ids: [] }` — mark elements QS-reviewed |
| `POST` | `/api/agent/reject` | Body `{ ids: [] }` — mark rejected |
| `GET` | `/api/agent/quantities` | Server-side summary hook (client remains source of truth for geometry) |
| `POST` | `/api/agent-takeoff` | Existing room-wise AI proposal |

Client remains authoritative for canvas geometry; the agent API coordinates review state and reporting.

## Compatibility

- `schemaVersion: 1` files (legacy project JSON) load via `normalizeDocument()`.
- Missing provenance fields are filled with safe defaults on load.
- Export (Excel/PDF/JSON) always includes `schemaVersion` and review metadata.
