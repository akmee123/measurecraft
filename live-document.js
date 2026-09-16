/**
 * Live document registry for MCP ↔ Pro canvas bridge.
 * In-memory sessions: client publishes snapshots; agents enqueue ops; client applies.
 */
'use strict';

const crypto = require('crypto');

const sessions = new Map(); // sessionId -> Session
const MAX_OPS = 200;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function now() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return (prefix || 'id') + '-' + crypto.randomBytes(8).toString('hex');
}

function createSession(preferredId) {
  const id = preferredId && String(preferredId).trim() ? String(preferredId).trim() : makeId('sess');
  if (sessions.has(id)) return sessions.get(id);
  const session = {
    id,
    createdAt: now(),
    updatedAt: now(),
    document: null,
    ops: [],
    opSeq: 0,
    sseClients: new Set(),
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  if (!id) return null;
  return sessions.get(String(id)) || null;
}

function touch(session) {
  session.updatedAt = now();
}

function publishDocument(session, doc) {
  session.document = doc && typeof doc === 'object' ? doc : null;
  touch(session);
  return session.document;
}

function enqueueOp(session, type, payload, meta) {
  session.opSeq += 1;
  const op = {
    id: makeId('op'),
    seq: session.opSeq,
    type: String(type),
    payload: payload || {},
    meta: meta || {},
    createdAt: now(),
    applied: false,
  };
  session.ops.push(op);
  if (session.ops.length > MAX_OPS) {
    session.ops = session.ops.slice(-MAX_OPS);
  }
  touch(session);
  broadcast(session, op);
  return op;
}

function listOps(session, sinceSeq) {
  const since = Number(sinceSeq) || 0;
  return session.ops.filter((op) => op.seq > since);
}

function markApplied(session, opIds) {
  const set = new Set((opIds || []).map(String));
  let n = 0;
  session.ops.forEach((op) => {
    if (set.has(String(op.id)) && !op.applied) {
      op.applied = true;
      n++;
    }
  });
  touch(session);
  return n;
}

function broadcast(session, op) {
  const data = `data: ${JSON.stringify({ type: 'op', op })}\n\n`;
  for (const res of session.sseClients) {
    try {
      res.write(data);
    } catch (_) {
      session.sseClients.delete(res);
    }
  }
}

function attachSse(session, res) {
  session.sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'hello', sessionId: session.id, opSeq: session.opSeq })}\n\n`);
  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clearInterval(keepAlive);
      session.sseClients.delete(res);
    }
  }, 25000);
  res.on('close', () => {
    clearInterval(keepAlive);
    session.sseClients.delete(res);
  });
}

function listSessions() {
  const out = [];
  for (const s of sessions.values()) {
    out.push({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      hasDocument: !!s.document,
      elementCount: s.document && Array.isArray(s.document.elements) ? s.document.elements.length : 0,
      opSeq: s.opSeq,
      pendingOps: s.ops.filter((o) => !o.applied).length,
      listeners: s.sseClients.size,
    });
  }
  return out;
}

function pruneStale() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions.entries()) {
    if (new Date(s.updatedAt).getTime() < cutoff && s.sseClients.size === 0) {
      sessions.delete(id);
    }
  }
}

setInterval(pruneStale, 15 * 60 * 1000).unref?.();

module.exports = {
  createSession,
  getSession,
  publishDocument,
  enqueueOp,
  listOps,
  markApplied,
  attachSse,
  listSessions,
  makeId,
};
