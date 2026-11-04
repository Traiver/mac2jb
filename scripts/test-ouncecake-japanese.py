# Verify actual Japanese glyph coverage, not just nonempty replacement/tofu glyphs.
import importlib.util
from pathlib import Path
module_path = Path(__file__).resolve().parents[1] / 'integrations/mintbrew-ouncecake/raster.py'
spec = importlib.util.spec_from_file_location('ouncecake_raster', module_path)
raster = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raster)
face = raster.font(25)
for a, b in [('日', '本'), ('あ', 'ア'), ('漢', '字')]:
    assert bytes(face.getmask(a)) != bytes(face.getmask(b)), f'Missing Japanese glyphs: {a}, {b}'
print('Japanese Kanji, Hiragana and Katakana glyph coverage passed:', face.path)

from PIL import Image, ImageDraw
canvas = Image.new('L', (raster.WIDTH, raster.HEIGHT))
draw = ImageDraw.Draw(canvas)
for name in ['The Legend of Zelda: Ocarina of Time', 'Super Nintendo Entertainment System – Nintendo Classics', 'スーパーファミコン Nintendo Classics']:
    prefix, suffix = raster.row_label({'name': name, 'titleId': '0400486024dec000'}, 22)
    label, face = raster.fit_label(draw, prefix, suffix, {25: raster.font(25)})
    assert label == prefix + suffix, (name, label)
    assert draw.textlength(label, font=face) <= raster.WIDTH - 8
prefix, suffix = raster.row_label({'name': '[Firmware] All registered original NCAs', 'kind':'firmware-nca', 'titleId':'fffffffffffffff0'}, 1)
assert suffix == ''
print('Complete screenshot titles fit the widened row; firmware sentinel is hidden.')
