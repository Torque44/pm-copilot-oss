#!/usr/bin/env python3
"""Generate the pmcopilot.wtf Excalidraw architecture diagram.

Run:   python docs/diagrams/build.py

Writes pmcopilot-architecture.excalidraw alongside this script with brand
logos embedded as base64 SVG data URLs (so the file is self-contained —
no external image fetches when the diagram is opened at excalidraw.com).

Brand badges use the official primary color of each vendor, with a
single-letter monogram. This is the look most brands ship in small
favicons / app icons and reads cleanly at every zoom level. Replace
individual files in the `files` map with real logo PNGs if you want
exact press-kit assets.
"""

from __future__ import annotations
import base64
import json
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent / "pmcopilot-architecture.excalidraw"
NOW_MS = int(time.time() * 1000)


def svg_badge(letter: str, bg: str, fg: str = "white") -> str:
    """Return the data-URL for a 100x100 SVG circle with a centered letter."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        f'<circle cx="50" cy="50" r="48" fill="{bg}"/>'
        f'<text x="50" y="70" font-family="Inter, ui-sans-serif, system-ui, Arial" '
        f'font-size="58" font-weight="800" text-anchor="middle" fill="{fg}">{letter}</text>'
        f'</svg>'
    )
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


# (id, letter, bg, fg)
LOGOS = [
    ("logo-anthropic", "C", "#d97757"),
    ("logo-openai", "G", "#10a37f"),
    ("logo-google", "G", "#1a73e8"),
    ("logo-xai", "X", "#000000"),
    ("logo-perplexity", "P", "#20808d"),
    ("logo-exa", "E", "#4f46e5"),
    ("logo-polymarket", "P", "#9c47ff"),
    ("logo-x", "𝕏", "#000000"),
]

files: dict = {}
for lid, letter, bg in LOGOS:
    files[lid] = {
        "mimeType": "image/svg+xml",
        "id": lid,
        "dataURL": svg_badge(letter, bg),
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

def rect(x, y, w, h, fill, stroke="#1e1e1e", stroke_w=2, rad=3, _id=None):
    return {
        "type": "rectangle",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False,
        "id": _id or nid(),
        "fillStyle": "solid",
        "strokeWidth": stroke_w, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100, "angle": 0,
        "x": x, "y": y, "width": w, "height": h,
        "strokeColor": stroke, "backgroundColor": fill,
        "seed": seed(), "groupIds": [], "frameId": None,
        "roundness": {"type": rad} if rad else None,
        "boundElements": [], "updated": NOW_MS,
        "link": None, "locked": False,
    }

def text(x, y, w, h, body, size=20, color="#1e1e1e", align="center", weight=None):
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
        "fontSize": size, "fontFamily": 5,
        "text": body, "textAlign": align, "verticalAlign": "top",
        "containerId": None, "originalText": body,
        "lineHeight": 1.25, "baseline": int(size * 0.9),
    }

def arrow(x1, y1, x2, y2, stroke="#1e1e1e", stroke_w=2, style="solid"):
    return {
        "type": "arrow",
        "version": 1, "versionNonce": seed(),
        "isDeleted": False, "id": nid(),
        "fillStyle": "solid", "strokeWidth": stroke_w, "strokeStyle": style,
        "roughness": 1, "opacity": 100, "angle": 0,
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
# canvas: roughly 2600 × 1900

elements: list = []

# Title
elements.append(text(750, 30, 1100, 60, "pmcopilot.wtf — architecture", size=44))
elements.append(text(600, 95, 1400, 28, "7 agents · 3 search backends · BYOK LLM · every claim cites a real source row, enforced in code", size=18, color="#666666"))

# ── L1: USER ─────────────────────────────────────────────────────────
elements.append(rect(1050, 180, 500, 90, "#fef3c7"))
elements.append(text(1060, 200, 480, 60, "1.   YOU\npaste a polymarket url  ·  ask a question", size=22))

# ── L2: SUPERVISOR ───────────────────────────────────────────────────
elements.append(rect(1050, 320, 500, 90, "#dbeafe"))
elements.append(text(1060, 340, 480, 60, "2.   SUPERVISOR\nsanitize title  ·  resolve venue  ·  fan out wave 1", size=22))

# ── L3: WAVE 1 AGENTS (5 boxes) ──────────────────────────────────────
W = 380
GAP = 50
total_w = 5 * W + 4 * GAP
start_x = (2600 - total_w) // 2
agent_y = 480
agent_h = 140
agent_specs = [
    ("(a)  MARKET",       "orderbook · imbalance ·\nliquidity depth · spread · 24h vol",     "#c7d2fe"),
    ("(b)  HOLDERS",      "top-5 wallets · concentration ·\nside-bias · ENS labels",         "#ddd6fe"),
    ("(c)  NEWS",         "self-healing chain\n3 backends × retry × 6 h cache",              "#fef9c3"),
    ("(d)  SENTIMENT",    "vetted X handles · 14 d ·\ntwo-pass · URL provenance",            "#d1fae5"),
    ("(e)  COMPARABLES",  "no LLM · resolved markets ·\nthreshold-shape · Bayesian rate",    "#e5e7eb"),
]
for i, (title_, body, fill) in enumerate(agent_specs):
    x = start_x + i * (W + GAP)
    elements.append(rect(x, agent_y, W, agent_h, fill))
    elements.append(text(x + 10, agent_y + 16, W - 20, 110, f"{title_}\n\n{body}", size=20))

# ── L4: DATA SOURCES per-agent (logos + label) ───────────────────────
src_y = 670
src_h = 130
src_specs = [
    # (label, [(logo_id, caption)])
    ("CLOB orderbook + Gamma meta",                   [("logo-polymarket", "Polymarket")]),
    ("Data API holders endpoint",                     [("logo-polymarket", "Polymarket")]),
    ("Exa  →  PM comments  →  Provider Web",         [("logo-exa", "Exa AI"), ("logo-polymarket", "Polymarket")]),
    ("Grok Live X-Search · vetted handles",          [("logo-xai", "xAI Grok"), ("logo-x", "X")]),
    ("Gamma resolved-market scan",                    [("logo-polymarket", "Polymarket")]),
]
for i, (caption, logos) in enumerate(src_specs):
    x = start_x + i * (W + GAP)
    elements.append(rect(x, src_y, W, src_h, "#f9fafb", stroke="#525252", stroke_w=1))
    # Logo row
    logo_size = 50
    logo_total = len(logos) * logo_size + (len(logos) - 1) * 14
    logo_start = x + (W - logo_total) // 2
    for j, (lid, _name) in enumerate(logos):
        elements.append(image(logo_start + j * (logo_size + 14), src_y + 14, logo_size, lid))
    elements.append(text(x + 10, src_y + 76, W - 20, 48, caption, size=15, color="#374151"))

# vertical arrows: each agent → its data-source box
for i in range(5):
    cx = start_x + i * (W + GAP) + W // 2
    elements.append(arrow(cx, agent_y + agent_h + 5, cx, src_y - 5, stroke="#525252", stroke_w=1, style="dotted"))

# ── L5: BYOK LLM bus (full width) ────────────────────────────────────
bus_y = 850
bus_h = 170
bus_x = start_x
bus_w = total_w
elements.append(rect(bus_x, bus_y, bus_w, bus_h, "#e0e7ff", stroke_w=2))
elements.append(text(bus_x + 10, bus_y + 18, bus_w - 20, 30, "PRIMARY LLM   ·   your key, your bill   ·   BYOK", size=22))

# 5 logos in a row inside the bus
llm_logos = [
    ("logo-anthropic", "Anthropic Claude", "#d97757"),
    ("logo-openai",    "OpenAI ChatGPT",   "#10a37f"),
    ("logo-google",    "Google Gemini",    "#1a73e8"),
    ("logo-xai",       "xAI Grok",         "#000000"),
    ("logo-perplexity","Perplexity Sonar", "#20808d"),
]
llm_logo_size = 60
slot_w = (bus_w - 80) // 5
for j, (lid, name, color) in enumerate(llm_logos):
    cx = bus_x + 40 + j * slot_w + slot_w // 2
    elements.append(image(cx - llm_logo_size // 2, bus_y + 60, llm_logo_size, lid))
    elements.append(text(cx - 130, bus_y + 130, 260, 22, name, size=16, color=color))

# small footnote
elements.append(text(bus_x + 10, bus_y + bus_h - 22, bus_w - 20, 18,
                     "keys AES-GCM in IndexedDB  ·  sent per-request as headers  ·  never logged  ·  never persisted server-side",
                     size=13, color="#666666"))

# arrow from data sources → bus (one centered)
elements.append(arrow(1300, bus_y - 30, 1300, bus_y - 5, stroke_w=2))

# ── L6: THESIS (wave 2) ──────────────────────────────────────────────
thesis_y = 1060
elements.append(rect(900, thesis_y, 800, 100, "#fbcfe8"))
elements.append(text(910, thesis_y + 16, 780, 70,
                     "(f)   THESIS    wave 2 — depends on wave 1\n\nsupports vs challenges · direction score · cites by id only",
                     size=20))
elements.append(arrow(1300, bus_y + bus_h + 5, 1300, thesis_y - 5))

# ── L7: SYNTHESIS (highlighted) ──────────────────────────────────────
synth_y = 1200
elements.append(rect(750, synth_y, 1100, 140, "#fed7aa", stroke="#d97706", stroke_w=3))
elements.append(text(760, synth_y + 18, 1080, 110,
                     "(g)   SYNTHESIS — the brief writer\n\ncan cite ONLY ids that exist in upstream evidence\ninvented citations are stripped server-side before render",
                     size=22, color="#7c2d12"))
elements.append(arrow(1300, thesis_y + 105, 1300, synth_y - 5))

# ── L8: OUTPUT ───────────────────────────────────────────────────────
brief_y = 1390
elements.append(rect(1000, brief_y, 600, 100, "#bbf7d0"))
elements.append(text(1010, brief_y + 18, 580, 70,
                     "3.   GROUNDED BRIEF\nevery claim is a clickable cite chip — to a real source row",
                     size=22, color="#14532d"))
elements.append(arrow(1300, synth_y + 145, 1300, brief_y - 5))

# ── L9: INVARIANT CALLOUT CARDS (4 across) ───────────────────────────
inv_y = 1540
card_w = (total_w - 3 * 30) // 4
inv_specs = [
    ("🚫  NO FABRICATION",
     "Upstream agents build a citation registry from real tool\noutput. The LLM only references by index — invented IDs\nstripped before render. Sentiment URL provenance via\nGrok's actual citations[] array."),
    ("📰  SOURCE DENYLIST",
     "Wikipedia, Reddit, Substack, Medium, Forbes contributor,\nYahoo aggregator — blocked at agent boundary. Curated\nallowlist surfaces trader-grade outlets only; off-list\nsurvivors flagged 'unverified'."),
    ("♻️  SELF-HEALING NEWS",
     "Exa retries 3× × 3 query variants × 429 Retry-After.\nFalls through to Polymarket comments → provider web.\n6 h LRU cache hides transient failures behind prior\nsuccess. Honest diagnostic only when truly stuck."),
    ("✅  RESOLVED MARKETS",
     "Sentiment + thesis SKIPPED — both produce their worst\nhallucinations when there's no real-time data to ground\nin. News searches the leadup window (30 d before\nresolution), not 'right now'."),
]
for i, (head, body) in enumerate(inv_specs):
    x = start_x + i * (card_w + 30)
    elements.append(rect(x, inv_y, card_w, 130, "#ffffff", stroke_w=1))
    elements.append(text(x + 12, inv_y + 12, card_w - 24, 110, f"{head}\n\n{body}", size=15, align="left"))

# footer
elements.append(text(800, 1700, 1000, 20,
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
        "viewBackgroundColor": "#ffffff",
    },
    "files": files,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(doc, indent=2), encoding="utf-8")
print(f"wrote {OUT}  ({OUT.stat().st_size} bytes, {len(elements)} elements, {len(files)} embedded logos)")
