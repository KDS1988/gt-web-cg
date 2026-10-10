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

  /* Общие часы: в облаке — время сервера Firebase, локально — время server.js. Таймеры считаются от него,
     поэтому пульт на Mac и графика на ПК vMix показывают одно и то же даже при расхождении системных часов. */
  var clock = { offset: 0, now: function () { return Date.now() + clock.offset; } };

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
    if (this.mode === 'server' && st.now) clock.offset = st.now - Date.now();
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
  /* Firebase через WebSocket (SDK): одно соединение на страницу, без лимита браузера в 6 HTTP-потоков на хост.
     Ключи полей вида «Счет1.Text» Firebase запрещает — кодируем точку и спецсимволы. */
  function encKey(k) { return String(k).replace(/[%.#$\/\[\]]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'); }); }
  function decKey(k) { return String(k).replace(/%(25|2E|23|24|2F|5B|5D)/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }); }
  function mapKeys(o, f) { if (!o || typeof o !== 'object') return o; var r = {}; Object.keys(o).forEach(function (k) { r[f(k)] = o[k]; }); return r; }
  function toObj(x) { // Firebase превращает {"1":…,"2":…} в массив
    if (!x) return {};
    if (Array.isArray(x)) { var o = {}; x.forEach(function (v, i) { if (v != null) o[String(i)] = v; }); return o; }
    return x;
  }
  function encodeState(st) {
    var out = Object.assign({}, st, { ch: {} });
    Object.keys(st.ch || {}).forEach(function (c) {
      var a = st.ch[c]; if (!a) return;
      out.ch['c' + c] = Object.assign({}, a, { data: mapKeys(a.data || {}, encKey) });
    });
    return JSON.parse(JSON.stringify(out)); // undefined Firebase не принимает
  }
  function decodeState(st) {
    if (!st) return { ch: {} };
    var ch = {}, src = toObj(st.ch);
    Object.keys(src).forEach(function (k) {
      var a = src[k]; if (!a) return;
      ch[k.replace(/^c/, '')] = Object.assign({}, a, { data: mapKeys(a.data || {}, decKey) });
    });
    return Object.assign({}, st, { ch: ch });
  }
  var fbApps = {};
  Bus.prototype._firebase = function (fb, room) {
    var self = this;
    this.mode = 'firebase';
    this.fbBase = fb + '/cg/' + encodeURIComponent(room);
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      this.onStatus('firebase', false, 'не загружен Firebase SDK (vendor/firebase-*.js)');
      return;
    }
    var app = fbApps[fb] || (fbApps[fb] = firebase.initializeApp({ databaseURL: fb }, 'gtcg-' + Object.keys(fbApps).length));
    var db = app.database();
    this.db = db;
    this.roomPath = 'cg/' + room;
    this.stateRef = db.ref('cg/' + room + '/state');
    this.pkgRef = db.ref('cg/' + room + '/pkg');
    db.ref('.info/serverTimeOffset').on('value', function (s) { clock.offset = s.val() || 0; });
    db.ref('.info/connected').on('value', function (s) {
      var ok = !!s.val();
      self.fbConnected = ok;
      if (ok) self.onStatus('firebase', true);
      else if (self._everConnected) self.onStatus('firebase', false, 'переподключение…');
      if (ok) self._everConnected = true;
    });
    // если за 8 с так и не подключились — сказать об этом
    setTimeout(function () { if (!self._everConnected) self.onStatus('firebase', false, 'нет соединения с базой'); }, 8000);
    this.stateRef.on('value', function (s) { self._deliver(decodeState(s.val())); },
      function (err) { self.onStatus('firebase', false, 'чтение запрещено правилами базы (' + (err && err.code || err) + ')'); });
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
      if (!this.stateRef) return Promise.resolve(false);
      return this.stateRef.set(encodeState(st)).then(function () { self.onStatus('firebase', true); return true; })
        .catch(function (e) { self.onStatus('firebase', false, 'запись отклонена: ' + (e && e.message || e)); return false; });
    }
    if (this.mode === 'server') {
      return fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) })
        .then(function (r) { return r.ok; }).catch(function () { return false; });
    }
    try { if (this.bc) this.bc.postMessage(st); } catch (e) {}
    try { localStorage.setItem('gt-web-cg-state', JSON.stringify(st)); } catch (e) {}
    return Promise.resolve(true);
  };
  /**
   * Внешние данные (табло через ScoreOCR и любые программы, умеющие слать в vMix).
   * cb({ f: Function, i: Input, n: SelectedName, v: Value, t: время }) — в порядке поступления.
   *  - server.js: SSE-событие «ext» (приложение шлёт в http://IP:8787/api/?Function=…)
   *  - Firebase: очередь /cg/<комната>/ext/q (приложение делает POST); пульт обрабатывает и удаляет
   */
  Bus.prototype.listenExt = function (cb) {
    var self = this;
    this.whenReady().then(function () {
      if (self.mode === 'server' && self.es) {
        self.es.addEventListener('ext', function (e) { try { cb(JSON.parse(e.data)); } catch (er) {} });
      } else if (self.mode === 'firebase' && self.db) {
        var started = clock.now();
        var q = self.db.ref(self.roomPath + '/ext/q');
        q.on('child_added', function (snap) {
          var m = snap.val();
          snap.ref.remove().catch(function () {});
          if (!m) return;
          // команды, пролежавшие в очереди до открытия пульта, уже неактуальны
          if (typeof m.t === 'number' && m.t < started - 5000) return;
          cb(m);
        });
      }
    });
  };
  /** Пакет из Firebase: анимации Lottie обратно из строки */
  function unpackFb(p) {
    if (p && p.titlesJson) { try { p.titles = JSON.parse(p.titlesJson); } catch (e) {} delete p.titlesJson; }
    if (p && p.titles) {
      if (!Array.isArray(p.titles)) p.titles = Object.keys(p.titles).sort(function (a, b) { return a - b; }).map(function (k) { return p.titles[k]; });
      p.titles.forEach(function (t) { if (t && t.animJson) { try { t.anim = JSON.parse(t.animJson); } catch (e) {} delete t.animJson; } });
    }
    return p;
  }
  /** Опубликовать пакет графики (её заберут все экраны графики этой комнаты) */
  Bus.prototype.putPkg = function (pkg) {
    var body = JSON.stringify(pkg);
    if (this.mode === 'firebase') {
      if (!this.pkgRef) return Promise.reject(new Error('нет связи с Firebase'));
      // Firebase хранит дерево узлов: выбрасывает пустые массивы/объекты и не пускает точки в ключах
      // (метаданные полей: pick.set {"Номер игрока.Text": …}) — описания титров кладём одной строкой
      var fbPkg = JSON.parse(body);
      fbPkg.titlesJson = JSON.stringify(fbPkg.titles || []);
      delete fbPkg.titles;
      try { return this.pkgRef.set(fbPkg).then(function () { return true; }); }
      catch (e) { return Promise.reject(e); }
    }
    if (this.mode === 'server') {
      return fetch('api/pkg', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body })
        .then(function (r) { if (!r.ok) throw new Error('server.js: HTTP ' + r.status); return true; });
    }
    return idbSet('active-pkg', pkg);
  };
  Bus.prototype.getPkg = function () {
    if (this.mode === 'firebase') return this.pkgRef ? this.pkgRef.once('value').then(function (s) { return unpackFb(s.val()); }) : Promise.resolve(null);
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
    Bus: Bus, fetchPkg: fetchPkg, clock: clock, encodeState: encodeState, decodeState: decodeState
  };
})(typeof self !== 'undefined' ? self : this);
