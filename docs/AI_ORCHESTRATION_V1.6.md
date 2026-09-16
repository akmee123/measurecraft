# MeasureCraft v1.6 — AI Takeoff Orchestration

## Workflow

Drawing image -> vision proposal -> deterministic normalization -> relationship preflight -> confidence/review prioritization -> AI proposals -> QS review -> accepted takeoff.

The orchestrator does **not** accept AI measurements automatically. `stage=true` only enqueues `add_elements` proposals to a live Pro session.

## Main API

`POST /api/agent/orchestrate`

Accepts either `analysis` (already parsed vision JSON) or `image_base64`.

Returns:
- normalized drawing intelligence
- AI proposal elements
- deterministic preflight issues
- review queue
- next actions
- optional staged operation metadata

## Research value

Each generated element retains:
- AI source/method
- confidence
- visible evidence
- uncertainty
- room association
- geometry snapshot
- validation result
- review priority

This supports AI-vs-QS correction and time/accuracy studies without treating model output as ground truth.
