/**
 * MeasureCraft Research Data Store
 * -----------------------------
 * Collects drawings + measurement records for academic user testing.
 * - Local JSONL + original drawing files (review before any AI training)
 * - Optional Google Sheets webhook append (GOOGLE_SHEETS_WEBHOOK_URL)
 * - Never auto-trains AI; data is for researcher review only
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const researchStorage = require('./research-storage');

const DATA_ROOT = process.env.RESEARCH_DATA_DIR
  ? path.resolve(process.env.RESEARCH_DATA_DIR)
  : path.join(__dirname, 'data');
const DRAWINGS_DIR = path.join(DATA_ROOT, 'drawings');
const RESEARCH_DIR = path.join(DATA_ROOT, 'research');
const ANNOTATIONS_DIR = path.join(RESEARCH_DIR, 'annotations');

const FILES = {
  projects: path.join(RESEARCH_DIR, 'projects.jsonl'),
  measurements: path.join(RESEARCH_DIR, 'measurements.jsonl'),
  sessions: path.join(RESEARCH_DIR, 'sessions.jsonl'),
  emailBindings: path.join(RESEARCH_DIR, 'email-bindings.json'),
  elementEvents: path.join(RESEARCH_DIR, 'element-events.jsonl'),
  counter: path.join(RESEARCH_DIR, 'counters.json'),
  // Researcher-entered ground-truth quantities keyed by drawingId + measurementType
  referenceQuantities: path.join(RESEARCH_DIR, 'reference-quantities.json'),
};

researchStorage.configure(DATA_ROOT);

function persistWrite(file, data, encoding) {
  fs.writeFileSync(file, data, encoding);
  // Fire-and-forget: local write is already durable on disk, so the request
  // path doesn't wait on the network round trip to S3. Failures are logged
  // inside mirrorFile itself.
  researchStorage.mirrorFile(file);
}

function persistAppend(file, data, encoding) {
  fs.appendFileSync(file, data, encoding);
  researchStorage.mirrorFile(file);
}

function persistDelete(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (_) {}
  // Fire-and-forget S3 delete; failures are logged inside deleteFile.
  researchStorage.deleteFile(file);
}

function ensureDataDirs() {
  for (const d of [DATA_ROOT, DRAWINGS_DIR, RESEARCH_DIR, ANNOTATIONS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// Awaited once at server startup (see server.js), BEFORE the app starts
// accepting requests, so the local cache is populated from S3 first. Order
// matters: if we created empty local placeholder files before hydrating,
// ensureDirs() below would see them as "already exist" and skip filling
// them from S3, and mirrorFile could even push an empty file up and
// clobber real data. So: make dirs -> pull from S3 -> only then fill in
// any files still missing (i.e. truly new / never synced before).
// Safe to call more than once — hydrateFromS3() is a no-op after the first
// successful (or failed) run.
async function hydrateFromRemote() {
  ensureDataDirs();
  await researchStorage.hydrateFromS3();
  ensureDirs();
}

function ensureDirs() {
  ensureDataDirs();
  for (const f of Object.values(FILES)) {
    if (f.endsWith('.jsonl') && !fs.existsSync(f)) persistWrite(f, '', 'utf8');
  }
  if (!fs.existsSync(FILES.counter)) {
    persistWrite(FILES.counter, JSON.stringify({
      project: 0, drawing: 0, record: 0, session: 0,
    }, null, 2));
  }
}

function nextId(kind) {
  ensureDirs();
  let counters = { project: 0, drawing: 0, record: 0, session: 0 };
  try {
    counters = JSON.parse(fs.readFileSync(FILES.counter, 'utf8'));
  } catch (_) {}
  const key = kind === 'project' ? 'project'
    : kind === 'drawing' ? 'drawing'
    : kind === 'session' ? 'session'
    : 'record';
  counters[key] = (Number(counters[key]) || 0) + 1;
  persistWrite(FILES.counter, JSON.stringify(counters, null, 2));
  const n = counters[key];
  if (kind === 'project') return 'PROJ-' + String(n).padStart(4, '0');
  if (kind === 'drawing') return 'DWG-' + String(n).padStart(4, '0');
  if (kind === 'session') return 'SES-' + String(n).padStart(4, '0');
  return 'REC-' + String(n).padStart(4, '0');
}

function appendJsonl(file, obj) {
  ensureDirs();
  persistAppend(file, JSON.stringify(obj) + '\n', 'utf8');
}

function readJsonl(file) {
  ensureDirs();
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_) { return null; }
  }).filter(Boolean);
}

function sanitizeParticipant(raw) {
  const s = String(raw || '').trim().slice(0, 64);
  // Prefer opaque IDs; strip characters that could be PII-heavy paths
  return s.replace(/[<>"'\\]/g, '') || 'ANON';
}

// drawingId is only ever generated server-side as "DWG-0001" (see nextId()),
// but it's also accepted from unauthenticated request bodies (e.g. the
// marked-drawing upload) and gets used to build a filesystem path. Reject
// anything that isn't that exact shape so a crafted value like
// "../../../etc/passwd" can never reach path.join() as a path segment.
const DRAWING_ID_RE = /^DWG-\d{1,10}$/;
function sanitizeDrawingId(raw) {
  const s = String(raw || '').trim();
  return DRAWING_ID_RE.test(s) ? s : null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** One email → one participant ID for the whole study. */
function readEmailBindings() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(FILES.emailBindings, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeEmailBindings(map) {
  ensureDirs();
  persistWrite(FILES.emailBindings, JSON.stringify(map, null, 2), 'utf8');
}

/**
 * Bind email ↔ participantId (one-time, unique both ways).
 * Rules:
 *  - Participant ID is required for new accounts
 *  - One email → exactly one Participant ID (cannot create additional IDs)
 *  - One Participant ID → exactly one email (no reuse)
 *  - If email already bound, return that ID only when it matches (or when no ID sent)
 */
function bindEmailToParticipant(email, participantId) {
  const e = normalizeEmail(email);
  if (!e || !e.includes('@')) {
    return { ok: false, error: 'Valid email is required' };
  }
  const pid = participantId ? sanitizeParticipant(participantId) : null;
  const map = readEmailBindings(); // { email: participantId }
  const existing = map[e];

  // Email already has a permanent Participant ID — cannot create another
  if (existing) {
    if (pid && pid !== existing) {
      return {
        ok: false,
        error: 'This email is already linked to Participant ID "' + existing + '". One email cannot create more Participant IDs.',
        participantId: existing,
      };
    }
    return { ok: true, participantId: existing, alreadyBound: true };
  }

  // New email: Participant ID is compulsory (no auto-assign from email)
  if (!pid) {
    return { ok: false, error: 'Participant ID is required. Choose a unique ID (e.g. P01 or QS-03).' };
  }

  // Participant ID must not already belong to another email
  for (const [otherEmail, otherPid] of Object.entries(map)) {
    if (otherPid === pid && otherEmail !== e) {
      return {
        ok: false,
        error: 'Participant ID "' + pid + '" already exists. Choose a different unique ID.',
        participantId: null,
      };
    }
  }

  map[e] = pid;
  writeEmailBindings(map);
  return { ok: true, participantId: pid, alreadyBound: false };
}

function getParticipantForEmail(email) {
  const map = readEmailBindings();
  return map[normalizeEmail(email)] || null;
}

function getEmailForParticipant(participantId) {
  const pid = sanitizeParticipant(participantId);
  if (!pid) return null;
  const map = readEmailBindings();
  for (const [email, p] of Object.entries(map)) {
    if (p === pid) return email;
  }
  return null;
}

/** Claim participant ID for mode-select when session already has email binding. */
function assertParticipantAvailable(participantId, email) {
  const pid = sanitizeParticipant(participantId);
  if (!pid) return { ok: false, error: 'Participant ID is required' };
  const map = readEmailBindings();
  const e = email ? normalizeEmail(email) : null;
  if (e && map[e] && map[e] !== pid) {
    return {
      ok: false,
      error: 'Your email is locked to Participant ID "' + map[e] + '". You cannot use a different ID.',
      participantId: map[e],
    };
  }
  for (const [otherEmail, otherPid] of Object.entries(map)) {
    if (otherPid === pid && (!e || otherEmail !== e)) {
      return {
        ok: false,
        error: 'Participant ID "' + pid + '" is already registered to another account.',
      };
    }
  }
  // If email known and unbound, bind now
  if (e && !map[e]) {
    map[e] = pid;
    writeEmailBindings(map);
    return { ok: true, participantId: pid, bound: true };
  }
  return { ok: true, participantId: pid };
}

function deleteMeasurementRecords(recordIds) {
  const ids = new Set((recordIds || []).map(String).filter(Boolean));
  if (!ids.size) return { deleted: 0 };
  const rows = readJsonl(FILES.measurements);
  const kept = rows.filter((r) => !ids.has(String(r.recordId)));
  const deleted = rows.length - kept.length;
  if (deleted) rewriteJsonl(FILES.measurements, kept);
  return { deleted, remaining: kept.length };
}

/**
 * Wipe ALL research data (measurements, projects, sessions, events,
 * annotations, drawings, counters, email bindings).
 * Requires RESEARCH_ADMIN_TOKEN on the API route — irreversible.
 */
function clearAllResearchData(opts = {}) {
  ensureDirs();
  const keepDrawings = !!(opts && opts.keepDrawings);
  const cleared = {
    measurements: false,
    projects: false,
    sessions: false,
    elementEvents: false,
    emailBindings: false,
    counters: false,
    referenceQuantities: false,
    annotations: 0,
    drawings: 0,
  };

  // Empty JSONL / JSON files (also mirrored to remote storage via persistWrite)
  try {
    persistWrite(FILES.measurements, '');
    cleared.measurements = true;
  } catch (_) {}
  try {
    persistWrite(FILES.projects, '');
    cleared.projects = true;
  } catch (_) {}
  try {
    persistWrite(FILES.sessions, '');
    cleared.sessions = true;
  } catch (_) {}
  try {
    persistWrite(FILES.elementEvents, '');
    cleared.elementEvents = true;
  } catch (_) {}
  try {
    persistWrite(FILES.emailBindings, JSON.stringify({}, null, 2), 'utf8');
    cleared.emailBindings = true;
  } catch (_) {}
  try {
    persistWrite(FILES.counter, JSON.stringify({
      project: 0,
      drawing: 0,
      record: 0,
      session: 0,
    }, null, 2), 'utf8');
    cleared.counters = true;
  } catch (_) {}
  try {
    persistWrite(FILES.referenceQuantities, JSON.stringify({}, null, 2), 'utf8');
    cleared.referenceQuantities = true;
  } catch (_) {}

  // Annotation JSON files under data/research/annotations/
  try {
    if (fs.existsSync(ANNOTATIONS_DIR)) {
      for (const name of fs.readdirSync(ANNOTATIONS_DIR)) {
        const p = path.join(ANNOTATIONS_DIR, name);
        try {
          if (fs.statSync(p).isFile()) {
            persistDelete(p);
            cleared.annotations += 1;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Drawing files (original + marked) under data/drawings/
  if (!keepDrawings) {
    try {
      if (fs.existsSync(DRAWINGS_DIR)) {
        for (const name of fs.readdirSync(DRAWINGS_DIR)) {
          const p = path.join(DRAWINGS_DIR, name);
          try {
            const st = fs.statSync(p);
            if (st.isFile()) {
              persistDelete(p);
              cleared.drawings += 1;
            } else if (st.isDirectory()) {
              // Recursively delete files inside (so each S3 key is removed),
              // then remove the empty directory locally.
              for (const child of fs.readdirSync(p)) {
                persistDelete(path.join(p, child));
              }
              try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
              cleared.drawings += 1;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  return { success: true, cleared };
}

/**
 * Real-time element lifecycle event (accept / reject / edit / add / delete).
 * Logged as the QS works — does not wait for export.
 */
function logElementEvent(payload) {
  ensureDirs();
  const action = String((payload && payload.action) || '').trim().toLowerCase();
  const allowed = new Set(['accept', 'reject', 'edit', 'add', 'delete', 'detect', 'snapshot']);
  if (!allowed.has(action)) {
    throw new Error('Invalid element event action');
  }
  const participantId = sanitizeParticipant(payload && payload.participantId);
  if (!participantId) throw new Error('participantId is required');
  const el = (payload && payload.element) || {};
  const rec = {
    eventId: crypto.randomBytes(8).toString('hex'),
    ts: nowIso(),
    action,
    participantId,
    projectId: (payload && payload.projectId) || null,
    drawingId: (payload && payload.drawingId) || null,
    sessionId: (payload && payload.sessionId) || null,
    mode: (payload && payload.mode) || null,
    elementId: el.id || el.elementId || null,
    elementType: el.type || null,
    elementLabel: el.label || null,
    source: el.source || null,
    reviewStatus: el.reviewStatus || null,
    accepted: el.accepted,
    geometry: {
      x: el.x, y: el.y, w: el.w, h: el.h,
      p1: el.p1 || null, p2: el.p2 || null,
      vertices: Array.isArray(el.vertices) ? el.vertices.slice(0, 64) : null,
      isLine: !!el.isLine,
    },
    notes: (payload && payload.notes) || null,
  };
  appendJsonl(FILES.elementEvents, rec);
  return rec;
}

function logElementEventBatch(events, common) {
  const list = Array.isArray(events) ? events : [];
  const out = [];
  for (const ev of list.slice(0, 200)) {
    out.push(logElementEvent(Object.assign({}, common || {}, ev, {
      element: ev.element || ev,
      action: ev.action,
    })));
  }
  return out;
}

function listElementEvents(filters = {}) {
  let rows = readJsonl(FILES.elementEvents);
  if (filters.participantId) {
    const pid = String(filters.participantId);
    rows = rows.filter((r) => r.participantId === pid);
  }
  if (filters.drawingId) {
    const d = String(filters.drawingId);
    rows = rows.filter((r) => r.drawingId === d);
  }
  if (filters.action) {
    const a = String(filters.action).toLowerCase();
    rows = rows.filter((r) => String(r.action).toLowerCase() === a);
  }
  if (filters.limit) rows = rows.slice(-Math.max(1, Number(filters.limit) || 500));
  return rows;
}

/**
 * Training export: human Pro corrections + final accepted vs AI.
 * Does not train the model itself — exports labeled rows for offline training.
 */
function sanitizeAnnotationPart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

/** Store complete QS-reviewed element geometry for offline training/evaluation. */
function saveReviewedAnnotations({ drawingId, projectId, participantId, mode, imageWidth, imageHeight, metersPerPixel, legendNotes, elements, aiElements, source }) {
  ensureDirs();
  const did = String(drawingId || '').trim();
  if (!did) throw new Error('drawingId is required');
  if (!Array.isArray(elements)) throw new Error('elements must be an array');
  const normalizeElements = (items, defaultSource, defaultStatus) => (Array.isArray(items) ? items : []).slice(0, 5000).map((e, index) => ({
    annotationId: String(e.annotationId || (did + '-' + index + '-' + Date.now())),
    type: String(e.type || 'unknown').toLowerCase().slice(0, 40),
    label: String(e.label || '').slice(0, 200),
    x: Number.isFinite(Number(e.x)) ? Number(e.x) : null,
    y: Number.isFinite(Number(e.y)) ? Number(e.y) : null,
    w: Number.isFinite(Number(e.w)) ? Number(e.w) : null,
    h: Number.isFinite(Number(e.h)) ? Number(e.h) : null,
    isLine: !!e.isLine,
    p1: e.p1 && Number.isFinite(Number(e.p1.x)) && Number.isFinite(Number(e.p1.y)) ? { x: Number(e.p1.x), y: Number(e.p1.y) } : null,
    p2: e.p2 && Number.isFinite(Number(e.p2.x)) && Number.isFinite(Number(e.p2.y)) ? { x: Number(e.p2.x), y: Number(e.p2.y) } : null,
    vertices: Array.isArray(e.vertices) ? e.vertices.slice(0, 100).map(v => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 })) : null,
    thickness: Number.isFinite(Number(e.thickness)) ? Number(e.thickness) : null,
    height: Number.isFinite(Number(e.height)) ? Number(e.height) : null,
    source: String(e.source || defaultSource).slice(0, 30),
    reviewStatus: String(e.reviewStatus || defaultStatus).slice(0, 30),
    accepted: e.accepted !== false,
  }));
  const normalized = normalizeElements(elements, 'MANUAL', 'QS_REVIEWED');
  const normalizedAi = normalizeElements(aiElements, 'AI', 'AI_GENERATED');
  const record = {
    schemaVersion: 2,
    drawingId: did,
    projectId: projectId ? String(projectId).slice(0, 100) : null,
    participantId: sanitizeParticipant(participantId),
    mode: mode === 'Pro' || mode === 'pro' ? 'Pro' : 'Simple',
    imageWidth: Number(imageWidth) || null,
    imageHeight: Number(imageHeight) || null,
    metersPerPixel: Number.isFinite(Number(metersPerPixel)) ? Number(metersPerPixel) : null,
    legendNotes: String(legendNotes || '').slice(0, 4000),
    source: String(source || 'qs_review').slice(0, 50),
    reviewedAt: nowIso(),
    elements: normalized,
    aiElements: normalizedAi,
  };
  const file = path.join(ANNOTATIONS_DIR, sanitizeAnnotationPart(did) + '__' + sanitizeAnnotationPart(projectId || mode || 'latest') + '.json');
  persistWrite(file, JSON.stringify(record, null, 2), 'utf8');
  return { ...record, storedPath: path.relative(DATA_ROOT, file) };
}

function listReviewedAnnotations(filters = {}) {
  ensureDirs();
  return fs.readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(ANNOTATIONS_DIR, f), 'utf8')); } catch (_) { return null; }
  }).filter(Boolean).filter(row => {
    if (filters.drawingId && row.drawingId !== String(filters.drawingId)) return false;
    if (filters.participantId && row.participantId !== String(filters.participantId)) return false;
    if (filters.mode && String(row.mode).toLowerCase() !== String(filters.mode).toLowerCase()) return false;
    return true;
  });
}

function buildAnnotationDataset(filters = {}) {
  const annotations = listReviewedAnnotations(filters);
  const projects = listProjects({}).filter(p => !p.superseded);
  const byDrawing = {};
  projects.forEach(p => { if (p.drawingId && !byDrawing[p.drawingId]) byDrawing[p.drawingId] = p; });
  return {
    schemaVersion: 1,
    format: 'measurecraft-reviewed-annotations',
    generatedAt: nowIso(),
    purpose: 'QS-reviewed drawing annotations for offline evaluation or dedicated detector training. This does not fine-tune Gemini automatically.',
    drawings: annotations.map(a => ({
      ...a,
      original: byDrawing[a.drawingId] ? { fileName: byDrawing[a.drawingId].fileName, storedPath: byDrawing[a.drawingId].storedPath, sha256: byDrawing[a.drawingId].sha256 } : null,
    })),
  };
}

function buildTrainingDataset(filters = {}) {
  const measurements = listMeasurements(Object.assign({}, filters, { limit: 50000 }))
    .filter((m) => !m.superseded);
  // Prefer rows where a human corrected AI, or Pro manual measurements exist
  const useful = measurements.filter((m) => {
    if (m.userCorrection) return true;
    if (m.measurementMode === 'Pro' && m.userMeasurement != null) return true;
    if (m.aiMeasurement != null && m.finalAcceptedMeasurement != null
      && Number(m.aiMeasurement) !== Number(m.finalAcceptedMeasurement)) return true;
    return false;
  });
  const projects = listProjects({}).filter((p) => !p.superseded);
  const byDwg = {};
  projects.forEach((p) => { byDwg[p.drawingId] = p; });
  const drawings = [];
  const seen = new Set();
  useful.forEach((m) => {
    if (!m.drawingId || seen.has(m.drawingId)) return;
    seen.add(m.drawingId);
    const p = byDwg[m.drawingId];
    drawings.push({
      drawingId: m.drawingId,
      projectId: m.projectId,
      participantId: m.participantId,
      fileName: p && p.fileName,
      storedPath: p && p.storedPath,
      hasFile: !!(p && p.storedPath),
    });
  });
  return {
    generatedAt: nowIso(),
    purpose: 'Offline AI training / evaluation from human QS corrections. Not used for automatic fine-tuning inside MeasureCraft.',
    note: 'Review each drawing file under data/drawings/ before including in a training set. Human Pro measurements and userCorrection flags are the ground truth.',
    sampleCount: useful.length,
    drawingCount: drawings.length,
    samples: useful.map((m) => ({
      recordId: m.recordId,
      participantId: m.participantId,
      drawingId: m.drawingId,
      projectId: m.projectId,
      measurementMode: m.measurementMode,
      measurementType: m.measurementType,
      unit: m.unit,
      aiMeasurement: m.aiMeasurement,
      humanMeasurement: m.userMeasurement,
      finalAccepted: m.finalAcceptedMeasurement,
      userCorrection: !!m.userCorrection,
      differencePct: m.differencePct,
      elementLabel: m.elementLabel,
      reviewStatus: m.reviewStatus,
      notes: m.notes,
    })),
    drawings,
    reviewedAnnotations: buildAnnotationDataset(filters).drawings,
    annotationCount: buildAnnotationDataset(filters).drawings.reduce((n, d) => n + (d.elements || []).length, 0),
  };
}

function listStoredDrawings() {
  ensureDirs();
  const projects = listProjects({}).filter((p) => !p.superseded);
  // One row per Drawing ID (Simple + Pro revisions share DWG-xxxx)
  const byDwg = new Map();
  projects.forEach((p) => {
    const id = p.drawingId || p.projectId;
    if (!id) return;
    const markedAbs = p.markedStoredPath ? path.join(DATA_ROOT, p.markedStoredPath) : null;
    const hasMarked = !!(markedAbs && fs.existsSync(markedAbs));
    const mode = p.mode || '—';
    const existing = byDwg.get(id);
    if (!existing) {
      byDwg.set(id, {
        drawingId: p.drawingId,
        projectId: p.projectId,
        projectIds: [p.projectId].filter(Boolean),
        modes: [mode],
        mode: mode,
        participantId: p.participantId,
        fileName: p.fileName,
        storedPath: p.storedPath,
        markedStoredPath: hasMarked ? p.markedStoredPath : null,
        markedAt: hasMarked ? p.markedAt : null,
        hasMarked,
        uploadedAt: p.uploadedAt,
        byteSize: p.byteSize,
        markedByteSize: hasMarked ? p.markedByteSize : null,
        sha256: p.sha256,
        revision: p.revision || 'ORIGINAL',
        parentProjectId: p.parentProjectId || null,
        reviewLabel: p.drawingId + (p.fileName ? ' · ' + p.fileName : ''),
      });
      return;
    }
    if (p.projectId && existing.projectIds.indexOf(p.projectId) < 0) {
      existing.projectIds.push(p.projectId);
    }
    if (mode && existing.modes.indexOf(mode) < 0) existing.modes.push(mode);
    existing.mode = existing.modes.join(' + ');
    if (p.uploadedAt && (!existing.uploadedAt || String(p.uploadedAt) > String(existing.uploadedAt))) {
      existing.uploadedAt = p.uploadedAt;
    }
    if (p.storedPath && !existing.storedPath) existing.storedPath = p.storedPath;
    if (p.byteSize && (!existing.byteSize || p.byteSize > existing.byteSize)) existing.byteSize = p.byteSize;
    if (hasMarked) {
      existing.hasMarked = true;
      existing.markedStoredPath = p.markedStoredPath;
      existing.markedAt = p.markedAt;
      existing.markedByteSize = p.markedByteSize;
    }
    // Prefer latest project id for display (Pro revision often newer)
    if (p.projectId && String(p.projectId).indexOf('/') >= 0) {
      existing.projectId = p.projectId;
      existing.revision = p.revision || existing.revision;
      existing.parentProjectId = p.parentProjectId || existing.parentProjectId;
    }
  });
  return Array.from(byDwg.values()).sort((a, b) =>
    String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''))
  );
}

function rewriteJsonl(file, rows) {
  ensureDirs();
  persistWrite(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function dateTimeParts(iso) {
  const d = iso ? new Date(iso) : new Date();
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  return { date, time };
}

/**
 * Optional Google Sheets append via Apps Script web app.
 * The script should accept POST JSON and append a row.
 * Set GOOGLE_SHEETS_WEBHOOK_URL and optional GOOGLE_SHEETS_WEBHOOK_SECRET.
 */
async function pushToGoogleSheets(row) {
  const url = (process.env.GOOGLE_SHEETS_WEBHOOK_URL || '').trim();
  if (!url) return { ok: false, skipped: true, reason: 'GOOGLE_SHEETS_WEBHOOK_URL not set' };
  const secret = (process.env.GOOGLE_SHEETS_WEBHOOK_SECRET || '').trim();
  try {
    const body = secret ? { secret, row } : { row };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    if (!resp.ok) {
      console.warn('[research] Google Sheets webhook failed', resp.status, text.slice(0, 200));
      return { ok: false, status: resp.status, body: text.slice(0, 300) };
    }
    return { ok: true, body: text.slice(0, 300) };
  } catch (err) {
    console.warn('[research] Google Sheets webhook error', err.message);
    return { ok: false, error: err.message };
  }
}

function startSession({ participantId, mode, userAgent }) {
  ensureDirs();
  const sessionId = nextId('session');
  const startedAt = nowIso();
  const rec = {
    sessionId,
    participantId: sanitizeParticipant(participantId),
    mode: mode === 'pro' ? 'Pro' : 'Simple',
    startedAt,
    endedAt: null,
    userAgent: String(userAgent || '').slice(0, 240),
    projectId: null,
    drawingId: null,
  };
  appendJsonl(FILES.sessions, rec);
  return rec;
}

function endSession(sessionId, extras = {}) {
  const sessions = readJsonl(FILES.sessions);
  const idx = sessions.findIndex((s) => s.sessionId === sessionId);
  if (idx < 0) return null;
  const endedAt = nowIso();
  const start = new Date(sessions[idx].startedAt).getTime();
  const durationSec = Math.max(0, Math.round((Date.now() - start) / 1000));
  sessions[idx] = {
    ...sessions[idx],
    ...extras,
    endedAt,
    durationSec,
  };
  // Rewrite sessions file (small research volume)
  persistWrite(FILES.sessions, sessions.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  return sessions[idx];
}

/**
 * Register an uploaded drawing. Stores original file bytes unchanged.
 * Same participant + same image hash → reuse drawingId (latest upload wins; no duplicate research rows).
 */
function registerProject({
  participantId,
  mode,
  sessionId,
  fileName,
  mimeType,
  imageBase64,
  projectName,
  scaleNote,
  meta,
}) {
  ensureDirs();
  const pid = sanitizeParticipant(participantId);
  const uploadedAt = nowIso();
  let storedPath = null;
  let byteSize = 0;
  let sha256 = null;
  let buf = null;

  if (imageBase64 && typeof imageBase64 === 'string') {
    const raw = imageBase64.replace(/^data:[^;]+;base64,/, '');
    buf = Buffer.from(raw, 'base64');
    byteSize = buf.length;
    sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  }

  const wantMode = mode === 'pro' || mode === 'Pro' ? 'Pro' : 'Simple';

  // Reuse ORIGINAL project only for same participant + hash + mode.
  // Never overwrite Simple ORIGINAL into Pro (use createProRevision for PROJ-xxxx/A).
  if (sha256) {
    const projects = readJsonl(FILES.projects);
    const priorSameMode = projects
      .filter((p) =>
        p.participantId === pid &&
        p.sha256 === sha256 &&
        !p.superseded &&
        (p.revision === 'ORIGINAL' || !p.revision) &&
        String(p.mode || '') === wantMode
      )
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    if (priorSameMode.length) {
      const keep = priorSameMode[0];
      const updated = projects.map((p) => {
        if (p.projectId !== keep.projectId) return p;
        return {
          ...p,
          uploadedAt,
          sessionId: sessionId || p.sessionId,
          mode: wantMode,
          revision: p.revision || 'ORIGINAL',
          parentProjectId: p.parentProjectId || null,
          projectName: String(projectName || fileName || p.projectName || 'Untitled').slice(0, 200),
          fileName: String(fileName || p.fileName || '').slice(0, 240),
          scaleNote: scaleNote != null ? scaleNote : p.scaleNote,
          meta: { ...(p.meta || {}), ...(meta || {}), reuploaded: true },
          latestUploadAt: uploadedAt,
        };
      });
      rewriteJsonl(FILES.projects, updated);
      return { ...(updated.find((p) => p.projectId === keep.projectId) || keep), reused: true };
    }
    // Same drawing bytes, different mode: keep Drawing ID, new ORIGINAL Project ID for this mode
    const priorAny = projects
      .filter((p) => p.participantId === pid && p.sha256 === sha256 && !p.superseded)
      .sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
    if (priorAny.length) {
      const keepDwg = priorAny[0];
      const projectId = nextId('project');
      const project = {
        projectId,
        drawingId: keepDwg.drawingId,
        participantId: pid,
        mode: wantMode,
        revision: 'ORIGINAL',
        parentProjectId: null,
        sessionId: sessionId || null,
        projectName: String(projectName || fileName || 'Untitled').slice(0, 200),
        fileName: String(fileName || keepDwg.fileName || '').slice(0, 240),
        mimeType: String(mimeType || keepDwg.mimeType || 'image/jpeg').slice(0, 80),
        uploadedAt,
        scaleNote: scaleNote || keepDwg.scaleNote || null,
        storedPath: keepDwg.storedPath || null,
        byteSize: keepDwg.byteSize || byteSize,
        sha256: keepDwg.sha256 || sha256,
        originalUnchanged: true,
        forAiTraining: false,
        superseded: false,
        meta: { ...(meta || {}), sharedDrawingId: true },
      };
      appendJsonl(FILES.projects, project);
      return project;
    }
  }

  const projectId = nextId('project');
  const drawingId = nextId('drawing');

  if (buf) {
    const ext = (mimeType || '').includes('png') ? 'png'
      : (mimeType || '').includes('webp') ? 'webp'
      : (mimeType || '').includes('pdf') ? 'pdf'
      : 'jpg';
    const fname = `${drawingId}.${ext}`;
    storedPath = path.join(DRAWINGS_DIR, fname);
    persistWrite(storedPath, buf);
    // NOTE: stays absolute here on purpose — it's converted to a
    // DATA_ROOT-relative path below when the project object is built.
  }

  const project = {
    projectId,
    drawingId,
    participantId: pid,
    mode: wantMode,
    revision: 'ORIGINAL',
    parentProjectId: null,
    sessionId: sessionId || null,
    projectName: String(projectName || fileName || 'Untitled').slice(0, 200),
    fileName: String(fileName || '').slice(0, 240),
    mimeType: String(mimeType || 'image/jpeg').slice(0, 80),
    uploadedAt,
    scaleNote: scaleNote || null,
    storedPath: storedPath ? path.relative(DATA_ROOT, storedPath) : null,
    byteSize,
    sha256,
    originalUnchanged: true,
    forAiTraining: false,
    superseded: false,
    meta: meta || {},
  };
  appendJsonl(FILES.projects, project);
  return project;
}

/**
 * Create Pro Mode child version from an exported Simple Mode project.
 * Drawing ID unchanged. Project ID becomes PROJ-0001/A (then /B, /C…).
 * Parent Simple record is never modified or superseded.
 */
function createProRevision({ parentProjectId, participantId, sessionId, projectName, meta }) {
  ensureDirs();
  const parentId = String(parentProjectId || '').trim();
  if (!parentId) throw new Error('parentProjectId is required');
  const projects = readJsonl(FILES.projects);
  const parent = projects.find((p) => p.projectId === parentId && !p.superseded)
    || projects.find((p) => p.projectId === parentId);
  if (!parent) throw new Error('Parent project not found: ' + parentId);

  // Base id without /A /B suffix
  const baseId = parentId.split('/')[0];
  const existingChildren = projects.filter((p) =>
    String(p.parentProjectId || '') === baseId ||
    String(p.parentProjectId || '') === parentId ||
    (String(p.projectId || '').startsWith(baseId + '/') && p.projectId !== parentId)
  );
  const usedLetters = new Set();
  existingChildren.forEach((p) => {
    const parts = String(p.projectId || '').split('/');
    if (parts.length >= 2) usedLetters.add(parts[1].toUpperCase());
    if (p.revision && p.revision !== 'ORIGINAL') usedLetters.add(String(p.revision).toUpperCase());
  });
  let letter = 'A';
  for (let i = 0; i < 26; i++) {
    const L = String.fromCharCode(65 + i);
    if (!usedLetters.has(L)) { letter = L; break; }
  }
  const childId = baseId + '/' + letter;
  const pid = sanitizeParticipant(participantId || parent.participantId);
  const project = {
    projectId: childId,
    drawingId: parent.drawingId,
    participantId: pid,
    mode: 'Pro',
    revision: letter,
    parentProjectId: baseId,
    sessionId: sessionId || null,
    projectName: String(projectName || parent.projectName || 'Pro revision').slice(0, 200),
    fileName: parent.fileName || '',
    mimeType: parent.mimeType || 'image/jpeg',
    uploadedAt: nowIso(),
    scaleNote: parent.scaleNote || null,
    storedPath: parent.storedPath || null,
    byteSize: parent.byteSize || 0,
    sha256: parent.sha256 || null,
    originalUnchanged: false,
    forAiTraining: false,
    superseded: false,
    meta: Object.assign({}, parent.meta || {}, meta || {}, {
      fromSimpleExport: true,
      parentProjectId: baseId,
      revision: letter,
    }),
  };
  appendJsonl(FILES.projects, project);
  return project;
}

/**
 * Mark previous measurements for same participant + drawing + mode + type as superseded
 * so re-exports only keep the latest set.
 * When drawingId is missing, fall back to sessionId so live-sync without a registered
 * drawing does not accumulate unbounded duplicate zero rows.
 */
function supersedePriorMeasurements({ participantId, drawingId, sessionId, measurementMode, measurementType }) {
  if (!participantId) return;
  if (!drawingId && !sessionId) return;
  const pid = sanitizeParticipant(participantId);
  const mode = measurementMode === 'Pro' ? 'Pro' : 'Simple';
  const rows = readJsonl(FILES.measurements);
  let changed = false;
  const updated = rows.map((r) => {
    if (r.participantId !== pid || r.measurementMode !== mode || r.superseded) return r;
    if (measurementType && r.measurementType !== measurementType) return r;
    const matchDrawing = drawingId && r.drawingId === drawingId;
    const matchSession = !drawingId && sessionId && r.sessionId === sessionId;
    if (matchDrawing || matchSession) {
      changed = true;
      return { ...r, superseded: true, supersededAt: nowIso() };
    }
    return r;
  });
  if (changed) rewriteJsonl(FILES.measurements, updated);
}

/**
 * Log a measurement comparison row.
 * Supports reference / AI / simple / pro / final accepted values.
 */
function logMeasurement(payload) {
  ensureDirs();
  // Manual dashboard rows must not wipe other types; live exports still supersede.
  const method = String(payload.measurementMethod || '').toLowerCase();
  const skipSupersede = !!payload._skipSupersede ||
    method === 'manual_dashboard_entry' ||
    method === 'manual';
  // Latest export wins for this participant + drawing + mode + type
  if (!skipSupersede) {
    supersedePriorMeasurements({
      participantId: payload.participantId,
      drawingId: payload.drawingId,
      sessionId: payload.sessionId,
      measurementMode: payload.measurementMode === 'Pro' || payload.mode === 'pro' ? 'Pro' : 'Simple',
      measurementType: payload.measurementType || payload.elementType,
    });
  }
  const recordId = nextId('record');
  const createdAt = nowIso();
  const { date, time } = dateTimeParts(createdAt);

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const ai = num(payload.aiMeasurement);
  const user = num(payload.userMeasurement);
  const finalV = num(payload.finalAcceptedMeasurement != null ? payload.finalAcceptedMeasurement : payload.userMeasurement);
  // Prefer explicit payload value; otherwise fall back to researcher ground-truth table
  const reference = resolveReferenceMeasurement(payload);
  const unit = String(payload.unit || '').slice(0, 24) || null;

  let difference = null;
  let differencePct = null;
  // Prefer final vs reference when both present; else final vs AI
  const baseline = reference != null ? reference : ai;
  if (finalV != null && baseline != null) {
    difference = Math.round((finalV - baseline) * 10000) / 10000;
    if (Math.abs(baseline) > 1e-9) {
      differencePct = Math.round((Math.abs(difference) / Math.abs(baseline)) * 10000) / 100;
    }
  }

  const record = {
    recordId,
    participantId: sanitizeParticipant(payload.participantId),
    projectId: payload.projectId || null,
    drawingId: payload.drawingId || null,
    sessionId: payload.sessionId || null,
    date,
    time,
    createdAt,
    measurementMode: payload.measurementMode === 'Pro' || payload.mode === 'pro' ? 'Pro' : 'Simple',
    measurementType: String(payload.measurementType || payload.elementType || 'unknown').slice(0, 80),
    measurementMethod: String(payload.measurementMethod || 'manual').slice(0, 80),
    // Comparison fields
    referenceMeasurement: reference,
    aiMeasurement: ai,
    simpleModeMeasurement: payload.measurementMode === 'Simple' || payload.mode === 'simple' ? user : num(payload.simpleModeMeasurement),
    proModeMeasurement: payload.measurementMode === 'Pro' || payload.mode === 'pro' ? user : num(payload.proModeMeasurement),
    userMeasurement: user,
    finalAcceptedMeasurement: finalV,
    unit,
    difference,
    differencePct,
    userCorrection: !!(payload.userCorrection || (ai != null && finalV != null && Math.abs(ai - finalV) > 1e-6)),
    measurementDurationSec: payload.measurementDurationSec != null ? Number(payload.measurementDurationSec) : null,
    notes: String(payload.notes || '').slice(0, 1000),
    // Extra professional fields (optional)
    professionalExtras: payload.professionalExtras || null,
    elementLabel: payload.elementLabel ? String(payload.elementLabel).slice(0, 120) : null,
    confidence: payload.confidence != null ? Number(payload.confidence) : null,
    reviewStatus: payload.reviewStatus || null,
    // Research control
    selectedForAiTraining: false,
    reviewedByResearcher: false,
    superseded: false,
  };

  appendJsonl(FILES.measurements, record);

  // Fire-and-forget sheet sync
  const sheetRow = {
    recordId: record.recordId,
    participantId: record.participantId,
    projectId: record.projectId,
    drawingId: record.drawingId,
    date: record.date,
    time: record.time,
    measurementMode: record.measurementMode,
    measurementType: record.measurementType,
    measurementMethod: record.measurementMethod,
    referenceMeasurement: record.referenceMeasurement,
    aiMeasurement: record.aiMeasurement,
    userMeasurement: record.userMeasurement,
    simpleModeMeasurement: record.simpleModeMeasurement,
    proModeMeasurement: record.proModeMeasurement,
    finalAcceptedMeasurement: record.finalAcceptedMeasurement,
    unit: record.unit,
    difference: record.difference,
    differencePct: record.differencePct,
    userCorrection: record.userCorrection ? 'Yes' : 'No',
    measurementDurationSec: record.measurementDurationSec,
    notes: record.notes,
    elementLabel: record.elementLabel,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus,
  };
  pushToGoogleSheets(sheetRow).catch(() => {});

  return record;
}

/**
 * Bulk log from a BOQ / element list (one session export).
 */
function logMeasurementBatch(items, common) {
  const results = [];
  // Supersede all prior rows for this drawing+mode (or session+mode) once, then write new batch
  if (common && common.participantId && (common.drawingId || common.sessionId)) {
    supersedePriorMeasurements({
      participantId: common.participantId,
      drawingId: common.drawingId,
      sessionId: common.sessionId,
      measurementMode: common.measurementMode === 'Pro' || common.mode === 'pro' ? 'Pro' : 'Simple',
      measurementType: null, // all types for this drawing+mode
    });
  }
  for (const item of items || []) {
    // Avoid double-supersede inside logMeasurement for batch
    const payload = { ...common, ...item, _skipSupersede: true };
    results.push(logMeasurement(payload));
  }
  return results;
}

/**
 * Update an existing measurement record in place (edit from research dashboard).
 * Does not supersede other rows. Recalculates difference / differencePct.
 */
function updateMeasurement(recordId, patch) {
  ensureDirs();
  const id = String(recordId || '').trim();
  if (!id) throw new Error('recordId is required');
  const rows = readJsonl(FILES.measurements);
  const idx = rows.findIndex((r) => String(r.recordId) === id);
  if (idx < 0) throw new Error('Record not found: ' + id);

  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const prev = rows[idx];
  const next = { ...prev };

  if (patch.participantId != null) next.participantId = sanitizeParticipant(patch.participantId);
  if (patch.projectId !== undefined) next.projectId = patch.projectId || null;
  if (patch.drawingId !== undefined) next.drawingId = patch.drawingId || null;
  if (patch.measurementMode != null || patch.mode != null) {
    next.measurementMode =
      patch.measurementMode === 'Pro' || patch.mode === 'pro' || String(patch.measurementMode).toLowerCase() === 'pro'
        ? 'Pro'
        : 'Simple';
  }
  if (patch.measurementType != null) {
    next.measurementType = String(patch.measurementType || 'unknown').slice(0, 80);
  }
  if (patch.measurementMethod != null) {
    next.measurementMethod = String(patch.measurementMethod).slice(0, 80);
  }
  if (patch.unit !== undefined) next.unit = patch.unit ? String(patch.unit).slice(0, 24) : null;
  if (patch.notes !== undefined) next.notes = patch.notes != null ? String(patch.notes).slice(0, 500) : null;
  if (patch.elementLabel !== undefined) next.elementLabel = patch.elementLabel || null;

  if (patch.aiMeasurement !== undefined) next.aiMeasurement = num(patch.aiMeasurement);
  if (patch.userMeasurement !== undefined) next.userMeasurement = num(patch.userMeasurement);
  if (patch.finalAcceptedMeasurement !== undefined) {
    next.finalAcceptedMeasurement = num(patch.finalAcceptedMeasurement);
  } else if (patch.userMeasurement !== undefined && next.finalAcceptedMeasurement == null) {
    next.finalAcceptedMeasurement = num(patch.userMeasurement);
  }
  if (patch.referenceMeasurement !== undefined) {
    next.referenceMeasurement = num(patch.referenceMeasurement);
  }
  if (patch.userCorrection !== undefined) {
    next.userCorrection = !!(patch.userCorrection === true || patch.userCorrection === 'true' || patch.userCorrection === 'Yes');
  }
  if (patch.measurementDurationSec !== undefined) {
    next.measurementDurationSec = num(patch.measurementDurationSec);
  }

  // Keep mode-specific mirrors in sync
  if (next.measurementMode === 'Pro') {
    next.proModeMeasurement = next.userMeasurement != null ? next.userMeasurement : next.finalAcceptedMeasurement;
  } else {
    next.simpleModeMeasurement = next.userMeasurement != null ? next.userMeasurement : next.finalAcceptedMeasurement;
  }

  const finalV = num(next.finalAcceptedMeasurement != null ? next.finalAcceptedMeasurement : next.userMeasurement);
  const reference = num(next.referenceMeasurement);
  const ai = num(next.aiMeasurement);
  const baseline = reference != null ? reference : ai;
  if (finalV != null && baseline != null) {
    const difference = Math.round((finalV - baseline) * 10000) / 10000;
    next.difference = difference;
    next.differencePct = Math.abs(baseline) > 1e-9
      ? Math.round((Math.abs(difference) / Math.abs(baseline)) * 10000) / 100
      : null;
  } else {
    next.difference = null;
    next.differencePct = null;
  }
  if (patch.userCorrection === undefined && ai != null && finalV != null) {
    next.userCorrection = Math.abs(ai - finalV) > 1e-6;
  }

  next.updatedAt = nowIso();
  rows[idx] = next;
  rewriteJsonl(FILES.measurements, rows);
  return enrichMeasurementRecord(next);
}

function enrichMeasurementRecord(row) {
  const out = { ...row };
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const finalV = num(out.finalAcceptedMeasurement != null ? out.finalAcceptedMeasurement : out.userMeasurement);
  const reference = num(out.referenceMeasurement);
  const ai = num(out.aiMeasurement);
  const baseline = reference != null ? reference : ai;
  if (out.finalAcceptedMeasurement == null && finalV != null) out.finalAcceptedMeasurement = finalV;
  if (out.userMeasurement == null && finalV != null) out.userMeasurement = finalV;
  if (out.difference == null && finalV != null && baseline != null) {
    const difference = Math.round((finalV - baseline) * 10000) / 10000;
    out.difference = difference;
    if (Math.abs(baseline) > 1e-9) {
      out.differencePct = Math.round((Math.abs(difference) / Math.abs(baseline)) * 10000) / 100;
    }
  } else if (out.differencePct == null && out.difference != null && baseline != null && Math.abs(baseline) > 1e-9) {
    out.differencePct = Math.round((Math.abs(Number(out.difference)) / Math.abs(baseline)) * 10000) / 100;
  }
  if (out.userCorrection == null) {
    out.userCorrection = !!(ai != null && finalV != null && Math.abs(ai - finalV) > 1e-6);
  }
  if (!String(out.notes || '').trim()) {
    out.notes = 'Recorded ' + String(out.measurementMethod || 'measurement') + ' · ' + String(out.measurementType || 'quantity');
  }
  return out;
}

function listMeasurements(filters = {}) {
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  let rows = readJsonl(FILES.measurements).map(enrichMeasurementRecord);
  // Default: only latest (non-superseded) rows
  if (filters.includeSuperseded !== true && filters.includeSuperseded !== 'true') {
    rows = rows.filter((r) => !r.superseded);
  }
  // Default: drop empty noise (zero final/user with no AI/reference) so dashboard
  // counts are not inflated by live aggregate rollups with no geometry yet.
  if (filters.includeEmpty !== true && filters.includeEmpty !== 'true') {
    rows = rows.filter((r) => {
      const finalV = num(r.finalAcceptedMeasurement != null ? r.finalAcceptedMeasurement : r.userMeasurement);
      const ai = num(r.aiMeasurement);
      const ref = num(r.referenceMeasurement);
      if (ai != null || ref != null) return true;
      if (finalV != null && Math.abs(finalV) > 1e-9) return true;
      return false;
    });
  }
  if (filters.participantId) {
    const p = sanitizeParticipant(filters.participantId);
    rows = rows.filter((r) => r.participantId === p);
  }
  if (filters.mode) {
    const m = String(filters.mode).toLowerCase() === 'pro' ? 'Pro' : 'Simple';
    rows = rows.filter((r) => r.measurementMode === m);
  }
  if (filters.drawingId) rows = rows.filter((r) => r.drawingId === filters.drawingId);
  if (filters.projectId) rows = rows.filter((r) => r.projectId === filters.projectId);
  if (filters.measurementType) {
    const t = String(filters.measurementType).toLowerCase();
    rows = rows.filter((r) => String(r.measurementType).toLowerCase() === t);
  }
  if (filters.userCorrection === true || filters.userCorrection === 'true') {
    rows = rows.filter((r) => r.userCorrection);
  }
  // newest first
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const limit = Math.min(Number(filters.limit) || 500, 5000);
  return rows.slice(0, limit);
}

function listProjects(filters = {}) {
  let rows = readJsonl(FILES.projects);
  if (filters.includeSuperseded !== true && filters.includeSuperseded !== 'true') {
    rows = rows.filter((r) => !r.superseded);
  }
  if (filters.participantId) {
    const p = sanitizeParticipant(filters.participantId);
    rows = rows.filter((r) => r.participantId === p);
  }
  rows.sort((a, b) => String(b.uploadedAt || b.latestUploadAt || '').localeCompare(String(a.uploadedAt || a.latestUploadAt || '')));
  return rows.slice(0, Math.min(Number(filters.limit) || 500, 2000));
}

function listSessions(filters = {}) {
  let rows = readJsonl(FILES.sessions);
  if (filters.participantId) {
    const p = sanitizeParticipant(filters.participantId);
    rows = rows.filter((r) => r.participantId === p);
  }
  rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return rows.slice(0, Math.min(Number(filters.limit) || 500, 2000));
}

function detectionAccuracy(filters = {}) {
  const types = ['wall', 'door', 'window', 'column', 'beam', 'slab'];
  const threshold = Math.max(0.1, Math.min(0.95, Number(filters.iouThreshold) || 0.5));
  const rows = listReviewedAnnotations(filters).filter((row) => Array.isArray(row.aiElements) && row.aiElements.length);
  const byType = Object.fromEntries(types.map((type) => [type, { type, drawings: 0, aiMarked: 0, confirmed: 0, truePositive: 0, falsePositive: 0, falseNegative: 0, precision: null, recall: null, quantityErrorPct: null }]));
  const iou = (a, b) => {
    const ax = Number(a.x) || 0, ay = Number(a.y) || 0, aw = Math.max(0, Number(a.w) || 0), ah = Math.max(0, Number(a.h) || 0);
    const bx = Number(b.x) || 0, by = Number(b.y) || 0, bw = Math.max(0, Number(b.w) || 0), bh = Math.max(0, Number(b.h) || 0);
    const inter = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx)) * Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by));
    const union = aw * ah + bw * bh - inter;
    return union > 0 ? inter / union : 0;
  };
  rows.forEach((row) => {
    const human = Array.isArray(row.elements) ? row.elements : [];
    const ai = Array.isArray(row.aiElements) ? row.aiElements : [];
    types.forEach((type) => {
      const truth = human.filter((e) => e.type === type);
      const proposals = ai.filter((e) => e.type === type);
      const used = new Set(); let tp = 0;
      proposals.forEach((proposal) => {
        let best = -1, bestScore = 0;
        truth.forEach((target, index) => { if (!used.has(index)) { const score = iou(proposal, target); if (score > bestScore) { bestScore = score; best = index; } } });
        if (best >= 0 && bestScore >= threshold) { used.add(best); tp++; }
      });
      const stat = byType[type]; stat.drawings++; stat.aiMarked += proposals.length; stat.confirmed += truth.length; stat.truePositive += tp; stat.falsePositive += proposals.length - tp; stat.falseNegative += truth.length - tp;
    });
  });
  const measurements = listMeasurements(filters).filter((m) => m.aiMeasurement != null && m.finalAcceptedMeasurement != null);
  measurements.forEach((m) => { const type = String(m.measurementType || '').toLowerCase(); const stat = byType[type]; if (stat) { stat._q = stat._q || []; if (Number.isFinite(Number(m.differencePct))) stat._q.push(Math.abs(Number(m.differencePct))); } });
  Object.values(byType).forEach((stat) => { stat.precision = stat.aiMarked ? Math.round(stat.truePositive / stat.aiMarked * 10000) / 100 : null; stat.recall = stat.confirmed ? Math.round(stat.truePositive / stat.confirmed * 10000) / 100 : null; if (stat._q && stat._q.length) stat.quantityErrorPct = Math.round(stat._q.reduce((a, b) => a + b, 0) / stat._q.length * 100) / 100; delete stat._q; });
  return { generatedAt: nowIso(), iouThreshold: threshold, annotationDrawings: rows.length, byType: Object.values(byType), note: 'Precision/recall use one-to-one bounding-box matching. Quantity error uses absolute final-versus-reference or final-versus-AI measurement error.' };
}

function _median(nums) {
  if (!nums || !nums.length) return null;
  const a = nums.slice().sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function _mean(nums) {
  if (!nums || !nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function _round2(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Research-grade summary.
 * Primary accuracy uses ONLY rows with a real researcher reference (not AI fallback).
 * Reports median (robust to outliers) so unit-mismatch rows cannot produce 3000% means.
 */
function summaryStats() {
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // Drop superseded and empty noise rows (zero final/user with no AI/reference baseline).
  // Those come from live aggregate rollups (Plastering/Tiling/Painting) when no elements exist.
  const measurements = readJsonl(FILES.measurements)
    .filter((m) => !m.superseded)
    .map(enrichMeasurementRecord)
    .filter((m) => {
      const finalV = num(m.finalAcceptedMeasurement != null ? m.finalAcceptedMeasurement : m.userMeasurement);
      const ai = num(m.aiMeasurement);
      const ref = num(m.referenceMeasurement);
      if (ai != null || ref != null) return true;
      if (finalV != null && Math.abs(finalV) > 1e-9) return true;
      return false;
    });
  const projects = readJsonl(FILES.projects).filter((p) => !p.superseded);
  const sessions = readJsonl(FILES.sessions);
  const participants = new Set(measurements.map((m) => m.participantId).filter(Boolean));
  const corrected = measurements.filter((m) => m.userCorrection).length;

  const vsRefAbs = [];
  const vsAiAbs = [];
  const allAbs = [];

  measurements.forEach((m) => {
    const ref = num(m.referenceMeasurement);
    const ai = num(m.aiMeasurement);
    const finalV = num(m.finalAcceptedMeasurement != null ? m.finalAcceptedMeasurement : m.userMeasurement);
    let pct = num(m.differencePct);
    if (pct == null && finalV != null) {
      const baseline = ref != null ? ref : ai;
      if (baseline != null && Math.abs(baseline) > 1e-9) {
        pct = (Math.abs(finalV - baseline) / Math.abs(baseline)) * 100;
      }
    }
    if (pct == null || !Number.isFinite(pct)) return;
    const absPct = Math.abs(pct);
    allAbs.push(absPct);
    if (ref != null) vsRefAbs.push(absPct);
    else if (ai != null) vsAiAbs.push(absPct);
  });

  const meanAll = _round2(_mean(allAbs));
  const medianAll = _round2(_median(allAbs));
  const meanVsRef = _round2(_mean(vsRefAbs));
  const medianVsRef = _round2(_median(vsRefAbs));
  const meanVsAi = _round2(_mean(vsAiAbs));
  const medianVsAi = _round2(_median(vsAiAbs));

  // Primary card: median vs real reference when available, else median vs AI
  const primaryMedian = medianVsRef != null ? medianVsRef : medianVsAi;
  const primaryMean = meanVsRef != null ? meanVsRef : meanVsAi;

  const uniqueDrawings = new Set(
    projects.map((p) => p.drawingId).filter(Boolean)
  );
  // Also count drawings that appear only in measurements
  measurements.forEach((m) => {
    if (m.drawingId) uniqueDrawings.add(m.drawingId);
  });

  return {
    totalMeasurements: measurements.length,
    totalProjects: projects.length,
    totalDrawings: uniqueDrawings.size,
    totalSessions: sessions.length,
    uniqueParticipants: participants.size,
    correctedCount: corrected,
    correctionRate: measurements.length ? Math.round((corrected / measurements.length) * 1000) / 10 : 0,
    // Compatibility field (dashboard used this name) — now robust median
    meanAbsPctErrorVsReference: primaryMedian,
    medianAbsPctErrorVsReference: medianVsRef,
    meanAbsPctErrorVsReferenceOnly: meanVsRef,
    medianAbsPctErrorVsAi: medianVsAi,
    meanAbsPctErrorVsAi: meanVsAi,
    medianAbsPctErrorAll: medianAll,
    meanAbsPctErrorAll: meanAll,
    primaryMeanAbsPct: primaryMean,
    rowsWithReference: vsRefAbs.length,
    rowsWithAiBaselineOnly: vsAiAbs.length,
    rowsWithError: allAbs.length,
    simpleCount: measurements.filter((m) => m.measurementMode === 'Simple').length,
    proCount: measurements.filter((m) => m.measurementMode === 'Pro').length,
    // Extended research KPIs
    avgMeasurementDurationSec: _round2(_mean(
      measurements.map((m) => num(m.measurementDurationSec)).filter((v) => v != null && v > 0)
    )),
    totalMeasurementDurationSec: measurements.reduce((s, m) => {
      const d = num(m.measurementDurationSec);
      return s + (d != null && d > 0 ? d : 0);
    }, 0),
    aiMeasurementRows: measurements.filter((m) => num(m.aiMeasurement) != null).length,
    referenceRows: measurements.filter((m) => num(m.referenceMeasurement) != null).length,
    finalRows: measurements.filter((m) => {
      const f = num(m.finalAcceptedMeasurement != null ? m.finalAcceptedMeasurement : m.userMeasurement);
      return f != null;
    }).length,
  };
}

/** Per-participant rollup for research dashboard. */
function participantSummary(filters = {}) {
  const measurements = listMeasurements(Object.assign({}, filters, { limit: 50000 }));
  const projects = listProjects(Object.assign({}, filters, { limit: 5000 }));
  const sessions = listSessions(Object.assign({}, filters, { limit: 5000 }));
  const events = listElementEvents(Object.assign({}, filters, { limit: 20000 }));
  const byPid = {};
  function ensure(pid) {
    if (!pid) return null;
    if (!byPid[pid]) {
      byPid[pid] = {
        participantId: pid,
        sessions: 0,
        projects: 0,
        drawings: new Set(),
        measurements: 0,
        simpleCount: 0,
        proCount: 0,
        aiAssisted: 0,
        manual: 0,
        corrections: 0,
        durationSecSum: 0,
        durationCount: 0,
        lastActivity: null,
        elementEvents: 0,
      };
    }
    return byPid[pid];
  }
  sessions.forEach((s) => {
    const row = ensure(s.participantId);
    if (!row) return;
    row.sessions += 1;
    if (s.startedAt && (!row.lastActivity || s.startedAt > row.lastActivity)) row.lastActivity = s.startedAt;
    if (s.endedAt && (!row.lastActivity || s.endedAt > row.lastActivity)) row.lastActivity = s.endedAt;
  });
  projects.forEach((p) => {
    const row = ensure(p.participantId);
    if (!row) return;
    row.projects += 1;
    if (p.drawingId) row.drawings.add(p.drawingId);
    if (p.uploadedAt && (!row.lastActivity || p.uploadedAt > row.lastActivity)) row.lastActivity = p.uploadedAt;
  });
  measurements.forEach((m) => {
    const row = ensure(m.participantId);
    if (!row) return;
    row.measurements += 1;
    if (m.drawingId) row.drawings.add(m.drawingId);
    if (m.measurementMode === 'Pro') row.proCount += 1;
    else row.simpleCount += 1;
    if (m.aiMeasurement != null && m.aiMeasurement !== '') row.aiAssisted += 1;
    else row.manual += 1;
    if (m.userCorrection) row.corrections += 1;
    const d = Number(m.measurementDurationSec);
    if (Number.isFinite(d) && d > 0) {
      row.durationSecSum += d;
      row.durationCount += 1;
    }
    if (m.createdAt && (!row.lastActivity || m.createdAt > row.lastActivity)) row.lastActivity = m.createdAt;
  });
  events.forEach((e) => {
    const row = ensure(e.participantId);
    if (!row) return;
    row.elementEvents += 1;
    if (e.ts && (!row.lastActivity || e.ts > row.lastActivity)) row.lastActivity = e.ts;
  });
  return Object.values(byPid).map((r) => ({
    participantId: r.participantId,
    sessions: r.sessions,
    projects: r.projects,
    drawings: r.drawings.size,
    measurements: r.measurements,
    simpleCount: r.simpleCount,
    proCount: r.proCount,
    aiAssisted: r.aiAssisted,
    manual: r.manual,
    corrections: r.corrections,
    avgMeasurementDurationSec: r.durationCount
      ? Math.round((r.durationSecSum / r.durationCount) * 100) / 100
      : null,
    elementEvents: r.elementEvents,
    lastActivity: r.lastActivity,
  })).sort((a, b) => String(a.participantId).localeCompare(String(b.participantId)));
}

/** Quantity error by element type (AI vs reference / final). Missing values → null, never 0. */
function quantityAccuracyByType(filters = {}) {
  const measurements = listMeasurements(Object.assign({}, filters, { limit: 50000 }));
  const byType = {};
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  measurements.forEach((m) => {
    const t = String(m.measurementType || 'unknown').toLowerCase();
    if (!byType[t]) {
      byType[t] = {
        elementType: t,
        count: 0,
        withAi: 0,
        withRef: 0,
        withFinal: 0,
        corrections: 0,
        aiVsRefErrors: [],
        finalVsRefErrors: [],
        aiVsFinalErrors: [],
      };
    }
    const row = byType[t];
    row.count += 1;
    const ai = num(m.aiMeasurement);
    const ref = num(m.referenceMeasurement);
    const finalV = num(m.finalAcceptedMeasurement != null ? m.finalAcceptedMeasurement : m.userMeasurement);
    if (ai != null) row.withAi += 1;
    if (ref != null) row.withRef += 1;
    if (finalV != null) row.withFinal += 1;
    if (m.userCorrection) row.corrections += 1;
    if (ai != null && ref != null && Math.abs(ref) > 1e-9) {
      row.aiVsRefErrors.push(Math.abs(ai - ref) / Math.abs(ref) * 100);
    }
    if (finalV != null && ref != null && Math.abs(ref) > 1e-9) {
      row.finalVsRefErrors.push(Math.abs(finalV - ref) / Math.abs(ref) * 100);
    }
    if (ai != null && finalV != null && Math.abs(ai) > 1e-9) {
      row.aiVsFinalErrors.push(Math.abs(finalV - ai) / Math.abs(ai) * 100);
    }
  });
  return Object.values(byType).map((r) => ({
    elementType: r.elementType,
    count: r.count,
    withAi: r.withAi,
    withRef: r.withRef,
    withFinal: r.withFinal,
    corrections: r.corrections,
    meanAiVsRefErrorPct: r.aiVsRefErrors.length ? _round2(_mean(r.aiVsRefErrors)) : null,
    meanFinalVsRefErrorPct: r.finalVsRefErrors.length ? _round2(_mean(r.finalVsRefErrors)) : null,
    meanAiVsFinalErrorPct: r.aiVsFinalErrors.length ? _round2(_mean(r.aiVsFinalErrors)) : null,
    rowsWithAiVsRef: r.aiVsRefErrors.length,
    rowsWithFinalVsRef: r.finalVsRefErrors.length,
  })).sort((a, b) => b.count - a.count);
}

/** Simple vs Pro mode comparison rollup. */
function modeComparison(filters = {}) {
  const measurements = listMeasurements(Object.assign({}, filters, { limit: 50000 }));
  const sessions = listSessions(Object.assign({}, filters, { limit: 5000 }));
  function roll(mode) {
    const rows = measurements.filter((m) => m.measurementMode === mode);
    const sess = sessions.filter((s) => String(s.mode || '') === mode ||
      (mode === 'Pro' && String(s.mode || '').toLowerCase() === 'pro') ||
      (mode === 'Simple' && String(s.mode || '').toLowerCase() === 'simple'));
    const durations = rows.map((m) => Number(m.measurementDurationSec)).filter((d) => Number.isFinite(d) && d > 0);
    const corrections = rows.filter((m) => m.userCorrection).length;
    const ai = rows.filter((m) => m.aiMeasurement != null && m.aiMeasurement !== '').length;
    const participants = new Set(rows.map((m) => m.participantId).filter(Boolean));
    return {
      mode,
      participants: participants.size,
      sessions: sess.length,
      measurements: rows.length,
      avgDurationSec: durations.length ? _round2(_mean(durations)) : null,
      corrections,
      correctionRate: rows.length ? _round2((corrections / rows.length) * 100) : null,
      aiAssisted: ai,
      aiAssistedRate: rows.length ? _round2((ai / rows.length) * 100) : null,
    };
  }
  return { simple: roll('Simple'), pro: roll('Pro') };
}

/** Correction action breakdown from element events. */
function correctionSummary(filters = {}) {
  const events = listElementEvents(Object.assign({}, filters, { limit: 20000 }));
  const byAction = {};
  const byType = {};
  events.forEach((e) => {
    const a = String(e.action || 'unknown');
    byAction[a] = (byAction[a] || 0) + 1;
    const t = String(e.elementType || 'unknown').toLowerCase();
    if (!byType[t]) byType[t] = {};
    byType[t][a] = (byType[t][a] || 0) + 1;
  });
  return {
    totalEvents: events.length,
    byAction,
    byElementType: byType,
  };
}

function exportCsv(rows) {
  const cols = [
    'recordId', 'participantId', 'projectId', 'drawingId', 'date', 'time',
    'measurementMode', 'measurementType', 'measurementMethod',
    'referenceMeasurement', 'aiMeasurement', 'simpleModeMeasurement', 'proModeMeasurement',
    'userMeasurement', 'finalAcceptedMeasurement', 'unit',
    'difference', 'differencePct', 'userCorrection', 'measurementDurationSec',
    'notes', 'elementLabel', 'confidence', 'reviewStatus',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(r[c])).join(','));
  }
  return lines.join('\n');
}

/**
 * Researcher ground-truth quantities.
 * Shape of reference-quantities.json:
 * {
 *   "DWG-0001": {
 *     "column": { "value": 12.5, "unit": "m³", "notes": "...", "updatedAt": "..." },
 *     "beam":   { "value": 8.2,  "unit": "m³", "notes": "",    "updatedAt": "..." }
 *   }
 * }
 * Keys for measurementType are lower-cased for stable lookup.
 */
function loadReferenceQuantities() {
  ensureDirs();
  try {
    if (!fs.existsSync(FILES.referenceQuantities)) return {};
    const raw = JSON.parse(fs.readFileSync(FILES.referenceQuantities, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch (_) {
    return {};
  }
}

function saveReferenceQuantities(map) {
  ensureDirs();
  persistWrite(FILES.referenceQuantities, JSON.stringify(map || {}, null, 2), 'utf8');
}

function normalizeTypeKey(t) {
  return String(t || '').trim().toLowerCase();
}

/**
 * Set or clear a ground-truth quantity for a drawing + element type.
 * value === null / undefined removes the entry.
 */
function setReferenceQuantity({ drawingId, measurementType, value, unit, notes }) {
  const id = sanitizeDrawingId(drawingId);
  if (!id) throw new Error('drawingId is required and must look like DWG-0000');
  const typeKey = normalizeTypeKey(measurementType);
  if (!typeKey) throw new Error('measurementType is required');

  const map = loadReferenceQuantities();
  if (!map[id]) map[id] = {};

  if (value == null || value === '') {
    delete map[id][typeKey];
    if (Object.keys(map[id]).length === 0) delete map[id];
  } else {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error('value must be a finite number');
    map[id][typeKey] = {
      value: n,
      unit: unit != null ? String(unit).slice(0, 24) : null,
      notes: notes != null ? String(notes).slice(0, 500) : '',
      updatedAt: nowIso(),
    };
  }
  saveReferenceQuantities(map);

  // Backfill existing measurement rows that are missing a referenceMeasurement
  // for this drawing + type, so dashboard stats update immediately.
  backfillReferenceOnMeasurements(id, typeKey, value == null || value === '' ? null : Number(value));

  return { drawingId: id, measurementType: typeKey, entry: (map[id] && map[id][typeKey]) || null };
}

function getReferenceQuantity(drawingId, measurementType) {
  const id = sanitizeDrawingId(drawingId);
  if (!id) return null;
  const map = loadReferenceQuantities();
  const typeKey = normalizeTypeKey(measurementType);
  const entry = map[id] && map[id][typeKey];
  return entry || null;
}

function listReferenceQuantities(drawingId) {
  const map = loadReferenceQuantities();
  if (drawingId) {
    const id = sanitizeDrawingId(drawingId);
    if (!id) return {};
    return map[id] || {};
  }
  return map;
}

/**
 * Rewrite measurement rows for a drawing+type, filling referenceMeasurement
 * where it was previously null. Does not overwrite an existing non-null
 * reference that might have been set on the row itself.
 */
function backfillReferenceOnMeasurements(drawingId, typeKey, refValue) {
  const id = sanitizeDrawingId(drawingId);
  if (!id) return 0;
  const rows = readJsonl(FILES.measurements);
  let changed = 0;
  const updated = rows.map((m) => {
    if (m.superseded) return m;
    if (String(m.drawingId) !== id) return m;
    if (normalizeTypeKey(m.measurementType) !== typeKey) return m;
    // Only fill when missing; never clobber a value already present on the row
    if (m.referenceMeasurement != null && m.referenceMeasurement !== '') return m;
    if (refValue == null) return m;
    changed += 1;
    const num = (v) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const finalV = num(m.finalAcceptedMeasurement != null ? m.finalAcceptedMeasurement : m.userMeasurement);
    const ai = num(m.aiMeasurement);
    const reference = num(refValue);
    let difference = null;
    let differencePct = null;
    const baseline = reference != null ? reference : ai;
    if (finalV != null && baseline != null) {
      difference = Math.round((finalV - baseline) * 10000) / 10000;
      if (Math.abs(baseline) > 1e-9) {
        differencePct = Math.round((Math.abs(difference) / Math.abs(baseline)) * 10000) / 100;
      }
    }
    return {
      ...m,
      referenceMeasurement: reference,
      difference,
      differencePct,
    };
  });
  if (changed) rewriteJsonl(FILES.measurements, updated);
  return changed;
}

/**
 * When logging a new measurement, pull researcher ground truth if the payload
 * did not already supply a referenceMeasurement.
 */
function resolveReferenceMeasurement(payload) {
  const fromPayload = (() => {
    if (payload == null) return null;
    const v = payload.referenceMeasurement != null ? payload.referenceMeasurement : payload.referenceQty;
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  })();
  if (fromPayload != null) return fromPayload;
  const drawingId = payload && payload.drawingId;
  const type = payload && (payload.measurementType || payload.elementType);
  if (!drawingId || !type) return null;
  const entry = getReferenceQuantity(drawingId, type);
  return entry && entry.value != null ? entry.value : null;
}

function getDrawingPath(drawingId) {
  const id = sanitizeDrawingId(drawingId);
  if (!id) return null;
  const projects = readJsonl(FILES.projects);
  const p = projects.find((x) => x.drawingId === id);
  if (!p || !p.storedPath) return null;
  const abs = path.join(DATA_ROOT, p.storedPath);
  // Belt-and-braces: refuse to serve anything that resolves outside DATA_ROOT.
  if (!abs.startsWith(path.resolve(DATA_ROOT) + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return { abs, project: p };
}

/**
 * Save a marked plan (measurements overlaid) for research download.
 * File: data/drawings/{drawingId}_marked.jpg (or png)
 * Updates the project row with markedStoredPath / markedAt.
 */
function saveMarkedDrawing({ drawingId, imageBase64, mimeType, participantId, mode, source }) {
  ensureDirs();
  const id = sanitizeDrawingId(drawingId);
  if (!id) throw new Error('drawingId is required and must look like DWG-0000');
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    throw new Error('imageBase64 is required');
  }
  const raw = imageBase64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('empty image');

  const ext = (mimeType || '').includes('png') ? 'png'
    : (mimeType || '').includes('webp') ? 'webp'
    : 'jpg';
  const fname = `${id}_marked.${ext}`;
  const abs = path.join(DRAWINGS_DIR, fname);
  persistWrite(abs, buf);
  const rel = path.relative(DATA_ROOT, abs);
  const markedAt = nowIso();

  const projects = readJsonl(FILES.projects);
  let found = false;
  const updated = projects.map((p) => {
    if (p.drawingId !== id || p.superseded) return p;
    found = true;
    return {
      ...p,
      markedStoredPath: rel,
      markedAt,
      markedByteSize: buf.length,
      markedMimeType: mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg'),
      markedSource: source || 'pro_export',
      markedMode: mode === 'pro' || mode === 'Pro' ? 'Pro' : (mode || p.mode || null),
      markedParticipantId: participantId || p.participantId || null,
    };
  });

  // If no project row exists yet, create a minimal one so the dashboard can list the marked file
  if (!found) {
    updated.push({
      projectId: nextId('project'),
      drawingId: id,
      participantId: sanitizeParticipant(participantId || 'unknown'),
      mode: mode === 'pro' || mode === 'Pro' ? 'Pro' : 'Simple',
      projectName: 'Marked only',
      fileName: fname,
      uploadedAt: markedAt,
      storedPath: null,
      markedStoredPath: rel,
      markedAt,
      markedByteSize: buf.length,
      markedMimeType: mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg'),
      markedSource: source || 'pro_export',
      originalUnchanged: false,
      forAiTraining: false,
      superseded: false,
    });
  }
  rewriteJsonl(FILES.projects, updated);

  return {
    drawingId: id,
    markedStoredPath: rel,
    markedAt,
    byteSize: buf.length,
    fileName: fname,
  };
}

function getMarkedDrawingPath(drawingId) {
  const id = sanitizeDrawingId(drawingId);
  if (!id) return null;
  const projects = readJsonl(FILES.projects);
  const p = projects.find((x) => x.drawingId === id && !x.superseded)
    || projects.find((x) => x.drawingId === id);
  if (!p || !p.markedStoredPath) return null;
  const abs = path.join(DATA_ROOT, p.markedStoredPath);
  if (!abs.startsWith(path.resolve(DATA_ROOT) + path.sep)) return null;
  if (!fs.existsSync(abs)) return null;
  return { abs, project: p, fileName: path.basename(p.markedStoredPath) };
}

module.exports = {
  ensureDirs,
  hydrateFromRemote,
  startSession,
  endSession,
  registerProject,
  createProRevision,
  logMeasurement,
  logMeasurementBatch,
  updateMeasurement,
  listMeasurements,
  listProjects,
  listSessions,
  summaryStats,
  detectionAccuracy,
  exportCsv,
  getDrawingPath,
  getMarkedDrawingPath,
  saveMarkedDrawing,
  pushToGoogleSheets,
  bindEmailToParticipant,
  getParticipantForEmail,
  getEmailForParticipant,
  assertParticipantAvailable,
  deleteMeasurementRecords,
  clearAllResearchData,
  logElementEvent,
  logElementEventBatch,
  listElementEvents,
  participantSummary,
  quantityAccuracyByType,
  modeComparison,
  correctionSummary,
  buildTrainingDataset,
  saveReviewedAnnotations,
  listReviewedAnnotations,
  buildAnnotationDataset,
  listStoredDrawings,
  setReferenceQuantity,
  getReferenceQuantity,
  listReferenceQuantities,
  loadReferenceQuantities,
  DATA_ROOT,
  DRAWINGS_DIR,
  RESEARCH_DIR,
  ANNOTATIONS_DIR,
  FILES,
  storageStatus: researchStorage.status,
};
