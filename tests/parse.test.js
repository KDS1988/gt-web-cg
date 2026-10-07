// Быстрая проверка парсера GT: node tests/parse.test.js
'use strict';
const assert = require('assert');
const P = require('../js/gt-parse.js');
const doc = `<?xml version="1.0" encoding="utf-16"?>
<Composition Width="1920" Height="1080"><Layer Name="Layer1" Dimensions="1920,1080,0"><Layer.Composition><Composition Width="1920" Height="1080">
 <Rectangle Name="Плашка" Dimensions="200,50,0" Location="10,20,0" DataFlags="None"><Rectangle.Bounding><Bounding Object="Имя" Padding="15,15,15,15" /></Rectangle.Bounding><Rectangle.Fill><Brush Color="#FFD40000" /></Rectangle.Fill></Rectangle>
 <Rectangle Name="Тень" Opacity="0.4" Dimensions="200,50,0" Location="10,20,0"><Rectangle.Fill><Brush Type="LinearGradient" EndPoint="1,0"><Brush.Stops><GradientStop Color="#FF000000" /><GradientStop Position="1" /></Brush.Stops></Brush></Rectangle.Fill></Rectangle>
 <TextBlock Name="Имя" Dimensions="170,20,0" Location="25,35,0" Text="Иван &amp; Ко" FontFamily="Montserrat" FontSize="26" FontWeight="DemiBold" TextAlign="Center" AutoSize="WidthAndHeight"><TextBlock.Mask><Mask Object="Плашка" /></TextBlock.Mask></TextBlock>
 <TextBlock Name="Статус" Text="x" DataFlags="Hidden" />
 <TextBlock Name="ОТ" Text="ОТ" DataFlags="ShowVisible" />
</Composition></Layer.Composition></Layer>
<Storyboard><Storyboard.Animations><Reveal Object="Плашка" Duration="0.5" Interpolation="CubicEasingInOut" CenterAxis="X" /><Hidden Object="Статус" /></Storyboard.Animations></Storyboard>
<Storyboard Type="TransitionOut"><Storyboard.Animations><Fade Object="Имя" Duration="0.3" /></Storyboard.Animations></Storyboard>
<Storyboard Type="DataChangeIn" DataName="Имя.Text"><Storyboard.Animations><Fly Object="Имя" Duration="0.5" Reverse="True" /></Storyboard.Animations></Storyboard>
</Composition>`;
const d = P.parseDocument(doc, '');
const byN = Object.fromEntries(d.objects.map(o => [o.n, o]));
assert.strictEqual(d.w, 1920);
assert.strictEqual(byN['Имя'].text.s, 'Иван & Ко');
assert.strictEqual(byN['Имя'].text.fw, 600);
assert.strictEqual(byN['Имя'].text.auto, 'wh');
assert.strictEqual(byN['Имя'].mask, 'Плашка');
assert.deepStrictEqual(byN['Плашка'].bound, { o: 'Имя', p: [15, 15, 15, 15] });
assert.strictEqual(byN['Плашка'].fill.c, '#d40000');
assert.strictEqual(byN['Тень'].fill.t, 'linear');
assert.strictEqual(byN['Тень'].fill.stops[1].c, 'rgba(0,0,0,0)');
assert.strictEqual(d.sb.in.length, 2);
assert.strictEqual(d.sb.out[0].t, 'Fade');
assert.strictEqual(d.sb.dc[0].f, 'Имя.Text');
assert.strictEqual(d.sb.dc[0].a[0].rev, true);
const keys = d.fields.map(f => f.k);
assert.deepStrictEqual(keys, ['Плашка.Fill', 'Имя.Text', 'ОТ.Text', 'ОТ.Visible']);
assert.strictEqual(P.color('#4C000000'), 'rgba(0,0,0,0.298)');
console.log('OK: парсер GT —', d.objects.length, 'объектов,', d.fields.length, 'полей');
