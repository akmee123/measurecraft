/**
 * MeasureCraft Document Model v2
 * Normalizes measurements with geometry, method, authorship, and review status.
 * Safe to load before takeoff_pro.js — attaches to window.MCDocument.
 */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 2;

  function nowIso() {
    return new Date().toISOString();
  }

  function defaultAuthorship(source) {
    var role = (source === 'AI' || source === 'AGENT' || source === 'AI_EDITED') ? 'agent' : 'human';
    return { role: role, actor: role === 'agent' ? 'gemini' : 'qs', at: nowIso() };
  }

  function inferMethod(el) {
    if (!el) return 'manual_draw';
    if (el.method) return el.method;
    if (el.source === 'AI' || el.reviewStatus === 'AI_GENERATED') return 'ai_detect';
    if (el.source === 'AGENT') return 'ai_agent';
    if (el.source === 'AI_EDITED') return 'ai_detect';
    return 'manual_draw';
  }

  function normalizeElement(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var source = raw.source || (raw.ai ? 'AI' : 'MANUAL');
    var reviewStatus = raw.reviewStatus;
    if (!reviewStatus) {
      if (source === 'AI' || source === 'AGENT') reviewStatus = 'AI_GENERATED';
      else if (source === 'AI_EDITED') reviewStatus = 'QS_REVIEWED';
      else reviewStatus = 'MANUAL';
    }
    var accepted = raw.accepted;
    if (accepted === undefined || accepted === null) {
      // AI proposals must be explicitly accepted; manual defaults to accepted
      accepted = !(reviewStatus === 'AI_GENERATED' || reviewStatus === 'REJECTED' || source === 'AI' || source === 'AGENT');
    }
    var authorship = raw.authorship && typeof raw.authorship === 'object'
      ? raw.authorship
      : defaultAuthorship(source);

    return Object.assign({}, raw, {
      source: source,
      method: inferMethod(raw),
      authorship: authorship,
      reviewStatus: reviewStatus,
      accepted: !!accepted,
      reviewedAt: raw.reviewedAt || null,
      confidence: raw.confidence != null ? Number(raw.confidence) : null,
      provenance: (function () {
        var P = global.MCProvenance;
        if (P && typeof P.normalize === 'function') return P.normalize(raw);
        return raw.provenance || null;
      })(),
      locked: !!raw.locked,
      hidden: !!raw.hidden,
    });
  }

  function normalizeElements(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = normalizeElement(list[i]);
      if (n) out.push(n);
    }
    return out;
  }

  function reviewBreakdown(elements) {
    var counts = {
      total: 0,
      manual: 0,
      aiGenerated: 0,
      qsReviewed: 0,
      final: 0,
      rejected: 0,
      accepted: 0,
      pending: 0,
    };
    (elements || []).forEach(function (el) {
      if (!el) return;
      counts.total++;
      var s = el.reviewStatus || 'MANUAL';
      if (s === 'MANUAL') counts.manual++;
      else if (s === 'AI_GENERATED') counts.aiGenerated++;
      else if (s === 'QS_REVIEWED') counts.qsReviewed++;
      else if (s === 'FINAL') counts.final++;
      else if (s === 'REJECTED') counts.rejected++;
      if (el.accepted) counts.accepted++;
      else if (s !== 'REJECTED') counts.pending++;
    });
    return counts;
  }

  function buildDocument(state) {
    state = state || {};
    var elements = normalizeElements(state.elements || []);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: state.id || ('doc-' + Date.now()),
      createdAt: state.createdAt || nowIso(),
      updatedAt: nowIso(),
      projectInfo: state.projectInfo || {},
      calibration: {
        factor: typeof state.calibrationFactor === 'number' ? state.calibrationFactor : 1.0,
        unit: 'm',
        method: state.calibrationMethod || 'two-point',
        calibratedAt: state.calibratedAt || null,
        notes: state.calibrationNotes || '',
      },
      sheets: state.sheets || [
        {
          id: 'sheet-1',
          name: (state.projectInfo && state.projectInfo.name) || 'Main',
          pageIndex: 0,
          background: state.backgroundImage || null,
          calibration: {
            factor: typeof state.calibrationFactor === 'number' ? state.calibrationFactor : 1.0,
          },
        },
      ],
      activeSheetId: state.activeSheetId || 'sheet-1',
      layers: state.layers || ['All', 'Structural', 'Architectural', 'MEP', 'Furniture'],
      elements: elements,
      revisions: state.revisions || [],
      nextId: state.nextId || 1,
      isConfirmed: !!state.isConfirmed,
      materialLibrary: state.materialLibrary || {},
      projectOverrides: state.projectOverrides || {},
      review: reviewBreakdown(elements),
    };
  }

  function normalizeDocument(data) {
    if (!data || typeof data !== 'object') {
      return buildDocument({});
    }
    // Legacy v1: flat project JSON from older MeasureCraft saves
    if (!data.schemaVersion || data.schemaVersion < 2) {
      return buildDocument({
        id: data.id,
        createdAt: data.createdAt,
        projectInfo: data.projectInfo,
        calibrationFactor: data.calibrationFactor,
        calibrationMethod: data.calibrationMethod,
        calibratedAt: data.calibratedAt,
        layers: data.layers,
        elements: data.elements,
        revisions: data.revisions,
        nextId: data.nextId,
        isConfirmed: data.isConfirmed,
        materialLibrary: data.materialLibrary,
        projectOverrides: data.projectOverrides,
        backgroundImage: data.backgroundImage,
      });
    }
    data.elements = normalizeElements(data.elements);
    data.review = reviewBreakdown(data.elements);
    data.updatedAt = nowIso();
    return data;
  }

  function markAccepted(el, actor) {
    if (!el) return el;
    el.accepted = true;
    el.reviewStatus = 'QS_REVIEWED';
    el.reviewedAt = nowIso();
    if (el.source === 'AI' || el.source === 'AGENT') el.source = 'AI_EDITED';
    el.authorship = {
      role: 'human',
      actor: actor || 'qs',
      at: el.reviewedAt,
    };
    return el;
  }

  function markRejected(el, actor) {
    if (!el) return el;
    el.accepted = false;
    el.reviewStatus = 'REJECTED';
    el.reviewedAt = nowIso();
    el.authorship = {
      role: 'human',
      actor: actor || 'qs',
      at: el.reviewedAt,
    };
    return el;
  }

  function isCostingEligible(el) {
    if (!el || el.hidden) return false;
    if (el.reviewStatus === 'REJECTED') return false;
    if (el.reviewStatus === 'AI_GENERATED' && !el.accepted) return false;
    if (el.accepted === false) return false;
    return true;
  }

  global.MCDocument = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    normalizeElement: normalizeElement,
    normalizeElements: normalizeElements,
    buildDocument: buildDocument,
    normalizeDocument: normalizeDocument,
    reviewBreakdown: reviewBreakdown,
    markAccepted: markAccepted,
    markRejected: markRejected,
    isCostingEligible: isCostingEligible,
    nowIso: nowIso,
  };
})(typeof window !== 'undefined' ? window : global);
