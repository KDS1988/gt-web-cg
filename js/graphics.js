/*!
 * GT Web CG · graphics.js — страница графики (vMix Web Browser input).
 * Параметры адреса:
 *   ?fb=…&room=…   облачная синхронизация (Firebase)
 *   ?pkg=url        взять пакет по ссылке (например packages/hockey.json), а не из комнаты
 *   ?checker=1      шахматный фон (для превью в пульте)
 *   ?pvw=1          режим превью: без шины, управление из пульта через window.__gtApply / __gtSetPkg
 *   ?still=id       показать титр id в конечном состоянии (проверка вёрстки)
 */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var stageEl = document.getElementById('stage');
  var msgEl = document.getElementById('msg');
  if (qs.has('checker')) document.body.classList.add('checker');

  var stage = new GTRender.Stage(stageEl, null);
  var pkgVer = null, pending = null, lastState = null;

  function msg(t) { msgEl.textContent = t || ''; }
  function fit() {
    var W = stage.W || 1920, H = stage.H || 1080;
    var vw = window.innerWidth, vh = window.innerHeight;
    var k = Math.min(vw / W, vh / H);
    if (Math.abs(k - 1) < 0.002) k = 1;
    stageEl.style.transform = k === 1 ? 'none' : 'scale(' + k + ')';
    stageEl.style.left = Math.round((vw - W * k) / 2) + 'px';
    stageEl.style.top = Math.round((vh - H * k) / 2) + 'px';
  }
  window.addEventListener('resize', fit);

  function setPkg(p) {
    if (!p) return Promise.resolve();
    pkgVer = p.id + '@' + (p.ver || '');
    var r = stage.setPackage(p);
    fit();
    msg('');
    return r;
  }
  function apply(st) {
    lastState = st;
    return stage.apply(st || {});
  }

  window.__gtStage = stage;
  window.__gtSetPkg = setPkg;
  window.__gtApply = apply;

  if (qs.get('still')) {
    var url = qs.get('pkg');
    CG.fetchPkg(url).then(setPkg).then(function () {
      var data = {};
      try { data = JSON.parse(qs.get('data') || '{}'); } catch (e) {}
      return stage.still(qs.get('still'), data);
    }).then(function () { document.title = 'READY'; }).catch(function (e) { msg(String(e.message || e)); });
    return;
  }
  if (qs.has('pvw')) { fit(); return; }

  var staticPkg = qs.get('pkg');
  var pkgP = staticPkg ? CG.fetchPkg(staticPkg).then(setPkg).catch(function (e) { msg('Пакет не загружен: ' + e.message); }) : null;

  var bus = new CG.Bus(function (st) {
    var want = st && st.pkg ? st.pkg.id + '@' + (st.pkg.ver || '') : null;
    if (staticPkg) { pkgP.then(function () { apply(st); }); return; }
    if (want && want !== pkgVer) {
      pending = st;
      if (bus._loading === want) return;
      bus._loading = want;
      msg('Загрузка пакета графики…');
      bus.getPkg().then(function (p) {
        bus._loading = null;
        if (!p) { msg('Пакет не найден в комнате — опубликуйте его из пульта'); return; }
        return setPkg(p).then(function () { apply(pending); });
      }).catch(function (e) { bus._loading = null; msg('Ошибка загрузки пакета: ' + e.message); });
      return;
    }
    if (bus._loading) { pending = st; return; }
    apply(st);
  }, function (mode, ok, why) {
    if (!ok) msg('Нет связи с пультом' + (why ? ': ' + why : '') + ' (' + mode + ')');
    else if (/Нет связи/.test(msgEl.textContent)) msg('');
  });
  fit();
})();
