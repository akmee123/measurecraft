#!/usr/bin/env node
/**
 * MeasureCraft — Export research annotations to YOLO training format
 *
 * Usage:
 *   node scripts/export-yolo.js [--out ./yolo-dataset] [--min-iou 0.5]
 *
 * Reads from data/research (or RESEARCH_DATA_DIR) and writes:
 *   <out>/
 *     images/          (copies or symlinks of reviewed drawings)
 *     labels/          (YOLO .txt files, one per image)
 *     data.yaml
 *     manifest.json    (full provenance for audit)
 *
 * Only includes drawings that have QS-reviewed / FINAL geometry.
 * Class map:
 *   0 wall, 1 door, 2 window, 3 column, 4 beam, 5 slab
 */

const fs = require('fs');
const path = require('path');

const CLASS_MAP = {
  wall: 0,
  door: 1,
  window: 2,
  column: 3,
  beam: 4,
  slab: 5,
};

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const OUT = path.resolve(arg('--out', './yolo-dataset'));
const DATA_ROOT = process.env.RESEARCH_DATA_DIR
  ? path.resolve(process.env.RESEARCH_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const RESEARCH_DIR = path.join(DATA_ROOT, 'research');
const DRAWINGS_DIR = path.join(DATA_ROOT, 'drawings');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function boxToYolo(box, imgW, imgH) {
  const x = Number(box.x) || 0;
  const y = Number(box.y) || 0;
  const w = Number(box.w) || 0;
  const h = Number(box.h) || 0;
  if (w <= 0 || h <= 0 || imgW <= 0 || imgH <= 0) return null;
  const xc = (x + w / 2) / imgW;
  const yc = (y + h / 2) / imgH;
  const nw = w / imgW;
  const nh = h / imgH;
  if (![xc, yc, nw, nh].every((v) => Number.isFinite(v) && v >= 0 && v <= 1.5)) return null;
  return [
    Math.max(0, Math.min(1, xc)),
    Math.max(0, Math.min(1, yc)),
    Math.max(0, Math.min(1, nw)),
    Math.max(0, Math.min(1, nh)),
  ];
}

function main() {
  console.log('MeasureCraft YOLO export');
  console.log('  Research dir:', RESEARCH_DIR);
  console.log('  Output:', OUT);

  ensureDir(path.join(OUT, 'images'));
  ensureDir(path.join(OUT, 'labels'));

  // Preferred sources: annotations (full geometry) then measurements
  const annotationFiles = fs.existsSync(path.join(RESEARCH_DIR, 'annotations'))
    ? fs.readdirSync(path.join(RESEARCH_DIR, 'annotations')).filter((f) => f.endsWith('.json'))
    : [];

  const measurements = loadJsonl(path.join(RESEARCH_DIR, 'measurements.jsonl'));
  const projects = loadJsonl(path.join(RESEARCH_DIR, 'projects.jsonl'));

  const byDrawing = new Map();

  // From annotation files (richest source)
  for (const file of annotationFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESEARCH_DIR, 'annotations', file), 'utf8'));
      const drawingId = data.drawingId || data.drawing_id || path.basename(file, '.json');
      const elements = (data.elements || data.reviewedElements || data.aiElements || []).filter(
        (e) =>
          e &&
          (e.reviewStatus === 'QS_REVIEWED' ||
            e.reviewStatus === 'FINAL' ||
            e.accepted === true ||
            e.source === 'MANUAL' ||
            e.source === 'AI_EDITED')
      );
      if (!elements.length) continue;
      byDrawing.set(drawingId, {
        drawingId,
        imageWidth: data.imageWidth || data.pixel_w || data.width,
        imageHeight: data.imageHeight || data.pixel_h || data.height,
        elements,
        source: 'annotation',
        file,
      });
    } catch (err) {
      console.warn('Skip annotation', file, err.message);
    }
  }

  // From measurements (fallback / supplement)
  for (const m of measurements) {
    if (!m || !m.drawingId) continue;
    if (byDrawing.has(m.drawingId)) continue;
    const status = (m.reviewStatus || m.status || '').toUpperCase();
    if (!['QS_REVIEWED', 'FINAL', 'ACCEPTED', 'MANUAL'].includes(status) && m.accepted !== true) {
      continue;
    }
    const list = byDrawing.get(m.drawingId) || {
      drawingId: m.drawingId,
      imageWidth: m.imageWidth,
      imageHeight: m.imageHeight,
      elements: [],
      source: 'measurement',
    };
    list.elements.push(m);
    byDrawing.set(m.drawingId, list);
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    classMap: CLASS_MAP,
    drawings: [],
    stats: { images: 0, labels: 0, boxes: 0, byClass: {} },
  };

  for (const [drawingId, rec] of byDrawing) {
    const imgW = Number(rec.imageWidth) || 0;
    const imgH = Number(rec.imageHeight) || 0;
    if (!imgW || !imgH) {
      console.warn('Skip', drawingId, '— missing image dimensions');
      continue;
    }

    const lines = [];
    for (const el of rec.elements) {
      const type = String(el.type || '').toLowerCase().trim();
      if (!(type in CLASS_MAP)) continue;
      const yolo = boxToYolo(el, imgW, imgH);
      if (!yolo) continue;
      lines.push(`${CLASS_MAP[type]} ${yolo.map((v) => v.toFixed(6)).join(' ')}`);
      manifest.stats.byClass[type] = (manifest.stats.byClass[type] || 0) + 1;
      manifest.stats.boxes += 1;
    }
    if (!lines.length) continue;

    // Label file
    const labelName = `${drawingId}.txt`;
    fs.writeFileSync(path.join(OUT, 'labels', labelName), lines.join('\n') + '\n');
    manifest.stats.labels += 1;

    // Try to copy drawing if present
    let imageCopied = false;
    const candidates = [
      path.join(DRAWINGS_DIR, `${drawingId}.jpg`),
      path.join(DRAWINGS_DIR, `${drawingId}.jpeg`),
      path.join(DRAWINGS_DIR, `${drawingId}.png`),
      path.join(DRAWINGS_DIR, `${drawingId}.webp`),
    ];
    for (const src of candidates) {
      if (fs.existsSync(src)) {
        const ext = path.extname(src);
        const dest = path.join(OUT, 'images', `${drawingId}${ext}`);
        fs.copyFileSync(src, dest);
        imageCopied = true;
        break;
      }
    }

    manifest.drawings.push({
      drawingId,
      boxes: lines.length,
      imageWidth: imgW,
      imageHeight: imgH,
      imageCopied,
      source: rec.source,
    });
    manifest.stats.images += 1;
  }

  // data.yaml
  const yaml = `path: ${OUT}
train: images
val: images
nc: 6
names: ['wall', 'door', 'window', 'column', 'beam', 'slab']
`;
  fs.writeFileSync(path.join(OUT, 'data.yaml'), yaml);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log('\nExport complete');
  console.log('  Images (with labels):', manifest.stats.images);
  console.log('  Total boxes:', manifest.stats.boxes);
  console.log('  By class:', manifest.stats.byClass);
  console.log('  data.yaml + manifest.json written');
  if (manifest.stats.images === 0) {
    console.log('\nNo reviewed drawings found yet.');
    console.log('Use the research dashboard to accept/correct AI detections, then re-run this script.');
  }
}

main();
