# MeasureCraft Research Dashboard

Research topic: **AI-Powered Digital Takeoff Tool for Housing Construction in Sri Lanka**

## Access

1. Set `RESEARCH_ADMIN_TOKEN` in `.env` (required in production).
2. Open `/research/dashboard.html`
3. Enter the admin token (stored in session only).

Participant personal data is not shown — **participant IDs only** (e.g. `P01`).

## What the dashboard answers

| Research question | Where |
|-------------------|--------|
| How accurate is the AI? | Overview KPI + AI Accuracy |
| Which elements are strongest/weakest? | AI Accuracy by type |
| How much human correction is needed? | Corrections + KPI correction rate |
| Does AI reduce time? | Avg measurement duration + Simple vs Pro |
| Simple vs Pro performance | Simple vs Pro panel |
| AI vs human vs ground truth | AI vs Human + Ground Truth |
| Per-participant / drawing variance | Participants, Projects & Drawings |

## Data principles

- **AI prediction**, **human correction**, **reference (ground truth)**, and **final accepted** are stored as **separate fields**.
- Missing values display as **N/A** and are **excluded** from accuracy means (never forced to 0).
- Drawings remain unique (`DWG-####`); projects (`PROJ-####`) stay separate even for the same participant.
- Export and AI training export are **explicit researcher actions** — nothing auto-trains a model.

## APIs used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/research/summary` | KPI rollup |
| `GET /api/research/participants` | Per-participant stats |
| `GET /api/research/projects` | Project/drawing registry |
| `GET /api/research/sessions` | Session log |
| `GET /api/research/records` | Measurement table (filterable) |
| `GET /api/research/quantity-accuracy` | Error % by element type |
| `GET /api/research/mode-comparison` | Simple vs Pro |
| `GET /api/research/corrections` | Element event breakdown |
| `GET/POST /api/research/reference-quantities` | Ground truth |
| `GET /api/research/export` | CSV / JSON |
| `GET /api/research/training-export` | Offline training package |
| `GET /api/research/accuracy-baseline` | IoU / precision / recall when annotations exist |

## Existing takeoff features

This dashboard is **additive**. Simple Mode, Pro Mode, AI detect, deductions, BOQ, calibration, and mode switch are unchanged.
