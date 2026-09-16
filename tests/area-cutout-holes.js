/**
 * Regression tests for real hole cutouts on area elements.
 *
 * The old behaviour subtracted each opening's full drawn area from the slab.
 * That over-deducts whenever an opening hangs over the slab edge or two
 * openings overlap. These tests pin the hole-based behaviour instead.
 *
 * Run: node tests/area-cutout-holes.js
 */
'use strict';

const G = require('../public/js/modules/geometry.js');
const { test, almostEqual, assert, done } = require('./_harness.js').createSuite(
  'area cutouts as real holes'
);

function rect(x, y, w, h) {
  return [
    { x: x, y: y },
    { x: x + w, y: y },
    { x: x + w, y: y + h },
    { x: x, y: y + h }
  ];
}

const SLAB = rect(0, 0, 10, 10);   // 100 m² at cf = 1

test('no holes → net area equals gross', () => {
  almostEqual(G.netAreaWithHoles(SLAB, []), 100);
  almostEqual(G.netPerimeterWithHoles(SLAB, []), 40);
});

test('hole fully inside → area deducted once', () => {
  const hole = rect(2, 2, 2, 2); // 4 m²
  almostEqual(G.netAreaWithHoles(SLAB, [hole]), 96);
});

test('hole fully inside → its boundary adds to measured perimeter', () => {
  const hole = rect(2, 2, 2, 2); // 8 m of void boundary
  almostEqual(G.netPerimeterWithHoles(SLAB, [hole]), 48);
});

test('hole hanging over the edge deducts only the part on the slab', () => {
  // 4×4 opening centred on the left edge: only half (8 m²) is on the slab.
  const hole = rect(-2, 3, 4, 4);
  almostEqual(G.netAreaWithHoles(SLAB, [hole]), 92, 1e-6,
    'old arithmetic subtraction would have removed the full 16 m²');
});

test('edge notch swaps the covered edge span for the notch sides', () => {
  // Notch 2 wide × 3 deep cut into the left edge.
  const hole = rect(-1, 3, 3, 2); // on-slab part is 2 wide × 2 deep
  const p = G.netPerimeterWithHoles(SLAB, [hole]);
  // 40 − 2 (covered left-edge span) + 2 + 2 + 2 (notch sides) = 44
  almostEqual(p, 44, 1e-6);
});

test('hole entirely off the slab deducts nothing', () => {
  const hole = rect(20, 20, 4, 4);
  almostEqual(G.netAreaWithHoles(SLAB, [hole]), 100);
  assert.strictEqual(G.clipHolesToParent(SLAB, [hole]).length, 0);
});

test('overlapping openings do not deduct the shared region twice', () => {
  const a = rect(2, 2, 4, 4);   // 16 m²
  const b = rect(4, 4, 4, 4);   // 16 m², shares a 2×2 = 4 m² corner
  // Naive sum would remove 32; the union is 28.
  almostEqual(G.netAreaWithHoles(SLAB, [a, b]), 72);
});

test('identical duplicate openings deduct once', () => {
  const a = rect(2, 2, 3, 3);
  almostEqual(G.netAreaWithHoles(SLAB, [a, JSON.parse(JSON.stringify(a))]), 91);
});

test('holes covering the whole slab clamp to zero, never negative', () => {
  const big = rect(-5, -5, 30, 30);
  almostEqual(G.netAreaWithHoles(SLAB, [big]), 0);
});

test('areaWithCutouts reports gross, net, cut and clipped rings together', () => {
  const hole = rect(-2, 3, 4, 4);
  const r = G.areaWithCutouts(SLAB, [hole]);
  almostEqual(r.grossArea, 100);
  almostEqual(r.netArea, 92);
  almostEqual(r.cutArea, 8);
  almostEqual(r.outerPerimeter, 40);
  assert.strictEqual(r.holes.length, 1, 'clipped hole ring is returned for rendering/audit');
});

test('non-rectangular (triangular) opening is clipped exactly', () => {
  // Right triangle with legs 4 and 4 → 8 m², fully inside.
  const tri = [{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 1, y: 5 }];
  almostEqual(G.netAreaWithHoles(SLAB, [tri]), 92);
});

test('slab polygon need not be a rectangle', () => {
  // L-shaped slab: 10×10 with a 4×4 bite out of the top-right.
  const L = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 },
    { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 }
  ];
  almostEqual(G.polygonArea(L), 84);
  const hole = rect(1, 1, 2, 2);
  almostEqual(G.netAreaWithHoles(L, [hole]), 80);
});

test('opening straddling a concave corner clips exactly', () => {
  // Same L-shaped slab; the opening spans the re-entrant corner, so only the
  // part over solid slab may be deducted.
  const L = [
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 },
    { x: 6, y: 6 }, { x: 6, y: 10 }, { x: 0, y: 10 }
  ];
  const hole = rect(5, 5, 2, 2); // 4 m² drawn, but 1 m² of it is over the bite
  almostEqual(G.netAreaWithHoles(L, [hole]), 84 - 3, 1e-6);
});

done();
