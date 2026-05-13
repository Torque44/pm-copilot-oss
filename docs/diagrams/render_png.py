#!/usr/bin/env python3
"""Render docs/diagrams/pmcopilot-architecture.png with Pillow.

Clean, professional layout — inspired by Stripe / Vercel / Cloudflare
architecture diagrams.  No handwriting font, tight grid spacing, pastel
fills, real brand logos from logos/.

Run:  python docs/diagrams/render_png.py
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "pmcopilot-architecture.png"
LOGOS = HERE / "logos"
W, H = 2400, 1690
BG = (255, 255, 255)


# Two font tracks:
#   - hand: Excalifont-like script (Segoe Script / Segoe Print) for the
#     heading + body, to match Excalidraw's default font
#   - sans: clean Segoe UI fallback for tiny labels / footnotes where
#     handwriting becomes hard to read
def hand(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    bold = weight == "bold"
    candidates = [
        # Bundled Excalifont if present, then Segoe Script (cursive)
        # then Segoe Print, then Comic Sans, then fall back to sans.
        "C:\\Windows\\Fonts\\Excalifont-Regular.woff2",
        "C:\\Windows\\Fonts\\segoesc.ttf",
        "C:\\Windows\\Fonts\\segoepr.ttf",
        "C:\\Windows\\Fonts\\comicbd.ttf" if bold else "C:\\Windows\\Fonts\\comic.ttf",
        "C:\\Windows\\Fonts\\segoeuib.ttf" if bold else "C:\\Windows\\Fonts\\segoeui.ttf",
        "arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def f(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    # All text in the diagram uses the handwriting track now.
    return hand(size, weight)


img = Image.new("RGBA", (W, H), BG + (255,))
d = ImageDraw.Draw(img, "RGBA")


# ----- primitives -------------------------------------------------------
def box(x, y, w, h, fill, stroke=(40, 40, 40), stroke_w=2, radius=12):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius,
                        fill=fill, outline=stroke, width=stroke_w)


def text(x, y, w, body, size=18, color=(40, 40, 40), align="center", weight="regular", line_h=1.45):
    font = f(size, weight)
    for line in body.split("\n"):
        bbox = d.textbbox((0, 0), line, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if align == "center":
            tx = x + (w - tw) // 2
        elif align == "right":
            tx = x + w - tw
        else:
            tx = x
        d.text((tx, y), line, fill=color, font=font)
        y += int(th * line_h)


def arrow(x1, y1, x2, y2, color=(40, 40, 40), w=3, style="solid"):
    import math
    if style == "dotted":
        steps = max(int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 / 10), 1)
        for i in range(0, steps, 2):
            t1 = i / steps
            t2 = min((i + 1) / steps, 1)
            d.line(
                [(x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1),
                 (x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2)],
                fill=color, width=w,
            )
    else:
        d.line([(x1, y1), (x2, y2)], fill=color, width=w)
    head = 11
    ang = math.atan2(y2 - y1, x2 - x1)
    ax1 = x2 - head * math.cos(ang - math.pi / 6)
    ay1 = y2 - head * math.sin(ang - math.pi / 6)
    ax2 = x2 - head * math.cos(ang + math.pi / 6)
    ay2 = y2 - head * math.sin(ang + math.pi / 6)
    d.polygon([(x2, y2), (ax1, ay1), (ax2, ay2)], fill=color)


_logo_cache: dict[str, Image.Image] = {}
def logo(name: str) -> Image.Image:
    if name not in _logo_cache:
        _logo_cache[name] = Image.open(LOGOS / f"{name}.png").convert("RGBA")
    return _logo_cache[name]

def paste_logo(name: str, cx: int, cy: int, target_size: int):
    im = logo(name).resize((target_size, target_size), Image.LANCZOS)
    img.paste(im, (cx - target_size // 2, cy - target_size // 2), im)


# ----- grid -------------------------------------------------------------
AGENT_W = 360
GAP = 24
total_w = 5 * AGENT_W + 4 * GAP    # 1896
start_x = (W - total_w) // 2       # 252
center_x = W // 2                  # 1200


# ============== HEADER ==============
# Small label "how it works" + big brand "pmcopilot.wtf" below.
# Generous gaps between heading rows.
text(0, 24, W, "how it works", size=28, color=(110, 110, 110))
text(0, 82, W, "pmcopilot.wtf", size=72, weight="bold")
text(0, 192, W,
     "7 agents · 3 search backends · BYOK LLM · every claim cites a real source row, enforced in code",
     size=18, color=(110, 110, 110))


# ============== L1: USER ==============
y = 250
box(center_x - 240, y, 480, 76, (254, 243, 199))
text(center_x - 240, y + 12, 480, "1.  You", size=22, weight="bold")
text(center_x - 240, y + 44, 480, "Paste a Polymarket URL  ·  Ask a question", size=16)


# ============== L2: SUPERVISOR ==============
arrow(center_x, 326 + 2, center_x, 352 + 2, w=3)
y = 354
box(center_x - 240, y, 480, 76, (219, 234, 254))
text(center_x - 240, y + 12, 480, "2.  Supervisor", size=22, weight="bold")
text(center_x - 240, y + 44, 480, "Sanitize title  ·  Resolve venue  ·  Fan out wave 1", size=16)


# ============== L3: WAVE 1 (5 agents) ==============
agent_y = 472
agent_H = 132
agents = [
    ("(a)  Market",      "Orderbook · imbalance ·\nliquidity depth · spread · 24h vol",  (199, 210, 254)),
    ("(b)  Holders",     "Top-5 wallets · concentration ·\nside-bias · ENS labels",      (221, 214, 254)),
    ("(c)  News",        "Self-healing chain\n3 backends × retry × 6h cache",            (254, 249, 195)),
    ("(d)  Sentiment",   "Vetted X handles · 14d ·\ntwo-pass · URL provenance",          (209, 250, 229)),
    ("(e)  Comparables", "No LLM · resolved markets ·\nthreshold-shape · Bayesian rate", (229, 231, 235)),
]
for i, (title_, body, fill) in enumerate(agents):
    x = start_x + i * (AGENT_W + GAP)
    box(x, agent_y, AGENT_W, agent_H, fill)
    text(x + 12, agent_y + 14, AGENT_W - 24, title_, size=21, weight="bold", align="left")
    text(x + 12, agent_y + 54, AGENT_W - 24, body, size=15, align="left")
    # arrow from supervisor → agent
    cx = x + AGENT_W // 2
    arrow(center_x, 430 + 2, cx, agent_y - 4, w=2)


# ============== L4: DATA SOURCES per-agent (real logos) ==============
src_y = 628
src_H = 120
src_specs = [
    ("CLOB orderbook  +  Gamma meta",                  ["polymarket"]),
    ("Data API  ·  holders endpoint",                  ["polymarket"]),
    ("Exa  →  PM comments  →  Provider Web",           ["exa", "polymarket"]),
    ("Grok Live X-Search  ·  vetted handles",          ["xai", "x"]),
    ("Gamma  ·  resolved-market scan",                 ["polymarket"]),
]
for i, (label, names) in enumerate(src_specs):
    x = start_x + i * (AGENT_W + GAP)
    box(x, src_y, AGENT_W, src_H, (250, 250, 252), stroke=(170, 170, 180), stroke_w=1, radius=10)
    sz = 48
    gap = 14
    total_lw = len(names) * sz + (len(names) - 1) * gap
    lx = x + (AGENT_W - total_lw) // 2 + sz // 2
    for j, name in enumerate(names):
        paste_logo(name, lx + j * (sz + gap), src_y + 36, sz)
    text(x + 12, src_y + 78, AGENT_W - 24, label, size=15, color=(70, 80, 100))
    # dotted connector agent → source
    cx = x + AGENT_W // 2
    arrow(cx, agent_y + agent_H + 2, cx, src_y - 2, color=(120, 120, 130), w=2, style="dotted")


# ============== L5: BYOK LLM BUS — all 5 in one tight row ==============
bus_y = 778
bus_H = 152
box(start_x, bus_y, total_w, bus_H, (224, 231, 255))

# Title
text(start_x, bus_y + 14, total_w,
     "Primary LLM  ·  BYOK (your key, your bill)",
     size=22, weight="bold")

# 5 logos in a single row, evenly spaced
llm = [
    ("openai",     "ChatGPT",    "default", (16, 138, 114)),
    ("anthropic",  "Claude",     "byok",    (204, 120, 92)),
    ("gemini",     "Gemini",     "byok",    (26, 115, 232)),
    ("xai",        "Grok",       "byok",    (0, 0, 0)),
    ("perplexity", "Sonar",      "byok",    (32, 128, 141)),
]
logo_sz = 56
slot_w = total_w // 5
for j, (name, label, tag, color) in enumerate(llm):
    cx = start_x + j * slot_w + slot_w // 2
    paste_logo(name, cx, bus_y + 78, logo_sz)
    text(cx - 100, bus_y + 110, 200, label, size=16, color=color, weight="bold")
    tag_color = (16, 138, 114) if tag == "default" else (130, 130, 140)
    text(cx - 80, bus_y + 130, 160, tag, size=12, color=tag_color)

# central arrow into bus
arrow(center_x, src_y + src_H + 2, center_x, bus_y - 2, w=3)


# ============== L6: THESIS ==============
arrow(center_x, bus_y + bus_H + 2, center_x, 958, w=3)
thesis_y = 960
box(center_x - 380, thesis_y, 760, 80, (251, 207, 232))
text(center_x - 380, thesis_y + 10, 760, "(f)  Thesis     —     Wave 2", size=22, weight="bold")
text(center_x - 380, thesis_y + 44, 760,
     "Supports vs challenges  ·  direction score  ·  cites by id only",
     size=16)


# ============== L7: SYNTHESIS (highlighted) ==============
arrow(center_x, thesis_y + 80 + 2, center_x, 1068, w=3)
synth_y = 1070
box(center_x - 520, synth_y, 1040, 110, (254, 215, 170), stroke=(217, 119, 6), stroke_w=3)
text(center_x - 520, synth_y + 14, 1040,
     "(g)  Synthesis  —  the brief writer",
     size=24, weight="bold", color=(124, 45, 18))
text(center_x - 520, synth_y + 56, 1040,
     "Can cite ONLY ids that exist in upstream evidence  ·  invented citations stripped server-side",
     size=15, color=(124, 45, 18))


# ============== L8: BRIEF ==============
arrow(center_x, synth_y + 110 + 2, center_x, 1208, w=3)
brief_y = 1210
box(center_x - 320, brief_y, 640, 80, (187, 247, 208))
text(center_x - 320, brief_y + 10, 640, "3.  Grounded Brief", size=22, weight="bold", color=(20, 83, 45))
text(center_x - 320, brief_y + 44, 640,
     "Every claim is a clickable cite chip — back to a real source row",
     size=16, color=(20, 83, 45))


# ============== L9: INVARIANTS (4 cards) ==============
inv_y = 1330
card_W = (total_w - 3 * 24) // 4
invariants = [
    ("No fabrication",
     "Upstream agents build a citation registry from real\ntool output. The LLM only references by index —\ninvented ids stripped before render."),
    ("Source denylist",
     "Wikipedia, Reddit, Substack, Medium, Forbes\ncontributor blocked at agent boundary. Curated\nallowlist surfaces trader-grade outlets only."),
    ("Self-healing news",
     "Exa retries 3× × 3 query variants × 429 Retry-After.\nFalls through to PM comments → provider web.\n6h LRU cache hides transient failures."),
    ("Resolved markets",
     "Sentiment + thesis SKIPPED — both produce their\nworst hallucinations without real-time data. News\nsearches 30d before resolution."),
]
for i, (head, body) in enumerate(invariants):
    x = start_x + i * (card_W + 24)
    box(x, inv_y, card_W, 158, (252, 252, 253), stroke=(170, 170, 180), stroke_w=1, radius=10)
    text(x + 16, inv_y + 14, card_W - 32, head, size=18, weight="bold", align="left")
    text(x + 16, inv_y + 50, card_W - 32, body, size=14, color=(70, 80, 100), align="left", line_h=1.55)


# ============== FOOTER ==============
text(0, H - 40, W,
     "github.com/Torque44/pm-copilot-oss",
     size=14, color=(150, 150, 150))


img.convert("RGB").save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB, {W}×{H})")
