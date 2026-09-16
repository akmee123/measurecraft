/**
 * MeasureCraft research client helpers (browser).
 * Participant ID + session + project/drawing registration + measurement logging.
 * Does not train AI; only posts structured research records to the server.
 */
(function (global) {
  const KEYS = {
    participant: 'mc-research-participant',
    session: 'mc-research-session',
    project: 'mc-research-project',
    mode: 'mc-research-mode',
    sessionStart: 'mc-research-session-start',
    simpleExported: 'mc-research-simple-exported',
  };

  function storeGet(k) {
    try { return sessionStorage.getItem(k); } catch (_) { return null; }
  }
  function storeSet(k, v) {
    try {
      if (v == null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, String(v));
    } catch (_) {}
  }

  function getParticipantId() {
    return storeGet(KEYS.participant) || '';
  }
  function setParticipantId(id) {
    storeSet(KEYS.participant, String(id || '').trim().slice(0, 64));
  }
  function getMode() {
    return storeGet(KEYS.mode) || '';
  }
  function setMode(mode) {
    storeSet(KEYS.mode, mode === 'pro' || mode === 'Pro' ? 'pro' : 'simple');
  }
  /** Set mode without clearing project/session (e.g. Simple → Pro continue). */
  function ensureMode(mode) {
    setMode(mode);
  }
  function getSession() {
    try { return JSON.parse(storeGet(KEYS.session) || 'null'); } catch (_) { return null; }
  }
  function getProject() {
    try { return JSON.parse(storeGet(KEYS.project) || 'null'); } catch (_) { return null; }
  }

  async function api(path, body) {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.success === false) {
      const err = new Error(data.error || ('HTTP ' + resp.status));
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function startSession(participantId, mode) {
    setParticipantId(participantId);
    setMode(mode);
    const data = await api('/api/research/session/start', {
      participantId: getParticipantId(),
      mode: getMode(),
    });
    storeSet(KEYS.session, JSON.stringify(data.session));
    storeSet(KEYS.sessionStart, String(Date.now()));
    storeSet(KEYS.project, null);
    return data.session;
  }

  async function endSession() {
    const s = getSession();
    if (!s || !s.sessionId) return null;
    const p = getProject();
    try {
      const data = await api('/api/research/session/end', {
        sessionId: s.sessionId,
        projectId: p && p.projectId,
        drawingId: p && p.drawingId,
      });
      return data.session;
    } catch (_) {
      return null;
    }
  }

  /**
   * Register drawing after upload. Pass canvas/data URL as imageBase64 when available.
   */
  async function registerDrawing(opts) {
    opts = opts || {};
    const participantId = getParticipantId();
    if (!participantId) return null;
    // Reuse existing project/drawing when continuing Simple → Pro (avoid DWG-0002 duplicate)
    if (opts.reuseExisting !== false) {
      const existing = getProject();
      if (existing && existing.drawingId && existing.projectId) {
        // Optionally refresh mode tag in storage only
        if (opts.mode) setMode(opts.mode);
        return existing;
      }
    }
    const s = getSession();
    const body = {
      participantId,
      mode: (opts.mode || getMode()),
      sessionId: s && s.sessionId,
      fileName: opts.fileName || 'drawing',
      mimeType: opts.mimeType || 'image/jpeg',
      imageBase64: opts.imageBase64 || null,
      projectName: opts.projectName || opts.fileName || 'Untitled',
      scaleNote: opts.scaleNote || null,
      meta: opts.meta || {},
    };
    // Cap payload size (~8MB base64) to avoid failed posts
    if (body.imageBase64 && body.imageBase64.length > 12 * 1024 * 1024) {
      body.imageBase64 = null;
      body.meta = Object.assign({}, body.meta, { imageOmitted: true, reason: 'payload_too_large' });
    }
    try {
      const data = await api('/api/research/project', body);
      storeSet(KEYS.project, JSON.stringify(data.project));
      return data.project;
    } catch (err) {
      console.warn('[research] registerDrawing failed', err.message);
      return null;
    }
  }


  function markSimpleExported(flag) {
    storeSet(KEYS.simpleExported, flag ? '1' : null);
  }
  function isSimpleExported() {
    return storeGet(KEYS.simpleExported) === '1';
  }

  /**
   * After Simple export → Pro: create PROJ-0001/A linked to parent Simple PROJ-0001.
   * Drawing ID unchanged. Stores new project in sessionStorage.
   */
  async function createProRevisionFromSimple(opts) {
    opts = opts || {};
    const parent = getProject();
    const parentProjectId = opts.parentProjectId || (parent && parent.projectId);
    if (!parentProjectId) {
      console.warn('[research] createProRevisionFromSimple: no parent projectId');
      return null;
    }
    // Already a revision (/A) — do not nest
    if (String(parentProjectId).indexOf('/') >= 0) {
      return parent;
    }
    const s = getSession();
    try {
      const data = await api('/api/research/project/pro-revision', {
        parentProjectId: parentProjectId,
        participantId: getParticipantId(),
        sessionId: s && s.sessionId,
        projectName: opts.projectName || (parent && parent.projectName),
        meta: opts.meta || {},
      });
      if (data.project) {
        storeSet(KEYS.project, JSON.stringify(data.project));
        setMode('pro');
      }
      return data.project || null;
    } catch (err) {
      console.warn('[research] createProRevisionFromSimple failed', err && err.message);
      return null;
    }
  }

  function getResearchIds() {
    const p = getProject() || {};
    return {
      drawingId: p.drawingId || null,
      projectId: p.projectId || null,
      parentProjectId: p.parentProjectId || null,
      revision: p.revision || 'ORIGINAL',
      mode: p.mode || (getMode() === 'pro' ? 'Pro' : 'Simple'),
    };
  }

  function sessionDurationSec() {
    const t0 = Number(storeGet(KEYS.sessionStart) || 0);
    if (!t0) return null;
    return Math.max(0, Math.round((Date.now() - t0) / 1000));
  }

  /** Upload final QS-reviewed geometry for offline detector training/evaluation. */
  async function saveReviewedAnnotations(elements, opts) {
    opts = opts || {};
    const p = getProject();
    const drawingId = opts.drawingId || (p && p.drawingId);
    if (!drawingId || !Array.isArray(elements) || !elements.length) return null;
    try {
      const data = await api('/api/research/annotations', {
        drawingId,
        projectId: opts.projectId || (p && p.projectId) || null,
        participantId: getParticipantId() || opts.participantId || null,
        mode: opts.mode || getMode() || 'pro',
        imageWidth: opts.imageWidth || null,
        imageHeight: opts.imageHeight || null,
        metersPerPixel: opts.metersPerPixel || null,
        legendNotes: opts.legendNotes || '',
        source: opts.source || 'qs_review_export',
        aiElements: Array.isArray(opts.aiElements) ? opts.aiElements : [],
        elements,
      });
      return data.annotation || data;
    } catch (err) {
      console.warn('[research] saveReviewedAnnotations failed', err && err.message);
      return null;
    }
  }

  /**
   * Real-time element lifecycle log (accept / reject / edit / add / delete / detect).
   * Fires while the QS works — does not wait for export.
   */
  async function logElementEvent(action, element, opts) {
    opts = opts || {};
    const participantId = getParticipantId() || opts.participantId;
    if (!participantId) return null;
    const p = getProject();
    const s = getSession();
    try {
      const data = await api('/api/research/element-event', {
        action: action,
        participantId: participantId,
        projectId: opts.projectId || (p && p.projectId) || null,
        drawingId: opts.drawingId || (p && p.drawingId) || null,
        sessionId: (s && s.sessionId) || null,
        mode: opts.mode || getMode() || 'pro',
        element: element || {},
        notes: opts.notes || null,
      });
      return data.event || data;
    } catch (err) {
      console.warn('[research] logElementEvent failed', err && err.message);
      return null;
    }
  }

  /** Debounced full geometry snapshot after edits (real-time ground-truth update). */
  let _snapshotTimer = null;
  let _snapshotGetter = null;

  function setRealtimeElementsProvider(fn) {
    _snapshotGetter = typeof fn === 'function' ? fn : null;
  }

  function scheduleRealtimeSnapshot(opts) {
    opts = opts || {};
    if (!getParticipantId()) return;
    if (_snapshotTimer) clearTimeout(_snapshotTimer);
    const delay = opts.delay != null ? opts.delay : 1200;
    _snapshotTimer = setTimeout(function () {
      _snapshotTimer = null;
      flushRealtimeSnapshot(opts);
    }, delay);
  }

  async function flushRealtimeSnapshot(opts) {
    opts = opts || {};
    if (!getParticipantId()) return null;
    if (!_snapshotGetter) return null;
    let payload;
    try {
      payload = _snapshotGetter();
    } catch (err) {
      console.warn('[research] realtime snapshot provider failed', err && err.message);
      return null;
    }
    if (!payload || !Array.isArray(payload.elements) || !payload.elements.length) return null;
    return saveReviewedAnnotations(payload.elements, {
      mode: opts.mode || getMode() || 'pro',
      imageWidth: payload.imageWidth,
      imageHeight: payload.imageHeight,
      metersPerPixel: payload.metersPerPixel,
      legendNotes: payload.legendNotes || '',
      source: opts.source || 'realtime_qs_snapshot',
      aiElements: Array.isArray(payload.aiElements) ? payload.aiElements : [],
    });
  }

  /**
   * Convenience: log one action and schedule a debounced geometry snapshot.
   * action: accept | reject | edit | add | delete | detect
   */
  function notifyElementChange(action, element, opts) {
    opts = opts || {};
    try { logElementEvent(action, element, opts); } catch (_) {}
    scheduleRealtimeSnapshot(opts);
  }

  /**
   * Upload marked plan (measurements on drawing) for research dashboard download.
   * Needs drawingId from registerDrawing / participant session.
   */
  async function saveMarkedDrawing(imageBase64, opts) {
    opts = opts || {};
    const p = getProject();
    const drawingId = opts.drawingId || (p && p.drawingId);
    if (!drawingId) {
      console.warn('[research] saveMarkedDrawing skipped — no drawingId');
      return null;
    }
    if (!imageBase64) return null;
    try {
      const data = await api('/api/research/marked-drawing', {
        drawingId: drawingId,
        image_base64: imageBase64,
        mime_type: opts.mimeType || opts.mime_type || 'image/jpeg',
        participantId: getParticipantId() || opts.participantId || null,
        mode: opts.mode || getMode() || 'pro',
        source: opts.source || 'pro_export',
      });
      return data.marked || data;
    } catch (err) {
      console.warn('[research] saveMarkedDrawing failed', err && err.message);
      return null;
    }
  }

  /**
   * Log one or many measurement rows.
   * item fields: measurementType, aiMeasurement, userMeasurement, finalAcceptedMeasurement,
   *   referenceMeasurement, unit, userCorrection, notes, elementLabel, confidence, reviewStatus,
   *   measurementMethod
   */
  async function logMeasurements(items, extra) {
    const participantId = getParticipantId();
    if (!participantId) return null;
    const s = getSession();
    const p = getProject();
    const list = Array.isArray(items) ? items : [items];
    if (!list.length) return null;
    try {
      const data = await api('/api/research/measurement', {
        participantId,
        projectId: (p && p.projectId) || (extra && extra.projectId) || null,
        drawingId: (p && p.drawingId) || (extra && extra.drawingId) || null,
        sessionId: s && s.sessionId,
        measurementMode: getMode() === 'pro' ? 'Pro' : 'Simple',
        mode: getMode(),
        measurementDurationSec: sessionDurationSec(),
        notes: extra && extra.notes,
        measurements: list,
      });
      return data;
    } catch (err) {
      console.warn('[research] logMeasurements failed', err.message);
      return null;
    }
  }

  /** Build comparison rows from Simple/Pro BOQ-style materials or element quantities. */
  function rowsFromElementQty(elementQty, opts) {
    opts = opts || {};
    return (elementQty || []).map(function (e) {
      return {
        measurementType: e.element || e.type || 'element',
        measurementMethod: opts.method || 'element_quantity',
        userMeasurement: e.qty,
        finalAcceptedMeasurement: e.qty,
        aiMeasurement: e.aiQty != null ? e.aiQty : null,
        referenceMeasurement: e.referenceQty != null ? e.referenceQty : null,
        unit: e.unit || '',
        userCorrection: !!e.userCorrection,
        elementLabel: e.element || e.label || null,
        notes: e.notes || '',
      };
    });
  }

  function rowsFromMaterials(materials, opts) {
    opts = opts || {};
    return (materials || []).map(function (m) {
      return {
        measurementType: m.material || m.name || 'material',
        measurementMethod: opts.method || 'material_quantity',
        userMeasurement: m.qty,
        finalAcceptedMeasurement: m.qty,
        aiMeasurement: m.aiQty != null ? m.aiQty : null,
        referenceMeasurement: m.referenceQty != null ? m.referenceQty : null,
        unit: m.unit || '',
        userCorrection: !!m.userCorrection,
        notes: m.source || m.notes || '',
      };
    });
  }

  /** Small UI chip showing participant + mode */
  function ensureParticipantChip(anchorSelector) {
    const id = getParticipantId();
    const mode = getMode();
    if (!id) return;
    let el = document.getElementById('mc-research-chip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mc-research-chip';
      el.style.cssText = 'display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;background:rgba(47,111,102,0.12);color:#2f6f66;border:1px solid rgba(47,111,102,0.25);';
      const host = anchorSelector ? document.querySelector(anchorSelector) : document.body;
      if (host) host.appendChild(el);
    }
    el.textContent = 'Participant: ' + id + ' · ' + (mode === 'pro' ? 'Pro' : 'Simple');
    el.title = 'Research testing session — only participant ID is stored (no extra personal data)';
  }

  global.MCResearch = {
    KEYS,
    getParticipantId,
    setParticipantId,
    getMode,
    setMode,
    ensureMode,
    getSession,
    getProject,
    startSession,
    endSession,
    registerDrawing,
    markSimpleExported,
    isSimpleExported,
    createProRevisionFromSimple,
    getResearchIds,
    saveMarkedDrawing,
    saveReviewedAnnotations,
    logElementEvent,
    setRealtimeElementsProvider,
    scheduleRealtimeSnapshot,
    flushRealtimeSnapshot,
    notifyElementChange,
    logMeasurements,
    rowsFromElementQty,
    rowsFromMaterials,
    sessionDurationSec,
    ensureParticipantChip,
  };
})(typeof window !== 'undefined' ? window : globalThis);
