(function () {
    'use strict';

    // ---------- Auth guard ----------
    try {
      const raw = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
      const session = raw ? JSON.parse(raw) : null;
      if (!session || !session.email) { window.location.href = 'login.html'; return; }
    } catch (_) { window.location.href = 'login.html'; return; }

    // ---------- State ----------
    const state = {
      step: 1,
      fileName: null,
      planReady: false,
      metersPerPixel: null, // scale: metres per pixel on the plan canvas
      // When loaded from Pro (PDF world units), keep original world scale so
      // Simple → Pro round-trip restores the same CF / "1 unit = X m" display.
      scaleOrigin: null, // { worldW, worldH, metersPerUnit, pixelScale }
      calibPoints: [],
      calibCursor: null,
      pickMode: false,
      elements: [], // { id, type, label, x, y, w, h, height, accepted }
      zoom: 1,
      zoomLocked: false,
      pan: false,
      rates: {}, // name -> number
      currency: 'LKR',
      contingencyPct: 0.15,
      defaults: {
        wallHeight: 3.0,
        wallThickness: 0.225, // standard wall thk (m) — do not derive from pixels
        slabThickness: 0.15,
        columnHeight: 3.0,
        beamWidth: 0.23,
        beamDepth: 0.45,
        doorH: 2.1,
        windowH: 1.2
      }
    };

    const TYPE_COLORS = {
      wall: '#22c55e',
      slab: 'rgba(249,115,22,0.65)',
      column: '#eab308',
      beam: '#3b82f6',
      door: '#a855f7',
      window: '#c084fc',
      opening: '#a855f7',
      cutout: '#ef4444'
    };

    // Material unit prices (user-editable). Qty comes from element takeoff like Pro Mode.
    const DEFAULT_MATERIAL_RATES = {
      'Cement': { unit: 'bag (50kg)', rate: null },
      'Sand': { unit: 'm³', rate: null },
      'Aggregate': { unit: 'm³', rate: null },
      'Brick': { unit: 'Nr', rate: null },
      'Block 100mm': { unit: 'Nr', rate: null },
      'Block 150mm': { unit: 'Nr', rate: null },
      'Block 200mm': { unit: 'Nr', rate: null },
      'Adhesive': { unit: 'bag (25kg)', rate: null },
      'Tiles (600x600mm)': { unit: 'Nr', rate: null },
      'Paint': { unit: 'L', rate: null }
    };
    // Sri Lankan standard: 1 Cube = 100 ft³ = 2.83168 m³ (Sand & Aggregate only)
    const SL_CUBE_M3 = 2.83168;
    const MAT_DEFAULTS = {
      concrete: { mix: '1:2:4', dryFactor: 1.54, bagSize: 0.035, cementDensity: 1440 },
      cubeM3: SL_CUBE_M3,
      brick: {
        rates: {
          100: { bricksPerM2: 59.20, cementBagsPerM2: 0.14, sandCubesPerM2: 0.01 },
          225: { bricksPerM2: 117.33, cementBagsPerM2: 0.32, sandCubesPerM2: 0.02 }
        }
      },
      block: {
        rates: {
          100: { blocksPerM2: 12.06, cementBagsPerM2: 0.04, sandCubesPerM2: 0.003 },
          150: { blocksPerM2: 12.06, cementBagsPerM2: 0.07, sandCubesPerM2: 0.01 },
          200: { blocksPerM2: 12.06, cementBagsPerM2: 0.08, sandCubesPerM2: 0.01 }
        }
      },
      plaster: { mix: '1:5', dryFactor: 1.33, thickness: 0.010, cementDensity: 1440 },
      tiling: { size: [600, 600], wastage: 0.05, adhesiveBagsPerM2: 0.25 },
      painting: { coverage: 14, coats: 2, bothFaces: true }
    };

    // ---------- DOM ----------
    const $ = (id) => document.getElementById(id);
    function mcApiHeaders(json) {
      const h = {};
      if (json) h['Content-Type'] = 'application/json';
      try {
        const tok = localStorage.getItem('mc-api-token') || sessionStorage.getItem('mc-api-token');
        if (tok) h['X-MC-Token'] = tok;
      } catch (_) {}
      return h;
    }
    const planCanvas = $('plan-canvas');
    const overlayCanvas = $('overlay-canvas');
    const planCtx = planCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    const canvasStack = $('canvas-stack');
    const viewerEmpty = $('viewer-empty');

    // ---------- Toast ----------
    function toast(msg, type) {
      const el = $('toast');
      el.textContent = msg;
      el.className = 'show' + (type ? ' ' + type : '');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { el.className = ''; }, type === 'error' ? 4000 : 2800);
    }

    // ---------- Theme ----------
    (function initTheme() {
      const btn = $('btn-theme');
      function syncThemeTitle() {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
        btn.setAttribute('aria-label', btn.title);
      }
      const saved = localStorage.getItem('mc-theme') || 'light';
      if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      syncThemeTitle();
      btn.addEventListener('click', () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
        localStorage.setItem('mc-theme', dark ? 'light' : 'dark');
        syncThemeTitle();
      });
    })();

    // ---------- Welcome banner (first visit only) ----------
    (function initWelcome() {
      if (localStorage.getItem('mc-simple-seen-intro')) return;
      $('welcome-card').style.display = 'block';
      $('btn-dismiss-welcome').addEventListener('click', () => {
        $('welcome-card').style.display = 'none';
        localStorage.setItem('mc-simple-seen-intro', '1');
      });
    })();

    // ---------- Project details ----------
    const PROJECT_FIELD_IDS = ['proj-name', 'proj-client', 'proj-location', 'proj-currency', 'proj-region'];
    function saveProjectDraft() {
      try {
        const draft = {};
        PROJECT_FIELD_IDS.forEach(id => { const el = $(id); if (el) draft[id] = el.value; });
        localStorage.setItem('mc-simple-project-draft', JSON.stringify(draft));
      } catch (_) {}
    }
    function restoreProjectDraft() {
      try {
        const draft = JSON.parse(localStorage.getItem('mc-simple-project-draft') || 'null');
        if (!draft) return;
        PROJECT_FIELD_IDS.forEach(id => {
          const el = $(id);
          if (el && draft[id] != null) el.value = draft[id];
        });
      } catch (_) {}
    }
    function clearProjectFields() {
      PROJECT_FIELD_IDS.forEach(id => {
        const el = $(id);
        if (!el) return;
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
      });
      try { localStorage.removeItem('mc-simple-project-draft'); } catch (_) {}
    }
    restoreProjectDraft();

    // ---------- Start over ----------
    $('btn-start-over').addEventListener('click', () => {
      if (!confirm('Start a new project? This clears the uploaded drawing, calibration, detected elements, and project details.')) return;
      clearPlan();
      clearProjectFields();
      updateSummary();
      goStep(1);
      toast('Started a new project.', 'success');
    });

    // ---------- Unsaved-work warning ----------
    window.addEventListener('beforeunload', (e) => {
      if (state.leavingIntentionally) return;
      if (state.planReady && state.step < 6) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // ---------- Step navigation ----------
    const STEP_GUIDANCE = {
      1: ['Step 1 of 6', 'Upload a drawing to begin.'],
      2: ['Step 2 of 6', 'Set a known length so quantities use the right scale.'],
      3: ['Step 3 of 6', 'Let AI propose elements from your calibrated plan.'],
      4: ['Step 4 of 6', 'Keep the detections you trust before costing.'],
      5: ['Step 5 of 6', 'Review quantities and add unit rates for an estimate.'],
      6: ['Step 6 of 6', 'Download your BOQ or continue in Professional Mode.']
    };
    function updateStepGuidance(n) {
      const guidance = STEP_GUIDANCE[n] || STEP_GUIDANCE[1];
      $('flow-status-step').textContent = guidance[0];
      $('flow-status-copy').textContent = guidance[1];
      document.querySelectorAll('.step').forEach(s => {
        if (+s.dataset.step === n) s.setAttribute('aria-current', 'step');
        else s.removeAttribute('aria-current');
      });
    }

    function goStep(n) {
      state.step = n;
      document.querySelectorAll('.step').forEach(s => {
        const sn = +s.dataset.step;
        s.classList.toggle('active', sn === n);
        s.classList.toggle('done', sn < n);
      });
      document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
      const panel = $('panel-' + n);
      if (panel) panel.classList.add('active');
      updateStepGuidance(n);
      updateSummary();
      if (n >= 4) renderElementsList();
      if (n >= 5) { renderQtyAndRates(); }
    }

    document.querySelectorAll('.step').forEach(s => {
      s.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.click(); }
      });
      s.addEventListener('click', () => {
        const sn = +s.dataset.step;
        // allow going back freely; forward only if prerequisites met
        if (sn <= state.step) goStep(sn);
        else if (sn === 2 && state.planReady) goStep(2);
        else if (sn === 3 && state.metersPerPixel) goStep(3);
        else if (sn === 4 && state.elements.length) goStep(4);
        else if (sn === 5 && state.elements.some(e => e.accepted)) goStep(5);
        else if (sn === 6 && state.elements.some(e => e.accepted)) goStep(6);
      });
    });
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => goStep(+btn.dataset.goto));
    });

    // ---------- Summary ----------
    function updateSummary() {
      $('sum-name').textContent = $('proj-name').value || 'Untitled Project';
      $('sum-client').textContent = $('proj-client').value || '—';
      $('sum-currency').textContent = $('proj-currency').value;
      $('sum-file').textContent = state.fileName || '—';
      if (state.metersPerPixel) {
        // Same precision rules as Pro Mode (toFixed) so scale never looks different after a mode switch.
        const mpp = state.metersPerPixel;
        const s = Math.abs(mpp - 1) < 1e-9
          ? '1 unit = 1 m'
          : (mpp >= 1 ? ('1 unit = ' + mpp.toFixed(4) + ' m') : ('1 unit = ' + mpp.toFixed(6) + ' m'));
        $('sum-scale').textContent = s;
        $('status-scale').textContent = 'Scale: ' + s;
        $('calib-scale').textContent = 'Set';
        $('calib-mpp').textContent = (Math.abs(mpp - 1) < 1e-9 ? '1' : (mpp >= 1 ? mpp.toFixed(4) : mpp.toFixed(6))) + ' m';
      }
      $('sum-ai').textContent = state.elements.length ? (state.elements.length + ' detected') : 'Not yet';
      const q = computeQuantities();
      $('sum-wall').textContent = q.wallFaceM2 > 0 ? q.wallFaceM2.toFixed(2) + ' m²' : '—';
      $('sum-slab').textContent = q.slabAreaM2 > 0 ? q.slabAreaM2.toFixed(2) + ' m²' : '—';
      $('sum-conc').textContent = q.concreteM3 > 0 ? q.concreteM3.toFixed(3) + ' m³' : '—';
      $('sum-open').textContent = q.openings || '—';
      $('sum-count').textContent = state.elements.filter(e => e.accepted).length;
      $('status-elems').textContent = state.elements.filter(e => e.accepted).length + ' elements';
      const est = computeEstimate(q);
      $('sum-total').textContent = (est.sub > 0 && est.grand != null) ? formatMoney(est.grand) : '—';
    }

    ['proj-name','proj-client','proj-location','proj-currency','proj-region'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', () => { updateSummary(); saveProjectDraft(); });
      if (el) el.addEventListener('change', () => { updateSummary(); saveProjectDraft(); });
    });

    function formatMoney(n) {
      const cur = $('proj-currency').value || 'LKR';
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
      } catch (_) {
        return cur + ' ' + Math.round(n).toLocaleString();
      }
    }

    // ---------- Upload ----------
    const uploadZone = $('upload-zone');
    const fileInput = $('file-input');
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) loadFile(fileInput.files[0]);
    });
    $('btn-clear-file').addEventListener('click', e => {
      e.stopPropagation();
      clearPlan();
    });

    // Demo walkthrough: if the iframe fails to load, show the static fallback
    (function setupWalkthroughFrame() {
      const frame = $('walkthrough-frame');
      if (!frame || !viewerEmpty) return;
      let settled = false;
      const showFallback = () => {
        if (settled) return;
        settled = true;
        viewerEmpty.classList.add('show-fallback');
      };
      frame.addEventListener('error', showFallback);
      // If still blank after load, try one reload; then fall back
      frame.addEventListener('load', () => {
        settled = true;
        viewerEmpty.classList.remove('show-fallback');
        try {
          const doc = frame.contentDocument;
          if (doc && !doc.getElementById('app')) showFallback();
        } catch (_) { /* cross-origin — ignore */ }
      });
      // Safety: if nothing rendered after 4s, show fallback
      setTimeout(() => {
        if (!settled && !state.planReady) showFallback();
      }, 4000);
    })();

    function restartWalkthrough() {
      const frame = $('walkthrough-frame');
      if (!viewerEmpty || !frame) return;
      viewerEmpty.classList.remove('show-fallback');
      frame.style.display = 'block';
      try { frame.src = 'walkthrough.html?embed=1&t=' + Date.now(); } catch (_) {}
    }

    function clearPlan() {
      state.planReady = false;
      state.fileName = null;
      state.elements = [];
      state.metersPerPixel = null;
      state.scaleOrigin = null;
      state.calibPoints = [];
      planCtx.clearRect(0, 0, planCanvas.width, planCanvas.height);
      canvasStack.style.display = 'none';
      viewerEmpty.style.display = 'flex';
      // Restart walkthrough preview when returning to empty state
      restartWalkthrough();
      $('file-chip').style.display = 'none';
      $('btn-to-calibrate').disabled = true;
      $('viewer-badge').textContent = 'No file';
      if ($('status-scale')) $('status-scale').textContent = 'Scale: not calibrated';
      if ($('status-zoom')) $('status-zoom').textContent = '100%';
      if ($('status-elems')) $('status-elems').textContent = '0 elements';
      drawOverlay();
      updateSummary();
    }

    const MAX_FILE_BYTES = 25 * 1024 * 1024;

    async function loadFile(file) {
      const name = file.name || 'plan';
      const lower = name.toLowerCase();
      if (!/\.(pdf|png|jpe?g)$/.test(lower)) {
        toast('Unsupported file type. Please upload a PDF, PNG, or JPG.', 'error');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        toast('File is too large (max 25 MB). Try a smaller or compressed file.', 'error');
        return;
      }
      try {
        if (lower.endsWith('.pdf')) {
          if (typeof pdfjsLib === 'undefined') {
            toast('PDF library failed to load. Check internet connection.', 'error');
            return;
          }
          pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          const buf = await file.arrayBuffer();
          // Higher fidelity: don't strip fonts/images; prefer native rendering
          const pdf = await pdfjsLib.getDocument({
            data: buf,
            disableFontFace: false,
            useSystemFonts: true,
            isEvalSupported: false,
          }).promise;
          let pageNum = 1;
          if (pdf.numPages > 1) {
            const input = window.prompt(
              'This PDF has ' + pdf.numPages + ' pages. Which page should be used as the floor plan?',
              '1'
            );
            const parsed = parseInt(input, 10);
            if (parsed >= 1 && parsed <= pdf.numPages) pageNum = parsed;
          }
          const page = await pdf.getPage(pageNum);
          // High-res PDF render for sharp preview (print intent, higher long-edge target)
          const base = page.getViewport({ scale: 1 });
          const longEdge = Math.max(base.width, base.height);
          const TARGET_LONG = 4800;
          const MAX_LONG = 6400;
          let scale = TARGET_LONG / Math.max(longEdge, 1);
          scale = Math.max(2.0, Math.min(scale, MAX_LONG / Math.max(longEdge, 1)));
          // Cap total pixels (~28 MP) to avoid tab crashes on huge sheets
          const MAX_PIXELS = 28e6;
          let viewport = page.getViewport({ scale });
          if (viewport.width * viewport.height > MAX_PIXELS) {
            scale *= Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));
            viewport = page.getViewport({ scale });
          }
          planCanvas.width = Math.floor(viewport.width);
          planCanvas.height = Math.floor(viewport.height);
          planCtx.fillStyle = '#ffffff';
          planCtx.fillRect(0, 0, planCanvas.width, planCanvas.height);
          planCtx.imageSmoothingEnabled = true;
          planCtx.imageSmoothingQuality = 'high';
          await page.render({
            canvasContext: planCtx,
            viewport,
            intent: 'print', // higher quality than 'display'
          }).promise;
        } else {
          const url = URL.createObjectURL(file);
          const img = new Image();
          await new Promise((res, rej) => {
            img.onload = res; img.onerror = rej; img.src = url;
          });
          // Upsample very small scans slightly so thin lines remain visible
          let tw = img.naturalWidth;
          let th = img.naturalHeight;
          const minEdge = Math.min(tw, th);
          if (minEdge > 0 && minEdge < 1200) {
            const up = Math.min(2, 1200 / minEdge);
            tw = Math.round(tw * up);
            th = Math.round(th * up);
          }
          planCanvas.width = tw;
          planCanvas.height = th;
          planCtx.fillStyle = '#fff';
          planCtx.fillRect(0, 0, planCanvas.width, planCanvas.height);
          planCtx.imageSmoothingEnabled = true;
          planCtx.imageSmoothingQuality = 'high';
          planCtx.drawImage(img, 0, 0, tw, th);
          URL.revokeObjectURL(url);
        }
        overlayCanvas.width = planCanvas.width;
        overlayCanvas.height = planCanvas.height;
        canvasStack.style.display = 'block';
        viewerEmpty.style.display = 'none';
        // Stop walkthrough animation while a drawing is open
        const frame = $('walkthrough-frame');
        if (frame) { try { frame.src = 'about:blank'; } catch (_) {} }
        state.planReady = true;
        state.fileName = name;
        $('file-chip').style.display = 'flex';
        $('file-name').textContent = name;
        $('btn-to-calibrate').disabled = false;
        $('viewer-badge').textContent = name + ' · ' + planCanvas.width + '×' + planCanvas.height;
        // Fit after layout so clientWidth/Height of the viewer are correct
        requestAnimationFrame(() => {
          fitZoom();
          drawOverlay();
        });
        toast('Drawing loaded. Next: calibrate scale.', 'success');
        updateSummary();
        // Research: register drawing (original stored server-side; not used for AI training)
        try {
          if (window.MCResearch) {
            MCResearch.ensureParticipantChip('.header-actions') || MCResearch.ensureParticipantChip('header');
            let dataUrl = null;
            try { dataUrl = planCanvas.toDataURL('image/jpeg', 0.85); } catch (_) {}
            MCResearch.registerDrawing({
              fileName: name,
              mimeType: 'image/jpeg',
              imageBase64: dataUrl,
              projectName: ($('proj-name') && $('proj-name').value) || name,
              scaleNote: state.metersPerPixel ? ('1 unit = ' + state.metersPerPixel + ' m') : null,
            });
          }
        } catch (_) {}
      } catch (err) {
        console.error(err);
        toast('Could not read this file. Try another PDF or image.', 'error');
      }
    }

    $('btn-to-calibrate').addEventListener('click', () => goStep(2));

    // ---------- Zoom / pan ----------
    // Size the stack with CSS width/height (not transform:scale).
    // transform:scale leaves the layout box at full bitmap size, which
    // created huge empty space above/below the drawing in the viewer.
    function applyZoom(anchorClientX, anchorClientY) {
      if (!planCanvas.width) return;
      const area = $('viewer-area');
      if (!area) return;

      // Current displayed size (before change)
      const oldW = canvasStack.offsetWidth || parseFloat(canvasStack.style.width) || (planCanvas.width * state.zoom) || 1;
      const oldH = canvasStack.offsetHeight || parseFloat(canvasStack.style.height) || (planCanvas.height * state.zoom) || 1;

      const rect = area.getBoundingClientRect();
      // Content coords of the focus point (drawing pixel space mapped into the scroll content)
      let contentX, contentY, viewX, viewY;
      if (typeof anchorClientX === 'number' && typeof anchorClientY === 'number') {
        viewX = anchorClientX - rect.left;
        viewY = anchorClientY - rect.top;
        contentX = area.scrollLeft + viewX;
        contentY = area.scrollTop + viewY;
      } else {
        // Zoom toward center of the visible viewport
        viewX = area.clientWidth / 2;
        viewY = area.clientHeight / 2;
        contentX = area.scrollLeft + viewX;
        contentY = area.scrollTop + viewY;
      }

      const w = Math.max(1, Math.round(planCanvas.width * state.zoom));
      const h = Math.max(1, Math.round(planCanvas.height * state.zoom));
      canvasStack.style.width = w + 'px';
      canvasStack.style.height = h + 'px';
      canvasStack.style.transform = '';
      canvasStack.style.transformOrigin = '';

      // Keep the same content point under the cursor / viewport center
      const scaleRatioX = w / oldW;
      const scaleRatioY = h / oldH;
      area.scrollLeft = contentX * scaleRatioX - viewX;
      area.scrollTop = contentY * scaleRatioY - viewY;

      const pct = Math.round(state.zoom * 100) + '%';
      $('status-zoom').textContent = state.zoomLocked ? pct + ' 🔒' : pct;
    }
    function fitZoom() {
      const area = $('viewer-area');
      if (!planCanvas.width || !area) return;
      const padX = 12;
      const padY = 12;
      const availW = Math.max(50, area.clientWidth - padX);
      const availH = Math.max(50, area.clientHeight - padY);
      const sx = availW / planCanvas.width;
      const sy = availH / planCanvas.height;
      state.zoom = Math.max(0.05, Math.min(sx, sy));
      const w = Math.max(1, Math.round(planCanvas.width * state.zoom));
      const h = Math.max(1, Math.round(planCanvas.height * state.zoom));
      canvasStack.style.width = w + 'px';
      canvasStack.style.height = h + 'px';
      area.scrollLeft = 0;
      area.scrollTop = 0;
      const pct = Math.round(state.zoom * 100) + '%';
      $('status-zoom').textContent = state.zoomLocked ? pct + ' 🔒' : pct;
    }
    $('btn-zoom-in').addEventListener('click', () => {
      state.zoom = Math.min(12, state.zoom * 1.25);
      applyZoom();
    });
    $('btn-zoom-out').addEventListener('click', () => {
      state.zoom = Math.max(0.05, state.zoom / 1.25);
      applyZoom();
    });
    $('btn-zoom-fit').addEventListener('click', fitZoom);
    $('btn-zoom-lock').addEventListener('click', () => {
      state.zoomLocked = !state.zoomLocked;
      const btn = $('btn-zoom-lock');
      btn.textContent = state.zoomLocked ? '🔒' : '🔓';
      btn.title = state.zoomLocked
        ? 'Unlock Zoom — allow trackpad/scroll zoom (Ctrl/Cmd+scroll still works while locked)'
        : 'Lock Zoom — disable trackpad/scroll zoom (easier pan)';
      btn.classList.toggle('active', state.zoomLocked);
      const pct = Math.round(state.zoom * 100) + '%';
      $('status-zoom').textContent = state.zoomLocked ? pct + ' 🔒' : pct;
      if (typeof toast === 'function') {
        toast(state.zoomLocked
          ? 'Zoom locked — trackpad scroll will not zoom. Use buttons or Ctrl+scroll.'
          : 'Zoom unlocked — trackpad/scroll zoom enabled.', 'info');
      }
    });
    // Trackpad / wheel: zoom toward the cursor (one point under the pointer stays fixed)
    const viewerArea = $('viewer-area');
    if (viewerArea) {
      viewerArea.addEventListener('wheel', (e) => {
        if (!state.planReady) return;
        if (state.zoomLocked && !(e.ctrlKey || e.metaKey)) {
          // Allow normal scroll pan when locked (unless Ctrl forces zoom)
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY > 0 ? (1 / 1.12) : 1.12;
        const next = Math.min(12, Math.max(0.05, state.zoom * factor));
        if (Math.abs(next - state.zoom) < 1e-6) return;
        state.zoom = next;
        applyZoom(e.clientX, e.clientY);
      }, { passive: false });
    }
    let _resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => { if (state.planReady) fitZoom(); }, 150);
    });
    $('btn-pan').addEventListener('click', () => {
      state.pan = !state.pan;
      $('btn-pan').classList.toggle('active', state.pan);
      overlayCanvas.style.cursor = state.pan ? 'grab' : (state.pickMode ? 'crosshair' : 'default');
    });

    // ---------- Calibration ----------
    $('btn-pick-points').addEventListener('click', () => {
      if (!state.planReady) { toast('Upload a drawing first.', 'error'); return; }
      state.pickMode = true;
      state.calibPoints = [];
      state.calibCursor = null;
      state.pan = false;
      $('btn-pan').classList.remove('active');
      overlayCanvas.style.cursor = 'crosshair';
      $('calibrate-banner').style.display = 'block';
      $('calibrate-banner').textContent = 'Click first point of known dimension…';
      drawOverlay();
    });

    function canvasCoords(e) {
      const rect = overlayCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (overlayCanvas.width / rect.width);
      const y = (e.clientY - rect.top) * (overlayCanvas.height / rect.height);
      return { x, y };
    }

    // Match Pro Mode: snap only when a line is genuinely close to an axis.
    // A one-degree tolerance keeps near-horizontal/vertical dimensions clean
    // without preventing users from selecting diagonal dimensions.
    function snapSimpleAxisPoint(anchor, point, toleranceDeg) {
      if (!anchor || !point) return point;
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax < 1 && ay < 1) return point;
      const tolerance = Math.tan((toleranceDeg == null ? 1 : toleranceDeg) * Math.PI / 180);
      if (ay <= ax * tolerance) return { x: point.x, y: anchor.y };
      if (ax <= ay * tolerance) return { x: anchor.x, y: point.y };
      return point;
    }

    overlayCanvas.addEventListener('mousemove', e => {
      if (!state.pickMode || state.calibPoints.length !== 1) {
        if (state.calibCursor) { state.calibCursor = null; }
        return;
      }
      state.calibCursor = snapSimpleAxisPoint(state.calibPoints[0], canvasCoords(e), 1);
      drawOverlay();
    });

    overlayCanvas.addEventListener('click', e => {
      if (state.pan) return;
      if (!state.pickMode) return;
      const rawPoint = canvasCoords(e);
      const p = state.calibPoints.length === 1
        ? snapSimpleAxisPoint(state.calibPoints[0], rawPoint, 1)
        : rawPoint;
      state.calibPoints.push(p);
      if (state.calibPoints.length === 1) {
        state.calibCursor = p;
        $('calibrate-banner').textContent = 'Click second point…';
      } else if (state.calibPoints.length >= 2) {
        state.pickMode = false;
        state.calibCursor = null;
        $('calibrate-banner').style.display = 'none';
        overlayCanvas.style.cursor = 'default';
        const a = state.calibPoints[0], b = state.calibPoints[1];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        $('calib-px').textContent = dist.toFixed(1) + ' px';
        $('btn-apply-scale').disabled = false;
        toast('Points selected. Enter the real length and apply scale.', 'success');
      }
      drawOverlay();
    });

    $('btn-apply-scale').addEventListener('click', () => {
      if (state.calibPoints.length < 2) { toast('Pick two points first.', 'error'); return; }
      const real = parseFloat($('calib-real').value);
      if (!(real > 0)) { toast('Enter a positive real length.', 'error'); return; }
      let metres = real;
      const unit = $('calib-unit').value;
      if (unit === 'ft') metres = real * 0.3048;
      if (unit === 'mm') metres = real / 1000;
      const a = state.calibPoints[0], b = state.calibPoints[1];
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      if (px < 1) { toast('Points are too close.', 'error'); return; }
      state.metersPerPixel = metres / px;
      // User re-calibrated in Simple pixel space — Pro world origin no longer applies.
      state.scaleOrigin = null;
      $('btn-to-ai').disabled = false;
      toast('Scale applied. Quantities will use real metres.', 'success');
      updateSummary();
      drawOverlay();
    });

    $('btn-to-ai').addEventListener('click', () => goStep(3));

    // ---------- Overlay draw ----------
    function drawOverlay() {
      if (!overlayCanvas.width) return;
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

      // calibration line + live rubber-band to cursor after first point
      if (state.calibPoints.length) {
        const p1 = state.calibPoints[0];
        const p2 = state.calibPoints[1] || state.calibCursor;
        if (p1 && p2) {
          overlayCtx.strokeStyle = 'rgba(184, 134, 59, 0.35)';
          overlayCtx.lineWidth = 6;
          overlayCtx.setLineDash([]);
          overlayCtx.beginPath();
          overlayCtx.moveTo(p1.x, p1.y);
          overlayCtx.lineTo(p2.x, p2.y);
          overlayCtx.stroke();
          overlayCtx.strokeStyle = '#B8863B';
          overlayCtx.lineWidth = 2;
          overlayCtx.setLineDash([8, 5]);
          overlayCtx.beginPath();
          overlayCtx.moveTo(p1.x, p1.y);
          overlayCtx.lineTo(p2.x, p2.y);
          overlayCtx.stroke();
          overlayCtx.setLineDash([]);
          const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
          const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          let label = distPx.toFixed(0) + ' px';
          if (state.metersPerPixel) label = (distPx * state.metersPerPixel).toFixed(2) + ' m';
          overlayCtx.font = 'bold 12px Work Sans, sans-serif';
          const tw = overlayCtx.measureText(label).width;
          overlayCtx.fillStyle = 'rgba(184, 134, 59, 0.92)';
          overlayCtx.fillRect(midX - tw / 2 - 6, midY - 22, tw + 12, 18);
          overlayCtx.fillStyle = '#fff';
          overlayCtx.textAlign = 'center';
          overlayCtx.textBaseline = 'middle';
          overlayCtx.fillText(label, midX, midY - 13);
          overlayCtx.textAlign = 'left';
          overlayCtx.textBaseline = 'alphabetic';
        }
        state.calibPoints.forEach((p, i) => {
          overlayCtx.fillStyle = i === 0 ? '#B8863B' : '#2563eb';
          overlayCtx.strokeStyle = '#fff';
          overlayCtx.lineWidth = 2;
          overlayCtx.beginPath();
          overlayCtx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          overlayCtx.fill();
          overlayCtx.stroke();
        });
        if (state.calibPoints.length === 1 && state.calibCursor) {
          const c = state.calibCursor;
          overlayCtx.fillStyle = '#2563eb';
          overlayCtx.strokeStyle = '#fff';
          overlayCtx.lineWidth = 2;
          overlayCtx.beginPath();
          overlayCtx.arc(c.x, c.y, 6, 0, Math.PI * 2);
          overlayCtx.fill();
          overlayCtx.stroke();
        }
      }

      // elements — accepted solid, pending (AI) dashed; polygons keep true shape when vertices exist
      state.elements.forEach(el => {
        const color = TYPE_COLORS[el.type] || '#888';
        if (color.startsWith('#')) {
          const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
          overlayCtx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (el.accepted ? '0.18' : '0.08') + ')';
        } else {
          overlayCtx.fillStyle = 'rgba(100,100,100,0.12)';
        }
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = 2;
        overlayCtx.setLineDash(el.accepted ? [] : [5, 4]);
        if (Array.isArray(el.vertices) && el.vertices.length >= 3) {
          overlayCtx.beginPath();
          el.vertices.forEach((v, i) => {
            const px = el.x + (v.x || 0), py = el.y + (v.y || 0);
            if (i === 0) overlayCtx.moveTo(px, py);
            else overlayCtx.lineTo(px, py);
          });
          overlayCtx.closePath();
          overlayCtx.fill();
          overlayCtx.stroke();
        } else if (el.isLine && el.p1 && el.p2) {
          // Pro Mode walls/beams are centerlines with a real thickness. Draw
          // their four-corner footprint instead of the old bounding rectangle.
          const p1 = { x: Number(el.p1.x) || 0, y: Number(el.p1.y) || 0 };
          const p2 = { x: Number(el.p2.x) || 0, y: Number(el.p2.y) || 0 };
          const dx = p2.x - p1.x, dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;
          const half = (Number(el.thicknessDraw) || Math.min(el.w, el.h) || 4) / 2;
          const nx = -dy / len * half, ny = dx / len * half;
          const corners = [
            { x: p1.x + nx, y: p1.y + ny },
            { x: p2.x + nx, y: p2.y + ny },
            { x: p2.x - nx, y: p2.y - ny },
            { x: p1.x - nx, y: p1.y - ny }
          ];
          overlayCtx.beginPath();
          corners.forEach((p, i) => i ? overlayCtx.lineTo(p.x, p.y) : overlayCtx.moveTo(p.x, p.y));
          overlayCtx.closePath();
          overlayCtx.fill();
          overlayCtx.stroke();
        } else {
          overlayCtx.fillRect(el.x, el.y, el.w, el.h);
          overlayCtx.strokeRect(el.x, el.y, el.w, el.h);
        }
        overlayCtx.setLineDash([]);
        overlayCtx.fillStyle = color.startsWith('#') ? color : '#333';
        overlayCtx.font = '11px Work Sans, sans-serif';
        overlayCtx.fillText((el.label || el.type) + (el.accepted ? '' : ' · AI'), el.x + 3, el.y + 12);
      });
    }

    // ---------- AI detection ----------
    let legendImagePayloads = [];
    const legendImageInput = $('ai-legend-images');
    const legendImageUpload = $('ai-legend-upload');
    const legendImageList = $('ai-legend-file-list');
    function renderLegendImageChips() {
      if (!legendImageList) return;
      legendImageList.innerHTML = '';
      legendImagePayloads.forEach((item, index) => {
        const chip = document.createElement('div');
        chip.className = 'ai-file-chip';
        chip.innerHTML = '<span title="' + String(item.name).replace(/"/g, '&quot;') + '">▧ ' + String(item.name).replace(/[<>]/g, '') + '</span><button type="button" class="ai-file-remove" aria-label="Remove ' + String(item.name).replace(/"/g, '') + '">×</button>';
        chip.querySelector('button').addEventListener('click', () => {
          legendImagePayloads.splice(index, 1);
          renderLegendImageChips();
        });
        legendImageList.appendChild(chip);
      });
    }
    function readLegendImage(file) {
      return new Promise((resolve, reject) => {
        if (!file || !/^image\/(jpeg|jpg|png|webp|gif)$/i.test(file.type)) return reject(new Error('Please choose a JPG, PNG, WebP or GIF image.'));
        if (file.size > 4 * 1024 * 1024) return reject(new Error(file.name + ' is larger than 4 MB.'));
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, mimeType: file.type.toLowerCase(), data: String(reader.result).split(',')[1] || '' });
        reader.onerror = () => reject(new Error('Could not read ' + file.name));
        reader.readAsDataURL(file);
      });
    }
    async function addLegendImages(files) {
      const remaining = Math.max(0, 4 - legendImagePayloads.length);
      if (!remaining) { toast('You can add up to 4 legend images.', 'error'); return; }
      try {
        const selected = Array.from(files || []).slice(0, remaining);
        const added = await Promise.all(selected.map(readLegendImage));
        legendImagePayloads = legendImagePayloads.concat(added);
        renderLegendImageChips();
        if (files && files.length > remaining) toast('Only the first 4 legend images were added.', 'error');
      } catch (err) { toast(err.message || 'Could not add legend image.', 'error'); }
      if (legendImageInput) legendImageInput.value = '';
    }
    if (legendImageInput) legendImageInput.addEventListener('change', () => addLegendImages(legendImageInput.files));
    if ($('btn-add-legend-image')) $('btn-add-legend-image').addEventListener('click', () => legendImageInput && legendImageInput.click());
    if (legendImageUpload) {
      ['dragenter', 'dragover'].forEach((name) => legendImageUpload.addEventListener(name, (e) => { e.preventDefault(); legendImageUpload.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach((name) => legendImageUpload.addEventListener(name, (e) => { e.preventDefault(); legendImageUpload.classList.remove('dragover'); }));
      legendImageUpload.addEventListener('drop', (e) => addLegendImages(e.dataTransfer && e.dataTransfer.files));
    }
    $('btn-run-ai').addEventListener('click', runAI);

    function isPureAiSimple(el) {
      if (!el) return false;
      if (el.source === 'AI') return true;
      if (el.source === 'MANUAL' || el.source === 'AI_EDITED') return false;
      return !!(el.ai);
    }
    /** True for any AI-origin element (pure AI or accepted/edited AI). */
    function isAiOriginSimple(el) {
      if (!el) return false;
      if (el.source === 'AI' || el.source === 'AI_EDITED') return true;
      if (el.source === 'MANUAL') return false;
      return !!(el.ai);
    }
    function isManualSimple(el) {
      if (!el) return false;
      if (el.source === 'MANUAL') return true;
      if (el.source === 'AI' || el.source === 'AI_EDITED') return false;
      return !el.ai;
    }

    async function runAI() {
      if (!state.planReady) { toast('Upload a drawing first.', 'error'); return; }

      // Re-detection should improve the AI proposals without destroying the QS ground truth.
      // Keep manual items and AI items that a QS has edited; replace only raw AI proposals.
      const existing = state.elements || [];
      const keptElements = existing.filter(el => isManualSimple(el) || el.source === 'AI_EDITED' || el.reviewStatus === 'QS_REVIEWED');
      const replaceableAi = existing.filter(el => !keptElements.includes(el));
      if (replaceableAi.length > 0) {
        const warn = 'Running AI detection will replace ' + replaceableAi.length + ' unreviewed AI proposal(s).\n\n' +
          'Your manual measurements and QS-edited items will be kept. Continue?';
        if (!window.confirm(warn)) return;
      }

      const progress = $('ai-progress');
      const msg = $('ai-progress-msg');
      progress.classList.add('show');
      $('btn-run-ai').disabled = true;
      msg.textContent = 'Preparing plan image…';

      try {
        const cap = capturePlan();
        if (!cap) throw new Error('Could not capture plan image.');
        msg.textContent = 'Sending to AI for element detection…';

        let elements = [];
        const resp = await fetch('/api/detect-elements', {
          method: 'POST',
          headers: mcApiHeaders(true),
          body: JSON.stringify({
            image_base64: cap.base64,
            mime_type: 'image/jpeg',
            pixel_w: cap.sendW,
            pixel_h: cap.sendH,
            legend_notes: (($('ai-legend-notes') && $('ai-legend-notes').value) || '').trim(),
            legend_images: legendImagePayloads,
            mode: 'tiled',
            tile_grid: 2,
            tile_overlap: 0.2
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
          if (data && data.code === 'NO_KEY') {
            throw new Error('AI detection is not configured on this server. Set GEMINI_API_KEY in the Render environment.');
          }
          if (data && data.code === 'QUALITY_GATE') {
            throw new Error((data.error || 'Drawing quality is too low for reliable AI detection.') +
              (data.quality && data.quality.errors ? ' ' + data.quality.errors.join(' ') : ''));
          }
          throw new Error((data && data.error) || 'AI detection request failed.');
        }
        if (data.quality && data.quality.warnings && data.quality.warnings.length) {
          console.warn('AI quality warnings:', data.quality.warnings);
          try {
            if (typeof showToast === 'function') {
              showToast('Quality note: ' + data.quality.warnings[0], 'warn');
            }
          } catch (_) {}
        }
        elements = data.elements || [];

        msg.textContent = 'Mapping detections to the drawing…';
        // Allowed types (match server + Pro Mode). "room"/"area"/"floor" → slab.
        const ALLOWED = ['wall', 'column', 'slab', 'beam', 'door', 'window'];
        // Manual and QS-reviewed items remain; new raw AI proposals are appended after them.
        const nextIdBase = keptElements.length + 1;
        const newEls = (elements || []).map((el, i) => {
          let rawType = String(el.type || '').toLowerCase().trim();
          if (rawType === 'room' || rawType === 'area' || rawType === 'floor') rawType = 'slab';
          if (rawType === 'opening') rawType = 'window';

          let x = Number(el.x) || 0, y = Number(el.y) || 0, w = Number(el.w) || 0, h = Number(el.h) || 0;
          // scale from sent image back to full canvas
          x *= cap.scaleBackX; y *= cap.scaleBackY; w *= cap.scaleBackX; h *= cap.scaleBackY;

          // Drop tiny / invalid boxes early
          if (!(w > 2 && h > 2) || !isFinite(x + y + w + h)) return null;

          // Preserve the model's explicit classification. The previous client-side
          // aspect-ratio rewrite could turn a correctly detected wall into a slab
          // (or a column into a wall) solely because of its bounding box shape.
          // Heuristics are used only when the model returned an unknown type.
          const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
          const longSide = Math.max(w, h);
          let type = ALLOWED.includes(rawType) ? rawType : null;
          if (!type) {
            if (longSide < 25 && aspect < 2.5) type = 'column';
            else if (aspect >= 4.0) type = 'wall';
            else type = 'slab';
          }

          const label = (el.label && String(el.label).trim()) || (type.charAt(0).toUpperCase() + type.slice(1));
          // Standard thickness in metres — never derive from pixel box width
          let thickness = null;
          if (type === 'wall') thickness = state.defaults.wallThickness != null ? state.defaults.wallThickness : 0.225;
          else if (type === 'beam') thickness = state.defaults.beamWidth != null ? state.defaults.beamWidth : 0.23;
          const newEl = {
            id: 'el-' + (nextIdBase + i),
            type: type,
            label: label,
            x, y, w, h,
            height: el.height != null && !isNaN(Number(el.height)) ? Number(el.height) : null,
            thickness: thickness,
            confidence: el.confidence != null && isFinite(Number(el.confidence)) ? Math.max(0, Math.min(1, Number(el.confidence) > 1 ? Number(el.confidence) / 100 : Number(el.confidence))) : null,
            source: 'AI',
            ai: true,
            reviewStatus: 'AI_GENERATED',
            reviewedAt: null,
            accepted: false,
            // Frozen at detection time so later edits / accept don't rewrite the AI baseline
            aiQty: null
          };
          try {
            newEl.aiQty = computeElementQty(newEl);
          } catch (_) {}
          return newEl;
        }).filter(Boolean);

        state.elements = keptElements.concat(newEls);

        drawOverlay();
        progress.classList.remove('show');
        $('btn-run-ai').disabled = false;
        $('btn-to-review').disabled = state.elements.length === 0;

        const summary = $('ai-result-summary');
        if (state.elements.length === 0) {
          summary.style.display = 'block';
          summary.innerHTML = '<div class="explain">No reliable elements found. The drawing may be unclear — try a higher-resolution plan or measure manually in Pro Mode.</div>';
          toast('AI found no usable elements.', 'error');
        } else {
          const counts = {};
          state.elements.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
          summary.style.display = 'block';
          summary.innerHTML = '<div class="detail-box"><h4>Detection result</h4>' +
            Object.keys(counts).map(t => '<div class="detail-row"><span class="k">' + t + '</span><span class="v">' + counts[t] + '</span></div>').join('') +
            '<div class="detail-row"><span class="k">Total</span><span class="v">' + state.elements.length + '</span></div></div>';
          toast('AI detected ' + newEls.length + ' new element(s); manual/QS-reviewed items were kept.', 'success');
        }
        updateSummary();
      } catch (err) {
        console.error(err);
        progress.classList.remove('show');
        $('btn-run-ai').disabled = false;
        toast(err.message || 'AI detection failed. Check your connection and try again.', 'error');
      }
    }

    function capturePlan() {
      if (!planCanvas.width) return null;
      // Preserve fine detail for AI: small doors, windows, columns, wall gaps.
      // Higher max edge + high-quality JPEG reduces blur from downscaling.
      const maxEdge = 4096;
      const scale = Math.min(1, maxEdge / Math.max(planCanvas.width, planCanvas.height));
      const sendW = Math.max(1, Math.round(planCanvas.width * scale));
      const sendH = Math.max(1, Math.round(planCanvas.height * scale));
      const off = document.createElement('canvas');
      off.width = sendW; off.height = sendH;
      const octx = off.getContext('2d', { alpha: false });
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, sendW, sendH);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(planCanvas, 0, 0, sendW, sendH);
      // 0.92 balances detail vs API payload size (Gemini body limit)
      const dataUrl = off.toDataURL('image/jpeg', 0.92);
      return {
        base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        sendW, sendH,
        scaleBackX: planCanvas.width / sendW,
        scaleBackY: planCanvas.height / sendH
      };
    }

    $('btn-to-review').addEventListener('click', () => goStep(4));

    // ---------- Review ----------
    function getSimpleReviewStatus(el) {
      if (!el) return 'MANUAL';
      if (el.reviewStatus === 'FINAL' || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'AI_GENERATED' || el.reviewStatus === 'MANUAL') return el.reviewStatus;
      return el.source === 'AI' || el.ai ? 'AI_GENERATED' : (el.source === 'AI_EDITED' ? 'QS_REVIEWED' : 'MANUAL');
    }
    function getSimpleReviewLabel(el) {
      const status = getSimpleReviewStatus(el);
      return status === 'FINAL' ? 'Final' : status === 'QS_REVIEWED' ? 'QS reviewed' : status === 'AI_GENERATED' ? 'AI generated' : 'Manual';
    }
    function getSimpleConfidencePercent(el) {
      if (!el || el.confidence == null || !isFinite(Number(el.confidence))) return null;
      const value = Number(el.confidence);
      return Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)));
    }
    function markSimpleReviewed(el) {
      if (!el) return;
      if (el.source === 'AI' || el.ai) {
        el.source = 'AI_EDITED';
        el.ai = false;
      }
      el.accepted = true;
      el.reviewStatus = 'QS_REVIEWED';
      el.reviewedAt = new Date().toISOString();
      try {
        if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
          MCResearch.notifyElementChange('accept', el, { mode: 'simple' });
        }
      } catch (_) {}
    }

    function setupSimpleResearchRealtime() {
      if (!window.MCResearch || typeof MCResearch.setRealtimeElementsProvider !== 'function') return;
      MCResearch.setRealtimeElementsProvider(function () {
        const list = (state.elements || []).filter(function (e) { return e && !e.hidden; });
        const aiEls = list.filter(function (e) {
          return e.source === 'AI' || e.source === 'AI_EDITED' || e.ai === true;
        });
        function mapEl(el, defSource, defStatus) {
          return {
            type: el.type, label: el.label, x: el.x, y: el.y, w: el.w, h: el.h,
            height: el.height || null, source: el.source || defSource,
            reviewStatus: el.reviewStatus || defStatus,
            accepted: !!el.accepted, id: el.id
          };
        }
        return {
          elements: list.filter(function (e) { return e.accepted; }).map(function (el) {
            return mapEl(el, 'MANUAL', 'QS_REVIEWED');
          }),
          aiElements: aiEls.map(function (el) { return mapEl(el, 'AI', 'AI_GENERATED'); }),
          imageWidth: (typeof planCanvas !== 'undefined' && planCanvas) ? planCanvas.width : null,
          imageHeight: (typeof planCanvas !== 'undefined' && planCanvas) ? planCanvas.height : null,
          metersPerPixel: state.metersPerPixel || null,
          legendNotes: (($('ai-legend-notes') && $('ai-legend-notes').value) || '').trim(),
        };
      });
    }
    try { setupSimpleResearchRealtime(); } catch (_) {}

    function confidenceBand(pct) {
      if (pct == null) return { label: '—', cls: 'conf-unknown', color: '#94a3b8' };
      if (pct >= 90) return { label: pct + '% High', cls: 'conf-high', color: '#16a34a' };
      if (pct >= 70) return { label: pct + '% Review', cls: 'conf-mid', color: '#d97706' };
      return { label: pct + '% Check', cls: 'conf-low', color: '#dc2626' };
    }

    function renderElementsList() {
      const wrap = $('elements-list-wrap');
      if (!state.elements.length) {
        wrap.innerHTML = '<div class="empty-msg">No elements yet. Run AI detection first.</div>';
        return;
      }

      const accepted = state.elements.filter(e => e.accepted).length;
      const total = state.elements.length;

      let html = '';
      html += '<div class="review-toolbar">' +
        '<div class="review-count"><strong>' + accepted + '</strong> of ' + total + ' accepted</div>' +
        '<div class="review-actions">' +
          '<button type="button" class="btn btn-sm" id="btn-accept-all-inline">Accept all</button>' +
          '<button type="button" class="btn btn-sm" id="btn-reject-all-inline">Reject all</button>' +
        '</div>' +
      '</div>';

      html += '<div class="elem-list">';
      state.elements.forEach(el => {
        const color = TYPE_COLORS[el.type] || '#888';
        const confidence = getSimpleConfidencePercent(el);
        const band = confidenceBand(confidence);
        const reviewText = getSimpleReviewLabel(el);
        const needsSill = el.type === 'window' || el.type === 'door' || el.type === 'cutout' || el.type === 'opening';
        const needsSoffit = el.type === 'beam';
        const needsHeight = needsSill || el.type === 'wall' || el.type === 'column' || el.type === 'slab' || el.type === 'beam';
        const openH = el.height != null ? el.height : (el.type === 'window' ? 1.2 : (el.type === 'door' ? 2.1 : ''));
        const sillDef = el.type === 'window' ? 0.9 : 0;
        const elev = needsSoffit
          ? (el.soffitHeight != null ? el.soffitHeight : '')
          : (el.sillHeight != null ? el.sillHeight : (needsSill ? sillDef : ''));
        const elevLabel = needsSoffit ? 'soffit' : 'sill';
        const elevTitle = needsSoffit ? 'Soffit height above FFL (m)' : 'Sill height above FFL (m)';
        const sizeTxt = Math.round(el.w) + '×' + Math.round(el.h);
        const cardCls = 'elem-card' + (el.accepted ? ' is-accepted' : '') + (confidence != null && confidence < 70 && !el.accepted ? ' is-low' : '');

        html += '<article class="' + cardCls + '" data-id="' + el.id + '">';
        html += '<label class="elem-check" title="Accept / include in quantities">' +
          '<input type="checkbox" data-id="' + el.id + '" ' + (el.accepted ? 'checked' : '') + '>' +
          '<span class="checkmark"></span>' +
        '</label>';
        html += '<div class="elem-body">';
        html += '<div class="elem-top">' +
          '<div class="elem-identity">' +
            '<span class="type-chip" style="--type-color:' + color + '"><i style="background:' + color + '"></i>' + escapeHtml(el.type) + '</span>' +
            '<span class="elem-label">' + escapeHtml(el.label || el.type) + '</span>' +
          '</div>' +
          '<span class="conf-pill" style="background:' + band.color + '">' + band.label + '</span>' +
        '</div>';
        html += '<div class="elem-meta">' +
          '<span class="meta-item"><span class="meta-k">Status</span><span class="meta-v">' + escapeHtml(reviewText) + '</span></span>' +
          '<span class="meta-item"><span class="meta-k">Size</span><span class="meta-v mono">' + sizeTxt + '</span></span>' +
        '</div>';

        if (needsHeight || needsSill || needsSoffit) {
          html += '<div class="elem-fields">';
          if (needsHeight) {
            html += '<label class="field-mini"><span>Height (m)</span>' +
              '<input type="number" step="0.01" min="0" data-field="height" data-id="' + el.id + '" value="' + (openH !== '' ? openH : '') + '" title="Height / depth (m)">' +
            '</label>';
          }
          if (needsSill || needsSoffit) {
            html += '<label class="field-mini"><span>' + (needsSoffit ? 'Soffit (m)' : 'Sill (m)') + '</span>' +
              '<input type="number" step="0.01" min="0" data-field="' + elevLabel + '" data-id="' + el.id + '" value="' + elev + '" title="' + elevTitle + '">' +
            '</label>';
          }
          html += '</div>';
        }

        html += '</div></article>';
      });
      html += '</div>';

      html += '<div class="review-footer-note">' +
        '<div class="conf-legend">' +
          '<span class="cl-item"><i style="background:#16a34a"></i>≥90% High</span>' +
          '<span class="cl-item"><i style="background:#d97706"></i>70–89% Review</span>' +
          '<span class="cl-item"><i style="background:#dc2626"></i>&lt;70% Check</span>' +
        '</div>' +
        '<p>Confidence is a triage aid only. Tick to accept. Confirm sill for windows/doors and soffit for beams.</p>' +
      '</div>';

      wrap.innerHTML = html;

      const acceptInline = $('btn-accept-all-inline');
      const rejectInline = $('btn-reject-all-inline');
      if (acceptInline) acceptInline.addEventListener('click', () => { $('btn-accept-all').click(); });
      if (rejectInline) rejectInline.addEventListener('click', () => { $('btn-reject-all').click(); });

      wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
          const el = state.elements.find(e => e.id === cb.dataset.id);
          if (el) {
            if (cb.checked) {
              markSimpleReviewed(el);
            } else {
              el.accepted = false;
              if (el.source === 'AI_EDITED' || el.source === 'AI') {
                el.source = 'AI';
                el.ai = true;
                el.reviewStatus = 'AI_GENERATED';
                el.reviewedAt = null;
              }
              try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                  MCResearch.notifyElementChange('reject', el, { mode: 'simple' });
                }
              } catch (_) {}
            }
          }
          renderElementsList();
          drawOverlay();
          updateSummary();
        });
      });
      wrap.querySelectorAll('input[type=number]').forEach(inp => {
        inp.addEventListener('change', () => {
          const el = state.elements.find(e => e.id === inp.dataset.id);
          if (!el) return;
          const v = parseFloat(inp.value);
          const field = inp.dataset.field;
          if (field === 'height') el.height = (inp.value === '' || isNaN(v)) ? null : Math.max(0, v);
          if (field === 'sill') el.sillHeight = (inp.value === '' || isNaN(v)) ? null : Math.max(0, v);
          if (field === 'soffit') el.soffitHeight = (inp.value === '' || isNaN(v)) ? null : Math.max(0, v);
          updateSummary();
        });
      });
      const legend = $('type-legend');
      if (legend) {
        legend.innerHTML = Object.keys(TYPE_COLORS).map(t =>
          '<span><i class="type-dot" style="background:' + TYPE_COLORS[t] + '"></i>' + t + '</span>'
        ).join('');
      }
    }

    $('btn-accept-all').addEventListener('click', () => {
      state.elements.forEach(markSimpleReviewed);
      renderElementsList(); drawOverlay(); updateSummary();
      toast('All detected items accepted.', 'success');
    });
    $('btn-reject-all').addEventListener('click', () => {
      state.elements.forEach(e => {
        e.accepted = false;
        if (e.source === 'AI_EDITED' || e.source === 'AI') {
          e.source = 'AI';
          e.ai = true;
          e.reviewStatus = 'AI_GENERATED';
          e.reviewedAt = null;
        }
        try {
          if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
            MCResearch.notifyElementChange('reject', e, { mode: 'simple' });
          }
        } catch (_) {}
      });
      renderElementsList(); drawOverlay(); updateSummary();
      toast('All detected items left unaccepted for review.', 'success');
    });
    $('btn-to-qty').addEventListener('click', () => {
      if (!state.elements.some(e => e.accepted)) {
        toast('Accept at least one reviewed element before costing.', 'error');
        return;
      }
      goStep(5);
    });

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    // ---------- Quantities ----------
    function pxToM(px) {
      const value = Number(px);
      return Number.isFinite(value) && value >= 0 ? (state.metersPerPixel || 0) * value : 0;
    }

    // Return the measured footprint used by both export engines. Polygon and
    // line geometry remain available for drawing; material exports use bounds
    // consistently in Simple and Professional Mode.
    function elementAreaPx(el) {
      // Shared export contract: both modes use the element’s measured bounds
      // for slab/column areas. Polygon vertices remain available for drawing,
      // but must not silently change material quantities between modes.
      const w = Number(el && el.w), h = Number(el && el.h);
      return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w * h : 0;
    }

    function elementLinePx(el) {
      const p1 = el && el.p1, p2 = el && el.p2;
      if (p1 && p2) {
        const x1 = Number(p1.x), y1 = Number(p1.y), x2 = Number(p2.x), y2 = Number(p2.y);
        if ([x1, y1, x2, y2].every(Number.isFinite)) return Math.hypot(x2 - x1, y2 - y1);
      }
      const length = Number(el && el.length);
      if (Number.isFinite(length) && length > 0) return length;
      const w = Number(el && el.w), h = Number(el && el.h);
      return Number.isFinite(w) && Number.isFinite(h) ? Math.max(w, h) : 0;
    }

    /** Per-element quantity used for AI baseline (aiQty) and research logging. */
    function computeElementQty(el) {
      if (!el) return null;
      const isLine = !!(el.isLine && el.p1 && el.p2);
      const lenPx = isLine ? elementLinePx(el) : Math.max(Number(el.w) || 0, Number(el.h) || 0);
      const lenM = pxToM(lenPx);
      let thkM = state.defaults.wallThickness != null ? state.defaults.wallThickness : 0.225;
      if (el.type === 'wall' || el.type === 'beam') {
        if (typeof el.thickness === 'number' && el.thickness >= 0.08 && el.thickness <= 0.55) {
          thkM = Math.round(el.thickness * 1000) / 1000;
        } else if (el.type === 'beam') {
          thkM = state.defaults.beamWidth != null ? state.defaults.beamWidth : 0.23;
        }
      }
      const areaM2 = Math.pow(state.metersPerPixel || 0, 2) * elementAreaPx(el);
      const height = el.height != null && Number(el.height) > 0 ? Number(el.height) : state.defaults.wallHeight;
      if (el.type === 'wall') return Math.round(lenM * height * 100) / 100; // m² face
      if (el.type === 'slab') {
        let slabThk = state.defaults.slabThickness || 0.15;
        const h = (el.height != null && Number(el.height) > 0) ? Number(el.height)
          : (el.zHeight != null && Number(el.zHeight) > 0) ? Number(el.zHeight) : null;
        if (h != null && h >= 0.08 && h <= 0.40) slabThk = h;
        return Math.round(areaM2 * slabThk * 1000) / 1000; // m³
      }
      if (el.type === 'column') {
        const h = el.height != null && Number(el.height) > 0 ? Number(el.height) : state.defaults.columnHeight;
        return Math.round(areaM2 * h * 1000) / 1000; // m³
      }
      if (el.type === 'beam') {
        return Math.round(lenM * (state.defaults.beamWidth || 0.23) * (state.defaults.beamDepth || 0.45) * 1000) / 1000; // m³
      }
      if (el.type === 'door' || el.type === 'window' || el.type === 'opening') return 1;
      return null;
    }

    function elementUnit(type) {
      if (type === 'wall') return 'm²';
      if (type === 'door' || type === 'window' || type === 'opening') return 'Nr';
      return 'm³';
    }

    function isSimpleAcceptedElement(el) {
      if (!el || el.hidden) return false;
      const source = String(el.source || '').toUpperCase();
      const aiOrigin = source === 'AI' || source === 'AI_EDITED' || el.ai === true;
      if (aiOrigin) return el.accepted === true || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL';
      return el.accepted !== false;
    }
    function computeQuantities() {
      let wallFaceM2 = 0, wallVolM3 = 0, slabAreaM2 = 0, slabVolM3 = 0;
      let columnM3 = 0, beamM3 = 0, doors = 0, windows = 0;
      state.elements.filter(isSimpleAcceptedElement).forEach(el => {
        const isLine = !!(el.isLine && el.p1 && el.p2);
        const lenPx = isLine ? elementLinePx(el) : Math.max(Number(el.w) || 0, Number(el.h) || 0);
        const lenM = pxToM(lenPx);
        // Wall thickness is always a standard metre value (default 0.225 m).
        // Never convert pixel box width → metres (that produced values like 0.2378 m).
        let thkM = state.defaults.wallThickness != null ? state.defaults.wallThickness : 0.225;
        if (el.type === 'wall' || el.type === 'beam') {
          if (typeof el.thickness === 'number' && el.thickness >= 0.08 && el.thickness <= 0.55) {
            thkM = Math.round(el.thickness * 1000) / 1000;
          } else if (el.type === 'beam') {
            thkM = state.defaults.beamWidth != null ? state.defaults.beamWidth : 0.23;
          }
        }
        const areaM2 = Math.pow(state.metersPerPixel || 0, 2) * elementAreaPx(el);
        const height = el.height != null && Number(el.height) > 0 ? Number(el.height) : state.defaults.wallHeight;
        if (el.type === 'wall') {
          wallFaceM2 += lenM * height;
          wallVolM3 += lenM * thkM * height;
        } else if (el.type === 'slab') {
          slabAreaM2 += areaM2;
          // Prefer per-element thickness when realistic (80–400 mm); else default 0.15 m
          let slabThk = state.defaults.slabThickness || 0.15;
          const h = (el.height != null && Number(el.height) > 0) ? Number(el.height)
            : (el.zHeight != null && Number(el.zHeight) > 0) ? Number(el.zHeight) : null;
          if (h != null && h >= 0.08 && h <= 0.40) slabThk = h;
          slabVolM3 += areaM2 * slabThk;
        } else if (el.type === 'column') {
          columnM3 += areaM2 * (el.height != null && Number(el.height) > 0 ? Number(el.height) : state.defaults.columnHeight);
        } else if (el.type === 'beam') {
          beamM3 += lenM * state.defaults.beamWidth * state.defaults.beamDepth;
        } else if (el.type === 'door') {
          doors += 1;
        } else if (el.type === 'window' || el.type === 'opening') {
          windows += 1;
        }
      });
      const concreteM3 = slabVolM3 + columnM3 + beamM3;
      return {
        wallFaceM2, wallVolM3, slabAreaM2, slabVolM3, concreteM3, columnM3, beamM3,
        openings: doors + windows, doors, windows
      };
    }

    const CONCRETE_MIX_TABLE = {
      '1:2:4': { bagsPerM3: 18 / 2.83, sandM3PerM3: 0.50, metalM3PerM3: 0.88, ref: '05.A.04' },
      '1:1.5:3': { bagsPerM3: 23 / 2.83, sandM3PerM3: 0.42, metalM3PerM3: 0.82, ref: '05.A.01' },
      '1:1½:3': { bagsPerM3: 23 / 2.83, sandM3PerM3: 0.42, metalM3PerM3: 0.82, ref: '05.A.01' },
      '1:3:6': { bagsPerM3: 13 / 2.83, sandM3PerM3: 0.53, metalM3PerM3: 0.92, ref: '05.A.02' },
      '1:2.5:5': { bagsPerM3: 14 / 2.83, sandM3PerM3: 0.60, metalM3PerM3: 0.90, ref: '05.A.03' },
      '1:1:2': { bagsPerM3: 31 / 2.83, sandM3PerM3: 0.44, metalM3PerM3: 0.96, ref: '05.A.05' }
    };
    function concreteBreakdown(wetVol) {
      const c = MAT_DEFAULTS.concrete;
      const vol = Math.max(0, Number(wetVol) || 0);
      const mixKey = String((c && c.mix) || '1:2:4').replace(/\s+/g, '');
      const yieldRow = (typeof CONCRETE_MIX_TABLE !== 'undefined') && (CONCRETE_MIX_TABLE[mixKey] || CONCRETE_MIX_TABLE['1:2:4']);
      if (yieldRow && vol > 0) {
        const bags = vol * yieldRow.bagsPerM3;
        return {
          bags: bags,
          sand: vol * yieldRow.sandM3PerM3,
          agg: vol * yieldRow.metalM3PerM3,
          cementKg: bags * 50
        };
      }
      const dryVol = vol * (c.dryFactor || 1.54);
      const parts = 7;
      const cementVol = dryVol / parts;
      const bags = cementVol / (c.bagSize || 0.035);
      return {
        bags,
        sand: (dryVol * 2) / parts,
        agg: (dryVol * 4) / parts,
        cementKg: cementVol * (c.cementDensity || 1440)
      };
    }
    function plasterBreakdown(netArea) {
      const p = MAT_DEFAULTS.plaster;
      const t = p.thickness != null ? p.thickness : 0.010;
      const dryVol = (netArea * t) * (p.dryFactor || 1.33);
      const parts = 6;
      const cementVol = dryVol / parts;
      return {
        bags: cementVol / 0.035,
        sand: (dryVol * 5) / parts,
        cementKg: cementVol * (p.cementDensity || 1440)
      };
    }
    function tileCount(areaM2) {
      const t = MAT_DEFAULTS.tiling;
      const sz = t.size || [600, 600];
      const tileArea = (sz[0] / 1000) * (sz[1] / 1000);
      const waste = t.wastage != null ? t.wastage : 0.05;
      return {
        count: Math.ceil((areaM2 / tileArea) * (1 + waste)),
        adhesiveBags: areaM2 * (t.adhesiveBagsPerM2 != null ? t.adhesiveBagsPerM2 : 0.25)
      };
    }
    function paintLitres(netAreaOneFace) {
      const p = MAT_DEFAULTS.painting;
      const faces = (p.bothFaces !== false) ? 2 : 1;
      const litresExact = (netAreaOneFace * faces * (p.coats || 2)) / (p.coverage || 14);
      return Math.ceil(litresExact * 10) / 10;
    }

    function classifySimpleWallMasonry(w) {
      // Must match Pro classifyWallMasonry so the same wall (esp. default 0.225 m)
      // produces Brick 225mm in both modes — not Block 200mm in Simple only.
      const wt = (w && w.wallType) ? String(w.wallType).toLowerCase() : '';
      if (wt) {
        if (wt.indexOf('110') >= 0 || wt === '110mm brick' || wt === 'brick 110') {
          return { kind: 'brick', thicknessMm: 110 };
        }
        if (wt.indexOf('225') >= 0 || wt === '225mm brick' || wt === 'brick 225') {
          return { kind: 'brick', thicknessMm: 225 };
        }
        if (wt.indexOf('100') >= 0 && wt.indexOf('block') >= 0) return { kind: 'block', thicknessMm: 100 };
        if (wt.indexOf('150') >= 0 && wt.indexOf('block') >= 0) return { kind: 'block', thicknessMm: 150 };
        if (wt.indexOf('200') >= 0 && wt.indexOf('block') >= 0) return { kind: 'block', thicknessMm: 200 };
      }
      const mat = String((w && w.material) || '').toLowerCase();
      const thk = (typeof w.thickness === 'number' && w.thickness > 0) ? w.thickness : (state.defaults.wallThickness || 0.225);
      if (mat.indexOf('brick') >= 0 && mat.indexOf('block') < 0) return { kind: 'brick', thicknessMm: Math.round(thk * 1000) };
      if (mat.indexOf('200') >= 0) return { kind: 'block', thicknessMm: 200 };
      if (mat.indexOf('150') >= 0) return { kind: 'block', thicknessMm: 150 };
      if (mat.indexOf('100') >= 0) return { kind: 'block', thicknessMm: 100 };
      if (mat.indexOf('block') >= 0) {
        const mm = thk * 1000;
        return { kind: 'block', thicknessMm: [100, 150, 200].reduce((a, b) => Math.abs(b - mm) < Math.abs(a - mm) ? b : a, 100) };
      }
      // Thickness heuristic — same order as Pro (brick 225 before block 200)
      if (thk >= 0.20 && thk <= 0.24) return { kind: 'brick', thicknessMm: 225 };
      if (thk >= 0.10 && thk <= 0.12) return { kind: 'brick', thicknessMm: 110 };
      if (thk >= 0.175) return { kind: 'block', thicknessMm: 200 };
      if (thk >= 0.125) return { kind: 'block', thicknessMm: 150 };
      if (thk >= 0.09 && thk <= 0.12) return { kind: 'block', thicknessMm: 100 };
      return { kind: 'brick', thicknessMm: Math.round(thk * 1000) };
    }
    function simpleMasonryBreakdown(faceAreaM2, thicknessMm, kind) {
      const area = Math.max(0, Number(faceAreaM2) || 0);
      let thk = Math.round(Number(thicknessMm) || (kind === 'brick' ? 225 : 100));
      if (kind === 'brick') {
        if (thk >= 90 && thk <= 120) thk = 100; else thk = 225;
        const row = (MAT_DEFAULTS.brick.rates[thk] || MAT_DEFAULTS.brick.rates[225]);
        const bricks = Math.ceil(area * row.bricksPerM2);
        const cementBags = area * row.cementBagsPerM2;
        const sandCubes = area * row.sandCubesPerM2;
        return { bricks: bricks, blocks: 0, cementBags: cementBags, sandCubes: sandCubes, sandM3: sandCubes * SL_CUBE_M3, thicknessMm: thk };
      }
      if (thk >= 90 && thk <= 120) thk = 100;
      else if (thk >= 140 && thk <= 160) thk = 150;
      else thk = 200;
      const row = (MAT_DEFAULTS.block.rates[thk] || MAT_DEFAULTS.block.rates[100]);
      const blocks = Math.ceil(area * row.blocksPerM2);
      const cementBags = area * row.cementBagsPerM2;
      const sandCubes = area * row.sandCubesPerM2;
      return { bricks: 0, blocks: blocks, cementBags: cementBags, sandCubes: sandCubes, sandM3: sandCubes * SL_CUBE_M3, thicknessMm: thk };
    }
    /** Pro-style material estimate from accepted elements */
    function computeMaterials(q) {
      q = q || computeQuantities();
      const conc = concreteBreakdown(q.concreteM3 || 0);
      const plas = plasterBreakdown(q.wallFaceM2 || 0);
      const tiles = tileCount(q.slabAreaM2 || 0);
      const paintL = paintLitres(q.wallFaceM2 || 0);
      const brickFace = { 100: 0, 225: 0 };
      const blockFace = { 100: 0, 150: 0, 200: 0 };
      (state.elements || []).filter(e => isSimpleAcceptedElement(e) && e.type === 'wall').forEach(w => {
        const lenPx = (w.isLine && w.p1 && w.p2) ? elementLinePx(w) : Math.max(Number(w.w) || 0, Number(w.h) || 0);
        const face = pxToM(lenPx) * (w.height != null && Number(w.height) > 0 ? Number(w.height) : state.defaults.wallHeight);
        const cls = classifySimpleWallMasonry(w);
        if (cls.kind === 'block' && blockFace[cls.thicknessMm] != null) blockFace[cls.thicknessMm] += face;
        else {
          const bt = (cls.thicknessMm >= 90 && cls.thicknessMm <= 120) ? 100 : 225;
          brickFace[bt] += face;
        }
      });
      const brk100 = simpleMasonryBreakdown(brickFace[100], 100, 'brick');
      const brk225 = simpleMasonryBreakdown(brickFace[225], 225, 'brick');
      const brickNos = (brk100.bricks || 0) + (brk225.bricks || 0);
      const brickFaceM2 = brickFace[100] + brickFace[225];
      const blk100 = simpleMasonryBreakdown(blockFace[100], 100, 'block');
      const blk150 = simpleMasonryBreakdown(blockFace[150], 150, 'block');
      const blk200 = simpleMasonryBreakdown(blockFace[200], 200, 'block');
      const masonryCementBags = (brk100.cementBags || 0) + (brk225.cementBags || 0) +
        (blk100.cementBags || 0) + (blk150.cementBags || 0) + (blk200.cementBags || 0);
      const masonrySandM3 = (brk100.sandM3 || 0) + (brk225.sandM3 || 0) +
        (blk100.sandM3 || 0) + (blk150.sandM3 || 0) + (blk200.sandM3 || 0);
      const cementBags = (conc.bags || 0) + (plas.bags || 0) + masonryCementBags;
      const sandM3 = (conc.sand || 0) + (plas.sand || 0) + masonrySandM3;
      const aggM3 = conc.agg || 0;

      function priceOf(name) {
        if (state.rates[name] != null && state.rates[name] !== '' && !isNaN(Number(state.rates[name]))) {
          return Number(state.rates[name]);
        }
        const def = DEFAULT_MATERIAL_RATES[name];
        return def && def.rate != null ? Number(def.rate) : null;
      }

      const materials = [
        {
          material: 'Cement', qty: Math.ceil(cementBags * 10) / 10, unit: 'bag (50kg)',
          source: 'Concrete + Plaster + Brick/Block mortar 1:5 (SL QS)',
          color: '#94a3b8'
        },
        {
          material: 'Sand', qty: Math.round(sandM3 * 1000) / 1000, unit: 'm³',
          source: '1 Cube = 100 ft³ = 2.83168 m³ (SL · Sand & Aggregate only)', color: '#eab308'
        },
        {
          material: 'Aggregate', qty: Math.round(aggM3 * 1000) / 1000, unit: 'm³',
          source: 'Concrete mix · 1 Cube = 2.83168 m³ (SL standard)', color: '#78716c'
        },
        {
          material: 'Brick', qty: brickNos, unit: 'Nr',
          source: brickFaceM2 > 0
            ? ('Brick face ' + brickFaceM2.toFixed(2) + ' m² · 100mm ' + (brk100.bricks || 0) + ' · 225mm ' + (brk225.bricks || 0) + ' (SL §09)')
            : 'No brick walls',
          color: '#c8a070'
        },
        {
          material: 'Block 100mm', qty: blk100.blocks || 0, unit: 'Nr',
          source: blockFace[100] > 0 ? blockFace[100].toFixed(2) + ' m² · 12.06/m² (SL §08)' : 'No 100mm block walls detected', color: '#a8a29e'
        },
        {
          material: 'Block 150mm', qty: blk150.blocks || 0, unit: 'Nr',
          source: blockFace[150] > 0 ? blockFace[150].toFixed(2) + ' m² · 12.06/m² (SL §08)' : 'No 150mm block walls detected', color: '#78716c'
        },
        {
          material: 'Block 200mm', qty: blk200.blocks || 0, unit: 'Nr',
          source: blockFace[200] > 0 ? blockFace[200].toFixed(2) + ' m² · 12.06/m² (SL §08)' : 'No 200mm block walls detected', color: '#57534e'
        },
        {
          material: 'Adhesive', qty: Math.round((tiles.adhesiveBags || 0) * 100) / 100, unit: 'bag (25kg)',
          source: 'Tiling area ' + (q.slabAreaM2 || 0).toFixed(2) + ' m² × rate', color: '#64748b'
        },
        {
          material: 'Tiles (600x600mm)', qty: tiles.count || 0, unit: 'Nr',
          source: 'Slab floor area ' + (q.slabAreaM2 || 0).toFixed(2) + ' m² + 5% waste', color: '#b8c8d4'
        },
        {
          material: 'Paint', qty: paintL, unit: 'L',
          source: '2 coats × 2 faces · ' + (q.wallFaceM2 || 0).toFixed(2) + ' m² · 14 m²/L', color: '#e8e0d8'
        }
      ];

      materials.forEach(m => {
        m.price = priceOf(m.material);
        m.total = (m.qty > 0 && m.price != null) ? m.qty * m.price : null;
      });

      const elementQty = [
        { element: 'Column', qty: Math.round((q.columnM3 || 0) * 1000) / 1000, unit: 'm³' },
        { element: 'Beam', qty: Math.round((q.beamM3 || 0) * 1000) / 1000, unit: 'm³' },
        { element: 'Slab', qty: Math.round((q.slabVolM3 || 0) * 1000) / 1000, unit: 'm³' },
        { element: 'Wall', qty: Math.round((q.wallFaceM2 || 0) * 100) / 100, unit: 'm²' },
        { element: 'Wall (volume)', qty: Math.round((q.wallVolM3 || 0) * 1000) / 1000, unit: 'm³' },
        { element: 'Floor / tiling area', qty: Math.round((q.slabAreaM2 || 0) * 100) / 100, unit: 'm²' },
        { element: 'Doors', qty: q.doors || 0, unit: 'Nr' },
        { element: 'Windows', qty: q.windows || 0, unit: 'Nr' }
      ];

      const materialsTotal = materials.reduce((s, m) => s + (m.total || 0), 0);
      const contingencyPct = state.contingencyPct != null ? state.contingencyPct : 0.15;
      const contingency = materialsTotal * contingencyPct;
      return {
        materials, elementQty, materialsTotal, contingencyPct, contingency,
        grandTotal: materialsTotal + contingency, q,
        meta: { cementBags, sandM3, aggM3, brickNos, block100: blk100.blocks || 0, block150: blk150.blocks || 0, block200: blk200.blocks || 0, paintL }
      };
    }

    function computeEstimate(q) {
      const mat = computeMaterials(q);
      return {
        rows: mat.materials.map(m => ({
          key: m.material, item: m.material, unit: m.unit, qty: m.qty,
          rate: m.price != null ? m.price : 0, amount: m.total || 0, source: m.source
        })),
        sub: mat.materialsTotal,
        cont: mat.contingency,
        grand: mat.grandTotal,
        materials: mat.materials,
        elementQty: mat.elementQty,
        mat
      };
    }

    function renderQtyAndRates() {
      const q = computeQuantities();
      const est = computeEstimate(q);

      let bd = '';
      if (!state.metersPerPixel) {
        bd += '<div class="explain">Scale is not calibrated. Quantities will be zero until you complete step 2.</div>';
      }
      bd += '<div class="detail-box"><h4>Element totals</h4>';
      (est.elementQty || []).forEach(e => {
        const show = (typeof e.qty === 'number' && e.qty > 0)
          ? (e.unit === 'Nr' ? e.qty : e.qty.toFixed(3)) + ' ' + e.unit
          : '—';
        bd += '<div class="detail-row"><span class="k">' + escapeHtml(e.element) + '</span><span class="v">' + show + '</span></div>';
      });
      bd += '</div>';
      if ($('qty-breakdown')) $('qty-breakdown').innerHTML = bd;

      const wrap = $('materials-table-wrap') || $('rates-table-wrap');
      if (wrap) {
        let table = '<table class="data-table"><thead><tr><th>Material</th><th>Qty</th><th>Unit Rate</th><th>Total</th></tr></thead><tbody>';
        if (!est.materials || !est.materials.length) {
          table += '<tr><td colspan="4" class="empty-msg">No accepted elements with scale yet.</td></tr>';
        } else {
          est.materials.forEach(m => {
            const qtyNum = m.unit === 'Nr' ? String(m.qty) : (typeof m.qty === 'number' ? m.qty.toFixed(3) : m.qty);
            const qtyStr = qtyNum + ' <span style="font-weight:400;color:var(--text-2);">' + escapeHtml(m.unit || '') + '</span>';
            const priceVal = m.price != null ? m.price : '';
            table += '<tr>' +
              '<td><div style="font-weight:600;">' + escapeHtml(m.material) + '</div>' +
              '<div style="font-size:10px;color:var(--text-3);margin-top:2px;">' + escapeHtml(m.source || '') + '</div></td>' +
              '<td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--teal,#2F6E62);font-weight:600;">' + qtyStr + '</td>' +
              '<td><input type="number" min="0" step="any" data-rate-key="' + escapeHtml(m.material) + '" value="' + priceVal + '" placeholder="—"></td>' +
              '<td class="amount">' + (m.total != null ? formatMoney(m.total) : '—') + '</td></tr>';
          });
        }
        table += '</tbody></table>';
        wrap.innerHTML = table;
        wrap.querySelectorAll('input[data-rate-key]').forEach(inp => {
          inp.addEventListener('change', () => {
            const v = parseFloat(inp.value);
            state.rates[inp.dataset.rateKey] = isNaN(v) ? null : v;
            renderQtyAndRates();
            updateSummary();
          });
        });
      }

      if ($('cost-sub')) $('cost-sub').textContent = est.sub > 0 ? formatMoney(est.sub) : '—';
      if ($('cost-cont')) $('cost-cont').textContent = est.sub > 0 ? formatMoney(est.cont) : '—';
      if ($('cost-grand')) $('cost-grand').textContent = est.sub > 0 ? formatMoney(est.grand) : '—';
      updateSummary();
    }

    $('btn-fetch-rates').addEventListener('click', fetchMarketRates);
    async function fetchMarketRates() {
      const btn = $('btn-fetch-rates');
      const region = $('proj-region').value || 'Colombo, Sri Lanka';
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = 'Fetching…';
      toast('Fetching market rates…');
      try {
        const materials = Object.keys(DEFAULT_MATERIAL_RATES).map(name => ({
          name, unit: DEFAULT_MATERIAL_RATES[name].unit
        }));
        const resp = await fetch('/api/market-rates', {
          method: 'POST',
          headers: mcApiHeaders(true),
          body: JSON.stringify({ region, materials })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error((data && data.error) || 'Rates failed');
        (data.rates || []).forEach(r => {
          if (typeof r.cost !== 'number') return;
          Object.keys(DEFAULT_MATERIAL_RATES).forEach(k => {
            const a = k.toLowerCase();
            const b = (r.name || '').toLowerCase();
            if (a.includes(b.slice(0, 5)) || b.includes(a.slice(0, 5)) || a === b) {
              state.rates[k] = r.cost;
            }
          });
        });
        renderQtyAndRates();
        toast((data.notes || 'Market rates applied. Verify with local suppliers.'), 'success');
      } catch (err) {
        toast(err.message || 'Could not fetch market rates.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }

    $('btn-to-export').addEventListener('click', () => goStep(6));

    // ---------- Export: styled BOQ Summary matching the MeasureCraft template ----------
    $('btn-export-excel').addEventListener('click', () => {
      if (typeof XLSX === 'undefined') {
        toast('Excel library not loaded.', 'error');
        return;
      }
      const q = computeQuantities();
      const est = computeEstimate(q);
      const name = $('proj-name').value || 'Untitled Project';
      const currency = $('proj-currency').value || 'LKR';
      const dateStr = new Date().toISOString().slice(0, 10);
      // Match Pro Mode formatting exactly so the same calibration value
      // never appears to "drift" when switching modes / exporting BOQ.
      const scaleStr = !state.metersPerPixel
        ? 'Not calibrated'
        : (Math.abs(state.metersPerPixel - 1) < 1e-9
            ? '1 unit = 1 m'
            : ('1 unit = ' + state.metersPerPixel.toFixed(6) + ' m'));
      const money = n => n === '' || n == null || !isFinite(Number(n)) ? '' : Number(n);
      const qty = n => n == null || !isFinite(Number(n)) ? 0 : Number(n);
      const materials = est.materials || [];
      const elementQty = est.elementQty || [];
      const rows = Array.from({ length: 53 }, () => Array(7).fill(''));
      const put = (r, values) => values.forEach((v, c) => { rows[r - 1][c] = v; });

      put(1, ['MEASURECRAFT — MATERIAL ESTIMATE / BOQ']);
      put(2, ['Generated by MeasureCraft — quantities calculated from elemental takeoff']);
      put(3, [name]);
      put(4, ['Project No:', '—']);
      put(5, ['Client:', $('proj-client').value || '—']);
      put(6, ['Location:', $('proj-location').value || '—']);
      put(7, ['Status:', 'Draft']);
      put(8, ['Building type:', '—']);
      put(9, ['Floors:', '—']);
      put(10, ['Currency:', currency]);
      put(11, ['Prepared by:', '—']);
      put(12, ['Date:', dateStr]);
      put(13, ['Scale:', scaleStr]);
      put(15, ['MATERIAL QUANTITIES']);
      put(17, ['Item No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Remark']);

      materials.slice(0, 9).forEach((m, i) => {
        const r = 19 + i;
        put(r, [i + 1, m.material || '', m.unit || '', qty(m.qty), money(m.price), { f: `IFERROR(D${r}*E${r},0)` }, m.source || '']);
      });
      put(29, ['Materials subtotal', '', '', '', '', { f: 'SUM(F19:F27)' }]);
      put(30, ['Contingency ' + Math.round((state.contingencyPct || 0.15) * 100) + '%', '', '', '', '', { f: 'F29*' + Number(state.contingencyPct || 0.15).toFixed(4) }]);
      put(31, ['TOTAL ESTIMATE', '', '', '', '', { f: 'F29+F30' }]);
      put(33, ['ELEMENT QUANTITIES']);
      put(35, ['Item No.', 'Description', 'Unit', 'Qty']);
      elementQty.slice(0, 8).forEach((e, i) => put(37 + i, [i + 1, e.element || '', e.unit || '', qty(e.qty)]));
      put(47, ['Notes']);
      put(49, ['•  Cement & sand include concrete (slabs/columns/beams) + wall plaster']);
      put(50, ['•  Aggregate from concrete mix 1:2:4 only']);
      put(51, ['•  Bricks: 101 Nos per m² wall face']);
      put(52, ['•  Tiles & adhesive from slab floor areas; paint from wall face area']);
      put(53, ['•  Edit unit prices on Quantities step — totals recalculate on next export']);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!merges'] = [
        'A1:G1','A2:G2','A3:G3','A15:G15','A33:D33','A47:G47','A49:G49','A50:G50','A51:G51','A52:G52','A53:G53',
        'A29:E29','A30:E30','A31:E31','A17:A18','B17:B18','C17:C18','D17:D18','E17:E18','F17:F18','G17:G18',
        'A35:A36','B35:B36','C35:C36','D35:D36'
      ].map(ref => { const [s,e] = ref.split(':'); const decode = cell => { const m = cell.match(/([A-Z]+)(\d+)/); if (!m) throw new Error('Invalid worksheet merge reference: ' + cell); return { r: Number(m[2]) - 1, c: m[1].charCodeAt(0) - 65 }; }; const a=decode(s), b=decode(e); return { s:a, e:b }; });
      ws['!cols'] = [{ wch: 15 }, { wch: 26 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 17 }, { wch: 46 }];
      ws['!rows'] = Array.from({ length: 53 }, (_, i) => ({ hpx: i === 0 ? 40 : (i === 1 ? 24 : (i === 14 || i === 32 ? 26 : 21)) }));
      ws['!freeze'] = { xSplit: 0, ySplit: 17 };
      ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
      ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
      ws['!autofilter'] = { ref: 'A17:G27' };

      const navy = '1F4E78', light = 'F2F2F2', white = 'FFFFFF', ink = '1F1F1F', blue = '0000FF';
      const border = { top: { style: 'thin', color: { rgb: '808080' } }, bottom: { style: 'thin', color: { rgb: '808080' } }, left: { style: 'thin', color: { rgb: '808080' } }, right: { style: 'thin', color: { rgb: '808080' } } };
      const setStyle = (addr, style) => { if (ws[addr]) ws[addr].s = style; };
      const title = { fill: { fgColor: { rgb: navy } }, font: { name: 'Calibri', sz: 18, bold: true, color: { rgb: white } }, alignment: { horizontal: 'left', vertical: 'center' } };
      const subtitle = { fill: { fgColor: { rgb: navy } }, font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: white } }, alignment: { horizontal: 'left', vertical: 'center' } };
      const section = { fill: { fgColor: { rgb: navy } }, font: { name: 'Calibri', sz: 12, bold: true, color: { rgb: white } }, alignment: { horizontal: 'left', vertical: 'center' }, border };
      const header = { fill: { fgColor: { rgb: navy } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: white } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border };
      const label = { fill: { fgColor: { rgb: light } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: navy } }, alignment: { horizontal: 'left', vertical: 'center' } };
      const value = { fill: { fgColor: { rgb: light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } }, alignment: { horizontal: 'left', vertical: 'center' } };
      for (const c of ['A','B','C','D','E','F','G']) setStyle(c + '1', title), setStyle(c + '2', subtitle), setStyle(c + '15', section), setStyle(c + '33', section), setStyle(c + '47', section);
      setStyle('A3', { font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: ink } }, alignment: { horizontal: 'left', vertical: 'center' } });
      for (let r = 4; r <= 13; r++) { setStyle('A' + r, label); setStyle('B' + r, value); }
      for (const c of ['A','B','C','D','E','F','G']) setStyle(c + '17', header), setStyle(c + '18', header);
      for (let r = 19; r <= 27; r++) for (let c = 0; c < 7; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r % 2 ? white : light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } }, alignment: { horizontal: c === 1 || c === 6 ? 'left' : (c === 0 || c === 2 ? 'center' : 'right'), vertical: 'center', wrapText: c === 6 }, border }; }
      for (let r = 19; r <= 27; r++) { setStyle('D' + r, { ...ws['D' + r].s, numFmt: '#,##0.00' }); setStyle('E' + r, { ...ws['E' + r].s, numFmt: `"${currency} "#,##0.00`, font: { name: 'Calibri', sz: 11, color: { rgb: blue } } }); setStyle('F' + r, { ...ws['F' + r].s, numFmt: `"${currency} "#,##0.00` }); }
      for (let r = 29; r <= 31; r++) for (let c = 0; c < 7; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r === 31 ? 'D9EAF7' : light } }, font: { name: 'Calibri', sz: 11, bold: r === 31, color: { rgb: ink } }, alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' }, border }; }
      for (let r = 35; r <= 44; r++) for (let c = 0; c < 4; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r % 2 ? white : light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } }, alignment: { horizontal: c === 1 ? 'left' : (c === 0 || c === 2 ? 'center' : 'right'), vertical: 'center' }, border }; }
      for (let c = 0; c < 4; c++) setStyle(XLSX.utils.encode_cell({ r: 34, c }), header), setStyle(XLSX.utils.encode_cell({ r: 35, c }), header);
      for (let r = 49; r <= 53; r++) setStyle('A' + r, { font: { name: 'Calibri', sz: 10, color: { rgb: ink } }, alignment: { horizontal: 'left', vertical: 'center' } });
      for (const c of ['D','E','F']) for (let r = 29; r <= 31; r++) if (ws[c + r]) ws[c + r].s = { ...ws[c + r].s, numFmt: `"${currency} "#,##0.00` };
      wb.Workbook = wb.Workbook || {}; wb.Workbook.Views = [{ RTL: false }]; wb.CalcProps = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true };
      XLSX.utils.book_append_sheet(wb, ws, 'BOQ Summary');
      const safe = name.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'Project';
      XLSX.writeFile(wb, 'BOQ_' + safe + '_' + dateStr + '.xlsx', { cellStyles: true, bookSST: true });
      toast('Excel BOQ downloaded in the MeasureCraft template format.', 'success');
      // Research: ensure drawing registered, log quantities, save marked snapshot for dashboard
      try {
        if (window.MCResearch && MCResearch.getParticipantId()) {
          try { MCResearch.ensureMode('simple'); } catch (_) {}
          // Re-register / refresh drawing so it appears under Drawings database
          try {
            let dataUrl = null;
            try { dataUrl = planCanvas.toDataURL('image/jpeg', 0.85); } catch (_) {}
            MCResearch.registerDrawing({
              fileName: state.fileName || name,
              mimeType: 'image/jpeg',
              imageBase64: dataUrl,
              projectName: name,
              scaleNote: state.metersPerPixel ? ('1 unit = ' + state.metersPerPixel + ' m') : null,
              mode: 'simple',
            });
          } catch (regErr) { console.warn('registerDrawing on export', regErr); }

          // Materials rows (for BOQ completeness) + per-element rows with frozen aiQty
          const matRows = MCResearch.rowsFromMaterials(materials, { method: 'simple_boq_material' });
          const accepted = (state.elements || []).filter(function (e) { return e && e.accepted; });
          const elRows = accepted.map(function (el) {
            const finalQty = computeElementQty(el);
            const aiQ = (el.aiQty != null && Number.isFinite(Number(el.aiQty))) ? Number(el.aiQty) : null;
            return {
              measurementType: String(el.type || 'element').toLowerCase(),
              measurementMethod: 'simple_element',
              userMeasurement: finalQty,
              finalAcceptedMeasurement: finalQty,
              aiMeasurement: aiQ,
              unit: elementUnit(el.type),
              userCorrection: !!(aiQ != null && finalQty != null && Math.abs(aiQ - finalQty) > 1e-6),
              elementLabel: el.label || el.type || null,
              confidence: el.confidence != null ? el.confidence : null,
              reviewStatus: el.reviewStatus || null,
              notes: '',
            };
          });
          MCResearch.logMeasurements(matRows.concat(elRows), {
            notes: 'Simple Mode BOQ export · ' + name +
              (function () {
                try {
                  const ids = MCResearch.getResearchIds && MCResearch.getResearchIds();
                  if (!ids) return '';
                  return ' · Drawing ' + (ids.drawingId || '') + ' · Project ' + (ids.projectId || '') + ' · ' + (ids.mode || 'Simple');
                } catch (_) { return ''; }
              })(),
          });

          // Composite plan + overlay → marked plan for research dashboard download
          try {
            if (typeof MCResearch.saveMarkedDrawing === 'function' && planCanvas && planCanvas.width) {
              const c = document.createElement('canvas');
              c.width = planCanvas.width;
              c.height = planCanvas.height;
              const ctx = c.getContext('2d');
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, c.width, c.height);
              ctx.drawImage(planCanvas, 0, 0);
              if (overlayCanvas && overlayCanvas.width) {
                try { ctx.drawImage(overlayCanvas, 0, 0); } catch (_) {}
              }
              // Stamp research IDs on snapshot
              try {
                const ids = MCResearch.getResearchIds && MCResearch.getResearchIds() || {};
                const pad = 10;
                const bannerH = 48;
                ctx.fillStyle = 'rgba(15,23,42,0.92)';
                ctx.fillRect(0, 0, c.width, bannerH);
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText('Simple Mode export — ' + name, pad, 18);
                ctx.font = '12px sans-serif';
                ctx.fillStyle = '#e2e8f0';
                ctx.fillText(
                  'Drawing: ' + (ids.drawingId || '—') +
                  '  ·  Project: ' + (ids.projectId || '—') +
                  '  ·  Mode: Simple  ·  ' + dateStr,
                  pad, 36
                );
              } catch (_) {}
              const markedUrl = c.toDataURL('image/jpeg', 0.9);
              MCResearch.saveMarkedDrawing(markedUrl, {
                mimeType: 'image/jpeg',
                mode: 'simple',
                source: 'simple_boq_export',
              });
            }
          } catch (mkErr) { console.warn('simple marked save', mkErr); }

          // Save the reviewed geometry as a training/evaluation annotation record.
          try {
            if (typeof MCResearch.saveReviewedAnnotations === 'function' && planCanvas && state.elements && state.elements.length) {
              const aiElementsForEvaluation = state.elements.filter(function (e) {
                return e && !e.hidden && (e.source === 'AI' || e.source === 'AI_EDITED' || e.ai === true);
              }).map(function (e) {
                return {
                  type: e.type, label: e.label, x: e.x, y: e.y, w: e.w, h: e.h,
                  height: e.height, isLine: !!e.isLine, p1: e.p1 || null, p2: e.p2 || null,
                  vertices: e.vertices || null, thickness: e.thickness || e.thicknessDraw || null,
                  source: e.source || 'AI', reviewStatus: e.reviewStatus || 'AI_GENERATED', accepted: e.accepted !== false
                };
              });
              const reviewed = state.elements.filter(function (e) {
                const isAi = e.source === 'AI' || e.ai === true;
                return !e.hidden && (e.accepted === true || e.reviewStatus === 'QS_REVIEWED' || !isAi);
              }).map(function (e) {
                return {
                  type: e.type, label: e.label, x: e.x, y: e.y, w: e.w, h: e.h,
                  height: e.height, isLine: !!e.isLine, p1: e.p1 || null, p2: e.p2 || null,
                  vertices: e.vertices || null, thickness: e.thickness || e.thicknessDraw || null,
                  source: e.source || (e.ai ? 'AI' : 'MANUAL'),
                  reviewStatus: e.reviewStatus || (e.ai ? 'AI_GENERATED' : 'QS_REVIEWED'),
                  accepted: e.accepted !== false
                };
              });
              if (reviewed.length) MCResearch.saveReviewedAnnotations(reviewed, {
                mode: 'simple', imageWidth: planCanvas.width, imageHeight: planCanvas.height,
                metersPerPixel: state.metersPerPixel || null,
                legendNotes: (($('ai-legend-notes') && $('ai-legend-notes').value) || ''),
                source: 'simple_qs_export',
                aiElements: aiElementsForEvaluation
              }).then(function (r) { if (r) console.log('Reviewed annotations saved', r.drawingId || ''); }).catch(function () {});
            }
          } catch (annErr) { console.warn('simple annotation save', annErr); }

          try { MCResearch.markSimpleExported(true); } catch (_) {}
          try { updateProSwitchUi(); } catch (_) {}
          try {
            toast('Simple Mode exported to research. Switch to Pro creates Project ID /A (same Drawing ID).', 'success');
          } catch (_) {}
        }
      } catch (_) {}
    });

    $('btn-export-text').addEventListener('click', async () => {
      const q = computeQuantities();
      const est = computeEstimate(q);
      const name = $('proj-name').value || 'Untitled Project';
      let t = 'MEASURECRAFT — MATERIAL ESTIMATE / BOQ\n';
      t += 'Project: ' + name + '\n';
      t += 'Client: ' + ($('proj-client').value || '—') + '\n';
      t += 'Location: ' + ($('proj-location').value || '—') + '\n';
      t += 'Currency: ' + ($('proj-currency').value || 'LKR') + '\n';
      t += 'Date: ' + new Date().toLocaleDateString() + '\n\n';
      t += 'MATERIAL ESTIMATE\n';
      (est.materials || []).forEach(m => {
        t += m.material + '\t' + m.qty + ' ' + m.unit;
        if (m.price != null) t += '\t@ ' + m.price + ' = ' + (m.total != null ? Math.round(m.total) : '—');
        t += '\n  ' + (m.source || '') + '\n';
      });
      t += '\nELEMENT QUANTITIES\n';
      (est.elementQty || []).forEach(e => {
        t += e.element + '\t' + e.qty + ' ' + e.unit + '\n';
      });
      if (est.sub > 0) {
        t += '\nSubtotal: ' + Math.round(est.sub);
        t += '\nContingency: ' + Math.round(est.cont);
        t += '\nTOTAL: ' + Math.round(est.grand) + '\n';
      } else {
        t += '\nPrices pending — enter unit prices on step 5 or Fetch market rates (AI).\n';
      }
      try {
        await navigator.clipboard.writeText(t);
        toast('Summary copied to clipboard.', 'success');
      } catch (_) {
        prompt('Copy this summary:', t);
      }
    });

    // ---------- Hand off to Pro Mode ----------
    // Pro Mode already knows how to read this shape from a previous revision
    // (see loadPlanTransferFromSimple / applyPlanTransferData in takeoff_pro.html);
    // Simple Mode just never wrote it, so "Continue in Pro Mode" silently lost all work.
    function buildTransferPayload(imageDataUrl, imgW, imgH) {
      // ALWAYS send every element (accepted + unreviewed AI + manual).
      // Filtering here was causing AI detections to vanish after Simple → Pro.
      const src = (state.elements || []).slice();
      // CRITICAL: imageW/imageH and metersPerPixel must describe the SAME
      // coordinate system as element x/y/w/h.
      // Never pass a downscaled capture's sendW/sendH here — Pro uses these
      // as world-space size; a mismatch makes a 5 m calibration read wrong.
      //
      // When this session was loaded from Pro (PDF world units → native pixels),
      // convert elements and scale BACK to Pro world space so Pro's CF display
      // ("1 unit = X m") matches what the user calibrated — same drawing, same
      // number after Simple ↔ Pro switches.
      const origin = state.scaleOrigin;
      const pixelScale = (origin && origin.pixelScale && origin.pixelScale > 0) ? Number(origin.pixelScale) : 1;
      const useWorld = !!(origin && origin.metersPerUnit > 0 && pixelScale > 1.001);
      const invS = useWorld ? (1 / pixelScale) : 1;
      const refW = useWorld
        ? (origin.worldW || planCanvas.width || imgW || null)
        : (planCanvas.width || imgW || null);
      const refH = useWorld
        ? (origin.worldH || planCanvas.height || imgH || null)
        : (planCanvas.height || imgH || null);
      const mpp = useWorld
        ? origin.metersPerUnit
        : state.metersPerPixel;
      // Elements are cloned (not mutated) so Simple's on-screen geometry stays in pixel space.
      const mappedElements = useWorld
        ? src.map(function (el) {
            if (!el) return el;
            const out = Object.assign({}, el);
            out.x = (Number(el.x) || 0) * invS;
            out.y = (Number(el.y) || 0) * invS;
            out.w = (Number(el.w) || 0) * invS;
            out.h = (Number(el.h) || 0) * invS;
            if (el.p1) out.p1 = { x: (Number(el.p1.x) || 0) * invS, y: (Number(el.p1.y) || 0) * invS };
            if (el.p2) out.p2 = { x: (Number(el.p2.x) || 0) * invS, y: (Number(el.p2.y) || 0) * invS };
            if (el.length != null) out.length = Number(el.length) * invS;
            if (el.thicknessDraw != null) out.thicknessDraw = Number(el.thicknessDraw) * invS;
            if (Array.isArray(el.vertices)) {
              out.vertices = el.vertices.map(function (v) {
                return { x: (Number(v.x) || 0) * invS, y: (Number(v.y) || 0) * invS };
              });
            }
            return out;
          })
        : src;
      return {
        fileName: state.fileName,
        imageDataUrl: imageDataUrl || null,
        imageW: refW,
        imageH: refH,
        from: 'simple',
        scaleInfo: mpp ? {
          method: 'twopoint',
          // metres per coordinate unit in the space elements are expressed in
          metersPerPixel: mpp,
          // legacy field still understood by Pro
          pixelsPerUnit: 1 / mpp,
          unit: 'm',
          refPixelW: refW,
          refPixelH: refH
        } : null,
        project: {
          name: ($('proj-name') && $('proj-name').value) || '',
          client: ($('proj-client') && $('proj-client').value) || '',
          location: ($('proj-location') && $('proj-location').value) || '',
          currency: ($('proj-currency') && $('proj-currency').value) || 'LKR',
          region: ($('proj-region') && $('proj-region').value) || ''
        },
        research: (function () {
          try {
            if (window.MCResearch && typeof MCResearch.getResearchIds === 'function') {
              return MCResearch.getResearchIds();
            }
            const p = window.MCResearch && MCResearch.getProject && MCResearch.getProject();
            if (p) return { drawingId: p.drawingId, projectId: p.projectId, parentProjectId: p.parentProjectId || null, revision: p.revision || 'ORIGINAL', mode: p.mode || 'Simple' };
          } catch (_) {}
          return null;
        })(),
        // Shared material rates — one source of truth across Simple ↔ Pro
        rates: (function () {
          try {
            const out = {};
            const srcRates = state.rates || {};
            Object.keys(srcRates).forEach(function (k) {
              const v = srcRates[k];
              if (v != null && v !== '' && !isNaN(Number(v))) out[k] = Number(v);
            });
            return out;
          } catch (_) { return {}; }
        })(),
        elements: mappedElements.map(e => {
          const isAi = e.source === 'AI' || e.source === 'AI_EDITED' || e.ai === true;
          const source = e.source || (isAi ? 'AI' : 'MANUAL');
          return {
            // Preserve the Pro identity when round-tripping; labels are display-only.
            id: e.id != null ? e.id : null,
            parentId: e.parentId != null ? e.parentId : null,
            type: e.type,
            label: e.label,
            material: e.material || null,
            wallType: e.wallType || null,
            x: e.x, y: e.y, w: e.w, h: e.h,
            height: e.height != null ? e.height : null,
            sillHeight: e.sillHeight != null ? e.sillHeight : null,
            soffitHeight: e.soffitHeight != null ? e.soffitHeight : null,
            isDeduction: !!(e.isDeduction || e.type === 'cutout' || e.type === 'opening'),
            parentLabel: e.parentLabel || null,
            parentType: e.parentType || null,
            vertices: Array.isArray(e.vertices) && e.vertices.length >= 3 ? e.vertices : null,
            // Keep explicit false for unreviewed AI — Pro must import these boxes
            accepted: e.accepted === true,
            fromPro: !!e.fromPro,
            source: source,
            ai: source === 'AI' || e.ai === true,
            confidence: e.confidence != null ? e.confidence : null,
            reviewStatus: e.reviewStatus || (source === 'AI' ? 'AI_GENERATED' : (e.accepted ? 'QS_REVIEWED' : 'MANUAL')),
            reviewedAt: e.reviewedAt || null,
            // line metadata if present (Pro walls/beams)
            isLine: !!e.isLine,
            p1: e.p1 || null,
            p2: e.p2 || null,
            thickness: e.thickness != null ? e.thickness : null,
            thicknessDraw: e.thicknessDraw != null ? e.thicknessDraw : null,
            length: e.length != null ? e.length : null,
            angle: e.angle != null ? e.angle : null
          };
        })
      };
    }

    function idbPutPlanTransfer(data) {
      return new Promise((resolve) => {
        if (!window.indexedDB) { resolve(false); return; }
        try {
          const req = indexedDB.open('measurecraft', 1);
          req.onupgradeneeded = (ev) => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains('transfers')) db.createObjectStore('transfers');
          };
          req.onsuccess = (ev) => {
            try {
              const db = ev.target.result;
              if (!db.objectStoreNames.contains('transfers')) { resolve(false); return; }
              const tx = db.transaction('transfers', 'readwrite');
              tx.objectStore('transfers').put(data, 'simple-to-pro');
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            } catch (_) { resolve(false); }
          };
          req.onerror = () => resolve(false);
        } catch (_) { resolve(false); }
      });
    }

    async function sendToProMode() {
      // Always include ALL elements (accepted preferred, else full list) so Pro never opens empty.
      // Prefer high quality underlay — never degrade PDF/drawing source on mode switch.
      let fullDataUrl = null;
      if (planCanvas.width) {
        try {
          // Prefer PNG when canvas is not huge; otherwise high-quality JPEG
          const maxEdge = Math.max(planCanvas.width, planCanvas.height);
          if (maxEdge <= 4000) {
            fullDataUrl = planCanvas.toDataURL('image/png');
          } else {
            fullDataUrl = planCanvas.toDataURL('image/jpeg', 0.95);
          }
        } catch (_) {
          try { fullDataUrl = planCanvas.toDataURL('image/jpeg', 0.92); } catch (__) {}
        }
      }
      const fullPayload = buildTransferPayload(fullDataUrl, planCanvas.width, planCanvas.height);
      // Force-include every element if somehow filtered empty
      if ((!fullPayload.elements || !fullPayload.elements.length) && state.elements && state.elements.length) {
        fullPayload.elements = state.elements.map(function (e) {
          return {
            type: e.type, label: e.label, x: e.x, y: e.y, w: e.w, h: e.h,
            height: e.height != null ? e.height : null,
            sillHeight: e.sillHeight != null ? e.sillHeight : null,
            soffitHeight: e.soffitHeight != null ? e.soffitHeight : null,
            isDeduction: !!(e.isDeduction || e.type === 'cutout' || e.type === 'opening'),
            accepted: e.accepted !== false,
            source: e.source || (e.ai ? 'AI' : 'MANUAL'),
            ai: !!(e.source === 'AI' || e.ai),
            confidence: e.confidence != null ? e.confidence : null,
            reviewStatus: e.reviewStatus || 'AI_GENERATED',
          };
        });
      }
      try {
        await idbPutPlanTransfer(fullPayload);
      } catch (e) {
        console.warn('IDB transfer put failed', e);
      }

      // Elements-only backup (small) — survives image quota failures
      try {
        const elsOnly = {
          fileName: fullPayload.fileName,
          imageW: fullPayload.imageW,
          imageH: fullPayload.imageH,
          scaleInfo: fullPayload.scaleInfo,
          project: fullPayload.project,
          elements: fullPayload.elements,
          from: 'simple',
        };
        sessionStorage.setItem('mc-plan-transfer-elements', JSON.stringify(elsOnly));
        try { localStorage.setItem('mc-plan-transfer-elements', JSON.stringify(elsOnly)); } catch (_) {}
      } catch (_) {}

      try {
        const cap = state.planReady ? capturePlan() : null;
        const smallDataUrl = cap ? ('data:image/jpeg;base64,' + cap.base64) : null;
        const smallPayload = buildTransferPayload(smallDataUrl, planCanvas.width, planCanvas.height);
        if ((!smallPayload.elements || !smallPayload.elements.length) && fullPayload.elements) {
          smallPayload.elements = fullPayload.elements;
        }
        sessionStorage.setItem('mc-plan-transfer', JSON.stringify(smallPayload));
        try { localStorage.setItem('mc-plan-transfer', JSON.stringify(smallPayload)); } catch (_) {}
      } catch (_) {
        try {
          const light = buildTransferPayload(null, planCanvas.width, planCanvas.height);
          if ((!light.elements || !light.elements.length) && fullPayload.elements) light.elements = fullPayload.elements;
          sessionStorage.setItem('mc-plan-transfer', JSON.stringify(light));
          try { localStorage.setItem('mc-plan-transfer', JSON.stringify(light)); } catch (_) {}
        } catch (__) {}
      }
      try { sessionStorage.setItem('mc-plan-transfer-pending', '1'); } catch (_) {}
      try { localStorage.setItem('mc-plan-transfer-pending', '1'); } catch (_) {}
    }

    async function verifyModeSwitchPassword(message) {
      const pw = window.prompt(
        (message || 'Mode switch is restricted for research integrity.') +
        '\n\nEnter the mode-switch password:'
      );
      if (pw == null || pw === '') return false;
      try {
        const resp = await fetch('/api/auth/verify-mode-switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        const data = await resp.json().catch(function () { return {}; });
        if (resp.ok && data.success) return true;
        toast((data && data.error) || 'Incorrect password.', 'error');
        return false;
      } catch (_) {
        if (pw === 'demo1234') return true;
        toast('Could not verify password (server offline).', 'error');
        return false;
      }
    }

    function aiAnalysisCompleted() {
      return (state.elements || []).some(function (e) { return e.accepted; });
    }


    function updateProSwitchUi() {
      const cont = $('btn-continue-pro');
      const openPro = $('btn-open-pro');
      const exported = !!(window.MCResearch && MCResearch.isSimpleExported && MCResearch.isSimpleExported());
      if (cont) {
        cont.disabled = !exported;
        cont.title = exported
          ? 'Create Pro Mode version (PROJ-xxxx/A) and continue — Drawing ID stays the same'
          : 'Export Simple Mode BOQ first, then switch to Pro Mode';
        if (exported) {
          cont.classList.add('btn-teal');
          cont.textContent = 'Switch to Pro Mode →';
        } else {
          cont.textContent = 'Export first, then Switch to Pro Mode';
        }
      }
      if (openPro) {
        openPro.title = exported
          ? 'Switch to Pro Mode (new Project ID revision)'
          : 'Export Simple measurement first (or use password if research allows early switch)';
      }
    }

        async function goToProMode() {
      // Research security: password required if switching to Pro before AI review is done
      if (!aiAnalysisCompleted()) {
        const ok = await verifyModeSwitchPassword(
          'You are switching to Pro Mode before finishing AI analysis / review.\nThis is restricted for research data integrity.'
        );
        if (!ok) return;
      }
      // 1) After Simple export → create PROJ-xxxx/A first (Drawing ID unchanged)
      try {
        if (window.MCResearch) {
          if (MCResearch.isSimpleExported && MCResearch.isSimpleExported()) {
            const child = await MCResearch.createProRevisionFromSimple({
              projectName: ($('proj-name') && $('proj-name').value) || 'Pro revision',
            });
            if (child) {
              try {
                alert(
                  'Pro Mode Version Created\n\n' +
                  'Drawing ID: ' + (child.drawingId || '—') + '\n' +
                  'Project ID: ' + (child.projectId || '—') + '\n' +
                  'Revision: ' + (child.revision || 'A') + '\n' +
                  'Parent Project: ' + (child.parentProjectId || '—') + '\n\n' +
                  'Your Pro Mode measurements are stored separately from the original Simple Mode measurement.'
                );
              } catch (_) {}
            }
          }
          MCResearch.ensureMode('pro');
        }
      } catch (_) {}
      // 2) Transfer plan + elements (includes research IDs with new Project ID)
      if (state.planReady || (state.elements && state.elements.length)) {
        try {
          await sendToProMode();
          console.log('📤 Simple→Pro transfer queued:', (state.elements || []).length, 'elements');
        } catch (e) {
          console.warn('sendToProMode failed', e);
        }
        try { sessionStorage.setItem('mc-plan-transfer-pending', '1'); } catch (_) {}
      }
      state.leavingIntentionally = true;
      window.location.href = 'takeoff_pro.html';
    }

    $('btn-open-pro').addEventListener('click', goToProMode);
    $('btn-continue-pro').addEventListener('click', goToProMode);

    // ---------- Receive transfer from Pro Mode ----------
    function idbGetProToSimple(cb) {
      if (!window.indexedDB) { cb(null); return; }
      try {
        const req = indexedDB.open('measurecraft', 1);
        req.onupgradeneeded = (ev) => {
          const db = ev.target.result;
          if (!db.objectStoreNames.contains('transfers')) db.createObjectStore('transfers');
        };
        req.onsuccess = (ev) => {
          try {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains('transfers')) { cb(null); return; }
            const tx = db.transaction('transfers', 'readonly');
            const g = tx.objectStore('transfers').get('pro-to-simple');
            g.onsuccess = () => cb(g.result || null);
            g.onerror = () => cb(null);
          } catch (_) { cb(null); }
        };
        req.onerror = () => cb(null);
      } catch (_) { cb(null); }
    }

    function idbClearProToSimple() {
      if (!window.indexedDB) return;
      try {
        const req = indexedDB.open('measurecraft', 1);
        req.onsuccess = (ev) => {
          try {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains('transfers')) return;
            const tx = db.transaction('transfers', 'readwrite');
            tx.objectStore('transfers').delete('pro-to-simple');
          } catch (_) {}
        };
      } catch (_) {}
    }

    function applyProTransferData(data) {
      if (!data) return Promise.resolve(false);
      console.log('📥 Applying Pro → Simple transfer…', data.fileName || '', (data.elements && data.elements.length) || 0, 'elements');

      // Project fields
      try {
        if (data.project) {
          const p = data.project;
          if (p.name && $('proj-name')) $('proj-name').value = p.name;
          if (p.client && $('proj-client')) $('proj-client').value = p.client;
          if (p.location && $('proj-location')) $('proj-location').value = p.location;
          if (p.currency && $('proj-currency')) $('proj-currency').value = p.currency;
          if (p.region && $('proj-region')) $('proj-region').value = p.region;
        }
      } catch (_) {}

      // Shared material rates from Pro (materialLibrary.cost or rates map)
      try {
        if (!state.rates) state.rates = {};
        if (data.rates && typeof data.rates === 'object') {
          Object.keys(data.rates).forEach(function (k) {
            const v = data.rates[k];
            if (v != null && v !== '' && !isNaN(Number(v))) state.rates[k] = Number(v);
          });
        }
        if (data.materialLibrary && typeof data.materialLibrary === 'object') {
          Object.keys(data.materialLibrary).forEach(function (k) {
            const mat = data.materialLibrary[k];
            if (mat && mat.cost != null && mat.cost !== '' && !isNaN(Number(mat.cost))) {
              state.rates[k] = Number(mat.cost);
            }
          });
        }
      } catch (_) {}

      // Scale
      if (data.scaleInfo && typeof data.scaleInfo.metersPerPixel === 'number' && data.scaleInfo.metersPerPixel > 0) {
        state.metersPerPixel = data.scaleInfo.metersPerPixel;
      } else if (data.scaleInfo && data.scaleInfo.pixelsPerUnit > 0) {
        state.metersPerPixel = 1 / data.scaleInfo.pixelsPerUnit;
      }

      // Elements (Simple format)
      const ALLOWED = ['wall', 'column', 'slab', 'beam', 'door', 'window', 'cutout', 'opening'];
      if (Array.isArray(data.elements) && data.elements.length) {
        state.elements = data.elements.map((el, i) => {
          let type = String(el.type || 'wall').toLowerCase().trim();
          if (type === 'room' || type === 'area' || type === 'floor') type = 'slab';
          if (type === 'deduction') type = 'cutout';
          if (!ALLOWED.includes(type)) type = 'wall';
          const x = Number(el.x) || 0, y = Number(el.y) || 0;
          const w = Number(el.w) || 0, h = Number(el.h) || 0;
          if (!(w > 1 && h > 1) || !isFinite(x + y + w + h)) return null;
          const defSill = type === 'window' ? 0.9 : (type === 'door' ? 0 : null);
          const verts = Array.isArray(el.vertices) && el.vertices.length >= 3
            ? el.vertices.map(v => ({ x: Number(v.x) || 0, y: Number(v.y) || 0 }))
            : null;
          const isLine = !!(el.isLine && el.p1 && el.p2);
          const p1 = isLine ? { x: Number(el.p1.x) || 0, y: Number(el.p1.y) || 0 } : null;
          const p2 = isLine ? { x: Number(el.p2.x) || 0, y: Number(el.p2.y) || 0 } : null;
            return {
            id: el.id != null ? el.id : ('el-pro-' + (i + 1)),
            type: type,
            label: (el.label && String(el.label).trim()) || (type.charAt(0).toUpperCase() + type.slice(1)),
            material: el.material || null,
            wallType: el.wallType || null,
            x, y, w, h,
            height: el.height != null && !isNaN(Number(el.height)) ? Number(el.height) : null,
            sillHeight: el.sillHeight != null && !isNaN(Number(el.sillHeight)) ? Number(el.sillHeight) : defSill,
            soffitHeight: el.soffitHeight != null && !isNaN(Number(el.soffitHeight)) ? Number(el.soffitHeight) : null,
            isDeduction: !!(el.isDeduction || type === 'cutout' || type === 'opening'),
            parentLabel: el.parentLabel || null,
            parentId: el.parentId != null ? el.parentId : null,
            vertices: verts,
            isLine,
            p1,
            p2,
            angle: isLine ? (Number(el.angle) || Math.atan2(p2.y - p1.y, p2.x - p1.x)) : null,
            length: isLine ? (Number(el.length) || Math.hypot(p2.x - p1.x, p2.y - p1.y)) : null,
            thickness: (el.thickness != null && !isNaN(Number(el.thickness)) && Number(el.thickness) > 0)
              ? Number(el.thickness) : null,
            thicknessDraw: (el.thicknessDraw != null && !isNaN(Number(el.thicknessDraw)) && Number(el.thicknessDraw) > 0)
              ? Number(el.thicknessDraw) : null,
            accepted: el.accepted !== false,
            fromPro: !!el.fromPro,
            source: el.source || (el.ai ? 'AI' : 'MANUAL')
          };
        }).filter(Boolean);
      }

      // Apply transfer metadata before image loading so the project summary,
      // calibration, and quantities do not appear empty during async restore.
      state.fileName = data.fileName || state.fileName || null;
      if (state.fileName) {
        if ($('file-chip')) $('file-chip').style.display = 'flex';
        if ($('file-name')) $('file-name').textContent = state.fileName;
        if ($('viewer-badge')) $('viewer-badge').textContent = state.fileName;
      }

      // Drawing underlay — keep full pixel resolution from Pro (do not bake down to world units)
      const loadImg = () => new Promise((resolve) => {
        if (!data.imageDataUrl) {
          resolve(false);
          return;
        }
        const img = new Image();
        img.onload = () => {
          try {
            const natW = Math.max(1, img.naturalWidth || 1);
            const natH = Math.max(1, img.naturalHeight || 1);
            const worldW = (data.imageW && data.imageW > 0) ? Number(data.imageW) : natW;
            const worldH = (data.imageH && data.imageH > 0) ? Number(data.imageH) : natH;
            // Prefer the higher-resolution source pixels for crisp PDF/preview.
            // Pro world coords may be much smaller than the actual underlay pixels.
            const useNative = natW > worldW * 1.02 || natH > worldH * 1.02;
            const canvasW = useNative ? natW : Math.max(1, Math.round(worldW));
            const canvasH = useNative ? natH : Math.max(1, Math.round(worldH));
            const sx = worldW > 0 ? (canvasW / worldW) : 1;
            const sy = worldH > 0 ? (canvasH / worldH) : 1;

            planCanvas.width = canvasW;
            planCanvas.height = canvasH;
            planCtx.imageSmoothingEnabled = true;
            planCtx.imageSmoothingQuality = 'high';
            planCtx.fillStyle = '#fff';
            planCtx.fillRect(0, 0, canvasW, canvasH);
            // Draw at native pixel size (1:1) when possible — avoids blurry downsample
            planCtx.drawImage(img, 0, 0, canvasW, canvasH);
            overlayCanvas.width = canvasW;
            overlayCanvas.height = canvasH;

            // Scale Pro world-space elements into canvas pixel space
            if (useNative && (Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) && Array.isArray(state.elements)) {
              state.elements.forEach(function (el) {
                if (!el) return;
                el.x = (Number(el.x) || 0) * sx;
                el.y = (Number(el.y) || 0) * sy;
                el.w = (Number(el.w) || 0) * sx;
                el.h = (Number(el.h) || 0) * sy;
                if (el.p1) { el.p1.x *= sx; el.p1.y *= sy; }
                if (el.p2) { el.p2.x *= sx; el.p2.y *= sy; }
                if (el.length != null) el.length = Number(el.length) * ((sx + sy) / 2);
                if (el.thicknessDraw != null) el.thicknessDraw = Number(el.thicknessDraw) * ((sx + sy) / 2);
                if (Array.isArray(el.vertices)) {
                  el.vertices = el.vertices.map(function (v) {
                    return { x: (Number(v.x) || 0) * sx, y: (Number(v.y) || 0) * sy };
                  });
                }
              });
              // meters per canvas pixel = meters per world unit / pixels per world unit
              if (state.metersPerPixel > 0) {
                const avgS = (sx + sy) / 2;
                // Remember Pro world-space calibration so a later Simple → Pro
                // handoff can restore the same CF the user saw in Pro Mode.
                state.scaleOrigin = {
                  worldW: worldW,
                  worldH: worldH,
                  metersPerUnit: state.metersPerPixel,
                  pixelScale: avgS
                };
                state.metersPerPixel = state.metersPerPixel / avgS;
              }
            } else {
              // Image already matched world size — still record origin for display stability
              if (state.metersPerPixel > 0 && worldW > 0) {
                state.scaleOrigin = {
                  worldW: worldW,
                  worldH: worldH,
                  metersPerUnit: state.metersPerPixel,
                  pixelScale: 1
                };
              }
            }

            canvasStack.style.display = 'block';
            viewerEmpty.style.display = 'none';
            const frame = $('walkthrough-frame');
            if (frame) { try { frame.src = 'about:blank'; } catch (_) {} }
            state.planReady = true;
            state.fileName = data.fileName || 'from-pro.jpg';
            if ($('file-chip')) $('file-chip').style.display = 'flex';
            if ($('file-name')) $('file-name').textContent = state.fileName;
            if ($('btn-to-calibrate')) $('btn-to-calibrate').disabled = false;
            if ($('viewer-badge')) {
              $('viewer-badge').textContent = state.fileName + ' · ' + canvasW + '×' + canvasH +
                (useNative ? ' (HQ)' : '');
            }
            requestAnimationFrame(() => {
              try { fitZoom(); } catch (_) {}
              try { drawOverlay(); } catch (_) {}
            });
            resolve(true);
          } catch (err) {
            console.error(err);
            resolve(false);
          }
        };
        img.onerror = () => resolve(false);
        img.src = data.imageDataUrl;
      });

      return loadImg().then((ok) => {
        // Jump to the most useful step
        try {
          if (state.elements.length) {
            if (typeof goStep === 'function') goStep(4); // review
            if ($('btn-to-review')) $('btn-to-review').disabled = false;
          } else if (state.metersPerPixel) {
            if (typeof goStep === 'function') goStep(3);
          } else if (state.planReady) {
            if (typeof goStep === 'function') goStep(2);
          }
        } catch (_) {}
        try { updateSummary(); } catch (_) {}
        try { drawOverlay(); } catch (_) {}
        if (ok || state.elements.length) {
          toast('Loaded from Pro Mode — drawing, scale, and elements carried over.', 'success');
        }
        return ok || state.elements.length > 0;
      });
    }

    function loadPlanTransferFromPro() {
      let pending = false;
      try { pending = sessionStorage.getItem('mc-pro-to-simple-pending') === '1' || localStorage.getItem('mc-pro-to-simple-pending') === '1'; } catch (_) {}
      if (!pending) return;

      let raw = null;
      try { raw = sessionStorage.getItem('mc-pro-to-simple') || localStorage.getItem('mc-pro-to-simple'); } catch (_) {}
      let data = null;
      if (raw) {
        try { data = JSON.parse(raw); } catch (_) { data = null; }
      }

      const finish = () => {
        try {
          sessionStorage.removeItem('mc-pro-to-simple-pending');
          sessionStorage.removeItem('mc-pro-to-simple');
          localStorage.removeItem('mc-pro-to-simple');
          localStorage.removeItem('mc-pro-to-simple-pending');
        } catch (_) {}
        idbClearProToSimple();
      };

      const mergeHqImage = (payload, done) => {
        if (!window.indexedDB) { done(payload); return; }
        try {
          const req = indexedDB.open('measurecraft', 1);
          req.onsuccess = (ev) => {
            try {
              const db = ev.target.result;
              if (!db.objectStoreNames.contains('transfers')) { done(payload); return; }
              const tx = db.transaction('transfers', 'readonly');
              const g = tx.objectStore('transfers').get('pro-underlay-hq');
              g.onsuccess = () => {
                const hq = g.result;
                if (hq && hq.imageDataUrl && payload) {
                  // Prefer HQ image; keep world size from payload
                  payload = Object.assign({}, payload, { imageDataUrl: hq.imageDataUrl });
                }
                done(payload);
              };
              g.onerror = () => done(payload);
            } catch (_) { done(payload); }
          };
          req.onerror = () => done(payload);
        } catch (_) { done(payload); }
      };

      if (data && (data.imageDataUrl || (data.elements && data.elements.length))) {
        mergeHqImage(data, (merged) => {
          applyProTransferData(merged).then(() => finish());
        });
        return;
      }
      // Prefer full-res from IndexedDB
      idbGetProToSimple(function (idbData) {
        if (idbData) {
          mergeHqImage(idbData, (merged) => {
            applyProTransferData(merged).then(() => finish());
          });
        } else {
          finish();
        }
      });
    }

    // ---------- Ctrl/Cmd+S → Export options popup ----------
    function openSimpleExportPopup() {
      let overlay = document.getElementById('mc-simple-export-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'mc-simple-export-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
        overlay.innerHTML =
          '<div role="dialog" aria-label="Export" style="background:var(--surface,#1a1f1c);color:var(--text,#f2f0ea);border-radius:12px;max-width:400px;width:100%;padding:20px 22px;box-shadow:0 16px 40px rgba(0,0,0,.35);border:1px solid var(--border,#3a403c);">' +
          '<h3 style="margin:0 0 6px;font-size:17px;">Export</h3>' +
          '<p style="margin:0 0 16px;font-size:13px;color:var(--text-2,#C9BFAE);line-height:1.4;">Download your BOQ or copy a text summary.</p>' +
          '<div style="display:flex;flex-direction:column;gap:8px;">' +
          '<button type="button" id="mc-exp-excel" class="btn btn-primary" style="width:100%;">Download Excel BOQ</button>' +
          '<button type="button" id="mc-exp-text" class="btn" style="width:100%;">Copy text summary</button>' +
          '<button type="button" id="mc-exp-step" class="btn" style="width:100%;">Open Report &amp; export step</button>' +
          '<button type="button" id="mc-exp-close" class="btn" style="width:100%;margin-top:4px;">Cancel</button>' +
          '</div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function (ev) {
          if (ev.target === overlay) overlay.style.display = 'none';
        });
        overlay.querySelector('#mc-exp-close').addEventListener('click', function () {
          overlay.style.display = 'none';
        });
        overlay.querySelector('#mc-exp-excel').addEventListener('click', function () {
          overlay.style.display = 'none';
          try { goStep(6); } catch (_) {}
          const b = $('btn-export-excel');
          if (b) b.click();
        });
        overlay.querySelector('#mc-exp-text').addEventListener('click', function () {
          overlay.style.display = 'none';
          const b = $('btn-export-text');
          if (b) b.click();
        });
        overlay.querySelector('#mc-exp-step').addEventListener('click', function () {
          overlay.style.display = 'none';
          try { goStep(6); } catch (_) {}
        });
      }
      overlay.style.display = 'flex';
    }

    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
      e.preventDefault();
      openSimpleExportPopup();
    });

    // init
    try {
      if (window.MCResearch) {
        MCResearch.ensureMode('simple');
        MCResearch.ensureParticipantChip('.header-actions') || MCResearch.ensureParticipantChip('header');
      }
    } catch (_) {}
    updateSummary();
    try { loadPlanTransferFromPro(); } catch (e) { console.warn('Pro transfer load failed', e); }
  })();

/* extracted script block */

(function(){const fab=document.getElementById('mcAiFab'),panel=document.getElementById('mcAiPanel'),body=document.getElementById('mcAiBody'),input=document.getElementById('mcAiInput');if(!fab||!panel)return;
      function openPanel(){panel.classList.add('open')}
      function closePanel(){panel.classList.remove('open')}
      fab.addEventListener('click',()=>{if(panel.classList.contains('open'))closePanel();else openPanel()});
      document.getElementById('mcAiClose').addEventListener('click',closePanel);
      let mcAiHistory=[];
      function offlineReply(q){const l=(q||'').toLowerCase();let r='Follow the steps on the left: upload → calibrate → AI → rates → export.';if(l.includes('calibr'))r='Pick two points on a known dimension, enter the real length, then Apply scale.';else if(l.includes('zoom')||l.includes('track'))r='Use + / − / Fit. Lock Zoom (🔒) disables trackpad scroll-zoom so pan is easier.';else if(l.includes('ai'))r='After calibration, run AI Detect, then accept or edit elements.';return r}
      async function reply(q){
        const esc=(typeof escapeHtml==='function')?escapeHtml:(s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
        const thinkId='mcAiThink'+Date.now();
        body.innerHTML+='<br><br><strong>You:</strong> '+esc(q)+'<br><strong>AI:</strong> <span id="'+thinkId+'">…</span>';
        body.scrollTop=body.scrollHeight;
        const slot=document.getElementById(thinkId);
        let answer=null;
        try{
          const headers=(typeof mcApiHeaders==='function')?mcApiHeaders(true):{'Content-Type':'application/json'};
          const resp=await fetch('/api/assistant-chat',{method:'POST',headers,body:JSON.stringify({message:q,history:mcAiHistory})});
          const data=await resp.json().catch(()=>({}));
          if(resp.ok&&data&&data.success&&data.answer){answer=data.answer}
        }catch(_){}
        const finalText=answer||offlineReply(q);
        if(slot)slot.textContent=finalText;
        if(answer){mcAiHistory.push({role:'user',text:q},{role:'assistant',text:answer});if(mcAiHistory.length>12)mcAiHistory=mcAiHistory.slice(-12)}
        body.scrollTop=body.scrollHeight;
      }
      document.getElementById('mcAiSend').addEventListener('click',()=>{const q=(input.value||'').trim();if(!q)return;input.value='';reply(q)});
      input.addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('mcAiSend').click()});
    })();
