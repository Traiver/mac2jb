import json
import os
import sys
import unicodedata
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1408
HEIGHT = 32
MAX_GAMES = 1001

def font(size):
    override = os.environ.get('MAC2JB_OUNCECAKE_FONT')
    candidates = [Path(override)] if override else []
    # Use the installed macOS Japanese font; never redistribute Apple's font files.
    candidates += [p for p in Path('/System/Library/Fonts').glob('*.ttc')
                   if unicodedata.normalize('NFC', p.name) == 'ヒラギノ角ゴシック W3.ttc']
    fallback = os.environ.get('MAC2JB_HBLAUNCHER_FONT')
    if fallback:
        candidates.append(Path(fallback))
    for path in candidates:
        if path.is_file():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)

def shorten(draw, value, face):
    if draw.textlength(value, font=face) <= WIDTH - 8:
        return value
    lo, hi = 0, len(value)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if draw.textlength(value[:mid] + '…', font=face) <= WIDTH - 8:
            lo = mid
        else:
            hi = mid - 1
    return value[:lo] + '…'

def row_label(game, number):
    suffix = f' [{game["titleId"]}]' if game.get('titleId') and not game.get('exportPart') and not game.get('saveArchive') and game.get('kind') != 'firmware-nca' else ''
    prefix = game['name'] if game.get('heading') else f'{number}. {game["name"]}'
    return prefix, suffix

def fit_label(draw, prefix, suffix, faces):
    for size in range(25, 17, -1):
        if size not in faces:
            faces[size] = font(size)
        face = faces[size]
        if draw.textlength(prefix + suffix, font=face) <= WIDTH - 8:
            return prefix + suffix, face
    while prefix and draw.textlength(prefix + '…' + suffix, font=face) > WIDTH - 8:
        prefix = prefix[:-1]
    return prefix.rstrip() + '…' + suffix, face

def raster(input_path, output_path):
    games = json.loads(Path(input_path).read_text())
    if not isinstance(games, list) or not 0 < len(games) <= MAX_GAMES:
        raise ValueError('invalid OunceCake catalog size')
    faces = {25: font(25)}
    with Path(output_path).open('wb') as output:
        for number, game in enumerate(games, 1):
            if not isinstance(game, dict) or not isinstance(game.get('name'), str):
                raise ValueError('invalid OunceCake game title')
            canvas = Image.new('L', (WIDTH, HEIGHT))
            draw = ImageDraw.Draw(canvas)
            prefix, suffix = row_label(game, number)
            label, face = fit_label(draw, prefix, suffix, faces)
            box = draw.textbbox((0, 0), label, font=face)
            draw.text((4 - box[0], (HEIGHT - (box[3] - box[1])) // 2 - box[1]),
                      label, font=face, fill=255)
            raw = canvas.tobytes()
            # Four alpha levels keep the wider row within the existing 16 MiB GPU buffer.
            packed = bytearray(len(raw) // 4)
            for i in range(0, len(raw), 4):
                packed[i // 4] = sum(((raw[i+j]*3+127)//255) << (6-2*j) for j in range(4))
            output.write(packed)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: raster.py CATALOG_JSON OUTPUT_BIN')
    raster(sys.argv[1], sys.argv[2])
