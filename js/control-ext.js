/*!
 * GT Web CG · control-ext.js — расширения пульта:
 *   • данные турнира с junior.fhr.ru (data/fhr/*.json) и окно «Матч»: выбор матча → команды, логотипы, коды,
 *     арена, составы разносятся по титрам (поля с bind в пакете);
 *   • ленты «Турнирная таблица» (по группам) и «Бомбардиры»;
 *   • выбор игрока/тренера из состава, кнопки-заготовки с данными матча;
 *   • окно ведения статистики → титр «Статистика матча»;
 *   • горячие клавиши (настройка в ⚙);
 *   • таймеры удалений: старт при IN, идут вместе с часами табло, по нулю — титр уходит сам.
 */
(function () {
  'use strict';
  var C = null; // внутренний API пульта (window.__gtc)
  var H = window.__gtcHooks = window.__gtcHooks || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var up = function (s) { return String(s == null ? '' : s).toUpperCase(); };

  /* =================================================================== */
  /* Данные турнира                                                      */
  /* =================================================================== */
  var FHR = { index: [], data: null, slug: '' };
  function cfgX() {
    var cfg = C.cfg;
    cfg.fhr = cfg.fhr || {};
    cfg.fhr.codes = cfg.fhr.codes || {};       // id команды → код (ДИН, Л04…), общий для всех пакетов
    cfg.fhr.nameFmt = cfg.fhr.nameFmt || 'fl'; // fl: ИМЯ ФАМИЛИЯ, lf: ФАМИЛИЯ ИМЯ, il: И. ФАМИЛИЯ
    cfg.keys = cfg.keys || {};
    return cfg;
  }
  function dataUrl(rel) { return new URL('data/fhr/' + rel, location.href).href; }
  function loadIndex() {
    return fetch('data/fhr/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
      .then(function (l) { FHR.index = Array.isArray(l) ? l : []; return FHR.index; });
  }
  function loadTournament(slug) {
    if (!slug) return Promise.resolve(null);
    return fetch('data/fhr/' + slug + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('нет данных турнира (' + r.status + ')'); return r.json(); })
      .then(function (d) { FHR.data = d; FHR.slug = slug; return d; });
  }
  /** Обновить данные с сайта прямо сейчас — только через server.js (сайт не отдаёт данные в браузер напрямую) */
  function refreshNow(slug) {
    var b = C.bus();
    if (!b || b.mode !== 'server') return Promise.reject(new Error('обновление по кнопке работает с server.js; в облаке данные обновляются автоматически каждые 15 минут'));
    var post = function (q) {
      return fetch('api/fhr-sync?' + q, { method: 'POST' }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
      });
    };
    var mid = $('#mMatch') && $('#mMatch').value || (C.D().match && C.D().match.id);
    return post('t=' + encodeURIComponent(slug)).then(function () { return mid ? post('game=' + encodeURIComponent(mid)).catch(function () {}) : null; })
      .then(function () { FHR.game = null; return loadTournament(slug); }).then(function () { return mid ? loadGame(mid) : null; });
  }

  function team(id) { return FHR.data && FHR.data.teams[id]; }
  /** Заявка на матч и судьи (data/fhr/games/<id>.json — со страницы матча на сайте) */
  function loadGame(id) {
    if (!id) { FHR.game = null; return Promise.resolve(null); }
    if (FHR.game && FHR.game.id === id && FHR.gameAt > Date.now() - 60000) return Promise.resolve(FHR.game);
    return fetch('data/fhr/games/' + id + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (g) { FHR.game = g ? Object.assign(g, { id: String(id) }) : { id: String(id), none: true, refs: { main: [], line: [] }, home: { players: [] }, away: { players: [] } }; FHR.gameAt = Date.now(); return FHR.game; });
  }
  function gameOf(mid) { return FHR.game && FHR.game.id === mid && !FHR.game.none ? FHR.game : null; }
  function hasLineup(g, side) { return !!(g && g[side] && g[side].players && g[side].players.length); }
  /** Порядок в составе: вратари (ОВ, затем ЗВ), защитники и нападающие — по звеньям, внутри — по номеру */
  function lineupSort(list) {
    var po = { G: 0, D: 1, F: 2 };
    var u = function (p) { return p.pos === 'G' ? (p.unit === 'ОВ' ? 0 : 1) : (+p.unit || 9); };
    return list.slice().sort(function (a, b) { return (po[a.pos] - po[b.pos]) || (u(a) - u(b)) || ((+a.num || 999) - (+b.num || 999)); });
  }
  /** Игроки стороны для титров и списков: заявка на матч, если она уже есть на сайте, иначе — состав команды */
  function rosterOf(side, m) {
    m = m || curMatch(); if (!m) return [];
    var g = gameOf(m.id);
    if (hasLineup(g, side)) return lineupSort(g[side].players);
    var t = team(m[side] && m[side].id);
    return (t && t.players) || [];
  }
  function codeOf(t) {
    if (!t) return '';
    var X = cfgX().fhr.codes;
    if (X[t.id]) return X[t.id];
    if (FHR.data && FHR.data.codes && FHR.data.codes[t.id]) return FHR.data.codes[t.id];
    return up(t.name).replace(/[^A-ZА-ЯЁ0-9]/g, '').slice(0, 3);
  }
  function logoOf(t) {
    if (!t) return '';
    return t.logoFile ? dataUrl(t.logoFile) : (t.logo || '');
  }
  function personName(p) {
    if (!p) return '';
    var f = cfgX().fhr.nameFmt;
    if (f === 'lf') return up(p.last + ' ' + p.first);
    if (f === 'il') return up((p.first ? p.first[0] + '. ' : '') + p.last);
    return up(p.first + ' ' + p.last);
  }
  function tournamentShort(d) {
    var t = (d && d.tournament && d.tournament.title) || '';
    var m = /"([^"]+)"\s*(\d{4}\s*г\.?\s*р\.?)?/.exec(t);
    return up(m ? m[1] + (m[2] ? ' ' + m[2].replace(/\s+/g, ' ').replace(/(\d{4})\s*г/, '$1 г') : '') : t);
  }
  function headCoach(t) {
    var st = (t && t.staff) || [];
    return st.filter(function (s) { return /главный/i.test(s.role); })[0] || st[0] || null;
  }
  var ROLE = { G: 'ВРАТАРЬ', D: 'ЗАЩИТНИК', F: 'НАПАДАЮЩИЙ' };
  var SLOTS = { G: 2, D: 10, F: 15 };

  /** Значения привязок (bind) для выбранного матча */
  function matchValues(m, opt) {
    opt = opt || {};
    var v = {}, warn = [];
    [['home', m.home], ['away', m.away]].forEach(function (x) {
      var side = x[0], t = Object.assign({}, x[1], team(x[1].id) || {}), g = gameOf(m.id);
      t.players = rosterOf(side, m);
      if (g && g[side] && g[side].staff && g[side].staff.length) t.staff = g[side].staff;
      v[side + '.name'] = up(t.name);
      v[side + '.city'] = up(t.city);
      v[side + '.abbr'] = (opt[side + 'Abbr'] || codeOf(t)).slice(0, 5);
      v[side + '.logo'] = logoOf(t);
      var hc = headCoach(t);
      v[side + '.coach'] = personName(hc);
      v[side + '.coachRole'] = hc ? up(hc.role) : 'ГЛАВНЫЙ ТРЕНЕР';
      var by = { G: [], D: [], F: [] };
      (t.players || []).forEach(function (p) { if (by[p.pos]) by[p.pos].push(p); });
      Object.keys(SLOTS).forEach(function (pos) {
        for (var i = 1; i <= SLOTS[pos]; i++) {
          var p = by[pos][i - 1];
          v[side + '.' + pos + i + '.num'] = p ? p.num : '';
          v[side + '.' + pos + i + '.name'] = p ? personName(p) : '';
        }
        if (by[pos].length > SLOTS[pos]) warn.push(up(t.name) + ': ' + { G: 'вратарей', D: 'защитников', F: 'нападающих' }[pos] + ' ' + by[pos].length + ', в титре мест ' + SLOTS[pos]);
      });
    });
    var gm = gameOf(m.id), refs = gm ? [gm.refs.main[0], gm.refs.main[1], gm.refs.line[0], gm.refs.line[1]] : [];
    for (var r = 1; r <= 4; r++) v['ref.' + r] = refs[r - 1] ? personName(refs[r - 1]) : '';
    v.tournament = opt.tournament != null ? opt.tournament : tournamentShort(FHR.data);
    v.place = opt.place != null ? opt.place : up(m.arena);
    v.date = m.date; v.time = m.time; v.matchno = String(m.n || '');
    return { v: v, warn: warn };
  }
  function standingsValues(gid) {
    var d = FHR.data, v = {};
    var g = d && d.groups.filter(function (x) { return x.id === gid; })[0];
    var rows = (d && d.standings[gid]) || [];
    v['st.group'] = g ? up(g.name) : '';
    for (var r = 1; r <= 5; r++) {
      var x = rows[r - 1], t = x && team(x.id);
      v['st.' + r + '.pos'] = x ? x.pos : '';
      v['st.' + r + '.name'] = x ? up(x.name) : '';
      v['st.' + r + '.city'] = x ? up(x.city) : '';
      v['st.' + r + '.logo'] = x ? logoOf(t || x) : '';
      ['gp', 'w', 'wo', 'wb', 'lb', 'lo', 'l', 'pts'].forEach(function (k) { v['st.' + r + '.' + k] = x ? x[k] : ''; });
      v['st.' + r + '.goals'] = x ? x.gf + '-' + x.ga : '';
    }
    return v;
  }
  function scorersValues(scope, from) {
    var d = FHR.data, v = {};
    var list = (d && d.scorers[scope || 'all']) || [];
    var g = d && d.groups.filter(function (x) { return x.id === scope; })[0];
    v['sc.group'] = g ? up(g.name) : 'ВЕСЬ ТУРНИР';
    from = from || 0;
    for (var r = 1; r <= 5; r++) {
      var x = list[from + r - 1], t = x && team(x.teamId);
      v['sc.' + r + '.rank'] = x ? String(from + r) : '';
      v['sc.' + r + '.name'] = x ? personName(x) : '';
      v['sc.' + r + '.team'] = x ? up(t ? t.name + ' ' + t.city : x.team) : '';
      v['sc.' + r + '.logo'] = x ? logoOf(t) : '';
      ['gp', 'g', 'a', 'pts'].forEach(function (k) { v['sc.' + r + '.' + k] = x ? x[k] : ''; });
    }
    return v;
  }

  /** Звено (пятёрка) из заявки на матч: 2 защитника и 3 нападающих звена unit */
  function lineValues(side, unit) {
    var m = curMatch(); if (!m) return { err: 'выберите матч' };
    var g = gameOf(m.id); if (!hasLineup(g, side)) return { err: 'на сайте ещё нет заявки на матч со звеньями' };
    var pl = lineupSort(g[side].players).filter(function (p) { return String(p.unit) === String(unit); });
    var d = pl.filter(function (p) { return p.pos === 'D'; }), f = pl.filter(function (p) { return p.pos === 'F'; });
    if (!d.length && !f.length) return { err: 'в заявке нет ' + unit + '-го звена' };
    d = d.slice(0, 2); f = f.slice(0, 3);
    // места заполняются подряд: защитники, затем нападающие; схема выбирает подписи под ними
    var five = d.concat(f), v = { 'ln.logo': logoOf(team(m[side].id)), 'ln.scheme': 'D' + d.length + 'F' + f.length };
    [0, 1, 2, 3, 4].forEach(function (i) {
      var p = five[i];
      v['ln.' + (i + 1) + '.num'] = p ? p.num : '';
      v['ln.' + (i + 1) + '.first'] = p ? up(p.first) : '';
      v['ln.' + (i + 1) + '.last'] = p ? up(p.last) : '';
    });
    return { v: v, n: d.length + f.length };
  }
  function linesTitle() { var p = C.pkg(); return p && p.titles.filter(function (t) { return t.feed === 'lines'; })[0]; }
  function unitsOf(side) {
    var m = curMatch(), g = m && gameOf(m.id), u = {};
    if (hasLineup(g, side)) g[side].players.forEach(function (p) { if (p.pos !== 'G' && /^\d+$/.test(p.unit)) u[p.unit] = 1; });
    var l = Object.keys(u).sort(); return l.length ? l : ['1', '2', '3', '4'];
  }
  /** Заполнить титр звена и (take) выдать в эфир; повторное нажатие того же звена в эфире — убрать */
  function showLine(side, unit, take) {
    var t = linesTitle(); if (!t) return C.toast('В пакете нет титра звена', true);
    var D = C.D(); D.feed = D.feed || {};
    var cur = D.feed[t.id] || {}, onAir = C.airChanOf(t.id);
    if (take && onAir && cur.side === side && String(cur.unit) === String(unit)) { stopCycle(); C.out(onAir); return; }
    var r = lineValues(side, unit); if (r.err) return C.toast('Звено: ' + r.err, true);
    D.feed[t.id] = { side: side, unit: String(unit) }; C.saveData();
    applyBinds(r.v, !!onAir);
    if (take) { if (onAir) startCycle(side, unit); else C.take(t.id); } // в эфир — beforeTake запустит пролистывание
    if (D.sel === t.id) C.renderEditor();
  }
  /** Пролистывание звеньев в эфире: каждые LINE_MS следующее звено, после последнего — титр уходит */
  var LINE_MS = 5000, cyc = null;
  function stopCycle() { if (cyc) clearTimeout(cyc.timer); cyc = null; }
  function startCycle(side, unit) {
    stopCycle();
    var us = unitsOf(side), i = Math.max(0, us.indexOf(String(unit)));
    var me = cyc = { side: side, units: us, i: i };
    var tick = function () {
      if (cyc !== me) return;
      var t = linesTitle(), ch = t && C.airChanOf(t.id);
      if (!ch) { stopCycle(); return; }
      me.i++;
      if (me.i >= me.units.length) { stopCycle(); C.out(ch); return; }
      var r = lineValues(side, me.units[me.i]);
      if (r.err) { stopCycle(); C.out(ch); return; }
      var D = C.D(); D.feed = D.feed || {}; D.feed[t.id] = { side: side, unit: me.units[me.i] }; C.saveData();
      applyBinds(r.v, true);
      if (D.sel === t.id) C.renderEditor();
      me.timer = setTimeout(tick, LINE_MS);
    };
    me.timer = setTimeout(tick, LINE_MS);
  }

  /** Записать значения по привязкам во все титры; instant — сразу в эфир */
  function applyBinds(vals, instant) {
    var pkg = C.pkg(); if (!pkg) return 0;
    var n = 0, tids = {};
    pkg.titles.forEach(function (t) {
      t.fields.forEach(function (f) {
        if (!f.bind || !(f.bind in vals)) return;
        var nv = vals[f.bind];
        if (f.kind === 'visible') nv = !!nv;
        var cur = C.getVal(t.id, f);
        if (C.same(cur, nv)) return;
        C.setVal(t.id, f, nv); n++; tids[t.id] = 1;
      });
      // логотип пуст — прячем слот (иначе осталась бы прозрачная заглушка, это не страшно, но честнее)
    });
    if (instant || C.D().live) C.pushLive(Object.keys(tids)); else C.renderEdBar();
    C.updatePreview(false);
    C.renderEditor();
    return n;
  }
  function valueOfBind(bind) {
    var pkg = C.pkg(), g = 'bind:' + bind, x = C.fieldIdx()[g];
    if (!x) return null;
    var t = C.titleById(x.titles[0]), f = t && t.fields.filter(function (y) { return y.g === g; })[0];
    return f ? C.getVal(t.id, f) : null;
  }

  /* =================================================================== */
  /* Хуки редактора                                                      */
  /* =================================================================== */
  H.presetValue = function (key) {
    if (key === 'clock') {
      var g = clockGroup(); if (!g) return null;
      var t = C.titleById(C.fieldIdx()[g].titles[0]), f = t.fields.filter(function (y) { return y.g === g; })[0];
      return GTRender.textOf(C.getVal(t.id, f), CG.clock.now());
    }
    var v = valueOfBind(key);
    return v == null ? null : v;
  };
  H.pickList = function (key) {
    var M = curMatch(); if (!M || !FHR.data) return [];
    var side = key.split('.')[0], what = key.split('.')[1];
    var t = team(M[side] && M[side].id); if (!t) return [];
    var gm = gameOf(M.id);
    if (what === 'staff') return ((gm && gm[side] && gm[side].staff && gm[side].staff.length ? gm[side].staff : t.staff) || []).map(function (p) { return { label: up(p.role) + ' · ' + personName(p), p: p }; });
    return rosterOf(side, M).map(function (p) { return { label: (p.num ? '№' + p.num + ' ' : '') + personName(p) + ' · ' + (ROLE[p.pos] || '').toLowerCase(), p: p }; });
  };
  H.pickFormat = function (it, fmt) {
    var p = it.p;
    return fmt.split(' ').map(function (k) {
      if (k === 'num') return p.num || '';
      if (k === 'name') return personName(p);
      if (k === 'role') return up(ROLE[p.pos] || p.role || '');
      return k;
    }).join(' ').trim();
  };
  H.editorTop = function (t) {
    var h = '';
    if (t.feed === 'standings') {
      var gs = (FHR.data && FHR.data.groups) || [], M = curMatch(), cur = (C.D().feed || {})[t.id] || (M && M.group) || (gs[0] && gs[0].id);
      h += '<div class="feedbar"><b>📊 Таблица с сайта ФХР</b><select id="fdGroup">' + gs.map(function (g) {
        var n = (FHR.data.standings[g.id] || []).length;
        return '<option value="' + esc(g.id) + '"' + (g.id === cur ? ' selected' : '') + '>' + esc(g.name) + (n ? '' : ' — нет таблицы') + '</option>';
      }).join('') + '</select><button class="btn take" data-feed="standings">Заполнить</button>' + feedInfo() + '</div>';
    } else if (t.feed === 'scorers') {
      var gs2 = (FHR.data && FHR.data.groups) || [], st = (C.D().feed || {})[t.id] || { scope: 'all', from: 0 };
      h += '<div class="feedbar"><b>🏒 Бомбардиры с сайта ФХР</b><select id="fdScope"><option value="all">Весь турнир</option>' + gs2.map(function (g) {
        var n = (FHR.data.scorers[g.id] || []).length;
        return '<option value="' + esc(g.id) + '"' + (g.id === st.scope ? ' selected' : '') + '>' + esc(g.name) + (n ? '' : ' — пока пусто') + '</option>';
      }).join('') + '</select><select id="fdFrom">' + [0, 5, 10, 15].map(function (k) { return '<option value="' + k + '"' + (k === st.from ? ' selected' : '') + '>места ' + (k + 1) + '–' + (k + 5) + '</option>'; }).join('') +
        '</select><button class="btn take" data-feed="scorers">Заполнить</button>' + feedInfo() + '</div>';
    } else if (t.feed === 'lines') {
      var lf = (C.D().feed || {})[t.id] || { side: 'home', unit: '1' };
      h += '<div class="feedbar"><b>🏒 Звено из заявки на матч</b>' + ['home', 'away'].map(function (sd) {
        return '<span class="hint">' + (sd === 'home' ? 'Хозяева' : 'Гости') + '</span>' + unitsOf(sd).map(function (u) {
          return '<button class="btn' + (lf.side === sd && lf.unit === u ? ' take' : '') + '" data-line="' + sd + ':' + u + '">' + u + '</button>';
        }).join('');
      }).join(' ') + '<span class="hint">кнопки в панели матча под мониторами — сразу в эфир</span></div>';
    } else if (t.statRows) {
      h += '<div class="feedbar"><b>📈 Статистика ведётся в окне</b><button class="btn take" data-open="stats">Открыть окно статистики</button></div>';
    } else if (t.side && !curMatch()) {
      h += '<div class="feedbar"><span class="hint">Состав и логотип подставятся из окна «Матч» — выберите матч.</span><button class="btn" data-open="match">Матч…</button></div>';
    }
    return h;
  };
  function feedInfo() {
    if (!FHR.data) return '<span class="hint">нет данных — откройте окно «Матч»</span>';
    return '<span class="hint">данные на ' + new Date(FHR.data.updated).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '</span>';
  }
  document.addEventListener('click', function (e) {
    var ln = e.target.closest('.feedbar [data-line]');
    if (ln && C) { var q = ln.dataset.line.split(':'); showLine(q[0], q[1], false); return; }
    var b = e.target.closest('[data-feed],[data-open]'); if (!b || !C) return;
    if (b.dataset.open === 'stats') return openStats();
    if (b.dataset.open === 'match') return openMatch();
    var t = C.titleById(C.D().sel); if (!t) return;
    var D = C.D(); D.feed = D.feed || {};
    if (b.dataset.feed === 'standings') {
      var gid = $('#fdGroup').value; D.feed[t.id] = gid; C.saveData();
      var n = applyBinds(standingsValues(gid), false);
      C.toast('Таблица заполнена (' + n + ' полей)');
    } else if (b.dataset.feed === 'scorers') {
      var sc = { scope: $('#fdScope').value, from: +$('#fdFrom').value }; D.feed[t.id] = sc; C.saveData();
      var n2 = applyBinds(scorersValues(sc.scope, sc.from), false);
      C.toast('Бомбардиры заполнены (' + n2 + ' полей)');
    }
  });

  /* =================================================================== */
  /* Окно «Матч»                                                         */
  /* =================================================================== */
  function curMatch() {
    var D = C.D(), id = D && D.match && D.match.id;
    if (!id || !FHR.data) return null;
    return FHR.data.matches.filter(function (m) { return m.id === id; })[0] || null;
  }
  function matchLabel(m) {
    return '№' + (m.n || '?') + ' · ' + m.date + ' ' + m.time + ' · ' + m.home.name + ' ' + m.home.city + ' — ' + m.away.name + ' ' + m.away.city + (m.score ? ' · ' + m.score : '');
  }
  function openMatch() {
    if (!C.pkg()) return C.toast('Сначала выберите пакет', true);
    $('#matchDlg').hidden = false;
    var D = C.D(); D.match = D.match || {};
    loadIndex().then(function (l) {
      var slug = D.match.slug || FHR.slug || (l[0] && l[0].slug);
      $('#mTour').innerHTML = l.map(function (x) { return '<option value="' + esc(x.slug) + '"' + (x.slug === slug ? ' selected' : '') + '>' + esc(x.title) + '</option>'; }).join('') || '<option value="">— нет данных —</option>';
      return slug && (FHR.slug === slug && FHR.data ? FHR.data : loadTournament(slug));
    }).then(renderMatch).catch(function (e) { $('#mInfo').innerHTML = '<span class="st-bad">Нет данных турнира: ' + esc(e.message) + '</span>'; });
  }
  function renderMatch() {
    var d = FHR.data, D = C.D();
    if (!d) { $('#mInfo').textContent = 'Нет данных'; return; }
    $('#mUpdated').textContent = 'данные с сайта на ' + new Date(d.updated).toLocaleString('ru-RU') + ' · обновляются автоматически';
    var filt = ($('#mFilter').value || '').trim().toLowerCase();
    var byDate = {};
    d.matches.forEach(function (m) {
      if (filt && matchLabel(m).toLowerCase().indexOf(filt) < 0 && (m.groupName || '').toLowerCase().indexOf(filt) < 0) return;
      (byDate[m.date] = byDate[m.date] || []).push(m);
    });
    var dates = Object.keys(byDate).sort(function (a, b) { return a.split('.').reverse().join('').localeCompare(b.split('.').reverse().join('')); });
    $('#mMatch').innerHTML = '<option value="">— выберите матч (' + d.matches.length + ') —</option>' + dates.map(function (dt) {
      return '<optgroup label="' + esc(dt) + '">' + byDate[dt].map(function (m) {
        return '<option value="' + esc(m.id) + '"' + (D.match && D.match.id === m.id ? ' selected' : '') + '>' + esc(matchLabel(m) + ' · ' + m.groupName) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    renderMatchCard();
  }
  function renderMatchCard() {
    var D = C.D(), id = $('#mMatch').value, m = FHR.data && FHR.data.matches.filter(function (x) { return x.id === id; })[0];
    var box = $('#mCard');
    if (!m) { box.innerHTML = '<p class="hint">Матчи всех групп турнира. Выберите нужный — команды, логотипы, коды, арена, составы и тренеры разойдутся по всем титрам.</p>'; return; }
    var M = D.match && D.match.id === m.id ? D.match : {};
    var side = function (s) {
      var t = Object.assign({}, m[s], team(m[s].id) || {}), cnt = { G: 0, D: 0, F: 0 }, gm = gameOf(m.id), fromGame = hasLineup(gm, s);
      t.players = rosterOf(s, m);
      (t.players || []).forEach(function (p) { if (cnt[p.pos] != null) cnt[p.pos]++; });
      var hc = headCoach(t);
      return '<div class="mteam"><img src="' + esc(logoOf(t)) + '" alt=""><div><b>' + esc(t.name) + '</b> <span class="hint">' + esc(t.city) + '</span>' +
        '<div class="hint">' + (fromGame ? '<b class="st-ok">заявка на матч</b>' : (gm || !FHR.game ? 'заявки на матч ещё нет — ' : '') + 'состав команды') + ': вратарей ' + cnt.G + ', защитников ' + cnt.D + ', нападающих ' + cnt.F + (hc ? ' · гл. тренер ' + esc(personName(hc)) : '') + '</div>' +
        '<label class="inl">Код для табло <input data-abbr="' + s + '" maxlength="5" value="' + esc(M[s + 'Abbr'] || codeOf(t)) + '" style="width:80px"></label></div></div>';
    };
    if (!FHR.game || FHR.game.id !== m.id) { loadGame(m.id).then(function () { if ($('#mMatch').value === m.id) renderMatchCard(); }); }
    var mv = matchValues(m, {}), gm = gameOf(m.id);
    box.innerHTML = '<div class="mcard">' + side('home') + '<div class="mvs">' + esc(m.score || 'VS') + '<small>' + esc(m.date + ' ' + m.time) + '<br>' + esc(m.groupName) + '</small></div>' + side('away') + '</div>' +
      '<div class="grid2"><label>Турнир (титры «Итог», «Инфографика»)<input id="mTournament" value="' + esc(M.tournament != null ? M.tournament : mv.v.tournament) + '"></label>' +
      '<label>Место (арена)<input id="mPlace" value="' + esc(M.place != null ? M.place : mv.v.place) + '"></label></div>' +
      '<p class="hint">' + (gm && (gm.refs.main.length || gm.refs.line.length) ? 'Судьи: ' + esc(gm.refs.main.concat(gm.refs.line).map(personName).join(', ')) : 'Судьи на сайте ещё не указаны') + '</p>' +
      (mv.warn.length ? '<p class="hint st-warn">⚠ ' + mv.warn.map(esc).join('<br>⚠ ') + ' — лишние не попадут в титр состава, их можно поставить вручную.</p>' : '');
  }
  function applyMatch() {
    var id = $('#mMatch').value, m = FHR.data && FHR.data.matches.filter(function (x) { return x.id === id; })[0];
    if (!m) return C.toast('Выберите матч', true);
    if (!FHR.game || FHR.game.id !== m.id) return loadGame(m.id).then(applyMatch);
    var D = C.D();
    var opt = { homeAbbr: $('[data-abbr=home]').value.trim(), awayAbbr: $('[data-abbr=away]').value.trim(), tournament: $('#mTournament').value.trim(), place: $('#mPlace').value.trim() };
    // коды команд запоминаем для всех будущих матчей
    var X = cfgX().fhr.codes;
    if (opt.homeAbbr && opt.homeAbbr !== codeOf(m.home)) X[m.home.id] = opt.homeAbbr;
    if (opt.awayAbbr && opt.awayAbbr !== codeOf(m.away)) X[m.away.id] = opt.awayAbbr;
    C.saveCfg();
    var fresh = !D.match || D.match.id !== m.id;
    D.match = Object.assign({ id: m.id, slug: FHR.slug, group: m.group }, opt);
    if (fresh) { // новый матч — статистика с нуля, журнал событий пустой
      D.events = [];
      var stt = statTitle();
      if (stt) stt.statRows.forEach(function (r) { [r.f1, r.f2].forEach(function (k) { C.setVal(stt.id, fieldOf(stt, k), '0'); }); });
    }
    var mv = matchValues(m, opt);
    var vals = Object.assign({}, mv.v, standingsValues(m.group), scorersValues('all', 0));
    // звено: логотип хозяев и первое звено (если заявка уже есть)
    var lt = linesTitle();
    if (lt) {
      var lr = lineValues('home', unitsOf('home')[0]);
      Object.assign(vals, lr.err ? { 'ln.logo': logoOf(team(m.home.id)) } : lr.v);
      D.feed = D.feed || {}; D.feed[lt.id] = { side: 'home', unit: unitsOf('home')[0] };
    }
    D.feed = D.feed || {};
    C.pkg().titles.forEach(function (t) { if (t.feed === 'standings') D.feed[t.id] = m.group; if (t.feed === 'scorers') D.feed[t.id] = { scope: 'all', from: 0 }; });
    C.saveData();
    var n = applyBinds(vals, true);
    $('#matchDlg').hidden = true;
    matchPill();
    C.toast('Матч №' + m.n + ': заполнено полей — ' + n + (hasLineup(gameOf(m.id), 'home') ? ' · составы из заявки на матч' : ' · заявки на матч ещё нет — составы команд') + (mv.warn.length ? ' (есть замечания по составам)' : ''));
  }
  function matchPill() {
    var p = $('#pMatch'); if (!p) return;
    var m = curMatch();
    p.className = 'pill' + (m ? ' ok' : '');
    p.textContent = m ? 'МАТЧ №' + m.n + ': ' + (m.home.name + ' — ' + m.away.name).toUpperCase() : 'МАТЧ: —';
    renderGame();
  }

  /* коды команд списком */
  function openCodes() {
    var d = FHR.data; if (!d) return C.toast('Нет данных турнира', true);
    var X = cfgX().fhr.codes;
    $('#cList').innerHTML = Object.values(d.teams).sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); }).map(function (t) {
      return '<tr><td><img src="' + esc(logoOf(t)) + '" alt="" class="mini"></td><td>' + esc(t.name) + ' <span class="hint">' + esc(t.city) + '</span></td>' +
        '<td><input data-code="' + esc(t.id) + '" maxlength="5" value="' + esc(X[t.id] || '') + '" placeholder="' + esc((d.codes && d.codes[t.id]) || codeOf(t)) + '" style="width:90px"></td></tr>';
    }).join('');
    $('#codesDlg').hidden = false;
  }
  function parseCodesText(txt) {
    // строки вида «Динамо Москва — ДИН» / «ДИН Динамо Москва» / «Динамо Москва;ДИН»
    var d = FHR.data, X = cfgX().fhr.codes, n = 0;
    var teams = Object.values(d.teams);
    var norm = function (s) { return String(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); };
    String(txt).split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var m = /^(.*?)[\s;,\t—–-]+([A-ZА-ЯЁ0-9]{2,5})$/.exec(line) || /^([A-ZА-ЯЁ0-9]{2,5})[\s;,\t—–-]+(.*)$/.exec(line);
      if (!m) return;
      var name = /^[A-ZА-ЯЁ0-9]{2,5}$/.test(m[1]) ? m[2] : m[1], code = /^[A-ZА-ЯЁ0-9]{2,5}$/.test(m[1]) ? m[1] : m[2];
      var nn = norm(name);
      var best = teams.filter(function (t) { return norm(t.name + ' ' + t.city) === nn; })[0] ||
        teams.filter(function (t) { return nn.indexOf(norm(t.name)) >= 0 && nn.indexOf(norm(t.city)) >= 0; })[0] ||
        teams.filter(function (t) { return norm(t.name) === nn; })[0];
      if (best) { X[best.id] = code; n++; }
    });
    C.saveCfg();
    return n;
  }

  /* =================================================================== */
  /* Статистика                                                          */
  /* =================================================================== */
  function statTitle() { var p = C.pkg(); return p && p.titles.filter(function (t) { return t.statRows; })[0]; }
  function fieldOf(t, k) { return t.fields.filter(function (f) { return f.k === k; })[0]; }
  function openStats() {
    var t = statTitle(); if (!t) return C.toast('В пакете нет титра статистики', true);
    renderStats(); $('#statDlg').hidden = false;
  }
  function renderStats() {
    var t = statTitle(); if (!t) return;
    var g = function (k) { var f = fieldOf(t, k); return f ? C.getVal(t.id, f) : ''; };
    var a1 = valueOfBind('home.abbr') || 'ХОЗ', a2 = valueOfBind('away.abbr') || 'ГОС';
    var tf = fieldOf(t, 'Заголовок.Text');
    $('#sTitle').innerHTML = (tf.presets || []).map(function (p) { return '<option' + (g('Заголовок.Text') === p ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      ((tf.presets || []).indexOf(g('Заголовок.Text')) < 0 ? '<option selected>' + esc(g('Заголовок.Text')) + '</option>' : '');
    $('#sBody').innerHTML = '<tr><th></th><th>' + esc(a1) + '</th><th>' + esc(a2) + '</th></tr>' + t.statRows.map(function (r) {
      var cell = function (k, n) {
        var hk = H.hotkeyOf('stat:' + r.key + ':' + n);
        return '<td><div class="stc"><button class="btn pm" data-st="' + r.key + '" data-n="' + n + '" data-d="-1">−</button><input data-sk="' + esc(k) + '" value="' + esc(g(k)) + '">' +
          '<button class="btn pm" data-st="' + r.key + '" data-n="' + n + '" data-d="1">+</button>' + (hk ? '<span class="hk">' + esc(hk) + '</span>' : '') + '</div></td>';
      };
      return '<tr><td><b>' + esc(g(r.label)) + '</b></td>' + cell(r.f1, 1) + cell(r.f2, 2) + '</tr>';
    }).join('');
    var c = C.airChanOf(t.id);
    $('#sAir').textContent = c ? 'В ЭФИРЕ (канал ' + c + ') — правки уходят сразу' : 'не в эфире';
    $('#sAir').className = 'pill ' + (c ? 'ok' : '');
    $('#sTake').textContent = c ? 'OUT ◼ убрать титр' : 'IN ▶ титр в эфир';
  }
  function statSet(k, v) {
    var t = statTitle(), f = t && fieldOf(t, k); if (!f) return;
    C.setVal(t.id, f, String(v));
    C.pushLive([t.id]);
    C.updatePreview(false);
  }
  function statAdd(key, n, d) {
    var t = statTitle(); if (!t) return;
    var r = t.statRows.filter(function (x) { return x.key === key; })[0]; if (!r) return;
    var k = n == 1 ? r.f1 : r.f2, f = fieldOf(t, k), cur = parseInt(C.getVal(t.id, f), 10) || 0;
    statSet(k, Math.max(0, cur + d));
    if (!$('#statDlg').hidden) renderStats();
    if (C.D().sel === t.id) C.renderEditor();
  }

  /* =================================================================== */
  /* Горячие клавиши                                                     */
  /* =================================================================== */
  function comboOf(e) {
    var c = e.code || '', k;
    if (/^Key[A-Z]$/.test(c)) k = c.slice(3);
    else if (/^Digit\d$/.test(c)) k = c.slice(5);
    else if (/^Numpad/.test(c)) k = 'Num' + c.slice(6);
    else if (/^F\d+$/.test(c)) k = c;
    else if (c === 'Space') k = 'Пробел';
    else if (/^(Shift|Control|Alt|Meta)/.test(c) || !c) return '';
    else k = c.replace(/^Arrow/, '');
    return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.metaKey ? 'Cmd+' : '') + k;
  }
  function actions() {
    var pkg = C.pkg(), out = [
      { id: 'sel', name: 'Выбранный титр: IN / OUT' }, { id: 'clear', name: 'Снять всё' },
      { id: 'clock', name: 'Часы табло: старт / стоп' },
      { id: 'score1+', name: 'Счёт хозяев +1' }, { id: 'score1-', name: 'Счёт хозяев −1' },
      { id: 'score2+', name: 'Счёт гостей +1' }, { id: 'score2-', name: 'Счёт гостей −1' },
      { id: 'match', name: 'Окно «Матч»' }, { id: 'stats', name: 'Окно статистики' }
    ];
    var st = statTitle();
    if (st) st.statRows.forEach(function (r) {
      var lab = C.getVal(st.id, fieldOf(st, r.label));
      out.push({ id: 'stat:' + r.key + ':1', name: 'Статистика: ' + lab + ' хозяев +1' }, { id: 'stat:' + r.key + ':2', name: 'Статистика: ' + lab + ' гостей +1' });
    });
    if (st) [['shot', 'Бросок'], ['sog', 'Бросок в створ'], ['fo', 'Вбрасывание']].forEach(function (x) {
      out.push({ id: 'ev:' + x[0] + ':1', name: 'Панель: ' + x[1] + ' хозяев' }, { id: 'ev:' + x[0] + ':2', name: 'Панель: ' + x[1] + ' гостей' });
    });
    (pkg ? pkg.titles : []).forEach(function (t) { out.push({ id: 't:' + t.id, name: 'IN / OUT: ' + t.name }); });
    return out;
  }
  H.hotkeyOf = function (id) {
    var K = cfgX().keys;
    for (var c in K) if (K[c] === id) return c;
    return '';
  };
  var capturing = null;
  H.keydown = function (e, inField) {
    if (!C) return false;
    var combo = comboOf(e); if (!combo) return false;
    if (capturing) { // назначение клавиши в настройках
      if (e.code === 'Escape') { capturing = null; renderKeys(); return true; }
      var K = cfgX().keys;
      Object.keys(K).forEach(function (c) { if (K[c] === capturing) delete K[c]; });
      if (e.code !== 'Backspace' && e.code !== 'Delete') K[combo] = capturing;
      C.saveCfg(); capturing = null; renderKeys(); C.renderList();
      return true;
    }
    var act = cfgX().keys[combo]; if (!act) return false;
    // в полях ввода срабатывают только сочетания с Ctrl/Alt/Cmd и F-клавиши
    if (inField && !/^(Ctrl|Alt|Cmd)\+|^F\d+$/.test(combo)) return false;
    if (document.querySelector('.modal:not([hidden]):not(#statDlg)')) return false;
    doAction(act);
    return true;
  };
  function doAction(a) {
    var D = C.D(); if (!D) return;
    if (a === 'sel') { if (D.sel) C.toggle(D.sel); }
    else if (a === 'clear') C.clearAll();
    else if (a === 'match') openMatch();
    else if (a === 'stats') openStats();
    else if (a === 'clock') toggleClock();
    else if (/^score[12][+-]$/.test(a)) bumpScore(a[5], a[6] === '+' ? 1 : -1);
    else if (/^stat:/.test(a)) { var p = a.split(':'); statAdd(p[1], p[2], 1); }
    else if (/^ev:/.test(a)) { var q = a.split(':'); gameStat(q[1], q[2] === '1' ? 'home' : 'away', 1); }
    else if (/^t:/.test(a)) C.toggle(a.slice(2));
  }
  function groupTitleField(g) {
    var x = C.fieldIdx()[g]; if (!x) return null;
    var t = C.titleById(x.titles[0]); return { t: t, f: t.fields.filter(function (y) { return y.g === g; })[0], tids: x.titles };
  }
  function setGroup(g, v) {
    var x = C.fieldIdx()[g]; if (!x) return;
    x.titles.forEach(function (id) { var t = C.titleById(id); C.setVal(id, t.fields.filter(function (y) { return y.g === g; })[0], v); });
    C.pushLive(x.titles); C.updatePreview(false);
    if (x.titles.indexOf(C.D().sel) >= 0) C.renderEditor();
  }
  function bumpScore(n, d) {
    var g = C.autoGroup(n === '1' ? 'HomeScore' : 'AwayScore'); if (!g) return C.toast('Нет поля счёта', true);
    var x = groupTitleField(g), cur = String(C.getVal(x.t.id, x.f)), v = Math.max(0, (parseInt(cur, 10) || 0) + d);
    setGroup(g, C.padLike(String(v), x.f.def));
  }
  function clockGroup() {
    var p = C.pkg(); if (!p) return null;
    for (var i = 0; i < p.titles.length; i++) {
      var f = p.titles[i].fields.filter(function (y) { return y.clock; })[0];
      if (f) return f.g;
    }
    return C.autoGroup('Clock');
  }
  function toggleClock() {
    var g = clockGroup(); if (!g) return C.toast('Нет поля часов', true);
    var x = groupTitleField(g), v = C.getVal(x.t.id, x.f), now = CG.clock.now(), tm;
    if (C.isTimer(v)) tm = Object.assign({}, v.tm);
    else { var ms = C.parseTime(v) || 0; tm = { ms: ms, ms0: ms, run: false, at: 0, dir: -1, fmt: C.fmtLike(v) }; }
    if (tm.run) { tm.ms = GTRender.timerMs(tm, now); tm.run = false; tm.at = 0; } else { tm.run = true; tm.at = now; }
    setGroup(g, { tm: tm });
  }
  function renderKeys() {
    var K = cfgX().keys;
    $('#kList').innerHTML = actions().map(function (a) {
      var c = H.hotkeyOf(a.id);
      return '<tr><td>' + esc(a.name) + '</td><td><button class="btn sm keybtn' + (capturing === a.id ? ' take' : '') + '" data-key="' + esc(a.id) + '">' +
        (capturing === a.id ? 'нажмите клавишу… (Esc — отмена, Delete — убрать)' : c ? esc(c) : '— назначить —') + '</button></td></tr>';
    }).join('');
  }

  /* =================================================================== */
  /* Удаления: таймер, синхронно с часами табло, автоуход                */
  /* =================================================================== */
  function penaltyFields(t) { return t.fields.filter(function (f) { return f.penalty; }); }
  function clockRunning() {
    var g = clockGroup(); if (!g) return null;
    var x = groupTitleField(g), v = C.getVal(x.t.id, x.f);
    return C.isTimer(v) ? !!v.tm.run : null;
  }
  H.beforeTake = function (tid) {
    var t = C.titleById(tid); if (!t) return;
    if (t.feed === 'lines') { // звено: данные текущего звена (логотип — всегда) и пролистывание до последнего
      var D = C.D(), f = (D.feed || {})[t.id] || { side: 'home', unit: unitsOf('home')[0] };
      var r = lineValues(f.side, f.unit), M = curMatch();
      if (!r.err) applyBinds(r.v, false);
      else if (M) applyBinds({ 'ln.logo': logoOf(team(M[f.side].id)) }, false);
      if (!r.err) startCycle(f.side, f.unit); else stopCycle();
    }
    penaltyFields(t).forEach(function (f) {
      var v = C.getVal(t.id, f), now = CG.clock.now(), tm;
      if (C.isTimer(v)) tm = Object.assign({}, v.tm);
      else { var ms = C.parseTime(v); if (ms == null) ms = 120000; tm = { ms: ms, ms0: ms, dir: -1, fmt: 'mm:ss' }; }
      if (!(GTRender.timerMs(tm, now) > 0)) tm.ms = tm.ms0 || 120000;
      else tm.ms = GTRender.timerMs(tm, now);
      var cr = clockRunning();
      tm.run = cr === null ? true : cr; tm.at = tm.run ? now : 0;
      C.setVal(t.id, f, { tm: tm });
    });
  };
  var lastClock = null;
  setInterval(function () {
    if (!C || !C.pkg()) return;
    var air = C.air(), now = CG.clock.now(), cr = clockRunning(), changed = [];
    Object.keys(air).forEach(function (c) {
      var a = air[c], t = a && C.titleById(a.t); if (!t) return;
      penaltyFields(t).forEach(function (f) {
        var v = C.getVal(t.id, f); if (!C.isTimer(v)) return;
        var tm = Object.assign({}, v.tm), left = GTRender.timerMs(tm, now);
        if (tm.run && left <= 0) { // удаление закончилось — титр уходит, таймер готов к следующему разу
          C.setVal(t.id, f, { tm: Object.assign(tm, { ms: tm.ms0 || 120000, run: false, at: 0 }) });
          C.out(c);
          C.toast(t.name + ': время удаления вышло — титр убран');
          return;
        }
        if (cr !== null && cr !== !!tm.run && cr !== lastClock) { // часы табло пошли/встали — удаление тоже
          tm.ms = left; tm.run = cr; tm.at = cr ? now : 0;
          C.setVal(t.id, f, { tm: tm }); changed.push(t.id);
        }
      });
    });
    lastClock = cr;
    if (changed.length) C.pushLive(changed);
  }, 200);


  /* =================================================================== */
  /* Панель матча под мониторами: статистика и события по командам      */
  /* =================================================================== */
  var PEN_TYPES = ['ПОДНОЖКА', 'ЗАДЕРЖКА', 'ЗАДЕРЖКА КЛЮШКОЙ', 'ЗАДЕРЖКА КЛЮШКИ СОПЕРНИКА', 'УДАР КЛЮШКОЙ', 'ТОЛЧОК КЛЮШКОЙ', 'ОТСЕЧЕНИЕ',
    'БЛОКИРОВКА', 'ГРУБОСТЬ', 'ТОЛЧОК НА БОРТ', 'АТАКА В ГОЛОВУ И ШЕЮ', 'УДАР ЛОКТЕМ', 'УДАР КОЛЕНОМ', 'ИГРА ВЫСОКО ПОДНЯТОЙ КЛЮШКОЙ',
    'КОЛЮЩИЙ УДАР', 'УДАР КОНЦОМ КЛЮШКИ', 'АТАКА ВРАТАРЯ', 'СДВИГ ВОРОТ', 'ЗАДЕРЖКА ИГРЫ', 'ВЫБРОС ШАЙБЫ', 'НАРУШЕНИЕ ЧИСЛЕННОГО СОСТАВА',
    'ИГРА РУКОЙ', 'НЕСПОРТИВНОЕ ПОВЕДЕНИЕ', 'ДРАКА', 'СИМУЛЯЦИЯ', 'ПРЕРЫВАНИЕ ИГРЫ'];
  var SIDE_N = { home: 1, away: 2 };
  function sideTitle(side, test) {
    var p = C.pkg(); if (!p) return null;
    return p.titles.filter(function (t) { return t.side === side && test(t); })[0] || null;
  }
  function golTitle(side) { return sideTitle(side, function (t) { return !!fieldOf(t, 'Имя Игрока.Text') && !!fieldOf(t, 'Ассистент 1.Text'); }); }
  function penTitle(side) { return sideTitle(side, function (t) { return penaltyFields(t).length > 0; }); }
  function playerTitle(side) { return sideTitle(side, function (t) { return !!fieldOf(t, 'Имя игрока.Text') && !!fieldOf(t, 'Роль игрока.Text'); }); }
  function setF(t, k, v, touched) {
    var f = t && fieldOf(t, k); if (!f) return;
    C.setVal(t.id, f, v);
    if (touched.indexOf(t.id) < 0) touched.push(t.id);
  }
  function statVal(key, n) {
    var t = statTitle(); if (!t) return '';
    var r = t.statRows.filter(function (x) { return x.key === key; })[0]; if (!r) return '';
    return C.getVal(t.id, fieldOf(t, n == 1 ? r.f1 : r.f2));
  }
  function scoreVal(n) {
    var g = C.autoGroup(n == 1 ? 'HomeScore' : 'AwayScore'), x = g && groupTitleField(g);
    return x ? String(C.getVal(x.t.id, x.f)) : '';
  }
  function players(side) { return H.pickList(side + '.players') || []; }
  function gameOn() { var p = C && C.pkg(); return !!(p && p.features && p.features.match === 'fhr'); }
  function logEvent(side, txt) {
    var D = C.D(); D.events = D.events || [];
    var clk = H.presetValue('clock') || '';
    D.events.push({ side: side, t: clk, txt: txt, at: Date.now() });
    if (D.events.length > 200) D.events = D.events.slice(-200);
    C.saveData();
  }
  function plOptions(side, empty) {
    var l = players(side);
    if (!l.length) return '<option value="">— нет состава: выберите матч —</option>';
    return (empty ? '<option value="">' + empty + '</option>' : '') + l.map(function (it, i) { return '<option value="' + i + '">' + esc(it.label) + '</option>'; }).join('');
  }
  function renderGame() {
    var box = $('#game'); if (!box) return;
    var on = gameOn();
    box.hidden = !on; document.body.classList.toggle('gamepanel', on);
    if (!on) return;
    var M = curMatch();
    box.innerHTML = ['home', 'away'].map(function (side) {
      var n = SIDE_N[side], tm = M && team(M[side] && M[side].id);
      var name = tm ? up(tm.name) : (side === 'home' ? 'ХОЗЯЕВА' : 'ГОСТИ');
      var st = function (ev, lab, title) {
        var hk = H.hotkeyOf('ev:' + ev + ':' + n);
        return '<div class="gst"><button class="btn gbig" data-ev="' + ev + '" data-side="' + side + '" title="' + esc(title) + '">' + lab +
          (hk ? ' <span class="hk">' + esc(hk) + '</span>' : '') + '</button><button class="btn sm gundo" data-undo="' + ev + '" data-side="' + side + '" title="Отменить: −1">−1</button></div>';
      };
      return '<div class="gside ' + side + '" data-side="' + side + '">' +
        '<div class="ghead">' + (tm && logoOf(tm) ? '<img class="mini" src="' + esc(logoOf(tm)) + '">' : '') +
        '<b>' + esc(name) + '</b><span class="gscore" data-gs="' + n + '"></span><span class="gstat" data-gstat="' + n + '"></span></div>' +
        '<div class="grow">' + st('shot', 'БРОСОК', 'Броски +1') + st('sog', 'В СТВОР', 'Броски +1 и броски в створ +1') + st('fo', 'ВБРАСЫВАНИЕ', 'Выигранные вбрасывания +1') + '</div>' +
        '<div class="grow">' +
        '<button class="btn gbig goal" data-open="goal" data-side="' + side + '">🚨 ГОЛ</button>' +
        '<button class="btn gbig pen" data-open="pen" data-side="' + side + '">⛔ УДАЛЕНИЕ</button></div>' +
        (linesTitle() ? '<div class="grow glines"><span class="hint">ЗВЕНО</span>' + unitsOf(side).map(function (u) {
          return '<button class="btn gln" data-ln="' + u + '" data-side="' + side + '" title="Звено ' + u + ': заполнить и в эфир (повторно — убрать)">' + u + '</button>';
        }).join('') + '</div>' : '') +
        '<div class="gform" data-form="goal" data-side="' + side + '" hidden>' +
        '<label>Автор гола<select data-g="author">' + plOptions(side) + '</select></label>' +
        '<div class="g2"><label>Ассистент 1<select data-g="a1">' + plOptions(side, '— нет —') + '</select></label>' +
        '<label>Ассистент 2<select data-g="a2">' + plOptions(side, '— нет —') + '</select></label></div>' +
        '<div class="row"><label class="tog"><input type="checkbox" data-g="score" checked> счёт +1</label><span style="flex:1"></span>' +
        '<button class="btn" data-close="goal">Отмена</button><button class="btn take" data-do="goal" data-side="' + side + '">ГОЛ ▶ В ЭФИР</button></div></div>' +
        '<div class="gform" data-form="pen" data-side="' + side + '" hidden>' +
        '<label>Игрок<select data-g="pl">' + plOptions(side) + '<option value="team">КОМАНДНЫЙ ШТРАФ</option></select></label>' +
        '<div class="g2"><label>Время<select data-g="min"><option value="2">2:00</option><option value="4">4:00</option><option value="5">5:00</option></select></label>' +
        '<label>Нарушение<select data-g="type">' + PEN_TYPES.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="row"><span class="hint" style="margin:0;flex:1">Таймер — в «доп. инфу», штраф +2/+4/+5 — в статистику</span>' +
        '<button class="btn" data-close="pen">Отмена</button><button class="btn take" data-do="pen" data-side="' + side + '">УДАЛЕНИЕ ▶ В ЭФИР</button></div></div>' +
        '<div class="glog" data-glog="' + side + '"></div>' +
        '</div>';
    }).join('');
    updateGame();
  }
  function updateGame() {
    if (!gameOn() || $('#game').hidden) return;
    [1, 2].forEach(function (n) {
      var s = $('[data-gs="' + n + '"]'); if (s) s.textContent = scoreVal(n);
      var g = $('[data-gstat="' + n + '"]');
      if (g) g.textContent = 'Б ' + (statVal('shots', n) || 0) + ' · СТВ ' + (statVal('sog', n) || 0) + ' · ВБР ' + (statVal('fo', n) || 0) + ' · ШТР ' + (statVal('pim', n) || 0);
    });
    var lt = linesTitle(), lf = lt && C.airChanOf(lt.id) ? (C.D().feed || {})[lt.id] : null;
    document.querySelectorAll('.gln').forEach(function (b) { b.classList.toggle('onair', !!(lf && lf.side === b.dataset.side && lf.unit === b.dataset.ln)); });
    var ev = C.D().events || [];
    ['home', 'away'].forEach(function (side) {
      var b = $('[data-glog="' + side + '"]'); if (!b) return;
      var h = ev.filter(function (e) { return e.side === side; }).slice(-3).reverse().map(function (e) {
        return '<div>' + (e.t ? '<b>' + esc(e.t) + '</b> ' : '') + esc(e.txt) + '</div>';
      }).join('');
      if (b.innerHTML !== h) b.innerHTML = h;
    });
  }
  function gameStat(ev, side, d) {
    var n = SIDE_N[side];
    if (ev === 'shot') statAdd('shots', n, d);
    else if (ev === 'sog') { statAdd('shots', n, d); statAdd('sog', n, d); }
    else if (ev === 'fo') statAdd('fo', n, d);
    updateGame();
  }
  function doGoal(side) {
    var form = $('.gform[data-form=goal][data-side=' + side + ']'), l = players(side), t = golTitle(side);
    if (!t) return C.toast('В пакете нет титра автора гола', true);
    var g = function (k) { return form.querySelector('[data-g=' + k + ']'); };
    var au = l[+g('author').value], a1 = l[+g('a1').value], a2 = l[+g('a2').value];
    if (g('a1').value === '') a1 = null; if (g('a2').value === '') a2 = null;
    if (!au) return C.toast('Выберите автора гола', true);
    var touched = [];
    setF(t, 'Номер игрока.Text', H.pickFormat(au, 'num'), touched);
    setF(t, 'Имя Игрока.Text', H.pickFormat(au, 'name'), touched);
    setF(t, 'Ассистент 1.Text', a1 ? H.pickFormat(a1, 'name num') : '', touched);
    setF(t, 'Ассистент 2.Text', a2 ? H.pickFormat(a2, 'name num') : '', touched);
    var clk = H.presetValue('clock'); if (clk) setF(t, 'Время доп..Text', clk, touched);
    if (g('score').checked) bumpScore(String(SIDE_N[side]), 1);
    C.pushLive(touched);
    C.take(t.id);
    logEvent(side, 'ГОЛ: №' + H.pickFormat(au, 'num name') + (a1 || a2 ? ' (' + [a1, a2].filter(Boolean).map(function (x) { return H.pickFormat(x, 'name'); }).join(', ') + ')' : ''));
    form.hidden = true;
    if (C.D().sel === t.id) C.renderEditor();
    C.updatePreview(false); updateGame();
  }
  function doPenalty(side) {
    var form = $('.gform[data-form=pen][data-side=' + side + ']'), l = players(side), t = penTitle(side);
    if (!t) return C.toast('В пакете нет титра удаления', true);
    var g = function (k) { return form.querySelector('[data-g=' + k + ']'); };
    var min = +g('min').value || 2, type = g('type').value, pv = g('pl').value, pl = pv === 'team' ? null : l[+pv];
    var touched = [];
    penaltyFields(t).forEach(function (f) { C.setVal(t.id, f, '0' + min + ':00'); });
    touched.push(t.id);
    statAdd('pim', SIDE_N[side], min);
    // игрок и нарушение — в титр игрока этой команды (выдать в эфир можно из списка)
    var pt = playerTitle(side), who = pl ? '№' + H.pickFormat(pl, 'num name') : 'КОМАНДНЫЙ ШТРАФ';
    if (pt && pl) {
      setF(pt, 'Номер.Text', H.pickFormat(pl, 'num'), touched);
      setF(pt, 'Имя игрока.Text', H.pickFormat(pl, 'name'), touched);
      setF(pt, 'Роль игрока.Text', 'УДАЛЕНИЕ ' + min + ' МИН · ' + type, touched);
    }
    C.pushLive(touched);
    C.take(t.id);
    logEvent(side, 'УДАЛЕНИЕ ' + min + ' МИН: ' + who + ' — ' + type.toLowerCase());
    form.hidden = true;
    if (touched.indexOf(C.D().sel) >= 0) C.renderEditor();
    C.updatePreview(false); updateGame();
  }
  function gameClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    var side = b.dataset.side || (b.closest('.gside') && b.closest('.gside').dataset.side);
    if (b.dataset.ln) showLine(side, b.dataset.ln, true);
    else if (b.dataset.ev) gameStat(b.dataset.ev, side, 1);
    else if (b.dataset.undo) gameStat(b.dataset.undo, side, -1);
    else if (b.dataset.open) {
      var f = $('.gform[data-form=' + b.dataset.open + '][data-side=' + side + ']'), was = f.hidden;
      document.querySelectorAll('.gside[data-side=' + side + '] .gform').forEach(function (x) { x.hidden = true; });
      f.hidden = !was;
    }
    else if (b.dataset.close) b.closest('.gform').hidden = true;
    else if (b.dataset.do === 'goal') doGoal(side);
    else if (b.dataset.do === 'pen') doPenalty(side);
  }
  setInterval(function () { if (C && C.pkg()) updateGame(); }, 500);

  /* =================================================================== */
  /* Разметка окон и запуск                                              */
  /* =================================================================== */
  function injectUi() {
    var top = $('.tact');
    var mb = document.createElement('button'); mb.className = 'btn'; mb.id = 'btnMatch'; mb.textContent = '🏒 Матч'; mb.title = 'Выбор матча из календаря турнира — данные по всем титрам';
    var sb = document.createElement('button'); sb.className = 'btn'; sb.id = 'btnStats'; sb.textContent = '📈 Статистика'; sb.title = 'Ведение статистики матча';
    top.insertBefore(sb, top.firstChild); top.insertBefore(mb, top.firstChild);
    var pill = document.createElement('span'); pill.className = 'pill'; pill.id = 'pMatch'; pill.textContent = 'МАТЧ: —'; pill.style.cursor = 'pointer';
    $('.pills').appendChild(pill);
    document.body.insertAdjacentHTML('beforeend',
      '<div class="modal" id="matchDlg" hidden><div class="dlg wide"><h2>🏒 Матч</h2>' +
      '<div class="row"><label style="flex:1">Турнир<select id="mTour"></select></label><button class="btn" id="mRefresh" title="Обновить данные с junior.fhr.ru (с server.js)">⟳ Обновить с сайта</button><button class="btn" id="mCodes">Коды команд…</button></div>' +
      '<p class="hint" id="mUpdated"></p>' +
      '<div class="row"><input id="mFilter" placeholder="Поиск: команда, №, дата, группа" style="flex:0 0 260px"><select id="mMatch" style="flex:1;min-width:0"></select></div>' +
      '<div id="mCard"></div><div id="mInfo" class="hint"></div>' +
      '<div class="row"><label class="inl">Имена <select id="mNameFmt"><option value="fl">ИМЯ ФАМИЛИЯ</option><option value="lf">ФАМИЛИЯ ИМЯ</option><option value="il">И. ФАМИЛИЯ</option></select></label></div>' +
      '<div class="row end"><button class="btn" id="mClose">Закрыть</button><button class="btn take big" id="mApply">Заполнить титры</button></div></div></div>' +
      '<div class="modal" id="codesDlg" hidden><div class="dlg"><h2>Коды команд для табло</h2><p class="hint">До 5 знаков. Пустое поле — код с сайта ФХР (серым). Можно вставить список строк «Динамо Москва — ДИН».</p>' +
      '<div class="wrapdata"><table class="data"><tbody id="cList"></tbody></table></div>' +
      '<textarea id="cPaste" rows="4" placeholder="Динамо Москва — ДИН&#10;Локомотив-2004 Ярославль — ЛОК" style="width:100%;margin-top:10px"></textarea>' +
      '<div class="row end"><button class="btn" id="cParse">Разобрать список</button><button class="btn take" id="cSave">Готово</button></div></div></div>' +
      '<div class="modal" id="statDlg" hidden><div class="dlg"><h2>📈 Статистика матча <span class="pill" id="sAir"></span></h2>' +
      '<label>Заголовок титра<select id="sTitle"></select></label>' +
      '<table class="data stat"><tbody id="sBody"></tbody></table>' +
      '<p class="hint">+1 и −1 сразу уходят в титр (и в эфир, если он там). Клавиши назначаются в ⚙ Настройках.</p>' +
      '<div class="row end"><button class="btn danger" id="sZero">Обнулить</button><button class="btn" id="sTake">IN</button><button class="btn take" id="sClose">Готово</button></div></div></div>');
    // блок горячих клавиш в настройках
    var sd = $('#settings .dlg'), anchor = $('#settings .row.end');
    var kh = document.createElement('div');
    kh.innerHTML = '<h3>Горячие клавиши</h3><p class="hint">Нажмите кнопку и затем клавишу или сочетание. Работают, когда курсор не в поле ввода (сочетания с Ctrl/Alt/Cmd и F1–F12 — всегда). Хранятся в этом браузере.</p>' +
      '<div class="wrapdata" style="max-height:300px"><table class="data"><tbody id="kList"></tbody></table></div><div class="row"><button class="btn danger sm" id="kReset">Сбросить все клавиши</button></div>';
    sd.insertBefore(kh, anchor);
    var gp = document.createElement('div'); gp.className = 'game'; gp.id = 'game'; gp.hidden = true;
    var mons = $('.monitors'); mons.parentNode.insertBefore(gp, mons.nextSibling);
    gp.addEventListener('click', gameClick);

    $('#btnMatch').addEventListener('click', openMatch);
    $('#btnStats').addEventListener('click', openStats);
    pill.addEventListener('click', openMatch);
    $('#mClose').addEventListener('click', function () { $('#matchDlg').hidden = true; });
    $('#mApply').addEventListener('click', applyMatch);
    $('#mMatch').addEventListener('change', renderMatchCard);
    $('#mFilter').addEventListener('input', renderMatch);
    $('#mTour').addEventListener('change', function (e) { loadTournament(e.target.value).then(renderMatch).catch(function (er) { C.toast(er.message, true); }); });
    $('#mNameFmt').addEventListener('change', function (e) { cfgX().fhr.nameFmt = e.target.value; C.saveCfg(); renderMatchCard(); });
    $('#mRefresh').addEventListener('click', function () {
      var b = this; b.disabled = true; b.textContent = 'Обновляю…';
      refreshNow($('#mTour').value || FHR.slug || 'kubokrossii-25008909').then(function () { renderMatch(); C.toast('Данные обновлены'); })
        .catch(function (e) { C.toast(e.message, true); }).then(function () { b.disabled = false; b.textContent = '⟳ Обновить с сайта'; });
    });
    $('#mCodes').addEventListener('click', openCodes);
    $('#cParse').addEventListener('click', function () { var n = parseCodesText($('#cPaste').value); C.toast('Распознано кодов: ' + n); openCodes(); });
    $('#cSave').addEventListener('click', function () {
      var X = cfgX().fhr.codes;
      document.querySelectorAll('[data-code]').forEach(function (i) { var v = i.value.trim().toUpperCase(); if (v) X[i.dataset.code] = v.slice(0, 5); else delete X[i.dataset.code]; });
      C.saveCfg(); $('#codesDlg').hidden = true; renderMatchCard();
    });
    $('#sClose').addEventListener('click', function () { $('#statDlg').hidden = true; });
    $('#sTake').addEventListener('click', function () { var t = statTitle(); if (t) { C.toggle(t.id); renderStats(); } });
    $('#sZero').addEventListener('click', function () {
      var t = statTitle(); if (!t || !confirm('Обнулить всю статистику?')) return;
      t.statRows.forEach(function (r) { [r.f1, r.f2].forEach(function (k) { C.setVal(t.id, fieldOf(t, k), '0'); }); });
      C.pushLive([t.id]); C.updatePreview(false); renderStats();
    });
    $('#sTitle').addEventListener('change', function (e) { statSet('Заголовок.Text', e.target.value); });
    $('#sBody').addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (b) statAdd(b.dataset.st, b.dataset.n, +b.dataset.d); });
    $('#sBody').addEventListener('change', function (e) { var i = e.target.closest('[data-sk]'); if (i) statSet(i.dataset.sk, i.value.trim()); });
    $('#btnSettings').addEventListener('click', function () { capturing = null; renderKeys(); });
    $('#kList').addEventListener('click', function (e) { var b = e.target.closest('[data-key]'); if (!b) return; capturing = b.dataset.key; renderKeys(); });
    $('#kReset').addEventListener('click', function () { if (confirm('Сбросить все горячие клавиши?')) { cfgX().keys = {}; C.saveCfg(); renderKeys(); C.renderList(); } });
  }

  H.pkgOpened = function (p) {
    matchPill();
    renderGame();
    if (!(p.features && p.features.match === 'fhr')) { $('#btnMatch').hidden = true; $('#btnStats').hidden = !statTitle(); $('#pMatch').hidden = true; return; }
    $('#btnMatch').hidden = false; $('#btnStats').hidden = false; $('#pMatch').hidden = false;
    var D = C.D(), slug = (D.match && D.match.slug) || 'kubokrossii-25008909';
    loadIndex().then(function (l) { if (!l.some(function (x) { return x.slug === slug; }) && l[0]) slug = l[0].slug; return loadTournament(slug); })
      .then(function () { var M = curMatch(); return M ? loadGame(M.id) : null; })
      .then(function () { matchPill(); C.renderEditor(); }).catch(function () {});
  };

  function start() {
    C = window.__gtc;
    if (!C) { setTimeout(start, 50); return; }
    cfgX();
    injectUi();
    $('#mNameFmt').value = cfgX().fhr.nameFmt;
    if (C.pkg()) H.pkgOpened(C.pkg());
  }
  window.__gtcX = { matchValues: matchValues, standingsValues: standingsValues, scorersValues: scorersValues, applyBinds: applyBinds, FHR: FHR, doAction: doAction, comboOf: comboOf };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
