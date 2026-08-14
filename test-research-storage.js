'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'measurecraft-research-'));
process.env.RESEARCH_DATA_DIR = root;
delete process.env.RESEARCH_STORAGE;
delete process.env.RESEARCH_S3_BUCKET;

const research = require('./research-store');
research.ensureDirs();
const session = research.startSession({ participantId: 'P01', mode: 'pro', userAgent: 'smoke-test' });
const image = Buffer.from('fake-image').toString('base64');
const project = research.registerProject({ participantId: 'P01', mode: 'pro', sessionId: session.sessionId, fileName: 'plan.jpg', mimeType: 'image/jpeg', imageBase64: image });
assert.ok(project.projectId && project.drawingId);
const record = research.logMeasurement({ participantId: 'P01', projectId: project.projectId, drawingId: project.drawingId, sessionId: session.sessionId, mode: 'pro', measurementType: 'wall', aiMeasurement: 10, userMeasurement: 12, unit: 'm' });
assert.strictEqual(record.userCorrection, true);
const annotation = research.saveReviewedAnnotations({ drawingId: project.drawingId, projectId: project.projectId, participantId: 'P01', mode: 'pro', imageWidth: 100, imageHeight: 100,   elements: [{ type: 'wall', x: 1, y: 2, w: 3, h: 4, source: 'AI_EDITED', reviewStatus: 'QS_REVIEWED' }],
  aiElements: [{ type: 'wall', x: 1, y: 2, w: 3, h: 4, source: 'AI', reviewStatus: 'AI_GENERATED' }] });
assert.strictEqual(annotation.elements.length, 1);
const marked = research.saveMarkedDrawing({ drawingId: project.drawingId, imageBase64: image, mimeType: 'image/jpeg', participantId: 'P01', mode: 'pro' });
assert.ok(research.getDrawingPath(project.drawingId));
assert.ok(research.getMarkedDrawingPath(project.drawingId));
assert.strictEqual(research.listReviewedAnnotations({ drawingId: project.drawingId }).length, 1);
const baseline = research.detectionAccuracy({ drawingId: project.drawingId });
const wallBaseline = baseline.byType.find((x) => x.type === 'wall');
assert.strictEqual(wallBaseline.precision, 100);
assert.strictEqual(wallBaseline.recall, 100);
assert.strictEqual(wallBaseline.quantityErrorPct, 20);
assert.strictEqual(research.storageStatus().enabled, false);
console.log(JSON.stringify({ ok: true, root, files: fs.readdirSync(path.join(root, 'research')), marked: marked.fileName }));
