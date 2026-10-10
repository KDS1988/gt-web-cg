#!/usr/bin/env python3
"""
GT Web CG · tools/fhr_package.py — пакет «ФХР · Кубок России», версия 2: титры AE (Lottie) после правок оператора.

  python3 tools/fhr_package.py <папка экспортов v1> <папка результата>

На входе — экспорты AE после первой сборки (NN_имя.json: исправленные имена слоёв и сжатые картинки).
На выходе — набор .json для страницы импорта; метаданные полей (привязки к данным матча, разделы,
выбор игроков, ленты таблицы/бомбардиров) добавляет tools/fhr_meta.py уже в собранный пакет.
"""
import sys, os, glob, copy, re, math
sys.path.insert(0, os.path.dirname(__file__))
import lottie_kit as K

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, '*.json')):
    os.remove(f)


def src(name):
    return K.load(glob.glob(os.path.join(SRC, '*_' + name + '.json'))[0])


def out(n, slug, d, title):
    d['nm'] = title
    out_order(d)
    K.save(d, os.path.join(OUT, '%02d_%s.json' % (n, slug)))


# ---------------------------------------------------------------- время: ускорение появления и порядок ухода
def is_fg(l):
    """Передний план — тексты и логотипы (и значки буллитов): при уходе они исчезают раньше подложек"""
    nm = l.get('nm', '')
    return (l.get('ty') == 5 or nm.startswith('Логотип') or 'Emblem' in nm or nm in (':', 'VS')
            or bool(re.match(r'^\d-[XV]', nm)))


def kf_lists(o, out=None):
    """Все списки ключевых кадров внутри объекта слоя (кроме ключей текста t.d)"""
    out = [] if out is None else out
    if isinstance(o, dict):
        k = o.get('k')
        if isinstance(k, list) and k and isinstance(k[0], dict) and 't' in k[0]:
            out.append(k)
        for kk, v in o.items():
            if kk == 'd' and isinstance(v, dict) and 'k' in v and isinstance(v['k'], list) and v['k'] and 's' in v['k'][0] and isinstance(v['k'][0]['s'], dict):
                continue  # документ текста
            kf_lists(v, out)
    elif isinstance(o, list):
        for v in o:
            kf_lists(v, out)
    return out


def walk_layers(d, fn):
    """fn(layer) для слоёв композиции и вложенных прекомпозиций (каждая — один раз)"""
    A = K.assets(d)
    seen = set()

    def go(layers):
        for l in layers:
            fn(l)
            if l.get('ty') == 0 and l.get('refId') in A and l['refId'] not in seen:
                seen.add(l['refId'])
                go(A[l['refId']].get('layers', []))
    go(d['layers'])


def marker(d, name):
    for m in d.get('markers', []):
        if m.get('cm') == name:
            return m
    return None


def speed_in(d, base=15, stagger=0.4, dur=0.5):
    """Быстрее появление текста: лесенка начала слоёв плотнее, сама анимация короче"""
    mo = marker(d, 'out')['tm']
    ends = []

    def fn(l):
        if not is_fg(l) or l.get('td'):
            return
        ip0 = l['ip']
        nip = base + (ip0 - base) * stagger if ip0 > base else ip0
        for ks in kf_lists({k: v for k, v in l.items() if k not in ('ip', 'op')}):
            for kf in ks:
                if kf['t'] < mo - 0.5 and kf['t'] >= ip0 - 0.5:
                    kf['t'] = nip + (kf['t'] - ip0) * dur
                    ends.append(kf['t'])
        l['ip'] = nip
    walk_layers(d, fn)
    h = marker(d, 'hold')
    if h and ends:
        h['tm'] = int(math.ceil(max(ends))) + 1


def out_order(d, F=10, overlap=3):
    """Уход: тексты и логотипы — за F кадров от метки out, подложки — после них.
    Слои переднего плана без своей анимации ухода (их прятала подложка-маска) — плавно гаснут."""
    m = marker(d, 'out')
    if not m:
        return
    mo = m['tm']
    fg_end, bg_start = [], []

    def scan(l):
        ts = [kf['t'] for ks in kf_lists(l) for kf in ks if kf['t'] >= mo - 0.5]
        if l.get('ty') == 0:
            return
        if is_fg(l) and not l.get('td'):
            fg_end.extend(ts)
        else:
            bg_start.extend(ts)
    walk_layers(d, scan)
    if not fg_end:
        return
    fe = max(fg_end)
    k = min(1.0, F / max(1e-6, fe - mo))
    g = lambda t: mo + (t - mo) * k
    D = max(0, int(math.ceil(mo + F - overlap - min(bg_start)))) if bg_start else 0
    op0 = d['op']

    def fix(l):
        if is_fg(l) and not l.get('td') and l.get('ty') != 0:
            n = 0
            for ks in kf_lists(l):
                for kf in ks:
                    if kf['t'] >= mo - 0.5:
                        kf['t'] = g(kf['t']); n += 1
            if l['op'] > mo:
                l['op'] = min(int(math.ceil(g(l['op']))) + 1, mo + F + 1)
            if not n:  # исчезал вместе с подложкой — гасим сами
                fade(l, mo + 1, mo + F)
                l['op'] = max(l['op'], mo + F + 1)
        else:
            for ks in kf_lists(l):
                for kf in ks:
                    if kf['t'] >= mo - 0.5:
                        kf['t'] += D
            if l['op'] > mo:
                l['op'] += D
    walk_layers(d, fix)
    d['op'] = op0 + D


EASE = {'i': {'x': [0.4], 'y': [1]}, 'o': {'x': [0.6], 'y': [0]}}


def fade(l, t0, t1):
    o = l['ks'].get('o') or {'a': 0, 'k': 100}
    if K._animated(o):
        last = o['k'][-1]
        v = last['s'][0] if 's' in last else 100
        last.update(copy.deepcopy(EASE))
        o['k'] += [dict({'t': t0, 's': [v]}, **copy.deepcopy(EASE)), {'t': t1, 's': [0]}]
    else:
        v = o['k'] if not isinstance(o['k'], list) else o['k'][0]
        o = {'a': 1, 'k': [dict({'t': t0, 's': [v]}, **copy.deepcopy(EASE)), {'t': t1, 's': [0]}]}
    l['ks']['o'] = o


def text_to_image(d, name, newname, w, h, cx, cy):
    """Заменить текстовый слой слотом картинки (с той же маской и анимацией)"""
    L = K.clone(d, name, newname)
    aid = 'slot_' + str(L['ind'])
    d['assets'].append({'id': aid, 'w': int(w), 'h': int(h), 'u': '', 'p': K.TRANSPARENT, 'e': 1})
    L.pop('t', None)
    L['ty'] = 2
    L['refId'] = aid
    L['ks']['a'] = {'a': 0, 'k': [w / 2, h / 2, 0]}
    K.place(L, cx, cy)
    K.remove(d, name)
    return L


# ---------------------------------------------------------------- табло: логотип слева, код команды ≤5 знаков
def tablo_logos(d):
    """Блок табло (общий у «Табло», «Автор гола», «Буллиты»): логотип слева от названия команды"""
    for k, y in ((1, 158.5), (2, 217.5)):
        t = K.get(d, 'Команда %d' % k)
        K.place(t, 205, K.pos(t)[1])
        K.add_image_slot(d, 'Логотип %d' % k, 40, 40, 122, y, like='Команда %d' % k)


# ---------------------------------------------------------------- доп. инфа: отдельный оверлей с удалением
def dop(k):
    d = src('tablo_dop%d' % k)
    info = 'Доп. информация %d' % k
    K.keep_only(d, [info, 'Dop BG'])
    # плашка выезжает из-под табло: часть под табло (до правого края карточки, x=373) прозрачная —
    # иначе поверх табло (оно на другом канале) был бы виден её левый край
    bg = K.get(d, 'Dop BG')
    K.crop_asset_left(d, bg['refId'], 373 - K.pos(bg)[0])
    y = K.pos(K.get(d, info))[1]
    a = K.clone(d, info, 'Удаление %d' % k)
    K.text(a, '5 НА 4')
    K.move(a, 465 - 517.985, 0)
    b = K.clone(d, info, 'Время удаления %d' % k)
    K.text(b, '02:00', font='BebasNeueBold')
    K.move(b, 595 - 517.985, 0)
    K.retime(b, 2)
    K.remove(d, info)
    return d


# ---------------------------------------------------------------- автор гола: отдельная плашка рядом с табло
def gol():
    d = src('gol_avtor')
    K.keep_only(d, ['Команда доп.', 'Номер игрока', 'Время доп.', 'Имя Игрока', 'Ассистент 1', 'Ассистент 2',
                    'BG 3', 'Pattern 2', 'Pattern gray 2'])
    # левая часть плашки уходит под табло (оно на своём канале) — делаем её прозрачной, как у «доп. инфы»
    bg = K.get(d, 'BG 3')
    K.crop_asset_left(d, bg['refId'], 373 - K.pos(bg)[0])
    # вместо названия команды — логотип
    text_to_image(d, 'Команда доп.', 'Логотип', 72, 72, 425, 188)
    return d


# ---------------------------------------------------------------- титр игрока / тренера
def igrok(coach):
    d = src('titr_igrok')
    K.add_image_slot(d, 'Логотип', 104, 104, 467, 902, like='Номер', at=0)
    K.remove(d, 'Команда')
    if coach:
        K.remove(d, 'Номер')
        n = K.get(d, 'Имя игрока'); n['nm'] = 'Имя тренера'
        r = K.get(d, 'Роль игрока'); r['nm'] = 'Должность'
        K.text(n, 'АЛЕКСАНДР АЛЕКСАНДРОВ')
        K.text(r, 'ГЛАВНЫЙ ТРЕНЕР')
        K.move(n, 560 - 780.985, 0)
        K.move(r, 562 - 782.985, 0)
    return d


# ---------------------------------------------------------------- таблица / бомбардиры на основе «Протокола»
ROW_Y = [404.992, 507.992, 612.992, 717.992, 822.992]


def table_base(title):
    d = src('protokol')
    K.text(K.get(d, 'Заголовок'), title)
    return d


def head(d, sub):
    """Шапка таблицы: заголовок поменьше и подзаголовок (группа) под ним — оба в красной полосе.
    Эмблему убираем: на её месте подпись последней колонки."""
    t = K.get(d, 'Заголовок')
    g = K.clone(d, 'Заголовок', 'Группа')
    K.text(t, size=62)
    K.move(t, 0, 266 - K.pos(t)[1])
    K.text(g, sub, size=32, font='BebasNeueRegular')
    K.move(g, 0, 306 - K.pos(g)[1])
    K.remove(d, 'Federation Emblem')


def col(d, srcname, name, x, t, k, dt=0, size=None, j=None, font=None, fc=None):
    L = K.clone(d, srcname, name)
    K.text(L, t, size=size, j=j, font=font, fc=fc)
    K.place(L, x, K.pos(L)[1])
    K.retime(L, dt)
    return L


def header_labels(d, labels):
    """Подписи колонок — белым в красной шапке, по центру колонок"""
    for i, (t, x) in enumerate(labels):
        L = K.clone(d, 'Заголовок', 'Колонка %d' % (i + 1))
        K.text(L, t, size=35, j=2, font='BebasNeueRegular')
        K.place(L, x, K.pos(L)[1] - 2)


def standings():
    d = table_base('ТУРНИРНАЯ ТАБЛИЦА')
    head(d, 'ГРУППА A-II')
    cols = [('И', 952), ('В', 1022), ('ВО', 1092), ('ВБ', 1162), ('ПБ', 1232), ('ПО', 1302), ('П', 1372), ('Ш', 1452)]
    for r in range(1, 6):
        col(d, 'Время %d' % r, 'Место %d' % r, 392, str(r), r)
        y = K.pos(K.get(d, 'Время %d' % r))[1]
        K.add_image_slot(d, 'Логотип %d' % r, 64, 64, 466, y, like='Время %d' % r)
        col(d, 'Игрок %d' % r, 'Команда %d' % r, 512, 'ДИНАМО', r)
        col(d, 'Тренер %d' % r, 'Город %d' % r, 513, 'МОСКВА', r)
        for c, (nm, x) in enumerate(cols):
            col(d, 'Команда гола %d' % r, '%s %d' % (nm, r), x, '19-8' if nm == 'Ш' else '0', r, dt=c // 3, size=50)
        col(d, 'Инфо %d' % r, 'О %d' % r, 1530, '0', r, dt=3)
    for r in range(1, 6):
        K.remove(d, 'Время %d' % r, 'Команда гола %d' % r, 'Игрок %d' % r, 'Тренер %d' % r, 'Инфо %d' % r)
    header_labels(d, cols + [('О', 1530)])
    return d


def scorers():
    d = table_base('БОМБАРДИРЫ')
    head(d, 'ВЕСЬ ТУРНИР')
    cols = [('И', 1170), ('Ш', 1280), ('А', 1390)]
    for r in range(1, 6):
        col(d, 'Время %d' % r, 'Место %d' % r, 392, str(r), r)
        y = K.pos(K.get(d, 'Время %d' % r))[1]
        K.add_image_slot(d, 'Логотип %d' % r, 64, 64, 466, y, like='Время %d' % r)
        col(d, 'Игрок %d' % r, 'Игрок %d' % r + ' ', 512, 'ИВАН ПЕТРОВ', r)
        col(d, 'Тренер %d' % r, 'Команда %d' % r + ' ', 513, 'ДИНАМО МОСКВА', r)
        for c, (nm, x) in enumerate(cols):
            col(d, 'Команда гола %d' % r, '%s %d' % (nm, r), x, '0', r, dt=c, size=50)
        col(d, 'Инфо %d' % r, 'О %d' % r, 1530, '0', r, dt=3)
    for r in range(1, 6):
        K.remove(d, 'Время %d' % r, 'Команда гола %d' % r, 'Игрок %d' % r, 'Тренер %d' % r, 'Инфо %d' % r)
        K.get(d, 'Игрок %d ' % r)['nm'] = 'Игрок %d' % r
        K.get(d, 'Команда %d ' % r)['nm'] = 'Команда %d' % r
    header_labels(d, cols + [('О', 1530)])
    return d


# ---------------------------------------------------------------- сборка
n = 0


def nxt():
    global n
    n += 1
    return n


out(nxt(), 'zastavka', src('zastavka'), 'Заставка')
out(nxt(), 'shtorka', src('shtorka'), 'Шторка')
d = src('tablo'); tablo_logos(d); out(nxt(), 'tablo', d, 'Табло')
out(nxt(), 'udalenie-hoz', dop(1), 'Удаление · хозяева (доп. инфа 1)')
out(nxt(), 'udalenie-gost', dop(2), 'Удаление · гости (доп. инфа 2)')
for side, nm in (('hoz', 'хозяева'), ('gost', 'гости')):
    out(nxt(), 'gol-' + side, gol(), 'Автор гола · ' + nm)

# счёт периода: логотипы слева от хозяев и справа от гостей
d = src('schet_period')
for k, dx in ((1, 32), (2, -32)):  # названия ближе к счёту — место под логотипы
    K.move(K.get(d, 'Команда %d' % k), dx, 0)
    K.move(K.get(d, 'Город %d' % k), dx, 0)
K.add_image_slot(d, 'Логотип 1', 92, 92, 372, 851, like='Счет 1')
K.add_image_slot(d, 'Логотип 2', 92, 92, 1549, 851, like='Счет 2')
out(nxt(), 'schet-period', d, 'Счёт периода')

d = src('bullity'); tablo_logos(d); out(nxt(), 'bullity', d, 'Серия буллитов')

# итоговый счёт: названия ниже, логотипы над ними
d = src('itog_schet')
for k, x in ((1, 576.5), (2, 1352.5)):
    t = K.get(d, 'Команда %d' % k)
    K.move(t, 0, 708 - K.pos(t)[1])
    K.text(t, size=60)
    K.add_image_slot(d, 'Логотип %d' % k, 140, 140, x, 572, like='Команда %d' % k)
out(nxt(), 'itog-schet', d, 'Итоговый счёт матча')

# инфографика: логотипы вместо названий
d = src('infografika')
for k, x in ((1, 636.5), (2, 1292.5)):
    K.add_image_slot(d, 'Логотип %d' % k, 220, 220, x, 622, like='Команда %d' % k)
K.remove(d, 'Команда 1', 'Команда 2')
out(nxt(), 'infografika', d, 'Инфографика о матче')

# составы: логотип над названием, название ниже; две копии — хозяева и гости
for side, nm in (('hoz', 'хозяева'), ('gost', 'гости')):
    d = src('sostav')
    speed_in(d)
    K.move(K.get(d, 'Команда'), 0, 92)
    K.text(K.get(d, 'Команда'), size=64)
    K.move(K.get(d, 'Город'), 0, 82)
    K.add_image_slot(d, 'Логотип', 190, 190, 521.5, 455, like='Команда')
    out(nxt(), 'sostav-' + side, d, 'Состав · ' + nm)

out(nxt(), 'statistika', src('statistika'), 'Статистика матча')
out(nxt(), 'protokol', src('protokol'), 'Протокол матча')
out(nxt(), 'igrok-hoz', igrok(False), 'Игрок · хозяева')
out(nxt(), 'igrok-gost', igrok(False), 'Игрок · гости')
out(nxt(), 'trener-hoz', igrok(True), 'Тренер · хозяева')
out(nxt(), 'trener-gost', igrok(True), 'Тренер · гости')
out(nxt(), 'tablica', standings(), 'Турнирная таблица')
out(nxt(), 'bombardiry', scorers(), 'Бомбардиры')
print('титров:', n, '→', OUT)
