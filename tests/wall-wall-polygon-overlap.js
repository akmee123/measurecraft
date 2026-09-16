/**
 * Regression tests for polygon-based wall–wall overlap length.
 *
 * These import public/js/modules/geometry.js directly — the same file the
 * browser loads — so a change to the shipped maths cannot pass here while
 * breaking the app.
 *
 * Run: node tests/wall-wall-polygon-overlap.js
 */
'use strict';

const G = require('../public/js/modules/geometry.js');
const { test, almostEqual, assert, done } = require('./_harness.js').createSuite(
  'wall-wall polygon overlap'
);

// cf = 1 → 1 drawing unit = 1 m, so the numbers below read as metres.
const OPTS = { calibrationFactor: 1, defaultThicknessM: 0.15 };

function makeLineWall(id, p1, p2, thickness) {
  return {
    id,
    type: 'wall',
    isLine: true,
    p1: { x: p1[0], y: p1[1] },
    p2: { x: p2[0], y: p2[1] },
    thickness: thickness != null ? thickness : 0.2
  };
}

function overlap(a, b) {
  return G.wallWallOverlapLengthDraw(a, b, OPTS);
}

// 1. Orthogonal T-junction, equal thickness
test('orthogonal T equal thickness → shared length ≈ thickness', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.2);
  const b = makeLineWall(2, [5, -5], [5, 5], 0.2);
  // Intersection of two 0.2-thick rectangles is ~0.2×0.2 → length 0.2
  almostEqual(overlap(a, b), 0.2, 0.02);
});

// 2. Orthogonal T, unequal thickness
test('orthogonal T unequal thickness → area / min thickness', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.1);
  const b = makeLineWall(2, [5, -5], [5, 5], 0.2);
  // area ≈ 0.1 × 0.2 = 0.02; / min(0.1, 0.2) = 0.2
  almostEqual(overlap(a, b), 0.2, 0.03);
});

// 3. Parallel collinear partial overlap
test('parallel collinear partial overlap → shared run length', () => {
  const a = makeLineWall(1, [0, 0], [7, 0], 0.2);
  const b = makeLineWall(2, [3, 0], [10, 0], 0.2);
  almostEqual(overlap(a, b), 4.0, 0.05);
});

// 4. Parallel but separated beyond thickness → zero
test('parallel walls separated beyond thickness → zero overlap', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.2);
  const b = makeLineWall(2, [0, 1], [10, 1], 0.2);
  almostEqual(overlap(a, b), 0, 1e-6);
});

// 5. No junction / far apart
test('non-intersecting walls → zero', () => {
  const a = makeLineWall(1, [0, 0], [5, 0], 0.2);
  const b = makeLineWall(2, [10, 10], [15, 10], 0.2);
  almostEqual(overlap(a, b), 0, 1e-6);
});

// 6. 45° angled junction still produces a positive finite length
test('45° angled junction → positive finite overlap', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.2);
  const b = makeLineWall(2, [5, 0], [5 + 5 * Math.SQRT1_2, 5 * Math.SQRT1_2], 0.2);
  const ol = overlap(a, b);
  assert.ok(ol > 0.05 && ol < 1.0, `expected reasonable angled overlap, got ${ol}`);
});

// 7. Same wall id → zero
test('same wall id → zero', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.2);
  almostEqual(overlap(a, a), 0);
});

// 8. Ownership: the shared junction is deducted from exactly one wall
test('ownership assigns full overlap to exactly one wall', () => {
  const walls = [
    makeLineWall(1, [0, 0], [10, 0], 0.2),
    makeLineWall(2, [5, -5], [5, 5], 0.2)
  ];
  const deduct = G.computeWallWallOverlapDeductions(walls, OPTS);
  assert.ok(deduct[2] > 0.1, 'later wall should receive the deduction');
  assert.strictEqual(deduct[1], undefined, 'earlier wall must not also be deducted');
});

// 9. Calibration factor is honoured (drawing units ≠ metres)
test('cf scaling: half-scale drawing gives half-scale overlap', () => {
  // cf = 0.5 → 1 drawing unit = 0.5 m, so a 0.2 m wall is 0.4 units thick.
  const a = makeLineWall(1, [0, 0], [20, 0], 0.2);
  const b = makeLineWall(2, [10, -10], [10, 10], 0.2);
  const ol = G.wallWallOverlapLengthDraw(a, b, { calibrationFactor: 0.5, defaultThicknessM: 0.15 });
  almostEqual(ol, 0.4, 0.04, 'overlap is returned in drawing units');
});

// 10. Walls with no usable footprint fall through to the caller's heuristic
test('missing footprint → caller fallback is used', () => {
  const a = { id: 1, type: 'wall' };
  const b = { id: 2, type: 'wall' };
  let called = false;
  const ol = G.wallWallOverlapLengthDraw(a, b, {
    calibrationFactor: 1,
    fallback: () => { called = true; return 1.25; }
  });
  assert.ok(called, 'fallback should be invoked');
  almostEqual(ol, 1.25);
});

// 11. Hidden walls are excluded from the deduction map
test('hidden walls are skipped', () => {
  const a = makeLineWall(1, [0, 0], [10, 0], 0.2);
  const b = makeLineWall(2, [5, -5], [5, 5], 0.2);
  b.hidden = true;
  const deduct = G.computeWallWallOverlapDeductions([a, b], OPTS);
  assert.deepStrictEqual(deduct, {});
});

done();
