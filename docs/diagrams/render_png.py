#!/usr/bin/env python3
"""Render docs/diagrams/pmcopilot-architecture.png directly with Pillow.

Doesn't depend on Excalidraw — emits a clean modern PNG of the same
architecture (same boxes, brand badges, arrows, invariant cards).

Run:  python docs/diagrams/render_png.py
"""

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent / "pmcopilot-architecture.png"
W, H = 2600, 1900
BG = (255, 255, 255)

# Fonts (Segoe UI is a clean modern sans available on Windows; falls back
# to Arial on systems without it)
def f(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont:
    candidates = (
        ["C:\\Windows\\Fonts\\segoeuib.ttf"] if weight == "bold"
        else ["C:\\Windows\\Fonts\\segoeui.ttf"]
    ) + ["arial.ttf"]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img, "RGBA")


def box(x, y, w, h, fill, stroke=(30, 30, 30), stroke_w=2, radius=14):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius, fill=fill, outline=stroke, width=stroke_w)


def text(x, y, w, body, size=20, color=(30, 30, 30), align="center", weight="regular"):
    font = f(size, weight)
    lines = body.split("\n")
    cy = y
    for line in lines:
        bbox = d.textbbox((0, 0), line, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        if align == "center":
            tx = x + (w - tw) // 2
        elif align == "right":
            tx = x + w - tw
        else:
            tx = x
        d.text((tx, cy), line, fill=color, font=font)
        cy += int(th * 1.55)


def arrow(x1, y1, x2, y2, color=(30, 30, 30), w=3, style="solid"):
    if style == "dotted":
        # short dashes
        steps = max(int(((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 / 8), 1)
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
    # arrowhead
    head = 12
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    ax1 = x2 - head * math.cos(ang - math.pi / 6)
    ay1 = y2 - head * math.sin(ang - math.pi / 6)
    ax2 = x2 - head * math.cos(ang + math.pi / 6)
    ay2 = y2 - head * math.sin(ang + math.pi / 6)
    d.polygon([(x2, y2), (ax1, ay1), (ax2, ay2)], fill=color)


def badge(cx, cy, r, bg, letter, fg=(255, 255, 255)):
    """Brand badge — filled circle with centered letter."""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=bg, outline=None)
    font = f(int(r * 1.2), "bold")
    bbox = d.textbbox((0, 0), letter, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    # Pillow text baseline lands a bit low; offset by ~25% of height
    d.text((cx - tw // 2 - bbox[0], cy - th // 2 - bbox[1] - int(r * 0.05)), letter, fill=fg, font=font)


# ============== HEADER ==============
text(0, 30, W, "pmcopilot.wtf — architecture", size=48, weight="bold")
text(0, 95, W, "7 agents · 3 search backends · BYOK LLM · every claim cites a real source row, enforced in code",
     size=20, color=(110, 110, 110))


# ============== L1: USER ==============
box(1050, 180, 500, 90, (254, 243, 199))
text(1050, 196, 500, "1.   YOU\npaste a polymarket url   ·   ask a question",
     size=22, weight="bold")


# ============== L2: SUPERVISOR ==============
box(1050, 320, 500, 90, (219, 234, 254))
text(1050, 336, 500, "2.   SUPERVISOR\nsanitize title · resolve venue · fan out wave 1",
     size=22, weight="bold")


arrow(1300, 273, 1300, 318)


# ============== L3: WAVE 1 (5 agents) ==============
agent_W, agent_H, GAP = 380, 140, 50
total_w = 5 * agent_W + 4 * GAP
start_x = (W - total_w) // 2
agent_y = 480
agents = [
    ("(a)  MARKET",      "orderbook · imbalance ·\nliquidity depth · spread · 24h vol",  (199, 210, 254)),
    ("(b)  HOLDERS",     "top-5 wallets · concentration ·\nside-bias · ENS labels",      (221, 214, 254)),
    ("(c)  NEWS",        "self-healing chain\n3 backends × retry × 6 h cache",           (254, 249, 195)),
    ("(d)  SENTIMENT",   "vetted X handles · 14 d ·\ntwo-pass · URL provenance",         (209, 250, 229)),
    ("(e)  COMPARABLES", "no LLM · resolved markets ·\nthreshold-shape · Bayesian rate", (229, 231, 235)),
]
for i, (title_, body, fill) in enumerate(agents):
    x = start_x + i * (agent_W + GAP)
    box(x, agent_y, agent_W, agent_H, fill)
    text(x + 10, agent_y + 16, agent_W - 20, title_, size=22, weight="bold")
    text(x + 10, agent_y + 70, agent_W - 20, body, size=17)


# arrows from supervisor to each agent
for i in range(5):
    cx = start_x + i * (agent_W + GAP) + agent_W // 2
    arrow(1300, 412, cx, agent_y - 5)


# ============== L4: DATA SOURCES per-agent ==============
src_y = 670
src_H = 140
src_specs = [
    ("CLOB orderbook  +  Gamma meta",                            [("P", (156, 71, 255))]),
    ("Data API  /  holders endpoint",                            [("P", (156, 71, 255))]),
    ("Exa  →  PM comments  →  Provider Web",                     [("E", (79, 70, 229)), ("P", (156, 71, 255))]),
    ("Grok Live X-Search  ·  vetted handles",                    [("X", (0, 0, 0)), ("𝕏", (0, 0, 0))]),
    ("Gamma  resolved-market scan",                              [("P", (156, 71, 255))]),
]
for i, (label, logos) in enumerate(src_specs):
    x = start_x + i * (agent_W + GAP)
    box(x, src_y, agent_W, src_H, (249, 250, 251), stroke=(82, 82, 82), stroke_w=1)
    # logo row
    bsz = 30
    total_bw = len(logos) * bsz * 2 + (len(logos) - 1) * 14
    bx0 = x + (agent_W - total_bw) // 2
    for j, (letter, color) in enumerate(logos):
        bx = bx0 + j * (bsz * 2 + 14) + bsz
        by = src_y + 35
        badge(bx, by, bsz, color, letter)
    text(x + 10, src_y + 90, agent_W - 20, label, size=16, color=(55, 65, 81))
    # dotted arrow from agent to source
    cx = x + agent_W // 2
    arrow(cx, agent_y + agent_H + 5, cx, src_y - 5, color=(82, 82, 82), w=2, style="dotted")


# ============== L5: BYOK LLM BUS ==============
bus_y = 880
bus_H = 180
bus_x = start_x
bus_W = total_w
box(bus_x, bus_y, bus_W, bus_H, (224, 231, 255))
text(bus_x, bus_y + 18, bus_W, "PRIMARY LLM    ·    your key, your bill    ·    BYOK",
     size=24, weight="bold")

# 5 logos in the bus
llm_logos = [
    ("C", "Anthropic Claude",  (217, 119, 87)),
    ("G", "OpenAI ChatGPT",    (16, 163, 127)),
    ("G", "Google Gemini",     (26, 115, 232)),
    ("X", "xAI Grok",          (0, 0, 0)),
    ("P", "Perplexity Sonar",  (32, 128, 141)),
]
slot_w = bus_W // 5
for j, (letter, name, color) in enumerate(llm_logos):
    cx = bus_x + j * slot_w + slot_w // 2
    badge(cx, bus_y + 80, 32, color, letter)
    text(cx - 200, bus_y + 130, 400, name, size=18, color=color, weight="bold")

text(bus_x + 10, bus_y + bus_H - 28, bus_W - 20,
     "keys AES-GCM in IndexedDB  ·  sent per-request as headers  ·  never logged  ·  never persisted server-side",
     size=14, color=(110, 110, 110))

# arrow into bus
arrow((bus_x + bus_W // 2), src_y + src_H + 5, (bus_x + bus_W // 2), bus_y - 5)


# ============== L6: THESIS ==============
thesis_y = 1100
box(900, thesis_y, 800, 100, (251, 207, 232))
text(900, thesis_y + 12, 800, "(f)   THESIS    wave 2 — depends on wave 1",
     size=22, weight="bold")
text(900, thesis_y + 56, 800,
     "supports vs challenges  ·  direction score  ·  cites by id only",
     size=17)

arrow(1300, bus_y + bus_H + 5, 1300, thesis_y - 5)


# ============== L7: SYNTHESIS (highlighted) ==============
synth_y = 1240
box(750, synth_y, 1100, 150, (254, 215, 170), stroke=(217, 119, 6), stroke_w=4)
text(750, synth_y + 16, 1100, "(g)   SYNTHESIS — the brief writer",
     size=26, weight="bold", color=(124, 45, 18))
text(750, synth_y + 72, 1100,
     "can cite ONLY ids that exist in upstream evidence\ninvented citations are stripped server-side before render",
     size=18, color=(124, 45, 18))

arrow(1300, thesis_y + 105, 1300, synth_y - 5)


# ============== L8: BRIEF ==============
brief_y = 1440
box(1000, brief_y, 600, 100, (187, 247, 208))
text(1000, brief_y + 14, 600, "3.   GROUNDED BRIEF",
     size=24, weight="bold", color=(20, 83, 45))
text(1000, brief_y + 56, 600,
     "every claim is a clickable cite chip — to a real source row",
     size=17, color=(20, 83, 45))

arrow(1300, synth_y + 155, 1300, brief_y - 5)


# ============== L9: INVARIANTS (4 cards) ==============
inv_y = 1590
card_W = (total_w - 3 * 30) // 4
invariants = [
    ("NO FABRICATION",
     "Upstream agents build a citation registry\nfrom real tool output. The LLM only refer-\nences by index — invented IDs stripped\nbefore render. Sentiment URL provenance\nvia Grok's actual citations[] array."),
    ("SOURCE DENYLIST",
     "Wikipedia, Reddit, Substack, Medium,\nForbes contributor, Yahoo aggregator —\nblocked at agent boundary. Curated allow-\nlist surfaces trader-grade outlets only;\noff-list survivors flagged 'unverified'."),
    ("SELF-HEALING NEWS",
     "Exa retries 3× × 3 query variants × 429\nRetry-After. Falls through to Polymarket\ncomments → provider web. 6 h LRU cache\nhides transient failures behind prior\nsuccess. Honest diagnostic only when stuck."),
    ("RESOLVED MARKETS",
     "Sentiment + thesis SKIPPED — both produce\ntheir worst hallucinations when there's no\nreal-time data to ground in. News searches\nthe leadup window (30 d before resolution),\nnot 'right now'."),
]
for i, (head, body) in enumerate(invariants):
    x = start_x + i * (card_W + 30)
    box(x, inv_y, card_W, 160, (255, 255, 255), stroke=(30, 30, 30), stroke_w=1)
    text(x + 14, inv_y + 14, card_W - 28, head, size=18, weight="bold", align="left")
    text(x + 14, inv_y + 50, card_W - 28, body, size=14, color=(55, 65, 81), align="left")


# ============== FOOTER ==============
text(0, H - 50, W, "pmcopilot.wtf   ·   github.com/Torque44/pm-copilot-oss",
     size=16, color=(150, 150, 150))


# ---- save ----
img.save(OUT, "PNG", optimize=True)
print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB, {W}×{H})")
