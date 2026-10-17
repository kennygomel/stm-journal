#!/usr/bin/env python3
"""Знак СТМ из logo.svg → icon-only SVG и PNG 512×512.

В логотипе знак — это три тонкие волны с линейными градиентами. Пути в SVG
задают осевую линию волны, поэтому толщина восстанавливается симметричным
контуром (осевая ± полуширина), а не заливкой «прямая + обратная проходка»
(та даёт сплошную ленту). Ширина плавно сужается к краям, как в оригинале.

Запуск: python3 tools/make_brand_mark.py
"""

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'logo.svg'
OUT_DIR = ROOT / 'public' / 'brand'

# Полуширина волны и сужение к краям (подобрано по оригиналу logo.svg).
HALF_WIDTH = 1.9
TAPER = 0.55


# ---------------------------------------------------------------- разбор SVG

def read_group(svg):
    group = re.search(r'<g\b([^>]*)>(.*?)</g>', svg, re.S)
    if not group:
        raise SystemExit('в logo.svg не найдена группа со знаком')
    attrs, body = group.groups()
    translate = re.search(r'translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)', attrs)
    origin = (float(translate.group(1)), float(translate.group(2))) if translate else (0.0, 0.0)

    waves = []
    for path in re.finditer(r'<path\b([^>]*?)/>', body, re.S):
        sa = path.group(1)
        d = re.search(r'\bd="([^"]+)"', sa).group(1)
        gradient = re.search(r'fill="url\(#([^)]+)\)"', sa)
        opacity = re.search(r'opacity="([\d.]+)"', sa)
        shift = re.search(r'translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)', sa)
        waves.append(
            {
                'd': d,
                'gradient': gradient.group(1) if gradient else None,
                'opacity': float(opacity.group(1)) if opacity else 1.0,
                'shift': (float(shift.group(1)), float(shift.group(2))) if shift else (0.0, 0.0),
            }
        )
    return origin, waves, body


def read_gradients(svg):
    gradients = {}
    for match in re.finditer(r'<linearGradient\b([^>]*)>(.*?)</linearGradient>', svg, re.S):
        attrs, body = match.groups()
        gid = re.search(r'id="([^"]+)"', attrs).group(1)
        stops = []
        for stop in re.finditer(r'<stop\b([^>]*)/>', body):
            sa = stop.group(1)
            offset = float(re.search(r'offset="([\d.]+)%"', sa).group(1)) / 100
            color = re.search(r'stop-color="(#[0-9A-Fa-f]{6})"', sa).group(1)
            stops.append((offset, color))
        gradients[gid] = sorted(stops)
    return gradients


# ------------------------------------------------------- осевая линия волны

def axis_points(d, step=0.35):
    tokens = re.findall(r'[MCcSs]|-?\d+(?:\.\d+)?', d.replace('\n', ' '))
    points = []
    current = None
    prev_ctrl = None
    index = 0
    while index < len(tokens):
        cmd = tokens[index]
        index += 1
        numbers = []
        while index < len(tokens) and re.fullmatch(r'-?\d+(?:\.\d+)?', tokens[index]):
            numbers.append(float(tokens[index]))
            index += 1

        if cmd == 'M':
            current = (numbers[0], numbers[1])
            points.append(current)
            prev_ctrl = None
        elif cmd in ('C', 'S'):
            if cmd == 'C':
                c1, c2, end = (numbers[0], numbers[1]), (numbers[2], numbers[3]), (numbers[4], numbers[5])
            else:
                c1 = (2 * current[0] - prev_ctrl[0], 2 * current[1] - prev_ctrl[1]) if prev_ctrl else current
                c2, end = (numbers[0], numbers[1]), (numbers[2], numbers[3])
            span = abs(end[0] - current[0]) + abs(c1[0] - current[0]) + abs(c2[0] - current[0])
            n = max(12, int(span * step))
            for k in range(1, n + 1):
                t = k / n
                mt = 1 - t
                x = mt**3 * current[0] + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * end[0]
                y = mt**3 * current[1] + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * end[1]
                points.append((x, y))
            prev_ctrl = c2
            current = end
    return points


def ribbon(points, half_width, taper):
    top, bottom = [], []
    count = len(points)
    for i, (x, y) in enumerate(points):
        t = i / (count - 1) if count > 1 else 0.5
        edge = min(t, 1 - t) / 0.5
        width = half_width * (1 - taper * (1 - min(1.0, edge)))
        if i == 0:
            dx, dy = points[1][0] - x, points[1][1] - y
        elif i == count - 1:
            dx, dy = x - points[-2][0], y - points[-2][1]
        else:
            dx, dy = points[i + 1][0] - points[i - 1][0], points[i + 1][1] - points[i - 1][1]
        length = (dx * dx + dy * dy) ** 0.5 or 1
        nx, ny = -dy / length, dx / length
        top.append((x + nx * width, y + ny * width))
        bottom.append((x - nx * width, y - ny * width))
    return top + bottom[::-1]


# ------------------------------------------------------------------- заливка

def hex_to_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def gradient_color(stops, t):
    t = min(max(t, 0.0), 1.0)
    for i in range(len(stops) - 1):
        o1, c1 = stops[i]
        o2, c2 = stops[i + 1]
        if o1 <= t <= o2:
            span = (t - o1) / (o2 - o1) if o2 > o1 else 0
            a, b = hex_to_rgb(c1), hex_to_rgb(c2)
            return tuple(round(a[k] + (b[k] - a[k]) * span) for k in range(3))
    return hex_to_rgb(stops[-1][1])


def render(origin, waves, gradients, size, factor, box, supersample=4):
    big = (size[0] * supersample, size[1] * supersample)
    min_x, max_x, min_y, max_y = box
    scale = factor * supersample
    pad_x = (big[0] - (max_x - min_x) * scale) / 2
    pad_y = (big[1] - (max_y - min_y) * scale) / 2

    def project(x, y):
        return (pad_x + (x - min_x) * scale, pad_y + (y - min_y) * scale)

    canvas = Image.new('RGBA', big, (0, 0, 0, 0))
    width = max_x - min_x
    for wave in waves:
        ox, oy = origin[0] + wave['shift'][0], origin[1] + wave['shift'][1]
        points = [(x + ox, y + oy) for x, y in axis_points(wave['d'])]
        contour = [project(x, y) for x, y in ribbon(points, HALF_WIDTH, TAPER)]

        mask = Image.new('L', big, 0)
        ImageDraw.Draw(mask).polygon(contour, fill=round(255 * wave['opacity']))

        stops = gradients.get(wave['gradient']) or [(0.0, '#1F94BF')]
        strip = Image.new('RGB', (big[0], 1))
        strip_px = strip.load()
        for x in range(big[0]):
            strip_px[x, 0] = gradient_color(stops, (x - pad_x) / (width * scale) if width else 0)
        layer = strip.resize(big).convert('RGBA')
        layer.putalpha(mask)
        canvas = Image.alpha_composite(canvas, layer)
    return canvas.resize(size, Image.LANCZOS)


def main():
    svg = SOURCE.read_text()
    origin, waves, body = read_group(svg)
    gradients = read_gradients(svg)
    print('волн в знаке:', len(waves))
    print('палитра:', sorted({c for stops in gradients.values() for _, c in stops}))

    xs, ys = [], []
    for wave in waves:
        for x, y in axis_points(wave['d']):
            xs.append(x + origin[0] + wave['shift'][0])
            ys.append(y + origin[1] + wave['shift'][1])
    pad = HALF_WIDTH + 1.5
    box = (min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad)
    print('знак: %.1f × %.1f' % (box[1] - box[0], box[3] - box[2]))

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    gradients_xml = re.findall(r'<linearGradient.*?</linearGradient>', svg, re.S)
    paths_xml = re.findall(r'<path.*?/>', body, re.S)
    icon = (
        '<svg xmlns="http://www.w3.org/2000/svg"\n'
        '     viewBox="%.1f %.1f %.1f %.1f"\n'
        '     role="img" aria-label="СТМ — волновой знак">\n'
        '  <defs>\n%s\n  </defs>\n'
        '  <g transform="translate(%g, %g)">\n%s\n  </g>\n'
        '</svg>\n'
    ) % (
        box[0], box[2], box[1] - box[0], box[3] - box[2],
        '\n'.join('    ' + line.strip() for line in gradients_xml),
        origin[0], origin[1],
        '\n'.join('    ' + line.strip() for line in paths_xml),
    )
    (OUT_DIR / 'stm-mark.svg').write_text(icon)
    print('→ public/brand/stm-mark.svg')

    SIZE = 512
    # знак широкий и низкий: держим по ширине, чтобы он занимал кадр осмысленно
    inner = SIZE * (1 - 2 * 0.07)
    factor = inner / (box[1] - box[0])
    render(origin, waves, gradients, (SIZE, SIZE), factor, box).save(OUT_DIR / 'stm-mark-512.png')
    print('→ public/brand/stm-mark-512.png (512×512)')

    # 3) крупный PNG для вёрстки (если понадобится растровый знак)
    wide = (int((box[1] - box[0]) * 3), int((box[3] - box[2]) * 3))
    render(origin, waves, gradients, wide, 3, box).save(OUT_DIR / 'mark@3x.png')
    print('→ public/brand/mark@3x.png (%d×%d)' % wide)


if __name__ == '__main__':
    main()
