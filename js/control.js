/*!
 * GT Web CG · control.js — пульт титрования.
 * Титры пакета (из .gtzip), каналы 1–4 как оверлеи vMix, PREVIEW/PROGRAM, правка полей, таймеры.
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var same = function (a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); };
  var qs = new URLSearchParams(location.search);
  var CHANNELS = ['1', '2', '3', '4'];

  /* =================================================================== */
  /* Настройки                                                           */
  /* =================================================================== */
  var cfg = { transport: /github\.io$/.test(location.hostname) ? 'firebase' : 'auto', fbUrl: CG.DEFAULT_FB, room: '', pkgId: '' };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem('gtcg-cfg') || '{}')); } catch (e) {}
  if (!cfg.room) cfg.room = 'gt-' + Math.random().toString(36).slice(2, 10);
  function saveCfg() { try { localStorage.setItem('gtcg-cfg', JSON.stringify(cfg)); } catch (e) {} }
  saveCfg();
  function useFirebase() { return cfg.transport === 'firebase' && CG.normFbUrl(cfg.fbUrl) && CG.normRoom(cfg.room); }
  function graphicsUrl() {
    var base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'index.html';
    if (useFirebase()) return base + '?fb=' + encodeURIComponent(CG.normFbUrl(cfg.fbUrl)) + '&room=' + encodeURIComponent(CG.normRoom(cfg.room));
    return base;
  }

  function toast(msg, err) {
    var t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 6000 : 2500);
  }

  /* =================================================================== */
  /* Пакет и данные                                                      */
  /* =================================================================== */
  var pkg = null;          // текущий пакет
  var D = null;            // данные полей пакета
  var fieldIdx = {};       // ключ поля → { titles:[id], defs:[...] }
  var air = {};            // канал → { t, take, data }
  var takeNo = Date.now() % 100000;
  var repoPkgs = [];

  function dataKey() { return 'gtcg-data:' + pkg.id; }
  function loadData() {
    D = { shared: {}, per: {}, link: {}, ch: {}, live: false, sel: null };
    try { Object.assign(D, JSON.parse(localStorage.getItem(dataKey()) || '{}')); } catch (e) {}
    try { air = JSON.parse(localStorage.getItem('gtcg-air:' + pkg.id) || '{}') || {}; } catch (e) { air = {}; }
  }
  var saveT = null;
  function saveData() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try { localStorage.setItem(dataKey(), JSON.stringify(D)); localStorage.setItem('gtcg-air:' + pkg.id, JSON.stringify(air)); }
      catch (e) { toast('Не удалось сохранить данные пульта: ' + e.message, true); }
    }, 200);
  }

  function titleById(id) { return pkg && pkg.titles.filter(function (t) { return t.id === id; })[0]; }

  /* Группа связи: одинаковое имя поля и одинаковое значение в GT (Таймер 20:00 в табло и нижнем титре — одна группа,
     Таймер 02:00 в удалениях — другая). Если у поля во всех титрах одно значение, группа = имя поля. */
  function buildFieldIdx() {
    fieldIdx = {};
    var byK = {};
    pkg.titles.forEach(function (t) { t.fields.forEach(function (f) { (byK[f.k] = byK[f.k] || []).push(f.def); }); });
    pkg.titles.forEach(function (t) {
      t.fields.forEach(function (f) {
        var d = byK[f.k], allSame = d.every(function (v) { return same(v, d[0]); });
        f.g = allSame ? f.k : f.k + '#' + JSON.stringify(f.def);
        var x = fieldIdx[f.g] = fieldIdx[f.g] || { titles: [], defs: [] };
        x.titles.push(t.id); x.defs.push(f.def);
      });
    });
  }
  function canLink(f) { return fieldIdx[f.g] && fieldIdx[f.g].titles.length > 1; }
  function isLinked(f) {
    if (!canLink(f)) return false;
    return D.link[f.g] !== undefined ? D.link[f.g] : true;
  }
  function getVal(tid, f) {
    if (isLinked(f)) return D.shared[f.g] !== undefined ? D.shared[f.g] : f.def;
    var p = D.per[tid];
    return p && p[f.k] !== undefined ? p[f.k] : f.def;
  }
  function setVal(tid, f, v) {
    if (isLinked(f)) { if (same(v, f.def)) delete D.shared[f.g]; else D.shared[f.g] = v; }
    else { D.per[tid] = D.per[tid] || {}; if (same(v, f.def)) delete D.per[tid][f.k]; else D.per[tid][f.k] = v; }
    saveData();
  }
  function dataFor(tid) {
    var t = titleById(tid), out = {};
    if (!t) return out;
    t.fields.forEach(function (f) { var v = getVal(tid, f); if (!same(v, f.def)) out[f.k] = v; });
    return out;
  }
  function affected(tid, f) { // титры, которых касается изменение поля f титра tid
    return isLinked(f) ? fieldIdx[f.g].titles.slice() : [tid];
  }

  /* Канал по умолчанию: полноэкранные — 1, верх экрана — 3/4, остальные — 2 */
  function defaultChannels() {
    var used3 = false, map = {};
    pkg.titles.forEach(function (t) {
      var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      t.objects.forEach(function (o) { if (o.t === 'layer' || !o.w || !o.h) return; x1 = Math.min(x1, o.x); y1 = Math.min(y1, o.y); x2 = Math.max(x2, o.x + o.w); y2 = Math.max(y2, o.y + o.h); });
      var W = t.w || 1920, H = t.h || 1080;
      var area = Math.max(0, Math.min(x2, W) - Math.max(x1, 0)) * Math.max(0, Math.min(y2, H) - Math.max(y1, 0)) / (W * H);
      if (area > 0.5) map[t.id] = '1';
      else if (y2 < H * 0.3) { map[t.id] = used3 ? '4' : '3'; used3 = true; }
      else map[t.id] = '2';
    });
    return map;
  }
  var defCh = {};
  function chanOf(tid) { return D.ch[tid] || defCh[tid] || '2'; }
  function airChanOf(tid) { for (var c in air) if (air[c] && air[c].t === tid) return c; return null; }

  /* =================================================================== */
  /* Шина                                                                */
  /* =================================================================== */
  var bus = null;
  function buildState() {
    var ch = {};
    Object.keys(air).forEach(function (c) { if (air[c]) ch[c] = { t: air[c].t, take: air[c].take, data: air[c].data || {} }; });
    return { rev: Date.now(), pkg: pkg ? { id: pkg.id, ver: pkg.ver || '' } : null, ch: ch };
  }
  function send() {
    saveData();
    renderAir();
    if (bus) bus.send(buildState());
  }
  function take(tid) {
    if (!titleById(tid)) return;
    var c = chanOf(tid);
    var was = airChanOf(tid);
    if (was && was !== c) delete air[was];
    air[c] = { t: tid, take: ++takeNo, data: dataFor(tid) };
    send();
  }
  function out(c) { if (air[c]) { delete air[c]; send(); } }
  function toggle(tid) { var c = airChanOf(tid); if (c) out(c); else take(tid); }
  function clearAll() { air = {}; send(); }
  /** Обновить данные титров в эфире (tids — список или все) */
  function pushLive(tids) {
    var any = false;
    Object.keys(air).forEach(function (c) {
      var a = air[c];
      if (!a || (tids && tids.indexOf(a.t) < 0)) return;
      var d = dataFor(a.t);
      if (!same(d, a.data)) { a.data = d; any = true; }
    });
    if (any) send();
    return any;
  }

  function syncStatus(mode, ok, why) {
    var p = $('#pSync');
    if (mode === 'server') { p.className = 'pill ' + (ok ? 'ok' : 'bad'); p.textContent = ok ? 'СВЯЗЬ: SERVER.JS' : 'СВЯЗЬ: SERVER ✕'; p.title = ok ? 'Локальный сервер' : 'Сервер не отвечает'; }
    else if (mode === 'firebase') { p.className = 'pill ' + (ok ? 'ok' : 'bad'); p.textContent = ok ? 'СВЯЗЬ: FIREBASE' : 'СВЯЗЬ: FIREBASE ✕'; p.title = ok ? 'Облако, комната ' + cfg.room : ('Нет связи с Firebase' + (why ? ': ' + why : '')); }
    else { p.className = 'pill warn'; p.textContent = 'СВЯЗЬ: ЭТОТ БРАУЗЕР'; p.title = 'Нет server.js и не включено облако: графика работает только в этом браузере'; }
  }
  function pkgPill(state, txt) {
    var p = $('#pPkg');
    p.className = 'pill ' + (state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : 'warn');
    p.textContent = 'ПАКЕТ: ' + txt;
  }
  function publish(force) {
    if (!bus || !pkg) return Promise.resolve();
    var key = 'gtcg-pub:' + bus.mode + ':' + (bus.mode === 'firebase' ? cfg.room : location.host);
    var want = pkg.id + '@' + (pkg.ver || '');
    if (!force && localStorage.getItem(key) === want && bus.mode !== 'local') { pkgPill('ok', 'В КОМНАТЕ'); return Promise.resolve(); }
    pkgPill('warn', 'ПУБЛИКАЦИЯ…');
    return bus.putPkg(pkg).then(function () {
      try { localStorage.setItem(key, want); } catch (e) {}
      pkgPill('ok', 'В КОМНАТЕ');
      bus.send(buildState());
    }).catch(function (e) { pkgPill('bad', 'НЕ ОПУБЛИКОВАН'); toast('Пакет не опубликован: ' + e.message, true); });
  }

  /* =================================================================== */
  /* Список титров                                                       */
  /* =================================================================== */
  function renderList() {
    var L = $('#list');
    if (!pkg) { L.innerHTML = ''; return; }
    L.innerHTML = '<div class="grp"><h4>Титры <span class="st">' + pkg.titles.length + '</span></h4>' +
      pkg.titles.map(function (t) {
        var th = pkg.thumbs && pkg.thumbs[t.id];
        return '<div class="item" data-id="' + esc(t.id) + '">' +
          (th ? '<img class="th" src="' + th + '" alt="">' : '<div class="th"></div>') +
          '<div class="meta"><div class="nm" title="' + esc(t.name) + '">' + esc(t.name) + '</div>' +
          '<div class="sub"><select class="chs" title="Канал (слой) — как оверлей vMix">' + CHANNELS.map(function (c) { return '<option' + (chanOf(t.id) === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
          '<span>' + t.fields.length + ' пол.</span><span class="air-dot">● ЭФИР</span></div></div>' +
          '<button class="btn">IN</button></div>';
      }).join('') + '</div>';
    markList();
  }
  function markList() {
    document.querySelectorAll('.item').forEach(function (el) {
      var id = el.dataset.id, c = airChanOf(id);
      el.classList.toggle('sel', id === D.sel);
      el.classList.toggle('air', !!c);
      $('.btn', el).textContent = c ? 'OUT' : 'IN';
    });
  }
  $('#list').addEventListener('click', function (e) {
    var it = e.target.closest('.item'); if (!it) return;
    if (e.target.closest('select')) return;
    if (e.target.closest('.btn')) { toggle(it.dataset.id); return; }
    select(it.dataset.id);
  });
  $('#list').addEventListener('change', function (e) {
    var it = e.target.closest('.item'); if (!it || !e.target.matches('select.chs')) return;
    D.ch[it.dataset.id] = e.target.value; saveData();
    var c = airChanOf(it.dataset.id);
    if (c && c !== e.target.value) { var a = air[c]; delete air[c]; air[e.target.value] = a; send(); }
  });

  function renderAir() {
    var box = $('#onair'), names = [];
    box.innerHTML = CHANNELS.map(function (c) {
      var a = air[c], t = a && titleById(a.t);
      if (t) names.push(t.name);
      return '<div class="chrow' + (t ? '' : ' empty') + '"><span class="n">КАНАЛ ' + c + '</span><b>' + (t ? esc(t.name) : '—') + '</b>' +
        (t ? '<button class="btn out" data-out="' + c + '">OUT</button>' : '') + '</div>';
    }).join('');
    $('#pgmName').textContent = names.join(' · ') || '—';
    markList();
    renderEdBar();
  }
  $('#onair').addEventListener('click', function (e) { var b = e.target.closest('[data-out]'); if (b) out(b.dataset.out); });

  function select(id) {
    D.sel = id; saveData();
    markList();
    renderEditor();
    updatePreview(true);
  }

  /* =================================================================== */
  /* Превью                                                              */
  /* =================================================================== */
  var pvwFrame = $('#pvwFrame'), pvwReady = false, pvwTake = 1, pvwPkg = null;
  pvwFrame.addEventListener('load', function () { pvwReady = true; pvwPkg = null; updatePreview(true); });
  function updatePreview(retake) {
    var t = pkg && titleById(D.sel);
    $('#pvwName').textContent = t ? t.name : '—';
    var w = pvwFrame.contentWindow;
    if (!pvwReady || !w || !w.__gtApply) return;
    var p = Promise.resolve();
    if (pkg && pvwPkg !== pkg) { pvwPkg = pkg; p = w.__gtSetPkg(pkg); }
    if (retake) pvwTake++;
    p.then(function () { w.__gtApply({ ch: t ? { '1': { t: t.id, take: pvwTake, data: dataFor(t.id) } } : {} }); });
  }
  // превью тикающих таймеров обновляется самим движком

  /* =================================================================== */
  /* Редактор полей                                                      */
  /* =================================================================== */
  var KIND_TITLE = { text: 'Тексты', image: 'Картинки', color: 'Цвета', visible: 'Видимость' };
  function assetList() {
    var used = {};
    pkg.titles.forEach(function (t) { t.objects.forEach(function (o) { if (o.t === 'image' && o.img) used[o.img] = 1; }); });
    return Object.keys(pkg.assets || {}).filter(function (k) { return used[k] || !/^font/.test(pkg.assets[k].mime); })
      .map(function (k) { return { id: k, name: pkg.assets[k].name || k }; });
  }
  function imgUrl(v) {
    if (!v) return '';
    if (pkg.assets && pkg.assets[v]) return pkg.assets[v].data;
    return v;
  }
  function isTimer(v) { return v && typeof v === 'object' && v.tm; }
  function parseTime(s) {
    s = String(s || '').trim();
    var m = /^(?:(\d+):)?(\d+)(?:[.,](\d))?$/.exec(s.replace(/^(\d+):(\d+):(\d+)$/, function (a, h, mm, ss) { return (h * 60 + +mm) + ':' + ss; }));
    if (!m) return null;
    return ((+(m[1] || 0)) * 60 + (+m[2])) * 1000 + (m[3] ? +m[3] * 100 : 0);
  }
  function looksTime(s) { return /^\d{1,3}:\d{2}$/.test(String(s || '').trim()); }
  function isInt(s) { return /^-?\d+$/.test(String(s || '').trim()); }

  function renderEdBar() {
    var bar = $('#edbar');
    if (!bar) return;
    var t = titleById(D.sel), c = t && airChanOf(t.id);
    $('#edTake').textContent = c ? 'OUT ◼ ИЗ ЭФИРА (канал ' + c + ')' : 'IN ▶ В ЭФИР (канал ' + (t ? chanOf(t.id) : '') + ')';
    $('#edTake').className = 'btn big ' + (c ? 'danger' : 'take');
    var dirty = c && !same(air[c].data, dataFor(t.id));
    $('#edPush').disabled = !dirty;
    $('#edPush').className = 'btn big' + (dirty ? ' take' : '');
    $('#btnTake').textContent = c ? 'OUT ◼ ИЗ ЭФИРА' : 'IN ▶ В ЭФИР';
    $('#btnTake').className = 'btn ' + (c ? 'danger' : 'take');
  }

  function renderEditor() {
    var E = $('#editor');
    if (!pkg) {
      E.innerHTML = '<div class="empty-state"><h2>Нет пакета графики</h2><p>Добавьте титры vMix GT: <a href="import.html">Импорт .gtzip</a>' +
        (repoPkgs.length ? ' или выберите пакет из репозитория в списке сверху.' : '.') + '</p></div>';
      return;
    }
    var t = titleById(D.sel);
    if (!t) { E.innerHTML = '<div class="empty-state">Выберите титр слева</div>'; return; }
    var groups = { text: [], image: [], color: [], visible: [] };
    t.fields.forEach(function (f) { (groups[f.kind] || groups.text).push(f); });
    var h = '<h3>' + esc(t.name) + ' <small>' + esc(t.file || '') + ' · ' + t.fields.length + ' полей</small></h3>' +
      '<div class="edbar" id="edbar"><button class="btn big take" id="edTake"></button>' +
      '<button class="btn big" id="edPush" title="Отправить правки в эфир">⟳ ОБНОВИТЬ В ЭФИРЕ</button>' +
      '<label class="tog" title="Каждая правка сразу уходит в эфир (если титр в эфире)"><input type="checkbox" id="edLive"' + (D.live ? ' checked' : '') + '> правки сразу в эфир</label>' +
      '<span class="sp"></span><span class="hint">🔗 — поле общее для всех титров с таким же полем · ± и таймеры идут в эфир сразу</span></div>';
    if (!t.fields.length) h += '<p class="hint">В этом титре нет редактируемых полей — только IN/OUT.</p>';
    Object.keys(groups).forEach(function (kind) {
      var list = groups[kind];
      if (!list.length) return;
      h += '<div class="fsec">' + KIND_TITLE[kind] + ' <small>' + list.length + '</small></div><div class="fields">';
      list.forEach(function (f) { h += fieldHtml(t, f); });
      h += '</div>';
    });
    if (t.warnings && t.warnings.length) h += '<details class="hint"><summary>Предупреждения конвертера (' + t.warnings.length + ')</summary><ul>' + t.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></details>';
    E.innerHTML = h;
    renderEdBar();
  }

  function fieldHtml(t, f) {
    var v = getVal(t.id, f), linked = isLinked(f), chg = !same(v, f.def);
    var head = '<div class="fh"><span class="nm" title="' + esc(f.k) + '">' + esc(f.label) + '</span>' +
      (canLink(f) ? '<button class="ibtn' + (linked ? ' on' : '') + '" data-act="link" title="' + (linked ? 'Общее поле: ' + fieldIdx[f.g].titles.map(function (id) { return titleById(id).name; }).join(', ') + ' — нажмите, чтобы отвязать' : 'Связать с такими же полями других титров') + '">🔗' + (linked ? ' ' + fieldIdx[f.g].titles.length : '') + '</button>' : '') +
      (chg ? '<button class="ibtn" data-act="def" title="Вернуть значение из GT: ' + esc(typeof f.def === 'string' ? f.def : '') + '">↺</button>' : '') + '</div>';
    var body = '';
    if (f.kind === 'text') {
      if (isTimer(v)) {
        var tm = v.tm;
        body = '<div class="timer' + (tm.run ? ' run' : '') + '"><span class="tv" data-tv>' + esc(GTRender.textOf(v, CG.clock.now())) + '</span>' +
          '<button class="btn" data-act="tgo">' + (tm.run ? '⏸ Стоп' : '▶ Старт') + '</button>' +
          '<input type="text" data-act="tset" placeholder="мм:сс" value="" title="Установить время и нажать Enter">' +
          '<button class="btn sm" data-act="treset" title="Вернуть ' + GTRender.fmtTimer(tm.ms0 || 0, 'mm:ss', -1) + '">↺</button>' +
          '<button class="btn sm" data-act="tdir" title="Направление">' + (tm.dir < 0 ? '↓ обратный' : '↑ прямой') + '</button>' +
          '<select data-act="tfmt" title="Формат">' + [['mm:ss', 'мм:сс'], ['m:ss', 'м:сс'], ['auto', 'м:сс → сс.д'], ['hh:mm:ss', 'чч:мм:сс']].map(function (o) { return '<option value="' + o[0] + '"' + (tm.fmt === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
          '<button class="ibtn on" data-act="timer" title="Выключить таймер (оставить текст)">⏱</button></div>';
      } else {
        var sv = String(v == null ? '' : v);
        body = '<div class="fr">' + (isInt(sv) ? '<button class="btn pm" data-act="dec" title="−1 (сразу в эфир)">−</button>' : '') +
          '<input type="text" data-act="text" value="' + esc(sv) + '" spellcheck="false">' +
          (isInt(sv) ? '<button class="btn pm" data-act="inc" title="+1 (сразу в эфир)">+</button>' : '') +
          '<button class="ibtn' + (looksTime(sv) ? '' : '') + '" data-act="timer" title="Сделать полем-таймером">⏱</button></div>';
      }
    } else if (f.kind === 'image') {
      var assets = assetList(), isAsset = pkg.assets && pkg.assets[v];
      body = '<div class="fr"><img class="imgbox" src="' + esc(imgUrl(v)) + '" alt="">' +
        '<select data-act="imgsel" style="flex:1;min-width:0"><option value="">— пусто —</option>' +
        assets.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === v ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') +
        (!isAsset && v ? '<option value="' + esc(v) + '" selected>свой файл</option>' : '') + '</select>' +
        '<label class="btn sm file" title="Загрузить свою картинку (PNG с прозрачностью)">Файл…<input type="file" accept="image/*" data-act="imgfile" hidden></label></div>';
    } else if (f.kind === 'color') {
      var hex = toHex(v);
      body = '<div class="fr"><input type="color" data-act="color" value="' + hex + '"><input type="text" data-act="colortxt" value="' + esc(v) + '" spellcheck="false"></div>';
    } else if (f.kind === 'visible') {
      body = '<label class="tog"><input type="checkbox" data-act="vis"' + (v === false || v === 'false' ? '' : ' checked') + '> показывать</label>';
    }
    return '<div class="fld' + (chg ? ' chg' : '') + '" data-k="' + esc(f.k) + '">' + head + body + '</div>';
  }
  function toHex(c) {
    c = String(c || '').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return '#' + m[1].toLowerCase();
    m = /^#([0-9a-f]{3})$/i.exec(c); if (m) return '#' + m[1].split('').map(function (x) { return x + x; }).join('').toLowerCase();
    m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    if (m) return '#' + [m[1], m[2], m[3]].map(function (x) { return (+x).toString(16).padStart(2, '0'); }).join('');
    return '#000000';
  }

  function fieldOf(el) {
    var box = el.closest('.fld'); if (!box) return null;
    var t = titleById(D.sel); if (!t) return null;
    var f = t.fields.filter(function (x) { return x.k === box.dataset.k; })[0];
    return f ? { t: t, f: f, box: box } : null;
  }
  /** Изменение значения. instant=true — сразу в эфир (±, таймер, видимость при live) */
  function change(t, f, v, instant, rerender) {
    setVal(t.id, f, v);
    if (D.live || instant) pushLive(affected(t.id, f)); else renderEdBar();
    updatePreview(false);
    if (rerender) renderEditor();
    else { var box = document.querySelector('.fld[data-k="' + CSS.escape(f.k) + '"]'); if (box) box.classList.toggle('chg', !same(v, f.def)); renderEdBar(); }
  }

  var editor = $('#editor');
  editor.addEventListener('click', function (e) {
    if (e.target.id === 'edTake') { if (D.sel) toggle(D.sel); return; }
    if (e.target.id === 'edPush') { var t0 = titleById(D.sel); if (t0) pushLive(null); return; }
    var b = e.target.closest('[data-act]'); if (!b || b.tagName === 'INPUT' || b.tagName === 'SELECT') return;
    var x = fieldOf(b); if (!x) return;
    var t = x.t, f = x.f, v = getVal(t.id, f), act = b.dataset.act;
    if (act === 'link') {
      var on = !isLinked(f);
      if (on) { D.shared[f.g] = v; }
      else { fieldIdx[f.g].titles.forEach(function (id) { D.per[id] = D.per[id] || {}; D.per[id][f.k] = D.shared[f.g] !== undefined ? D.shared[f.g] : v; }); }
      D.link[f.g] = on; saveData(); renderEditor(); updatePreview(false); return;
    }
    if (act === 'def') { change(t, f, f.def, false, true); return; }
    if (act === 'inc' || act === 'dec') {
      var s = String(v), n = parseInt(s, 10) + (act === 'inc' ? 1 : -1);
      if (n < 0) n = 0;
      var padN = /^0\d/.test(s) ? s.length : 0;
      var ns = String(n); while (ns.length < padN) ns = '0' + ns;
      $('input[data-act=text]', x.box).value = ns;
      change(t, f, ns, true, false);
      return;
    }
    if (act === 'timer') {
      if (isTimer(v)) change(t, f, GTRender.textOf(v, CG.clock.now()), true, true);
      else {
        var ms = parseTime(v); if (ms == null) ms = 0;
        change(t, f, { tm: { ms: ms, ms0: ms, run: false, at: 0, dir: -1, fmt: 'mm:ss' } }, true, true);
      }
      return;
    }
    if (isTimer(v)) {
      var tm = Object.assign({}, v.tm), now = CG.clock.now();
      if (act === 'tgo') {
        if (tm.run) { tm.ms = GTRender.timerMs(tm, now); tm.run = false; tm.at = 0; }
        else { tm.run = true; tm.at = now; }
      } else if (act === 'treset') { tm.ms = tm.ms0 || 0; if (tm.run) tm.at = now; }
      else if (act === 'tdir') { tm.ms = GTRender.timerMs(tm, now); if (tm.run) tm.at = now; tm.dir = tm.dir < 0 ? 1 : -1; }
      else return;
      change(t, f, { tm: tm }, true, true);
    }
  });
  editor.addEventListener('input', function (e) {
    var x = fieldOf(e.target); if (!x) return;
    var act = e.target.dataset.act;
    if (act === 'text') change(x.t, x.f, e.target.value, false, false);
    else if (act === 'color') { $('input[data-act=colortxt]', x.box).value = e.target.value; change(x.t, x.f, e.target.value, false, false); }
    else if (act === 'colortxt') { $('input[data-act=color]', x.box).value = toHex(e.target.value); change(x.t, x.f, e.target.value.trim(), false, false); }
  });
  editor.addEventListener('change', function (e) {
    if (e.target.id === 'edLive') { D.live = e.target.checked; saveData(); if (D.live) pushLive(null); return; }
    var x = fieldOf(e.target); if (!x) return;
    var act = e.target.dataset.act, t = x.t, f = x.f, v = getVal(t.id, f);
    if (act === 'vis') change(t, f, e.target.checked, false, false);
    else if (act === 'imgsel') change(t, f, e.target.value, false, true);
    else if (act === 'tfmt' && isTimer(v)) change(t, f, { tm: Object.assign({}, v.tm, { fmt: e.target.value }) }, true, false);
    else if (act === 'imgfile' && e.target.files[0]) {
      var obj = t.objects.filter(function (o) { return o.n === f.o; })[0];
      shrinkImage(e.target.files[0], obj ? Math.max(obj.w, obj.h) * 1.5 : 512).then(function (url) { change(t, f, url, false, true); })
        .catch(function (err) { toast('Картинка не загружена: ' + err.message, true); });
    }
  });
  editor.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var x = fieldOf(e.target); if (!x) return;
    var act = e.target.dataset.act, t = x.t, f = x.f, v = getVal(t.id, f);
    if (act === 'tset' && isTimer(v)) {
      var ms = parseTime(e.target.value);
      if (ms == null) { toast('Формат времени: мм:сс', true); return; }
      var tm = Object.assign({}, v.tm, { ms: ms, ms0: ms });
      if (tm.run) tm.at = CG.clock.now();
      change(t, f, { tm: tm }, true, true);
    } else if (act === 'text' && !D.live) { pushLive(affected(t.id, f)); }
  });

  function shrinkImage(file, maxSide) {
    return new Promise(function (res, rej) {
      var rd = new FileReader();
      rd.onerror = function () { rej(new Error('не прочитан файл')); };
      rd.onload = function () {
        var img = new Image();
        img.onerror = function () { rej(new Error('это не картинка')); };
        img.onload = function () {
          var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          if (k >= 1 && rd.result.length < 400000) return res(rd.result);
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/png'));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  // тикающие таймеры в редакторе
  setInterval(function () {
    var t = pkg && titleById(D.sel); if (!t) return;
    document.querySelectorAll('.fld').forEach(function (box) {
      var tv = $('[data-tv]', box); if (!tv) return;
      var f = t.fields.filter(function (x) { return x.k === box.dataset.k; })[0];
      var v = f && getVal(t.id, f);
      if (isTimer(v)) tv.textContent = GTRender.textOf(v, CG.clock.now());
    });
  }, 200);

  /* =================================================================== */
  /* Клавиши                                                             */
  /* =================================================================== */
  var lastEsc = 0;
  document.addEventListener('keydown', function (e) {
    if (!$('#settings').hidden) { if (e.key === 'Escape') $('#settings').hidden = true; return; }
    if (!$('#extDlg').hidden) { if (e.key === 'Escape') $('#extDlg').hidden = true; return; }
    var inField = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === 'Escape') {
      if (inField) { document.activeElement.blur(); return; }
      var now = Date.now(); if (now - lastEsc < 600) clearAll(); lastEsc = now; return;
    }
    if (inField || !pkg) return;
    if (e.key === ' ') { e.preventDefault(); if (D.sel) toggle(D.sel); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var ids = pkg.titles.map(function (t) { return t.id; }), i = ids.indexOf(D.sel);
      i = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1);
      select(ids[i]);
    }
  });
  $('#btnTake').addEventListener('click', function () { if (D && D.sel) toggle(D.sel); });
  $('#btnReplay').addEventListener('click', function () { updatePreview(true); });
  $('#btnClear').addEventListener('click', clearAll);

  /* =================================================================== */
  /* Выбор пакета                                                        */
  /* =================================================================== */
  function fillPkgSel(list) {
    var sel = $('#pkgSel');
    var h = list.map(function (p) { return '<option value="lib:' + esc(p.id) + '">' + esc(p.name) + ' (' + p.titles + ')</option>'; }).join('');
    var repo = repoPkgs.filter(function (r) { return !list.some(function (p) { return p.id === r.id; }); });
    if (repo.length) h += '<optgroup label="Из репозитория">' + repo.map(function (r) { return '<option value="repo:' + esc(r.file) + '">📦 ' + esc(r.name) + '</option>'; }).join('') + '</optgroup>';
    if (!list.length && !repo.length) h = '<option value="">— нет пакетов —</option>';
    h += '<option value="import">＋ Импорт .gtzip…</option>';
    sel.innerHTML = h;
    sel.value = pkg ? 'lib:' + pkg.id : '';
  }
  $('#pkgSel').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v === 'import') { location.href = 'import.html'; return; }
    if (/^lib:/.test(v)) openPkg(v.slice(4));
    else if (/^repo:/.test(v)) {
      CG.fetchPkg(v.slice(5)).then(function (p) { return CG.Library.put(p).then(function () { openPkg(p.id); }); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  function openPkg(id) {
    return CG.Library.get(id).then(function (p) {
      if (!p) { toast('Пакет не найден в браузере', true); return; }
      if (pkg && pkg.id !== id && Object.keys(air).length) { air = {}; send(); }
      pkg = p;
      cfg.pkgId = p.id; saveCfg();
      loadData();
      buildFieldIdx();
      defCh = defaultChannels();
      if (!titleById(D.sel)) D.sel = pkg.titles[0] && pkg.titles[0].id;
      $('#pkgName').textContent = pkg.name + ' · ' + pkg.titles.length + ' титр.';
      document.title = 'Пульт · ' + pkg.name;
      renderList(); renderAir(); renderEditor(); updatePreview(true);
      return CG.Library.list().then(fillPkgSel).then(function () { return publish(false); });
    });
  }

  /* =================================================================== */
  /* Настройки                                                           */
  /* =================================================================== */
  function openSettings() {
    $('#sTransport').value = cfg.transport; $('#sFbUrl').value = cfg.fbUrl || ''; $('#sRoom').value = cfg.room || '';
    $('#sVmixUrl').value = graphicsUrl();
    $('#settings').hidden = false;
  }
  $('#btnSettings').addEventListener('click', openSettings);
  $('#sCancel').addEventListener('click', function () { $('#settings').hidden = true; });
  ['#sTransport', '#sFbUrl', '#sRoom'].forEach(function (s) {
    $(s).addEventListener('input', function () {
      var keep = { t: cfg.transport, u: cfg.fbUrl, r: cfg.room };
      cfg.transport = $('#sTransport').value; cfg.fbUrl = CG.normFbUrl($('#sFbUrl').value); cfg.room = CG.normRoom($('#sRoom').value) || keep.r;
      $('#sVmixUrl').value = graphicsUrl();
      cfg.transport = keep.t; cfg.fbUrl = keep.u; cfg.room = keep.r;
    });
  });
  $('#sCopy').addEventListener('click', function () {
    var inp = $('#sVmixUrl'); inp.select();
    (navigator.clipboard ? navigator.clipboard.writeText(inp.value) : Promise.reject()).then(function () { toast('Ссылка скопирована'); })
      .catch(function () { document.execCommand('copy'); toast('Ссылка скопирована'); });
  });
  $('#sSave').addEventListener('click', function () {
    var prev = cfg.transport + '|' + cfg.fbUrl + '|' + cfg.room;
    cfg.transport = $('#sTransport').value; cfg.fbUrl = CG.normFbUrl($('#sFbUrl').value); cfg.room = CG.normRoom($('#sRoom').value) || cfg.room;
    saveCfg();
    $('#settings').hidden = true;
    if (prev !== cfg.transport + '|' + cfg.fbUrl + '|' + cfg.room) setTimeout(function () { location.reload(); }, 200);
  });
  $('#sPublish').addEventListener('click', function () { publish(true).then(function () { toast('Пакет опубликован'); }); });
  function download(name, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('#sDownloadPkg').addEventListener('click', function () { if (pkg) download(pkg.id + '.json', pkg); });
  $('#sDeletePkg').addEventListener('click', function () {
    if (!pkg || !confirm('Удалить пакет «' + pkg.name + '» из этого браузера?')) return;
    var id = pkg.id;
    air = {}; send();
    CG.Library.remove(id).then(function (l) {
      pkg = null; cfg.pkgId = ''; saveCfg();
      $('#settings').hidden = true;
      if (l[0]) openPkg(l[0].id); else { fillPkgSel([]); renderList(); renderEditor(); }
    });
  });
  $('#sExport').addEventListener('click', function () { if (pkg) download('data-' + pkg.id + '.json', { pkg: pkg.id, data: D }); });
  $('#sImport').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (s) {
      var j = JSON.parse(s);
      Object.assign(D, j.data || j); saveData(); renderEditor(); updatePreview(false); toast('Данные загружены');
    }).catch(function (err) { toast('Не прочитан файл: ' + err.message, true); });
  });
  $('#sReset').addEventListener('click', function () {
    if (!pkg || !confirm('Вернуть все поля к значениям из GT?')) return;
    D.shared = {}; D.per = {}; D.link = {}; saveData(); renderEditor(); updatePreview(false);
  });

  /* =================================================================== */
  /* Данные с табло (ScoreOCR и всё, что умеет слать в HTTP API vMix)    */
  /* =================================================================== */
  // Сообщение: { f: Function, i: Input, n: SelectedName, v: Value, t }
  //   SetText — значение поля; Suspend/Start/Pause/Stop/Change/Set/AdjustCountdown — таймер поля.
  var extLastAt = 0, extLastMsg = null, extRefreshT = null;
  function extCfg() {
    D.ext = D.ext || {};
    if (D.ext.on === undefined) D.ext.on = true;
    if (D.ext.live === undefined) D.ext.live = true;
    D.ext.map = D.ext.map || {};
    D.ext.seen = D.ext.seen || {};
    return D.ext;
  }
  function groupList() { // текстовые группы полей пакета
    var out = [];
    Object.keys(fieldIdx).forEach(function (g) {
      var t0 = titleById(fieldIdx[g].titles[0]); if (!t0) return;
      var f = t0.fields.filter(function (x) { return x.g === g; })[0];
      if (!f || f.kind !== 'text') return;
      out.push({ g: g, k: f.k, def: f.def, titles: fieldIdx[g].titles });
    });
    return out;
  }
  function groupLabel(x) {
    return x.k.replace(/\.Text$/, '').replace(/_/g, ' ') + ' — ' + x.titles.map(function (id) { return titleById(id).name; }).join(', ') +
      (typeof x.def === 'string' && x.def ? ' («' + x.def + '»)' : '');
  }
  function secOf(v) { var m = /^(\d+):(\d{2})$/.exec(String(v || '').trim()); return m ? +m[1] * 60 + +m[2] : -1; }
  /** Авто-сопоставление поля приложения с группой полей титров */
  function autoGroup(n) {
    var gl = groupList(), k = String(n || '').replace(/\.Text$/i, ''), low = k.toLowerCase();
    var exact = gl.filter(function (x) { return x.k === n || x.k === k + '.Text'; });
    if (exact.length) return exact.sort(function (a, b) { return b.titles.length - a.titles.length; })[0].g;
    var pick = function (re, pred) {
      var c = gl.filter(function (x) { return re.test(x.k.replace(/\.Text$/, '')) && (!pred || pred(x)); });
      return c.length ? c.sort(function (a, b) { return b.titles.length - a.titles.length; })[0] : null;
    };
    var r = null;
    if (/^home.?score$/.test(low)) r = pick(/^(сч[её]т|score)[ _-]?(1|хоз|home)$/i);
    else if (/^away.?score$/.test(low)) r = pick(/^(сч[её]т|score)[ _-]?(2|гост|away)$/i);
    else if (/^clock$/.test(low)) {
      var c = groupList().filter(function (x) { return /^(таймер|clock|timer|игровое.?время)$/i.test(x.k.replace(/\.Text$/, '')) && secOf(x.def) >= 0; });
      if (c.length) r = c.sort(function (a, b) { return secOf(b.def) - secOf(a.def); })[0]; // основные часы — с наибольшим временем (20:00, а не 02:00)
    }
    else if (/^period$/.test(low)) r = pick(/^(период|period)([ _-]?цифра)?$/i, function (x) { return /^\d+$/.test(String(x.def)); }) || pick(/^(период|period)/i);
    else if (/^home.?fouls?$/.test(low)) r = pick(/^(фол|fouls?)[ _-]?(1|хоз|home)$/i);
    else if (/^away.?fouls?$/.test(low)) r = pick(/^(фол|fouls?)[ _-]?(2|гост|away)$/i);
    else if (/^shot.?clock$/.test(low)) r = pick(/^(24|shot.?clock|атака)/i);
    return r ? r.g : null;
  }
  function targetOf(n) {
    var m = extCfg().map[n];
    if (m === '') return null;          // «не использовать»
    if (m && fieldIdx[m]) return m;
    return autoGroup(n);
  }
  function parseClock(v) { // "00:19:45.5" | "19:45" | "45.6" | "1185" → мс
    var s = String(v == null ? '' : v).trim(); if (!s) return null;
    var p = s.split(':'), sec = 0;
    for (var i = 0; i < p.length; i++) { var x = parseFloat(p[i].replace(',', '.')); if (!isFinite(x)) return null; sec = sec * 60 + x; }
    return Math.round(sec * 1000);
  }
  function padLike(v, def) { // «3» в поле «00» → «03»
    v = String(v == null ? '' : v);
    if (/^\d+$/.test(v) && typeof def === 'string' && /^0\d+$/.test(def) && v.length < def.length) while (v.length < def.length) v = '0' + v;
    return v;
  }
  function applyExt(m) {
    if (!pkg || !m || !m.f) return;
    var X = extCfg();
    var n = String(m.n || ''), fn = String(m.f).toLowerCase();
    extLastAt = Date.now(); extLastMsg = m;
    var seen = X.seen[n] = X.seen[n] || {};
    seen.f = m.f; seen.at = extLastAt;
    if (fn === 'settext') seen.v = m.v;
    else seen.v = m.f + (m.v != null ? ' ' + m.v : '');
    extPill();
    if (!X.on) return;
    var g = targetOf(n); if (!g) { scheduleExtUi(); return; }
    var tids = fieldIdx[g].titles, now = CG.clock.now();
    var fOf = function (tid) { return titleById(tid).fields.filter(function (x) { return x.g === g; })[0]; };
    var f0 = fOf(tids[0]), cur = getVal(tids[0], f0), nv;
    if (fn === 'settext') nv = padLike(m.v, f0.def);
    else if (/countdown$/.test(fn)) {
      var tm = isTimer(cur) ? Object.assign({}, cur.tm) : (function () { var ms = parseTime(cur); if (ms == null) ms = parseClock(cur) || 0; return { ms: ms, ms0: ms, run: false, at: 0, dir: -1, fmt: 'mm:ss' }; })();
      var curMs = GTRender.timerMs(tm, now);
      if (fn === 'suspendcountdown') { tm.ms = curMs; tm.run = false; tm.at = 0; }
      else if (fn === 'startcountdown') { if (!tm.run) { tm.ms = curMs; tm.run = true; tm.at = now; } }
      else if (fn === 'pausecountdown') { if (tm.run) { tm.ms = curMs; tm.run = false; tm.at = 0; } else { tm.run = true; tm.at = now; } }
      else if (fn === 'stopcountdown') { tm.ms = tm.ms0 || 0; tm.run = false; tm.at = 0; }
      else if (fn === 'changecountdown') { var ms = parseClock(m.v); if (ms == null) return; tm.ms = ms; if (tm.run) tm.at = now; }
      else if (fn === 'setcountdown') { var ms2 = parseClock(m.v); if (ms2 == null) return; tm.ms = tm.ms0 = ms2; tm.run = false; tm.at = 0; }
      else if (fn === 'adjustcountdown') { tm.ms = curMs + (parseFloat(m.v) || 0) * 1000; if (tm.run) tm.at = now; }
      else return;
      // десятые на последней минуте, если табло их показывает
      if (fn === 'changecountdown' && /\.\d/.test(String(m.v)) && tm.fmt === 'mm:ss') tm.fmt = 'auto';
      nv = { tm: tm };
    } else return; // остальные функции vMix не относятся к полям
    if (same(nv, cur) && tids.every(function (id) { return same(getVal(id, fOf(id)), nv); })) return;
    tids.forEach(function (id) { setVal(id, fOf(id), nv); });
    if (X.live) pushLive(tids); else renderEdBar();
    if (tids.indexOf(D.sel) >= 0) { updatePreview(false); scheduleEditor(); }
    scheduleExtUi();
  }
  function scheduleEditor() {
    clearTimeout(extRefreshT);
    extRefreshT = setTimeout(function () {
      var a = document.activeElement;
      if (a && $('#editor').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) { scheduleEditor(); return; } // не сбивать оператора
      renderEditor();
    }, 250);
  }
  function extPill() {
    var p = $('#pExt'), age = extLastAt ? (Date.now() - extLastAt) / 1000 : -1;
    var X = D ? extCfg() : { on: true };
    if (!X.on) { p.className = 'pill'; p.textContent = 'ТАБЛО: ВЫКЛ'; return; }
    if (age < 0) { p.className = 'pill'; p.textContent = 'ТАБЛО: —'; p.title = 'Данных с табло пока не было'; return; }
    p.className = 'pill ' + (age < 15 ? 'ok' : 'warn');
    p.textContent = 'ТАБЛО: ' + (age < 15 ? '●' : Math.round(age) + ' с назад');
    p.title = 'Последнее: ' + (extLastMsg ? extLastMsg.f + ' ' + (extLastMsg.n || '') + ' ' + (extLastMsg.v == null ? '' : extLastMsg.v) : '');
  }
  setInterval(function () { if (extLastAt) extPill(); }, 2000);
  var extUiT = null;
  function scheduleExtUi() { clearTimeout(extUiT); extUiT = setTimeout(function () { saveData(); if (!$('#extDlg').hidden) renderExt(); }, 300); }
  function renderExt() {
    if (!pkg) return;
    var X = extCfg(), gl = groupList();
    $('#xOn').checked = X.on; $('#xLive').checked = X.live;
    var age = extLastAt ? Math.round((Date.now() - extLastAt) / 1000) : -1;
    $('#xStatus').className = 'pill ' + (age >= 0 && age < 15 ? 'ok' : age >= 0 ? 'warn' : '');
    $('#xStatus').textContent = age < 0 ? 'нет данных' : age < 15 ? 'данные идут' : 'тишина ' + age + ' с';
    var host = location.hostname || 'IP-этого-компьютера';
    if (bus && bus.mode === 'firebase') {
      $('#xHow').innerHTML = 'ScoreOCR → Настройки → <b>Куда отправлять: GT Web CG (облако)</b>:<br>адрес базы <code>' + esc(CG.normFbUrl(cfg.fbUrl)) + '</code>, комната <code>' + esc(cfg.room) + '</code>. ' +
        '<button class="btn sm" id="xCopy">Скопировать</button><br>Нужен интернет на iPhone. Пульт должен быть открыт — он принимает данные и отправляет их в графику.';
    } else if (bus && bus.mode === 'server') {
      $('#xHow').innerHTML = 'ScoreOCR → Настройки → vMix: <b>IP компьютера</b> — IP этого Mac/ПК, где запущен server.js (сейчас открыт как <code>' + esc(host) + '</code>), <b>порт</b> <code>' + esc(location.port || '80') + '</code>. ' +
        'Приложение считает систему титрования обычным vMix — менять в нём больше ничего не нужно, «Проверить связь» покажет «vMix GT Web CG».';
    } else {
      $('#xHow').innerHTML = 'Сейчас пульт работает без server.js и без облака — данные с табло принять некуда. Запустите server.js или включите облако в ⚙ Настройках.';
    }
    var names = Object.keys(X.seen).sort();
    var opts = function (n) {
      var m = X.map[n], auto = autoGroup(n);
      return '<option value="*"' + (m === undefined ? ' selected' : '') + '>Авто' + (auto ? ': ' + esc(groupLabel(gl.filter(function (x) { return x.g === auto; })[0] || { k: auto, titles: [] })) : ' — не найдено') + '</option>' +
        '<option value=""' + (m === '' ? ' selected' : '') + '>— не использовать —</option>' +
        gl.map(function (x) { return '<option value="' + esc(x.g) + '"' + (m === x.g ? ' selected' : '') + '>' + esc(groupLabel(x)) + '</option>'; }).join('');
    };
    $('#xMap').innerHTML = names.length ? names.map(function (n) {
      var sn = X.seen[n];
      return '<tr><td><b>' + esc(n || '(без имени)') + '</b></td><td>' + esc(sn.v == null ? '' : sn.v) + '</td><td><select data-n="' + esc(n) + '" style="width:100%">' + opts(n) + '</select></td></tr>';
    }).join('') : '<tr><td colspan="3" class="hint">Пока ничего не пришло. Включите в ScoreOCR кнопку ЭФИР.</td></tr>';
  }
  $('#btnExt').addEventListener('click', function () { if (!pkg) return toast('Сначала выберите пакет', true); renderExt(); $('#extDlg').hidden = false; });
  $('#xClose').addEventListener('click', function () { $('#extDlg').hidden = true; });
  $('#xOn').addEventListener('change', function (e) { extCfg().on = e.target.checked; saveData(); extPill(); });
  $('#xLive').addEventListener('change', function (e) { extCfg().live = e.target.checked; saveData(); });
  $('#xMap').addEventListener('change', function (e) {
    var n = e.target.dataset.n; if (n == null) return;
    var v = e.target.value, X = extCfg();
    if (v === '*') delete X.map[n]; else X.map[n] = v;
    saveData(); renderExt();
  });
  $('#xForget').addEventListener('click', function () { var X = extCfg(); X.seen = {}; X.map = {}; saveData(); renderExt(); });
  $('#xTest').addEventListener('click', function () {
    applyExt({ f: 'SetText', n: 'HomeScore.Text', v: '1', t: Date.now() });
    applyExt({ f: 'SetText', n: 'AwayScore.Text', v: '0', t: Date.now() });
    renderExt();
  });
  document.addEventListener('click', function (e) {
    if (e.target.id !== 'xCopy') return;
    var t = 'Адрес базы: ' + CG.normFbUrl(cfg.fbUrl) + '\nКомната: ' + cfg.room;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Скопировано'); }).catch(function () { toast(t); });
  });
  window.__gtExt = applyExt; // для отладки и тестов

  /* =================================================================== */
  /* Старт                                                               */
  /* =================================================================== */
  bus = new CG.Bus(function (st) {
    if (bus._gotInitial) return;
    bus._gotInitial = true;
    // восстановить эфир с сервера/из облака, если пульт перезагружали
    if (pkg && st && st.pkg && st.pkg.id === pkg.id && st.ch && !Object.keys(air).length) {
      Object.keys(st.ch).forEach(function (c) { if (st.ch[c] && titleById(st.ch[c].t)) air[c] = st.ch[c]; });
      saveData(); renderAir();
    }
  }, syncStatus, useFirebase() ? { fb: CG.normFbUrl(cfg.fbUrl), room: CG.normRoom(cfg.room) } : null);

  bus.listenExt(applyExt);
  bus.whenReady().then(function () {
    $('#pgmFrame').src = (useFirebase() ? graphicsUrl() + '&' : 'index.html?') + 'checker=1&_=' + Date.now(); // без старого кэша
    if (pkg) publish(false);
  });

  fetch('packages/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
    .then(function (list) { repoPkgs = Array.isArray(list) ? list : []; return CG.Library.list(); })
    .then(function (list) {
      var want = qs.get('pkg') || cfg.pkgId || (list[0] && list[0].id);
      if (want && list.some(function (p) { return p.id === want; })) return openPkg(want);
      fillPkgSel(list);
      renderEditor();
      pkgPill('warn', 'НЕТ');
    });
})();
