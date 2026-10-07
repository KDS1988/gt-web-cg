#!/usr/bin/env node
/*
 * GT Web CG — мини-сервер (без зависимостей, Node 18+).
 *  - раздаёт статику (index.html — графика, control.html — пульт, import.html — импорт .gtzip)
 *  - синхронизирует пульт и графику: POST /api/state → SSE /api/events
 *  - хранит опубликованный пакет графики: PUT/GET /api/pkg
 *  - помнит последнее состояние: графика после перезагрузки восстанавливается
 *
 * Запуск:  node server.js            (порт 8787; 8088 занят vMix)
 *          PORT=9000 node server.js
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = +process.env.PORT || 8787;
const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, '.state.json');
const PKG_FILE = path.join(ROOT, '.pkg.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp'
};

let state = { rev: 0, ch: {} };
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* первый запуск */ }
let pkgBody = null;
try { pkgBody = fs.readFileSync(PKG_FILE); } catch (e) { /* нет пакета */ }
const clients = new Set();

function broadcast() {
  const msg = 'data: ' + JSON.stringify(Object.assign({}, state, { now: Date.now() })) + '\n\n';
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 300);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (p === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(Object.assign({}, state, { now: Date.now() })));
  }
  if (p === '/api/state' && req.method === 'POST') {
    try {
      const st = JSON.parse((await readBody(req, 5e6)).toString('utf8'));
      state = Object.assign({ ch: {} }, st, { rev: (state.rev || 0) + 1, ts: Date.now() });
      broadcast(); persist();
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end(JSON.stringify({ ok: true, rev: state.rev }));
    } catch (e) { res.writeHead(400); return res.end('bad json'); }
  }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n');
    res.write('data: ' + JSON.stringify(Object.assign({}, state, { now: Date.now() })) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (p === '/api/pkg' && req.method === 'GET') {
    if (!pkgBody) { res.writeHead(404); return res.end('null'); }
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(pkgBody);
  }
  if (p === '/api/pkg' && (req.method === 'PUT' || req.method === 'POST')) {
    try {
      const body = await readBody(req, 200e6);
      const pkg = JSON.parse(body.toString('utf8'));
      if (!pkg || !Array.isArray(pkg.titles)) throw new Error('not a package');
      pkgBody = body;
      fs.writeFile(PKG_FILE, body, () => {});
      console.log('  Пакет опубликован: ' + (pkg.name || pkg.id) + ' (' + pkg.titles.length + ' титр., ' + Math.round(body.length / 1024) + ' КБ)');
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      return res.end('{"ok":true}');
    } catch (e) { res.writeHead(400); return res.end(String(e.message || e)); }
  }

  // ---------- статика ----------
  let file = path.normalize(path.join(ROOT, p === '/' ? '/index.html' : p));
  if (!file.startsWith(ROOT) || /(^|[\\/])\./.test(path.relative(ROOT, file))) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, buf) => {
      if (err2) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\n  GT Web CG — сервер запущен\n');
  console.log(`  Графика (vMix → Web Browser):  http://localhost:${PORT}/`);
  console.log(`  Пульт управления:              http://localhost:${PORT}/control.html`);
  console.log(`  Импорт .gtzip:                 http://localhost:${PORT}/import.html`);
  ips.forEach(ip => console.log(`  В локальной сети:              http://${ip}:${PORT}/  (графика)   http://${ip}:${PORT}/control.html`));
  console.log('\n  Ctrl+C — остановить\n');
});
