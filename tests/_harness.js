/**
 * Minimal test harness shared by the MeasureCraft Node tests.
 * No dependencies — `npm run check` must work on a clean clone.
 */
'use strict';

const assert = require('assert');

function createSuite(title) {
  let passed = 0;
  let failed = 0;
  console.log(title);

  function test(name, fn) {
    try {
      fn();
      console.log('  \u2713', name);
      passed++;
    } catch (err) {
      console.error('  \u2717', name);
      console.error('   ', err.message);
      failed++;
      process.exitCode = 1;
    }
  }

  function almostEqual(actual, expected, tol, msg) {
    tol = tol != null ? tol : 1e-6;
    assert.ok(
      Math.abs(actual - expected) <= tol,
      (msg || '') + ` expected ${expected}, got ${actual}`
    );
  }

  function done() {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    if (failed) {
      console.error('SOME TESTS FAILED');
      process.exit(1);
    }
  }

  return { test, almostEqual, assert, done };
}

module.exports = { createSuite };
