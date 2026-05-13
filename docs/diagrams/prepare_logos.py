#!/usr/bin/env python3
"""One-shot: pull raw brand logos from ~/Downloads, normalise to 256x256
PNG on transparent canvas, save into docs/diagrams/logos/.

Run once, then build.py and render_png.py both read from logos/.

Sources (all user-supplied, in ~/Downloads):
  openai.svg            -> openai.png            (resvg)
  xai.webp              -> xai.png               (PIL)
  exa logo.jpg          -> exa.png               (PIL, crop mark only)
  polymarket logo.png   -> polymarket.png        (PIL)
  gemini logo.jpg       -> gemini.png            (PIL)

Two we draw inline (no asset available):
  anthropic.png         -> orange asterisk on white
  perplexity.png        -> teal triskele on white
  x.png                 -> black 𝕏 on white  (for X / Twitter source)
"""

from __future__ import annotations
import base64
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import resvg_py

HERE = Path(__file__).resolve().parent
OUT = HERE / "logos"
OUT.mkdir(parents=True, exist_ok=True)
DL = Path("C:/Users/ayush/Downloads")
SIZE = 256


def fit_square(img: Image.Image, bg=(255, 255, 255, 0)) -> Image.Image:
    """Pad+resize to SIZE x SIZE on transparent canvas, preserving aspect."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    s = max(w, h)
    canvas = Image.new("RGBA", (s, s), bg)
    canvas.paste(img, ((s - w) // 2, (s - h) // 2), img)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def crop_to_mark(img: Image.Image) -> Image.Image:
    """For wordmark-containing logos: auto-find the bounding box of
    the leftmost non-white connected blob and crop to it (square)."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    W, H = rgba.size
    # find leftmost non-white pixel column
    left = None
    for x in range(W):
        for y in range(H):
            r, g, b, a = px[x, y]
            if not (r > 240 and g > 240 and b > 240):
                left = x
                break
        if left is not None:
            break
    if left is None:
        return rgba
    # find where the first "gap" of white columns begins (>10px wide) after the mark
    gap_start = None
    in_gap = 0
    for x in range(left, W):
        # is this column "mostly white"?
        all_white = True
        for y in range(H):
            r, g, b, a = px[x, y]
            if not (r > 240 and g > 240 and b > 240):
                all_white = False
                break
        if all_white:
            in_gap += 1
            if in_gap >= 15 and gap_start is None:
                gap_start = x - in_gap + 1
                break
        else:
            in_gap = 0
    right = gap_start if gap_start else min(left + H, W)
    return rgba.crop((max(left - 8, 0), 0, right, H))


# 1) openai.svg -> openai.png  (resvg)
png_bytes = bytes(resvg_py.svg_to_bytes(svg_path=str(DL / "openai.svg")))
img = Image.open(BytesIO(png_bytes))
fit_square(img).save(OUT / "openai.png", "PNG")

# 2) xai.webp -> xai.png
img = Image.open(DL / "xai.webp")
fit_square(img).save(OUT / "xai.png", "PNG")

# 3) exa logo.jpg -> exa.png  (crop tight bbox of the mark, drop wordmark)
img = Image.open(DL / "exa logo.jpg").convert("RGBA")
img = crop_to_mark(img)
# strip white background, keep blue
px = img.load()
W, H = img.size
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if r > 240 and g > 240 and b > 240:
            px[x, y] = (255, 255, 255, 0)
fit_square(img).save(OUT / "exa.png", "PNG")

# 4) polymarket logo.png -> polymarket.png
img = Image.open(DL / "polymarket logo.png")
fit_square(img).save(OUT / "polymarket.png", "PNG")

# 5) gemini logo.jpg -> gemini.png
img = Image.open(DL / "gemini logo.jpg").convert("RGBA")
px = img.load()
W, H = img.size
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if r > 240 and g > 240 and b > 240:
            px[x, y] = (255, 255, 255, 0)
fit_square(img).save(OUT / "gemini.png", "PNG")

# 6) anthropic.png  — official Anthropic "A" mark (slanted asymmetric A in
#    house orange).  Path copied from the Anthropic press kit SVG.
anthropic_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="white"/>
  <path fill="#cc785c" d="M147.46 51.2H110.6L172.5 204.8h36.86L147.46 51.2Zm-83.2 0L2.36 204.8H40.6l12.66-32.84h64.7L130.62 204.8h38.24L106.96 51.2H64.26ZM64.86 138.7l21.34-55.3 21.34 55.3H64.86Z"/>
</svg>"""
png_bytes = bytes(resvg_py.svg_to_bytes(svg_string=anthropic_svg))
img = Image.open(BytesIO(png_bytes))
fit_square(img).save(OUT / "anthropic.png", "PNG")

# 7) perplexity.png  — Perplexity's official mark: black square with a
#    white hexagonal-hourglass frame, vertical bisector, and inner star.
perplexity_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="black"/>
  <g fill="none" stroke="white" stroke-width="9" stroke-linecap="square" stroke-linejoin="miter">
    <!-- outer hexagonal-hourglass frame (top trapezoid + bottom trapezoid) -->
    <path d="M 60 54 L 196 54 L 162 128 L 196 202 L 60 202 L 94 128 Z"/>
    <!-- vertical center line, extends past frame top/bottom -->
    <line x1="128" y1="24" x2="128" y2="232"/>
    <!-- mid horizontal pinch -->
    <line x1="94"  y1="128" x2="162" y2="128"/>
    <!-- inner X (diagonals through pinch) -->
    <line x1="78"  y1="78"  x2="178" y2="178"/>
    <line x1="178" y1="78"  x2="78"  y2="178"/>
  </g>
</svg>"""
png_bytes = bytes(resvg_py.svg_to_bytes(svg_string=perplexity_svg))
img = Image.open(BytesIO(png_bytes))
fit_square(img).save(OUT / "perplexity.png", "PNG")

# 8) x.png  — the 𝕏 mark for X/Twitter
x_svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="white"/>
  <path fill="black" d="M71.5 16 L82 16 L60.2 41.1 L86 84 L65.7 84 L49.8 63.1 L31.6 84 L21.1 84 L44.4 57.2 L19.7 16 L40.6 16 L55.0 35.1 Z M67.9 78.5 L73.7 78.5 L37.4 21 L31.2 21 Z"/>
</svg>"""
png_bytes = bytes(resvg_py.svg_to_bytes(svg_string=x_svg))
img = Image.open(BytesIO(png_bytes))
fit_square(img).save(OUT / "x.png", "PNG")


print(f"wrote {len(list(OUT.glob('*.png')))} logos to {OUT}")
for p in sorted(OUT.glob("*.png")):
    print(f"  {p.name:20s} {p.stat().st_size // 1024} KB")
