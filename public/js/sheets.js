/**
 * MeasureCraft multi-sheet model.
 * Each sheet owns background, calibration, and elements.
 * Attaches to window.MCSheets.
 */
(function (global) {
  'use strict';

  function uid(prefix) {
    return (prefix || 'sheet') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function createSheet(opts) {
    opts = opts || {};
    return {
      id: opts.id || uid('sheet'),
      name: opts.name || 'Sheet 1',
      pageIndex: typeof opts.pageIndex === 'number' ? opts.pageIndex : 0,
      background: opts.background || null,
      calibrationFactor: typeof opts.calibrationFactor === 'number' ? opts.calibrationFactor : 1.0,
      elements: Array.isArray(opts.elements) ? opts.elements : [],
      nextId: opts.nextId || 1,
      isConfirmed: !!opts.isConfirmed,
    };
  }

  function ensureSheets(state) {
    if (state && Array.isArray(state.sheets) && state.sheets.length) {
      return {
        sheets: state.sheets.map(function (s, i) {
          return createSheet(Object.assign({}, s, {
            name: s.name || ('Sheet ' + (i + 1)),
            pageIndex: s.pageIndex != null ? s.pageIndex : i,
          }));
        }),
        activeSheetId: state.activeSheetId || state.sheets[0].id,
      };
    }
    // Bootstrap from legacy single-drawing state
    var sheet = createSheet({
      id: 'sheet-1',
      name: (state && state.projectInfo && state.projectInfo.name) || 'Main',
      pageIndex: 0,
      background: state && state.backgroundImage,
      calibrationFactor: state && state.calibrationFactor,
      elements: (state && state.elements) || [],
      nextId: (state && state.nextId) || 1,
      isConfirmed: state && state.isConfirmed,
    });
    return { sheets: [sheet], activeSheetId: sheet.id };
  }

  function findSheet(sheets, id) {
    if (!Array.isArray(sheets)) return null;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i] && sheets[i].id === id) return sheets[i];
    }
    return null;
  }

  function captureActive(sheet, live) {
    if (!sheet) return sheet;
    sheet.elements = live.elements || [];
    sheet.nextId = live.nextId || 1;
    sheet.calibrationFactor = typeof live.calibrationFactor === 'number' ? live.calibrationFactor : 1;
    sheet.isConfirmed = !!live.isConfirmed;
    if (live.backgroundImage !== undefined) {
      sheet.background = live.backgroundImage
        ? {
            src: live.backgroundImage.src,
            w: live.backgroundImage.w,
            h: live.backgroundImage.h,
            opacity: live.backgroundImage.opacity,
            visible: live.backgroundImage.visible,
          }
        : null;
    }
    return sheet;
  }

  function renderTabsHtml(sheets, activeId) {
    if (!sheets || !sheets.length) return '';
    return sheets.map(function (s) {
      var active = s.id === activeId ? ' active' : '';
      return (
        '<button type="button" class="sheet-tab' + active + '" data-sheet-id="' + escapeAttr(s.id) + '" title="' + escapeAttr(s.name) + '">' +
        escapeHtml(s.name) +
        '</button>'
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

  global.MCSheets = {
    createSheet: createSheet,
    ensureSheets: ensureSheets,
    findSheet: findSheet,
    captureActive: captureActive,
    renderTabsHtml: renderTabsHtml,
    uid: uid,
  };
})(typeof window !== 'undefined' ? window : global);
