/*!
 * GT Web CG · gt-parse.js
 * Разбор титров vMix GT (.gtzip) в JSON-пакет для веб-титрования.
 * Работает в браузере (window.GTParse) и в Node (require) — без DOMParser, свой мини-XML-парсер.
 *
 * .gtzip = zip: document.xml (сцена + storyboards), resources.xml (путь → GUID ресурса),
 *          <GUID> (картинки), thumbnail.png
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 'gt-web-cg/1';

  /* ------------------------------------------------------------------ */
  /* Мини-XML                                                            */
  /* ------------------------------------------------------------------ */
  function decodeEnt(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      var l = e.toLowerCase();
      if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>';
      if (l === 'quot') return '"'; if (l === 'apos') return "'";
      if (l[1] === 'x') return String.fromCodePoint(parseInt(l.slice(2), 16));
      return String.fromCodePoint(parseInt(l.slice(1), 10));
    });
  }
  function parseXML(src) {
    src = String(src).replace(/^﻿/, '');
    var rootEl = { tag: '#root', attr: {}, kids: [] }, stack = [rootEl], i = 0, n = src.length;
    var reAttr = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    while (i < n) {
      var lt = src.indexOf('<', i);
      if (lt < 0) break;
      if (src.startsWith('<!--', lt)) { i = src.indexOf('-->', lt); i = i < 0 ? n : i + 3; continue; }
      if (src.startsWith('<?', lt)) { i = src.indexOf('?>', lt); i = i < 0 ? n : i + 2; continue; }
      if (src.startsWith('<![CDATA[', lt)) { i = src.indexOf(']]>', lt); i = i < 0 ? n : i + 3; continue; }
      if (src.startsWith('<!', lt)) { i = src.indexOf('>', lt); i = i < 0 ? n : i + 1; continue; }
      var gt = lt + 1, q = null;
      while (gt < n) { var ch = src[gt]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break; gt++; }
      var body = src.slice(lt + 1, gt);
      i = gt + 1;
      if (body[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
      var self = /\/\s*$/.test(body);
      if (self) body = body.replace(/\/\s*$/, '');
      var m = /^([\w:.-]+)/.exec(body);
      if (!m) continue;
      var el = { tag: m[1], attr: {}, kids: [] }, a;
      reAttr.lastIndex = 0;
      var rest = body.slice(m[1].length);
      while ((a = reAttr.exec(rest))) el.attr[a[1]] = decodeEnt(a[3] != null ? a[3] : a[4]);
      stack[stack.length - 1].kids.push(el);
      if (!self) stack.push(el);
    }
    return rootEl;
  }
  function kid(el, tag) { if (!el) return null; for (var i = 0; i < el.kids.length; i++) if (el.kids[i].tag === tag) return el.kids[i]; return null; }
  function kids(el, tag) { return el ? el.kids.filter(function (k) { return k.tag === tag; }) : []; }
  function find(el, tag) { // первый потомок на любой глубине
    if (!el) return null;
    for (var i = 0; i < el.kids.length; i++) { var k = el.kids[i]; if (k.tag === tag) return k; var r = find(k, tag); if (r) return r; }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Значения                                                            */
  /* ------------------------------------------------------------------ */
  function nums(s, def) {
    if (s == null || s === '') return def;
    return String(s).split(/[,\s]+/).filter(Boolean).map(Number);
  }
  function num(s, def) { var v = parseFloat(s); return isFinite(v) ? v : def; }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  var NAMED = { white: '#FFFFFFFF', black: '#FF000000', transparent: '#00000000', red: '#FFFF0000', green: '#FF008000', blue: '#FF0000FF', yellow: '#FFFFFF00' };
  /** '#AARRGGBB' | '#RRGGBB' → 'rgba(r,g,b,a)' / '#rrggbb' */
  function color(s, def) {
    if (s == null || s === '') return def === undefined ? null : def;
    s = String(s).trim();
    if (NAMED[s.toLowerCase()]) s = NAMED[s.toLowerCase()];
    var h = s.replace('#', '');
    if (/^[0-9a-f]{8}$/i.test(h)) {
      var A = parseInt(h.slice(0, 2), 16), R = parseInt(h.slice(2, 4), 16), G = parseInt(h.slice(4, 6), 16), B = parseInt(h.slice(6, 8), 16);
      if (A === 255) return '#' + h.slice(2).toLowerCase();
      return 'rgba(' + R + ',' + G + ',' + B + ',' + r3(A / 255) + ')';
    }
    if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
    if (/^[0-9a-f]{3}$/i.test(h)) return '#' + h.toLowerCase();
    return s;
  }

  function parseBrush(el) {
    var b = kid(el, 'Brush');
    if (!b) return null;
    var type = b.attr.Type || 'Solid';
    if (/Gradient/i.test(type)) {
      var stops = kids(kid(b, 'Brush.Stops'), 'GradientStop').map(function (g) {
        return { c: color(g.attr.Color, 'rgba(0,0,0,0)'), p: num(g.attr.Position, 0) };
      }).sort(function (x, y) { return x.p - y.p; });
      if (!stops.length) return b.attr.Color ? { t: 'solid', c: color(b.attr.Color) } : null;
      return {
        t: /Radial/i.test(type) ? 'radial' : 'linear',
        s: nums(b.attr.StartPoint, [0, 0]), e: nums(b.attr.EndPoint, [1, 1]),
        stops: stops
      };
    }
    if (b.attr.Source) return { t: 'image', src: b.attr.Source };
    if (!b.attr.Color) return null;
    return { t: 'solid', c: color(b.attr.Color) };
  }

  var WEIGHTS = { thin: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400, medium: 500, demibold: 600, semibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900, extrablack: 950, ultrablack: 950 };
  function weight(s) { if (!s) return 400; var v = WEIGHTS[String(s).toLowerCase()]; return v || num(s, 400); }

  function flags(s) {
    var o = {};
    String(s || '').split(/[,\s|]+/).filter(Boolean).forEach(function (f) { o[f] = true; });
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Сцена                                                               */
  /* ------------------------------------------------------------------ */
  var SHAPES = { Rectangle: 'rect', Ellipse: 'ellipse', TextBlock: 'text', Image: 'image', Layer: 'layer' };

  function parseObjects(comp, ox, oy, layerName, out, warn) {
    comp.kids.forEach(function (el) {
      var t = SHAPES[el.tag];
      if (!t) { if (el.tag !== 'Storyboard') warn('Неизвестный объект «' + el.tag + '» пропущен'); return; }
      var dim = nums(el.attr.Dimensions, [0, 0]), loc = nums(el.attr.Location, [0, 0]);
      var x = ox + (loc[0] || 0), y = oy + (loc[1] || 0);
      var name = el.attr.Name || (el.tag + out.length);
      if (t === 'layer') {
        var inner = kid(kid(el, 'Layer.Composition'), 'Composition');
        out.push({ n: name, t: 'layer', x: x, y: y, w: dim[0], h: dim[1], lay: layerName || null });
        if (inner) parseObjects(inner, x, y, name, out, warn);
        return;
      }
      var o = { n: name, t: t, x: r3(x), y: r3(y), w: r3(dim[0] || 0), h: r3(dim[1] || 0) };
      if (layerName) o.lay = layerName;
      if (el.attr.Opacity != null) o.op = num(el.attr.Opacity, 1);
      if (el.attr.Rotation != null && num(el.attr.Rotation, 0)) o.rot = num(el.attr.Rotation, 0);
      var df = flags(el.attr.DataFlags);
      // В GT у всех объектов, кроме текста и картинки, «Hidden» стоит по умолчанию
      var hiddenDef = !(t === 'text' || t === 'image');
      o.df = {
        hidden: el.attr.DataFlags == null ? hiddenDef : !!df.Hidden,
        vis: !!df.ShowVisible
      };
      var P = el.tag + '.';
      var fill = parseBrush(kid(el, P + 'Fill'));
      if (fill) o.fill = fill;
      var sw = num(el.attr.StrokeThickness, 0);
      if (sw > 0) { var st = parseBrush(kid(el, P + 'Stroke')); if (st) o.stroke = { b: st, w: sw }; }
      var mk = find(kid(el, P + 'Mask'), 'Mask');
      if (mk && mk.attr.Object) o.mask = mk.attr.Object;
      var bd = find(kid(el, P + 'Bounding'), 'Bounding');
      if (bd && bd.attr.Object) { var pd = nums(bd.attr.Padding, [0, 0, 0, 0]); while (pd.length < 4) pd.push(pd[pd.length - 1] || 0); o.bound = { o: bd.attr.Object, p: pd.slice(0, 4) }; }
      var cr = find(kid(el, P + 'Crop'), 'Crop');
      if (cr) {
        var cv = ['Left', 'Top', 'Right', 'Bottom'].map(function (k) { return num(cr.attr[k], 0); });
        if (cv.some(Boolean)) o.crop = cv;
        var fe = nums(cr.attr.Feather, [0, 0, 0, 0]);
        if (fe.some(Boolean)) o.feather = fe;
      }
      kids(kid(el, P + 'Effects'), 'Effect').forEach(function (fx) {
        var ft = fx.attr.Type;
        o.fx = o.fx || {};
        if (ft === 'Shadow' || ft === 'DropShadow' || ft === 'Glow') {
          o.fx.sh = { b: num(fx.attr.BlurAmount, 5), c: color(fx.attr.Color, 'rgba(0,0,0,0.5)'), dx: num(fx.attr.OffsetX, num((fx.attr.Offset || '').split(',')[0], ft === 'Glow' ? 0 : 2)), dy: num(fx.attr.OffsetY, num((fx.attr.Offset || '').split(',')[1], ft === 'Glow' ? 0 : 3)), glow: ft === 'Glow' };
        } else if (ft === 'FlipX') o.fx.flipX = true;
        else if (ft === 'FlipY') o.fx.flipY = true;
        else if (ft === 'Blur') o.fx.blur = num(fx.attr.BlurAmount, 5);
        else warn('Эффект «' + ft + '» на «' + name + '» не переносится');
      });
      if (t === 'text') {
        var ta = (el.attr.TextAlign || 'Left').toLowerCase(), va = (el.attr.VerticalAlign || 'Top').toLowerCase();
        o.text = {
          s: el.attr.Text != null ? el.attr.Text : '',
          ff: el.attr.FontFamily || 'Arial',
          fs: num(el.attr.FontSize, 24),
          fw: weight(el.attr.FontWeight),
          it: /italic|oblique/i.test(el.attr.FontStyle || ''),
          al: ta === 'center' ? 'center' : ta === 'right' ? 'right' : ta === 'justify' ? 'justify' : 'left',
          va: va === 'center' ? 'center' : va === 'bottom' ? 'bottom' : 'top',
          wrap: !/nowrap/i.test(el.attr.TextWordWrapping || el.attr.TextWrapping || ''),
          up: /upper/i.test(el.attr.TextEffect || ''),
          lo: /lower/i.test(el.attr.TextEffect || ''),
          auto: (function (a) { a = String(a || '').toLowerCase(); return a === 'widthandheight' ? 'wh' : a === 'width' ? 'w' : a === 'height' ? 'h' : a === 'shrink' ? 'shrink' : 'none'; })(el.attr.AutoSize)
        };
        if (el.attr.LineSpacing) o.text.ls = num(el.attr.LineSpacing, 0);
        if (el.attr.CharacterSpacing || el.attr.LetterSpacing) o.text.cs = num(el.attr.CharacterSpacing || el.attr.LetterSpacing, 0);
      }
      if (t === 'image') {
        var bm = find(kid(el, 'Image.Bitmap'), 'Bitmap');
        o.img = bm ? (bm.attr.Source || '') : '';
        o.fit = (el.attr.Stretch || 'Uniform').toLowerCase();
      }
      out.push(o);
    });
  }

  var KNOWN_ANIMS = { Fade: 1, Reveal: 1, Expand: 1, Fly: 1, Hidden: 1, Zoom: 1, Wipe: 1, Slide: 1 };

  function parseStoryboards(rootComp, warn) {
    var sb = { in: null, out: null, cont: null, dc: [] };
    kids(rootComp, 'Storyboard').forEach(function (s) {
      var type = s.attr.Type || 'TransitionIn';
      var anims = kid(s, 'Storyboard.Animations');
      var list = anims ? anims.kids.map(function (a) {
        if (!KNOWN_ANIMS[a.tag]) warn('Анимация «' + a.tag + '» (' + (a.attr.Object || '') + ') заменена на Fade');
        var o = { t: KNOWN_ANIMS[a.tag] ? a.tag : 'Fade', o: a.attr.Object || '', d: num(a.attr.Delay, 0), u: num(a.attr.Duration, 0), e: a.attr.Interpolation || 'Linear' };
        if (a.attr.Direction) o.dir = a.attr.Direction;
        if (a.attr.CenterAxis) o.ax = a.attr.CenterAxis;
        if (/true/i.test(a.attr.Reverse || '')) o.rev = true;
        return o;
      }) : [];
      if (type === 'TransitionIn') sb.in = list;
      else if (type === 'TransitionOut') sb.out = list;
      else if (type === 'Continuous') sb.cont = list;
      else if (type === 'DataChangeIn' || type === 'DataChangeOut') sb.dc.push({ k: type === 'DataChangeIn' ? 'in' : 'out', f: s.attr.DataName || null, a: list });
      else warn('Storyboard «' + type + '» не поддерживается (пропущен)');
    });
    return sb;
  }

  function prettyLabel(n) { return String(n).replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }

  function buildFields(objects) {
    var f = [];
    objects.forEach(function (o) {
      if (o.t === 'layer') return;
      if (!o.df.hidden) {
        if (o.t === 'text') f.push({ k: o.n + '.Text', o: o.n, kind: 'text', label: prettyLabel(o.n), def: o.text.s });
        else if (o.t === 'image') f.push({ k: o.n + '.Source', o: o.n, kind: 'image', label: prettyLabel(o.n), def: o.img });
        else if ((o.t === 'rect' || o.t === 'ellipse') && o.fill && o.fill.t === 'solid') f.push({ k: o.n + '.Fill', o: o.n, kind: 'color', label: prettyLabel(o.n), def: o.fill.c });
      }
      if (o.df.vis) f.push({ k: o.n + '.Visible', o: o.n, kind: 'visible', label: prettyLabel(o.n), def: true });
    });
    return f;
  }

  /**
   * Разбор одного документа GT.
   * @param {string} docXml   содержимое document.xml
   * @param {string} resXml   содержимое resources.xml (может быть пустым)
   * @returns {{w,h,objects,sb,fields,res,warnings}}  res: { 'путь\\файл.png': 'GUID' }
   */
  function parseDocument(docXml, resXml) {
    var warnings = [];
    var warn = function (m) { if (warnings.indexOf(m) < 0) warnings.push(m); };
    var doc = parseXML(docXml);
    var top = kid(doc, 'Composition');
    if (!top) throw new Error('В document.xml нет <Composition>');
    var objects = [];
    parseObjects(top, 0, 0, null, objects, warn);
    var res = {};
    if (resXml) {
      var r = parseXML(resXml);
      (find(r, 'resources') || r).kids.forEach(function (re) {
        if (re.tag !== 'resource') return;
        var src = kid(re, 'source');
        var guid = src && src.attr.guid;
        if (guid) res[re.attr.filename] = guid;
      });
    }
    var sb = parseStoryboards(top, warn);
    // проверка ссылок
    var names = {}; objects.forEach(function (o) { names[o.n] = o; });
    objects.forEach(function (o) {
      if (o.mask && !names[o.mask]) { warn('Маска «' + o.mask + '» для «' + o.n + '» не найдена'); delete o.mask; }
      if (o.bound && !names[o.bound.o]) { warn('Bounding «' + o.bound.o + '» для «' + o.n + '» не найден'); delete o.bound; }
      if (o.feather) warn('Размытие края (Feather) у «' + o.n + '» не переносится');
    });
    ['in', 'out', 'cont'].forEach(function (k) {
      (sb[k] || []).forEach(function (a) { if (a.o && !names[a.o]) warn('Анимация ссылается на несуществующий объект «' + a.o + '»'); });
    });
    // вложенные слои в сцене не рисуем, но имя остаётся для анимаций
    return {
      w: num(top.attr.Width, 1920), h: num(top.attr.Height, 1080),
      objects: objects, sb: sb, fields: buildFields(objects), res: res, warnings: warnings
    };
  }

  /* ------------------------------------------------------------------ */
  /* Ассеты                                                              */
  /* ------------------------------------------------------------------ */
  function fnv1a(bytes) {
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
    for (var i = 0; i < bytes.length; i++) {
      h1 ^= bytes[i]; h1 = Math.imul(h1, 0x01000193);
      h2 ^= bytes[(bytes.length - 1 - i)]; h2 = Math.imul(h2, 0x5bd1e995);
    }
    return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
  }
  function sniffMime(b) {
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'image/webp';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    var head = ''; for (var i = 0; i < Math.min(200, b.length); i++) head += String.fromCharCode(b[i]);
    if (/<svg/i.test(head)) return 'image/svg+xml';
    return 'application/octet-stream';
  }
  function b64(bytes) {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function baseName(p) { return String(p).split(/[\\/]/).pop(); }
  function stripExt(p) { return baseName(p).replace(/\.[^.]+$/, ''); }
  function slug(s) {
    var map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
    return String(s).toLowerCase().split('').map(function (c) { return map[c] != null ? map[c] : c; }).join('')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'title';
  }

  /* ------------------------------------------------------------------ */
  /* Загрузка .gtzip / .zip c несколькими .gtzip                         */
  /* ------------------------------------------------------------------ */
  function decodeName(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { try { return new TextDecoder('ibm866').decode(bytes); } catch (e2) { return String.fromCharCode.apply(null, bytes); } }
  }

  function readZip(JSZip, data) { return JSZip.loadAsync(data, { decodeFileName: decodeName }); }

  function findEntry(zip, name) {
    var want = name.toLowerCase(), hit = null;
    zip.forEach(function (p, f) { if (!f.dir && (p.toLowerCase() === want || p.toLowerCase().endsWith('/' + want))) hit = hit || f; });
    return hit;
  }

  /** Разбирает один .gtzip (уже открытый JSZip) → title + сырые ассеты */
  function parseGtZip(zip, fileName) {
    var docF = findEntry(zip, 'document.xml');
    if (!docF) return Promise.reject(new Error('«' + fileName + '»: нет document.xml — это не титр GT'));
    var resF = findEntry(zip, 'resources.xml'), thF = findEntry(zip, 'thumbnail.png');
    var prefix = docF.name.slice(0, docF.name.length - 'document.xml'.length);
    return Promise.all([docF.async('string'), resF ? resF.async('string') : '', thF ? thF.async('uint8array') : null]).then(function (r) {
      var d = parseDocument(r[0], r[1]);
      var name = stripExt(fileName);
      var title = { id: slug(name), name: name, file: baseName(fileName), w: d.w, h: d.h, objects: d.objects, sb: d.sb, fields: d.fields, warnings: d.warnings };
      // картинки: Bitmap Source → resources.xml → GUID-файл в архиве
      var need = {};
      d.objects.forEach(function (o) {
        if (o.t === 'image' && o.img) need[o.img] = 1;
        if (o.fill && o.fill.t === 'image') need[o.fill.src] = 1;
      });
      var raw = [];
      var jobs = Object.keys(need).map(function (srcPath) {
        var guid = d.res[srcPath];
        var f = guid ? (zip.file(prefix + guid) || findEntry(zip, guid)) : null;
        if (!f) f = findEntry(zip, baseName(srcPath)); // старые версии кладут файл по имени
        if (!f) { title.warnings.push('Нет файла картинки «' + baseName(srcPath) + '» в архиве'); return null; }
        return f.async('uint8array').then(function (bytes) { raw.push({ src: srcPath, name: baseName(srcPath), bytes: bytes }); });
      });
      return Promise.all(jobs).then(function () { return { title: title, raw: raw, thumb: r[2] }; });
    });
  }

  /**
   * Главная функция: принимает список { name, data(ArrayBuffer|Uint8Array) } — .gtzip или .zip c .gtzip внутри.
   * Возвращает пакет (ассеты в виде байт — для оптимизации на странице импорта) .
   */
  function convertFiles(JSZip, files, opts) {
    opts = opts || {};
    var titles = [], assets = {}, thumbs = {}, log = [];
    function addTitle(t) {
      // уникальные id
      var base = t.title.id, id = base, k = 2;
      while (titles.some(function (x) { return x.id === id; })) id = base + '-' + (k++);
      t.title.id = id;
      t.raw.forEach(function (r) {
        var hash = fnv1a(r.bytes);
        if (!assets[hash]) assets[hash] = { id: hash, name: r.name, mime: sniffMime(r.bytes), bytes: r.bytes };
        t.title.objects.forEach(function (o) {
          if (o.t === 'image' && o.img === r.src) o.img = hash;
          if (o.fill && o.fill.t === 'image' && o.fill.src === r.src) o.fill.src = hash;
        });
        t.title.fields.forEach(function (f) { if (f.kind === 'image' && f.def === r.src) f.def = hash; });
      });
      // картинки, для которых файла не нашлось
      t.title.objects.forEach(function (o) { if (o.t === 'image' && o.img && !assets[o.img]) o.img = ''; });
      t.title.fields.forEach(function (f) { if (f.kind === 'image' && f.def && !assets[f.def]) f.def = ''; });
      if (t.thumb) thumbs[id] = t.thumb;
      titles.push(t.title);
    }
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        return readZip(JSZip, file.data).then(function (zip) {
          if (findEntry(zip, 'document.xml') && !Object.keys(zip.files).some(function (p) { return /\.gtzip$/i.test(p); })) {
            return parseGtZip(zip, file.name).then(addTitle);
          }
          var inner = [];
          zip.forEach(function (p, f) { if (!f.dir && /\.gtzip$/i.test(p) && !/(^|\/)__MACOSX\//.test(p)) inner.push(f); });
          inner.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
          if (!inner.length) throw new Error('«' + file.name + '»: внутри нет .gtzip');
          var c2 = Promise.resolve();
          inner.forEach(function (f) {
            c2 = c2.then(function () {
              return f.async('uint8array').then(function (b) { return readZip(JSZip, b); })
                .then(function (z) { return parseGtZip(z, f.name); }).then(addTitle)
                .catch(function (e) { log.push(String(e.message || e)); });
            });
          });
          return c2;
        }).catch(function (e) { log.push(String(e.message || e)); });
      });
    });
    return chain.then(function () {
      var fonts = {};
      titles.forEach(function (t) { t.objects.forEach(function (o) { if (o.text) { var f = fonts[o.text.ff] = fonts[o.text.ff] || {}; f[o.text.fw + (o.text.it ? 'i' : '')] = 1; } }); });
      return {
        format: FORMAT,
        id: opts.id || ('pkg-' + Date.now().toString(36)),
        name: opts.name || (titles[0] ? 'Пакет: ' + titles.length + ' титр.' : 'Пакет'),
        created: new Date().toISOString(),
        w: titles[0] ? titles[0].w : 1920, h: titles[0] ? titles[0].h : 1080,
        fonts: Object.keys(fonts).map(function (k) { return { family: k, variants: Object.keys(fonts[k]).sort() }; }),
        titles: titles,
        assets: assets,   // { id: {name, mime, bytes} } — страница импорта превращает в data:URL
        thumbs: thumbs,   // { titleId: bytes }
        errors: log
      };
    });
  }

  /** Финализация без оптимизации (Node / резерв): байты → data:URL */
  function finalize(pkg) {
    var out = Object.assign({}, pkg, { assets: {}, thumbs: {} });
    Object.keys(pkg.assets).forEach(function (k) {
      var a = pkg.assets[k];
      out.assets[k] = { name: a.name, mime: a.mime, data: a.data || ('data:' + a.mime + ';base64,' + b64(a.bytes)) };
    });
    Object.keys(pkg.thumbs || {}).forEach(function (k) {
      var t = pkg.thumbs[k];
      out.thumbs[k] = typeof t === 'string' ? t : 'data:image/png;base64,' + b64(t);
    });
    delete out.errors;
    return out;
  }

  return {
    FORMAT: FORMAT,
    parseXML: parseXML, parseDocument: parseDocument, color: color,
    convertFiles: convertFiles, finalize: finalize, slug: slug, hash: fnv1a, b64: b64, sniffMime: sniffMime
  };
});
