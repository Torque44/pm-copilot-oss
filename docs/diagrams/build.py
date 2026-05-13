#!/usr/bin/env python3
"""Generate the pmcopilot.wtf Excalidraw architecture diagram.

Run:   python docs/diagrams/build.py

Writes pmcopilot-architecture.excalidraw alongside this script with the
REAL vendor logos (from docs/diagrams/logos/*.png, prepared once by
prepare_logos.py) embedded as base64 data URLs so the file is fully
self-contained.

Aesthetic: clean professional layout — inspired by Stripe / Vercel /
Cloudflare architecture diagrams.  Pastel fills, sentence case text,
tight grid spacing, real brand logos.  Coordinates match render_png.py
so the .excalidraw and the .png show the same thing.
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

def rect(x, y, w, h, fill, stroke="#28282b", stroke_w=2, rad=3, roughness=1, _id=None):
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

def text(x, y, w, h, body, size=18, color="#28282b", align="center", font_family=5):
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
        "fontSize": size, "fontFamily": font_family,
        "text": body, "textAlign": align, "verticalAlign": "top",
        "containerId": None, "originalText": body,
        "lineHeight": 1.25, "baseline": int(size * 0.9),
    }

def arrow(x1, y1, x2, y2, stroke="#28282b", stroke_w=2, style="solid", roughness=1):
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


# ---- layout (matches render_png.py) -----------------------------------
W, H = 2400, 1620
AGENT_W = 360
GAP = 24
total_w = 5 * AGENT_W + 4 * GAP
start_x = (W - total_w) // 2
center_x = W // 2

elements: list = []

# ── Title ────────────────────────────────────────────────────────────
elements.append(text(0, 30, W, 50, "pmcopilot.wtf · architecture", size=42))
elements.append(text(0, 90, W, 28,
                     "7 agents · 3 search backends · BYOK LLM · every claim cites a real source row, enforced in code",
                     size=18, color="#6e6e76"))

# ── L1: USER ─────────────────────────────────────────────────────────
y = 150
elements.append(rect(center_x - 240, y, 480, 76, "#fef3c7"))
elements.append(text(center_x - 240, y + 12, 480, 28, "1.  You", size=22))
elements.append(text(center_x - 240, y + 46, 480, 22, "Paste a Polymarket URL  ·  Ask a question", size=16))

# arrow user → supervisor
elements.append(arrow(center_x, y + 78, center_x, y + 102, stroke_w=3))

# ── L2: SUPERVISOR ───────────────────────────────────────────────────
y2 = 254
elements.append(rect(center_x - 240, y2, 480, 76, "#dbeafe"))
elements.append(text(center_x - 240, y2 + 12, 480, 28, "2.  Supervisor", size=22))
elements.append(text(center_x - 240, y2 + 46, 480, 22, "Sanitize title  ·  Resolve venue  ·  Fan out wave 1", size=16))

# ── L3: WAVE 1 AGENTS (5 boxes) ──────────────────────────────────────
agent_y = 372
agent_h = 132
agent_specs = [
    ("(a)  Market",      "Orderbook · imbalance ·\nliquidity depth · spread · 24h vol",  "#c7d2fe"),
    ("(b)  Holders",     "Top-5 wallets · concentration ·\nside-bias · ENS labels",      "#ddd6fe"),
    ("(c)  News",        "Self-healing chain\n3 backends × retry × 6h cache",            "#fef9c3"),
    ("(d)  Sentiment",   "Vetted X handles · 14d ·\ntwo-pass · URL provenance",          "#d1fae5"),
    ("(e)  Comparables", "No LLM · resolved markets ·\nthreshold-shape · Bayesian rate", "#e5e7eb"),
]
for i, (title_, body, fill) in enumerate(agent_specs):
    x = start_x + i * (AGENT_W + GAP)
    elements.append(rect(x, agent_y, AGENT_W, agent_h, fill))
    elements.append(text(x + 12, agent_y + 14, AGENT_W - 24, 30, title_, size=21, align="left"))
    elements.append(text(x + 12, agent_y + 54, AGENT_W - 24, 70, body, size=15, align="left"))
    # arrow supervisor → agent
    cx = x + AGENT_W // 2
    elements.append(arrow(center_x, y2 + 76, cx, agent_y - 4, stroke_w=2))

# ── L4: DATA SOURCES per-agent ───────────────────────────────────────
src_y = 528
src_h = 120
src_specs = [
    ("CLOB orderbook  +  Gamma meta",        [("logo-polymarket", "polymarket")]),
    ("Data API  ·  holders endpoint",        [("logo-polymarket", "polymarket")]),
    ("Exa  →  PM comments  →  Provider Web", [("logo-exa", "exa"), ("logo-polymarket", "polymarket")]),
    ("Grok Live X-Search  ·  vetted handles",[("logo-xai", "xai grok"), ("logo-x", "x")]),
    ("Gamma  ·  resolved-market scan",       [("logo-polymarket", "polymarket")]),
]
for i, (caption, logos) in enumerate(src_specs):
    x = start_x + i * (AGENT_W + GAP)
    elements.append(rect(x, src_y, AGENT_W, src_h, "#fafafc", stroke="#aaaab4", stroke_w=1))
    sz = 48
    gap = 14
    total_lw = len(logos) * sz + (len(logos) - 1) * gap
    lx = x + (AGENT_W - total_lw) // 2
    for j, (lid, _name) in enumerate(logos):
        elements.append(image(lx + j * (sz + gap), src_y + 12, sz, lid))
    elements.append(text(x + 12, src_y + 70, AGENT_W - 24, 40, caption, size=15, color="#465064"))
    # dotted connector agent → source
    cx = x + AGENT_W // 2
    elements.append(arrow(cx, agent_y + agent_h + 2, cx, src_y - 2, stroke="#7c7c88", stroke_w=1, style="dotted"))

# ── L5: BYOK LLM bus — all 5 in one tight row ────────────────────────
bus_y = 678
bus_h = 152
elements.append(rect(start_x, bus_y, total_w, bus_h, "#e0e7ff"))
elements.append(text(start_x, bus_y + 14, total_w, 30,
                     "Primary LLM  ·  BYOK (your key, your bill)",
                     size=22))

llm_logos = [
    ("logo-openai",     "ChatGPT",   "default", "#108a72"),
    ("logo-anthropic",  "Claude",    "byok",    "#cc785c"),
    ("logo-google",     "Gemini",    "byok",    "#1a73e8"),
    ("logo-xai",        "Grok",      "byok",    "#000000"),
    ("logo-perplexity", "Sonar",     "byok",    "#20808d"),
]
slot_w = total_w // 5
for j, (lid, label, tag, color) in enumerate(llm_logos):
    cx = start_x + j * slot_w + slot_w // 2
    elements.append(image(cx - 28, bus_y + 50, 56, lid))
    elements.append(text(cx - 100, bus_y + 110, 200, 22, label, size=16, color=color))
    tag_color = "#108a72" if tag == "default" else "#82828c"
    elements.append(text(cx - 80, bus_y + 130, 160, 18, tag, size=12, color=tag_color))

# central arrow into bus
elements.append(arrow(center_x, src_y + src_h + 2, center_x, bus_y - 2, stroke_w=3))

# ── L6: THESIS ──────────────────────────────────────────────────────
elements.append(arrow(center_x, bus_y + bus_h + 2, center_x, 858, stroke_w=3))
thesis_y = 860
elements.append(rect(center_x - 380, thesis_y, 760, 80, "#fbcfe8"))
elements.append(text(center_x - 380, thesis_y + 12, 760, 28, "(f)  Thesis     —     Wave 2", size=22))
elements.append(text(center_x - 380, thesis_y + 46, 760, 22,
                     "Supports vs challenges  ·  direction score  ·  cites by id only",
                     size=16))

# ── L7: SYNTHESIS (highlighted) ──────────────────────────────────────
elements.append(arrow(center_x, thesis_y + 82, center_x, 968, stroke_w=3))
synth_y = 970
elements.append(rect(center_x - 520, synth_y, 1040, 110, "#fed7aa", stroke="#d97706", stroke_w=3))
elements.append(text(center_x - 520, synth_y + 16, 1040, 30,
                     "(g)  Synthesis  —  the brief writer",
                     size=24, color="#7c2d12"))
elements.append(text(center_x - 520, synth_y + 58, 1040, 22,
                     "Can cite ONLY ids that exist in upstream evidence  ·  invented citations stripped server-side",
                     size=15, color="#7c2d12"))

# ── L8: BRIEF ───────────────────────────────────────────────────────
elements.append(arrow(center_x, synth_y + 112, center_x, 1108, stroke_w=3))
brief_y = 1110
elements.append(rect(center_x - 320, brief_y, 640, 80, "#bbf7d0"))
elements.append(text(center_x - 320, brief_y + 12, 640, 28, "3.  Grounded Brief", size=22, color="#14532d"))
elements.append(text(center_x - 320, brief_y + 46, 640, 22,
                     "Every claim is a clickable cite chip — back to a real source row",
                     size=16, color="#14532d"))

# ── L9: INVARIANTS (4 cards) ─────────────────────────────────────────
inv_y = 1230
card_w = (total_w - 3 * 24) // 4
inv_specs = [
    ("No fabrication",
     "Upstream agents build a citation registry from\nreal tool output. The LLM only references by\nindex — invented ids stripped before render."),
    ("Source denylist",
     "Wikipedia, Reddit, Substack, Medium, Forbes\ncontributor blocked at agent boundary. Curated\nallowlist surfaces trader-grade outlets only."),
    ("Self-healing news",
     "Exa retries 3× × 3 query variants × 429 Retry-\nAfter. Falls through to PM comments → provider\nweb. 6h LRU cache hides transient failures."),
    ("Resolved markets",
     "Sentiment + thesis SKIPPED — both produce their\nworst hallucinations without real-time data.\nNews searches 30d before resolution."),
]
for i, (head, body) in enumerate(inv_specs):
    x = start_x + i * (card_w + 24)
    elements.append(rect(x, inv_y, card_w, 158, "#fcfcfd", stroke="#aaaab4", stroke_w=1))
    elements.append(text(x + 16, inv_y + 14, card_w - 32, 28, head, size=18, align="left"))
    elements.append(text(x + 16, inv_y + 50, card_w - 32, 96, body, size=14, color="#465064", align="left"))

# footer
elements.append(text(0, H - 42, W, 22,
                     "pmcopilot.wtf  ·  github.com/Torque44/pm-copilot-oss  ·  keys AES-GCM in IndexedDB · sent as headers · never logged",
                     size=14, color="#9a9aa3"))


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
print(f"wrote {OUT}  ({OUT.stat().st_size // 1024} KB, {len(elements)} elements, {len(files)} embedded logos)")
