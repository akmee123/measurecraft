/**
 * MeasureCraft — measurement provenance.
 *
 * `reviewStatus` answers "has a QS signed this off?". Provenance answers the
 * audit questions that sit underneath it:
 *
 *   - how did this measurement come into existence (method)?
 *   - who/what created it, and who last touched it (actor)?
 *   - how many times has it been edited since?
 *   - what did the geometry look like *before* the first human edit?
 *
 * The pre-edit snapshot is frozen once and never overwritten, so an AI
 * proposal can always be compared against the QS-corrected figure — that
 * delta is the raw material for an accuracy/MAPE holdout.
 *
 * Pure data, no DOM. Safe to require in Node tests.
 *
 *   Browser  <script src="js/modules/provenance.js"></script> → window.MCProvenance
 *   Node     const P = require('../public/js/modules/provenance.js');
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MCProvenance = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var SCHEMA = 1;

    var METHOD = {
        MANUAL_DRAW: 'manual_draw',      // QS drew it on the sheet
        AI_DETECT: 'ai_detect',          // vision/detector proposal
        AI_AGENT: 'ai_agent',            // agent/MCP tool call
        IMPORT: 'import',                // loaded from a saved project / CAD
        DERIVED: 'derived',              // generated from another element
        UNKNOWN: 'unknown'
    };

    var ROLE = { HUMAN: 'human', AI: 'ai', SYSTEM: 'system' };

    function nowIso() { return new Date().toISOString(); }

    function num(v) {
        var n = Number(v);
        return isFinite(n) ? n : null;
    }

    /** Map the legacy `source` flag onto a provenance method. */
    function methodFromSource(source, el) {
        if (el && typeof el.method === 'string' && el.method) return el.method;
        switch (source) {
            case 'AI': return METHOD.AI_DETECT;
            case 'AI_EDITED': return METHOD.AI_DETECT; // origin is still AI
            case 'AGENT': return METHOD.AI_AGENT;
            case 'IMPORT': return METHOD.IMPORT;
            case 'MANUAL': return METHOD.MANUAL_DRAW;
            default: return METHOD.UNKNOWN;
        }
    }

    function roleForMethod(method) {
        if (method === METHOD.AI_DETECT || method === METHOD.AI_AGENT) return ROLE.AI;
        if (method === METHOD.IMPORT || method === METHOD.DERIVED) return ROLE.SYSTEM;
        return ROLE.HUMAN;
    }

    /**
     * Frozen copy of everything that determines a quantity.
     * Deliberately not a whole-element clone — labels, colours and selection
     * state are noise in an audit trail.
     */
    function snapshotGeometry(el) {
        if (!el) return null;
        var snap = {
            capturedAt: nowIso(),
            type: el.type || null,
            isLine: !!el.isLine,
            x: num(el.x), y: num(el.y), w: num(el.w), h: num(el.h),
            thickness: num(el.thickness),
            zHeight: num(el.zHeight),
            sillHeight: num(el.sillHeight),
            soffitHeight: num(el.soffitHeight),
            length: num(el.length),
            angle: num(el.angle),
            p1: el.p1 ? { x: num(el.p1.x), y: num(el.p1.y) } : null,
            p2: el.p2 ? { x: num(el.p2.x), y: num(el.p2.y) } : null,
            vertices: Array.isArray(el.vertices)
                ? el.vertices.map(function (v) { return { x: num(v.x), y: num(v.y) }; })
                : null
        };
        return snap;
    }

    /**
     * Build a provenance record for a newly created element.
     * `opts`: { method, actor, role, confidence, model, sheetId, geometry }
     */
    function create(el, opts) {
        opts = opts || {};
        var method = opts.method || methodFromSource(el && el.source, el);
        var role = opts.role || roleForMethod(method);
        var at = nowIso();
        return {
            schema: SCHEMA,
            method: method,
            role: role,
            actor: opts.actor || (role === ROLE.AI ? (opts.model || 'measurecraft-ai') : 'qs'),
            model: opts.model || null,
            confidence: opts.confidence != null ? num(opts.confidence)
                : (el && el.confidence != null ? num(el.confidence) : null),
            sheetId: opts.sheetId || (el && el.sheetId) || null,
            createdAt: at,
            lastEditedAt: null,
            lastEditedBy: null,
            editCount: 0,
            reviewedAt: null,
            reviewedBy: null,
            /** Geometry as first created — frozen at the first edit, never after. */
            geometrySnapshot: opts.geometry !== undefined ? opts.geometry : snapshotGeometry(el),
            snapshotAtEdit: false,
            history: []
        };
    }

    /** Return the element's provenance, creating it on demand (lazy backfill). */
    function ensure(el, opts) {
        if (!el) return null;
        if (!el.provenance || typeof el.provenance !== 'object' || !el.provenance.schema) {
            el.provenance = create(el, opts);
        }
        return el.provenance;
    }

    /**
     * Record an edit. The first edit freezes the pre-edit geometry so the
     * original proposal survives every later change.
     * `opts`: { actor, role, reason, geometryBefore }
     */
    function recordEdit(el, opts) {
        if (!el) return null;
        opts = opts || {};
        var existed = !!(el.provenance && el.provenance.schema);
        var p = ensure(el, { geometry: opts.geometryBefore });
        // Elements created through the factory already carry their as-created
        // ring. A record born here (legacy or imported elements) can only
        // snapshot the *post*-edit shape, so it is flagged rather than trusted.
        if (!existed && !opts.geometryBefore) p.snapshotAtEdit = true;
        if (!p.geometrySnapshot) {
            p.geometrySnapshot = opts.geometryBefore || snapshotGeometry(el);
            if (!opts.geometryBefore) p.snapshotAtEdit = true;
        }
        p.editCount = (p.editCount || 0) + 1;
        p.lastEditedAt = nowIso();
        p.lastEditedBy = opts.actor || 'qs';
        if (opts.reason) {
            p.history = p.history || [];
            // Keep the trail bounded — audits care about first + recent.
            if (p.history.length >= 20) p.history.splice(1, 1);
            p.history.push({ at: p.lastEditedAt, by: p.lastEditedBy, reason: opts.reason });
        }
        return p;
    }

    /** Record QS sign-off (does not touch the frozen snapshot). */
    function recordReview(el, opts) {
        if (!el) return null;
        opts = opts || {};
        var p = ensure(el);
        p.reviewedAt = nowIso();
        p.reviewedBy = opts.actor || 'qs';
        return p;
    }

    /** True when a human has changed an AI-originated measurement. */
    function wasCorrectedByHuman(el) {
        var p = el && el.provenance;
        if (!p) return false;
        return roleForMethod(p.method) === ROLE.AI && (p.editCount || 0) > 0;
    }

    /** Flat, export-friendly view (BOQ audit column, research events). */
    function summarize(el) {
        var p = ensure(el);
        if (!p) return null;
        return {
            method: p.method,
            actor: p.actor,
            role: p.role,
            confidence: p.confidence,
            editCount: p.editCount || 0,
            createdAt: p.createdAt,
            lastEditedAt: p.lastEditedAt,
            reviewedAt: p.reviewedAt,
            reviewedBy: p.reviewedBy,
            corrected: wasCorrectedByHuman(el),
            hasSnapshot: !!p.geometrySnapshot
        };
    }

    /** Human-readable one-liner for the element inspector. */
    function describe(el) {
        var s = summarize(el);
        if (!s) return '';
        var origin = s.method === METHOD.AI_DETECT ? 'AI detected'
            : s.method === METHOD.AI_AGENT ? 'Agent created'
            : s.method === METHOD.IMPORT ? 'Imported'
            : s.method === METHOD.DERIVED ? 'Derived'
            : s.method === METHOD.MANUAL_DRAW ? 'Drawn by QS'
            : 'Unknown origin';
        if (!s.editCount) return origin;
        return origin + ' · ' + s.editCount + (s.editCount === 1 ? ' edit' : ' edits');
    }

    /** Normalise a provenance object loaded from disk (old projects included). */
    function normalize(el) {
        if (!el) return null;
        var p = el.provenance;
        if (!p || typeof p !== 'object') return create(el);
        return {
            schema: SCHEMA,
            method: p.method || methodFromSource(el.source, el),
            role: p.role || roleForMethod(p.method || methodFromSource(el.source, el)),
            actor: p.actor || 'qs',
            model: p.model || null,
            confidence: p.confidence != null ? num(p.confidence) : (el.confidence != null ? num(el.confidence) : null),
            sheetId: p.sheetId || el.sheetId || null,
            createdAt: p.createdAt || nowIso(),
            lastEditedAt: p.lastEditedAt || null,
            lastEditedBy: p.lastEditedBy || null,
            editCount: Number(p.editCount) || 0,
            reviewedAt: p.reviewedAt || el.reviewedAt || null,
            reviewedBy: p.reviewedBy || null,
            geometrySnapshot: p.geometrySnapshot || null,
            snapshotAtEdit: !!p.snapshotAtEdit,
            history: Array.isArray(p.history) ? p.history.slice(-20) : []
        };
    }

    return {
        SCHEMA: SCHEMA,
        METHOD: METHOD,
        ROLE: ROLE,
        methodFromSource: methodFromSource,
        roleForMethod: roleForMethod,
        snapshotGeometry: snapshotGeometry,
        create: create,
        ensure: ensure,
        recordEdit: recordEdit,
        recordReview: recordReview,
        wasCorrectedByHuman: wasCorrectedByHuman,
        summarize: summarize,
        describe: describe,
        normalize: normalize
    };
}));
