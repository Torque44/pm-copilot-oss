// GET /admin — serves the standalone admin dashboard.
//
// The HTML is embedded as a string constant so it ships with the
// TypeScript build (no static-file plumbing through Vite or Docker
// COPY). It's a single self-contained page: dark theme, vanilla JS,
// Chart.js from CDN. No dependency on the React app at all — so a bug
// in the React bundle can't break admin access, and the admin UI bytes
// never ship to anonymous visitors.

import type { Request, Response } from 'express';

const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>pm-copilot · admin</title>
<style>
  :root {
    --bg: #050506;
    --panel: #0d0e12;
    --panel-2: #14151b;
    --border: rgba(255,255,255,0.08);
    --border-strong: rgba(255,255,255,0.16);
    --text: #e6e7ea;
    --text-muted: #7c828d;
    --accent: #75d0ea;
    --success: #16d99a;
    --danger: #f55e6c;
    --warn: #f5b16c;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    min-height: 100vh;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .mono { font-family: var(--mono); }
  button {
    font-family: inherit;
    cursor: pointer;
  }

  /* ===== Login screen ===== */
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .login-card {
    width: 100%;
    max-width: 420px;
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 32px;
    border-radius: 4px;
  }
  .login-card h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
  .login-card .sub { color: var(--text-muted); font-size: 12px; margin-bottom: 24px; font-family: var(--mono); }
  .login-card label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 6px; }
  .login-card input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border-strong);
    color: var(--text);
    padding: 10px 12px;
    font-family: var(--mono);
    font-size: 13px;
    border-radius: 3px;
    outline: none;
  }
  .login-card input:focus { border-color: var(--accent); }
  .login-card button[type=submit] {
    margin-top: 16px;
    width: 100%;
    background: var(--accent);
    color: #050506;
    border: 0;
    padding: 10px 12px;
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: 3px;
  }
  .login-card .err {
    margin-top: 12px;
    color: var(--danger);
    font-size: 12px;
    font-family: var(--mono);
  }

  /* ===== Dashboard ===== */
  .topbar {
    border-bottom: 1px solid var(--border);
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(10,11,14,0.85);
    backdrop-filter: blur(8px);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .topbar .brand { display: flex; align-items: baseline; gap: 12px; }
  .topbar .brand .name { font-weight: 600; }
  .topbar .brand .label { color: var(--text-muted); font-size: 11px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
  .topbar .actions { display: flex; gap: 12px; align-items: center; }
  .topbar .actions button, .topbar .actions a {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text);
    padding: 6px 12px;
    font-size: 11px;
    font-family: var(--mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: 3px;
  }
  .topbar .actions button:hover, .topbar .actions a:hover { border-color: var(--text); }
  .topbar .actions .updated { color: var(--text-muted); font-family: var(--mono); font-size: 11px; }

  .container { max-width: 1280px; margin: 0 auto; padding: 24px; }
  h2 { margin: 32px 0 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 600; }
  h2:first-of-type { margin-top: 0; }

  /* KPI tiles */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .kpi {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 18px 16px;
    border-radius: 4px;
  }
  .kpi .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-family: var(--mono);
  }
  .kpi .value {
    margin-top: 6px;
    font-size: 32px;
    font-weight: 600;
    font-feature-settings: 'tnum' 1;
    letter-spacing: -0.02em;
  }
  .kpi.accent .value { color: var(--accent); }

  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td {
    text-align: left;
    padding: 9px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th {
    color: var(--text-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    font-family: var(--mono);
    background: var(--panel-2);
  }
  td { font-family: var(--mono); }
  td .question { color: var(--text); white-space: pre-wrap; word-break: break-word; }
  td .wallet { color: var(--accent); }
  td .small { color: var(--text-muted); font-size: 11px; }

  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }

  canvas { max-width: 100%; }

  .empty { padding: 24px; color: var(--text-muted); font-family: var(--mono); font-size: 12px; text-align: center; }

  .ask-filter-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-bottom: 10px;
  }
  .ask-filter-row input {
    flex: 1;
    background: var(--panel);
    border: 1px solid var(--border-strong);
    color: var(--text);
    padding: 8px 12px;
    font-family: var(--mono);
    font-size: 12px;
    border-radius: 3px;
    outline: none;
  }
  .ask-filter-row input:focus { border-color: var(--accent); }
  .ask-count { color: var(--text-muted); font-size: 11px; white-space: nowrap; }

  /* Asks table can be ~10k rows tall; keep it scrollable inside the
     panel instead of stretching the whole page to multi-megabyte
     height. Subsequent sections stay reachable. */
  .panel.scroll-tall {
    max-height: 70vh;
    overflow-y: auto;
  }

  .hidden { display: none !important; }
</style>
</head>
<body>

<!-- ===== Login screen ===== -->
<div id="login" class="login-wrap">
  <form class="login-card" onsubmit="return login(event)">
    <h1>pm-copilot admin</h1>
    <div class="sub">paste your admin token to continue</div>
    <label for="token">admin token</label>
    <input id="token" type="password" autocomplete="off" spellcheck="false" autofocus placeholder="64 hex chars" />
    <button type="submit">sign in</button>
    <div class="err mono hidden" id="login-err"></div>
  </form>
</div>

<!-- ===== Dashboard ===== -->
<div id="dash" class="hidden">
  <div class="topbar">
    <div class="brand">
      <span class="name">pm-copilot</span>
      <span class="label">admin · analytics</span>
    </div>
    <div class="actions">
      <span class="updated mono" id="updated"></span>
      <button onclick="refresh()" id="refresh-btn">refresh</button>
      <a href="https://pmcopilot.wtf" target="_blank" rel="noopener">visit site ↗</a>
      <button onclick="logout()">sign out</button>
    </div>
  </div>

  <div class="container">
    <h2>summary</h2>
    <div class="kpi-grid" id="kpis"></div>

    <h2>recent questions <span class="mono" style="text-transform: none; letter-spacing: 0; color: var(--text-muted); font-weight: 400; font-size: 11px;">— the actual text users asked the agent</span></h2>
    <div class="ask-filter-row">
      <input id="ask-filter" type="text" placeholder="filter by question text / marketId / wallet…" autocomplete="off" />
      <span class="ask-count mono" id="ask-count"></span>
    </div>
    <div class="panel scroll-tall"><div id="recent-asks"></div></div>

    <h2>daily active users</h2>
    <div class="panel" style="padding: 18px;"><canvas id="dau-chart" height="80"></canvas></div>

    <div class="two-col">
      <div>
        <h2>top markets</h2>
        <div class="panel"><div id="top-markets"></div></div>
      </div>
      <div>
        <h2>top categories</h2>
        <div class="panel"><div id="top-cats"></div></div>
      </div>
    </div>

    <h2>newest users</h2>
    <div class="panel"><div id="users"></div></div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js"></script>
<script>
// ============================================================
// Login flow
// ============================================================
async function login(ev) {
  ev.preventDefault();
  const token = document.getElementById('token').value.trim();
  const errEl = document.getElementById('login-err');
  errEl.classList.add('hidden');
  if (!token) { showErr('paste your admin token'); return false; }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ token }),
    });
    if (res.status === 401) { showErr('invalid token'); return false; }
    if (res.status === 503) { showErr('ADMIN_TOKEN is not configured on the server'); return false; }
    if (!res.ok) { showErr('login failed (' + res.status + ')'); return false; }
    // Cookie is set; pivot to dashboard.
    document.getElementById('login').classList.add('hidden');
    document.getElementById('dash').classList.remove('hidden');
    await refresh();
  } catch (err) {
    showErr('network error: ' + (err && err.message ? err.message : 'unknown'));
  }
  return false;
}
function showErr(msg) {
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function logout() {
  try {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {}
  // Hard reload to fully reset state.
  location.reload();
}

// On page load: try fetching analytics with the existing cookie. If 200, we're
// already logged in; otherwise show the login screen.
(async () => {
  try {
    const r = await fetch('/api/admin/analytics?format=raw', { credentials: 'same-origin' });
    if (r.ok) {
      document.getElementById('login').classList.add('hidden');
      document.getElementById('dash').classList.remove('hidden');
      const data = await r.json();
      renderAll(data);
      setLastUpdated();
    }
  } catch {}
})();

// ============================================================
// Dashboard refresh
// ============================================================
let chart = null;

async function refresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'loading…';
  try {
    const r = await fetch('/api/admin/analytics?format=raw', { credentials: 'same-origin' });
    if (r.status === 401) { location.reload(); return; }
    const data = await r.json();
    renderAll(data);
    setLastUpdated();
  } catch (err) {
    alert('refresh failed: ' + (err && err.message ? err.message : 'unknown'));
  } finally {
    btn.disabled = false;
    btn.textContent = 'refresh';
  }
}

function setLastUpdated() {
  const el = document.getElementById('updated');
  const now = new Date();
  el.textContent = 'updated ' + now.toLocaleTimeString();
}

// Auto-refresh every 60s so the dashboard stays current without manual clicks.
setInterval(() => { if (!document.hidden) refresh(); }, 60_000);

// ============================================================
// Rendering
// ============================================================
function renderAll(data) {
  const users = data.users || [];
  const events = data.events || [];

  // Compute KPIs from raw events for an always-fresh view.
  const counts = { visit: 0, brief: 0, ask: 0, market_view: 0, onboarding_complete: 0 };
  const dayMap = new Map(); // YYYY-MM-DD → Set<wallet>
  const marketCount = new Map();
  const catCount = new Map();
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.marketId) marketCount.set(e.marketId, (marketCount.get(e.marketId) || 0) + 1);
    if (e.category) catCount.set(e.category, (catCount.get(e.category) || 0) + 1);
    if (e.wallet) {
      const day = new Date(e.ts).toISOString().slice(0, 10);
      let set = dayMap.get(day);
      if (!set) { set = new Set(); dayMap.set(day, set); }
      set.add(e.wallet);
    }
  }
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayDau = (dayMap.get(todayKey) || new Set()).size;

  renderKpis({
    users: users.length,
    events: events.length,
    visits: counts.visit,
    briefs: counts.brief,
    asks: counts.ask,
    dauToday: todayDau,
  });
  renderRecentAsks(events);
  renderDauChart(dayMap);
  renderTopMarkets(marketCount);
  renderTopCategories(catCount);
  renderUsers(users);
}

function renderKpis(k) {
  const fields = [
    { label: 'unique users', value: k.users, accent: true },
    { label: 'total events', value: k.events },
    { label: 'visits', value: k.visits },
    { label: 'briefs', value: k.briefs },
    { label: 'asks', value: k.asks, accent: true },
    { label: 'DAU today', value: k.dauToday },
  ];
  document.getElementById('kpis').innerHTML = fields.map(f => \`
    <div class="kpi \${f.accent ? 'accent' : ''}">
      <div class="label">\${f.label}</div>
      <div class="value">\${Number(f.value).toLocaleString()}</div>
    </div>
  \`).join('');
}

// Cap how many ask rows we'll render at once. 10k is comfortably handled
// by a modern browser (DOM ~30MB, scroll smooth); going higher starts
// stalling Safari. The filter input narrows the view further when this
// grows past readable.
const MAX_ASKS_RENDERED = 10000;
let ALL_ASKS = []; // populated on every refresh; filter input slices it.

function renderRecentAsks(events) {
  ALL_ASKS = events
    .filter(e => e.type === 'ask')
    .sort((a, b) => b.ts - a.ts);
  applyAskFilter();
}

function applyAskFilter() {
  const q = (document.getElementById('ask-filter').value || '').trim().toLowerCase();
  let filtered = ALL_ASKS;
  if (q) {
    filtered = ALL_ASKS.filter(e => {
      const wallet = (e.wallet || '').toLowerCase();
      const handle = (e.handle || '').toLowerCase();
      const market = (e.marketId || '').toLowerCase();
      const text = ((e.meta && e.meta.question) || '').toLowerCase();
      return wallet.includes(q) || handle.includes(q) || market.includes(q) || text.includes(q);
    });
  }

  const total = ALL_ASKS.length;
  const shown = Math.min(filtered.length, MAX_ASKS_RENDERED);
  const countEl = document.getElementById('ask-count');
  if (q) {
    countEl.textContent = \`showing \${shown.toLocaleString()} of \${filtered.length.toLocaleString()} matches (\${total.toLocaleString()} total asks)\`;
  } else if (filtered.length > MAX_ASKS_RENDERED) {
    countEl.textContent = \`showing newest \${MAX_ASKS_RENDERED.toLocaleString()} of \${total.toLocaleString()} asks — type to filter\`;
  } else {
    countEl.textContent = \`\${total.toLocaleString()} asks total\`;
  }

  const target = document.getElementById('recent-asks');
  if (filtered.length === 0) {
    target.innerHTML = \`<div class="empty">\${q ? 'no matches' : 'no ask events recorded yet'}</div>\`;
    return;
  }

  const slice = filtered.slice(0, MAX_ASKS_RENDERED);
  // Build with array.join — much faster than repeated innerHTML += at this size.
  const rows = new Array(slice.length);
  for (let i = 0; i < slice.length; i++) {
    const e = slice[i];
    const tStr = new Date(e.ts).toLocaleString();
    const w = e.wallet
      ? '<span class="wallet">' + escapeHtml(e.wallet.slice(0, 10) + '…' + e.wallet.slice(-4)) + '</span>'
      : '<span class="small">anon</span>';
    const market = escapeHtml(e.marketId || '—');
    const meta = e.meta || {};
    const qText = meta.question
      ? '<span class="question">' + escapeHtml(meta.question) + '</span>'
      : '<span class="small">(pre-L4: only length ' + (meta.questionLength || '?') + ')</span>';
    rows[i] = '<tr><td>' + tStr + '</td><td>' + w + '</td><td>' + market + '</td><td>' + qText + '</td></tr>';
  }
  target.innerHTML =
    '<table><thead><tr><th>when</th><th>wallet</th><th>market</th><th>question</th></tr></thead><tbody>' +
    rows.join('') +
    '</tbody></table>';
}

// Wire the filter input once the DOM is ready. Debounced so a fast typist
// doesn't trigger a 10k-row re-render on every keystroke.
let askFilterTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('ask-filter');
  if (!el) return;
  el.addEventListener('input', () => {
    clearTimeout(askFilterTimer);
    askFilterTimer = setTimeout(applyAskFilter, 120);
  });
});

function renderDauChart(dayMap) {
  const sorted = [...dayMap.entries()].sort(([a], [b]) => a.localeCompare(b));
  const labels = sorted.map(([day]) => day);
  const values = sorted.map(([, set]) => set.size);

  if (chart) chart.destroy();
  const ctx = document.getElementById('dau-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'unique wallets',
        data: values,
        backgroundColor: 'rgba(117, 208, 234, 0.6)',
        borderColor: 'rgba(117, 208, 234, 1)',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7c828d', font: { family: 'ui-monospace, Menlo, monospace', size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#7c828d', font: { family: 'ui-monospace, Menlo, monospace', size: 10 }, precision: 0 }, beginAtZero: true },
      },
    },
  });
}

function renderTopMarkets(map) {
  const top = [...map.entries()].sort(([, a], [, b]) => b - a).slice(0, 15);
  if (top.length === 0) {
    document.getElementById('top-markets').innerHTML = '<div class="empty">no market data yet</div>';
    return;
  }
  const rows = top.map(([id, n]) => \`<tr><td>\${id}</td><td style="text-align:right">\${n}</td></tr>\`).join('');
  document.getElementById('top-markets').innerHTML = \`<table>
    <thead><tr><th>marketId</th><th style="text-align:right">events</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

function renderTopCategories(map) {
  const top = [...map.entries()].sort(([, a], [, b]) => b - a);
  if (top.length === 0) {
    document.getElementById('top-cats').innerHTML = '<div class="empty">no category data yet</div>';
    return;
  }
  const rows = top.map(([cat, n]) => \`<tr><td>\${cat}</td><td style="text-align:right">\${n}</td></tr>\`).join('');
  document.getElementById('top-cats').innerHTML = \`<table>
    <thead><tr><th>category</th><th style="text-align:right">events</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

function renderUsers(users) {
  if (users.length === 0) {
    document.getElementById('users').innerHTML = '<div class="empty">no users yet</div>';
    return;
  }
  const sorted = [...users].sort((a, b) => b.firstSeen - a.firstSeen).slice(0, 50);
  const rows = sorted.map(u => \`<tr>
    <td class="wallet">\${u.wallet}</td>
    <td>\${u.handle || '<span class="small">—</span>'}</td>
    <td>\${new Date(u.firstSeen).toLocaleString()}</td>
    <td>\${new Date(u.lastSeen).toLocaleString()}</td>
    <td style="text-align:right">\${u.visitCount}</td>
  </tr>\`).join('');
  document.getElementById('users').innerHTML = \`<table>
    <thead><tr><th>wallet</th><th>handle</th><th>first seen</th><th>last seen</th><th style="text-align:right">visits</th></tr></thead>
    <tbody>\${rows}</tbody>
  </table>\`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
</script>
</body>
</html>`;

export function adminUiHandler(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  // Block framing — defense in depth against clickjacking on the admin
  // page. The page itself is dark and visually distinctive, but
  // X-Frame-Options is the cheap belt + suspenders.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
  );
  res.send(ADMIN_HTML);
}
