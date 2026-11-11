'use strict';
/*
 * On-device storage.
 *  - DB: every record lives in IndexedDB (one object store per record type) and is mirrored in
 *    memory for fast reports. IndexedDB data belongs to the app and survives app updates.
 *  - Native: thin wrapper over the Android bridge (file save/share, backup folder, safety snapshot),
 *    with browser fallbacks so the app can also run in a desktop browser for development.
 *  - Backup: versioned export/import of ALL data, with automatic migration of older files.
 */
var APP_VERSION = '1.0.0';

var DB = (function () {
  var STORES = ['users', 'products', 'priceHistory', 'sales', 'deliveries', 'adjustments', 'expenses', 'recurring',
    'categories', 'customers', 'payments', 'shifts', 'audit', 'meta'];
  var idb = null, data = {}, maps = {}, api;

  function reset(d) {
    STORES.forEach(function (s) {
      data[s] = (d && d[s]) ? d[s] : [];
      maps[s] = {};
      data[s].forEach(function (r) { maps[s][r.id] = r; });
    });
    api.rev++;
  }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function done(tx) { return new Promise(function (res, rej) { tx.oncomplete = function () { res(); }; tx.onerror = tx.onabort = function () { rej(tx.error || new Error('Storage error')); }; }); }

  function open(name) {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('This device does not support local storage (IndexedDB).'));
      var r = indexedDB.open(name || 'gasstation', 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        STORES.forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' }); });
      };
      r.onsuccess = function () { idb = r.result; res(); };
      r.onerror = function () { rej(r.error); };
    }).then(function () {
      var tx = idb.transaction(STORES, 'readonly'), out = {};
      return Promise.all(STORES.map(function (s) { return req(tx.objectStore(s).getAll()).then(function (rows) { out[s] = rows; }); }))
        .then(function () { reset(out); });
    });
  }
  function changed() { api.rev++; if (api.onChange) api.onChange(); }

  function put(store, obj) {
    if (!maps[store][obj.id]) data[store].push(obj);
    else if (maps[store][obj.id] !== obj) data[store][data[store].indexOf(maps[store][obj.id])] = obj;
    maps[store][obj.id] = obj;
    changed();
    var tx = idb.transaction(store, 'readwrite');
    tx.objectStore(store).put(obj);
    return done(tx);
  }
  function del(store, id) {
    var cur = maps[store][id];
    if (cur) { data[store].splice(data[store].indexOf(cur), 1); delete maps[store][id]; }
    changed();
    var tx = idb.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    return done(tx);
  }
  /** Replaces everything (used by restore and migrations) in one all-or-nothing transaction. */
  function replaceAll(d) {
    var tx = idb.transaction(STORES, 'readwrite');
    STORES.forEach(function (s) {
      var os = tx.objectStore(s);
      os.clear();
      (d[s] || []).forEach(function (r) { os.put(r); });
    });
    return done(tx).then(function () { reset(d); if (api.onChange) api.onChange(); });
  }
  function dump() { var o = {}; STORES.forEach(function (s) { o[s] = data[s]; }); return o; }
  function get(store, id) { return maps[store][id] || null; }
  function meta(key, dflt) { var r = maps.meta[key]; return r ? r.value : dflt; }
  function setMeta(key, value) { return put('meta', { id: key, value: value }); }

  api = { STORES: STORES, rev: 0, onChange: null, data: data, open: open, put: put, del: del, replaceAll: replaceAll, dump: dump, get: get, meta: meta, setMeta: setMeta };
  return api;
})();

/* Station-wide settings, stored as one record so they travel with backups. */
var Settings = (function () {
  var DEFAULTS = { stationName: 'My Gas Station', address: '', logo: null, autoLogoutMin: 10, autoBackup: false, lastAutoBackup: '', lastBackupAt: 0 };
  function get() {
    var s = DB.meta('settings', {}), o = {};
    for (var k in DEFAULTS) o[k] = s[k] === undefined ? DEFAULTS[k] : s[k];
    return o;
  }
  function save(patch) {
    var o = get();
    for (var k in patch) o[k] = patch[k];
    return DB.setMeta('settings', o);
  }
  return { get: get, save: save };
})();

var Native = (function () {
  var B = window.AndroidBridge || null, cbs = {}, seq = 1, pending = 0, CHUNK = 393216;
  window.__nativeResult = function (id, ok, msg) { var c = cbs[id]; if (c) { delete cbs[id]; c({ ok: !!ok, message: msg || '' }); } };

  function send(bytes) {
    if (!B.fileBegin()) throw new Error('Could not prepare the file');
    for (var i = 0; i < bytes.length; i += CHUNK) {
      if (!B.fileAppend(U.base64(bytes.subarray(i, Math.min(bytes.length, i + CHUNK))))) throw new Error('Could not write the file');
    }
  }
  function call(fn) {
    return new Promise(function (res) {
      var id = seq++;
      pending++;
      cbs[id] = function (r) { pending--; res(r); };
      try { fn(id); } catch (e) { delete cbs[id]; pending--; res({ ok: false, message: e.message }); }
    });
  }
  function download(name, mime, bytes) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    return Promise.resolve({ ok: true, message: name });
  }
  return {
    available: !!B,
    busy: function () { return pending > 0; },
    version: function () { try { return (B && B.appVersion()) || APP_VERSION; } catch (e) { return APP_VERSION; } },
    saveAs: function (name, mime, bytes) {
      if (!B) return download(name, mime, bytes);
      return call(function (id) { send(bytes); B.fileSaveAs(name, mime, id); });
    },
    share: function (name, mime, bytes) {
      if (!B) return download(name, mime, bytes);
      return call(function (id) { send(bytes); B.fileShare(name, mime, id); });
    },
    toBackupFolder: function (name, bytes) {
      if (!B) return Promise.resolve({ ok: false, message: 'Only available in the Android app' });
      return call(function (id) { send(bytes); B.fileToBackupFolder(name, id); });
    },
    pickFolder: function () {
      if (!B) return Promise.resolve({ ok: false, message: 'Only available in the Android app' });
      return call(function (id) { B.pickBackupFolder(id); });
    },
    folder: function () { try { return B ? B.backupFolder() : ''; } catch (e) { return ''; } },
    clearFolder: function () { try { if (B) B.clearBackupFolder(); } catch (e) { /* ignore */ } },
    /** The snapshot shares the bridge's outgoing-file buffer, so it must wait while a save dialog is open. */
    snapshotWrite: function (bytes) {
      if (!B || pending > 0) return false;
      try { send(bytes); return !!B.fileToSnapshot(); } catch (e) { return false; }
    },
    snapshotRead: function () { try { return B ? B.snapshotRead() : ''; } catch (e) { return ''; } }
  };
})();

var Backup = (function () {
  var FORMAT = 'gasstation-backup';
  /** Version of the data layout. Bump it and add MIGRATIONS[oldVersion] whenever stored records change shape. */
  var VERSION = 1, api;
  /** MIGRATIONS[n] upgrades a backup object from version n to n + 1 and returns it. */
  var MIGRATIONS = {};
  var LABELS = { users: 'Users', products: 'Products', sales: 'Sales', deliveries: 'Deliveries', adjustments: 'Stock adjustments', expenses: 'Expenses',
    recurring: 'Recurring expenses', categories: 'Expense categories', customers: 'Customers', payments: 'Customer payments', shifts: 'Shifts',
    priceHistory: 'Price history entries', audit: 'Audit log entries' };

  function build(by) {
    var d = DB.dump(), counts = {};
    DB.STORES.forEach(function (s) { counts[s] = d[s].length; });
    return { format: FORMAT, backupVersion: api.VERSION, appVersion: APP_VERSION, createdAt: new Date().toISOString(), createdBy: by || '',
      stationName: Settings.get().stationName, counts: counts, data: d };
  }
  function bytes(by) { return U.utf8(JSON.stringify(build(by))); }
  function fileName(prefix) {
    var d = new Date();
    return (prefix || 'GasStation-backup-') + U.dateStr(d) + '-' + U.pad(d.getHours()) + U.pad(d.getMinutes()) + '.json';
  }

  function migrate(obj) {
    var v = obj.backupVersion | 0;
    if (v < 1) throw new Error('This backup file has no valid version number.');
    if (v > api.VERSION) throw new Error('This backup was made by a newer version of the app (data format ' + v + '). Update the app, then import again.');
    while (v < api.VERSION) {
      if (!MIGRATIONS[v]) throw new Error('Cannot upgrade a backup from data format ' + v + '.');
      obj = MIGRATIONS[v](obj);
      v++;
      obj.backupVersion = v;
    }
    return obj;
  }

  /** Parses and validates backup text, upgrading older formats. Returns {data, info} or throws a readable Error. */
  function parse(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('This file is not a valid backup (it could not be read).'); }
    if (!obj || obj.format !== FORMAT || !obj.data || typeof obj.data !== 'object') throw new Error('This file is not a Gas Station Manager backup.');
    var original = obj.backupVersion | 0;
    obj = migrate(obj);
    var data = {}, counts = [];
    DB.STORES.forEach(function (s) {
      var rows = Array.isArray(obj.data[s]) ? obj.data[s] : [];
      data[s] = rows.filter(function (r) { return r && typeof r === 'object' && r.id != null; });
      if (LABELS[s]) counts.push({ label: LABELS[s], count: data[s].length });
    });
    if (!data.users.some(function (u) { return u.role === 'owner' && !u.disabled; })) throw new Error('This backup has no active Owner account, so it cannot be restored.');
    var dates = data.sales.map(function (s) { return s.date; }).sort();
    var settings = (data.meta.filter(function (m) { return m.id === 'settings'; })[0] || {}).value || {};
    return {
      data: data,
      info: { stationName: settings.stationName || obj.stationName || '', createdAt: obj.createdAt || '', createdBy: obj.createdBy || '', appVersion: obj.appVersion || '',
        version: original, migrated: original !== api.VERSION, counts: counts, salesFrom: dates[0] || '', salesTo: dates[dates.length - 1] || '',
        users: data.users.map(function (u) { return u.username + ' (' + (u.role === 'owner' ? 'Owner' : 'Cashier') + ')'; }) }
    };
  }
  function restore(data) {
    var metaRows = data.meta.filter(function (m) { return m.id !== 'schemaVersion'; });
    metaRows.push({ id: 'schemaVersion', value: api.VERSION });
    data.meta = metaRows;
    return DB.replaceAll(data);
  }
  /** Brings the on-device database up to the current data layout after an app update. */
  function upgradeDevice() {
    var v = DB.meta('schemaVersion', 0);
    if (!v) return DB.data.users.length || DB.data.meta.length ? DB.setMeta('schemaVersion', api.VERSION) : Promise.resolve();
    if (v >= api.VERSION) return Promise.resolve();
    var obj = migrate({ format: FORMAT, backupVersion: v, data: U.clone(DB.dump()) });
    return restore(obj.data);
  }

  // ---- Safety snapshot (Android only): a private copy used if the WebView storage is ever lost.
  var dirty = false, lastSnap = 0;
  function snapshot(force) {
    if (!Native.available || !dirty || !DB.data.users.length) return;
    if (!force && Date.now() - lastSnap < 120000) return;
    if (Native.snapshotWrite(bytes('snapshot'))) { dirty = false; lastSnap = Date.now(); }
  }
  function markDirty() { dirty = true; }
  function recoverFromSnapshot() {
    if (!Native.available || DB.data.users.length) return Promise.resolve(false);
    var text = Native.snapshotRead();
    if (!text) return Promise.resolve(false);
    try { return restore(parse(text).data).then(function () { return true; }); } catch (e) { return Promise.resolve(false); }
  }

  api = { FORMAT: FORMAT, VERSION: VERSION, MIGRATIONS: MIGRATIONS, build: build, bytes: bytes, fileName: fileName, parse: parse, restore: restore,
    upgradeDevice: upgradeDevice, snapshot: snapshot, markDirty: markDirty, recoverFromSnapshot: recoverFromSnapshot };
  return api;
})();
