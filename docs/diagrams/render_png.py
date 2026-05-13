#!/usr/bin/env python3
"""Render docs/diagrams/pmcopilot-architecture.png directly with Pillow.

Doesn't depend on Excalidraw — emits a clean PNG of the same
architecture (same boxes, REAL brand logos from logos/, arrows,
invariant cards).  Hand-drawn / playful aesthetic to match the
'how pm-copilot works' sketch.

Run:  python docs/diagrams/render_png.py
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "pmcopilot-architecture.png"
LOGOS = HERE / "logos"
W, H = 2600, 1920
BG = (250, 248, 243)        # warm cream — matches hand-drawn vibe


# ----- font loader ------------------------------------------------------
# Excalidraw / lowercase hand-drawn aesthetic. We try Comic Sans first
# (closest to "playful sketch" widely installed on Windows), then fall
# back to clean modern sans.
def f(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    bold = weight == "bold"
    # Comic Sans gives the "kid's-sketchbook" feel; Segoe Print is even
    # closer to handwritten if available; otherwise Segoe UI.
    candidates = (
        ["C:\\Windows\\Fonts\\segoesc.ttf",   # Segoe Script (cursive)
         "C:\\Windows\\Fonts\\segoepr.ttf",   # Segoe Print
         "C:\\Windows\\Fonts\\comicbd.ttf" if bold else "C:\\Windows\\Fonts\\comic.ttf",
         "C:\\Windows\\Fonts\\segoeuib.ttf" if bold else "C:\\Windows\\Fonts\\segoeui.ttf",
         "arial.ttf"]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


img = Image.new("RGBA", (W, H), BG + (255,))
d = ImageDraw.Draw(img, "RGBA")


# ----- primitives -------------------------------------------------------
def box(x, y, w, h, fill, stroke=(30, 30, 30), stroke_w=3, radius=18):
    """Hand-drawn-ish rounded rectangle: slight double-stroke offset to
    fake the wobble of an Excalidraw sketch."""
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=stroke, width=stroke_w)
    # subtle inner shadow line (handdrawn look — second pass slightly offset)
    d.rounded_rectangle([x + 2, y + 1, x + w + 1, y + h + 1], radius=radius, outline=stroke + (40,) if len(stroke) == 3 else stroke, width=1)


def text(x, y, w, body, size=20, color=(30, 30, 30), align="center", weight="regular"):
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
        y += int(th * 1.55)


def arrow(x1, y1, x2, y2, color=(30, 30, 30), w=3, style="solid"):
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
    head = 14
    ang = math.atan2(y2 - y1, x2 - x1)
    ax1 = x2 - head * math.cos(ang - math.pi / 6)
    ay1 = y2 - head * math.sin(ang - math.pi / 6)
    ax2 = x2 - head * math.cos(ang + math.pi / 6)
    ay2 = y2 - head * math.sin(ang + math.pi / 6)
    d.polygon([(x2, y2), (ax1, ay1), (ax2, ay2)], fill=color)


# logo cache
_logo_cache: dict[str, Image.Image] = {}
def logo(name: str) -> Image.Image:
    if name not in _logo_cache:
        _logo_cache[name] = Image.open(LOGOS / f"{name}.png").convert("RGBA")
    return _logo_cache[name]

def paste_logo(name: str, cx: int, cy: int, target_size: int):
    """Paste logo PNG centered at (cx,cy) at target_size px."""
    im = logo(name)
    im = im.resize((target_size, target_size), Image.LANCZOS)
    img.paste(im, (cx - target_size // 2, cy - target_size // 2), im)


# ============== HEADER ==============
text(0, 35, W, "how pmcopilot.wtf works", size=58, weight="bold")
text(0, 115, W,
     "7 agents  ·  3 search backends  ·  byok llm  ·  every claim cites a real source row, enforced in code",
     size=22, color=(110, 110, 110))


# ============== L1: USER ==============
box(1050, 200, 500, 95, (254, 243, 199))
text(1050, 218, 500, "1.   you", size=26, weight="bold")
text(1050, 257, 500, "paste a polymarket url   ·   ask a question", size=20)


# ============== L2: SUPERVISOR ==============
box(1050, 340, 500, 95, (219, 234, 254))
text(1050, 358, 500, "2.   supervisor", size=26, weight="bold")
text(1050, 397, 500, "sanitize title  ·  resolve venue  ·  fan out wave 1", size=20)


arrow(1300, 297, 1300, 338, w=4)


# ============== L3: WAVE 1 (5 agents) ==============
agent_W, agent_H, GAP = 380, 150, 50
total_w = 5 * agent_W + 4 * GAP
start_x = (W - total_w) // 2
agent_y = 510
agents = [
    ("(a)  market",      "orderbook · imbalance ·\nliquidity depth · spread · 24h vol",  (199, 210, 254)),
    ("(b)  holders",     "top-5 wallets · concentration ·\nside-bias · ens labels",      (221, 214, 254)),
    ("(c)  news",        "self-healing chain\n3 backends × retry × 6h cache",            (254, 249, 195)),
    ("(d)  sentiment",   "vetted x handles · 14d ·\ntwo-pass · url provenance",          (209, 250, 229)),
    ("(e)  comparables", "no llm · resolved markets ·\nthreshold-shape · bayesian rate", (229, 231, 235)),
]
for i, (title_, body, fill) in enumerate(agents):
    x = start_x + i * (agent_W + GAP)
    box(x, agent_y, agent_W, agent_H, fill)
    text(x + 10, agent_y + 18, agent_W - 20, title_, size=24, weight="bold")
    text(x + 10, agent_y + 75, agent_W - 20, body, size=18)


# arrows from supervisor to each agent
for i in range(5):
    cx = start_x + i * (agent_W + GAP) + agent_W // 2
    arrow(1300, 437, cx, agent_y - 5, w=3)


# ============== L4: DATA SOURCES per-agent (real logos) ==============
src_y = 700
src_H = 145
src_specs = [
    ("clob orderbook  +  gamma meta",                          ["polymarket"]),
    ("data api  ·  holders endpoint",                          ["polymarket"]),
    ("exa  →  pm comments  →  provider web",                   ["exa", "polymarket"]),
    ("grok live x-search  ·  vetted handles",                  ["xai", "x"]),
    ("gamma  ·  resolved-market scan",                         ["polymarket"]),
]
for i, (label, logo_names) in enumerate(src_specs):
    x = start_x + i * (agent_W + GAP)
    box(x, src_y, agent_W, src_H, (249, 250, 251), stroke=(82, 82, 82), stroke_w=2)
    # paste real logos centered horizontally
    sz = 60
    gap = 18
    total_lw = len(logo_names) * sz + (len(logo_names) - 1) * gap
    lx = x + (agent_W - total_lw) // 2 + sz // 2
    for j, name in enumerate(logo_names):
        paste_logo(name, lx + j * (sz + gap), src_y + 42, sz)
    text(x + 10, src_y + 95, agent_W - 20, label, size=17, color=(55, 65, 81))
    # dotted arrow from agent → source
    cx = x + agent_W // 2
    arrow(cx, agent_y + agent_H + 5, cx, src_y - 5, color=(82, 82, 82), w=2, style="dotted")


# ============== L5: BYOK LLM BUS ==============
# OpenAI is the active shipping provider; the rest are BYOK-only.
bus_y = 905
bus_H = 220
bus_x = start_x
bus_W = total_w
box(bus_x, bus_y, bus_W, bus_H, (224, 231, 255))
text(bus_x, bus_y + 18, bus_W, "primary llm    ·    currently shipping with openai",
     size=28, weight="bold")

# --- left half: big OpenAI logo (the active default) ---
left_cx = bus_x + 310
paste_logo("openai", left_cx, bus_y + 110, 110)
text(left_cx - 240, bus_y + 178, 480, "openai chatgpt   ·   default",
     size=20, color=(13, 138, 114), weight="bold")

# vertical divider
import math
for yy in range(bus_y + 65, bus_y + 180, 9):
    d.line([(bus_x + 640, yy), (bus_x + 640, yy + 5)], fill=(160, 160, 180), width=2)

# --- right half: BYOK label + 4 smaller logos in a row ---
right_x0 = bus_x + 685
right_W = bus_W - (right_x0 - bus_x) - 30
text(right_x0, bus_y + 65, right_W,
     "also works with your own key — bring any of these:",
     size=20, color=(55, 65, 81), align="left", weight="bold")

byok_logos = [
    ("anthropic",  "anthropic claude",  (204, 120, 92)),
    ("gemini",     "google gemini",     (26, 115, 232)),
    ("xai",        "xai grok",          (0, 0, 0)),
    ("perplexity", "perplexity sonar",  (32, 128, 141)),
]
slot_w = right_W // 4
for j, (name, label, color) in enumerate(byok_logos):
    cx = right_x0 + j * slot_w + slot_w // 2
    paste_logo(name, cx, bus_y + 122, 64)
    text(cx - 180, bus_y + 178, 360, label, size=16, color=color, weight="bold")

text(bus_x + 10, bus_y + bus_H - 32, bus_W - 20,
     "keys aes-gcm in indexeddb  ·  sent per-request as headers  ·  never logged  ·  never persisted server-side",
     size=16, color=(110, 110, 110))

# arrow into bus from sources
arrow((bus_x + bus_W // 2), src_y + src_H + 5, (bus_x + bus_W // 2), bus_y - 5, w=4)


# ============== L6: THESIS ==============
thesis_y = 1165
box(900, thesis_y, 800, 110, (251, 207, 232))
text(900, thesis_y + 14, 800, "(f)   thesis      wave 2 — depends on wave 1",
     size=24, weight="bold")
text(900, thesis_y + 60, 800,
     "supports vs challenges  ·  direction score  ·  cites by id only",
     size=18)

arrow(1300, bus_y + bus_H + 5, 1300, thesis_y - 5, w=4)


# ============== L7: SYNTHESIS (highlighted) ==============
synth_y = 1315
box(750, synth_y, 1100, 160, (254, 215, 170), stroke=(217, 119, 6), stroke_w=5)
text(750, synth_y + 20, 1100, "(g)   synthesis  —  the brief writer",
     size=30, weight="bold", color=(124, 45, 18))
text(750, synth_y + 80, 1100,
     "can cite ONLY ids that exist in upstream evidence\ninvented citations stripped server-side before render",
     size=20, color=(124, 45, 18))

arrow(1300, thesis_y + 115, 1300, synth_y - 5, w=4)


# ============== L8: BRIEF ==============
brief_y = 1520
box(1000, brief_y, 600, 105, (187, 247, 208))
text(1000, brief_y + 16, 600, "3.   grounded brief",
     size=26, weight="bold", color=(20, 83, 45))
text(1000, brief_y + 60, 600,
     "every claim is a clickable cite chip — to a real source row",
     size=18, color=(20, 83, 45))

arrow(1300, synth_y + 165, 1300, brief_y - 5, w=4)


# ============== L9: INVARIANTS (4 cards) ==============
inv_y = 1675
card_W = (total_w - 3 * 30) // 4
invariants = [
    ("🚫  no fabrication",
     "upstream agents build a citation\nregistry from real tool output.\nthe llm only references by index —\ninvented ids stripped before render."),
    ("📰  source denylist",
     "wikipedia, reddit, substack,\nmedium, forbes contributor blocked\nat agent boundary. curated allowlist\nsurfaces trader-grade outlets only."),
    ("♻️  self-healing news",
     "exa retries 3× × 3 query variants ×\n429 retry-after. falls through to\npm comments → provider web. 6h lru\ncache hides transient failures."),
    ("✅  resolved markets",
     "sentiment + thesis SKIPPED — both\nproduce their worst hallucinations\nwithout real-time data. news\nsearches 30d before resolution."),
]
for i, (head, body) in enumerate(invariants):
    x = start_x + i * (card_W + 30)
    box(x, inv_y, card_W, 175, (255, 255, 255), stroke=(30, 30, 30), stroke_w=2)
    text(x + 16, inv_y + 14, card_W - 32, head, size=19, weight="bold", align="left")
    text(x + 16, inv_y + 56, card_W - 32, body, size=15, color=(55, 65, 81), align="left")


# ============== FOOTER ==============
text(0, H - 50, W, "pmcopilot.wtf   ·   github.com/Torque44/pm-copilot-oss",
     size=18, color=(150, 150, 150))


# ---- save ----
img.convert("RGB").save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB, {W}×{H})")
