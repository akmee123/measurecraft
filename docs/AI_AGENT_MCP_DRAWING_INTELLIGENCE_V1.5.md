# MeasureCraft v1.5 — AI Agent + MCP + Drawing Intelligence

## Architecture

`Drawing image -> Vision agent -> normalized proposals -> deterministic intelligence graph -> QS review -> live document`

The AI layer is intentionally non-destructive. Vision output is never treated as a final quantity. The server adds evidence, uncertainty, room/element relationships and a review queue before the browser stages proposals.

## New API

- `POST /api/agent/analyze` — vision analysis + deterministic drawing graph. Read-only.
- `POST /api/agent/plan` — read-only next-action planner for the current document.
- Existing `/api/agent-takeoff` remains available for compatibility.

## MCP

New tools:

- `analyze_drawing`
- `create_agent_plan`

Existing live mutation tools remain explicit (`live_add_elements`, `live_update_elements`, `live_accept_elements`, `live_reject_elements`).

## Drawing intelligence

The graph contains:

- room nodes
- wall/door/window/column nodes
- room -> element `contains` edges
- opening -> nearest wall `hosted_by` edges
- confidence
- evidence
- uncertainty
- review queue

Relationships are deterministic post-processing, not hallucinated facts.

## QS safety

AI-originated elements remain `AI_GENERATED` and are not costing-eligible until accepted/QS-reviewed. Provenance is preserved, including the intelligence room ID and visible evidence/uncertainty metadata.

## Research value

The architecture supports evaluation of:

- AI detection accuracy
- confidence vs correction rate
- human correction frequency
- review workload
- room/element relationship accuracy
- time saved by AI-assisted takeoff
- provenance of AI proposals versus final QS-approved geometry
