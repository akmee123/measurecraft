'use strict';

/**
 * MeasureCraft Takeoff Core v3
 * Headless, deterministic helpers shared by the API, MCP and research tools.
 * No DOM, no network, no project-specific state.
 */

function finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v) {
  const n = num(v);
  if (n == null) return null;
  return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
}

function confidenceBand(value) {
  const c = clamp01(value);
  if (c == null) return { value: null, label: 'Unknown', level: 'unknown' };
  if (c >= 0.9) return { value: c, label: 'High', level: 'high' };
  if (c >= 0.7) return { value: c, label: 'Review', level: 'medium' };
  return { value: c, label: 'Check', level: 'low' };
}

function isAi(el) {
  return !!el && (el.source === 'AI' || el.source === 'AGENT' || el.method === 'ai_detect' || el.method === 'ai_agent' || el.reviewStatus === 'AI_GENERATED');
}

function costingEligible(el) {
  if (!el || el.hidden) return false;
  if (el.reviewStatus === 'REJECTED' || el.accepted === false) return false;
  return !isAi(el) || el.accepted === true || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL';
}

function elementQuantity(el, calibrationFactor = 1) {
  if (!el || !finite(Number(calibrationFactor)) || calibrationFactor <= 0) return null;
  const cf = Number(calibrationFactor);
  const type = String(el.type || '').toLowerCase();
  const lengthDraw = num(el.length, null);
  const w = num(el.w, null);
  const h = num(el.h, null);
  const thickness = num(el.thickness, null);

  if (lengthDraw != null && (el.isLine || type === 'wall' || type === 'beam' || type === 'deduct')) {
    return { gross: Math.abs(lengthDraw) * cf, unit: 'm', basis: 'length' };
  }
  if (w != null && h != null && (type === 'slab' || type === 'opening' || type === 'floor' || type === 'area')) {
    return { gross: Math.abs(w * h) * cf * cf, unit: 'm²', basis: 'area' };
  }
  if (w != null && h != null && thickness != null && (type === 'column' || type === 'beam_volume' || type === 'concrete')) {
    return { gross: Math.abs(w * h * thickness) * Math.pow(cf, 3), unit: 'm³', basis: 'volume' };
  }
  if (type === 'count' || type === 'opening_count') return { gross: 1, unit: 'nr', basis: 'count' };
  return null;
}

function summarize(elements, calibrationFactor = 1) {
  const list = Array.isArray(elements) ? elements : [];
  const byType = {};
  const byUnit = {};
  let eligible = 0;
  let pending = 0;
  let rejected = 0;
  let ai = 0;
  let corrected = 0;

  for (const el of list) {
    if (!el) continue;
    if (isAi(el)) ai++;
    if (el.reviewStatus === 'REJECTED') rejected++;
    if (isAi(el) && el.accepted !== true && el.reviewStatus !== 'QS_REVIEWED' && el.reviewStatus !== 'FINAL') pending++;
    if (el.provenance && el.provenance.editCount > 0 && isAi(el)) corrected++;
    const q = elementQuantity(el, calibrationFactor);
    if (!q || !costingEligible(el)) continue;
    eligible++;
    const type = String(el.type || 'unknown');
    byType[type] = byType[type] || { count: 0, quantities: {} };
    byType[type].count++;
    byType[type].quantities[q.unit] = (byType[type].quantities[q.unit] || 0) + q.gross;
    byUnit[q.unit] = (byUnit[q.unit] || 0) + q.gross;
  }

  return {
    elementCount: list.length,
    costingEligible: eligible,
    aiElements: ai,
    aiPendingReview: pending,
    aiCorrected: corrected,
    rejected,
    byType,
    totalsByUnit: byUnit,
    reviewReady: pending === 0,
  };
}

function validateDocument(doc) {
  const issues = [];
  const d = doc && typeof doc === 'object' ? doc : {};
  const elements = Array.isArray(d.elements) ? d.elements : [];
  const ids = new Set();

  if (!d.schemaVersion) issues.push({ severity: 'warning', code: 'schema_missing', message: 'Document has no schemaVersion.' });
  const cf = num(d.calibration && d.calibration.factor != null ? d.calibration.factor : d.calibrationFactor);
  if (cf == null || cf <= 0) issues.push({ severity: 'error', code: 'invalid_calibration', message: 'Calibration factor must be a finite positive number.' });

  elements.forEach((el, index) => {
    if (!el || typeof el !== 'object') {
      issues.push({ severity: 'error', code: 'invalid_element', index, message: 'Element is not an object.' });
      return;
    }
    const id = el.id != null ? String(el.id) : null;
    if (!id) issues.push({ severity: 'error', code: 'missing_id', index, message: 'Element is missing an id.' });
    else if (ids.has(id)) issues.push({ severity: 'error', code: 'duplicate_id', id, index, message: 'Duplicate element id: ' + id });
    else ids.add(id);

    const status = el.reviewStatus || 'MANUAL';
    if (isAi(el) && status === 'AI_GENERATED' && el.accepted !== true) {
      issues.push({ severity: 'warning', code: 'ai_pending_review', id, index, message: 'AI element requires QS review before costing/export.' });
    }
    if (el.confidence != null && clamp01(el.confidence) == null) {
      issues.push({ severity: 'warning', code: 'invalid_confidence', id, index, message: 'Confidence is not numeric.' });
    }
    ['x', 'y', 'w', 'h', 'length', 'thickness'].forEach((key) => {
      if (el[key] != null && !finite(Number(el[key]))) {
        issues.push({ severity: 'error', code: 'non_finite_geometry', id, index, field: key, message: key + ' must be finite.' });
      }
    });
    if (Array.isArray(el.vertices)) {
      el.vertices.forEach((p, pi) => {
        if (!p || !finite(Number(p.x)) || !finite(Number(p.y))) {
          issues.push({ severity: 'error', code: 'invalid_vertex', id, index, vertex: pi, message: 'Vertex coordinates must be finite.' });
        }
      });
    }
    if (Array.isArray(el.cutouts)) {
      el.cutouts.forEach((cid) => {
        if (!ids.has(String(cid)) && !elements.some((x) => x && String(x.id) === String(cid))) {
          issues.push({ severity: 'warning', code: 'missing_cutout', id, cutoutId: cid, message: 'Cutout references missing element ' + cid });
        }
      });
    }
  });

  const errors = issues.filter((x) => x.severity === 'error').length;
  const warnings = issues.filter((x) => x.severity === 'warning').length;
  return { valid: errors === 0, errors, warnings, issues };
}

function findElements(elements, query = {}) {
  const list = Array.isArray(elements) ? elements : [];
  const text = query.text ? String(query.text).toLowerCase() : '';
  const type = query.type ? String(query.type).toLowerCase() : '';
  const status = query.reviewStatus ? String(query.reviewStatus).toUpperCase() : '';
  const source = query.source ? String(query.source).toUpperCase() : '';
  return list.filter((el) => {
    if (!el) return false;
    if (type && String(el.type || '').toLowerCase() !== type) return false;
    if (status && String(el.reviewStatus || '').toUpperCase() !== status) return false;
    if (source && String(el.source || '').toUpperCase() !== source) return false;
    if (text) {
      const hay = [el.id, el.label, el.type, el.description, el.material, el.source].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    if (query.accepted != null && !!el.accepted !== !!query.accepted) return false;
    return true;
  });
}

module.exports = {
  finite, num, clamp01, confidenceBand, isAi, costingEligible,
  elementQuantity, summarize, validateDocument, findElements,
};
