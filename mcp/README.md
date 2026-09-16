# MeasureCraft MCP

MCP server for MeasureCraft — includes a **live document bridge** so agents can read and change the Pro canvas while a human is logged in.

## Live bridge workflow

1. Start the app: `cd .. && npm start`
2. Open **Professional Mode** in the browser (creates a live session; see **Live · xxxxxx** in the sheet nav)
3. Configure MCP (below) and call `list_live_sessions`
4. Use `live_get_document` / `live_add_elements` / `live_accept_elements` / etc.

Ops are applied on the client within ~1–2 seconds (poll + SSE).

## Tools

| Tool | Description |
|------|-------------|
| `health` | App + agent + live sessions |
| `list_live_sessions` | Active Pro bridge sessions |
| `live_get_document` | Full published document snapshot |
| `live_add_elements` | Add AI/agent measurements to canvas |
| `live_update_elements` | Patch by id |
| `live_remove_elements` | Delete by id |
| `live_accept_elements` | QS-accept ids |
| `live_reject_elements` | Reject ids |
| `live_set_calibration` | Set metres-per-unit factor |
| `live_toast` | Toast in Pro UI |
| `document_summary` | Review counts (live or posted) |
| `agent_takeoff` | Room-wise AI proposals from image |
| `list_tools_help` | This workflow |

## Claude / Cursor config

```json
{
  "mcpServers": {
    "measurecraft": {
      "command": "node",
      "args": ["/absolute/path/to/measurecraft-upgraded/mcp/bin.js"],
      "env": {
        "MC_BASE_URL": "http://127.0.0.1:3000",
        "MC_API_TOKEN": "",
        "MC_LIVE_SESSION": ""
      }
    }
  }
}
```

Optional `MC_LIVE_SESSION` pins a default session id so tools can omit `sessionId`.

## Local install

```bash
cd mcp && npm install
```

## Architecture

- Pro UI → `PUT /api/live/document/:sessionId` (snapshot on edits)
- Agent/MCP → `POST /api/live/ops/:sessionId` (enqueue op)
- Pro UI → poll `GET /api/live/ops/...` + SSE `GET /api/live/events/...` → apply → ack

Geometry remains validated on the client; agents propose, QS accepts.

## Deterministic agent/research tools (v0.3)

The MCP layer now exposes read-only validation, element lookup and deterministic document summaries in addition to the live mutation tools. AI writes remain proposal/review based: a live `add_elements` operation creates AI-origin elements that stay unaccepted until a QS explicitly reviews them.
