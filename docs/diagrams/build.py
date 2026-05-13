#!/usr/bin/env python3
"""Generate the pmcopilot.wtf Excalidraw architecture diagram.

Run:   python docs/diagrams/build.py

Writes pmcopilot-architecture.excalidraw alongside this script with the
REAL vendor logos (from docs/diagrams/logos/*.png, prepared once by
prepare_logos.py) embedded as base64 data URLs so the file is fully
self-contained — no external image fetches when opened at excalidraw.com.

Aesthetic: hand-drawn (Excalifont, roughness 2, lowercase, pastel
fills) — match the playful look of the original 'how pm-copilot works'
sketch.
"""

from __future__ import annotations
import base64
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "pmcopilot-architecture.excalidraw"
LOGOS_DIR = HERE / "logos"
NOW_MS = int(time.time() * 1000)


def png_data_url(path: Path) -> str:
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


# logo id  ->  filename in logos/
LOGOS = {
    "logo-anthropic":  "anthropic.png",
    "logo-openai":     "openai.png",
    "logo-google":     "gemini.png",
    "logo-xai":        "xai.png",
    "logo-perplexity": "perplexity.png",
    "logo-exa":        "exa.png",
    "logo-polymarket": "polymarket.png",
    "logo-x":          "x.png",
}

files: dict = {}
for lid, fname in LOGOS.items():
    files[lid] = {
        "mimeType": "image/png",
        "id": lid,
        "dataURL": png_data_url(LOGOS_DIR / fname),
        "created": NOW_MS,
        "lastRetrieved": NOW_MS,
    }


# ---- element factories -------------------------------------------------

_seed = [200_000]
def nid() -> str:
    _seed[0] += 1
    return f"el-{_seed[0]}"

def seed() -> int:
    _seed[0] += 1
    return _seed[0]

def rect(x, y, w, h, fill, stroke="#1e1e1e", stroke_w=2, rad=3, roughness=2, _id=None):
    return {
        "type": "rectangle",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False,
        "id": _id or nid(),
        "fillStyle": "solid",
        "strokeWidth": stroke_w, "strokeStyle": "solid",
        "roughness": roughness, "opacity": 100, "angle": 0,
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": stroke, "backgroundColor": fill,
        "seed": seed(), "groupIds": [], "frameId": None,
        "roundness": {"type": rad} if rad else None,
        "boundElements": [], "updated": NOW_MS,
        "link": None, "locked": False,
    }

def text(x, y, w, h, body, size=20, color="#1e1e1e", align="center"):
    return {
        "type": "text",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False, "id": nid(),
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100, "angle": 0,
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": color, "backgroundColor": "transparent",
        "seed": seed(), "groupIds": [], "frameId": None,
        "roundness": None, "boundElements": [], "updated": NOW_MS,
        "link": None, "locked": False,
        "fontSize": size, "fontFamily": 5,      # 5 = Excalifont (hand-drawn)
        "text": body, "textAlign": align, "verticalAlign": "top",
        "containerId": None, "originalText": body,
        "lineHeight": 1.25, "baseline": int(size * 0.9),
    }

def arrow(x1, y1, x2, y2, stroke="#1e1e1e", stroke_w=2, style="solid", roughness=2):
    return {
        "type": "arrow",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False, "id": nid(),
        "fillStyle": "solid", "strokeWidth": stroke_w, "strokeStyle": style,
        "roughness": roughness, "opacity": 100, "angle": 0,
        "x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1,
        "strokeColor": stroke, "backgroundColor": "transparent",
        "seed": seed(), "groupIds": [], "frameId": None,
        "roundness": {"type": 2}, "boundElements": [], "updated": NOW_MS,
        "link": None, "locked": False,
        "startBinding": None, "endBinding": None,
        "lastCommittedPoint": None,
        "startArrowhead": None, "endArrowhead": "arrow",
        "points": [[0, 0], [x2 - x1, y2 - y1]],
        "elbowed": False,
    }

def image(x, y, size, file_id):
    return {
        "type": "image",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False, "id": nid(),
        "fillStyle": "solid", "strokeWidth": 0, "strokeStyle": "solid",
        "roughness": 0, "opacity": 100, "angle": 0,
        "x": x, "y": y, "width": size, "height": size,
        "strokeColor": "transparent", "backgroundColor": "transparent",
        "seed": seed(), "groupIds": [], "frameId": None,
        "roundness": None, "boundElements": [], "updated": NOW_MS,
        "link": None, "locked": False,
        "status": "saved", "fileId": file_id, "scale": [1, 1],
    }


# ---- layout ------------------------------------------------------------
# canvas ~ 2600 × 1900.   lowercase text throughout — playful sketch vibe.

elements: list = []

# Title
elements.append(text(700, 30, 1200, 70, "how pmcopilot.wtf works", size=52))
elements.append(text(500, 105, 1600, 30, "7 agents  ·  3 search backends  ·  byok llm  ·  every claim cites a real source row, enforced in code",
                     size=20, color="#666666"))

# ── L1: USER ─────────────────────────────────────────────────────────
elements.append(rect(1050, 195, 500, 95, "#fef3c7"))
elements.append(text(1060, 220, 480, 60, "1.  you\npaste a polymarket url  ·  ask a question", size=22))

# ── L2: SUPERVISOR ───────────────────────────────────────────────────
elements.append(rect(1050, 335, 500, 95, "#dbeafe"))
elements.append(text(1060, 360, 480, 60, "2.  supervisor\nsanitize title  ·  resolve venue  ·  fan out wave 1", size=22))

# ── L3: WAVE 1 AGENTS (5 boxes) ──────────────────────────────────────
W = 380
GAP = 50
total_w = 5 * W + 4 * GAP
start_x = (2600 - total_w) // 2
agent_y = 500
agent_h = 145
agent_specs = [
    ("(a)  market",       "orderbook · imbalance ·\nliquidity depth · spread · 24h vol",     "#c7d2fe"),
    ("(b)  holders",      "top-5 wallets · concentration ·\nside-bias · ens labels",         "#ddd6fe"),
    ("(c)  news",         "self-healing chain\n3 backends × retry × 6h cache",               "#fef9c3"),
    ("(d)  sentiment",    "vetted x handles · 14d ·\ntwo-pass · url provenance",             "#d1fae5"),
    ("(e)  comparables",  "no llm · resolved markets ·\nthreshold-shape · bayesian rate",    "#e5e7eb"),
]
for i, (title_, body, fill) in enumerate(agent_specs):
    x = start_x + i * (W + GAP)
    elements.append(rect(x, agent_y, W, agent_h, fill))
    elements.append(text(x + 10, agent_y + 18, W - 20, 110, f"{title_}\n\n{body}", size=20))

# ── L4: DATA SOURCES per-agent (logos + label) ───────────────────────
src_y = 695
src_h = 135
src_specs = [
    # (label, [(logo_id, caption)])
    ("clob orderbook + gamma meta",              [("logo-polymarket", "polymarket")]),
    ("data api  ·  holders endpoint",            [("logo-polymarket", "polymarket")]),
    ("exa  →  pm comments  →  provider web",     [("logo-exa", "exa ai"), ("logo-polymarket", "polymarket")]),
    ("grok live x-search  ·  vetted handles",    [("logo-xai", "xai grok"), ("logo-x", "x")]),
    ("gamma resolved-market scan",               [("logo-polymarket", "polymarket")]),
]
for i, (caption, logos) in enumerate(src_specs):
    x = start_x + i * (W + GAP)
    elements.append(rect(x, src_y, W, src_h, "#f9fafb", stroke="#525252", stroke_w=1))
    # Logo row (real brand PNGs)
    logo_size = 56
    logo_total = len(logos) * logo_size + (len(logos) - 1) * 16
    logo_start = x + (W - logo_total) // 2
    for j, (lid, _name) in enumerate(logos):
        elements.append(image(logo_start + j * (logo_size + 16), src_y + 14, logo_size, lid))
    elements.append(text(x + 10, src_y + 82, W - 20, 48, caption, size=15, color="#374151"))

# vertical arrows: each agent → its data-source box
for i in range(5):
    cx = start_x + i * (W + GAP) + W // 2
    elements.append(arrow(cx, agent_y + agent_h + 5, cx, src_y - 5, stroke="#525252", stroke_w=1, style="dotted"))

# ── L5: BYOK LLM bus (full width) ────────────────────────────────────
# OpenAI is the active shipping provider; the rest are BYOK-only.
bus_y = 880
bus_h = 220
bus_x = start_x
bus_w = total_w
elements.append(rect(bus_x, bus_y, bus_w, bus_h, "#e0e7ff", stroke_w=2))
elements.append(text(bus_x + 10, bus_y + 16, bus_w - 20, 32, "primary llm   ·   currently shipping with openai", size=24))

# Big OpenAI logo on the left half
left_cx = bus_x + 280
elements.append(image(left_cx - 55, bus_y + 60, 110, "logo-openai"))
elements.append(text(left_cx - 220, bus_y + 180, 440, 22, "openai chatgpt  ·  default", size=18, color="#0d8a72"))

# Vertical divider
elements.append(arrow(bus_x + 570, bus_y + 60, bus_x + 570, bus_y + 175, stroke="#9999aa", stroke_w=1, style="dashed", roughness=1))

# Right side: BYOK label + 4 muted logos in a row
right_x0 = bus_x + 620
elements.append(text(right_x0, bus_y + 60, bus_w - (right_x0 - bus_x) - 20, 26,
                     "also works with your own key — bring any of these:",
                     size=18, color="#374151", align="left"))

byok_logos = [
    ("logo-anthropic", "anthropic claude",  "#cc785c"),
    ("logo-google",    "google gemini",     "#1a73e8"),
    ("logo-xai",       "xai grok",          "#000000"),
    ("logo-perplexity","perplexity sonar",  "#20808d"),
]
right_w = bus_w - (right_x0 - bus_x) - 40
slot_w = right_w // 4
for j, (lid, name, color) in enumerate(byok_logos):
    cx = right_x0 + j * slot_w + slot_w // 2
    elements.append(image(cx - 30, bus_y + 100, 60, lid))
    elements.append(text(cx - 140, bus_y + 168, 280, 22, name, size=15, color=color))

# small footnote
elements.append(text(bus_x + 10, bus_y + bus_h - 25, bus_w - 20, 18,
                     "keys aes-gcm in indexeddb  ·  sent per-request as headers  ·  never logged  ·  never persisted server-side",
                     size=14, color="#666666"))

# arrow from data sources → bus (one centered)
elements.append(arrow(1300, src_y + src_h + 5, 1300, bus_y - 5, stroke_w=2))

# ── L6: THESIS (wave 2) ──────────────────────────────────────────────
thesis_y = 1115
elements.append(rect(900, thesis_y, 800, 105, "#fbcfe8"))
elements.append(text(910, thesis_y + 18, 780, 75,
                     "(f)  thesis    wave 2 — depends on wave 1\n\nsupports vs challenges  ·  direction score  ·  cites by id only",
                     size=20))
elements.append(arrow(1300, bus_y + bus_h + 5, 1300, thesis_y - 5))

# ── L7: SYNTHESIS (highlighted) ──────────────────────────────────────
synth_y = 1260
elements.append(rect(750, synth_y, 1100, 145, "#fed7aa", stroke="#d97706", stroke_w=3))
elements.append(text(760, synth_y + 20, 1080, 110,
                     "(g)  synthesis — the brief writer\n\ncan cite ONLY ids that exist in upstream evidence\ninvented citations are stripped server-side before render",
                     size=22, color="#7c2d12"))
elements.append(arrow(1300, thesis_y + 110, 1300, synth_y - 5))

# ── L8: OUTPUT ───────────────────────────────────────────────────────
brief_y = 1455
elements.append(rect(1000, brief_y, 600, 105, "#bbf7d0"))
elements.append(text(1010, brief_y + 22, 580, 70,
                     "3.  grounded brief\nevery claim is a clickable cite chip — to a real source row",
                     size=22, color="#14532d"))
elements.append(arrow(1300, synth_y + 150, 1300, brief_y - 5))

# ── L9: INVARIANT CALLOUT CARDS (4 across) ───────────────────────────
inv_y = 1605
card_w = (total_w - 3 * 30) // 4
inv_specs = [
    ("🚫  no fabrication",
     "upstream agents build a citation registry from real tool\noutput. the llm only references by index — invented ids\nstripped before render. sentiment url provenance via\ngrok's actual citations[] array."),
    ("📰  source denylist",
     "wikipedia, reddit, substack, medium, forbes contributor,\nyahoo aggregator — blocked at agent boundary. curated\nallowlist surfaces trader-grade outlets only; off-list\nsurvivors flagged 'unverified'."),
    ("♻️  self-healing news",
     "exa retries 3× × 3 query variants × 429 retry-after.\nfalls through to polymarket comments → provider web.\n6h lru cache hides transient failures behind prior\nsuccess. honest diagnostic only when truly stuck."),
    ("✅  resolved markets",
     "sentiment + thesis SKIPPED — both produce their worst\nhallucinations when there's no real-time data to ground\nin. news searches the leadup window (30d before\nresolution), not 'right now'."),
]
for i, (head, body) in enumerate(inv_specs):
    x = start_x + i * (card_w + 30)
    elements.append(rect(x, inv_y, card_w, 135, "#ffffff", stroke_w=1, roughness=2))
    elements.append(text(x + 12, inv_y + 12, card_w - 24, 115, f"{head}\n\n{body}", size=15, align="left"))

# footer
elements.append(text(800, 1770, 1000, 22,
                     "pmcopilot.wtf   ·   github.com/Torque44/pm-copilot-oss",
                     size=14, color="#999999"))


# ---- write the file ---------------------------------------------------
doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {
        "gridSize": None,
        "viewBackgroundColor": "#faf8f3",   # warm cream — matches handdrawn vibe
    },
    "files": files,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, indent=2), encoding="utf-8")
print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB, {len(elements)} elements, {len(files)} embedded logos)")
