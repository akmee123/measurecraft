/**
 * Live document bridge — publishes Pro canvas state and applies agent ops.
 * Requires takeoff_pro globals via callbacks registered with MCLiveBridge.init(hooks).
 */
(function (global) {
  'use strict';

  var sessionId = null;
  var lastOpSeq = 0;
  var pollTimer = null;
  var publishTimer = null;
  var hooks = null;
  var eventSource = null;
  var enabled = true;

  function storageKey() {
    return 'mc_live_session_id';
  }

  function getTokenHeaders() {
    var h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    try {
      var tok = localStorage.getItem('mc_token') || localStorage.getItem('mcToken');
      if (tok) h['Authorization'] = 'Bearer ' + tok;
      var api = localStorage.getItem('mc_api_token');
      if (api) h['X-MC-Token'] = api;
    } catch (_) {}
    return h;
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    return fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign(getTokenHeaders(), opts.headers || {}),
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok) throw new Error((j && j.error) || res.statusText);
        return j;
      });
    });
  }

  function ensureSession() {
    if (sessionId) return Promise.resolve(sessionId);
    try {
      sessionId = localStorage.getItem(storageKey()) || null;
    } catch (_) {}
    return fetchJson('/api/live/session', {
      method: 'POST',
      body: { sessionId: sessionId },
    }).then(function (data) {
      sessionId = data.sessionId;
      try {
        localStorage.setItem(storageKey(), sessionId);
      } catch (_) {}
      updateStatusChip();
      return sessionId;
    });
  }

  function updateStatusChip() {
    var el = document.getElementById('mcLiveStatus');
    if (!el) return;
    el.textContent = sessionId ? 'Live · ' + sessionId.slice(-6) : 'Live off';
    el.title = sessionId
      ? 'MCP live session ' + sessionId + ' — agents can read/write this document'
      : 'Live bridge inactive';
  }

  function buildSnapshot() {
    if (!hooks || typeof hooks.getSnapshot !== 'function') return null;
    return hooks.getSnapshot();
  }

  function publishNow() {
    if (!enabled) return Promise.resolve();
    return ensureSession()
      .then(function (id) {
        var doc = buildSnapshot();
        if (!doc) return null;
        return fetchJson('/api/live/document/' + encodeURIComponent(id), {
          method: 'PUT',
          body: { document: doc },
        });
      })
      .catch(function (err) {
        console.warn('[live-bridge] publish', err.message);
      });
  }

  function schedulePublish() {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(function () {
      publishTimer = null;
      publishNow();
    }, 800);
  }

  function applyOp(op) {
    if (!hooks || typeof hooks.applyOp !== 'function') return false;
    try {
      return !!hooks.applyOp(op);
    } catch (e) {
      console.warn('[live-bridge] applyOp', op && op.type, e);
      return false;
    }
  }

  function processOps(ops) {
    if (!ops || !ops.length) return Promise.resolve();
    var appliedIds = [];
    ops.forEach(function (op) {
      if (!op || op.applied) return;
      if (op.seq && op.seq <= lastOpSeq) return;
      if (applyOp(op)) {
        appliedIds.push(op.id);
        if (op.seq > lastOpSeq) lastOpSeq = op.seq;
      }
    });
    if (!appliedIds.length || !sessionId) return Promise.resolve();
    return fetchJson('/api/live/ops/' + encodeURIComponent(sessionId) + '/ack', {
      method: 'POST',
      body: { opIds: appliedIds },
    }).catch(function () {});
  }

  function pollOps() {
    if (!sessionId || !enabled) return;
    fetchJson('/api/live/ops/' + encodeURIComponent(sessionId) + '?since=' + lastOpSeq)
      .then(function (data) {
        if (data && data.ops) return processOps(data.ops);
      })
      .catch(function () {});
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOps, 1500);
  }

  function startSse() {
    if (!sessionId || typeof EventSource === 'undefined') return;
    try {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      // EventSource cannot set custom headers; use cookie-less public poll + optional token query
      var url = '/api/live/events/' + encodeURIComponent(sessionId);
      try {
        var api = localStorage.getItem('mc_api_token');
        if (api) url += '?token=' + encodeURIComponent(api);
      } catch (_) {}
      eventSource = new EventSource(url);
      eventSource.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg.type === 'op' && msg.op) processOps([msg.op]);
          if (msg.type === 'hello' && typeof msg.opSeq === 'number') {
            // don't rewind lastOpSeq on reconnect
          }
        } catch (_) {}
      };
      eventSource.onerror = function () {
        // fall back to poll only
      };
    } catch (_) {}
  }

  function init(h) {
    hooks = h || {};
    enabled = hooks.enabled !== false;
    ensureSession()
      .then(function () {
        startPolling();
        startSse();
        return publishNow();
      })
      .catch(function (err) {
        console.warn('[live-bridge] init', err.message);
      });
  }

  function getSessionId() {
    return sessionId;
  }

  global.MCLiveBridge = {
    init: init,
    publish: schedulePublish,
    publishNow: publishNow,
    getSessionId: getSessionId,
    ensureSession: ensureSession,
  };
})(typeof window !== 'undefined' ? window : global);
