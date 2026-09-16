/**
 * Tests for measurement provenance.
 *
 * reviewStatus answers "did a QS sign this off?". Provenance answers "where did
 * this number come from, and how far has it moved since?" — origin method,
 * actor, edit count, and a frozen as-created geometry snapshot.
 *
 * Run: node tests/provenance.js
 */
'use strict';

const P = require('../public/js/modules/provenance.js');
const { test, almostEqual, assert, done } = require('./_harness.js').createSuite(
  'measurement provenance'
);

function aiWall(overrides) {
  return Object.assign({
    id: 1,
    type: 'wall',
    source: 'AI',
    reviewStatus: 'AI_GENERATED',
    confidence: 0.82,
    isLine: true,
    p1: { x: 0, y: 0 },
    p2: { x: 10, y: 0 },
    thickness: 0.2,
    zHeight: 3
  }, overrides || {});
}

test('method is inferred from source when not given', () => {
  assert.strictEqual(P.methodFromSource('AI', {}), P.METHOD.AI_DETECT);
  assert.strictEqual(P.methodFromSource('AGENT', {}), P.METHOD.AI_AGENT);
  assert.strictEqual(P.methodFromSource('MANUAL', {}), P.METHOD.MANUAL_DRAW);
  assert.strictEqual(P.methodFromSource('IMPORT', {}), P.METHOD.IMPORT);
});

test('an AI-edited element keeps its AI origin', () => {
  // The QS corrected it, but it was still born from a detection.
  assert.strictEqual(P.methodFromSource('AI_EDITED', {}), P.METHOD.AI_DETECT);
});

test('an explicit method on the element wins over the source flag', () => {
  assert.strictEqual(P.methodFromSource('MANUAL', { method: 'import' }), 'import');
});

test('create() captures origin, actor, role and confidence', () => {
  const el = aiWall();
  const p = P.create(el, { model: 'gemini-2.0' });
  assert.strictEqual(p.method, P.METHOD.AI_DETECT);
  assert.strictEqual(p.role, P.ROLE.AI);
  assert.strictEqual(p.actor, 'gemini-2.0');
  almostEqual(p.confidence, 0.82);
  assert.strictEqual(p.editCount, 0);
  assert.ok(p.createdAt, 'createdAt is stamped');
});

test('the as-created geometry is snapshotted', () => {
  const el = aiWall();
  const p = P.create(el);
  assert.strictEqual(p.geometrySnapshot.thickness, 0.2);
  assert.deepStrictEqual(p.geometrySnapshot.p2, { x: 10, y: 0 });
  assert.strictEqual(p.snapshotAtEdit, false);
});

test('the snapshot is a copy, not a live reference', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  el.p2.x = 99;
  el.thickness = 0.4;
  assert.strictEqual(el.provenance.geometrySnapshot.p2.x, 10,
    'editing the element must not rewrite history');
  assert.strictEqual(el.provenance.geometrySnapshot.thickness, 0.2);
});

test('recordEdit counts edits and stamps the editor', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  P.recordEdit(el, { actor: 'qs' });
  P.recordEdit(el, { actor: 'qs' });
  assert.strictEqual(el.provenance.editCount, 2);
  assert.strictEqual(el.provenance.lastEditedBy, 'qs');
  assert.ok(el.provenance.lastEditedAt, 'lastEditedAt is stamped');
});

test('later edits never overwrite the frozen snapshot', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  el.p2.x = 12;           // QS stretches the wall
  P.recordEdit(el, { actor: 'qs' });
  el.p2.x = 14;           // and again
  P.recordEdit(el, { actor: 'qs' });
  assert.strictEqual(el.provenance.geometrySnapshot.p2.x, 10,
    'the AI proposal must stay comparable after any number of edits');
});

test('a legacy element snapshotted at edit time is flagged as such', () => {
  const el = aiWall();             // no provenance yet — e.g. loaded from an old file
  P.recordEdit(el, { actor: 'qs' });
  assert.strictEqual(el.provenance.snapshotAtEdit, true,
    'audits must not treat a post-edit snapshot as the original');
});

test('an explicit geometryBefore is trusted as the original', () => {
  const el = aiWall();
  const before = P.snapshotGeometry(el);
  el.thickness = 0.3;
  P.recordEdit(el, { actor: 'qs', geometryBefore: before });
  assert.strictEqual(el.provenance.geometrySnapshot.thickness, 0.2);
  assert.strictEqual(el.provenance.snapshotAtEdit, false);
});

test('recordReview stamps sign-off without touching the snapshot', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  P.recordReview(el, { actor: 'vihanga' });
  assert.strictEqual(el.provenance.reviewedBy, 'vihanga');
  assert.ok(el.provenance.reviewedAt);
  assert.strictEqual(el.provenance.editCount, 0, 'review is not an edit');
});

test('wasCorrectedByHuman distinguishes untouched AI from corrected AI', () => {
  const untouched = aiWall();
  untouched.provenance = P.create(untouched);
  assert.strictEqual(P.wasCorrectedByHuman(untouched), false);

  const corrected = aiWall();
  corrected.provenance = P.create(corrected);
  P.recordEdit(corrected, { actor: 'qs' });
  assert.strictEqual(P.wasCorrectedByHuman(corrected), true);

  const manual = aiWall({ source: 'MANUAL' });
  manual.provenance = P.create(manual);
  P.recordEdit(manual, { actor: 'qs' });
  assert.strictEqual(P.wasCorrectedByHuman(manual), false,
    'a QS editing their own line is not an AI correction');
});

test('history is recorded but bounded', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  for (let i = 0; i < 40; i++) P.recordEdit(el, { actor: 'qs', reason: 'edit ' + i });
  assert.ok(el.provenance.history.length <= 20, 'history must not grow without bound');
  assert.strictEqual(el.provenance.history[0].reason, 'edit 0',
    'the first correction is always kept');
  assert.strictEqual(el.provenance.editCount, 40, 'the count stays exact');
});

test('normalize() repairs provenance on projects saved before this change', () => {
  const el = aiWall({ provenance: undefined });
  const p = P.normalize(el);
  assert.strictEqual(p.method, P.METHOD.AI_DETECT);
  assert.strictEqual(p.editCount, 0);
  assert.strictEqual(p.schema, P.SCHEMA);
});

test('normalize() preserves an existing record', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  P.recordEdit(el, { actor: 'qs' });
  const p = P.normalize(el);
  assert.strictEqual(p.editCount, 1);
  assert.strictEqual(p.geometrySnapshot.p2.x, 10);
});

test('summarize() gives a flat row for export / research events', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  P.recordEdit(el, { actor: 'qs' });
  const s = P.summarize(el);
  assert.strictEqual(s.method, P.METHOD.AI_DETECT);
  assert.strictEqual(s.editCount, 1);
  assert.strictEqual(s.corrected, true);
  assert.strictEqual(s.hasSnapshot, true);
});

test('describe() reads sensibly in the inspector', () => {
  const el = aiWall();
  el.provenance = P.create(el);
  assert.strictEqual(P.describe(el), 'AI detected');
  P.recordEdit(el, { actor: 'qs' });
  assert.strictEqual(P.describe(el), 'AI detected · 1 edit');
  P.recordEdit(el, { actor: 'qs' });
  assert.strictEqual(P.describe(el), 'AI detected · 2 edits');
});

test('ensure() is idempotent', () => {
  const el = aiWall();
  const first = P.ensure(el);
  const second = P.ensure(el);
  assert.strictEqual(first, second, 'must not silently reset an existing record');
});

done();
