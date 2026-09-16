# MeasureCraft v1.6 — AI Agent Orchestration Upgrade

This release advances the AI workflow from **vision-only detection** to an explicit orchestration pipeline:

**Drawing → Vision → Normalization → Relationship Preflight → Confidence/Risk → AI Proposals → QS Review**

### New components
- `core/agent-orchestrator.js`
- `POST /api/agent/orchestrate`
- MCP tool: `agent_orchestrate_takeoff`
- deterministic relationship checks for openings, rooms and low-confidence detections
- stable AI proposal IDs
- evidence/uncertainty/provenance on generated elements
- review-priority queue
- optional live staging (`stage=true`) that never accepts AI output

### Safety / QS control
AI output remains `AI_GENERATED` and `accepted:false`. Staging only adds proposals to the live canvas. A QS must explicitly review/accept them before costing/export.

### Verification
All existing tests plus the new agent-orchestrator test pass.
