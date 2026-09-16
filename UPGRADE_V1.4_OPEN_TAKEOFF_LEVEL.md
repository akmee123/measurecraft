# MeasureCraft v1.4 — OpenTakeoff-level upgrade

This build keeps MeasureCraft's existing geometry/provenance/research implementation and adds a deterministic core + agent architecture rather than replacing the application.

## Added

- `core/takeoff-engine.js`: headless deterministic summary, eligibility gate, confidence bands, validation and element query functions.
- `core/tool-registry.js`: explicit read/proposal agent tool contract reusable by API/MCP layers.
- `public/js/modules/takeoff-engine.js`: browser-side quantity/review summary adapter.
- `public/js/modules/validation.js`: browser document integrity checks.
- `public/js/modules/agent-tools.js`: browser agent tool registry; write tools are proposal-only.
- `/api/agent/tools`, `/api/agent/validate`, `/api/agent/summary`, `/api/agent/find-elements`.
- MCP v0.3 tools: `validate_document`, `find_elements`, `get_element`, `get_document_summary`.
- Pro UI integrity badge showing `Ready`, `Review · N`, or `Issues · N`.
- Regression tests for confidence, AI review gating, summaries, validation and agent tools.

## Design principle

AI remains assistive. An AI-generated measurement is not costing/export eligible until it is explicitly accepted/reviewed by a QS. Provenance remains attached to the measurement so AI proposals and human corrections can be studied in the research dataset.

## Verification

`npm run check` passes all existing geometry, hole, wall-identity, provenance, module-wiring tests plus the new takeoff-engine tests.

## v1.5 AI Agent + Drawing Intelligence upgrade
- Added `core/drawing-intelligence.js` for deterministic room/element graph construction, evidence/uncertainty tracking, duplicate suppression, and agent action planning.
- Added `POST /api/agent/analyze`: vision agent -> normalized drawing intelligence graph. This endpoint is read-only and never mutates the live document.
- Added `POST /api/agent/plan`: read-only next-action planning from the current takeoff document.
- Extended the server/MCP tool surface with `analyze_drawing` and `create_agent_plan`.
- AI Agent UI now consumes Drawing Intelligence output and stages proposals with room/evidence/uncertainty metadata while preserving QS review gates.
- Added browser `MCIntelligence` facade for future agent orchestration and graph tooling.
