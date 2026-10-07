/*!
 * GT Web CG · import.js — страница импорта: .gtzip → пакет веб-титров.
 */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var pkg = null, srcName = '', selId = null, take = 1, bundled = ['Montserrat'];

  fetch('fonts/fonts.json').then(function (r) { return r.json(); }).then(function (j) { bundled = j.bundled || bundled; }).catch(function () {});

  function toast(msg, err) {
    var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, err ? 7000 : 2500);
  }
  function kb(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : Math.round(n / 1024) + ' КБ'; }

  /* ---------------- приём файлов ---------------- */
  var drop = $('#drop');
  $('#pick').addEventListener('click', function (e) { e.stopPropagation(); $('#file').click(); });
  drop.addEventListener('click', function () { $('#file').click(); });
  $('#file').addEventListener('change', function (e) { handle([].slice.call(e.target.files)); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { handle([].slice.call(e.dataTransfer.files)); });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); if (!drop.contains(e.target)) handle([].slice.call(e.dataTransfer.files)); });

  function handle(files) {
    files = files.filter(function (f) { return /\.(gtzip|zip)$/i.test(f.name); });
    if (!files.length) { toast('Нужны файлы .gtzip или .zip', true); return; }
    drop.querySelector('h2').textContent = 'Разбираю ' + files.length + ' файл(ов)…';
    srcName = files.length === 1 ? files[0].name.replace(/\.(gtzip|zip)$/i, '') : '';
    Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (b) { return { name: f.name, data: b }; }); }))
      .then(function (list) { return GTParse.convertFiles(JSZip, list, {}); })
      .then(function (raw) {
        drop.querySelector('h2').textContent = 'Перетащите сюда титры .gtzip';
        if (!raw.titles.length) { toast('Титры не найдены. ' + raw.errors.join('; '), true); return; }
        return prepare(raw);
      })
      .catch(function (e) { drop.querySelector('h2').textContent = 'Перетащите сюда титры .gtzip'; toast('Ошибка: ' + (e.message || e), true); console.error(e); });
  }

  /* ---------------- подготовка пакета ---------------- */
  function prepare(raw) {
    var errors = raw.errors;
    pkg = GTParse.finalize(raw);
    pkg.fontFiles = [];
    pkg.ver = Date.now().toString(36);
    pkg._raw = raw;
    var nice = srcName && !/^[0-9a-f]{6,}[-_]/i.test(srcName) && !/^_+$/.test(srcName) ? srcName : '';
    $('#pname').value = nice || ('Пакет титров · ' + new Date().toLocaleDateString('ru-RU'));
    $('#work').hidden = false;
    $('#done').hidden = true;
    var log = $('#log');
    log.hidden = !errors.length; log.textContent = errors.join('\n');
    selId = pkg.titles[0].id;
    renderTitles();
    renderFonts();
    fillTargets();
    sendPreview(true);
    sizeHint();
    return Promise.all([shrinkThumbs(), embedGoogleFonts()]).then(function () { renderTitles(); renderFonts(); sizeHint(); sendPreview(false); });
  }

  function renderTitles() {
    $('#titles').innerHTML = pkg.titles.map(function (t) {
      var dc = (t.sb.dc || []).length ? ' · реакция на смену данных' : '';
      return '<div class="ti' + (t.id === selId ? ' sel' : '') + '" data-id="' + esc(t.id) + '">' +
        '<img src="' + (pkg.thumbs[t.id] || '') + '" alt="">' +
        '<div class="m"><b>' + esc(t.name) + '</b><span>' + t.objects.length + ' объектов · ' + t.fields.length + ' полей · ' +
        (t.sb.in ? 'In' : 'без In') + ' / ' + (t.sb.out ? 'Out' : 'без Out') + dc + '</span>' +
        (t.warnings.length ? '<div class="w">⚠ ' + t.warnings.map(esc).join('<br>⚠ ') + '</div>' : '') + '</div></div>';
    }).join('');
  }
  $('#titles').addEventListener('click', function (e) {
    var it = e.target.closest('.ti'); if (!it) return;
    selId = it.dataset.id; renderTitles(); sendPreview(true);
  });

  /* ---------------- превью ---------------- */
  var pvw = $('#pvw'), pvwReady = false, pvwVer = null;
  pvw.addEventListener('load', function () { pvwReady = true; pvwVer = null; if (pkg) sendPreview(true); });
  function sendPreview(retake, off) {
    var w = pvw.contentWindow;
    if (!pvwReady || !w.__gtApply || !pkg) return;
    var p = Promise.resolve();
    var cur = pkg.id + '@' + pkg.ver;
    if (pvwVer !== cur) { pvwVer = cur; p = w.__gtSetPkg(publicPkg()); retake = true; }
    if (retake) take++;
    var t = pkg.titles.filter(function (x) { return x.id === selId; })[0];
    $('#pvwHint').textContent = t ? t.name : '';
    p.then(function () { w.__gtApply({ ch: off || !t ? {} : { '1': { t: t.id, take: take, data: {} } } }); });
  }
  $('#bIn').addEventListener('click', function () { sendPreview(true); });
  $('#bOut').addEventListener('click', function () { sendPreview(false, true); });

  /* ---------------- шрифты ---------------- */
  function fontStatus(f) {
    if (bundled.indexOf(f.family) >= 0) return { cls: 'st-ok', txt: 'встроен в пульт' };
    var have = pkg.fontFiles.filter(function (x) { return x.family === f.family; });
    if (have.length) return { cls: 'st-ok', txt: 'вшит в пакет (' + have.length + ' файл.)' };
    if (f._google === 'loading') return { cls: 'st-warn', txt: 'скачиваю с Google Fonts…' };
    return { cls: 'st-bad', txt: 'нет — будет системный шрифт с таким именем, если он установлен' };
  }
  function renderFonts() {
    $('#fonts').innerHTML = pkg.fonts.map(function (f, i) {
      var s = fontStatus(f);
      return '<div class="fontrow"><b style="font-family:\'' + esc(f.family) + '\'">' + esc(f.family) + '</b><span class="hint">' + f.variants.join(', ') + '</span>' +
        '<span class="' + s.cls + '">' + s.txt + '</span><span style="flex:1"></span>' +
        (bundled.indexOf(f.family) < 0 ? '<label class="btn sm file">Файл шрифта…<input type="file" data-i="' + i + '" accept=".ttf,.otf,.woff,.woff2" multiple hidden></label>' : '') + '</div>';
    }).join('') || '<p class="hint">Текстов нет.</p>';
  }
  $('#fonts').addEventListener('change', function (e) {
    var inp = e.target; if (!inp.files || !inp.files.length) return;
    var f = pkg.fonts[+inp.dataset.i];
    Promise.all([].slice.call(inp.files).map(function (file) {
      return new Promise(function (res) {
        var rd = new FileReader();
        rd.onload = function () {
          var n = file.name.toLowerCase();
          var w = /thin/.test(n) ? 100 : /extralight|ultralight/.test(n) ? 200 : /light/.test(n) ? 300 : /medium/.test(n) ? 500 : /semibold|demibold/.test(n) ? 600 : /extrabold|ultrabold/.test(n) ? 800 : /black|heavy/.test(n) ? 900 : /bold/.test(n) ? 700 : 0;
          var weights = w ? [w] : f.variants.map(function (v) { return parseInt(v, 10); }); // один файл без веса в имени — на все начертания
          weights.forEach(function (wt) { pkg.fontFiles.push({ family: f.family, weight: wt, style: /italic|oblique/.test(n) ? 'italic' : 'normal', data: rd.result }); });
          res();
        };
        rd.readAsDataURL(file);
      });
    })).then(function () { pkg.ver = Date.now().toString(36); renderFonts(); sizeHint(); sendPreview(true); });
  });

  function embedGoogleFonts() {
    var jobs = pkg.fonts.filter(function (f) { return bundled.indexOf(f.family) < 0; }).map(function (f) {
      f._google = 'loading'; renderFonts();
      var vars = f.variants.map(function (v) { var it = /i$/.test(v) ? 1 : 0; return [it, parseInt(v, 10) || 400]; })
        .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
      var url = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f.family).replace(/%20/g, '+') +
        ':ital,wght@' + vars.map(function (v) { return v[0] + ',' + v[1]; }).join(';') + '&display=block';
      return fetch(url).then(function (r) { if (!r.ok) throw new Error('нет в Google Fonts'); return r.text(); }).then(function (css) {
        var blocks = [], re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g, m;
        while ((m = re.exec(css))) {
          if (!/^(cyrillic|cyrillic-ext|latin|latin-ext)$/.test(m[1])) continue;
          var b = m[2], src = /url\(([^)]+)\)/.exec(b);
          if (!src) continue;
          blocks.push({ style: (/font-style:\s*(\w+)/.exec(b) || [])[1] || 'normal', weight: +((/font-weight:\s*(\d+)/.exec(b) || [])[1] || 400), range: ((/unicode-range:\s*([^;]+)/.exec(b) || [])[1] || '').trim(), url: src[1].replace(/['"]/g, '') });
        }
        if (!blocks.length) throw new Error('пустой ответ');
        return Promise.all(blocks.map(function (bl) {
          return fetch(bl.url).then(function (r) { return r.blob(); }).then(function (blob) {
            return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res(rd.result); }; rd.readAsDataURL(blob); });
          }).then(function (data) { pkg.fontFiles.push({ family: f.family, weight: bl.weight, style: bl.style, range: bl.range, data: data.replace(/^data:[^;]*;/, 'data:font/woff2;') }); });
        }));
      }).then(function () { f._google = 'ok'; pkg.ver = Date.now().toString(36); })
        .catch(function () { f._google = 'fail'; });
    });
    return Promise.all(jobs);
  }

  /* ---------------- оптимизация картинок ---------------- */
  function loadImg(src) { return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = src; }); }
  function canvasUrl(img, w, h, type, q) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    return c.toDataURL(type, q);
  }
  function shrinkThumbs() {
    return Promise.all(Object.keys(pkg.thumbs).map(function (id) {
      return loadImg(pkg.thumbs[id]).then(function (img) {
        var u = canvasUrl(img, 384, Math.round(384 * img.naturalHeight / img.naturalWidth) || 216, 'image/webp', 0.82);
        if (!/^data:image\/webp/.test(u)) u = canvasUrl(img, 384, 216, 'image/png');
        if (u.length < pkg.thumbs[id].length) pkg.thumbs[id] = u;
      }).catch(function () {});
    }));
  }
  /** Картинки больше, чем нужно в кадре, уменьшаются до размера показа (×1.25 запас) */
  function optimizeImages(p) {
    var need = {};
    p.titles.forEach(function (t) {
      t.objects.forEach(function (o) {
        if (o.t === 'image' && o.img) (need[o.img] = need[o.img] || []).push({ w: o.w, h: o.h, fit: o.fit });
        if (o.fill && o.fill.t === 'image') (need[o.fill.src] = need[o.fill.src] || []).push({ w: o.w, h: o.h, fit: 'fill' });
      });
    });
    return Promise.all(Object.keys(p.assets).map(function (id) {
      var a = p.assets[id];
      if (!/^image\/(png|jpeg|webp|bmp|gif)$/.test(a.mime) || !need[id]) return null;
      return loadImg(a.data).then(function (img) {
        var nw = img.naturalWidth, nh = img.naturalHeight, tw = 0, th = 0;
        need[id].forEach(function (b) {
          var k = b.fit === 'fill' || b.fit === 'uniformtofill' ? Math.max(b.w / nw, b.h / nh) : Math.min(b.w / nw, b.h / nh);
          tw = Math.max(tw, nw * k); th = Math.max(th, nh * k);
        });
        tw = Math.ceil(tw * 1.25); th = Math.ceil(th * 1.25);
        if (tw >= nw * 0.9 || !tw || !th) return;
        var u = canvasUrl(img, tw, th, a.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
        if (u.length < a.data.length) { a.data = u; a.mime = a.mime === 'image/jpeg' ? 'image/jpeg' : 'image/png'; a.opt = nw + '×' + nh + ' → ' + tw + '×' + th; }
      }).catch(function () {});
    }));
  }

  function publicPkg() {
    var p = Object.assign({}, pkg);
    delete p._raw;
    p.fonts = pkg.fonts.map(function (f) { return { family: f.family, variants: f.variants }; });
    return p;
  }
  function sizeHint() {
    var s = JSON.stringify(publicPkg()).length;
    $('#sizeHint').textContent = 'Титров: ' + pkg.titles.length + ' · картинок: ' + Object.keys(pkg.assets).length + ' · размер пакета: ' + kb(s) +
      ($('#opt').checked ? ' (до оптимизации картинок)' : '');
  }

  /* ---------------- сохранение ---------------- */
  function fillTargets() {
    CG.Library.list().then(function (l) {
      $('#target').innerHTML = '<option value="">Новый пакет</option>' + l.map(function (p) { return '<option value="' + esc(p.id) + '">Добавить в «' + esc(p.name) + '» (' + p.titles + ')</option>'; }).join('');
    });
  }
  function build() {
    var p = JSON.parse(JSON.stringify(publicPkg()));
    var opt = $('#opt').checked ? optimizeImages(p) : Promise.resolve();
    return opt.then(function () {
      var target = $('#target').value;
      p.name = $('#pname').value.trim() || 'Пакет титров';
      p.ver = Date.now().toString(36);
      if (!target) {
        return CG.Library.list().then(function (l) {
          var base = GTParse.slug(p.name), id = base, k = 2;
          while (l.some(function (x) { return x.id === id; })) id = base + '-' + (k++);
          p.id = id;
          return p;
        });
      }
      return CG.Library.get(target).then(function (old) {
        if (!old) return p;
        var m = JSON.parse(JSON.stringify(old));
        p.titles.forEach(function (t) {
          var i = m.titles.findIndex(function (x) { return x.id === t.id || x.name === t.name; });
          if (i >= 0) { t.id = m.titles[i].id; m.titles[i] = t; } else m.titles.push(t);
          if (p.thumbs[t.id]) m.thumbs[t.id] = p.thumbs[t.id];
        });
        Object.assign(m.assets, p.assets);
        p.fonts.forEach(function (f) {
          var e = m.fonts.filter(function (x) { return x.family === f.family; })[0];
          if (!e) m.fonts.push(f); else f.variants.forEach(function (v) { if (e.variants.indexOf(v) < 0) e.variants.push(v); });
        });
        m.fontFiles = (m.fontFiles || []).concat((p.fontFiles || []).filter(function (f) { return !(m.fontFiles || []).some(function (x) { return x.family === f.family && x.weight === f.weight && x.style === f.style && x.range === f.range; }); }));
        m.ver = p.ver;
        if ($('#pname').value.trim() && $('#pname').value.trim() !== m.name && !/^Пакет титров ·/.test($('#pname').value)) m.name = $('#pname').value.trim();
        return m;
      });
    });
  }
  $('#save').addEventListener('click', function () {
    var b = this; b.disabled = true; b.textContent = 'Сохраняю…';
    build().then(function (p) {
      return CG.Library.put(p).then(function () {
        var d = $('#done');
        d.hidden = false;
        d.innerHTML = '✔ Пакет «' + esc(p.name) + '» сохранён (' + p.titles.length + ' титр., ' + kb(JSON.stringify(p).length) + '). ' +
          '<a class="btn take" href="control.html?pkg=' + encodeURIComponent(p.id) + '">Открыть в пульте →</a>' +
          '<p class="hint">Пакет хранится в этом браузере. При выборе в пульте он автоматически публикуется в комнату — графика в vMix его подхватит.</p>';
        fillTargets();
      });
    }).catch(function (e) { toast('Не сохранено: ' + e.message, true); })
      .then(function () { b.disabled = false; b.textContent = 'Сохранить в пульт'; });
  });
  $('#dl').addEventListener('click', function () {
    build().then(function (p) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(p)], { type: 'application/json' }));
      a.download = p.id + '.json'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });
  });
  $('#opt').addEventListener('change', sizeHint);
})();
