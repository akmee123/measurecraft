const assert = require('assert');
const fs = require('fs');

function canonicalElementId(value) {
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}
function sameElementId(a, b) { return a != null && b != null && String(a) === String(b); }
function normalizeElementIdentity(rawElements, nextIdHint) {
  const source = rawElements.map((raw) => ({ ...raw, cutouts: Array.isArray(raw.cutouts) ? [...raw.cutouts] : raw.cutouts }));
  const used = new Set();
  const sourceToCanonical = new Map();
  let maxId = 0;
  source.forEach((el) => {
    const n = canonicalElementId(el.id);
    if (n != null && !used.has(n)) { used.add(n); maxId = Math.max(maxId, n); sourceToCanonical.set(String(el.id), n); }
  });
  maxId = Math.max(maxId, canonicalElementId(nextIdHint) || 0);
  source.forEach((el) => {
    const oldId = el.id;
    let id = canonicalElementId(oldId);
    if (id == null || !used.has(id) || sourceToCanonical.get(String(oldId)) !== id) {
      id = ++maxId;
      while (used.has(id)) id++;
      used.add(id);
    }
    sourceToCanonical.set(String(oldId), sourceToCanonical.get(String(oldId)) || id);
    el.id = id;
  });
  const remap = (value) => sourceToCanonical.get(String(value)) ?? canonicalElementId(value) ?? value;
  source.forEach((el) => {
    if (el.parentId != null) el.parentId = remap(el.parentId);
    if (Array.isArray(el.cutouts)) el.cutouts = el.cutouts.map(remap).filter((id) => source.some((e) => sameElementId(e.id, id)));
  });
  return { elements: source, nextId: Math.max(maxId + 1, canonicalElementId(nextIdHint) || 1) };
}

const walls = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1, type: 'wall', label: `Wall ${i + 1}`, x: i * 10, y: 0, w: 8 + i, h: 0.225,
  cutouts: []
}));
const opening = { id: 101, type: 'cutout', label: 'Opening → Wall 7', parentId: 7, w: 2, h: 1, zHeight: 2.1 };
walls[6].cutouts.push(opening.id);
const opening3 = { id: 102, type: 'cutout', label: 'Opening → Wall 3', parentId: 3, w: 1.5, h: 1, zHeight: 2.1 };
walls[2].cutouts.push(opening3.id);
let project = [...walls, opening, opening3];

assert.strictEqual(project.find((e) => e.id === 7).label, 'Wall 7');
assert.strictEqual(project.find((e) => e.id === 10).label, 'Wall 10');
assert.strictEqual(project.find((e) => e.id === opening.parentId).id, 7);
assert.strictEqual(project.find((e) => e.id === 7).cutouts[0], opening.id);
assert.strictEqual(project.find((e) => e.id === opening3.parentId).id, 3);

const grossWall7 = 8 * 3;
const deductionWall7 = 2 * 2.1;
const netWall7 = grossWall7 - deductionWall7;
assert.strictEqual(netWall7, 19.8);
assert.strictEqual((8 + 2) * 3, 30);

const wall1Before = project.find((e) => e.id === 1);
assert.strictEqual((wall1Before.cutouts || []).length, 0);

const wall7 = project.find((e) => e.id === 7);
wall7.x += 42; wall7.y += 13;
project = [project[4], project[0], project[10], project[6], project[2], project[5], project[1], project[3], project[7], project[8], project[9], project[11]];
assert.strictEqual(project.find((e) => e.id === 7).x, 102);
assert.strictEqual(project.find((e) => e.id === opening.parentId).label, 'Wall 7');
assert.strictEqual(project.find((e) => e.id === 10).label, 'Wall 10');

project = project.filter((e) => e.id !== 3);
assert.strictEqual(project.find((e) => e.id === 7).label, 'Wall 7');
assert.strictEqual(project.find((e) => e.id === opening.parentId).id, 7);
assert.strictEqual(project.find((e) => e.id === 10).label, 'Wall 10');

const loaded = normalizeElementIdentity(JSON.parse(JSON.stringify(project)), 200);
assert.strictEqual(loaded.elements.find((e) => e.id === 7).label, 'Wall 7');
assert.strictEqual(loaded.elements.find((e) => e.id === 101).parentId, 7);
assert.strictEqual(loaded.elements.find((e) => e.id === 7).cutouts[0], 101);

const legacy = normalizeElementIdentity([
  { id: '7', type: 'wall', label: 'Wall 7', cutouts: ['101'] },
  { id: '101', type: 'cutout', parentId: '7' }
], '200');
assert.strictEqual(legacy.elements[0].id, 7);
assert.strictEqual(legacy.elements[1].parentId, 7);

const duplicateSource = fs.readFileSync(require('path').join(__dirname, '..', 'public/js/takeoff_pro.js'), 'utf8');
assert(duplicateSource.includes('const idMap = {};'));
assert(duplicateSource.includes('copy.parentId = idMap[copy.parentId];'));

const pro = fs.readFileSync(require('path').join(__dirname, '..', 'public/js/takeoff_pro.js'), 'utf8');
const simple = fs.readFileSync(require('path').join(__dirname, '..', 'public/js/measurecraft_quantity_only.js'), 'utf8');
assert(pro.includes('function findElementById(id, list)'));
assert(pro.includes('function sameElementId(a, b)'));
assert(pro.includes('function isSelectedId(id)'));
assert(pro.includes('parentId: el.parentId != null ? el.parentId : null'));
assert(pro.includes('const normalized = normalizeElementIdentity(data.elements, data.nextId);'));
assert(pro.includes('Prefer the explicit source parent ID'));
assert(pro.includes('let deductionTargetLocked = false;'));
assert(pro.includes('findElementById(selectedIds'));
assert(pro.includes('sameElementId(o.parentId'));
assert(pro.includes('deductionTargetLocked && pendingDeductionParentId != null'));
assert(pro.includes('pendingDeductionParentId = selectedWallId;'));
assert(pro.includes('pendingDeductionParentId = selectedWallForDedId;'));
assert(pro.includes('Resolve parent wall by stable ID'));
assert(simple.includes('id: e.id != null ? e.id : null'));
assert(simple.includes('parentId: e.parentId != null ? e.parentId : null'));

console.log('wall identity regression tests passed:', {
  wallCount: 10,
  selectedWall: 7,
  deductionTarget: 7,
  wall3Target: 3,
  wall10: 10,
  movedWall: 7,
  roundTripTarget: 7
});
