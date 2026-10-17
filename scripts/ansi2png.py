#!/usr/bin/env python3
"""Renders a tmux `capture-pane -e` dump (ANSI SGR colors) to a PNG.

Half-block and full-block glyphs are painted as rectangles so the pixel floor
comes out exactly, whatever the font. Everything else uses a monospace font.

    python3 scripts/ansi2png.py snap.ansi snap.png
"""

import re
import sys

from PIL import Image, ImageDraw, ImageFont

CELL_W, CELL_H = 9, 18
DEFAULT_FG, DEFAULT_BG = (0xD0, 0xD0, 0xD0), (0x1E, 0x1E, 0x1E)
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/firacode/FiraCode-Regular.ttf",
    "C:/Windows/Fonts/consola.ttf",
]

BASIC = [
    (0, 0, 0), (205, 49, 49), (13, 188, 121), (229, 229, 16),
    (36, 114, 200), (188, 63, 188), (17, 168, 205), (229, 229, 229),
    (102, 102, 102), (241, 76, 76), (35, 209, 139), (245, 245, 67),
    (59, 142, 234), (214, 112, 214), (41, 184, 219), (255, 255, 255),
]


def xterm256(n):
    if n < 16:
        return BASIC[n]
    if n < 232:
        n -= 16
        steps = [0, 95, 135, 175, 215, 255]
        return (steps[n // 36], steps[(n // 6) % 6], steps[n % 6])
    v = 8 + (n - 232) * 10
    return (v, v, v)


FALLBACKS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/seguisym.ttf",
]


def load_font(paths=FONTS):
    for path in paths:
        try:
            return ImageFont.truetype(path, 15)
        except OSError:
            continue
    return ImageFont.load_default()


def needs_fallback(ch):
    """Symbols monospace fonts usually lack (misc symbols, dingbats, arrows+)."""
    cp = ord(ch)
    return 0x2190 <= cp <= 0x21FF or 0x2600 <= cp <= 0x27BF or 0x2B00 <= cp <= 0x2BFF


SGR = re.compile(r"\x1b\[([0-9;:]*)m")
OTHER_ESC = re.compile(r"\x1b\][^\x07]*(\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]")


def parse(text):
    """Yields rows of (char, fg, bg, bold, dim) cells."""
    fg, bg, bold, dim, reverse = None, None, False, False, False
    rows = []
    for line in text.split("\n"):
        cells = []
        pos = 0
        for m in SGR.finditer(line):
            for ch in OTHER_ESC.sub("", line[pos:m.start()]):
                cells.append((ch, fg, bg, bold, dim, reverse))
            pos = m.end()
            codes = [int(c) if c else 0 for c in re.split("[;:]", m.group(1) or "0")]
            i = 0
            while i < len(codes):
                c = codes[i]
                if c == 0:
                    fg, bg, bold, dim, reverse = None, None, False, False, False
                elif c == 1:
                    bold = True
                elif c == 2:
                    dim = True
                elif c == 22:
                    bold = dim = False
                elif c == 7:
                    reverse = True
                elif c == 27:
                    reverse = False
                elif 30 <= c <= 37:
                    fg = BASIC[c - 30]
                elif 90 <= c <= 97:
                    fg = BASIC[c - 90 + 8]
                elif 40 <= c <= 47:
                    bg = BASIC[c - 40]
                elif 100 <= c <= 107:
                    bg = BASIC[c - 100 + 8]
                elif c == 39:
                    fg = None
                elif c == 49:
                    bg = None
                elif c in (38, 48) and i + 1 < len(codes):
                    if codes[i + 1] == 2 and i + 4 < len(codes):
                        color = tuple(codes[i + 2:i + 5])
                        i += 4
                    elif codes[i + 1] == 5 and i + 2 < len(codes):
                        color = xterm256(codes[i + 2])
                        i += 2
                    else:
                        color = None
                    if c == 38:
                        fg = color
                    else:
                        bg = color
                i += 1
        for ch in OTHER_ESC.sub("", line[pos:]):
            cells.append((ch, fg, bg, bold, dim, reverse))
        rows.append(cells)
    while rows and not rows[-1]:
        rows.pop()
    return rows


def render(rows, out):
    width = max((len(r) for r in rows), default=1)
    img = Image.new("RGB", (width * CELL_W, max(1, len(rows)) * CELL_H), DEFAULT_BG)
    draw = ImageDraw.Draw(img)
    font = load_font()
    fallback = load_font(FALLBACKS)
    for y, row in enumerate(rows):
        for x, (ch, fg, bg, bold, dim, reverse) in enumerate(row):
            f = fg or DEFAULT_FG
            b = bg or DEFAULT_BG
            if reverse:
                f, b = b, f
            if dim:
                f = tuple((c + bc) // 2 for c, bc in zip(f, b))
            x0, y0 = x * CELL_W, y * CELL_H
            draw.rectangle([x0, y0, x0 + CELL_W - 1, y0 + CELL_H - 1], fill=b)
            half = CELL_H // 2
            if ch == "\u2580":
                draw.rectangle([x0, y0, x0 + CELL_W - 1, y0 + half - 1], fill=f)
            elif ch == "\u2584":
                draw.rectangle([x0, y0 + half, x0 + CELL_W - 1, y0 + CELL_H - 1], fill=f)
            elif ch == "\u2588":
                draw.rectangle([x0, y0, x0 + CELL_W - 1, y0 + CELL_H - 1], fill=f)
            elif ch != " ":
                face = fallback if needs_fallback(ch) else font
                draw.text((x0, y0 + 1), ch, font=face, fill=f)
                if bold:
                    draw.text((x0 + 1, y0 + 1), ch, font=face, fill=f)
    img.save(out)


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8", errors="replace") as fh:
        render(parse(fh.read()), dst)
