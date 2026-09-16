/**
 * MeasureCraft — pure plan geometry (no DOM, no globals, no build step).
 *
 * This is the single source of truth for takeoff plan maths. `takeoff_pro.js`
 * delegates to it and `tests/*.js` require it directly, so the tested code and
 * the shipped code can no longer drift apart.
 *
 * Coordinates are "drawing units" (the canvas/world units of a sheet).
 * `calibrationFactor` (cf) converts drawing units → metres: metres = draw * cf.
 * Physical member sizes (wall thickness etc.) are stored in metres, so a
 * thickness in drawing units is `thicknessM / cf`.
 *
 * Accuracy notes / known limits (deliberate, documented):
 *  - Polygon clipping is Sutherland–Hodgman, which is exact when the *clip*
 *    polygon is convex. Hole clipping therefore passes the opening as the clip
 *    polygon and the slab as the subject, so an L-shaped or otherwise concave
 *    slab is still measured exactly — openings are the convex side in practice.
 *    A concave clip polygon degrades gracefully (over-clips) rather than
 *    throwing.
 *  - Overlapping holes are resolved by pairwise inclusion–exclusion, exact for
 *    two-at-a-time overlaps (the realistic drawing case) and slightly
 *    conservative if three holes share one region.
 *
 * Usage:
 *   Browser  <script src="js/modules/geometry.js"></script> → window.MCGeometry
 *   Node     const G = require('../public/js/modules/geometry.js');
 */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.MCGeometry = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var EPS = 1e-9;
    var DEFAULT_WALL_THICKNESS_M = 0.15;

    // -----------------------------------------------------------------------
    // Basic polygon measures
    // -----------------------------------------------------------------------

    /** Twice the signed area. > 0 = counter-clockwise in a y-down canvas. */
    function polygonSignedArea(pts) {
        if (!pts || pts.length < 3) return 0;
        var a = 0;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i], q = pts[(i + 1) % pts.length];
            a += p.x * q.y - q.x * p.y;
        }
        return a / 2;
    }

    function polygonArea(pts) {
        return Math.abs(polygonSignedArea(pts));
    }

    function polygonPerimeter(pts) {
        if (!pts || pts.length < 2) return 0;
        var total = 0;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i], q = pts[(i + 1) % pts.length];
            total += Math.hypot(q.x - p.x, q.y - p.y);
        }
        return total;
    }

    function polygonBounds(pts) {
        if (!pts || pts.length === 0) return null;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < pts.length; i++) {
            var p = pts[i];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    /** Vertex-average centroid (matches historic MeasureCraft behaviour). */
    function polygonCentroid(pts) {
        if (!pts || pts.length === 0) return { x: 0, y: 0 };
        var cx = 0, cy = 0;
        for (var i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
        return { x: cx / pts.length, y: cy / pts.length };
    }

    /** Ray-cast point-in-polygon. Absolute (world) coordinates. */
    function pointInPolygon(px, py, pts) {
        if (!pts || pts.length < 3) return false;
        var inside = false;
        for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            var xi = pts[i].x, yi = pts[i].y;
            var xj = pts[j].x, yj = pts[j].y;
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    /** Shortest distance from a point to a segment. */
    function distancePointToSegment(px, py, a, b) {
        var dx = b.x - a.x, dy = b.y - a.y;
        var len2 = dx * dx + dy * dy;
        if (len2 < 1e-18) return Math.hypot(px - a.x, py - a.y);
        var t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    /** True if the point lies on (within tol of) the polygon boundary. */
    function pointOnPolygonBoundary(px, py, pts, tol) {
        if (!pts || pts.length < 2) return false;
        tol = tol != null ? tol : 1e-6;
        for (var i = 0; i < pts.length; i++) {
            var a = pts[i], b = pts[(i + 1) % pts.length];
            if (distancePointToSegment(px, py, a, b) <= tol) return true;
        }
        return false;
    }

    // -----------------------------------------------------------------------
    // Clipping / intersection
    // -----------------------------------------------------------------------

    /**
     * Sutherland–Hodgman: the part of `subject` inside `clip`.
     * Returns a ring (>= 3 points) or [] when there is no overlap.
     */
    function polygonIntersection(subject, clipPts) {
        if (!subject || !clipPts || subject.length < 3 || clipPts.length < 3) return [];
        var output = subject.slice();
        // Normalise clip winding so "inside" is consistent.
        var clip = polygonSignedArea(clipPts) >= 0 ? clipPts : clipPts.slice().reverse();

        function inside(p, a, b) {
            return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPS;
        }
        function intersect(s, e, a, b) {
            var dx1 = e.x - s.x, dy1 = e.y - s.y;
            var dx2 = b.x - a.x, dy2 = b.y - a.y;
            var den = dx1 * dy2 - dy1 * dx2;
            if (Math.abs(den) < 1e-12) return { x: e.x, y: e.y };
            var t = ((a.x - s.x) * dy2 - (a.y - s.y) * dx2) / den;
            return { x: s.x + t * dx1, y: s.y + t * dy1 };
        }

        for (var i = 0; i < clip.length; i++) {
            if (!output.length) break;
            var a = clip[i], b = clip[(i + 1) % clip.length];
            var input = output;
            output = [];
            var s = input[input.length - 1];
            for (var k = 0; k < input.length; k++) {
                var e = input[k];
                var ein = inside(e, a, b), sin = inside(s, a, b);
                if (ein) {
                    if (!sin) output.push(intersect(s, e, a, b));
                    output.push(e);
                } else if (sin) {
                    output.push(intersect(s, e, a, b));
                }
                s = e;
            }
        }
        return output.length >= 3 ? output : [];
    }

    function polygonIntersectionArea(aPts, bPts) {
        var ring = polygonIntersection(aPts, bPts);
        return ring.length >= 3 ? polygonArea(ring) : 0;
    }

    // -----------------------------------------------------------------------
    // Element → plan polygon
    // -----------------------------------------------------------------------

    /** Absolute plan vertices for a polygon element (vertices are element-relative). */
    function getAbsolutePlanVertices(el) {
        if (!el || !Array.isArray(el.vertices) || el.vertices.length < 3) return null;
        var ox = Number(el.x) || 0, oy = Number(el.y) || 0;
        return el.vertices.map(function (v) {
            return { x: ox + (Number(v.x) || 0), y: oy + (Number(v.y) || 0) };
        });
    }

    /**
     * Thickened footprint of a wall/beam.
     * Line members are swept by their *physical* thickness (never the visual
     * stroke width, which is clamped for legibility and would inflate areas).
     */
    function getWallFootprintVertices(wall, opts) {
        if (!wall) return null;
        opts = opts || {};
        var cf = (typeof opts.calibrationFactor === 'number' && opts.calibrationFactor > 0)
            ? opts.calibrationFactor : 1;
        var defThk = (typeof opts.defaultThicknessM === 'number' && opts.defaultThicknessM > 0)
            ? opts.defaultThicknessM : DEFAULT_WALL_THICKNESS_M;

        if (wall.isLine && wall.p1 && wall.p2) {
            var thkM = (typeof wall.thickness === 'number' && wall.thickness > 0) ? wall.thickness : defThk;
            var t = Math.max(0.001, thkM / cf) / 2;
            var dx = wall.p2.x - wall.p1.x, dy = wall.p2.y - wall.p1.y;
            var len = Math.hypot(dx, dy) || 1;
            var nx = -dy / len, ny = dx / len;
            return [
                { x: wall.p1.x + nx * t, y: wall.p1.y + ny * t },
                { x: wall.p2.x + nx * t, y: wall.p2.y + ny * t },
                { x: wall.p2.x - nx * t, y: wall.p2.y - ny * t },
                { x: wall.p1.x - nx * t, y: wall.p1.y - ny * t }
            ];
        }
        if (wall.x != null && wall.y != null && wall.w != null && wall.h != null) {
            return [
                { x: wall.x, y: wall.y },
                { x: wall.x + wall.w, y: wall.y },
                { x: wall.x + wall.w, y: wall.y + wall.h },
                { x: wall.x, y: wall.y + wall.h }
            ];
        }
        return null;
    }

    /** Polygon vertices if present, otherwise the thickened/box footprint. */
    function getElementPlanVertices(el, opts) {
        return getAbsolutePlanVertices(el) || getWallFootprintVertices(el, opts);
    }

    // -----------------------------------------------------------------------
    // Wall–wall junction overlap
    // -----------------------------------------------------------------------

    /**
     * Shared run length (drawing units) implied by a footprint intersection.
     * area / min(thickness) recovers the thickness of a square T-junction and
     * the shared run for parallel collinear walls.
     */
    function overlapLengthFromFootprints(ptsA, ptsB, thkADraw, thkBDraw) {
        var area = polygonIntersectionArea(ptsA, ptsB);
        if (area <= EPS) return 0;
        var ta = Math.max(thkADraw, 1e-6);
        var tb = Math.max(thkBDraw, 1e-6);
        return area / Math.min(ta, tb);
    }

    /**
     * Polygon wall–wall overlap length in drawing units.
     * `opts.fallback(a, b)` is called only when a footprint cannot be built
     * (legacy elements); `takeoff_pro.js` passes its centreline heuristic there.
     */
    function wallWallOverlapLengthDraw(a, b, opts) {
        if (!a || !b || a.id === b.id) return 0;
        opts = opts || {};
        var cf = (typeof opts.calibrationFactor === 'number' && opts.calibrationFactor > 0)
            ? opts.calibrationFactor : 1;
        var defThk = (typeof opts.defaultThicknessM === 'number' && opts.defaultThicknessM > 0)
            ? opts.defaultThicknessM : DEFAULT_WALL_THICKNESS_M;

        var ptsA = getWallFootprintVertices(a, { calibrationFactor: cf, defaultThicknessM: defThk });
        var ptsB = getWallFootprintVertices(b, { calibrationFactor: cf, defaultThicknessM: defThk });
        if (ptsA && ptsB && ptsA.length >= 3 && ptsB.length >= 3) {
            var thkAM = (typeof a.thickness === 'number' && a.thickness > 0) ? a.thickness : defThk;
            var thkBM = (typeof b.thickness === 'number' && b.thickness > 0) ? b.thickness : defThk;
            return overlapLengthFromFootprints(ptsA, ptsB, thkAM / cf, thkBM / cf);
        }
        return typeof opts.fallback === 'function' ? (opts.fallback(a, b) || 0) : 0;
    }

    /**
     * wallId → overlap length owned by that wall. Each shared junction is
     * assigned to exactly one wall so the union is counted once.
     */
    function computeWallWallOverlapDeductions(walls, opts) {
        var deduct = {};
        var list = walls || [];
        for (var i = 0; i < list.length; i++) {
            for (var j = i + 1; j < list.length; j++) {
                var a = list[i], b = list[j];
                if (!a || !b || a.hidden || b.hidden) continue;
                var ol = wallWallOverlapLengthDraw(a, b, opts);
                if (ol <= 1e-6) continue;
                deduct[b.id] = (deduct[b.id] || 0) + ol;
            }
        }
        return deduct;
    }

    // -----------------------------------------------------------------------
    // Real hole cutouts (OpenTakeoff-style holes on the parent ring)
    // -----------------------------------------------------------------------

    /**
     * Clip candidate hole rings to a parent ring and drop the ones that miss.
     * The returned rings are the parts of each opening that actually sit on the
     * parent — an opening hanging half off a slab edge now deducts only the
     * half that is really there, instead of its full drawn area.
     *
     * @returns {Array<Array<{x,y}>>} clipped hole rings, largest first
     */
    function clipHolesToParent(outer, holeRings, opts) {
        if (!outer || outer.length < 3 || !holeRings || !holeRings.length) return [];
        var minArea = (opts && typeof opts.minArea === 'number') ? opts.minArea : 1e-9;
        var out = [];
        for (var i = 0; i < holeRings.length; i++) {
            var ring = holeRings[i];
            if (!ring || ring.length < 3) continue;
            // Clip the parent *by the opening*, not the other way round:
            // openings are convex in practice, parent slabs often are not
            // (L-shaped rooms), and Sutherland-Hodgman is exact only when the
            // clip polygon is convex.
            var clipped = polygonIntersection(outer, ring);
            if (clipped.length >= 3 && polygonArea(clipped) > minArea) out.push(clipped);
        }
        out.sort(function (p, q) { return polygonArea(q) - polygonArea(p); });
        return out;
    }

    /**
     * Net plan area of `outer` with `holes` removed.
     * Holes are clipped to the parent first, then pairwise inclusion–exclusion
     * prevents two overlapping openings deducting the same region twice.
     */
    function netAreaWithHoles(outer, holes, opts) {
        if (!outer || outer.length < 3) return 0;
        var gross = polygonArea(outer);
        var rings = (opts && opts.preClipped) ? (holes || []) : clipHolesToParent(outer, holes, opts);
        if (!rings.length) return gross;

        var deduct = 0;
        for (var i = 0; i < rings.length; i++) deduct += polygonArea(rings[i]);
        // Add back doubly-counted overlaps between openings.
        for (var a = 0; a < rings.length; a++) {
            for (var b = a + 1; b < rings.length; b++) {
                deduct -= polygonIntersectionArea(rings[a], rings[b]);
            }
        }
        return Math.max(0, gross - Math.max(0, deduct));
    }

    /**
     * Net measured boundary length of `outer` once `holes` are cut.
     *
     *  - A hole fully inside the parent adds its whole boundary (a void you
     *    still have to form and finish).
     *  - A hole breaking the edge is a notch: the covered span of the parent
     *    edge is removed and the notch's interior sides are added.
     */
    function netPerimeterWithHoles(outer, holes, opts) {
        if (!outer || outer.length < 3) return 0;
        var tol = (opts && typeof opts.tolerance === 'number') ? opts.tolerance : 1e-6;
        var total = polygonPerimeter(outer);
        var rings = (opts && opts.preClipped) ? (holes || []) : clipHolesToParent(outer, holes, opts);

        for (var i = 0; i < rings.length; i++) {
            var ring = rings[i];
            for (var k = 0; k < ring.length; k++) {
                var p = ring[k], q = ring[(k + 1) % ring.length];
                var len = Math.hypot(q.x - p.x, q.y - p.y);
                if (len <= tol) continue;
                var mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                var onOuter = pointOnPolygonBoundary(mid.x, mid.y, outer, tol);
                if (onOuter) total -= len;   // notch mouth: parent edge is gone
                else total += len;           // real cut face
            }
        }
        return Math.max(0, total);
    }

    /**
     * One call for the whole cutout picture of an area element.
     * Areas/lengths are returned in drawing units; multiply by cf (and cf²)
     * for metres.
     */
    function areaWithCutouts(outer, holeRings, opts) {
        var rings = clipHolesToParent(outer, holeRings, opts);
        var o = Object.assign({}, opts || {}, { preClipped: true });
        var gross = polygonArea(outer);
        var net = netAreaWithHoles(outer, rings, o);
        return {
            grossArea: gross,
            netArea: net,
            cutArea: Math.max(0, gross - net),
            perimeter: netPerimeterWithHoles(outer, rings, o),
            outerPerimeter: polygonPerimeter(outer),
            holes: rings
        };
    }

    return {
        EPS: EPS,
        DEFAULT_WALL_THICKNESS_M: DEFAULT_WALL_THICKNESS_M,
        // measures
        polygonArea: polygonArea,
        polygonSignedArea: polygonSignedArea,
        polygonPerimeter: polygonPerimeter,
        polygonBounds: polygonBounds,
        polygonCentroid: polygonCentroid,
        pointInPolygon: pointInPolygon,
        pointOnPolygonBoundary: pointOnPolygonBoundary,
        distancePointToSegment: distancePointToSegment,
        // clipping
        polygonIntersection: polygonIntersection,
        polygonIntersectionArea: polygonIntersectionArea,
        // elements
        getAbsolutePlanVertices: getAbsolutePlanVertices,
        getWallFootprintVertices: getWallFootprintVertices,
        getElementPlanVertices: getElementPlanVertices,
        // walls
        overlapLengthFromFootprints: overlapLengthFromFootprints,
        wallWallOverlapLengthDraw: wallWallOverlapLengthDraw,
        computeWallWallOverlapDeductions: computeWallWallOverlapDeductions,
        // holes
        clipHolesToParent: clipHolesToParent,
        netAreaWithHoles: netAreaWithHoles,
        netPerimeterWithHoles: netPerimeterWithHoles,
        areaWithCutouts: areaWithCutouts
    };
}));
