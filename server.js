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
const auth = require('./auth');
let sharp = null;
try {
  sharp = require('sharp');
} catch (_) {
  console.warn('[detect] sharp is unavailable; tiled mode will use logical full-image passes and preprocessing will be skipped.');
}

let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (_) {
  // Optional — OCR scale/label assist is skipped when not installed
}

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
// gemini-2.0-flash was shut down by Google on June 1, 2026 — gemini-3.5-flash
// is the current supported default. Set GEMINI_MODEL=gemini-3.1-pro in .env
// for noticeably better bounding-box accuracy (slower/pricier).
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
// Render sets RENDER_EXTERNAL_URL (e.g. https://measurecraftnew.onrender.com).
// Always allow our own public URL so same-origin browser fetches work in production
// even when ALLOWED_ORIGINS is not configured.
const renderExternalUrl = (process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
if (renderExternalUrl && !allowedOrigins.includes(renderExternalUrl)) {
  allowedOrigins.push(renderExternalUrl);
}
app.use(cors({
  origin: (origin, callback) => {
    // Non-browser / same-process clients often omit Origin.
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // If no allowlist was configured, permit all origins rather than 500ing.
    // Set ALLOWED_ORIGINS to a comma-separated list to lock this down later.
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Reject without throwing — callback(Error) becomes an unhandled 500 HTML page
    // and breaks the login UI with a generic "Could not join" message.
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-MC-Token', 'X-Research-Token'],
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Simple Mode embeds the local walkthrough in a same-origin iframe. Keep
  // framing disabled everywhere else, but allow this one documented page.
  res.setHeader('X-Frame-Options', req.path === '/walkthrough.html' ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '25mb' }));

// Auth routes (JWT when jsonwebtoken+bcryptjs installed; otherwise demo-safe fallback)
app.post('/api/login', auth.loginHandler);
app.post('/api/register', auth.registerHandler);
app.get('/api/me', auth.requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

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
  if (!MC_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, error: 'AI API protection is not configured.', code: 'API_TOKEN_NOT_CONFIGURED' });
    }
    return next();
  }
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

function normalizeDetectedElements(rawElements, pixelW, pixelH, options = {}) {
  const source = Array.isArray(rawElements) ? rawElements : [];
  const maxW = Number(pixelW) > 0 ? Number(pixelW) : null;
  const maxH = Number(pixelH) > 0 ? Number(pixelH) : null;
  const imgArea = (maxW && maxH) ? maxW * maxH : null;
  const minDim = (maxW && maxH) ? Math.min(maxW, maxH) : null;
  const normalized = [];
  const rejected = { area: 0, aspect: 0, size: 0, geometry: 0 };

  for (const raw of source) {
    if (!raw || typeof raw !== 'object') continue;
    let type = String(raw.type || '').trim().toLowerCase();
    if (type === 'room' || type === 'area' || type === 'floor') type = 'slab';
    if (type === 'opening') type = 'window';
    if (!DETECT_TYPES.has(type)) {
      rejected.type += 1;
      continue;
    }

    const values = ['x', 'y', 'w', 'h'].map((key) => Number(raw[key]));
    if (values.some((value) => !Number.isFinite(value))) {
      rejected.geometry += 1;
      continue;
    }
    let [x, y, w, h] = values;
    if (w <= 1 || h <= 1) {
      rejected.geometry += 1;
      continue;
    }
    x = Math.max(0, x);
    y = Math.max(0, y);
    if (maxW != null) w = Math.min(w, Math.max(0, maxW - x));
    if (maxH != null) h = Math.min(h, Math.max(0, maxH - y));
    if (w <= 1 || h <= 1) {
      rejected.geometry += 1;
      continue;
    }

    const area = w * h;
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h)); // >= 1

    // ---- Geometric sanity filters (C) ----
    if (imgArea) {
      // Absolute minimum area: ignore tiny noise / text boxes (≈ 0.002 % of sheet)
      const minAreaFrac = type === 'column' || type === 'door' || type === 'window' ? 0.000008 : 0.00002;
      if (area < imgArea * minAreaFrac) {
        rejected.area += 1;
        continue;
      }
      // Columns / openings should not be huge relative to the sheet
      if ((type === 'column' || type === 'door' || type === 'window') && area > imgArea * 0.04) {
        rejected.area += 1;
        continue;
      }
    }

    if (type === 'column') {
      // True columns are roughly square-ish; long thin rectangles are walls/beams
      if (aspect > 2.8) {
        rejected.aspect += 1;
        continue;
      }
      if (minDim && Math.max(w, h) > minDim * 0.22) {
        // Column larger than ~22 % of the short sheet side is almost certainly a room/slab misclass
        rejected.area += 1;
        continue;
      }
    }

    if (type === 'wall' || type === 'beam') {
      // Walls/beams must be elongated; reject near-square boxes that are likely rooms or hatch
      if (aspect < 2.2) {
        rejected.aspect += 1;
        continue;
      }
    }

    if (type === 'door' || type === 'window') {
      // Openings are small and moderately elongated
      if (aspect > 8) {
        rejected.aspect += 1;
        continue;
      }
      if (minDim && Math.max(w, h) > minDim * 0.18) {
        rejected.area += 1;
        continue;
      }
    }

    let confidence = Number(raw.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    if (confidence > 1) confidence /= 100;
    confidence = Math.max(0, Math.min(1, confidence));

    // Slight confidence penalty for borderline aspect so QS review prioritises them
    if (type === 'column' && aspect > 2.0) confidence *= 0.92;
    if ((type === 'wall' || type === 'beam') && aspect < 3.0) confidence *= 0.9;

    const height = Number(raw.height);
    const item = {
      type,
      label: String(raw.label || type).trim().slice(0, 120) || type,
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
      w: Math.round(w * 100) / 100,
      h: Math.round(h * 100) / 100,
      height: Number.isFinite(height) && height > 0 ? Math.round(height * 1000) / 1000 : null,
      confidence: Math.round(confidence * 1000) / 1000,
    };
    if (raw.ocrForced) item.ocrForced = true;
    if (raw.ocrLabel) item.ocrLabel = raw.ocrLabel;
    normalized.push(item);
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

  if (options.returnStats) {
    return { elements: kept, rejected };
  }
  return kept;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(GEMINI_API_KEY),
    model: GEMINI_MODEL,
    sharp: Boolean(sharp),
    ocr: Boolean(Tesseract),
    features: {
      preprocess: Boolean(sharp),
      realTileCrop: Boolean(sharp),
      ocrAssist: Boolean(Tesseract),
      geometricFilters: true,
    },
  });
});

/**
 * Build the core detection prompt.
 * @param {'coarse'|'fine'|'single'} passType
 * @param {number} w
 * @param {number} h
 * @param {string} legend
 * @param {string} [tileNote]
 */
function buildDetectPrompt(passType, w, h, legend, tileNote) {
  const sizeNote = w && h ? `Image size is ${w}x${h} pixels. All x,y,w,h must be inside 0..${w} and 0..${h}.` : '';
  const base = [
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
    sizeNote,
    'x,y are top-left of each box; w,h are width and height in pixels.',
    '- confidence is a number from 0 to 1 based on how clearly the element is visible and classified; do not use confidence as a substitute for QS review.',
    legend ? 'USER-PROVIDED DRAWING LEGEND AND QS GUIDANCE (use this as visual context, but do not blindly invent elements from text): ' + legend : '',
    '- Treat the user legend as a mapping between visible symbols/colours/line styles and element types. First locate the visible symbol in the image, then classify and box it.',
    '- Ignore legend swatches, notes, dimensions, title blocks, north arrows, furniture, hatching, and annotation text unless the user explicitly says they are target elements.',
    '- Do not invent elements you cannot see. Prefer fewer accurate boxes over many wrong ones.',
    'If you return two boxes for the same physical element, merge them into one box instead — never return duplicate/overlapping boxes for the same wall, column, or slab.',
  ];

  if (passType === 'coarse') {
    base.push(
      'FOCUS THIS PASS ON LARGE ELEMENTS ONLY: slabs (every room floor plate), long continuous wall runs, and clear beams.',
      'You may still return doors/windows/columns if they are very obvious, but prioritise large geometry.',
      'Return at most 80 elements, highest confidence first.'
    );
  } else if (passType === 'fine') {
    base.push(
      'FOCUS THIS PASS ON SMALL ELEMENTS: doors, windows, columns, and short wall segments.',
      'Also return any slabs or long walls that are clearly visible inside this region.',
      tileNote || '',
      'Return at most 60 elements for this tile, highest confidence first.'
    );
  } else {
    base.push(
      'Return at most 150 elements, highest confidence first. Include ALL visible slabs, columns, doors, and windows — do not stop early on a dense drawing.'
    );
  }

  return base.filter(Boolean).join(' ');
}

/**
 * Call Gemini once with the given prompt + image(s).
 */
/**
 * Mild high-contrast + sharpen preprocessing for better line / hatch visibility.
 * Keeps colour (Gemini benefits from colour legends) but normalises contrast
 * and applies a light unsharp mask. Returns original data if sharp is missing
 * or preprocessing is disabled.
 */
async function preprocessForDetection(imageBase64, mime, options = {}) {
  if (!sharp || options.disablePreprocess) {
    return { data: imageBase64, mimeType: mime || 'image/jpeg', preprocessed: false };
  }
  try {
    const input = Buffer.from(imageBase64, 'base64');
    let pipeline = sharp(input).rotate(); // honour EXIF orientation

    // Normalise contrast and mild sharpen — helps thin walls / dashed lines
    // without destroying hatch patterns or colour legend swatches.
    pipeline = pipeline
      .normalize()
      .modulate({ brightness: 1.02, saturation: 1.05 })
      .sharpen({ sigma: 0.8, m1: 0.6, m2: 0.3 });

    // Prefer JPEG for Gemini size limits; keep PNG if source was PNG and small
    const usePng = (mime || '').includes('png') && imageBase64.length < 4 * 1024 * 1024;
    const output = usePng
      ? await pipeline.png({ compressionLevel: 6 }).toBuffer()
      : await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();

    return {
      data: output.toString('base64'),
      mimeType: usePng ? 'image/png' : 'image/jpeg',
      preprocessed: true,
    };
  } catch (err) {
    console.warn('[preprocess] failed, using original image:', err.message);
    return { data: imageBase64, mimeType: mime || 'image/jpeg', preprocessed: false };
  }
}

async function cropImageToTile(imageBase64, left, top, width, height, options = {}) {
  if (!sharp) return null;
  const input = Buffer.from(imageBase64, 'base64');
  const clippedLeft = Math.max(0, Math.floor(left));
  const clippedTop = Math.max(0, Math.floor(top));
  const clippedWidth = Math.max(1, Math.floor(width));
  const clippedHeight = Math.max(1, Math.floor(height));
  let pipeline = sharp(input)
    .extract({ left: clippedLeft, top: clippedTop, width: clippedWidth, height: clippedHeight });

  if (!options.disablePreprocess) {
    pipeline = pipeline
      .normalize()
      .modulate({ brightness: 1.02, saturation: 1.05 })
      .sharpen({ sigma: 0.8, m1: 0.6, m2: 0.3 });
  }

  const output = await pipeline.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return {
    data: output.toString('base64'),
    mimeType: 'image/jpeg',
    left: clippedLeft,
    top: clippedTop,
    width: clippedWidth,
    height: clippedHeight,
  };
}

/**
 * Lightweight OCR assist (tesseract.js optional).
 * Returns { scaleRatio, scaleText, labels: [{text, x, y, w, h, conf}] }
 * Used to inject scale hints into the prompt and to hard-correct element types.
 */
async function runOcrAssist(imageBase64, pixelW, pixelH) {
  if (!Tesseract || !imageBase64) {
    return { scaleRatio: null, scaleText: null, labels: [], ocrUsed: false };
  }
  try {
    // Downscale large images for speed — OCR does not need full detection resolution
    let ocrBuffer = Buffer.from(imageBase64, 'base64');
    let scaleFactor = 1;
    if (sharp && pixelW > 1800) {
      scaleFactor = 1600 / Math.max(pixelW, pixelH);
      ocrBuffer = await sharp(ocrBuffer)
        .resize({ width: Math.round(pixelW * scaleFactor), height: Math.round(pixelH * scaleFactor), fit: 'inside' })
        .grayscale()
        .normalize()
        .png()
        .toBuffer();
    }

    const result = await Tesseract.recognize(ocrBuffer, 'eng', {
      logger: () => {},
    });

    const labels = [];
    const words = (result.data && result.data.words) || [];
    for (const word of words) {
      const t = (word.text || '').trim();
      if (!t || t.length < 1 || t.length > 24) continue;
      const conf = Number(word.confidence) || 0;
      if (conf < 40) continue;
      const bbox = word.bbox || {};
      // Map back to original pixel coordinates
      const x = (bbox.x0 || 0) / scaleFactor;
      const y = (bbox.y0 || 0) / scaleFactor;
      const w = ((bbox.x1 || 0) - (bbox.x0 || 0)) / scaleFactor;
      const h = ((bbox.y1 || 0) - (bbox.y0 || 0)) / scaleFactor;
      labels.push({
        text: t,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
        conf: Math.round(conf),
      });
    }

    // Scale detection: look for classic patterns 1:50, 1:100, 1/100, SCALE 1:75 etc.
    const fullText = (result.data && result.data.text) || '';
    let scaleRatio = null;
    let scaleText = null;
    const scalePatterns = [
      /(?:scale|sc\.?)\s*[:=]?\s*1\s*[:/]\s*(\d{2,4})/i,
      /\b1\s*[:/]\s*(\d{2,4})\b/,
      /(?:scale|sc\.?)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*mm\s*=\s*(\d+(?:\.\d+)?)\s*m/i,
    ];
    for (const re of scalePatterns) {
      const m = fullText.match(re);
      if (m) {
        if (m[2]) {
          // mm = m form → ratio = (mm real) / (m drawing * 1000)
          const mm = parseFloat(m[1]);
          const metres = parseFloat(m[2]);
          if (mm > 0 && metres > 0) {
            scaleRatio = (metres * 1000) / mm; // drawing units per real mm → classic 1:N
            scaleText = m[0].trim();
            break;
          }
        } else if (m[1]) {
          const n = parseInt(m[1], 10);
          if (n >= 20 && n <= 5000) {
            scaleRatio = n;
            scaleText = m[0].trim();
            break;
          }
        }
      }
    }

    return {
      scaleRatio,
      scaleText,
      labels: labels.slice(0, 120),
      ocrUsed: true,
      fullTextSnippet: fullText.slice(0, 400),
    };
  } catch (err) {
    console.warn('[ocr] assist failed:', err.message);
    return { scaleRatio: null, scaleText: null, labels: [], ocrUsed: false, error: err.message };
  }
}

/**
 * Map OCR labels that fall inside (or very near) a detection box to force
 * or boost the element type. Classic column marks: C1, COL, COL1, etc.
 */
function applyOcrLabelCorrections(elements, ocrLabels) {
  if (!Array.isArray(elements) || !Array.isArray(ocrLabels) || !ocrLabels.length) {
    return elements;
  }
  const columnHints = /^(c|col|column|stanchion|pier)[\s\-_]?\d*[a-z]?$/i;
  const slabHints = /^(s|sl|slab|fl|floor|rm|room)[\s\-_]?\d*[a-z]?$/i;
  const beamHints = /^(b|bm|beam)[\s\-_]?\d*[a-z]?$/i;
  const doorHints = /^(d|dr|door)[\s\-_]?\d*[a-z]?$/i;
  const windowHints = /^(w|win|wdw|window)[\s\-_]?\d*[a-z]?$/i;

  return elements.map((el) => {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    let best = null;
    for (const lab of ocrLabels) {
      const lx = lab.x + lab.w / 2;
      const ly = lab.y + lab.h / 2;
      // Centre of text inside or near the box (expand box slightly)
      const margin = Math.max(8, Math.min(el.w, el.h) * 0.25);
      if (
        lx >= el.x - margin &&
        lx <= el.x + el.w + margin &&
        ly >= el.y - margin &&
        ly <= el.y + el.h + margin
      ) {
        if (!best || lab.conf > best.conf) best = lab;
      }
    }
    if (!best) return el;

    const t = best.text.trim();
    let forcedType = null;
    if (columnHints.test(t)) forcedType = 'column';
    else if (slabHints.test(t)) forcedType = 'slab';
    else if (beamHints.test(t)) forcedType = 'beam';
    else if (doorHints.test(t)) forcedType = 'door';
    else if (windowHints.test(t)) forcedType = 'window';

    if (forcedType && forcedType !== el.type) {
      return {
        ...el,
        type: forcedType,
        label: t.slice(0, 40),
        confidence: Math.min(1, (el.confidence || 0.5) + 0.15),
        ocrForced: true,
        ocrLabel: t,
      };
    }
    // Same type — just attach a cleaner label if the existing one is generic
    if (forcedType && (!el.label || el.label === el.type)) {
      return { ...el, label: t.slice(0, 40), ocrLabel: t };
    }
    return el;
  });
}

async function runGeminiDetect(prompt, mime, imageBase64, legendImages) {
  const model = getModel();
  const content = [
    { text: prompt },
    { inlineData: { mimeType: mime, data: imageBase64 } },
  ];
  if (legendImages && legendImages.length) {
    content.push({
      text: 'The following uploaded image(s) show the drawing legend or symbol references. Use them only to understand visible symbols and colours in the plan; do not detect the legend samples themselves.',
    });
    legendImages.forEach((item) =>
      content.push({ inlineData: { mimeType: item.mimeType, data: item.data } })
    );
  }
  const result = await model.generateContent(content);
  const text = result.response.text();
  const parsed = parseJsonLoose(text);
  return Array.isArray(parsed.elements) ? parsed.elements : (Array.isArray(parsed) ? parsed : []);
}

/**
 * Simple quality gate. Returns { ok, warnings, errors }.
 * Does not require image decoding libraries — uses provided pixel dimensions + payload size.
 */
function qualityGate(w, h, base64Length, mime) {
  const warnings = [];
  const errors = [];

  if (!w || !h) {
    warnings.push('Pixel dimensions not provided — coordinate validation will be limited.');
  } else {
    if (w < 400 || h < 400) {
      errors.push('Image resolution is too low (minimum recommended 800×800 px for reliable detection of doors/windows).');
    } else if (w < 800 || h < 800) {
      warnings.push('Image resolution is modest. Small openings and columns may be missed. Prefer higher-resolution scans.');
    }
    if (w > 10000 || h > 10000) {
      warnings.push('Very large image. Detection will use tiling; consider downsampling slightly for speed.');
    }
    const aspect = w / h;
    if (aspect > 4 || aspect < 0.25) {
      warnings.push('Unusual aspect ratio — check that the drawing is not cropped incorrectly or rotated.');
    }
  }

  // Rough payload size heuristic (base64 is ~1.37× binary)
  const approxBytes = base64Length * 0.75;
  if (approxBytes < 30 * 1024) {
    warnings.push('Image file is very small — quality may be insufficient for detailed detection.');
  }

  if (!mime || !/^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime)) {
    errors.push('Unsupported image type.');
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}

app.post('/api/detect-elements', rateLimitAi, requireApiToken, async (req, res) => {
  try {
    const {
      image_base64,
      mime_type,
      pixel_w,
      pixel_h,
      legend_notes,
      legend_images,
      mode,           // 'tiled' (default) | 'single'
      tile_grid,      // e.g. 2 → 2×2
      tile_overlap,   // 0.0–0.4
      preprocess,     // true (default) | false — sharp high-contrast / sharpen
      ocr_assist,     // true (default when tesseract available) | false
    } = req.body || {};

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
    if ((w && (w < 1 || w > 12000)) || (h && (h < 1 || h > 12000))) {
      return res.status(400).json({ success: false, error: 'pixel_w / pixel_h out of range' });
    }

    // Quality gate
    const quality = qualityGate(w, h, image_base64.length, mime);
    if (!quality.ok) {
      return res.status(400).json({
        success: false,
        error: quality.errors.join(' '),
        code: 'QUALITY_GATE',
        quality,
      });
    }

    const legend = typeof legend_notes === 'string' ? legend_notes.trim().slice(0, 4000) : '';
    const allowedLegendImages = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
    const legendImages = Array.isArray(legend_images)
      ? legend_images
          .slice(0, 4)
          .filter((item) => {
            return (
              item &&
              typeof item.data === 'string' &&
              item.data.length <= 5 * 1024 * 1024 &&
              allowedLegendImages.has(String(item.mimeType || 'image/jpeg').toLowerCase())
            );
          })
          .map((item) => ({
            mimeType: String(item.mimeType || 'image/jpeg').toLowerCase(),
            data: item.data,
            name: typeof item.name === 'string' ? item.name.slice(0, 120) : 'legend reference',
          }))
      : [];

    const disablePreprocess = preprocess === false || preprocess === 'false';
    const wantOcr = ocr_assist !== false && ocr_assist !== 'false';

    // ---- A) Preprocess full image (high-contrast + mild sharpen) ----
    const pre = await preprocessForDetection(image_base64, mime, { disablePreprocess });
    const workMime = pre.mimeType;
    const workBase64 = pre.data;

    // ---- B) OCR scale-bar / label assist (optional tesseract.js) ----
    let ocrInfo = { scaleRatio: null, scaleText: null, labels: [], ocrUsed: false };
    if (wantOcr && Tesseract) {
      ocrInfo = await runOcrAssist(workBase64, w || 2000, h || 2000);
    }

    // Inject scale + a short list of high-confidence labels into the prompt
    let enrichedLegend = legend;
    if (ocrInfo.scaleText) {
      enrichedLegend = (enrichedLegend ? enrichedLegend + '\n' : '') +
        `OCR-detected scale annotation on the drawing: "${ocrInfo.scaleText}" (ratio 1:${ocrInfo.scaleRatio}). Use only as context; do not invent elements.`;
    }
    if (ocrInfo.labels && ocrInfo.labels.length) {
      const sample = ocrInfo.labels
        .filter((l) => l.conf >= 60)
        .slice(0, 25)
        .map((l) => l.text)
        .join(', ');
      if (sample) {
        enrichedLegend = (enrichedLegend ? enrichedLegend + '\n' : '') +
          `OCR-visible text fragments (may include element marks such as C1, S1, COL): ${sample}. Prefer classifying a box as column/slab/beam when a matching mark sits inside it.`;
      }
    }

    const detectMode = (mode === 'single') ? 'single' : 'tiled';
    const grid = Math.max(1, Math.min(3, Number(tile_grid) || 2)); // 1–3
    const overlap = Math.max(0, Math.min(0.35, Number(tile_overlap) || 0.2));

    let allRaw = [];
    let passes = [];

    if (detectMode === 'single' || !w || !h || grid === 1) {
      // Classic single-pass
      const prompt = buildDetectPrompt('single', w, h, enrichedLegend);
      const raw = await runGeminiDetect(prompt, workMime, workBase64, legendImages);
      allRaw = raw;
      passes.push({ type: 'single', count: raw.length, preprocessed: pre.preprocessed });
    } else {
      // ---- Coarse pass (full image, large elements) ----
      const coarsePrompt = buildDetectPrompt('coarse', w, h, enrichedLegend);
      const coarseRaw = await runGeminiDetect(coarsePrompt, workMime, workBase64, legendImages);
      allRaw = allRaw.concat(coarseRaw);
      passes.push({ type: 'coarse', count: coarseRaw.length, preprocessed: pre.preprocessed });

      // ---- Fine / tiled pass ----
      // Prefer real pixel crops via sharp for higher effective resolution on small elements.
      // When sharp is unavailable, fall back to full-image passes with a prompt constraint.

      const tileW = w / grid;
      const tileH = h / grid;
      const overlapPxX = tileW * overlap;
      const overlapPxY = tileH * overlap;

      for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
          const x0 = Math.max(0, col * tileW - overlapPxX);
          const y0 = Math.max(0, row * tileH - overlapPxY);
          const x1 = Math.min(w, (col + 1) * tileW + overlapPxX);
          const y1 = Math.min(h, (row + 1) * tileH + overlapPxY);

          const tileNote =
            `This is tile (${col + 1},${row + 1}) of a ${grid}×${grid} grid. ` +
            `Return coordinates relative to the provided tile image. ` +
            `Detect only elements visible in this tile; do not detect legend samples, notes, or title blocks.`;

          try {
            const tile = await cropImageToTile(workBase64, x0, y0, x1 - x0, y1 - y0, { disablePreprocess });
            const tileWActual = tile ? tile.width : w;
            const tileHActual = tile ? tile.height : h;
            const finePrompt = buildDetectPrompt('fine', tileWActual, tileHActual, enrichedLegend, tileNote);
            const tileRaw = await runGeminiDetect(
              finePrompt,
              tile ? tile.mimeType : workMime,
              tile ? tile.data : workBase64,
              legendImages
            );
            const mapped = tile
              ? tileRaw.map((el) => ({ ...el, x: Number(el.x) + tile.left, y: Number(el.y) + tile.top }))
              : tileRaw.filter((el) => {
                  const cx = Number(el.x) + Number(el.w) / 2;
                  const cy = Number(el.y) + Number(el.h) / 2;
                  return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
                });
            allRaw = allRaw.concat(mapped);
            passes.push({
              type: 'fine',
              tile: `${col + 1},${row + 1}`,
              region: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)],
              count: mapped.length,
              realCrop: Boolean(tile),
            });
          } catch (tileErr) {
            console.warn('Tile detection failed', col, row, tileErr.message);
            passes.push({ type: 'fine', tile: `${col + 1},${row + 1}`, error: tileErr.message });
          }
        }
      }
    }

    // ---- C) Geometric sanity filters + OCR label hard-corrections ----
    let elements = normalizeDetectedElements(allRaw, w, h);
    elements = applyOcrLabelCorrections(elements, ocrInfo.labels || []);

    // Re-run light NMS after OCR type changes (same type may now collide)
    const afterOcr = normalizeDetectedElements(elements, w, h, { returnStats: true });
    elements = afterOcr.elements || elements;

    res.json({
      success: true,
      elements,
      model: GEMINI_MODEL,
      mode: detectMode,
      quality: {
        warnings: quality.warnings,
        ok: true,
      },
      scale: ocrInfo.scaleRatio
        ? { ratio: ocrInfo.scaleRatio, text: ocrInfo.scaleText, source: 'ocr' }
        : null,
      validation: {
        received: allRaw.length,
        legendGuidanceUsed: Boolean(legend) || legendImages.length > 0,
        legendImagesUsed: legendImages.length,
        returned: elements.length,
        duplicatesRemoved: Math.max(0, allRaw.length - elements.length),
        coordinateSystem: w && h ? `${w}x${h}px` : 'source pixels',
        passes,
        tileGrid: detectMode === 'tiled' ? grid : 1,
        tileOverlap: detectMode === 'tiled' ? overlap : 0,
        preprocessed: pre.preprocessed,
        ocrUsed: Boolean(ocrInfo.ocrUsed),
        ocrLabels: (ocrInfo.labels || []).length,
        geometricRejected: afterOcr.rejected || null,
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

/** Update an existing measurement record (manual edit from dashboard). */
app.post('/api/research/records/update', requireResearchAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const recordId = body.recordId || body.id;
    if (!recordId) {
      return res.status(400).json({ success: false, error: 'recordId is required' });
    }
    const record = research.updateMeasurement(recordId, body);
    res.json({ success: true, record });
  } catch (err) {
    const status = /not found/i.test(err.message || '') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * Manual measurement entry from the research dashboard (Pro or Simple).
 * Fully manual — does not require AI detection.
 */
app.post('/api/research/records/manual', requireResearchAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!body.participantId) {
      return res.status(400).json({ success: false, error: 'participantId is required' });
    }
    if (!body.measurementType && !body.elementType) {
      return res.status(400).json({ success: false, error: 'measurementType is required' });
    }
    const userVal = body.userMeasurement != null ? body.userMeasurement : body.finalAcceptedMeasurement;
    if (userVal == null || userVal === '') {
      return res.status(400).json({ success: false, error: 'userMeasurement (or finalAcceptedMeasurement) is required' });
    }
    const modeRaw = body.measurementMode || body.mode || 'pro';
    const isPro = String(modeRaw).toLowerCase() === 'pro';
    const record = research.logMeasurement({
      participantId: body.participantId,
      projectId: body.projectId || null,
      drawingId: body.drawingId || null,
      measurementMode: isPro ? 'Pro' : 'Simple',
      mode: isPro ? 'pro' : 'simple',
      measurementType: body.measurementType || body.elementType,
      measurementMethod: body.measurementMethod || 'manual_dashboard_entry',
      referenceMeasurement: body.referenceMeasurement,
      aiMeasurement: body.aiMeasurement != null ? body.aiMeasurement : null,
      userMeasurement: userVal,
      finalAcceptedMeasurement: body.finalAcceptedMeasurement != null ? body.finalAcceptedMeasurement : userVal,
      unit: body.unit || '',
      notes: body.notes || 'Manual entry from research dashboard',
      elementLabel: body.elementLabel || body.measurementType || body.elementType,
      userCorrection: body.userCorrection,
      measurementDurationSec: body.measurementDurationSec,
      _skipSupersede: true,
    });
    res.json({ success: true, record });
  } catch (err) {
    console.error('research manual record', err);
    res.status(400).json({ success: false, error: err.message });
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
 * Researcher ground-truth quantities (admin only).
 * GET  /api/research/reference-quantities[?drawingId=DWG-0001]
 * POST /api/research/reference-quantities  body: { drawingId, measurementType, value, unit?, notes? }
 *      (value null / empty string removes the entry)
 */
app.get('/api/research/reference-quantities', requireResearchAdmin, (req, res) => {
  try {
    const drawingId = req.query.drawingId || null;
    const data = research.listReferenceQuantities(drawingId || undefined);
    res.json({ success: true, referenceQuantities: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/research/reference-quantities', requireResearchAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const result = research.setReferenceQuantity({
      drawingId: body.drawingId,
      measurementType: body.measurementType || body.elementType || body.type,
      value: body.value,
      unit: body.unit,
      notes: body.notes,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message || 'failed to set reference quantity' });
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

/**
 * YOLO training export (admin). Runs scripts/export-yolo.js and returns summary.
 * Prefer offline: node scripts/export-yolo.js --out ./yolo-dataset
 */
app.post('/api/research/yolo-export', requireResearchAdmin, (req, res) => {
  try {
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    const outDir = path.join(research.DATA_ROOT || path.join(__dirname, 'data'), 'yolo-export');
    const script = path.join(__dirname, 'scripts', 'export-yolo.js');
    const result = spawnSync(process.execPath, [script, '--out', outDir], {
      encoding: 'utf8',
      env: { ...process.env, RESEARCH_DATA_DIR: research.DATA_ROOT },
      timeout: 120000,
    });
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    } catch (_) {}
    res.json({
      success: result.status === 0,
      stdout: (result.stdout || '').slice(0, 4000),
      stderr: (result.stderr || '').slice(0, 2000),
      outDir,
      manifest,
    });
  } catch (err) {
    console.error('yolo-export', err);
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

app.get('/api/research/participants', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.participantSummary(req.query || {});
    res.json({ success: true, count: rows.length, participants: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/quantity-accuracy', requireResearchAdmin, (req, res) => {
  try {
    const rows = research.quantityAccuracyByType(req.query || {});
    res.json({ success: true, count: rows.length, byType: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/mode-comparison', requireResearchAdmin, (req, res) => {
  try {
    const data = research.modeComparison(req.query || {});
    res.json({ success: true, comparison: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/corrections', requireResearchAdmin, (req, res) => {
  try {
    const data = research.correctionSummary(req.query || {});
    res.json({ success: true, ...data });
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
