#!/usr/bin/env python3
"""
GT Web CG · tools/fhr_meta.py — метаданные полей пакета «ФХР · Кубок России» (поверх собранного импортом пакета).

  python3 tools/fhr_meta.py <пакет.json> <результат.json>

Свойства поля (их понимает пульт):
  bind   — ключ данных матча: home.name, away.logo, home.G1.num, st.3.pts, stat.shots.1 …
  grp    — явная группа связи (иначе поля связываются по имени и значению)
  sec    — раздел в редакторе (Вратари / Защитники / …); narrow — узкое поле (номер)
  maxLen — максимум знаков; maxW — максимум ширины текста в кадре (px), длиннее — шрифт уменьшается
  presets — быстрые значения-кнопки ('$home.name' — значение из данных матча)
  pick   — выбор из списка: {list: 'home.players'|'away.staff'|…, set: {ключ поля: формат}}
  penalty — таймер удаления: старт при IN, идёт вместе с часами табло, по нулю — уход титра
  clock  — основные часы матча (табло)
Свойства титра: side ('home'|'away'), ch (канал по умолчанию), feed ('standings'|'scorers'),
  statRows (строки окна статистики).
"""
import json, sys, re

P = json.load(open(sys.argv[1], encoding='utf-8'))
T = {t['id']: t for t in P['titles']}


def F(t, k):
    for f in t['fields']:
        if f['k'] == k:
            return f
    raise KeyError(t['id'] + ': ' + k)


def opt(t, k):
    try:
        return F(t, k)
    except KeyError:
        return None


def setf(t, k, **kw):
    f = opt(t, k)
    if f:
        f.update(kw)
    return f


def side_grp(t, side):
    """Поля титра-дубля (хозяева/гости) не связываются с таким же титром другой стороны"""
    for f in t['fields']:
        if 'bind' not in f:
            f['grp'] = side + ':' + f['k']


SIDES = (('home', 1), ('away', 2))
for t in P['titles']:
    t.pop('side', None)

# ---------------- табло и титры с табло
for tid in ('03-tablo', '09-bullity'):
    t = T[tid]
    for side, n in SIDES:
        setf(t, 'Команда %d.Text' % n, bind=side + '.abbr', maxLen=5, maxW=104, label='Код команды %d' % n)
        setf(t, 'Логотип %d.Source' % n, bind=side + '.logo', label='Логотип %d' % n)
        setf(t, 'Логотип %d.Visible' % n, label='Логотип %d' % n)
    setf(t, 'Время.Text', clock=True)
    setf(t, 'Период.Text', presets=['1', '2', '3', 'ОТ', 'Б'])
T['03-tablo']['ch'] = '3'

# ---------------- удаления (доп. инфа) — свои каналы, чтобы оба могли быть в эфире вместе с табло
for tid, side, n, ch in (('04-udalenie-hoz', 'home', 1, '4'), ('05-udalenie-gost', 'away', 2, '5')):
    t = T[tid]
    t['side'] = side
    t['ch'] = ch
    setf(t, 'Удаление %d.Text' % n, label='Состав', presets=['5 НА 4', '4 НА 4', '5 НА 3', '4 НА 3', '3 НА 3', '4 НА 5', '3 НА 5'], maxW=120)
    setf(t, 'Время удаления %d.Text' % n, label='Время удаления', penalty=True, presets=['02:00', '04:00', '05:00', '10:00'])
    side_grp(t, side)

# ---------------- автор гола
for tid, side in (('06-gol-hoz', 'home'), ('07-gol-gost', 'away')):
    t = T[tid]
    t['side'] = side
    t['ch'] = '7'  # своя плашка рядом с табло — над табло и удалениями
    setf(t, 'Логотип.Source', bind=side + '.logo', label='Логотип команды')
    setf(t, 'Имя Игрока.Text', label='Автор гола', maxW=260,
         pick={'list': side + '.players', 'set': {'Номер игрока.Text': 'num', 'Имя Игрока.Text': 'name'}})
    for a in (1, 2):
        setf(t, 'Ассистент %d.Text' % a, maxW=260, pick={'list': side + '.players', 'set': {'Ассистент %d.Text' % a: 'name num'}})
    setf(t, 'Время доп..Text', label='Время гола', presets=['$clock'])
    side_grp(t, side)

# ---------------- счёт периода, итоговый, инфографика
t = T['08-schet-period']
for side, n in SIDES:
    setf(t, 'Команда %d.Text' % n, bind=side + '.name', maxW=262)
    setf(t, 'Город %d.Text' % n, bind=side + '.city', maxW=262)
    setf(t, 'Логотип %d.Source' % n, bind=side + '.logo')
setf(t, 'Период.Text', presets=['ПОСЛЕ 1 ПЕРИОДА', 'ПОСЛЕ 2 ПЕРИОДА', 'ПОСЛЕ 3 ПЕРИОДА', 'ПОСЛЕ ОВЕРТАЙМА', 'ПЕРЕД МАТЧЕМ'], maxW=190)
t = T['10-itog-schet']
for side, n in SIDES:
    setf(t, 'Команда %d.Text' % n, bind=side + '.name', maxW=300)
    setf(t, 'Логотип %d.Source' % n, bind=side + '.logo')
setf(t, 'Название чемпионата.Text', bind='tournament', maxW=1100)
setf(t, 'Место.Text', bind='place', maxW=1150)
t = T['11-infografika']
for side, n in SIDES:
    setf(t, 'Логотип %d.Source' % n, bind=side + '.logo')
setf(t, 'Название чемпионата.Text', bind='tournament', maxW=1100)
setf(t, 'Место.Text', bind='place', maxW=1150)

# ---------------- составы: разделы и привязки к ростеру
POSN = {'вратарь': 'G', 'защитник': 'D', 'форвард': 'F'}
SEC = {'G': 'Вратари', 'D': 'Защитники', 'F': 'Нападающие'}
for tid, side in (('12-sostav-hoz', 'home'), ('13-sostav-gost', 'away')):
    t = T[tid]
    t['side'] = side
    head, rest = [], []
    for f in t['fields']:
        m = re.match(r'^(Номер )?(вратарь|защитник|форвард) (\d+)\.Text$', f['k'], re.I)
        if m:
            pos = POSN[m.group(2).lower()]
            n = m.group(3)
            f['sec'] = SEC[pos]
            f['bind'] = '%s.%s%s.%s' % (side, pos, n, 'num' if m.group(1) else 'name')
            if m.group(1):
                f['narrow'] = True
                f['label'] = '№'
            else:
                f['label'] = '%s %s' % ({'G': 'Вратарь', 'D': 'Защитник', 'F': 'Нападающий'}[pos], n)
                f['maxW'] = 300
            rest.append(f)
        else:
            head.append(f)
    for f in head:
        f['sec'] = 'Команда'
    setf(t, 'Команда.Text', bind=side + '.name', maxW=330)
    setf(t, 'Город.Text', bind=side + '.city', maxW=330)
    setf(t, 'Логотип.Source', bind=side + '.logo')
    setf(t, 'Имя тренера.Text', bind=side + '.coach', maxW=330,
         pick={'list': side + '.staff', 'set': {'Имя тренера.Text': 'name', 'Главный тренер.Text': 'role'}})
    for lab in ('Заголовок.Text', 'ВРАТАРИ:.Text', 'ЗАЩИТНИКИ:.Text', 'ФОРВАРДЫ:.Text', 'Главный тренер.Text'):
        setf(t, lab, sec='Подписи')
    # порядок в редакторе: команда, вратари, защитники, нападающие, подписи
    order = {'Команда': 0, 'Вратари': 1, 'Защитники': 2, 'Нападающие': 3, 'Подписи': 4}
    t['fields'].sort(key=lambda f: order.get(f.get('sec'), 5))
    side_grp(t, side)

# ---------------- статистика
t = T['14-statistika']
t['statRows'] = []
for side, n in SIDES:
    setf(t, 'Команда %d.Text' % n, bind=side + '.name', maxW=290)
RED, DARK = [0.855, 0.161, 0.11], [0.247, 0.247, 0.243]
for key, lab in (('shots', 'Броски'), ('sog', 'Броски в створ'), ('fo', 'Вбрасывания'), ('pim', 'Штраф')):
    setf(t, lab + '.Text', sec='Подписи')
    for side, n in SIDES:
        # цвет: красный — у большего значения в строке, остальные тёмные (cmp — с чем сравнивать)
        setf(t, '%s %d.Text' % (lab, n), bind='stat.%s.%d' % (key, n), sec='Значения',
             cmp='%s %d.Text' % (lab, 3 - n), hiC=RED, loC=DARK)
    t['statRows'].append({'key': key, 'label': lab + '.Text', 'f1': lab + ' 1.Text', 'f2': lab + ' 2.Text'})
setf(t, 'Заголовок.Text', bind='stat.title', maxW=1050,
     presets=['СТАТИСТИКА МАТЧА ПОСЛЕ 1 ПЕРИОДА', 'СТАТИСТИКА МАТЧА ПОСЛЕ 2 ПЕРИОДА', 'СТАТИСТИКА МАТЧА ПОСЛЕ 3 ПЕРИОДА', 'СТАТИСТИКА МАТЧА'])

# ---------------- протокол: команда гола — кнопками
t = T['15-protokol']
for r in range(1, 6):
    setf(t, 'Команда гола %d.Text' % r, presets=['$home.abbr', '$away.abbr'], maxW=200, sec='Гол %d' % r)
    for k in ('Время', 'Игрок', 'Тренер', 'Инфо'):
        setf(t, '%s %d.Text' % (k, r), sec='Гол %d' % r)
    setf(t, 'Тренер %d.Text' % r, label='Ассистенты %d' % r)
    setf(t, 'Инфо %d.Text' % r, label='Счёт %d' % r)

# ---------------- игроки и тренеры
for tid, side, coach in (('16-igrok-hoz', 'home', 0), ('17-igrok-gost', 'away', 0), ('18-trener-hoz', 'home', 1), ('19-trener-gost', 'away', 1)):
    t = T[tid]
    t['side'] = side
    setf(t, 'Логотип.Source', bind=side + '.logo')
    if coach:
        setf(t, 'Имя тренера.Text', bind=side + '.coach', maxW=900,
             pick={'list': side + '.staff', 'set': {'Имя тренера.Text': 'name', 'Должность.Text': 'role'}})
        setf(t, 'Должность.Text', bind=side + '.coachRole', presets=['ГЛАВНЫЙ ТРЕНЕР', 'СТАРШИЙ ТРЕНЕР', 'ТРЕНЕР'])
    else:
        setf(t, 'Имя игрока.Text', maxW=760,
             pick={'list': side + '.players', 'set': {'Номер.Text': 'num', 'Имя игрока.Text': 'name', 'Роль игрока.Text': 'role'}})
        setf(t, 'Роль игрока.Text', presets=['ВРАТАРЬ', 'ЗАЩИТНИК', 'НАПАДАЮЩИЙ', 'КАПИТАН'])
    side_grp(t, side)

# ---------------- турнирная таблица, бомбардиры
t = T['20-tablica']
t['feed'] = 'standings'
setf(t, 'Группа.Text', bind='st.group', maxW=600)
for r in range(1, 6):
    for k, b in (('Место', 'pos'), ('Команда', 'name'), ('Город', 'city'), ('И', 'gp'), ('В', 'w'), ('ВО', 'wo'), ('ВБ', 'wb'),
                 ('ПБ', 'lb'), ('ПО', 'lo'), ('П', 'l'), ('Ш', 'goals'), ('О', 'pts')):
        setf(t, '%s %d.Text' % (k, r), bind='st.%d.%s' % (r, b), sec='Место %d' % r)
    setf(t, 'Команда %d.Text' % r, maxW=400)
    setf(t, 'Логотип %d.Source' % r, bind='st.%d.logo' % r, sec='Место %d' % r)
    setf(t, 'Логотип %d.Visible' % r, sec='Место %d' % r)
t = T['21-bombardiry']
t['feed'] = 'scorers'
setf(t, 'Группа.Text', bind='sc.group', maxW=600)
for r in range(1, 6):
    for k, b in (('Место', 'rank'), ('Игрок', 'name'), ('Команда', 'team'), ('И', 'gp'), ('Ш', 'g'), ('А', 'a'), ('О', 'pts')):
        setf(t, '%s %d.Text' % (k, r), bind='sc.%d.%s' % (r, b), sec='Место %d' % r)
    setf(t, 'Игрок %d.Text' % r, maxW=560)
    setf(t, 'Команда %d.Text' % r, maxW=560)
    setf(t, 'Логотип %d.Source' % r, bind='sc.%d.logo' % r, sec='Место %d' % r)
    setf(t, 'Логотип %d.Visible' % r, sec='Место %d' % r)

# ---------------- картинки Lottie — в общий словарь пакета (одинаковые хранятся один раз)
import hashlib
P.setdefault('assets', {})
saved = 0
for t in P['titles']:
    for a in (t.get('anim') or {}).get('assets', []):
        p = a.get('p') or ''
        if not p.startswith('data:') or len(p) < 2000:
            continue
        h = 'lt' + hashlib.sha1(p.encode()).hexdigest()[:16]
        if h in P['assets']:
            saved += len(p)
        else:
            P['assets'][h] = {'name': a.get('id', ''), 'mime': p[5:p.index(';')], 'data': p}
        a['p'] = 'asset:' + h
print('картинки: повторов убрано %d КБ' % (saved // 1024))

# таблица и бомбардиры: шапка, затем места 1…5
for tid in ('20-tablica', '21-bombardiry'):
    t = T[tid]
    for f in t['fields']:
        if not f.get('sec'):
            f['sec'] = 'Шапка'
    def rk(f):
        m = re.match(r'^Место (\d+)$', f.get('sec', ''))
        return int(m.group(1)) if m else 0
    t['fields'].sort(key=rk)

T['02-shtorka']['ch'] = '6'
P['features'] = {'match': 'fhr', 'channels': 7}
json.dump(P, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('ok', len(P['titles']), 'титров')
