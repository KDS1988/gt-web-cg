/*!
 * GT Web CG · gt-render.js
 * Движок воспроизведения титров vMix GT в браузере: сцена, маски, автоподгонка текста,
 * storyboards TransitionIn / TransitionOut / DataChangeIn / DataChangeOut / Continuous, таймеры.
 *
 * Модель анимации (как в GT Designer):
 *  - каждая анимация описывает ПОЯВЛЕНИЕ объекта; в TransitionOut и DataChangeOut она проигрывается обратно (исчезновение);
 *  - Reverse="True" зеркалит направление (Left↔Right, Top↔Bottom);
 *  - Hidden — объект скрыт всё время storyboard и после него;
 *  - объект, которого нет в storyboard, виден;
 *  - после окончания storyboard сцена «замирает» в его конечном состоянии;
 *  - при изменении поля с DataChange-storyboard: сначала DataChangeIn, затем DataChangeOut.
 */
(function (root) {
  'use strict';

  function gtNow() { return root.CG && root.CG.clock ? root.CG.clock.now() : Date.now(); }

  /* ------------------------------------------------------------------ */
  /* Интерполяция                                                         */
  /* ------------------------------------------------------------------ */
  var BASE = {
    linear: function (p) { return p; },
    quadratic: function (p) { return p * p; },
    cubic: function (p) { return p * p * p; },
    quartic: function (p) { return p * p * p * p; },
    quintic: function (p) { return p * p * p * p * p; },
    sine: function (p) { return 1 - Math.cos(p * Math.PI / 2); },
    exponential: function (p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); },
    circle: function (p) { return 1 - Math.sqrt(1 - p * p); },
    back: function (p) { var s = 1.70158; return p * p * ((s + 1) * p - s); },
    elastic: function (p) { return p === 0 || p === 1 ? p : -Math.pow(2, 10 * (p - 1)) * Math.sin((p - 1.075) * 2 * Math.PI / 0.3); },
    bounce: function (p) { return 1 - bounceOut(1 - p); }
  };
  function bounceOut(p) {
    if (p < 1 / 2.75) return 7.5625 * p * p;
    if (p < 2 / 2.75) { p -= 1.5 / 2.75; return 7.5625 * p * p + 0.75; }
    if (p < 2.5 / 2.75) { p -= 2.25 / 2.75; return 7.5625 * p * p + 0.9375; }
    p -= 2.625 / 2.75; return 7.5625 * p * p + 0.984375;
  }
  var easeCache = {};
  function ease(name) {
    name = name || 'Linear';
    if (easeCache[name]) return easeCache[name];
    var m = /^([a-z]+?)(?:easing)?(inout|in|out)?$/i.exec(String(name).replace(/[\s_-]/g, ''));
    var base = m && BASE[m[1].toLowerCase()] || BASE.linear, mode = (m && m[2] || 'in').toLowerCase();
    if (m && m[1].toLowerCase() === 'linear') mode = 'in';
    var f = mode === 'in' ? base
      : mode === 'out' ? function (p) { return 1 - base(1 - p); }
        : function (p) { return p < 0.5 ? base(p * 2) / 2 : 1 - base((1 - p) * 2) / 2; };
    return (easeCache[name] = f);
  }

  /* ------------------------------------------------------------------ */
  /* Кисти                                                               */
  /* ------------------------------------------------------------------ */
  function brushCss(b, w, h, assetUrl) {
    if (!b) return 'none';
    if (b.t === 'solid') return b.c;
    if (b.t === 'image') return 'url("' + assetUrl(b.src) + '") center / 100% 100% no-repeat';
    if (b.t === 'radial') {
      return 'radial-gradient(ellipse at center, ' + b.stops.map(function (s) { return s.c + ' ' + (s.p * 100).toFixed(2) + '%'; }).join(', ') + ')';
    }
    // WPF LinearGradientBrush (точки в долях рамки) → CSS-угол с пересчётом позиций стопов
    w = w || 1; h = h || 1;
    var sx = b.s[0] * w, sy = b.s[1] * h, ex = b.e[0] * w, ey = b.e[1] * h;
    var dx = ex - sx, dy = ey - sy;
    if (!dx && !dy) return b.stops[0].c;
    var ang = Math.atan2(dx, -dy); // 0 = вверх, по часовой
    var ux = Math.sin(ang), uy = -Math.cos(ang);
    var L = Math.abs(w * ux) + Math.abs(h * uy);
    var cx = w / 2, cy = h / 2;
    var stops = b.stops.map(function (s) {
      var px = sx + dx * s.p, py = sy + dy * s.p;
      var pos = ((px - cx) * ux + (py - cy) * uy) / L + 0.5;
      return s.c + ' ' + (pos * 100).toFixed(2) + '%';
    });
    return 'linear-gradient(' + (ang * 180 / Math.PI).toFixed(2) + 'deg, ' + stops.join(', ') + ')';
  }

  /* ------------------------------------------------------------------ */
  /* Таймеры                                                             */
  /* ------------------------------------------------------------------ */
  // value = { tm: { ms: база, run: идёт?, at: epoch старта, dir: -1|1, fmt: 'mm:ss'|'m:ss'|'auto'|'hh:mm:ss', stop0: true } }
  function timerMs(tm, now) {
    var v = tm.ms || 0;
    if (tm.run && tm.at) v += (tm.dir < 0 ? -1 : 1) * (now - tm.at);
    if (tm.dir < 0 && v < 0) v = 0;
    if (tm.lim && tm.dir > 0 && v > tm.lim) v = tm.lim;
    return v;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTimer(ms, fmt, dir) {
    fmt = fmt || 'mm:ss';
    // обратный отсчёт округляем вверх (20:00 → 19:59 только через секунду)
    var tot = dir < 0 ? Math.ceil(ms / 1000 - 1e-6) : Math.floor(ms / 1000 + 1e-6);
    if ((fmt === 'auto' || fmt === 'auto.') && ms < 60000 && dir < 0) {
      var t = Math.ceil(ms / 100 - 1e-6) / 10;
      return t.toFixed(1);
    }
    var h = Math.floor(tot / 3600), m = Math.floor(tot / 60) % 60, s = tot % 60;
    if (fmt === 'hh:mm:ss') return pad(h) + ':' + pad(m) + ':' + pad(s);
    var mm = h * 60 + m;
    if (fmt === 'm:ss' || fmt === 'auto') return mm + ':' + pad(s);
    if (fmt === 'auto.') return mm + '.' + pad(s);
    if (fmt === 'ss') return String(tot);
    if (fmt === 'mm.ss') return pad(mm) + '.' + pad(s);
    if (fmt === 'm.ss') return mm + '.' + pad(s);
    return pad(mm) + ':' + pad(s);
  }
  function textOf(v, now) {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.tm) return fmtTimer(timerMs(v.tm, now), v.tm.fmt, v.tm.dir);
      if (v.text != null) return String(v.text);
      return '';
    }
    return String(v);
  }

  /* ------------------------------------------------------------------ */
  /* Шрифты                                                              */
  /* ------------------------------------------------------------------ */
  var fontsLoaded = {};
  function loadFonts(pkg) {
    var jobs = [];
    (pkg.fontFiles || []).forEach(function (f) {
      var key = f.family + '|' + f.weight + '|' + (f.style || 'normal') + '|' + (f.range || '');
      if (fontsLoaded[key]) return;
      fontsLoaded[key] = 1;
      try {
        var desc = { weight: String(f.weight || 400), style: f.style || 'normal', display: 'block' };
        if (f.range) desc.unicodeRange = f.range;
        var ff = new FontFace(f.family, 'url(' + f.data + ')', desc);
        document.fonts.add(ff);
        jobs.push(ff.load().catch(function () {}));
      } catch (e) {}
    });
    (pkg.fonts || []).forEach(function (f) {
      (f.variants || ['400']).forEach(function (v) {
        var w = parseInt(v, 10) || 400, it = /i$/.test(v);
        if (document.fonts && document.fonts.load) jobs.push(document.fonts.load((it ? 'italic ' : '') + w + ' 40px "' + f.family + '"', 'АаZz09').catch(function () {}));
      });
    });
    var timeout = new Promise(function (r) { setTimeout(r, 4000); });
    return Promise.race([Promise.all(jobs), timeout]).then(function () { return document.fonts ? document.fonts.ready : null; });
  }

  /* ------------------------------------------------------------------ */
  /* Титр                                                                */
  /* ------------------------------------------------------------------ */
  var FLIP = { Left: 'Right', Right: 'Left', Top: 'Bottom', Bottom: 'Top' };
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function same(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }

  function Title(stage, def, data, z) {
    this.stage = stage;
    this.def = def;
    this.W = def.w || stage.W; this.H = def.h || stage.H;
    this.data = {};
    this.objs = [];
    this.byName = {};
    this.phase = 'hidden';
    this.sb = null;      // текущий storyboard {list, mode, t0, dur, next}
    this.held = null;    // замороженный storyboard (конечное состояние)
    this.cont = def.sb && def.sb.cont && def.sb.cont.length ? { list: def.sb.cont, dur: sbDur(def.sb.cont) || 1 } : null;
    this.tStart = performance.now();
    this.el = document.createElement('div');
    this.el.className = 'gt-title';
    this.el.style.cssText = 'position:absolute;left:0;top:0;width:' + this.W + 'px;height:' + this.H + 'px;overflow:hidden;pointer-events:none;visibility:hidden';
    this._build();
    if (z != null) this.el.style.zIndex = String(z);
    stage.el.appendChild(this.el); // до вёрстки: размеры текста меряются только в документе
    this.setData(data || {}, false);
    this.dirty = true;
  }

  function sbDur(list) {
    var d = 0;
    (list || []).forEach(function (a) { if (a.t !== 'Hidden') d = Math.max(d, (a.d || 0) + (a.u || 0)); });
    return d;
  }

  Title.prototype._build = function () {
    var self = this, def = this.def;
    var animated = {};
    var sbs = def.sb || {};
    [sbs.in, sbs.out, sbs.cont].concat((sbs.dc || []).map(function (d) { return d.a; })).forEach(function (l) {
      (l || []).forEach(function (a) { if (a.t !== 'Hidden') animated[a.o] = 1; });
    });
    def.objects.forEach(function (o) { if (o.mask && animated[o.mask]) animated[o.n] = 1; if (o.lay && animated[o.lay]) animated[o.n] = 1; });
    var layers = {};
    def.objects.forEach(function (o) { if (o.t === 'layer') layers[o.n] = o; });
    this.layers = layers;
    def.objects.forEach(function (o) {
      if (o.t === 'layer') return;
      var rec = { o: o, g: { x: o.x, y: o.y, w: o.w, h: o.h }, fill: o.fill || null, vis: true, text: '', src: o.img || '', st: {}, css: {} };
      var e = document.createElement('div'); e.className = 'gt-o gt-' + o.t; e.setAttribute('data-n', o.n);
      var c = document.createElement('div'); c.className = 'gt-c';
      var k = document.createElement(o.t === 'image' ? 'img' : 'div'); k.className = 'gt-k';
      e.style.cssText = 'position:absolute;transform-origin:0 0' + (animated[o.n] ? ';will-change:transform,opacity' : ''); // слой только тем, кто двигается
      c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%' + (o.fx && (o.fx.sh || o.fx.blur) && animated[o.n] ? ';will-change:transform' : ''); // тень растрируется один раз
      k.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;box-sizing:border-box';
      if (o.t === 'ellipse') k.style.borderRadius = '50%';
      if (o.t === 'image') { k.alt = ''; k.draggable = false; k.style.objectFit = { fill: 'fill', uniform: 'contain', uniformtofill: 'cover', none: 'none' }[o.fit] || 'contain'; }
      if (o.t === 'text') {
        var T = o.text;
        k.style.display = 'flex';
        k.style.flexDirection = 'column';
        k.style.justifyContent = T.va === 'center' ? 'center' : T.va === 'bottom' ? 'flex-end' : 'flex-start';
        k.style.alignItems = T.al === 'center' ? 'center' : T.al === 'right' ? 'flex-end' : 'flex-start';
        var sp = document.createElement('span');
        sp.className = 'gt-t';
        sp.style.cssText = 'display:inline-block;max-width:none;line-height:normal;font-kerning:normal;' +
          'font-family:"' + T.ff + '",sans-serif;font-weight:' + T.fw + ';font-style:' + (T.it ? 'italic' : 'normal') + ';' +
          'text-align:' + T.al + ';text-transform:' + (T.up ? 'uppercase' : T.lo ? 'lowercase' : 'none') + ';' +
          'white-space:' + (T.wrap && T.auto !== 'wh' && T.auto !== 'w' ? 'pre-wrap' : 'pre') + ';' +
          (T.cs ? 'letter-spacing:' + (T.cs / 1000) + 'em;' : '');
        if (T.wrap && T.auto !== 'wh' && T.auto !== 'w') sp.style.width = '103%'; // допуск 3%: рамки в GT подогнаны под текст впритык, сглаживание Windows/Mac отличается
        if (o.stroke) { sp.style.webkitTextStroke = o.stroke.w + 'px ' + (o.stroke.b.c || '#000'); sp.style.paintOrder = 'stroke fill'; }
        k.appendChild(sp);
        rec.sp = sp;
      } else if (o.stroke && o.stroke.b.t === 'solid') {
        k.style.boxShadow = 'inset 0 0 0 ' + o.stroke.w + 'px ' + o.stroke.b.c;
      }
      if (o.fx && (o.fx.flipX || o.fx.flipY)) k.style.transform = 'scale(' + (o.fx.flipX ? -1 : 1) + ',' + (o.fx.flipY ? -1 : 1) + ')';
      var filt = [];
      if (o.fx && o.fx.sh) filt.push('drop-shadow(' + o.fx.sh.dx + 'px ' + o.fx.sh.dy + 'px ' + o.fx.sh.b + 'px ' + o.fx.sh.c + ')');
      if (o.fx && o.fx.blur) filt.push('blur(' + o.fx.blur + 'px)');
      if (filt.length) k.style.filter = filt.join(' '); // тень «запекается» в растр слоя c, а не считается при каждой композиции
      rec.pad = o.fx && o.fx.sh ? o.fx.sh.b * 2 + Math.max(Math.abs(o.fx.sh.dx), Math.abs(o.fx.sh.dy)) + 2 : 0;
      c.appendChild(k); e.appendChild(c);
      rec.e = e; rec.c = c; rec.k = k;
      self.el.appendChild(e);
      self.objs.push(rec);
      self.byName[o.n] = rec;
    });
    // анимации на слой → на все его объекты
    this._childrenOf = function (name) {
      var out = [];
      def.objects.forEach(function (o) {
        var l = o.lay;
        while (l) { if (l === name) { if (o.t !== 'layer') out.push(o.n); break; } l = layers[l] && layers[l].lay; }
      });
      return out;
    };
  };

  Title.prototype._index = function (list) {
    if (!list) return {};
    if (list._idx) return list._idx;
    var idx = {}, self = this;
    list.forEach(function (a) {
      var targets = self.byName[a.o] ? [a.o] : (self.layers[a.o] ? self._childrenOf(a.o) : []);
      targets.forEach(function (n) { (idx[n] = idx[n] || []).push(a); });
    });
    Object.defineProperty(list, '_idx', { value: idx, enumerable: false });
    return idx;
  };

  Title.prototype.assetUrl = function (v) {
    if (!v) return '';
    if (/^(data:|https?:|blob:|\/|\.\/|[\w-]+\/)/.test(v) && !(this.stage.pkg.assets || {})[v]) return v;
    var a = (this.stage.pkg.assets || {})[v];
    return a ? a.data : '';
  };

  /** Новые значения полей. animate=true — запускать DataChange-storyboards. */
  Title.prototype.setData = function (data, animate) {
    var self = this, changed = [];
    data = data || {};
    (this.def.fields || []).forEach(function (f) {
      var v = data[f.k] !== undefined ? data[f.k] : f.def;
      if (!same(self.data[f.k], v)) {
        // таймер: смена хода/базы не считается «изменением данных» для DataChange
        var wasT = self.data[f.k] && typeof self.data[f.k] === 'object' && self.data[f.k].tm;
        var isT = v && typeof v === 'object' && v.tm;
        if (!(wasT && isT)) changed.push(f.k);
        self.data[f.k] = v;
      }
    });
    this.hasTimer = (this.def.fields || []).some(function (f) { var v = self.data[f.k]; return v && typeof v === 'object' && v.tm && v.tm.run; });
    this._applyData();
    this.layout();
    this.dirty = true;
    if (animate && changed.length) {
      if (this.phase === 'idle' || this.phase === 'dc') this._dataChange(changed);
      else if (this.phase === 'in') this._pendingDC = (this._pendingDC || []).concat(changed); // после появления
    }
    return changed;
  };

  Title.prototype._applyData = function () {
    var self = this, now = gtNow();
    this.objs.forEach(function (r) {
      var o = r.o, n = o.n;
      var vis = self.data[n + '.Visible'];
      r.vis = vis === undefined ? true : !(vis === false || vis === 'false' || vis === 0 || vis === '0');
      if (o.t === 'text') {
        var tv = self.data[n + '.Text'];
        r.text = textOf(tv === undefined ? o.text.s : tv, now);
        if (r.sp.textContent !== r.text) { r.sp.textContent = r.text; r.needLayout = true; }
      }
      if (o.t === 'image') {
        var sv = self.data[n + '.Source'];
        var src = self.assetUrl(sv === undefined ? o.img : sv);
        if (r.src !== src) {
          r.src = src;
          if (src) { r.k.src = src; r.k.style.display = ''; if (r.k.decode) (self._imgWait = self._imgWait || []).push(r.k.decode().catch(function () {})); }
          else { r.k.removeAttribute('src'); r.k.style.display = 'none'; }
        }
      }
      var cv = self.data[n + '.Fill'];
      if (cv !== undefined && cv !== null && cv !== '') r.fill = { t: 'solid', c: String(cv) };
      else r.fill = o.fill || null;
    });
  };

  /** Тикающие таймеры: обновить только текст */
  Title.prototype._tickTimers = function () {
    if (!this.hasTimer) return;
    var self = this, now = gtNow(), relayout = false;
    this.objs.forEach(function (r) {
      if (r.o.t !== 'text') return;
      var v = self.data[r.o.n + '.Text'];
      if (!v || typeof v !== 'object' || !v.tm) return;
      var s = textOf(v, now);
      if (s !== r.text) { r.text = s; r.sp.textContent = s; if (r.o.text.auto !== 'none') { r.needLayout = true; relayout = true; } }
    });
    if (relayout) { this.layout(); this.dirty = true; }
  };

  /** Геометрия: автоподгонка текста, Bounding */
  Title.prototype.layout = function () {
    var self = this;
    this.objs.forEach(function (r) {
      var o = r.o;
      if (o.t !== 'text') return;
      var T = o.text, sp = r.sp, g = r.g;
      // размеры рамки — ДО замера: иначе перенос считается по нулевой ширине и Shrink сжимает шрифт до нечитаемого
      if (T.auto === 'shrink' || T.auto === 'none') { r.e.style.width = o.w + 'px'; r.e.style.height = o.h + 'px'; r.gkey = null; }
      else if (T.auto === 'h') { r.e.style.width = o.w + 'px'; r.gkey = null; }
      else if (T.auto === 'w') { r.e.style.height = o.h + 'px'; r.gkey = null; }
      if (T.auto === 'wh' || T.auto === 'w' || T.auto === 'h') {
        sp.style.fontSize = T.fs + 'px';
        var w = r.text ? sp.offsetWidth : 0, h = r.text ? sp.offsetHeight : 0;
        if (!r.text) { w = 0; h = T.auto === 'w' ? o.h : 0; }
        if (T.auto !== 'h') {
          g.w = w;
          g.x = o.x; // GT: Location (левый верх) при AutoSize не сдвигается
        }
        if (T.auto !== 'w') {
          g.h = h;
          g.y = o.y;
        }
      } else if (T.auto === 'shrink') {
        g.x = o.x; g.y = o.y; g.w = o.w; g.h = o.h;
        var fits = function (fs) {
          sp.style.fontSize = fs + 'px';
          if (T.wrap) return sp.offsetHeight <= o.h + 0.5 && sp.scrollWidth <= o.w * 1.03 + 0.5;
          return sp.offsetWidth <= o.w + 0.5 && sp.offsetHeight <= o.h * 1.15 + 0.5;
        };
        if (!fits(T.fs)) {
          var lo = 4, hi = T.fs;
          for (var i = 0; i < 9; i++) { var mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
          sp.style.fontSize = lo.toFixed(2) + 'px';
        }
      } else sp.style.fontSize = T.fs + 'px';
    });
    // Bounding (2 прохода — на случай цепочек)
    for (var pass = 0; pass < 2; pass++) {
      this.objs.forEach(function (r) {
        var b = r.o.bound; if (!b) return;
        var t = self.byName[b.o]; if (!t) return;
        var tg = t.g, p = b.p;
        var empty = t.o.t === 'text' && !t.text;
        r.g.x = tg.x - p[0]; r.g.y = tg.y - p[1];
        r.g.w = empty ? 0 : tg.w + p[0] + p[2];
        r.g.h = empty ? 0 : tg.h + p[1] + p[3];
      });
    }
    this.objs.forEach(function (r) {
      var g = r.g, e = r.e, key = g.x + ',' + g.y + ',' + g.w + ',' + g.h;
      if (r.gkey !== key) {
        r.gkey = key;
        e.style.left = g.x + 'px'; e.style.top = g.y + 'px'; e.style.width = Math.max(0, g.w) + 'px'; e.style.height = Math.max(0, g.h) + 'px';
      }
      var fk = JSON.stringify(r.fill) + '|' + Math.round(g.w) + 'x' + Math.round(g.h);
      if (r.fkey !== fk) {
        r.fkey = fk;
        var css = brushCss(r.fill, g.w, g.h, self.assetUrl.bind(self));
        if (r.o.t === 'text') {
          if (!r.fill || r.fill.t === 'solid') { r.sp.style.color = r.fill ? r.fill.c : '#fff'; r.sp.style.background = 'none'; r.sp.style.webkitBackgroundClip = ''; }
          else { r.sp.style.background = css; r.sp.style.webkitBackgroundClip = 'text'; r.sp.style.backgroundClip = 'text'; r.sp.style.color = 'transparent'; }
        } else if (r.o.t !== 'image') r.k.style.background = r.fill ? css : 'none';
      }
    });
  };

  /* ---------------- storyboards ---------------- */
  Title.prototype._play = function (list, mode, next) {
    this.sb = { list: list || [], mode: mode, t0: null, dur: sbDur(list), next: next || null };
    this.dirty = true;
  };
  Title.prototype.playIn = function () {
    var self = this;
    this.phase = 'in';
    var done = function () {
      self.phase = 'idle';
      var p = self._pendingDC; self._pendingDC = null;
      if (p && p.length) self._dataChange(p);
    };
    var go = function () {
      if (self.phase !== 'in') return;
      self.el.style.visibility = '';
      self._play(self.def.sb && self.def.sb.in ? self.def.sb.in : [], 'in', done);
    };
    // сначала раскодировать картинки, чтобы первые кадры появления не проскакивали
    var waits = (this._imgWait || []).filter(Boolean); this._imgWait = [];
    if (!waits.length) go();
    else Promise.race([Promise.all(waits), new Promise(function (r) { setTimeout(r, 600); })]).then(go);
  };
  Title.prototype.playOut = function () {
    var self = this;
    if (this.phase === 'out' || this.phase === 'gone') return this._outP || Promise.resolve();
    this.phase = 'out';
    this._outP = new Promise(function (res) {
      var list = self.def.sb && self.def.sb.out;
      if (list) self._play(list, 'out', function () { self.phase = 'gone'; res(); });
      else { // нет TransitionOut — короткое растворение всего титра
        self._fade = { from: 1, to: 0, t0: performance.now(), dur: 300 };
        self._play([], 'in', null);
        self.sb.dur = 0.3;
        self.sb.next = function () { self.phase = 'gone'; res(); };
      }
    });
    return this._outP;
  };
  Title.prototype._dataChange = function (changed) {
    var dc = (this.def.sb && this.def.sb.dc) || [];
    if (!dc.length) return;
    var pick = null;
    for (var i = 0; i < changed.length && !pick; i++) {
      var k = changed[i];
      if (dc.some(function (s) { return s.f === k; })) pick = k;
    }
    if (!pick && dc.some(function (s) { return !s.f; })) pick = null; else if (!pick) return;
    var inL = dc.filter(function (s) { return s.k === 'in' && s.f === pick; })[0];
    var outL = dc.filter(function (s) { return s.k === 'out' && s.f === pick; })[0];
    if (!inL && !outL) return;
    var self = this;
    this.phase = 'dc';
    var doOut = function () {
      if (outL) self._play(outL.a, 'out', function () { self.phase = 'idle'; });
      else self.phase = 'idle';
    };
    if (inL) this._play(inL.a, 'in', doOut); else doOut();
  };

  /** Состояние объекта в storyboard */
  Title.prototype._state = function (r, anims, mode, t, s) {
    var o = r.o, g = r.g;
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      if (a.t === 'Hidden') { s.vis = false; continue; }
      var p = a.u > 0 ? clamp01((t - a.d) / a.u) : (t >= a.d ? 1 : 0);
      var e = ease(a.e)(p);
      var amt = mode === 'in' ? e : 1 - e;
      var dir = a.dir || 'Left';
      if (a.rev && FLIP[dir]) dir = FLIP[dir];
      var inv = 1 - amt;
      switch (a.t) {
        case 'Fade': s.a *= amt; break;
        case 'Reveal': case 'Wipe':
          if (a.ax === 'X') { s.cl[1] = Math.max(s.cl[1], inv / 2); s.cl[3] = Math.max(s.cl[3], inv / 2); }
          else if (a.ax === 'Y') { s.cl[0] = Math.max(s.cl[0], inv / 2); s.cl[2] = Math.max(s.cl[2], inv / 2); }
          else if (dir === 'Left') s.cl[1] = Math.max(s.cl[1], inv);
          else if (dir === 'Right') s.cl[3] = Math.max(s.cl[3], inv);
          else if (dir === 'Top') s.cl[2] = Math.max(s.cl[2], inv);
          else if (dir === 'Bottom') s.cl[0] = Math.max(s.cl[0], inv);
          else { for (var q = 0; q < 4; q++) s.cl[q] = Math.max(s.cl[q], inv / 2); }
          break;
        case 'Expand':
          if (a.ax === 'X') { s.sx *= amt; s.ox = 0.5; }
          else if (a.ax === 'Y') { s.sy *= amt; s.oy = 0.5; }
          else if (dir === 'Left') { s.sx *= amt; s.ox = 0; }
          else if (dir === 'Right') { s.sx *= amt; s.ox = 1; }
          else if (dir === 'Top') { s.sy *= amt; s.oy = 0; }
          else if (dir === 'Bottom') { s.sy *= amt; s.oy = 1; }
          else { s.sx *= amt; s.sy *= amt; s.ox = 0.5; s.oy = 0.5; }
          break;
        case 'Zoom': s.sx *= amt; s.sy *= amt; s.ox = 0.5; s.oy = 0.5; break;
        case 'Fly': case 'Slide':
          if (dir === 'Left') s.tx -= inv * (g.x + g.w);
          else if (dir === 'Right') s.tx += inv * (this.W - g.x);
          else if (dir === 'Top') s.ty -= inv * (g.y + g.h);
          else if (dir === 'Bottom') s.ty += inv * (this.H - g.y);
          else { s.sx *= amt; s.sy *= amt; s.ox = 0.5; s.oy = 0.5; }
          break;
      }
    }
    return s;
  };

  Title.prototype._visRect = function (r) {
    var s = r.st, g = r.g;
    var x1 = g.x + g.w * s.cl[3], x2 = g.x + g.w * (1 - s.cl[1]), y1 = g.y + g.h * s.cl[0], y2 = g.y + g.h * (1 - s.cl[2]);
    var Ox = g.x + g.w * s.ox, Oy = g.y + g.h * s.oy;
    x1 = Ox + (x1 - Ox) * s.sx + s.tx; x2 = Ox + (x2 - Ox) * s.sx + s.tx;
    y1 = Oy + (y1 - Oy) * s.sy + s.ty; y2 = Oy + (y2 - Oy) * s.sy + s.ty;
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  };

  Title.prototype.render = function (now) {
    if (this.phase === 'hidden' || this.phase === 'gone') return;
    this._tickTimers();
    var sb = this.sb, self = this;
    if (sb && sb.t0 == null) sb.t0 = now; // первый кадр storyboard — ровно t=0, без проскока
    var t = sb ? (now - sb.t0) / 1000 : 0;
    var ended = sb && t >= sb.dur;
    var anyAnim = !!sb || !!this.cont; // sb ещё не снят — нужен кадр завершения
    if (!anyAnim && !this.dirty && !(this._fade)) return;
    var list = sb ? sb.list : (this.held ? this.held.list : []), mode = sb ? sb.mode : (this.held ? this.held.mode : 'in');
    if (!sb && this.held) t = 1e9;
    var idx = this._index(list);
    var cidx = this.cont ? this._index(this.cont.list) : null;
    var ct = this.cont ? ((now - this.tStart) / 1000) % this.cont.dur : 0;
    // 1. состояния
    this.objs.forEach(function (r) {
      var s = { vis: r.vis, a: r.o.op == null ? 1 : r.o.op, cl: [0, 0, 0, 0], sx: 1, sy: 1, ox: 0.5, oy: 0.5, tx: 0, ty: 0 };
      var an = idx[r.o.n];
      if (an) self._state(r, an, mode, t, s);
      if (cidx && cidx[r.o.n]) self._state(r, cidx[r.o.n], 'in', ct, s);
      r.st = s;
    });
    var fadeA = 1;
    if (this._fade) {
      var f = this._fade, fp = f.dur ? clamp01((now - f.t0) / f.dur) : 1;
      fadeA = f.from + (f.to - f.from) * fp;
      if (fp >= 1 && f.to === 1) this._fade = null;
    }
    // 2. применение (маска считается сразу здесь: клип на самом объекте, без полноэкранных слоёв)
    this.objs.forEach(function (r) {
      var s = r.st, e = r.e, css = r.css, g = r.g;
      var op = s.vis ? s.a : 0;
      var empty = s.sx === 0 || s.sy === 0 || s.cl[0] + s.cl[2] >= 1 || s.cl[1] + s.cl[3] >= 1;
      // Обрезка (Reveal) и маска — одним clip-path на внешнем элементе, в его локальных координатах.
      // Растр содержимого (вместе с тенью) остаётся в своём слое и не перерисовывается каждый кадр.
      var pad = r.pad || 0;
      var side = [s.cl[0] ? s.cl[0] * g.h : -pad, s.cl[1] ? s.cl[1] * g.w : -pad, s.cl[2] ? s.cl[2] * g.h : -pad, s.cl[3] ? s.cl[3] * g.w : -pad];
      var mimg = null, mell = '';
      if (r.o.mask && op > 0.001 && !empty) {
        var mr = self.byName[r.o.mask], ms = mr && mr.st;
        if (!ms) op = 0;
        else {
          op *= ms.vis ? ms.a : 0;
          var vr = self._visRect(mr);
          if (vr[2] - vr[0] <= 0.01 || vr[3] - vr[1] <= 0.01) op = 0;
          else {
            var Ox = g.x + g.w * s.ox, Oy = g.y + g.h * s.oy;
            var x1 = (vr[0] - s.tx - Ox) / s.sx + Ox - g.x, x2 = (vr[2] - s.tx - Ox) / s.sx + Ox - g.x;
            var y1 = (vr[1] - s.ty - Oy) / s.sy + Oy - g.y, y2 = (vr[3] - s.ty - Oy) / s.sy + Oy - g.y;
            if (mr.o.t === 'image' && mr.src) mimg = { src: mr.src, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
            else if (mr.o.t === 'ellipse') mell = 'ellipse(' + ((x2 - x1) / 2).toFixed(2) + 'px ' + ((y2 - y1) / 2).toFixed(2) + 'px at ' + ((x1 + x2) / 2).toFixed(2) + 'px ' + ((y1 + y2) / 2).toFixed(2) + 'px)';
            else {
              side[0] = Math.max(side[0], y1); side[1] = Math.max(side[1], g.w - x2);
              side[2] = Math.max(side[2], g.h - y2); side[3] = Math.max(side[3], x1);
            }
          }
        }
      }
      if (side[0] + side[2] >= g.h || side[1] + side[3] >= g.w) op = 0;
      var clip = mell || ((side[0] > -pad || side[1] > -pad || side[2] > -pad || side[3] > -pad) ?
        'inset(' + side[0].toFixed(2) + 'px ' + side[1].toFixed(2) + 'px ' + side[2].toFixed(2) + 'px ' + side[3].toFixed(2) + 'px)' : '');
      var revealOnC = mell && (s.cl[0] || s.cl[1] || s.cl[2] || s.cl[3]); // эллипс-маска + Reveal: Reveal на внутреннем слое
      var show = op > 0.001 && !empty;
      var v = show ? '' : 'hidden';
      if (css.v !== v) { css.v = v; e.style.visibility = v; }
      if (!show) return;
      var opS = op >= 0.999 ? '1' : op.toFixed(3);
      if (css.op !== opS) { css.op = opS; e.style.opacity = opS; }
      var tr = '';
      if (s.tx || s.ty) tr += 'translate(' + s.tx.toFixed(2) + 'px,' + s.ty.toFixed(2) + 'px) ';
      if (r.o.rot) tr += 'rotate(' + r.o.rot + 'deg) ';
      if (s.sx !== 1 || s.sy !== 1) tr += 'scale(' + Math.max(s.sx, 0.0001).toFixed(4) + ',' + Math.max(s.sy, 0.0001).toFixed(4) + ')';
      var org = (s.ox * 100) + '% ' + (s.oy * 100) + '%';
      if (css.tr !== tr) { css.tr = tr; e.style.transform = tr || 'none'; }
      if (css.org !== org) { css.org = org; e.style.transformOrigin = org; }
      var cp = revealOnC ? 'inset(' + s.cl.map(function (x) { return (x * 100).toFixed(3) + '%'; }).join(' ') + ')' : '';
      if (css.cp !== cp) { css.cp = cp; r.c.style.clipPath = cp; r.c.style.webkitClipPath = cp; }
      if (css.mc !== clip) { css.mc = clip; e.style.clipPath = clip; e.style.webkitClipPath = clip; }
      var mk = mimg ? mimg.src.length + '|' + mimg.x.toFixed(1) + ',' + mimg.y.toFixed(1) + ',' + mimg.w.toFixed(1) + ',' + mimg.h.toFixed(1) : '';
      if (css.mk !== mk) {
        css.mk = mk;
        var mi = mimg ? 'url("' + mimg.src + '")' : '', mp = mimg ? mimg.x.toFixed(1) + 'px ' + mimg.y.toFixed(1) + 'px' : '', msz = mimg ? mimg.w.toFixed(1) + 'px ' + mimg.h.toFixed(1) + 'px' : '';
        e.style.webkitMaskImage = mi; e.style.maskImage = mi; e.style.webkitMaskPosition = mp; e.style.maskPosition = mp;
        e.style.webkitMaskSize = msz; e.style.maskSize = msz; e.style.webkitMaskRepeat = mimg ? 'no-repeat' : ''; e.style.maskRepeat = mimg ? 'no-repeat' : '';
      }
    });
    var fo = fadeA >= 0.999 ? '' : fadeA.toFixed(3);
    if (this._fo !== fo) { this._fo = fo; this.el.style.opacity = fo; }
    this.dirty = false;
    if (ended) {
      var nx = sb.next;
      this.held = { list: sb.list, mode: sb.mode };
      this.sb = null;
      this.dirty = true;
      if (nx) nx();
    }
  };

  Title.prototype.destroy = function () { this.phase = 'gone'; if (this.el.parentNode) this.el.parentNode.removeChild(this.el); };

  /* ------------------------------------------------------------------ */
  /* Сцена: каналы 1…N (как оверлеи vMix)                                */
  /* ------------------------------------------------------------------ */
  function Stage(el, pkg) {
    this.el = el;
    this.ch = {};       // канал → { title, key, take }
    this.dying = [];
    this.setPackage(pkg);
    var self = this;
    // шрифт догрузился позже — пересчитать размеры текста (Shrink/AutoSize)
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { self.relayout(); });
    var loop = function (ts) { self._frame(ts || performance.now()); self._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
    // в фоне (вкладка скрыта) rAF спит — таймеры и анимации досчитываем setInterval-ом
    this._iv = setInterval(function () { if (document.hidden) self._frame(performance.now()); }, 100);
  }
  Stage.prototype.setPackage = function (pkg) {
    var self = this;
    if (this.pkg && pkg && this.pkg.id === pkg.id && this.pkg.ver === pkg.ver) return this.ready;
    this.clear(true);
    this.pkg = pkg || { titles: [], assets: {} };
    this.W = this.pkg.w || 1920; this.H = this.pkg.h || 1080;
    this.el.style.width = this.W + 'px'; this.el.style.height = this.H + 'px';
    this.titles = {};
    (this.pkg.titles || []).forEach(function (t) { self.titles[t.id] = t; });
    // заранее раскодировать все картинки пакета (кэш браузера) — IN не будет ждать
    this._decoded = Object.keys(this.pkg.assets || {}).map(function (k) {
      var a = self.pkg.assets[k]; if (!a || !/^data:image/.test(a.data || '')) return null;
      var im = new Image(); im.src = a.data; return im.decode ? im.decode().catch(function () {}).then(function () { return im; }) : null;
    });
    this.ready = loadFonts(this.pkg);
    return this.ready;
  };
  Stage.prototype.relayout = function () {
    var self = this;
    Object.keys(this.ch).forEach(function (k) { var c = self.ch[k]; if (c && c.title) { c.title.objs.forEach(function (r) { r.gkey = null; r.fkey = null; }); c.title.layout(); c.title.dirty = true; } });
  };
  Stage.prototype.clear = function (now) {
    var self = this;
    Object.keys(this.ch).forEach(function (k) { var c = self.ch[k]; if (c && c.title) c.title.destroy(); });
    this.ch = {};
    this.dying.forEach(function (t) { t.destroy(); });
    this.dying = [];
  };
  Stage.prototype._frame = function (now) {
    var self = this;
    Object.keys(this.ch).forEach(function (k) { var c = self.ch[k]; if (c && c.title) c.title.render(now); });
    this.dying = this.dying.filter(function (t) { t.render(now); if (t.phase === 'gone') { t.destroy(); return false; } return true; });
  };
  /**
   * Применить состояние: { ch: { '1': { t: 'titleId', take: 5, data: {...} } | null, ... } }
   */
  Stage.prototype.apply = function (st) {
    var self = this;
    st = st || {};
    var chs = st.ch || {};
    var keys = {};
    Object.keys(chs).concat(Object.keys(this.ch)).forEach(function (k) { keys[k] = 1; });
    return this.ready.then(function () {
      Object.keys(keys).forEach(function (k) {
        var want = chs[k], cur = self.ch[k];
        if (want && !self.titles[want.t]) want = null;
        if (!want) {
          if (cur) { self._kill(cur.title); delete self.ch[k]; }
          return;
        }
        if (cur && cur.key === want.t && cur.take === want.take) {
          cur.title.setData(want.data || {}, true);
          return;
        }
        if (cur) self._kill(cur.title);
        var T = makeTitle(self, self.titles[want.t], want.data || {}, 10 + (parseInt(k, 10) || 0));
        T.playIn();
        self.ch[k] = { title: T, key: want.t, take: want.take };
      });
    });
  };
  Stage.prototype._kill = function (T) {
    if (!T) return;
    this.dying.push(T);
    T.playOut();
  };
  /** Титр GT или Lottie (After Effects) — по виду описания */
  function makeTitle(stage, def, data, z) {
    if (def.kind === 'lottie') {
      if (!root.GTRender.LottieTitle || !root.lottie) throw new Error('Для титров After Effects нужны vendor/lottie.min.js и js/lottie-title.js');
      return new root.GTRender.LottieTitle(stage, def, data, z);
    }
    return new Title(stage, def, data, z);
  }
  Stage.prototype.destroy = function () { cancelAnimationFrame(this._raf); clearInterval(this._iv); this.clear(); };

  /** Статичный кадр титра в конечном состоянии In (для миниатюр/проверки) */
  Stage.prototype.still = function (titleId, data, ch) {
    var self = this;
    return this.ready.then(function () {
      var T = makeTitle(self, self.titles[titleId], data || {}, 10 + (ch || 1));
      self.ch['s' + (ch || 1)] = { title: T, key: titleId, take: -1 };
      if (T.isLottie) return T.freeze().then(function () { return T; });
      T.el.style.visibility = '';
      T.phase = 'idle';
      T.held = { list: (T.def.sb && T.def.sb.in) || [], mode: 'in' };
      T.dirty = true;
      return T;
    });
  };

  root.GTRender = { now: gtNow, Stage: Stage, Title: Title, ease: ease, brushCss: brushCss, fmtTimer: fmtTimer, timerMs: timerMs, textOf: textOf, loadFonts: loadFonts };
})(typeof self !== 'undefined' ? self : this);
