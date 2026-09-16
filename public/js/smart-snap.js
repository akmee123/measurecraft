/**
 * MeasureCraft — Smart Snapping helpers (client-side)
 *
 * Include in takeoff pages:
 *   <script src="/js/smart-snap.js"></script>
 *
 * Usage:
 *   const snapped = MCSnap.snapPoint(x, y, {
 *     elements,
 *     tolerancePx: 12,          // pixels in screen/world space
 *     snapWallToWall: true,
 *     snapWallToColumn: true,
 *     snapOpeningToWall: true,
 *     snapEndpoint: true,
 *   });
 *   // snapped = { x, y, snapped: true, target: element|null, kind: 'endpoint'|'edge'|'column' }
 *
 * Also provides:
 *   MCSnap.snapWallEndpoints(wallA, wallB, tolerance)
 *   MCSnap.associateOpeningToWall(opening, walls, tolerance)
 */

(function (global) {
  'use strict';

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return { x: x1, y: y1, t: 0, d: dist(px, py, x1, y1) };
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const sx = x1 + t * dx;
    const sy = y1 + t * dy;
    return { x: sx, y: sy, t, d: dist(px, py, sx, sy) };
  }

  function elementEndpoints(el) {
    if (!el) return [];
    // Line-style walls/beams may store vertices or x1,y1,x2,y2
    if (Array.isArray(el.vertices) && el.vertices.length >= 2) {
      return el.vertices.map((v) => ({ x: v.x, y: v.y }));
    }
    if (el.x1 != null && el.y1 != null && el.x2 != null && el.y2 != null) {
      return [
        { x: el.x1, y: el.y1 },
        { x: el.x2, y: el.y2 },
      ];
    }
    // Axis-aligned box → four corners + midpoints of long sides for walls
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.w) || 0;
    const h = Number(el.h) || 0;
    const pts = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    if (el.type === 'wall' || el.type === 'beam') {
      if (w >= h) {
        pts.push({ x: x + w / 2, y }, { x: x + w / 2, y: y + h });
      } else {
        pts.push({ x, y: y + h / 2 }, { x: x + w, y: y + h / 2 });
      }
    }
    return pts;
  }

  function elementCenter(el) {
    if (el.cx != null && el.cy != null) return { x: el.cx, y: el.cy };
    return {
      x: (Number(el.x) || 0) + (Number(el.w) || 0) / 2,
      y: (Number(el.y) || 0) + (Number(el.h) || 0) / 2,
    };
  }

  /**
   * Snap a free point to nearby geometry.
   */
  function snapPoint(px, py, opts) {
    opts = opts || {};
    const elements = opts.elements || [];
    const tol = opts.tolerancePx != null ? opts.tolerancePx : 12;
    const snapEndpoint = opts.snapEndpoint !== false;
    const snapWallToWall = opts.snapWallToWall !== false;
    const snapWallToColumn = opts.snapWallToColumn !== false;
    const snapOpeningToWall = opts.snapOpeningToWall !== false;

    let best = { x: px, y: py, snapped: false, target: null, kind: null, distance: Infinity };

    for (const el of elements) {
      if (!el || el.hidden || el.accepted === false) continue;
      const type = String(el.type || '').toLowerCase();

      // Endpoints of walls / beams
      if (snapEndpoint && (type === 'wall' || type === 'beam')) {
        for (const p of elementEndpoints(el)) {
          const d = dist(px, py, p.x, p.y);
          if (d <= tol && d < best.distance) {
            best = { x: p.x, y: p.y, snapped: true, target: el, kind: 'endpoint', distance: d };
          }
        }
      }

      // Column centres
      if (snapWallToColumn && type === 'column') {
        const c = elementCenter(el);
        const d = dist(px, py, c.x, c.y);
        if (d <= tol && d < best.distance) {
          best = { x: c.x, y: c.y, snapped: true, target: el, kind: 'column', distance: d };
        }
      }

      // Project onto wall long edge (for openings or free points)
      if ((snapWallToWall || snapOpeningToWall) && type === 'wall') {
        const pts = elementEndpoints(el);
        if (pts.length >= 2) {
          // Approximate wall as line from first to last endpoint (or long axis)
          let x1 = pts[0].x, y1 = pts[0].y, x2 = pts[pts.length - 1].x, y2 = pts[pts.length - 1].y;
          if (el.w != null && el.h != null) {
            if (el.w >= el.h) {
              x1 = el.x; y1 = el.y + el.h / 2;
              x2 = el.x + el.w; y2 = el.y + el.h / 2;
            } else {
              x1 = el.x + el.w / 2; y1 = el.y;
              x2 = el.x + el.w / 2; y2 = el.y + el.h;
            }
          }
          const proj = pointToSegment(px, py, x1, y1, x2, y2);
          if (proj.d <= tol && proj.d < best.distance) {
            best = {
              x: proj.x,
              y: proj.y,
              snapped: true,
              target: el,
              kind: 'edge',
              distance: proj.d,
            };
          }
        }
      }
    }

    return best;
  }

  /**
   * Suggest connection between two wall endpoints.
   */
  function snapWallEndpoints(wallA, wallB, tolerance) {
    tolerance = tolerance != null ? tolerance : 15;
    const aPts = elementEndpoints(wallA);
    const bPts = elementEndpoints(wallB);
    let best = null;
    for (const a of aPts) {
      for (const b of bPts) {
        const d = dist(a.x, a.y, b.x, b.y);
        if (d <= tolerance && (!best || d < best.d)) {
          best = { a, b, d, wallA, wallB };
        }
      }
    }
    return best;
  }

  /**
   * Find the wall that best contains / is nearest to an opening (door/window).
   * Returns { wall, distance, projected } or null.
   */
  function associateOpeningToWall(opening, walls, tolerance) {
    tolerance = tolerance != null ? tolerance : 25;
    const c = elementCenter(opening);
    let best = null;
    for (const wall of walls || []) {
      if (!wall || wall.type !== 'wall') continue;
      let x1, y1, x2, y2;
      if (wall.w >= wall.h) {
        x1 = wall.x; y1 = wall.y + wall.h / 2;
        x2 = wall.x + wall.w; y2 = wall.y + wall.h / 2;
      } else {
        x1 = wall.x + wall.w / 2; y1 = wall.y;
        x2 = wall.x + wall.w / 2; y2 = wall.y + wall.h;
      }
      const proj = pointToSegment(c.x, c.y, x1, y1, x2, y2);
      if (proj.d <= tolerance && (!best || proj.d < best.distance)) {
        best = { wall, distance: proj.d, projected: { x: proj.x, y: proj.y } };
      }
    }
    return best;
  }

  /**
   * Apply automatic opening deduction bookkeeping:
   * returns { grossArea, openingsArea, netArea } in drawing units²
   * (caller multiplies by scale² for m²).
   */
  function wallNetArea(wall, openings) {
    const length = Math.max(wall.w || 0, wall.h || 0);
    const thickness = Math.min(wall.w || 0, wall.h || 0) || 1;
    // Prefer explicit length/thickness if stored
    const L = wall.length != null ? wall.length : length;
    const T = wall.thickness != null ? wall.thickness : thickness;
    const height = wall.height != null ? wall.height : 3.0; // metres — caller should pass real height
    // This helper works in pixel space for association; quantity code converts later.
    const gross = L * height;
    let openingsArea = 0;
    const assoc = [];
    for (const op of openings || []) {
      if (op.type !== 'door' && op.type !== 'window' && op.type !== 'opening') continue;
      const link = associateOpeningToWall(op, [wall], 40);
      if (!link) continue;
      const ow = Math.max(op.w || 0, op.h || 0);
      const oh = op.height != null ? op.height : op.type === 'door' ? 2.1 : 1.2;
      openingsArea += ow * oh; // still in mixed units — quantity layer converts
      assoc.push({ opening: op, wall, projected: link.projected });
    }
    return { gross, openingsArea, net: Math.max(0, gross - openingsArea), associations: assoc };
  }

  global.MCSnap = {
    snapPoint,
    snapWallEndpoints,
    associateOpeningToWall,
    wallNetArea,
    elementEndpoints,
    elementCenter,
    dist,
  };
})(typeof window !== 'undefined' ? window : global);
