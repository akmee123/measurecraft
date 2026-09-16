/**
 * MeasureCraft MCP server — agent REST + live document bridge.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.MC_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.MC_API_TOKEN || '';
const DEFAULT_SESSION = process.env.MC_LIVE_SESSION || '';

async function mcFetch(path, options = {}) {
  const headers = Object.assign(
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    options.headers || {}
  );
  if (TOKEN) headers['X-MC-Token'] = TOKEN;
  const res = await fetch(BASE + path, {
    method: options.method || 'GET',
    headers,
    body: options.body != null ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json.error || json.message || res.statusText || 'Request failed');
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

function textResult(obj) {
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
  };
}

function resolveSession(args) {
  return (args && args.sessionId) || DEFAULT_SESSION || '';
}

const TOOLS = [
  {
    name: 'health',
    description: 'Check MeasureCraft server, agent API, and list live sessions.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_live_sessions',
    description: 'List active live bridge sessions (open Pro UI creates one). Use sessionId for live_* tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'live_get_document',
    description: 'Fetch the live takeoff document snapshot from the Pro canvas.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_add_elements',
    description: 'Add measurement elements to the live canvas as AI proposals.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        elements: { type: 'array', items: { type: 'object' } },
      },
      required: ['sessionId', 'elements'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_update_elements',
    description: 'Patch existing elements by id.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        updates: { type: 'array', items: { type: 'object' } },
      },
      required: ['sessionId', 'updates'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_remove_elements',
    description: 'Remove elements by id from the live canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        ids: { type: 'array', items: { type: ['number', 'string'] } },
      },
      required: ['sessionId', 'ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_accept_elements',
    description: 'Mark element ids as QS-reviewed on the live canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        ids: { type: 'array', items: { type: ['number', 'string'] } },
      },
      required: ['sessionId', 'ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_reject_elements',
    description: 'Mark element ids as rejected on the live canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        ids: { type: 'array', items: { type: ['number', 'string'] } },
      },
      required: ['sessionId', 'ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_set_calibration',
    description: 'Set calibration factor (metres per drawing unit) on the live canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        factor: { type: 'number' },
      },
      required: ['sessionId', 'factor'],
      additionalProperties: false,
    },
  },
  {
    name: 'live_toast',
    description: 'Show a toast message in the Pro UI.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        message: { type: 'string' },
        level: { type: 'string' },
      },
      required: ['sessionId', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'document_summary',
    description: 'Review breakdown for a snapshot or live session document.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        elements: { type: 'array', items: { type: 'object' } },
        calibrationFactor: { type: 'number' },
        isConfirmed: { type: 'boolean' },
        projectInfo: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'analyze_drawing',
    description: 'Run drawing intelligence on a plan image and return rooms, geometry relationships, evidence and uncertainty. Read-only; never mutates the live document.',
    inputSchema: { type: 'object', properties: { image_base64:{type:'string'}, mime_type:{type:'string'}, pixel_w:{type:'number'}, pixel_h:{type:'number'}, goal:{type:'string'} }, required:['image_base64'], additionalProperties:false },
  },
  {
    name: 'agent_orchestrate_takeoff',
    description: 'Run the full vision-to-QS-proposal orchestration loop. Optional stage enqueues proposals but never accepts them.',
    inputSchema: { type:'object', properties:{ image_base64:{type:'string'}, mime_type:{type:'string'}, pixel_w:{type:'number'}, pixel_h:{type:'number'}, goal:{type:'string'}, analysis:{type:'object'}, sessionId:{type:'string'}, stage:{type:'boolean'} }, required:['image_base64'], additionalProperties:false },
  },
  {
    name: 'create_agent_plan',
    description: 'Create a read-only agent action plan from the live document, prioritising calibration, review and low-confidence inspection.',
    inputSchema: { type:'object', properties:{ sessionId:{type:'string'}, goal:{type:'string'} }, required:['sessionId'], additionalProperties:false },
  },
  {
    name: 'agent_takeoff',
    description: 'Room-wise AI takeoff from image_base64 (does not auto-apply).',
    inputSchema: {
      type: 'object',
      properties: {
        image_base64: { type: 'string' },
        mime_type: { type: 'string' },
        pixel_w: { type: 'number' },
        pixel_h: { type: 'number' },
        goal: { type: 'string' },
      },
      required: ['image_base64'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_document',
    description: 'Validate a live MeasureCraft document for geometry, calibration, IDs and AI review gates.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, document: { type: 'object' } }, additionalProperties: false },
  },
  {
    name: 'find_elements',
    description: 'Find live takeoff elements by type, source, review status, acceptance or text.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, query: { type: 'object' } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_element',
    description: 'Read one live takeoff element by id.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string' }, id: { type: ['number', 'string'] } },
      required: ['sessionId', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_document_summary',
    description: 'Get deterministic quantity totals plus AI/review readiness for a live document.',
    inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false },
  },
  {
    name: 'list_tools_help',
    description: 'How to use MeasureCraft MCP with the live document bridge.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function enqueue(sessionId, type, payload) {
  return mcFetch('/api/live/ops/' + encodeURIComponent(sessionId), {
    method: 'POST',
    body: { type, payload, meta: { source: 'mcp' } },
  });
}

export async function startServer() {
  const server = new Server(
    { name: 'measurecraft-mcp', version: '0.4.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};

    try {
      if (name === 'list_tools_help') {
        return textResult({
          baseUrl: BASE,
          tokenConfigured: !!TOKEN,
          defaultSession: DEFAULT_SESSION || null,
          workflow: [
            '1. Start MeasureCraft (npm start) and open Pro Mode',
            '2. list_live_sessions → copy sessionId (also shown as Live · xxxxxx in UI)',
            '3. live_get_document { sessionId }',
            '4. live_add_elements / live_accept_elements / etc. — Pro applies within ~1–2s',
          ],
        });
      }

      if (name === 'health') {
        const [appHealth, agentHealth, sessions] = await Promise.all([
          mcFetch('/api/health').catch((e) => ({ success: false, error: e.message })),
          mcFetch('/api/agent/health').catch((e) => ({ success: false, error: e.message })),
          mcFetch('/api/live/sessions').catch((e) => ({ success: false, error: e.message })),
        ]);
        return textResult({ baseUrl: BASE, app: appHealth, agent: agentHealth, live: sessions });
      }

      if (name === 'list_live_sessions') {
        return textResult(await mcFetch('/api/live/sessions'));
      }

      if (name === 'live_get_document') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await mcFetch('/api/live/document/' + encodeURIComponent(sid)));
      }

      if (name === 'live_add_elements') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'add_elements', { elements: args.elements }));
      }

      if (name === 'live_update_elements') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'update_elements', { updates: args.updates }));
      }

      if (name === 'live_remove_elements') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'remove_elements', { ids: args.ids }));
      }

      if (name === 'live_accept_elements') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'accept_elements', { ids: args.ids }));
      }

      if (name === 'live_reject_elements') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'reject_elements', { ids: args.ids }));
      }

      if (name === 'live_set_calibration') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'set_calibration', { factor: args.factor }));
      }

      if (name === 'live_toast') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        return textResult(await enqueue(sid, 'toast', { message: args.message, level: args.level || 'info' }));
      }

      if (name === 'document_summary') {
        if (args.sessionId) {
          const live = await mcFetch('/api/live/document/' + encodeURIComponent(args.sessionId));
          const doc = live.document || {};
          const data = await mcFetch('/api/agent/document', {
            method: 'POST',
            body: {
              elements: doc.elements || [],
              calibrationFactor: doc.calibration && doc.calibration.factor,
              isConfirmed: doc.isConfirmed,
              projectInfo: doc.projectInfo,
            },
          });
          return textResult({ sessionId: args.sessionId, ...data });
        }
        return textResult(
          await mcFetch('/api/agent/document', {
            method: 'POST',
            body: {
              elements: args.elements || [],
              calibrationFactor: args.calibrationFactor,
              isConfirmed: args.isConfirmed,
              projectInfo: args.projectInfo,
            },
          })
        );
      }

      if (name === 'validate_document') {
        const doc = args.document || (args.sessionId ? (await mcFetch('/api/live/document/' + encodeURIComponent(args.sessionId))).document : null);
        if (!doc) throw new Error('document or sessionId required');
        return textResult(await mcFetch('/api/agent/validate', { method:'POST', body:{ document: doc } }));
      }

      if (name === 'find_elements') {
        if (!args.sessionId) throw new Error('sessionId required');
        const live = await mcFetch('/api/live/document/' + encodeURIComponent(args.sessionId));
        return textResult(await mcFetch('/api/agent/find-elements', { method:'POST', body:{ elements:(live.document||{}).elements||[], query:args.query||{} } }));
      }

      if (name === 'get_element') {
        if (!args.sessionId) throw new Error('sessionId required');
        const live = await mcFetch('/api/live/document/' + encodeURIComponent(args.sessionId));
        const found = (live.document && Array.isArray(live.document.elements) ? live.document.elements : []).find((e) => e && String(e.id) === String(args.id));
        return textResult({ success:true, element:found||null });
      }

      if (name === 'get_document_summary') {
        const live = await mcFetch('/api/live/document/' + encodeURIComponent(args.sessionId));
        const doc = live.document || {};
        return textResult(await mcFetch('/api/agent/summary', { method:'POST', body:{ elements:doc.elements||[], calibrationFactor:doc.calibration && doc.calibration.factor } }));
      }

      if (name === 'analyze_drawing') {
        return textResult(await mcFetch('/api/agent/analyze', {
          method:'POST', body:{ image_base64:args.image_base64, mime_type:args.mime_type || 'image/jpeg', pixel_w:args.pixel_w, pixel_h:args.pixel_h, goal:args.goal }
        }));
      }

      if (name === 'agent_orchestrate_takeoff') {
        return textResult(await mcFetch('/api/agent/orchestrate', {
          method:'POST', body:{ image_base64:args.image_base64, mime_type:args.mime_type || 'image/jpeg', pixel_w:args.pixel_w, pixel_h:args.pixel_h, goal:args.goal, analysis:args.analysis, sessionId:args.sessionId, stage:args.stage === true }
        }));
      }

      if (name === 'create_agent_plan') {
        const sid = resolveSession(args);
        if (!sid) throw new Error('sessionId required');
        const live = await mcFetch('/api/live/document/' + encodeURIComponent(sid));
        return textResult(await mcFetch('/api/agent/plan', { method:'POST', body:{ document:live.document || {}, goal:args.goal || '' } }));
      }

      if (name === 'agent_takeoff') {
        return textResult(
          await mcFetch('/api/agent-takeoff', {
            method: 'POST',
            body: {
              image_base64: args.image_base64,
              mime_type: args.mime_type || 'image/jpeg',
              pixel_w: args.pixel_w,
              pixel_h: args.pixel_h,
              goal: args.goal,
            },
          })
        );
      }

      return textResult({ error: 'Unknown tool: ' + name });
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: err.message,
                status: err.status,
                body: err.body,
                hint: 'Is MeasureCraft running? Is Pro UI open so a live session exists?',
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
