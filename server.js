/**
 * MeasureCraft API + static server
 * Endpoints:
 *   POST /api/detect-elements  { image_base64, mime_type?, pixel_w?, pixel_h? }
 *   POST /api/market-rates     { region, materials: [{name, unit}] }
 *   POST /api/assistant-chat   { message, history?: [{role, text}] }
 *   GET  /api/health
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// gemini-2.0-flash was shut down by Google on June 1, 2026 — gemini-3.5-flash
// is the current supported default. Set GEMINI_MODEL=gemini-3.1-pro in .env
// for noticeably better bounding-box accuracy (slower/pricier).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Optional shared token for Gemini-backed routes (set MC_API_TOKEN in env).
// When unset, endpoints stay open (demo). When set, require header: X-MC-Token or Authorization: Bearer …
const MC_API_TOKEN = (process.env.MC_API_TOKEN || '').trim();

// Lightweight in-memory rate limit (per IP) for AI endpoints — no extra dependency
const _rlBuckets = new Map();
function rateLimitAi(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxHits = Number(process.env.MC_AI_RATE_LIMIT || 20); // per minute
  let b = _rlBuckets.get(ip);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    _rlBuckets.set(ip, b);
  }
  b.count += 1;
  if (b.count > maxHits) {
    return res.status(429).json({
      success: false,
      error: 'Too many AI requests from this network. Wait a minute and try again.',
      code: 'RATE_LIMIT',
    });
  }
  next();
}

function requireApiToken(req, res, next) {
  if (!MC_API_TOKEN) return next();
  const hdr = req.headers['x-mc-token'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const token = String(hdr || bearer || '').trim();
  if (token && token === MC_API_TOKEN) return next();
  return res.status(401).json({
    success: false,
    error: 'Unauthorized. This server requires an API token (X-MC-Token).',
    code: 'UNAUTHORIZED',
  });
}

// Always start at the login page
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/index.html', (_req, res) => {
  res.redirect(302, '/login.html');
});

app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function getModel(opts) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not set. Add it in Render Environment or .env');
    err.code = 'NO_KEY';
    throw err;
  }
  const json = !opts || opts.json !== false;
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: json ? 0.2 : 0.4,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });
}

function parseJsonLoose(text) {
  if (!text) throw new Error('Empty model response');
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  function tryParse(s) {
    return JSON.parse(s);
  }
  function repair(s) {
    let u = s;
    u = u.replace(/,\s*([}\]])/g, '$1');
    u = u.replace(/'([^'\\]*)'/g, function (_, inner) {
      return '"' + inner.replace(/"/g, '\\"') + '"';
    });
    u = u.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
    return u;
  }

  try {
    return tryParse(t);
  } catch (e1) {
    try {
      return tryParse(repair(t));
    } catch (e2) {
      const m = t.match(/[\[{][\s\S]*[\]}]/);
      if (m) {
        try {
          return tryParse(repair(m[0]));
        } catch (e3) {
          let frag = m[0];
          const elMatch = frag.match(/"elements"\s*:\s*\[([\s\S]*)/);
          if (elMatch) {
            const body = elMatch[1];
            const objects = [];
            let depth = 0, start = -1;
            for (let i = 0; i < body.length; i++) {
              const ch = body[i];
              if (ch === '{') {
                if (depth === 0) start = i;
                depth++;
              } else if (ch === '}') {
                depth--;
                if (depth === 0 && start >= 0) {
                  const slice = body.slice(start, i + 1);
                  try {
                    objects.push(JSON.parse(repair(slice)));
                  } catch (_) {}
                  start = -1;
                }
              }
            }
            if (objects.length) {
              console.warn('parseJsonLoose: recovered', objects.length, 'element object(s) from truncated JSON');
              return { elements: objects };
            }
          }
          console.warn('parseJsonLoose: failed after repair', e3.message);
        }
      }
      throw new Error('Could not parse JSON from model: ' + t.slice(0, 120));
    }
  }
}

const DETECT_TYPES = new Set(['wall', 'column', 'slab', 'beam', 'door', 'window']);

function normalizeDetectedElements(rawElements, pixelW, pixelH) {
  const source = Array.isArray(rawElements) ? rawElements : [];
  const maxW = Number(pixelW) > 0 ? Number(pixelW) : null;
  const maxH = Number(pixelH) > 0 ? Number(pixelH) : null;
  const normalized = [];

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    let type = String(raw.type || '').trim().toLowerCase();
    if (type === 'room' || type === 'area' || type === 'floor') type = 'slab';
    if (type === 'opening') type = 'window';
    if (!DETECT_TYPES.has(type)) continue;

    const values = ['x', 'y', 'w', 'h'].map((key) => Number(raw[key]));
    if (values.some((value) => !Number.isFinite(value))) continue;
    let [x, y, w, h] = values;
    if (w <= 1 || h <= 1) continue;
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (maxW != null) w = Math.min(w, Math.max(0, maxW - x));
    if (maxH != null) h = Math.min(h, Math.max(0, maxH - y));
    if (w <= 1 || h <= 1) continue;

    let confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    if (confidence > 1) confidence /= 100;
    confidence = Math.max(0, Math.min(1, confidence));

    const height = Number(raw.height);
    normalized.push({
      type,
      label: String(raw.label || type).trim().slice(0, 120) || type,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      height: Number.isFinite(height) && height > 0 ? Math.round(height * 1000) / 1000 : null,
      confidence: Math.round(confidence * 1000) / 1000,
    });
  }

  normalized.sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const item of normalized) {
    const duplicate = kept.some((other) => {
      if (other.type !== item.type) return false;
      const x1 = Math.max(item.x, other.x);
      const y1 = Math.max(item.y, other.y);
      const x2 = Math.min(item.x + item.w, other.x + other.w);
      const y2 = Math.min(item.y + item.h, other.y + other.h);
      const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const union = item.w * item.h + other.w * other.h - intersection;
      return union > 0 && intersection / union >= 0.82;
    });
    if (!duplicate) kept.push(item);
    if (kept.length >= 150) break;
  }
  return kept;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
  });
});

app.post('/api/detect-elements', rateLimitAi, requireApiToken, async (req, res) => {
  try {
    const { image_base64, mime_type, pixel_w, pixel_h, legend_notes, legend_images } = req.body || {};
    if (!image_base64) {
      return res.status(400).json({ success: false, error: 'image_base64 is required' });
    }
    if (typeof image_base64 !== 'string' || image_base64.length > 30 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'image_base64 is too large or invalid' });
    }
    const allowedMime = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
    const mime = String(mime_type || 'image/jpeg').toLowerCase();
    if (!allowedMime.has(mime)) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported mime_type. Use image/jpeg or image/png.',
      });
    }
    const w = Number(pixel_w) || 0;
    const h = Number(pixel_h) || 0;
    const legend = typeof legend_notes === 'string' ? legend_notes.trim().slice(0, 4000) : '';
    const allowedLegendImages = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
    const legendImages = Array.isArray(legend_images) ? legend_images.slice(0, 4).filter((item) => {
      return item && typeof item.data === 'string' && item.data.length <= 5 * 1024 * 1024
        && allowedLegendImages.has(String(item.mimeType || 'image/jpeg').toLowerCase());
    }).map((item) => ({
      mimeType: String(item.mimeType || 'image/jpeg').toLowerCase(),
      data: item.data,
      name: typeof item.name === 'string' ? item.name.slice(0, 120) : 'legend reference',
    })) : [];
    if ((w && (w < 1 || w > 12000)) || (h && (h < 1 || h > 12000))) {
      return res.status(400).json({ success: false, error: 'pixel_w / pixel_h out of range' });
    }

    const prompt = [
      'You are a quantity-surveying assistant analysing an architectural floor plan image.',
      'Detect STRUCTURAL and architectural elements as axis-aligned bounding boxes in PIXEL coordinates of the PROVIDED image.',
      'Return ONLY valid JSON with this exact shape:',
      '{"elements":[{"type":"wall|column|slab|beam|door|window","label":"string","x":number,"y":number,"w":number,"h":number,"height":number|null,"confidence":number}]}',
      'CRITICAL type rules (follow strictly):',
      '- wall: ONE continuous run of a wall as a LONG THIN rectangle hugging the wall line. Short side (thickness) must be much smaller than long side (typically aspect ratio >= 4:1). NEVER box an entire room, corridor, or large open area as a wall. Split long walls at corners into separate segments.',
      '- column: small square/rectangular piers or column marks (typically much smaller than rooms; often near grid intersections).',
      '- beam: long thin structural members spanning across spaces (similar aspect to walls); only if clearly drawn as beams.',
      '- slab: REQUIRED for every enclosed room / floor plate / zone with a usable floor area. Box the INTERIOR floor area of each room (not the walls). Label with room name if visible (e.g. "Office", "Toilet", "Corridor"). Always include slabs — quantity takeoff depends on them.',
      '- door / window: small segments on wall lines where openings are shown.',
      'Do NOT return type "room". Closed rooms → type "slab" for the floor plate PLUS separate thin "wall" boxes for perimeter wall lines when visible.',
      'height = vertical height in meters ONLY if explicitly labeled on the drawing; otherwise null. Never invent floor-to-floor height.',
      w && h ? `Image size is ${w}x${h} pixels. All x,y,w,h must be inside 0..${w} and 0..${h}.` : '',
      'x,y are top-left of each box; w,h are width and height in pixels.',
      '- confidence is a number from 0 to 1 based on how clearly the element is visible and classified; do not use confidence as a substitute for QS review.',
      legend ? 'USER-PROVIDED DRAWING LEGEND AND QS GUIDANCE (use this as visual context, but do not blindly invent elements from text): ' + legend : '',
      '- Treat the user legend as a mapping between visible symbols/colours/line styles and element types. First locate the visible symbol in the image, then classify and box it.',
      '- Ignore legend swatches, notes, dimensions, title blocks, north arrows, furniture, hatching, and annotation text unless the user explicitly says they are target elements.',
      '- Do not invent elements you cannot see. Prefer fewer accurate boxes over many wrong ones.',
      'If you return two boxes for the same physical element, merge them into one box instead — never return duplicate/overlapping boxes for the same wall, column, or slab.',
      'Return at most 150 elements, highest confidence first. Include ALL visible slabs, columns, doors, and windows — do not stop early on a dense drawing.',
    ].filter(Boolean).join(' ');

    const model = getModel();
    const content = [
      { text: prompt },
      { inlineData: { mimeType: mime, data: image_base64 } },
    ];
    if (legendImages.length) {
      content.push({ text: 'The following uploaded image(s) show the drawing legend or symbol references. Use them only to understand visible symbols and colours in the plan; do not detect the legend samples themselves.' });
      legendImages.forEach((item) => content.push({ inlineData: { mimeType: item.mimeType, data: item.data } }));
    }
    const result = await model.generateContent(content);
    const text = result.response.text();
    const parsed = parseJsonLoose(text);
    const rawElements = Array.isArray(parsed.elements) ? parsed.elements : (Array.isArray(parsed) ? parsed : []);
    const elements = normalizeDetectedElements(rawElements, w, h);

    res.json({
      success: true,
      elements,
      model: GEMINI_MODEL,
      validation: {
        received: rawElements.length,
        legendGuidanceUsed: Boolean(legend) || legendImages.length > 0,
        legendImagesUsed: legendImages.length,
        returned: elements.length,
        duplicatesRemoved: Math.max(0, rawElements.length - elements.length),
        coordinateSystem: w && h ? `${w}x${h}px` : 'source pixels',
      },
    });
  } catch (err) {
    console.error('detect-elements', err);
    const msg = err.message || String(err);
    const quota = /quota|429|rate limit/i.test(msg);
    res.status(quota ? 429 : 500).json({
      success: false,
      error: msg,
      code: err.code || (quota ? 'QUOTA_EXCEEDED' : 'DETECT_FAILED'),
    });
  }
});

app.post('/api/market-rates', rateLimitAi, requireApiToken, async (req, res) => {
  try {
    const { region, materials } = req.body || {};
    const regionName = (region && String(region).trim()) || 'Colombo, Sri Lanka';
    const mats = Array.isArray(materials) && materials.length
      ? materials
      : [
          { name: 'Cement', unit: 'bag (50kg)' },
          { name: 'Sand', unit: 'm³' },
          { name: 'Aggregate', unit: 'm³' },
          { name: 'Concrete C25', unit: 'm³' },
          { name: 'Brick Standard', unit: 'Nr' },
          { name: 'Steel Rebar', unit: 'tonne' },
          { name: 'Tiling 600x600', unit: 'm²' },
          { name: 'Adhesive', unit: 'bag (25kg)' },
          { name: 'Paint Interior', unit: 'L' },
          { name: 'Plaster 1:5', unit: 'm²' },
          { name: 'Formwork', unit: 'm²' },
          { name: 'Wood Timber', unit: 'm³' },
        ];

    const prompt = [
      'You are a construction cost estimator.',
      `Estimate CURRENT approximate retail/contractor unit rates for building materials in this region: ${regionName}.`,
      'Return ONLY valid JSON:',
      '{"currency":"ISO or local code","as_of":"YYYY-MM","notes":"short caveat","rates":[{"name":"...","unit":"...","cost":number,"low":number,"high":number}]}',
      'Use these material names and units when possible:',
      JSON.stringify(mats),
      'cost is a typical mid-market value. Be realistic for the region. Estimates are acceptable if exact live prices are unknown — say so in notes.',
    ].join('\n');

    const model = getModel();
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJsonLoose(text);
    const rates = Array.isArray(parsed.rates) ? parsed.rates : [];

    res.json({
      success: true,
      region: regionName,
      currency: parsed.currency || '',
      as_of: parsed.as_of || '',
      notes: parsed.notes || 'AI estimates — verify with local suppliers.',
      rates,
      model: GEMINI_MODEL,
    });
  } catch (err) {
    console.error('market-rates', err);
    const msg = err.message || String(err);
    const quota = /quota|429|rate limit/i.test(msg);
    res.status(quota ? 429 : 500).json({
      success: false,
      error: msg,
      code: err.code || (quota ? 'QUOTA_EXCEEDED' : 'RATES_FAILED'),
    });
  }
});

const ASSISTANT_SYSTEM_PROMPT = [
  'You are the in-app "AI Assistant" for MeasureCraft, a construction quantity-takeoff tool for Quantity Surveyors.',
  'Answer ONLY questions about how to use MeasureCraft: uploading/calibrating a plan, drawing walls/columns/slabs/beams/openings, ',
  'AI element detection, editing/accepting elements, sill/soffit heights, layers, the quantity table, 3D preview, ',
  'Excel/PDF/JSON export, market rates, Simple vs Professional mode, and account/login basics.',
  'Key facts about the product: Calibrate by picking two points on a known real-world length and entering the length in metres. ',
  'Continuous polylines are drawn by clicking points and finishing with Enter or double-click; Esc cancels. ',
  'Lock Zoom disables trackpad scroll-zoom (Ctrl+scroll still works). AI Detect proposes elements from the plan image after calibration; ',
  'the user must accept or edit them. Export options are Excel BOQ, a marked-up PDF/PNG plan, and a project JSON file. ',
  'Simple Mode is a guided upload → calibrate → AI detect → rates → export flow; Professional Mode has the full toolset ',
  '(layers, deductions, 3D, materials). Work can be handed off from Simple to Pro Mode and back.',
  'If asked something unrelated to using this app (general chit-chat, other software, coding help, unrelated advice), ',
  'politely say you can only help with MeasureCraft itself and redirect to what you can help with.',
  'Keep answers short — 1-3 sentences, plain text, no markdown formatting, no code blocks.',
].join(' ');

app.post('/api/assistant-chat', rateLimitAi, requireApiToken, async (req, res) => {
  try {
    const { message, history } = req.body || {};
    const msg = (message && String(message).trim()) || '';
    if (!msg) {
      return res.status(400).json({ success: false, error: 'message is required' });
    }
    if (msg.length > 2000) {
      return res.status(400).json({ success: false, error: 'message is too long (max 2000 characters)' });
    }
    // Only trust a short trailing slice of client-supplied history; it's context, not instructions.
    const turns = Array.isArray(history) ? history.slice(-6) : [];
    const historyText = turns
      .filter(t => t && typeof t.role === 'string' && typeof t.text === 'string')
      .map(t => `${t.role === 'assistant' ? 'Assistant' : 'User'}: ${String(t.text).slice(0, 500)}`)
      .join('\n');

    const model = getModel({ json: false });
    const result = await model.generateContent([
      { text: ASSISTANT_SYSTEM_PROMPT },
      ...(historyText ? [{ text: 'Recent conversation:\n' + historyText }] : []),
      { text: 'User question: ' + msg },
    ]);
    const answer = (result.response.text() || '').trim().slice(0, 1200);

    res.json({ success: true, answer, model: GEMINI_MODEL });
  } catch (err) {
    console.error('assistant-chat', err);
    const msg = err.message || String(err);
    const quota = /quota|429|rate limit/i.test(msg);
    res.status(quota ? 429 : 500).json({
      success: false,
      error: msg,
      code: err.code || (quota ? 'QUOTA_EXCEEDED' : 'ASSISTANT_FAILED'),
    });
  }
});

// ---------------------------------------------------------------------------
// Auth helpers for user testing: email join + optional Google (Gmail)
// ---------------------------------------------------------------------------
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const research = require('./research-store');
// Directory + S3 hydration is awaited once at startup, before the server
// starts accepting requests (see the app.listen call near the bottom of
// this file). We deliberately do NOT call research.ensureDirs() here
// synchronously: if S3 mirroring is enabled, ensureDirs() must run AFTER
// hydration so it doesn't create empty local placeholder files before the
// real data has been pulled down from the bucket.

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function buildSession({ email, name, participantId, provider }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const local = cleanEmail.split('@')[0] || 'User';
  return {
    email: cleanEmail,
    name: String(name || local).slice(0, 80),
    participantId: participantId ? String(participantId).trim().slice(0, 64) : null,
    provider: provider || 'email',
    loggedInAt: Date.now(),
  };
}

app.get('/api/auth/config', (_req, res) => {
  res.json({
    success: true,
    googleClientId: GOOGLE_CLIENT_ID || null,
    emailJoinEnabled: true,
  });
});

app.post('/api/auth/email-join', (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    let participantId = (req.body && req.body.participantId) ? String(req.body.participantId).trim() : null;
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'A valid email is required' });
    }
    // Existing email may re-join without re-typing ID (server returns locked ID).
    // New email requires an explicit unique Participant ID.
    const existingPid = research.getParticipantForEmail(email);
    if (!existingPid && !participantId) {
      return res.status(400).json({
        success: false,
        error: 'Participant ID is required. Choose a unique ID that has not been used before.',
        code: 'PARTICIPANT_ID_REQUIRED',
      });
    }
    const bind = research.bindEmailToParticipant(email, participantId || existingPid);
    if (!bind.ok) {
      return res.status(409).json({
        success: false,
        error: bind.error,
        participantId: bind.participantId,
        code: 'EMAIL_PARTICIPANT_LOCKED',
      });
    }
    participantId = bind.participantId;
    const session = buildSession({ email, participantId, provider: 'email' });
    res.json({ success: true, session, alreadyBound: !!bind.alreadyBound });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Password gate for Simple ↔ Pro switches (research integrity). Default: demo1234 */
const MODE_SWITCH_PASSWORD = (process.env.MODE_SWITCH_PASSWORD || 'demo1234').trim();

app.post('/api/auth/verify-mode-switch', (req, res) => {
  try {
    const password = String((req.body && req.body.password) || '');
    if (password && password === MODE_SWITCH_PASSWORD) {
      return res.json({ success: true, allowed: true });
    }
    return res.status(401).json({
      success: false,
      allowed: false,
      error: 'Incorrect password. Mode switch is restricted for research integrity.',
      code: 'MODE_SWITCH_DENIED',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(503).json({
        success: false,
        error: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.',
        code: 'GOOGLE_NOT_CONFIGURED',
      });
    }
    const credential = req.body && req.body.credential;
    let participantId = (req.body && req.body.participantId) ? String(req.body.participantId).trim() : null;
    if (!credential || typeof credential !== 'string') {
      return res.status(400).json({ success: false, error: 'Google credential is required' });
    }
    const verifyUrl = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential);
    const gResp = await fetch(verifyUrl);
    const info = await gResp.json().catch(() => ({}));
    if (!gResp.ok || !info || !info.email) {
      return res.status(401).json({
        success: false,
        error: (info && info.error_description) || 'Invalid Google token',
        code: 'GOOGLE_INVALID',
      });
    }
    if (info.aud && info.aud !== GOOGLE_CLIENT_ID) {
      return res.status(401).json({ success: false, error: 'Google token audience mismatch', code: 'GOOGLE_AUD' });
    }
    const existingPid = research.getParticipantForEmail(info.email);
    if (!existingPid && !participantId) {
      return res.status(400).json({
        success: false,
        error: 'Participant ID is required for first-time Google sign-in. Choose a unique ID.',
        code: 'PARTICIPANT_ID_REQUIRED',
      });
    }
    const bind = research.bindEmailToParticipant(info.email, participantId || existingPid);
    if (!bind.ok) {
      return res.status(409).json({
        success: false,
        error: bind.error,
        participantId: bind.participantId,
        code: 'EMAIL_PARTICIPANT_LOCKED',
      });
    }
    participantId = bind.participantId;
    const session = buildSession({
      email: info.email,
      name: info.name || info.email.split('@')[0],
      participantId,
      provider: 'google',
    });
    res.json({ success: true, session, alreadyBound: !!bind.alreadyBound });
  } catch (err) {
    console.error('auth/google', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Research data collection (user testing / final-year study)
// ---------------------------------------------------------------------------
const RESEARCH_ADMIN_TOKEN = (process.env.RESEARCH_ADMIN_TOKEN || '').trim();

function requireResearchAdmin(req, res, next) {
  if (!RESEARCH_ADMIN_TOKEN) {
    // Fail closed by default. An explicitly opted-in local development override
    // keeps the dashboard convenient without risking an open Render deployment.
    if (String(process.env.ALLOW_OPEN_RESEARCH_ADMIN || '').toLowerCase() === 'true' && process.env.NODE_ENV !== 'production') return next();
    return res.status(503).json({
      success: false,
      error: 'Research dashboard is disabled until RESEARCH_ADMIN_TOKEN is configured.',
      code: 'RESEARCH_ADMIN_NOT_CONFIGURED',
    });
  }
  const hdr = req.headers['x-research-token'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const token = String(hdr || bearer || '').trim();
  if (token && token === RESEARCH_ADMIN_TOKEN) return next();
  return res.status(401).json({
    success: false,
    error: 'Unauthorized. Researcher dashboard requires X-Research-Token.',
    code: 'RESEARCH_UNAUTHORIZED',
  });
}

/** Start a timed research session (participant + mode). */
app.post('/api/research/session/start', (req, res) => {
  try {
    const { participantId, mode } = req.body || {};
    if (!participantId || !String(participantId).trim()) {
      return res.status(400).json({ success: false, error: 'participantId is required' });
    }
    const session = research.startSession({
      participantId,
      mode: mode === 'pro' || mode === 'Pro' ? 'pro' : 'simple',
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true, session });
  } catch (err) {
    console.error('research session/start', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/research/session/end', (req, res) => {
  try {
    const { sessionId, projectId, drawingId } = req.body || {};
    if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId is required' });
    const session = research.endSession(sessionId, { projectId, drawingId });
    if (!session) return res.status(404).json({ success: false, error: 'session not found' });
    res.json({ success: true, session });
  } catch (err) {
    console.error('research session/end', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Register uploaded drawing (stores original bytes; does not train AI). */
app.post('/api/research/project', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.participantId) {
      return res.status(400).json({ success: false, error: 'participantId is required' });
    }
    const project = research.registerProject({
      participantId: body.participantId,
      mode: body.mode === 'pro' || body.mode === 'Pro' ? 'pro' : 'simple',
      sessionId: body.sessionId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      imageBase64: body.imageBase64,
      projectName: body.projectName,
      scaleNote: body.scaleNote,
      meta: body.meta,
    });
    // Do not echo full image back
    res.json({
      success: true,
      project: {
        projectId: project.projectId,
        drawingId: project.drawingId,
        mode: project.mode,
        revision: project.revision || 'ORIGINAL',
        parentProjectId: project.parentProjectId || null,
        uploadedAt: project.uploadedAt,
        fileName: project.fileName,
        byteSize: project.byteSize,
        sha256: project.sha256,
        originalUnchanged: project.originalUnchanged !== false,
        forAiTraining: false,
      },
    });
  } catch (err) {
    console.error('research project', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Simple → Pro: create PROJ-0001/A (same Drawing ID, new Project ID).
 * Parent Simple record is never modified.
 */
app.post('/api/research/project/pro-revision', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.parentProjectId) {
      return res.status(400).json({ success: false, error: 'parentProjectId is required' });
    }
    const project = research.createProRevision({
      parentProjectId: body.parentProjectId,
      participantId: body.participantId,
      sessionId: body.sessionId,
      projectName: body.projectName,
      meta: body.meta,
    });
    res.json({
      success: true,
      project: {
        projectId: project.projectId,
        drawingId: project.drawingId,
        mode: project.mode,
        revision: project.revision,
        parentProjectId: project.parentProjectId,
        uploadedAt: project.uploadedAt,
        fileName: project.fileName,
      },
      message: 'Pro Mode version created. Drawing ID unchanged; Project ID is a new revision.',
    });
  } catch (err) {
    console.error('research pro-revision', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/** Log one measurement comparison row (or batch). */
app.post('/api/research/measurement', (req, res) => {
  try {
    const body = req.body || {};
    if (Array.isArray(body.measurements)) {
      if (!body.participantId) {
        return res.status(400).json({ success: false, error: 'participantId is required' });
      }
      const common = {
        participantId: body.participantId,
        projectId: body.projectId,
        drawingId: body.drawingId,
        sessionId: body.sessionId,
        measurementMode: body.measurementMode || body.mode,
        mode: body.mode,
        measurementDurationSec: body.measurementDurationSec,
        notes: body.notes,
      };
      const records = research.logMeasurementBatch(body.measurements, common);
      return res.json({ success: true, count: records.length, records });
    }
    if (!body.participantId) {
      return res.status(400).json({ success: false, error: 'participantId is required' });
    }
    const record = research.logMeasurement(body);
    res.json({ success: true, record });
  } catch (err) {
    console.error('research measurement', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Researcher dashboard APIs (protected). */
app.get('/api/research/summary', requireResearchAdmin, (_req, res) => {
  try {
    res.json({ success: true, summary: research.summaryStats() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/records', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listMeasurements(req.query || {});
    res.json({ success: true, count: rows.length, records: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/projects', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listProjects(req.query || {});
    res.json({ success: true, count: rows.length, projects: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/sessions', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listSessions(req.query || {});
    res.json({ success: true, count: rows.length, sessions: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/export', requireResearchAdmin, (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    const rows = research.listMeasurements(req.query || {});
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="measurecraft-research.json"');
      return res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, records: rows }, null, 2));
    }
    const csv = research.exportCsv(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="measurecraft-research.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/drawing/:drawingId', requireResearchAdmin, (req, res) => {
  try {
    const info = research.getDrawingPath(req.params.drawingId);
    if (!info) return res.status(404).json({ success: false, error: 'drawing not found' });
    res.sendFile(info.abs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Download marked plan (measurements overlaid) for a drawing ID. */
app.get('/api/research/drawing/:drawingId/marked', requireResearchAdmin, (req, res) => {
  try {
    const info = research.getMarkedDrawingPath(req.params.drawingId);
    if (!info) return res.status(404).json({ success: false, error: 'marked drawing not found' });
    const name = info.fileName || (req.params.drawingId + '_marked.jpg');
    res.setHeader('Content-Disposition', 'attachment; filename="' + String(name).replace(/"/g, '') + '"');
    res.sendFile(info.abs);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Client uploads marked plan after Pro export (no admin token; same as measurement logging).
 * Body: { drawingId, image_base64|imageBase64, mime_type?, participantId?, mode?, source? }
 */
app.post('/api/research/marked-drawing', (req, res) => {
  try {
    const body = req.body || {};
    const drawingId = body.drawingId || body.drawing_id;
    const imageBase64 = body.image_base64 || body.imageBase64;
    const mimeType = body.mime_type || body.mimeType || 'image/jpeg';
    const result = research.saveMarkedDrawing({
      drawingId,
      imageBase64,
      mimeType,
      participantId: body.participantId || body.participant_id,
      mode: body.mode,
      source: body.source || 'pro_export',
    });
    res.json({ success: true, marked: result });
  } catch (err) {
    console.error('research marked-drawing', err);
    res.status(400).json({ success: false, error: err.message || 'failed to save marked drawing' });
  }
});

/** List stored drawing files (for manual review / GitHub import). Neutral labels only. */
app.get('/api/research/drawings', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listStoredDrawings();
    res.json({
      success: true,
      count: rows.length,
      drawings: rows,
      storagePath: research.DRAWINGS_DIR,
      hint: 'Download original via /api/research/drawing/:id and marked plan via /api/research/drawing/:id/marked',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Delete measurement record(s) by recordId */
app.delete('/api/research/records', requireResearchAdmin, (req, res) => {
  try {
    const body = req.body || {};
    let ids = body.recordIds || body.ids || [];
    if (req.query.recordId) ids = ids.concat(String(req.query.recordId));
    if (!Array.isArray(ids)) ids = [ids];
    const result = research.deleteMeasurementRecords(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/research/records/delete', requireResearchAdmin, (req, res) => {
  try {
    const ids = (req.body && (req.body.recordIds || req.body.ids)) || [];
    const result = research.deleteMeasurementRecords(ids);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Wipe ALL research data (admin only). Irreversible.
 * Body: { "confirm": "DELETE_ALL_RESEARCH_DATA", "keepDrawings"?: true }
 */
app.post('/api/research/clear-all', requireResearchAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (body.confirm !== 'DELETE_ALL_RESEARCH_DATA') {
      return res.status(400).json({
        success: false,
        error: 'Send { "confirm": "DELETE_ALL_RESEARCH_DATA" } to proceed.',
      });
    }
    const result = research.clearAllResearchData({
      keepDrawings: !!body.keepDrawings,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Export human correction samples for offline AI training / evaluation.
 * MeasureCraft does not fine-tune Gemini automatically; this JSON is for your own training pipeline.
 */
app.get('/api/research/training-export', requireResearchAdmin, (req, res) => {
  try {
    const dataset = research.buildTrainingDataset(req.query || {});
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="measurecraft-training-export.json"');
    res.send(JSON.stringify(dataset, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Save the final QS-reviewed geometry for a drawing. This is dataset collection, not automatic Gemini training. */
app.post('/api/research/annotations', (req, res) => {
  try {
    const body = req.body || {};
    if (!body.drawingId) return res.status(400).json({ success: false, error: 'drawingId is required' });
    const saved = research.saveReviewedAnnotations({
      drawingId: body.drawingId,
      projectId: body.projectId,
      participantId: body.participantId,
      mode: body.mode,
      imageWidth: body.imageWidth,
      imageHeight: body.imageHeight,
      metersPerPixel: body.metersPerPixel,
      legendNotes: body.legendNotes,
      elements: body.elements,
      aiElements: body.aiElements,
      source: body.source || 'qs_review_export',
    });
    res.json({ success: true, annotation: { drawingId: saved.drawingId, projectId: saved.projectId, reviewedAt: saved.reviewedAt, elementCount: saved.elements.length } });
  } catch (err) {
    console.error('research annotations', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/research/annotation-export', requireResearchAdmin, (req, res) => {
  try {
    const dataset = research.buildAnnotationDataset(req.query || {});
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="measurecraft-reviewed-annotations.json"');
    res.send(JSON.stringify(dataset, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/accuracy-baseline', requireResearchAdmin, (req, res) => {
  try {
    res.json({ success: true, accuracy: research.detectionAccuracy(req.query || {}) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/annotations', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listReviewedAnnotations(req.query || {});
    res.json({ success: true, count: rows.length, annotations: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Claim / validate unique participant ID (mode-select). */
app.post('/api/research/participant/claim', (req, res) => {
  try {
    const { participantId, email } = req.body || {};
    if (!participantId || !String(participantId).trim()) {
      return res.status(400).json({ success: false, error: 'Participant ID is required', code: 'PARTICIPANT_ID_REQUIRED' });
    }
    const result = research.assertParticipantAvailable(participantId, email);
    if (!result.ok) {
      return res.status(409).json({ success: false, error: result.error, participantId: result.participantId || null });
    }
    res.json({ success: true, participantId: result.participantId, bound: !!result.bound });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Real-time element lifecycle events (accept / reject / edit / add / delete / detect).
 * Logged while the QS works — does not wait for export.
 */
app.post('/api/research/element-event', (req, res) => {
  try {
    const body = req.body || {};
    if (Array.isArray(body.events)) {
      const common = {
        participantId: body.participantId,
        projectId: body.projectId,
        drawingId: body.drawingId,
        sessionId: body.sessionId,
        mode: body.mode,
      };
      const records = research.logElementEventBatch(body.events, common);
      return res.json({ success: true, count: records.length, events: records });
    }
    if (!body.participantId) {
      return res.status(400).json({ success: false, error: 'participantId is required' });
    }
    if (!body.action) {
      return res.status(400).json({ success: false, error: 'action is required' });
    }
    const record = research.logElementEvent(body);
    res.json({ success: true, event: record });
  } catch (err) {
    console.error('research element-event', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/research/element-events', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.listElementEvents(req.query || {});
    res.json({ success: true, count: rows.length, events: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SPA-style fallback: unknown non-API routes → login
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

async function start() {
  // Pull any existing research data down from S3 (if configured) before we
  // start accepting traffic, so the first requests see a warm local cache
  // instead of racing the hydration in the background.
  try {
    await research.hydrateFromRemote();
  } catch (e) {
    console.warn('research store init', e.message);
  }

  app.listen(PORT, () => {
    console.log(`MeasureCraft listening on :${PORT}`);
    console.log(`Gemini key: ${GEMINI_API_KEY ? 'set' : 'MISSING — set GEMINI_API_KEY'}`);
    console.log(`Model: ${GEMINI_MODEL}`);
    console.log(`API token: ${MC_API_TOKEN ? 'required (MC_API_TOKEN set)' : 'open (set MC_API_TOKEN to require X-MC-Token)'}`);
    console.log(`AI rate limit: ${process.env.MC_AI_RATE_LIMIT || 20}/min per IP`);
    console.log(`Research admin token: ${RESEARCH_ADMIN_TOKEN ? 'required' : 'OPEN (set RESEARCH_ADMIN_TOKEN)'}`);
    console.log(`Google Sheets webhook: ${process.env.GOOGLE_SHEETS_WEBHOOK_URL ? 'configured' : 'not set'}`);
    console.log(`Google sign-in: ${GOOGLE_CLIENT_ID ? 'enabled' : 'off (set GOOGLE_CLIENT_ID for Gmail button)'}`);
    console.log(`Research storage: ${research.storageStatus().enabled ? 'S3 (' + research.storageStatus().bucket + ')' : 'local disk only'}`);
    console.log(`Research data dir: ${research.DATA_ROOT}`);
  });
}

start();
