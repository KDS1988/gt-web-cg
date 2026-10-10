/*!
 * GT Web CG · lottie-title.js
 * Титры из After Effects (экспорт Bodymovin / Lottie .json) в той же системе, что и титры vMix GT.
 *
 *  - GTLottie.analyze(json, fileName) → описание титра для пакета (поля, маркеры, предупреждения);
 *  - GTRender.LottieTitle — проигрыватель с тем же интерфейсом, что у GTRender.Title
 *    (setData / playIn / playOut / render(now) / destroy), поэтому каналы, пульт, таймеры
 *    и данные с табло работают одинаково для обоих видов титров.
 *
 * Тайминг берётся из маркеров композиции AE:
 *   in   — начало появления (по умолчанию первый кадр);
 *   hold — кадр, на котором титр «стоит» в эфире;
 *   out  — начало ухода (уход проигрывается до конца композиции).
 * Без маркеров: появление — вся композиция, уход — растворение 0,3 с.
 *
 * Поля: каждый текстовый слой → «<Имя слоя>.Text», небольшие картинки (логотипы) → «<Имя слоя>.Source».
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Подготовка JSON                                                     */
  /* ------------------------------------------------------------------ */

  /** Убирает то, на чём lottie-web падает. Возвращает число исправлений. */
  function sanitize(anim) {
    var n = 0;
    function fixLayers(layers) {
      (layers || []).forEach(function (l) {
        var t = l && l.t;
        if (t && t.a && t.a.length) {
          // селектор-выражение (Animation Composer и т.п.) без самого выражения: lottie-web на нём падает
          // и перестаёт рисовать все слои выше
          var keep = t.a.filter(function (a) { var s = a && a.s; return !(s && s.t === 1 && !('x' in s) && !('r' in s)); });
          n += t.a.length - keep.length;
          t.a = keep;
        }
      });
    }
    fixLayers(anim.layers);
    (anim.assets || []).forEach(function (a) { if (a.layers) fixLayers(a.layers); });
    return n;
  }

  function countExpr(o) {
    var n = 0;
    (function walk(v) {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) walk(v[i]); return; }
      if (typeof v.x === 'string' && ('k' in v || 'a' in v || 't' in v)) n++;
      for (var k in v) if (k !== 'p' || typeof v[k] === 'object') walk(v[k]);
    })(o);
    return n;
  }

  function markers(anim) {
    var mk = {};
    (anim.markers || []).forEach(function (m) {
      var name = String(m.cm || '').trim().toLowerCase();
      try { var j = JSON.parse(m.cm); if (j && j.name) name = String(j.name).toLowerCase(); } catch (e) {}
      if (/^(in|start|вход|появление)$/.test(name)) mk.in = m.tm;
      else if (/^(hold|loop|stop|пауза|стоп|удержание)$/.test(name)) mk.hold = m.tm;
      else if (/^(out|end|выход|уход)$/.test(name)) mk.out = m.tm;
    });
    var ip = anim.ip || 0, op = anim.op || ip + 1;
    var res = { ip: ip, op: op, in: mk.in != null ? mk.in : ip };
    if (mk.hold != null) res.hold = mk.hold;
    if (mk.out != null) res.out = mk.out;
    if (res.hold == null) res.hold = res.out != null ? res.out : op - 1;
    if (res.out != null && res.out < res.hold) res.out = res.hold;
    res.named = mk.hold != null || mk.out != null;
    return res;
  }

  // оформление (фоны, узоры, линии, разделители) полями не делаем
  var DECOR = /^(:|[-–—|\/.]+)$|(^|[\s_-])(bg|pattern|line|lines|фон|узор|линия|линии|подложка)(\s|[_-]|\d|$)/i;
  var ICON = /(^|[\s_-])[XVХ✓✗](\s|\d|$)/i;
  function uniq(name, used) {
    var b = String(name || 'Слой').trim() || 'Слой', n = b, k = 2;
    while (used[n]) n = b + ' ' + (k++);
    used[n] = 1;
    return n;
  }

  /**
   * Разбор Lottie JSON → титр пакета (без миниатюры и рамок: их добавляет страница импорта).
   */
  function analyze(anim, fileName) {
    if (!anim || !anim.layers || !anim.v) throw new Error('«' + fileName + '»: это не экспорт Bodymovin/Lottie');
    anim = JSON.parse(JSON.stringify(anim));
    var warnings = [];
    var fixed = sanitize(anim);
    if (fixed) warnings.push('Убраны текстовые аниматоры без выражения (Animation Composer): ' + fixed);
    var ex = countExpr(anim);
    if (ex) warnings.push('В файле остались выражения AE (' + ex + '): они считаются в браузере и могут вести себя иначе. Лучше «запечь» их перед экспортом.');
    if (anim.chars && anim.chars.length) warnings.push('Шрифты экспортированы как глифы (Glyphs): тексты можно менять только в пределах экспортированных букв. Отключите Glyphs в настройках Bodymovin.');
    var mk = markers(anim);
    if (!mk.named) warnings.push('В композиции нет маркеров in / hold / out: появление — вся композиция, уход — растворение.');
    var assets = {};
    (anim.assets || []).forEach(function (a) { assets[a.id] = a; });
    var external = (anim.assets || []).filter(function (a) { return a.p && !a.e && !/^data:/.test(a.p) && !a.layers; });
    if (external.length) warnings.push('Картинки не вложены в JSON (' + external.length + '): включите Assets → Include in json в Bodymovin.');
    var fields = [], used = {}, fx = {};
    anim.layers.forEach(function (l, i) {
      if (l.ef && l.ef.length) l.ef.forEach(function (e) { fx[e.nm] = 1; });
      if (l.td) return; // слой-маска (track matte)
      if (l.ty === 5 && l.t && l.t.d && l.t.d.k && l.t.d.k.length) {
        var s = l.t.d.k[0].s || {};
        fields.push({ k: uniq(l.nm, used) + '.Text', o: l.nm, li: i, kind: 'text', label: String(l.nm || 'Текст'), def: String(s.t == null ? '' : s.t).replace(/\r/g, '\n') });
      } else if (l.ty === 2 && assets[l.refId]) {
        var a = assets[l.refId];
        // логотипы, эмблемы, значки — небольшие картинки; фоны и линии полями не делаем
        if (a.w >= 8 && a.h >= 8 && a.w <= 600 && a.h <= 600 && !DECOR.test(String(l.nm).trim())) {
          var nm = uniq(l.nm, used);
          // значки-отметки (1-X, 1-V …) только включаются/выключаются, логотипы ещё и меняются
          if (!ICON.test(l.nm)) fields.push({ k: nm + '.Source', o: l.nm, li: i, kind: 'image', label: String(l.nm || 'Картинка'), def: '' });
          fields.push({ k: nm + '.Visible', o: l.nm, li: i, kind: 'visible', label: String(l.nm || 'Картинка'), def: !ICON.test(l.nm) }); // отметки по умолчанию выключены
        }
      }
      if (l.ddd) warnings.push('3D-слой «' + l.nm + '» — lottie показывает 3D упрощённо');
    });
    var fxn = Object.keys(fx);
    if (fxn.length) warnings.push('Эффекты AE на слоях (' + fxn.slice(0, 5).join(', ') + (fxn.length > 5 ? '…' : '') + ') — lottie-web поддерживает только часть эффектов');
    var fonts = ((anim.fonts && anim.fonts.list) || []).map(function (f) { return { family: f.fFamily || f.fName, variants: ['400'], lottie: f.fName }; });
    var base = String(fileName || 'Lottie').replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
    return {
      title: {
        kind: 'lottie', id: base, name: anim.nm && !/^(comp|композиция)/i.test(anim.nm) ? anim.nm : base, file: String(fileName || '').replace(/^.*[\\/]/, ''),
        w: anim.w, h: anim.h, fr: anim.fr, mk: mk, anim: anim, objects: [], fields: fields, sb: {}, warnings: warnings
      },
      fonts: fonts
    };
  }

  root.GTLottie = { analyze: analyze, sanitize: sanitize, markers: markers };

  /* ------------------------------------------------------------------ */
  /* Проигрыватель                                                       */
  /* ------------------------------------------------------------------ */
  var R = root.GTRender;
  if (!R) return;
  var animStr = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function cloneAnim(def, pkgAssets) {
    var s = animStr && animStr.get(def);
    if (!s) {
      var a = JSON.parse(JSON.stringify(def.anim));
      sanitize(a);
      s = JSON.stringify(a);
      if (animStr) animStr.set(def, s);
    }
    var out = JSON.parse(s);
    // картинки вынесены в общий словарь пакета (одинаковые хранятся один раз): "asset:<id>"
    (out.assets || []).forEach(function (a) {
      if (typeof a.p === 'string' && a.p.indexOf('asset:') === 0) {
        var x = pkgAssets && pkgAssets[a.p.slice(6)];
        a.p = x ? x.data : '';
        a.u = ''; a.e = 1;
      }
    });
    return out;
  }

  /** Ширина строки текста слоя (для подгонки под maxW) */
  var measCtx = null;
  function textWidth(str, family, size, tr) {
    if (!measCtx) measCtx = document.createElement('canvas').getContext('2d');
    measCtx.font = size + 'px "' + family + '"';
    var w = 0;
    String(str).split(/\r|\n/).forEach(function (line) { w = Math.max(w, measCtx.measureText(line).width + (tr || 0) / 1000 * size * Math.max(0, line.length - 1)); });
    return w;
  }

  function LottieTitle(stage, def, data, z) {
    var self = this;
    this.isLottie = true;
    this.stage = stage;
    this.def = def;
    this.W = def.w || stage.W; this.H = def.h || stage.H;
    this.mk = def.mk || markers(def.anim);
    this.fr = def.fr || def.anim.fr || 25;
    this.data = {};
    this.objs = [];       // совместимость со Stage.relayout
    this.phase = 'hidden';
    this.seg = null;      // { from, to, t0, next }
    this.frame = this.mk.in;
    this.dirty = true;
    this.el = document.createElement('div');
    this.el.className = 'gt-title gt-lottie';
    this.el.style.cssText = 'position:absolute;left:0;top:0;width:' + this.W + 'px;height:' + this.H + 'px;overflow:hidden;pointer-events:none;visibility:hidden';
    if (z != null) this.el.style.zIndex = String(z);
    stage.el.appendChild(this.el);
    this.anim = root.lottie.loadAnimation({
      container: this.el, renderer: 'svg', loop: false, autoplay: false, animationData: cloneAnim(def, stage.pkg && stage.pkg.assets),
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false, hideOnTransparent: true }
    });
    this.loaded = new Promise(function (res) {
      if (self.anim.isLoaded) res();
      self.anim.addEventListener('DOMLoaded', res);
      setTimeout(res, 6000);
    }).then(function () {
      self.ok = true;
      self._applyData(true);
      self.dirty = true;
    });
    this.setData(data || {}, false);
  }

  LottieTitle.prototype._el = function (f) {
    var r = this.anim && this.anim.renderer;
    var e = r && r.elements && r.elements[f.li];
    if (e && e.data && e.data.nm === f.o) return e;
    // на случай, если порядок слоёв поменялся — поиск по имени
    for (var i = 0; r && r.elements && i < r.elements.length; i++) {
      e = r.elements[i];
      if (e && e.data && e.data.nm === f.o && ((f.kind === 'text' && e.data.ty === 5) || (f.kind === 'image' && e.data.ty === 2))) return e;
    }
    return null;
  };

  /** Все элементы с именем слоя (включая копии в прекомпозициях-масках), по порядку обхода */
  LottieTitle.prototype._all = function (f) {
    var out = [], ty = f.kind === 'text' ? 5 : 2;
    (function walk(list) {
      (list || []).forEach(function (e) {
        if (!e || !e.data) return;
        if (e.data.nm === f.o && e.data.ty === ty) out.push(e);
        if (e.elements) walk(e.elements);
      });
    })(this.anim && this.anim.renderer && this.anim.renderer.elements);
    return out;
  };

  LottieTitle.prototype.setData = function (data, animate) {
    var self = this, changed = [];
    data = data || {};
    (this.def.fields || []).forEach(function (f) {
      var v = data[f.k] !== undefined ? data[f.k] : f.def;
      if (JSON.stringify(self.data[f.k]) !== JSON.stringify(v)) { changed.push(f.k); self.data[f.k] = v; }
    });
    this.hasTimer = (this.def.fields || []).some(function (f) { var v = self.data[f.k]; return v && typeof v === 'object' && v.tm && v.tm.run; });
    if (this.ok) this._applyData(false);
    this.dirty = true;
    return changed;
  };

  LottieTitle.prototype._applyData = function (force) {
    var self = this, now = R.now(), any = false;
    // общая подгонка шрифта группы полей (f.fitGroup): у всех один размер — по самому длинному тексту
    var gfit = {};
    (this.def.fields || []).forEach(function (f) {
      if (!f.fitGroup || f.kind !== 'text' || !f.maxW) return;
      var e = self._el(f), doc = e && e.textProperty && e.textProperty.data && e.textProperty.data.d && e.textProperty.data.d.k[0] && e.textProperty.data.d.k[0].s;
      if (!doc) return;
      if (doc._s0 == null) doc._s0 = doc.s;
      var fm = self.anim.renderer.globalData && self.anim.renderer.globalData.fontManager;
      var fo = fm && fm.getFontByName ? fm.getFontByName(doc.f) : null;
      var w = textWidth(R.textOf(self.data[f.k], now).replace(/\n/g, '\r'), (fo && fo.fFamily) || doc.f, doc._s0, doc.tr);
      var k = w > f.maxW ? f.maxW / w : 1;
      gfit[f.fitGroup] = Math.min(gfit[f.fitGroup] == null ? 1 : gfit[f.fitGroup], k);
    });
    (this.def.fields || []).forEach(function (f) {
      var v = self.data[f.k];
      if (f.kind === 'text') {
        var s = R.textOf(v, now), fc = null, sig;
        if (f.cmp) { // цвет по сравнению с другим полем: больше — hiC, иначе loC
          var a = parseFloat(String(s).replace(',', '.')), b = parseFloat(String(R.textOf(self.data[f.cmp], now)).replace(',', '.'));
          fc = (isFinite(a) && isFinite(b) && a > b) ? f.hiC : f.loC;
        }
        sig = (fc ? s + '|' + fc.join(',') : s) + (f.fitGroup && gfit[f.fitGroup] != null ? '|g' + gfit[f.fitGroup] : '');
        if (!force && self['t:' + f.k] === sig) return;
        if (self['t:' + f.k] === undefined && s === f.def && !fc && !f.fitGroup && !force) { self['t:' + f.k] = s; return; }
        var main = self._el(f);
        if (!main || !main.textProperty) return;
        // сам слой + его копии в масках (подготовка T → Alpha Matte кладёт туда тексты)
        var list = [main].concat(self._all(f).filter(function (x) { return x !== main && (x.data.t && x.data.t.d && JSON.stringify(x.data.t.d.k[0].s.t) === JSON.stringify(f.def)); }));
        if (!self['tl:' + f.k]) self['tl:' + f.k] = list;
        var fit = f.fitGroup && gfit[f.fitGroup] != null ? gfit[f.fitGroup] : null; // подгонка длинного текста под ширину места в макете (f.maxW): шрифт меньше
        self['tl:' + f.k].forEach(function (e) {
          if (!e.textProperty) return;
          var keys = (e.textProperty.data && e.textProperty.data.d && e.textProperty.data.d.k) || [];
          for (var i = 0; i < Math.max(1, keys.length); i++) {
            var doc = keys[i] && keys[i].s, upd = { t: s.replace(/\n/g, '\r') };
            if (fc) upd.fc = fc;
            if (doc && f.maxW) {
              if (doc._s0 == null) doc._s0 = doc.s;
              if (fit == null) {
                var fm = self.anim.renderer.globalData && self.anim.renderer.globalData.fontManager;
                var fo = fm && fm.getFontByName ? fm.getFontByName(doc.f) : null;
                var w = textWidth(upd.t, (fo && fo.fFamily) || doc.f, doc._s0, doc.tr);
                fit = w > f.maxW ? f.maxW / w : 1;
              }
              upd.s = Math.round(doc._s0 * fit * 10) / 10;
            }
            e.updateDocumentData(upd, i);
          }
        });
        self['t:' + f.k] = sig;
        any = true;
      } else if (f.kind === 'image') {
        var src = v ? self.assetUrl(v) : '';
        if (!force && self['i:' + f.k] === src) return;
        var ie = self._el(f), node = ie && ie.innerElem;
        if (!node) return;
        if (self['i:' + f.k] === undefined) self['i0:' + f.k] = node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || node.getAttribute('href');
        var href = src || self['i0:' + f.k] || '';
        node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href);
        node.setAttribute('preserveAspectRatio', src ? 'xMidYMid meet' : 'xMidYMid slice');
        self['i:' + f.k] = src;
        any = true;
      } else if (f.kind === 'visible') {
        var on = !(v === false || v === 'false' || v === 0 || v === '0');
        if (!force && self['v:' + f.k] === on) return;
        var ve = self._el(f);
        if (!ve || !ve.layerElement) return;
        ve.layerElement.style.visibility = on ? '' : 'hidden';
        self['v:' + f.k] = on;
      }
    });
    // правила скрытия слоёв по значению поля: def.hide = [{layers:[имя слоя…], field:'Поле.Text', re:'^ПОСЛЕ'}]
    (this.def.hide || []).forEach(function (h, i) {
      var off = false; // fields — все поля должны подходить под re
      try { var re = new RegExp(h.re, 'i'); off = (h.fields || [h.field]).every(function (k) { return re.test(String(R.textOf(self.data[k], now))); }); } catch (e) {}
      if (!force && self['h:' + i] === off) return;
      self['h:' + i] = off;
      (function walk(list) {
        (list || []).forEach(function (e) {
          if (!e || !e.data) return;
          if (h.layers.indexOf(e.data.nm) >= 0 && e.layerElement) e.layerElement.style.display = off ? 'none' : '';
          if (e.elements) walk(e.elements);
        });
      })(self.anim && self.anim.renderer && self.anim.renderer.elements);
      any = true;
    });
    if (any) this._force = true;
  };

  LottieTitle.prototype.assetUrl = function (v) {
    var a = (this.stage.pkg.assets || {})[v];
    return a ? a.data : v;
  };

  LottieTitle.prototype.layout = function () { this.dirty = true; };

  LottieTitle.prototype._go = function (from, to, next) {
    this.seg = { from: from, to: to, t0: null, next: next || null };
    this.dirty = true;
  };

  LottieTitle.prototype.playIn = function () {
    var self = this;
    this.phase = 'in';
    this.loaded.then(function () {
      if (self.phase !== 'in') return;
      self.el.style.visibility = '';
      self._go(self.mk.in, self.mk.hold, function () { self.phase = 'idle'; });
    });
  };

  LottieTitle.prototype.playOut = function () {
    var self = this;
    if (this.phase === 'out' || this.phase === 'gone') return this._outP || Promise.resolve();
    var wasHidden = this.phase === 'hidden';
    this.phase = 'out';
    this._outP = new Promise(function (res) {
      var done = function () { self.phase = 'gone'; res(); };
      if (wasHidden || !self.ok) { done(); return; }
      if (self.mk.out != null && self.mk.out < self.mk.op) {
        // уход прямо во время появления: прыжок на начало ухода
        self._go(self.mk.out, self.mk.op - 1, done);
      } else {
        self._fade = { t0: null, dur: 300 };
        self._go(self.frame, self.frame, null);
        self._fadeDone = done;
      }
    });
    return this._outP;
  };

  LottieTitle.prototype.freeze = function () {
    var self = this;
    this.phase = 'idle';
    return this.loaded.then(function () { self.el.style.visibility = ''; self.frame = self.mk.hold; self.dirty = true; });
  };

  LottieTitle.prototype.render = function (now) {
    if (this.phase === 'hidden' || this.phase === 'gone' || !this.ok) return;
    if (this.hasTimer) this._applyData(false);
    var seg = this.seg, f = this.frame, ended = false;
    if (seg) {
      if (seg.t0 == null) seg.t0 = now;
      f = seg.from + (now - seg.t0) / 1000 * this.fr;
      if (f >= seg.to) { f = seg.to; ended = true; }
    }
    if (this._fade) {
      if (this._fade.t0 == null) this._fade.t0 = now;
      var p = Math.min(1, (now - this._fade.t0) / this._fade.dur);
      this.el.style.opacity = String(1 - p);
      if (p >= 1) { this._fade = null; var d = this._fadeDone; this._fadeDone = null; if (d) d(); return; }
    }
    if (f !== this.frame || this.dirty || this._force) {
      if (this._force) { this.anim.renderer.renderedFrame = -1e9; this._force = false; }
      this.frame = f;
      this.anim.goToAndStop(f, true);
      this.dirty = false;
    }
    if (ended) {
      var nx = seg.next;
      this.seg = null;
      if (nx) nx();
    }
  };

  LottieTitle.prototype.destroy = function () {
    this.phase = 'gone';
    try { this.anim.destroy(); } catch (e) {}
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  };

  R.LottieTitle = LottieTitle;
})(typeof self !== 'undefined' ? self : this);
