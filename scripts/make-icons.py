#!/usr/bin/env python3
"""Generate LingoStep PWA icons (192, 512, maskable, favicon)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
os.makedirs(OUT, exist_ok=True)

PRIMARY = (14, 122, 95, 255)      # #0e7a5f
PRIMARY_DEEP = (9, 63, 49, 255)   # #093f31
WHITE = (255, 255, 255, 255)

def rounded_rect_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m

def draw_icon(size, maskable=False):
    img = Image.new('RGBA', (size, size), PRIMARY if maskable else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if not maskable:
        # app tile
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=PRIMARY)
    # subtle gradient blob (decorative)
    blob_r = int(size * 0.42)
    d.ellipse([size - blob_r, -blob_r // 2, size + blob_r // 2, blob_r], fill=(255, 255, 255, 22))
    # letter L
    font = None
    for candidate in [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ]:
        if os.path.exists(candidate):
            font = ImageFont.truetype(candidate, int(size * 0.62))
            break
    if font is None:
        font = ImageFont.load_default()
    text = 'L'
    bbox = d.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1] - size * 0.02
    d.text((x, y), text, font=font, fill=WHITE)
    # small speech-dot accent
    r = size * 0.055
    cx, cy = size * 0.72, size * 0.72
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(56, 199, 155, 255))
    return img

for size in (192, 512):
    draw_icon(size).save(os.path.join(OUT, f'icon-{size}.png'))
    # maskable: content within 80% safe zone on solid background
    img = draw_icon(size, maskable=True)
    inner = draw_icon(int(size * 0.8), maskable=False)
    img.alpha_composite(inner, (int(size * 0.1), int(size * 0.1)))
    img.save(os.path.join(OUT, f'icon-{size}-maskable.png'))

draw_icon(64).save(os.path.join(OUT, 'favicon-64.png'))
print('icons written to', OUT)
