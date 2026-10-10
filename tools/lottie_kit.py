"""
GT Web CG · tools/lottie_kit.py — правка Lottie (Bodymovin) JSON из Python: перенос, клонирование
слоёв с их анимацией, слоты под логотипы, удаление слоёв вместе с масками.

Соглашения Lottie: layers — сверху вниз; слой-маска (td) стоит прямо над слоем с tt.
Позиция слоя: ks.p.k — [x,y,z] или ключи [{t,s,(e)}]; раздельная — ks.p.x/ks.p.y.
"""
import copy, json, base64, io

TRANSPARENT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg=='


def load(p):
    return json.load(open(p, encoding='utf-8'))


def save(d, p):
    json.dump(d, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))


def idx(d, name, start=0):
    for i in range(start, len(d['layers'])):
        if d['layers'][i]['nm'] == name:
            return i
    raise KeyError(name)


def get(d, name):
    return d['layers'][idx(d, name)]


def has(d, name):
    return any(l['nm'] == name for l in d['layers'])


def _animated(prop):
    k = prop.get('k')
    return isinstance(k, list) and k and isinstance(k[0], dict)


def pos(layer):
    """Текущая (первая) позиция слоя [x, y]"""
    p = layer['ks']['p']
    if 'k' not in p:
        return [p['x']['k'] if not _animated(p['x']) else p['x']['k'][0]['s'][0],
                p['y']['k'] if not _animated(p['y']) else p['y']['k'][0]['s'][0]]
    if _animated(p):
        return list(p['k'][0]['s'][:2])
    return list(p['k'][:2])


def move(layer, dx, dy):
    p = layer['ks']['p']
    if 'k' not in p:  # раздельные x/y
        for ax, dv in (('x', dx), ('y', dy)):
            q = p[ax]
            if _animated(q):
                for kf in q['k']:
                    for key in ('s', 'e'):
                        if key in kf:
                            kf[key][0] += dv
            else:
                q['k'] += dv
        return layer
    if _animated(p):
        for kf in p['k']:
            for key in ('s', 'e'):
                if key in kf:
                    kf[key][0] += dx
                    kf[key][1] += dy
    else:
        p['k'][0] += dx
        p['k'][1] += dy
    return layer


def place(layer, x, y):
    cx, cy = pos(layer)
    return move(layer, x - cx, y - cy)


def retime(layer, dt):
    """Сдвинуть слой во времени на dt кадров (ip/op и все ключи трансформации)"""
    if not dt:
        return layer
    layer['ip'] += dt
    layer['op'] += dt

    def sh(prop):
        if isinstance(prop, dict):
            if _animated(prop):
                for kf in prop['k']:
                    kf['t'] += dt
            for v in prop.values():
                if isinstance(v, dict) and v is not prop:
                    sh(v)
    for v in layer['ks'].values():
        sh(v)
    return layer


def _next_ind(d):
    return max([l.get('ind', 0) for l in d['layers']] + [0]) + 1


def text(layer, t=None, size=None, j=None, fc=None, font=None, tr=None):
    for k in layer['t']['d']['k']:
        s = k['s']
        if t is not None:
            s['t'] = t
        if size is not None:
            s['s'] = size
        if j is not None:
            s['j'] = j
        if fc is not None:
            s['fc'] = fc
        if font is not None:
            s['f'] = font
        if tr is not None:
            s['tr'] = tr
    return layer


def text_of(layer):
    return layer['t']['d']['k'][0]['s']


def clone(d, src, name, at=None, with_matte=True):
    """Копия слоя src (со своей анимацией). Слой под маской (tt) копируется вместе с маской.
    at — индекс вставки (по умолчанию — над исходным слоем/его маской). Возвращает новый слой."""
    i = idx(d, src)
    L = d['layers'][i]
    new = copy.deepcopy(L)
    new['nm'] = name
    new['ind'] = _next_ind(d)
    block = [new]
    if L.get('tt') and with_matte and i > 0 and d['layers'][i - 1].get('td'):
        m = copy.deepcopy(d['layers'][i - 1])
        m['ind'] = new['ind'] + 1
        block = [m, new]
    if at is None:
        at = i - 1 if len(block) == 2 else i
    d['layers'][at:at] = block
    return new


def remove(d, *names):
    """Удалить слои; маска (td) прямо над удаляемым tt-слоем удаляется тоже"""
    for n in names:
        if not has(d, n):
            continue
        i = idx(d, n)
        if d['layers'][i].get('tt') and i > 0 and d['layers'][i - 1].get('td'):
            del d['layers'][i - 1:i + 1]
        else:
            del d['layers'][i]


def keep_only(d, names):
    """Оставить только перечисленные слои (и их маски)"""
    keep = set()
    for i, l in enumerate(d['layers']):
        if l['nm'] in names:
            keep.add(i)
            if l.get('tt') and i > 0 and d['layers'][i - 1].get('td'):
                keep.add(i - 1)
    d['layers'] = [l for i, l in enumerate(d['layers']) if i in keep]


def add_image_slot(d, name, w, h, cx, cy, like, at=0, asset_id=None, anchor_center=True):
    """Слот под картинку (логотип): прозрачная заглушка w×h с центром (cx, cy), анимация — как у слоя like
    (масштаб, прозрачность, сдвиги, время). Картинку подставляет пульт (поле «name.Source»)."""
    L = get(d, like)
    aid = asset_id or ('slot_' + str(_next_ind(d)))
    d['assets'].append({'id': aid, 'w': int(w), 'h': int(h), 'u': '', 'p': TRANSPARENT, 'e': 1})
    ks = copy.deepcopy(L['ks'])
    ks['a'] = {'a': 0, 'k': [w / 2, h / 2, 0]}
    lay = {'ddd': 0, 'ind': _next_ind(d), 'ty': 2, 'nm': name, 'refId': aid, 'sr': 1, 'ks': ks, 'ao': 0,
           'ip': L['ip'], 'op': L['op'], 'st': L.get('st', 0), 'bm': 0}
    place(lay, cx, cy)
    d['layers'].insert(at, lay)
    return lay


def assets(d):
    return {a['id']: a for a in d['assets']}


def crop_asset_left(d, asset_id, px):
    """Сделать прозрачными левые px пикселей картинки ассета (нужна Pillow)"""
    from PIL import Image
    a = assets(d)[asset_id]
    head, b64 = a['p'].split(',', 1)
    im = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
    px = int(px)
    for x in range(min(px, im.width)):
        for y in range(im.height):
            r, g, b, al = im.getpixel((x, y))
            im.putpixel((x, y), (r, g, b, 0))
    bio = io.BytesIO()
    im.save(bio, 'PNG', optimize=True)
    a['p'] = 'data:image/png;base64,' + base64.b64encode(bio.getvalue()).decode()
