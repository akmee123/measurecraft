#!/usr/bin/env node
/**
 * MeasureCraft MCP entry — stdio transport for Claude Desktop / Cursor / etc.
 *
 * Env:
 *   MC_BASE_URL   — MeasureCraft server origin (default http://127.0.0.1:3000)
 *   MC_API_TOKEN  — optional X-MC-Token if server requires it
 */
import { startServer } from './src/index.js';

startServer().catch((err) => {
  console.error('[measurecraft-mcp]', err);
  process.exit(1);
});
