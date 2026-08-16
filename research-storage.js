'use strict';

const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

let dataRoot = null;
let hydrated = false;
let hydrating = null; // in-flight hydration promise, so concurrent callers share it
let warned = false;
let cachedClient = null;
let cachedClientKey = null;

// Per-file write queue so rapid successive writes to the same JSONL/JSON file
// are mirrored to S3 in order, instead of racing and possibly landing out of
// order (each mirror is a whole-object PUT, so out-of-order PUTs would mean
// a newer local write gets clobbered by an older upload finishing late).
const fileQueues = new Map();

function enabled() {
  return String(process.env.RESEARCH_STORAGE || '').trim().toLowerCase() === 's3'
    || !!String(process.env.RESEARCH_S3_BUCKET || process.env.S3_BUCKET || '').trim();
}

function config() {
  const bucket = String(process.env.RESEARCH_S3_BUCKET || process.env.S3_BUCKET || '').trim();
  const region = String(process.env.RESEARCH_S3_REGION || process.env.AWS_REGION || 'auto').trim();
  const endpoint = String(process.env.RESEARCH_S3_ENDPOINT || process.env.S3_ENDPOINT || '').trim();
  const prefix = String(process.env.RESEARCH_S3_PREFIX || 'measurecraft-research').trim().replace(/^\/+|\/+$/g, '');
  if (!bucket) throw new Error('RESEARCH_S3_BUCKET or S3_BUCKET is required when S3 research storage is enabled');
  return { bucket, region, endpoint, prefix };
}

function configure(root) {
  dataRoot = root;
}

function getClient(cfg) {
  const key = cfg.region + '|' + cfg.endpoint;
  if (cachedClient && cachedClientKey === key) return cachedClient;
  cachedClient = new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: String(process.env.RESEARCH_S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
    credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        sessionToken: process.env.AWS_SESSION_TOKEN,
      }
      : undefined,
  });
  cachedClientKey = key;
  return cachedClient;
}

function keyFor(prefix, relativePath) {
  return prefix ? prefix + '/' + relativePath : relativePath;
}

async function bodyToBuffer(body) {
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Downloads every object under the configured prefix and writes it into the
// local data root. Runs once at process startup (see server.js), awaited
// before the app starts accepting traffic, so it never blocks a request.
async function hydrateFromS3() {
  if (hydrated || !enabled()) return;
  if (hydrating) return hydrating; // another caller already hydrating; share it
  if (!dataRoot) throw new Error('S3 storage is not configured with a data root');

  hydrating = (async () => {
    const cfg = config();
    const client = getClient(cfg);
    let continuationToken;
    do {
      const page = await client.send(new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: cfg.prefix ? cfg.prefix + '/' : undefined,
        ContinuationToken: continuationToken,
      }));
      for (const object of page.Contents || []) {
        if (!object.Key) continue;
        const prefix = cfg.prefix ? cfg.prefix + '/' : '';
        const relativePath = object.Key.startsWith(prefix) ? object.Key.slice(prefix.length) : object.Key;
        const target = path.join(dataRoot, relativePath);
        if (!target.startsWith(path.resolve(dataRoot) + path.sep)) continue;
        const response = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: object.Key }));
        const body = await bodyToBuffer(response.Body);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  })().catch((err) => {
    if (!warned) {
      console.warn('[research] S3 hydration failed; using local cache:', err.message);
      warned = true;
    }
  }).finally(() => {
    hydrated = true;
    hydrating = null;
  });

  return hydrating;
}

// Mirrors a single local file to S3 in the background. Deliberately NOT
// awaited by callers on the request path (see research-store.js) so a slow
// or unavailable bucket never stalls the Express event loop / other users.
// Writes to the same file are serialized via fileQueues so an in-flight PUT
// for an older version of the file can't finish after (and clobber) a newer
// one.
function mirrorFile(file) {
  if (!enabled()) return Promise.resolve();
  if (!dataRoot) return Promise.reject(new Error('S3 storage is not configured with a data root'));

  const absolute = path.resolve(file);
  const root = path.resolve(dataRoot);
  if (!absolute.startsWith(root + path.sep)) {
    console.warn('[research] Refusing to mirror a file outside research data root:', file);
    return Promise.resolve();
  }
  const relativePath = path.relative(root, absolute).split(path.sep).join('/');

  const previous = fileQueues.get(absolute) || Promise.resolve();
  const next = previous
    .catch(() => {}) // don't let an earlier failure block later writes
    .then(async () => {
      const cfg = config();
      const client = getClient(cfg);
      const body = fs.readFileSync(absolute); // snapshot at the moment this write is dequeued
      await client.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: keyFor(cfg.prefix, relativePath),
        Body: body,
      }));
    })
    .catch((err) => {
      console.warn('[research] S3 mirror failed for ' + file + ':', err.message);
    })
    .finally(() => {
      if (fileQueues.get(absolute) === next) fileQueues.delete(absolute);
    });

  fileQueues.set(absolute, next);
  return next;
}

// Deletes a single local file's S3 mirror (if S3 is enabled). Uses the same
// path-safety guard and per-file queue as mirrorFile so deletes stay ordered
// relative to any in-flight writes of the same key.
function deleteFile(file) {
  if (!enabled()) return Promise.resolve();
  if (!dataRoot) return Promise.reject(new Error('S3 storage is not configured with a data root'));

  const absolute = path.resolve(file);
  const root = path.resolve(dataRoot);
  if (!absolute.startsWith(root + path.sep)) {
    console.warn('[research] Refusing to delete a file outside research data root:', file);
    return Promise.resolve();
  }
  const relativePath = path.relative(root, absolute).split(path.sep).join('/');

  const previous = fileQueues.get(absolute) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const cfg = config();
      const client = getClient(cfg);
      await client.send(new DeleteObjectCommand({
        Bucket: cfg.bucket,
        Key: keyFor(cfg.prefix, relativePath),
      }));
    })
    .catch((err) => {
      console.warn('[research] S3 delete failed for ' + file + ':', err.message);
    })
    .finally(() => {
      if (fileQueues.get(absolute) === next) fileQueues.delete(absolute);
    });

  fileQueues.set(absolute, next);
  return next;
}

function status() {
  return {
    enabled: enabled(),
    bucket: enabled() ? config().bucket : null,
    prefix: enabled() ? config().prefix : null,
    hydrated,
  };
}

module.exports = { configure, enabled, hydrateFromS3, mirrorFile, deleteFile, status };
