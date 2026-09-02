// ================================================================
        //  ADVANCED QUANTITY TAKEOFF PRO
        //  Features: 3D Viewer, Cost Engine, Material Library,
        //  Layer Management, Measurement Tool, Dark Mode
        //  + Line‑based Deduction Wall (yellow) continuous polyline
        //  + Continuous wall/beam polyline drawing with live preview
        //  + All elements fully editable (move, vertices, reshape)
        //  + Smart snapping: hover highlights parent, click snaps to it
        //  + Export as Excel BOQ
        // ================================================================

        console.log('🚀 Starting MeasureCraft Takeoff Pro...');

        // ----- TOAST NOTIFICATIONS (prefer over alert for non-blocking feedback) -----
        function showToast(message, type) {
            const el = document.getElementById('mcToast');
            if (!el) { try { console.log('[toast]', message); } catch (_) {} return; }
            el.textContent = message;
            el.style.borderColor = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--success)' : 'var(--border-color)';
            el.style.opacity = '1';
            el.style.transform = 'translateX(-50%) translateY(0)';
            clearTimeout(showToast._t);
            showToast._t = setTimeout(() => {
                el.style.opacity = '0';
                el.style.transform = 'translateX(-50%) translateY(20px)';
            }, type === 'error' ? 4500 : 2800);
        }

        function updateStatusBarMeta() {
            try {
                const zoomEl = document.getElementById('statusZoom');
                if (zoomEl && typeof viewport !== 'undefined' && viewport) {
                    const pct = Math.round((viewport.scale || 1) * 100) + '%';
                    zoomEl.textContent = 'Zoom: ' + pct + (typeof zoomLocked !== 'undefined' && zoomLocked ? ' 🔒' : '');
                }
                const scaleEl = document.getElementById('statusScale');
                if (scaleEl) {
                    if (typeof calibrationFactor !== 'undefined' && calibrationFactor && Math.abs(calibrationFactor - 1) >= 1e-9) {
                        // Match calibDisplay / Excel scale note so Simple ↔ Pro never show a different value.
                        const cf = Number(calibrationFactor);
                        scaleEl.textContent = 'Scale: 1 unit = ' + (cf >= 1 ? cf.toFixed(4) : cf.toFixed(6)) + ' m';
                    } else {
                        scaleEl.textContent = 'Scale: not calibrated';
                    }
                }
                const elemsEl = document.getElementById('statusElems');
                if (elemsEl && typeof elements !== 'undefined') {
                    const n = (elements || []).filter(e => !e.hidden).length;
                    elemsEl.textContent = n + ' element' + (n === 1 ? '' : 's');
                }
            } catch (_) {}
        }

        // ----- CONSTANTS & DEFAULTS -----
        const DEFAULTS = {
            // Quantity formulas only — no money rates (AI / market / user sets prices).
            // Cement density 1440 kg/m³ · Standard bag 50 kg = 0.035 m³
            // Default mix 1:2:4 — yields from Material List 05.A.04 (per Cube → per m³)
            concrete: { mix: '1:2:4', dryFactor: 1.54, bagSize: 0.035, waste: 0.05, cementDensity: 1440 },
            // Sri Lankan QS: 1 Cube = 100 ft³ = 2.83168 m³ (Sand & Aggregate only)
            cubeM3: 2.83168,
            // Brick work cement sand 1:5 — rates per m² wall face from SL Material List
            // 09.01 100mm: 550 Nr / 100ft² = 59.20 /m² · Cement 1.3 bag · Sand 0.1 Cube
            // 09.02 225mm: 1090 Nr / 100ft² = 117.33 /m² · Cement 3 bag · Sand 0.2 Cube
            brick: {
                waste: 0.05,
                // keyed by thickness mm (110mm wall type uses 100mm rates)
                rates: {
                    100: { bricksPerM2: 59.20, cementBagsPerM2: 0.14, sandCubesPerM2: 0.01 },
                    110: { bricksPerM2: 59.20, cementBagsPerM2: 0.14, sandCubesPerM2: 0.01 },
                    225: { bricksPerM2: 117.33, cementBagsPerM2: 0.32, sandCubesPerM2: 0.02 }
                },
                defaultThicknessMm: 225
            },
            // Block work (hollow) cement sand 1:5 cavities unfilled — SL Material List §08
            // 08.01 200mm: 112 Nr / 100ft² = 12.06 /m² · Cement 0.75 bag · Sand 0.06 Cube
            // 08.02 150mm: 112 Nr / 100ft² = 12.06 /m² · Cement 0.65 bag · Sand 0.07 Cube
            // 08.03 100mm: 112 Nr / 100ft² = 12.06 /m² · Cement 0.4 bag · Sand 0.03 Cube
            block: {
                rates: {
                    100: { blocksPerM2: 12.06, cementBagsPerM2: 0.04, sandCubesPerM2: 0.003 },
                    150: { blocksPerM2: 12.06, cementBagsPerM2: 0.07, sandCubesPerM2: 0.01 },
                    200: { blocksPerM2: 12.06, cementBagsPerM2: 0.08, sandCubesPerM2: 0.01 }
                },
                sandCubeM3: 2.83168,
                thicknesses: { '100': 0.100, '150': 0.150, '200': 0.200 }
            },
            // Plaster: 10 mm (0.010 m), mix 1:5, dry factor 1.33
            plaster: { mix: '1:5', dryFactor: 1.33, thickness: 0.010, waste: 0.05, cementDensity: 1440 },
            // Tile 600×600 mm, 5% wastage, skirting default 150 mm, adhesive ~0.25 bags/m² (25 kg)
            tiling: { size: [600, 600], wastage: 0.05, skirtingHeight: 0.150, adhesiveBagsPerM2: 0.25 },
            // Paint: 14 m²/L per coat, 2 coats, applied to both faces of wall
            painting: { coverage: 14, coats: 2, bothFaces: true, waste: 0.05 },
        };

        /**
         * Local Material List (QS) mix yields — analysis per 1 Cube = 100 cft = 2.83168 m³.
         * Sand & Aggregate quantities use Cube → m³ conversion (Sri Lankan standard).
         * Cement remains in 50 kg bags. Converted to per 1 m³ wet concrete.
         */
        const SL_CUBE_M3 = 2.83168; // 1 Cube = 100 ft³
        const CONCRETE_MIX_TABLE = {
            // 05.A.04 Mixing Concrete 1:2:4(3/4") — Cement 18 bag, Sand 0.5 Cube, Metal 0.88 Cube / Cube
            '1:2:4': { bagsPerM3: 18 / SL_CUBE_M3, sandM3PerM3: (0.50 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.88 * SL_CUBE_M3) / SL_CUBE_M3, metal: '3/4"', ref: '05.A.04' },
            // 05.A.01 Mixing Concrete 1:1-1/2:3(3/4")
            '1:1.5:3': { bagsPerM3: 23 / SL_CUBE_M3, sandM3PerM3: (0.42 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.82 * SL_CUBE_M3) / SL_CUBE_M3, metal: '3/4"', ref: '05.A.01' },
            '1:1½:3': { bagsPerM3: 23 / SL_CUBE_M3, sandM3PerM3: (0.42 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.82 * SL_CUBE_M3) / SL_CUBE_M3, metal: '3/4"', ref: '05.A.01' },
            // 05.A.02 Mixing Concrete 1:3:6(1 1/2") Gr 15
            '1:3:6': { bagsPerM3: 13 / SL_CUBE_M3, sandM3PerM3: (0.53 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.92 * SL_CUBE_M3) / SL_CUBE_M3, metal: '1½"', ref: '05.A.02' },
            // 05.A.03 Mixing Concrete 1:2 1/2 :5 (1")
            '1:2.5:5': { bagsPerM3: 14 / SL_CUBE_M3, sandM3PerM3: (0.60 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.90 * SL_CUBE_M3) / SL_CUBE_M3, metal: '1"', ref: '05.A.03' },
            // 05.A.05 Mixing Concrete 1:1:2(3/4")
            '1:1:2': { bagsPerM3: 31 / SL_CUBE_M3, sandM3PerM3: (0.44 * SL_CUBE_M3) / SL_CUBE_M3, metalM3PerM3: (0.96 * SL_CUBE_M3) / SL_CUBE_M3, metal: '3/4"', ref: '05.A.05' }
        };

        /** Concrete material breakdown — prefers Material List yields; falls back to dry-factor theory. */
        function concreteBreakdown(wetVol) {
            const c = projectOverrides.concrete || {};
            const vol = Math.max(0, Number(wetVol) || 0);
            const mixKey = String(c.mix || '1:2:4').replace(/\s+/g, '');
            const yieldRow = CONCRETE_MIX_TABLE[mixKey] || CONCRETE_MIX_TABLE[c.mix] || CONCRETE_MIX_TABLE['1:2:4'];
            if (yieldRow && vol > 0) {
                const bagsExact = vol * yieldRow.bagsPerM3;
                const sand = vol * yieldRow.sandM3PerM3;
                const agg = vol * yieldRow.metalM3PerM3;
                const cementKg = bagsExact * 50; // 50 kg bags
                return {
                    dryVol: vol * (c.dryFactor || 1.54),
                    bags: bagsExact,
                    bagsCeil: Math.ceil(bagsExact),
                    sand: sand,
                    agg: agg,
                    cementKg: cementKg,
                    mix: c.mix || '1:2:4',
                    source: yieldRow.ref,
                    note: 'Cement: ' + bagsExact.toFixed(2) + ' bags (' + cementKg.toFixed(1) +
                        ' kg), Sand: ' + sand.toFixed(3) + ' m³, Aggregate: ' + agg.toFixed(3) +
                        ' m³ · mix ' + (c.mix || '1:2:4') + ' (' + yieldRow.ref + ' Material List)'
                };
            }
            // Theoretical fallback 1:2:4 dry factor
            const dryVol = vol * (c.dryFactor || 1.54);
            const parts = 7;
            const cementVol = dryVol / parts;
            const bagsExact = cementVol / (c.bagSize || 0.035);
            const sand = (dryVol * 2) / parts;
            const agg = (dryVol * 4) / parts;
            const cementKg = cementVol * (c.cementDensity || 1440);
            return {
                dryVol: dryVol,
                bags: bagsExact,
                bagsCeil: Math.ceil(bagsExact),
                sand: sand,
                agg: agg,
                cementKg: cementKg,
                note: 'Cement: ' + bagsExact.toFixed(2) + ' bags (' + cementKg.toFixed(1) +
                    ' kg), Sand: ' + sand.toFixed(3) + ' m³, Aggregate: ' + agg.toFixed(3) +
                    ' m³ · dry ' + dryVol.toFixed(3) + ' m³'
            };
        }

        /** Plaster material breakdown (1:5 → 6 parts, thickness 10 mm)
         *  Per 1 m² single face: Cement 3.19 kg, Sand 0.011 m³
         */
        function plasterBreakdown(netArea) {
            const p = projectOverrides.plaster;
            const t = p.thickness != null ? p.thickness : 0.010;
            const dryVol = (netArea * t) * (p.dryFactor || 1.33);
            const parts = 6; // 1+5
            const cementVol = dryVol / parts;
            const bagsExact = cementVol / 0.035;
            const sand = (dryVol * 5) / parts;
            const cementKg = cementVol * (p.cementDensity || 1440);
            return {
                dryVol,
                bags: bagsExact,
                sand,
                cementKg,
                note: `Cement: ${cementKg.toFixed(2)} kg (${bagsExact.toFixed(2)} bags), Sand: ${sand.toFixed(3)} m³ · ${p.mix || '1:5'} · thk ${(t * 1000).toFixed(0)} mm`
            };
        }

        /** Tile count with wastage
         *  Per 1 m²: 2.92 tiles (600×600, 5% waste); adhesive avg 0.25 bags/m²
         */

        /**
         * Sri Lankan cube → m³ (Sand & Aggregate only). 1 Cube = 100 ft³ = 2.83168 m³.
         */
        function cubeToM3(cubes) {
            const cube = (projectOverrides && projectOverrides.cubeM3) != null
                ? Number(projectOverrides.cubeM3)
                : ((DEFAULTS.cubeM3 != null) ? DEFAULTS.cubeM3 : SL_CUBE_M3);
            return (Number(cubes) || 0) * cube;
        }

        /**
         * Brick work — Sri Lankan Material List §09 (cement sand 1:5).
         * Rates per m² wall face from Quantity1m2 column:
         *   100/110 mm: 59.20 bricks · 0.14 bag cement · 0.01 Cube sand
         *   225 mm:     117.33 bricks · 0.32 bag cement · 0.02 Cube sand
         */
        function brickWorkBreakdown(faceAreaM2, thicknessMm) {
            const br = (projectOverrides && projectOverrides.brick) || {};
            const ratesTable = br.rates || DEFAULTS.brick.rates;
            let thk = Math.round(Number(thicknessMm) || DEFAULTS.brick.defaultThicknessMm || 225);
            if (thk >= 90 && thk <= 120) thk = 100;
            else if (thk >= 200 && thk <= 240) thk = 225;
            const row = ratesTable[thk] || ratesTable[225] || ratesTable[100] ||
                { bricksPerM2: 117.33, cementBagsPerM2: 0.32, sandCubesPerM2: 0.02 };
            const area = Math.max(0, Number(faceAreaM2) || 0);
            const bricksPerM2 = row.bricksPerM2 != null ? row.bricksPerM2 : 117.33;
            const cementBagsPerM2 = row.cementBagsPerM2 != null ? row.cementBagsPerM2 : 0.32;
            const sandCubesPerM2 = row.sandCubesPerM2 != null ? row.sandCubesPerM2 : 0.02;
            const bricks = Math.ceil(area * bricksPerM2);
            const cementBags = area * cementBagsPerM2;
            const sandCubes = area * sandCubesPerM2;
            const sandM3 = cubeToM3(sandCubes);
            return {
                thicknessMm: thk,
                bricks: bricks,
                bricksPerM2: bricksPerM2,
                cementBags: cementBags,
                cementKg: cementBags * 50,
                sandCubes: sandCubes,
                sandM3: sandM3,
                note: 'Brick ' + thk + 'mm · ' + bricksPerM2 + '/m² · mortar 1:5 · face ' +
                    area.toFixed(2) + ' m² · cement ' + cementBags.toFixed(2) + ' bags · sand ' +
                    sandCubes.toFixed(3) + ' Cube (' + sandM3.toFixed(3) + ' m³)'
            };
        }

        /**
         * Block work — Sri Lankan Material List §08 hollow blocks, cement sand 1:5, cavities unfilled.
         * Rates per m² wall face:
         *   200 mm: 12.06 blocks · 0.08 bag · 0.01 Cube sand
         *   150 mm: 12.06 blocks · 0.07 bag · 0.01 Cube sand
         *   100 mm: 12.06 blocks · 0.04 bag · 0.003 Cube sand
         */
        function blockWorkBreakdown(faceAreaM2, thicknessMm) {
            const b = (projectOverrides && projectOverrides.block) || {};
            const ratesTable = b.rates || DEFAULTS.block.rates;
            let thk = Math.round(Number(thicknessMm) || 100);
            if (thk >= 90 && thk <= 120) thk = 100;
            else if (thk >= 140 && thk <= 160) thk = 150;
            else if (thk >= 190 && thk <= 210) thk = 200;
            const row = ratesTable[thk] || ratesTable[100] ||
                { blocksPerM2: 12.06, cementBagsPerM2: 0.04, sandCubesPerM2: 0.003 };
            const area = Math.max(0, Number(faceAreaM2) || 0);
            const blocksPerM2 = row.blocksPerM2 != null ? row.blocksPerM2 : 12.06;
            const cementBagsPerM2 = row.cementBagsPerM2 != null ? row.cementBagsPerM2 : 0.04;
            const sandCubesPerM2 = row.sandCubesPerM2 != null ? row.sandCubesPerM2 : 0.003;
            const blocks = Math.ceil(area * blocksPerM2);
            const cementBags = area * cementBagsPerM2;
            const sandCubes = area * sandCubesPerM2;
            const sandM3 = cubeToM3(sandCubes);
            return {
                thicknessMm: thk,
                blocks: blocks,
                blocksPerM2: blocksPerM2,
                cementBags: cementBags,
                cementKg: cementBags * 50,
                sandCubes: sandCubes,
                sandM3: sandM3,
                note: 'Block ' + thk + 'mm · ' + blocksPerM2 + '/m² · mortar 1:5 unfilled · face ' +
                    area.toFixed(2) + ' m² · cement ' + cementBags.toFixed(2) + ' bags · sand ' +
                    sandCubes.toFixed(3) + ' Cube (' + sandM3.toFixed(3) + ' m³)'
            };
        }

        /** Classify wall as brick or block 100/150/200 from material name or thickness (m). */
        function classifyWallMasonry(w) {
            // Explicit wallType takes priority (manual override or auto-detected)
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
            const thk = (typeof w.thickness === 'number' && w.thickness > 0) ? w.thickness : DEFAULT_WALL_THICKNESS_M;
            if (mat.indexOf('brick') >= 0 && mat.indexOf('block') < 0) return { kind: 'brick', thicknessMm: Math.round(thk * 1000) };
            if (mat.indexOf('200') >= 0) return { kind: 'block', thicknessMm: 200 };
            if (mat.indexOf('150') >= 0) return { kind: 'block', thicknessMm: 150 };
            if (mat.indexOf('100') >= 0) return { kind: 'block', thicknessMm: 100 };
            if (mat.indexOf('block') >= 0) {
                // nearest of 100/150/200
                const mm = thk * 1000;
                const nearest = [100, 150, 200].reduce(function (a, b) {
                    return Math.abs(b - mm) < Math.abs(a - mm) ? b : a;
                }, 100);
                return { kind: 'block', thicknessMm: nearest };
            }
            // Thickness heuristic when material not set
            if (thk >= 0.20 && thk <= 0.24) return { kind: 'brick', thicknessMm: 225 };
            if (thk >= 0.10 && thk <= 0.12) return { kind: 'brick', thicknessMm: 110 };
            if (thk >= 0.175) return { kind: 'block', thicknessMm: 200 };
            if (thk >= 0.125) return { kind: 'block', thicknessMm: 150 };
            if (thk >= 0.09 && thk <= 0.12) return { kind: 'block', thicknessMm: 100 };
            return { kind: 'brick', thicknessMm: Math.round(thk * 1000) };
        }

        /** Canonical wall type options for Properties / Quantities */
        const WALL_TYPE_OPTIONS = [
            { value: '110mm Brick', thicknessM: 0.110, kind: 'brick' },
            { value: '225mm Brick', thicknessM: 0.225, kind: 'brick' },
            { value: '100mm Block', thicknessM: 0.100, kind: 'block' },
            { value: '150mm Block', thicknessM: 0.150, kind: 'block' },
            { value: '200mm Block', thicknessM: 0.200, kind: 'block' }
        ];

        function resolveWallTypeLabel(w) {
            if (w && w.wallType) return w.wallType;
            const cls = classifyWallMasonry(w);
            if (cls.kind === 'brick') {
                if (cls.thicknessMm >= 200) return '225mm Brick';
                return '110mm Brick';
            }
            if (cls.thicknessMm === 200) return '200mm Block';
            if (cls.thicknessMm === 150) return '150mm Block';
            return '100mm Block';
        }

        /**
         * Snap a detected/edited wall thickness to the nearest standard construction
         * thickness. Uses wallType when present; otherwise classifies from measured mm
         * with a small tolerance so 149–161 → 150 mm block, 220–230 → 225 mm brick, etc.
         * Mutates el.thickness (metres), el.wallType, and refreshes thicknessDraw.
         * Does NOT blindly round every value — only maps onto known standards.
         */
        function standardizeWallThickness(el) {
            if (!el || el.type !== 'wall') return el;
            const cls = classifyWallMasonry(el);
            const standardMm = cls.thicknessMm;
            const standardM = standardMm / 1000;
            const label = resolveWallTypeLabel(Object.assign({}, el, { thickness: standardM, wallType: el.wallType || null }));
            // Prefer explicit option label that matches standardMm
            let wallTypeLabel = el.wallType;
            for (let i = 0; i < WALL_TYPE_OPTIONS.length; i++) {
                const opt = WALL_TYPE_OPTIONS[i];
                if (Math.round(opt.thicknessM * 1000) === standardMm) {
                    wallTypeLabel = opt.value;
                    break;
                }
            }
            if (!wallTypeLabel) wallTypeLabel = label;
            el.thickness = standardM;
            el.wallType = wallTypeLabel;
            if (typeof setLineThicknessMeters === 'function') {
                setLineThicknessMeters(el, standardM);
            } else {
                el.thicknessDraw = clampThicknessDraw(toDrawing(standardM));
            }
            // Keep attached deductions thickness in sync with parent standard
            syncAttachedDeductionThickness(el);
            return el;
        }

        /** Propagate parent wall thickness to all linked cutouts/deductions. */
        function syncAttachedDeductionThickness(parent) {
            if (!parent || parent.id == null) return;
            const thk = (typeof parent.thickness === 'number' && parent.thickness > 0)
                ? parent.thickness : DEFAULT_WALL_THICKNESS_M;
            getAttachedChildIds(parent.id).forEach(function (cid) {
                const child = findElementById(cid);
                if (!child) return;
                if (child.isDeduction || child.type === 'cutout' || child.type === 'opening' ||
                    child.type === 'door' || child.type === 'window') {
                    child.thickness = thk;
                    child.parentThickness = thk;
                }
            });
        }

        /**
         * Transform all attached children by the same dx/dy (and optional rotation)
         * so deductions stay glued to the wall when it moves or rotates.
         */
        function transformAttachedChildren(parent, dx, dy, degrees, pivot) {
            if (!parent || parent.id == null) return;
            const childIds = getAttachedChildIds(parent.id);
            if (!childIds.length && !(parent.cutouts && parent.cutouts.length)) return;
            const ids = childIds.length ? childIds : (parent.cutouts || []);
            ids.forEach(function (cid) {
                const child = findElementById(cid);
                if (!child || child.locked) return;
                if (dx || dy) {
                    moveElementBy(child, dx, dy);
                }
                if (degrees && Math.abs(degrees) > 1e-9) {
                    rotateElementBy(child, degrees, pivot || getElementCenter(parent));
                }
            });
        }

        /**
         * After a line wall's endpoints change, rebuild linked deduction polygons
         * so they stay aligned to the wall centerline and use current thickness.
         * Only adjusts cutouts that still lie on the wall (projection within segment).
         */
        function realignAttachedDeductionsToWall(wall) {
            if (!wall || !wall.isLine || !wall.p1 || !wall.p2) return;
            const thk = (typeof wall.thickness === 'number' && wall.thickness > 0)
                ? wall.thickness : DEFAULT_WALL_THICKNESS_M;
            let thkDraw = getLineThicknessDraw(wall);
            if (!(thkDraw > 0) || !isFinite(thkDraw)) thkDraw = Math.max(1.5, toDrawing(thk) || 1.5);
            const halfThk = Math.max(thkDraw / 2, 0.025);
            const ax = wall.p1.x, ay = wall.p1.y, bx = wall.p2.x, by = wall.p2.y;
            const abx = bx - ax, aby = by - ay;
            const len = Math.hypot(abx, aby) || 1;
            const ux = abx / len, uy = aby / len;
            const angle = Math.atan2(aby, abx);
            const cosA = Math.cos(angle), sinA = Math.sin(angle);

            getAttachedChildIds(wall.id).forEach(function (cid) {
                const o = findElementById(cid);
                if (!o || !(o.isDeduction || o.type === 'cutout')) return;
                // Project cutout center onto wall; keep length along wall
                const cx0 = (o.x || 0) + (o.w || 0) / 2;
                const cy0 = (o.y || 0) + (o.h || 0) / 2;
                let openWidthDraw = (typeof cutoutWidthAlongLine === 'function')
                    ? cutoutWidthAlongLine(wall, o) : Math.max(o.w || 0, o.h || 0);
                if (openWidthDraw < 1e-6) openWidthDraw = Math.max(o.w || 0, o.h || 0, 0.05);
                // Clamp opening to segment
                let tCenter = ((cx0 - ax) * ux + (cy0 - ay) * uy);
                tCenter = Math.max(openWidthDraw / 2, Math.min(len - openWidthDraw / 2, tCenter));
                const cx = ax + tCenter * ux;
                const cy = ay + tCenter * uy;
                const halfLen = Math.max(openWidthDraw / 2, 0.025);
                const localPts = [
                    { x: -halfLen, y: -halfThk },
                    { x: halfLen, y: -halfThk },
                    { x: halfLen, y: halfThk },
                    { x: -halfLen, y: halfThk }
                ];
                const worldPts = localPts.map(function (p) {
                    return {
                        x: cx + p.x * cosA - p.y * sinA,
                        y: cy + p.x * sinA + p.y * cosA
                    };
                });
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                worldPts.forEach(function (p) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                });
                o.x = minX;
                o.y = minY;
                o.w = Math.max(0.01, maxX - minX);
                o.h = Math.max(0.01, maxY - minY);
                o.vertices = worldPts.map(function (p) { return { x: p.x - o.x, y: p.y - o.y }; });
                o.thickness = thk;
                o.parentThickness = thk;
            });
        }

        function tileCount(areaM2) {
            const t = projectOverrides.tiling;
            const sz = t.size || [600, 600];
            const tileArea = (sz[0] / 1000) * (sz[1] / 1000);
            const waste = t.wastage != null ? t.wastage : 0.05;
            const countExact = (areaM2 / tileArea) * (1 + waste);
            const count = Math.ceil(countExact);
            const adhesiveBags = areaM2 * (t.adhesiveBagsPerM2 != null ? t.adhesiveBagsPerM2 : 0.25);
            return {
                count,
                countExact,
                adhesiveBags,
                sizeLabel: `${sz[0]}×${sz[1]}mm`,
                note: `Tiles: ${count} Nos (${sz[0]}×${sz[1]}mm, incl ${Math.round(waste * 100)}% waste) · Adhesive ≈ ${adhesiveBags.toFixed(2)} bags (25 kg)`
            };
        }

        /** Paint litres — 2 coats @ 14 m²/L; both faces by default (rate table: 0.286 L per m² face)
         *  litres = area × faces × coats / coverage
         */
        function paintLitres(netAreaOneFace) {
            const p = projectOverrides.painting;
            const coats = p.coats || 2;
            const coverage = p.coverage || 14;
            const faces = (p.bothFaces !== false) ? 2 : 1;
            const litresExact = (netAreaOneFace * faces * coats) / coverage;
            const litres = Math.ceil(litresExact * 10) / 10;
            return {
                litres,
                litresExact,
                note: `${coats} coats × ${faces} face(s) · ${litres} L (coverage ${coverage} m²/L · ${litresExact.toFixed(3)} L exact)`
            };
        }

        // Material catalogue — no default prices (AI / market rates / user fill costs).
        let materialLibrary = {
            'Cement': { cost: null, unit: 'bag (50kg)', color: '#94a3b8' },
            'Sand': { cost: null, unit: 'm³', color: '#eab308' },
            'Aggregate': { cost: null, unit: 'm³', color: '#78716c' },
            'Brick': { cost: null, unit: 'Nr', color: '#c8a070' },
            'Block 100mm': { cost: null, unit: 'Nr', color: '#a8a29e' },
            'Block 150mm': { cost: null, unit: 'Nr', color: '#78716c' },
            'Block 200mm': { cost: null, unit: 'Nr', color: '#57534e' },
            'Adhesive': { cost: null, unit: 'bag (25kg)', color: '#64748b' },
            'Tiles (600x600mm)': { cost: null, unit: 'Nr', color: '#b8c8d4' },
            'Paint': { cost: null, unit: 'L', color: '#e8e0d8' },
        };

        /**
         * Build Material Estimate + Element Quantities from drawn takeoff.
         * Cement/Sand/Agg from concrete + plaster; Bricks from walls; Tiles/Adhesive from slabs; Paint from wall faces.
         */
        function computeMaterialEstimate() {
            const cf = calibrationFactor || 1;
            const walls = elements.filter(e => e.type === 'wall' && !e.hidden);
            const slabs = elements.filter(e => e.type === 'slab' && !e.hidden);
            const columns = elements.filter(e => e.type === 'column' && !e.hidden);
            const beams = elements.filter(e => e.type === 'beam' && !e.hidden);
            const openingsAll = elements.filter(e =>
                !e.hidden && (e.type === 'door' || e.type === 'window' || e.type === 'opening' || e.isDeduction || e.type === 'cutout')
            );

            // ---- Element quantities ----
            let wallFaceM2 = 0, wallVolM3 = 0;
            // Keep Pro BOQ quantities numerically identical to Simple Mode.
            // Both modes use the same calibrated drawing-unit space, accepted
            // takeoff elements, line length/thickness rules, and rectangular
            // element bounds for material quantities. Polygon vertices remain
            // available for drawing/geometry, but are not substituted for the
            // Quantity contract: manual elements remain usable, but every AI-origin
            // element must be explicitly accepted or QS-reviewed before costing/export.
            const accepted = el => {
                if (!el || el.hidden) return false;
                const source = getElementSource(el);
                const aiOrigin = source === 'AI' || source === 'AI_EDITED' || el.ai === true;
                if (aiOrigin) {
                    return el.accepted === true || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL';
                }
                return el.accepted !== false;
            };
            const wallHeightDefault = 3.0;
            // Floor finish adjustment accumulators — see SKIRTING_HEIGHT_M above.
            let wallFootprintTotalM2 = 0;
            let wallLengthTotalM = 0;
            walls.forEach(w => {
                if (!accepted(w)) return;
                const isLine = !!(w.isLine && w.p1 && w.p2);
                const lenDraw = isLine
                    ? (Number(w.length) || Math.hypot(Number(w.p2.x) - Number(w.p1.x), Number(w.p2.y) - Number(w.p1.y)))
                    : Math.max(Number(w.w) || 0, Number(w.h) || 0);
                const lengthM = lenDraw * cf;
                const heightM = (w.zHeight != null && w.zHeight > 0) ? w.zHeight : wallHeightDefault;
                const gross = lengthM * heightM;
                {
                    // Wall plan footprint (length × thickness) — deducted from slab area
                    // to get the actual tileable floor area, and wall length is used
                    // for the skirting-area addition below.
                    const fpThkM = (typeof w.thickness === 'number' && isFinite(w.thickness) && w.thickness > 0)
                        ? w.thickness : DEFAULT_WALL_THICKNESS_M;
                    wallFootprintTotalM2 += lengthM * fpThkM;
                    wallLengthTotalM += lengthM;
                }
                // Deduct openings / cutouts / columns (same engine as Live Quantities)
                let deductionM2 = 0;
                try {
                    if (typeof collectWallDeductions === 'function') {
                        const hits = collectWallDeductions(w) || [];
                        hits.forEach(function (d) { deductionM2 += Number(d.deductM2) || 0; });
                    } else {
                        openingsAll.forEach(function (o) {
                            if (o.parentId != null && typeof sameElementId === 'function' && !sameElementId(o.parentId, w.id)) return;
                            if (o.parentId == null && typeof elementIntersectsWall === 'function' && !elementIntersectsWall(w, o)) return;
                            if (o.parentId == null && typeof elementIntersectsWall !== 'function') return;
                            let openWidthM;
                            if (isLine && typeof cutoutWidthAlongLine === 'function') {
                                const wd = cutoutWidthAlongLine(w, o);
                                openWidthM = (wd > 1e-6 ? wd : Math.max(o.w || 0, o.h || 0)) * cf;
                            } else {
                                openWidthM = Math.max(o.w || 0, o.h || 0) * cf;
                            }
                            const openHeightM = Math.min(heightM, Math.max(0.01, o.zHeight || 2.1));
                            deductionM2 += openWidthM * openHeightM;
                        });
                    }
                } catch (_) {}
                const netFace = Math.max(0, gross - deductionM2);
                wallFaceM2 += netFace;
                // Thickness is stored in metres — never derive from thicknessDraw/pixels.
                // Use current value whenever positive so Properties edits always reflow totals.
                let thkM = (typeof w.thickness === 'number' && isFinite(w.thickness) && w.thickness > 0)
                    ? w.thickness : DEFAULT_WALL_THICKNESS_M;
                wallVolM3 += netFace * thkM;
            });

            function planAreaM2(el) {
                // BOQ contract: always use axis-aligned bounds (w×h), same as Simple Mode.
                // Polygon vertices stay for drawing / live reshape, but must not change
                // material quantities between modes (irregular slabs used to drift).
                return (Number(el.w) || 0) * (Number(el.h) || 0) * cf * cf;
            }
            // BOQ / material estimate: always use current element dimensions.
            // Opening / cutout deductions are applied here so Export matches Live Quantities.
            // User edits to Thickness / Height / Depth must flow into totals immediately.
            // (AI import may still write bad heights; QS can correct them in Properties.)
            function slabThicknessM(el, defaultH) {
                if (el && typeof el.zHeight === 'number' && isFinite(el.zHeight) && el.zHeight > 0) {
                    return el.zHeight;
                }
                return defaultH;
            }
            function columnHeightM(el, defaultH) {
                if (el && typeof el.zHeight === 'number' && isFinite(el.zHeight) && el.zHeight > 0) {
                    return el.zHeight;
                }
                return defaultH;
            }
            function slabColVol(el, defaultH, kind) {
                const area = planAreaM2(el);
                const h = (kind === 'slab')
                    ? slabThicknessM(el, defaultH)
                    : columnHeightM(el, defaultH);
                return { area: area, vol: area * h };
            }

            let slabVol = 0, slabArea = 0;
            // Slab–slab and slab–structural overlaps (drawing units) — same as Live Quantities
            let slabSlabOl = {};
            let slabStructuralOl = {};
            try {
                if (typeof computeSlabSlabOverlapDeductions === 'function') {
                    slabSlabOl = computeSlabSlabOverlapDeductions(slabs) || {};
                }
                if (typeof computeSlabStructuralOverlapDeductions === 'function') {
                    slabStructuralOl = computeSlabStructuralOverlapDeductions(slabs, walls, columns) || {};
                }
            } catch (_) {}
            slabs.forEach(s => {
                if (!accepted(s)) return;
                const r = slabColVol(s, DEFAULT_SLAB_THICKNESS_M, 'slab');
                let cutAreaM2 = 0;
                // Explicit cutouts / openings parented to or overlapping this slab
                try {
                    if (typeof getDeductionsOverlapping === 'function') {
                        const hits = getDeductionsOverlapping(s, openingsAll) || [];
                        hits.forEach(function (hit) {
                            const o = hit.opening;
                            let aM2 = 0;
                            if (o && o.vertices && o.vertices.length >= 3 && typeof polygonArea === 'function') {
                                const abs = o.vertices.map(function (v) {
                                    return { x: (o.x || 0) + (v.x || 0), y: (o.y || 0) + (v.y || 0) };
                                });
                                aM2 = polygonArea(abs) * cf * cf;
                            } else if (o && (o.w || o.h)) {
                                aM2 = (Number(o.w) || 0) * (Number(o.h) || 0) * cf * cf;
                            } else if (hit.areaDraw) {
                                aM2 = hit.areaDraw * cf * cf;
                            }
                            cutAreaM2 += aM2;
                        });
                    }
                } catch (_) {}
                // Slab∩slab and slab∩wall/column overlaps (drawing-unit areas → m²)
                const ssOl = slabSlabOl[s.id] || 0;
                if (ssOl > 0) cutAreaM2 += ssOl * cf * cf;
                const hostOl = slabStructuralOl[s.id] || 0;
                if (hostOl > 0) cutAreaM2 += hostOl * cf * cf;

                const netArea = Math.max(0, r.area - cutAreaM2);
                const thk = (r.vol > 0 && r.area > 0) ? (r.vol / r.area) : slabThicknessM(s, DEFAULT_SLAB_THICKNESS_M);
                slabVol += netArea * thk;
                slabArea += netArea;
            });
            let colVol = 0;
            columns.forEach(c => { if (accepted(c)) colVol += slabColVol(c, 3.0, 'column').vol; });
            let beamVol = 0;
            beams.forEach(b => {
                if (!accepted(b)) return;
                const isLine = !!(b.isLine && b.p1 && b.p2);
                const lenDraw = isLine
                    ? (Number(b.length) || Math.hypot(Number(b.p2.x) - Number(b.p1.x), Number(b.p2.y) - Number(b.p1.y)))
                    : Math.max(Number(b.w) || 0, Number(b.h) || 0);
                // Live dimensions: width = thickness (m), depth = zHeight (m).
                // Any edit to length / thickness / depth must flow into totals.
                const widthM = (typeof b.thickness === 'number' && b.thickness > 0)
                    ? b.thickness
                    : DEFAULT_BEAM_THICKNESS_M;
                const depthM = (typeof b.zHeight === 'number' && b.zHeight > 0)
                    ? b.zHeight
                    : 0.45;
                const gross = (lenDraw * cf) * widthM * depthM;
                beamVol += Math.max(0, gross);
            });

            const concreteVol = slabVol + colVol + beamVol;
            const conc = concreteBreakdown(concreteVol);
            const plas = plasterBreakdown(wallFaceM2);
            // Floor finish (tile) area ≠ slab area:
            //   slab area includes the footprint of walls sitting on it, so that
            //   footprint must be deducted to get the exposed floor to be tiled;
            //   then a skirting strip (wall length × SKIRTING_HEIGHT_M) is added
            //   back, since skirting is also tiled material.
            const skirtingAreaM2 = wallLengthTotalM * SKIRTING_HEIGHT_M;
            const floorFinishAreaM2 = Math.max(0, slabArea - wallFootprintTotalM2) + skirtingAreaM2;
            const tiles = tileCount(floorFinishAreaM2);
            const paint = paintLitres(wallFaceM2);
            // Split wall faces: brick 100/225 vs block 100/150/200 (Sri Lankan Material List §08/§09)
            const brickFace = { 100: 0, 225: 0 };
            const blockFace = { 100: 0, 150: 0, 200: 0 };
            walls.forEach(function (w) {
                if (!accepted(w)) return;
                const isLine = !!(w.isLine && w.p1 && w.p2);
                const lenDraw = isLine
                    ? (Number(w.length) || Math.hypot(Number(w.p2.x) - Number(w.p1.x), Number(w.p2.y) - Number(w.p1.y)))
                    : Math.max(Number(w.w) || 0, Number(w.h) || 0);
                const lengthM = lenDraw * cf;
                const heightM = (w.zHeight != null && w.zHeight > 0) ? w.zHeight : 3.0;
                const grossFace = lengthM * heightM;
                let deductionM2 = 0;
                try {
                    if (typeof collectWallDeductions === 'function') {
                        (collectWallDeductions(w) || []).forEach(function (d) {
                            deductionM2 += Number(d.deductM2) || 0;
                        });
                    }
                } catch (_) {}
                const face = Math.max(0, grossFace - deductionM2);
                const cls = classifyWallMasonry(w);
                if (cls.kind === 'block' && blockFace[cls.thicknessMm] != null) {
                    blockFace[cls.thicknessMm] += face;
                } else {
                    const bt = (cls.thicknessMm >= 90 && cls.thicknessMm <= 120) ? 100 : 225;
                    brickFace[bt] += face;
                }
            });
            const brk100 = brickWorkBreakdown(brickFace[100], 100);
            const brk225 = brickWorkBreakdown(brickFace[225], 225);
            const brickNos = (brk100.bricks || 0) + (brk225.bricks || 0);
            const brickFaceM2 = brickFace[100] + brickFace[225];
            const blk100 = blockWorkBreakdown(blockFace[100], 100);
            const blk150 = blockWorkBreakdown(blockFace[150], 150);
            const blk200 = blockWorkBreakdown(blockFace[200], 200);
            const masonryCementBags = (brk100.cementBags || 0) + (brk225.cementBags || 0) +
                (blk100.cementBags || 0) + (blk150.cementBags || 0) + (blk200.cementBags || 0);
            const masonrySandM3 = (brk100.sandM3 || 0) + (brk225.sandM3 || 0) +
                (blk100.sandM3 || 0) + (blk150.sandM3 || 0) + (blk200.sandM3 || 0);
            const masonrySandCubes = (brk100.sandCubes || 0) + (brk225.sandCubes || 0) +
                (blk100.sandCubes || 0) + (blk150.sandCubes || 0) + (blk200.sandCubes || 0);

            // Cement bags = concrete + plaster + brick/block mortar 1:5
            const cementBags = (conc.bags || 0) + (plas.bags || 0) + masonryCementBags;
            const sandM3 = (conc.sand || 0) + (plas.sand || 0) + masonrySandM3;
            const aggM3 = conc.agg || 0;

            // Prices empty until online price DB / AI is connected (or user sets them in Material Library)
            function rate(name) {
                const lib = materialLibrary[name];
                if (lib && lib.cost != null && lib.cost !== '' && !isNaN(Number(lib.cost))) {
                    return Number(lib.cost);
                }
                return null; // leave Price / Total blank
            }

            const materials = [
                {
                    material: 'Cement',
                    qty: Math.ceil(cementBags * 10) / 10,
                    unit: 'bag (50kg)',
                    price: rate('Cement'),
                    source: 'Concrete ' + concreteVol.toFixed(3) + ' m³ + Plaster + Brick/Block mortar 1:5 (SL QS)',
                    color: '#94a3b8'
                },
                {
                    material: 'Sand',
                    qty: Math.round(sandM3 * 1000) / 1000,
                    unit: 'm³',
                    price: rate('Sand'),
                    source: 'Concrete + Plaster + Masonry · 1 Cube = 100 ft³ = 2.83168 m³ (SL) · masonry ' +
                        masonrySandCubes.toFixed(3) + ' Cube',
                    color: '#eab308'
                },
                {
                    material: 'Aggregate',
                    qty: Math.round(aggM3 * 1000) / 1000,
                    unit: 'm³',
                    price: rate('Aggregate'),
                    source: 'Concrete mix · 1 Cube = 100 ft³ = 2.83168 m³ (SL standard, Sand & Aggregate only)',
                    color: '#78716c'
                },
                {
                    material: 'Brick',
                    qty: brickNos,
                    unit: 'Nr',
                    price: rate('Brick'),
                    source: brickFaceM2 > 0
                        ? ('Brick face ' + brickFaceM2.toFixed(2) + ' m² · 100mm: ' + (brk100.bricks || 0) +
                            ' · 225mm: ' + (brk225.bricks || 0) + ' (SL §09 1:5)')
                        : 'No brick walls — set Wall Type 110mm/225mm Brick',
                    color: '#c8a070'
                },
                {
                    material: 'Block 100mm',
                    qty: blk100.blocks || 0,
                    unit: 'Nr',
                    price: rate('Block 100mm'),
                    source: blockFace[100] > 0 ? blk100.note : 'No 100mm block walls — set Wall Type 100mm Block',
                    color: '#a8a29e'
                },
                {
                    material: 'Block 150mm',
                    qty: blk150.blocks || 0,
                    unit: 'Nr',
                    price: rate('Block 150mm'),
                    source: blockFace[150] > 0 ? blk150.note : 'No 150mm block walls — set Wall Type 150mm Block',
                    color: '#78716c'
                },
                {
                    material: 'Block 200mm',
                    qty: blk200.blocks || 0,
                    unit: 'Nr',
                    price: rate('Block 200mm'),
                    source: blockFace[200] > 0 ? blk200.note : 'No 200mm block walls — set Wall Type 200mm Block',
                    color: '#57534e'
                },
                {
                    material: 'Adhesive',
                    qty: Math.round((tiles.adhesiveBags || 0) * 100) / 100,
                    unit: 'bag (25kg)',
                    price: rate('Adhesive'),
                    source: 'Floor finish area ' + floorFinishAreaM2.toFixed(2) + ' m² × rate',
                    color: '#64748b'
                },
                {
                    material: 'Tiles (600x600mm)',
                    qty: tiles.count || 0,
                    unit: 'Nr',
                    price: rate('Tiles (600x600mm)'),
                    source: 'Floor finish ' + floorFinishAreaM2.toFixed(2) + ' m² (Slab ' + slabArea.toFixed(2)
                        + ' − Wall footprint ' + wallFootprintTotalM2.toFixed(2)
                        + ' + Skirting ' + skirtingAreaM2.toFixed(2) + ') + 5% waste',
                    color: '#b8c8d4'
                },
                {
                    material: 'Paint',
                    qty: paint.litres || 0,
                    unit: 'L',
                    price: rate('Paint'),
                    source: paint.note || ('Wall face ' + wallFaceM2.toFixed(2) + ' m²'),
                    color: '#e8e0d8'
                },
            ];

            materials.forEach(m => {
                m.total = (m.qty > 0 && m.price != null) ? m.qty * m.price : null;
            });

            // Match Simple Mode element quantity rows (doors/windows included).
            // Also count Wall-Deduction openings (type 'cutout'/isDeduction) by the
            // Opening Type the user picked in Properties (door/window/opening).
            let doorCount = 0, windowCount = 0, openingCount = 0;
            elements.forEach(e => {
                if (!accepted(e)) return;
                if (e.type === 'door') { doorCount += 1; return; }
                if (e.type === 'window') { windowCount += 1; return; }
                if (e.type === 'opening') { openingCount += 1; return; }
                if (e.isDeduction || e.type === 'cutout') {
                    const ot = e.openingType || 'opening';
                    if (ot === 'door') doorCount += 1;
                    else if (ot === 'window') windowCount += 1;
                    else openingCount += 1;
                }
            });
            const elementQty = [
                { element: 'Column', qty: Math.round(colVol * 1000) / 1000, unit: 'm³' },
                { element: 'Beam', qty: Math.round(beamVol * 1000) / 1000, unit: 'm³' },
                { element: 'Slab', qty: Math.round(slabVol * 1000) / 1000, unit: 'm³' },
                { element: 'Wall', qty: Math.round(wallFaceM2 * 100) / 100, unit: 'm²' },
                { element: 'Wall (volume)', qty: Math.round(wallVolM3 * 1000) / 1000, unit: 'm³' },
                { element: 'Floor / tiling area', qty: Math.round(floorFinishAreaM2 * 100) / 100, unit: 'm²' },
                { element: 'Skirting area', qty: Math.round(skirtingAreaM2 * 100) / 100, unit: 'm²' },
                { element: 'Doors', qty: doorCount, unit: 'Nr' },
                { element: 'Windows', qty: windowCount, unit: 'Nr' },
                { element: 'Openings (other)', qty: openingCount, unit: 'Nr' },
            ];

            const materialsTotal = materials.reduce((s, m) => s + (m.total || 0), 0);
            const contingencyPct = 0.15;
            const contingency = materialsTotal * contingencyPct;
            const grandTotal = materialsTotal + contingency;

            return {
                materials,
                elementQty,
                materialsTotal,
                contingencyPct,
                contingency,
                grandTotal,
                meta: {
                    concreteVol, wallFaceM2, slabArea, colVol, beamVol, slabVol, brickNos,
                    cementBags, sandM3, aggM3,
                    wallFootprintTotalM2, wallLengthTotalM, skirtingAreaM2, floorFinishAreaM2
                }
            };
        }


        let projectOverrides = JSON.parse(JSON.stringify(DEFAULTS));

        let projectInfo = {
            name: 'Untitled Project', client: '', location: '', ref: '', qs: '', notes: '',
            status: 'Draft', buildingType: '', floors: '', currency: 'LKR', units: 'metric'
        };
        (function setupProjectHeader() {
            const nameInput = document.getElementById('projectNameInput');
            const dateChip = document.getElementById('dateChip');
            if (dateChip) dateChip.textContent = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            if (nameInput) nameInput.addEventListener('change', function () { projectInfo.name = this.value || 'Untitled Project'; });
            function openProj() {
                const m = document.getElementById('projectModal'); if (!m) return;
                document.getElementById('infoProjectName').value = projectInfo.name || '';
                document.getElementById('infoClient').value = projectInfo.client || '';
                document.getElementById('infoLocation').value = projectInfo.location || '';
                document.getElementById('infoRef').value = projectInfo.ref || '';
                document.getElementById('infoQS').value = projectInfo.qs || '';
                document.getElementById('infoNotes').value = projectInfo.notes || '';
                const st = document.getElementById('infoStatus'); if (st) st.value = projectInfo.status || 'Draft';
                const bt = document.getElementById('infoBuildingType'); if (bt) bt.value = projectInfo.buildingType || '';
                const fl = document.getElementById('infoFloors'); if (fl) fl.value = projectInfo.floors || '';
                const cur = document.getElementById('infoCurrency'); if (cur) cur.value = projectInfo.currency || 'LKR';
                const un = document.getElementById('infoUnits'); if (un) un.value = projectInfo.units || 'metric';
                m.classList.add('open');
            }
            function closeProj() { const m = document.getElementById('projectModal'); if (m) m.classList.remove('open'); }
            function saveProj() {
                projectInfo = {
                    name: document.getElementById('infoProjectName').value || 'Untitled Project',
                    client: document.getElementById('infoClient').value,
                    location: document.getElementById('infoLocation').value,
                    ref: document.getElementById('infoRef').value,
                    qs: document.getElementById('infoQS').value,
                    notes: document.getElementById('infoNotes').value,
                    status: (document.getElementById('infoStatus') || {}).value || 'Draft',
                    buildingType: (document.getElementById('infoBuildingType') || {}).value || '',
                    floors: (document.getElementById('infoFloors') || {}).value || '',
                    currency: (document.getElementById('infoCurrency') || {}).value || 'LKR',
                    units: (document.getElementById('infoUnits') || {}).value || 'metric'
                };
                if (nameInput) nameInput.value = projectInfo.name;
                const chip = document.getElementById('clientChip');
                if (chip) chip.textContent = 'Client: ' + (projectInfo.client || '—');
                const statusEl = document.getElementById('statusEdit');
                if (statusEl) statusEl.textContent = projectInfo.status || 'Draft';
                closeProj();
            }
            const bp = document.getElementById('btnProjectInfo'); if (bp) bp.addEventListener('click', openProj);
            const bos = document.getElementById('btnOpenSimple');
            if (bos) bos.addEventListener('click', function () {
                if (typeof goToSimpleMode === 'function') goToSimpleMode();
                else window.location.href = 'measurecraft_quantity_only.html';
            });
            const pc = document.getElementById('projModalClose'); if (pc) pc.addEventListener('click', closeProj);
            const pca = document.getElementById('projModalCancel'); if (pca) pca.addEventListener('click', closeProj);
            const ps = document.getElementById('projModalSave'); if (ps) ps.addEventListener('click', saveProj);
            const bh = document.getElementById('btnHelpShortcuts');
            const hm = document.getElementById('helpModal');
            if (bh && hm) bh.addEventListener('click', function(){ hm.classList.add('open'); });
            const hc = document.getElementById('helpModalClose'); if (hc && hm) hc.addEventListener('click', function(){ hm.classList.remove('open'); });
            const ho = document.getElementById('helpModalOk'); if (ho && hm) ho.addEventListener('click', function(){ hm.classList.remove('open'); });
        })();


        // ----- STATE -----
        // Standard construction defaults (metres). Do NOT derive wall thickness from
        // pixel short-side / calibration — that produces values like 0.2378 m.
        const DEFAULT_WALL_THICKNESS_M = 0.225;
        const DEFAULT_BEAM_THICKNESS_M = 0.20;
        const DEFAULT_SLAB_THICKNESS_M = 0.15;
        // Floor finish (tile) adjustment: slab plan area includes the footprint of
        // walls sitting on it, but tiling only covers the exposed floor between
        // walls, plus a skirting strip run along the base of every wall.
        // Skirting height assumption — adjust here if the QS spec differs.
        const SKIRTING_HEIGHT_M = 0.10; // 100 mm skirting
        let elements = [];
        let selectedIds = [];
        let elementSearchQuery = '';
        let nextId = 1;
        let undoStack = [];
        let redoStack = [];
        const MAX_UNDO = 30;
        let currentTool = 'select';
        let cutoutParentId = null;
        let snapGrid = false; // exact clicks by default — turn magnet on for grid snap
        let snapWall = false;
        let showLabels = true;
        let showDimensions = true;
        let isDragging = false;
        let dragStartX, dragStartY;
        let dragElementStart = {};
        let resizeHandle = null;
        let contextTargetId = null;
        let mouseDown = false;
        let isConfirmed = false;
        let currentView = '2d';
        let currentLayer = 'All';
        let layers = ['All', 'Structural', 'Architectural', 'MEP', 'Furniture'];

        // Element identity is deliberately independent of array order or display labels.
        // IDs in older project files may be numeric strings, missing, or duplicated after
        // a partial transfer. Normalize them once at every persistence boundary and keep
        // all parent/cutout references pointing at the normalized IDs.
        function canonicalElementId(value) {
            if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
            if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
                const n = Number(value.trim());
                if (Number.isSafeInteger(n) && n > 0) return n;
            }
            return null;
        }
        function sameElementId(a, b) {
            return a != null && b != null && String(a) === String(b);
        }
        function findElementById(id, list) {
            const source = Array.isArray(list) ? list : elements;
            return source.find(function (el) { return el && sameElementId(el.id, id); }) || null;
        }
        function normalizeElementIdentity(rawElements, nextIdHint) {
            const source = Array.isArray(rawElements) ? rawElements : [];
            const used = new Set();
            const sourceToCanonical = new Map();
            let maxId = 0;
            source.forEach(function (el) {
                const n = canonicalElementId(el && el.id);
                if (n != null && !used.has(n)) {
                    used.add(n);
                    maxId = Math.max(maxId, n);
                    sourceToCanonical.set(String(el.id), n);
                }
            });
            maxId = Math.max(maxId, canonicalElementId(nextIdHint) || 0);
            const out = source.map(function (raw) {
                const el = (raw && typeof raw === 'object') ? raw : {};
                const oldId = el.id;
                let id = canonicalElementId(oldId);
                if (id == null || !used.has(id) || sourceToCanonical.get(String(oldId)) !== id) {
                    id = ++maxId;
                    while (used.has(id)) id++;
                    used.add(id);
                }
                // Preserve the first occurrence of a valid source ID; duplicate IDs get
                // fresh IDs and never steal another wall's identity.
                sourceToCanonical.set(String(oldId), sourceToCanonical.get(String(oldId)) || id);
                el.id = id;
                return el;
            });
            const remap = function (value) {
                if (value == null) return value;
                const mapped = sourceToCanonical.get(String(value));
                return mapped != null ? mapped : canonicalElementId(value) || value;
            };
            out.forEach(function (el) {
                if (el.parentId != null) el.parentId = remap(el.parentId);
                if (Array.isArray(el.cutouts)) el.cutouts = el.cutouts.map(remap).filter(function (id) { return findElementById(id, out) != null; });
            });
            return { elements: out, nextId: Math.max(maxId + 1, canonicalElementId(nextIdHint) || 1) };
        }

        // Drawing state (rectangle)
        let drawStartWorld = null;
        let drawCurrentWorld = null;
        let drawPreview = null;
        let dragMode = null;

        // Polygon state (for cutout & floor/slab)
        let polygonPoints = [];
        let polygonTempLine = null;
        let isPolygonClosed = false;
        let polygonElementType = null;

        // Continuous polyline drawing for wall / beam / deduction_wall
        let deductionLinePoints = [];
        let deductionParentId = null; // store the parent element id when first click snaps
        let hoveredParentId = null; // for highlighting
        let continuousDrawPoints = []; // shared continuous polyline points for wall/beam
        let continuousTempPreview = null; // {x1,y1,x2,y2} live preview
        let editingVertex = null; // { elId, vertexIndex, isEndpoint: 'p1'|'p2'|null } for reshape

        // Overlapping-element selection stack (Ctrl/Cmd+click cycles)
        let overlapHitIds = [];       // ordered list of element ids under cursor
        let overlapCycleIndex = 0;
        let lastOverlapKey = '';
        let hoverLabelWorld = null;   // { x, y } for on-canvas hover name/type label

        // Measurement state
        let measurePoints = [];
        let measureMode = false;
        let measurePreview = null; // live cursor point while measuring (Bluebeam-style)

        // Warn on refresh/close if a drawing is loaded or takeoff elements exist.
        // Skip the warning when we intentionally navigate (Open Simple / Modes after save).
        let workSessionActive = false;
        let leavingIntentionally = false;
        function markWorkSession() { workSessionActive = true; }
        function hasUnsavedWork() {
            return workSessionActive || !!backgroundImage || (Array.isArray(elements) && elements.length > 0);
        }
        window.addEventListener('beforeunload', (e) => {
            if (leavingIntentionally) return;
            if (!hasUnsavedWork()) return;
            e.preventDefault();
            e.returnValue = 'You have an uploaded drawing and/or measurements. Leaving or refreshing this page will lose your work.';
            return e.returnValue;
        });

        // Calibration
        let calibrationFactor = 1.0;

        function toast(msg, type) {
            try {
                let el = document.getElementById('mc-pro-toast');
                if (!el) {
                    el = document.createElement('div');
                    el.id = 'mc-pro-toast';
                    el.style.cssText = 'position:fixed;bottom:72px;left:50%;transform:translateX(-50%);z-index:99999;max-width:min(480px,92vw);padding:10px 16px;border-radius:8px;font-size:13px;line-height:1.35;box-shadow:0 8px 24px rgba(0,0,0,.25);opacity:0;transition:opacity .2s;pointer-events:none;';
                    document.body.appendChild(el);
                }
                const bg = type === 'error' ? '#b91c1c' : (type === 'success' ? '#15803d' : '#1e3a5f');
                el.style.background = bg;
                el.style.color = '#fff';
                el.textContent = msg;
                el.style.opacity = '1';
                clearTimeout(el._t);
                el._t = setTimeout(function () { el.style.opacity = '0'; }, 4200);
            } catch (_) {
                try { console.info(msg); } catch (__) {}
            }
        }
        let calibratePoints = [];
        let calibrateMode = false;
        let calibratePreview = null;

        // 3D state
        let scene, camera, renderer, controls;
        let threeInitialized = false;
        let threeObjects = [];

        // Theme
        let currentTheme = 'light';

        // ----- VIEWPORT -----
        let viewport = {
            offsetX: 0,
            offsetY: 0,
            scale: 1.0,
        };
        let zoomLocked = false; // when true, trackpad/scroll wheel zoom is disabled (buttons still work)

        // ----- BACKGROUND DRAWING UNDERLAY -----
        let backgroundImage = null;
        let bgLoading = false;
        /** When false, measured elements (walls, slabs, etc.) are hidden on the drawing view; quantities/tree unchanged. */
        let elementsOnDrawingVisible = true;

        // ----- COORDINATE HELPERS -----
        function screenToWorld(sx, sy) {
            return {
                x: (sx - viewport.offsetX) / viewport.scale,
                y: (sy - viewport.offsetY) / viewport.scale,
            };
        }

        function worldToScreen(wx, wy) {
            return {
                x: wx * viewport.scale + viewport.offsetX,
                y: wy * viewport.scale + viewport.offsetY,
            };
        }

        /**
         * Convert a desired on-screen pixel width to canvas (world) lineWidth.
         * Context is scaled by viewport.scale, so dividing keeps thickness stable on screen.
         * At high zoom we gently reduce thickness further so boundaries do not obscure PDF detail.
         */
        function screenLineWidth(basePx) {
            const s = Math.max(viewport.scale || 1, 0.001);
            let px = basePx;
            if (s > 2) {
                // At s=2 ≈ same; at s=8 ≈ 0.6×; floor at 0.45× base
                const factor = Math.max(0.45, Math.pow(2 / s, 0.35));
                px = basePx * factor;
            }
            return Math.max(0.4 / s, px / s);
        }

        /** World-space padding equal to ~N screen pixels (selection boxes, etc.). */
        function screenPad(px) {
            return (px || 2) / Math.max(viewport.scale || 1, 0.001);
        }

        // ---- CAD-style object snap (to existing takeoff element geometry) ----
        let hoveredSnapId = null;
        let snapCursorPoint = null;
        let snapKind = null; // 'center' | 'edge' | 'endpoint' | 'corner'
        const SNAP_TOLERANCE_PX = 14;

        // ---- Auto-Glue / Keep Separate (user-controlled) ----
        let autoGlueEnabled = true;
        let glueToleranceMm = 10; // connection tolerance in millimetres

        function getGlueToleranceDraw() {
            // mm → metres → drawing units
            const m = Math.max(0, Number(glueToleranceMm) || 0) / 1000;
            const cf = (typeof calibrationFactor === 'number' && calibrationFactor > 0) ? calibrationFactor : 1;
            return m / cf;
        }

        /**
         * Snap a world point to the nearest wall/beam endpoint or column corner
         * within glue tolerance. Returns {x,y} (possibly unchanged).
         */
        function applyAutoGluePoint(pt, options) {
            options = options || {};
            if (!autoGlueEnabled) return { x: pt.x, y: pt.y };
            const tol = getGlueToleranceDraw();
            if (!(tol > 0)) return { x: pt.x, y: pt.y };
            const skipId = options.skipId;
            let best = null;
            let bestD = tol;
            elements.forEach(function (el) {
                if (!el || el.hidden || el.id === skipId) return;
                const candidates = [];
                if (el.isLine && el.p1 && el.p2) {
                    candidates.push(el.p1, el.p2);
                } else if (el.type === 'column' || el.type === 'slab') {
                    if (el.vertices && el.vertices.length >= 2) {
                        el.vertices.forEach(function (v) {
                            candidates.push({ x: el.x + v.x, y: el.y + v.y });
                        });
                    } else if (el.w != null && el.h != null) {
                        candidates.push(
                            { x: el.x, y: el.y },
                            { x: el.x + el.w, y: el.y },
                            { x: el.x + el.w, y: el.y + el.h },
                            { x: el.x, y: el.y + el.h }
                        );
                    }
                }
                candidates.forEach(function (c) {
                    const d = Math.hypot(pt.x - c.x, pt.y - c.y);
                    if (d <= bestD) {
                        bestD = d;
                        best = c;
                    }
                });
            });
            return best ? { x: best.x, y: best.y } : { x: pt.x, y: pt.y };
        }

        function applyAutoGluePolyline(pts) {
            if (!autoGlueEnabled || !pts || !pts.length) return pts;
            return pts.map(function (p) { return applyAutoGluePoint(p); });
        }



        /** Screen-stable rotate handle above element center (single selection). */
        function getRotateHandleWorld(el) {
            const c = getElementCenter(el);
            const lift = 22 / Math.max(viewport.scale || 1, 0.001);
            return { x: c.x, y: c.y - lift, cx: c.x, cy: c.y };
        }

        function drawRotateHandle(ctx, el) {
            if (!el || el.locked) return;
            const h = getRotateHandleWorld(el);
            const r = 7 / Math.max(viewport.scale || 1, 0.001);
            // stem
            ctx.save();
            ctx.strokeStyle = '#6366f1';
            ctx.fillStyle = '#6366f1';
            ctx.lineWidth = 1.5 / Math.max(viewport.scale || 1, 0.001);
            ctx.beginPath();
            ctx.moveTo(h.cx, h.cy);
            ctx.lineTo(h.x, h.y);
            ctx.stroke();
            // knob
            ctx.beginPath();
            ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.2 / Math.max(viewport.scale || 1, 0.001);
            ctx.stroke();
            // small arc icon
            ctx.beginPath();
            ctx.arc(h.x, h.y, r * 0.55, -0.8, Math.PI * 0.9);
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            ctx.restore();
        }

        function formatSnapLabel(kind, el) {
            if (!kind || !el) return '';
            const type = (el.type || 'element');
            const name = type.charAt(0).toUpperCase() + type.slice(1);
            if (kind === 'center') return 'Snap: ' + name + ' Center';
            if (kind === 'edge') return 'Snap: ' + name + ' Edge';
            if (kind === 'endpoint') return 'Snap: ' + name + ' Endpoint';
            if (kind === 'corner') return 'Snap: ' + name + ' Corner';
            return 'Snap: ' + name;
        }

        /**
         * Nearest element geometry to a world point within screen-pixel tolerance.
         * Returns { el, point: {x,y}, dist } or null.
         * Uses actual geometry (segments, polygon edges, rect edges), not mouse-only bbox.
         */
        function findNearestElementSnap(world, options) {
            options = options || {};
            const tolWorld = (options.tolerancePx != null ? options.tolerancePx : SNAP_TOLERANCE_PX)
                / Math.max(viewport.scale || 1, 0.001);
            // Prefer endpoints slightly so wall corners win over mid-edge when both are near
            const endpointBonus = tolWorld * 0.35;
            const typeFilter = options.types || null;
            let best = null;
            let bestDist = tolWorld;

            function consider(el, pt, dist, kind) {
                if (dist > bestDist) return;
                bestDist = dist;
                best = { el: el, point: { x: pt.x, y: pt.y }, dist: dist, kind: kind || 'edge' };
            }

            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                if (el.hidden) continue;
                if (typeFilter && typeFilter.indexOf(el.type) < 0) continue;

                if (el.isLine && el.p1 && el.p2) {
                    const p1 = el.p1, p2 = el.p2;
                    const dx = p2.x - p1.x, dy = p2.y - p1.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const nx = -dy / len, ny = dx / len; // unit perpendicular
                    const half = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(el) : 0) / 2;

                    // Centerline endpoints + segment (for wall/beam chaining)
                    const d1 = Math.hypot(world.x - p1.x, world.y - p1.y);
                    const d2 = Math.hypot(world.x - p2.x, world.y - p2.y);
                    consider(el, p1, Math.max(0, d1 - endpointBonus), 'endpoint');
                    consider(el, p2, Math.max(0, d2 - endpointBonus), 'endpoint');
                    const np = nearestPointOnSegment(world.x, world.y, p1.x, p1.y, p2.x, p2.y);
                    consider(el, np, Math.hypot(world.x - np.x, world.y - np.y), 'center');

                    // Outer faces + corners (slab boundaries follow wall edges)
                    if (half > 1e-6) {
                        const faces = [
                            [p1.x + nx * half, p1.y + ny * half, p2.x + nx * half, p2.y + ny * half, 'edge'],
                            [p1.x - nx * half, p1.y - ny * half, p2.x - nx * half, p2.y - ny * half, 'edge'],
                            [p1.x + nx * half, p1.y + ny * half, p1.x - nx * half, p1.y - ny * half, 'endpoint'],
                            [p2.x + nx * half, p2.y + ny * half, p2.x - nx * half, p2.y - ny * half, 'endpoint']
                        ];
                        for (const [ax, ay, bx, by, kind] of faces) {
                            const c1 = { x: ax, y: ay }, c2 = { x: bx, y: by };
                            consider(el, c1, Math.max(0, Math.hypot(world.x - ax, world.y - ay) - endpointBonus), kind === 'endpoint' ? 'corner' : 'edge');
                            consider(el, c2, Math.max(0, Math.hypot(world.x - bx, world.y - by) - endpointBonus), kind === 'endpoint' ? 'corner' : 'edge');
                            const fp = nearestPointOnSegment(world.x, world.y, ax, ay, bx, by);
                            consider(el, fp, Math.hypot(world.x - fp.x, world.y - fp.y), kind);
                        }
                    }
                } else if (el.vertices && el.vertices.length >= 2) {
                    // vertices are stored relative to el.x / el.y — convert to world
                    const pts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                    for (let j = 0; j < pts.length; j++) {
                        const a = pts[j], b = pts[(j + 1) % pts.length];
                        // Prefer corners
                        const dCorner = Math.hypot(world.x - a.x, world.y - a.y);
                        consider(el, a, Math.max(0, dCorner - endpointBonus));
                        const np = nearestPointOnSegment(world.x, world.y, a.x, a.y, b.x, b.y);
                        const d = Math.hypot(world.x - np.x, world.y - np.y);
                        consider(el, np, d);
                    }
                } else if (el.w != null && el.h != null) {
                    const x0 = el.x, y0 = el.y, x1 = el.x + el.w, y1 = el.y + el.h;
                    const corners = [
                        { x: x0, y: y0 }, { x: x1, y: y0 },
                        { x: x1, y: y1 }, { x: x0, y: y1 }
                    ];
                    corners.forEach(c => {
                        const d = Math.hypot(world.x - c.x, world.y - c.y);
                        consider(el, c, Math.max(0, d - endpointBonus));
                    });
                    const edges = [
                        [x0, y0, x1, y0], [x1, y0, x1, y1],
                        [x1, y1, x0, y1], [x0, y1, x0, y0]
                    ];
                    for (const [ax, ay, bx, by] of edges) {
                        const np = nearestPointOnSegment(world.x, world.y, ax, ay, bx, by);
                        const d = Math.hypot(world.x - np.x, world.y - np.y);
                        consider(el, np, d);
                    }
                }
            }
            return best;
        }

        // Keep the DOM measurement badge anchored to its world-space midpoint.
        // The canvas overlay is redrawn on zoom/pan, but this badge used to stay
        // at the screen position from the original click.
        function updateMeasureLabelPosition() {
            const label = document.getElementById('measureLabel');
            if (!label || label.style.display === 'none' || measurePoints.length < 2) return;
            const p1 = measurePoints[0], p2 = measurePoints[1];
            const sp = worldToScreen((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
            label.style.left = `${sp.x}px`;
            label.style.top = `${sp.y - 20}px`;
        }

        /** Viewer size in CSS pixels (matches renderCanvas2D). */
        function getViewerSize() {
            const canvas = document.getElementById('canvas2d');
            const parent = canvas && canvas.parentElement;
            const rect = parent ? parent.getBoundingClientRect()
                : (canvas ? canvas.getBoundingClientRect() : null);
            const W = (rect && rect.width) ? rect.width : 1200;
            const H = (rect && rect.height) ? rect.height : 800;
            return { W: Math.max(1, W), H: Math.max(1, H) };
        }

        function updateZoomDisplays() {
            const pct = Math.round((viewport.scale || 1) * 100) + '%';
            const label = (typeof zoomLocked !== 'undefined' && zoomLocked) ? (pct + ' 🔒') : pct;
            const zd = document.getElementById('zoomDisplay');
            if (zd) zd.textContent = label;
            const sz = document.getElementById('statusZoom');
            if (sz) sz.textContent = 'Zoom: ' + label;
        }

        /**
         * Fit the drawing (underlay + optional elements) perfectly into the 2D viewer,
         * centered with padding. Used after upload and by the Fit button.
         */
        function fitViewportToContent(opts) {
            opts = opts || {};
            const pad = opts.pad != null ? opts.pad : 48;
            const { W, H } = getViewerSize();

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let hasBounds = false;

            // Prefer the underlay as the primary fit target so the whole plan is visible
            if (backgroundImage && backgroundImage.w > 0 && backgroundImage.h > 0) {
                minX = 0;
                minY = 0;
                maxX = backgroundImage.w;
                maxY = backgroundImage.h;
                hasBounds = true;
            }

            // Expand to include visible elements (in case they sit outside the underlay)
            if (Array.isArray(elements)) {
                elements.forEach(function (el) {
                    if (!el || el.hidden) return;
                    let x0 = el.x, y0 = el.y, x1 = el.x + (el.w || 0), y1 = el.y + (el.h || 0);
                    if (el.isLine && el.p1 && el.p2) {
                        x0 = Math.min(el.p1.x, el.p2.x);
                        y0 = Math.min(el.p1.y, el.p2.y);
                        x1 = Math.max(el.p1.x, el.p2.x);
                        y1 = Math.max(el.p1.y, el.p2.y);
                    }
                    if (el.vertices && el.vertices.length) {
                        el.vertices.forEach(function (v) {
                            const vx = el.x + v.x, vy = el.y + v.y;
                            x0 = Math.min(x0, vx); y0 = Math.min(y0, vy);
                            x1 = Math.max(x1, vx); y1 = Math.max(y1, vy);
                        });
                    }
                    if (!isFinite(x0 + y0 + x1 + y1)) return;
                    minX = Math.min(minX, x0);
                    minY = Math.min(minY, y0);
                    maxX = Math.max(maxX, x1);
                    maxY = Math.max(maxY, y1);
                    hasBounds = true;
                });
            }

            if (!hasBounds || !isFinite(minX) || maxX <= minX || maxY <= minY) {
                // Empty project — neutral view
                viewport.scale = 1;
                viewport.offsetX = 0;
                viewport.offsetY = 0;
                updateZoomDisplays();
                if (opts.render !== false) renderCanvas2D();
                return false;
            }

            const worldW = Math.max(1, maxX - minX);
            const worldH = Math.max(1, maxY - minY);
            const availW = Math.max(40, W - pad * 2);
            const availH = Math.max(40, H - pad * 2);
            // Cap max zoom so tiny drawings don't explode; allow zoom-out without floor fight
            let scale = Math.min(availW / worldW, availH / worldH, 8);
            if (!(scale > 0) || !isFinite(scale)) scale = 1;
            scale = Math.max(0.02, scale);

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            viewport.scale = scale;
            // Center content in the viewer
            viewport.offsetX = W / 2 - cx * scale;
            viewport.offsetY = H / 2 - cy * scale;
            updateZoomDisplays();
            if (opts.render !== false) renderCanvas2D();
            return true;
        }

        /** Fit after layout settles (upload / panel resize). */
        function fitViewportWhenReady(retries) {
            retries = retries == null ? 8 : retries;
            const tryFit = function (left) {
                const { W, H } = getViewerSize();
                // Wait until the viewer has a real size (not 0 during first paint)
                if (W < 50 || H < 50) {
                    if (left > 0) requestAnimationFrame(function () { tryFit(left - 1); });
                    return;
                }
                fitViewportToContent();
                // Second pass next frame in case scrollbars/panels adjusted size
                if (left > 0) {
                    requestAnimationFrame(function () { fitViewportToContent(); });
                }
            };
            requestAnimationFrame(function () { tryFit(retries); });
        }

        // ----- UNDO / REDO -----
        function deepCopy(arr) { return arr.map(el => ({ ...el })); }

        function saveState() {
            if (isConfirmed) return;
            undoStack.push(deepCopy(elements));
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack = [];
            if (elements && elements.length > 0) markWorkSession();
        }

        function undo() {
            if (isConfirmed || undoStack.length === 0) return;
            redoStack.push(deepCopy(elements));
            elements = undoStack.pop();
            selectedIds = [];
            renderAll();
        }

        function redo() {
            if (isConfirmed || redoStack.length === 0) return;
            undoStack.push(deepCopy(elements));
            elements = redoStack.pop();
            selectedIds = [];
            renderAll();
        }

        // ----- ELEMENT FACTORY -----
        function createElement(type, x, y, w, h, props = {}) {
            const colors = {
                wall: '#4a8fe0',
                column: '#e08a4a',
                slab: '#4ae0b0',
                door: '#d4b84a',
                window: '#5ac8c8',
                beam: '#b07ae0',
                floor: '#e07a7a',
                opening: '#ff3b30',
                deduction: '#ff3b30',
                cutout: '#ff3b30'
            };
            let zHeight = 0,
                thickness = DEFAULT_WALL_THICKNESS_M;
            let sillHeight = null;   // opening: height of sill above FFL (m)
            let soffitHeight = null; // beam: underside elevation above FFL (m); null = auto
            switch (type) {
                case 'wall':
                    zHeight = 3.0;
                    thickness = DEFAULT_WALL_THICKNESS_M;
                    break;
                case 'column':
                    zHeight = 3.0;
                    break;
                case 'slab':
                    zHeight = DEFAULT_SLAB_THICKNESS_M;
                    break;
                case 'beam':
                    zHeight = 0.30; // beam depth
                    thickness = DEFAULT_BEAM_THICKNESS_M;
                    soffitHeight = null; // auto: under typical storey height
                    break;
                case 'door':
                    zHeight = 2.1;
                    sillHeight = 0; // doors typically from floor
                    break;
                case 'window':
                    zHeight = 1.2; // typical opening height
                    sillHeight = 0.9; // typical sill above FFL — user must confirm
                    break;
                case 'deduction':
                case 'opening':
                case 'cutout':
                    zHeight = 2.1;
                    thickness = DEFAULT_WALL_THICKNESS_M;
                    sillHeight = 0;
                    break;
                default:
                    zHeight = 1.0;
            }
            const base = {
                id: nextId++,
                type,
                x,
                y,
                w,
                h,
                color: props.color || colors[type] || '#aaaaaa',
                ai: false,
                source: 'MANUAL',
                locked: false,
                hidden: false,
                label: type === 'cutout' ? `Cutout ${nextId-1}` :
                    `${type.charAt(0).toUpperCase()+type.slice(1)} ${nextId-1}`,
                thickness: thickness,
                zHeight: zHeight,
                sillHeight: sillHeight,
                soffitHeight: soffitHeight,
                layer: (type === 'wall' || type === 'column' || type === 'beam' || type === 'slab') ? 'Structural'
                    : (type === 'door' || type === 'window' || type === 'opening' || type === 'cutout' || type === 'deduction') ? 'Architectural'
                    : 'Structural',
                material: null,
                costOverride: null,
                isDeduction: (type === 'cutout' || type === 'opening'),
                parentId: props.parentId || null,
                cutouts: props.cutouts || [],
                vertices: props.vertices || null,
                isLine: props.isLine || false,
                p1: props.p1 || null,
                p2: props.p2 || null,
                angle: props.angle || null,
                length: props.length || null,
                confidence: props.confidence != null ? props.confidence : null,
                reviewStatus: props.reviewStatus || 'MANUAL',
                reviewedAt: props.reviewedAt || null,
            };
            return { ...base, ...props };
        }

        // Clipboard
        let clipboardElements = [];
        let pasteCount = 0;

        function copySelected() {
            if (selectedIds.length === 0) return;
            clipboardElements = elements.filter(el => selectedIds.includes(el.id)).map(el => ({ ...el }));
            pasteCount = 0;
        }

        function pasteClipboard() {
            if (isConfirmed || clipboardElements.length === 0) return;
            saveState();
            pasteCount++;
            const offset = 20 * pasteCount;
            const newEls = clipboardElements.map(el => ({
                ...el,
                id: nextId++,
                x: el.x + offset,
                y: el.y + offset,
            }));
            elements.push(...newEls);
            selectedIds = newEls.length ? [newEls[0].id] : [];
            newEls.forEach(function (el) {
                try { if (window.MCResearch && MCResearch.notifyElementChange) MCResearch.notifyElementChange('add', el, { mode: 'pro' }); } catch (_) {}
            });
            renderAll();
        }

        function selectAllElements() {
            selectedIds = elements.filter(el => !el.hidden).map(el => el.id);
            renderAll();
        }

        function addElement(el) {
            if (isConfirmed) return;
            saveState();
            elements.push(el);
            selectedIds = [el.id];
            try { if (window.MCResearch && MCResearch.notifyElementChange) MCResearch.notifyElementChange('add', el, { mode: 'pro' }); } catch (_) {}
            renderAll();
        }

        
        /** IDs of cutouts/deductions attached to a parent — always resolved by stable ID, never array index. */
        function getAttachedChildIds(parentId) {
            const parent = findElementById(parentId);
            const ids = new Set();
            elements.forEach(function (e) {
                if (e && sameElementId(e.parentId, parentId)) ids.add(e.id);
            });
            if (parent && Array.isArray(parent.cutouts)) {
                parent.cutouts.forEach(function (cid) {
                    if (findElementById(cid)) ids.add(cid);
                });
            }
            return [...ids];
        }

        /** True if selectedIds currently contains this element id (type-safe). */
        function isSelectedId(id) {
            return selectedIds.some(function (sid) { return sameElementId(sid, id); });
        }

        /**
         * Expand selection to include wall + all attached cutouts/deductions.
         * The primary (clicked) wall ID is always first so Properties stays anchored
         * to the actual wall object, not a child deduction or a different wall.
         */
        function expandSelectionWithChildren(ids) {
            const primary = ids && ids.length ? ids[0] : null;
            const expanded = [];
            const seen = new Set();
            const pushId = function (id) {
                if (id == null) return;
                const key = String(id);
                if (seen.has(key)) return;
                seen.add(key);
                expanded.push(id);
            };
            // Primary first — this is what renderProperties uses as selectedIds[0]
            if (primary != null) pushId(primary);
            (ids || []).forEach(function (id) {
                pushId(id);
                const el = findElementById(id);
                if (el && ['wall', 'beam', 'slab', 'column'].includes(el.type)) {
                    getAttachedChildIds(id).forEach(pushId);
                }
            });
            return expanded;
        }

        /** Move element by dx, dy (handles line endpoints and polygon verts via bounds).
         *  When moving a wall, also move attached deductions so they never lag behind. */
        function moveElementBy(el, dx, dy) {
            el.x += dx;
            el.y += dy;
            if (el.p1 && el.p2) {
                el.p1 = { x: el.p1.x + dx, y: el.p1.y + dy };
                el.p2 = { x: el.p2.x + dx, y: el.p2.y + dy };
                syncLineBounds(el);
            }
            // vertices are relative to x,y — no change needed
            if (el.type === 'wall') {
                // Move children that were NOT already included in the same drag selection
                const childIds = getAttachedChildIds(el.id);
                childIds.forEach(function (cid) {
                    if (selectedIds && isSelectedId(cid)) return; // already moved with selection
                    const child = findElementById(cid);
                    if (child && !child.locked) moveElementBy(child, dx, dy);
                });
            }
        }

        /** Center of element in world drawing units (for rotation pivot). */
        function getElementCenter(el) {
            if (!el) return { x: 0, y: 0 };
            if (el.isLine && el.p1 && el.p2) {
                return { x: (el.p1.x + el.p2.x) / 2, y: (el.p1.y + el.p2.y) / 2 };
            }
            if (el.vertices && el.vertices.length >= 2) {
                let sx = 0, sy = 0;
                el.vertices.forEach(function (v) { sx += el.x + v.x; sy += el.y + v.y; });
                return { x: sx / el.vertices.length, y: sy / el.vertices.length };
            }
            return {
                x: (el.x || 0) + (el.w || 0) / 2,
                y: (el.y || 0) + (el.h || 0) / 2
            };
        }

        function rotatePointAround(px, py, cx, cy, cosA, sinA) {
            const dx = px - cx, dy = py - cy;
            return { x: cx + dx * cosA - dy * sinA, y: cy + dx * sinA + dy * cosA };
        }

        /**
         * Rotate one element by degrees (positive = CW in screen coords where Y grows down).
         * Works for walls/beams (line), polygons (slab/column/cutout), and axis-aligned boxes.
         */
        function rotateElementBy(el, degrees, pivot) {
            if (!el || el.locked) return;
            const rad = (Number(degrees) || 0) * Math.PI / 180;
            if (!isFinite(rad) || Math.abs(rad) < 1e-12) return;
            const cosA = Math.cos(rad), sinA = Math.sin(rad);
            const c = pivot || getElementCenter(el);

            if (el.isLine && el.p1 && el.p2) {
                el.p1 = rotatePointAround(el.p1.x, el.p1.y, c.x, c.y, cosA, sinA);
                el.p2 = rotatePointAround(el.p2.x, el.p2.y, c.x, c.y, cosA, sinA);
                el.angle = Math.atan2(el.p2.y - el.p1.y, el.p2.x - el.p1.x);
                el.length = Math.hypot(el.p2.x - el.p1.x, el.p2.y - el.p1.y);
                if (typeof syncLineBounds === 'function') syncLineBounds(el);
                return;
            }

            if (el.vertices && el.vertices.length >= 2) {
                const abs = el.vertices.map(function (v) {
                    return rotatePointAround(el.x + v.x, el.y + v.y, c.x, c.y, cosA, sinA);
                });
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                abs.forEach(function (p) {
                    if (p.x < minX) minX = p.x;
                    if (p.y < minY) minY = p.y;
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                });
                el.x = minX;
                el.y = minY;
                el.w = Math.max(0.01, maxX - minX);
                el.h = Math.max(0.01, maxY - minY);
                el.vertices = abs.map(function (p) { return { x: p.x - el.x, y: p.y - el.y }; });
                el.rotation = ((el.rotation || 0) + degrees) % 360;
                return;
            }

            // Axis-aligned box → rotate corners into polygon so orientation is kept
            const corners = [
                { x: el.x, y: el.y },
                { x: el.x + (el.w || 0), y: el.y },
                { x: el.x + (el.w || 0), y: el.y + (el.h || 0) },
                { x: el.x, y: el.y + (el.h || 0) }
            ].map(function (p) { return rotatePointAround(p.x, p.y, c.x, c.y, cosA, sinA); });
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            corners.forEach(function (p) {
                if (p.x < minX) minX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.x > maxX) maxX = p.x;
                if (p.y > maxY) maxY = p.y;
            });
            el.x = minX;
            el.y = minY;
            el.w = Math.max(0.01, maxX - minX);
            el.h = Math.max(0.01, maxY - minY);
            el.vertices = corners.map(function (p) { return { x: p.x - el.x, y: p.y - el.y }; });
            el.rotation = ((el.rotation || 0) + degrees) % 360;
        }

        function rotateSelected(degrees) {
            if (isConfirmed || !selectedIds.length) return;
            const deg = Number(degrees);
            if (!isFinite(deg) || deg === 0) return;
            saveState();
            // Shared pivot = centroid of selection centers (multi-select rotates as a group)
            let sx = 0, sy = 0, n = 0;
            const list = [];
            selectedIds.forEach(function (id) {
                const el = elements.find(function (e) { return e.id === id; });
                if (!el || el.locked || el.hidden) return;
                list.push(el);
                const c = getElementCenter(el);
                sx += c.x; sy += c.y; n++;
            });
            if (!list.length) return;
            const pivot = n ? { x: sx / n, y: sy / n } : null;
            list.forEach(function (el) { rotateElementBy(el, deg, pivot); });
            renderAll();
            try {
                list.forEach(function (el) {
                    if (typeof markElementEdited === 'function') markElementEdited(el);
                    if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                        MCResearch.notifyElementChange('edit', el, {
                            mode: 'pro',
                            notes: 'rotate:' + deg + 'deg'
                        });
                    }
                });
                if (typeof scheduleResearchQuantitySync === 'function') scheduleResearchQuantitySync();
            } catch (_) {}
        }

        function promptRotateSelected() {
            if (isConfirmed || !selectedIds.length) return;
            const raw = window.prompt(
                'Rotate selected element(s) by angle in degrees.\n\n' +
                'Positive = clockwise, negative = counter-clockwise.\n' +
                'Examples: 90, -45, 15',
                '90'
            );
            if (raw === null) return;
            const deg = parseFloat(raw);
            if (!isFinite(deg) || deg === 0) {
                try { showToast('Enter a non-zero number of degrees', 'error'); } catch (_) {}
                return;
            }
            rotateSelected(deg);
        }


        function deleteSelected() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const toDelete = new Set(selectedIds);
            selectedIds.forEach(id => {
                getAttachedChildIds(id).forEach(cid => toDelete.add(cid));
            });
            elements.forEach(el => {
                if (el.parentId != null && toDelete.has(el.parentId)) toDelete.add(el.id);
            });
            elements.forEach(el => {
                if (el.cutouts) el.cutouts = el.cutouts.filter(cid => !toDelete.has(cid));
            });
            const removed = elements.filter(el => toDelete.has(el.id));
            elements = elements.filter(el => !toDelete.has(el.id));
            selectedIds = [];
            renderAll();
            try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                    removed.forEach(function (el) {
                        MCResearch.notifyElementChange('delete', el, { mode: 'pro' });
                    });
                }
            } catch (_) {}
        }

        function duplicateSelected() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const originalSelected = [...selectedIds];
            const idsToCopy = expandSelectionWithChildren(originalSelected);
            const idMap = {};
            const copies = [];
            idsToCopy.forEach(id => {
                const el = elements.find(e => e.id === id);
                if (!el) return;
                const newId = nextId++;
                idMap[id] = newId;
                const copy = {
                    ...el,
                    id: newId,
                    x: el.x + 20,
                    y: el.y + 20,
                    label: el.label + ' (copy)',
                    ai: false,
                    source: 'MANUAL',
                    // A duplicate is a fresh manual element — it never had an AI proposal
                    // of its own, so don't carry over the original's frozen AI baseline.
                    aiQty: null,
                    aiUnit: null,
                    p1: el.p1 ? { x: el.p1.x + 20, y: el.p1.y + 20 } : null,
                    p2: el.p2 ? { x: el.p2.x + 20, y: el.p2.y + 20 } : null,
                    vertices: el.vertices ? el.vertices.map(v => ({ ...v })) : null,
                    cutouts: el.cutouts ? [...el.cutouts] : [],
                    parentId: el.parentId
                };
                if (copy.isLine) syncLineBounds(copy);
                copies.push(copy);
            });
            copies.forEach(copy => {
                if (copy.parentId != null && idMap[copy.parentId] != null) {
                    copy.parentId = idMap[copy.parentId];
                }
                if (copy.cutouts && copy.cutouts.length) {
                    copy.cutouts = copy.cutouts
                        .map(cid => idMap[cid] != null ? idMap[cid] : null)
                        .filter(cid => cid != null);
                }
            });
            elements.push(...copies);
            selectedIds = originalSelected.map(id => idMap[id]).filter(id => id != null);
            copies.forEach(function (el) {
                try { if (window.MCResearch && MCResearch.notifyElementChange) MCResearch.notifyElementChange('add', el, { mode: 'pro' }); } catch (_) {}
            });
            renderAll();
        }

        function toggleLockSelected() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const anyLocked = elements.some(el => selectedIds.includes(el.id) && el.locked);
            elements.forEach(el => { if (selectedIds.includes(el.id)) el.locked = !anyLocked; });
            renderAll();
        }

        function toggleHideSelected() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const anyHidden = elements.some(el => selectedIds.includes(el.id) && el.hidden);
            elements.forEach(el => { if (selectedIds.includes(el.id)) el.hidden = !anyHidden; });
            renderAll();
        }

        /** Show or hide all measured elements on the drawing (PDF/plan view). Does not delete or change quantities. */
        function toggleElementsOnDrawing() {
            elementsOnDrawingVisible = !elementsOnDrawingVisible;
            const btn = document.getElementById('btnToggleElements');
            if (btn) {
                btn.innerHTML = elementsOnDrawingVisible
                    ? '<i class="fas fa-layer-group"></i>'
                    : '<i class="fas fa-eye-slash"></i>';
                btn.classList.toggle('tool-active', !elementsOnDrawingVisible);
                btn.setAttribute('data-tooltip', elementsOnDrawingVisible
                    ? 'Show / hide measured elements on drawing'
                    : 'Show measured elements on drawing (currently hidden)');
                btn.title = elementsOnDrawingVisible
                    ? 'Hide measured elements on drawing'
                    : 'Show measured elements on drawing';
            }
            try {
                if (typeof showToast === 'function') {
                    showToast(elementsOnDrawingVisible
                        ? 'Measured elements shown on drawing'
                        : 'Measured elements hidden on drawing — quantities unchanged', 'success');
                }
            } catch (_) {}
            renderAll();
        }

        function bringToFront() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const selected = elements.filter(el => selectedIds.includes(el.id));
            const others = elements.filter(el => !selectedIds.includes(el.id));
            elements = [...others, ...selected];
            renderAll();
        }

        function sendToBack() {
            if (isConfirmed || selectedIds.length === 0) return;
            saveState();
            const selected = elements.filter(el => selectedIds.includes(el.id));
            const others = elements.filter(el => !selectedIds.includes(el.id));
            elements = [...selected, ...others];
            renderAll();
        }

        // ----- CONFIRM -----
        function confirmTakeoff() {
            if (isConfirmed) {
                isConfirmed = false;
                const _b1 = document.getElementById('btnConfirm');
                if (_b1) _b1.classList.remove('confirmed');
                document.getElementById('statusEdit').textContent = 'Draft';
                elements.forEach(el => {
                    el.locked = false;
                    if (getReviewStatus(el) === 'FINAL') {
                        const source = getElementSource(el);
                        el.reviewStatus = source === 'AI' ? 'AI_GENERATED' : (source === 'AI_EDITED' ? 'QS_REVIEWED' : 'MANUAL');
                        el.finalizedAt = null;
                    }
                });
                renderAll();
                return;
            }
            const finalizedAt = new Date().toISOString();
            elements.forEach(el => {
                el.locked = true;
                el.reviewStatus = 'FINAL';
                el.finalizedAt = finalizedAt;
            });
            isConfirmed = true;
            const _b2 = document.getElementById('btnConfirm');
            if (_b2) _b2.classList.add('confirmed');
            document.getElementById('statusEdit').textContent = 'Confirmed';
            currentTool = null;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
            document.getElementById('statusMode').textContent = 'Select';
            renderAll();
            alert('✅ Takeoff confirmed and locked.');
        }

        // ----- CALIBRATION -----
        function updateCalibDisplay() {
            const el = document.getElementById('calibDisplay');
            if (!el) return;
            if (Math.abs(calibrationFactor - 1) < 1e-9) {
                el.textContent = '1 unit = 1 m';
            } else if (calibrationFactor >= 1) {
                el.textContent = `1 unit = ${calibrationFactor.toFixed(4)} m`;
            } else {
                el.textContent = `1 unit = ${calibrationFactor.toFixed(6)} m`;
            }
        }

        function toMeters(drawingDist) {
            return drawingDist * calibrationFactor;
        }

        function toDrawing(meters) {
            return meters / (calibrationFactor || 1);
        }

        /** True when focus is in an editable field — global shortcuts must not run. */
        function isTypingTarget(el) {
            // Always prefer the true focus owner (more reliable than event.target under rebuilds)
            const ae = document.activeElement;
            const candidates = [el, ae].filter(Boolean);
            for (let i = 0; i < candidates.length; i++) {
                let node = candidates[i];
                if (!node || node === document.body || node === document.documentElement) continue;
                const tag = (node.tagName || '').toLowerCase();
                if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
                if (node.isContentEditable) return true;
                if (node.getAttribute && (node.getAttribute('role') === 'textbox' || node.getAttribute('role') === 'spinbutton')) return true;
                if (typeof node.closest === 'function') {
                    if (node.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable]')) return true;
                }
            }
            // Fallback: if an input in props/modals is focused
            if (ae && ae !== document.body && typeof ae.closest === 'function') {
                if (ae.closest('#props-container, #right-panel, #bottom-panel, .modal, [role="dialog"], #app-header, #toolbar')) {
                    const at = (ae.tagName || '').toLowerCase();
                    if (at === 'input' || at === 'textarea' || at === 'select' || ae.isContentEditable) return true;
                }
            }
            return false;
        }

        /** Core rule: while typing in any field, app shortcuts are fully disabled. */
        function isAppEditing() {
            return isTypingTarget(document.activeElement) || isTypingTarget(document.activeElement);
        }

        /**
         * Element provenance for AI vs manual workflow.
         * source: 'AI' | 'MANUAL' | 'AI_EDITED'
         * Legacy elements may only have ai:true/false — normalized here.
         */
        function getElementSource(el) {
            if (!el) return 'MANUAL';
            if (el.source === 'AI' || el.source === 'MANUAL' || el.source === 'AI_EDITED') return el.source;
            if (el.ai) return 'AI';
            return 'MANUAL';
        }
        function isPureAiElement(el) {
            return getElementSource(el) === 'AI';
        }
        /** Any AI-origin element (pure AI or accepted/edited). */
        function isAiOriginElement(el) {
            const s = getElementSource(el);
            return s === 'AI' || s === 'AI_EDITED';
        }
        function isManualElement(el) {
            return getElementSource(el) === 'MANUAL';
        }
        function getReviewStatus(el) {
            if (!el) return 'MANUAL';
            if (el.reviewStatus === 'FINAL' || el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'AI_GENERATED' || el.reviewStatus === 'MANUAL') {
                return el.reviewStatus;
            }
            return getElementSource(el) === 'AI' ? 'AI_GENERATED' : (getElementSource(el) === 'AI_EDITED' ? 'QS_REVIEWED' : 'MANUAL');
        }
        function getReviewLabel(el) {
            const status = getReviewStatus(el);
            return status === 'FINAL' ? 'Final' : status === 'QS_REVIEWED' ? 'QS reviewed' : status === 'AI_GENERATED' ? 'AI generated' : 'Manual';
        }
        function getConfidencePercent(el) {
            if (!el || el.confidence == null || !isFinite(Number(el.confidence))) return null;
            const value = Number(el.confidence);
            return Math.max(0, Math.min(100, Math.round((value <= 1 ? value * 100 : value))));
        }
        function markElementReviewed(el) {
            if (!el) return;
            if (getElementSource(el) === 'AI') {
                el.source = 'AI_EDITED';
                el.ai = false;
            }
            el.accepted = true; // include in BOQ / material quantities
            el.reviewStatus = 'QS_REVIEWED';
            el.reviewedAt = new Date().toISOString();
            try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                    MCResearch.notifyElementChange('accept', el, { mode: 'pro' });
                }
            } catch (_) {}
        }
        /** User changed geometry/props of an AI item → AI_EDITED (kept on re-detect). */
        function markElementEdited(el) {
            if (!el) return;
            if (getElementSource(el) === 'AI') {
                el.source = 'AI_EDITED';
                el.ai = false;
            }
            el.accepted = true;
            if (getReviewStatus(el) !== 'FINAL') {
                el.reviewStatus = 'QS_REVIEWED';
                el.reviewedAt = new Date().toISOString();
            }
            try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                    MCResearch.notifyElementChange('edit', el, { mode: 'pro' });
                }
            } catch (_) {}
        }
        /** Real-time research: debounced geometry snapshots after QS edits. */
        function setupResearchRealtime() {
            if (!window.MCResearch || typeof MCResearch.setRealtimeElementsProvider !== 'function') return;
            MCResearch.setRealtimeElementsProvider(function () {
                const visible = (typeof elements !== 'undefined' && Array.isArray(elements))
                    ? elements.filter(function (el) { return el && !el.hidden; })
                    : [];
                const aiEls = visible.filter(function (el) {
                    return el.source === 'AI' || el.source === 'AI_EDITED' || el.ai === true;
                });
                function mapEl(el, defSource, defStatus) {
                    return {
                        type: el.type, label: el.label, x: el.x, y: el.y, w: el.w, h: el.h,
                        height: el.zHeight || el.height || null, isLine: !!el.isLine,
                        p1: el.p1 || null, p2: el.p2 || null, vertices: el.vertices || null,
                        thickness: el.thickness || null,
                        source: el.source || defSource,
                        reviewStatus: el.reviewStatus || defStatus,
                        accepted: el.accepted !== false,
                        id: el.id
                    };
                }
                return {
                    elements: visible.map(function (el) { return mapEl(el, el.ai ? 'AI_EDITED' : 'MANUAL', 'QS_REVIEWED'); }),
                    aiElements: aiEls.map(function (el) { return mapEl(el, 'AI', 'AI_GENERATED'); }),
                    imageWidth: (typeof backgroundImage !== 'undefined' && backgroundImage && (backgroundImage.w || (backgroundImage.img && backgroundImage.img.naturalWidth))) || (typeof canvas2d !== 'undefined' && canvas2d ? canvas2d.width : null),
                    imageHeight: (typeof backgroundImage !== 'undefined' && backgroundImage && (backgroundImage.h || (backgroundImage.img && backgroundImage.img.naturalHeight))) || (typeof canvas2d !== 'undefined' && canvas2d ? canvas2d.height : null),
                    metersPerPixel: (typeof calibrationFactor === 'number') ? calibrationFactor : null,
                };
            });
        }
        try { setupResearchRealtime(); } catch (_) {}

        // Keep the research dashboard in sync with the same live quantities shown in Pro Mode.
        // The export path used to be the only place that wrote measurement rows, so edits made
        // after detection (especially slab geometry and deductions) left stale dashboard data.
        let researchQuantitySyncTimer = null;
        let researchQuantitySyncInFlight = false;
        let researchQuantitySyncAgain = false;
        function scheduleResearchQuantitySync() {
            if (!window.MCResearch || typeof MCResearch.logMeasurements !== 'function') return;
            if (researchQuantitySyncTimer) clearTimeout(researchQuantitySyncTimer);
            researchQuantitySyncTimer = setTimeout(function () {
                researchQuantitySyncTimer = null;
                syncResearchQuantities();
            }, 250);
        }
        async function syncResearchQuantities() {
            if (!window.MCResearch || typeof MCResearch.logMeasurements !== 'function') return;
            if (!MCResearch.getParticipantId || !MCResearch.getParticipantId()) return;
            if (researchQuantitySyncInFlight) {
                researchQuantitySyncAgain = true;
                return;
            }
            researchQuantitySyncInFlight = true;
            try {
                const ids = MCResearch.getResearchIds ? MCResearch.getResearchIds() : {};
                // Without a registered drawing, supersede cannot match prior rows and
                // zero aggregate lines (Plastering/Tiling/Painting) flood the dashboard.
                if (!ids.drawingId) {
                    return;
                }
                const currentRows = computeQuantities();
                const cf = calibrationFactor;
                const materialRows = currentRows.map(function (row) {
                    const el = row.elementId != null ? elements.find(function (item) { return item.id === row.elementId; }) : null;
                    const qty = Number(row.qty);
                    if (!Number.isFinite(qty)) return null;
                    // Skip empty aggregate rollups (always emitted even with no walls/slabs)
                    if (row.isAggregate && Math.abs(qty) < 1e-9) return null;
                    // Skip zero per-element rows unless they carry AI/reference for comparison
                    const aiQty = el && Number.isFinite(Number(el.aiQty)) ? Number(el.aiQty) : null;
                    const referenceQty = el && Number.isFinite(Number(el.referenceQty)) ? Number(el.referenceQty) : null;
                    if (Math.abs(qty) < 1e-9 && aiQty == null && referenceQty == null) return null;
                    const sourceNote = row.remarks ? String(row.remarks) : 'Live quantity from the current reviewed geometry';
                    const context = 'Live Pro quantity · ' + (ids.projectId || 'project') + ' · ' + (ids.drawingId || 'drawing');
                    return {
                        measurementType: row.material || row.element || 'quantity',
                        measurementMethod: 'pro_live_quantity',
                        aiMeasurement: aiQty,
                        referenceMeasurement: referenceQty,
                        userMeasurement: qty,
                        finalAcceptedMeasurement: qty,
                        unit: row.unit || '',
                        userCorrection: !!(el && (el.source === 'AI_EDITED' || el.reviewStatus === 'QS_REVIEWED')),
                        elementLabel: row.elementLabel || row.element || row.material || 'Quantity',
                        notes: context + ' · ' + sourceNote
                    };
                }).filter(Boolean);
                // Element-level baseline rows, one per wall/beam/slab/column/door/window.
                // These use the SAME definition as computeAiBaselineQty() (m³ for
                // wall/beam/slab/column, 1 Nr per door/window), matched by measurementType
                // ('wall','door','window','column','beam','slab') so the research
                // dashboard's "AI Detection Baseline" Quantity Error column — which keys
                // off those exact type names — actually has AI-vs-current data to compare,
                // instead of only ever seeing derived material rows (Brickwork, Tiles,
                // Paint…) whose type names never match and so were always skipped.
                const elementBaselineRows = elements.filter(function (el) {
                    return el && !el.hidden && ['wall', 'beam', 'slab', 'column', 'door', 'window'].indexOf(el.type) >= 0;
                }).map(function (el) {
                    const live = computeAiBaselineQty(el, cf);
                    if (!live) return null;
                    if (!(Number.isFinite(live.qty) && Math.abs(live.qty) > 1e-9)) return null;
                    const aiQty = Number.isFinite(Number(el.aiQty)) ? Number(el.aiQty) : null;
                    const referenceQty = Number.isFinite(Number(el.referenceQty)) ? Number(el.referenceQty) : null;
                    return {
                        measurementType: el.type,
                        measurementMethod: 'pro_element_baseline',
                        aiMeasurement: aiQty,
                        referenceMeasurement: referenceQty,
                        userMeasurement: live.qty,
                        finalAcceptedMeasurement: live.qty,
                        unit: live.unit,
                        userCorrection: !!(el.source === 'AI_EDITED' || el.reviewStatus === 'QS_REVIEWED'),
                        elementLabel: el.label || el.type,
                        notes: 'Element baseline · ' + (ids.projectId || 'project') + ' · ' + (ids.drawingId || 'drawing')
                    };
                }).filter(Boolean);
                const rows = materialRows.concat(elementBaselineRows);
                if (rows.length) {
                    await MCResearch.logMeasurements(rows, {
                        mode: 'pro',
                        projectId: ids.projectId || null,
                        drawingId: ids.drawingId || null,
                        notes: 'Live Pro quantity refresh · ' + (ids.projectId || 'project') + ' · ' + (ids.drawingId || 'drawing')
                    });
                }
            } catch (err) {
                console.warn('[research] live quantity sync failed', err && err.message);
            } finally {
                researchQuantitySyncInFlight = false;
                if (researchQuantitySyncAgain) {
                    researchQuantitySyncAgain = false;
                    scheduleResearchQuantitySync();
                }
            }
        }
        function isAiStyled(el) {
            // Pure AI looks dashed; manual + AI_EDITED look solid (user-owned)
            return getElementSource(el) === 'AI';
        }

        /**
         * Visual wall/beam thickness in DRAWING units.
         * el.thickness stays in METRES for quantities/properties.
         * thicknessDraw mirrors the true scaled thickness so changing 100→225 mm
         * is visible on the plan. Only extreme outliers are clamped.
         */
        function clampThicknessDraw(td) {
            if (!(td > 0) || !isFinite(td)) return 4;
            // Allow realistic walls (100–300 mm) at fine PDF scales (CF ~0.005 → ~20–60 du).
            // Upper bound only stops pathological values becoming "bubbles".
            return Math.max(0.8, Math.min(td, 120));
        }

        function getLineThicknessDraw(el) {
            if (!el) return 3;
            // Always derive visual stroke from metres for walls/beams so property
            // edits (e.g. 0.15 → 0.225) update 2D immediately and stay in sync with 3D.
            const hasM = (typeof el.thickness === 'number' && isFinite(el.thickness) && el.thickness > 0);
            const thkM = hasM
                ? el.thickness
                : (el.type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M);
            const td = clampThicknessDraw(toDrawing(thkM));
            el.thicknessDraw = td;
            return td;
        }

        function setLineThicknessMeters(el, meters) {
            if (!el) return;
            const m = Number(meters);
            if (!(m > 0) || !isFinite(m)) return;
            el.thickness = m;
            // Update visual to match new property at CURRENT scale (user-driven)
            el.thicknessDraw = clampThicknessDraw(toDrawing(m));
        }


        /**
         * Snap step in drawing units.
         * Based on ~2 screen pixels so tracing stays accurate when zoomed in.
         * Physical-meter grids are too coarse on calibrated PDF underlays.
         */
        function getSnapStep() {
            if (!snapGrid) return 0;
            const pxPerUnit = Math.max(viewport.scale || 1, 0.001);
            // ~2 px on screen → fine placement; zoom in for even finer control
            let stepDu = 2 / pxPerUnit;
            // Keep a sensible range
            if (stepDu > 50) stepDu = 50;
            if (stepDu < 0.01) stepDu = 0.01;
            // Nice round steps
            const candidates = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50];
            let best = candidates[0];
            for (let i = 0; i < candidates.length; i++) {
                if (candidates[i] >= stepDu) { best = candidates[i]; break; }
                best = candidates[i];
            }
            return best;
        }

        // Exact cursor by default. Grid snap only when magnet is ON.
        // Hold Alt or Shift to force exact even if snap is on.
        function snapPoint(world, e) {
            const bypass = e && (e.altKey || e.shiftKey);
            if (!snapGrid || bypass) {
                return { x: world.x, y: world.y };
            }
            const step = getSnapStep();
            if (!step || step <= 0) return { x: world.x, y: world.y };
            return {
                x: Math.round(world.x / step) * step,
                y: Math.round(world.y / step) * step,
            };
        }

        /** Canvas pointer → CSS-pixel coords relative to the 2D canvas (sub-pixel accurate). */
        function getCanvasPointer(e, canvasEl) {
            const canvas = canvasEl || document.getElementById('canvas2d');
            if (!canvas) return { sx: 0, sy: 0, world: { x: 0, y: 0 } };
            const rect = canvas.getBoundingClientRect();
            // Use floating-point CSS pixels (matches how viewport is applied in render)
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            return { sx, sy, world: screenToWorld(sx, sy) };
        }

        function finishCalibration(p1, p2) {
            const drawingDist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
            if (drawingDist < 1e-6) {
                showToast('Points are too close. Click two distinct points on a known dimension.', 'error');
                calibratePoints = [];
                calibratePreview = null;
                return;
            }
            const input = prompt(
                `Measured ${drawingDist.toFixed(2)} drawing units.\n\nEnter the REAL length in meters:`,
                drawingDist.toFixed(2)
            );
            if (input === null) {
                calibratePoints = [];
                calibratePreview = null;
                currentTool = null;
                calibrateMode = false;
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                document.getElementById('statusMode').textContent = 'Select';
                document.getElementById('canvas2d').style.cursor = 'default';
                renderCanvas2D();
                return;
            }
            const realMeters = parseFloat(input);
            if (isNaN(realMeters) || realMeters <= 0) {
                showToast('Please enter a positive length in meters.', 'error');
                calibratePoints = [];
                calibratePreview = null;
                return;
            }
            calibrationFactor = realMeters / drawingDist;
            updateCalibDisplay();
            // Fix AI wall/beam thicknesses that were stored in drawing units
            // (would become giant bubbles after toDrawing() with the new scale)
            sanitizeLineThicknesses();
            calibratePoints = [];
            calibratePreview = null;
            calibrateMode = false;
            currentTool = null;
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
            document.getElementById('statusMode').textContent = 'Select';
            document.getElementById('canvas2d').style.cursor = 'default';
            if (currentView === '3d' && threeInitialized) {
                threeFitDone = false;
            }
            renderAll();
            showToast(
                'Scale set: 1 drawing unit = ' + calibrationFactor.toFixed(6) + ' m (' +
                drawingDist.toFixed(2) + ' units → ' + realMeters + ' m). Geometry is unchanged; quantities now use this scale.',
                'success'
            );
        }

        /** Keep wall/beam thickness in realistic metres (renderer uses toDrawing). */
        function sanitizeLineThicknesses() {
            let fixed = 0;
            (elements || []).forEach(function (el) {
                if (!(el.type === 'wall' || el.type === 'beam')) return;
                if (!el.isLine) return;
                const t = el.thickness;
                if (!(typeof t === 'number' && t >= 0.08 && t <= 0.55)) {
                    if (typeof t === 'number' && t > 0) {
                        const asM = toMeters(t);
                        if (asM >= 0.08 && asM <= 0.55) {
                            el.thickness = asM;
                        } else {
                            el.thickness = el.type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
                        }
                    } else {
                        el.thickness = el.type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
                    }
                    fixed++;
                }
                if (el.type === 'wall' && typeof standardizeWallThickness === 'function') {
                    standardizeWallThickness(el);
                    fixed++;
                }
                // Preserve existing thicknessDraw so calibrate does not change visual stroke.
                // Only seed if missing.
                if (!(typeof el.thicknessDraw === 'number' && el.thicknessDraw > 0)) {
                    let td = getLineThicknessDraw(el);
                    if (!(td > 0) || !isFinite(td)) td = 4;
                    el.thicknessDraw = clampThicknessDraw(td);
                    fixed++;
                }
            });
            if (fixed) console.log('sanitizeLineThicknesses: fixed', fixed);
        }

        function resetCalibration() {
            if (!confirm('Reset scale to 1 unit = 1 m?')) return;
            calibrationFactor = 1.0;
            updateCalibDisplay();
            renderAll();
        }

        // ----- GRID -----
        function getGridSpacing(scale) {
            const targetPixels = 40;
            const worldWidth = 1 / scale * targetPixels;
            const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
            let major = candidates.find(c => c >= worldWidth) || candidates[candidates.length - 1];
            let minor = major / 5;
            return { major, minor };
        }

        // ----- DRAW DOOR & WINDOW (unchanged) -----
        function drawDoor(ctx, el, scale) {
            const { x, y, w, h, swing, doorStyle } = el;
            const style = doorStyle || 'standard';
            const stroke = '#333333';
            const lw = 1.5 / scale;
            const isHorizontal = w >= h;
            const openingLen = isHorizontal ? w : h;

            ctx.save();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.setLineDash([]);

            if (style === 'double') {
                if (isHorizontal) {
                    const hingeL = x;
                    const hingeR = x + w;
                    const cy = swing === 'right' ? y : y + h;
                    const radius = w / 2;
                    const dir = swing === 'right' ? 1 : -1;
                    ctx.beginPath();
                    ctx.moveTo(x - 8 / scale, cy);
                    ctx.lineTo(x, cy);
                    ctx.moveTo(x + w, cy);
                    ctx.lineTo(x + w + 8 / scale, cy);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(hingeL, cy);
                    ctx.lineTo(hingeL + radius, cy);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(hingeR, cy);
                    ctx.lineTo(hingeR - radius, cy);
                    ctx.stroke();
                    ctx.beginPath();
                    if (dir < 0) {
                        ctx.arc(hingeL, cy, radius, 0, Math.PI / 2, false);
                        ctx.moveTo(hingeR, cy);
                        ctx.arc(hingeR, cy, radius, Math.PI, Math.PI / 2, true);
                    } else {
                        ctx.arc(hingeL, cy, radius, 0, -Math.PI / 2, true);
                        ctx.moveTo(hingeR, cy);
                        ctx.arc(hingeR, cy, radius, Math.PI, -Math.PI / 2, false);
                    }
                    ctx.stroke();
                } else {
                    const hingeT = y;
                    const hingeB = y + h;
                    const cx = swing === 'right' ? x + w : x;
                    const radius = h / 2;
                    const dir = swing === 'right' ? 1 : -1;
                    ctx.beginPath();
                    ctx.moveTo(cx, y - 8 / scale);
                    ctx.lineTo(cx, y);
                    ctx.moveTo(cx, y + h);
                    ctx.lineTo(cx, y + h + 8 / scale);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(cx, hingeT);
                    ctx.lineTo(cx, hingeT + radius);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(cx, hingeB);
                    ctx.lineTo(cx, hingeB - radius);
                    ctx.stroke();
                    ctx.beginPath();
                    if (dir < 0) {
                        ctx.arc(cx, hingeT, radius, Math.PI / 2, Math.PI, false);
                        ctx.moveTo(cx, hingeB);
                        ctx.arc(cx, hingeB, radius, -Math.PI / 2, Math.PI, true);
                    } else {
                        ctx.arc(cx, hingeT, radius, Math.PI / 2, 0, true);
                        ctx.moveTo(cx, hingeB);
                        ctx.arc(cx, hingeB, radius, -Math.PI / 2, 0, false);
                    }
                    ctx.stroke();
                }
            } else if (style === 'sliding') {
                ctx.strokeRect(x, y, w, h);
                const gap = 3 / scale;
                if (isHorizontal) {
                    ctx.beginPath();
                    ctx.moveTo(x + gap, y + h * 0.35);
                    ctx.lineTo(x + w - gap, y + h * 0.35);
                    ctx.moveTo(x + gap, y + h * 0.65);
                    ctx.lineTo(x + w - gap, y + h * 0.65);
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.moveTo(x + w * 0.35, y + gap);
                    ctx.lineTo(x + w * 0.35, y + h - gap);
                    ctx.moveTo(x + w * 0.65, y + gap);
                    ctx.lineTo(x + w * 0.65, y + h - gap);
                    ctx.stroke();
                }
                ctx.fillStyle = stroke;
                ctx.font = `${9 / scale}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('⇔', x + w / 2, y + h / 2);
            } else {
                if (isHorizontal) {
                    const hingeX = swing === 'left' ? x : x + w;
                    const leafEndX = swing === 'left' ? x + openingLen : x;
                    const cy = y + h / 2;
                    const radius = openingLen;
                    ctx.beginPath();
                    ctx.moveTo(x - 10 / scale, cy);
                    ctx.lineTo(x, cy);
                    ctx.moveTo(x + w, cy);
                    ctx.lineTo(x + w + 10 / scale, cy);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(hingeX, cy);
                    ctx.lineTo(leafEndX, cy);
                    ctx.stroke();
                    ctx.beginPath();
                    if (swing === 'left') {
                        ctx.arc(hingeX, cy, radius, 0, Math.PI / 2, false);
                    } else {
                        ctx.arc(hingeX, cy, radius, Math.PI, Math.PI / 2, true);
                    }
                    ctx.stroke();
                } else {
                    const hingeY = swing === 'left' ? y : y + h;
                    const leafEndY = swing === 'left' ? y + openingLen : y;
                    const cx = x + w / 2;
                    const radius = openingLen;
                    ctx.beginPath();
                    ctx.moveTo(cx, y - 10 / scale);
                    ctx.lineTo(cx, y);
                    ctx.moveTo(cx, y + h);
                    ctx.lineTo(cx, y + h + 10 / scale);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(cx, hingeY);
                    ctx.lineTo(cx, leafEndY);
                    ctx.stroke();
                    ctx.beginPath();
                    if (swing === 'left') {
                        ctx.arc(cx, hingeY, radius, Math.PI / 2, 0, true);
                    } else {
                        ctx.arc(cx, hingeY, radius, -Math.PI / 2, 0, false);
                    }
                    ctx.stroke();
                }
            }
            ctx.restore();
        }

        function drawWindow(ctx, el, scale) {
            const { x, y, w, h } = el;
            const stroke = '#333333';
            const lw = 1.5 / scale;
            const isHorizontal = w >= h;

            ctx.save();
            ctx.strokeStyle = stroke;
            ctx.lineWidth = lw;
            ctx.lineCap = 'butt';
            ctx.setLineDash([]);

            if (isHorizontal) {
                const cy = y + h / 2;
                const inset = Math.min(h * 0.25, 4 / scale);
                ctx.beginPath();
                ctx.moveTo(x - 8 / scale, y + inset);
                ctx.lineTo(x + w + 8 / scale, y + inset);
                ctx.moveTo(x - 8 / scale, y + h - inset);
                ctx.lineTo(x + w + 8 / scale, y + h - inset);
                ctx.stroke();
                ctx.lineWidth = lw * 0.7;
                ctx.beginPath();
                ctx.moveTo(x, cy);
                ctx.lineTo(x + w, cy);
                ctx.stroke();
            } else {
                const cx = x + w / 2;
                const inset = Math.min(w * 0.25, 4 / scale);
                ctx.beginPath();
                ctx.moveTo(x + inset, y - 8 / scale);
                ctx.lineTo(x + inset, y + h + 8 / scale);
                ctx.moveTo(x + w - inset, y - 8 / scale);
                ctx.lineTo(x + w - inset, y + h + 8 / scale);
                ctx.stroke();
                ctx.lineWidth = lw * 0.7;
                ctx.beginPath();
                ctx.moveTo(cx, y);
                ctx.lineTo(cx, y + h);
                ctx.stroke();
            }
            ctx.restore();
        }

        // ----- POLYGON HELPERS -----
        function polygonArea(pts) {
            if (pts.length < 3) return 0;
            let area = 0;
            for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                area += pts[i].x * pts[j].y;
                area -= pts[j].x * pts[i].y;
            }
            return Math.abs(area) / 2;
        }

        function polygonBounds(pts) {
            if (pts.length === 0) return null;
            let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
            pts.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }

        /** True if a polygon element is just a plain 4-corner box matching its bounds
         *  (i.e. drawn as a rectangle) — these should get corner/edge "zoom" resize
         *  handles like AI-detected elements, instead of single-vertex dragging. */
        function isRectangleShape(el) {
            if (!el || !el.vertices || el.vertices.length !== 4) return false;
            const w = Number(el.w) || 0, h = Number(el.h) || 0;
            if (w <= 0 || h <= 0) return false;
            const corners = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
            const tol = Math.max(0.75, Math.min(w, h) * 0.03);
            return el.vertices.every(v => corners.some(c => Math.hypot(v.x - c.x, v.y - c.y) <= tol));
        }

        /** Ensure slab/column (and other area polygons) have relative vertices so
         *  shape editing works the same as for polygon-drawn columns: gold size
         *  handles + green vertex handles. AI/box elements often lack vertices. */
        function ensureElementVertices(el) {
            if (!el || el.isLine) return;
            if (el.vertices && el.vertices.length >= 3) return;
            const w = Number(el.w) || 0, h = Number(el.h) || 0;
            if (w <= 0 || h <= 0) return;
            el.vertices = [
                { x: 0, y: 0 },
                { x: w, y: 0 },
                { x: w, y: h },
                { x: 0, y: h }
            ];
        }

        function polygonCentroid(pts) {
            if (pts.length === 0) return { x: 0, y: 0 };
            let cx = 0,
                cy = 0;
            pts.forEach(p => { cx += p.x;
                cy += p.y; });
            return { x: cx / pts.length, y: cy / pts.length };
        }

        /** Point-in-polygon (ray cast). pts are absolute world coords. */
        function pointInPolygon(px, py, pts) {
            if (!pts || pts.length < 3) return false;
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const xi = pts[i].x, yi = pts[i].y;
                const xj = pts[j].x, yj = pts[j].y;
                if (((yi > py) !== (yj > py)) &&
                    (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        /** Absolute world vertices for a polygon/box element. */
        function elementWorldPoints(el) {
            if (!el) return null;
            if (el.isLine && el.p1 && el.p2) return [el.p1, el.p2];
            if (Array.isArray(el.vertices) && el.vertices.length >= 3) {
                return el.vertices.map(function (v) {
                    return { x: (el.x || 0) + (v.x || 0), y: (el.y || 0) + (v.y || 0) };
                });
            }
            const x = el.x || 0, y = el.y || 0;
            const w = el.w || 0, h = el.h || 0;
            if (w <= 0 || h <= 0) return null;
            return [
                { x: x, y: y },
                { x: x + w, y: y },
                { x: x + w, y: y + h },
                { x: x, y: y + h }
            ];
        }

        /**
         * Resolve host for a polygon cutout/opening.
         * Accepts wall, beam, slab, column (and selected/locked parent as fallback).
         * Scores candidates by containment of cutout centroid, then by plan overlap.
         */
        function findCutoutParent(pts, cutoutBounds) {
            const hosts = (elements || []).filter(function (e) {
                if (!e || e.hidden) return false;
                if (e.isDeduction || e.type === 'cutout' || e.type === 'opening' || e.type === 'door' || e.type === 'window') return false;
                return e.type === 'wall' || e.type === 'beam' || e.type === 'slab' || e.type === 'column';
            });
            if (!hosts.length) return null;

            const cx = pts.reduce(function (s, p) { return s + p.x; }, 0) / pts.length;
            const cy = pts.reduce(function (s, p) { return s + p.y; }, 0) / pts.length;
            const cutBox = cutoutBounds || polygonBounds(pts);

            let best = null;
            let bestScore = -1;

            function consider(e, score) {
                if (score > bestScore) {
                    bestScore = score;
                    best = e;
                }
            }

            hosts.forEach(function (e) {
                // ---- Line wall / beam: distance from centroid to segment ----
                if (e.isLine && e.p1 && e.p2) {
                    const ax = e.p1.x, ay = e.p1.y, bx = e.p2.x, by = e.p2.y;
                    const abx = bx - ax, aby = by - ay;
                    const len2 = abx * abx + aby * aby || 1;
                    let t = ((cx - ax) * abx + (cy - ay) * aby) / len2;
                    t = Math.max(0, Math.min(1, t));
                    const px = ax + t * abx, py = ay + t * aby;
                    let half = 8;
                    try {
                        if (typeof getLineThicknessDraw === 'function') half = getLineThicknessDraw(e) / 2;
                        else if (typeof e.thicknessDraw === 'number') half = e.thicknessDraw / 2;
                    } catch (_) {}
                    // Generous hit tolerance (screen-space padding + thickness)
                    const tol = half + Math.max(12, 14 / (viewport.scale || 1));
                    const dist = Math.hypot(cx - px, cy - py);
                    if (dist <= tol) {
                        // Higher score when closer to centerline
                        consider(e, 1000 - dist);
                    }
                    return;
                }

                // ---- Area hosts: slab / column / box wall ----
                const worldPts = elementWorldPoints(e);
                if (worldPts && worldPts.length >= 3 && pointInPolygon(cx, cy, worldPts)) {
                    // Prefer smaller hosts that tightly contain the cutout (e.g. room slab over whole floor)
                    const hostArea = polygonArea(worldPts) || 1;
                    consider(e, 500 + 1 / hostArea);
                    return;
                }
                // AABB / overlap fallback
                if (cutBox && e.w > 0 && e.h > 0) {
                    const oa = overlapArea(
                        { x: cutBox.x, y: cutBox.y, w: cutBox.w, h: cutBox.h },
                        e
                    );
                    if (oa > 1e-6) {
                        const hostArea = (e.w || 1) * (e.h || 1);
                        consider(e, 100 + oa / hostArea);
                    }
                }
            });

            // Explicit Properties lock
            if (!best && typeof deductionTargetLocked !== 'undefined' && deductionTargetLocked &&
                pendingDeductionParentId != null) {
                const locked = findElementById(pendingDeductionParentId);
                if (locked && !locked.hidden &&
                    (locked.type === 'wall' || locked.type === 'beam' || locked.type === 'slab' || locked.type === 'column')) {
                    best = locked;
                }
            }
            // Selected structural element as last resort
            if (!best && selectedIds && selectedIds.length === 1) {
                const sel = findElementById(selectedIds[0]);
                if (sel && !sel.hidden &&
                    (sel.type === 'wall' || sel.type === 'beam' || sel.type === 'slab' || sel.type === 'column')) {
                    best = sel;
                }
            }
            return best;
        }

        function createPolygonElement(type, vertices, props = {}) {
            if (!vertices || vertices.length < 3) return null;
            const bounds = polygonBounds(vertices);
            // Cutouts/deductions on thin walls can be narrower than 1 drawing unit — allow small boxes
            const isCut = type === 'cutout' || type === 'opening' || type === 'deduction' || !!(props && props.isDeduction);
            const minSize = isCut ? 0.05 : 1;
            if (!bounds || bounds.w < minSize || bounds.h < minSize) return null;
            const extra = {};
            if (type === 'column') {
                extra.zHeight = 3.0;
                extra.label = `Column ${nextId}`;
            } else if (type === 'slab') {
                extra.label = `Slab ${nextId}`;
            } else {
                extra.label = `Cutout ${nextId}`;
            }
            const el = createElement(type, bounds.x, bounds.y, bounds.w, bounds.h, {
                vertices: vertices.map(v => ({ x: v.x - bounds.x, y: v.y - bounds.y })),
                ...extra,
                ...props
            });
            return el;
        }

        /**
         * Estimate wall thickness (metres) by sampling the underlay image
         * perpendicular to the centerline. Looks for dark/hatched pixels that
         * form the wall body on typical architectural PDFs.
         * Returns null if underlay/calibration unavailable or estimate is unreliable.
         */
        function estimateWallThicknessFromUnderlay(p1, p2) {
            try {
                if (!backgroundImage || !backgroundImage.complete || !calibrationFactor || calibrationFactor <= 0) return null;
                if (!p1 || !p2) return null;
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy);
                if (len < 1e-3) return null;
                const ux = dx / len, uy = dy / len;
                const nx = -uy, ny = ux; // unit normal

                // Sample at 3 stations along the segment (25%, 50%, 75%)
                const stations = [0.25, 0.5, 0.75];
                // Max search radius ~400 mm in drawing units
                const maxSearchM = 0.40;
                const maxSearchDu = maxSearchM / calibrationFactor;
                const stepDu = Math.max(0.5, (0.005 / calibrationFactor)); // ~5 mm steps

                // Offscreen sample from underlay
                const iw = backgroundImage.naturalWidth || backgroundImage.width;
                const ih = backgroundImage.naturalHeight || backgroundImage.height;
                if (!(iw > 0 && ih > 0)) return null;
                // Map drawing coords → image pixels (underlay drawn at 0,0 in world with image size)
                // In this app, background is placed with world coords matching image pixel space
                // when first loaded; after calibrate, drawing units stay and CF converts to metres.
                const off = document.createElement('canvas');
                off.width = iw;
                off.height = ih;
                const octx = off.getContext('2d', { willReadFrequently: true });
                if (!octx) return null;
                octx.drawImage(backgroundImage, 0, 0);
                const imgData = octx.getImageData(0, 0, iw, ih);
                const data = imgData.data;

                function isWallPixel(px, py) {
                    const x = Math.round(px), y = Math.round(py);
                    if (x < 0 || y < 0 || x >= iw || y >= ih) return false;
                    const i = (y * iw + x) * 4;
                    const r = data[i], g = data[i + 1], b = data[i + 2];
                    // Dark / grey hatch or solid wall (not white background)
                    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                    return lum < 200; // ink/hatch threshold
                }

                const widths = [];
                stations.forEach(function (t) {
                    const cx = p1.x + ux * len * t;
                    const cy = p1.y + uy * len * t;
                    // Walk both sides from center until non-wall, measure total width
                    let neg = 0, pos = 0;
                    for (let s = 0; s <= maxSearchDu; s += stepDu) {
                        if (isWallPixel(cx - nx * s, cy - ny * s)) neg = s;
                        else if (s > stepDu * 2) break;
                    }
                    for (let s = 0; s <= maxSearchDu; s += stepDu) {
                        if (isWallPixel(cx + nx * s, cy + ny * s)) pos = s;
                        else if (s > stepDu * 2) break;
                    }
                    const wDu = neg + pos;
                    if (wDu > stepDu) widths.push(wDu);
                });
                if (widths.length < 2) return null;
                widths.sort(function (a, b) { return a - b; });
                const med = widths[Math.floor(widths.length / 2)];
                const thkM = med * calibrationFactor;
                // Realistic wall range
                if (thkM < 0.07 || thkM > 0.50) return null;
                return thkM;
            } catch (err) {
                return null;
            }
        }

        // Create a single angled wall/beam from two endpoints
        function createLineElement(type, p1, p2, thickness) {
            let thk = thickness;
            if (type === 'wall' && (thk == null || thk === DEFAULT_WALL_THICKNESS_M)) {
                const estimated = estimateWallThicknessFromUnderlay(p1, p2);
                if (estimated != null) thk = estimated;
            }
            if (thk == null || !(thk > 0)) {
                thk = type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
            }
            const thkDraw = toDrawing(thk);
            const dx = p2.x - p1.x,
                dy = p2.y - p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 0.5) return null;
            const angle = Math.atan2(dy, dx);
            const nx = -Math.sin(angle),
                ny = Math.cos(angle);
            const half = thkDraw / 2;
            const corners = [
                { x: p1.x + nx * half, y: p1.y + ny * half },
                { x: p1.x - nx * half, y: p1.y - ny * half },
                { x: p2.x + nx * half, y: p2.y + ny * half },
                { x: p2.x - nx * half, y: p2.y - ny * half },
            ];
            let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
            corners.forEach(c => {
                if (c.x < minX) minX = c.x;
                if (c.x > maxX) maxX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.y > maxY) maxY = c.y;
            });
            const el = createElement(type, minX, minY, Math.max(maxX - minX, 1), Math.max(maxY - minY, 1), {
                label: type === 'beam' ? `Beam ${nextId}` : `Wall ${nextId}`,
                thickness: thk,
                thicknessDraw: clampThicknessDraw(thkDraw),
                zHeight: type === 'beam' ? 0.30 : 3.0,
                isLine: true,
                p1: { x: p1.x, y: p1.y },
                p2: { x: p2.x, y: p2.y },
                angle: angle,
                length: len,
            });
            if (type === 'wall' && typeof standardizeWallThickness === 'function') {
                standardizeWallThickness(el);
            }
            return el;
        }

        function syncLineBounds(el) {
            if (!el || !el.p1 || !el.p2) return;
            const thkDraw = getLineThicknessDraw(el);
            const dx = el.p2.x - el.p1.x,
                dy = el.p2.y - el.p1.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            el.angle = Math.atan2(dy, dx);
            el.length = len;
            const nx = -Math.sin(el.angle),
                ny = Math.cos(el.angle);
            const half = thkDraw / 2;
            const corners = [
                { x: el.p1.x + nx * half, y: el.p1.y + ny * half },
                { x: el.p1.x - nx * half, y: el.p1.y - ny * half },
                { x: el.p2.x + nx * half, y: el.p2.y + ny * half },
                { x: el.p2.x - nx * half, y: el.p2.y - ny * half },
            ];
            let minX = Infinity,
                minY = Infinity,
                maxX = -Infinity,
                maxY = -Infinity;
            corners.forEach(c => {
                if (c.x < minX) minX = c.x;
                if (c.x > maxX) maxX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.y > maxY) maxY = c.y;
            });
            el.x = minX;
            el.y = minY;
            el.w = Math.max(maxX - minX, 1);
            el.h = Math.max(maxY - minY, 1);
        }

        // ---- Render polygon preview ----
        function drawPolygonPreview(ctx, pts, scale) {
            if (pts.length === 0) return;
            ctx.save();

            if (pts.length >= 3) {
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) {
                    ctx.lineTo(pts[i].x, pts[i].y);
                }
                if (isPolygonClosed || pts.length >= 3) {
                    ctx.closePath();
                }
                ctx.fillStyle = 'rgba(0,122,255,0.10)';
                ctx.fill();
                ctx.strokeStyle = '#B8863B';
                ctx.lineWidth = 2.5 / scale;
                ctx.setLineDash([8 / scale, 4 / scale]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            for (let i = 0; i < pts.length - 1; i++) {
                ctx.beginPath();
                ctx.moveTo(pts[i].x, pts[i].y);
                ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
                ctx.strokeStyle = '#B8863B';
                ctx.lineWidth = 2 / scale;
                ctx.stroke();
            }

            if (polygonTempLine && !isPolygonClosed) {
                ctx.beginPath();
                ctx.moveTo(polygonTempLine.x1, polygonTempLine.y1);
                ctx.lineTo(polygonTempLine.x2, polygonTempLine.y2);
                ctx.strokeStyle = '#B8863B';
                ctx.lineWidth = 1.5 / scale;
                ctx.setLineDash([6 / scale, 4 / scale]);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            pts.forEach((p, idx) => {
                ctx.fillStyle = idx === 0 && pts.length > 2 ? '#34c759' : '#B8863B';
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 2 / scale;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 6 / scale;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 5 / scale, 0, 2 * Math.PI);
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.stroke();
                ctx.fillStyle = '#fff';
                ctx.font = `${10 / scale}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(idx + 1, p.x, p.y - 8 / scale);
            });

            if (isPolygonClosed && pts.length >= 3) {
                const area = polygonArea(pts);
                const areaM2 = area * calibrationFactor * calibrationFactor;
                const centroid = polygonCentroid(pts);
                ctx.fillStyle = 'rgba(0,122,255,0.92)';
                ctx.font = `bold ${12 / scale}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const label = `Area: ${areaM2.toFixed(2)} m²`;
                const tw = ctx.measureText(label).width;
                const pad = 8 / scale;
                const bh = 20 / scale;
                const lx = centroid.x - tw / 2 - pad;
                const ly = centroid.y - bh / 2;
                ctx.beginPath();
                ctx.roundRect(lx, ly, tw + pad * 2, bh, 4 / scale);
                ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillText(label, centroid.x, centroid.y);
            }

            ctx.restore();
        }

        // ---- Draw deduction line preview (yellow/rose) ----
        function drawDeductionLinePreview(ctx, pts, scale, color) {
            if (pts.length < 1) return;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = 4 / scale;
            ctx.setLineDash([]);
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 8 / scale;
            if (pts.length === 1) {
                ctx.beginPath();
                ctx.arc(pts[0].x, pts[0].y, 6 / scale, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.shadowBlur = 0;
                ctx.stroke();
            } else if (pts.length >= 2) {
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                ctx.lineTo(pts[1].x, pts[1].y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.fillStyle = color;
                pts.forEach(p => {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 5 / scale, 0, 2 * Math.PI);
                    ctx.fill();
                });
                const len = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
                const lenM = toMeters(len);
                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                ctx.fillStyle = color;
                ctx.font = `bold ${11/scale}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(`${lenM.toFixed(2)} m`, midX, midY - 8 / scale);
            }
            ctx.restore();
        }

        // ----- Helper: nearest point on segment -----
        function nearestPointOnSegment(px, py, ax, ay, bx, by) {
            const abx = bx - ax,
                aby = by - ay;
            const len2 = abx * abx + aby * aby;
            if (len2 === 0) return { x: ax, y: ay, t: 0 };
            let t = ((px - ax) * abx + (py - ay) * aby) / len2;
            t = Math.max(0, Math.min(1, t));
            return { x: ax + t * abx, y: ay + t * aby, t: t };
        }

        /** Opening sill above FFL (m). Windows default 0.9 m; doors/openings default 0. */
        function getOpeningSillM(el) {
            if (!el) return 0;
            if (typeof el.sillHeight === 'number' && isFinite(el.sillHeight) && el.sillHeight >= 0) {
                return el.sillHeight;
            }
            const ot = el.openingType || el.type;
            if (ot === 'window' || el.type === 'window') return 0.9;
            return 0;
        }

        /** Opening clear height (m). */
        function getOpeningHeightM(el) {
            if (!el) return 2.1;
            if (typeof el.zHeight === 'number' && isFinite(el.zHeight) && el.zHeight > 0) {
                return el.zHeight;
            }
            const ot = el.openingType || el.type;
            if (ot === 'window' || el.type === 'window') return 1.2;
            return 2.1;
        }

        /** True if world point hits element geometry (with small screen-pixel tolerance). */
        function elementHitsPoint(el, world) {
            if (!el || el.hidden) return false;
            const tol = 6 / Math.max(viewport.scale || 1, 0.001);
            if (el.isLine && el.p1 && el.p2) {
                const np = nearestPointOnSegment(world.x, world.y, el.p1.x, el.p1.y, el.p2.x, el.p2.y);
                const thk = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(el) : 0) / 2 + tol;
                return Math.hypot(world.x - np.x, world.y - np.y) <= thk;
            }
            if (el.vertices && el.vertices.length >= 3) {
                // Point-in-polygon (ray cast) with edge tolerance
                const pts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                let inside = false;
                for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
                    const np = nearestPointOnSegment(world.x, world.y, xi, yi, xj, yj);
                    if (Math.hypot(world.x - np.x, world.y - np.y) <= tol) return true;
                    const intersect = ((yi > world.y) !== (yj > world.y)) &&
                        (world.x < (xj - xi) * (world.y - yi) / ((yj - yi) || 1e-12) + xi);
                    if (intersect) inside = !inside;
                }
                return inside;
            }
            if (el.w != null && el.h != null) {
                return world.x >= el.x - tol && world.x <= el.x + el.w + tol &&
                    world.y >= el.y - tol && world.y <= el.y + el.h + tol;
            }
            return false;
        }

        /**
         * All elements under a world point, top-most first (reverse of array order).
         * Used for overlap detection and Ctrl+click cycling.
         */
        function hitTestAllElements(world) {
            const hits = [];
            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                if (elementHitsPoint(el, world)) hits.push(el);
            }
            return hits;
        }

        /** Axis-aligned bounds overlap (with small pad) — for drawing overlap cues. */
        function elementsAabbOverlap(a, b, pad) {
            pad = pad || 0;
            const ax0 = a.isLine ? Math.min(a.p1.x, a.p2.x) - pad : a.x - pad;
            const ay0 = a.isLine ? Math.min(a.p1.y, a.p2.y) - pad : a.y - pad;
            const ax1 = a.isLine ? Math.max(a.p1.x, a.p2.x) + pad : a.x + (a.w || 0) + pad;
            const ay1 = a.isLine ? Math.max(a.p1.y, a.p2.y) + pad : a.y + (a.h || 0) + pad;
            const bx0 = b.isLine ? Math.min(b.p1.x, b.p2.x) - pad : b.x - pad;
            const by0 = b.isLine ? Math.min(b.p1.y, b.p2.y) - pad : b.y - pad;
            const bx1 = b.isLine ? Math.max(b.p1.x, b.p2.x) + pad : b.x + (b.w || 0) + pad;
            const by1 = b.isLine ? Math.max(b.p1.y, b.p2.y) + pad : b.y + (b.h || 0) + pad;
            return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
        }

        /** Set of element ids that spatially overlap at least one other visible element. */
        function computeOverlappingElementIds() {
            const vis = elements.filter(el => !el.hidden);
            const ids = new Set();
            for (let i = 0; i < vis.length; i++) {
                for (let j = i + 1; j < vis.length; j++) {
                    if (elementsAabbOverlap(vis[i], vis[j], 2 / Math.max(viewport.scale || 1, 0.001))) {
                        ids.add(vis[i].id);
                        ids.add(vis[j].id);
                    }
                }
            }
            return ids;
        }

        // ----- PRE-UPLOAD WORKSPACE LOCK -----
        // Keep the empty workspace safe and focused: only Import can be used until
        // a valid PDF/image underlay has finished loading.
        function setPreUploadControlsLocked(locked) {
            const controls = document.querySelectorAll('button, a, input, select, textarea');
            controls.forEach(function (el) {
                const isImport = el.id === 'btnUploadDrawing' || el.id === 'drawingFileInput';
                const isProjectFileInput = el.id === 'fileInput';
                const isPreUploadAllowed = el.id === 'btnOpenSimple' ||
                    el.id === 'btnHelpShortcuts' ||
                    (el.tagName === 'A' && el.getAttribute('href') === 'mode-select.html');
                if (isImport || isProjectFileInput || isPreUploadAllowed) return;
                if (el.tagName === 'A') {
                    el.setAttribute('aria-disabled', locked ? 'true' : 'false');
                    el.style.pointerEvents = locked ? 'none' : '';
                    el.style.opacity = locked ? '0.45' : '';
                    return;
                }
                el.disabled = !!locked;
            });
            document.body.classList.toggle('pre-upload-locked', !!locked);
            const importBtn = document.getElementById('btnUploadDrawing');
            if (importBtn) {
                importBtn.disabled = false;
                importBtn.setAttribute('aria-label', locked ? 'Import a PDF or drawing to begin' : 'Import drawing');
            }
        }

        // ----- AXIS SNAP FOR LINE/POLYGON DRAWING -----
        // Wall, Beam, Column, and Slab align only when very close to an axis.
        // Alt still provides an escape hatch for intentionally angled geometry.
        let axisSnapKind = null;
        function snapAxisPoint(start, point, event) {
            axisSnapKind = null;
            if (!start || !point || (event && event.altKey)) return point;
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            const ax = Math.abs(dx);
            const ay = Math.abs(dy);
            const minLength = 8 / Math.max((viewport && viewport.scale) || 1, 0.01);
            if (Math.max(ax, ay) < minLength) return point;
            // Ultra-tight tolerance: align only when within 1° of an axis.
            const tolerance = Math.tan(1 * Math.PI / 180);
            if (ax >= ay && ay <= ax * tolerance) {
                axisSnapKind = 'horizontal';
                return { x: point.x, y: start.y };
            }
            if (ay > ax && ax <= ay * tolerance) {
                axisSnapKind = 'vertical';
                return { x: start.x, y: point.y };
            }
            return point;
        }

        // ----- RENDER CANVAS 2D -----
        function loadBackgroundFromSrc(src, opts) {
            opts = opts || {};
            const img = new Image();
            img.onload = function() {
                setPreUploadControlsLocked(false);
                backgroundImage = {
                    img: img,
                    src: src,
                    w: opts.w || img.naturalWidth,
                    h: opts.h || img.naturalHeight,
                    opacity: opts.opacity != null ? opts.opacity : 1.0,
                    visible: opts.visible != null ? opts.visible : true,
                };
                const bgControls = document.getElementById('bgControls');
                const bgOpacitySlider = document.getElementById('bgOpacity');
                const bgToggleBtn = document.getElementById('btnBgToggle');
                bgControls.style.display = 'flex';
                bgOpacitySlider.value = Math.round(backgroundImage.opacity * 100);
                const valDisplay = document.getElementById('bgOpacityValue');
                if (valDisplay) valDisplay.textContent = bgOpacitySlider.value + '%';
                bgToggleBtn.innerHTML = backgroundImage.visible ?
                    '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
                markWorkSession();
                // Fit drawing to the full viewer (centered). Retry after layout settles.
                try {
                    fitViewportWhenReady();
                } catch (err) {
                    console.warn('fit underlay failed', err);
                    try { fitViewportToContent(); } catch (_) {}
                }
                renderCanvas2D();
                // Research: register drawing once per load (original preserved server-side)
                try {
                    if (window.MCResearch && MCResearch.getParticipantId() && !opts.skipResearch) {
                        MCResearch.ensureMode('pro');
                        MCResearch.ensureParticipantChip('#status-bar') || MCResearch.ensureParticipantChip('#statusBar') || MCResearch.ensureParticipantChip('body');
                        MCResearch.registerDrawing({
                            fileName: (opts.fileName || backgroundImage.fileName || 'drawing.jpg'),
                            mimeType: (src && src.indexOf('image/png') >= 0) ? 'image/png' : 'image/jpeg',
                            imageBase64: (typeof src === 'string' && src.indexOf('data:') === 0) ? src : null,
                            projectName: (projectInfo && projectInfo.name) || 'Untitled Project',
                            scaleNote: (typeof calibrationFactor === 'number') ? ('1 unit = ' + calibrationFactor + ' m') : null,
                            mode: 'pro',
                            // New file import → new drawing; transfer uses skipResearch so not here
                            reuseExisting: opts.reuseExisting === true,
                        });
                    }
                } catch (_) {}
            };
            img.onerror = function() {
                alert('Could not load the drawing image.');
            };
            img.src = src;
        }

        function handleDrawingFile(file) {
            if (!file) return;
            // Match Simple Mode: reject huge files before they hang the tab / exceed API body limit
            const MAX_FILE_BYTES = 25 * 1024 * 1024;
            const name = file.name || 'drawing';
            const lower = name.toLowerCase();
            if (!/\.(pdf|png|jpe?g)$/i.test(lower) &&
                !/^image\/(png|jpeg)$/i.test(file.type || '') &&
                file.type !== 'application/pdf') {
                alert('Unsupported file type. Please upload a PDF, PNG, or JPG (max 25 MB).');
                return;
            }
            if (file.size > MAX_FILE_BYTES) {
                alert('File is too large (max 25 MB). Try a smaller or compressed PDF/image.');
                return;
            }
            const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
            if (isPdf) {
                if (typeof pdfjsLib === 'undefined') {
                    alert('PDF support did not load. Check your internet connection and try again.');
                    return;
                }
                pdfjsLib.GlobalWorkerOptions.workerSrc =
                    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
                bgLoading = true;
                const reader = new FileReader();
                reader.onload = function(ev) {
                    const typedArray = new Uint8Array(ev.target.result);
                    pdfjsLib.getDocument({
                        data: typedArray,
                        disableFontFace: false,
                        useSystemFonts: true,
                        isEvalSupported: false,
                    }).promise.then(function(pdf) {
                        let pageNum = 1;
                        if (pdf.numPages > 1) {
                            const input = prompt('This PDF has ' + pdf.numPages +
                                ' pages. Which page would you like to use as the drawing underlay?', '1');
                            const parsed = parseInt(input, 10);
                            if (parsed >= 1 && parsed <= pdf.numPages) pageNum = parsed;
                        }
                        return pdf.getPage(pageNum);
                    }).then(function(page) {
                        // High-res PDF render for sharp Pro ↔ Simple preview (print intent)
                        const base = page.getViewport({ scale: 1 });
                        const longEdge = Math.max(base.width, base.height);
                        const TARGET_LONG = 4800;
                        const MAX_LONG = 6400;
                        let renderScale = TARGET_LONG / Math.max(longEdge, 1);
                        renderScale = Math.max(2.0, Math.min(renderScale, MAX_LONG / Math.max(longEdge, 1)));
                        let viewportPdf = page.getViewport({ scale: renderScale });
                        const MAX_PIXELS = 28e6;
                        if (viewportPdf.width * viewportPdf.height > MAX_PIXELS) {
                            renderScale *= Math.sqrt(MAX_PIXELS / (viewportPdf.width * viewportPdf.height));
                            viewportPdf = page.getViewport({ scale: renderScale });
                        }
                        const offCanvas = document.createElement('canvas');
                        offCanvas.width = Math.floor(viewportPdf.width);
                        offCanvas.height = Math.floor(viewportPdf.height);
                        const offCtx = offCanvas.getContext('2d', { alpha: false });
                        offCtx.fillStyle = '#ffffff';
                        offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height);
                        offCtx.imageSmoothingEnabled = true;
                        offCtx.imageSmoothingQuality = 'high';
                        return page.render({
                            canvasContext: offCtx,
                            viewport: viewportPdf,
                            intent: 'print',
                        }).promise.then(function() {
                            // Prefer PNG for crisp linework when under ~10MP; else JPEG 0.97
                            let dataUrl;
                            if (offCanvas.width * offCanvas.height <= 10e6) {
                                try { dataUrl = offCanvas.toDataURL('image/png'); } catch (_) { dataUrl = null; }
                            }
                            if (!dataUrl) dataUrl = offCanvas.toDataURL('image/jpeg', 0.97);
                            // World size = rendered pixel size (NOT PDF points / renderScale).
                            // Both Pro and Simple must share the same coordinate system so
                            // calibrating the same two points on the same drawing yields the
                            // same CF ("1 unit = X m") in either mode. Using PDF points made
                            // Pro CF ≈ renderScale × Simple CF (often ~4×).
                            loadBackgroundFromSrc(dataUrl, {
                                w: offCanvas.width,
                                h: offCanvas.height,
                                fileName: name,
                            });
                        });
                    }).catch(function(err) {
                        alert('Could not read this PDF: ' + err.message);
                    }).finally(function() {
                        bgLoading = false;
                    });
                };
                reader.readAsArrayBuffer(file);
            } else {
                const reader = new FileReader();
                reader.onload = function(ev) {
                    loadBackgroundFromSrc(ev.target.result, {});
                };
                reader.readAsDataURL(file);
            }
        }

        // ----- AI DETECTION (via QS AI backend / Gemini) -----
        const AI_DETECT_TYPES = ['wall', 'column', 'slab', 'beam', 'door', 'window', 'deduction'];
        const AI_DETECT_LAYER = { wall: 'Structural', column: 'Structural', slab: 'Structural',
            beam: 'Structural', door: 'Architectural', window: 'Architectural', deduction: 'Architectural' };

        /**
         * Freeze the AI-proposed quantity for an element at the moment AI detects it
         * (before any QS edits/deductions). Stored on el.aiQty / el.aiUnit and never
         * touched again — this is what the research dashboard compares the QS's final
         * corrected quantity against (AI column, Δ, Δ%). Deliberately a simple gross
         * calculation (no deductions yet) since it represents the raw AI proposal.
         */
        function computeAiBaselineQty(el, cf) {
            try {
                if (!el || !(cf > 0)) return null;
                if (el.type === 'wall' || el.type === 'beam') {
                    const lengthM = (el.isLine && el.length != null ? el.length : Math.max(el.w, el.h)) * cf;
                    const vol = lengthM * (el.zHeight || (el.type === 'beam' ? 3.0 : 3.0)) * (el.thickness || DEFAULT_WALL_THICKNESS_M);
                    return { qty: Math.round(vol * 1000) / 1000, unit: 'm³' };
                }
                if (el.type === 'slab' || el.type === 'column') {
                    let planAreaDraw;
                    if (el.vertices && el.vertices.length >= 3) {
                        const absPts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                        planAreaDraw = polygonArea(absPts);
                    } else {
                        planAreaDraw = (el.w || 0) * (el.h || 0);
                    }
                    const areaM2 = planAreaDraw * cf * cf;
                    let thkOrH = el.zHeight;
                    if (typeof thkOrH !== 'number' || !isFinite(thkOrH) || thkOrH <= 0) {
                        thkOrH = (el.type === 'slab') ? 0.15 : 3.0;
                    }
                    const vol = areaM2 * thkOrH;
                    return { qty: Math.round(vol * 1000) / 1000, unit: 'm³' };
                }
                if (el.type === 'door' || el.type === 'window' || el.type === 'opening') {
                    return { qty: 1, unit: 'Nr' };
                }
            } catch (_) {}
            return null;
        }

        function setAiDetectBusy(busy, message) {
            const btn = document.getElementById('btnAiDetect');
            const loading = document.getElementById('loading');
            if (btn) {
                btn.disabled = busy;
                btn.classList.toggle('ai-busy', busy);
                btn.innerHTML = busy ?
                    '<i class="fas fa-spinner fa-spin"></i> Detecting…' :
                    '<i class="fas fa-robot"></i> AI Detect';
            }
            if (loading) {
                if (busy) { loading.textContent = message || 'Running AI detection…';
                    loading.classList.remove('hidden'); } else loading.classList.add('hidden');
            }
        }

        async function aiDetectElements() {
            if (isConfirmed) { alert('Unlock the takeoff (it is confirmed) before adding AI-detected elements.'); return; }
            if (!backgroundImage) { alert('Upload a drawing first (PDF/PNG/JPG) — AI Detect reads the uploaded underlay.'); return; }

            // AI proposals are additive and must never delete manual or QS-reviewed work.
            // Unreviewed proposals from an earlier run are retained for comparison/rejection.
            const existing = elements || [];
            const existingManual = existing.filter(function (el) { return el && isManualElement(el); });
            const existingReviewed = existing.filter(function (el) {
                return el && (el.reviewStatus === 'QS_REVIEWED' || el.reviewStatus === 'FINAL' || el.source === 'AI_EDITED');
            });
            const existingUnreviewedAi = existing.filter(function (el) {
                return el && isAiOriginElement(el) && !existingReviewed.includes(el);
            });
            if (existing.length > 0) {
                const msg = 'A new AI proposal set will be added without deleting existing work.\\n\\n' +
                    existingManual.length + ' manual measurement(s), ' +
                    existingReviewed.length + ' QS-reviewed item(s), and ' +
                    existingUnreviewedAi.length + ' unreviewed AI proposal(s) will be preserved.\\n\\n' +
                    'Review the new proposals and reject duplicates when needed. Continue?';
                if (!confirm(msg)) return;
            }

            const pixelW = backgroundImage.img.naturalWidth;
            const pixelH = backgroundImage.img.naturalHeight;
            const toWorldScale = backgroundImage.w / pixelW;

            // Keep enough resolution for small openings/columns (max edge 4096px)
            let sendW = pixelW, sendH = pixelH, sendBase64 = null, sendMime = 'image/jpeg';
            try {
                const maxEdge = 4096;
                const scale = Math.min(1, maxEdge / Math.max(pixelW, pixelH));
                sendW = Math.max(1, Math.round(pixelW * scale));
                sendH = Math.max(1, Math.round(pixelH * scale));
                const off = document.createElement('canvas');
                off.width = sendW;
                off.height = sendH;
                const octx = off.getContext('2d', { alpha: false });
                octx.fillStyle = '#ffffff';
                octx.fillRect(0, 0, sendW, sendH);
                octx.imageSmoothingEnabled = true;
                octx.imageSmoothingQuality = 'high';
                octx.drawImage(backgroundImage.img, 0, 0, sendW, sendH);
                const dataUrl = off.toDataURL('image/jpeg', 0.92);
                sendBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            } catch (e) {
                console.warn('Could not downscale underlay, sending original', e);
                const commaIdx = backgroundImage.src.indexOf(',');
                sendBase64 = commaIdx >= 0 ? backgroundImage.src.slice(commaIdx + 1) : backgroundImage.src;
                sendMime = backgroundImage.src.indexOf(';') > 0
                    ? (backgroundImage.src.slice(5, backgroundImage.src.indexOf(';')) || 'image/png')
                    : 'image/png';
                sendW = pixelW;
                sendH = pixelH;
            }
            // Map boxes from sent image coords back to full-res pixel coords
            const scaleBackX = pixelW / sendW;
            const scaleBackY = pixelH / sendH;

            setAiDetectBusy(true, 'Sending drawing to Gemini for element detection…');
            try {
                const response = await fetch('/api/detect-elements', {
                    method: 'POST',
                    headers: mcApiHeaders(true),
                    body: JSON.stringify({
                        image_base64: sendBase64,
                        mime_type: sendMime,
                        pixel_w: sendW,
                        pixel_h: sendH,
                        mode: 'tiled',
                        tile_grid: 2,
                        tile_overlap: 0.2
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data.success) {
                    const msg = (data && data.error) ? data.error : ('HTTP ' + response.status);
                    if (response.status === 429 || (data && data.code === 'QUOTA_EXCEEDED')) {
                        alert(
                            'Gemini quota exceeded (free tier limit).\n\n' +
                            'Wait ~1 minute and try again, or in backend/.env set a different model, e.g.\n' +
                            'GEMINI_MODEL=gemini-3.5-flash\n' +
                            'or enable billing / use a key with higher limits in Google AI Studio.\n\n' +
                            msg.slice(0, 280)
                        );
                    } else if (data && data.code === 'QUALITY_GATE') {
                        alert('Drawing quality check failed:\n\n' + msg +
                            '\n\nPlease upload a clearer, higher-resolution plan (recommended ≥ 800×800 px).');
                    } else {
                        alert('AI detection failed: ' + msg);
                    }
                    return;
                }
                if (data.quality && data.quality.warnings && data.quality.warnings.length) {
                    console.warn('AI quality warnings:', data.quality.warnings);
                    try {
                        if (typeof showToast === 'function') showToast('Quality note: ' + data.quality.warnings[0], 'warn');
                    } catch (_) {}
                }
                const detected = data.elements || [];
                if (!Array.isArray(detected) || detected.length === 0) {
                    alert(
                        'AI ran successfully but found no elements it could box on this drawing.\n\n' +
                        'This can happen on very dense plans or if the underlay is blurry. ' +
                        'You can still measure manually: Calibrate → draw walls/slabs → review Live Quantities.'
                    );
                    return;
                }
                // Scale detections from downscaled image back to original pixel space
                detected.forEach(item => {
                    if (typeof item.x === 'number') item.x *= scaleBackX;
                    if (typeof item.y === 'number') item.y *= scaleBackY;
                    if (typeof item.w === 'number') item.w *= scaleBackX;
                    if (typeof item.h === 'number') item.h *= scaleBackY;
                });

                saveState();
                const newEls = [];
                detected.forEach(item => {
                    if (typeof item.x !== 'number' || typeof item.y !== 'number' ||
                        typeof item.w !== 'number' || typeof item.h !== 'number') return;
                    // Normalize type: "room" → slab; unknown → wall only if thin, else slab
                    let rawType = String(item.type || '').toLowerCase();
                    if (rawType === 'room' || rawType === 'area' || rawType === 'floor') rawType = 'slab';
                    let type = AI_DETECT_TYPES.includes(rawType) ? rawType : null;

                    const wx = item.x * toWorldScale;
                    const wy = item.y * toWorldScale;
                    const ww = Math.max(item.w * toWorldScale, 1);
                    const wh = Math.max(item.h * toWorldScale, 1);
                    const aspect = Math.max(ww, wh) / Math.max(1, Math.min(ww, wh));
                    const shortSide = Math.min(ww, wh);
                    const longSide = Math.max(ww, wh);

                    // Heuristic: large square-ish / medium boxes are floors (slab), not walls
                    if (!type || type === 'wall') {
                        if (aspect < 3.0 && longSide > 50) {
                            // Looks like a room/floor plate — treat as slab
                            type = 'slab';
                        } else if (aspect >= 3.0) {
                            type = type || 'wall';
                        } else if (longSide < 25) {
                            type = 'column';
                        } else if (aspect < 2.0 && longSide > 30) {
                            type = 'slab';
                        } else {
                            type = type || 'wall';
                        }
                    }

                    const label = item.label || (type.charAt(0).toUpperCase() + type.slice(1));
                    const confidence = Number(item.confidence);
                    const baseProps = {
                        ai: true,
                        source: 'AI',
                        reviewStatus: 'AI_GENERATED',
                        reviewedAt: null,
                        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence > 1 ? confidence / 100 : confidence)) : null,
                        layer: AI_DETECT_LAYER[type] || 'Structural',
                        label: label
                    };

                    // Walls / beams → continuous centerline segments.
                    // CRITICAL: el.thickness is stored in METRES (renderer does toDrawing(thickness)).
                    // Never store pixel/drawing shortSide as thickness — that becomes giant bubbles after calibrate.
                    if (type === 'wall' || type === 'beam') {
                        let p1, p2;
                        if (ww >= wh) {
                            p1 = { x: wx, y: wy + wh / 2 };
                            p2 = { x: wx + ww, y: wy + wh / 2 };
                        } else {
                            p1 = { x: wx + ww / 2, y: wy };
                            p2 = { x: wx + ww / 2, y: wy + wh };
                        }
                        // Prefer measured short side in metres only if realistic; else typical defaults.
                        // Then standardize wall thickness (e.g. 159 mm → 150 mm block).
                        let thicknessM = type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
                        if (typeof item.thickness === 'number' && item.thickness >= 0.08 && item.thickness <= 0.55) {
                            thicknessM = item.thickness;
                        } else if (calibrationFactor && calibrationFactor > 0) {
                            const shortSideDu = Math.min(ww, wh);
                            const shortM = shortSideDu * calibrationFactor;
                            if (shortM >= 0.08 && shortM <= 0.55) thicknessM = shortM;
                        }
                        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                        if (len >= 1e-6) {
                            const thkDraw = toDrawing(thicknessM);
                            const el = createElement(type, Math.min(p1.x, p2.x), Math.min(p1.y, p2.y),
                                Math.abs(p2.x - p1.x) || thkDraw, Math.abs(p2.y - p1.y) || thkDraw, {
                                    ...baseProps,
                                    isLine: true,
                                    p1, p2,
                                    length: len,
                                    thickness: thicknessM,
                                    thicknessDraw: clampThicknessDraw(toDrawing(thicknessM)),
                                    angle: Math.atan2(p2.y - p1.y, p2.x - p1.x)
                                });
                            if (typeof item.height === 'number' && item.height > 0) el.zHeight = item.height;
                            if (type === 'wall') standardizeWallThickness(el);
                            newEls.push(el);
                        }
                    } else {
                        const el = createElement(type, wx, wy, ww, wh, baseProps);
                        if (typeof item.height === 'number' && item.height > 0) {
                            // For slabs, only keep height if it looks like thickness (mm-scale)
                            if (type === 'slab') {
                                if (item.height >= 0.08 && item.height <= 0.40) el.zHeight = item.height;
                                // else keep DEFAULT_SLAB_THICKNESS_M from createElement
                            } else {
                                el.zHeight = item.height;
                            }
                        }
                        // Give slab/column rectangle vertices so shape editing matches drawn polygons
                        if (type === 'slab' || type === 'column') ensureElementVertices(el);
                        newEls.push(el);
                    }
                });
                if (newEls.length === 0) {
                    alert('AI responded, but none of the detected shapes had usable coordinates.');
                    return;
                }
                // Freeze each element's AI-proposed quantity now, before the QS edits it —
                // this is the baseline the research dashboard's AI/Δ/Δ% columns compare against.
                newEls.forEach(function (el) {
                    const snap = computeAiBaselineQty(el, calibrationFactor);
                    if (snap) { el.aiQty = snap.qty; el.aiUnit = snap.unit; }
                });
                elements.push(...newEls);
                // Do not multi-select all AI elements (creates heavy blue glow / bubble effect)
                selectedIds = newEls.length ? [newEls[0].id] : [];
                // Ensure plan view shows all layers after AI (manual draws use Structural/Architectural)
                currentLayer = 'All';
                try {
                    document.querySelectorAll('[data-layer]').forEach(function (btn) {
                        btn.classList.toggle('active', btn.dataset.layer === 'All');
                    });
                } catch (_) {}
                window.mcAiFromSimple = false;
                try { saveState(); } catch (_) {}
                renderAll();
                try {
                    if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                        newEls.forEach(function (el) {
                            MCResearch.notifyElementChange('detect', el, { mode: 'pro' });
                        });
                    }
                } catch (_) {}
                // AI Review: Accept All / Review / Reject All (no fake confidence scores)
                try {
                    openAiReviewModal(newEls.map(function (e) { return e.id; }), detected);
                } catch (reviewErr) {
                    console.warn('AI review UI failed', reviewErr);
                    alert('AI detected ' + newEls.length + ' element(s). Review and adjust them — AI takeoffs can miss or misjudge details.');
                }
            } catch (err) {
                alert('AI detection failed: ' + err.message);
            } finally {
                setAiDetectBusy(false);
            }
        }

        // ----- AI REVIEW (Accept / Reject / Review) -----
        let _aiReviewIds = [];
        let _aiReviewRejected = new Set();

        function closeAiReviewModal() {
            const m = document.getElementById('aiReviewModal');
            if (m) {
                m.classList.remove('open', 'reviewing');
            }
            _aiReviewIds = [];
            _aiReviewRejected = new Set();
        }

        function openAiReviewModal(ids, rawDetected) {
            _aiReviewIds = (ids || []).slice();
            _aiReviewRejected = new Set();
            const modal = document.getElementById('aiReviewModal');
            if (!modal) {
                alert('AI detected ' + _aiReviewIds.length + ' element(s). Review them in the tree and on the plan.');
                return;
            }
            const counts = {};
            _aiReviewIds.forEach(function (id) {
                const el = elements.find(function (e) { return e.id === id; });
                if (!el) return;
                counts[el.type] = (counts[el.type] || 0) + 1;
            });
            const countEl = document.getElementById('aiReviewCounts');
            if (countEl) {
                let chips = '<span class="ai-count-chip"><strong>Total</strong> ' + _aiReviewIds.length + '</span>';
                Object.keys(counts).sort().forEach(function (t) {
                    chips += '<span class="ai-count-chip">' + t + ': ' + counts[t] + '</span>';
                });
                countEl.innerHTML = chips;
            }
            const lowConfidenceCount = _aiReviewIds.filter(function (id) {
                const el = elements.find(function (e) { return e.id === id; });
                const pct = getConfidencePercent(el);
                return pct != null && pct < 70;
            }).length;
            const sum = document.getElementById('aiReviewSummary');
            if (sum) {
                sum.textContent = 'AI detected ' + _aiReviewIds.length +
                    ' element(s). Accepting marks QS reviewed; rejecting removes it. Confidence is a triage aid only (not accuracy).' +
                    (lowConfidenceCount ? ' ' + lowConfidenceCount + ' item(s) are below 70% and deserve closer checking.' : '');
            }
            // Build list with confidence bands and explicit provenance.
            const list = document.getElementById('aiReviewList');
            if (list) {
                let html = '';
                _aiReviewIds.forEach(function (id, idx) {
                    const el = elements.find(function (e) { return e.id === id; });
                    if (!el) return;
                    const pct = getConfidencePercent(el);
                    let bandLabel = '—', bandColor = '#94a3b8';
                    if (pct != null) {
                        if (pct >= 90) { bandLabel = pct + '% High'; bandColor = '#16a34a'; }
                        else if (pct >= 70) { bandLabel = pct + '% Review'; bandColor = '#d97706'; }
                        else { bandLabel = pct + '% Check'; bandColor = '#dc2626'; }
                    }
                    const statusText = getReviewLabel(el);
                    html += '<div class="ai-review-item" data-id="' + id + '">' +
                        '<span class="color-dot" style="width:10px;height:10px;border-radius:50%;background:' + escapeHtml(String(el.color || '#888')) + ';display:inline-block;"></span>' +
                        '<div class="grow"><strong>' + escapeHtml(String(el.label || el.type || '')) + '</strong>' +
                        '<div style="font-size:11px;color:var(--text-secondary);">' + escapeHtml(String(el.type || '')) + ' · ' + escapeHtml(statusText) + '</div>' +
                        '<div style="margin-top:3px;"><span style="display:inline-block;padding:2px 7px;border-radius:999px;font-size:11px;font-weight:600;color:#fff;background:' + bandColor + '">' + bandLabel + '</span></div></div>' +
                        '<button type="button" class="accept" data-act="accept" data-id="' + id + '">Mark QS reviewed</button>' +
                        '<button type="button" class="reject" data-act="reject" data-id="' + id + '">Reject</button>' +
                        '</div>';
                });
                list.innerHTML = html;
                list.querySelectorAll('button').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const id = parseInt(btn.dataset.id, 10);
                        const act = btn.dataset.act;
                        const row = list.querySelector('.ai-review-item[data-id="' + id + '"]');
                        const reviewedEl = elements.find(function (e) { return e.id === id; });
                        try { saveState(); } catch (_) {}
                        if (act === 'reject') {
                            _aiReviewRejected.add(id);
                            if (row) row.classList.add('rejected');
                        } else {
                            _aiReviewRejected.delete(id);
                            if (reviewedEl) markElementReviewed(reviewedEl);
                            if (row) {
                                row.classList.remove('rejected');
                                const button = row.querySelector('[data-act="accept"]');
                                if (button) button.textContent = 'QS reviewed';
                            }
                        }
                        // Highlight on plan and update the visible provenance badge.
                        selectedIds = [id];
                        renderAll();
                    });
                });
            }
            modal.classList.remove('reviewing');
            modal.classList.add('open');
        }

        function applyAiReviewRejects() {
            if (!_aiReviewRejected.size) return;
            const removeIds = _aiReviewRejected;
            const removed = elements.filter(function (el) { return removeIds.has(el.id); });
            elements.forEach(function (el) {
                if (!el || !el.cutouts) return;
                el.cutouts = el.cutouts.filter(function (cid) { return !removeIds.has(cid); });
            });
            elements = elements.filter(function (el) { return !removeIds.has(el.id); });
            selectedIds = selectedIds.filter(function (id) { return !removeIds.has(id); });
            try { saveState(); } catch (_) {}
            renderAll();
            try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                    removed.forEach(function (el) {
                        MCResearch.notifyElementChange('reject', el, { mode: 'pro' });
                    });
                }
            } catch (_) {}
        }

        function rejectAllAiReview() {
            if (!_aiReviewIds.length) { closeAiReviewModal(); return; }
            if (!confirm('Reject all ' + _aiReviewIds.length + ' AI-detected element(s) from this run?')) return;
            const removeIds = new Set(_aiReviewIds);
            const removed = elements.filter(function (el) { return removeIds.has(el.id); });
            elements = elements.filter(function (el) { return !removeIds.has(el.id); });
            selectedIds = selectedIds.filter(function (id) { return !removeIds.has(id); });
            try { saveState(); } catch (_) {}
            renderAll();
            try {
                if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                    removed.forEach(function (el) {
                        MCResearch.notifyElementChange('reject', el, { mode: 'pro' });
                    });
                }
            } catch (_) {}
            closeAiReviewModal();
        }

        function acceptAllAiReview() {
            _aiReviewIds.forEach(function (id) {
                if (!_aiReviewRejected.has(id)) {
                    const el = elements.find(function (e) { return e.id === id; });
                    if (el) markElementReviewed(el);
                }
            });
            applyAiReviewRejects();
            try { saveState(); } catch (_) {}
            renderAll();
            closeAiReviewModal();
        }

        function wireAiReviewModal() {
            const accept = document.getElementById('aiReviewAcceptAll');
            const reject = document.getElementById('aiReviewRejectAll');
            const review = document.getElementById('aiReviewReviewBtn');
            const modal = document.getElementById('aiReviewModal');
            if (accept) accept.addEventListener('click', acceptAllAiReview);
            if (reject) reject.addEventListener('click', rejectAllAiReview);
            if (review) review.addEventListener('click', function () {
                if (modal) modal.classList.toggle('reviewing');
            });
            if (modal) modal.addEventListener('click', function (e) {
                if (e.target === modal) acceptAllAiReview();
            });
        }

        function drawBackgroundImage(ctx) {
            if (!backgroundImage || !backgroundImage.visible || !backgroundImage.img) return;
            ctx.save();
            ctx.globalAlpha = backgroundImage.opacity;
            ctx.drawImage(backgroundImage.img, 0, 0, backgroundImage.w, backgroundImage.h);
            ctx.restore();
        }

        // ---- MAIN 2D RENDER ----
        function renderCanvas2D() {
            const canvas = document.getElementById('canvas2d');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const rect = canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = (rect.width || 1200) * dpr;
            canvas.height = (rect.height || 800) * dpr;
            canvas.style.width = (rect.width || 1200) + 'px';
            canvas.style.height = (rect.height || 800) + 'px';
            ctx.scale(dpr, dpr);

            const W = rect.width || 1200;
            const H = rect.height || 800;

            ctx.clearRect(0, 0, W, H);
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim() || '#ffffff';
            ctx.fillRect(0, 0, W, H);

            ctx.save();
            ctx.translate(viewport.offsetX, viewport.offsetY);
            ctx.scale(viewport.scale, viewport.scale);

            drawBackgroundImage(ctx);

            const { major, minor } = getGridSpacing(viewport.scale);
            const visibleRect = {
                x: -viewport.offsetX / viewport.scale,
                y: -viewport.offsetY / viewport.scale,
                w: W / viewport.scale,
                h: H / viewport.scale,
            };

            ctx.strokeStyle = '#e8e8ec';
            ctx.lineWidth = 0.5 / viewport.scale;
            const startX = Math.floor(visibleRect.x / minor) * minor;
            const startY = Math.floor(visibleRect.y / minor) * minor;
            const endX = visibleRect.x + visibleRect.w;
            const endY = visibleRect.y + visibleRect.h;
            for (let x = startX; x <= endX; x += minor) {
                if (Math.abs(x % major) < 0.001) continue;
                ctx.beginPath();
                ctx.moveTo(x, visibleRect.y);
                ctx.lineTo(x, visibleRect.y + visibleRect.w);
                ctx.stroke();
            }
            for (let y = startY; y <= endY; y += minor) {
                if (Math.abs(y % major) < 0.001) continue;
                ctx.beginPath();
                ctx.moveTo(visibleRect.x, y);
                ctx.lineTo(visibleRect.x + visibleRect.w, y);
                ctx.stroke();
            }
            ctx.strokeStyle = '#d0d0d8';
            ctx.lineWidth = 0.8 / viewport.scale;
            for (let x = startX; x <= endX; x += major) {
                ctx.beginPath();
                ctx.moveTo(x, visibleRect.y);
                ctx.lineTo(x, visibleRect.y + visibleRect.w);
                ctx.stroke();
            }
            for (let y = startY; y <= endY; y += major) {
                ctx.beginPath();
                ctx.moveTo(visibleRect.x, y);
                ctx.lineTo(visibleRect.x + visibleRect.w, y);
                ctx.stroke();
            }

            const layerFilter = currentLayer === 'All' ? null : currentLayer;
            const visibleEls = elementsOnDrawingVisible
                ? elements.filter(el => !el.hidden && (layerFilter === null || el.layer === layerFilter || el.layer === 'All'))
                : [];
            updateMeasureLabelPosition();

            // ---- Polygon preview (for slab/cutout) ----
            if ((currentTool === 'slab' || currentTool === 'cutout' || currentTool === 'column') &&
                polygonPoints.length > 0) {
                drawPolygonPreview(ctx, polygonPoints, viewport.scale);
            }

            // ---- Continuous wall / beam polyline preview ----
            if ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length > 0) {
                const color = currentTool === 'beam' ? '#b07ae0' : '#4a8fe0';
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 3 / viewport.scale;
                ctx.setLineDash([]);
                ctx.shadowColor = 'rgba(0,0,0,0.25)';
                ctx.shadowBlur = 6 / viewport.scale;
                if (polygonPoints.length >= 2) {
                    ctx.beginPath();
                    ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
                    for (let i = 1; i < polygonPoints.length; i++) {
                        ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
                    }
                    ctx.stroke();
                }
                // live segment to cursor
                if (continuousTempPreview) {
                    ctx.beginPath();
                    ctx.moveTo(continuousTempPreview.x1, continuousTempPreview.y1);
                    ctx.lineTo(continuousTempPreview.x2, continuousTempPreview.y2);
                    ctx.setLineDash([8 / viewport.scale, 4 / viewport.scale]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    const len = Math.hypot(continuousTempPreview.x2 - continuousTempPreview.x1,
                        continuousTempPreview.y2 - continuousTempPreview.y1);
                    const midX = (continuousTempPreview.x1 + continuousTempPreview.x2) / 2;
                    const midY = (continuousTempPreview.y1 + continuousTempPreview.y2) / 2;
                    ctx.fillStyle = color;
                    ctx.font = `bold ${11 / viewport.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(toMeters(len).toFixed(2) + ' m', midX, midY - 6 / viewport.scale);
                }
                polygonPoints.forEach((p, idx) => {
                    ctx.fillStyle = idx === 0 ? '#34c759' : color;
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2 / viewport.scale;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 5 / viewport.scale, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.stroke();
                });
                ctx.restore();
            }

            // ---- Deduction continuous polyline preview (yellow) ----
            if (currentTool === 'deduction_wall' && deductionLinePoints.length > 0) {
                const color = '#FFD700';
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = 4 / viewport.scale;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 8 / viewport.scale;
                if (deductionLinePoints.length >= 2) {
                    ctx.beginPath();
                    ctx.moveTo(deductionLinePoints[0].x, deductionLinePoints[0].y);
                    for (let i = 1; i < deductionLinePoints.length; i++) {
                        ctx.lineTo(deductionLinePoints[i].x, deductionLinePoints[i].y);
                    }
                    ctx.stroke();
                }
                if (continuousTempPreview) {
                    ctx.beginPath();
                    ctx.moveTo(continuousTempPreview.x1, continuousTempPreview.y1);
                    ctx.lineTo(continuousTempPreview.x2, continuousTempPreview.y2);
                    ctx.setLineDash([8 / viewport.scale, 4 / viewport.scale]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    const len = Math.hypot(continuousTempPreview.x2 - continuousTempPreview.x1,
                        continuousTempPreview.y2 - continuousTempPreview.y1);
                    const midX = (continuousTempPreview.x1 + continuousTempPreview.x2) / 2;
                    const midY = (continuousTempPreview.y1 + continuousTempPreview.y2) / 2;
                    ctx.fillStyle = color;
                    ctx.font = `bold ${11 / viewport.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(toMeters(len).toFixed(2) + ' m', midX, midY - 6 / viewport.scale);
                }
                deductionLinePoints.forEach((p, idx) => {
                    const isStart = idx === 0;
                    const r = (isStart ? 7 : 5) / viewport.scale;
                    ctx.fillStyle = isStart ? '#FFD700' : color;
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2 / viewport.scale;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.stroke();
                    if (isStart) {
                        // Cross so START is obvious even with one point
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 1.5 / viewport.scale;
                        const c = 9 / viewport.scale;
                        ctx.beginPath();
                        ctx.moveTo(p.x - c, p.y);
                        ctx.lineTo(p.x + c, p.y);
                        ctx.moveTo(p.x, p.y - c);
                        ctx.lineTo(p.x, p.y + c);
                        ctx.stroke();
                        ctx.fillStyle = '#FFD700';
                        ctx.font = `bold ${10 / viewport.scale}px sans-serif`;
                        ctx.textAlign = 'left';
                        ctx.textBaseline = 'bottom';
                        ctx.fillText('START', p.x + 10 / viewport.scale, p.y - 6 / viewport.scale);
                    }
                });
                ctx.restore();
            }

            // ---- Draw elements ----
            const overlappingIds = computeOverlappingElementIds();
            visibleEls.forEach(el => {
                const { x, y, w, h } = el;
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.1)';
                ctx.shadowBlur = 4 / viewport.scale;

                // Ensure slab/column have vertices so shape handles match column editing
                if ((el.type === 'slab' || el.type === 'column') && selectedIds.includes(el.id)) {
                    ensureElementVertices(el);
                }
                // If element has vertices, draw as polygon (slab, floor, cutout)
                if (el.vertices && el.vertices.length >= 3) {
                    const pts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) {
                        ctx.lineTo(pts[i].x, pts[i].y);
                    }
                    ctx.closePath();
                    // For cutout/deduction, fill with red transparent and draw cross
                    if (el.isDeduction || el.type === 'cutout') {
                        ctx.fillStyle = '#ff3b3040';
                        ctx.strokeStyle = '#ff3b30';
                        ctx.lineWidth = 2.5 / viewport.scale;
                        ctx.setLineDash([]);
                        ctx.fill();
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.moveTo(pts[0].x, pts[0].y);
                        ctx.lineTo(pts[2] ? pts[2].x : pts[1].x, pts[2] ? pts[2].y : pts[1].y);
                        ctx.moveTo(pts[1].x, pts[1].y);
                        ctx.lineTo(pts[3] ? pts[3].x : pts[0].x, pts[3] ? pts[3].y : pts[0].y);
                        ctx.stroke();
                    } else {
                        ctx.fillStyle = el.color + '60';
                        ctx.strokeStyle = el.locked ? '#888' : el.color;
                        ctx.lineWidth = screenLineWidth(isAiStyled(el) ? 2 : 2.5);
                        ctx.setLineDash(isAiStyled(el) ? [] : [6 / viewport.scale, 4 / viewport.scale]);
                        ctx.fill();
                        ctx.stroke();
                        ctx.setLineDash([]);
                    }
                    // Show vertices
                    pts.forEach((p) => {
                        ctx.fillStyle = '#B8863B';
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 3 / viewport.scale, 0, 2 * Math.PI);
                        ctx.fill();
                    });
                    if (selectedIds.includes(el.id)) {
                        const pad = screenPad(2);
                        ctx.shadowBlur = 16 / viewport.scale;
                        ctx.shadowColor = '#B8863B';
                        ctx.strokeStyle = '#B8863B';
                        ctx.lineWidth = screenLineWidth(2);
                        ctx.setLineDash([]);
                        ctx.strokeRect(el.x - pad, el.y - pad, el.w + pad * 2, el.h + pad * 2);
                        if (selectedIds.length === 1 && !el.locked) {
                            const handles = [
                                [el.x, el.y],
                                [el.x + el.w / 2, el.y],
                                [el.x + el.w, el.y],
                                [el.x, el.y + el.h / 2],
                                [el.x + el.w, el.y + el.h / 2],
                                [el.x, el.y + el.h],
                                [el.x + el.w / 2, el.y + el.h],
                                [el.x + el.w, el.y + el.h]
                            ];
                            handles.forEach(([hx, hy]) => {
                                // Size handles (gold) — drag to make bigger/smaller
                                const r = 6 / viewport.scale;
                                ctx.fillStyle = '#B8863B';
                                ctx.strokeStyle = '#fff';
                                ctx.lineWidth = 1.5 / viewport.scale;
                                ctx.shadowBlur = 0;
                                ctx.beginPath();
                                ctx.arc(hx, hy, r, 0, 2 * Math.PI);
                                ctx.fill();
                                ctx.stroke();
                            });
                            if (selectedIds.length === 1 && !el.locked) drawRotateHandle(ctx, el);
                            pts.forEach((p) => {
                                // Shape vertices (green) — Shift+drag corner, or drag free vertex
                                ctx.fillStyle = '#34c759';
                                ctx.strokeStyle = '#fff';
                                ctx.lineWidth = 1.5 / viewport.scale;
                                ctx.beginPath();
                                ctx.arc(p.x, p.y, 5 / viewport.scale, 0, 2 * Math.PI);
                                ctx.fill();
                                ctx.stroke();
                            });
                        }
                    }
                    if (hoveredSnapId === el.id && !selectedIds.includes(el.id)) {
                        const hpad = screenPad(3);
                        ctx.setLineDash([8 / viewport.scale, 4 / viewport.scale]);
                        ctx.strokeStyle = '#ffaa00';
                        ctx.lineWidth = screenLineWidth(3);
                        ctx.strokeRect(el.x - hpad, el.y - hpad, el.w + hpad * 2, el.h + hpad * 2);
                        ctx.setLineDash([]);
                    }
                    ctx.restore();
                    ctx.fillStyle = '#333';
                    ctx.font = `${9/viewport.scale}px sans-serif`;
                    ctx.fillText(el.label, el.x + 2, el.y + 12);
                    ctx.fillStyle = '#666';
                    ctx.font = `${8/viewport.scale}px sans-serif`;
                    ctx.fillText(`z=${el.zHeight.toFixed(2)}m`, el.x + 2, el.y + 24);
                    return;
                }

                // Angled wall / beam (2-point line with thickness)
                if (el.isLine && el.p1 && el.p2 && (el.type === 'wall' || el.type === 'beam')) {
                    // Visual thickness is stable drawing-units (not re-scaled by calibration)
                    const thkDraw = getLineThicknessDraw(el);
                    const dx = el.p2.x - el.p1.x,
                        dy = el.p2.y - el.p1.y;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const angle = el.angle != null ? el.angle : Math.atan2(dy, dx);
                    const midX = (el.p1.x + el.p2.x) / 2;
                    const midY = (el.p1.y + el.p2.y) / 2;
                    ctx.save();
                    ctx.translate(midX, midY);
                    ctx.rotate(angle);
                    ctx.fillStyle = el.color + '60';
                    ctx.strokeStyle = el.locked ? '#888' : el.color;
                    ctx.lineWidth = screenLineWidth(isAiStyled(el) ? 2 : 2.5);
                    ctx.setLineDash(isAiStyled(el) ? [] : [6 / viewport.scale, 4 / viewport.scale]);
                    ctx.fillRect(-len / 2, -thkDraw / 2, len, thkDraw);
                    ctx.strokeRect(-len / 2, -thkDraw / 2, len, thkDraw);
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    // Cap endpoint dots to a few screen pixels so bad thickness never draws bubbles
                    const endR = Math.min(Math.max(thkDraw / 2, 1 / viewport.scale), 6 / viewport.scale);
                    ctx.arc(-len / 2, 0, endR, 0, Math.PI * 2);
                    ctx.arc(len / 2, 0, endR, 0, Math.PI * 2);
                    ctx.fillStyle = el.color + '90';
                    ctx.fill();
                    if (selectedIds.includes(el.id)) {
                        ctx.strokeStyle = '#B8863B';
                        ctx.lineWidth = screenLineWidth(2.5);
                        ctx.strokeRect(-len / 2 - 2 / viewport.scale, -thkDraw / 2 - 2 / viewport.scale,
                            len + 4 / viewport.scale, thkDraw + 4 / viewport.scale);
                        if (selectedIds.length === 1 && !el.locked) {
                            ctx.fillStyle = '#B8863B';
                            ctx.beginPath();
                            ctx.arc(-len / 2, 0, 5 / viewport.scale, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.beginPath();
                            ctx.arc(len / 2, 0, 5 / viewport.scale, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                    // Highlight if hovered (deduction parent or general CAD snap)
                    if ((hoveredParentId === el.id && currentTool === 'deduction_wall') ||
                        hoveredSnapId === el.id) {
                        ctx.setLineDash([8 / viewport.scale, 4 / viewport.scale]);
                        ctx.strokeStyle = '#ffaa00';
                        ctx.lineWidth = screenLineWidth(3);
                        ctx.strokeRect(-len / 2 - 4 / viewport.scale, -thkDraw / 2 - 4 / viewport.scale,
                            len + 8 / viewport.scale, thkDraw + 8 / viewport.scale);
                        ctx.setLineDash([]);
                    }
                    ctx.restore();
                    ctx.fillStyle = '#333';
                    ctx.font = `${9 / viewport.scale}px sans-serif`;
                    ctx.fillText(el.label, midX + 2, midY - thkDraw / 2 - 4 / viewport.scale);
                    ctx.fillStyle = '#666';
                    ctx.font = `${8 / viewport.scale}px sans-serif`;
                    const lenM = toMeters(len);
                    ctx.fillText(`${lenM.toFixed(2)} m · z=${(el.zHeight || 0).toFixed(2)}m`, midX + 2, midY - thkDraw / 2 + 10 / viewport.scale);
                    if (selectedIds.includes(el.id) && selectedIds.length === 1 && !el.locked) {
                        drawRotateHandle(ctx, el);
                    }
                    ctx.restore();
                    return;
                }

                // Standard rect elements (door, window, column, etc.)
                if (el.type === 'door') {
                    drawDoor(ctx, el, viewport.scale);
                } else if (el.type === 'window') {
                    drawWindow(ctx, el, viewport.scale);
                } else if (el.isDeduction || el.type === 'cutout') {
                    // draw as red cross with semi-transparent fill
                    ctx.fillStyle = '#ff3b3040';
                    ctx.strokeStyle = '#ff3b30';
                    ctx.lineWidth = 2.5 / viewport.scale;
                    ctx.setLineDash([]);
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + w, y + h);
                    ctx.moveTo(x + w, y);
                    ctx.lineTo(x, y + h);
                    ctx.stroke();
                } else {
                    ctx.fillStyle = el.color + '60';
                    ctx.strokeStyle = el.locked ? '#888' : el.color;
                    ctx.lineWidth = screenLineWidth(isAiStyled(el) ? 2 : 2.5);
                    ctx.setLineDash(isAiStyled(el) ? [] : [6 / viewport.scale, 4 / viewport.scale]);
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);
                }

                if (selectedIds.includes(el.id) && !el.vertices) {
                    const pad = screenPad(2);
                    ctx.shadowBlur = 16 / viewport.scale;
                    ctx.shadowColor = '#B8863B';
                    ctx.strokeStyle = '#B8863B';
                    ctx.lineWidth = screenLineWidth(2);
                    ctx.setLineDash([]);
                    ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
                    if (selectedIds.length === 1 && !el.locked) {
                        const handles = [
                            [x, y, 'nw'],
                            [x + w / 2, y, 'n'],
                            [x + w, y, 'ne'],
                            [x, y + h / 2, 'w'],
                            [x + w, y + h / 2, 'e'],
                            [x, y + h, 'sw'],
                            [x + w / 2, y + h, 's'],
                            [x + w, y + h, 'se']
                        ];
                        handles.forEach(([hx, hy]) => {
                            // Size handles (gold) — larger + white ring so they are easy to grab
                            const r = 6 / viewport.scale;
                            ctx.fillStyle = '#B8863B';
                            ctx.strokeStyle = '#fff';
                            ctx.lineWidth = 1.5 / viewport.scale;
                            ctx.shadowBlur = 0;
                            ctx.beginPath();
                            ctx.arc(hx, hy, r, 0, 2 * Math.PI);
                            ctx.fill();
                            ctx.stroke();
                        });
                        if (selectedIds.length === 1 && !el.locked) drawRotateHandle(ctx, el);
                    }
                }
                // CAD snap hover highlight for rect elements
                if (hoveredSnapId === el.id && !selectedIds.includes(el.id)) {
                    const hpad = screenPad(3);
                    ctx.setLineDash([8 / viewport.scale, 4 / viewport.scale]);
                    ctx.strokeStyle = '#ffaa00';
                    ctx.lineWidth = screenLineWidth(3);
                    ctx.strokeRect(x - hpad, y - hpad, w + hpad * 2, h + hpad * 2);
                    ctx.setLineDash([]);
                }
                ctx.restore();
                ctx.fillStyle = '#333';
                ctx.font = `${9/viewport.scale}px sans-serif`;
                ctx.fillText(el.label, x + 2, y + 12);
                ctx.fillStyle = '#666';
                ctx.font = `${8/viewport.scale}px sans-serif`;
                ctx.fillText(`z=${el.zHeight.toFixed(2)}m`, x + 2, y + 24);
                if (el.layer && el.layer !== 'All') {
                    ctx.fillStyle = '#888';
                    ctx.font = `${7/viewport.scale}px sans-serif`;
                    ctx.fillText(`📁${el.layer}`, x + 2, y + 36);
                }
            });

            // ---- Overlap cues: magenta dashed ring + badge on stacked elements ----
            if (overlappingIds.size > 0) {
                ctx.save();
                visibleEls.forEach(el => {
                    if (!overlappingIds.has(el.id)) return;
                    let bx, by, bw, bh;
                    if (el.isLine && el.p1 && el.p2) {
                        const thk = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(el) : 8);
                        const minx = Math.min(el.p1.x, el.p2.x), maxx = Math.max(el.p1.x, el.p2.x);
                        const miny = Math.min(el.p1.y, el.p2.y), maxy = Math.max(el.p1.y, el.p2.y);
                        const pad = thk / 2 + screenPad(4);
                        bx = minx - pad; by = miny - pad;
                        bw = (maxx - minx) + pad * 2; bh = (maxy - miny) + pad * 2;
                    } else {
                        const pad = screenPad(4);
                        bx = el.x - pad; by = el.y - pad;
                        bw = (el.w || 0) + pad * 2; bh = (el.h || 0) + pad * 2;
                    }
                    ctx.setLineDash([7 / viewport.scale, 5 / viewport.scale]);
                    ctx.strokeStyle = selectedIds.includes(el.id) ? '#B8863B' : '#e11d48';
                    ctx.lineWidth = screenLineWidth(selectedIds.includes(el.id) ? 2.5 : 1.75);
                    ctx.strokeRect(bx, by, bw, bh);
                    ctx.setLineDash([]);
                    // Small "stack" badge
                    const badge = '⧉';
                    ctx.font = `bold ${11 / viewport.scale}px sans-serif`;
                    ctx.fillStyle = '#e11d48';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    ctx.fillText(badge, bx + 2 / viewport.scale, by + 2 / viewport.scale);
                });
                ctx.restore();
            }

            // ---- Hover name/type label for element under cursor (esp. overlaps) ----
            if (hoverLabelWorld && overlapHitIds.length > 0) {
                ctx.save();
                const lines = overlapHitIds.map((id, idx) => {
                    const el = elements.find(e => e.id === id);
                    if (!el) return null;
                    const mark = (selectedIds.includes(id) ? '● ' : (idx === overlapCycleIndex ? '→ ' : '  '));
                    const typeName = (el.type || 'element').charAt(0).toUpperCase() + (el.type || '').slice(1);
                    return mark + (el.label || typeName) + ' · ' + typeName;
                }).filter(Boolean);
                if (lines.length) {
                    const fontPx = 11 / viewport.scale;
                    ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
                    let maxW = 0;
                    lines.forEach(t => { maxW = Math.max(maxW, ctx.measureText(t).width); });
                    const pad = 6 / viewport.scale;
                    const lineH = 14 / viewport.scale;
                    const boxW = maxW + pad * 2;
                    const boxH = lines.length * lineH + pad * 2;
                    const lx = hoverLabelWorld.x + 12 / viewport.scale;
                    const ly = hoverLabelWorld.y - boxH - 8 / viewport.scale;
                    ctx.fillStyle = 'rgba(28, 25, 23, 0.88)';
                    ctx.strokeStyle = overlapHitIds.length > 1 ? '#e11d48' : '#B8863B';
                    ctx.lineWidth = screenLineWidth(1.25);
                    ctx.beginPath();
                    if (ctx.roundRect) ctx.roundRect(lx, ly, boxW, boxH, 4 / viewport.scale);
                    else ctx.rect(lx, ly, boxW, boxH);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#fafaf9';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'top';
                    lines.forEach((t, i) => {
                        ctx.fillStyle = t.startsWith('●') || t.startsWith('→') ? '#fbbf24' : '#fafaf9';
                        ctx.fillText(t, lx + pad, ly + pad + i * lineH);
                    });
                    if (lines.length > 1) {
                        ctx.fillStyle = '#fda4af';
                        ctx.font = `${9 / viewport.scale}px sans-serif`;
                        ctx.fillText('Ctrl+click to cycle', lx + pad, ly + boxH + 2 / viewport.scale);
                    }
                }
                ctx.restore();
            }

            // ---- Measure points (Bluebeam-style distance) ----
            if (measurePoints.length > 0 || (currentTool === 'measure' && measurePreview)) {
                ctx.save();
                measurePoints.forEach((p, i) => {
                    ctx.fillStyle = i === 0 ? '#B8863B' : '#ff3b30';
                    ctx.shadowColor = 'rgba(0,0,0,0.3)';
                    ctx.shadowBlur = 6 / viewport.scale;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 5 / viewport.scale, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                });
                const p1 = measurePoints[0];
                const p2 = measurePoints.length >= 2 ? measurePoints[1] : (measurePreview || null);
                if (p1 && p2) {
                    const dist = toMeters(Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2));
                    ctx.strokeStyle = '#B8863B';
                    ctx.lineWidth = 2 / viewport.scale;
                    ctx.setLineDash(measurePoints.length < 2 ? [8 / viewport.scale, 5 / viewport.scale] : []);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    const midX = (p1.x + p2.x) / 2,
                        midY = (p1.y + p2.y) / 2;
                    ctx.fillStyle = '#B8863B';
                    ctx.font = `bold ${12 / viewport.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(dist.toFixed(2) + ' m', midX, midY - 10 / viewport.scale);
                    if (measurePreview && measurePoints.length === 1) {
                        ctx.fillStyle = 'rgba(0,122,255,0.45)';
                        ctx.beginPath();
                        ctx.arc(measurePreview.x, measurePreview.y, 4 / viewport.scale, 0, 2 * Math.PI);
                        ctx.fill();
                    }
                }
                ctx.restore();
            }

            // ---- Calibration points ----
            if (calibratePoints.length > 0 || (currentTool === 'calibrate' && calibratePreview)) {
                ctx.save();
                calibratePoints.forEach((p, i) => {
                    ctx.fillStyle = i === 0 ? '#ff9f0a' : '#34c759';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2 / viewport.scale;
                    ctx.shadowColor = 'rgba(0,0,0,0.4)';
                    ctx.shadowBlur = 8 / viewport.scale;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 7 / viewport.scale, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.stroke();
                    ctx.fillStyle = '#fff';
                    ctx.font = `bold ${11 / viewport.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(i + 1), p.x, p.y);
                });

                const p1 = calibratePoints[0];
                const p2 = calibratePoints.length >= 2 ?
                    calibratePoints[1] :
                    (calibratePreview || null);

                if (p1 && p2) {
                    const drawingDist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
                    ctx.strokeStyle = 'rgba(255, 159, 10, 0.35)';
                    ctx.lineWidth = 6 / viewport.scale;
                    ctx.setLineDash([]);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    ctx.strokeStyle = '#ff9f0a';
                    ctx.lineWidth = 2.5 / viewport.scale;
                    ctx.setLineDash([8 / viewport.scale, 5 / viewport.scale]);
                    ctx.beginPath();
                    ctx.moveTo(p1.x, p1.y);
                    ctx.lineTo(p2.x, p2.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const label = drawingDist.toFixed(2) + ' units';
                    ctx.font = `bold ${13 / viewport.scale}px sans-serif`;
                    const tw = ctx.measureText(label).width;
                    const pad = 6 / viewport.scale;
                    const bh = 18 / viewport.scale;
                    ctx.fillStyle = 'rgba(255, 159, 10, 0.92)';
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1.5 / viewport.scale;
                    const lx = midX - tw / 2 - pad;
                    const ly = midY - bh - 8 / viewport.scale;
                    ctx.beginPath();
                    ctx.roundRect(lx, ly, tw + pad * 2, bh, 4 / viewport.scale);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, midX, ly + bh / 2);

                    if (calibratePoints.length === 1 && calibratePreview) {
                        ctx.fillStyle = '#34c759';
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 2 / viewport.scale;
                        ctx.beginPath();
                        ctx.arc(p2.x, p2.y, 7 / viewport.scale, 0, 2 * Math.PI);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = '#fff';
                        ctx.font = `bold ${11 / viewport.scale}px sans-serif`;
                        ctx.fillText('2', p2.x, p2.y);
                    }
                }
                ctx.restore();
            }

            // ---- CAD object-snap marker (crosshair on snapped geometry) ----
            if (snapCursorPoint && hoveredSnapId) {
                ctx.save();
                const sp = snapCursorPoint;
                const r = 6 / viewport.scale;
                ctx.strokeStyle = '#ffaa00';
                ctx.fillStyle = 'rgba(255, 170, 0, 0.35)';
                ctx.lineWidth = screenLineWidth(1.5);
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, r, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(sp.x - r * 1.6, sp.y);
                ctx.lineTo(sp.x + r * 1.6, sp.y);
                ctx.moveTo(sp.x, sp.y - r * 1.6);
                ctx.lineTo(sp.x, sp.y + r * 1.6);
                ctx.stroke();
                ctx.restore();
            }

            ctx.restore();

            // ---- Scale bar ----
            ctx.save();
            const barX = 20,
                barY = H - 40;
            const targetPixels = 100;
            const worldLen = targetPixels / viewport.scale;
            const realLen = toMeters(worldLen);
            const roundValues = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
            let displayMeters = roundValues.find(v => v >= realLen) || 100;
            let barWidth = toDrawing(displayMeters) * viewport.scale;
            while (barWidth > 300 && displayMeters > 0.1) { displayMeters /= 2;
                barWidth = toDrawing(displayMeters) * viewport.scale; }
            while (barWidth < 30 && displayMeters < 1000) { displayMeters *= 2;
                barWidth = toDrawing(displayMeters) * viewport.scale; }
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.fillStyle = '#333';
            ctx.font = '12px sans-serif';
            ctx.beginPath();
            ctx.moveTo(barX, barY);
            ctx.lineTo(barX + barWidth, barY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(barX, barY - 5);
            ctx.lineTo(barX, barY + 5);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(barX + barWidth, barY - 5);
            ctx.lineTo(barX + barWidth, barY + 5);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const label = displayMeters >= 1 ? displayMeters + ' m' : displayMeters.toFixed(1) + ' m';
            ctx.fillText(label, barX + barWidth / 2, barY + 6);
            ctx.restore();

            const zdEl = document.getElementById('zoomDisplay');
            if (zdEl) {
                const pct = Math.round(viewport.scale * 100) + '%';
                zdEl.textContent = zoomLocked ? pct + ' 🔒' : pct;
            }
            document.getElementById('loading').classList.add('hidden');
        }

        // ----- 3D RENDERER (unchanged) -----
        let threeGrid = null;
        let threeGround = null;
        let threeFitDone = false;

        function initThree() {
            if (threeInitialized) return;
            const container = document.getElementById('threeContainer');
            if (!container) return;
            const W = container.clientWidth || 600;
            const H = container.clientHeight || 400;
            scene = new THREE.Scene();
            const bg = currentTheme === 'dark' ? 0x1c1c1e : 0xf0f0f2;
            scene.background = new THREE.Color(bg);
            camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 5000);
            camera.position.set(15, 12, 20);
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(W, H);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            container.appendChild(renderer.domElement);
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.target.set(0, 0, 0);
            controls.enableDamping = true;
            controls.dampingFactor = 0.1;
            controls.update();
            const ambient = new THREE.AmbientLight(0x404060, 0.55);
            scene.add(ambient);
            const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
            dirLight.position.set(30, 50, 20);
            dirLight.castShadow = true;
            dirLight.shadow.mapSize.width = 2048;
            dirLight.shadow.mapSize.height = 2048;
            dirLight.shadow.camera.near = 0.5;
            dirLight.shadow.camera.far = 200;
            dirLight.shadow.camera.left = -50;
            dirLight.shadow.camera.right = 50;
            dirLight.shadow.camera.top = 50;
            dirLight.shadow.camera.bottom = -50;
            scene.add(dirLight);
            const fillLight = new THREE.DirectionalLight(0x8888ff, 0.35);
            fillLight.position.set(-20, 20, -30);
            scene.add(fillLight);
            const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.55);
            scene.add(hemi);
            threeInitialized = true;
            threeFitDone = false;
            buildThreeScene();
            animateThree();
        }

        function du(v) { return v * (calibrationFactor || 1); }

        function rebuildThreeGrid(minX, maxX, minZ, maxZ) {
            if (threeGrid) { scene.remove(threeGrid);
                threeGrid = null; }
            if (threeGround) { scene.remove(threeGround);
                threeGround = null; }
            const pad = 5;
            const sizeX = Math.max(10, (maxX - minX) + pad * 2);
            const sizeZ = Math.max(10, (maxZ - minZ) + pad * 2);
            const size = Math.max(sizeX, sizeZ);
            const cx = (minX + maxX) / 2;
            const cz = (minZ + maxZ) / 2;
            const divisions = Math.max(10, Math.min(100, Math.round(size)));
            threeGrid = new THREE.GridHelper(size, divisions, 0x888888, 0xcccccc);
            threeGrid.position.set(cx, -0.02, cz);
            scene.add(threeGrid);
            const groundGeo = new THREE.PlaneGeometry(size, size);
            const groundMat = new THREE.ShadowMaterial({ opacity: 0.25 });
            threeGround = new THREE.Mesh(groundGeo, groundMat);
            threeGround.rotation.x = -Math.PI / 2;
            threeGround.position.set(cx, -0.02, cz);
            threeGround.receiveShadow = true;
            scene.add(threeGround);
        }

        function fitThreeCamera(minX, maxX, minY, maxY, minZ, maxZ) {
            const sizeX = Math.max(1, maxX - minX);
            const sizeY = Math.max(1, maxY - minY);
            const sizeZ = Math.max(1, maxZ - minZ);
            const maxDim = Math.max(sizeX, sizeY, sizeZ);
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const cz = (minZ + maxZ) / 2;
            const dist = maxDim * 1.6 + 2;
            camera.position.set(cx + dist * 0.7, cy + dist * 0.55, cz + dist * 0.7);
            camera.near = Math.max(0.05, maxDim / 500);
            camera.far = Math.max(500, maxDim * 20);
            camera.updateProjectionMatrix();
            controls.target.set(cx, cy * 0.4, cz);
            controls.update();
            scene.traverse(obj => {
                if (obj.isDirectionalLight && obj.castShadow) {
                    const s = maxDim * 0.8 + 10;
                    obj.shadow.camera.left = -s;
                    obj.shadow.camera.right = s;
                    obj.shadow.camera.top = s;
                    obj.shadow.camera.bottom = -s;
                    obj.shadow.camera.far = maxDim * 5 + 50;
                    obj.shadow.camera.updateProjectionMatrix();
                    obj.position.set(cx + s * 0.6, cy + s, cz + s * 0.4);
                }
            });
        }

        /**
         * Build 3D geometry for an element.
         * - Circular / near-square columns → CylinderGeometry
         * - Polygon slabs / cutouts (vertices) → ExtrudeGeometry (true plan shape)
         * - Everything else → BoxGeometry
         * Returns { geo, cx, cz, yMode: 'center'|'bottom' }
         */

        /**
         * Openings belonging to a wall (parentId or plan overlap).
         */
        function getOpeningsForWall(wall) {
            if (!wall) return [];
            return elements.filter(function (o) {
                if (!o || o.hidden) return false;
                const isOpen = o.type === 'door' || o.type === 'window' || o.type === 'opening'
                    || o.isDeduction || o.type === 'cutout';
                if (!isOpen) return false;
                // Explicit parent link always wins — never reassign to another wall by geometry
                if (o.parentId != null) return sameElementId(o.parentId, wall.id);
                // Fallback: overlap test only when parent is unset
                return typeof elementIntersectsWall === 'function' && elementIntersectsWall(wall, o);
            });
        }

        /**
         * Build wall mesh with real openings (holes) using Shape + ExtrudeGeometry.
         * Shape in local XY: X = along wall length, Y = height; extrude = thickness.
         * Returns { mesh, cx, cz, wallH } or null.
         */
        function createWallMeshWithOpenings(wall, color, selected) {
            if (!wall || !wall.isLine || !wall.p1 || !wall.p2) return null;
            const s = calibrationFactor || 1;
            const du = function (v) { return v * s; };
            const p1x = du(wall.p1.x), p1z = du(wall.p1.y);
            const p2x = du(wall.p2.x), p2z = du(wall.p2.y);
            const dx = p2x - p1x, dz = p2z - p1z;
            const lenM = Math.hypot(dx, dz);
            if (!(lenM > 0.02)) return null;
            const ux = dx / lenM, uz = dz / lenM;
            const wallH = (typeof wall.zHeight === 'number' && wall.zHeight > 0) ? wall.zHeight : 3.0;
            const thickM = (typeof wall.thickness === 'number' && wall.thickness > 0)
                ? wall.thickness : DEFAULT_WALL_THICKNESS_M;

            const shape = new THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(lenM, 0);
            shape.lineTo(lenM, wallH);
            shape.lineTo(0, wallH);
            shape.closePath();

            const openings = getOpeningsForWall(wall);
            openings.forEach(function (o) {
                // Project opening center onto wall axis (drawing units → metres along wall)
                let ocx, ocy;
                if (o.isLine && o.p1 && o.p2) {
                    ocx = (o.p1.x + o.p2.x) / 2;
                    ocy = (o.p1.y + o.p2.y) / 2;
                } else {
                    ocx = o.x + (o.w || 0) / 2;
                    ocy = o.y + (o.h || 0) / 2;
                }
                // Distance along wall from p1 in drawing units
                const abx = wall.p2.x - wall.p1.x, aby = wall.p2.y - wall.p1.y;
                const lenDraw = Math.hypot(abx, aby) || 1;
                const t = ((ocx - wall.p1.x) * abx + (ocy - wall.p1.y) * aby) / (lenDraw * lenDraw);
                const alongDraw = Math.max(0, Math.min(lenDraw, t * lenDraw));
                const alongM = alongDraw * s;

                let widthM;
                if (typeof cutoutWidthAlongLine === 'function') {
                    widthM = cutoutWidthAlongLine(wall, o) * s;
                } else {
                    widthM = Math.max(o.w || 0, o.h || 0) * s;
                }
                widthM = Math.max(0.2, Math.min(lenM - 0.02, widthM || 0.9));
                const openH = Math.max(0.2, getOpeningHeightM(o));
                const sillM = Math.max(0, getOpeningSillM(o));
                // Clamp hole inside wall rectangle
                let x0 = alongM - widthM / 2;
                let x1 = alongM + widthM / 2;
                if (x0 < 0.01) { x1 += (0.01 - x0); x0 = 0.01; }
                if (x1 > lenM - 0.01) { x0 -= (x1 - (lenM - 0.01)); x1 = lenM - 0.01; }
                let y0 = sillM;
                let y1 = sillM + openH;
                if (y0 < 0) y0 = 0;
                if (y1 > wallH - 0.01) y1 = wallH - 0.01;
                if (y1 - y0 < 0.15 || x1 - x0 < 0.15) return;

                const hole = new THREE.Path();
                hole.moveTo(x0, y0);
                hole.lineTo(x1, y0);
                hole.lineTo(x1, y1);
                hole.lineTo(x0, y1);
                hole.closePath();
                shape.holes.push(hole);
            });

            const geo = new THREE.ExtrudeGeometry(shape, {
                depth: Math.max(0.05, thickM),
                bevelEnabled: false,
                steps: 1
            });
            // Geometry: X along wall, Y up, Z thickness (0..thick)
            // Shift so thickness is centered on wall centerline
            geo.translate(0, 0, -thickM / 2);

            const mat = new THREE.MeshStandardMaterial({
                color: color,
                transparent: true,
                opacity: wall.locked ? 0.6 : 0.92,
                roughness: 0.5,
                metalness: 0.06,
                emissive: selected ? new THREE.Color(0x007aff) : new THREE.Color(0x000000),
                emissiveIntensity: selected ? 0.35 : 0,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geo, mat);
            // Place at p1, orient X along wall direction in XZ plane
            const angle = Math.atan2(dz, dx); // rotation about Y
            mesh.position.set(p1x, 0, p1z);
            mesh.rotation.y = -angle;
            mesh.userData.elementId = wall.id;
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            const cx = (p1x + p2x) / 2;
            const cz = (p1z + p2z) / 2;
            return { mesh: mesh, cx: cx, cz: cz, wallH: wallH, openings: openings };
        }

        function createThreeGeometryForElement(el, wM, dM, hM, wallAngle) {
            const s = calibrationFactor || 1;
            const duLocal = function (v) { return v * s; };

            // --- Polygon plan shape (slab / cutout / irregular) ---
            if (el.vertices && el.vertices.length >= 3) {
                const abs = el.vertices.map(function (v) {
                    return { x: duLocal(el.x + v.x), z: duLocal(el.y + v.y) };
                });
                let cx = 0, cz = 0;
                abs.forEach(function (p) { cx += p.x; cz += p.z; });
                cx /= abs.length;
                cz /= abs.length;
                const shape = new THREE.Shape();
                abs.forEach(function (p, i) {
                    // Shape in XY; after rotateX(-90°) Y becomes world up from extrusion depth
                    const lx = p.x - cx;
                    const ly = -(p.z - cz);
                    if (i === 0) shape.moveTo(lx, ly);
                    else shape.lineTo(lx, ly);
                });
                shape.closePath();
                const geo = new THREE.ExtrudeGeometry(shape, {
                    depth: Math.max(0.02, hM),
                    bevelEnabled: false,
                    curveSegments: 8,
                    steps: 1
                });
                // Extrude along +Z → rotate so +Z becomes +Y (height)
                geo.rotateX(-Math.PI / 2);
                // Geometry now spans y ≈ 0..hM
                return { geo: geo, cx: cx, cz: cz, yMode: 'bottom', isPolygon: true };
            }

            // --- Circular columns only when explicitly marked (match PDF plan shape otherwise) ---
            if (el.type === 'column') {
                const asCircle = el.circular === true || el.shape === 'circle' || el.shape === 'circular' || el.shape === 'round';
                if (asCircle) {
                    const radius = Math.max(0.05, Math.min(wM, dM) / 2);
                    const geo = new THREE.CylinderGeometry(radius, radius, Math.max(0.05, hM), 32);
                    let cx, cz;
                    if (el.isLine && el.p1 && el.p2) {
                        cx = duLocal((el.p1.x + el.p2.x) / 2);
                        cz = duLocal((el.p1.y + el.p2.y) / 2);
                    } else {
                        cx = duLocal(el.x + (el.w || 10) / 2);
                        cz = duLocal(el.y + (el.h || 10) / 2);
                    }
                    return { geo: geo, cx: cx, cz: cz, yMode: 'center', isCylinder: true };
                }
            }

            // --- Default box ---
            const geo = new THREE.BoxGeometry(Math.max(0.05, wM), Math.max(0.05, hM), Math.max(0.05, dM));
            let cx, cz;
            if (el.isLine && el.p1 && el.p2) {
                cx = duLocal((el.p1.x + el.p2.x) / 2);
                cz = duLocal((el.p1.y + el.p2.y) / 2);
            } else {
                cx = duLocal(el.x + (el.w || 10) / 2);
                cz = duLocal(el.y + (el.h || 10) / 2);
            }
            return { geo: geo, cx: cx, cz: cz, yMode: 'center', isBox: true };
        }

        function buildThreeScene() {
            if (!threeInitialized) return;
            threeObjects.forEach(obj => scene.remove(obj));
            threeObjects = [];
            const visibleEls = elementsOnDrawingVisible ? elements.filter(el => !el.hidden) : [];
            const s = calibrationFactor || 1;
            let minX = Infinity,
                maxX = -Infinity,
                minZ = Infinity,
                maxZ = -Infinity,
                maxH = 3;
            visibleEls.forEach(el => {
                const color = new THREE.Color(el.color);
                // --- Line walls: solid wall with real openings cut as holes ---
                if (el.type === 'wall' && el.isLine && el.p1 && el.p2) {
                    const builtWall = createWallMeshWithOpenings(el, color, selectedIds.includes(el.id));
                    if (builtWall && builtWall.mesh) {
                        scene.add(builtWall.mesh);
                        threeObjects.push(builtWall.mesh);
                        // Edge outline for clarity
                        try {
                            const edges = new THREE.EdgesGeometry(builtWall.mesh.geometry);
                            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                                color: selectedIds.includes(el.id) ? 0x007aff : 0x333333
                            }));
                            line.position.copy(builtWall.mesh.position);
                            line.rotation.copy(builtWall.mesh.rotation);
                            scene.add(line);
                            threeObjects.push(line);
                        } catch (_) {}
                        // Label sprite
                        try {
                            const labelCanvas = document.createElement('canvas');
                            labelCanvas.width = 256;
                            labelCanvas.height = 64;
                            const lctx = labelCanvas.getContext('2d');
                            lctx.fillStyle = 'rgba(0,0,0,0.55)';
                            lctx.beginPath();
                            lctx.roundRect(0, 0, 256, 64, 10);
                            lctx.fill();
                            lctx.fillStyle = '#fff';
                            lctx.font = 'bold 20px sans-serif';
                            lctx.textAlign = 'center';
                            lctx.textBaseline = 'middle';
                            lctx.fillText(el.label || 'Wall', 128, 32);
                            const texture = new THREE.CanvasTexture(labelCanvas);
                            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
                            sprite.position.set(builtWall.cx, builtWall.wallH + 0.35, builtWall.cz);
                            sprite.scale.set(2.0, 0.5, 1);
                            scene.add(sprite);
                            threeObjects.push(sprite);
                        } catch (_) {}
                        minX = Math.min(minX, builtWall.cx - 1);
                        maxX = Math.max(maxX, builtWall.cx + 1);
                        minZ = Math.min(minZ, builtWall.cz - 1);
                        maxZ = Math.max(maxZ, builtWall.cz + 1);
                        maxH = Math.max(maxH, builtWall.wallH);
                        return; // wall done (openings rendered as holes; still draw opening markers below)
                    }
                }
                // Plan sizes: drawing units → metres via calibration (du)
                // Heights (zHeight) and thickness are already stored in metres.
                let wM = Math.max(0.05, du(el.w || 10));
                let dM = Math.max(0.05, du(el.h || 10));
                const userZ = (typeof el.zHeight === 'number' && isFinite(el.zHeight) && el.zHeight > 0)
                    ? el.zHeight : null;
                let hM = userZ != null ? userZ : 0.5;
                // Doors / windows / openings: height is clear opening height (m), not wall height
                if (el.type === 'door' || el.type === 'window' || el.type === 'opening') {
                    hM = getOpeningHeightM(el);
                }
                let wallAngle = 0;
                if (el.type === 'wall') {
                    // Prefer explicit thickness (m). Fallback: thinner plan side in metres.
                    let thick = (typeof el.thickness === 'number' && el.thickness > 0)
                        ? el.thickness : DEFAULT_WALL_THICKNESS_M;
                    if (!el.isLine && (el.thickness == null)) {
                        const planThinM = Math.min(du(el.w || 10), du(el.h || 10));
                        // Only use drawn thickness if it looks like a wall (5cm–1.2m)
                        if (planThinM >= 0.05 && planThinM <= 1.2) thick = planThinM;
                    }
                    hM = userZ != null ? userZ : 3.0;
                    if (el.isLine && el.length != null) {
                        wM = Math.max(0.05, du(el.length));
                        dM = Math.max(0.05, thick);
                        wallAngle = el.angle || 0;
                    } else if (el.w >= el.h) {
                        dM = Math.max(0.05, thick);
                        wM = Math.max(0.05, du(el.w));
                    } else {
                        wM = Math.max(0.05, thick);
                        dM = Math.max(0.05, du(el.h));
                    }
                }
                if (el.type === 'column') {
                    hM = userZ != null ? userZ : 3.0;
                }
                if (el.type === 'beam') {
                    hM = userZ != null ? userZ : 0.3;
                    const thick = (typeof el.thickness === 'number' && el.thickness > 0)
                        ? el.thickness : 0.2;
                    if (el.isLine && el.length != null) {
                        wM = Math.max(0.05, du(el.length));
                        dM = Math.max(0.05, thick);
                        wallAngle = el.angle || 0;
                    } else if (el.w >= el.h) {
                        dM = Math.max(0.05, thick);
                    } else {
                        wM = Math.max(0.05, thick);
                    }
                }
                if (el.type === 'slab') {
                    hM = userZ != null ? userZ : 0.15;
                }
                const isDed = el.isDeduction || el.type === 'cutout';
                let cx, cz;
                if (el.isLine && el.p1 && el.p2) {
                    cx = du((el.p1.x + el.p2.x) / 2);
                    cz = du((el.p1.y + el.p2.y) / 2);
                } else {
                    cx = du(el.x + (el.w || 10) / 2);
                    cz = du(el.y + (el.h || 10) / 2);
                }
                if (isDed || el.type === 'door' || el.type === 'window' || el.type === 'opening') {
                    // Opening identity marker — wall hole is already cut; show frame + label
                    hM = getOpeningHeightM(el);
                    const sillM = getOpeningSillM(el);
                    const openWM = Math.max(0.15, wM);
                    const openDM = Math.max(0.15, dM);
                    let hostWall = el.parentId != null
                        ? findElementById(el.parentId)
                        : null;
                    if (!hostWall) {
                        hostWall = elements.find(w =>
                            w.type === 'wall' && !w.hidden &&
                            el.x < w.x + w.w && el.x + el.w > w.x &&
                            el.y < w.y + w.h && el.y + el.h > w.y
                        );
                    }
                    let boxW = openWM, boxD = openDM;
                    let wallAngleOpen = 0;
                    if (hostWall && hostWall.isLine && hostWall.p1 && hostWall.p2) {
                        const thick = hostWall.thickness || DEFAULT_WALL_THICKNESS_M;
                        boxD = Math.max(thick + 0.04, 0.12);
                        if (typeof cutoutWidthAlongLine === 'function') {
                            boxW = Math.max(0.2, cutoutWidthAlongLine(hostWall, el) * (calibrationFactor || 1));
                        }
                        wallAngleOpen = hostWall.angle != null
                            ? hostWall.angle
                            : Math.atan2(hostWall.p2.y - hostWall.p1.y, hostWall.p2.x - hostWall.p1.x);
                    } else if (hostWall) {
                        const thick = hostWall.thickness || DEFAULT_WALL_THICKNESS_M;
                        if (hostWall.w >= hostWall.h) { boxD = Math.max(thick + 0.04, 0.12); boxW = openWM; }
                        else { boxW = Math.max(thick + 0.04, 0.12); boxD = openDM; }
                    }
                    // Thin translucent frame (not a solid block filling the hole)
                    const frameThk = 0.04;
                    const geo = new THREE.BoxGeometry(boxW, hM, boxD);
                    const ot = el.openingType || el.type || 'opening';
                    const frameColor = ot === 'door' ? '#c4a35a' : (ot === 'window' ? '#5b9bd5' : '#e07a3d');
                    const mat = new THREE.MeshStandardMaterial({
                        color: new THREE.Color(frameColor),
                        transparent: true,
                        opacity: 0.22,
                        roughness: 0.4,
                        metalness: 0.05,
                        emissive: new THREE.Color(frameColor),
                        emissiveIntensity: selectedIds.includes(el.id) ? 0.45 : 0.12,
                        depthWrite: false,
                        side: THREE.DoubleSide,
                    });
                    const mesh = new THREE.Mesh(geo, mat);
                    const baseY = sillM + hM / 2;
                    mesh.position.set(cx, baseY, cz);
                    if (wallAngleOpen) mesh.rotation.y = -wallAngleOpen;
                    mesh.userData.elementId = el.id;
                    mesh.userData.isOpening = true;
                    mesh.renderOrder = 2;
                    scene.add(mesh);
                    threeObjects.push(mesh);
                    const edges = new THREE.EdgesGeometry(geo);
                    const lineMat = new THREE.LineBasicMaterial({ color: 0xff1a1a, linewidth: 2 });
                    const line = new THREE.LineSegments(edges, lineMat);
                    line.position.copy(mesh.position);
                    line.renderOrder = 3;
                    scene.add(line);
                    threeObjects.push(line);
                    const crossMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true,
                        opacity: 0.9 });
                    const crossPts1 = [
                        new THREE.Vector3(-boxW / 2, -hM / 2, 0),
                        new THREE.Vector3(boxW / 2, hM / 2, 0),
                    ];
                    const crossPts2 = [
                        new THREE.Vector3(boxW / 2, -hM / 2, 0),
                        new THREE.Vector3(-boxW / 2, hM / 2, 0),
                    ];
                    const cross1 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(crossPts1), crossMat);
                    const cross2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(crossPts2), crossMat);
                    cross1.position.copy(mesh.position);
                    cross2.position.copy(mesh.position);
                    if (hostWall && hostWall.w < hostWall.h) {
                        cross1.rotation.y = Math.PI / 2;
                        cross2.rotation.y = Math.PI / 2;
                    }
                    cross1.renderOrder = 4;
                    cross2.renderOrder = 4;
                    scene.add(cross1);
                    scene.add(cross2);
                    threeObjects.push(cross1, cross2);
                    const labelCanvas = document.createElement('canvas');
                    labelCanvas.width = 256;
                    labelCanvas.height = 80;
                    const lctx = labelCanvas.getContext('2d');
                    const otLabel = (el.openingType || el.type || 'opening').toString();
                    const title = otLabel.charAt(0).toUpperCase() + otLabel.slice(1);
                    const wStr = (typeof cutoutWidthAlongLine === 'function' && hostWall && hostWall.isLine)
                        ? (cutoutWidthAlongLine(hostWall, el) * (calibrationFactor || 1)).toFixed(2)
                        : (Math.max(el.w || 0, el.h || 0) * (calibrationFactor || 1)).toFixed(2);
                    const hStr = hM.toFixed(2);
                    const thkStr = hostWall && hostWall.thickness
                        ? Math.round(hostWall.thickness * 1000) + ' mm wall'
                        : '';
                    lctx.fillStyle = otLabel === 'door' ? 'rgba(180,140,60,0.95)'
                        : (otLabel === 'window' ? 'rgba(50,110,180,0.95)' : 'rgba(200,90,40,0.95)');
                    lctx.beginPath();
                    lctx.roundRect(0, 0, 256, 80, 12);
                    lctx.fill();
                    lctx.strokeStyle = '#fff';
                    lctx.lineWidth = 3;
                    lctx.stroke();
                    lctx.fillStyle = '#fff';
                    lctx.font = 'bold 22px sans-serif';
                    lctx.textAlign = 'center';
                    lctx.textBaseline = 'middle';
                    lctx.fillText(title + '  ' + wStr + '×' + hStr + ' m', 128, 28);
                    lctx.font = '16px sans-serif';
                    lctx.fillText((el.label || '') + (thkStr ? ' · ' + thkStr : ''), 128, 58);
                    const texture = new THREE.CanvasTexture(labelCanvas);
                    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true,
                    depthTest: false });
                    const sprite = new THREE.Sprite(spriteMat);
                    sprite.position.set(cx, sillM + hM + 0.5, cz);
                    sprite.scale.set(2.2, 0.7, 1);
                    sprite.renderOrder = 5;
                    scene.add(sprite);
                    threeObjects.push(sprite);
                    minX = Math.min(minX, cx - boxW / 2);
                    maxX = Math.max(maxX, cx + boxW / 2);
                    minZ = Math.min(minZ, cz - boxD / 2);
                    maxZ = Math.max(maxZ, cz + boxD / 2);
                    maxH = Math.max(maxH, sillM + hM + 0.5);
                    return;
                }
                const built = createThreeGeometryForElement(el, wM, dM, hM, wallAngle);
                const geo = built.geo;
                cx = built.cx;
                cz = built.cz;
                const mat = new THREE.MeshStandardMaterial({
                    color: color,
                    transparent: true,
                    opacity: el.locked ? 0.6 : 0.88,
                    roughness: 0.45,
                    metalness: 0.08,
                    emissive: selectedIds.includes(el.id) ? new THREE.Color(0x007aff) : new THREE.Color(
                    0x000000),
                    emissiveIntensity: selectedIds.includes(el.id) ? 0.35 : 0,
                });
                const mesh = new THREE.Mesh(geo, mat);
                // Vertical placement (metres, Y up):
                //  - yMode 'center': mesh origin at mid-height (boxes, cylinders)
                //  - yMode 'bottom': extruded polygons with y from 0..hM
                let posY;
                if (built.yMode === 'bottom') {
                    // Extruded polygon: geometry sits on y=0..hM
                    if (el.type === 'slab') {
                        posY = 0;
                    } else if (el.type === 'beam') {
                        const wallHs = visibleEls
                            .filter(e => e.type === 'wall' && !e.hidden)
                            .map(e => (typeof e.zHeight === 'number' && e.zHeight > 0) ? e.zHeight : 3.0);
                        const storeyH = wallHs.length ? Math.max(...wallHs) : 3.0;
                        if (typeof el.soffitHeight === 'number' && el.soffitHeight >= 0) {
                            posY = el.soffitHeight;
                        } else {
                            posY = Math.max(0, storeyH - hM);
                        }
                    } else if (el.type === 'door' || el.type === 'window' || el.isDeduction || el.type === 'cutout' || el.type === 'opening') {
                        // Bottom of geometry at sill (above FFL) — preserves high-level / ventilation windows
                        posY = getOpeningSillM(el);
                    } else {
                        posY = 0;
                    }
                } else {
                    let baseY = hM / 2;
                    if (el.type === 'slab') {
                        baseY = hM / 2;
                    } else if (el.type === 'beam') {
                        const wallHs = visibleEls
                            .filter(e => e.type === 'wall' && !e.hidden)
                            .map(e => (typeof e.zHeight === 'number' && e.zHeight > 0) ? e.zHeight : 3.0);
                        const storeyH = wallHs.length ? Math.max(...wallHs) : 3.0;
                        if (typeof el.soffitHeight === 'number' && el.soffitHeight >= 0) {
                            baseY = el.soffitHeight + hM / 2;
                        } else {
                            baseY = Math.max(hM / 2, storeyH - hM / 2);
                        }
                    } else if (el.type === 'door' || el.type === 'window' || el.isDeduction || el.type === 'cutout' || el.type === 'opening') {
                        // Center of box at sill + half opening height
                        baseY = getOpeningSillM(el) + hM / 2;
                    }
                    posY = baseY;
                }
                mesh.position.set(cx, posY, cz);
                if (el.isLine && wallAngle && !built.isCylinder && !built.isPolygon) {
                    mesh.rotation.y = -wallAngle;
                }
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData.elementId = el.id;
                scene.add(mesh);
                threeObjects.push(mesh);
                const edges = new THREE.EdgesGeometry(geo);
                const lineMat = new THREE.LineBasicMaterial({
                    color: 0x222222,
                    transparent: true,
                    opacity: 0.25
                });
                const line = new THREE.LineSegments(edges, lineMat);
                line.position.copy(mesh.position);
                line.rotation.copy(mesh.rotation);
                scene.add(line);
                threeObjects.push(line);
                const labelCanvas = document.createElement('canvas');
                labelCanvas.width = 256;
                labelCanvas.height = 64;
                const lctx = labelCanvas.getContext('2d');
                lctx.fillStyle = 'rgba(0,0,0,0.65)';
                lctx.beginPath();
                lctx.roundRect(0, 0, 256, 64, 10);
                lctx.fill();
                lctx.fillStyle = '#fff';
                lctx.font = 'bold 22px sans-serif';
                lctx.textAlign = 'center';
                lctx.textBaseline = 'middle';
                lctx.fillText(el.label, 128, 32);
                const texture = new THREE.CanvasTexture(labelCanvas);
                const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true,
                depthTest: false });
                const sprite = new THREE.Sprite(spriteMat);
                const labelY = (built && built.yMode === 'bottom') ? (posY + hM + 0.4) : (posY + hM / 2 + 0.4);
                sprite.position.set(cx, labelY, cz);
                const sprW = Math.max(1.2, Math.min(4, wM * 0.6));
                sprite.scale.set(sprW, sprW * 0.28, 1);
                scene.add(sprite);
                threeObjects.push(sprite);
                const planMinX = du(el.x);
                const planMaxX = du(el.x + (el.w || 10));
                const planMinZ = du(el.y);
                const planMaxZ = du(el.y + (el.h || 10));
                minX = Math.min(minX, planMinX);
                maxX = Math.max(maxX, planMaxX);
                minZ = Math.min(minZ, planMinZ);
                maxZ = Math.max(maxZ, planMaxZ);
                maxH = Math.max(maxH, (built && built.yMode === 'bottom') ? (posY + hM) : (posY + hM / 2));
            });
            if (!isFinite(minX)) { minX = -5;
                maxX = 5;
                minZ = -5;
                maxZ = 5;
                maxH = 3; }
            rebuildThreeGrid(minX, maxX, minZ, maxZ);
            fitThreeCamera(minX, maxX, 0, maxH, minZ, maxZ);
            threeFitDone = true;
        }

        function animateThree() {
            if (!threeInitialized) return;
            requestAnimationFrame(animateThree);
            controls.update();
            renderer.render(scene, camera);
        }

        function resizeThree() {
            if (!threeInitialized) return;
            const container = document.getElementById('threeContainer');
            const W = container.clientWidth || 600;
            const H = container.clientHeight || 400;
            camera.aspect = W / H;
            camera.updateProjectionMatrix();
            renderer.setSize(W, H);
        }

        function toggleView(view) {
            currentView = view;
            const canvas2d = document.getElementById('canvas2d');
            const threeContainer = document.getElementById('threeContainer');
            const tabs = document.querySelectorAll('.viewer-tabs button');
            tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
            if (view === '2d') {
                canvas2d.classList.remove('hidden');
                threeContainer.classList.remove('active');
                renderCanvas2D();
            } else {
                canvas2d.classList.add('hidden');
                threeContainer.classList.add('active');
                if (!threeInitialized) initThree();
                else { buildThreeScene();
                    resizeThree(); }
            }
        }

        // ----- RENDER PROPERTIES (professional QS panel) -----
        function getElementMetrics(el) {
            const cf = calibrationFactor || 1;
            const cutouts = elements.filter(function (c) {
                if (!(c.isDeduction || c.type === 'cutout')) return false;
                if (c.parentId != null) return sameElementId(c.parentId, el.id);
                return overlapArea(el, c) > 0 && !sameElementId(el.id, c.id);
            });
            let gross = 0,
                cut = 0,
                net = 0,
                lengthM = 0,
                unit = 'm²';
            // Walls: openings + columns + wall–wall overlap (collectWallDeductions)
            if (el.type === 'wall') {
                if (el.isLine && el.p1 && el.p2) {
                    lengthM = Math.hypot(Number(el.p2.x) - Number(el.p1.x), Number(el.p2.y) - Number(el.p1.y)) * cf;
                } else {
                    lengthM = Math.max(el.w || 0, el.h || 0) * cf;
                }
                const heightM = (el.zHeight != null && el.zHeight > 0) ? el.zHeight : 3;
                const face = lengthM * heightM;
                const deds = collectWallDeductions(el);
                let ded = 0;
                deds.forEach(d => { ded += d.deductM2; });
                gross = face;
                cut = ded;
                net = Math.max(0, face - ded);
                unit = 'm²';
                return { gross, cut, net, lengthM, unit, cutoutCount: deds.length, deductions: deds };
            }
            if (el.isLine && el.p1 && el.p2) {
                lengthM = (el.length != null ? el.length : Math.hypot(el.p2.x - el.p1.x, el.p2.y - el.p1.y)) * cf;
                const face = lengthM * (el.zHeight || 3);
                let ded = 0;
                cutouts.forEach(c => {
                    let ow = cutoutWidthAlongLine(el, c);
                    if (ow < 1e-6) ow = Math.max(c.w, c.h);
                    ow *= cf;
                    const oh = Math.max(0.01, c.zHeight || 2.1);
                    ded += ow * oh;
                });
                gross = face;
                cut = ded;
                net = Math.max(0, face - ded);
                unit = 'm²';
            } else if (el.vertices && el.vertices.length >= 3) {
                const abs = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                gross = polygonArea(abs) * cf * cf;
                cutouts.forEach(c => {
                    if (c.vertices && c.vertices.length >= 3) {
                        const ca = c.vertices.map(v => ({ x: c.x + v.x, y: c.y + v.y }));
                        cut += polygonArea(ca) * cf * cf;
                    } else {
                        cut += (Number(c.w) || 0) * (Number(c.h) || 0) * cf * cf;
                    }
                });
                // Keep Properties identical to the live table for overlapping slabs.
                if (el.type === 'slab') {
                        const slabOverlapDeductions = computeSlabSlabOverlapDeductions(
                            elements.filter(s => s && s.type === 'slab' && !s.hidden)
                        );
                        cut += (slabOverlapDeductions[el.id] || 0) * cf * cf;
                        const slabStructuralDeductions = computeSlabStructuralOverlapDeductions(
                            [el],
                            elements.filter(h => h && h.type === 'wall' && !h.hidden),
                            elements.filter(h => h && h.type === 'column' && !h.hidden)
                        );
                        cut += (slabStructuralDeductions[el.id] || 0) * cf * cf;
                }
                net = Math.max(0, gross - cut);
                unit = 'm²';
            } else {
                gross = (Number(el.w) || 0) * (Number(el.h) || 0) * cf * cf;
                cutouts.forEach(c => { cut += Math.min(gross, (Number(c.w) || 0) * (Number(c.h) || 0) * cf * cf); });
                net = Math.max(0, gross - cut);
                if (el.type === 'column') {
                    const vol = el.w * cf * el.h * cf * (el.zHeight || 3);
                    gross = vol;
                    net = vol;
                    cut = 0;
                    unit = 'm³';
                }
                unit = el.type === 'column' ? 'm³' : 'm²';
            }
            return { gross, cut, net, lengthM, unit, cutoutCount: cutouts.length };
        }

        function positionArrowButtons() {
            const qtyPanel = document.getElementById('bottom-panel');
            const propsPanel = document.getElementById('right-panel');
            const qtyBtn = document.getElementById('btnArrowQty');
            const propsBtn = document.getElementById('btnArrowProps');

            if (qtyBtn && qtyPanel && qtyPanel.classList.contains('open')) {
                const r = qtyPanel.getBoundingClientRect();
                // Sit centered on the TOP edge of the quantities table
                qtyBtn.style.bottom = (window.innerHeight - r.top + 6) + 'px';
                qtyBtn.style.top = 'auto';
                qtyBtn.style.left = '50%';
                qtyBtn.style.transform = 'translateX(-50%)';
            } else if (qtyBtn) {
                qtyBtn.style.bottom = '';
                qtyBtn.style.top = '';
                qtyBtn.style.left = '';
                qtyBtn.style.transform = '';
            }

            if (propsBtn && propsPanel && propsPanel.classList.contains('open')) {
                const r = propsPanel.getBoundingClientRect();
                // Left of panel, vertically centered on the panel
                const btnH = propsBtn.offsetHeight || 40;
                propsBtn.style.left = Math.max(8, r.left - propsBtn.offsetWidth - 8) + 'px';
                propsBtn.style.right = 'auto';
                propsBtn.style.top = (r.top + r.height / 2 - btnH / 2) + 'px';
                propsBtn.style.transform = 'none';
            } else if (propsBtn) {
                propsBtn.style.left = '';
                propsBtn.style.right = '';
                propsBtn.style.top = '';
                propsBtn.style.transform = '';
            }
        }

        function syncArrowBtn(id, isOpen) {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.classList.toggle('is-open', !!isOpen);
            // Quantities (bottom): ↑ open, ↓ hide
            // Properties (right): ← open, → hide
            const icon = btn.querySelector('.arrow-icon i');
            if (icon) {
                if (id === 'btnArrowQty') {
                    icon.className = isOpen ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
                } else if (id === 'btnArrowProps') {
                    icon.className = isOpen ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
                }
            }
            // Keep buttons on top of panels
            btn.style.zIndex = '120';
            btn.style.display = 'inline-flex';
            btn.style.visibility = 'visible';
            btn.style.opacity = '1';
            requestAnimationFrame(positionArrowButtons);
        }
        function syncElementsBtn(isOpen) {
            const btn = document.getElementById('btnArrowElements');
            if (!btn) return;
            btn.classList.toggle('is-open', !!isOpen);
            const icon = btn.querySelector('.arrow-icon i');
            if (icon) icon.className = isOpen ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
            btn.style.zIndex = '120';
            btn.style.display = 'inline-flex';
            btn.style.visibility = 'visible';
            btn.style.opacity = '1';
        }
        function openElementsPanel() {
            const panel = document.getElementById('left-panel');
            if (!panel) return;
            panel.classList.remove('collapsed');
            panel.setAttribute('aria-hidden', 'false');
            syncElementsBtn(true);
            requestAnimationFrame(() => { renderAll(); positionArrowButtons(); });
        }
        function closeElementsPanel() {
            const panel = document.getElementById('left-panel');
            if (!panel) return;
            panel.classList.add('collapsed');
            panel.setAttribute('aria-hidden', 'true');
            syncElementsBtn(false);
            requestAnimationFrame(() => { renderAll(); positionArrowButtons(); });
        }
        function toggleElementsPanel() {
            const panel = document.getElementById('left-panel');
            if (panel && panel.classList.contains('collapsed')) openElementsPanel();
            else closeElementsPanel();
        }

        function openPropsPanel() {
            const panel = document.getElementById('right-panel');
            if (!panel) return;
            panel.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            syncArrowBtn('btnArrowProps', true);
        }
        function closePropsPanel() {
            const panel = document.getElementById('right-panel');
            if (!panel) return;
            panel.classList.remove('open');
            panel.setAttribute('aria-hidden', 'true');
            syncArrowBtn('btnArrowProps', false);
        }

        function openQtyPanel() {
            const panel = document.getElementById('bottom-panel');
            if (panel) {
                panel.classList.add('open');
                panel.setAttribute('aria-hidden', 'false');
            }
            syncArrowBtn('btnArrowQty', true);
        }
        function closeQtyPanel() {
            const panel = document.getElementById('bottom-panel');
            if (panel) {
                panel.classList.remove('open');
                panel.setAttribute('aria-hidden', 'true');
            }
            syncArrowBtn('btnArrowQty', false);
        }
        function togglePropsPanel() {
            const panel = document.getElementById('right-panel');
            if (panel && panel.classList.contains('open')) closePropsPanel();
            else {
                openPropsPanel();
                renderProperties();
            }
        }
        function toggleQtyPanel() {
            const panel = document.getElementById('bottom-panel');
            if (panel && panel.classList.contains('open')) closeQtyPanel();
            else openQtyPanel();
        }

        function renderProperties() {
            const container = document.getElementById('props-container');
            if (!container) return;
            if (selectedIds.length === 0) {
                container.innerHTML =
                    `<div style="color:var(--text-secondary);font-size:12px;text-align:center;padding:20px 0;">
                    <i class="fas fa-mouse-pointer" style="font-size:24px;display:block;margin-bottom:8px;"></i>
                    Select a measurement to view properties</div>`;
                // Do not auto-open — user opens via the Properties side button
                return;
            }
            // Update content only; panel stays closed until user clicks Properties.
            // A wall selection intentionally expands to include attached deductions for
            // moving/deleting, but Properties must remain anchored to the primary ID.
            const primary = findElementById(selectedIds[0]);
            const onlyAttachedToPrimary = primary && selectedIds.slice(1).every(function (id) {
                // Children of the primary wall OR the primary itself (type-safe)
                if (sameElementId(id, primary.id)) return true;
                return getAttachedChildIds(primary.id).some(function (childId) { return sameElementId(childId, id); });
            });
            if (selectedIds.length > 1 && !onlyAttachedToPrimary) {
                container.innerHTML =
                    `<div style="color:var(--text-secondary);font-size:12px;padding:10px 0;">
                    <strong>${selectedIds.length}</strong> elements selected<br>
                    <span style="font-size:11px;">Use Delete to remove all.</span></div>`;
                return;
            }
            const el = primary;
            if (!el) return;
            // Auto-estimate wall thickness from underlay hatch when still at default
            // (user drew the wall without an explicit thickness / wall type).
            if (el.type === 'wall' && el.isLine && el.p1 && el.p2 &&
                !el._thicknessAutoDone &&
                (el.thickness == null || Math.abs(el.thickness - DEFAULT_WALL_THICKNESS_M) < 1e-6) &&
                !el.wallType) {
                const est = estimateWallThicknessFromUnderlay(el.p1, el.p2);
                if (est != null) {
                    el.thickness = est;
                    standardizeWallThickness(el);
                    el._thicknessAutoDone = true;
                    try { if (typeof markElementEdited === 'function') markElementEdited(el); } catch (_) {}
                } else {
                    el._thicknessAutoDone = true; // don't retry every frame
                }
            }
            // Cutouts/deductions stay selectable; parent link via parentId only

            // One-shot guidance: openings & beams need elevation / height checks
            try {
                if (!window._mcElevTipShown) window._mcElevTipShown = {};
                if (el.type === 'window' || el.type === 'door') {
                    if (!window._mcElevTipShown.opening) {
                        window._mcElevTipShown.opening = true;
                        const msg = 'Tip: Windows/doors are not always at floor level. Set Elevation above FFL in Properties (presets: Floor, 0.9 m, 1.0 m, 1.2 m).';
                        if (typeof toast === 'function') toast(msg, 'info');
                        else console.info(msg);
                    }
                } else if (el.type === 'beam') {
                    if (!window._mcElevTipShown.beam) {
                        window._mcElevTipShown.beam = true;
                        const msg = 'Tip: Beams have a fixed height. Adjust Depth and Elevation/soffit (m above FFL) in Properties, or use the preset buttons.';
                        if (typeof toast === 'function') toast(msg, 'info');
                        else console.info(msg);
                    }
                }
            } catch (_) {}

            const m = getElementMetrics(el);
            const matNames = Object.keys(materialLibrary);
            const matOptions = matNames.map(name =>
                `<option value="${escapeHtml(String(name))}" ${el.material===name?'selected':''}>${escapeHtml(String(name))}</option>`).join('');
            const typeLabel = el.type.charAt(0).toUpperCase() + el.type.slice(1);

            let html = '';
            html += `<div class="prop-group"><label>Object Type</label><input value="${typeLabel}" disabled /></div>`;
            html += `<div class="prop-group"><label>Label</label><input value="${escapeHtml(el.label)}" id="prop-label" ${isConfirmed?'disabled':''} /></div>`;

            html += `<div class="prop-group"><label>Quantities</label>
                <div class="cost-display">
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span>Gross</span><span>${m.gross.toFixed(3)} ${m.unit}</span></div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;color:var(--danger);"><span>Deduction (${m.cutoutCount})</span><span>− ${m.cut.toFixed(3)} ${m.unit}</span></div>
                    <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-color);padding-top:4px;"><span>Net</span><span class="total">${m.net.toFixed(3)} ${m.unit}</span></div>
                </div></div>`;

            // Wall: Add Deduction + list openings & columns deducted from this wall
            if (el.type === 'wall' && !isConfirmed) {
                html += `<div class="prop-group"><label>Wall deductions</label>
                    <p style="font-size:11px;color:var(--text-secondary);margin:0 0 8px;line-height:1.4;">
                        Columns inside the wall are auto-deducted from net face area. Draw openings or extra deduction regions without changing the wall boundary.
                    </p>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        <button type="button" id="prop-add-deduction" style="font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;color:var(--text-primary);">
                            <i class="fas fa-cut" style="color:#FFD700;"></i> Add Deduction
                        </button>
                        <button type="button" id="prop-add-deduction-line" style="font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;color:var(--text-primary);">
                            <i class="fas fa-slash" style="color:#FFD700;"></i> Deduction along wall
                        </button>
                    </div>
                </div>`;
            }

            // List deductions on this wall/beam with editable opening height
            if (['wall', 'beam', 'slab', 'column'].includes(el.type) && m.cutoutCount > 0) {
                if (el.type === 'wall' && m.deductions && m.deductions.length) {
                    html += `<div class="prop-group"><label>Deductions on this wall (${m.deductions.length})</label>`;
                    m.deductions.forEach(d => {
                        const o = d.source;
                        const kindLabel = d.kind === 'column' ? 'column' : (d.kind === 'wall-overlap' ? 'wall overlap' : (o && (o.openingType || o.type) || 'opening'));
                        const dedIdAttr = o ? ` data-ded-id="${o.id}"` : '';
                        html += `<div class="deduction-card"${dedIdAttr} style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;padding:8px;margin-bottom:6px;">
                            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--danger);">${escapeHtml(d.label)}
                                <span style="font-weight:400;color:var(--text-secondary);text-transform:capitalize;">(${escapeHtml(kindLabel)})</span>
                            </div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">
                                ${d.openWidthM.toFixed(3)} m × ${d.openHeightM.toFixed(3)} m = <strong style="color:var(--danger);">−${d.deductM2.toFixed(3)} m²</strong>
                            </div>`;
                        if (d.kind === 'opening') {
                            html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                                <span style="font-size:10px;color:var(--text-secondary);width:48px;">Height</span>
                                <input type="number" class="prop-ded-height" data-id="${o.id}" value="${(o.zHeight || d.openHeightM).toFixed(3)}" step="0.01" min="0.01" ${isConfirmed?'disabled':''}
                                    style="flex:1;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:3px 6px;border-radius:3px;font-size:12px;" />
                                <span style="font-size:10px;color:var(--text-secondary);">m</span>
                            </div>
                            <button type="button" class="prop-ded-delete" data-id="${o.id}" ${isConfirmed?'disabled':''}
                                style="margin-top:4px;font-size:11px;color:var(--danger);background:transparent;padding:2px 0;cursor:pointer;">
                                <i class="fas fa-trash"></i> Remove deduction
                            </button>`;
                        } else if (d.kind === 'column') {
                            html += `<div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px;">Column kept as separate volume · auto-deducted from wall</div>
                            <label style="font-size:11px;display:flex;align-items:center;gap:6px;cursor:pointer;">
                                <input type="checkbox" class="prop-col-skip-ded" data-id="${o.id}" ${o.skipWallDeduction ? '' : 'checked'} ${isConfirmed?'disabled':''} />
                                Deduct this column from wall net area
                            </label>`;
                        } else {
                            html += `<div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px;">Shared wall junction · overlap deduction is calculated automatically and split between the connected walls.</div>`;
                        }
                        html += `</div>`;
                    });
                    html += `</div>`;
                } else if (el.type !== 'wall') {
                const openingsAll = elements.filter(e =>
                    e.type === 'door' || e.type === 'window' || e.type === 'opening' || e.isDeduction || e.type === 'cutout'
                );
                const hits = getDeductionsOverlapping(el, openingsAll);
                if (hits.length) {
                    html += `<div class="prop-group"><label>Deductions (on this ${el.type})</label>`;
                    hits.forEach(({ opening: o }) => {
                        let openWidthDraw;
                        if (el.isLine) {
                            openWidthDraw = cutoutWidthAlongLine(el, o);
                            if (openWidthDraw < 1e-6) openWidthDraw = Math.max(o.w, o.h);
                        } else {
                            openWidthDraw = Math.max(o.w, o.h);
                        }
                        const openWidthM = openWidthDraw * calibrationFactor;
                        const openHeightM = Math.max(0.01, o.zHeight || 2.1);
                        const deductM2 = openWidthM * openHeightM;
                        html += `<div style="background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;padding:8px;margin-bottom:6px;">
                            <div style="font-size:11px;font-weight:600;margin-bottom:4px;color:var(--danger);">${escapeHtml(o.label || 'Deduction')} <span style="font-weight:400;color:var(--text-secondary);text-transform:capitalize;">(${escapeHtml(o.openingType || 'opening')})</span></div>
                            <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                                <span style="font-size:10px;color:var(--text-secondary);width:48px;">Width</span>
                                <input type="number" value="${openWidthM.toFixed(3)}" disabled style="flex:1;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:3px 6px;border-radius:3px;font-size:12px;" />
                                <span style="font-size:10px;color:var(--text-secondary);">m</span>
                            </div>
                            <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                                <span style="font-size:10px;color:var(--text-secondary);width:48px;">Height</span>
                                <input type="number" value="${openHeightM.toFixed(3)}" id="prop-ded-h-${o.id}" step="0.01" min="0.01" ${isConfirmed?'disabled':''}
                                    style="flex:1;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:3px 6px;border-radius:3px;font-size:12px;" />
                                <span style="font-size:10px;color:var(--text-secondary);">m</span>
                            </div>
                            <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:4px;">
                                <span style="color:var(--text-secondary);">Deducted</span>
                                <span style="color:var(--danger);font-weight:600;">− ${deductM2.toFixed(3)} m²</span>
                            </div>
                            <button type="button" data-ded-id="${o.id}" class="prop-ded-delete" ${isConfirmed?'disabled':''}
                                style="margin-top:6px;font-size:11px;color:var(--danger);background:transparent;padding:2px 0;">
                                <i class="fas fa-trash"></i> Remove deduction
                            </button>
                        </div>`;
                    });
                    html += `</div>`;
                }
                } // else if (el.type !== 'wall')
            }

            if (m.lengthM > 0) {
                html += `<div class="prop-group"><label>Length (m)</label>
                    <input type="number" value="${m.lengthM.toFixed(3)}" id="prop-length" step="0.01" min="0.01" ${isConfirmed?'disabled':''} /></div>`;
            }

            if (el.isLine && el.p1 && el.p2) {
                const angDeg = ((el.angle != null ? el.angle : Math.atan2(el.p2.y - el.p1.y, el.p2.x - el.p1.x)) * 180 / Math.PI);
                html += `<div class="prop-group"><label>Angle</label><input value="${angDeg.toFixed(1)}°" disabled /></div>`;
                if (el.type === 'wall') {
                    const currentWt = resolveWallTypeLabel(el);
                    let wtOpts = WALL_TYPE_OPTIONS.map(function (o) {
                        return `<option value="${escapeHtml(o.value)}" ${o.value === currentWt ? 'selected' : ''}>${escapeHtml(o.value)}</option>`;
                    }).join('');
                    html += `<div class="prop-group"><label>Wall Type</label>
                        <select id="prop-wall-type" ${isConfirmed?'disabled':''}>${wtOpts}</select>
                        <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Sets thickness & masonry class. Manual override is saved.</div></div>`;
                }
                html += `<div class="prop-group"><label>Thickness (m)</label><input type="number" value="${el.thickness || DEFAULT_WALL_THICKNESS_M}" id="prop-thk" step="0.01" min="0.05" ${isConfirmed?'disabled':''} /></div>`;
            } else if (!el.isLine) {
                html += `<div class="prop-group"><div class="row">
                    <div><label>Width (units)</label><input type="number" value="${el.w.toFixed(1)}" id="prop-w" step="1" ${isConfirmed?'disabled':''} /></div>
                    <div><label>Height (units)</label><input type="number" value="${el.h.toFixed(1)}" id="prop-h" step="1" ${isConfirmed?'disabled':''} /></div>
                </div></div>`;
            }

            if (el.type === 'door' || el.type === 'window') {
                const openH = (el.zHeight != null && el.zHeight > 0) ? el.zHeight : (el.type === 'window' ? 1.2 : 2.1);
                const sill = (el.sillHeight != null && el.sillHeight >= 0) ? el.sillHeight : (el.type === 'window' ? 0.9 : 0);
                html += `<div class="prop-group"><label>Opening height (m)</label><input type="number" value="${openH}" id="prop-z" step="0.01" min="0.01" ${isConfirmed?'disabled':''} /></div>`;
                html += `<div class="prop-group"><label>Elevation above FFL (m)</label>
                    <input type="number" value="${sill}" id="prop-sill" step="0.01" min="0" ${isConfirmed?'disabled':''} />
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
                        <button type="button" class="elev-preset" data-elev="0" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>Floor (0)</button>
                        <button type="button" class="elev-preset" data-elev="0.9" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>0.9 m</button>
                        <button type="button" class="elev-preset" data-elev="1.0" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>1.0 m</button>
                        <button type="button" class="elev-preset" data-elev="1.2" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>1.2 m</button>
                    </div>
                    <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Windows are not always at floor level — pick a preset or type the elevation from the drawing. Doors are usually 0.</div></div>`;
            } else if (!['door', 'window'].includes(el.type)) {
                let zLabel = 'Height (m)';
                if (el.type === 'slab') zLabel = 'Thickness (m)';
                if (el.type === 'beam') zLabel = 'Depth (m)';
                if (el.isDeduction || el.type === 'cutout') zLabel = 'Opening height (m)';
                html += `<div class="prop-group"><label>${zLabel}</label><input type="number" value="${el.zHeight}" id="prop-z" step="0.01" min="0.01" ${isConfirmed?'disabled':''} /></div>`;
                if (el.type === 'beam') {
                    const sof = (el.soffitHeight != null && el.soffitHeight >= 0) ? el.soffitHeight : '';
                    html += `<div class="prop-group"><label>Elevation / soffit (m above FFL)</label>
                        <input type="number" value="${sof}" id="prop-soffit" step="0.01" min="0" placeholder="auto from walls" ${isConfirmed?'disabled':''} />
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
                            <button type="button" class="elev-preset-soffit" data-elev="" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>Auto</button>
                            <button type="button" class="elev-preset-soffit" data-elev="2.1" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>2.1 m</button>
                            <button type="button" class="elev-preset-soffit" data-elev="2.4" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>2.4 m</button>
                            <button type="button" class="elev-preset-soffit" data-elev="2.7" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>2.7 m</button>
                            <button type="button" class="elev-preset-soffit" data-elev="3.0" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-hover);cursor:pointer;" ${isConfirmed?'disabled':''}>3.0 m</button>
                        </div>
                        <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Beams sit at a fixed height. Set underside elevation above finished floor, or leave Auto to place under typical wall height. Adjust depth above if needed.</div></div>`;
                }
                if (el.isDeduction || el.type === 'cutout') {
                    const otVal = el.openingType || 'opening';
                    html += `<div class="prop-group"><label>Opening Type</label>
                        <select id="prop-opening-type" ${isConfirmed?'disabled':''}>
                            <option value="door" ${otVal==='door'?'selected':''}>Door</option>
                            <option value="window" ${otVal==='window'?'selected':''}>Window</option>
                            <option value="opening" ${otVal==='opening'?'selected':''}>Opening (other)</option>
                        </select>
                        <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Sets how this deduction is counted in the Quantity / Live Quantities tables (Doors, Windows, or Openings).</div></div>`;
                    const depthVal = el.depth != null ? el.depth : '';
                    const sillC = (el.sillHeight != null && el.sillHeight >= 0) ? el.sillHeight : 0;
                    html += `<div class="prop-group"><label>Sill / invert height (m above FFL)</label>
                        <input type="number" value="${sillC}" id="prop-sill" step="0.01" min="0" ${isConfirmed?'disabled':''} /></div>`;
                    html += `<div class="prop-group"><label>Depth (m) — leave empty for m², set for m³</label>
                        <input type="number" value="${depthVal}" id="prop-depth" step="0.01" min="0" placeholder="optional" ${isConfirmed?'disabled':''} /></div>`;
                }
            }

            html += `<div class="prop-group"><label>Material</label><select id="prop-material" ${isConfirmed?'disabled':''}><option value="">None</option>${matOptions}</select></div>`;
            html += `<div class="prop-group"><label>Layer</label><select id="prop-layer" ${isConfirmed?'disabled':''}>${layers.map(l => `<option value="${l}" ${el.layer===l?'selected':''}>${l}</option>`).join('')}</select></div>`;
            html += `<div class="prop-group"><label>Color</label><input type="color" id="prop-color" value="${el.color || '#4a8fe0'}" ${isConfirmed?'disabled':''} style="width:100%;height:28px;padding:2px;border:1px solid var(--border-color);border-radius:4px;" /></div>`;
            html += `<div class="prop-group checkbox-row"><input type="checkbox" id="prop-locked" ${el.locked?'checked':''} ${isConfirmed?'disabled':''} /><label for="prop-locked">Locked</label></div>`;
            html += `<div class="prop-group checkbox-row"><input type="checkbox" id="prop-hidden" ${el.hidden?'checked':''} ${isConfirmed?'disabled':''} /><label for="prop-hidden">Hidden</label></div>`;
            if (el.parentId) {
                const parent = findElementById(el.parentId);
                html += `<div class="prop-group"><label>Parent</label><input value="${parent ? parent.label : el.parentId}" disabled /></div>`;
            }
            html += `<div class="prop-group" style="display:flex;gap:8px;margin-top:8px;">
                <button style="background:var(--bg-hover);padding:4px 12px;border-radius:4px;color:var(--text-primary);" id="prop-delete-btn" ${isConfirmed?'disabled':''}><i class="fas fa-trash"></i> Delete</button>
            </div>`;

            container.innerHTML = html;
            if (isConfirmed) return;
            // Soft refresh while typing: update canvas/3D/qty WITHOUT rebuilding the
            // properties panel (which would steal focus and make digits/Backspace
            // hit global shortcuts → switch to 3D or delete the element).
            const softRefresh = () => {
                // Skip renderTree while typing — avoids any focus side-effects
                try { renderCanvas2D(); } catch (_) {}
                try { renderQuantityTable(); } catch (_) {}
                try { updateStatusBarMeta(); } catch (_) {}
                // Keep 3D mesh in sync so thickness looks correct when switching views
                if (threeInitialized) {
                    try { buildThreeScene(); } catch (_) {}
                }
                // Propagate live dimension edits into research/dashboard totals
                try { scheduleResearchQuantitySync(); } catch (_) {}
            };
            const markManualIfEdited = () => {
                // User is editing an AI element → AI_EDITED (kept on re-detect)
                markElementEdited(el);
            };
            const attachChange = (id, setter) => {
                const inp = document.getElementById(id);
                if (!inp) return;
                // Belt-and-suspenders: never let canvas shortcuts fire while focused here
                inp.addEventListener('keydown', (ev) => {
                    ev.stopPropagation();
                });
                const applyLive = () => {
                    setter(inp);
                    markManualIfEdited();
                    softRefresh();
                };
                const applyCommit = () => {
                    setter(inp);
                    markManualIfEdited();
                    saveState();
                    // Full render is safe on change (focus usually leaves the field)
                    renderAll();
                };
                inp.addEventListener('change', applyCommit);
                // Live preview in 3D while editing numeric props (height/thickness/size)
                if (id === 'prop-z' || id === 'prop-thk' || id === 'prop-w' || id === 'prop-h' || id === 'prop-length' || id === 'prop-depth' || id === 'prop-sill' || id === 'prop-soffit') {
                    inp.addEventListener('input', applyLive);
                }
            };
            container.querySelectorAll('.prop-ded-height').forEach(inp => {
                inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); });
                const apply = () => {
                    const dedId = parseInt(inp.dataset.id, 10);
                    const ded = elements.find(e => e.id === dedId);
                    if (!ded) return;
                    saveState();
                    ded.zHeight = Math.max(0.01, parseFloat(inp.value) || 0.1);
                    markElementEdited(ded);
                    renderAll();
                };
                inp.addEventListener('change', apply);
            });
            container.querySelectorAll('[id^="prop-ded-h-"]').forEach(inp => {
                inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); });
                const applyDedLive = () => {
                    const dedId = parseInt(inp.id.replace('prop-ded-h-', ''), 10);
                    const ded = elements.find(e => e.id === dedId);
                    if (ded) {
                        ded.zHeight = Math.max(0.01, parseFloat(inp.value) || 0.1);
                        markElementEdited(ded);
                        softRefresh();
                    }
                };
                inp.addEventListener('input', applyDedLive);
                inp.addEventListener('change', () => {
                    const dedId = parseInt(inp.id.replace('prop-ded-h-', ''), 10);
                    const ded = elements.find(e => e.id === dedId);
                    if (ded) {
                        saveState();
                        ded.zHeight = Math.max(0.01, parseFloat(inp.value) || 0.1);
                        markElementEdited(ded);
                        renderAll();
                    }
                });
            });
            container.querySelectorAll('.prop-ded-delete').forEach(btn => {
                btn.addEventListener('click', () => {
                    const dedId = parseInt(btn.dataset.dedId || btn.dataset.id, 10);
                    if (!dedId) return;
                    saveState();
                    elements.forEach(e => {
                        if (e.cutouts) e.cutouts = e.cutouts.filter(cid => cid !== dedId);
                    });
                    const removedDeduction = elements.find(e => e.id === dedId);
                    elements = elements.filter(e => e.id !== dedId);
                    if (removedDeduction) {
                        try { if (window.MCResearch && MCResearch.notifyElementChange) MCResearch.notifyElementChange('delete', removedDeduction, { mode: 'pro' }); } catch (_) {}
                    }
                    renderAll();
                });
            });
            container.querySelectorAll('.prop-col-skip-ded').forEach(cb => {
                cb.addEventListener('change', () => {
                    const colId = parseInt(cb.dataset.id, 10);
                    const col = elements.find(e => e.id === colId);
                    if (!col) return;
                    saveState();
                    col.skipWallDeduction = !cb.checked;
                    markElementEdited(col);
                    renderAll();
                });
            });
            const startWallDeduction = (mode) => {
                pendingDeductionParentId = el.id;
                deductionParentId = el.id;
                deductionTargetLocked = true;
                hoveredParentId = el.id;
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                if (mode === 'line') {
                    currentTool = 'deduction_wall';
                    const btn = document.getElementById('toolDeductionWall');
                    if (btn) btn.classList.add('tool-active');
                    document.getElementById('statusMode').textContent =
                        `Deduction on ${el.label}: click along the wall (snap) · Enter to finish`;
                } else {
                    currentTool = 'cutout';
                    const btn = document.getElementById('toolCutout');
                    if (btn) btn.classList.add('tool-active');
                    document.getElementById('statusMode').textContent =
                        `Deduction on ${el.label}: click polygon around column/opening · Enter to finish`;
                }
                document.getElementById('canvas2d').style.cursor = 'crosshair';
                polygonPoints = [];
                deductionLinePoints = [];
                renderCanvas2D();
            };
            const addDedBtn = document.getElementById('prop-add-deduction');
            if (addDedBtn) addDedBtn.addEventListener('click', () => startWallDeduction('poly'));
            const addDedLineBtn = document.getElementById('prop-add-deduction-line');
            if (addDedLineBtn) addDedLineBtn.addEventListener('click', () => startWallDeduction('line'));
            attachChange('prop-label', (inp) => { el.label = String(inp.value || el.label || '').slice(0, 200); });
            attachChange('prop-opening-type', (inp) => {
                const typeNames = { door: 'Door', window: 'Window', opening: 'Opening' };
                const oldName = typeNames[el.openingType || 'opening'];
                el.openingType = inp.value;
                // Auto-update the label if it still looks like the auto-generated
                // default, so renamed/custom labels are left untouched.
                const parentEl = el.parentId ? findElementById(el.parentId) : null;
                const parentLabel = parentEl ? parentEl.label : '';
                if (!el.label || el.label === `${oldName} → ${parentLabel}` || /^Deduction → /.test(el.label) || /^(Door|Window|Opening) → /.test(el.label)) {
                    el.label = parentLabel ? `${typeNames[inp.value]} → ${parentLabel}` : typeNames[inp.value];
                }
            });
            attachChange('prop-w', (inp) => {
                const newW = Math.max(5, parseFloat(inp.value) || 10);
                if (el.vertices && el.w > 0) {
                    const sx = newW / el.w;
                    el.vertices = el.vertices.map(v => ({ x: v.x * sx, y: v.y }));
                }
                el.w = newW;
            });
            attachChange('prop-h', (inp) => {
                const newH = Math.max(5, parseFloat(inp.value) || 10);
                if (el.vertices && el.h > 0) {
                    const sy = newH / el.h;
                    el.vertices = el.vertices.map(v => ({ x: v.x, y: v.y * sy }));
                }
                el.h = newH;
            });
            attachChange('prop-z', (inp) => { el.zHeight = Math.max(0.01, parseFloat(inp.value) || 0.1); });
            attachChange('prop-sill', (inp) => {
                const v = parseFloat(inp.value);
                el.sillHeight = (inp.value === '' || isNaN(v) || v < 0) ? 0 : v;
            });
            attachChange('prop-soffit', (inp) => {
                const v = parseFloat(inp.value);
                if (inp.value === '' || isNaN(v) || v < 0) el.soffitHeight = null;
                else el.soffitHeight = v;
            });
            container.querySelectorAll('.elev-preset').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (isConfirmed) return;
                    const v = parseFloat(btn.dataset.elev);
                    el.sillHeight = isNaN(v) ? 0 : Math.max(0, v);
                    const inp = document.getElementById('prop-sill');
                    if (inp) inp.value = el.sillHeight;
                    markElementEdited(el);
                    renderAll();
                });
            });
            container.querySelectorAll('.elev-preset-soffit').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (isConfirmed) return;
                    const raw = btn.dataset.elev;
                    if (raw === '' || raw == null) {
                        el.soffitHeight = null;
                    } else {
                        const v = parseFloat(raw);
                        el.soffitHeight = isNaN(v) ? null : Math.max(0, v);
                    }
                    const inp = document.getElementById('prop-soffit');
                    if (inp) inp.value = (el.soffitHeight != null) ? el.soffitHeight : '';
                    markElementEdited(el);
                    renderAll();
                });
            });
            attachChange('prop-depth', (inp) => {
                const v = parseFloat(inp.value);
                if (inp.value === '' || isNaN(v) || v <= 0) {
                    el.depth = null;
                } else {
                    el.depth = v;
                }
            });
            attachChange('prop-thk', (inp) => {
                const m = Math.max(0.05, parseFloat(inp.value) || 0.15);
                // Always update metres + drawing-unit stroke for walls AND beams
                setLineThicknessMeters(el, m);
                if (el.type === 'wall') {
                    // Snap to standard construction thickness (159→150, 224→225, …)
                    standardizeWallThickness(el);
                    if (inp) inp.value = String(el.thickness);
                    realignAttachedDeductionsToWall(el);
                }
                if (el.isLine) syncLineBounds(el);
                // Force 2D redraw even if softRefresh path is skipped
                try { renderCanvas2D(); } catch (_) {}
            });
            const wallTypeSel = document.getElementById('prop-wall-type');
            if (wallTypeSel) {
                wallTypeSel.addEventListener('change', () => {
                    if (isConfirmed) return;
                    const val = wallTypeSel.value;
                    el.wallType = val;
                    const opt = WALL_TYPE_OPTIONS.find(function (o) { return o.value === val; });
                    if (opt) {
                        setLineThicknessMeters(el, opt.thicknessM);
                        // Also set material hint for BOQ brick/block split
                        if (opt.kind === 'brick') {
                            if (!el.material || /block/i.test(String(el.material))) el.material = 'Brick';
                        } else {
                            const blockName = 'Block ' + Math.round(opt.thicknessM * 1000) + 'mm';
                            if (!el.material || /brick/i.test(String(el.material))) el.material = blockName;
                        }
                        if (el.isLine) syncLineBounds(el);
                        syncAttachedDeductionThickness(el);
                        realignAttachedDeductionsToWall(el);
                    }
                    markElementEdited(el);
                    saveState();
                    renderAll();
                });
            }
            attachChange('prop-length', (inp) => {
                if (!el.isLine || !el.p1 || !el.p2) return;
                const newLenM = Math.max(0.01, parseFloat(inp.value) || 0.1);
                const newLen = toDrawing(newLenM);
                const ang = el.angle != null ? el.angle : Math.atan2(el.p2.y - el.p1.y, el.p2.x - el.p1.x);
                const cx = (el.p1.x + el.p2.x) / 2,
                    cy = (el.p1.y + el.p2.y) / 2;
                el.p1 = { x: cx - Math.cos(ang) * newLen / 2, y: cy - Math.sin(ang) * newLen / 2 };
                el.p2 = { x: cx + Math.cos(ang) * newLen / 2, y: cy + Math.sin(ang) * newLen / 2 };
                syncLineBounds(el);
                if (el.type === 'wall') realignAttachedDeductionsToWall(el);
            });
            attachChange('prop-color', (inp) => { el.color = inp.value; });
            const layerSel = document.getElementById('prop-layer');
            if (layerSel) layerSel.addEventListener('change', () => { el.layer = layerSel.value;
                saveState();
                renderAll(); });
            const matSel = document.getElementById('prop-material');
            if (matSel) matSel.addEventListener('change', () => {
                el.material = matSel.value || null;
                try { if (typeof markElementEdited === 'function') markElementEdited(el); } catch (_) {}
                saveState();
                renderAll();
                try { renderQuantityTable(); } catch (_) {}
            });
            const lockCb = document.getElementById('prop-locked');
            if (lockCb) lockCb.addEventListener('change', () => { el.locked = lockCb.checked;
                saveState();
                renderAll(); });
            const hiddenCb = document.getElementById('prop-hidden');
            if (hiddenCb) hiddenCb.addEventListener('change', () => { el.hidden = hiddenCb.checked;
                saveState();
                renderAll(); });
            const delBtn = document.getElementById('prop-delete-btn');
            if (delBtn) delBtn.addEventListener('click', () => deleteSelected());
        }

        /** Headers for Gemini-backed APIs. Optional token from localStorage.mc-api-token or env demo. */
        function mcApiHeaders(json) {
            const h = {};
            if (json) h['Content-Type'] = 'application/json';
            try {
                const tok = localStorage.getItem('mc-api-token') || sessionStorage.getItem('mc-api-token');
                if (tok) h['X-MC-Token'] = tok;
            } catch (_) {}
            return h;
        }

        function escapeHtml(str) {
            if (str == null) return '';
            const d = document.createElement('div');
            d.textContent = String(str);
            return d.innerHTML;
        }

        // ----- COST & QUANTITY (unchanged) -----
        function getMaterialCost(materialName) {
            if (!materialName) return null;
            const lib = materialLibrary[materialName];
            return lib ? lib.cost : null;
        }

        function getElementCost(el) {
            if (el.costOverride !== null && el.costOverride !== undefined) return el.costOverride;
            const s = calibrationFactor;
            if (el.material) {
                const cost = getMaterialCost(el.material);
                if (cost !== null) {
                    const area = el.w * s * el.h * s;
                    const vol = area * (el.zHeight || 0.15);
                    return cost * vol;
                }
            }
            const area = el.w * s * el.h * s;
            const vol = area * (el.zHeight || 0.15);
            switch (el.type) {
                case 'wall':
                    return vol * 120;
                case 'column':
                    return vol * 140;
                case 'slab':
                    return vol * 110;
                case 'beam':
                    return vol * 130;
                case 'door':
                    return 150;
                case 'window':
                    return 120;
                default:
                    return area * 20;
            }
        }

        function overlapArea(a, b) {
            const x1 = Math.max(a.x, b.x);
            const y1 = Math.max(a.y, b.y);
            const x2 = Math.min(a.x + a.w, b.x + b.w);
            const y2 = Math.min(a.y + a.h, b.y + b.h);
            if (x2 <= x1 || y2 <= y1) return 0;
            return (x2 - x1) * (y2 - y1);
        }

        /**
         * Approximate overlapping length of two line walls (drawing units).
         * Handles T-junctions, crosses, and collinear overlaps.
         * Returns the length along the walls that is double-counted (≈ thickness
         * of the crossing wall for a T/cross junction).
         */
        function wallWallOverlapLengthDraw(a, b) {
            if (!a || !b || a.id === b.id) return 0;
            if (!(a.isLine && a.p1 && a.p2 && b.isLine && b.p1 && b.p2)) {
                const oa = overlapArea(a, b);
                if (oa <= 0) return 0;
                const aw = a.w || 1, ah = a.h || 1;
                return Math.min(aw, ah, Math.sqrt(oa));
            }
            const thkA = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(a) : 8);
            const thkB = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(b) : 8);
            const halfA = thkA / 2 + 2;
            const halfB = thkB / 2 + 2;
            const tol = Math.max(halfA, halfB);

            const ax = a.p1.x, ay = a.p1.y, bx = a.p2.x, by = a.p2.y;
            const abx = bx - ax, aby = by - ay;
            const lenA = Math.hypot(abx, aby) || 1;
            const uxA = abx / lenA, uyA = aby / lenA;

            const cx = b.p1.x, cy = b.p1.y, dx = b.p2.x, dy = b.p2.y;
            const cdx = dx - cx, cdy = dy - cy;
            const lenB = Math.hypot(cdx, cdy) || 1;
            const uxB = cdx / lenB, uyB = cdy / lenB;

            // Cross product magnitude ~ sin(angle); near 0 = parallel
            const cross = uxA * uyB - uyA * uxB;
            const absCross = Math.abs(cross);

            // --- Perpendicular / angled junction (T or cross) ---
            if (absCross > 0.25) {
                // Intersection of infinite lines, then clamp to both segments (with thickness pad)
                const denom = abx * cdy - aby * cdx;
                if (Math.abs(denom) < 1e-12) return 0;
                const t = ((cx - ax) * cdy - (cy - ay) * cdx) / denom;
                const u = ((cx - ax) * aby - (cy - ay) * abx) / denom;
                const padT = (thkB / 2 + 2) / lenA;
                const padU = (thkA / 2 + 2) / lenB;
                if (t < -padT || t > 1 + padT || u < -padU || u > 1 + padU) return 0;
                // Deduct the physical shared thickness, not the clamped visual
                // stroke width. This matters at test scale (1 drawing unit = 1 m),
                // where a 0.20 m wall is visually clamped to 0.80 drawing units.
                const cf = (typeof calibrationFactor === 'number' && calibrationFactor > 0) ? calibrationFactor : 1;
                const physA = (typeof a.thickness === 'number' && a.thickness > 0) ? a.thickness / cf : thkA;
                const physB = (typeof b.thickness === 'number' && b.thickness > 0) ? b.thickness / cf : thkB;
                return Math.min(physA, physB) > 0 ? Math.min(physA, physB) : tol;
            }

            // --- Parallel / collinear overlap ---
            // Distance between centerlines
            const midBx = (cx + dx) / 2, midBy = (cy + dy) / 2;
            const dist = Math.abs((midBx - ax) * (-uyA) + (midBy - ay) * uxA);
            if (dist > tol) return 0;
            // Project B endpoints onto A
            let t0 = ((cx - ax) * uxA + (cy - ay) * uyA);
            let t1 = ((dx - ax) * uxA + (dy - ay) * uyA);
            if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
            const o0 = Math.max(0, t0);
            const o1 = Math.min(lenA, t1);
            return Math.max(0, o1 - o0);
        }

        /**
         * Map of wallId → overlap length (drawing units) assigned to that wall.
         * Each shared wall–wall region is assigned to one owner only, so the
         * combined gross quantity counts the union exactly once.
         */
        function computeWallWallOverlapDeductions(walls) {
            const deduct = {};
            for (let i = 0; i < walls.length; i++) {
                for (let j = i + 1; j < walls.length; j++) {
                    const a = walls[i], b = walls[j];
                    if (a.hidden || b.hidden) continue;
                    const ol = wallWallOverlapLengthDraw(a, b);
                    if (ol <= 1e-6) continue;
                    // Assign the shared junction to exactly one wall. The lower
                    // array index keeps ownership stable while ensuring the union
                    // total is gross(A)+gross(B)-one_overlap, not two deductions.
                    deduct[b.id] = (deduct[b.id] || 0) + ol;
                }
            }
            return deduct;
        }

        /**
         * Map of slabId → overlap plan area (drawing units²) assigned to that slab.
         * Each shared slab region is assigned to one owner only.
         */
        function getAbsolutePlanVertices(el) {
            if (!el || !Array.isArray(el.vertices) || el.vertices.length < 3) return null;
            return el.vertices.map(v => ({ x: (el.x || 0) + Number(v.x || 0), y: (el.y || 0) + Number(v.y || 0) }));
        }

        // Exact intersection area for convex slab polygons. Legacy rectangles use
        // the existing AABB fallback so old saved projects remain compatible.
        function polygonIntersectionArea(aPts, bPts) {
            if (!aPts || !bPts || aPts.length < 3 || bPts.length < 3) return 0;
            let output = aPts.slice();
            const signed = pts => pts.reduce((s, p, i) => {
                const q = pts[(i + 1) % pts.length];
                return s + p.x * q.y - q.x * p.y;
            }, 0);
            const clip = signed(bPts) >= 0 ? bPts : bPts.slice().reverse();
            const inside = (p, a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
            const intersect = (s, e, a, b) => {
                const dx1 = e.x - s.x, dy1 = e.y - s.y;
                const dx2 = b.x - a.x, dy2 = b.y - a.y;
                const den = dx1 * dy2 - dy1 * dx2;
                if (Math.abs(den) < 1e-12) return { x: e.x, y: e.y };
                const t = ((a.x - s.x) * dy2 - (a.y - s.y) * dx2) / den;
                return { x: s.x + t * dx1, y: s.y + t * dy1 };
            };
            clip.forEach((a, i) => {
                if (!output.length) return;
                const b = clip[(i + 1) % clip.length], input = output;
                output = [];
                let s = input[input.length - 1];
                input.forEach(e => {
                    const ein = inside(e, a, b), sin = inside(s, a, b);
                    if (ein) { if (!sin) output.push(intersect(s, e, a, b)); output.push(e); }
                    else if (sin) output.push(intersect(s, e, a, b));
                    s = e;
                });
            });
            return output.length >= 3 ? polygonArea(output) : 0;
        }

        function planOverlapArea(a, b) {
            const ap = getAbsolutePlanVertices(a), bp = getAbsolutePlanVertices(b);
            if (ap && bp) return polygonIntersectionArea(ap, bp);
            return overlapArea(a, b);
        }

        function computeSlabSlabOverlapDeductions(slabs) {
            const deduct = {};
            for (let i = 0; i < slabs.length; i++) {
                for (let j = i + 1; j < slabs.length; j++) {
                    const a = slabs[i], b = slabs[j];
                    if (a.hidden || b.hidden) continue;
                    const oa = planOverlapArea(a, b);
                    if (oa <= 1e-6) continue;
                    // Assign the complete shared plan area to the later slab only.
                    // This counts the overlap once in the combined slab quantity.
                    deduct[b.id] = (deduct[b.id] || 0) + oa;
                }
            }
            return deduct;
        }

        function getWallFootprintVertices(wall) {
            if (!wall) return null;
            if (wall.isLine && wall.p1 && wall.p2) {
                const cf = (typeof calibrationFactor === 'number' && calibrationFactor > 0) ? calibrationFactor : 1;
                const physicalThicknessM = (typeof wall.thickness === 'number' && wall.thickness > 0)
                    ? wall.thickness : ((typeof DEFAULT_WALL_THICKNESS_M === 'number') ? DEFAULT_WALL_THICKNESS_M : 0.15);
                // Use physical thickness for quantity footprints. Visual strokes are
                // intentionally clamped for visibility and must not inflate slab area.
                const t = Math.max(0.001, physicalThicknessM / cf) / 2;
                const dx = wall.p2.x - wall.p1.x, dy = wall.p2.y - wall.p1.y;
                const len = Math.hypot(dx, dy) || 1;
                const nx = -dy / len, ny = dx / len;
                return [
                    { x: wall.p1.x + nx * t, y: wall.p1.y + ny * t },
                    { x: wall.p2.x + nx * t, y: wall.p2.y + ny * t },
                    { x: wall.p2.x - nx * t, y: wall.p2.y - ny * t },
                    { x: wall.p1.x - nx * t, y: wall.p1.y - ny * t }
                ];
            }
            if (wall.x != null && wall.y != null && wall.w != null && wall.h != null) {
                return [
                    { x: wall.x, y: wall.y }, { x: wall.x + wall.w, y: wall.y },
                    { x: wall.x + wall.w, y: wall.y + wall.h }, { x: wall.x, y: wall.y + wall.h }
                ];
            }
            return null;
        }

        function getElementPlanVertices(el) {
            const own = getAbsolutePlanVertices(el);
            if (own) return own;
            return getWallFootprintVertices(el);
        }

        function computeSlabHostOverlapDeductions(slabs, hosts) {
            const deduct = {};
            slabs.forEach(slab => {
                if (!slab || slab.hidden) return;
                const slabPts = getElementPlanVertices(slab);
                hosts.forEach(host => {
                    if (!host || host.hidden || host.id === slab.id) return;
                    const hostPts = getElementPlanVertices(host);
                    const area = slabPts && hostPts ? polygonIntersectionArea(slabPts, hostPts) : overlapArea(slab, host);
                    if (area > 1e-6) deduct[slab.id] = (deduct[slab.id] || 0) + area;
                });
            });
            return deduct;
        }

        // Structural hosts are a union, not independent deductions. In particular,
        // a column that lies inside a wall must not cause the slab to lose the same
        // footprint twice. Pairwise inclusion-exclusion removes that duplicate.
        function computeSlabStructuralOverlapDeductions(slabs, walls, columns) {
            const result = computeSlabHostOverlapDeductions(slabs, walls);
            const columnOnly = computeSlabHostOverlapDeductions(slabs, columns);
            slabs.forEach(slab => {
                let area = (result[slab.id] || 0) + (columnOnly[slab.id] || 0);
                const slabPts = getElementPlanVertices(slab);
                (columns || []).forEach(col => {
                    if (!col || col.hidden) return;
                    const colPts = getElementPlanVertices(col);
                    (walls || []).forEach(wall => {
                        if (!wall || wall.hidden) return;
                        const wallPts = getElementPlanVertices(wall);
                        if (!slabPts || !colPts || !wallPts) return;
                        const colWall = polygonIntersectionArea(colPts, wallPts);
                        if (colWall <= 1e-6) return;
                        // For the common column-inside-wall case, remove the part
                        // counted by both host categories from the slab union.
                        const slabCol = polygonIntersectionArea(slabPts, colPts);
                        const slabWall = polygonIntersectionArea(slabPts, wallPts);
                        if (slabCol > 0 && slabWall > 0) area -= Math.min(slabCol, slabWall, colWall);
                    });
                });
                if (area > 1e-6) result[slab.id] = area;
                else delete result[slab.id];
            });
            return result;
        }

        function getDeductionsOverlapping(el, openingsAll) {
            const hits = [];
            openingsAll.forEach(function (o) {
                // Deductions with an explicit parent belong ONLY to that wall
                if (o.parentId != null && !sameElementId(o.parentId, el.id)) return;
                if (o.parentId != null && sameElementId(o.parentId, el.id)) {
                    hits.push({ opening: o, areaDraw: Math.max((o.w || 0) * (o.h || 0), 1) });
                    return;
                }
                const oa = overlapArea(el, o);
                if (oa > 0) hits.push({ opening: o, areaDraw: oa });
            });
            return hits;
        }

        /**
         * True if a column (or other rect) intersects a wall in plan.
         * Line walls use thickness buffer; rect walls use AABB overlap.
         */
        function elementIntersectsWall(wall, other) {
            if (!wall || !other || wall.id === other.id || other.hidden) return false;
            if (other.skipWallDeduction) return false;
            if (wall.isLine && wall.p1 && wall.p2) {
                const thk = (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(wall) : 8) / 2 + 2;
                let pts = [];
                if (other.vertices && other.vertices.length >= 3) {
                    pts = other.vertices.map(v => ({ x: other.x + v.x, y: other.y + v.y }));
                } else {
                    pts = [
                        { x: other.x, y: other.y },
                        { x: other.x + (other.w || 0), y: other.y },
                        { x: other.x + (other.w || 0), y: other.y + (other.h || 0) },
                        { x: other.x, y: other.y + (other.h || 0) },
                        { x: other.x + (other.w || 0) / 2, y: other.y + (other.h || 0) / 2 }
                    ];
                }
                for (const p of pts) {
                    const np = nearestPointOnSegment(p.x, p.y, wall.p1.x, wall.p1.y, wall.p2.x, wall.p2.y);
                    if (Math.hypot(p.x - np.x, p.y - np.y) <= thk) return true;
                }
                if (other.w != null && other.h != null) {
                    const inside = (px, py) =>
                        px >= other.x && px <= other.x + other.w &&
                        py >= other.y && py <= other.y + other.h;
                    if (inside(wall.p1.x, wall.p1.y) || inside(wall.p2.x, wall.p2.y)) return true;
                }
                return false;
            }
            return overlapArea(wall, other) > 0;
        }

        /**
         * Deduction sources for a wall: openings/cutouts + columns in the wall.
         * Columns remain separate measurable elements; only their face contribution
         * is subtracted from the wall net area (wall geometry is not deleted).
         */
        function wallDeductionSourceCenterOnWall(wall, source) {
            if (!wall || !source) return null;
            if (wall.isLine && wall.p1 && wall.p2) {
                const ax = Number(wall.p1.x) || 0, ay = Number(wall.p1.y) || 0;
                const bx = Number(wall.p2.x) || 0, by = Number(wall.p2.y) || 0;
                const dx = bx - ax, dy = by - ay;
                const len = Math.hypot(dx, dy) || 1;
                const ux = dx / len, uy = dy / len;
                let cx, cy;
                if (source.type === 'wall' && source.isLine && source.p1 && source.p2) {
                    const c1x = Number(source.p1.x) || 0, c1y = Number(source.p1.y) || 0;
                    const c2x = Number(source.p2.x) || 0, c2y = Number(source.p2.y) || 0;
                    const den = dx * (c2y - c1y) - dy * (c2x - c1x);
                    if (Math.abs(den) > 1e-9) {
                        const t = ((c1x - ax) * (c2y - c1y) - (c1y - ay) * (c2x - c1x)) / den;
                        cx = ax + t * dx; cy = ay + t * dy;
                    } else {
                        cx = (c1x + c2x) / 2; cy = (c1y + c2y) / 2;
                    }
                } else if (source.isLine && source.p1 && source.p2) {
                    cx = (Number(source.p1.x) + Number(source.p2.x)) / 2;
                    cy = (Number(source.p1.y) + Number(source.p2.y)) / 2;
                } else if (source.vertices && source.vertices.length >= 3) {
                    const pts = source.vertices.map(v => ({ x: (Number(source.x) || 0) + (Number(v.x) || 0), y: (Number(source.y) || 0) + (Number(v.y) || 0) }));
                    cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                    cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                } else {
                    cx = (Number(source.x) || 0) + (Number(source.w) || 0) / 2;
                    cy = (Number(source.y) || 0) + (Number(source.h) || 0) / 2;
                }
                return ((cx - ax) * ux + (cy - ay) * uy);
            }
            const alongX = Math.abs(Number(wall.w) || 0) >= Math.abs(Number(wall.h) || 0);
            return alongX
                ? ((Number(source.x) || 0) + (Number(source.w) || 0) / 2) - (Number(wall.x) || 0)
                : ((Number(source.y) || 0) + (Number(source.h) || 0) / 2) - (Number(wall.y) || 0);
        }

        function wallDeductionUnionArea(items, cf) {
            const events = [];
            items.forEach(item => { events.push(item.x0, item.x1); });
            const xs = Array.from(new Set(events.filter(Number.isFinite))).sort((a, b) => a - b);
            let area = 0;
            for (let i = 0; i < xs.length - 1; i++) {
                const x0 = xs[i], x1 = xs[i + 1];
                if (x1 - x0 <= 1e-9) continue;
                const mid = (x0 + x1) / 2;
                const ys = [];
                items.forEach(item => {
                    if (item.x0 <= mid + 1e-9 && item.x1 >= mid - 1e-9 && item.y1 > item.y0) {
                        ys.push([item.y0, item.y1]);
                    }
                });
                ys.sort((a, b) => a[0] - b[0]);
                let covered = 0, cur0 = null, cur1 = null;
                ys.forEach(pair => {
                    if (cur0 == null) { cur0 = pair[0]; cur1 = pair[1]; }
                    else if (pair[0] <= cur1 + 1e-9) cur1 = Math.max(cur1, pair[1]);
                    else { covered += cur1 - cur0; cur0 = pair[0]; cur1 = pair[1]; }
                });
                if (cur0 != null) covered += cur1 - cur0;
                area += (x1 - x0) * (cf || 1) * covered;
            }
            return area;
        }

        function normalizeWallDeductionUnion(wall, list, wallH, cf) {
            const all = [];
            list.forEach(d => {
                const center = wallDeductionSourceCenterOnWall(wall, d.source);
                const width = Math.max(0, Number(d.openWidthDraw) || 0);
                if (!Number.isFinite(center) || width <= 1e-9) return;
                const wallLengthDraw = wall.isLine && wall.p1 && wall.p2
                    ? Math.hypot(wall.p2.x - wall.p1.x, wall.p2.y - wall.p1.y)
                    : Math.max(Number(wall.w) || 0, Number(wall.h) || 0);
                const x0 = Math.max(0, center - width / 2);
                const x1 = Math.min(wallLengthDraw, center + width / 2);
                let y0 = 0;
                if (d.kind === 'opening' && d.source && typeof getOpeningSillM === 'function') y0 = Math.max(0, getOpeningSillM(d.source) || 0);
                const y1 = Math.min(wallH, y0 + Math.max(0, Number(d.openHeightM) || 0));
                if (x1 > x0 && y1 > y0) all.push({ d, x0, x1, y0, y1 });
            });
            const accepted = [];
            all.forEach(item => {
                const before = wallDeductionUnionArea(accepted, cf);
                const after = wallDeductionUnionArea(accepted.concat(item), cf);
                const unique = Math.max(0, after - before);
                if (unique > 1e-7) {
                    item.d.deductM2 = unique;
                    const h = item.y1 - item.y0;
                    item.d.openWidthM = h > 1e-9 ? unique / h : 0;
                    item.d.openWidthDraw = item.d.openWidthM / (cf || 1);
                    accepted.push(item);
                }
            });
            return accepted.map(item => item.d);
        }

        function collectWallDeductions(wall) {
            const cf = calibrationFactor || 1;
            const wallH = (wall.zHeight != null && wall.zHeight > 0) ? wall.zHeight : 3.0;
            const list = [];
            const openingsAll = elements.filter(e =>
                !e.hidden && (e.type === 'door' || e.type === 'window' || e.type === 'opening' ||
                    e.isDeduction || e.type === 'cutout')
            );
            getDeductionsOverlapping(wall, openingsAll)
                .filter(({ opening: o }) => {
                    if (wall.isLine) return typeof elementIntersectsLineWall === 'function'
                        ? elementIntersectsLineWall(wall, o, 0)
                        : cutoutWidthAlongLine(wall, o) > 1e-6;
                    return overlapArea(wall, o) > 1e-9;
                })
                .forEach(({ opening: o }) => {
                let openWidthDraw;
                if (wall.isLine) {
                    openWidthDraw = cutoutWidthAlongLine(wall, o);
                    if (openWidthDraw < 1e-6) openWidthDraw = Math.max(o.w || 0, o.h || 0);
                } else {
                    openWidthDraw = Math.max(o.w || 0, o.h || 0);
                }
                const openWidthM = openWidthDraw * cf;
                const openHeightM = Math.max(0.01,
                    (typeof getOpeningHeightM === 'function' ? getOpeningHeightM(o) : null) || o.zHeight || 2.1);
                const hDed = Math.min(openHeightM, wallH);
                const deductM2 = openWidthM * hDed;
                list.push({
                    source: o,
                    kind: 'opening',
                    openWidthDraw,
                    openWidthM,
                    openHeightM: hDed,
                    deductM2,
                    label: o.label || o.type || 'Opening'
                });
            });
            elements.forEach(col => {
                if (col.hidden || col.type !== 'column') return;
                if (col.skipWallDeduction) return;
                const linked = sameElementId(col.parentId, wall.id) ||
                    (Array.isArray(col.deductFromWallIds) && col.deductFromWallIds.some(function (wid) { return sameElementId(wid, wall.id); }));
                if (!linked && !elementIntersectsWall(wall, col)) return;
                let openWidthDraw;
                if (wall.isLine) {
                    openWidthDraw = cutoutWidthAlongLine(wall, col);
                    if (openWidthDraw < 1e-6) {
                        openWidthDraw = Math.min(col.w || 0, col.h || 0) || Math.max(col.w || 0, col.h || 0);
                    }
                } else {
                    const ox = Math.max(0, Math.min(wall.x + wall.w, col.x + col.w) - Math.max(wall.x, col.x));
                    const oy = Math.max(0, Math.min(wall.y + wall.h, col.y + col.h) - Math.max(wall.y, col.y));
                    openWidthDraw = Math.max(ox, oy);
                }
                const openWidthM = openWidthDraw * cf;
                const colH = (col.zHeight != null && col.zHeight > 0) ? col.zHeight : wallH;
                const hDed = Math.min(colH, wallH);
                const deductM2 = openWidthM * hDed;
                list.push({
                    source: col,
                    kind: 'column',
                    openWidthDraw,
                    openWidthM,
                    openHeightM: hDed,
                    deductM2,
                    label: col.label || 'Column'
                });
            });
            // Use the attached engine for precise pair classification and stable
            // owner assignment when it is available. Existing geometry fallbacks
            // remain above for legacy/project data that cannot be classified.
            if (typeof OverlapDeductionEngine !== 'undefined') {
                try {
                    const already = new Set(list.map(d => d.source && d.source.id).filter(Boolean));
                    const engineDeductions = OverlapDeductionEngine.collectDeductionsFor(wall, elements);
                    engineDeductions.forEach(d => {
                        if (!d || !d.source || already.has(d.source.id)) return;
                        if (d.kind === 'wall-wall' || d.kind === 'wall-column' || d.kind === 'wall-beam' || d.kind === 'wall-opening') {
                            list.push({
                                source: d.source,
                                kind: d.kind === 'wall-wall' ? 'wall-overlap' : (d.kind === 'wall-column' ? 'column' : (d.kind === 'wall-beam' ? 'beam' : 'opening')),
                                openWidthDraw: (d.openWidthM || 0) / (cf || 1),
                                openWidthM: d.openWidthM || 0,
                                openHeightM: d.openHeightM || 0,
                                deductM2: d.deductM2 || 0,
                                label: d.label || d.kind
                            });
                            already.add(d.source.id);
                        }
                    });
                } catch (err) {
                    console.warn('[OverlapDeductionEngine] wall integration failed', err);
                }
            }
            return normalizeWallDeductionUnion(wall, list, wallH, cf);
        }

        // =====================================================================
        //  AUTOMATIC OVERLAP DETECTION & DEDUCTION ENGINE (MeasureCraft)
        //  Spatial indexing + rule-based net quantities for professional QS
        // =====================================================================
        const OverlapDeductionEngine = (function () {
            "use strict";

            // Configurable deduction rules (users can toggle via settings later)
            const DeductionRules = {
                wall:   ["door", "window", "opening", "cutout", "column", "beam", "wall"],
                slab:   ["beam", "column", "opening", "cutout", "door", "window"],
                column: [],
                beam:   [],
                // openings never receive deductions
                door: [], window: [], opening: [], cutout: []
            };

            // Enable / disable individual rule categories
            let rulesEnabled = {
                wall_opening: true,
                wall_column: true,
                wall_beam: true,
                wall_wall: true,   // corner / junction shared thickness
                slab_beam: true,
                slab_column: true,
                slab_opening: true
            };

            // Spatial hash grid cell size in drawing units
            let gridCellSize = 80;

            // Cached index
            let spatialIndex = null;
            let indexVersion = 0;
            let lastElementsLen = -1;
            let lastGeometrySignature = '';

            function getCf() {
                return (typeof calibrationFactor === "number" && calibrationFactor > 0) ? calibrationFactor : 1;
            }

            function getWallThkM(wall) {
                if (wall && typeof wall.thickness === "number" && wall.thickness > 0) return wall.thickness;
                return (typeof DEFAULT_WALL_THICKNESS_M === "number") ? DEFAULT_WALL_THICKNESS_M : 0.15;
            }

            function getZHeight(el, fallback) {
                if (el && typeof el.zHeight === "number" && el.zHeight > 0) return el.zHeight;
                return fallback != null ? fallback : 3.0;
            }

            /** Axis-aligned bounding box in drawing units (expanded for line elements by half thickness). */
            function elementAABB(el) {
                if (!el) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
                if (el.isLine && el.p1 && el.p2) {
                    const thkDraw = (typeof getLineThicknessDraw === "function")
                        ? getLineThicknessDraw(el)
                        : ((getWallThkM(el) / getCf()) || 8);
                    const half = thkDraw / 2 + 1;
                    return {
                        minX: Math.min(el.p1.x, el.p2.x) - half,
                        minY: Math.min(el.p1.y, el.p2.y) - half,
                        maxX: Math.max(el.p1.x, el.p2.x) + half,
                        maxY: Math.max(el.p1.y, el.p2.y) + half
                    };
                }
                const w = el.w || 0, h = el.h || 0;
                return {
                    minX: el.x || 0,
                    minY: el.y || 0,
                    maxX: (el.x || 0) + w,
                    maxY: (el.y || 0) + h
                };
            }

            function aabbOverlap(a, b, pad) {
                pad = pad || 0;
                return a.minX - pad < b.maxX && a.maxX + pad > b.minX &&
                       a.minY - pad < b.maxY && a.maxY + pad > b.minY;
            }

            function aabbIntersectionArea(a, b) {
                const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
                const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
                return ix * iy;
            }

            // ---------- Spatial Hash Grid (fast candidate pairs) ----------
            function geometrySignature(els) {
                return els.map(el => {
                    const p1 = el.p1 || {}, p2 = el.p2 || {};
                    return [el.id, el.type, el.hidden ? 1 : 0, el.x || 0, el.y || 0, el.w || 0, el.h || 0,
                        p1.x || 0, p1.y || 0, p2.x || 0, p2.y || 0, el.thickness || 0].join(':');
                }).join('|');
            }

            function buildSpatialIndex(els) {
                const cell = gridCellSize;
                const buckets = new Map();
                const boxes = new Map();
                els.forEach(el => {
                    if (el.hidden) return;
                    const box = elementAABB(el);
                    boxes.set(el.id, box);
                    const cx0 = Math.floor(box.minX / cell);
                    const cy0 = Math.floor(box.minY / cell);
                    const cx1 = Math.floor(box.maxX / cell);
                    const cy1 = Math.floor(box.maxY / cell);
                    for (let cx = cx0; cx <= cx1; cx++) {
                        for (let cy = cy0; cy <= cy1; cy++) {
                            const key = cx + ":" + cy;
                            if (!buckets.has(key)) buckets.set(key, []);
                            buckets.get(key).push(el);
                        }
                    }
                });
                spatialIndex = { buckets, boxes, cell, version: ++indexVersion };
                lastElementsLen = els.length;
                lastGeometrySignature = geometrySignature(els);
                return spatialIndex;
            }

            function ensureIndex(els) {
                const signature = geometrySignature(els);
                if (!spatialIndex || lastElementsLen !== els.length || lastGeometrySignature !== signature) {
                    return buildSpatialIndex(els);
                }
                return spatialIndex;
            }

            /** Return nearby visible elements that may intersect `el` (excluding self). */
            function queryNearby(el, els, typeFilter) {
                const idx = ensureIndex(els);
                const box = idx.boxes.get(el.id) || elementAABB(el);
                const cell = idx.cell;
                const seen = new Set();
                const result = [];
                const cx0 = Math.floor(box.minX / cell) - 1;
                const cy0 = Math.floor(box.minY / cell) - 1;
                const cx1 = Math.floor(box.maxX / cell) + 1;
                const cy1 = Math.floor(box.maxY / cell) + 1;
                for (let cx = cx0; cx <= cx1; cx++) {
                    for (let cy = cy0; cy <= cy1; cy++) {
                        const list = idx.buckets.get(cx + ":" + cy);
                        if (!list) continue;
                        for (let i = 0; i < list.length; i++) {
                            const o = list[i];
                            if (o.id === el.id || o.hidden || seen.has(o.id)) continue;
                            if (typeFilter && typeFilter.indexOf(o.type) < 0 &&
                                !(o.isDeduction && typeFilter.indexOf("cutout") >= 0)) continue;
                            seen.add(o.id);
                            const ob = idx.boxes.get(o.id) || elementAABB(o);
                            if (aabbOverlap(box, ob, 2)) result.push(o);
                        }
                    }
                }
                return result;
            }

            // ---------- Geometry helpers ----------
            function segmentLength(p1, p2) {
                return Math.hypot(p2.x - p1.x, p2.y - p1.y);
            }

            function nearestPointOnSegment(px, py, ax, ay, bx, by) {
                const abx = bx - ax, aby = by - ay;
                const len2 = abx * abx + aby * aby;
                if (len2 < 1e-12) return { x: ax, y: ay, t: 0 };
                let t = ((px - ax) * abx + (py - ay) * aby) / len2;
                t = Math.max(0, Math.min(1, t));
                return { x: ax + t * abx, y: ay + t * aby, t: t };
            }

            function pointToSegmentDist(px, py, ax, ay, bx, by) {
                const np = nearestPointOnSegment(px, py, ax, ay, bx, by);
                return Math.hypot(px - np.x, py - np.y);
            }

            /** Approximate plan overlap length of a rectangular element along a line-wall centreline. */
            function overlapLengthAlongWall(wall, other) {
                if (!wall.isLine || !wall.p1 || !wall.p2) {
                    // Rect walls: use intersection width of AABBs projected on longer axis
                    const a = elementAABB(wall), b = elementAABB(other);
                    const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
                    const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
                    return Math.max(ix, iy);
                }
                if (typeof cutoutWidthAlongLine === "function") {
                    const w = cutoutWidthAlongLine(wall, other);
                    if (w > 1e-6) return w;
                }
                // Fallback: project other extents onto wall axis
                const ax = wall.p1.x, ay = wall.p1.y, bx = wall.p2.x, by = wall.p2.y;
                const len = Math.hypot(bx - ax, by - ay) || 1;
                const ux = (bx - ax) / len, uy = (by - ay) / len;
                let pts = [];
                if (other.vertices && other.vertices.length >= 3) {
                    pts = other.vertices.map(v => ({ x: other.x + v.x, y: other.y + v.y }));
                } else {
                    const ow = other.w || 0, oh = other.h || 0;
                    pts = [
                        { x: other.x, y: other.y },
                        { x: other.x + ow, y: other.y },
                        { x: other.x + ow, y: other.y + oh },
                        { x: other.x, y: other.y + oh }
                    ];
                }
                let tMin = Infinity, tMax = -Infinity;
                pts.forEach(p => {
                    const t = (p.x - ax) * ux + (p.y - ay) * uy;
                    if (t < tMin) tMin = t;
                    if (t > tMax) tMax = t;
                });
                tMin = Math.max(0, Math.min(len, tMin));
                tMax = Math.max(0, Math.min(len, tMax));
                return Math.max(0, tMax - tMin);
            }

            function elementIntersectsLineWall(wall, other, tolExtra) {
                if (!wall.isLine || !wall.p1 || !wall.p2) return false;

                // Quantity deductions must use the physical wall footprint, not
                // the clamped visual stroke plus a large drawing-unit tolerance.
                // The old tolerance could classify an opening one metre away from
                // a perpendicular wall as touching it at coarse test scales.
                if (typeof getWallFootprintVertices === 'function' && typeof polygonIntersectionArea === 'function' && !other.isLine) {
                    const wallPts = getWallFootprintVertices(wall);
                    let otherPts;
                    if (other.vertices && other.vertices.length >= 3) {
                        otherPts = other.vertices.map(v => ({ x: (Number(other.x) || 0) + (Number(v.x) || 0), y: (Number(other.y) || 0) + (Number(v.y) || 0) }));
                    } else {
                        const ox = Number(other.x) || 0, oy = Number(other.y) || 0;
                        const ow = Number(other.w) || 0, oh = Number(other.h) || 0;
                        otherPts = [{ x: ox, y: oy }, { x: ox + ow, y: oy }, { x: ox + ow, y: oy + oh }, { x: ox, y: oy + oh }];
                    }
                    if (wallPts && otherPts.length >= 3 && polygonIntersectionArea(wallPts, otherPts) > 1e-9) return true;
                    return false;
                }

                const thkDraw = (typeof getLineThicknessDraw === "function")
                    ? getLineThicknessDraw(wall) / 2
                    : (getWallThkM(wall) / getCf()) / 2;
                const tol = thkDraw + (tolExtra || 0);
                let pts = [];
                if (other.vertices && other.vertices.length >= 3) {
                    pts = other.vertices.map(v => ({ x: other.x + v.x, y: other.y + v.y }));
                } else {
                    const ow = other.w || 0, oh = other.h || 0;
                    pts = [
                        { x: other.x, y: other.y },
                        { x: other.x + ow, y: other.y },
                        { x: other.x + ow, y: other.y + oh },
                        { x: other.x, y: other.y + oh },
                        { x: other.x + ow / 2, y: other.y + oh / 2 }
                    ];
                }
                for (let i = 0; i < pts.length; i++) {
                    if (pointToSegmentDist(pts[i].x, pts[i].y, wall.p1.x, wall.p1.y, wall.p2.x, wall.p2.y) <= tol)
                        return true;
                }
                // Wall endpoints inside other
                if (other.w != null && other.h != null) {
                    const inside = (px, py) =>
                        px >= other.x && px <= other.x + other.w &&
                        py >= other.y && py <= other.y + other.h;
                    if (inside(wall.p1.x, wall.p1.y) || inside(wall.p2.x, wall.p2.y)) return true;
                }
                return false;
            }

            // ---------- Wall–Wall junction detection ----------
            /**
             * Detect L / T / Cross junctions between two walls.
             * Returns shared corner length (drawing units) that should be counted once.
             * Convention: the wall with the higher id number absorbs the deduction
             * so material is never double-counted.
             */
            function wallWallJunction(wA, wB) {
                if (!wA || !wB || wA.id === wB.id) return null;
                // Prefer the project’s segment-intersection routine: the engine’s
                // endpoint test alone misses wall crosses whose centerlines meet
                // away from both endpoints and misses collinear shared runs.
                if (wA.isLine && wB.isLine && wA.p1 && wA.p2 && wB.p1 && wB.p2 &&
                    typeof wallWallOverlapLengthDraw === 'function') {
                    const sharedLengthDraw = wallWallOverlapLengthDraw(wA, wB);
                    if (sharedLengthDraw > 1e-6) {
                        const thkA = getWallThkM(wA) / getCf();
                        const thkB = getWallThkM(wB) / getCf();
                        return {
                            kind: 'segment-overlap',
                            sharedLengthDraw,
                            sharedAreaDraw: sharedLengthDraw * Math.min(thkA, thkB)
                        };
                    }
                }
                if (!wA.isLine || !wB.isLine || !wA.p1 || !wA.p2 || !wB.p1 || !wB.p2) {
                    // Rect walls: shared plan overlap area → treat as junction volume
                    const a = elementAABB(wA), b = elementAABB(wB);
                    const area = aabbIntersectionArea(a, b);
                    if (area < 1e-4) return null;
                    return {
                        kind: "rect-overlap",
                        sharedLengthDraw: Math.sqrt(area),
                        sharedAreaDraw: area
                    };
                }
                const endpoints = [
                    { wall: wA, p: wA.p1, other: wB },
                    { wall: wA, p: wA.p2, other: wB },
                    { wall: wB, p: wB.p1, other: wA },
                    { wall: wB, p: wB.p2, other: wA }
                ];
                const cf = getCf();
                const thkA = getWallThkM(wA) / cf;
                const thkB = getWallThkM(wB) / cf;
                const joinTol = Math.max(thkA, thkB) * 0.75 + 4;

                let best = null;
                endpoints.forEach(({ wall, p, other }) => {
                    const d = pointToSegmentDist(p.x, p.y, other.p1.x, other.p1.y, other.p2.x, other.p2.y);
                    if (d > joinTol) return;
                    // Shared length ≈ average thickness (corner square)
                    const shared = (thkA + thkB) / 2;
                    if (!best || shared > best.sharedLengthDraw) {
                        best = {
                            kind: "corner",
                            sharedLengthDraw: shared,
                            sharedAreaDraw: shared * Math.min(thkA, thkB),
                            junctionPoint: { x: p.x, y: p.y }
                        };
                    }
                });
                // Mid-span T-junction: one wall endpoint near middle of the other
                if (!best) {
                    // already covered by endpoints loop
                }
                return best;
            }

            // ---------- Core intersection volume / area ----------
            /**
             * Compute overlap metrics between two elements.
             * Returns { overlapAreaM2, overlapVolumeM3, overlapLengthM, kind }
             * using extrusion heights (zHeight). Suitable for QS quantity takeoff.
             */
            function computeOverlap(a, b) {
                if (!a || !b || a.id === b.id) return null;
                const cf = getCf();
                const boxA = elementAABB(a);
                const boxB = elementAABB(b);
                if (!aabbOverlap(boxA, boxB, 4)) return null;

                const hA = getZHeight(a);
                const hB = getZHeight(b);
                const hMin = Math.min(hA, hB);

                // Opening / cutout vs host
                const isOpening = (el) => el.type === "door" || el.type === "window" ||
                    el.type === "opening" || el.type === "cutout" || el.isDeduction;

                // Wall ↔ Opening
                if (a.type === "wall" && isOpening(b)) {
                    // For line walls, projection onto the wall axis is not enough:
                    // an opening beside a perpendicular wall can have a non-zero
                    // projected width while never touching that wall. Require an
                    // actual footprint/centreline intersection before deducting.
                    if (a.isLine ? !elementIntersectsLineWall(a, b, 0) : !aabbOverlap(boxA, boxB, 0)) return null;
                    const lenDraw = overlapLengthAlongWall(a, b);
                    if (lenDraw < 1e-6) return null;
                    const lenM = lenDraw * cf;
                    const openH = Math.min(getZHeight(b, 2.1), hA);
                    return {
                        overlapAreaM2: lenM * openH,
                        overlapVolumeM3: lenM * openH * getWallThkM(a),
                        overlapLengthM: lenM,
                        kind: "wall-opening"
                    };
                }
                if (b.type === "wall" && isOpening(a)) return computeOverlap(b, a);

                // Wall ↔ Column
                if (a.type === "wall" && b.type === "column") {
                    if (b.skipWallDeduction) return null;
                    const intersects = a.isLine
                        ? elementIntersectsLineWall(a, b, 0)
                        : aabbOverlap(boxA, boxB, 0);
                    if (!intersects && b.parentId !== a.id) return null;
                    const lenDraw = overlapLengthAlongWall(a, b);
                    const lenM = Math.max(lenDraw * cf, Math.min(b.w || 0, b.h || 0) * cf || 0.2);
                    const hDed = Math.min(getZHeight(b), hA);
                    return {
                        overlapAreaM2: lenM * hDed,
                        overlapVolumeM3: lenM * hDed * getWallThkM(a),
                        overlapLengthM: lenM,
                        kind: "wall-column"
                    };
                }
                if (b.type === "wall" && a.type === "column") return computeOverlap(b, a);

                // Wall ↔ Beam (beam penetrates wall face)
                if (a.type === "wall" && b.type === "beam") {
                    const intersects = a.isLine
                        ? elementIntersectsLineWall(a, b, 0)
                        : aabbOverlap(boxA, boxB, 0);
                    if (!intersects) return null;
                    const lenDraw = overlapLengthAlongWall(a, b);
                    const lenM = Math.max(lenDraw * cf, 0.1);
                    // Beam height typically partial
                    const beamH = Math.min(getZHeight(b, 0.45), hA);
                    return {
                        overlapAreaM2: lenM * beamH,
                        overlapVolumeM3: lenM * beamH * getWallThkM(a),
                        overlapLengthM: lenM,
                        kind: "wall-beam"
                    };
                }
                if (b.type === "wall" && a.type === "beam") return computeOverlap(b, a);

                // Wall ↔ Wall (corner / shared thickness)
                if (a.type === "wall" && b.type === "wall") {
                    const j = wallWallJunction(a, b);
                    if (!j) return null;
                    // Only the wall with larger id receives the deduction (prevent double-count)
                    const deductFrom = a.id > b.id ? a : b;
                    const other = deductFrom === a ? b : a;
                    const thk = Math.min(getWallThkM(a), getWallThkM(b));
                    const sharedLenM = (j.sharedLengthDraw || 0) * cf;
                    const faceArea = sharedLenM * hMin;
                    return {
                        overlapAreaM2: faceArea,
                        overlapVolumeM3: faceArea * thk,
                        overlapLengthM: sharedLenM,
                        kind: "wall-wall",
                        deductFromId: deductFrom.id,
                        junction: j
                    };
                }

                // Slab ↔ Beam
                if (a.type === "slab" && b.type === "beam") {
                    const areaDraw = aabbIntersectionArea(boxA, boxB);
                    if (areaDraw < 1e-6) return null;
                    const areaM2 = areaDraw * cf * cf;
                    // Beam volume inside slab depth (typically full beam depth counted in beam)
                    const beamDepth = getZHeight(b, 0.45);
                    const slabDepth = getZHeight(a, 0.15);
                    const overlapDepth = Math.min(beamDepth, slabDepth);
                    return {
                        overlapAreaM2: areaM2,
                        overlapVolumeM3: areaM2 * overlapDepth,
                        overlapLengthM: Math.sqrt(areaM2),
                        kind: "slab-beam"
                    };
                }
                if (b.type === "slab" && a.type === "beam") return computeOverlap(b, a);

                // Slab ↔ Column
                if (a.type === "slab" && b.type === "column") {
                    const areaDraw = aabbIntersectionArea(boxA, boxB);
                    if (areaDraw < 1e-6) return null;
                    const areaM2 = areaDraw * cf * cf;
                    const slabDepth = getZHeight(a, 0.15);
                    return {
                        overlapAreaM2: areaM2,
                        overlapVolumeM3: areaM2 * slabDepth,
                        overlapLengthM: Math.sqrt(areaM2),
                        kind: "slab-column"
                    };
                }
                if (b.type === "slab" && a.type === "column") return computeOverlap(b, a);

                // Slab ↔ Opening
                if (a.type === "slab" && isOpening(b)) {
                    const areaDraw = aabbIntersectionArea(boxA, boxB);
                    if (areaDraw < 1e-6) return null;
                    const areaM2 = areaDraw * cf * cf;
                    const slabDepth = getZHeight(a, 0.15);
                    return {
                        overlapAreaM2: areaM2,
                        overlapVolumeM3: areaM2 * slabDepth,
                        overlapLengthM: Math.sqrt(areaM2),
                        kind: "slab-opening"
                    };
                }
                if (b.type === "slab" && isOpening(a)) return computeOverlap(b, a);

                // Generic fallback: AABB intersection extruded by min height
                const areaDraw = aabbIntersectionArea(boxA, boxB);
                if (areaDraw < 1e-6) return null;
                const areaM2 = areaDraw * cf * cf;
                return {
                    overlapAreaM2: areaM2,
                    overlapVolumeM3: areaM2 * hMin,
                    overlapLengthM: Math.sqrt(areaM2),
                    kind: "generic"
                };
            }

            // ---------- Public API ----------
            function invalidate() {
                spatialIndex = null;
                lastElementsLen = -1;
                lastGeometrySignature = '';
            }

            function setRuleEnabled(key, enabled) {
                if (Object.prototype.hasOwnProperty.call(rulesEnabled, key)) {
                    rulesEnabled[key] = !!enabled;
                }
            }

            function getRules() {
                return { DeductionRules: Object.assign({}, DeductionRules), rulesEnabled: Object.assign({}, rulesEnabled) };
            }

            /**
             * Collect all deductions that apply to a single host element.
             * Returns array of { source, kind, deductM2, deductM3, label, overlap }
             */
            function collectDeductionsFor(host, allElements) {
                if (!host || host.hidden) return [];
                const rules = DeductionRules[host.type] || [];
                if (!rules.length) return [];

                const typeFilter = rules.slice();
                // also allow isDeduction cutouts
                if (typeFilter.indexOf("cutout") < 0) typeFilter.push("cutout");

                const candidates = queryNearby(host, allElements, typeFilter);
                const list = [];
                const seen = new Set();

                candidates.forEach(other => {
                    if (seen.has(other.id)) return;
                    seen.add(other.id);

                    // Rule toggles
                    const pairKey = [host.type, other.type].sort().join("_");
                    const ruleKey =
                        (host.type === "wall" && (other.type === "door" || other.type === "window" || other.type === "opening" || other.type === "cutout" || other.isDeduction)) ? "wall_opening" :
                        (host.type === "wall" && other.type === "column") ? "wall_column" :
                        (host.type === "wall" && other.type === "beam") ? "wall_beam" :
                        (host.type === "wall" && other.type === "wall") ? "wall_wall" :
                        (host.type === "slab" && other.type === "beam") ? "slab_beam" :
                        (host.type === "slab" && other.type === "column") ? "slab_column" :
                        (host.type === "slab" && (other.type === "opening" || other.type === "cutout" || other.isDeduction)) ? "slab_opening" :
                        null;
                    if (ruleKey && rulesEnabled[ruleKey] === false) return;

                    const ov = computeOverlap(host, other);
                    if (!ov) return;

                    // Wall-wall: only deduct on the designated wall
                    if (ov.kind === "wall-wall" && ov.deductFromId && ov.deductFromId !== host.id) return;

                    list.push({
                        source: other,
                        kind: ov.kind,
                        deductM2: ov.overlapAreaM2 || 0,
                        deductM3: ov.overlapVolumeM3 || 0,
                        openWidthM: ov.overlapLengthM || 0,
                        openHeightM: (ov.overlapAreaM2 && ov.overlapLengthM) ? (ov.overlapAreaM2 / Math.max(ov.overlapLengthM, 1e-9)) : 0,
                        label: other.label || other.type || "Element",
                        overlap: ov
                    });
                });
                return list;
            }

            /**
             * Full quantity result for one element: gross, deductions, net.
             */
            function computeElementQuantity(el, allElements) {
                const cf = getCf();
                const result = {
                    elementId: el.id,
                    label: el.label || el.type,
                    type: el.type,
                    grossAreaM2: 0,
                    grossVolumeM3: 0,
                    deductions: [],
                    totalDeductionAreaM2: 0,
                    totalDeductionVolumeM3: 0,
                    netAreaM2: 0,
                    netVolumeM3: 0,
                    unit: "m²"
                };

                if (el.type === "wall") {
                    let lengthM;
                    if (el.isLine && el.p1 && el.p2) {
                        lengthM = (el.length != null ? el.length : segmentLength(el.p1, el.p2)) * cf;
                    } else {
                        lengthM = Math.max(el.w || 0, el.h || 0) * cf;
                    }
                    const height = getZHeight(el);
                    const thk = getWallThkM(el);
                    result.grossAreaM2 = lengthM * height;
                    result.grossVolumeM3 = result.grossAreaM2 * thk;
                    result.unit = "m²"; // face area primary for brickwork; volume also available

                    const deds = collectDeductionsFor(el, allElements);
                    deds.forEach(d => {
                        result.deductions.push(d);
                        result.totalDeductionAreaM2 += d.deductM2;
                        result.totalDeductionVolumeM3 += d.deductM3;
                    });
                    result.netAreaM2 = Math.max(0, result.grossAreaM2 - result.totalDeductionAreaM2);
                    result.netVolumeM3 = Math.max(0, result.grossVolumeM3 - result.totalDeductionVolumeM3);
                    return result;
                }

                if (el.type === "slab") {
                    let planAreaDraw;
                    if (el.vertices && el.vertices.length >= 3) {
                        // shoelace if polygonArea available
                        if (typeof polygonArea === "function") {
                            const absPts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                            planAreaDraw = polygonArea(absPts);
                        } else {
                            planAreaDraw = (el.w || 0) * (el.h || 0);
                        }
                    } else {
                        planAreaDraw = (el.w || 0) * (el.h || 0);
                    }
                    const planAreaM2 = planAreaDraw * cf * cf;
                    const depth = getZHeight(el, 0.15);
                    result.grossAreaM2 = planAreaM2;
                    result.grossVolumeM3 = planAreaM2 * depth;
                    result.unit = "m³";

                    const deds = collectDeductionsFor(el, allElements);
                    deds.forEach(d => {
                        result.deductions.push(d);
                        result.totalDeductionAreaM2 += d.deductM2;
                        result.totalDeductionVolumeM3 += d.deductM3;
                    });
                    result.netAreaM2 = Math.max(0, result.grossAreaM2 - result.totalDeductionAreaM2);
                    result.netVolumeM3 = Math.max(0, result.grossVolumeM3 - result.totalDeductionVolumeM3);
                    return result;
                }

                if (el.type === "column") {
                    let planAreaDraw;
                    if (el.vertices && el.vertices.length >= 3 && typeof polygonArea === "function") {
                        const absPts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                        planAreaDraw = polygonArea(absPts);
                    } else {
                        planAreaDraw = (el.w || 0) * (el.h || 0);
                    }
                    const planAreaM2 = planAreaDraw * cf * cf;
                    const height = getZHeight(el);
                    result.grossAreaM2 = planAreaM2;
                    result.grossVolumeM3 = planAreaM2 * height;
                    result.unit = "m³";
                    // Columns typically have no deductions in standard QS
                    result.netAreaM2 = result.grossAreaM2;
                    result.netVolumeM3 = result.grossVolumeM3;
                    return result;
                }

                if (el.type === "beam") {
                    let lengthM;
                    if (el.isLine && el.p1 && el.p2) {
                        lengthM = (el.length != null ? el.length : segmentLength(el.p1, el.p2)) * cf;
                    } else {
                        lengthM = Math.max(el.w || 0, el.h || 0) * cf;
                    }
                    // Live beam section from current thickness / depth props
                    const widthM = (typeof el.thickness === "number" && el.thickness > 0) ? el.thickness : DEFAULT_BEAM_THICKNESS_M;
                    const depthM = getZHeight(el, 0.45);
                    result.grossAreaM2 = lengthM * widthM; // plan
                    result.grossVolumeM3 = lengthM * widthM * depthM;
                    result.unit = "m³";
                    result.netAreaM2 = result.grossAreaM2;
                    result.netVolumeM3 = result.grossVolumeM3;
                    return result;
                }

                return result;
            }

            /**
             * Detect all clashes in the model (for real-time UI feedback).
             * Returns array of { a, b, overlap, message }
             */
            function detectAllClashes(allElements) {
                ensureIndex(allElements);
                const clashes = [];
                const vis = allElements.filter(e => !e.hidden);
                const checked = new Set();
                vis.forEach(el => {
                    const nearby = queryNearby(el, allElements, null);
                    nearby.forEach(other => {
                        if (other.id <= el.id) return; // unique pairs
                        const key = el.id + "|" + other.id;
                        if (checked.has(key)) return;
                        checked.add(key);
                        const ov = computeOverlap(el, other);
                        if (!ov || (ov.overlapAreaM2 < 1e-6 && ov.overlapVolumeM3 < 1e-9)) return;
                        clashes.push({
                            a: el,
                            b: other,
                            overlap: ov,
                            message: `Overlap: ${el.label || el.type} ↔ ${other.label || other.type} · ${ov.kind} · ${ov.overlapVolumeM3.toFixed(3)} m³`
                        });
                    });
                });
                return clashes;
            }

            /**
             * Geometry healing helpers (lightweight) – call before quantity calc.
             */
            function healGeometry(allElements) {
                // Snap nearly-coincident wall endpoints so junctions are exact
                const walls = allElements.filter(e => e.type === "wall" && e.isLine && e.p1 && e.p2 && !e.hidden);
                const snapTol = 6; // drawing units
                for (let i = 0; i < walls.length; i++) {
                    for (let j = i + 1; j < walls.length; j++) {
                        const pairs = [
                            [walls[i].p1, walls[j].p1],
                            [walls[i].p1, walls[j].p2],
                            [walls[i].p2, walls[j].p1],
                            [walls[i].p2, walls[j].p2]
                        ];
                        pairs.forEach(([pa, pb]) => {
                            if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= snapTol) {
                                const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
                                pa.x = pb.x = mx;
                                pa.y = pb.y = my;
                            }
                        });
                    }
                }
                invalidate();
            }

            return {
                buildSpatialIndex,
                invalidate,
                queryNearby,
                computeOverlap,
                collectDeductionsFor,
                computeElementQuantity,
                detectAllClashes,
                healGeometry,
                setRuleEnabled,
                getRules,
                elementAABB,
                DeductionRules,
                rulesEnabled
            };
        })();

        // Expose for debugging / future UI toggles
        try { window.OverlapDeductionEngine = OverlapDeductionEngine; } catch (_) {}



        /** Parent wall id when user starts Add Deduction from Properties */
        let pendingDeductionParentId = null;
        // True only while the user explicitly chose a host wall for the next deduction.
        let deductionTargetLocked = false;

        function cutoutWidthAlongLine(lineEl, cutout) {
            if (!lineEl.p1 || !lineEl.p2) {
                return Math.max(cutout.w, cutout.h);
            }
            const ax = lineEl.p1.x,
                ay = lineEl.p1.y,
                bx = lineEl.p2.x,
                by = lineEl.p2.y;
            const abx = bx - ax,
                aby = by - ay;
            const len = Math.hypot(abx, aby) || 1;
            const ux = abx / len,
                uy = aby / len;
            let pts = [];
            if (cutout.vertices && cutout.vertices.length >= 3) {
                pts = cutout.vertices.map(v => ({ x: cutout.x + v.x, y: cutout.y + v.y }));
            } else {
                pts = [
                    { x: cutout.x, y: cutout.y },
                    { x: cutout.x + cutout.w, y: cutout.y },
                    { x: cutout.x + cutout.w, y: cutout.y + cutout.h },
                    { x: cutout.x, y: cutout.y + cutout.h },
                ];
            }
            let tMin = Infinity,
                tMax = -Infinity;
            pts.forEach(p => {
                const t = ((p.x - ax) * ux + (p.y - ay) * uy);
                if (t < tMin) tMin = t;
                if (t > tMax) tMax = t;
            });
            tMin = Math.max(0, Math.min(len, tMin));
            tMax = Math.max(0, Math.min(len, tMax));
            return Math.max(0, tMax - tMin);
        }

        function computeQuantities() {
            const rows = [];
            const cf = calibrationFactor;
            const walls = elements.filter(e => e.type === 'wall');
            const openingsAll = elements.filter(e =>
                e.type === 'door' || e.type === 'window' || e.type === 'opening' || e.isDeduction || e.type === 'cutout'
            );
            const slabs = elements.filter(e => e.type === 'slab');
            const columns = elements.filter(e => e.type === 'column');
            const beams = elements.filter(e => e.type === 'beam');
            let totalBrickVol = 0,
                totalBrickQty = 0,
                totalPlasterArea = 0;
            // Floor finish adjustment accumulators — see SKIRTING_HEIGHT_M above.
            let wallFootprintTotalM2 = 0;
            let wallLengthTotalM = 0;
            function materialDisplayName(el, fallback) {
                const m = el && el.material ? String(el.material).trim() : '';
                return m || fallback;
            }
            function isBlockOrBrickMaterial(name) {
                const n = String(name || '').toLowerCase();
                return n.indexOf('brick') >= 0 || n.indexOf('block') >= 0;
            }
            function isConcreteMaterial(name) {
                const n = String(name || '').toLowerCase();
                return n.indexOf('concrete') >= 0 || n.indexOf('c25') >= 0 || n.indexOf('c30') >= 0;
            }
            function wallQtyForMaterial(matName, netArea, vol) {
                // Sri Lankan rates: brick 59.20/m² (100mm) or 117.33/m² (225mm); block 12.06/m²
                const n = String(matName || '').toLowerCase();
                let perM2 = 117.33;
                if (n.indexOf('block') >= 0) perM2 = 12.06;
                else if (n.indexOf('100') >= 0 || n.indexOf('110') >= 0) perM2 = 59.20;
                else if (n.indexOf('225') >= 0) perM2 = 117.33;
                const lib = matName && materialLibrary[matName] ? materialLibrary[matName] : null;
                if (isBlockOrBrickMaterial(matName) || !matName) {
                    const count = Math.ceil(netArea * perM2);
                    return {
                        qty: count,
                        unit: (lib && lib.unit) || 'Nos',
                        remarks: `Net face ${netArea.toFixed(2)} m² × ${perM2}/m² (SL QS) = ${count} · Vol ${vol.toFixed(3)} m³`,
                    };
                }
                if (isConcreteMaterial(matName)) {
                    return {
                        qty: vol.toFixed(3),
                        unit: (lib && lib.unit) || 'm³',
                        remarks: `Wall volume ${vol.toFixed(3)} m³ (face ${netArea.toFixed(2)} m²)`,
                    };
                }
                // Generic: report face area in m² (paint/plaster-like) unless library unit is Nos
                const u = lib ? String(lib.unit).toLowerCase() : '';
                if (lib && (u.indexOf('nr') >= 0 || u === 'ea' || u.indexOf('nos') >= 0)) {
                    const count = Math.ceil(netArea * perM2);
                    return { qty: count, unit: lib.unit, remarks: `Net face ${netArea.toFixed(2)} m² · Vol ${vol.toFixed(3)} m³` };
                }
                return {
                    qty: netArea.toFixed(2),
                    unit: (lib && lib.unit) || 'm²',
                    remarks: `Net face ${netArea.toFixed(2)} m² · Vol ${vol.toFixed(3)} m³`,
                };
            }
            // Wall overlap deductions are supplied by OverlapDeductionEngine through collectWallDeductions.
            walls.forEach(w => {
                const lengthDraw = w.isLine && w.p1 && w.p2
                    ? Math.hypot(Number(w.p2.x) - Number(w.p1.x), Number(w.p2.y) - Number(w.p1.y))
                    : Math.max(Number(w.w) || 0, Number(w.h) || 0);
                const lengthM = lengthDraw * cf;
                const heightM = (w.zHeight != null && w.zHeight > 0) ? w.zHeight : 3;
                const gross = lengthM * heightM;
                {
                    // Wall plan footprint (length × thickness) — deducted from slab area
                    // to get the tileable floor area; length feeds the skirting addition.
                    const fpThkM = (typeof w.thickness === 'number' && w.thickness > 0)
                        ? w.thickness : DEFAULT_WALL_THICKNESS_M;
                    wallFootprintTotalM2 += lengthM * fpThkM;
                    wallLengthTotalM += lengthM;
                }
                // Openings + columns occupying the wall (wall geometry kept intact)
                const hits = collectWallDeductions(w);
                let deduction = 0;
                let dedRemarks = [];
                hits.forEach(d => {
                    deduction += d.deductM2;
                    const tag = d.kind === 'column' ? 'Col' : (d.kind === 'wall-overlap' ? 'WallJct' : (d.kind === 'beam' ? 'Beam' : 'Opn'));
                    dedRemarks.push(`${tag}:${d.label}(${d.openWidthM.toFixed(2)}×${d.openHeightM.toFixed(2)}=${d.deductM2.toFixed(2)}m²)`);
                });
                const netArea = Math.max(0, gross - deduction);
                // Use standardized thickness for volume
                const thkM = (typeof w.thickness === 'number' && w.thickness > 0)
                    ? w.thickness : DEFAULT_WALL_THICKNESS_M;
                const vol = netArea * thkM;
                totalBrickVol += vol;
                const matName = materialDisplayName(w, 'Brickwork');
                const q = wallQtyForMaterial(w.material || matName, netArea, vol);
                if (isBlockOrBrickMaterial(matName) || !w.material) {
                    totalBrickQty += Number(q.qty) || 0;
                }
                totalPlasterArea += netArea;
                const wallThkMm = Math.round(thkM * 1000);
                const dedNote = dedRemarks.length
                    ? ` | Deductions: ${dedRemarks.join(', ')}`
                    : '';
                // Live Quantities table shows face area (Gross/Deduction/Net in m²).
                // Brick/block *counts* (Nos) belong only in the material BOQ estimate,
                // not in this per-wall area table — unit must be m² here.
                // qty must be net face area (m²), never the brick/block Nos from wallQtyForMaterial.
                rows.push({
                    material: matName,
                    element: w.label,
                    qty: Math.round(netArea * 100) / 100,
                    gross: gross.toFixed(2),
                    cutout: deduction.toFixed(2),
                    net: netArea.toFixed(2),
                    unit: 'm²',
                    remarks: `Wall ${wallThkMm} mm · Gross ${gross.toFixed(2)} m² · Deduct ${deduction.toFixed(2)} m² · Net ${netArea.toFixed(2)} m²${dedNote}`,
                    elementId: w.id,
                    elementLabel: w.label,
                    deductionDetails: hits.map(d => ({
                        kind: d.kind,
                        label: d.label,
                        deductM2: d.deductM2,
                        openWidthM: d.openWidthM,
                        openHeightM: d.openHeightM
                    }))
                });
            });
            const conc = projectOverrides.concrete;

            const slabSlabOl = computeSlabSlabOverlapDeductions(slabs);
            const slabStructuralOl = computeSlabStructuralOverlapDeductions(slabs, walls, columns);
            function processHorizontal(el, materialLabel) {
                let planAreaDraw;
                if (el.vertices && el.vertices.length >= 3) {
                    const absPts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                    planAreaDraw = polygonArea(absPts);
                } else {
                    planAreaDraw = (el.w || 0) * (el.h || 0);
                }
                const grossArea = planAreaDraw * cf * cf;
                const thk = (el.zHeight || 0.15);
                const grossVol = grossArea * thk;
                const hits = getDeductionsOverlapping(el, openingsAll);
                let deductVol = 0;
                let dedRemarks = [];
                hits.forEach(({ opening: o, areaDraw }) => {
                    const overlapM2 = areaDraw * cf * cf;
                    const dVol = overlapM2 * thk;
                    deductVol += dVol;
                    dedRemarks.push(`${o.label}(${dVol.toFixed(3)}m³)`);
                });
                // Slab–slab union allocation
                const ssOlDraw = slabSlabOl[el.id] || 0;
                let cutArea = hits.reduce((s, h) => s + h.areaDraw * cf * cf, 0);
                if (ssOlDraw > 0) {
                    const ssOlM2 = ssOlDraw * cf * cf;
                    cutArea += ssOlM2;
                    deductVol += ssOlM2 * thk;
                    dedRemarks.push(`Slab∩(${ssOlM2.toFixed(2)}m²)`);
                }
                const hostOlDraw = slabStructuralOl[el.id] || 0;
                if (hostOlDraw > 0) {
                    const hostOlM2 = hostOlDraw * cf * cf;
                    cutArea += hostOlM2;
                    deductVol += hostOlM2 * thk;
                    dedRemarks.push(`Wall/Column∩(${hostOlM2.toFixed(2)}m²)`);
                }
                const netVol = Math.max(0, grossVol - deductVol);
                const dedNote = dedRemarks.length ? ` · Deduct: ${dedRemarks.join(', ')}` : '';
                const netArea = Math.max(0, grossArea - cutArea);
                const br = concreteBreakdown(netVol);
                const matName = materialDisplayName(el, materialLabel);
                rows.push({
                    material: matName,
                    element: el.label,
                    qty: netVol.toFixed(3),
                    gross: grossArea.toFixed(2),
                    cutout: cutArea.toFixed(2),
                    net: netArea.toFixed(2),
                    unit: 'm³',
                    remarks: `${br.note}${dedNote}`,
                    elementId: el.id,
                    elementLabel: el.label
                });
                return { grossArea, netArea, netVol };
            }
            let totalSlabNetArea = 0;
            slabs.forEach(s => { const r = processHorizontal(s, 'Concrete – Slab');
                totalSlabNetArea += r.netArea; });
            // Floor finish (tile) area ≠ slab area: deduct the wall footprint sitting
            // on the slab, then add the skirting strip (wall length × SKIRTING_HEIGHT_M),
            // since skirting is tiled material too.
            const skirtingAreaM2 = wallLengthTotalM * SKIRTING_HEIGHT_M;
            const totalTileArea = Math.max(0, totalSlabNetArea - wallFootprintTotalM2) + skirtingAreaM2;
            columns.forEach(c => {
                // Plan area: polygon area if vertices exist, else bounding box
                let planAreaDraw;
                if (c.vertices && c.vertices.length >= 3) {
                    const absPts = c.vertices.map(v => ({ x: c.x + v.x, y: c.y + v.y }));
                    planAreaDraw = polygonArea(absPts);
                } else {
                    planAreaDraw = (c.w || 0) * (c.h || 0);
                }
                const planAreaM2 = planAreaDraw * cf * cf;
                const grossVol = planAreaM2 * (c.zHeight || 3.0);
                const hits = getDeductionsOverlapping(c, openingsAll);
                let deductVol = 0;
                let dedRemarks = [];
                hits.forEach(({ opening: o, areaDraw }) => {
                    const ratio = planAreaDraw > 0 ? Math.min(1, areaDraw / planAreaDraw) : 0;
                    const dVol = grossVol * ratio;
                    deductVol += dVol;
                    dedRemarks.push(`${o.label}(${dVol.toFixed(3)}m³)`);
                });
                const netVol = Math.max(0, grossVol - deductVol);
                const dedNote = dedRemarks.length ? ` · Deduct: ${dedRemarks.join(', ')}` : '';
                const brC = concreteBreakdown(netVol);
                rows.push({
                    material: materialDisplayName(c, 'Concrete – Column'),
                    element: c.label,
                    qty: netVol.toFixed(3),
                    unit: 'm³',
                    remarks: `${brC.note}${dedNote}`,
                    elementId: c.id,
                    elementLabel: c.label
                });
            });
            beams.forEach(b => {
                // Live dimensions — same rules as computeMaterialEstimate / 3D viewer
                const beamWidthM = (typeof b.thickness === 'number' && b.thickness > 0)
                    ? b.thickness
                    : DEFAULT_BEAM_THICKNESS_M;
                const beamDepthM = (typeof b.zHeight === 'number' && b.zHeight > 0)
                    ? b.zHeight
                    : 0.45;
                const grossVol = (b.isLine && b.length != null)
                    ? (b.length * cf) * beamWidthM * beamDepthM
                    : (b.w * cf) * (b.h * cf) * beamDepthM;
                const hits = getDeductionsOverlapping(b, openingsAll);
                let deductVol = 0;
                let dedRemarks = [];
                hits.forEach(({ opening: o }) => {
                    let openWidthDraw = b.isLine ? cutoutWidthAlongLine(b, o) : Math.max(o.w, o.h);
                    if (openWidthDraw < 1e-6) openWidthDraw = Math.max(o.w, o.h);
                    const openWidthM = openWidthDraw * cf;
                    const thk = beamWidthM;
                    const dH = Math.min(beamDepthM, (o.zHeight || beamDepthM));
                    const dVol = openWidthM * thk * dH;
                    deductVol += dVol;
                    dedRemarks.push(`${o.label}(${dVol.toFixed(3)}m³)`);
                });
                // Beam–wall intersection: deduct shared length × beam section (avoid double material)
                walls.forEach(function (w) {
                    if (w.hidden) return;
                    if (!elementIntersectsWall(w, b) && !(b.isLine && w.isLine && wallWallOverlapLengthDraw(b, w) > 0)) return;
                    let olDraw = 0;
                    if (b.isLine && w.isLine) {
                        olDraw = wallWallOverlapLengthDraw(b, w);
                    } else if (b.isLine) {
                        olDraw = cutoutWidthAlongLine(b, w) || (typeof getLineThicknessDraw === 'function' ? getLineThicknessDraw(w) : 8);
                    } else {
                        olDraw = Math.min(b.w || 0, b.h || 0) || 0;
                    }
                    if (olDraw <= 1e-6) return;
                    const olM = olDraw * cf;
                    const bThk = beamWidthM;
                    const bDepth = beamDepthM;
                    const dVol = olM * bThk * bDepth;
                    deductVol += dVol;
                    dedRemarks.push(`Wall∩${w.label || w.id}(${dVol.toFixed(3)}m³)`);
                });
                const netVol = Math.max(0, grossVol - deductVol);
                const dedNote = dedRemarks.length ? ` · Deduct: ${dedRemarks.join(', ')}` : '';
                const brB = concreteBreakdown(netVol);
                rows.push({
                    material: materialDisplayName(b, 'Concrete – Beam'),
                    element: b.label,
                    qty: netVol.toFixed(3),
                    unit: 'm³',
                    remarks: `${brB.note}${dedNote}`,
                    elementId: b.id,
                    elementLabel: b.label
                });
            });
            openingsAll.forEach(o => {
                // Plan / face area of cutout
                let areaM2;
                if (o.vertices && o.vertices.length >= 3) {
                    const abs = o.vertices.map(v => ({ x: o.x + v.x, y: o.y + v.y }));
                    areaM2 = polygonArea(abs) * cf * cf;
                } else {
                    // For wall-face openings prefer width along parent × opening height when parent is a line wall
                    const parent = o.parentId != null ? elements.find(e => e.id === o.parentId) : null;
                    if (parent && parent.isLine && parent.p1 && parent.p2) {
                        let openWidthDraw = cutoutWidthAlongLine(parent, o);
                        if (openWidthDraw < 1e-6) openWidthDraw = Math.max(o.w, o.h);
                        const openHeightM = Math.max(0.01, o.zHeight || 2.1);
                        areaM2 = openWidthDraw * cf * openHeightM;
                    } else {
                        areaM2 = Math.max(o.w, o.h) * cf * Math.max(0.01, o.zHeight || 2.1);
                    }
                }
                // Depth/thickness turns area cutout into volume (m³)
                const depth = (o.depth != null && o.depth > 0) ? o.depth
                    : ((o.thickness != null && o.thickness > 0 && o._hasDepth) ? o.thickness : 0);
                const hosts = [];
                [...walls, ...slabs, ...columns, ...beams].forEach(host => {
                    if (o.parentId === host.id || overlapArea(host, o) > 0) hosts.push(host.label);
                });
                const hostNote = hosts.length ? `Affects: ${hosts.join(', ')}` : 'No host overlap';
                if (depth > 0) {
                    const vol = areaM2 * depth;
                    rows.push({
                        material: 'Cutout / Opening',
                        element: o.label,
                        qty: vol.toFixed(3),
                        gross: areaM2.toFixed(3),
                        cutout: '—',
                        net: vol.toFixed(3),
                        unit: 'm³',
                        remarks: `Area ${areaM2.toFixed(3)} m² × depth ${depth} m = ${vol.toFixed(3)} m³ · ${hostNote}`,
                        elementId: o.id,
                        elementLabel: o.label
                    });
                } else {
                    rows.push({
                        material: 'Cutout / Opening',
                        element: o.label,
                        qty: areaM2.toFixed(2),
                        gross: areaM2.toFixed(2),
                        cutout: '—',
                        net: areaM2.toFixed(2),
                        unit: 'm²',
                        remarks: `Area ${areaM2.toFixed(2)} m² (no depth) · ${hostNote}`,
                        elementId: o.id,
                        elementLabel: o.label
                    });
                }
            });
            const plas = plasterBreakdown(totalPlasterArea);
            rows.push({
                material: 'Plastering',
                element: 'All Walls',
                qty: totalPlasterArea.toFixed(2),
                unit: 'm²',
                remarks: plas.note,
                elementId: null,
                elementLabel: 'All Walls',
                isAggregate: true,
                aggregateType: 'walls'
            });
            const tiles = tileCount(totalTileArea);
            rows.push({
                material: 'Tiling',
                element: 'Floor Areas (from Slabs)',
                qty: tiles.count,
                unit: 'Nos',
                remarks: `${tiles.note} · Floor finish ${totalTileArea.toFixed(2)} m² `
                    + `(Slab ${totalSlabNetArea.toFixed(2)} − Wall footprint ${wallFootprintTotalM2.toFixed(2)} `
                    + `+ Skirting ${skirtingAreaM2.toFixed(2)} @ ${(SKIRTING_HEIGHT_M * 1000).toFixed(0)}mm)`,
                elementId: null,
                elementLabel: 'Floor Areas',
                isAggregate: true,
                aggregateType: 'tile'
            });
            rows.push({
                material: 'Skirting Tiling',
                element: 'Wall Base (all walls)',
                qty: skirtingAreaM2.toFixed(2),
                unit: 'm²',
                remarks: `Wall length ${wallLengthTotalM.toFixed(2)} m × ${(SKIRTING_HEIGHT_M * 1000).toFixed(0)} mm skirting height`,
                elementId: null,
                elementLabel: 'Skirting',
                isAggregate: true,
                aggregateType: 'skirting'
            });
            const paintInfo = paintLitres(totalPlasterArea);
            rows.push({
                material: 'Painting',
                element: 'All Walls',
                qty: paintInfo.litres,
                unit: 'Liters',
                remarks: paintInfo.note + ` · Area ${totalPlasterArea.toFixed(2)} m²`,
                elementId: null,
                elementLabel: 'All Walls',
                isAggregate: true,
                aggregateType: 'walls'
            });
            elements.forEach(el => {
                if (['wall', 'slab', 'column', 'beam'].includes(el.type)) {
                    const existing = rows.find(r => r.elementId === el.id);
                    if (!existing) {
                        const vol = (el.w * cf) * (el.h * cf) * (el.zHeight || 0.15);
                        rows.push({
                            material: el.type.charAt(0).toUpperCase() + el.type.slice(1),
                            element: el.label,
                            qty: vol.toFixed(3),
                            unit: 'm³',
                            remarks: el.material ? `Mat: ${el.material}` : '',
                            elementId: el.id,
                            elementLabel: el.label
                        });
                    }
                }
            });
            return rows;
        }

        function renderQuantityTable() {
            const tbody = document.getElementById('table-body');
            if (!tbody) return;
            let rows = [];
            try {
                rows = computeQuantities() || [];
            } catch (err) {
                console.error('computeQuantities failed', err);
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);padding:14px;">Quantity calculation error — check calibration and elements.</td></tr>';
                return;
            }
            const hasTakeoff = (elements || []).some(e => e && !e.hidden && (e.type === 'wall' || e.type === 'slab' || e.type === 'column' || e.type === 'beam'));
            if (!hasTakeoff) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-tertiary);padding:14px;">No measured elements yet. Draw walls / slabs / columns, or run AI Detect, then open this panel (↑ Quantities).</td></tr>';
                return;
            }
            let html = '';
            rows.forEach((row, index) => {
                const activeClass = row.elementId && selectedIds.includes(row.elementId) ? 'active-row' : '';
                const dataAttrs =
                    `data-row-idx="${index}" data-element-id="${row.elementId||''}" data-label="${escapeHtml(row.elementLabel||'')}"`;
                const gross = row.gross != null ? row.gross : row.qty;
                const cutout = row.cutout != null ? row.cutout : '—';
                const net = row.net != null ? row.net : row.qty;
                html += `<tr class="${activeClass}" ${dataAttrs}>
              <td>${escapeHtml(String(row.material != null ? row.material : ''))}</td>
              <td>${escapeHtml(String(row.element != null ? row.element : ''))}</td>
              <td>${escapeHtml(String(gross))}</td>
              <td style="color:var(--danger);">${escapeHtml(String(cutout))}</td>
              <td><strong>${escapeHtml(String(net))}</strong></td>
              <td>${escapeHtml(String(row.unit != null ? row.unit : ''))}</td>
              <td style="font-size:11px;color:var(--text-secondary);">${escapeHtml(String(row.remarks != null ? row.remarks : ''))}</td>
            </tr>`;
            });
            tbody.innerHTML = html;
            tbody.querySelectorAll('tr').forEach(tr => {
                tr.addEventListener('click', function(e) {
                    if (isConfirmed) return;
                    const elementId = parseInt(this.dataset.elementId);
                    const label = this.dataset.label;
                    if (elementId && !isNaN(elementId)) {
                        const el = elements.find(e => e.id === elementId);
                        if (el) {
                            selectedIds = [el.id];
                            renderAll();
                            try {
                                if (typeof currentView !== 'string' || currentView === '2d') {
                                    zoomToElement(el);
                                }
                            } catch (_) {}
                        }
                    } else if (label) {
                        if (label === 'All Walls') {
                            const ids = elements.filter(e => e.type === 'wall').map(e => e.id);
                            if (ids.length) { selectedIds = ids;
                                renderAll(); }
                        } else if (label === 'Floor Areas') {
                            const ids = elements.filter(e => e.type === 'slab').map(e => e.id);
                            if (ids.length) { selectedIds = ids;
                                renderAll(); }
                        }
                    }
                });
            });
        }

        // ================================================================
        //  CANVAS INTERACTION  (with ENTER key to close polygon)
        //  + Hover detection for deduction tools
        // ================================================================
        function setupCanvasInteraction() {
            const canvas = document.getElementById('canvas2d');
            let startX, startY;
            let isPanning = false;
            let spaceHeld = false;

            window.addEventListener('keydown', (e) => {
                // Core rule: if focus is in ANY editable property/field, no app shortcuts.
                // Do not stopPropagation in capture — that would block the input from receiving keys.
                const isEditing = isTypingTarget(e.target) || isTypingTarget(document.activeElement);

                if (isEditing) {
                    // Escape exits the field; all other keys belong to the input (digits, Backspace, arrows…)
                    if (e.key === 'Escape') {
                        try { (e.target || document.activeElement).blur(); } catch (_) {}
                    }
                    return;
                }

                if (e.code === 'Space' && !e.repeat) {
                    if (document.activeElement === document.body || document.activeElement === canvas) {
                        e.preventDefault();
                    }
                    spaceHeld = true;
                    if (!mouseDown && currentView === '2d') canvas.style.cursor = 'grab';
                    return;
                }

                if (!isEditing && currentView === '2d' && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
                        e.key)) {
                    e.preventDefault();
                    const step = e.shiftKey ? 80 : 30;
                    if (e.key === 'ArrowLeft') viewport.offsetX += step;
                    if (e.key === 'ArrowRight') viewport.offsetX -= step;
                    if (e.key === 'ArrowUp') viewport.offsetY += step;
                    if (e.key === 'ArrowDown') viewport.offsetY -= step;
                    renderCanvas2D();
                    return;
                }

                // ENTER: Complete current drawing
                if ((e.key === 'Enter' || e.key === 'Return') && !isEditing) {
                    if (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length >= 3) {
                        e.preventDefault();
                        completeDrawing();
                        return;
                    }
                    if (currentTool === 'deduction_wall' && deductionLinePoints.length >= 2) {
                        e.preventDefault();
                        completeDeductionLine();
                        return;
                    }
                    if ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length >= 2) {
                        e.preventDefault();
                        completeWallBeamLine();
                        return;
                    }
                }

                // Shortcuts
                if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); if (e.shiftKey) redo();
                    else undo(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault();
                    redo(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault();
                    selectAllElements(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault();
                    copySelected(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault();
                    pasteClipboard(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault();
                    duplicateSelected(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === '=') { e.preventDefault();
                    document.getElementById('btnZoomIn').click(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault();
                    document.getElementById('btnZoomOut').click(); return; }
                if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault();
                    document.getElementById('btnZoomFit').click(); return; }
                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                    try {
                        if (typeof openExportModal === 'function') openExportModal();
                        else {
                            const be = document.getElementById('btnExport');
                            if (be) be.click();
                        }
                    } catch (_) {}
                    return;
                }
                if (e.key === '1' && !isEditing) toggleView('2d');
                if (e.key === '2' && !isEditing) toggleView('3d');
                if (e.key === 'm' && !isEditing) { document.querySelector('[data-tool="measure"]').click(); }
                if (e.key === 'c' && !isEditing && !e.ctrlKey && !e.metaKey) {
                    const btn = document.querySelector('[data-tool="calibrate"]');
                    if (btn) btn.click();
                }
                if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditing) {
                    e.preventDefault();
                    deleteSelected();
                    return;
                }
                // Rotate selection: R = 90° CW, Shift+R = 90° CCW
                if (!isEditing && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    if (selectedIds && selectedIds.length) {
                        e.preventDefault();
                        rotateSelected(e.shiftKey ? -90 : 90);
                        return;
                    }
                }
                if (e.key === 'Escape' && !isEditing) {
                    if (polygonPoints.length > 0 || drawPreview || deductionLinePoints.length > 0) {
                        cancelDrawing();
                        return;
                    }
                    if (dragMode === 'draw') {
                        dragMode = null;
                        drawStartWorld = null;
                        drawCurrentWorld = null;
                        drawPreview = null;
                        document.getElementById('canvas2d').style.cursor = currentTool ? 'crosshair' : 'default';
                        document.getElementById('statusMode').textContent = currentTool ? 'Draw: ' + currentTool :
                            'Select';
                        renderCanvas2D();
                        return;
                    }
                    if (currentTool) {
                        currentTool = null;
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        document.getElementById('statusMode').textContent = 'Select';
                        document.getElementById('canvas2d').style.cursor = 'default';
                        renderAll();
                        return;
                    }
                    selectedIds = [];
                    renderAll();
                }
            });

            window.addEventListener('keyup', (e) => {
                if (e.code === 'Space') {
                    spaceHeld = false;
                    if (dragMode !== 'pan') {
                        canvas.style.cursor = currentTool ? 'crosshair' : 'default';
                    }
                }
            });

            canvas.addEventListener('wheel', (e) => {
                if (currentView === '3d') return;
                // When zoom is locked, ignore trackpad/scroll zoom (easier pan on trackpad).
                // Hold Ctrl/Cmd to force zoom even while locked.
                if (zoomLocked && !(e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    return;
                }
                e.preventDefault();
                const ptr = getCanvasPointer(e, canvas);
                const sx = ptr.sx;
                const sy = ptr.sy;
                const world = ptr.world;
                const delta = e.deltaY > 0 ? -0.1 : 0.1;
                let newScale = viewport.scale * (1 + delta);
                newScale = Math.min(Math.max(0.1, newScale), 10);
                viewport.offsetX = sx - world.x * newScale;
                viewport.offsetY = sy - world.y * newScale;
                viewport.scale = newScale;
                updateZoomDisplays();
                renderCanvas2D();
                document.getElementById('statusCursor').textContent =
                    `(${world.x.toFixed(1)}, ${world.y.toFixed(1)})`;
            }, { passive: false });

            canvas.addEventListener('mousedown', (e) => {
                if (isConfirmed || currentView === '3d') return;
                const ptr = getCanvasPointer(e, canvas);
                const sx = ptr.sx;
                const sy = ptr.sy;
                const world = ptr.world;
                startX = sx;
                startY = sy;
                mouseDown = true;

                if (e.button === 1 || (e.button === 0 && (e.altKey || spaceHeld))) {
                    isPanning = true;
                    dragMode = 'pan';
                    canvas.style.cursor = 'grabbing';
                    e.preventDefault();
                    return;
                }

                if (currentTool === 'pan' && e.button === 0) {
                    isPanning = true;
                    dragMode = 'pan';
                    canvas.style.cursor = 'grabbing';
                    e.preventDefault();
                    return;
                }

                if (currentTool === 'calibrate' && e.button === 0) {
                    calibratePoints.push({ x: world.x, y: world.y });
                    if (calibratePoints.length > 2) calibratePoints = [{ x: world.x, y: world.y }];
                    calibratePreview = null;
                    renderCanvas2D();
                    if (calibratePoints.length === 1) {
                        document.getElementById('statusMode').textContent = 'Calibrate: click 2nd point';
                    } else if (calibratePoints.length === 2) {
                        finishCalibration(calibratePoints[0], calibratePoints[1]);
                    }
                    return;
                }

                if (currentTool === 'measure' && e.button === 0) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    if (measurePoints.length >= 2) {
                        // Start a new measurement on next click
                        measurePoints = [];
                        measurePreview = null;
                        document.getElementById('measureLabel').style.display = 'none';
                    }
                    measurePoints.push({ x: snapped.x, y: snapped.y });
                    measurePreview = null;
                    renderCanvas2D();
                    if (measurePoints.length === 1) {
                        document.getElementById('statusMode').textContent = 'Measure: click 2nd point';
                    } else if (measurePoints.length === 2) {
                        const p1 = measurePoints[0],
                            p2 = measurePoints[1];
                        const dist = toMeters(Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2));
                        document.getElementById('statusMode').textContent =
                            `📏 ${dist.toFixed(2)} m — click again to measure another`;
                        document.getElementById('statusCursor').textContent = `📏 ${dist.toFixed(2)} m`;
                        const label = document.getElementById('measureLabel');
                        label.textContent = dist.toFixed(2) + ' m';
                        label.style.display = 'block';
                        const sp = worldToScreen((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
                        label.style.left = sp.x + 'px';
                        label.style.top = (sp.y - 20) + 'px';
                        markWorkSession();
                    }
                    return;
                }

                // ---- Deduction Wall continuous polyline with snapping ----
                if (currentTool === 'deduction_wall' && e.button === 0) {
                    let pt;
                    // First click of a new segment: bind to the wall under the cursor
                    // so continuous deductions can switch walls without pre-selecting.
                    if (deductionLinePoints.length === 0) {
                        let startParent = null;
                        if (hoveredParentId != null) {
                            startParent = findElementById(hoveredParentId);
                        }
                        if ((!startParent || startParent.type !== 'wall') &&
                            deductionTargetLocked && pendingDeductionParentId != null) {
                            startParent = findElementById(pendingDeductionParentId);
                        }
                        if (startParent && startParent.type === 'wall') {
                            deductionParentId = startParent.id;
                            // Hover/click on a wall always wins for this segment
                            if (hoveredParentId != null && sameElementId(hoveredParentId, startParent.id)) {
                                pendingDeductionParentId = startParent.id;
                            }
                        } else {
                            deductionParentId = null;
                        }
                    }
                    if (hoveredParentId && deductionLinePoints.length === 0) {
                        const parent = findElementById(hoveredParentId);
                        if (parent && parent.isLine && parent.p1 && parent.p2) {
                            const nearest = nearestPointOnSegment(
                                world.x, world.y,
                                parent.p1.x, parent.p1.y,
                                parent.p2.x, parent.p2.y
                            );
                            pt = { x: nearest.x, y: nearest.y };
                            deductionParentId = parent.id;
                        }
                    }
                    if (!pt) pt = snapPoint(world, e);
                    // Snap subsequent points to the same parent wall for this segment
                    if (deductionParentId != null && deductionLinePoints.length > 0) {
                        const parent = findElementById(deductionParentId);
                        if (parent && parent.isLine && parent.p1 && parent.p2) {
                            const nearest = nearestPointOnSegment(
                                world.x, world.y,
                                parent.p1.x, parent.p1.y,
                                parent.p2.x, parent.p2.y
                            );
                            pt = { x: nearest.x, y: nearest.y };
                        }
                    }
                    deductionLinePoints.push(pt);
                    continuousTempPreview = null;
                    const n = deductionLinePoints.length;
                    const host = deductionParentId != null ? findElementById(deductionParentId) : null;
                    if (n === 1) {
                        document.getElementById('statusMode').textContent = host
                            ? `Deduction on ${host.label}: START placed · click 2nd point · Enter finishes · Esc cancel`
                            : `Deduction Wall: START point placed · move mouse for line · click 2nd point · Esc cancel`;
                    } else {
                        document.getElementById('statusMode').textContent = host
                            ? `Deduction on ${host.label}: ${n} point(s) · Enter/Done to finish · Esc cancel`
                            : `Deduction Wall: ${n} point(s) · click more · Enter/Done/double-click to finish · Esc cancel`;
                    }
                    renderCanvas2D();
                    return;
                }

                // ---- Polygon tools (slab, cutout) ----
                if (['slab', 'cutout', 'column'].includes(currentTool) && e.button === 0) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    if (polygonPoints.length > 0 && ['column', 'slab'].includes(currentTool)) {
                        snapped = snapAxisPoint(polygonPoints[polygonPoints.length - 1], snapped, e);
                    }
                    polygonPoints.push(snapped);
                    polygonTempLine = null;
                    polygonElementType = currentTool;
                    const n = polygonPoints.length;
                    const hint = n >= 3 ? ' · Enter / Done to finish' : ' · need 3+ points';
                    document.getElementById('statusMode').textContent =
                        `${currentTool}: ${n} vertices${hint}`;
                    renderCanvas2D();
                    return;
                }

                // ---- Wall / Beam continuous polyline ----
                if ((currentTool === 'wall' || currentTool === 'beam') && e.button === 0) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    if (['wall', 'beam'].includes(currentTool) && polygonPoints.length > 0) {
                        snapped = snapAxisPoint(polygonPoints[polygonPoints.length - 1], snapped, e);
                    }
                    polygonPoints.push(snapped);
                    continuousTempPreview = null;
                    const n = polygonPoints.length;
                    const axisHint = ['wall', 'beam', 'column', 'slab'].includes(currentTool) && axisSnapKind
                        ? ' · ' + axisSnapKind + ' snap' : '';
                    document.getElementById('statusMode').textContent =
                        `${currentTool}: ${n} point(s) · click more · Enter/Done/double-click to finish${axisHint} · Esc cancel`;
                    renderCanvas2D();
                    return;
                }

                // Column uses polygon mode (handled with slab/cutout above)


                // ---- Element selection + vertex/endpoint editing ----
                if (e.button === 0) {
                    // First: try hit-test control points of selected element (reshape / resize)
                    // Allow when Select, Move, or no tool — so size handles work right after drawing.
                    if (selectedIds.length === 1 && (!currentTool || currentTool === 'select' || currentTool === 'move')) {
                        const el = findElementById(selectedIds[0]);
                        if (el && !el.locked) {
                            // Slab/column shape editing requires vertices (same as polygon-drawn columns)
                            if (el.type === 'slab' || el.type === 'column') ensureElementVertices(el);
                            // Rotate handle (above center)
                            const rh = getRotateHandleWorld(el);
                            const hsRot = 16 / viewport.scale;
                            if (Math.hypot(world.x - rh.x, world.y - rh.y) <= hsRot) {
                                saveState();
                                const c = getElementCenter(el);
                                editingVertex = {
                                    elId: el.id,
                                    rotate: true,
                                    pivot: { x: c.x, y: c.y },
                                    startAngle: Math.atan2(world.y - c.y, world.x - c.x),
                                    lastAngle: Math.atan2(world.y - c.y, world.x - c.x)
                                };
                                dragMode = 'reshape';
                                canvas.style.cursor = 'grabbing';
                                return;
                            }
                            // Larger hit target so handles are easy to grab when zoomed out
                            const hs = 14 / viewport.scale;
                            // Line endpoints
                            if (el.isLine && el.p1 && el.p2) {
                                if (Math.hypot(world.x - el.p1.x, world.y - el.p1.y) <= hs) {
                                    editingVertex = { elId: el.id, endpoint: 'p1' };
                                    dragMode = 'reshape';
                                    markElementEdited(el);
                                    saveState();
                                    return;
                                }
                                if (Math.hypot(world.x - el.p2.x, world.y - el.p2.y) <= hs) {
                                    editingVertex = { elId: el.id, endpoint: 'p2' };
                                    dragMode = 'reshape';
                                    markElementEdited(el);
                                    saveState();
                                    return;
                                }
                            }
                            // SIZE first (bounding-box handles) so slabs/columns can always
                            // be made bigger/smaller by dragging corners or edge midpoints.
                            // Hold Shift to prefer vertex (shape) edit instead.
                            if (!el.isLine && !e.shiftKey) {
                                const handles = [
                                    ['nw', el.x, el.y], ['n', el.x + el.w / 2, el.y], ['ne', el.x + el.w, el.y],
                                    ['w', el.x, el.y + el.h / 2], ['e', el.x + el.w, el.y + el.h / 2],
                                    ['sw', el.x, el.y + el.h], ['s', el.x + el.w / 2, el.y + el.h],
                                    ['se', el.x + el.w, el.y + el.h]
                                ];
                                for (const [name, hx, hy] of handles) {
                                    if (Math.abs(world.x - hx) <= hs && Math.abs(world.y - hy) <= hs) {
                                        editingVertex = {
                                            elId: el.id,
                                            handle: name,
                                            start: { x: el.x, y: el.y, w: el.w, h: el.h },
                                            hasVertices: !!(el.vertices && el.vertices.length >= 3),
                                            startVertices: el.vertices ? el.vertices.map(v => ({ x: v.x, y: v.y })) : null
                                        };
                                        dragMode = 'reshape';
                                        markElementEdited(el);
                                        saveState();
                                        return;
                                    }
                                }
                            }
                            // SHAPE: vertex drag (Shift+corner, or any free vertex)
                            if (!el.isLine && el.vertices && el.vertices.length >= 3) {
                                for (let vi = 0; vi < el.vertices.length; vi++) {
                                    const vx = el.x + el.vertices[vi].x;
                                    const vy = el.y + el.vertices[vi].y;
                                    if (Math.hypot(world.x - vx, world.y - vy) <= hs) {
                                        editingVertex = { elId: el.id, vertexIndex: vi };
                                        dragMode = 'reshape';
                                        markElementEdited(el);
                                        saveState();
                                        return;
                                    }
                                }
                            }
                            // Shift held but no vertex: still allow size handles
                            if (!el.isLine && e.shiftKey) {
                                const handles = [
                                    ['nw', el.x, el.y], ['n', el.x + el.w / 2, el.y], ['ne', el.x + el.w, el.y],
                                    ['w', el.x, el.y + el.h / 2], ['e', el.x + el.w, el.y + el.h / 2],
                                    ['sw', el.x, el.y + el.h], ['s', el.x + el.w / 2, el.y + el.h],
                                    ['se', el.x + el.w, el.y + el.h]
                                ];
                                for (const [name, hx, hy] of handles) {
                                    if (Math.abs(world.x - hx) <= hs && Math.abs(world.y - hy) <= hs) {
                                        editingVertex = {
                                            elId: el.id,
                                            handle: name,
                                            start: { x: el.x, y: el.y, w: el.w, h: el.h },
                                            hasVertices: !!(el.vertices && el.vertices.length >= 3),
                                            startVertices: el.vertices ? el.vertices.map(v => ({ x: v.x, y: v.y })) : null
                                        };
                                        dragMode = 'reshape';
                                        markElementEdited(el);
                                        saveState();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                    // Collect ALL hits so overlapping elements can be cycled (Ctrl/Cmd+click)
                    const hitStack = hitTestAllElements(world);
                    overlapHitIds = hitStack.map(el => el.id);
                    let foundEl = null;
                    if (hitStack.length > 0) {
                        const key = overlapHitIds.join(',');
                        if (e.ctrlKey || e.metaKey) {
                            // Cycle through stack
                            if (key !== lastOverlapKey) {
                                overlapCycleIndex = 0;
                                lastOverlapKey = key;
                            } else {
                                overlapCycleIndex = (overlapCycleIndex + 1) % hitStack.length;
                            }
                            foundEl = hitStack[overlapCycleIndex];
                            if (hitStack.length > 1) {
                                const statusMode = document.getElementById('statusMode');
                                if (statusMode) {
                                    statusMode.textContent =
                                        `Overlap ${overlapCycleIndex + 1}/${hitStack.length}: ${foundEl.label || foundEl.type} (Ctrl+click to cycle)`;
                                }
                            }
                        } else {
                            // Prefer currently selected if still under cursor, else topmost
                            const preferred = hitStack.find(function (el) { return isSelectedId(el.id); });
                            foundEl = preferred || hitStack[0];
                            overlapCycleIndex = Math.max(0, hitStack.indexOf(foundEl));
                            lastOverlapKey = key;
                        }
                    } else {
                        lastOverlapKey = '';
                        overlapCycleIndex = 0;
                    }
                    if (foundEl) {
                        if (!e.shiftKey) {
                            selectedIds = expandSelectionWithChildren([foundEl.id]);
                        } else {
                            if (isSelectedId(foundEl.id)) {
                                const removeSet = new Set(expandSelectionWithChildren([foundEl.id]).map(String));
                                selectedIds = selectedIds.filter(function (id) { return !removeSet.has(String(id)); });
                            } else {
                                selectedIds = expandSelectionWithChildren(selectedIds.concat([foundEl.id]));
                            }
                        }
                        dragMode = 'select';
                        dragElementStart = {};
                        elements.forEach(function (el) {
                            if (isSelectedId(el.id)) {
                                dragElementStart[el.id] = {
                                    x: el.x, y: el.y, w: el.w, h: el.h,
                                    p1: el.p1 ? { x: el.p1.x, y: el.p1.y } : null,
                                    p2: el.p2 ? { x: el.p2.x, y: el.p2.y } : null,
                                };
                            }
                        });
                        renderAll();
                        return;
                    }
                    if (!e.shiftKey) { selectedIds = []; renderAll(); }
                    dragMode = 'select';
                    dragElementStart = {};
                }
            });

            canvas.addEventListener('mousemove', (e) => {
                if (currentView === '3d') return;
                const ptr = getCanvasPointer(e, canvas);
                const sx = ptr.sx;
                const sy = ptr.sy;
                const world = ptr.world;
                document.getElementById('statusCursor').textContent =
                    `(${world.x.toFixed(2)}, ${world.y.toFixed(2)})`;

                // ---- Deduction Wall: hover snap + live rubber-band from first point ----
                if (currentTool === 'deduction_wall') {
                    const targetType = 'wall';
                    let found = null;
                    for (let i = elements.length - 1; i >= 0; i--) {
                        const el = elements[i];
                        if (el.hidden || el.type !== targetType) continue;
                        if (el.isLine && el.p1 && el.p2) {
                            const ax = el.p1.x, ay = el.p1.y, bx = el.p2.x, by = el.p2.y;
                            const abx = bx - ax, aby = by - ay;
                            const len2 = abx * abx + aby * aby || 1;
                            let t = ((world.x - ax) * abx + (world.y - ay) * aby) / len2;
                            t = Math.max(0, Math.min(1, t));
                            const px = ax + t * abx, py = ay + t * aby;
                            const thk = getLineThicknessDraw(el) / 2 + 10 / viewport.scale;
                            if (Math.hypot(world.x - px, world.y - py) <= thk) {
                                found = el;
                                break;
                            }
                        }
                    }
                    if (found) {
                        hoveredParentId = found.id;
                        canvas.style.cursor = 'pointer';
                    } else {
                        if (hoveredParentId) hoveredParentId = null;
                        canvas.style.cursor = 'crosshair';
                    }

                    // After first click: always show start marker + rubber-band line to cursor
                    if (deductionLinePoints.length > 0) {
                        let pt = snapPoint(world, e);
                        const snapParentId = deductionParentId || hoveredParentId;
                        if (snapParentId) {
                            const parent = findElementById(snapParentId);
                            if (parent && parent.isLine && parent.p1 && parent.p2) {
                                const nearest = nearestPointOnSegment(
                                    world.x, world.y,
                                    parent.p1.x, parent.p1.y,
                                    parent.p2.x, parent.p2.y
                                );
                                pt = { x: nearest.x, y: nearest.y };
                            }
                        }
                        const last = deductionLinePoints[deductionLinePoints.length - 1];
                        continuousTempPreview = { x1: last.x, y1: last.y, x2: pt.x, y2: pt.y };
                        const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
                        const distM = toMeters(dist);
                        document.getElementById('statusMode').textContent =
                            `Deduction Wall: ${deductionLinePoints.length} point(s) · next ${distM.toFixed(2)} m · click to place · Enter/Done to finish · Esc cancel`;
                    } else if (found) {
                        document.getElementById('statusMode').textContent =
                            `Hovering over ${found.label} — click to place START point of deduction`;
                    } else {
                        document.getElementById('statusMode').textContent =
                            `Deduction Wall: click on a wall to place START point (or click anywhere)`;
                    }
                    renderCanvas2D();
                    return;
                } else {
                    if (hoveredParentId) {
                        hoveredParentId = null;
                        renderCanvas2D();
                    }
                }

                // ---- CAD-style object snap + overlap hover labels ----
                // Active for select and drawing tools (not pan/calibrate-only)
                {
                    const snapTools = ['select', 'wall', 'beam', 'slab', 'column', 'cutout',
                        'measure', 'door', 'window', 'deduction_wall', 'move', null, ''];
                    const toolOk = !currentTool || snapTools.indexOf(currentTool) >= 0;
                    if (toolOk && !e.altKey) {
                        const hit = findNearestElementSnap(world, { tolerancePx: SNAP_TOLERANCE_PX });
                        const prevId = hoveredSnapId;
                        const prevHits = overlapHitIds.join(',');
                        if (hit) {
                            hoveredSnapId = hit.el.id;
                            snapCursorPoint = hit.point;
                            snapKind = hit.kind || 'edge';
                            if (currentTool === 'select' || !currentTool || currentTool === 'move') {
                                canvas.style.cursor = 'pointer';
                            }
                        } else {
                            hoveredSnapId = null;
                            snapCursorPoint = null;
                            snapKind = null;
                        }
                        // Full stack under cursor for overlap UI (select tool)
                        const stack = hitTestAllElements(world);
                        overlapHitIds = stack.map(el => el.id);
                        hoverLabelWorld = stack.length ? { x: world.x, y: world.y } : null;
                        if (prevId !== hoveredSnapId || prevHits !== overlapHitIds.join(',')) {
                            renderCanvas2D();
                        }
                    } else if (hoveredSnapId || hoverLabelWorld) {
                        hoveredSnapId = null;
                        snapCursorPoint = null;
                        snapKind = null;
                        hoverLabelWorld = null;
                        overlapHitIds = [];
                        renderCanvas2D();
                    }
                }

                if (currentTool === 'calibrate' && calibratePoints.length === 1) {
                    calibratePreview = { x: world.x, y: world.y };
                    const p1 = calibratePoints[0];
                    const dist = Math.sqrt((world.x - p1.x) ** 2 + (world.y - p1.y) ** 2);
                    document.getElementById('statusMode').textContent =
                        `Calibrate: click 2nd point · ${dist.toFixed(2)} units`;
                    renderCanvas2D();
                    return;
                }

                // Measure live preview (Bluebeam-style)
                if (currentTool === 'measure' && measurePoints.length === 1) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    measurePreview = { x: snapped.x, y: snapped.y };
                    const p1 = measurePoints[0];
                    const dist = toMeters(Math.hypot(snapped.x - p1.x, snapped.y - p1.y));
                    document.getElementById('statusMode').textContent =
                        `Measure: click 2nd point · ${dist.toFixed(2)} m`;
                    document.getElementById('statusCursor').textContent = `📏 ${dist.toFixed(2)} m`;
                    renderCanvas2D();
                    return;
                }

                // Continuous wall / beam live preview
                if ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length > 0) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    const last = polygonPoints[polygonPoints.length - 1];
                    if (['wall', 'beam'].includes(currentTool)) snapped = snapAxisPoint(last, snapped, e);
                    continuousTempPreview = { x1: last.x, y1: last.y, x2: snapped.x, y2: snapped.y };
                    const dist = Math.hypot(snapped.x - last.x, snapped.y - last.y);
                    const distM = toMeters(dist);
                    const n = polygonPoints.length;
                    let snapHint = '';
                    if (snapCursorPoint && !e.altKey) {
                        const el = elements.find(ee => ee.id === hoveredSnapId);
                        snapHint = ' · ' + (formatSnapLabel(snapKind, el) || 'snapped');
                    }
                    const axisHint = ['wall', 'beam', 'column', 'slab'].includes(currentTool) && axisSnapKind
                        ? ' · ' + axisSnapKind + ' snap' : '';
                    document.getElementById('statusMode').textContent =
                        `${currentTool}: ${n} pts · next ${distM.toFixed(2)} m · Enter/Done to finish${axisHint}${snapHint}`;
                    renderCanvas2D();
                    return;
                }

                if (['slab', 'cutout', 'column'].includes(currentTool) &&
                    polygonPoints.length > 0 && !isPolygonClosed) {
                    let snapped = snapPoint(world, e);
                    if (snapCursorPoint && !e.altKey) snapped = { x: snapCursorPoint.x, y: snapCursorPoint.y };
                    const last = polygonPoints[polygonPoints.length - 1];
                    if (['column', 'slab'].includes(currentTool)) snapped = snapAxisPoint(last, snapped, e);
                    polygonTempLine = { x1: last.x, y1: last.y, x2: snapped.x, y2: snapped.y };
                    const dist = Math.hypot(snapped.x - last.x, snapped.y - last.y);
                    const distM = toMeters(dist);
                    const n = polygonPoints.length;
                    const ready = n >= 3 ? ' · Enter / Done to finish' : ` · need ${3 - n} more`;
                    const axisHint = ['column', 'slab'].includes(currentTool) && axisSnapKind
                        ? ' · ' + axisSnapKind + ' snap' : '';
                    let snapHint = '';
                    if (snapCursorPoint && !e.altKey) {
                        const el = elements.find(ee => ee.id === hoveredSnapId);
                        snapHint = ' · ' + (formatSnapLabel(snapKind, el) || 'snapped');
                    }
                    document.getElementById('statusMode').textContent =
                        `${currentTool}: ${n} vertices · next seg ${distM.toFixed(2)} m${ready}${axisHint}${snapHint}`;
                    renderCanvas2D();
                    return;
                }

                if (dragMode === 'pan' && isPanning) {
                    const dx = sx - startX,
                        dy = sy - startY;
                    viewport.offsetX += dx;
                    viewport.offsetY += dy;
                    startX = sx;
                    startY = sy;
                    renderCanvas2D();
                    return;
                }



                // Reshape: drag vertex / endpoint / handle
                if (dragMode === 'reshape' && mouseDown && editingVertex) {
                    const el = elements.find(ee => ee.id === editingVertex.elId);
                    if (el && !el.locked) {
                        if (editingVertex.rotate && editingVertex.pivot) {
                            const ang = Math.atan2(world.y - editingVertex.pivot.y, world.x - editingVertex.pivot.x);
                            let delta = ang - editingVertex.lastAngle;
                            // normalize
                            while (delta > Math.PI) delta -= Math.PI * 2;
                            while (delta < -Math.PI) delta += Math.PI * 2;
                            // Shift = snap to 15° increments from start
                            if (e.shiftKey) {
                                const fromStart = ang - editingVertex.startAngle;
                                const step = 15 * Math.PI / 180;
                                const snappedDelta = Math.round(fromStart / step) * step - (editingVertex.lastAngle - editingVertex.startAngle);
                                delta = snappedDelta;
                            }
                            if (Math.abs(delta) > 1e-6) {
                                const deg = delta * 180 / Math.PI;
                                rotateElementBy(el, deg, editingVertex.pivot);
                                // Keep wall deductions glued during free-rotate
                                if (el.type === 'wall') {
                                    transformAttachedChildren(el, 0, 0, deg, editingVertex.pivot);
                                }
                                editingVertex.lastAngle = ang;
                            }
                            renderCanvas2D();
                            return;
                        }
                        const snapped = snapPoint(world, e);
                        if (editingVertex.endpoint === 'p1') {
                            el.p1 = { x: snapped.x, y: snapped.y };
                            syncLineBounds(el);
                            if (el.type === 'wall') realignAttachedDeductionsToWall(el);
                        } else if (editingVertex.endpoint === 'p2') {
                            el.p2 = { x: snapped.x, y: snapped.y };
                            syncLineBounds(el);
                            if (el.type === 'wall') realignAttachedDeductionsToWall(el);
                        } else if (editingVertex.vertexIndex != null && el.vertices) {
                            const vi = editingVertex.vertexIndex;
                            el.vertices[vi] = { x: snapped.x - el.x, y: snapped.y - el.y };
                            // Update bounds from vertices
                            const absPts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                            const b = polygonBounds(absPts);
                            if (b) {
                                const ox = el.x, oy = el.y;
                                el.x = b.x; el.y = b.y; el.w = b.w; el.h = b.h;
                                el.vertices = absPts.map(p => ({ x: p.x - b.x, y: p.y - b.y }));
                            }
                        } else if (editingVertex.handle && editingVertex.start) {
                            const s = editingVertex.start;
                            let nx = s.x, ny = s.y, nw = s.w, nh = s.h;
                            const h = editingVertex.handle;
                            // Allow small columns/slabs (min ~1 drawing unit, was 5)
                            const minSz = 1;
                            if (h.includes('e')) nw = Math.max(minSz, snapped.x - s.x);
                            if (h.includes('w')) { nw = Math.max(minSz, s.x + s.w - snapped.x); nx = snapped.x; }
                            if (h.includes('s')) nh = Math.max(minSz, snapped.y - s.y);
                            if (h.includes('n')) { nh = Math.max(minSz, s.y + s.h - snapped.y); ny = snapped.y; }
                            el.x = nx; el.y = ny; el.w = nw; el.h = nh;
                            // Scale existing vertices with the new box so both size AND
                            // shape are preserved for manual polygons (slab/column).
                            // AI boxes (no vertices) stay pure rectangles.
                            if (editingVertex.hasVertices && editingVertex.startVertices && editingVertex.startVertices.length >= 3) {
                                const ow = s.w || 1, oh = s.h || 1;
                                el.vertices = editingVertex.startVertices.map(v => ({
                                    x: (v.x / ow) * nw,
                                    y: (v.y / oh) * nh
                                }));
                            } else if (editingVertex.hasVertices && el.vertices && el.vertices.length === 4) {
                                el.vertices = [{ x: 0, y: 0 }, { x: nw, y: 0 }, { x: nw, y: nh }, { x: 0, y: nh }];
                            }
                        }
                        renderAll();
                    }
                }

                if (dragMode === 'select' && mouseDown && selectedIds.length > 0) {
                    const clickWorld = screenToWorld(startX, startY);
                    const dx = world.x - clickWorld.x,
                        dy = world.y - clickWorld.y;
                    let moved = false;
                    elements.forEach(function (el) {
                        if (isSelectedId(el.id) && !el.locked) {
                            const start = dragElementStart[el.id];
                            if (start) {
                                el.x = start.x + dx;
                                el.y = start.y + dy;
                                if (start.p1 && start.p2) {
                                    el.p1 = { x: start.p1.x + dx, y: start.p1.y + dy };
                                    el.p2 = { x: start.p2.x + dx, y: start.p2.y + dy };
                                    syncLineBounds(el);
                                }
                                moved = true;
                            }
                        }
                    });
                    if (moved) renderAll();
                }

                // Resize / vertex handle hover (slab, column, any polygon: both size + shape)
                if (selectedIds.length === 1 && (currentTool === 'select' || currentTool === 'move' || !currentTool)) {
                    const el = elements.find(ee => ee.id === selectedIds[0]);
                    if (el && !el.locked) {
                        if (el.type === 'slab' || el.type === 'column') ensureElementVertices(el);
                        const hs = 14 / viewport.scale;
                        let foundHandle = false;
                        if (!el.isLine && el.vertices && el.vertices.length >= 3) {
                            for (let i = 0; i < el.vertices.length; i++) {
                                const vx = el.x + el.vertices[i].x,
                                    vy = el.y + el.vertices[i].y;
                                if (Math.hypot(world.x - vx, world.y - vy) <= hs) {
                                    foundHandle = true;
                                    canvas.style.cursor = 'pointer';
                                    break;
                                }
                            }
                        }
                        if (el.isLine && el.p1 && el.p2) {
                            if (Math.hypot(world.x - el.p1.x, world.y - el.p1.y) <= hs ||
                                Math.hypot(world.x - el.p2.x, world.y - el.p2.y) <= hs) {
                                foundHandle = true;
                                canvas.style.cursor = 'pointer';
                            }
                        }
                        if (!foundHandle && !el.isLine) {
                            const handles = [
                                [el.x, el.y],
                                [el.x + el.w / 2, el.y],
                                [el.x + el.w, el.y],
                                [el.x, el.y + el.h / 2],
                                [el.x + el.w, el.y + el.h / 2],
                                [el.x, el.y + el.h],
                                [el.x + el.w / 2, el.y + el.h],
                                [el.x + el.w, el.y + el.h]
                            ];
                            for (const [hx, hy] of handles) {
                                if (Math.abs(world.x - hx) <= hs && Math.abs(world.y - hy) <= hs) {
                                    foundHandle = true;
                                    canvas.style.cursor = 'pointer';
                                    break;
                                }
                            }
                        }
                        if (!foundHandle) canvas.style.cursor = 'default';
                    }
                }
            });

            canvas.addEventListener('mouseup', (e) => {
                if (isConfirmed || currentView === '3d') return;

                if (dragMode === 'select' && mouseDown) {
                    const moved = elements.some(el => {
                        if (!selectedIds.includes(el.id) || el.locked) return false;
                        const start = dragElementStart[el.id];
                        return start && (start.x !== el.x || start.y !== el.y);
                    });
                    if (moved) {
                        elements.forEach(el => {
                            if (!selectedIds.includes(el.id) || el.locked) return;
                            const start = dragElementStart[el.id];
                            if (start && (start.x !== el.x || start.y !== el.y)) markElementEdited(el);
                        });
                        saveState();
                    }
                    renderAll();
                }
                // Free-rotate drag finished → research dashboard (edit + geometry snapshot + quantities)
                if (dragMode === 'reshape' && editingVertex && editingVertex.rotate) {
                    const el = elements.find(function (ee) { return ee.id === editingVertex.elId; });
                    if (el) {
                        try {
                            if (typeof markElementEdited === 'function') markElementEdited(el);
                            if (window.MCResearch && typeof MCResearch.notifyElementChange === 'function') {
                                MCResearch.notifyElementChange('edit', el, {
                                    mode: 'pro',
                                    notes: 'rotate:drag'
                                });
                            }
                            if (typeof scheduleResearchQuantitySync === 'function') scheduleResearchQuantitySync();
                        } catch (_) {}
                    }
                }
                if (dragMode === 'pan') {
                    isPanning = false;
                    canvas.style.cursor = currentTool ? 'crosshair' : 'default';
                }
                mouseDown = false;
                dragMode = null;
                resizeHandle = null;
                editingVertex = null;
            });

            canvas.addEventListener('dblclick', (e) => {
                if (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length >= 3) {
                    e.preventDefault();
                    completeDrawing();
                    return;
                }
                if (currentTool === 'deduction_wall' && deductionLinePoints.length >= 2) {
                    e.preventDefault();
                    completeDeductionLine();
                    return;
                }
                if ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length >= 2) {
                    e.preventDefault();
                    completeWallBeamLine();
                    return;
                }
            });

            canvas.addEventListener('contextmenu', (e) => {
                if (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length > 0) {
                    e.preventDefault();
                    polygonPoints.pop();
                    polygonTempLine = null;
                    document.getElementById('statusMode').textContent =
                        `${currentTool}: ${polygonPoints.length} vertices · right-click removes last`;
                    renderCanvas2D();
                }
                if ((currentTool === 'deduction_wall') &&
                    deductionLinePoints.length > 0) {
                    e.preventDefault();
                    deductionLinePoints = [];
                    deductionParentId = null;
                    document.getElementById('statusMode').textContent =
                        `Deduction Wall: click 1st point`;
                    renderCanvas2D();
                }
                if ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length > 0) {
                    e.preventDefault();
                    polygonPoints.pop();
                    continuousTempPreview = null;
                    document.getElementById('statusMode').textContent =
                        polygonPoints.length
                            ? `${currentTool}: ${polygonPoints.length} pts · right-click removes last`
                            : `${currentTool}: click points continuously`;
                    renderCanvas2D();
                }
            });

            window.addEventListener('mouseup', () => {
                if (dragMode === 'draw') {
                    dragMode = null;
                    drawStartWorld = null;
                    drawCurrentWorld = null;
                    drawPreview = null;
                    canvas.style.cursor = currentTool ? 'crosshair' : 'default';
                    renderCanvas2D();
                }
                if (dragMode === 'pan') {
                    isPanning = false;
                    canvas.style.cursor = currentTool ? 'crosshair' : 'default';
                    dragMode = null;
                }
                mouseDown = false;
                resizeHandle = null;
                if (dragMode === 'reshape') {
                    dragMode = null;
                    editingVertex = null;
                    renderAll();
                }
            });
        }

        // ---- Complete wall/beam continuous polyline (creates one segment per edge) ----
        /**
         * Ask for opening bottom + top levels above finished floor level (FFL).
         * Returns { sillHeightM, openHeightM, topLevelM } or null if cancelled / invalid.
         */
        function promptOpeningLevelsFromFFL(parent) {
            const parentH = (parent && parent.zHeight) ? parent.zHeight : 2.1;
            const parentLabel = (parent && parent.label) ? parent.label : 'wall';
            const parentType = (parent && parent.type) ? parent.type : 'wall';

            const bottomInput = prompt(
                `Deduction on ${parentLabel}\n\n` +
                `BOTTOM level of the opening above finished floor level (FFL) in metres.\n\n` +
                `Examples:\n` +
                `  0   = opening starts from the floor (typical door)\n` +
                `  0.9 = typical window sill\n` +
                `  1.2 = higher sill\n\n` +
                `Enter bottom level from FFL (m):`,
                '0'
            );
            if (bottomInput === null) return null;
            let sillHeightM = parseFloat(bottomInput);
            if (isNaN(sillHeightM) || sillHeightM < 0) {
                alert('Please enter a valid bottom level ≥ 0 m from FFL.');
                return null;
            }

            const topDefault = String(parentH);
            const topInput = prompt(
                `Deduction on ${parentLabel}\n\n` +
                `TOP level of the opening above finished floor level (FFL) in metres.\n\n` +
                `Opening height will be: Top − Bottom.\n` +
                `Bottom (already entered): ${sillHeightM} m\n` +
                `Typical full wall: ${parentH} m\n\n` +
                `Enter top level from FFL (m):`,
                topDefault
            );
            if (topInput === null) return null;
            let topLevelM = parseFloat(topInput);
            if (isNaN(topLevelM) || topLevelM <= sillHeightM) {
                alert('Top level must be greater than bottom level (' + sillHeightM + ' m).');
                return null;
            }
            if (topLevelM > parentH + 1e-6) {
                if (!confirm(
                    `Top level (${topLevelM} m) is above ${parentLabel} height (${parentH} m).\n` +
                    `Use parent top ${parentH} m instead?`
                )) return null;
                topLevelM = parentH;
            }
            let openHeightM = topLevelM - sillHeightM;
            if (openHeightM <= 0) {
                alert('Opening height must be positive (top − bottom).');
                return null;
            }
            if (openHeightM > parentH + 1e-6) {
                if (!confirm(
                    `Opening height (${openHeightM.toFixed(3)} m) is taller than ${parentLabel} (${parentH} m).\n` +
                    `Use parent height ${parentH} m instead?`
                )) return null;
                openHeightM = parentH;
                sillHeightM = Math.max(0, topLevelM - openHeightM);
            }
            return { sillHeightM: sillHeightM, openHeightM: openHeightM, topLevelM: topLevelM, parentType: parentType };
        }

        /** After drawing window/door/beam — ask elevation with simple choices (no jargon). */
        function promptElevationAfterCreate(elIds) {
            const ids = Array.isArray(elIds) ? elIds : [elIds];
            const list = ids.map(function (id) { return elements.find(function (e) { return e.id === id; }); }).filter(Boolean);
            if (!list.length) return;
            const t = list[0].type;
            if (t === 'window' || t === 'door') {
                const isWin = t === 'window';
                const def = isWin ? '0.9' : '0';
                const choice = window.prompt(
                    (isWin ? 'Window' : 'Door') + ' — start height above finished floor level (FFL) in metres.\n\n' +
                    'This is the sill / bottom of the opening (not the opening height).\n\n' +
                    'Examples:\n' +
                    '  0   = starts from finished floor\n' +
                    '  0.9 = typical window sill\n' +
                    '  1.0 or 1.2 = higher sill\n\n' +
                    'Enter a number (metres):',
                    def
                );
                if (choice === null) return;
                const v = parseFloat(choice);
                if (!isNaN(v) && v >= 0) {
                    list.forEach(function (el) { el.sillHeight = v; });
                    try { renderAll(); } catch (_) {}
                    try { if (typeof toast === 'function') toast((isWin ? 'Window' : 'Door') + ' elevation set to ' + v + ' m above floor.', 'success'); } catch (_) {}
                }
            } else if (t === 'beam') {
                const choice = window.prompt(
                    'Beam underside height above finished floor (m).\n\n' +
                    'Leave empty for automatic (from typical wall height).\n' +
                    'Examples: 2.1 · 2.4 · 2.7 · 3.0\n\n' +
                    'Enter a number or leave blank:',
                    ''
                );
                if (choice === null) return;
                if (String(choice).trim() === '') {
                    list.forEach(function (el) { el.soffitHeight = null; });
                } else {
                    const v = parseFloat(choice);
                    if (!isNaN(v) && v >= 0) {
                        list.forEach(function (el) { el.soffitHeight = v; });
                        try { if (typeof toast === 'function') toast('Beam elevation set to ' + v + ' m above floor.', 'success'); } catch (_) {}
                    }
                }
                try { renderAll(); } catch (_) {}
            }
        }

        /**
         * After finishing one element with Enter/Done, keep the same drawing tool
         * active so the user can immediately start the next element of that type.
         * Exit only via Esc, Cancel, Select tool, or picking a different tool.
         */
        function stayInDrawingTool(tool, readyMessage) {
            if (!tool) return;
            currentTool = tool;
            document.querySelectorAll('.tool-btn').forEach(b => {
                const t = b.getAttribute('data-tool');
                b.classList.toggle('tool-active', t === tool);
            });
            const canvas = document.getElementById('canvas2d');
            if (canvas) canvas.style.cursor = 'crosshair';
            const mode = document.getElementById('statusMode');
            if (mode) {
                mode.textContent = readyMessage ||
                    (tool.charAt(0).toUpperCase() + tool.slice(1) + ': click to start next · Esc to exit tool');
            }
        }

        function completeWallBeamLine() {

            if (polygonPoints.length < 2) {
                alert('Need at least 2 points for a wall/beam.');
                return;
            }
            const thickness = currentTool === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
            const type = currentTool;
            // Auto-Glue: pull endpoints to nearby walls/columns within tolerance (user can disable)
            const gluedPts = applyAutoGluePolyline(polygonPoints);
            saveState();
            const newIds = [];
            for (let i = 0; i < gluedPts.length - 1; i++) {
                const p1 = gluedPts[i], p2 = gluedPts[i + 1];
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (len < 0.5) continue;
                const el = createLineElement(type, p1, p2, thickness);
                if (el) {
                    elements.push(el);
                    newIds.push(el.id);
                }
            }
            polygonPoints = [];
            continuousTempPreview = null;
            if (newIds.length === 0) {
                alert('Segments too short.');
                return;
            }
            selectedIds = newIds;
            stayInDrawingTool(type,
                type.charAt(0).toUpperCase() + type.slice(1) +
                ' saved · click to start next ' + type + ' · Enter finishes each · Esc exits tool');
            renderAll();
            if (type === 'beam') {
                setTimeout(function () { promptElevationAfterCreate(newIds); }, 50);
            }
        }

        // ---- Complete deduction continuous polyline (cutouts on parent wall) ----
        function completeDeductionLine() {
            if (deductionLinePoints.length < 2) {
                alert('Need at least 2 points for a deduction.');
                return;
            }
            // Resolve parent wall by stable ID — prefer the wall snapped on the FIRST click of this
            // segment so continuous deductions can target different walls without pre-selecting.
            // Order: deductionParentId (this segment) → locked Properties target → geometric snap.
            let parent = null;
            if (deductionParentId != null) {
                parent = findElementById(deductionParentId);
                if (parent && parent.type !== 'wall') parent = null;
            }
            if (!parent && deductionTargetLocked && pendingDeductionParentId != null) {
                parent = findElementById(pendingDeductionParentId);
                if (parent && parent.type !== 'wall') parent = null;
            }
            if (!parent && pendingDeductionParentId != null) {
                parent = findElementById(pendingDeductionParentId);
                if (parent && parent.type !== 'wall') parent = null;
            }
            if (!parent) {
                const midX = (deductionLinePoints[0].x + deductionLinePoints[1].x) / 2;
                const midY = (deductionLinePoints[0].y + deductionLinePoints[1].y) / 2;
                for (let i = elements.length - 1; i >= 0; i--) {
                    const el = elements[i];
                    if (el.hidden || el.type !== 'wall') continue;
                    if (el.isLine && el.p1 && el.p2) {
                        const ax = el.p1.x, ay = el.p1.y, bx = el.p2.x, by = el.p2.y;
                        const abx = bx - ax, aby = by - ay;
                        const len2 = abx * abx + aby * aby || 1;
                        let t = ((midX - ax) * abx + (midY - ay) * aby) / len2;
                        t = Math.max(0, Math.min(1, t));
                        const px = ax + t * abx, py = ay + t * aby;
                        const thk = getLineThicknessDraw(el) / 2 + 10 / viewport.scale;
                        if (Math.hypot(midX - px, midY - py) <= thk) { parent = el; break; }
                    } else if (midX >= el.x && midX <= el.x + el.w && midY >= el.y && midY <= el.y + el.h) {
                        parent = el; break;
                    }
                }
            }
            if (!parent) {
                alert('No wall found under the deduction line. Hover a wall and click to snap.');
                return;
            }
            const openLevels = promptOpeningLevelsFromFFL(parent);
            if (!openLevels) return;
            const openHeightM = openLevels.openHeightM;
            const sillHeightM = openLevels.sillHeightM;
            saveState();
            // Use the same visual thickness as the wall (clamped) so the deduction polygon is never too thin to create
            const thk = (typeof parent.thickness === 'number' && parent.thickness > 0) ? parent.thickness : DEFAULT_WALL_THICKNESS_M;
            let thkDraw = getLineThicknessDraw(parent);
            if (!(thkDraw > 0) || !isFinite(thkDraw)) thkDraw = Math.max(1.5, toDrawing(thk) || 1.5);
            const newIds = [];
            for (let i = 0; i < deductionLinePoints.length - 1; i++) {
                const p1 = deductionLinePoints[i], p2 = deductionLinePoints[i + 1];
                const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                // Allow short openings (doors/windows can be ~0.8–1 m; in drawing units that may be < 0.5 after scale)
                if (len < 0.05) continue;
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                const halfLen = Math.max(len / 2, 0.025);
                const halfThk = Math.max(thkDraw / 2, 0.025);
                const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
                const localPts = [
                    { x: -halfLen, y: -halfThk },
                    { x: halfLen, y: -halfThk },
                    { x: halfLen, y: halfThk },
                    { x: -halfLen, y: halfThk },
                ];
                const cosA = Math.cos(angle), sinA = Math.sin(angle);
                const worldPts = localPts.map(p => ({
                    x: cx + p.x * cosA - p.y * sinA,
                    y: cy + p.x * sinA + p.y * cosA
                }));
                const el = createPolygonElement('cutout', worldPts, {
                    parentId: parent.id,
                    isDeduction: true,
                    color: '#FFD700',
                    zHeight: openHeightM,
                    sillHeight: sillHeightM,
                    openingType: 'opening',
                    label: `Opening → ${parent.label}`,
                });
                if (el) {
                    el.isDeduction = true;
                    el.sillHeight = sillHeightM;
                    el.thickness = thk; // parent wall thickness (m) — never a fixed global
                    el.parentThickness = thk;
                    el.zHeight = openHeightM;
                    el.openingType = el.openingType || 'opening';
                    if (!parent.cutouts) parent.cutouts = [];
                    parent.cutouts.push(el.id);
                    elements.push(el);
                    newIds.push(el.id);
                }
            }
            deductionLinePoints = [];
            continuousTempPreview = null;
            if (newIds.length === 0) {
                alert('Could not create deduction segments. Draw the deduction line along a wall (at least two points), then press Enter / Done.');
                return;
            }
            selectedIds = [parent.id];
            // Release segment parent so the NEXT deduction can target a different wall
            // by hovering/clicking it. Do not permanently lock to this wall.
            deductionParentId = null;
            pendingDeductionParentId = null;
            deductionTargetLocked = false;
            hoveredParentId = null;
            stayInDrawingTool('deduction_wall',
                `Deduction saved on ${parent.label} · hover another wall and click to deduct · Esc exits tool`);
            renderAll();
        }

        // ---- Complete polygon (slab/floor/cutout) ----
        function completeDrawing() {
            if (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length >= 3) {
                // Auto-Glue vertices to nearby wall edges / columns within tolerance
                const pts = applyAutoGluePolyline(polygonPoints.map(p => ({ x: p.x, y: p.y })));
                const type = currentTool === 'cutout' ? 'cutout' : currentTool;
                const el = createPolygonElement(type, pts);
                if (el) {
                    if (type === 'cutout') {
                        // Resolve host: wall, beam, slab, or column under the polygon
                        // (or locked/selected structural element).
                        const parent = findCutoutParent(pts, polygonBounds(pts));
                        if (parent) {
                            // Walls/beams: opening height (m). Slabs/columns: use host thickness/height.
                            const defaultH = (parent.type === 'slab')
                                ? (parent.zHeight || DEFAULT_SLAB_THICKNESS_M)
                                : (parent.type === 'column')
                                    ? (parent.zHeight || 3.0)
                                    : (parent.zHeight || 2.1);
                            const heightHint = (parent.type === 'slab')
                                ? `Slab cut-out thickness defaults to the slab thickness.\nEnter thickness to deduct (m):`
                                : `Confirm OPENING HEIGHT in meters.\n\n` +
                                  `Tip: the opening starts from the finished floor level (FFL)\n` +
                                  `(sill at 0 m = from floor). This height is deducted from the ${parent.type}.\n\n` +
                                  `Enter opening height (m):`;
                            const heightInput = prompt(
                                `Deduction on ${parent.label} (${parent.type})\n\n` + heightHint,
                                String(defaultH)
                            );
                            if (heightInput === null) {
                                polygonPoints = [];
                                renderCanvas2D();
                                return;
                            }
                            let openHeightM = parseFloat(heightInput);
                            if (isNaN(openHeightM) || openHeightM <= 0) {
                                alert('Please enter a positive height in meters.');
                                polygonPoints = [];
                                renderCanvas2D();
                                return;
                            }
                            if (openHeightM > defaultH + 1e-6) {
                                if (!confirm(`Opening height (${openHeightM} m) exceeds parent (${defaultH} m).\nUse ${defaultH} m?`)) {
                                    polygonPoints = [];
                                    renderCanvas2D();
                                    return;
                                }
                                openHeightM = defaultH;
                            }
                            el.parentId = parent.id;
                            el.isDeduction = true;
                            el.zHeight = openHeightM;
                            el.sillHeight = 0;
                            el.color = '#ff3b30';
                            el.openingType = 'opening';
                            if (!parent.cutouts) parent.cutouts = [];
                            parent.cutouts.push(el.id);
                            el.label = `Opening → ${parent.label}`;
                            addElement(el);
                            // Release lock so the next polygon can attach to a different wall
                            // by drawing on it (continuous multi-wall deductions).
                            pendingDeductionParentId = null;
                            deductionTargetLocked = false;
                            polygonPoints = [];
                            polygonTempLine = null;
                            isPolygonClosed = false;
                            polygonElementType = null;
                            selectedIds = [parent.id];
                            stayInDrawingTool('cutout',
                                `Deduction saved on ${parent.label} · draw next opening · Esc exits tool`);
                            renderAll();
                            return;
                        } else {
                            alert('No parent found under cutout.\n\nDraw the opening on top of a wall, beam, slab, or column.\nOr select a structural element first, then use Cutout / Deduction.');
                            polygonPoints = [];
                            renderCanvas2D();
                            return;
                        }
                    }
                    addElement(el);
                    const keepTool = currentTool; // slab | column | cutout
                    polygonPoints = [];
                    polygonTempLine = null;
                    isPolygonClosed = false;
                    polygonElementType = null;
                    selectedIds = [el.id];
                    stayInDrawingTool(keepTool,
                        (keepTool.charAt(0).toUpperCase() + keepTool.slice(1)) +
                        ' saved · click to start next · Enter finishes each · Esc exits tool');
                    renderAll();
                    if (el && (el.type === 'window' || el.type === 'door' || el.type === 'beam')) {
                        setTimeout(function () { promptElevationAfterCreate([el.id]); }, 50);
                    }
                } else {
                    alert('Could not create element from polygon.');
                }
            } else {
                alert('Need at least 3 points for a polygon.');
            }
        }

        // ---- Cancel drawing ----
        function cancelDrawing() {
            polygonPoints = [];
            polygonTempLine = null;
            isPolygonClosed = false;
            polygonElementType = null;
            deductionLinePoints = [];
            deductionParentId = null;
            pendingDeductionParentId = null;
            deductionTargetLocked = false;
            continuousTempPreview = null;
            editingVertex = null;
            drawStartWorld = null;
            drawCurrentWorld = null;
            drawPreview = null;
            dragMode = null;
            measurePoints = [];
            measurePreview = null;
            calibratePoints = [];
            calibratePreview = null;
            hoveredParentId = null;
            hoveredSnapId = null;
            snapCursorPoint = null;
            hoverLabelWorld = null;
            overlapHitIds = [];
            overlapCycleIndex = 0;
            lastOverlapKey = '';
            const measureLabel = document.getElementById('measureLabel');
            if (measureLabel) measureLabel.style.display = 'none';
            if (currentTool === 'measure') {
                document.getElementById('statusMode').textContent = 'Measure: click 1st point';
            } else {
                document.getElementById('statusMode').textContent = currentTool ?
                    (currentTool.charAt(0).toUpperCase() + currentTool.slice(1)) :
                    'Select';
            }
            document.getElementById('canvas2d').style.cursor =
                (currentTool === 'pan') ? 'grab' :
                (currentTool && currentTool !== 'select' && currentTool !== 'move') ? 'crosshair' : 'default';
            renderCanvas2D();
        }

        // ----- CONTEXT MENU (unchanged) -----
        function setupContextMenu() {
            const menu = document.getElementById('contextMenu');
            const canvas = document.getElementById('canvas2d');
            canvas.addEventListener('contextmenu', (e) => {
                if (isConfirmed || currentView === '3d') return;
                if (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length > 0) return;
                if ((currentTool === 'deduction_wall') && deductionLinePoints.length >
                    0) return;
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left,
                    sy = e.clientY - rect.top;
                const world = screenToWorld(sx, sy);
                let found = null;
                for (let i = elements.length - 1; i >= 0; i--) {
                    const el = elements[i];
                    if (el.hidden) continue;
                    if (world.x >= el.x && world.x <= el.x + el.w && world.y >= el.y && world.y <= el.y + el.h) {
                        found = el;
                        break;
                    }
                }
                if (found) {
                    if (!selectedIds.includes(found.id)) { selectedIds = [found.id];
                        renderAll(); }
                    contextTargetId = found.id;
                    menu.classList.add('open');
                    menu.style.left = (e.clientX - 10) + 'px';
                    menu.style.top = (e.clientY - 10) + 'px';
                } else menu.classList.remove('open');
            });
            document.addEventListener('click', () => menu.classList.remove('open'));
            menu.querySelectorAll('.item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = item.dataset.action;
                    switch (action) {
                        case 'duplicate':
                            duplicateSelected();
                            break;
                        case 'delete':
                            deleteSelected();
                            break;
                        case 'rotateCW':
                            rotateSelected(90);
                            break;
                        case 'rotateCCW':
                            rotateSelected(-90);
                            break;
                        case 'rotate180':
                            rotateSelected(180);
                            break;
                        case 'rotateCustom':
                            promptRotateSelected();
                            break;
                        case 'lock':
                            toggleLockSelected();
                            break;
                        case 'hide':
                            toggleHideSelected();
                            break;
                        case 'bringFront':
                            bringToFront();
                            break;
                        case 'sendBack':
                            sendToBack();
                            break;
                        case 'assignMat':
                            showAssignMaterial();
                            break;
                    }
                    menu.classList.remove('open');
                });
            });
        }

        function showAssignMaterial() {
            if (selectedIds.length === 0) return;
            const el = findElementById(selectedIds[0]);
            if (!el) return;
            const matNames = Object.keys(materialLibrary);
            const opts = matNames.map(m => `<option value="${m}">${m}</option>`).join('');
            const html = `
            <div class="modal" style="max-width:400px;">
              <h2>Assign Material</h2>
              <div class="field-group"><label>Material</label><select id="assign-mat-select">${opts}</select></div>
              <div class="actions">
                <button id="assign-cancel">Cancel</button>
                <button class="primary" id="assign-save">Assign</button>
              </div>
            </div>
          `;
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay open';
            overlay.id = 'assignOverlay';
            overlay.innerHTML = html;
            document.body.appendChild(overlay);
            document.getElementById('assign-cancel').addEventListener('click', () => overlay.remove());
            document.getElementById('assign-save').addEventListener('click', () => {
                const sel = document.getElementById('assign-mat-select');
                if (sel) {
                    el.material = sel.value || null;
                    try { if (typeof markElementEdited === 'function') markElementEdited(el); } catch (_) {}
                    saveState();
                    renderAll();
                    try { renderQuantityTable(); } catch (_) {}
                }
                overlay.remove();
            });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        }

        // ----- LAYER TABS -----
        function renderLayers() {
            const container = document.getElementById('layer-tabs');
            let html = '';
            layers.forEach(layer => {
                const active = layer === currentLayer ? 'active' : '';
                const count = elements.filter(el => el.layer === layer || (layer === 'All' && true)).length;
                html +=
                    `<button class="${active}" data-layer="${layer}">${layer} <span style="font-size:9px;color:var(--text-secondary);">(${count})</span></button>`;
            });
            html +=
                `<button style="margin-left:auto;font-size:11px;color:var(--accent);" id="addLayerBtn"><i class="fas fa-plus"></i></button>`;
            container.innerHTML = html;
            container.querySelectorAll('[data-layer]').forEach(btn => {
                btn.addEventListener('click', () => {
                    currentLayer = btn.dataset.layer;
                    renderLayers();
                    renderAll();
                });
            });
            document.getElementById('addLayerBtn').addEventListener('click', () => {
                const name = prompt('Enter new layer name:');
                if (name && name.trim() && !layers.includes(name.trim())) {
                    layers.push(name.trim());
                    currentLayer = name.trim();
                    renderLayers();
                    renderAll();
                }
            });
        }

        // ----- TOOLBAR SETUP -----

        // ----- EXPORT: BOQ Excel + Marked Drawing PDF -----
        /** Readable plain-text report for Excel sheet + .txt download */
        function buildPlainTextReport() {
            const est = computeMaterialEstimate();
            const rows = (typeof computeQuantities === 'function') ? computeQuantities() : [];
            const projName = (projectInfo && projectInfo.name) ? projectInfo.name : 'Untitled Project';
            const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            const scaleNote = Math.abs(calibrationFactor - 1) < 1e-9
                ? '1 unit = 1 m'
                : ('1 unit = ' + calibrationFactor.toFixed(6) + ' m');
            const L = [];
            const line = (s) => L.push(s == null ? '' : String(s));
            const rule = (ch, n) => line((ch || '─').repeat(n || 56));

            line('MEASURECRAFT — TAKEOFF REPORT');
            rule('=');
            line('Project:   ' + projName);
            line('Client:    ' + ((projectInfo && projectInfo.client) || '—'));
            line('Location:  ' + ((projectInfo && projectInfo.location) || '—'));
            line('Ref:       ' + ((projectInfo && projectInfo.ref) || '—'));
            line('Prepared:  ' + ((projectInfo && projectInfo.qs) || '—'));
            line('Date:      ' + dateStr);
            line('Scale:     ' + scaleNote);
            line('Elements:  ' + elements.filter(e => !e.hidden).length);
            rule();

            line('ELEMENT QUANTITIES');
            rule('-');
            line(pad('Element', 28) + pad('Qty', 12) + 'Unit');
            rule('-');
            est.elementQty.forEach(eq => {
                if (!eq.qty) return;
                line(pad(eq.element, 28) + pad(String(eq.qty), 12) + (eq.unit || ''));
            });
            rule();

            line('MATERIAL ESTIMATE (auto from elements)');
            rule('-');
            line(pad('Material', 22) + pad('Qty', 12) + pad('Unit', 14) + pad('Price', 10) + 'Total');
            rule('-');
            est.materials.forEach(m => {
                if (!m.qty) return;
                const price = m.price != null ? String(m.price) : '—';
                const total = m.total != null ? String(Math.round(m.total * 100) / 100) : '—';
                line(pad(m.material, 22) + pad(String(m.qty), 12) + pad(m.unit || '', 14) + pad(price, 10) + total);
            });
            rule('-');
            const hasPx = est.materials.some(m => m.price != null && m.qty > 0);
            if (hasPx) {
                line(pad('Materials subtotal', 48) + formatMoney(est.materialsTotal));
                line(pad('Contingency (15%)', 48) + formatMoney(est.contingency));
                line(pad('TOTAL ESTIMATE', 48) + formatMoney(est.grandTotal));
            } else {
                line('Price / Total: pending online price database (or set in Material Library)');
            }
            rule();

            line('BOQ LINES (per element)');
            rule('-');
            rows.forEach((r, i) => {
                line((i + 1) + '. ' + (r.material || '') + ' — ' + (r.element || r.elementLabel || ''));
                line('   Qty: ' + r.qty + ' ' + (r.unit || '') +
                    (r.net != null ? ('  |  Net: ' + r.net) : '') +
                    (r.gross != null ? ('  |  Gross: ' + r.gross) : ''));
                if (r.remarks) line('   ' + r.remarks);
            });
            if (!rows.length) line('(No BOQ lines yet)');
            rule();
            line('Notes');
            line('- Cement & sand: concrete (slabs/columns/beams) + wall plaster');
            line('- Aggregate: concrete mix 1:2:4 only');
            line('- Bricks: face rate from wall net area (openings deducted)');
            line('- Tiles & adhesive: from slab floor areas');
            line('- Paint: from wall face area');
            line('- Prices empty until online DB connected');
            rule('=');
            line('Generated by MeasureCraft');
            return L.join('\n');

            function pad(s, n) {
                s = String(s == null ? '' : s);
                if (s.length >= n) return s.slice(0, n - 1) + ' ';
                return s + ' '.repeat(n - s.length);
            }
        }

        function downloadPlainTextReport() {
            const body = buildPlainTextReport();
            const dateStr = new Date().toISOString().slice(0, 10);
            const safe = ((projectInfo && projectInfo.name) || 'takeoff').replace(/[^\w\-]+/g, '_').slice(0, 40);
            const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Takeoff_Report_' + safe + '_' + dateStr + '.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showExportToast('Plain text report downloaded');
        }

        function exportBoqExcel() {
            if (typeof XLSX === 'undefined') {
                showToast('Excel library failed to load. Check your internet connection and try again.', 'error');
                return;
            }
            const est = computeMaterialEstimate();
            const projName = (projectInfo && projectInfo.name) ? projectInfo.name : 'Untitled Project';
            const currency = (projectInfo && projectInfo.currency) || 'LKR';
            const dateStr = new Date().toISOString().slice(0, 10);
            const scaleNote = Math.abs(calibrationFactor - 1) < 1e-9 ? '1 unit = 1 m' : ('1 unit = ' + calibrationFactor.toFixed(6) + ' m');
            // Use the same material-level estimate as Simple Mode. Do not export
            // aggregate element rows such as Concrete as material quantities.
            const materials = (est.materials || []).map(m => ({
                material: m.material,
                qty: Number(m.qty) || 0,
                unit: m.unit || '',
                price: m.price,
                source: m.source || ''
            }));
            const elementQty = (est.elementQty || []).slice();
            const openingCounts = elements.filter(e => !e.hidden && (e.type === 'door' || e.type === 'window'));
            const doorCount = openingCounts.filter(e => e.type === 'door').length;
            const windowCount = openingCounts.filter(e => e.type === 'window').length;
            if (!elementQty.some(e => e.element === 'Doors')) elementQty.push({ element: 'Doors', qty: doorCount, unit: 'Nr' });
            if (!elementQty.some(e => e.element === 'Windows')) elementQty.push({ element: 'Windows', qty: windowCount, unit: 'Nr' });
            const overrides = projectOverrides || {};
            const data = Array.from({ length: 53 }, () => Array(7).fill(''));
            const put = (r, vals) => vals.forEach((v, c) => { data[r - 1][c] = v; });
            put(1, ['MEASURECRAFT — MATERIAL ESTIMATE / BOQ']);
            put(2, ['Generated by MeasureCraft — quantities calculated from elemental takeoff']);
            put(3, [projName]);
            put(4, ['Project No:', (projectInfo && projectInfo.ref) || '—']);
            put(5, ['Client:', (projectInfo && projectInfo.client) || '—']);
            put(6, ['Location:', (projectInfo && projectInfo.location) || '—']);
            put(7, ['Status:', (projectInfo && projectInfo.status) || 'Draft']);
            put(8, ['Building type:', (projectInfo && projectInfo.buildingType) || '—']);
            put(9, ['Floors:', (projectInfo && projectInfo.floors) || '—']);
            put(10, ['Currency:', currency]);
            put(11, ['Prepared by:', (projectInfo && projectInfo.qs) || '—']);
            put(12, ['Date:', dateStr]);
            put(13, ['Scale:', scaleNote]);
            put(15, ['MATERIAL QUANTITIES']);
            put(17, ['Item No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount', 'Remark']);
            materials.slice(0, 9).forEach((m, i) => {
                const r = 19 + i;
                // Rate column must use the same material price as Text export / on-screen BOQ
                // (materialLibrary via computeMaterialEstimate → m.price). Never leave blank when rate exists.
                const rateVal = (m.price != null && m.price !== '' && !isNaN(Number(m.price)))
                    ? Number(m.price)
                    : '';
                put(r, [i + 1, m.material, m.unit, Number(m.qty.toFixed(3)), rateVal, { f: `IFERROR(D${r}*E${r},0)` }, m.source || '']);
            });
            put(29, ['Materials subtotal', '', '', '', '', { f: 'SUM(F19:F27)' }]);
            put(30, ['Contingency ' + Math.round((est.contingencyPct || 0.15) * 100) + '%', '', '', '', '', { f: 'F29*' + Number(est.contingencyPct || 0.15).toFixed(4) }]);
            put(31, ['TOTAL ESTIMATE', '', '', '', '', { f: 'F29+F30' }]);
            put(33, ['ELEMENT QUANTITIES']);
            put(35, ['Item No.', 'Description', 'Unit', 'Qty']);
            elementQty.slice(0, 8).forEach((e, i) => put(37 + i, [i + 1, e.element || '', e.unit || '', e.qty]));
            put(47, ['Notes']);
            put(49, ['•  Cement & sand include concrete + plaster + brick/block mortar 1:5 (SL QS §08/§09)']);
            put(50, ['•  Aggregate from concrete only · 1 Cube = 100 ft³ = 2.83168 m³ (Sand & Aggregate)']);
            put(51, ['•  Bricks: 59.20/m² (100mm) or 117.33/m² (225mm) · Blocks: 12.06/m² (SL Material List)']);
            put(52, ['•  Tiles & adhesive from slab floor areas; paint from wall face area']);
            put(53, ['•  Edit rates in the workbook — Amount and total formulas recalculate automatically']);
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(data);
            const decode = cell => { const m = cell.match(/([A-Z]+)(\d+)/); if (!m) throw new Error('Invalid worksheet merge reference: ' + cell); return { r: Number(m[2]) - 1, c: m[1].charCodeAt(0) - 65 }; };
            ws['!merges'] = ['A1:G1','A2:G2','A3:G3','A15:G15','A33:D33','A47:G47','A49:G49','A50:G50','A51:G51','A52:G52','A53:G53','A29:E29','A30:E30','A31:E31','A17:A18','B17:B18','C17:C18','D17:D18','E17:E18','F17:F18','G17:G18','A35:A36','B35:B36','C35:C36','D35:D36'].map(ref => { const [a,b] = ref.split(':'); return { s: decode(a), e: decode(b) }; });
            ws['!cols'] = [{ wch: 15 }, { wch: 26 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 17 }, { wch: 46 }];
            ws['!rows'] = Array.from({ length: 53 }, (_, i) => ({ hpx: i === 0 ? 40 : (i === 1 ? 24 : (i === 14 || i === 32 ? 26 : 21)) }));
            ws['!freeze'] = { xSplit: 0, ySplit: 17 };
            ws['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
            ws['!sheetPr'] = { pageSetUpPr: { fitToPage: true } };
            const navy = '1F4E78', light = 'F2F2F2', white = 'FFFFFF', ink = '1F1F1F', blue = '0000FF';
            const border = { top: { style: 'thin', color: { rgb: '808080' } }, bottom: { style: 'thin', color: { rgb: '808080' } }, left: { style: 'thin', color: { rgb: '808080' } }, right: { style: 'thin', color: { rgb: '808080' } } };
            const style = (addr, s) => { if (ws[addr]) ws[addr].s = s; };
            const fill = (rgb, font, alignment, b = border) => ({ fill: { fgColor: { rgb } }, font, alignment, border: b });
            const title = fill(navy, { name: 'Calibri', sz: 18, bold: true, color: { rgb: white } }, { horizontal: 'left', vertical: 'center' }, undefined);
            const subtitle = fill(navy, { name: 'Calibri', sz: 10, italic: true, color: { rgb: white } }, { horizontal: 'left', vertical: 'center' }, undefined);
            const section = fill(navy, { name: 'Calibri', sz: 12, bold: true, color: { rgb: white } }, { horizontal: 'left', vertical: 'center' });
            const header = fill(navy, { name: 'Calibri', sz: 11, bold: true, color: { rgb: white } }, { horizontal: 'center', vertical: 'center', wrapText: true });
            for (const c of ['A','B','C','D','E','F','G']) { style(c+'1', title); style(c+'2', subtitle); style(c+'15', section); style(c+'33', section); style(c+'47', section); style(c+'17', header); style(c+'18', header); }
            style('A3', { font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: ink } }, alignment: { horizontal: 'left', vertical: 'center' } });
            for (let r = 4; r <= 13; r++) { style('A'+r, { fill: { fgColor: { rgb: light } }, font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: navy } } }); style('B'+r, { fill: { fgColor: { rgb: light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } } }); }
            for (let r = 19; r <= 27; r++) for (let c = 0; c < 7; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r % 2 ? white : light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } }, alignment: { horizontal: c === 1 || c === 6 ? 'left' : (c === 0 || c === 2 ? 'center' : 'right'), vertical: 'center', wrapText: c === 6 }, border }; }
            for (let r = 19; r <= 27; r++) { if (ws['D'+r]) ws['D'+r].s.numFmt = '#,##0.00'; if (ws['E'+r]) ws['E'+r].s = { ...ws['E'+r].s, numFmt: `"${currency} "#,##0.00`, font: { name: 'Calibri', sz: 11, color: { rgb: blue } } }; if (ws['F'+r]) ws['F'+r].s.numFmt = `"${currency} "#,##0.00`; }
            for (let r = 29; r <= 31; r++) for (let c = 0; c < 7; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r === 31 ? 'D9EAF7' : light } }, font: { name: 'Calibri', sz: 11, bold: r === 31, color: { rgb: ink } }, alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' }, border }; }
            for (let c = 0; c < 4; c++) { style(XLSX.utils.encode_cell({ r: 34, c }), header); style(XLSX.utils.encode_cell({ r: 35, c }), header); }
            for (let r = 37; r <= 44; r++) for (let c = 0; c < 4; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell) cell.s = { fill: { fgColor: { rgb: r % 2 ? white : light } }, font: { name: 'Calibri', sz: 11, color: { rgb: ink } }, alignment: { horizontal: c === 1 ? 'left' : (c === 0 || c === 2 ? 'center' : 'right'), vertical: 'center' }, border }; }
            for (let r = 49; r <= 53; r++) style('A'+r, { font: { name: 'Calibri', sz: 10, color: { rgb: ink } }, alignment: { horizontal: 'left', vertical: 'center' } });
            wb.CalcProps = { calcMode: 'auto', fullCalcOnLoad: true, forceFullCalc: true };
            XLSX.utils.book_append_sheet(wb, ws, 'BOQ Summary');
            const safe = projName.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'Project';
            XLSX.writeFile(wb, 'BOQ_' + safe + '_' + dateStr + '.xlsx', { cellStyles: true, bookSST: true });
            console.log('📥 Styled BOQ Excel exported:', 'BOQ_' + safe + '_' + dateStr + '.xlsx');
            // Research: element-level AI vs final is already logged continuously via
            // syncResearchQuantities() on render. Do not add aggregate elementQty rows
            // here — they never carry aiQty and inflate measurement counts uselessly.
        }

        function getExportWorldBounds() {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const expand = (x, y) => {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            };
            if (backgroundImage && backgroundImage.img) {
                expand(0, 0);
                expand(backgroundImage.w || backgroundImage.img.naturalWidth || 1000,
                       backgroundImage.h || backgroundImage.img.naturalHeight || 1000);
            }
            elements.forEach(el => {
                if (el.hidden) return;
                if (el.isLine && el.p1 && el.p2) {
                    expand(el.p1.x, el.p1.y);
                    expand(el.p2.x, el.p2.y);
                } else if (el.vertices && el.vertices.length) {
                    // vertices are stored relative to el.x / el.y
                    el.vertices.forEach(v => expand(el.x + v.x, el.y + v.y));
                    expand(el.x || 0, el.y || 0);
                    expand((el.x || 0) + (el.w || 0), (el.y || 0) + (el.h || 0));
                } else {
                    expand(el.x || 0, el.y || 0);
                    expand((el.x || 0) + (el.w || 0), (el.y || 0) + (el.h || 0));
                }
            });
            if (!isFinite(minX)) {
                minX = 0; minY = 0; maxX = 1000; maxY = 800;
            }
            const pad = Math.max(20, (maxX - minX) * 0.03, (maxY - minY) * 0.03);
            return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
        }

        function drawMarkedExport(ctx, bounds, scale) {
            // White background
            const W = (bounds.maxX - bounds.minX) * scale;
            const H = (bounds.maxY - bounds.minY) * scale;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, W, H);

            ctx.save();
            ctx.scale(scale, scale);
            ctx.translate(-bounds.minX, -bounds.minY);

            // Drawing underlay
            if (backgroundImage && backgroundImage.img && backgroundImage.visible !== false) {
                ctx.save();
                ctx.globalAlpha = backgroundImage.opacity != null ? backgroundImage.opacity : 1;
                const bw = backgroundImage.w || backgroundImage.img.naturalWidth;
                const bh = backgroundImage.h || backgroundImage.img.naturalHeight;
                ctx.drawImage(backgroundImage.img, 0, 0, bw, bh);
                ctx.restore();
            }

            // Elements
            elements.forEach(el => {
                if (el.hidden) return;
                const col = el.color || '#2563eb';
                ctx.save();
                if (el.isLine && el.p1 && el.p2) {
                    const thk = getLineThicknessDraw(el);
                    const ang = Math.atan2(el.p2.y - el.p1.y, el.p2.x - el.p1.x);
                    const len = Math.hypot(el.p2.x - el.p1.x, el.p2.y - el.p1.y);
                    const midX = (el.p1.x + el.p2.x) / 2;
                    const midY = (el.p1.y + el.p2.y) / 2;
                    ctx.translate(midX, midY);
                    ctx.rotate(ang);
                    ctx.fillStyle = col + '99';
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 1 / scale;
                    ctx.fillRect(-len / 2, -thk / 2, len, thk);
                    ctx.strokeRect(-len / 2, -thk / 2, len, thk);
                    ctx.restore();
                    ctx.save();
                    ctx.fillStyle = '#111';
                    ctx.font = `${10 / scale}px sans-serif`;
                    const lenM = toMeters(len);
                    ctx.fillText(
                        `${el.label || el.type}  ${lenM.toFixed(2)} m  h=${(el.zHeight || 0).toFixed(2)} m`,
                        midX + 4, midY - thk / 2 - 4
                    );
                } else if (el.vertices && el.vertices.length >= 3) {
                    // vertices are relative to el.x / el.y — convert to absolute world coords
                    const pts = el.vertices.map(v => ({ x: el.x + v.x, y: el.y + v.y }));
                    ctx.beginPath();
                    pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
                    ctx.closePath();
                    ctx.fillStyle = col + '55';
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 1.5 / scale;
                    ctx.fill();
                    ctx.stroke();
                    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
                    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
                    ctx.fillStyle = '#111';
                    ctx.font = `${10 / scale}px sans-serif`;
                    ctx.fillText(`${el.label || el.type}  h=${(el.zHeight || 0).toFixed(2)} m`, cx, cy);
                } else {
                    const x = el.x || 0, y = el.y || 0, w = el.w || 10, h = el.h || 10;
                    ctx.fillStyle = col + '55';
                    ctx.strokeStyle = col;
                    ctx.lineWidth = 1.5 / scale;
                    ctx.fillRect(x, y, w, h);
                    ctx.strokeRect(x, y, w, h);
                    ctx.fillStyle = '#111';
                    ctx.font = `${10 / scale}px sans-serif`;
                    ctx.fillText(
                        `${el.label || el.type}  h=${(el.zHeight || 0).toFixed(2)} m`,
                        x + 4, y + 12
                    );
                }
                ctx.restore();
            });

            ctx.restore();

            // Title + footer: project, Participant ID, Drawing ID, Calibration (printed on marked plan)
            let participantId = '—';
            let drawingId = '—';
            let projectIdLabel = '—';
            let revisionLabel = 'ORIGINAL';
            try {
                if (window.MCResearch) {
                    if (typeof MCResearch.getParticipantId === 'function') {
                        participantId = MCResearch.getParticipantId() || '—';
                    }
                    const ids = (typeof MCResearch.getResearchIds === 'function')
                        ? MCResearch.getResearchIds()
                        : (MCResearch.getProject && MCResearch.getProject());
                    if (ids) {
                        if (ids.drawingId) drawingId = ids.drawingId;
                        if (ids.projectId) projectIdLabel = ids.projectId;
                        if (ids.revision) revisionLabel = ids.revision;
                    }
                }
            } catch (_) {}
            const scaleNote = Math.abs(calibrationFactor - 1) < 1e-9
                ? '1 unit = 1 m'
                : ('1 unit = ' + Number(calibrationFactor).toFixed(6) + ' m');
            const projName = (projectInfo && projectInfo.name) ? projectInfo.name : 'Untitled Project';
            const dateStr = new Date().toISOString().slice(0, 10);

            const bannerH = Math.max(52, Math.min(72, H * 0.06));
            const footerH = Math.max(28, Math.min(40, H * 0.035));
            const pad = Math.max(10, bannerH * 0.18);
            const titleSize = Math.max(13, Math.min(18, bannerH * 0.32));
            const metaSize = Math.max(11, Math.min(14, bannerH * 0.24));

            ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
            ctx.fillRect(0, 0, W, bannerH);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold ' + titleSize + 'px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('Marked Drawing — ' + projName, pad, pad);
            ctx.font = metaSize + 'px sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText('Participant ID: ' + participantId + '    Drawing ID: ' + drawingId + '    Project ID: ' + projectIdLabel, pad, pad + titleSize + 6);
            ctx.fillText('Calibration: ' + scaleNote + '    Mode: PRO    Revision: ' + revisionLabel + '    Date: ' + dateStr, pad, pad + titleSize + metaSize + 12);

            ctx.fillStyle = 'rgba(15, 23, 42, 0.90)';
            ctx.fillRect(0, H - footerH, W, footerH);
            ctx.fillStyle = '#cbd5e1';
            ctx.font = Math.max(10, footerH * 0.38) + 'px sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(
                'Participant: ' + participantId + '  ·  Drawing: ' + drawingId + '  ·  Project: ' + projectIdLabel + '  ·  Rev: ' + revisionLabel + '  ·  ' + scaleNote,
                pad,
                H - footerH / 2
            );
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
        }

        function exportMarkedDrawingPdf() {
            const bounds = getExportWorldBounds();
            const worldW = Math.max(10, bounds.maxX - bounds.minX);
            const worldH = Math.max(10, bounds.maxY - bounds.minY);
            const maxEdge = 2400;
            const scale = maxEdge / Math.max(worldW, worldH);
            const canvasW = Math.round(worldW * scale);
            const canvasH = Math.round(worldH * scale);

            const off = document.createElement('canvas');
            off.width = canvasW;
            off.height = canvasH;
            const ctx = off.getContext('2d');
            drawMarkedExport(ctx, bounds, scale);

            const dateStr = new Date().toISOString().slice(0, 10);
            const safeName = ((projectInfo && projectInfo.name) || 'takeoff')
                .replace(/[^\w\-]+/g, '_').slice(0, 40);
            const baseName = 'Marked_Drawing_' + safeName + '_' + dateStr;

            // Prefer PDF; fall back to PNG (always works offline)
            const jpegDataUrl = off.toDataURL('image/jpeg', 0.92);

            // Research: store marked plan on server for dashboard download
            try {
                if (window.MCResearch && typeof MCResearch.saveMarkedDrawing === 'function' && MCResearch.getParticipantId()) {
                    MCResearch.saveMarkedDrawing(jpegDataUrl, {
                        mimeType: 'image/jpeg',
                        mode: 'pro',
                        source: 'pro_marked_export',
                    }).then(function (r) {
                        if (r) console.log('📥 Marked drawing saved for research', r.drawingId || '', r.fileName || '');
                    }).catch(function () {});
                }
            } catch (_) {}

            // Save final visible Pro elements as QS-reviewed training/evaluation annotations.
            try {
                if (window.MCResearch && typeof MCResearch.saveReviewedAnnotations === 'function' && window.MCResearch.getParticipantId && MCResearch.getParticipantId()) {
                    const aiElementsForEvaluation = elements.filter(function (el) {
                        return !el.hidden && (el.source === 'AI' || el.source === 'AI_EDITED' || el.ai === true);
                    }).map(function (el) {
                        return {
                            type: el.type, label: el.label, x: el.x, y: el.y, w: el.w, h: el.h,
                            height: el.zHeight || el.height || null, isLine: !!el.isLine,
                            p1: el.p1 || null, p2: el.p2 || null, vertices: el.vertices || null,
                            thickness: (typeof getLineThicknessDraw === 'function' && el.isLine) ? getLineThicknessDraw(el) : (el.thickness || null),
                            source: el.source || 'AI', reviewStatus: el.reviewStatus || 'AI_GENERATED', accepted: el.accepted !== false
                        };
                    });
                    const reviewed = elements.filter(function (el) { return !el.hidden; }).map(function (el) {
                        return {
                            type: el.type, label: el.label, x: el.x, y: el.y, w: el.w, h: el.h,
                            height: el.zHeight || el.height || null, isLine: !!el.isLine,
                            p1: el.p1 || null, p2: el.p2 || null, vertices: el.vertices || null,
                            thickness: (typeof getLineThicknessDraw === 'function' && el.isLine) ? getLineThicknessDraw(el) : (el.thickness || null),
                            source: el.source || (el.ai ? 'AI_EDITED' : 'MANUAL'),
                            reviewStatus: 'QS_REVIEWED', accepted: true
                        };
                    });
                    if (reviewed.length) {
                        MCResearch.saveReviewedAnnotations(reviewed, {
                            mode: 'pro',
                            imageWidth: (backgroundImage && (backgroundImage.w || backgroundImage.img && backgroundImage.img.naturalWidth)) || canvas2d.width,
                            imageHeight: (backgroundImage && (backgroundImage.h || backgroundImage.img && backgroundImage.img.naturalHeight)) || canvas2d.height,
                            metersPerPixel: (typeof calibrationFactor === 'number') ? calibrationFactor : null,
                            source: 'pro_qs_export',
                            aiElements: aiElementsForEvaluation
                        }).then(function (r) { if (r) console.log('📥 Reviewed annotations saved', r.drawingId || ''); }).catch(function () {});
                    }
                }
            } catch (_) {}

            try {
                if (downloadImageAsPdf(jpegDataUrl, canvasW, canvasH, baseName + '.pdf')) {
                    console.log('📥 Marked drawing PDF exported:', baseName + '.pdf');
                    return;
                }
            } catch (err) {
                console.warn('PDF export failed, falling back to PNG', err);
            }

            // PNG fallback
            off.toBlob(function(blob) {
                if (!blob) {
                    alert('Could not export marked drawing.');
                    return;
                }
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = baseName + '.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                alert('Marked drawing saved as PNG (PDF library unavailable).\nYou can print the PNG to PDF from your system if needed.');
            }, 'image/png');
        }

        /** Build a one-page PDF embedding a JPEG (no external library required). */
        function downloadImageAsPdf(jpegDataUrl, imgW, imgH, filename) {
            const comma = jpegDataUrl.indexOf(',');
            if (comma < 0) return false;
            const b64 = jpegDataUrl.slice(comma + 1);
            // Decode base64 → binary string for PDF stream
            const raw = atob(b64);
            const jpegLen = raw.length;

            // A3 page in points (1 pt = 1/72 in). A3 = 297 x 420 mm
            const orientLandscape = imgW >= imgH;
            const pageW = orientLandscape ? 1190.55 : 841.89; // ~A3
            const pageH = orientLandscape ? 841.89 : 1190.55;
            const margin = 24;
            const usableW = pageW - margin * 2;
            const usableH = pageH - margin * 2;
            const imgRatio = imgW / imgH;
            let drawW = usableW;
            let drawH = drawW / imgRatio;
            if (drawH > usableH) {
                drawH = usableH;
                drawW = drawH * imgRatio;
            }
            const x = (pageW - drawW) / 2;
            const y = (pageH - drawH) / 2;

            // PDF objects
            const objects = [];
            const addObj = (body) => {
                objects.push(body);
                return objects.length; // 1-based id
            };

            const catalogId = addObj('<< /Type /Catalog /Pages 2 0 R >>');
            // pages id will be 2
            const pagesId = addObj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
            const pageId = addObj(
                '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW.toFixed(2) + ' ' + pageH.toFixed(2) + '] ' +
                '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'
            );
            // Image XObject — placeholder length, we'll build carefully
            // Content stream
            const content =
                'q\n' +
                drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm\n' +
                '/Im0 Do\n' +
                'Q\n';
            // We need object order: 1 catalog, 2 pages, 3 page, 4 image, 5 content
            // Rebuild with fixed IDs using byte offsets after assembly

            function buildPdf() {
                const encoder = new TextEncoder();
                const parts = [];
                const offsets = [0];

                function pushStr(s) {
                    parts.push(s);
                }

                pushStr('%PDF-1.4\n');

                // Obj 1 Catalog
                offsets[1] = parts.join('').length;
                // Use binary-safe length tracking with array of strings then measure
                // Better: collect {id, str} then join with offset calc on Uint8Array

                const chunks = [];
                function write(s) {
                    chunks.push(typeof s === 'string' ? s : s);
                }

                // We'll assemble as string for ASCII parts + raw jpeg
                // Track lengths in bytes (latin1 for binary jpeg)
                const out = [];
                const ofs = [0];
                let pos = 0;
                function w(str) {
                    out.push({ type: 's', data: str });
                    pos += str.length;
                }
                function wBin(binStr) {
                    out.push({ type: 'b', data: binStr });
                    pos += binStr.length;
                }
                function markObj(id) {
                    ofs[id] = pos;
                }

                w('%PDF-1.4\n');

                markObj(1);
                w('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

                markObj(2);
                w('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

                markObj(3);
                w('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
                    pageW.toFixed(2) + ' ' + pageH.toFixed(2) +
                    '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');

                markObj(4);
                w('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + imgW +
                    ' /Height ' + imgH + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
                    '/Filter /DCTDecode /Length ' + jpegLen + ' >>\nstream\n');
                wBin(raw);
                w('\nendstream\nendobj\n');

                markObj(5);
                const streamBody =
                    'q\n' +
                    drawW.toFixed(2) + ' 0 0 ' + drawH.toFixed(2) + ' ' +
                    x.toFixed(2) + ' ' + y.toFixed(2) + ' cm\n' +
                    '/Im0 Do\nQ\n';
                w('5 0 obj\n<< /Length ' + streamBody.length + ' >>\nstream\n' + streamBody + 'endstream\nendobj\n');

                const xrefPos = pos;
                w('xref\n0 6\n');
                w('0000000000 65535 f \n');
                for (let i = 1; i <= 5; i++) {
                    w(String(ofs[i]).padStart(10, '0') + ' 00000 n \n');
                }
                w('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');

                // Convert to Blob
                const bytes = [];
                out.forEach(chunk => {
                    if (chunk.type === 's') {
                        for (let i = 0; i < chunk.data.length; i++) {
                            bytes.push(chunk.data.charCodeAt(i) & 0xff);
                        }
                    } else {
                        for (let i = 0; i < chunk.data.length; i++) {
                            bytes.push(chunk.data.charCodeAt(i) & 0xff);
                        }
                    }
                });
                const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                return true;
            }

            return buildPdf();
        }


        // ----- EXPORT MODAL (graphical preview + one-click downloads) -----
        function showExportToast(msg) {
            const t = document.getElementById('exportToast');
            if (!t) return;
            t.textContent = msg || 'Downloaded';
            t.classList.add('show');
            clearTimeout(t._hideTimer);
            t._hideTimer = setTimeout(() => t.classList.remove('show'), 2200);
        }

        function resolveMaterialRate(matName) {
            if (!matName || typeof materialLibrary !== 'object') return null;
            if (materialLibrary[matName]) return materialLibrary[matName];
            const lower = String(matName).toLowerCase();
            const keys = Object.keys(materialLibrary);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                const kl = k.toLowerCase();
                if (lower.indexOf(kl) >= 0 || kl.indexOf(lower.split(/[–\-]/)[0].trim()) >= 0) {
                    return materialLibrary[k];
                }
            }
            if (lower.indexOf('brick') >= 0 || lower.indexOf('block') >= 0) {
                return materialLibrary['Brick'] || materialLibrary['Block 100mm'] || materialLibrary['Block 150mm'] || null;
            }
            if (lower.indexOf('concrete') >= 0 || lower.indexOf('cement') >= 0 ||
                lower.indexOf('slab') >= 0 || lower.indexOf('column') >= 0 || lower.indexOf('beam') >= 0) {
                return materialLibrary['Cement'] || materialLibrary['Aggregate'] || null;
            }
            if (lower.indexOf('plaster') >= 0 || lower.indexOf('sand') >= 0) {
                return materialLibrary['Sand'] || materialLibrary['Cement'] || null;
            }
            if (lower.indexOf('til') >= 0 || lower.indexOf('adhesive') >= 0) {
                return materialLibrary['Tiles (600x600mm)'] || materialLibrary['Adhesive'] || null;
            }
            if (lower.indexOf('paint') >= 0) return materialLibrary['Paint'] || null;
            return null;
        }

        function getBoqSummaryRows() {
            const rows = (typeof computeQuantities === 'function') ? computeQuantities() : [];
            const byMat = {};
            rows.forEach(r => {
                const key = r.material || 'Unspecified';
                if (!byMat[key]) byMat[key] = { qty: 0, unit: r.unit || '', remarks: [], count: 0 };
                byMat[key].qty += parseFloat(r.qty) || 0;
                byMat[key].unit = r.unit || byMat[key].unit;
                byMat[key].count += 1;
                if (r.remarks) byMat[key].remarks.push(r.remarks);
            });
            Object.keys(byMat).forEach(key => {
                const m = byMat[key];
                const lib = resolveMaterialRate(key);
                m.rate = lib && lib.cost != null ? Number(lib.cost) : null;
                m.color = (lib && lib.color) || '#94a3b8';
                m.cost = (m.rate != null && !isNaN(m.qty)) ? m.rate * m.qty : null;
                m.note = m.remarks && m.remarks[0] ? String(m.remarks[0]).slice(0, 90) : '';
            });
            return { rows, byMat };
        }

        function renderExportPreviewCanvas() {
            const canvas = document.getElementById('exportPreviewCanvas');
            const empty = document.getElementById('exportPreviewEmpty');
            if (!canvas) return;
            const hasContent = (backgroundImage && backgroundImage.img) || (elements && elements.length > 0);
            if (!hasContent) {
                canvas.style.display = 'none';
                if (empty) empty.style.display = 'block';
                return;
            }
            if (empty) empty.style.display = 'none';
            canvas.style.display = 'block';

            const bounds = getExportWorldBounds();
            const worldW = Math.max(10, bounds.maxX - bounds.minX);
            const worldH = Math.max(10, bounds.maxY - bounds.minY);
            const maxW = 520;
            const maxH = 320;
            const scale = Math.min(maxW / worldW, maxH / worldH, 4);
            const canvasW = Math.max(1, Math.round(worldW * scale));
            const canvasH = Math.max(1, Math.round(worldH * scale));
            canvas.width = canvasW;
            canvas.height = canvasH;
            const ctx = canvas.getContext('2d');
            try {
                drawMarkedExport(ctx, bounds, scale);
            } catch (err) {
                console.warn('Export preview draw failed', err);
                ctx.fillStyle = '#f1f5f9';
                ctx.fillRect(0, 0, canvasW, canvasH);
                ctx.fillStyle = '#64748b';
                ctx.font = '13px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Preview unavailable', canvasW / 2, canvasH / 2);
            }
        }

        function formatMoney(n) {
            if (n == null || isNaN(n)) return '—';
            const abs = Math.abs(n);
            const opts = abs >= 1000
                ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
                : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
            try {
                return n.toLocaleString(undefined, opts);
            } catch (e) {
                return String(Math.round(n * 100) / 100);
            }
        }

        function populateExportBoqTable() {
            const est = (typeof computeMaterialEstimate === 'function') ? computeMaterialEstimate() : null;
            const body = document.getElementById('exportBoqBody');
            const elemBody = document.getElementById('exportElemBody');
            const statElems = document.getElementById('exportStatElems');
            const statMats = document.getElementById('exportStatMats');
            const statItems = document.getElementById('exportStatItems');
            const totalBar = document.getElementById('exportTotalBar');
            const totalCostEl = document.getElementById('exportTotalCost');
            const matSub = document.getElementById('exportMatSub');
            const contEl = document.getElementById('exportContingency');

            if (statElems) statElems.textContent = String(elements.filter(e => !e.hidden).length);

            if (!est) {
                if (body) body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:14px;">Unable to compute estimate.</td></tr>';
                return;
            }

            const activeMats = est.materials.filter(m => m.qty > 0);
            if (statMats) statMats.textContent = String(activeMats.length);
            if (statItems) {
                const rows = (typeof computeQuantities === 'function') ? computeQuantities() : [];
                // Do not count zero-value aggregate placeholders (Plastering, Tiling, Painting)
                // as BOQ lines before the user has measured any elements.
                const billableRows = rows.filter(function (row) {
                    return row && Number(row.qty) > 0;
                });
                statItems.textContent = String(billableRows.length);
            }

            if (body) {
                if (activeMats.length === 0) {
                    body.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:14px;">Draw walls / slabs / columns first — quantities fill automatically.</td></tr>';
                } else {
                    let html = '';
                    activeMats.forEach(m => {
                        const q = (typeof m.qty === 'number') ? (Math.round(m.qty * 1000) / 1000) : m.qty;
                        const priceCell = (m.price != null)
                            ? formatMoney(m.price)
                            : '<span style="color:var(--text-tertiary);font-weight:400;">—</span>';
                        const totalCell = (m.total != null)
                            ? formatMoney(m.total)
                            : '<span style="color:var(--text-tertiary);font-weight:400;">—</span>';
                        html += '<tr title="' + escapeHtml(String(m.source || '')).replace(/"/g, '&quot;') + '">' +
                            '<td><span class="mat-dot" style="background:' + escapeHtml(String(m.color || '#94a3b8')) + ';"></span>' + escapeHtml(String(m.material || '')) +
                            '<div class="mat-note">' + escapeHtml(String(m.source || '')) + '</div></td>' +
                            '<td class="qty-cell">' + escapeHtml(String(q)) + '</td>' +
                            '<td>' + escapeHtml(String(m.unit || '—')) + '</td>' +
                            '<td class="cost-cell">' + priceCell + '</td>' +
                            '<td class="cost-cell">' + totalCell + '</td>' +
                            '</tr>';
                    });
                    // Also show zero lines collapsed? skip zeros for clarity
                    body.innerHTML = html;
                }
            }

            if (elemBody) {
                let eh = '';
                est.elementQty.forEach(eq => {
                    if (!eq.qty) return;
                    eh += '<tr><td>' + escapeHtml(String(eq.element || '')) + '</td><td class="qty-cell">' + escapeHtml(String(eq.qty)) + '</td><td>' + escapeHtml(String(eq.unit || '')) + '</td></tr>';
                });
                elemBody.innerHTML = eh || '<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary);padding:10px;">No elements yet</td></tr>';
            }

            if (totalBar && totalCostEl) {
                const hasPrices = est.materials.some(m => m.price != null && m.qty > 0);
                if (hasPrices && est.materialsTotal > 0) {
                    totalBar.style.display = 'flex';
                    if (matSub) matSub.textContent = formatMoney(est.materialsTotal);
                    if (contEl) contEl.textContent = formatMoney(est.contingency);
                    totalCostEl.textContent = formatMoney(est.grandTotal);
                } else {
                    // Prices pending online DB / AI — show note instead of fake totals
                    totalBar.style.display = 'flex';
                    if (matSub) matSub.textContent = '—';
                    if (contEl) contEl.textContent = '—';
                    totalCostEl.textContent = '—';
                    totalCostEl.title = 'Connect online price database or set rates in Material Library';
                }
            }
        }

        function openExportModal() {
            const modal = document.getElementById('exportModal');
            if (!modal) return;
            const projName = (projectInfo && projectInfo.name) ? projectInfo.name : 'Untitled Project';
            const sub = document.getElementById('exportModalSub');
            if (sub) sub.textContent = projName + ' · ready to export';
            const scaleEl = document.getElementById('exportScaleNote');
            if (scaleEl) {
                scaleEl.textContent = Math.abs(calibrationFactor - 1) < 1e-9
                    ? '1 unit = 1 m'
                    : ('1 unit = ' + calibrationFactor.toFixed(4) + ' m');
            }
            populateExportBoqTable();
            modal.classList.add('open');
            requestAnimationFrame(() => {
                requestAnimationFrame(renderExportPreviewCanvas);
            });
        }

        function closeExportModal() {
            const modal = document.getElementById('exportModal');
            if (modal) modal.classList.remove('open');
        }

        function copyBoqSummaryToClipboard() {
            const est = computeMaterialEstimate();
            const projName = (projectInfo && projectInfo.name) ? projectInfo.name : 'Untitled Project';
            const dateStr = new Date().toLocaleDateString();
            const lines = [
                'MATERIAL ESTIMATE — ' + projName,
                'Date: ' + dateStr,
                'Client: ' + ((projectInfo && projectInfo.client) || '—'),
                '',
                '— Materials —',
            ];
            est.materials.filter(m => m.qty > 0).forEach(m => {
                if (m.price != null) {
                    lines.push(m.material + ':  ' + m.qty + ' ' + m.unit + '  @ ' + formatMoney(m.price) + '  = ' + formatMoney(m.total));
                } else {
                    lines.push(m.material + ':  ' + m.qty + ' ' + m.unit + '  |  price: — (pending online DB)');
                }
            });
            lines.push('', '— Element quantities —');
            est.elementQty.filter(e => e.qty > 0).forEach(eq => {
                lines.push(eq.element + ':  ' + eq.qty + ' ' + eq.unit);
            });
            lines.push('');
            lines.push('Materials: ' + formatMoney(est.materialsTotal));
            lines.push('Contingency (15%): ' + formatMoney(est.contingency));
            lines.push('TOTAL ESTIMATE: ' + formatMoney(est.grandTotal));
            lines.push('', 'Generated by MeasureCraft');
            const text = lines.join('\n');
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => showExportToast('Material estimate copied')).catch(() => fallbackCopy(text));
            } else {
                fallbackCopy(text);
            }
        }

        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                showExportToast('BOQ summary copied');
            } catch (e) {
                alert('Could not copy. Select and copy manually:\\n\\n' + text);
            }
            document.body.removeChild(ta);
        }

        function downloadProjectJsonFromExport() {
            const data = {
                elements, projectOverrides, materialLibrary, layers, nextId, isConfirmed, calibrationFactor, projectInfo,
                backgroundImage: backgroundImage ? {
                    src: backgroundImage.src, w: backgroundImage.w, h: backgroundImage.h,
                    opacity: backgroundImage.opacity, visible: backgroundImage.visible,
                } : null,
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safe = ((projectInfo && projectInfo.name) || 'takeoff').replace(/[^\w\-]+/g, '_').slice(0, 40);
            a.download = 'Project_' + safe + '_' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
            showExportToast('Project JSON saved');
        }

        function setupExportModal() {
            const close = document.getElementById('exportModalClose');
            if (close) close.addEventListener('click', closeExportModal);
            const overlay = document.getElementById('exportModal');
            if (overlay) {
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) closeExportModal();
                });
            }
            const btnExcel = document.getElementById('btnDlExcel');
            if (btnExcel) btnExcel.addEventListener('click', () => {
                try {
                    exportBoqExcel();
                    showExportToast('Excel BOQ downloaded');
                } catch (err) {
                    console.error('BOQ Excel export failed:', err);
                    showToast('BOQ export failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                }
            });
            const btnTxt = document.getElementById('btnDlTxt');
            if (btnTxt) btnTxt.addEventListener('click', downloadPlainTextReport);
            const btnPdf = document.getElementById('btnDlPdf');
            if (btnPdf) btnPdf.addEventListener('click', () => {
                exportMarkedDrawingPdf();
                showExportToast('Marked PDF downloaded');
            });
            const btnBoth = document.getElementById('btnDlBoth');
            if (btnBoth) btnBoth.addEventListener('click', () => {
                try {
                    exportBoqExcel();
                    setTimeout(() => {
                        exportMarkedDrawingPdf();
                        showExportToast('Excel + PDF downloaded');
                    }, 350);
                } catch (err) {
                    console.error('BOQ Excel export failed:', err);
                    showToast('BOQ export failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
                }
            });
            const btnCopy = document.getElementById('btnCopySummary');
            if (btnCopy) btnCopy.addEventListener('click', copyBoqSummaryToClipboard);
            const btnJson = document.getElementById('btnDlProjectJson');
            if (btnJson) btnJson.addEventListener('click', downloadProjectJsonFromExport);
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (typeof isTypingTarget === 'function' && (isTypingTarget(e.target) || isTypingTarget(document.activeElement))) return;
                const m = document.getElementById('exportModal');
                if (m && m.classList.contains('open')) closeExportModal();
            });
        }


        function setupToolbar() {
            document.querySelectorAll('.tool-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (isConfirmed) return;
                    const tool = btn.dataset.tool;

                    if (tool === 'calibrate') {
                        if (currentTool === 'calibrate') {
                            currentTool = null;
                            calibrateMode = false;
                            calibratePoints = [];
                            calibratePreview = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                        } else {
                            polygonPoints = [];
                            polygonTempLine = null;
                            deductionLinePoints = [];
                            deductionParentId = null;
                            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                            btn.classList.add('tool-active');
                            currentTool = 'calibrate';
                            calibrateMode = true;
                            calibratePoints = [];
                            calibratePreview = null;
                            measurePoints = [];
                            document.getElementById('statusMode').textContent = 'Calibrate: click 1st point';
                            document.getElementById('measureLabel').style.display = 'none';
                            document.getElementById('canvas2d').style.cursor = 'crosshair';
                        }
                        renderCanvas2D();
                        return;
                    }

                    if (tool === 'measure') {
                        if (currentTool === 'measure') {
                            currentTool = null;
                            measureMode = false;
                            measurePoints = [];
                            measurePreview = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('measureLabel').style.display = 'none';
                            document.getElementById('canvas2d').style.cursor = 'default';
                        } else {
                            polygonPoints = [];
                            polygonTempLine = null;
                            deductionLinePoints = [];
                            deductionParentId = null;
                            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                            btn.classList.add('tool-active');
                            currentTool = 'measure';
                            measureMode = true;
                            measurePoints = [];
                            measurePreview = null;
                            calibratePoints = [];
                            document.getElementById('statusMode').textContent = 'Measure: click 1st point';
                            document.getElementById('measureLabel').style.display = 'none';
                            document.getElementById('canvas2d').style.cursor = 'crosshair';
                        }
                        renderCanvas2D();
                        return;
                    }

                    // ---- Navigation tools ----
                    if (['select', 'pan', 'move'].includes(tool)) {
                        polygonPoints = [];
                        polygonTempLine = null;
                        deductionLinePoints = [];
                        deductionParentId = null;
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        btn.classList.add('tool-active');
                        currentTool = tool;
                        document.getElementById('statusMode').textContent =
                            tool === 'select' ? 'Select' :
                            tool === 'pan' ? 'Pan' :
                            tool === 'move' ? 'Move: drag selected objects' : tool;
                        document.getElementById('canvas2d').style.cursor =
                            tool === 'pan' ? 'grab' :
                            tool === 'select' || tool === 'move' ? 'default' : 'crosshair';
                        renderCanvas2D();
                        return;
                    }

                    // ---- Polygon tools (slab, cutout) ----
                    if (['slab', 'cutout', 'column'].includes(tool)) {
                        if (currentTool === tool && polygonPoints.length > 0) {
                            polygonPoints = [];
                            polygonTempLine = null;
                            currentTool = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        if (currentTool === tool) {
                            currentTool = null;
                            polygonPoints = [];
                            polygonTempLine = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        // A selected wall is an explicit target. Do not let a stale
                        // pending target from another wall override it.
                        // Walk selectedIds for a wall (primary is first after expandSelectionWithChildren).
                        let selectedWall = null;
                        if (tool === 'cutout') {
                            for (let si = 0; si < selectedIds.length; si++) {
                                const cand = findElementById(selectedIds[si]);
                                if (cand && cand.type === 'wall') { selectedWall = cand; break; }
                            }
                        }
                        const selectedWallId = selectedWall ? selectedWall.id : null;
                        polygonPoints = [];
                        polygonTempLine = null;
                        deductionLinePoints = [];
                        deductionParentId = null;
                        if (tool === 'cutout' && selectedWallId != null) {
                            pendingDeductionParentId = selectedWallId;
                            deductionTargetLocked = true;
                        } else if (tool === 'cutout') {
                            pendingDeductionParentId = null;
                            deductionTargetLocked = false;
                        }
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        btn.classList.add('tool-active');
                        currentTool = tool;
                        document.getElementById('statusMode').textContent =
                            `${tool}: click vertices · Enter / Done to finish`;
                        document.getElementById('canvas2d').style.cursor = 'crosshair';
                        selectedIds = [];
                        renderAll();
                        return;
                    }

                    // ---- Deduction Wall / Beam (line mode) ----
                    if (['deduction_wall'].includes(tool)) {
                        if (currentTool === tool && deductionLinePoints.length > 0) {
                            deductionLinePoints = [];
                            deductionParentId = null;
                            currentTool = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        if (currentTool === tool) {
                            currentTool = null;
                            deductionLinePoints = [];
                            deductionParentId = null;
                            pendingDeductionParentId = null;
                            deductionTargetLocked = false;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        // Lock target to the currently selected wall (stable ID), never default to Wall 1
                        const selectedWallForDed = findElementById(selectedIds[0]);
                        const selectedWallForDedId = selectedWallForDed && selectedWallForDed.type === 'wall'
                            ? selectedWallForDed.id : null;
                        polygonPoints = [];
                        polygonTempLine = null;
                        deductionLinePoints = [];
                        deductionParentId = null;
                        if (selectedWallForDedId != null) {
                            pendingDeductionParentId = selectedWallForDedId;
                            deductionParentId = selectedWallForDedId;
                            deductionTargetLocked = true;
                            hoveredParentId = selectedWallForDedId;
                        } else {
                            pendingDeductionParentId = null;
                            deductionTargetLocked = false;
                        }
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        btn.classList.add('tool-active');
                        currentTool = tool;
                        document.getElementById('statusMode').textContent = selectedWallForDedId != null
                            ? `Deduction on ${selectedWallForDed.label}: click along the wall · Enter/Done to finish`
                            : `Deduction Wall: click on a wall to snap, then continue points · Enter/Done to finish`;
                        document.getElementById('canvas2d').style.cursor = 'crosshair';
                        selectedIds = [];
                        renderAll();
                        return;
                    }

                    // ---- Wall / Beam line mode ----
                    if (['wall', 'beam'].includes(tool)) {
                        if (currentTool === tool && polygonPoints.length > 0) {
                            polygonPoints = [];
                            currentTool = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        if (currentTool === tool) {
                            currentTool = null;
                            polygonPoints = [];
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        polygonPoints = [];
                        polygonTempLine = null;
                        deductionLinePoints = [];
                        deductionParentId = null;
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        btn.classList.add('tool-active');
                        currentTool = tool;
                        document.getElementById('statusMode').textContent =
                            `${tool}: click points continuously · Enter/Done to finish`;
                        document.getElementById('canvas2d').style.cursor = 'crosshair';
                        selectedIds = [];
                        renderAll();
                        return;
                    }

                    // ---- Column (polygon, same as slab) ----
                    if (tool === 'column') {
                        if (currentTool === 'column' && polygonPoints.length > 0) {
                            polygonPoints = [];
                            polygonTempLine = null;
                            continuousTempPreview = null;
                            currentTool = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        if (currentTool === 'column') {
                            currentTool = null;
                            polygonPoints = [];
                            polygonTempLine = null;
                            continuousTempPreview = null;
                            btn.classList.remove('tool-active');
                            document.getElementById('statusMode').textContent = 'Select';
                            document.getElementById('canvas2d').style.cursor = 'default';
                            renderCanvas2D();
                            return;
                        }
                        polygonPoints = [];
                        polygonTempLine = null;
                        continuousTempPreview = null;
                        deductionLinePoints = [];
                        deductionParentId = null;
                        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('tool-active'));
                        btn.classList.add('tool-active');
                        currentTool = 'column';
                        document.getElementById('statusMode').textContent =
                            'column: click vertices · Enter / Done to finish';
                        document.getElementById('canvas2d').style.cursor = 'crosshair';
                        selectedIds = [];
                        renderAll();
                        return;
                    }
                });
            });

            document.getElementById('btnUndo').addEventListener('click', undo);
            document.getElementById('btnRedo').addEventListener('click', redo);

            document.getElementById('btnZoomIn').addEventListener('click', () => {
                if (currentView === '3d') { camera.position.multiplyScalar(0.9);
                    controls.update(); return; }
                const { W, H } = getViewerSize();
                const cx = W / 2, cy = H / 2;
                const world = screenToWorld(cx, cy);
                viewport.scale = Math.min(10, viewport.scale * 1.25);
                viewport.offsetX = cx - world.x * viewport.scale;
                viewport.offsetY = cy - world.y * viewport.scale;
                updateZoomDisplays();
                renderCanvas2D();
            });
            document.getElementById('btnZoomOut').addEventListener('click', () => {
                if (currentView === '3d') { camera.position.multiplyScalar(1.1);
                    controls.update(); return; }
                const { W, H } = getViewerSize();
                const cx = W / 2, cy = H / 2;
                const world = screenToWorld(cx, cy);
                viewport.scale = Math.max(0.05, viewport.scale / 1.25);
                viewport.offsetX = cx - world.x * viewport.scale;
                viewport.offsetY = cy - world.y * viewport.scale;
                updateZoomDisplays();
                renderCanvas2D();
            });
            document.getElementById('btnZoomFit').addEventListener('click', () => {
                if (currentView === '3d') {
                    const box = new THREE.Box3();
                    threeObjects.forEach(obj => { if (obj.isMesh) box.expandByObject(obj); });
                    if (!box.isEmpty()) {
                        const size = box.getSize(new THREE.Vector3());
                        const center = box.getCenter(new THREE.Vector3());
                        const maxDim = Math.max(size.x, size.y, size.z);
                        const dist = maxDim * 1.5;
                        camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist);
                        controls.target.copy(center);
                        controls.update();
                    }
                    return;
                }
                // Fit underlay + elements, centered in the viewer
                fitViewportToContent({ pad: 48 });
            });

            document.getElementById('btnZoomLock').addEventListener('click', function() {
                zoomLocked = !zoomLocked;
                this.classList.toggle('tool-active', zoomLocked);
                this.classList.toggle('primary', zoomLocked);
                const icon = this.querySelector('i');
                if (icon) {
                    icon.className = zoomLocked ? 'fas fa-lock' : 'fas fa-lock-open';
                }
                this.setAttribute('data-tooltip', zoomLocked
                    ? 'Unlock Zoom — allow trackpad/scroll zoom (Ctrl/Cmd+scroll still works while locked)'
                    : 'Lock Zoom — disable trackpad/scroll zoom (easier pan)');
                const zd = document.getElementById('zoomDisplay');
                if (zd) {
                    const pct = Math.round((viewport.scale || 1) * 100) + '%';
                    zd.textContent = zoomLocked ? pct + ' 🔒' : pct;
                }
                if (typeof showToast === 'function') {
                    showToast(zoomLocked
                        ? 'Zoom locked — trackpad scroll will not zoom. Use buttons or Ctrl+scroll.'
                        : 'Zoom unlocked — trackpad/scroll zoom enabled.',
                        'info');
                }
            });

            document.getElementById('btnSnapGrid').addEventListener('click', function() {
                snapGrid = !snapGrid;
                this.classList.toggle('primary');
                updateSnapStatus();
            });
            (function setupAutoGlueUI() {
                const btn = document.getElementById('btnAutoGlue');
                const inp = document.getElementById('glueToleranceMm');
                function refreshGlueUI() {
                    if (btn) {
                        btn.classList.toggle('tool-active', autoGlueEnabled);
                        btn.innerHTML = autoGlueEnabled
                            ? '<i class="fas fa-link"></i> Glue'
                            : '<i class="fas fa-unlink"></i> Separate';
                        btn.setAttribute('data-tooltip', autoGlueEnabled
                            ? 'Auto-Glue ON — nearby walls/columns join within tolerance. Click for Keep Separate.'
                            : 'Keep Separate — elements stay independent even if close. Click for Auto-Glue.');
                    }
                    if (inp) inp.value = String(glueToleranceMm);
                }
                if (btn) {
                    btn.addEventListener('click', function () {
                        autoGlueEnabled = !autoGlueEnabled;
                        refreshGlueUI();
                        try {
                            showToast(autoGlueEnabled
                                ? ('Auto-Glue ON · tolerance ' + glueToleranceMm + ' mm')
                                : 'Keep Separate — no auto connection', 'success');
                        } catch (_) {}
                    });
                }
                if (inp) {
                    inp.addEventListener('change', function () {
                        let v = parseFloat(inp.value);
                        if (!isFinite(v) || v < 0) v = 0;
                        if (v > 500) v = 500;
                        glueToleranceMm = v;
                        inp.value = String(v);
                        try { showToast('Connection tolerance: ' + v + ' mm', 'success'); } catch (_) {}
                    });
                }
                refreshGlueUI();
            })();
            document.getElementById('btnSnapWall').addEventListener('click', function() {
                snapWall = !snapWall;
                this.classList.toggle('primary');
                updateSnapStatus();
            });

            function updateSnapStatus() {
                let s = '';
                if (snapGrid) s += 'Grid ';
                if (snapWall) s += 'Wall';
                const el = document.getElementById('statusSnap');
                if (!el) return;
                if (!snapGrid && !snapWall) {
                    el.textContent = 'Snap: off (exact)';
                } else {
                    el.textContent = 'Snap: ' + s.trim() + (snapGrid ? ' · Alt/Shift = exact' : '');
                }
            }
            updateSnapStatus();

            const elementSearch = document.getElementById('elementSearch');
            if (elementSearch) {
                elementSearch.addEventListener('input', function () {
                    elementSearchQuery = this.value || '';
                    renderTree();
                });
            }
            const btnFocusMode = document.getElementById('btnFocusMode');
            function setFocusMode(on) {
                document.body.classList.toggle('focus-mode', !!on);
                if (btnFocusMode) {
                    btnFocusMode.setAttribute('aria-pressed', on ? 'true' : 'false');
                    btnFocusMode.innerHTML = on ? '<i class="fas fa-compress"></i><span class="focus-label">Exit Focus</span>' : '<i class="fas fa-expand"></i><span class="focus-label">Focus</span>';
                }
                requestAnimationFrame(function () { renderCanvas2D(); positionArrowButtons(); });
            }
            if (btnFocusMode) btnFocusMode.addEventListener('click', function () {
                setFocusMode(!document.body.classList.contains('focus-mode'));
            });
            const btnFocusExit = document.getElementById('btnFocusExit');
            if (btnFocusExit) btnFocusExit.addEventListener('click', function () { setFocusMode(false); });
            document.addEventListener('keydown', function (e) {
                if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return;
                if (e.key.toLowerCase() === 'f') setFocusMode(!document.body.classList.contains('focus-mode'));
                if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) setFocusMode(false);
            });

            document.getElementById('btnSettings').addEventListener('click', openSettings);
            
            document.getElementById('btnMaterials').addEventListener('click', openMaterials);
            const btnFetchMarketRates = document.getElementById('btnFetchMarketRates');
            if (btnFetchMarketRates) {
                btnFetchMarketRates.addEventListener('click', async function () {
                    const region = (document.getElementById('marketRegionInput')||{}).value || 'Colombo, Sri Lanka';
                    const statusEl = document.getElementById('marketRatesStatus');
                    this.disabled = true;
                    if (statusEl) statusEl.textContent = 'Fetching market rates…';
                    try {
                        const result = await fetchMarketRatesForLibrary(region.trim());
                        const n = applyMarketRatesToLibrary(result);
                        openMaterials();
                        if (statusEl) statusEl.textContent = 'Updated '+n+' rate(s) via '+(result.source||'AI')+(result.currency?' · '+result.currency:'')+'. Estimates only.';
                        if (typeof renderQuantityTable==='function') renderQuantityTable();
                    } catch(err) {
                        if (statusEl) statusEl.textContent = 'Failed: '+(err.message||err);
                        alert('Market rates failed: '+(err.message||err));
                    } finally { this.disabled = false; }
                });
            }


            const btnViewProps = document.getElementById('btnViewProps');
            if (btnViewProps) {
                btnViewProps.addEventListener('click', togglePropsPanel);
            }
            const btnPropsClose = document.getElementById('btnPropsClose');
            if (btnPropsClose) {
                btnPropsClose.addEventListener('click', closePropsPanel);
            }
            const btnArrowProps = document.getElementById('btnArrowProps');
            if (btnArrowProps) btnArrowProps.addEventListener('click', togglePropsPanel);
            const btnArrowElements = document.getElementById('btnArrowElements');
            if (btnArrowElements) {
                btnArrowElements.addEventListener('click', toggleElementsPanel);
                closeElementsPanel();
            }
            const btnArrowQty = document.getElementById('btnArrowQty');
            if (btnArrowQty) btnArrowQty.addEventListener('click', toggleQtyPanel);
            const btnQtyClose = document.getElementById('btnQtyClose');
            if (btnQtyClose) btnQtyClose.addEventListener('click', closeQtyPanel);
            window.addEventListener('resize', positionArrowButtons);
            // Re-dock arrows after layout changes (measure, render)
            const _origRenderAll = typeof renderAll === 'function' ? null : null;
            setInterval(function () {
                const q = document.getElementById('bottom-panel');
                const p = document.getElementById('right-panel');
                if ((q && q.classList.contains('open')) || (p && p.classList.contains('open'))) {
                    positionArrowButtons();
                }
            }, 800);
            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (typeof isTypingTarget === 'function' && (isTypingTarget(e.target) || isTypingTarget(document.activeElement))) return;
                const aiM = document.getElementById('aiReviewModal');
                if (aiM && aiM.classList.contains('open')) { acceptAllAiReview(); return; }
                closePropsPanel();
                closeQtyPanel();
            });

            const btnComplete = document.getElementById('btnComplete');
            if (btnComplete) btnComplete.addEventListener('click', () => {
                const drawingActive =
                    (currentTool === 'deduction_wall' && deductionLinePoints.length > 0) ||
                    ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length > 0) ||
                    (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length > 0);
                if (currentTool === 'deduction_wall') {
                    if (deductionLinePoints.length >= 2) { completeDeductionLine(); return; }
                    if (drawingActive) { alert('Need at least 2 points for a deduction.'); return; }
                } else if (currentTool === 'wall' || currentTool === 'beam') {
                    if (polygonPoints.length >= 2) { completeWallBeamLine(); return; }
                    if (drawingActive) { alert('Need at least 2 points.'); return; }
                } else if (['slab', 'cutout', 'column'].includes(currentTool)) {
                    if (polygonPoints.length >= 3) { completeDrawing(); return; }
                    if (drawingActive) { alert('Need at least 3 points.'); return; }
                }
                // Idle: treat Done as takeoff complete → guide user to export then leave
                const n = (typeof elements !== 'undefined' && elements) ? elements.length : 0;
                const msg = n
                    ? ('Takeoff complete (' + n + ' element(s)).\n\nExport your file / BOQ now before leaving?\n\nOK = open Export · Cancel = stay')
                    : 'No elements yet. You can still export project settings, or stay to continue working.';
                if (window.confirm(msg)) {
                    try {
                        if (typeof openExportModal === 'function') openExportModal();
                        else {
                            const be = document.getElementById('btnExport');
                            if (be) be.click();
                        }
                    } catch (e) {
                        alert('Use the Export button in the toolbar to download your takeoff, then you can log out.');
                    }
                }
            });
            const btnCancelDraw = document.getElementById('btnCancelDraw');
            if (btnCancelDraw) btnCancelDraw.addEventListener('click', () => {
                const drawingActive =
                    (currentTool === 'deduction_wall' && deductionLinePoints.length > 0) ||
                    ((currentTool === 'wall' || currentTool === 'beam') && polygonPoints.length > 0) ||
                    (['slab', 'cutout', 'column'].includes(currentTool) && polygonPoints.length > 0) ||
                    (currentTool === 'measure' && measurePoints && measurePoints.length > 0) ||
                    (currentTool === 'calibrate' && calibratePoints && calibratePoints.length > 0);
                if (drawingActive) {
                    cancelDrawing();
                    try { if (typeof toast === 'function') toast('Drawing cancelled.', 'info'); } catch (_) {}
                    return;
                }
                // Idle cut/cancel: offer to remove underlay drawing with confirmation
                if (backgroundImage) {
                    if (window.confirm('Remove the uploaded drawing underlay from the canvas?\n\nElements stay; only the background plan is cleared.')) {
                        backgroundImage = null;
                        const bgc = document.getElementById('bgControls');
                        if (bgc) bgc.style.display = 'none';
                        renderCanvas2D();
                        try { if (typeof toast === 'function') toast('Drawing underlay removed.', 'success'); else alert('Drawing underlay removed.'); } catch (_) { alert('Drawing underlay removed.'); }
                    }
                } else {
                    try { if (typeof toast === 'function') toast('Nothing to cancel — no active drawing or underlay.', 'info'); else alert('Nothing to cancel — no active drawing or underlay.'); } catch (_) { alert('Nothing to cancel — no active drawing or underlay.'); }
                }
            });
            const btnDelete = document.getElementById('btnDelete');
            if (btnDelete) btnDelete.addEventListener('click', () => {
                if (typeof selectedIds !== 'undefined' && selectedIds && selectedIds.length) {
                    deleteSelected();
                    try { if (typeof toast === 'function') toast('Deleted selected element(s).', 'success'); } catch (_) {}
                } else {
                    try { if (typeof toast === 'function') toast('Select one or more elements to delete.', 'info'); else alert('Select one or more elements to delete.'); } catch (_) { alert('Select one or more elements to delete.'); }
                }
            });
            const btnRotateCW = document.getElementById('btnRotateCW');
            const btnRotateCCW = document.getElementById('btnRotateCCW');
            if (btnRotateCW) btnRotateCW.addEventListener('click', function () {
                if (!selectedIds.length) { try { showToast('Select element(s) to rotate', 'info'); } catch (_) {} return; }
                rotateSelected(90);
            });
            if (btnRotateCCW) btnRotateCCW.addEventListener('click', function () {
                if (!selectedIds.length) { try { showToast('Select element(s) to rotate', 'info'); } catch (_) {} return; }
                rotateSelected(-90);
            });
            const btnConfirm = document.getElementById('btnConfirm');
            if (btnConfirm) btnConfirm.addEventListener('click', () => confirmTakeoff());

            // Save project (download JSON)
            const btnSave = document.getElementById('btnSave');
            if (btnSave) btnSave.addEventListener('click', () => {
                const data = {
                    elements, projectOverrides, materialLibrary, layers, nextId, isConfirmed, calibrationFactor, projectInfo,
                    backgroundImage: backgroundImage ? {
                        src: backgroundImage.src, w: backgroundImage.w, h: backgroundImage.h,
                        opacity: backgroundImage.opacity, visible: backgroundImage.visible,
                    } : null,
                };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'takeoff_project.json';
                a.click();
                URL.revokeObjectURL(url);
            });

            
            document.getElementById('fileInput').addEventListener('change', function(e) {
                const file = this.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function(ev) {
                    try {
                        const data = JSON.parse(ev.target.result);
                        if (data.elements) {
                            const normalized = normalizeElementIdentity(data.elements, data.nextId);
                            elements = normalized.elements;
                            if (data.projectOverrides) {
                                projectOverrides = data.projectOverrides;
                                // Strip legacy money rates (AI decides rates)
                                try {
                                    Object.keys(projectOverrides).forEach(function (g) {
                                        const o = projectOverrides[g];
                                        if (!o || typeof o !== 'object') return;
                                        Object.keys(o).forEach(function (k) {
                                            if (/^cost/i.test(k) || /costPer/i.test(k)) delete o[k];
                                        });
                                    });
                                } catch (_) {}
                            }
                            if (data.materialLibrary) materialLibrary = { ...materialLibrary, ...data
                                    .materialLibrary };
                            if (data.layers) layers = data.layers;
                            if (data.calibrationFactor != null) calibrationFactor = data.calibrationFactor;
                            if (data.projectInfo) {
                                projectInfo = Object.assign({
                                    name: 'Untitled Project', client: '', location: '', ref: '', qs: '', notes: '',
                                    status: 'Draft', buildingType: '', floors: '', currency: 'LKR', units: 'metric'
                                }, data.projectInfo);
                                const ni = document.getElementById('projectNameInput');
                                if (ni) ni.value = projectInfo.name || 'Untitled Project';
                                const chip = document.getElementById('clientChip');
                                if (chip) chip.textContent = 'Client: ' + (projectInfo.client || '—');
                            }
                            if (data.backgroundImage && data.backgroundImage.src) {
                                loadBackgroundFromSrc(data.backgroundImage.src, {
                                    w: data.backgroundImage.w,
                                    h: data.backgroundImage.h,
                                    opacity: data.backgroundImage.opacity,
                                    visible: data.backgroundImage.visible,
                                });
                            } else {
                                backgroundImage = null;
                                document.getElementById('bgControls').style.display = 'none';
                            }
                            nextId = normalized.nextId;
                            undoStack = [];
                            redoStack = [];
                            saveState();
                            selectedIds = [];
                            isConfirmed = data.isConfirmed || false;
                            if (isConfirmed) { const _b3 = document.getElementById('btnConfirm'); if (_b3) _b3.classList.add('confirmed');
                                document.getElementById('statusEdit').textContent = 'Confirmed'; } else { const _b4 = document
                                    .getElementById('btnConfirm'); if (_b4) _b4.classList.remove('confirmed');
                                document.getElementById('statusEdit').textContent = 'Draft'; }
                            updateCalibDisplay();
                            renderAll();
                            if (!isConfirmed && projectInfo && projectInfo.status) {
                                const se = document.getElementById('statusEdit');
                                if (se) se.textContent = projectInfo.status;
                            }
                            showToast('Project loaded successfully.', 'success');
                        } else showToast('Invalid project file format.', 'error');
                    } catch (err) { showToast('Could not read project file. Please try again.', 'error'); }
                };
                reader.readAsText(file);
                this.value = '';
            });

            document.getElementById('btnUploadDrawing').addEventListener('click', () =>
                document.getElementById('drawingFileInput').click());
            document.getElementById('drawingFileInput').addEventListener('change', function(e) {
                const file = this.files[0];
                handleDrawingFile(file);
                this.value = '';
            });
            document.getElementById('bgOpacity').addEventListener('input', function() {
                if (backgroundImage) {
                    backgroundImage.opacity = this.value / 100;
                    renderCanvas2D();
                }
                const valDisplay = document.getElementById('bgOpacityValue');
                if (valDisplay) valDisplay.textContent = this.value + '%';
            });
            document.getElementById('btnBgToggle').addEventListener('click', function() {
                if (!backgroundImage) return;
                backgroundImage.visible = !backgroundImage.visible;
                this.innerHTML = backgroundImage.visible ?
                    '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>';
                renderCanvas2D();
            });
            document.getElementById('btnBgRemove').addEventListener('click', function() {
                if (!backgroundImage) return;
                if (!confirm('Remove the uploaded drawing underlay?')) return;
                backgroundImage = null;
                document.getElementById('bgControls').style.display = 'none';
                renderCanvas2D();
            });
            const btnToggleElements = document.getElementById('btnToggleElements');
            if (btnToggleElements) {
                btnToggleElements.addEventListener('click', toggleElementsOnDrawing);
                btnToggleElements.title = 'Hide measured elements on drawing';
            }
            document.getElementById('btnAiDetect').addEventListener('click', aiDetectElements);

            document.getElementById('btnExport').addEventListener('click', openExportModal);
            setupExportModal();


            document.querySelectorAll('.viewer-tabs button').forEach(btn => {
                btn.addEventListener('click', () => toggleView(btn.dataset.view));
            });

            document.getElementById('btnTheme').addEventListener('click', toggleTheme);

            const calibStatus = document.getElementById('statusCalib');
            if (calibStatus) {
                calibStatus.addEventListener('click', () => {
                    if (isConfirmed) return;
                    resetCalibration();
                });
            }
        }

        // ----- THEME -----
        function toggleTheme() {
            currentTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', currentTheme);
            document.getElementById('btnTheme').innerHTML = currentTheme === 'light' ?
                '<i class="fas fa-moon"></i>' :
                '<i class="fas fa-sun"></i>';
            if (currentView === '3d' && threeInitialized) {
                const bg = currentTheme === 'light' ? 0xf0f0f2 : 0x1c1c1e;
                scene.background = new THREE.Color(bg);
            }
            renderAll();
        }

        // ----- SETTINGS MODAL (unchanged) -----
        function openSettings() {
            const modal = document.getElementById('settingsModal');
            modal.classList.add('open');
            const content = document.getElementById('settingsContent');
            const groups = [
                { label: 'Concrete', key: 'concrete' },
                { label: 'Brick', key: 'brick' },
                { label: 'Plaster', key: 'plaster' },
                { label: 'Tiling', key: 'tiling' },
                { label: 'Painting', key: 'painting' },
            ];
            let html = '';
            groups.forEach(g => {
                html +=
                    `<h3 style="margin:12px 0 4px;font-size:14px;color:var(--text-secondary);border-bottom:1px solid var(--border-color);padding-bottom:4px;">${g.label}</h3>`;
                const obj = projectOverrides[g.key];
                if (!obj) return;
                Object.keys(obj).forEach(key => {
                    // Hide money rates — prices come from AI / Material Library only
                    if (/^cost/i.test(key) || /costPer/i.test(key)) return;
                    let val = obj[key];
                    if (Array.isArray(val)) {
                        val.forEach((item, index) => {
                            html +=
                                `<div class="field-group"><label>${key}[${index}]</label><input type="number" step="any" value="${item}" data-group="${g.key}" data-key="${key}" data-index="${index}" /></div>`;
                        });
                    } else {
                        let inputType = 'number',
                            step = 'any';
                        if (key === 'mix') { inputType = 'text';
                            step = ''; }
                        if (key === 'coats') step = '1';
                        if (key === 'waste' || key === 'wastage') step = '0.01';
                        html +=
                            `<div class="field-group"><label>${key}</label><input type="${inputType}" step="${step}" value="${val}" data-group="${g.key}" data-key="${key}" /></div>`;
                    }
                });
            });
            content.innerHTML = html;
        }

        document.getElementById('modalClose').addEventListener('click', () => document.getElementById('settingsModal')
            .classList.remove('open'));
        document.getElementById('modalCancel').addEventListener('click', () => document.getElementById('settingsModal')
            .classList.remove('open'));
        document.getElementById('modalSave').addEventListener('click', () => {
            const inputs = document.querySelectorAll('#settingsContent input');
            inputs.forEach(inp => {
                const group = inp.dataset.group,
                    key = inp.dataset.key,
                    index = inp.dataset.index;
                if (group && key) {
                    let val = inp.value;
                    if (!isNaN(val) && val.trim() !== '') val = parseFloat(val);
                    if (index !== undefined) {
                        if (!Array.isArray(projectOverrides[group][key])) projectOverrides[group][key] = [];
                        projectOverrides[group][key][parseInt(index)] = val;
                    } else projectOverrides[group][key] = val;
                }
            });
            document.getElementById('settingsModal').classList.remove('open');
            renderQuantityTable();
        });


        async function fetchMarketRatesForLibrary(region) {
            region = region || 'Colombo, Sri Lanka';
            const materials = Object.keys(materialLibrary).map(name => ({ name, unit: (materialLibrary[name]&&materialLibrary[name].unit)||'unit' }));
            let response;
            try {
                response = await fetch('/api/market-rates', { method:'POST', headers: mcApiHeaders(true), body: JSON.stringify({ region, materials }) });
            } catch (e) {
                throw new Error('Could not reach the server. Check your connection and try again.');
            }
            const data = await response.json().catch(()=>({}));
            if (!response.ok || !data.success) {
                if (data && data.code === 'NO_KEY') {
                    throw new Error('AI market rates are not configured on this server. Set GEMINI_API_KEY in the Render environment.');
                }
                throw new Error((data && data.error) || ('Market rates request failed (HTTP ' + response.status + ')'));
            }
            return { rates: data.rates||[], source:'server', notes:data.notes||'', currency:data.currency||'' };
        }
        function applyMarketRatesToLibrary(result) {
            let updated = 0;
            (result.rates||[]).forEach(r => {
                if (!r||!r.name||typeof r.cost!=='number') return;
                let key = Object.keys(materialLibrary).find(k => k.toLowerCase()===String(r.name).toLowerCase());
                if (!key) key = Object.keys(materialLibrary).find(k => k.toLowerCase().includes(String(r.name).toLowerCase()) || String(r.name).toLowerCase().includes(k.toLowerCase()));
                if (key) { materialLibrary[key].cost = r.cost; if (r.unit) materialLibrary[key].unit = r.unit; }
                else materialLibrary[r.name] = { cost: r.cost, unit: r.unit||'unit', color:'#94a3b8' };
                updated++;
            });
            return updated;
        }
        // ----- MATERIALS MODAL -----
        function openMaterials() {

            const modal = document.getElementById('materialsModal');
            modal.classList.add('open');
            const content = document.getElementById('materialsContent');
            let html =
                '<p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;">Edit material costs and properties.</p>';
            Object.keys(materialLibrary).forEach(name => {
                const mat = materialLibrary[name];
                const safeName = escapeHtml(String(name));
                const safeUnit = escapeHtml(String(mat.unit || ''));
                const safeColor = escapeHtml(String(mat.color || '#cccccc'));
                const safeCost = escapeHtml(String(mat.cost != null ? mat.cost : ''));
                // data-mat uses HTML attribute encoding via escapeHtml (quotes become entities)
                html += `<div class="material-row">
              <span style="width:120px;font-size:12px;font-weight:500;">${safeName}</span>
              <input type="number" step="0.01" value="${safeCost}" data-mat="${safeName}" data-field="cost" style="width:100px;" />
              <input type="text" value="${safeUnit}" data-mat="${safeName}" data-field="unit" style="width:80px;" />
              <input type="color" value="${safeColor}" data-mat="${safeName}" data-field="color" style="width:40px;height:30px;padding:2px;border:1px solid var(--border-color);border-radius:4px;" />
              <button style="color:var(--danger);font-size:14px;" data-mat="${safeName}" class="mat-delete"><i class="fas fa-trash"></i></button>
            </div>`;
            });
            html += `<div style="margin-top:12px;display:flex;gap:8px;">
            <input type="text" id="newMatName" placeholder="New material name" style="flex:1;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:4px 8px;border-radius:4px;font-size:12px;" />
            <input type="number" id="newMatCost" placeholder="Cost" style="width:100px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:4px 8px;border-radius:4px;font-size:12px;" />
            <input type="text" id="newMatUnit" placeholder="Unit" style="width:80px;background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-primary);padding:4px 8px;border-radius:4px;font-size:12px;" />
            <button class="primary" id="addMatBtn" style="padding:4px 12px;border-radius:4px;background:var(--accent);color:#fff;">Add</button>
          </div>`;
            content.innerHTML = html;
            content.querySelectorAll('.mat-delete').forEach(btn => {
                btn.addEventListener('click', () => {
                    const name = btn.dataset.mat;
                    if (confirm(`Delete material "${name}"?`)) {
                        delete materialLibrary[name];
                        openMaterials();
                    }
                });
            });
            document.getElementById('addMatBtn').addEventListener('click', () => {
                const name = document.getElementById('newMatName').value.trim();
                const cost = parseFloat(document.getElementById('newMatCost').value);
                const unit = document.getElementById('newMatUnit').value.trim() || 'unit';
                if (name && !isNaN(cost)) {
                    materialLibrary[name] = { cost, unit, color: '#cccccc' };
                    openMaterials();
                } else alert('Please enter a valid name and cost.');
            });
        }

        document.getElementById('matModalClose').addEventListener('click', () => document.getElementById('materialsModal')
            .classList.remove('open'));
        document.getElementById('matModalCancel').addEventListener('click', () => document.getElementById('materialsModal')
            .classList.remove('open'));
        document.getElementById('matModalSave').addEventListener('click', () => {
            const inputs = document.querySelectorAll('#materialsContent .material-row input');
            inputs.forEach(inp => {
                const name = inp.dataset.mat,
                    field = inp.dataset.field;
                if (name && field && materialLibrary[name]) {
                    let val = inp.value;
                    if (field === 'cost') {
                        // Empty → null (no rate); valid number → Number
                        if (val === '' || val == null) {
                            val = null;
                        } else {
                            const n = parseFloat(val);
                            val = isNaN(n) ? null : n;
                        }
                    }
                    materialLibrary[name][field] = val;
                }
            });
            document.getElementById('materialsModal').classList.remove('open');
            renderQuantityTable();
            try { populateExportBoqTable(); } catch (_) {}
        });

        // ----- RENDER ALL -----
        function renderAll() {
            renderTree();
            renderCanvas2D();
            renderProperties();
            renderQuantityTable();
            renderLayers();
            updateStatusBarMeta();
                        if (currentView === '3d' && threeInitialized) buildThreeScene();
            scheduleResearchQuantitySync();
        }
        function zoomToElement(el) {
            if (!el) return;
            // Build world-space points that frame the element correctly.
            // Vertices are stored relative to el.x/el.y — convert to absolute.
            let pts = [];
            if (el.isLine && el.p1 && el.p2) {
                pts = [el.p1, el.p2];
            } else if (Array.isArray(el.vertices) && el.vertices.length >= 2) {
                pts = el.vertices.map(function (v) {
                    return { x: (el.x || 0) + (v.x || 0), y: (el.y || 0) + (v.y || 0) };
                });
            } else {
                const x = el.x || 0, y = el.y || 0;
                const w = Math.max(1, el.w || 1), h = Math.max(1, el.h || 1);
                pts = [
                    { x: x, y: y },
                    { x: x + w, y: y },
                    { x: x + w, y: y + h },
                    { x: x, y: y + h }
                ];
            }
            let minX = Math.min.apply(null, pts.map(function (p) { return p.x; }));
            let maxX = Math.max.apply(null, pts.map(function (p) { return p.x; }));
            let minY = Math.min.apply(null, pts.map(function (p) { return p.y; }));
            let maxY = Math.max.apply(null, pts.map(function (p) { return p.y; }));
            // Expand thin line walls/beams by half thickness so the stroke is in view
            if (el.isLine) {
                let half = 4;
                try {
                    if (typeof getLineThicknessDraw === 'function') half = Math.max(2, getLineThicknessDraw(el) / 2);
                    else if (typeof el.thicknessDraw === 'number' && el.thicknessDraw > 0) half = el.thicknessDraw / 2;
                } catch (_) {}
                minX -= half; maxX += half; minY -= half; maxY += half;
            }
            const { W, H } = getViewerSize();
            const pad = 90;
            // Avoid extreme zoom on point-like or very thin elements
            const worldW = Math.max(20, maxX - minX);
            const worldH = Math.max(20, maxY - minY);
            const nextScale = Math.max(0.05, Math.min(10, Math.min((W - pad * 2) / worldW, (H - pad * 2) / worldH)));
            viewport.scale = nextScale;
            viewport.offsetX = W / 2 - ((minX + maxX) / 2) * viewport.scale;
            viewport.offsetY = H / 2 - ((minY + maxY) / 2) * viewport.scale;
            updateZoomDisplays();
            renderCanvas2D();
        }

        /** Zoom to a single selected element when in 2D view (tree / table / programmatic). */
        function zoomToSelectionIf2D() {
            try {
                if (typeof currentView === 'string' && currentView !== '2d') return;
                if (!selectedIds || selectedIds.length !== 1) return;
                const el = findElementById(selectedIds[0]);
                if (el) zoomToElement(el);
            } catch (_) {}
        }

        // ----- TREE RENDER -----
        function renderTree() {
            const container = document.getElementById('tree-container');
            const cats = {};
            const layerFilter = currentLayer === 'All' ? null : currentLayer;
            const query = String(elementSearchQuery || '').trim().toLowerCase();
            const filtered = elements.filter(el => {
                const layerMatch = layerFilter === null || el.layer === layerFilter || el.layer === 'All';
                if (!layerMatch) return false;
                if (!query) return true;
                return [el.label, el.type, el.material, el.room, el.location, el.id]
                    .some(value => String(value == null ? '' : value).toLowerCase().includes(query));
            });
            filtered.forEach(el => {
                const key = el.type + 's';
                if (!cats[key]) cats[key] = [];
                cats[key].push(el);
            });
            let html = '';
            for (const [cat, items] of Object.entries(cats)) {
                html += `<div class="tree-category">${cat}</div>`;
                items.forEach(function (el) {
                    const active = isSelectedId(el.id) ? 'active' : '';
                    const src = getElementSource(el);
                    const badge = src === 'AI' ? 'ai' : (src === 'AI_EDITED' ? 'edited' : (el.material ? 'cost' : 'manual'));
                    const badgeLabel = src === 'AI' ? 'AI' : (src === 'AI_EDITED' ? 'AI' : (el.material ? '💰' : 'M'));
                    const lock = el.locked ? '<i class="fas fa-lock lock-icon"></i>' : '';
                    const hidden = el.hidden ? ' style="opacity:0.4;"' : '';
                    html += `<div class="tree-item ${active}" data-id="${el.id}"${hidden}>
                <span class="color-dot" style="background:${escapeHtml(String(el.color || '#888'))}"></span>
                <span>${escapeHtml(String(el.label || el.type || ''))}</span>
                <span class="badge ${badge}">${badgeLabel}</span>
                ${lock}
              </div>`;
                });
            }
            container.innerHTML = html;
            document.getElementById('elemCount').textContent = elements.length;
            container.querySelectorAll('.tree-item').forEach(function (item) {
                item.addEventListener('click', function (e) {
                    if (isConfirmed) return;
                    const id = parseInt(item.dataset.id, 10);
                    if (!e.shiftKey) {
                        selectedIds = expandSelectionWithChildren([id]);
                    } else {
                        if (isSelectedId(id)) {
                            const removeSet = new Set(expandSelectionWithChildren([id]).map(String));
                            selectedIds = selectedIds.filter(function (sid) { return !removeSet.has(String(sid)); });
                        } else {
                            selectedIds = expandSelectionWithChildren(selectedIds.concat([id]));
                        }
                    }
                    renderAll();
                    // Single primary selection → frame it in 2D
                    try {
                        if (typeof currentView !== 'string' || currentView === '2d') {
                            zoomToElement(findElementById(id));
                        }
                    } catch (_) {}
                });
            });
        }

        // ----- INIT -----
        async function loadDrawingFromUrl(filename) {
            // Load a file previously uploaded via AI Takeoff (/uploads/...)
            try {
                const url = '/uploads/' + encodeURIComponent(filename);
                const resp = await fetch(url);
                if (!resp.ok) throw new Error('Could not load drawing from server (' + resp.status + ')');
                const blob = await resp.blob();
                const file = new File([blob], filename, {
                    type: blob.type || (/\.pdf$/i.test(filename) ? 'application/pdf' : 'image/png')
                });
                handleDrawingFile(file);
                const nameInput = document.getElementById('projectNameInput');
                if (nameInput && (!nameInput.value || nameInput.value === 'Untitled Project')) {
                    nameInput.value = filename.replace(/\.[^.]+$/, '');
                }
                console.log('📄 Auto-loaded drawing from AI Takeoff:', filename);
            } catch (err) {
                console.error(err);
                alert('Could not open the uploaded drawing in MeasureCraft: ' + err.message);
            }
        }


        // ----- Pro → Simple Mode transfer -----
        function idbPutTransfer(key, data) {
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
                            tx.objectStore('transfers').put(data, key);
                            tx.oncomplete = () => resolve(true);
                            tx.onerror = () => resolve(false);
                        } catch (_) { resolve(false); }
                    };
                    req.onerror = () => resolve(false);
                } catch (_) { resolve(false); }
            });
        }
        function idbGetTransfer(key, cb) {
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
                        const g = tx.objectStore('transfers').get(key);
                        g.onsuccess = () => cb(g.result || null);
                        g.onerror = () => cb(null);
                    } catch (_) { cb(null); }
                };
                req.onerror = () => cb(null);
            } catch (_) { cb(null); }
        }
        function idbDeleteTransfer(key) {
            if (!window.indexedDB) return;
            try {
                const req = indexedDB.open('measurecraft', 1);
                req.onsuccess = (ev) => {
                    try {
                        const db = ev.target.result;
                        if (!db.objectStoreNames.contains('transfers')) return;
                        const tx = db.transaction('transfers', 'readwrite');
                        tx.objectStore('transfers').delete(key);
                    } catch (_) {}
                };
            } catch (_) {}
        }
        function idbPutProToSimple(data) {
            return idbPutTransfer('pro-to-simple', data);
        }

        /** Full Pro element state so cutouts/polylines survive Simple round-trip */
        function buildProFullSnapshot() {
            return {
                version: 1,
                nextId: nextId,
                calibrationFactor: calibrationFactor,
                projectInfo: projectInfo ? JSON.parse(JSON.stringify(projectInfo)) : null,
                materialLibrary: materialLibrary ? JSON.parse(JSON.stringify(materialLibrary)) : null,
                projectOverrides: projectOverrides ? JSON.parse(JSON.stringify(projectOverrides)) : null,
                elements: (elements || []).map(function (el) {
                    return JSON.parse(JSON.stringify(el));
                }),
                background: backgroundImage ? {
                    w: backgroundImage.w,
                    h: backgroundImage.h,
                    opacity: backgroundImage.opacity,
                    visible: backgroundImage.visible,
                    // src may be large; prefer existing data URL if available
                    src: backgroundImage.src || null
                } : null
            };
        }

        function restoreProFullSnapshot(snap) {
            if (!snap || !Array.isArray(snap.elements)) return false;
            try {
                const normalized = normalizeElementIdentity(snap.elements, snap.nextId);
                elements = normalized.elements.map(function (el) {
                    // Ensure source/ai fields exist
                    if (!el.source) el.source = el.ai ? 'AI' : 'MANUAL';
                    return el;
                });
                nextId = normalized.nextId;
                if (typeof snap.calibrationFactor === 'number' && snap.calibrationFactor > 0) {
                    calibrationFactor = snap.calibrationFactor;
                    try { updateCalibDisplay(); } catch (_) {}
                }
                if (snap.projectInfo) {
                    projectInfo = snap.projectInfo;
                    try {
                        const ni = document.getElementById('projectNameInput');
                        if (ni && projectInfo.name) ni.value = projectInfo.name;
                        const chip = document.getElementById('clientChip');
                        if (chip) chip.textContent = 'Client: ' + (projectInfo.client || '—');
                    } catch (_) {}
                }
                if (snap.materialLibrary && typeof snap.materialLibrary === 'object') {
                    materialLibrary = Object.assign({}, materialLibrary, snap.materialLibrary);
                }
                if (snap.projectOverrides && typeof snap.projectOverrides === 'object') {
                    projectOverrides = Object.assign({}, projectOverrides, snap.projectOverrides);
                }
                selectedIds = [];
                window.mcAiFromSimple = false;
                markWorkSession();
                // Ensure polygon vertices survived clone
                let polyCount = 0;
                elements.forEach(function (el) {
                    if (el.vertices && el.vertices.length >= 3) polyCount++;
                });
                renderAll();
                try { fitViewportWhenReady(); } catch (_) { try { fitViewportToContent(); } catch (_) {} }
                console.log('✅ Restored full Pro snapshot:', elements.length, 'elements,', polyCount, 'polygons');
                return true;
            } catch (err) {
                console.error('restoreProFullSnapshot failed', err);
                return false;
            }
        }

        /**
         * Capture underlay for transfer.
         * opts: { quality (0-1), maxEdge, preferOriginal, format: 'image/jpeg'|'image/png' }
         * Prefer the original data URL when possible so PDF/plan quality does not degrade on mode switch.
         */
        function captureProUnderlayDataUrl(qualityOrOpts) {
            const opts = (qualityOrOpts != null && typeof qualityOrOpts === 'object')
                ? qualityOrOpts
                : { quality: qualityOrOpts };
            const quality = opts.quality != null ? opts.quality : 0.97;
            const maxEdge = opts.maxEdge != null ? opts.maxEdge : 6000;
            const preferOriginal = opts.preferOriginal !== false;
            const format = opts.format || 'image/jpeg';
            if (!backgroundImage || !backgroundImage.img) return null;
            try {
                const src = backgroundImage.src || '';
                // Always prefer the original data URL when available — no re-encode loss
                if (preferOriginal && typeof src === 'string' && src.indexOf('data:image') === 0) {
                    return src;
                }
                const img = backgroundImage.img;
                const w = Math.max(1, img.naturalWidth || backgroundImage.w || 1);
                const h = Math.max(1, img.naturalHeight || backgroundImage.h || 1);
                const scale = Math.min(1, maxEdge / Math.max(w, h));
                const cw = Math.max(1, Math.round(w * scale));
                const ch = Math.max(1, Math.round(h * scale));
                const off = document.createElement('canvas');
                off.width = cw;
                off.height = ch;
                const ctx = off.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, cw, ch);
                ctx.drawImage(img, 0, 0, cw, ch);
                // Prefer PNG for sharp line drawings when under ~8MP; else high-quality JPEG
                if (format === 'image/png' || (cw * ch <= 8e6 && quality >= 0.95)) {
                    try { return off.toDataURL('image/png'); } catch (_) {}
                }
                return off.toDataURL('image/jpeg', Math.max(0.92, quality));
            } catch (err) {
                console.warn('captureProUnderlayDataUrl failed', err);
                try { return backgroundImage.src || null; } catch (_) { return null; }
            }
        }

        function buildProToSimplePayload(imageDataUrl) {
            // World size = Pro drawing space (same as element x/y/w/h and calibrationFactor)
            const worldW = (backgroundImage && backgroundImage.w) ? backgroundImage.w
                : (backgroundImage && backgroundImage.img && backgroundImage.img.naturalWidth) || null;
            const worldH = (backgroundImage && backgroundImage.h) ? backgroundImage.h
                : (backgroundImage && backgroundImage.img && backgroundImage.img.naturalHeight) || null;

            const nameInput = document.getElementById('projectNameInput');
            const projectName = (nameInput && nameInput.value) || (projectInfo && projectInfo.name) || 'Untitled Project';

            // Export all non-hidden elements as Simple-style axis-aligned boxes
            const exportEls = (elements || []).filter(function (el) {
                if (!el || el.hidden) return false;
                // Skip pure cutouts/openings without size — Simple has limited deduction support
                return true;
            }).map(function (el) {
                let x = Number(el.x) || 0;
                let y = Number(el.y) || 0;
                let w = Number(el.w) || 0;
                let h = Number(el.h) || 0;
                // Preserve line walls/beams as endpoints instead of flattening
                // them into an axis-aligned box. Simple Mode can render this
                // rotated footprint and Pro Mode can reconstruct the line.
                const line = (el.isLine && el.p1 && el.p2) ? {
                    p1: { x: Number(el.p1.x) || 0, y: Number(el.p1.y) || 0 },
                    p2: { x: Number(el.p2.x) || 0, y: Number(el.p2.y) || 0 },
                    angle: Number(el.angle) || 0,
                    length: Number(el.length) || Math.hypot(el.p2.x - el.p1.x, el.p2.y - el.p1.y),
                    thickness: Number(el.thickness) || null,
                    thicknessDraw: Number(el.thicknessDraw) || null
                } : null;
                if (line) {
                    x = Math.min(line.p1.x, line.p2.x);
                    y = Math.min(line.p1.y, line.p2.y);
                    w = Math.abs(line.p2.x - line.p1.x) || w || 1;
                    h = Math.abs(line.p2.y - line.p1.y) || h || 1;
                    if (w < 2 && h > 2) w = Math.max(w, 4);
                    if (h < 2 && w > 2) h = Math.max(h, 4);
                }
                let type = String(el.type || 'wall').toLowerCase();
                if (type === 'floor') type = 'slab';
                // Keep cutout/opening/deduction as-is (do NOT map to window — that broke round-trip geometry)
                const heightM = (typeof el.zHeight === 'number' && el.zHeight > 0) ? el.zHeight : null;
                const parent = (el.parentId != null) ? elements.find(function (p) { return p.id === el.parentId; }) : null;
                const out = {
                    // IDs are internal identity; labels are display-only and may be duplicated or renamed.
                    id: el.id,
                    parentId: el.parentId != null ? el.parentId : null,
                    type: type,
                    label: el.label || (type.charAt(0).toUpperCase() + type.slice(1)),
                    material: el.material || null,
                    // wallType + thickness must travel for ALL walls (not only line walls)
                    // so Simple classifies masonry the same way as Pro.
                    wallType: el.wallType || null,
                    x: x, y: y, w: w, h: h,
                    height: heightM,
                    sillHeight: (typeof el.sillHeight === 'number') ? el.sillHeight : null,
                    soffitHeight: (typeof el.soffitHeight === 'number') ? el.soffitHeight : null,
                    isDeduction: !!(el.isDeduction || type === 'cutout' || type === 'opening' || type === 'deduction'),
                    parentLabel: parent ? parent.label : null,
                    parentType: parent ? parent.type : null,
                    vertices: el.vertices ? el.vertices.map(function (v) { return { x: v.x, y: v.y }; }) : null,
                    isLine: !!line,
                    p1: line ? line.p1 : null,
                    p2: line ? line.p2 : null,
                    angle: line ? line.angle : null,
                    length: line ? line.length : null,
                    thickness: (typeof el.thickness === 'number' && el.thickness > 0)
                        ? el.thickness
                        : (line && line.thickness) || null,
                    thicknessDraw: (typeof el.thicknessDraw === 'number' && el.thicknessDraw > 0)
                        ? el.thicknessDraw
                        : (line && line.thicknessDraw) || null,
                    accepted: true,
                    fromPro: true,
                    ai: isPureAiElement(el),
                    source: getElementSource(el)
                };
                return out;
            }).filter(function (e) {
                return e.w > 1 && e.h > 1 && isFinite(e.x + e.y + e.w + e.h);
            });

            // Shared rates map for Simple Mode (name -> cost number)
            const ratesMap = {};
            try {
                Object.keys(materialLibrary || {}).forEach(function (name) {
                    const mat = materialLibrary[name];
                    if (mat && mat.cost != null && mat.cost !== '' && !isNaN(Number(mat.cost))) {
                        ratesMap[name] = Number(mat.cost);
                    }
                });
            } catch (_) {}

            return {
                from: 'pro',
                fileName: (backgroundImage && backgroundImage.fileName) || projectName || 'plan-from-pro.jpg',
                imageDataUrl: imageDataUrl || null,
                imageW: worldW,
                imageH: worldH,
                scaleInfo: (typeof calibrationFactor === 'number' && calibrationFactor > 0) ? {
                    method: 'twopoint',
                    metersPerPixel: calibrationFactor,
                    pixelsPerUnit: 1 / calibrationFactor,
                    unit: 'm',
                    refPixelW: worldW,
                    refPixelH: worldH
                } : null,
                project: {
                    name: projectName,
                    client: (projectInfo && projectInfo.client) || '',
                    location: (projectInfo && projectInfo.location) || '',
                    currency: (projectInfo && projectInfo.currency) || 'LKR',
                    region: ''
                },
                materialLibrary: materialLibrary ? JSON.parse(JSON.stringify(materialLibrary)) : null,
                rates: ratesMap,
                elements: exportEls
            };
        }

        async function sendToSimpleMode() {
            // High-quality underlay for IDB (prefer original data URL — no extra JPEG loss)
            const fullDataUrl = captureProUnderlayDataUrl({
                quality: 0.97,
                maxEdge: 6000,
                preferOriginal: true
            });
            const fullPayload = buildProToSimplePayload(fullDataUrl);
            // Always persist the full geometry + calibration payload, even if the
            // image capture is unavailable or too large. Quantities and scale must
            // never depend on the PDF image fitting in sessionStorage.
            try { await idbPutProToSimple(fullPayload); } catch (err) {
                console.warn('IndexedDB pro-to-simple payload failed', err);
            }
            // Full geometry snapshot (cutouts, polygon slabs, polylines, parents) for return to Pro
            try {
                const snap = buildProFullSnapshot();
                // Keep original underlay src when present; only fill if missing
                if (snap.background) {
                    if (!snap.background.src || snap.background.src.indexOf('data:') !== 0) {
                        snap.background.src = fullDataUrl;
                    }
                }
                await idbPutTransfer('pro-full-snapshot', snap);
                // Also store image alone for reliable high-res restore
                if (fullDataUrl) {
                    try { await idbPutTransfer('pro-underlay-hq', { imageDataUrl: fullDataUrl, w: snap.background && snap.background.w, h: snap.background && snap.background.h }); } catch (_) {}
                }
                sessionStorage.setItem('mc-pro-full-snapshot-pending', '1');
                try {
                    // Light snapshot without image for sessionStorage backup (geometry only)
                    const light = JSON.parse(JSON.stringify(snap));
                    if (light.background) light.background.src = null;
                    sessionStorage.setItem('mc-pro-full-snapshot', JSON.stringify(light));
                } catch (_) {}
            } catch (err) {
                console.warn('pro full snapshot save failed', err);
            }
            try {
                // Small session handoff; the HQ underlay is stored separately.
                const smallPayload = buildProToSimplePayload(null);
                // Keep the browser-session handoff intentionally small. The HQ PDF
                // underlay is restored separately from IndexedDB by Simple Mode.
                sessionStorage.setItem('mc-pro-to-simple', JSON.stringify(smallPayload));
                try { localStorage.setItem('mc-pro-to-simple', JSON.stringify(smallPayload)); } catch (_) {}
            } catch (err) {
                // Last-resort retry with geometry/calibration only. This path is
                // deliberately tiny and therefore survives storage pressure.
                try {
                    const light = buildProToSimplePayload(null);
                    sessionStorage.setItem('mc-pro-to-simple', JSON.stringify(light));
                    try { localStorage.setItem('mc-pro-to-simple', JSON.stringify(light)); } catch (_) {}
                } catch (fallbackErr) {
                    console.warn('sessionStorage pro-to-simple failed', fallbackErr);
                }
            }
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
                alert((data && data.error) || 'Incorrect password.');
                return false;
            } catch (_) {
                if (pw === 'demo1234') return true;
                alert('Could not verify password (server offline).');
                return false;
            }
        }

        async function goToSimpleMode() {
            // Research security: Pro → Simple always requires password
            const allowed = await verifyModeSwitchPassword(
                'Switching from Pro Mode to Simple Mode is restricted for research data integrity.'
            );
            if (!allowed) return;

            const hasWork = !!(backgroundImage || (Array.isArray(elements) && elements.length > 0));
            if (hasWork) {
                try {
                    await sendToSimpleMode();
                    sessionStorage.setItem('mc-pro-to-simple-pending', '1');
                    try { localStorage.setItem('mc-pro-to-simple-pending', '1'); } catch (_) {}
                } catch (err) {
                    console.error(err);
                    alert('Could not prepare data for Simple Mode: ' + (err && err.message ? err.message : err));
                    return;
                }
            }
            leavingIntentionally = true;
            window.location.href = 'measurecraft_quantity_only.html';
        }

        function loadPlanTransferFromSimple() {
            let pending = false;
            try { pending = sessionStorage.getItem('mc-plan-transfer-pending') === '1' || localStorage.getItem('mc-plan-transfer-pending') === '1'; } catch (_) {}
            if (!pending) return false;

            let raw = null;
            try { raw = sessionStorage.getItem('mc-plan-transfer') || localStorage.getItem('mc-plan-transfer'); } catch (_) {}
            let data = null;
            if (raw) {
                try { data = JSON.parse(raw); } catch (_) { data = null; }
            }
            // Merge elements-only backup if main payload lost elements (quota / truncation)
            try {
                const elsRaw = sessionStorage.getItem('mc-plan-transfer-elements') || localStorage.getItem('mc-plan-transfer-elements');
                if (elsRaw) {
                    const elsData = JSON.parse(elsRaw);
                    if (!data) data = elsData;
                    else {
                        const mainN = (data.elements && data.elements.length) || 0;
                        const bakN = (elsData.elements && elsData.elements.length) || 0;
                        if (bakN > mainN) {
                            console.log('📥 Using elements-only backup:', bakN, 'vs session', mainN);
                            data.elements = elsData.elements;
                        }
                        if (!data.scaleInfo && elsData.scaleInfo) data.scaleInfo = elsData.scaleInfo;
                        if (!data.imageW && elsData.imageW) { data.imageW = elsData.imageW; data.imageH = elsData.imageH; }
                        if (!data.project && elsData.project) data.project = elsData.project;
                        if (!data.from && elsData.from) data.from = elsData.from;
                    }
                }
            } catch (_) {}
            if (data && (data.imageDataUrl || (Array.isArray(data.elements) && data.elements.length))) {
                applyPlanTransferData(data);
                try {
                    sessionStorage.removeItem('mc-plan-transfer-elements');
                    localStorage.removeItem('mc-plan-transfer-elements');
                } catch (_) {}
                try { updateCalibDisplay(); renderAll(); } catch (_) {}
                // Upgrade underlay from IndexedDB if a larger image is stored; also merge elements if session payload was truncated
                idbGetPlanTransfer(function (idbData) {
                    if (!idbData) {
                        idbClearPlanTransfer();
                        return;
                    }
                    if (idbData.imageDataUrl && (!data.imageDataUrl || (idbData.imageDataUrl.length > (data.imageDataUrl||'').length))) {
                        console.log('📥 Upgrading underlay from IndexedDB');
                        const upW = idbData.imageW || (idbData.scaleInfo && idbData.scaleInfo.refPixelW) || data.imageW;
                        const upH = idbData.imageH || (idbData.scaleInfo && idbData.scaleInfo.refPixelH) || data.imageH;
                        loadBackgroundFromSrc(idbData.imageDataUrl, {
                            w: upW || undefined,
                            h: upH || undefined,
                            opacity: 1.0,
                            visible: true,
                            skipResearch: true,
                        });
                    }
                    // Prefer IndexedDB when it has more (or equal and from Simple) elements —
                    // sessionStorage often truncates under quota and can drop AI detections.
                    const sessN = (data.elements && data.elements.length) || 0;
                    const idbN = (idbData.elements && idbData.elements.length) || 0;
                    const fromSimple = (idbData.from === 'simple') || (data.from === 'simple');
                    if (idbN > sessN || (fromSimple && idbN > 0 && idbN >= sessN && sessN === 0)) {
                        console.log('📥 Session had', sessN, 'elements; restoring', idbN, 'from IndexedDB');
                        elements = [];
                        nextId = 1;
                        selectedIds = [];
                        applyPlanTransferData(idbData);
                        try { updateCalibDisplay(); renderAll(); } catch (_) {}
                    } else if (fromSimple && idbN > sessN) {
                        console.log('📥 Restoring fuller Simple payload from IndexedDB', idbN);
                        elements = [];
                        nextId = 1;
                        selectedIds = [];
                        applyPlanTransferData(idbData);
                        try { updateCalibDisplay(); renderAll(); } catch (_) {}
                    }
                    idbClearPlanTransfer();
                });
                return true;
            }
            // Async fallback: IndexedDB only (still requires pending flag).
            // Return true so init does NOT clear the pending flag before the async apply runs.
            idbGetPlanTransfer(function (idbData) {
                try {
                    sessionStorage.removeItem('mc-plan-transfer-pending');
                    sessionStorage.removeItem('mc-plan-transfer');
                    localStorage.removeItem('mc-plan-transfer');
                } catch (_) {}
                if (!idbData) {
                    console.warn('📥 No IndexedDB transfer payload found');
                    return;
                }
                console.log('📥 Loading plan from IndexedDB…', (idbData.elements && idbData.elements.length) || 0, 'elements');
                applyPlanTransferData(idbData);
                idbClearPlanTransfer();
                setTimeout(function () {
                    try { const z = document.getElementById('btnZoomFit'); if (z) z.click(); } catch (_) {}
                    try { updateCalibDisplay(); renderAll(); } catch (_) {}
                }, 400);
            });
            return true;
        }

        function idbClearPlanTransfer() {
            if (!window.indexedDB) return;
            try {
                const req = indexedDB.open('measurecraft', 1);
                req.onsuccess = function (ev) {
                    try {
                        const db = ev.target.result;
                        if (!db.objectStoreNames.contains('transfers')) return;
                        const tx = db.transaction('transfers', 'readwrite');
                        tx.objectStore('transfers').delete('simple-to-pro');
                    } catch (_) {}
                };
            } catch (_) {}
        }

        function idbGetPlanTransfer(cb) {
            if (!window.indexedDB) { cb(null); return; }
            try {
                const req = indexedDB.open('measurecraft', 1);
                req.onupgradeneeded = function (ev) {
                    const db = ev.target.result;
                    if (!db.objectStoreNames.contains('transfers')) db.createObjectStore('transfers');
                };
                req.onsuccess = function (ev) {
                    try {
                        const db = ev.target.result;
                        if (!db.objectStoreNames.contains('transfers')) { cb(null); return; }
                        const tx = db.transaction('transfers', 'readonly');
                        const g = tx.objectStore('transfers').get('simple-to-pro');
                        g.onsuccess = function () { cb(g.result || null); };
                        g.onerror = function () { cb(null); };
                    } catch (e) { cb(null); }
                };
                req.onerror = function () { cb(null); };
            } catch (e) { cb(null); }
        }

        function applyPlanTransferData(data) {
            if (!data) return false;
            console.log('📥 Applying plan transfer…', data.fileName || '', data.imageW, data.imageH,
                (data.elements && data.elements.length) || 0, 'elements');

            // Research IDs from Simple → Pro: keep Drawing ID; Project may be PROJ-xxxx/A
            try {
                if (window.MCResearch && data.research && data.research.drawingId) {
                    const r = data.research;
                    const proj = {
                        projectId: r.projectId,
                        drawingId: r.drawingId,
                        parentProjectId: r.parentProjectId || null,
                        revision: r.revision || 'ORIGINAL',
                        mode: r.mode || 'Pro',
                    };
                    try {
                        sessionStorage.setItem('mc-research-project', JSON.stringify(proj));
                    } catch (_) {}
                    try { MCResearch.ensureMode('pro'); } catch (_) {}
                    console.log('Research IDs from Simple:', proj.drawingId, proj.projectId, proj.revision);
                } else if (window.MCResearch && data.from === 'simple') {
                    // Handoff without research block — still Pro mode; revision may already be set
                    try { MCResearch.ensureMode('pro'); } catch (_) {}
                }
            } catch (e) { console.warn('research transfer ids', e); }

            // World size MUST match Simple's plan-canvas pixel space (element x/y/w/h
            // and metersPerPixel). The transferred JPEG may be downscaled for storage;
            // stretch it to imageW×imageH so a 5 m calibration still reads 5 m.
            const worldW = (data.imageW && data.imageW > 0)
                ? data.imageW
                : (data.scaleInfo && data.scaleInfo.refPixelW) || undefined;
            const worldH = (data.imageH && data.imageH > 0)
                ? data.imageH
                : (data.scaleInfo && data.scaleInfo.refPixelH) || undefined;

            if (data.imageDataUrl) {
                loadBackgroundFromSrc(data.imageDataUrl, {
                    w: worldW,
                    h: worldH,
                    opacity: 1.0,
                    visible: true,
                    skipResearch: true, // keep same DWG/project as Simple (no DWG-0002)
                });
            } else {
                console.warn('Transfer has no image — underlay empty. Re-save from Simple Mode.');
            }

            if (data.scaleInfo) {
                const si = data.scaleInfo;
                // Prefer explicit metres-per-plan-pixel from Simple (same space as elements).
                if (typeof si.metersPerPixel === 'number' && si.metersPerPixel > 0) {
                    calibrationFactor = si.metersPerPixel;
                    updateCalibDisplay();
                    console.log('Scale from Simple → CF (metersPerPixel)', calibrationFactor);
                } else if (si.method === 'twopoint' && si.pixelsPerUnit > 0) {
                    const unit = (si.unit || 'm').toLowerCase();
                    let metersPerUnit = 1;
                    if (unit === 'ft' || unit === 'feet' || unit === 'foot') metersPerUnit = 0.3048;
                    else if (unit === 'in' || unit === 'inch' || unit === 'inches') metersPerUnit = 0.0254;
                    else if (unit === 'mm') metersPerUnit = 0.001;
                    else if (unit === 'cm') metersPerUnit = 0.01;
                    else if (unit === 'm' || unit === 'meter' || unit === 'metres' || unit === 'meters') metersPerUnit = 1;
                    // pixelsPerUnit = plan-canvas pixels per real unit → CF = m per drawing unit
                    calibrationFactor = metersPerUnit / si.pixelsPerUnit;
                    updateCalibDisplay();
                    console.log('Scale from Simple → CF (pixelsPerUnit)', calibrationFactor);
                }
            }

            // Shared material rates from Simple Mode (one source of truth)
            try {
                if (data.rates && typeof data.rates === 'object') {
                    Object.keys(data.rates).forEach(function (name) {
                        const cost = data.rates[name];
                        if (cost == null || cost === '' || isNaN(Number(cost))) return;
                        if (materialLibrary[name]) {
                            materialLibrary[name].cost = Number(cost);
                        } else {
                            materialLibrary[name] = { cost: Number(cost), unit: 'unit', color: '#94a3b8' };
                        }
                    });
                }
                if (data.materialLibrary && typeof data.materialLibrary === 'object') {
                    Object.keys(data.materialLibrary).forEach(function (name) {
                        const mat = data.materialLibrary[name];
                        if (!mat) return;
                        if (materialLibrary[name]) {
                            if (mat.cost != null && mat.cost !== '' && !isNaN(Number(mat.cost))) {
                                materialLibrary[name].cost = Number(mat.cost);
                            }
                            if (mat.unit) materialLibrary[name].unit = mat.unit;
                            if (mat.color) materialLibrary[name].color = mat.color;
                        } else {
                            materialLibrary[name] = {
                                cost: (mat.cost != null && !isNaN(Number(mat.cost))) ? Number(mat.cost) : null,
                                unit: mat.unit || 'unit',
                                color: mat.color || '#94a3b8'
                            };
                        }
                    });
                }
            } catch (rateErr) { console.warn('rate transfer apply failed', rateErr); }

            if (data.project || data.fileName) {
                try {
                    const p = data.project || {};
                    const nameFromFile = data.fileName ? String(data.fileName).replace(/\.[^.]+$/, '') : '';
                    const name = (p.name && p.name.trim()) ? p.name.trim() : (nameFromFile || projectInfo.name || 'Untitled Project');
                    projectInfo.name = name;
                    if (p.client) projectInfo.client = p.client;
                    if (p.location) projectInfo.location = p.location;
                    if (p.currency) projectInfo.currency = p.currency;
                    if (p.region) projectInfo.notes = (projectInfo.notes ? projectInfo.notes + '\n' : '') + 'Region: ' + p.region;
                    const nameInput = document.getElementById('projectNameInput');
                    if (nameInput) nameInput.value = projectInfo.name;
                    const chip = document.getElementById('clientChip');
                    if (chip) chip.textContent = 'Client: ' + (projectInfo.client || '—');
                    // Keep Project Info modal fields in sync if open later
                    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
                    setVal('infoProjectName', projectInfo.name);
                    setVal('infoClient', projectInfo.client);
                    setVal('infoLocation', projectInfo.location);
                    setVal('infoCurrency', projectInfo.currency);
                    console.log('📋 Project details from Simple:', projectInfo.name, projectInfo.client);
                } catch (err) { console.warn('Project transfer failed', err); }
            }

            const srcEls = Array.isArray(data.elements) ? data.elements : [];
            if (srcEls.length && typeof createElement === 'function') {
                const newEls = [];
                let skipped = 0;
                srcEls.forEach(function (item) {
                    try {
                        if (!item) { skipped++; return; }
                        const wx = Number(item.x), wy = Number(item.y);
                        const ww = Number(item.w) || 0, wh = Number(item.h) || 0;
                        if (!isFinite(wx) || !isFinite(wy)) { skipped++; return; }
                        // Allow thin AI boxes (e.g. walls) — only drop zero-size
                        if (!(ww > 0 || wh > 0) && !(item.isLine && item.p1 && item.p2)) { skipped++; return; }
                        // Preserve Simple/Pro transfer types exactly so quantities stay consistent.
                        // Only map a few aliases; never reclassify an explicit "wall" as slab/column.
                        let type = String(item.type || '').toLowerCase().trim();
                        if (type === 'room' || type === 'area' || type === 'floor') type = 'slab';
                        if (type === 'opening' || type === 'deduction') type = 'cutout';
                        const longSide = Math.max(ww, wh);
                        const shortSide = Math.max(1, Math.min(ww || 1, wh || 1));
                        if (!type) {
                            const aspect = longSide / shortSide;
                            if (aspect < 3.0 && longSide > 50) type = 'slab';
                            else if (longSide < 25) type = 'column';
                            else if (aspect < 2.0 && longSide > 30) type = 'slab';
                            else type = 'wall';
                        }
                        const label = item.label || (type.charAt(0).toUpperCase() + type.slice(1));
                        // CRITICAL: keep AI detections from Simple as AI (never force MANUAL)
                        let srcFlag = 'AI';
                        if (item.source === 'MANUAL' || item.source === 'AI_EDITED') srcFlag = item.source;
                        else if (item.source === 'AI') srcFlag = 'AI';
                        else if (item.fromPro && !item.ai) srcFlag = 'MANUAL';
                        else if (item.ai === true || item.source === 'AI') srcFlag = 'AI';
                        else if (item.source) srcFlag = String(item.source);
                        else srcFlag = (item.ai ? 'AI' : 'MANUAL');
                        const isAi = (srcFlag === 'AI' || srcFlag === 'AI_EDITED');
                        // Preserve explicit accepted flag; unreviewed AI stays accepted=false but still imported
                        const acceptedFlag = (item.accepted === true || item.accepted === false)
                            ? !!item.accepted
                            : (srcFlag === 'MANUAL' || srcFlag === 'AI_EDITED');
                        let reviewStatus = item.reviewStatus || null;
                        if (!reviewStatus) {
                            if (srcFlag === 'AI') reviewStatus = 'AI_GENERATED';
                            else if (srcFlag === 'AI_EDITED' || acceptedFlag) reviewStatus = 'QS_REVIEWED';
                            else reviewStatus = 'MANUAL';
                        }
                        const baseProps = {
                            ai: srcFlag === 'AI',
                            source: srcFlag === 'AI_EDITED' ? 'AI_EDITED' : (srcFlag === 'MANUAL' ? 'MANUAL' : 'AI'),
                            layer: (typeof AI_DETECT_LAYER !== 'undefined' && AI_DETECT_LAYER[type]) ? AI_DETECT_LAYER[type] : 'Structural',
                            label: label,
                            material: item.material || null,
                            isDeduction: !!(item.isDeduction || type === 'cutout'),
                            vertices: item.vertices || null,
                            confidence: (item.confidence != null && isFinite(Number(item.confidence))) ? Number(item.confidence) : null,
                            reviewStatus: reviewStatus,
                            reviewedAt: item.reviewedAt || null,
                            accepted: acceptedFlag
                        };
                        if (typeof item.sillHeight === 'number') baseProps.sillHeight = item.sillHeight;
                        if (typeof item.soffitHeight === 'number') baseProps.soffitHeight = item.soffitHeight;
                        let el;
                        if (type === 'cutout' || type === 'opening') {
                            el = createElement('cutout', wx, wy, Math.max(ww, 1), Math.max(wh, 1), baseProps);
                            if (typeof item.height === 'number' && item.height > 0) el.zHeight = item.height;
                            // Prefer the explicit source parent ID. Label matching remains only
                            // a compatibility fallback for legacy transfer files.
                            el._sourceTransferId = item.id != null ? item.id : null;
                            el._sourceParentTransferId = item.parentId != null ? item.parentId : null;
                            const parent = (item.parentId != null
                                ? newEls.find(function (p) { return sameElementId(p._sourceTransferId, item.parentId); })
                                : null)
                                || (item.parentLabel ? newEls.find(function (p) { return p.label === item.parentLabel; }) : null)
                                || (item.parentLabel ? elements.find(function (p) { return p.label === item.parentLabel; }) : null);
                            if (parent) {
                                el.parentId = parent.id;
                                if (!parent.cutouts) parent.cutouts = [];
                                if (parent.cutouts.indexOf(el.id) < 0) parent.cutouts.push(el.id);
                            }
                            el.accepted = acceptedFlag;
                            el.reviewStatus = reviewStatus;
                            el.source = baseProps.source;
                            el.ai = baseProps.ai;
                            newEls.push(el);
                            return;
                        }
                        if (type === 'wall' || type === 'beam') {
                            let p1, p2;
                            if (item.isLine && item.p1 && item.p2 &&
                                isFinite(Number(item.p1.x)) && isFinite(Number(item.p1.y)) &&
                                isFinite(Number(item.p2.x)) && isFinite(Number(item.p2.y))) {
                                p1 = { x: Number(item.p1.x), y: Number(item.p1.y) };
                                p2 = { x: Number(item.p2.x), y: Number(item.p2.y) };
                            } else if (ww >= wh) {
                                p1 = { x: wx, y: wy + wh / 2 };
                                p2 = { x: wx + ww, y: wy + wh / 2 };
                            } else {
                                p1 = { x: wx + ww / 2, y: wy };
                                p2 = { x: wx + ww / 2, y: wy + wh };
                            }
                            let thicknessM = Number(item.thickness);
                            // Accept only sensible standard range; never invent from pixels
                            if (!(thicknessM >= 0.08 && thicknessM <= 0.55)) {
                                thicknessM = type === 'beam' ? DEFAULT_BEAM_THICKNESS_M : DEFAULT_WALL_THICKNESS_M;
                            } else {
                                // Round to 1 mm to avoid long floats like 0.237785...
                                thicknessM = Math.round(thicknessM * 1000) / 1000;
                            }
                            const len = Number(item.length) > 0 ? Number(item.length) : Math.hypot(p2.x - p1.x, p2.y - p1.y);
                            let thkDraw = Number(item.thicknessDraw);
                            if (!(thkDraw > 0)) {
                                try { thkDraw = clampThicknessDraw(toDrawing(thicknessM)); }
                                catch (_) { thkDraw = Math.max(0.8, shortSide || 4); }
                            }
                            el = createElement(type, Math.min(p1.x, p2.x), Math.min(p1.y, p2.y),
                                Math.abs(p2.x - p1.x) || thkDraw, Math.abs(p2.y - p1.y) || thkDraw, {
                                    ...baseProps,
                                    isLine: true,
                                    p1: p1, p2: p2,
                                    length: len,
                                    thickness: thicknessM,
                                    thicknessDraw: thkDraw,
                                    angle: Number(item.angle) || Math.atan2(p2.y - p1.y, p2.x - p1.x)
                                });
                        } else {
                            el = createElement(type, wx, wy, Math.max(ww, 1), Math.max(wh, 1), baseProps);
                        }
                        if (typeof item.height === 'number' && item.height > 0) {
                            let hM = item.height;
                            if (item.heightUnit === 'ft' || item.heightUnit === 'feet') hM = item.height * 0.3048;
                            if (type === 'slab') {
                                // Reject storey-height values mis-applied as slab thickness
                                if (hM >= 0.08 && hM <= 0.40) el.zHeight = hM;
                            } else {
                                el.zHeight = hM;
                            }
                        }
                        if (typeof item.sillHeight === 'number' && item.sillHeight >= 0) el.sillHeight = item.sillHeight;
                        if (typeof item.soffitHeight === 'number' && item.soffitHeight >= 0) el.soffitHeight = item.soffitHeight;
                        if (type === 'window' && el.sillHeight == null) el.sillHeight = 0.9;
                        if (type === 'door' && el.sillHeight == null) el.sillHeight = 0;
                        // Preserve wall masonry type so Brick vs Block quantities match Simple
                        if (item.wallType) el.wallType = item.wallType;
                        if (item.material && !el.material) el.material = item.material;
                        if (typeof item.thickness === 'number' && item.thickness >= 0.08 && item.thickness <= 0.55) {
                            el.thickness = Math.round(item.thickness * 1000) / 1000;
                        }
                        // Preserve AI / review state from Simple — never drop AI detections
                        el.accepted = acceptedFlag;
                        el.reviewStatus = reviewStatus;
                        el.source = baseProps.source;
                        el.ai = baseProps.ai;
                        if (baseProps.confidence != null) el.confidence = baseProps.confidence;
                        // Carry the AI baseline quantity across the Simple → Pro transfer so the
                        // research dashboard's AI/Δ/Δ% columns keep working after import; compute
                        // one from scratch if this element never had it frozen in Simple Mode.
                        if (Number.isFinite(Number(item.aiQty))) {
                            el.aiQty = Number(item.aiQty);
                            el.aiUnit = item.aiUnit || el.aiUnit || null;
                        } else if (isAi) {
                            const snap = computeAiBaselineQty(el, calibrationFactor);
                            if (snap) { el.aiQty = snap.qty; el.aiUnit = snap.unit; }
                        }
                        el._sourceTransferId = item.id != null ? item.id : null;
                        el._sourceParentTransferId = item.parentId != null ? item.parentId : null;
                        newEls.push(el);
                    } catch (errItem) {
                        skipped++;
                        console.warn('Skip transfer element', item && item.label, errItem);
                    }
                });
                if (newEls.length) {
                    // Second pass handles transfers where a deduction precedes its target wall.
                    const sourceMap = new Map(newEls.filter(function (e) { return e._sourceTransferId != null; })
                        .map(function (e) { return [String(e._sourceTransferId), e]; }));
                    newEls.forEach(function (child) {
                        if (child._sourceParentTransferId == null) return;
                        const parent = sourceMap.get(String(child._sourceParentTransferId));
                        if (!parent || parent.type !== 'wall') return;
                        child.parentId = parent.id;
                        if (!Array.isArray(parent.cutouts)) parent.cutouts = [];
                        if (!parent.cutouts.some(function (id) { return sameElementId(id, child.id); })) parent.cutouts.push(child.id);
                    });
                    newEls.forEach(function (e) {
                        delete e._sourceTransferId;
                        delete e._sourceParentTransferId;
                    });
                    elements.push(...newEls);
                    selectedIds = [newEls[0].id];
                    window.mcAiFromSimple = !!(data.from !== 'pro');
                    markWorkSession();
                    console.log('✅ Imported', newEls.length, 'elements from Simple Mode' + (skipped ? ' (' + skipped + ' skipped)' : ''));
                    try {
                        if (typeof toast === 'function') {
                            toast('Loaded ' + newEls.length + ' element(s) from Simple Mode.', 'success');
                        }
                    } catch (_) {}
                    try { renderAll(); } catch (_) {}
                } else {
                    console.warn('Transfer had', srcEls.length, 'items but none could be created (skipped ' + skipped + ')');
                }
            } else if (Array.isArray(data.areas) && data.areas.length) {
                console.log('Simple areas available (no geometry):', data.areas.length);
            }

            renderAll();
            return true;
        }


        function init() {
            try {
                const s = sessionStorage.getItem('mc-session') || localStorage.getItem('mc-session');
                if (!s || !JSON.parse(s).email) { window.location.href = 'login.html'; return; }
            } catch(_) { window.location.href = 'login.html'; return; }
            console.log('🚀 Initializing Pro...');
            elements = [];
            nextId = 1;
            selectedIds = [];
            window.mcAiFromSimple = false;
            // Research: always tag this page as Pro so BOQ logs are not stored as Simple
            // (especially when arriving via Simple → Continue in Pro without mode-select).
            try {
                if (window.MCResearch) {
                    MCResearch.ensureMode('pro');
                    MCResearch.ensureParticipantChip('#status-bar') || MCResearch.ensureParticipantChip('body');
                }
            } catch (_) {}
            saveState();
            updateCalibDisplay();
            renderAll();
            setupCanvasInteraction();
            setupContextMenu();
            setupToolbar();
            setPreUploadControlsLocked(true);
            // The initial Elements panel state changes the viewer dimensions after the first render.
            // Redraw on the next frame so canvas geometry and selected handles are visible immediately.
            requestAnimationFrame(function () {
                try { renderAll(); positionArrowButtons(); } catch (_) {}
            });
            try { wireAiReviewModal(); } catch (_) {}
            setTimeout(() => document.getElementById('btnZoomFit').click(), 300);
            console.log('✅ Init complete.');

            // Only load a drawing when explicitly requested (?file=) or when coming from Simple Mode (pending flag).
            // Do NOT auto-load leftover transfer data when opening Pro fresh.
            try {
                const params = new URLSearchParams(window.location.search);
                const fileParam = params.get('file');
                let transferPending = false;
                let snapshotPending = false;
                try { transferPending = sessionStorage.getItem('mc-plan-transfer-pending') === '1' || localStorage.getItem('mc-plan-transfer-pending') === '1'; } catch (_) {}
                try { snapshotPending = sessionStorage.getItem('mc-pro-full-snapshot-pending') === '1'; } catch (_) {}
                if (fileParam) {
                    loadDrawingFromUrl(fileParam);
                } else if (snapshotPending) {
                    // Returning from Simple after Pro work — restore full geometry (cutouts, polylines, parents)
                    const finishSnap = function (snap) {
                        try { sessionStorage.removeItem('mc-pro-full-snapshot-pending'); } catch (_) {}
                        try { sessionStorage.removeItem('mc-pro-full-snapshot'); } catch (_) {}
                        idbDeleteTransfer('pro-full-snapshot');
                        if (snap && restoreProFullSnapshot(snap)) {
                            // Restore underlay ONLY — never call loadPlanTransferFromSimple() here
                            // (that re-imports Simple boxes and destroys polygon slabs / cutouts).
                            const applyBg = function (src, w, h, opacity) {
                                if (!src) return;
                                loadBackgroundFromSrc(src, {
                                    w: w || undefined,
                                    h: h || undefined,
                                    opacity: opacity != null ? opacity : 0.65,
                                    visible: true,
                                    skipResearch: true
                                });
                            };
                            if (snap.background && snap.background.src) {
                                applyBg(snap.background.src, snap.background.w, snap.background.h, snap.background.opacity);
                            } else {
                                // High-quality underlay stored separately
                                idbGetTransfer('pro-underlay-hq', function (hq) {
                                    if (hq && hq.imageDataUrl) {
                                        applyBg(hq.imageDataUrl, hq.w, hq.h, 0.65);
                                        return;
                                    }
                                    // Last resort: Simple transfer image only (not elements)
                                    try {
                                        const raw = sessionStorage.getItem('mc-plan-transfer') || localStorage.getItem('mc-plan-transfer') || sessionStorage.getItem('mc-pro-to-simple') || localStorage.getItem('mc-pro-to-simple');
                                        if (raw) {
                                            const d = JSON.parse(raw);
                                            if (d && d.imageDataUrl) {
                                                applyBg(d.imageDataUrl, d.imageW, d.imageH, 0.65);
                                            }
                                        }
                                    } catch (_) {}
                                });
                            }
                            try {
                                sessionStorage.removeItem('mc-plan-transfer-pending');
                                sessionStorage.removeItem('mc-plan-transfer');
                                localStorage.removeItem('mc-plan-transfer');
                            } catch (_) {}
                            idbClearPlanTransfer();
                            setTimeout(function () {
                                try { fitViewportWhenReady(); } catch (_) {
                                    try { document.getElementById('btnZoomFit').click(); } catch (_) {}
                                }
                            }, 400);
                            return;
                        }
                        // Snapshot missing/corrupt — fall back to simplified Simple transfer
                        if (transferPending && typeof loadPlanTransferFromSimple === 'function') {
                            loadPlanTransferFromSimple();
                        }
                    };
                    let light = null;
                    try {
                        const raw = sessionStorage.getItem('mc-pro-full-snapshot');
                        if (raw) light = JSON.parse(raw);
                    } catch (_) {}
                    idbGetTransfer('pro-full-snapshot', function (idbSnap) {
                        finishSnap(idbSnap || light);
                    });
                } else if (transferPending && typeof loadPlanTransferFromSimple === 'function' && loadPlanTransferFromSimple()) {
                    try {
                        sessionStorage.removeItem('mc-plan-transfer-pending');
                        localStorage.removeItem('mc-plan-transfer-pending');
                    } catch (_) {}
                    try {
                        sessionStorage.removeItem('mc-plan-transfer');
                        localStorage.removeItem('mc-plan-transfer');
                    } catch (_) {}
                    setTimeout(function () {
                        try {
                            const z = document.getElementById('btnZoomFit');
                            if (z) z.click();
                        } catch (_) {}
                    }, 500);
                } else {
                    // Clear stale transfer so Pro stays empty until user imports
                    try {
                        sessionStorage.removeItem('mc-plan-transfer-pending');
                        sessionStorage.removeItem('mc-plan-transfer');
                        localStorage.removeItem('mc-plan-transfer');
                        sessionStorage.removeItem('mc-pro-full-snapshot-pending');
                    } catch (_) {}
                }
            } catch (e) {
                console.warn('URL/transfer load failed', e);
            }
        }

        
        document.addEventListener('DOMContentLoaded', function() {
            // Update opacity value display
            const bgOpacity = document.getElementById('bgOpacity');
            const bgOpacityValue = document.getElementById('bgOpacityValue');
            if (bgOpacity && bgOpacityValue) {
                bgOpacity.addEventListener('input', function() {
                    bgOpacityValue.textContent = this.value + '%';
                });
            }
        });

        document.addEventListener('DOMContentLoaded', init);

        if (!CanvasRenderingContext2D.prototype.roundRect) {
            CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
                const r = typeof radii === 'number' ? radii : (radii || 0);
                this.moveTo(x + r, y);
                this.lineTo(x + w - r, y);
                this.quadraticCurveTo(x + w, y, x + w, y + r);
                this.lineTo(x + w, y + h - r);
                this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                this.lineTo(x + r, y + h);
                this.quadraticCurveTo(x, y + h, x, y + h - r);
                this.lineTo(x, y + r);
                this.quadraticCurveTo(x, y, x + r, y);
                return this;
            };
        }

        window.addEventListener('resize', () => {
            if (currentView === '3d') resizeThree();
            else renderCanvas2D();
        });

/* extracted script block */

(function(){const fab=document.getElementById('mcAiFab'),panel=document.getElementById('mcAiPanel'),body=document.getElementById('mcAiBody'),input=document.getElementById('mcAiInput');if(!fab||!panel)return;
            function openPanel(){panel.classList.add('open')}
            function closePanel(){panel.classList.remove('open')}
            fab.addEventListener('click',()=>{if(panel.classList.contains('open'))closePanel();else openPanel()});
            document.getElementById('mcAiClose').addEventListener('click',closePanel);
            let mcAiHistory=[];
            function offlineReply(q){const l=(q||'').toLowerCase();let r='Import a drawing, calibrate scale, then use tools to measure. Lock Zoom helps with trackpad.';if(l.includes('calibr'))r='Click Calibrate, pick two points on a known length, enter real metres.';else if(l.includes('zoom')||l.includes('lock')||l.includes('track'))r='Toolbar: Zoom In/Out/Fit + Lock Zoom. When locked, trackpad scroll will not zoom (Ctrl+scroll still works).';else if(l.includes('wall'))r='Select Wall, click points along the wall, press Enter to finish.';else if(l.includes('export')||l.includes('boq'))r='Use Export for Excel BOQ, marked plan, or project JSON.';else if(l.includes('ai'))r='AI Detect proposes elements from the plan image after calibration.';return r}
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
