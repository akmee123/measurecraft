/**
 * Guards the reason the geometry module exists: the shipped app and the tests
 * must run the SAME code. Before this, tests/wall-wall-polygon-overlap.js
 * carried its own copy of the geometry with a "keep in sync" comment — which
 * meant an edit to takeoff_pro.js could break the app while the suite stayed
 * green. These checks make that failure mode loud.
 *
 * Run: node tests/module-wiring.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test, assert, done } = require('./_harness.js').createSuite('module wiring');

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const app = read('public/js/takeoff_pro.js');
const html = read('public/takeoff_pro.html');

test('geometry module exports every helper the app delegates to', () => {
  const G = require('../public/js/modules/geometry.js');
  [
    'polygonArea', 'polygonPerimeter', 'polygonBounds', 'polygonCentroid',
    'pointInPolygon', 'polygonIntersection', 'polygonIntersectionArea',
    'getWallFootprintVertices', 'getElementPlanVertices',
    'wallWallOverlapLengthDraw', 'computeWallWallOverlapDeductions',
    'clipHolesToParent', 'netAreaWithHoles', 'netPerimeterWithHoles',
    'areaWithCutouts'
  ].forEach(fn => {
    assert.strictEqual(typeof G[fn], 'function', `MCGeometry.${fn} is missing`);
  });
});

test('takeoff_pro delegates the geometry helpers to MCGeometry', () => {
  [
    'G.polygonArea(', 'G.polygonIntersectionArea(', 'G.getWallFootprintVertices(',
    'G.wallWallOverlapLengthDraw(', 'G.areaWithCutouts('
  ].forEach(call => {
    assert.ok(app.includes(call), `takeoff_pro.js no longer calls ${call}`);
  });
});

test('takeoff_pro uses MCProvenance on create, edit and review', () => {
  ['MCProvenance', 'P.create(', 'P.recordEdit(', 'P.recordReview('].forEach(token => {
    assert.ok(app.includes(token), `takeoff_pro.js no longer references ${token}`);
  });
});

test('the Pro page loads both modules before takeoff_pro.js', () => {
  const geomAt = html.indexOf('js/modules/geometry.js');
  const provAt = html.indexOf('js/modules/provenance.js');
  const appAt = html.indexOf('js/takeoff_pro.js');
  assert.ok(geomAt > -1, 'geometry.js is not loaded by takeoff_pro.html');
  assert.ok(provAt > -1, 'provenance.js is not loaded by takeoff_pro.html');
  assert.ok(geomAt < appAt && provAt < appAt, 'modules must load before the app');
});

test('no test re-implements the shared geometry', () => {
  fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.js') && f !== 'module-wiring.js')
    .forEach(f => {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      assert.ok(
        !/function\s+polygonIntersectionArea\s*\(/.test(src),
        `${f} defines its own polygonIntersectionArea — require the module instead`
      );
      assert.ok(
        !/function\s+getWallFootprintVertices\s*\(/.test(src),
        `${f} defines its own getWallFootprintVertices — require the module instead`
      );
    });
});

done();

const DI = require('../core/drawing-intelligence');
assert(DI && typeof DI.analyze === 'function' && typeof DI.createAgentPlan === 'function');
