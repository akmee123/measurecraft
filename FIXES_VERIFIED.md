# MEASURECRAFT Research Dashboard Fix Verification

The dashboard now keeps the current Pro Mode quantity state synchronized with research measurement records. The shared live refresh runs after the normal `renderAll()` path, so slab geometry edits, height/thickness corrections, additions, pasted/duplicated elements, deletions, and deduction deletions all regenerate the current quantity rows and replace superseded records for the active project and mode.

Research element lifecycle events now include add and deduction-delete operations, in addition to the existing edit, accept, reject, detect, and parent-delete events. Live records include the current user/final quantity, unit, element label, project/drawing context, and calculation remarks in Notes. When an element supplies AI or reference quantities, those values are preserved and the server derives Δ and Δ% using reference first, then AI as the fallback baseline.

The server now enriches records returned to the dashboard. If a stored row has a final/user quantity and a reference or AI baseline but is missing derived error fields, the response calculates them. Missing Notes are given a descriptive fallback rather than rendering as an empty cell. The dashboard also consistently renders unavailable numeric values as an em dash and uses a dedicated percentage formatter.

## Verification performed

| Check | Result |
|---|---|
| `node --check server.js` | Passed |
| `node --check research-store.js` | Passed |
| `node --check research-storage.js` | Passed |
| `node --check test-research-storage.js` | Passed |
| Existing research-storage test suite | Passed |
| Static check for live quantity sync | Passed |
| Static check for add/delete lifecycle hooks | Passed |
| Static check for server record enrichment | Passed |
| Static check for dashboard percentage and Notes fallbacks | Passed |

The delivered ZIP contains the repaired project and this verification note.
