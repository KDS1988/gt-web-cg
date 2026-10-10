#!/usr/bin/env python3
"""
GT Web CG · tools/fhr_package.py — пакет «ФХР · Кубок России», версия 2: титры AE (Lottie) после правок оператора.

  python3 tools/fhr_package.py <папка экспортов v1> <папка результата>

На входе — экспорты AE после первой сборки (NN_имя.json: исправленные имена слоёв и сжатые картинки).
На выходе — набор .json для страницы импорта; метаданные полей (привязки к данным матча, разделы,
выбор игроков, ленты таблицы/бомбардиров) добавляет tools/fhr_meta.py уже в собранный пакет.
"""
import sys, os, glob, copy
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
    K.save(d, os.path.join(OUT, '%02d_%s.json' % (n, slug)))


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
    d = src('gol_avtor'); tablo_logos(d); out(nxt(), 'gol-' + side, d, 'Автор гола · ' + nm)

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
