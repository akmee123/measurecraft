# MeasureCraft → OpenTakeoff-level Upgrade Roadmap

OpenTakeoff is a dual human+agent measurement engine (React, MCP tools, formal protocol, multi-sheet stitching, revisions, stamps, RFI, roll goods). MeasureCraft is a QS-focused Node + vanilla JS app with strong Gemini detection and costing.

This document tracks how we close the gap without throwing away MeasureCraft’s strengths (materials BOQ, Simple/Pro modes, market rates).

## Phase 1 — DONE in this package

- [x] Formal **Takeoff Document Schema v2** (geometry + method + authorship + review)
- [x] **Revisions panel** — named snapshots, restore
- [x] Stronger **review workflow** UI (accept / reject / provenance badges)
- [x] **Agent REST surface** (`/api/agent/*`) for document summary + bulk accept/reject
- [x] Versioned project JSON on save (`schemaVersion: 2`)
- [x] Docs: schema + this roadmap

## Phase 1.2 + 2 + MCP prototype — DONE in this package

- [x] **Review UI polish** — pending/QS/rejected badges, ✓/✕ on tree items, Accept all
- [x] **Multi-sheet navigator** — sheet tabs, per-sheet elements/calibration/background
- [x] **IndexedDB autosave** — debounced; restore prompt on load
- [x] Module extraction: `document-model.js`, `revisions.js`, `sheets.js`, `autosave.js`
- [x] **MCP prototype** (`mcp/`) — health, document_summary, accept/reject, agent_takeoff

## Phase 2 (remaining)

- [ ] Further split `takeoff_pro.js` (quantities, canvas-render, ai-client)
- [ ] Multi-project home / named IDB projects
- [ ] Unit tests for quantity engine + review rules

## Phase 3 — Product surface

- [ ] Stamps / markup panel
- [ ] RFI / question panel linked to geometry
- [ ] Richer Report panel (schedules, by-layer, by-review-status)
- [ ] Optional React island for new panels (incremental migration)

## Phase 4 — Agent-first parity

- [ ] Expand MCP with live document bridge (geometry push/pull)
- [ ] Align export with Takeoff Protocol-style schemas
- [ ] Voice or command-box takeoff (optional)
- [ ] Benchmark suite (geometry IoU + quantity totals)

## Non-goals (keep MeasureCraft identity)

- Do not drop QS costing, market rates, or Simple Mode
- Do not require users to run MCP for normal takeoff
- Prefer additive AI (never wipe manual work)

## How to verify Phase 1

1. `npm install && npm start`
2. Login → Pro Mode → import plan → calibrate → AI Detect
3. Open **Revisions** → **Save snapshot**
4. Accept some AI elements in Properties / review controls
5. Save project JSON and confirm `"schemaVersion": 2` and `authorship` / `reviewStatus` fields
6. `GET /api/agent/document` with auth headers returns summary counts
