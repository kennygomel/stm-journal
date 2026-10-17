#!/usr/bin/env python3
"""Превью иконок из src/icons.js — рисует их обводкой в PNG.

Юнит-тест проверяет только структуру (что это SVG с контурами), поэтому нужен
глазной контроль: скрипт разбирает те же строки путей, что уходят в бандл, и
рисует их штрихом 1.7 на сетке 24×24. Поддерживает M/L/H/V/C/S/A/Z.

Запуск: python3 tools/preview_icons.py
"""

import math
import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'src' / 'icons.js'
OUT = ROOT / 'tools' / 'icons-preview.png'

STROKE = 1.7
SS = 4  # суперсэмплинг
NUMBER = re.compile(r'-?\d*\.?\d+')


def read_icons():
    text = SOURCE.read_text()
    block = re.search(r'const PATHS = \{(.*?)\n\};', text, re.S).group(1)
    icons = {}
    for entry in re.finditer(r"(\w+): \[(.*?)\],", block, re.S):
        name, body = entry.groups()
        icons[name] = re.findall(r"'([^']+)'", body)
    return icons


def arc_to_cubics(x0, y0, rx, ry, phi_deg, large, sweep, x1, y1):
    """SVG-дуга → кубические кривые (алгоритм из спецификации SVG)."""
    if rx == 0 or ry == 0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]
    phi = math.radians(phi_deg)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x1) / 2, (y0 - y1) / 2
    x1p, y1p = cos_p * dx2 + sin_p * dy2, -sin_p * dx2 + cos_p * dy2

    rx, ry = abs(rx), abs(ry)
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1:
        k = math.sqrt(lam)
        rx, ry = rx * k, ry * k

    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    factor = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        factor = -factor
    cxp = factor * rx * y1p / ry
    cyp = -factor * ry * x1p / rx
    cx = cos_p * cxp - sin_p * cyp + (x0 + x1) / 2
    cy = sin_p * cxp + cos_p * cyp + (y0 + y1) / 2

    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        norm = math.hypot(ux, uy) * math.hypot(vx, vy) or 1
        value = max(-1.0, min(1.0, dot / norm))
        sign = -1 if (ux * vy - uy * vx) < 0 else 1
        return sign * math.acos(value)

    theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    # В SVG положительный угол идёт ПО часовой (ось Y вниз), а acos/atan2 —
    # против. Поэтому sweep=0 (против часовой по SVG) = положительная дельта.
    if sweep and delta < 0:
        delta -= 2 * math.pi
    if not sweep and delta > 0:
        delta += 2 * math.pi

    out = []
    segments = max(1, int(math.ceil(abs(delta) / (math.pi / 2))))
    for i in range(segments):
        a0 = theta1 + delta * i / segments
        a1 = theta1 + delta * (i + 1) / segments
        alpha = 4 / 3 * math.tan((a1 - a0) / 4)
        p0 = (
            cx + rx * math.cos(a0) * cos_p - ry * math.sin(a0) * sin_p,
            cy + rx * math.cos(a0) * sin_p + ry * math.sin(a0) * cos_p,
        )
        p1 = (
            cx + rx * math.cos(a1) * cos_p - ry * math.sin(a1) * sin_p,
            cy + rx * math.cos(a1) * sin_p + ry * math.sin(a1) * cos_p,
        )
        d0 = (
            -rx * math.sin(a0) * cos_p - ry * math.cos(a0) * sin_p,
            -rx * math.sin(a0) * sin_p + ry * math.cos(a0) * cos_p,
        )
        d1 = (
            -rx * math.sin(a1) * cos_p - ry * math.cos(a1) * sin_p,
            -rx * math.sin(a1) * sin_p + ry * math.cos(a1) * cos_p,
        )
        out.append(
            (
                (p0[0] + alpha * d0[0], p0[1] + alpha * d0[1]),
                (p1[0] - alpha * d1[0], p1[1] - alpha * d1[1]),
                p1,
            )
        )
    return out


def parse_path(d):
    """Строка пути → список полилиний (замкнутых и открытых)."""
    tokens = re.findall(r'[MmLlHhVvCcSsAaZz]|-?\d*\.?\d+', d.replace(',', ' '))
    subs = []
    current = []
    x = y = sx = sy = 0.0
    prev_c2 = None
    last_was_curve = False
    index = 0

    def numbers(count):
        nonlocal index
        values = []
        while index < len(tokens) and len(values) < count and NUMBER.fullmatch(tokens[index] or ''):
            values.append(float(tokens[index]))
            index += 1
        return values

    def cubic(c1, c2, end):
        nonlocal x, y, prev_c2
        span = abs(end[0] - x) + abs(c1[0] - x) + abs(c2[0] - x) + abs(end[1] - y) + abs(end[1] - y)
        steps = max(16, int(span * 14))
        for k in range(1, steps + 1):
            t = k / steps
            mt = 1 - t
            px = mt**3 * x + 3 * mt**2 * t * c1[0] + 3 * mt * t**2 * c2[0] + t**3 * end[0]
            py = mt**3 * y + 3 * mt**2 * t * c1[1] + 3 * mt * t**2 * c2[1] + t**3 * end[1]
            current.append((px, py))
        x, y = end
        prev_c2 = c2

    while index < len(tokens):
        cmd = tokens[index]
        index += 1
        if cmd in 'Mm':
            if current:
                subs.append(current)
            point = numbers(2)
            x, y = (point[0], point[1]) if cmd == 'M' else (x + point[0], y + point[1])
            sx, sy = x, y
            current = [(x, y)]
            prev_c2 = None
        elif cmd in 'Ll':
            point = numbers(2)
            x, y = (point[0], point[1]) if cmd == 'L' else (x + point[0], y + point[1])
            current.append((x, y))
            prev_c2 = None
        elif cmd in 'Hh':
            value = numbers(1)[0]
            x = value if cmd == 'H' else x + value
            current.append((x, y))
            prev_c2 = None
        elif cmd in 'Vv':
            value = numbers(1)[0]
            y = value if cmd == 'V' else y + value
            current.append((x, y))
            prev_c2 = None
        elif cmd in 'CcSs':
            values = numbers(6)
            absolute = cmd.isupper()
            point = lambda i: (values[i], values[i + 1]) if absolute else (x + values[i], y + values[i + 1])
            if cmd in 'Cc':
                c1, c2, end = point(0), point(2), point(4)
            else:
                # S/s: первый контроль — отражение предыдущего, вторая точка задана явно
                c1 = (2 * x - prev_c2[0], 2 * y - prev_c2[1]) if prev_c2 else (x, y)
                c2, end = point(0), point(2)
            cubic(c1, c2, end)
        elif cmd in 'Aa':
            values = numbers(7)
            rx, ry, rot, large, sweep, ax, ay = values
            end = (ax, ay) if cmd == 'A' else (x + ax, y + ay)
            for c1, c2, point in arc_to_cubics(x, y, rx, ry, rot, int(large), int(sweep), end[0], end[1]):
                cubic(c1, c2, point)
        elif cmd in 'Zz':
            if current and (x, y) != (sx, sy):
                current.append((sx, sy))
            x, y = sx, sy
            prev_c2 = None
    if current:
        subs.append(current)
    return subs


def stroke_box(points, width):
    """Прямоугольник вокруг полилинии — чтобы не считать расстояние по всему кадру."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    half = width / 2 + 2
    return (min(xs) - half, min(ys) - half, max(xs) + half, max(ys) + half)


def draw_stroke(draw, points, width, closed=False):
    """Толстая линия = множество точек на расстоянии ≤ width/2 от полилинии.

    Так не бывает самопересечений контура — в отличие от «полосы по нормалям»,
    которая на окружностях даёт кресты.
    """
    if len(points) < 2:
        return
    if closed and points[0] != points[-1]:
        points = list(points) + [points[0]]
    half = width / 2
    x0, y0, x1, y1 = stroke_box(points, width)
    limit = half + 1
    for py in range(math.floor(y0), math.ceil(y1) + 1):
        for px in range(math.floor(x0), math.ceil(x1) + 1):
            cx, cy = px + 0.5, py + 0.5
            for index in range(len(points) - 1):
                ax, ay = points[index]
                bx, by = points[index + 1]
                dx, dy = bx - ax, by - ay
                length2 = dx * dx + dy * dy
                if length2 == 0:
                    t = 0.0
                else:
                    t = max(0.0, min(1.0, ((cx - ax) * dx + (cy - ay) * dy) / length2))
                qx, qy = ax + t * dx, ay + t * dy
                if (cx - qx) ** 2 + (cy - qy) ** 2 <= half * half:
                    draw.point((px, py), fill=255)
                    break


def render_icon(paths, scale=5):
    size = 24 * scale * SS
    canvas = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(canvas)
    factor = size / 24
    for d in paths:
        for sub in parse_path(d):
            closed = len(sub) > 2 and sub[0] == sub[-1]
            draw_stroke(draw, [(px * factor, py * factor) for px, py in sub], STROKE * factor, closed)
    return canvas.resize((24 * scale, 24 * scale), Image.LANCZOS)


def main():
    icons = read_icons()
    names = list(icons)
    print('иконок:', names)
    cell, gap = 24 * 5, 14
    width = gap + len(names) * (cell + gap)
    height = cell + 2 * gap
    sheet = Image.new('L', (width, height), 245)

    for index, name in enumerate(names):
        tile = render_icon(icons[name])
        # штрих рисовался белым на чёрном — на лист кладём инверсию
        sheet.paste(Image.eval(tile, lambda value: 255 - value), (gap + index * (cell + gap), gap))

    sheet.save(OUT)
    print('→', OUT.relative_to(ROOT), f'({width}×{height}); порядок: {", ".join(names)}')


if __name__ == '__main__':
    main()
