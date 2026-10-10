#!/usr/bin/env node
/*!
 * GT Web CG · tools/fhr-sync.js — данные турнира с junior.fhr.ru для титров.
 *
 *   node tools/fhr-sync.js [турнир] [папка]
 *     турнир — часть адреса, по умолчанию kubokrossii-25008909
 *     папка  — куда писать, по умолчанию data/fhr рядом с репозиторием
 *
 * Результат: <папка>/<турнир>.json и логотипы <папка>/logos/<id команды>.webp
 *   { updated, tournament, groups[], matches[], standings{group:[]}, scorers{group|all:[]}, teams{id:{…, players[], staff[]}}, codes{id:'ДИН'} }
 * и страницы матчей <папка>/games/<id>.json — заявка на матч (со звеньями, ОВ/ЗВ, К/А) и судьи:
 *   { id, updated, refs:{main:[{last,first}], line:[…]}, home:{players:[{num,last,first,pos,unit,cap}]}, away:{…} }
 *
 * Сайт отдаёт страницы целиком (Bitrix) и куски через /fhr-ajax/… — их и разбираем.
 * Запускается GitHub Action по расписанию (облако) и server.js по кнопке в пульте (локально).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('./vendor/node-html-parser.js');

const SITE = 'https://junior.fhr.ru';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 GT-Web-CG';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, kind) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url.startsWith('http') ? url : SITE + url, { headers: { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest' } });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return kind === 'buf' ? Buffer.from(await r.arrayBuffer()) : kind === 'json' ? await r.json() : await r.text();
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw last;
}

const clean = (s) => String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const txt = (el) => clean(el ? el.text : '');
const idFromLogo = (src) => { const m = /\/(\d+)\.\w+(?:\?.*)?$/.exec(src || ''); return m ? m[1] : ''; };
const idFromSlug = (href) => { const m = /_(\d+)\/?$/.exec(href || ''); return m ? m[1] : ''; };

/** PHP serialize → объект (только строки/числа/булевы — больше на сайте нет) */
function phpParams(b64) {
  const s = Buffer.from(decodeURIComponent(b64), 'base64').toString('utf8');
  const o = {}; const re = /s:\d+:"(\w+)";(?:s:\d+:"([^"]*)"|i:(-?\d+)|b:(\d))/g; let m;
  while ((m = re.exec(s))) o[m[1]] = m[2] != null ? m[2] : m[3] != null ? +m[3] : m[4] === '1';
  return o;
}
function ajaxUrl(component, params, extra) {
  const ser = 'a:' + Object.keys(params).length + ':{' + Object.keys(params).map((k) => {
    const v = params[k];
    const key = 's:' + Buffer.byteLength(k) + ':"' + k + '";';
    if (typeof v === 'boolean') return key + 'b:' + (v ? 1 : 0) + ';';
    const sv = String(v); return key + 's:' + Buffer.byteLength(sv) + ':"' + sv + '";';
  }).join('') + '}';
  return '/fhr-ajax/SXRwcm9maXRcQXBwXEFqYXhcQWpheENvbXBvbmVudA==/cmVuZGVyQ29tcG9uZW50/?component=' + encodeURIComponent(component) +
    '&template=.default&params=' + encodeURIComponent(Buffer.from(ser).toString('base64')) + (extra || '');
}

/* ---------------- разбор ---------------- */
function parseGroups(html) {
  const doc = parse(html);
  const out = [];
  doc.querySelectorAll('.filter-btn[data-ajax-link]').forEach((b) => {
    const link = b.getAttribute('data-ajax-link').replace(/&amp;/g, '&');
    const pm = /(?:params|¶ms)=([^&]+)/.exec(link); if (!pm) return; // «&para» парсер превращает в ¶
    const p = phpParams(pm[1]);
    if (!p.GROUP_ID || p.GROUP_ID === 'all') return;
    if (!out.some((g) => g.id === p.GROUP_ID)) out.push({ id: String(p.GROUP_ID), name: txt(b), tid: String(p.TOURNAMENT_ID), year: String(p.YEAR_ID) });
  });
  const title = txt(doc.querySelector('h2')) || txt(doc.querySelector('h1'));
  const season = (/season=(\d{4}-\d{4})/.exec(html) || [])[1] || '';
  return { groups: out, title, season };
}

function teamCell(td) {
  const img = td.querySelector('img');
  const logo = img ? img.getAttribute('src') : '';
  return { id: idFromLogo(logo), name: txt(td.querySelector('.team-title')), city: txt(td.querySelector('.team-city')), logo };
}
function parseCalendar(html, group) {
  const doc = parse(html), out = [];
  doc.querySelectorAll('table tbody tr').forEach((tr) => {
    const td = tr.querySelectorAll('td'); if (td.length < 6) return;
    const a = tr.querySelector('a[href*="/games/"]');
    const date = txt(td[1].querySelector('.date')), time = txt(td[1].querySelector('.time')).replace(/\s*МСК/i, '');
    const score = txt(td[4]).replace(/\s+/g, '');
    out.push({
      n: +txt(td[0]) || null, id: a ? (/games\/(\d+)/.exec(a.getAttribute('href')) || [])[1] : '',
      date, time, group: group.id, groupName: group.name,
      home: teamCell(td[2]), away: teamCell(td[3]),
      score: /\d/.test(score) ? score : '', arena: txt(td[5])
    });
  });
  return out;
}
const STAND_KEYS = ['pos', 'team', 'gp', 'w', 'wo', 'wb', 'lb', 'lo', 'l', 'gf', 'ga', 'diff', 'pts'];
function parseStandings(html) {
  const doc = parse(html), out = [];
  const t = doc.querySelector('table.table'); if (!t) return out;
  t.querySelectorAll('tbody tr').forEach((tr) => {
    const td = tr.querySelectorAll('td'); if (td.length < 13) return;
    const r = {};
    STAND_KEYS.forEach((k, i) => { if (k !== 'team') r[k] = txt(td[i]); });
    const img = td[1].querySelector('img'), a = td[1].querySelector('a');
    r.logo = img ? img.getAttribute('src') : '';
    r.id = idFromLogo(r.logo) || idFromSlug(a && a.getAttribute('href'));
    r.name = txt(td[1].querySelector('.team-title')) || txt(td[1]);
    r.city = txt(td[1].querySelector('.team-city'));
    r.slug = a ? a.getAttribute('href').replace(/^.*\//, '').replace(/^/, '') : '';
    if (a) r.slug = a.getAttribute('href').split('/').filter(Boolean).pop();
    out.push(r);
  });
  return out;
}
function parseTeamLinks(html, tslug) {
  const doc = parse(html), out = {};
  doc.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href');
    const m = new RegExp('^/tournaments/' + tslug + '/([a-z0-9-]+_(\\d+))/?$').exec(h);
    if (m) out[m[2]] = { slug: m[1], name: txt(a) };
  });
  return out;
}
/** Коды команд (ДИН, Л04, …) из ленты матчей сверху страницы */
function parseCodes(html, codes) {
  parse(html).querySelectorAll('a.match-card').forEach((c) => {
    ['.box-left', '.box-right'].forEach((side) => {
      const b = c.querySelector(side); if (!b) return;
      const id = idFromLogo(b.querySelector('img') && b.querySelector('img').getAttribute('src'));
      const code = txt(b.querySelector('.name'));
      if (id && code && !codes[id]) codes[id] = code;
    });
  });
}
const POS = { 'Вратарь': 'G', 'Защитник': 'D', 'Нападающий': 'F' };
function splitName(full) {
  const p = clean(full).split(' ');
  return { last: p[0] || '', first: p[1] || '', middle: p.slice(2).join(' ') };
}
function parseTeam(html) {
  const doc = parse(html);
  const players = [], staff = [];
  doc.querySelectorAll('table').forEach((t) => {
    const heads = t.querySelectorAll('th').map(txt);
    if (heads[0] === 'Фамилия Имя' && heads.includes('Амплуа')) {
      t.querySelectorAll('tbody tr').forEach((tr) => {
        const td = tr.querySelectorAll('td'); if (td.length < 3) return;
        const raw = txt(td[0]); const m = /^(\d+)\s+(.*)$/.exec(raw);
        const pos = txt(td[heads.indexOf('Амплуа')]);
        const img = tr.querySelector('img');
        players.push(Object.assign({ num: m ? m[1] : '', pos: POS[pos] || '', role: pos, birth: txt(td[1]), photo: img ? img.getAttribute('src') : '' }, splitName(m ? m[2] : raw)));
      });
    } else if (heads[0] === 'Фамилия Имя' && heads.includes('Должность')) {
      t.querySelectorAll('tbody tr').forEach((tr) => {
        const td = tr.querySelectorAll('td'); if (td.length < 2) return;
        staff.push(Object.assign({ role: txt(td[heads.indexOf('Должность')]) }, splitName(txt(td[0]))));
      });
    }
  });
  const order = { G: 0, D: 1, F: 2, '': 3 };
  players.sort((a, b) => order[a.pos] - order[b.pos] || (+a.num || 999) - (+b.num || 999));
  return { players, staff };
}
/** Бомбардиры: DataTables-JSON, строки — HTML-ячейки */
function parseScorers(json) {
  const rows = (json && (json.data || json.aaData)) || [];
  const cols = (json && json.columns) || [];
  return rows.map((r, i) => {
    const cell = (k, j) => (Array.isArray(r) ? r[j] : r[k]);
    const plain = (v) => clean(parse(String(v == null ? '' : v)).text);
    if (Array.isArray(r)) {
      return { raw: r.map(plain) };
    }
    const o = {};
    Object.keys(r).forEach((k) => {
      const v = r[k];
      o[k] = typeof v === 'string' && /</.test(v) ? plain(v) : v;
      if (typeof v === 'string' && /<img/.test(v)) { const im = /src="([^"]+)"/.exec(v); if (im) o[k + '_img'] = im[1]; }
      if (typeof v === 'string' && /href=/.test(v)) { const h = /href="([^"]+)"/.exec(v); if (h) o[k + '_href'] = h[1]; }
    });
    o._i = i;
    // «13 Родионов Кирилл Нападающий» → номер, фамилия, имя, амплуа
    const m = /^(\d+)?\s*(\S+)\s+(\S+)(?:\s+(Нападающий|Защитник|Вратарь))?/.exec(o.surname || o.name || '');
    const tn = String(o.team_name || '');
    return {
      rank: +o.id || i + 1, num: m ? m[1] || '' : '', last: m ? m[2] : '', first: m ? m[3] : '', role: m ? m[4] || '' : '', pos: POS[(m && m[4]) || ''] || '',
      teamId: idFromLogo(o.team_name_img) || idFromSlug(o.team_name_href), team: tn, photo: o.surname_img || '',
      gp: o.gp || '', g: o.g || '', a: o.a || '', pts: o.pts || '', pm: o.plusminus || '', pim: o.pim || ''
    };
  });
}


/* ---------------- страница матча: заявка и судьи ---------------- */
const tt = (el) => clean(el ? (el.textContent != null ? el.textContent : el.text) : '');
const cap1 = (w) => w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
const POS_HEAD = { 'вратари': 'G', 'защитники': 'D', 'нападающие': 'F', 'персонал': 'S' };
/** doc — разобранная страница /games/<id>/ (node-html-parser или DOM браузера) */
function parseGame(doc) {
  const refs = { main: [], line: [] };
  doc.querySelectorAll('.added-info .info-row').forEach((r) => {
    const k = tt(r.querySelector('.main-text')).toLowerCase();
    const list = tt(r.querySelector('.text')).split(',').map((x) => clean(x)).filter(Boolean)
      .map((x) => { const n = splitName(x.toLowerCase().split(' ').map(cap1).join(' ')); return { last: n.last, first: n.first }; });
    if (/главн/.test(k)) refs.main = list; else if (/линейн/.test(k)) refs.line = list;
  });
  const out = { refs, home: { players: [], staff: [] }, away: { players: [], staff: [] } };
  doc.querySelectorAll('.team-lineups .team-block').forEach((b) => {
    const side = /right-team/.test(b.getAttribute('class') || '') ? 'away' : 'home';
    let pos = '';
    b.querySelectorAll('thead, tbody').forEach((sec) => {
      if (/^thead$/i.test(sec.tagName)) { const h = sec.querySelector('.pos-name .text') || sec.querySelector('th'); pos = POS_HEAD[tt(h).toLowerCase().split(' ')[0]] || ''; return; }
      sec.querySelectorAll('tr').forEach((tr) => {
        const p = tr.querySelector('.player'); if (!p) return;
        const td = tr.querySelectorAll('td');
        const c = td[1] ? tt(td[1]).toUpperCase() : '';
        const n = splitName(tt(p.querySelector('.text')));
        if (pos === 'S') { out[side].staff.push({ role: tt(td[td.length - 1]), last: n.last, first: n.first }); return; }
        if (!pos) return;
        out[side].players.push({ num: tt(p.querySelector('.number')), last: n.last, first: n.first, pos, unit: tt(p.querySelector('.unit')).toUpperCase(), cap: /^[КАK]$/.test(c) ? c : '' });
      });
    });
  });
  return out;
}
async function syncGame(id, outDir) {
  const dir = path.join(outDir, 'games');
  fs.mkdirSync(dir, { recursive: true });
  const g = Object.assign({ id: String(id), updated: new Date().toISOString() }, parseGame(parse(await get('/games/' + id + '/'))));
  const f = path.join(dir, id + '.json');
  const strip = (o) => JSON.stringify(Object.assign({}, o, { updated: '' }));
  let prev = null; try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  if (!prev || strip(prev) !== strip(g)) fs.writeFileSync(f, JSON.stringify(g)); else g.updated = prev.updated;
  return g;
}
/** Какие матчи обновлять: ближайшие (−2…+3 дня) всегда, прошедшие — один раз */
function gamesToSync(matches, outDir, now) {
  now = now || new Date();
  const day = (m) => { const p = String(m.date || '').split('.'); return p.length === 3 ? new Date(+p[2], +p[1] - 1, +p[0]) : null; };
  return matches.filter((m) => {
    const d = day(m); if (!m.id || !d) return false;
    const diff = (d - now) / 864e5;
    if (diff >= -2 && diff <= 3) return true;
    return diff < 0 && diff > -150 && !fs.existsSync(path.join(outDir, 'games', m.id + '.json'));
  }).map((m) => m.id);
}

/* ---------------- главная ---------------- */
async function sync(tslug, outDir, log) {
  log = log || ((...a) => console.log(...a));
  tslug = tslug || 'kubokrossii-25008909';
  outDir = outDir || path.join(__dirname, '..', 'data', 'fhr');
  fs.mkdirSync(path.join(outDir, 'logos'), { recursive: true });
  const base = '/tournaments/' + tslug + '/';
  const codes = {};
  const calHtml = await get(base + 'calendar/');
  parseCodes(calHtml, codes);
  const meta = parseGroups(calHtml);
  if (!meta.groups.length) throw new Error('не найдены группы турнира');
  log('групп:', meta.groups.length, meta.title);
  const matches = [], standings = {}, scorers = {}, teamLinks = {};
  for (const g of meta.groups) {
    const P = { TOURNAMENT_ID: g.tid, GROUP_ID: g.id, YEAR_ID: g.year, is_ajax: true };
    const [cal, tab, tms] = await Promise.all([
      get(ajaxUrl('itprofit:competitions-calendar', P)),
      get(ajaxUrl('itprofit:tournament-page', P)),
      get(ajaxUrl('itprofit:competitions-teams', P))
    ]);
    const ms = parseCalendar(cal, g); matches.push(...ms);
    standings[g.id] = parseStandings(tab);
    Object.assign(teamLinks, parseTeamLinks(tms, tslug));
    standings[g.id].forEach((r) => { if (r.id && r.slug && !teamLinks[r.id]) teamLinks[r.id] = { slug: r.slug, name: r.name }; });
    log(' ', g.name, 'матчей', ms.length, 'команд', standings[g.id].length);
  }
  // бомбардиры: весь турнир и по группам
  const g0 = meta.groups[0];
  const sUrl = (gid) => '/fhr-ajax/SXRwcm9maXRcQXBwXEFqYXhcQWpheFN0YXRz/Z2V0RGF0YVRhYmxlU2ltcGxlU3RhdHM=/?key=scorers&comp=' + g0.tid + '&year=' + g0.year + '&group=' + (gid || '') + '&season=' + meta.season;
  for (const gid of [''].concat(meta.groups.map((g) => g.id))) {
    try { scorers[gid || 'all'] = parseScorers(await get(sUrl(gid), 'json')); }
    catch (e) { log('  бомбардиры', gid || 'all', e.message); }
  }
  // команды
  const teams = {};
  const byId = {};
  matches.forEach((m) => { [m.home, m.away].forEach((t) => { if (t.id) byId[t.id] = Object.assign(byId[t.id] || {}, t); }); });
  Object.values(standings).flat().forEach((r) => { if (r.id) byId[r.id] = Object.assign({ id: r.id, name: r.name, city: r.city, logo: r.logo }, byId[r.id] || {}); });
  for (const id of Object.keys(byId)) {
    const t = byId[id];
    const link = teamLinks[id];
    const rec = { id, name: t.name, city: t.city, logo: t.logo, slug: link ? link.slug : '', players: [], staff: [] };
    if (link) {
      try { const h = await get(base + link.slug + '/'); parseCodes(h, codes); Object.assign(rec, parseTeam(h)); }
      catch (e) { log('  команда', t.name, e.message); }
    }
    // логотип — рядом с данными, чтобы графика брала его со своего адреса
    if (t.logo) {
      const f = path.join(outDir, 'logos', id + path.extname(new URL(t.logo).pathname || '.webp'));
      try { if (!fs.existsSync(f)) fs.writeFileSync(f, await get(t.logo, 'buf')); rec.logoFile = 'logos/' + path.basename(f); }
      catch (e) { log('  логотип', t.name, e.message); }
    }
    teams[id] = rec;
  }
  matches.sort((a, b) => (a.n || 0) - (b.n || 0));
  // страницы матчей: заявки со звеньями и судьи
  const gids = gamesToSync(matches, outDir);
  for (let i = 0; i < gids.length; i += 4) {
    await Promise.all(gids.slice(i, i + 4).map((id) => syncGame(id, outDir).catch((e) => log('  матч', id, e.message))));
  }
  if (gids.length) log('страниц матчей:', gids.length);
  const out = {
    source: SITE + base, updated: new Date().toISOString(), tournament: { slug: tslug, title: meta.title, season: meta.season, id: g0.tid, year: g0.year },
    groups: meta.groups.map((g) => ({ id: g.id, name: g.name })), matches, standings, scorers, teams, codes
  };
  const file = path.join(outDir, tslug + '.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  // без изменений — не трогаем файл (меньше коммитов)
  const strip = (o) => JSON.stringify(Object.assign({}, o, { updated: '' }));
  if (!prev || strip(prev) !== strip(out)) fs.writeFileSync(file, JSON.stringify(out));
  else out.updated = prev.updated;
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(mergeIndex(path.join(outDir, 'index.json'), { slug: tslug, title: meta.title, file: tslug + '.json' })));
  log('готово:', matches.length, 'матчей,', Object.keys(teams).length, 'команд →', file);
  return out;
}
function mergeIndex(f, item) {
  let l = []; try { l = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  l = l.filter((x) => x.slug !== item.slug); l.push(item); return l;
}

module.exports = { sync, syncGame, parseGame, gamesToSync, parseCalendar, parseStandings, parseTeam, parseGroups, parseCodes, parseScorers, ajaxUrl, phpParams };
if (require.main === module) {
  sync(process.argv[2], process.argv[3]).catch((e) => { console.error('ОШИБКА:', e.message); process.exit(1); });
}
