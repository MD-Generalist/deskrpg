"""Assemble existing rendered evidence; never changes model or rendered pixels."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'art/characters/office-catalog'
rows = []
for sex in ['female', 'male']:
    for look in json.loads((ART / sex / 'looks.json').read_text()):
        rows.append((sex, look['id']))
for clip in ['idle', 'walk', 'sit']:
    sheet = Image.new('RGB', (1800, 1260), '#e3dfd6')
    draw = ImageDraw.Draw(sheet)
    for index, (sex, ident) in enumerate(rows):
        suffix = '' if sex == 'male' and clip == 'idle' else '-' + clip
        path = ART / sex / (ident + suffix + '.png')
        render = Image.open(path).convert('RGBA')
        render.thumbnail((180, 232))
        x, y = (index % 10) * 180, (index // 10) * 252
        sheet.paste(render, (x + (180-render.width)//2, y), render)
        draw.text((x+4, y+235), ident, fill='#222222')
    sheet.save(ART / ('wardrobe-' + clip + '.jpg'), quality=92)
for path in sorted((ART / 'wardrobe-audit').glob('office-*-idle-front.png')):
    ident = path.name.removesuffix('-idle-front.png')
    sheet = Image.new('RGB', (720, 936), '#e3dfd6')
    draw = ImageDraw.Draw(sheet)
    for row, clip in enumerate(['idle', 'walk', 'sit']):
        for col, angle in enumerate(['front', 'side', 'rear']):
            render = Image.open(path.parent / f'{ident}-{clip}-{angle}.png').convert('RGB')
            render.thumbnail((240, 288))
            sheet.paste(render, (col*240, row*312))
            draw.text((col*240+4, row*312+294), f'{ident} {clip} {angle}', fill='#222222')
    sheet.save(path.parent / (ident+'-review.jpg'), quality=92)
manifest = []
for sex, ident in rows:
    model = ROOT / 'public/assets/characters/office' / (ident+'.glb')
    renders = {}
    for clip in ['idle', 'walk', 'sit']:
        suffix = '' if sex == 'male' and clip == 'idle' else '-' + clip
        path = ART / sex / (ident + suffix + '.png')
        assert path.stat().st_mtime >= model.stat().st_mtime, f'Stale render: {path}'
        renders[clip] = {'path': str(path.relative_to(ROOT)),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    manifest.append({'id': ident, 'sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
                     'renders': renders})
(ART / 'visual-review-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
