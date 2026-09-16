// ================================================================
//  MANUAL COUNT TOOL
//  Adds a "Count" button to the top toolbar that opens a small
//  "Count Objects" panel. Pick an object type, then click each
//  matching symbol on the drawing to tally it — markers are placed
//  in world (drawing) coordinates so they stay put on pan/zoom.
//  This module draws its own overlay on top of the 2D canvas and
//  reuses the existing screenToWorld / worldToScreen / getCanvasPointer
//  helpers exposed by takeoff_pro.js (same shared top-level script
//  scope, loaded first). It also lightly wraps renderCanvas2D,
//  computeQuantities and renderAll (see wrapGlobalFn) so counted
//  markers: (1) stay glued to the drawing on every zoom/pan redraw,
//  not just while this panel is open, (2) get real "Nr" rows in the
//  Live Quantities table, and (3) get a hidden backing element in the
//  main elements[] array so they show up in the Elements tree and are
//  editable/removable from Properties.
// ================================================================
(function () {
    'use strict';

    var DEFAULT_TYPES = [
        { id: 'door', label: 'Door', icon: 'fa-door-open', color: '#c4934a' },
        { id: 'window', label: 'Window', icon: 'fa-square', color: '#5b9bd5' },
        { id: 'wc', label: 'WC', icon: 'fa-toilet', color: '#10b981' },
        { id: 'wash_basin', label: 'Wash Basin', icon: 'fa-faucet', color: '#06b6d4' },
        { id: 'fan', label: 'Fan', icon: 'fa-fan', color: '#8b5cf6' },
        { id: 'sink', label: 'Sink', icon: 'fa-sink', color: '#0ea5e9' },
        { id: 'urinal', label: 'Urinal', icon: 'fa-restroom', color: '#14b8a6' },
        { id: 'floor_drain', label: 'Floor Drain', icon: 'fa-water', color: '#64748b' },
        { id: 'light', label: 'Light', icon: 'fa-lightbulb', color: '#f59e0b' },
        { id: 'socket', label: 'Socket', icon: 'fa-plug', color: '#ef4444' }
    ];

    var customTypes = [];
    var markers = [];       // { id, type, wx, wy }
    var history = [];       // stack of marker ids, for Undo Last
    var activeTypeId = null;
    var nextMarkerId = 1;
    var rafHandle = null;
    var storageKey = 'mc_manual_count_v1';

    function esc(s) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function allTypes() { return DEFAULT_TYPES.concat(customTypes); }

    function typeInfo(id) {
        var found = allTypes().filter(function (t) { return t.id === id; })[0];
        return found || { id: id, label: id, icon: 'fa-shapes', color: '#999999' };
    }

    // ----------------------------------------------------------------
    // Integration with the main takeoff document (elements / tree /
    // properties / live quantities). Each marker gets a lightweight,
    // hidden backing "element" so it shows up in the Elements panel and
    // Properties, and can be deleted from there too. It is created with
    // a "count_" type prefix (never the real 'door'/'window'/etc. types)
    // so it can never be picked up by wall/slab deduction or cutout
    // logic, and it is marked hidden so it never gets drawn a second
    // time on the 2D canvas underneath our own round marker dot.
    // Live Quantities gets its own proper Nr-per-type rows via
    // wrapComputeQuantities() below, independent of these elements.
    // ----------------------------------------------------------------
    function backingElementType(typeId) { return 'count_' + typeId; }

    function addBackingElement(marker) {
        if (typeof createElement !== 'function' || typeof addElement !== 'function') return null;
        if (typeof isConfirmed !== 'undefined' && isConfirmed) return null;
        try {
            var info = typeInfo(marker.type);
            var el = createElement(backingElementType(marker.type), marker.wx - 0.5, marker.wy - 0.5, 1, 1, {
                color: info.color,
                label: info.label + ' (count)',
                source: 'MANUAL',
                hidden: true,
                locked: false,
                isCount: true,
                zHeight: 0
            });
            addElement(el);
            return el.id;
        } catch (err) {
            console.warn('[count-tool] could not add backing element', err);
            return null;
        }
    }

    function spliceElementSilently(elId) {
        if (elId == null || typeof elements === 'undefined' || !Array.isArray(elements)) return false;
        var idx = -1;
        for (var i = 0; i < elements.length; i++) {
            if (elements[i].id === elId) { idx = i; break; }
        }
        if (idx === -1) return false;
        elements.splice(idx, 1);
        if (Array.isArray(selectedIds)) {
            selectedIds = selectedIds.filter(function (id) { return id !== elId; });
        }
        return true;
    }

    function removeBackingElements(elIds) {
        var any = false;
        (elIds || []).forEach(function (elId) {
            if (elId != null && spliceElementSilently(elId)) any = true;
        });
        if (any && typeof renderAll === 'function') {
            try { renderAll(); } catch (_) {}
        }
    }

    /** Drop any marker whose backing element was deleted elsewhere (e.g. via Properties). */
    function pruneOrphanMarkers() {
        if (typeof elements === 'undefined' || !Array.isArray(elements) || !markers.length) return;
        var liveIds = {};
        elements.forEach(function (e) { liveIds[e.id] = true; });
        var changed = false;
        markers = markers.filter(function (m) {
            if (m.elId == null) return true; // legacy marker from before this fix
            if (liveIds[m.elId]) return true;
            changed = true;
            return false;
        });
        if (changed) {
            history = history.filter(function (id) {
                return markers.some(function (m) { return m.id === id; });
            });
            save();
            renderAllUi();
        }
    }

    /** Monkey-patch a global render/compute function so our own sync logic
     *  runs right after it, using the same shared script-scope that lets
     *  this file already call screenToWorld / worldToScreen directly. */
    function wrapGlobalFn(name, after) {
        try {
            if (typeof window[name] !== 'function' || window[name]._mcCountWrapped) return;
            var orig = window[name];
            var wrapped = function () {
                var r = orig.apply(this, arguments);
                try { after(r); } catch (_) {}
                return r;
            };
            wrapped._mcCountWrapped = true;
            window[name] = wrapped;
        } catch (_) {}
    }

    function save() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({
                markers: markers, customTypes: customTypes, nextMarkerId: nextMarkerId
            }));
        } catch (_) { /* ignore quota / privacy-mode errors */ }
    }

    function load() {
        try {
            var raw = localStorage.getItem(storageKey);
            if (!raw) return;
            var data = JSON.parse(raw);
            if (data && Array.isArray(data.markers)) {
                markers = data.markers;
                customTypes = Array.isArray(data.customTypes) ? data.customTypes : [];
                nextMarkerId = data.nextMarkerId || (markers.length + 1);
            }
        } catch (_) { /* ignore corrupt storage */ }
    }

    document.addEventListener('DOMContentLoaded', init);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        // Script tag is at the very end of body, DOM is already parsed by the time it runs.
        setTimeout(init, 0);
    }

    var inited = false;
    function init() {
        if (inited) return;
        var panel = document.getElementById('mcCountPanel');
        var overlay = document.getElementById('mcCountOverlay');
        var toggleBtn = document.getElementById('btnManualCount');
        if (!panel || !overlay || !toggleBtn) return; // markup not present, bail quietly
        inited = true;
        load();

        var closeBtn = document.getElementById('mcCountClose');
        var typeGrid = document.getElementById('mcCountTypeGrid');
        var statusEl = document.getElementById('mcCountStatus');
        var listEl = document.getElementById('mcCountList');
        var undoBtn = document.getElementById('mcCountUndo');
        var clearBtn = document.getElementById('mcCountClear');
        var doneBtn = document.getElementById('mcCountDone');
        var canvasEl = document.getElementById('canvas2d');

        function openPanel() {
            panel.style.display = 'flex';
            pruneOrphanMarkers();
            renderAllUi();
            startSyncLoop();
        }
        function closePanel() {
            panel.style.display = 'none';
            disarm();
        }
        function togglePanel() {
            if (panel.style.display === 'none' || !panel.style.display) openPanel();
            else closePanel();
        }

        function setActiveType(id) {
            activeTypeId = (activeTypeId === id) ? null : id;
            renderAllUi();
        }

        function arm() { overlay.classList.add('armed'); }
        function disarm() { overlay.classList.remove('armed'); }

        function addCustomType() {
            var label = window.prompt('Name of the custom object to count (e.g. "Extract Fan"):');
            if (!label) return;
            var trimmed = label.trim();
            if (!trimmed) return;
            var id = 'custom_' + trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + Date.now();
            customTypes.push({ id: id, label: trimmed, icon: 'fa-shapes', color: '#ec4899' });
            activeTypeId = id;
            save();
            renderAllUi();
        }

        function placeMarker(sx, sy) {
            if (!activeTypeId) return;
            if (typeof screenToWorld !== 'function') return;
            var world = screenToWorld(sx, sy);
            var marker = { id: nextMarkerId++, type: activeTypeId, wx: world.x, wy: world.y, elId: null };
            marker.elId = addBackingElement(marker);
            markers.push(marker);
            history.push(marker.id);
            save();
            renderAllUi();
        }

        function undoLast() {
            if (!history.length) return;
            var lastId = history.pop();
            var removed = markers.filter(function (m) { return m.id === lastId; });
            markers = markers.filter(function (m) { return m.id !== lastId; });
            removeBackingElements(removed.map(function (m) { return m.elId; }));
            save();
            renderAllUi();
        }

        function clearCurrent() {
            var toRemove;
            if (!activeTypeId) {
                if (!markers.length) return;
                if (!window.confirm('Clear ALL counted objects (every type)?')) return;
                toRemove = markers.slice();
                markers = [];
                history = [];
            } else {
                if (!window.confirm('Clear all "' + typeInfo(activeTypeId).label + '" counts?')) return;
                toRemove = markers.filter(function (m) { return m.type === activeTypeId; });
                markers = markers.filter(function (m) { return m.type !== activeTypeId; });
                history = history.filter(function (id) {
                    return markers.some(function (m) { return m.id === id; });
                });
            }
            removeBackingElements(toRemove.map(function (m) { return m.elId; }));
            save();
            renderAllUi();
        }

        function removeMarker(id) {
            var removed = markers.filter(function (m) { return m.id === id; });
            markers = markers.filter(function (m) { return m.id !== id; });
            history = history.filter(function (hid) { return hid !== id; });
            removeBackingElements(removed.map(function (m) { return m.elId; }));
            save();
            renderAllUi();
        }

        function renderTypeGrid() {
            typeGrid.innerHTML = '';
            allTypes().forEach(function (t) {
                var count = markers.filter(function (m) { return m.type === t.id; }).length;
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'mc-count-type-btn' + (activeTypeId === t.id ? ' active' : '');
                btn.innerHTML = '<i class="fas ' + t.icon + '"></i><span>' + esc(t.label) + '</span>' +
                    (count ? '<span class="mc-count-type-tally">' + count + '</span>' : '');
                btn.addEventListener('click', function () { setActiveType(t.id); });
                typeGrid.appendChild(btn);
            });
            var addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'mc-count-type-btn';
            addBtn.innerHTML = '<i class="fas fa-plus"></i><span>Custom</span>';
            addBtn.addEventListener('click', addCustomType);
            typeGrid.appendChild(addBtn);
        }

        function renderStatus() {
            if (activeTypeId) {
                statusEl.textContent = 'Click each ' + typeInfo(activeTypeId).label + ' symbol on the drawing. Click the button again to stop.';
                statusEl.classList.add('armed');
                arm();
            } else {
                statusEl.textContent = markers.length
                    ? 'Choose an object type to keep counting, or review the list below.'
                    : 'Choose an object type to start counting.';
                statusEl.classList.remove('armed');
                disarm();
            }
        }

        function renderList() {
            if (!markers.length) {
                listEl.innerHTML = '<div class="mc-count-empty">No count records yet.</div>';
                return;
            }
            var byType = {};
            markers.forEach(function (m) {
                byType[m.type] = (byType[m.type] || 0) + 1;
            });
            var ids = Object.keys(byType);
            listEl.innerHTML = '';
            ids.forEach(function (id) {
                var info = typeInfo(id);
                var row = document.createElement('div');
                row.className = 'mc-count-row';
                row.innerHTML = '<i class="fas ' + info.icon + '" style="color:' + info.color + ';"></i>' +
                    '<span class="mc-count-row-label">' + esc(info.label) + '</span>' +
                    '<span class="mc-count-row-total">' + byType[id] + '</span>';
                var delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'mc-count-row-del';
                delBtn.title = 'Remove last ' + info.label;
                delBtn.innerHTML = '<i class="fas fa-times"></i>';
                delBtn.addEventListener('click', function () {
                    var last = null;
                    for (var i = markers.length - 1; i >= 0; i--) {
                        if (markers[i].type === id) { last = markers[i].id; break; }
                    }
                    if (last != null) removeMarker(last);
                });
                row.appendChild(delBtn);
                listEl.appendChild(row);
            });
        }

        function renderAllUi() {
            renderTypeGrid();
            renderStatus();
            renderList();
            syncOverlayMarkers();
        }

        function syncOverlayMarkers() {
            if (typeof worldToScreen !== 'function') return;
            overlay.innerHTML = '';
            markers.forEach(function (m) {
                var info = typeInfo(m.type);
                var pt = worldToScreen(m.wx, m.wy);
                var el = document.createElement('div');
                el.className = 'mc-count-marker';
                el.style.setProperty('--mc-count-color', info.color);
                el.style.left = pt.x + 'px';
                el.style.top = pt.y + 'px';
                el.title = info.label;
                el.innerHTML = '<i class="fas ' + info.icon + '" style="font-size:9px;"></i>';
                // Count markers must remain draggable after placement.
                // They are interactive even while the count overlay is armed.
                el.style.pointerEvents = 'auto';
                el.style.cursor = 'grab';
                (function (marker, markerEl) {
                    var dragging = false;
                    var moved = false;
                    var startX = 0, startY = 0;
                    var startWx = marker.wx, startWy = marker.wy;

                    markerEl.addEventListener('mousedown', function (e) {
                        if (e.button !== 0) return;
                        dragging = true;
                        moved = false;
                        startX = e.clientX;
                        startY = e.clientY;
                        startWx = marker.wx;
                        startWy = marker.wy;
                        markerEl.style.cursor = 'grabbing';
                        e.preventDefault();
                        e.stopPropagation();
                    });

                    function moveMarker(e) {
                        if (!dragging || typeof screenToWorld !== 'function') return;
                        var dx = e.clientX - startX;
                        var dy = e.clientY - startY;
                        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
                        var base = worldToScreen(startWx, startWy);
                        var w = screenToWorld(base.x + dx, base.y + dy);
                        marker.wx = w.x;
                        marker.wy = w.y;

                        // Keep the hidden backing element synchronized so the
                        // Elements/Properties representation follows the marker.
                        if (marker.elId != null && typeof elements !== 'undefined' && Array.isArray(elements)) {
                            for (var i = 0; i < elements.length; i++) {
                                if (elements[i] && String(elements[i].id) === String(marker.elId)) {
                                    elements[i].x = marker.wx - (elements[i].w || 1) / 2;
                                    elements[i].y = marker.wy - (elements[i].h || 1) / 2;
                                    elements[i].locked = false;
                                    break;
                                }
                            }
                        }
                        syncOverlayMarkers();
                        e.preventDefault();
                        e.stopPropagation();
                    }

                    function finishMarkerDrag(e) {
                        if (!dragging) return;
                        dragging = false;
                        markerEl.style.cursor = 'grab';
                        if (moved) {
                            save();
                            try { if (typeof renderAll === 'function') renderAll(); } catch (_) {}
                        }
                        if (e) { e.preventDefault(); e.stopPropagation(); }
                    }

                    window.addEventListener('mousemove', moveMarker, true);
                    window.addEventListener('mouseup', finishMarkerDrag, true);
                    markerEl.addEventListener('click', function (e) {
                        // A dragged marker must never create a new count.
                        e.preventDefault();
                        e.stopPropagation();
                    }, true);
                })(m, el);
                overlay.appendChild(el);
            });
        }

        function startSyncLoop() {
            if (rafHandle) return;
            function tick() {
                if (panel.style.display === 'none' || !panel.style.display) { rafHandle = null; return; }
                syncOverlayMarkers();
                rafHandle = requestAnimationFrame(tick);
            }
            rafHandle = requestAnimationFrame(tick);
        }

        overlay.addEventListener('click', function (e) {
            if (!activeTypeId) return;
            if (typeof getCanvasPointer === 'function' && canvasEl) {
                var p = getCanvasPointer(e, canvasEl);
                placeMarker(p.sx, p.sy);
            } else {
                var rect = canvasEl ? canvasEl.getBoundingClientRect() : overlay.getBoundingClientRect();
                placeMarker(e.clientX - rect.left, e.clientY - rect.top);
            }
        });

        // ---- Let zoom / pan keep working while a count type is armed ----
        // The overlay has to sit on top of the canvas (pointer-events:auto)
        // so it can catch placement clicks, but that also swallows the
        // wheel event the canvas uses for zoom, and any drag used for
        // panning. Forward those through instead of eating them.
        var localSpaceHeld = false;
        function isTypingTargetSafe(t) {
            if (typeof isTypingTarget === 'function') {
                try { return isTypingTarget(t); } catch (_) {}
            }
            if (!t) return false;
            var tag = (t.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || !!t.isContentEditable;
        }
        window.addEventListener('keydown', function (e) {
            if (e.code === 'Space' && !isTypingTargetSafe(e.target)) localSpaceHeld = true;
        });
        window.addEventListener('keyup', function (e) {
            if (e.code === 'Space') localSpaceHeld = false;
        });

        overlay.addEventListener('wheel', function (e) {
            if (!canvasEl) return;
            try {
                var evt = new WheelEvent('wheel', {
                    deltaY: e.deltaY, deltaX: e.deltaX, deltaMode: e.deltaMode,
                    clientX: e.clientX, clientY: e.clientY,
                    ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
                    bubbles: true, cancelable: true
                });
                canvasEl.dispatchEvent(evt);
            } catch (_) {}
            e.preventDefault();
        }, { passive: false });

        overlay.addEventListener('mousedown', function (e) {
            var isPanGesture = e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || localSpaceHeld));
            if (!isPanGesture || !canvasEl) return;
            // Forward the initial mousedown to the canvas, then get out of the
            // way for the rest of the drag so native pan handling takes over.
            try {
                var down = new MouseEvent('mousedown', {
                    clientX: e.clientX, clientY: e.clientY, button: e.button, buttons: e.buttons,
                    altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey,
                    bubbles: true, cancelable: true
                });
                canvasEl.dispatchEvent(down);
            } catch (_) {}
            overlay.style.pointerEvents = 'none';
            var restore = function () {
                overlay.style.pointerEvents = ''; // let the .armed CSS class govern again
                window.removeEventListener('mouseup', restore);
            };
            window.addEventListener('mouseup', restore);
            e.preventDefault();
        });

        toggleBtn.addEventListener('click', togglePanel);
        closeBtn.addEventListener('click', closePanel);
        undoBtn.addEventListener('click', undoLast);
        clearBtn.addEventListener('click', clearCurrent);
        doneBtn.addEventListener('click', closePanel);

        // Keep markers aligned while the panel is closed too, in case other
        // tools trigger a resize — cheap since it only runs while markers exist.
        window.addEventListener('resize', function () { syncOverlayMarkers(); });

        // ---- Keep the overlay glued to the drawing on EVERY canvas redraw ----
        // (zoom wheel, pan drag, and any other edit) instead of only while
        // this panel happens to be open. This is what actually fixes markers
        // drifting away from their symbols during zoom/pan.
        wrapGlobalFn('renderCanvas2D', function () { syncOverlayMarkers(); });

        // ---- Give counted objects their own rows in Live Quantities ----
        // Independent of the backing elements above: sums each counted type
        // into a simple "Nr" row so the tally is visible in the on-canvas
        // Quantities table, not just inside this panel.
        wrapGlobalFn('computeQuantities', function (rows) {
            if (!Array.isArray(rows) || !markers.length) return;
            var byType = {};
            markers.forEach(function (m) { byType[m.type] = (byType[m.type] || 0) + 1; });
            Object.keys(byType).forEach(function (id) {
                var info = typeInfo(id);
                rows.push({
                    material: 'Manual Count',
                    element: info.label,
                    qty: byType[id],
                    gross: byType[id],
                    cutout: '—',
                    net: byType[id],
                    unit: 'Nr',
                    remarks: 'Counted manually on the drawing (Count tool)',
                    elementId: null,
                    elementLabel: info.label
                });
            });
        });

        // ---- Drop markers whose backing element was deleted elsewhere ----
        // (e.g. selected in the Elements tree and removed via Properties
        // → Delete, or Delete/Backspace on the canvas).
        wrapGlobalFn('renderAll', function () { pruneOrphanMarkers(); });

        try {
            if (typeof elements !== 'undefined' && Array.isArray(elements)) {
                elements.forEach(function (e) {
                    if (e && typeof e.type === 'string' && e.type.indexOf('count_') === 0) {
                        e.locked = false;
                        e.isCount = true;
                        if (e.zHeight == null || e.zHeight === 1) e.zHeight = 0;
                    }
                });
            }
        } catch (_) {}

        function onElementsDeleted(elIds) {
            if (!elIds || !elIds.length) return;
            var idSet = {};
            elIds.forEach(function (id) { idSet[String(id)] = true; });
            markers = markers.filter(function (m) {
                return !(m.elId != null && idSet[String(m.elId)]);
            });
            history = history.filter(function (id) {
                return markers.some(function (m) { return m.id === id; });
            });
            save();
            renderAllUi();
        }

        function syncMarkersFromElements() {
            if (typeof elements === 'undefined' || !Array.isArray(elements)) return;
            var byId = {};
            elements.forEach(function (e) {
                if (e && e.id != null) byId[String(e.id)] = e;
            });
            var changed = false;
            markers.forEach(function (m) {
                if (m.elId == null) return;
                var el = byId[String(m.elId)];
                if (!el) return;
                var cx = (el.x || 0) + (el.w || 1) / 2;
                var cy = (el.y || 0) + (el.h || 1) / 2;
                if (m.wx !== cx || m.wy !== cy) {
                    m.wx = cx;
                    m.wy = cy;
                    changed = true;
                }
            });
            if (changed) {
                save();
                try { renderAllUi(); } catch (_) {}
            }
        }

        try {
            window.MCCountTool = {
                onElementsDeleted: onElementsDeleted,
                getMarkers: function () { return markers.slice(); },
                pruneOrphanMarkers: pruneOrphanMarkers,
                syncMarkersFromElements: syncMarkersFromElements
            };
        } catch (_) {}
    }
})();
