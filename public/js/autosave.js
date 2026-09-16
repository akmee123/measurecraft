/**
 * MeasureCraft IndexedDB autosave.
 * Debounced writes of the takeoff document so refresh does not lose work.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'measurecraft';
  var DB_VERSION = 2;
  var STORE = 'projects';
  var AUTOSAVE_KEY = 'autosave-pro';
  var timer = null;
  var DEBOUNCE_MS = 1500;

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains('transfers')) {
          db.createObjectStore('transfers');
        }
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = function (ev) {
        resolve(ev.target.result);
      };
      req.onerror = function () {
        reject(req.error || new Error('IDB open failed'));
      };
    });
  }

  function put(key, data) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE)) {
            resolve(false);
            return;
          }
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(data, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error); };
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function get(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          if (!db.objectStoreNames.contains(STORE)) {
            resolve(null);
            return;
          }
          var tx = db.transaction(STORE, 'readonly');
          var req = tx.objectStore(STORE).get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { reject(req.error); };
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  function remove(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          if (!db.objectStoreNames.contains(STORE)) {
            resolve(false);
            return;
          }
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (_) {
          resolve(false);
        }
      });
    });
  }

  function schedule(payloadBuilder) {
    if (typeof payloadBuilder !== 'function') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      try {
        var data = payloadBuilder();
        if (!data) return;
        data._autosavedAt = new Date().toISOString();
        put(AUTOSAVE_KEY, data).then(function (ok) {
          if (ok && global.MCAutosave && typeof global.MCAutosave.onSaved === 'function') {
            global.MCAutosave.onSaved(data._autosavedAt);
          }
        }).catch(function () {});
      } catch (_) {}
    }, DEBOUNCE_MS);
  }

  function loadAutosave() {
    return get(AUTOSAVE_KEY);
  }

  function clearAutosave() {
    return remove(AUTOSAVE_KEY);
  }

  global.MCAutosave = {
    AUTOSAVE_KEY: AUTOSAVE_KEY,
    schedule: schedule,
    load: loadAutosave,
    clear: clearAutosave,
    put: put,
    get: get,
    onSaved: null,
  };
})(typeof window !== 'undefined' ? window : global);
