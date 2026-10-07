/*!
 * GT Web CG · core.js — общий модуль: конфиг, хранилище (IndexedDB), шина синхронизации пульт ↔ графика.
 *
 * Шина (как в пакете гонок дронов):
 *   - облако: Firebase Realtime Database, REST + SSE. Состояние: /cg/<комната>/state, пакет: /cg/<комната>/pkg
 *   - локально: server.js (POST /api/state, SSE /api/events, GET/PUT /api/pkg)
 *   - резерв: BroadcastChannel + IndexedDB (пульт и графика в одном браузере)
 */
(function (root) {
  'use strict';

  var DEFAULT_FB = 'https://kds88-title-default-rtdb.europe-west1.firebasedatabase.app';

  function normFbUrl(u) {
    u = String(u || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//.test(u)) u = 'https://' + u;
    return u;
  }
  function normRoom(r) { return String(r || '').trim().replace(/[^\w-]/g, '').slice(0, 64); }
  function qsParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }

  /* ------------------------------------------------------------------ */
  /* IndexedDB (key-value)                                               */
  /* ------------------------------------------------------------------ */
  var dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise(function (res, rej) {
      var rq = indexedDB.open('gt-web-cg', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
    return dbP;
  }
  function idbGet(key) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var rq = d.transaction('kv', 'readonly').objectStore('kv').get(key);
        rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return undefined; });
  }
  function idbSet(key, val) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('kv', 'readwrite');
        if (val === undefined) tx.objectStore('kv').delete(key); else tx.objectStore('kv').put(val, key);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbKeys() {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var rq = d.transaction('kv', 'readonly').objectStore('kv').getAllKeys();
        rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return []; });
  }

  /* Библиотека пакетов в браузере пульта: pkg:<id> → пакет, 'pkgs' → список {id,name,ver,titles,size} */
  var Library = {
    list: function () { return idbGet('pkgs').then(function (l) { return l || []; }); },
    get: function (id) { return idbGet('pkg:' + id); },
    put: function (pkg) {
      var size = JSON.stringify(pkg).length;
      return idbSet('pkg:' + pkg.id, pkg).then(function () { return Library.list(); }).then(function (l) {
        l = l.filter(function (x) { return x.id !== pkg.id; });
        l.unshift({ id: pkg.id, name: pkg.name, ver: pkg.ver, titles: pkg.titles.length, size: size, saved: Date.now() });
        return idbSet('pkgs', l).then(function () { return l; });
      });
    },
    remove: function (id) {
      return idbSet('pkg:' + id, undefined).then(function () { return Library.list(); }).then(function (l) {
        l = l.filter(function (x) { return x.id !== id; });
        return idbSet('pkgs', l).then(function () { return l; });
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Шина                                                                */
  /* ------------------------------------------------------------------ */
  function Bus(onState, onStatus, opts) {
    this.onState = onState || function () {};
    this.onStatus = onStatus || function () {};
    this.mode = null;
    this.lastRev = -1;
    var self = this;
    opts = opts || {};
    var forced = opts.mode || qsParam('bus') || null;
    var fb = normFbUrl(opts.fb || qsParam('fb')), room = normRoom(opts.room || qsParam('room'));
    if (forced !== 'bc' && forced !== 'server' && fb && room) { this._firebase(fb, room); return; }
    var httpOk = /^https?:$/.test(location.protocol);
    if (forced !== 'bc' && httpOk) {
      fetch('api/state', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('no server');
        return r.json();
      }).then(function (st) { self._server(st); })
        .catch(function () { self._bc(); });
    } else this._bc();
  }
  Bus.prototype._deliver = function (st) {
    if (!st || typeof st !== 'object') return;
    if (st.rev != null && st.rev === this.lastRev) return;
    this.lastRev = st.rev;
    this.onState(st);
  };
  Bus.prototype._server = function (initial) {
    var self = this;
    this.mode = 'server';
    if (initial && initial.rev != null) this._deliver(initial);
    var es = new EventSource('api/events');
    es.onopen = function () { self.onStatus('server', true); };
    es.onmessage = function (e) { try { self._deliver(JSON.parse(e.data)); } catch (err) {} };
    es.onerror = function () { self.onStatus('server', false); };
    this.es = es;
  };
  Bus.prototype._firebase = function (fb, room) {
    var self = this;
    this.mode = 'firebase';
    this.fbBase = fb + '/cg/' + encodeURIComponent(room);
    this.fbRef = this.fbBase + '/state.json';
    var es = null, retry = null;
    var connect = function () {
      try { if (es) es.close(); } catch (e) {}
      es = new EventSource(self.fbRef);
      self.es = es;
      var onData = function (e) {
        try {
          var msg = JSON.parse(e.data);
          if (!msg) return;
          if (msg.path === '/') self._deliver(msg.data || { ch: {} });
          else self._refetch();
        } catch (er) {}
      };
      es.addEventListener('put', onData);
      es.addEventListener('patch', onData);
      es.addEventListener('keep-alive', function () { self.onStatus('firebase', true); });
      es.addEventListener('cancel', function () { self.onStatus('firebase', false, 'доступ запрещён правилами базы'); });
      es.onopen = function () { self.onStatus('firebase', true); };
      es.onerror = function () {
        self.onStatus('firebase', false);
        if (es.readyState === 2) { clearTimeout(retry); retry = setTimeout(connect, 2000); }
      };
    };
    connect();
  };
  Bus.prototype._refetch = function () {
    var self = this;
    fetch(this.fbRef, { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (st) { self._deliver(st || { ch: {} }); }).catch(function () {});
  };
  Bus.prototype._bc = function () {
    var self = this;
    this.mode = 'local';
    try {
      this.bc = new BroadcastChannel('gt-web-cg');
      this.bc.onmessage = function (e) { self._deliver(e.data); };
    } catch (e) {}
    try {
      window.addEventListener('storage', function (e) {
        if (e.key === 'gt-web-cg-state' && e.newValue) { try { self._deliver(JSON.parse(e.newValue)); } catch (er) {} }
      });
      var saved = localStorage.getItem('gt-web-cg-state');
      if (saved) setTimeout(function () { self._deliver(JSON.parse(saved)); }, 0);
    } catch (e) {}
    this.onStatus('local', true);
  };
  Bus.prototype.send = function (st) {
    var self = this;
    if (this.mode === 'firebase') {
      return fetch(this.fbRef, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) })
        .then(function (r) { if (!r.ok) self.onStatus('firebase', false, 'запись запрещена (HTTP ' + r.status + ')'); return r.ok; })
        .catch(function () { self.onStatus('firebase', false); return false; });
    }
    if (this.mode === 'server') {
      return fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    }
    try { if (this.bc) this.bc.postMessage(st); } catch (e) {}
    try { localStorage.setItem('gt-web-cg-state', JSON.stringify(st)); } catch (e) {}
    return Promise.resolve(true);
  };
  /** Опубликовать пакет графики (её заберут все экраны графики этой комнаты) */
  Bus.prototype.putPkg = function (pkg) {
    var body = JSON.stringify(pkg);
    if (this.mode === 'firebase') {
      return fetch(this.fbBase + '/pkg.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { if (!r.ok) throw new Error('Firebase: HTTP ' + r.status); return true; });
    }
    if (this.mode === 'server') {
      return fetch('api/pkg', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { if (!r.ok) throw new Error('server.js: HTTP ' + r.status); return true; });
    }
    return idbSet('active-pkg', pkg);
  };
  Bus.prototype.getPkg = function () {
    if (this.mode === 'firebase') return fetch(this.fbBase + '/pkg.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
    if (this.mode === 'server') return fetch('api/pkg', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
    return idbGet('active-pkg');
  };
  /** Ждать, пока шина определится с режимом */
  Bus.prototype.whenReady = function () {
    var self = this;
    return new Promise(function (res) { (function w() { if (self.mode) res(self); else setTimeout(w, 30); })(); });
  };

  /* ------------------------------------------------------------------ */
  /* Пакет: загрузка по ссылке                                           */
  /* ------------------------------------------------------------------ */
  function fetchPkg(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
      return r.json();
    }).then(function (p) {
      if (!p || !p.titles) throw new Error('Это не пакет GT Web CG');
      return p;
    });
  }

  root.CG = {
    DEFAULT_FB: DEFAULT_FB,
    normFbUrl: normFbUrl, normRoom: normRoom, qsParam: qsParam,
    idbGet: idbGet, idbSet: idbSet, idbKeys: idbKeys, Library: Library,
    Bus: Bus, fetchPkg: fetchPkg
  };
})(typeof self !== 'undefined' ? self : this);
