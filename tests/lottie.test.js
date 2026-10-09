// Проверка разбора титров After Effects (Lottie): node tests/lottie.test.js
'use strict';
const assert = require('assert');
const G = require('../js/lottie-title.js').GTLottie; // в Node модуль кладёт GTLottie в exports
const txt = (nm, t) => ({ ty: 5, nm, ks: {}, t: { d: { k: [{ s: { t, f: 'BebasNeueBold', s: 50, j: 2 }, t: 0 }] }, a: [] } });
const anim = {
  v: '5.12.1', fr: 25, ip: 0, op: 250, w: 1920, h: 1080, nm: 'Табло',
  fonts: { list: [{ fName: 'BebasNeueBold', fFamily: 'BebasNeueBold', fStyle: 'Regular', origin: 0 }] },
  assets: [{ id: 'image_0', w: 28, h: 35, e: 1, p: 'data:image/png;base64,AA' }, { id: 'image_1', w: 1920, h: 3662, e: 1, p: 'data:image/png;base64,AA' }],
  markers: [{ tm: 0, cm: 'in', dr: 0 }, { tm: 46, cm: 'hold', dr: 0 }, { tm: 219, cm: 'out', dr: 0 }],
  layers: [
    txt('Счет 1', '00'),
    Object.assign(txt('Period BG', 'Период'), {}),
    { ty: 2, nm: 'Federation Emblem', refId: 'image_0', ks: {} },
    { ty: 2, nm: 'matte', refId: 'image_1', td: 1, ks: {} },
    { ty: 2, nm: 'Pattern', refId: 'image_1', tt: 1, ks: {} },
    txt('Счет 1', '00')
  ]
};
anim.layers[1].t.a = [{ nm: 'AC IN', s: { t: 1, b: 1 }, a: { s: { a: 0, k: [0, 0, 100] } } }];
const r = G.analyze(anim, 'табло.json');
const t = r.title;
assert.strictEqual(t.kind, 'lottie');
assert.deepStrictEqual([t.mk.in, t.mk.hold, t.mk.out], [0, 46, 219]);
assert.deepStrictEqual(t.fields.map(f => f.k), ['Счет 1.Text', 'Period BG.Text', 'Federation Emblem.Source', 'Счет 1 2.Text']);
assert.strictEqual(t.anim.layers[1].t.a.length, 0, 'пустой аниматор Animation Composer убран');
assert.strictEqual(anim.layers[1].t.a.length, 1, 'исходный JSON не изменён');
assert.deepStrictEqual(r.fonts, [{ family: 'BebasNeueBold', variants: ['400'], lottie: 'BebasNeueBold' }]);
const m2 = G.markers({ ip: 0, op: 100 });
assert.deepStrictEqual([m2.in, m2.hold, m2.out, m2.named], [0, 99, undefined, false]);
assert.throws(() => G.analyze({ foo: 1 }, 'x.json'));
console.log('lottie: OK');
