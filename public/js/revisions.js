/**
 * MeasureCraft Revisions — named document checkpoints (beyond undo/redo).
 * Depends on nothing; UI wires into takeoff_pro via window.MCRevisions.
 */
(function (global) {
  'use strict';

  var MAX_REVISIONS = 40;

  function uid() {
    return 'rev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * @param {object} state - { elements, nextId, calibrationFactor, isConfirmed, projectInfo }
   * @param {object} meta - { name, author, note }
   */
  function createSnapshot(state, meta) {
    meta = meta || {};
    var elements = state.elements || [];
    return {
      id: uid(),
      name: meta.name || ('Snapshot ' + new Date().toLocaleString()),
      createdAt: new Date().toISOString(),
      author: meta.author || 'human',
      note: meta.note || '',
      elementCount: elements.length,
      payload: {
        elements: clone(elements),
        nextId: state.nextId,
        calibrationFactor: state.calibrationFactor,
        isConfirmed: !!state.isConfirmed,
        projectInfo: state.projectInfo ? clone(state.projectInfo) : undefined,
      },
    };
  }

  function pushRevision(list, snapshot) {
    var next = Array.isArray(list) ? list.slice() : [];
    next.unshift(snapshot);
    if (next.length > MAX_REVISIONS) next = next.slice(0, MAX_REVISIONS);
    return next;
  }

  function findRevision(list, id) {
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function renderListHtml(list) {
    if (!list || !list.length) {
      return '<div class="mc-rev-empty">No snapshots yet. Save a checkpoint after AI detect or before major edits.</div>';
    }
    return list.map(function (r) {
      var when = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
      return (
        '<div class="mc-rev-row" data-rev-id="' + escapeAttr(r.id) + '">' +
          '<div class="mc-rev-meta">' +
            '<strong>' + escapeHtml(r.name || 'Snapshot') + '</strong>' +
            '<span class="mc-rev-sub">' + escapeHtml(when) + ' · ' + (r.elementCount || 0) + ' elements · ' + escapeHtml(r.author || '') + '</span>' +
            (r.note ? '<span class="mc-rev-note">' + escapeHtml(r.note) + '</span>' : '') +
          '</div>' +
          '<div class="mc-rev-actions">' +
            '<button type="button" class="mc-rev-restore" data-rev-id="' + escapeAttr(r.id) + '" title="Restore this snapshot">Restore</button>' +
            '<button type="button" class="mc-rev-delete" data-rev-id="' + escapeAttr(r.id) + '" title="Delete snapshot">×</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  global.MCRevisions = {
    MAX_REVISIONS: MAX_REVISIONS,
    createSnapshot: createSnapshot,
    pushRevision: pushRevision,
    findRevision: findRevision,
    renderListHtml: renderListHtml,
  };
})(typeof window !== 'undefined' ? window : global);
