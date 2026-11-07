// TerraTrace web app. No external libraries. All text is set with textContent (never innerHTML),
// so data, reviewer comments and AI answers can never run as code in the page.
// Security decisions (login, roles, approvals, audit log) are enforced by the server; the UI only mirrors them.
'use strict';

const MAX_Q = 1000;
const S = { me: null, data: {}, items: {}, reviews: {}, audit: null, health: null, ui: {} };
const SCEN = { ssp126: 'SSP1-2.6 (low warming)', ssp245: 'SSP2-4.5 (middle)', ssp585: 'SSP5-8.5 (high warming)' };
const CROPS = { pea: 'Pea', potato: 'Potato', carrot: 'Carrot', spinach: 'Spinach', turnip_rape: 'Turnip rape' };
const REG = { FI_SW: 'Finland (SW)', SE_SKANE: 'Sweden (Skåne)' };
const ROLE_TXT = {
  viewer: 'Sees totals for regions, crops and catchments. Cannot approve.',
  reviewer: 'Checks sources and approves or rejects results and data corrections.',
  farm_advisor: 'Sees farm-level records (codes only) to advise growers.',
  admin: 'Manages users. Does not see farm-level records unless also a farm advisor.',
};

// ---------------------------------------------------------------- tiny DOM helpers
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM, allowed by the strict CSP
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const c of kids.flat()) {
    if (c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
// Simple line icons (24x24, stroke). Paths are static strings written here, never from data.
const ICONS = {
  leaf: ['M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z', 'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12'],
  dashboard: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
  map: ['M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z', 'M9 3v15', 'M15 6v15'],
  truck: ['M1 3h15v13H1z', 'M16 8h4l3 3v5h-7z', 'M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z'],
  bot: ['M12 8V4H8', 'M4 8h16v12H4z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M6.34 17.66l-1.41 1.41', 'M19.07 4.93l-1.41 1.41'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  collapse: ['M3 3h18v18H3z', 'M9 3v18', 'M16 15l-3-3 3-3'],
  euro: ['M4 10h12', 'M4 14h9', 'M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2'],
  trend: ['M22 17l-8.5-8.5-5 5L2 7', 'M16 17h6v-6'],
  co2: ['M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2', 'M9.6 4.6A2 2 0 1 1 11 8H2', 'M12.6 19.4A2 2 0 1 0 14 16H2'],
  drop: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  ok: ['M20 6L9 17l-5-5'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  alert: ['M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  lock: ['M5 11h14v10H5z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  home: ['M3 10.5L12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  spark: ['M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z', 'M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  ship: ['M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1', 'M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76', 'M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6', 'M12 10v4', 'M12 2v3'],
  ferry: ['M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1', 'M3 15l2 4h14l2-4z', 'M6 15V9h12v6', 'M9 9V6h6v3'],
  snow: ['M2 12h20', 'M12 2v20', 'M20 16l-4-4 4-4', 'M4 8l4 4-4 4', 'M16 4l-4 4-4-4', 'M8 20l4-4 4 4'],
  up: ['M7 17L17 7', 'M8 7h9v9'],
  down: ['M7 7l10 10', 'M17 8v9H8'],
};
function icon(name) {
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    (ICONS[name] || []).map((d) => s('path', { d })));
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const eur = (v) => (isNum(v) ? '€' + num(Math.round(v)) : '–');
const pct = (v, d = 1) => (isNum(v) ? (v > 0 ? '+' : '') + num(v, d) + ' %' : '–');
const has = (role) => !!(S.me && S.me.roles.includes(role));
const can = (k) => !!(S.me && S.me.can && S.me.can[k]);
const initials = (email) => (email || '?').split('@')[0].split(/[._-]/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase();

// ---------------------------------------------------------------- storage (theme, sidebar only; never security data)
function pref(key, val) {
  try {
    if (val === undefined) return window.localStorage.getItem('tt.' + key);
    window.localStorage.setItem('tt.' + key, val);
  } catch (e) { /* storage blocked */ }
  return null;
}
function applyTheme() { document.documentElement.setAttribute('data-theme', pref('theme') === 'dark' ? 'dark' : 'light'); }

// ---------------------------------------------------------------- API
async function api(path, opts) {
  opts = opts || {};
  const init = { method: opts.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.headers['X-TerraTrace'] = '1';
    init.body = JSON.stringify(opts.body);
  } else if (init.method === 'POST') {
    init.headers['X-TerraTrace'] = '1';
  }
  if (opts.signal) init.signal = opts.signal;
  const res = await fetch(path, init);
  if (opts.raw) return res;
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') { S.me = null; renderLogin('Your session has ended. Please sign in again.'); throw new Error('signed out'); }
  if (!res.ok) throw new Error((data && data.error) || ('Request failed (' + res.status + ')'));
  return data;
}

// ---------------------------------------------------------------- dialog
function openDialog(...content) {
  const dlg = document.getElementById('dlg');
  document.getElementById('dlg-body').replaceChildren(...content.filter(Boolean));
  if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
}
function closeDialog() {
  const d = document.getElementById('dlg');
  if (typeof d.close === 'function' && d.open) d.close(); else d.removeAttribute('open');
}
const closeBtn = () => h('button', { class: 'btn', type: 'button', text: 'Close', onclick: closeDialog });

// ---------------------------------------------------------------- review items
function item(id, title, summary, src) {
  S.items[id] = { id, title, summary, src: src || {} };
  return S.items[id];
}
function status(id) { return (S.reviews[id] && S.reviews[id].status) || 'draft'; }
function pill(id) {
  const st = status(id);
  return h('span', { class: 'pill st-' + st, text: st === 'draft' ? 'Draft' : st === 'approved' ? 'Approved' : 'Rejected' });
}
function showSource(it) {
  const src = it.src || {};
  const r = S.reviews[it.id];
  openDialog(
    h('h3', { text: 'Source: ' + it.title }),
    it.summary ? h('p', { text: it.summary }) : null,
    src.formula ? h('p', {}, h('strong', { text: 'Formula / rule: ' }), src.formula) : null,
    src.standard ? h('p', {}, h('strong', { text: 'Standard: ' }), src.standard) : null,
    src.files && src.files.length ? h('div', {}, h('strong', { text: 'Source files and records:' }),
      h('ul', {}, src.files.map((x) => h('li', {}, h('code', { text: x }))))) : null,
    src.assumptions && src.assumptions.length ? h('div', {}, h('strong', { text: 'Assumptions:' }),
      h('ul', {}, src.assumptions.map((a) => h('li', { text: a })))) : null,
    h('p', { class: 'small muted', text: 'Review status: ' + status(it.id) + (r ? ` by ${r.by} at ${r.ts}` : '') + (r && r.comment ? `. Reason: ${r.comment}` : '') + (r ? '. This decision is final.' : '') }),
    h('div', { class: 'dlg-actions' }, closeBtn()),
  );
}
async function decide(it, newStatus, comment) {
  if (S.ui.busy && S.ui.busy[it.id]) return;
  S.ui.busy = S.ui.busy || {};
  S.ui.busy[it.id] = true;
  render();
  try {
    await api('/api/review', { method: 'POST', body: {
      record_key: it.id, status: newStatus, comment: comment || '',
      title: it.title, summary: it.summary || '',
      rule_or_model: (it.src && it.src.formula) || '', evidence: ((it.src && it.src.files) || []).join('; '),
    } });
    await refreshReviews();
    render();
  } catch (e) {
    if (e.message !== 'signed out') {
      try { await refreshReviews(); } catch (e2) { /* ignore */ }
      render();
      openDialog(h('h3', { text: 'Not saved' }), h('p', { text: e.message }), h('div', { class: 'dlg-actions' }, closeBtn()));
    }
  } finally {
    delete S.ui.busy[it.id];
    if (S.me) render();
  }
}
function reject(it) {
  const ta = h('textarea', { maxlength: 500, placeholder: 'Why do you reject this result? (required)' });
  const err = h('p', { class: 'err-text' });
  openDialog(h('h3', { text: 'Reject: ' + it.title }), ta, err,
    h('div', { class: 'dlg-actions' }, closeBtn(), h('button', {
      class: 'btn primary', type: 'button', text: 'Reject',
      onclick: () => {
        const c = ta.value.replace(/[\u0000-\u001f]/g, ' ').trim();
        if (c.length < 3) { err.textContent = 'Please write a short reason.'; return; }
        closeDialog();
        decide(it, 'rejected', c);
      },
    })));
  ta.focus();
}
function localTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts || '');
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function controls(it, wide) {
  const st = status(it.id);
  const r = S.reviews[it.id];
  const busy = !!(S.ui.busy && S.ui.busy[it.id]);
  const decided = st !== 'draft';
  const lbl = (txt) => (wide ? h('span', { text: txt }) : null);
  return h('div', { class: 'acts' + (wide ? ' wide' : '') }, pill(it.id),
    h('button', { class: 'btn sm src' + (wide ? '' : ' ico'), type: 'button', title: 'Show source and formula', 'aria-label': 'Show source', onclick: () => showSource(it) }, icon('info'), lbl('Source')),
    !decided && can('review') ? h('button', { class: 'btn sm ok' + (wide ? '' : ' ico'), type: 'button', disabled: busy, title: 'Approve', 'aria-label': 'Approve ' + it.title, onclick: () => decide(it, 'approved', '') }, icon('ok'), lbl(busy ? 'Saving…' : 'Approve')) : null,
    !decided && can('review') ? h('button', { class: 'btn sm no' + (wide ? '' : ' ico'), type: 'button', disabled: busy, title: 'Reject (a reason is required)', 'aria-label': 'Reject ' + it.title, onclick: () => reject(it) }, icon('x'), lbl('Reject')) : null,
    decided && r ? h('div', { class: 'decided', role: 'note', 'aria-label': `Decided by ${r.by} at ${localTime(r.ts)}. Final.`,
      title: `${r.by.split('@')[0]} · ${localTime(r.ts)}` + (r.comment ? ' · Reason: ' + r.comment : '') + ' · final, kept in the audit log' },
      icon('lock'), wide ? h('span', { text: `${r.by.split('@')[0]} · ${localTime(r.ts)}` }) : null) : null);
}

// ---------------------------------------------------------------- building blocks
function card(title, sub, body, extra) {
  return h('div', { class: 'card' },
    title ? h('div', { class: 'card-h' }, h('div', {}, h('h2', { text: title }), sub ? h('p', { class: 'sub', text: sub }) : null), h('span', { class: 'spacer' }), extra || null) : null,
    body);
}
function stat(ic, color, label, value, note) {
  return h('div', { class: 'card stat accent-' + color }, h('div', { class: 'ico ' + color }, icon(ic)),
    h('div', {}, h('div', { class: 'lbl', text: label }), h('div', { class: 'val', text: value }), h('div', { class: 'note', text: note })));
}
function table(headers, numCols, rows, emptyText) {
  if (!rows.length) return h('div', { class: 'empty', text: emptyText || 'Nothing to show.' });
  for (const tr of rows) {
    if (!tr || !tr.children) continue;
    Array.from(tr.children).forEach((td, i) => { if (headers[i]) td.setAttribute('data-label', headers[i]); });
  }
  return h('div', { class: 'tablewrap' }, h('table', { class: 'rtable' },
    h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { class: numCols.includes(i) ? 'num' : null, text: x })))),
    h('tbody', {}, rows)));
}
function methodBox(title, m) {
  return h('div', { class: 'method' }, h('h3', { text: title }),
    h('ul', {}, Object.entries(m).filter(([, v]) => typeof v === 'string').map(([k, v]) => h('li', {}, h('strong', { text: k + ': ' }), v))));
}
function pageHead(title, sub, extra) {
  return h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: title }), sub ? h('p', { text: sub }) : null), h('span', { class: 'spacer' }), extra || null);
}

// ---------------------------------------------------------------- charts
// Charts: thin marks, nice round ticks, hairline grid, hover/focus tooltips (text only, no innerHTML).
function niceTicks(max, count) {
  const raw = Math.max(max, 1e-9) / (count || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}
const tickTxt = (v) => (v >= 10000 ? num(v / 1000) + 'K' : v < 10 && v % 1 ? num(v, 1) : num(v));
function vizTip() { return h('div', { class: 'viz-tip', role: 'status', 'aria-live': 'polite' }); }
function fillTip(tip, title, rows, total) {
  const kids = [h('div', { class: 'tt-h', text: title }),
    ...rows.map((r) => h('div', { class: 'tt-r' + (r.dim ? ' dim' : '') }, h('span', { class: 'tt-k ' + r.key }), h('strong', { text: r.value }), h('span', { text: r.name })))];
  if (total) kids.push(h('div', { class: 'tt-t' }, h('span', {}), h('strong', { text: total.value }), h('span', { text: total.name })));
  tip.replaceChildren(...kids);
}
function placeTip(wrap, tip, xPx) {
  const w = wrap.clientWidth, tw = tip.offsetWidth || 180;
  let left = xPx + 14;
  if (left + tw > w) left = Math.max(0, xPx - tw - 14);
  tip.style.left = left + 'px';
  tip.style.top = '8px';
  tip.classList.add('on');
}
function legendRow(items) {
  return h('div', { class: 'legend' }, items.map((x) => h('span', {}, h('span', { class: (x.line ? 'lk ' : 'sw ') + x.key }), x.name)));
}

function lineChart(series, opt) {
  opt = opt || {};
  const narrow = window.innerWidth < 640;
  const W = narrow ? 420 : 760, H = narrow ? 300 : opt.h || 300, L = 40, R = 14, T = 18, B = 28;
  const pts = series.flatMap((x) => x.points).filter((p) => isNum(p[0]) && isNum(p[1]));
  if (!pts.length) return h('div', { class: 'empty', text: 'No data.' });
  const xs = pts.map((p) => p[0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.max(...pts.map((p) => p[1])), 4);
  const y1 = ticks[ticks.length - 1];
  const X = (v) => L + ((v - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opt.label || 'chart' });
  for (const v of ticks) g.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid-line' }), s('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, tickTxt(v)));
  for (let v = Math.ceil(x0 / 10) * 10; v <= x1; v += 10) g.append(s('text', { x: X(v), y: H - 6, 'text-anchor': 'middle' }, v));
  const clean = series.map((se) => ({ ...se, p: se.points.filter((q) => isNum(q[0]) && isNum(q[1])).sort((a, b) => a[0] - b[0]) }));
  const smooth = (pp) => {
    const P = pp.map((q) => [X(q[0]), Y(q[1])]);
    if (P.length < 3) return P.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1)).join('');
    let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2, k = 0.18;
      d += `C${(p1[0] + (p2[0] - p0[0]) * k).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) * k).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) * k).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) * k).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  for (const se of clean) {
    if (!se.p.length || !se.area) continue;
    const fill = grad(g, 'gr-area ' + se.key, true);
    g.append(s('path', { d: smooth(se.p) + `L${X(se.p[se.p.length - 1][0]).toFixed(1)},${Y(0)}L${X(se.p[0][0]).toFixed(1)},${Y(0)}Z`, fill, class: 'area' }));
  }
  for (const se of clean) {
    if (!se.p.length) continue;
    g.append(s('path', { d: smooth(se.p), class: 'ln ' + se.key + (se.dash ? ' dash' : '') + (se.thin ? ' thin' : '') }));
  }
  for (const se of clean) if (se.dots) for (const q of se.p) g.append(s('circle', { cx: X(q[0]), cy: Y(q[1]), r: 3.5, class: 'dotm ' + se.key }));
  const cross = s('line', { y1: T, y2: H - B, class: 'cross' });
  const hl = s('g', { class: 'hl' });
  g.append(cross, hl);
  if (opt.ylabel) g.append(s('text', { x: 2, y: 10, class: 'ylab' }, opt.ylabel));
  const tip = vizTip();
  const wrap = h('div', { class: 'viz', tabindex: '0', 'aria-label': (opt.label || 'chart') + '. Use left and right arrow keys to read values.' }, g, tip);
  const years = [...new Set(clean.flatMap((se) => se.p.map((q) => q[0])))].sort((a, b) => a - b);
  let idx = -1;
  const show = (i) => {
    idx = Math.max(0, Math.min(years.length - 1, i));
    const yr = years[idx];
    cross.setAttribute('x1', X(yr)); cross.setAttribute('x2', X(yr)); cross.classList.add('on');
    hl.replaceChildren();
    const rows = [];
    for (const se of clean) {
      const q = se.p.find((pp) => pp[0] === yr);
      if (!q) continue;
      hl.append(s('circle', { cx: X(yr), cy: Y(q[1]), r: 4.5, class: 'dotm ' + se.key }));
      rows.push({ key: se.key, value: num(q[1], 2) + ' ' + (opt.unit || ''), name: se.name, dim: se.thin });
    }
    fillTip(tip, String(yr), rows);
    placeTip(wrap, tip, (X(yr) / W) * g.getBoundingClientRect().width);
  };
  const hide = () => { cross.classList.remove('on'); hl.replaceChildren(); tip.classList.remove('on'); };
  const fromEvent = (e) => {
    const r = g.getBoundingClientRect();
    const xv = x0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (x1 - x0);
    let best = 0;
    years.forEach((y, i) => { if (Math.abs(y - xv) < Math.abs(years[best] - xv)) best = i; });
    show(best);
  };
  g.addEventListener('pointermove', fromEvent);
  g.addEventListener('pointerdown', fromEvent);
  g.addEventListener('pointerleave', hide);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); show(idx < 0 ? years.length - 1 : idx + (e.key === 'ArrowRight' ? 1 : -1)); }
    if (e.key === 'Escape') hide();
  });
  wrap.addEventListener('blur', hide);
  return h('div', {}, wrap, legendRow(series.map((x) => ({ key: x.key, name: x.name, line: true }))));
}

function stackedBars(cats, groups, keys, opt) {
  opt = opt || {};
  const narrow = window.innerWidth < 640;
  const W = narrow ? 420 : 760, H = narrow ? 320 : opt.h || 300, L = 44, R = 10, T = 26, B = 28, GAP = 2, BAR = narrow ? 22 : 26;
  const tot = cats.map((c) => groups.reduce((a, gname) => a + (c.v[gname] || 0), 0));
  const ticks = niceTicks(Math.max(1, ...tot), 4);
  const y1 = ticks[ticks.length - 1];
  const band = (W - L - R) / cats.length;
  const X = (i) => L + (i + 0.5) * band;
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opt.label || 'bar chart' });
  for (const v of ticks) g.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid-line' }), s('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, tickTxt(v)));
  const tip = vizTip();
  const wrap = h('div', { class: 'viz' }, g, tip);
  const cols = [];
  cats.forEach((c, i) => {
    const col = s('g', { class: 'col', tabindex: '0', role: 'button',
      'aria-label': `${c.label}: total ${num(tot[i])} ${opt.unit || ''}. ` + groups.map((gn) => `${gn} ${num(c.v[gn] || 0)}`).join(', ') });
    col.append(s('rect', { x: X(i) - band / 2, y: T, width: band, height: H - T - B, class: 'hit' }));
    const segs = groups.map((gn) => ({ gn, v: c.v[gn] || 0 })).filter((x) => x.v > 0);
    let acc = 0;
    segs.forEach((sg, j) => {
      const yTop = Y(acc + sg.v), yBot = Y(acc);
      const top = j === segs.length - 1;
      const hgt = Math.max(0.5, yBot - yTop - (j > 0 ? GAP : 0));
      const yb = yBot - (j > 0 ? GAP : 0);
      const x = X(i) - BAR / 2, r = top ? Math.min(4, hgt) : 0;
      const d = `M${x},${yb}V${yb - hgt + r}${r ? `Q${x},${yb - hgt} ${x + r},${yb - hgt}` : ''}H${x + BAR - r}${r ? `Q${x + BAR},${yb - hgt} ${x + BAR},${yb - hgt + r}` : ''}V${yb}Z`;
      col.append(s('path', { d, class: 'seg ' + keys[sg.gn] }));
      acc += sg.v;
    });
    col.append(s('text', { x: X(i), y: Y(tot[i]) - 8, 'text-anchor': 'middle', class: 'cap' }, num(tot[i])));
    col.append(s('text', { x: X(i), y: H - 6, 'text-anchor': 'middle' }, c.label));
    const on = () => {
      cols.forEach((cc) => cc.classList.toggle('dim', cc !== col));
      fillTip(tip, c.label, [...groups].reverse().map((gn) => ({ key: keys[gn], value: num(c.v[gn] || 0) + ' t', name: gn })),
        { value: num(tot[i]) + ' t', name: 'total' });
      placeTip(wrap, tip, (X(i) / W) * g.getBoundingClientRect().width);
    };
    col.addEventListener('pointerenter', on);
    col.addEventListener('pointerdown', on);
    col.addEventListener('focus', on);
    cols.push(col);
    g.append(col);
  });
  const off = () => { cols.forEach((cc) => cc.classList.remove('dim')); tip.classList.remove('on'); };
  g.addEventListener('pointerleave', off);
  g.addEventListener('focusout', (e) => { if (!g.contains(e.relatedTarget)) off(); });
  if (opt.ylabel) g.append(s('text', { x: 2, y: 12, class: 'ylab' }, opt.ylabel));
  return h('div', {}, wrap, legendRow(groups.map((x) => ({ key: keys[x], name: x }))));
}

// ---------------------------------------------------------------- pages
function pageDashboard() {
  const { climate, nature, transport, actions } = S.data;
  const r245 = climate.risk.filter((r) => r.scenario === 'ssp245');
  const totalEur = r245.reduce((a, r) => a + (r.eur_risk_per_yr || 0), 0);
  const worst = r245.reduce((a, r) => (r.mean_yield_change_pct < a.mean_yield_change_pct ? r : a), r245[0]);
  const t25 = transport.summary.find((x) => x.year === 2025) || transport.summary[transport.summary.length - 1];
  const top = nature.catchments[0];
  const acts = actions.actions.map((a) => item('action:' + a.id, a.action, a.evidence, {
    files: a.sources,
    formula: a.lever ? `Lever ${a.lever.lever_id}: ${a.lever.lever_name} (${a.lever.value_status})` : 'TerraTrace model result',
    assumptions: a.lever ? ['Lever abatement and cost are design estimates from decarbonisation_levers.csv'] : [],
  }));
  const nr = actions.not_a_reduction;
  const dv = transport.dev_inventory_check['2024'];
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const drafts = draftCount();
  const chainOk = !!(S.audit && S.audit.chain_valid);
  return [
    h('section', { class: 'hero' },
      h('div', { class: 'hero-main' },
        h('div', { class: 'eyebrow', text: 'Climate & Nature Navigator · Apetit' }),
        h('h1', { text: `${hello}, ${S.me.email.split('@')[0]}` }),
        h('p', { text: 'Where climate and nature put the supply at risk, what it costs in euros and tonnes, and what to do next week. Every number traces back to its source.' }),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn light', href: '#/copilot' }, icon('spark'), 'Ask the Copilot'),
          can('see_corrections') ? h('a', { class: 'btn glass', href: '#/review' }, icon('check'), `Review drafts (${drafts})`) : h('a', { class: 'btn glass', href: '#/climate' }, icon('cloud'), 'Open climate risk'))),
      h('div', { class: 'hero-side' },
        h('div', { class: 'hs-item' }, h('div', { class: 'hs-val', text: String(actions.actions.length) }), h('div', { class: 'hs-lbl', text: 'actions for next week' })),
        h('div', { class: 'hs-item' }, h('div', { class: 'hs-val', text: 'SSP2-4.5' }), h('div', { class: 'hs-lbl', text: '2041–2060 vs 1991–2020' })),
        h('div', { class: 'hs-item' }, h('div', { class: 'hs-val' + (chainOk ? ' ok' : ''), text: chainOk ? 'Intact' : 'Check' }), h('div', { class: 'hs-lbl', text: 'audit trail (hash chain)' })))),
    h('div', { class: 'grid g4' },
      stat('euro', 'c-green', 'Climate risk to contract crops', eur(totalEur) + ' / yr', 'Replacement cost of the expected shortfall (SSP2-4.5)'),
      stat('trend', 'c-red', 'Largest yield loss', `${CROPS[worst.crop]} ${pct(worst.mean_yield_change_pct)}`, `${REG[worst.region]} · bad-year probability ${num(worst.p_bad_year * 100)} %`),
      stat('co2', 'c-amber', 'Transport CO₂e ' + t25.year, num(t25.cat4_corrected_tco2e + t25.cat9_tco2e) + ' t', 'Scope 3 cat 4 + cat 9, incl. corrected missing legs'),
      stat('drop', 'c-blue', 'Top nature priority', `${top.catchment_id} · ${top.region === 'FI_SW' ? 'Finland' : 'Sweden'}`, `${num(top.p_kg)} kg P and ${num(top.n_kg)} kg N to water (2025), status ${top.status}`)),
    card('Next-week action list', 'What to do next week: euros, tonnes, an owner and a first step', h('div', { class: 'card-b' }, h('div', { class: 'alist' },
      actions.actions.map((a, i) => h('article', { class: 'act' },
        h('div', { class: 'act-n', text: a.priority }),
        h('div', { class: 'act-main' },
          h('div', { class: 'act-top' }, h('span', { class: 'pill tag', text: a.area }), h('span', { class: 'owner' }, icon('user'), a.owner)),
          h('h3', { text: a.action }),
          h('p', { class: 'act-ev', text: a.evidence })),
        h('div', { class: 'act-next' }, h('span', { class: 'lbl' }, icon('arrow'), 'Next week'), h('p', { text: a.next_week })),
        h('div', { class: 'act-fig' },
          h('div', { class: 'fig' }, h('strong', { text: eur(a.eur_per_yr) }), h('span', { text: a.eur_label || '€ per year' })),
          h('div', { class: 'fig' }, h('strong', { text: isNum(a.tco2e) ? num(a.tco2e) + ' t' : '–' }), h('span', { text: 't CO₂e per year' }))),
        h('div', { class: 'act-rev' }, controls(acts[i], true))))))),
    h('div', { class: 'grid g2' },
      card('Not a reduction', 'Honest accounting', h('div', { class: 'card-b' }, h('p', { text: nr.note }), h('p', { class: 'small muted', text: `Lever ${nr.lever.lever_id}: ${nr.lever.lever_name}` }))),
      card('Reliability checks', 'Our results against Apetit\'s public development keys', h('div', { class: 'card-b' }, h('ul', {},
        h('li', { text: `Transport 2024: category 4 ${num(dv.cat4_ours, 1)} t vs ${num(dv.cat4_truth, 1)} t; category 9 ${num(dv.cat9_ours, 1)} t vs ${num(dv.cat9_truth, 1)} t.` }),
        h('li', { text: `Missing sea legs on 2023–2024 dev labels: ${transport.dev_check.correct} of ${transport.dev_check.true_labels} found, precision ${num(transport.dev_check.precision * 100)} %.` }),
        h('li', { text: `Nature D1 dev score ${num(nature.calibration.dev_score.score, 1)} (package baseline ${num(nature.calibration.baseline_dev_score, 1)}), calibrated on the 6 dev catchments.` }),
        h('li', { text: 'Yield model beats the farm-average baseline in the 2023–2026 back-test for every crop.' }))))),
  ];
}

function pageClimate() {
  const { climate } = S.data;
  const sel = S.ui.climate;
  const combos = [...new Set(climate.risk.map((r) => r.region + '|' + r.crop))];
  if (!combos.includes(sel.combo)) sel.combo = combos[0];
  const pick = h('select', { 'aria-label': 'Crop', onchange: (e) => { sel.combo = e.target.value; render(); } },
    combos.map((c) => { const [r, cr] = c.split('|'); return h('option', { value: c, selected: c === sel.combo, text: `${CROPS[cr]} – ${REG[r]}` }); }));
  const scen = h('div', { class: 'seg-ctl', role: 'radiogroup', 'aria-label': 'Climate scenario' },
    Object.entries(SCEN).map(([k, v]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(k === sel.scen), class: k === sel.scen ? 'on' : null,
      title: v, onclick: () => { sel.scen = k; render(); } }, v.split(' ')[0])));
  const [reg, crop] = sel.combo.split('|');
  const ser = climate.series.filter((x) => x.region === reg && x.crop === crop);
  const obs = climate.observed_yield.filter((x) => x.region === reg && x.crop === crop);
  const c1 = climate.c1_summary.filter((x) => x.region === reg && x.crop === crop);
  const others = ['ssp126', 'ssp245', 'ssp585'].filter((k) => k !== sel.scen);
  const lines = [
    { key: 'cobs', name: 'Observed (farm data)', points: obs.map((x) => [x.year, x.yield_t_ha]), dots: true },
    { key: 'cmod', name: 'Model, 1991–2020 weather', points: ser.filter((x) => x.scenario === 'historical').map((x) => [x.year, x.yield_t_ha]), thin: true },
    { key: 'c1', name: 'C1 forecast 2027–2031 (SSP2-4.5)', points: c1.map((x) => [x.year, x.yield_t_ha]), dots: true, area: true },
    { key: 'c5', name: SCEN[sel.scen] + ', 2041–2060', points: ser.filter((x) => x.scenario === sel.scen).map((x) => [x.year, x.yield_t_ha]), area: true },
    ...others.map((k) => ({ key: 'cctx', name: SCEN[k].split(' ')[0] + ' (for comparison)', points: ser.filter((x) => x.scenario === k).map((x) => [x.year, x.yield_t_ha]), dash: true, thin: true })),
  ];
  const rows = climate.risk.filter((r) => r.scenario === sel.scen);
  return [
    pageHead('Climate risk to farming', 'How a changing climate affects contract-crop yields, what the shortfall costs, and what reduces it (tasks C1, C2, C3).', h('div', { class: 'toolbar' }, pick, scen)),
    card('Yield per hectare (t/ha)', `${CROPS[crop]} – ${REG[reg]}`, h('div', { class: 'card-b' }, lineChart(lines, { ylabel: 't/ha', unit: 't/ha', label: 'Yield per hectare by year' }))),
    card(`All crops – ${SCEN[sel.scen]}`, '2041–2060 compared with 1991–2020', h('div', { class: 'card-b tight' },
      table(['Crop', 'Region', 'Yield change', 'Bad-year prob.', 'Shortfall t/yr', 'Price €/t × premium', '€ risk / yr', 'Saved by irrigation / yr', 'Review'], [2, 3, 4, 5, 6, 7],
        rows.map((r) => {
          const it = item(`risk:${r.region}:${r.crop}:${r.scenario}`, `${CROPS[r.crop]} ${REG[r.region]} ${r.scenario}`,
            `Yield ${pct(r.mean_yield_change_pct)}, shortfall ${num(r.expected_shortfall_t_per_yr)} t/yr, risk ${eur(r.eur_risk_per_yr)}/yr`,
            { formula: r.formula, files: r.sources, assumptions: r.assumptions, standard: climate.method.standards });
          return h('tr', {}, h('td', { class: 'strong', text: CROPS[r.crop] }), h('td', { text: REG[r.region] }),
            h('td', { class: 'num', text: pct(r.mean_yield_change_pct) }), h('td', { class: 'num', text: num(r.p_bad_year * 100) + ' %' }),
            h('td', { class: 'num', text: num(r.expected_shortfall_t_per_yr) }),
            h('td', { class: 'num', text: `${num(r.contract_price_eur_t, 1)} × ${num(r.replacement_premium_frac, 2)}` }),
            h('td', { class: 'num strong', text: eur(r.eur_risk_per_yr) }),
            h('td', { class: 'num', title: r.irrigation_note, text: isNum(r.eur_saved_by_irrigation_per_yr) ? eur(r.eur_saved_by_irrigation_per_yr) : 'not enough data' }),
            h('td', {}, controls(it)));
        })),
      h('p', { class: 'small muted', style: 'padding:10px 20px;margin:0', text: '€ risk counts the shortfall in bad years, so a crop can carry risk even when its average yield rises.' }))),
    h('div', { class: 'grid g2' },
      card('Back-test', 'Trained 2012–2022, tested 2023–2026', h('div', { class: 'card-b tight' },
        table(['Crop', 'Region', 'Model error', 'Farm-average baseline'], [2, 3],
          climate.backtest.map((b) => h('tr', {}, h('td', { text: CROPS[b.crop] }), h('td', { text: REG[b.region] }),
            h('td', { class: 'num strong', text: num(b.model_mape_pct, 1) + ' %' }), h('td', { class: 'num', text: num(b.baseline_mape_pct, 1) + ' %' })))))),
      card('Method', 'How the numbers are made', h('div', { class: 'card-b' }, methodBox('Climate model', climate.method),
        h('p', { class: 'small muted', text: 'Adaptation: irrigation is modelled from history. Earlier sowing and tolerant varieties are not modelled. A wider sourcing area is action 1 on the Dashboard.' })))),
  ];
}

function pageNature() {
  const { nature } = S.data;
  const byId = Object.fromEntries(nature.catchments.map((c) => [c.catchment_id, c]));
  const sel = S.ui.nature;
  const feats = nature.geojson.features.filter((f) => f.geometry && f.geometry.type === 'Polygon');
  const color = (c) => (!c || c.p_kg <= 0 ? '#e6eadf' : c.rank <= 5 ? '#b8520a' : c.rank <= 12 ? '#e07a1f' : c.rank <= 25 ? '#f3ad62' : '#fbe3c6');
  const panel = (region) => {
    const fs = feats.filter((f) => f.properties.region === region);
    if (!fs.length) return null;
    let minX = 180, maxX = -180, minY = 90, maxY = -90;
    for (const f of fs) for (const [x, y] of f.geometry.coordinates[0]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
    const W = 400, sc = W / ((maxX - minX) * k), H = Math.round((maxY - minY) * sc);
    const svg = s('svg', { viewBox: `-2 -2 ${W + 4} ${H + 4}`, class: 'chart map', role: 'img', 'aria-label': 'Catchment priority map ' + REG[region] });
    for (const f of fs) {
      const id = f.properties.catchment_id, c = byId[id];
      const d = f.geometry.coordinates[0].map((p, i) => (i ? 'L' : 'M') + ((p[0] - minX) * k * sc).toFixed(1) + ',' + ((maxY - p[1]) * sc).toFixed(1)).join('') + 'Z';
      const path = s('path', { d, fill: color(c), class: sel.id === id ? 'sel' : null }, s('title', {}, c ? `${id}: rank ${c.rank}, P ${num(c.p_kg)} kg, N ${num(c.n_kg)} kg, ${c.status}` : id));
      path.addEventListener('click', () => { sel.id = id; render(); });
      svg.append(path);
    }
    return h('div', {}, h('div', { class: 'small muted', text: REG[region] }), svg);
  };
  const cur = byId[sel.id] || nature.catchments[0];
  const cal = nature.calibration;
  const facts = [
    ['Region', REG[cur.region]], ['Receiving water', cur.water_type], ['Ecological status', `${cur.status} (weight ${cur.state_weight})`],
    ['P sensitivity', String(cur.p_sensitivity)], ['Apetit contract area 2025', `${num(cur.contract_area_ha)} ha in ${cur.parcels} parcels`],
    ['P to water', num(cur.p_kg, 1) + ' kg'], ['N to water', num(cur.n_kg) + ' kg'],
    ['Monitored outlet load 2025 (all sources)', isNum(cur.monitored_total_p_kg_2025) ? `${num(cur.monitored_total_p_kg_2025)} kg P, ${num(cur.monitored_total_n_kg_2025)} kg N` : 'no station'],
    ['Priority score', num(cur.priority_score, 2)],
  ];
  return [
    pageHead('Nature: nutrient pressure on waters', 'Phosphorus (P) and nitrogen (N) from Apetit contract parcels reaching lakes and rivers in 2025, and where to act first (SBTN step 2, task D1).'),
    h('div', { class: 'grid g2' },
      card('Priority map', 'Click a catchment', h('div', { class: 'card-b' }, h('div', { class: 'maps' }, panel('FI_SW'), panel('SE_SKANE')),
        h('div', { class: 'legend' }, [['#b8520a', 'Priority 1–5 (act first)'], ['#e07a1f', '6–12'], ['#f3ad62', '13–25'], ['#fbe3c6', '26+ (lower)'], ['#e6eadf', 'No Apetit parcels']]
          .map(([c, t]) => h('span', {}, h('span', { class: 'sw', style: 'background:' + c }), t))),
        h('p', { class: 'small muted', text: 'Synthetic catchment polygons placed in the real sourcing regions (not to the same scale).' }))),
      card(`${cur.catchment_id} – rank ${cur.rank}`, 'Catchment details', h('div', { class: 'card-b' },
        h('table', { class: 'kv' }, h('tbody', {}, facts.map(([a, b]) => h('tr', {}, h('th', { text: a }), h('td', { text: b }))))),
        h('div', { style: 'height:12px' }),
        methodBox('Method', { formula: nature.method.formula, standard: nature.method.standard, actions: nature.method.actions }),
        h('p', { class: 'small muted', text: `Calibration: decay length ${cal.decay_length_m} m; dev score ${num(cal.dev_score.score, 1)} vs baseline ${cal.baseline_dev_score}. ${cal.note}` })))),
    card('Top 10 catchments', 'Pressure × state of nature', h('div', { class: 'card-b tight' },
      table(['#', 'Catchment', 'Region', 'P kg', 'N kg', 'Status', 'Score', 'Review'], [3, 4, 6],
        nature.catchments.slice(0, 10).map((c) => {
          const it = item('nature:' + c.catchment_id, `Catchment ${c.catchment_id} priority`, `Rank ${c.rank}: ${num(c.p_kg, 1)} kg P, ${num(c.n_kg)} kg N, status ${c.status}`,
            { formula: nature.method.formula, standard: nature.method.standard, files: nature.method.sources, assumptions: [nature.method.loads] });
          return h('tr', {}, h('td', { class: 'idx', text: c.rank }),
            h('td', {}, h('button', { class: 'btn sm', type: 'button', text: c.catchment_id, onclick: () => { sel.id = c.catchment_id; render(); } })),
            h('td', { text: REG[c.region] }), h('td', { class: 'num', text: num(c.p_kg, 1) }), h('td', { class: 'num', text: num(c.n_kg) }),
            h('td', {}, h('span', { class: 'pill tag', text: c.status })), h('td', { class: 'num strong', text: num(c.priority_score, 2) }), h('td', {}, controls(it)));
        })))),
  ];
}

// Transport: total + trend on the left, every mode as a row (CO2 share vs freight share) on the right.
const MODE_INFO = {
  truck: { name: 'Truck', sub: 'Road, ambient', icon: 'truck', key: 'c1' },
  'truck-reefer': { name: 'Reefer truck', sub: 'Road, chilled / frozen', icon: 'truck', key: 'c2', cold: true },
  ropax: { name: 'Ro-pax ferry', sub: 'Truck on a ferry', icon: 'ferry', key: 'c3' },
  'ship-bulk': { name: 'Bulk ship', sub: 'Sea, dry bulk', icon: 'ship', key: 'c4' },
  'ship-reefer': { name: 'Reefer ship', sub: 'Sea, chilled container', icon: 'ship', key: 'c5', cold: true },
};
function deltaChip(now, before, label) {
  if (!isNum(now) || !isNum(before) || !before) return null;
  const d = ((now - before) / before) * 100;
  const up = d > 0.05, flat = Math.abs(d) <= 0.05;
  return h('span', { class: 'delta ' + (flat ? 'flat' : up ? 'bad' : 'good'), title: `Change ${label}` },
    flat ? null : icon(up ? 'up' : 'down'), `${d > 0 ? '+' : ''}${num(d, 1)} % ${label}`);
}
let _gid = 0;
function grad(svg, cls, vertical) {
  // gradient colours come from CSS classes (stop-color), so light/dark mode both work
  const id = 'g' + (++_gid);
  let defs = svg.querySelector('defs');
  if (!defs) { defs = s('defs', {}); svg.prepend(defs); }
  defs.append(s('linearGradient', { id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0, class: cls },
    s('stop', { offset: '0', class: 'g0' }), s('stop', { offset: '1', class: 'g1' })));
  return `url(#${id})`;
}
function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

function transportPanel(transport) {
  const years = transport.summary.map((r) => r.year);
  const st = S.ui.transport = S.ui.transport || {};
  if (!years.includes(st.year)) st.year = years[years.length - 1];
  const yr = st.year, iy = years.indexOf(yr);
  const pick = (y) => { st.year = y; render(); };
  const rowsY = (y) => transport.by_mode.filter((r) => r.year === y);
  const sum = (arr, f) => arr.reduce((a, r) => a + (r[f] || 0), 0);
  const totals = years.map((y) => sum(rowsY(y), 'tco2e'));
  const cur = rowsY(yr), total = totals[iy], tkmAll = sum(cur, 'tkm');
  const sm = transport.summary[iy];
  const inb = sum(cur.filter((r) => r.direction === 'inbound'), 'tco2e');

  // ---- overview: KPI grid + rounded "pill" columns (this year vs previous year)
  const kpi = (label, value, note) => h('div', { class: 'kp' }, h('span', { text: label }), h('strong', { text: value }), note ? h('small', { text: note }) : null);
  const left = h('div', { class: 'ov-left' },
    h('div', { class: 'ov-lbl', text: `Transport legs · ${yr}` }),
    h('div', { class: 'ov-hero' }, h('strong', { text: num(total) }), h('span', { text: 't CO₂e' }),
      iy > 0 ? deltaChip(total, totals[iy - 1], '') : null),
    h('div', { class: 'kp-grid' },
      kpi('Inbound (cat 4)', num(inb) + ' t'),
      kpi('Outbound (cat 9)', num(total - inb) + ' t'),
      kpi('Warehousing', num(sm.cat9_warehousing_tco2e) + ' t', 'frozen, third party'),
      kpi('Shipments', num(sum(cur, 'shipments'))),
      kpi('Avg. intensity', num((total * 1e6) / tkmAll) + ' g/tkm'),
      kpi('Missing legs added', num(sm.missing_leg_tco2e, 1) + ' t', 'auto-corrected')));

  const narrow = window.innerWidth < 640;
  const W = narrow ? 380 : 640, H = 280, L = 44, R = 8, T = 30, B = 30;
  const ticks = niceTicks(Math.max(...totals), 4), y1 = ticks[ticks.length - 1];
  const band = (W - L - R) / years.length, PW = narrow ? 12 : 16;
  const X = (i) => L + (i + 0.5) * band;
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart pills', role: 'img', 'aria-label': 'Transport CO2e per year: ' + years.map((y, i) => `${y} ${num(totals[i])} t`).join(', ') });
  const gMain = grad(svg, 'gr-brand', true), gSel = grad(svg, 'gr-earth', true), gGhost = grad(svg, 'gr-ghost', true);
  const kTxt = (v) => (y1 >= 10000 ? (v ? num(v / 1000) + 'K' : '0') : tickTxt(v));
  for (const v of ticks) svg.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'grid-line' }), s('text', { x: L - 8, y: Y(v) + 4, 'text-anchor': 'end' }, kTxt(v)));
  const tip = vizTip();
  const wrap = h('div', { class: 'viz' }, svg, tip);
  years.forEach((y, i) => {
    const on = y === yr;
    const g = s('g', { class: 'pcol' + (on ? ' on' : ''), tabindex: '0', role: 'button', 'aria-pressed': String(on), 'aria-label': `${y}: ${num(totals[i])} t CO2e` });
    g.append(s('rect', { x: X(i) - band / 2, y: T - 20, width: band, height: H - T - B + 20, class: 'hit' }));
    if (i > 0) g.append(s('rect', { x: X(i) - PW - 3, y: Y(totals[i - 1]), width: PW, height: Y(0) - Y(totals[i - 1]), rx: PW / 2, fill: gGhost }));
    g.append(s('rect', { x: X(i) + (i > 0 ? 3 : -PW / 2), y: Y(totals[i]), width: PW, height: Y(0) - Y(totals[i]), rx: PW / 2, fill: on ? gSel : gMain }));
    if (on) g.append(s('text', { x: X(i) + (i > 0 ? 3 + PW / 2 : 0), y: Y(totals[i]) - 9, 'text-anchor': 'middle', class: 'pv' }, num(totals[i])));
    g.append(s('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', class: on ? 'px on' : 'px' }, y));
    const show = () => {
      fillTip(tip, String(y), [{ key: 'kbrand', value: num(totals[i]) + ' t', name: 'this year' }].concat(i > 0 ? [{ key: 'kghost', value: num(totals[i - 1]) + ' t', name: String(years[i - 1]) }] : []));
      placeTip(wrap, tip, (X(i) / W) * svg.getBoundingClientRect().width);
    };
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('click', () => pick(y));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(y); } });
    svg.append(g);
  });
  svg.addEventListener('pointerleave', () => tip.classList.remove('on'));
  const legend = h('div', { class: 'legend' }, h('span', {}, h('span', { class: 'sw kbrand' }), 'Total t CO₂e'), h('span', {}, h('span', { class: 'sw kghost' }), 'Previous year'),
    h('span', {}, h('span', { class: 'sw kearth' }), 'Selected year (tap a column)'));
  const pills = h('div', { class: 'seg-ctl', role: 'radiogroup', 'aria-label': 'Year' },
    years.map((y) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(y === yr), class: y === yr ? 'on' : null, onclick: () => pick(y) }, String(y))));
  const overview = card('Transport overview', 'Scope 3 categories 4 and 9, from shipment legs', h('div', { class: 'card-b' }, h('div', { class: 'ov' }, left, h('div', { class: 'ov-chart' }, wrap, legend))), pills);

  // ---- mode mix: donut with rounded, gapped segments
  const modes = Object.keys(MODE_INFO).map((m) => ({ m, co2: sum(cur.filter((r) => r.mode === m), 'tco2e'), tkm: sum(cur.filter((r) => r.mode === m), 'tkm'),
    prev: iy > 0 ? sum(rowsY(years[iy - 1]).filter((r) => r.mode === m), 'tco2e') : null })).sort((a, b) => b.co2 - a.co2);
  const D = 220, cx = D / 2, cy = D / 2, rr = 80, gap = 0.05;
  const dsvg = s('svg', { viewBox: `0 0 ${D} ${D}`, class: 'chart donut', role: 'img', 'aria-label': 'Share of CO2 by mode: ' + modes.map((x) => `${MODE_INFO[x.m].name} ${num((x.co2 / total) * 100)} %`).join(', ') });
  dsvg.append(s('circle', { cx, cy, r: rr, class: 'track' }));
  const dtip = vizTip();
  const dwrap = h('div', { class: 'viz donut-wrap' }, dsvg, dtip,
    h('div', { class: 'donut-c' }, h('strong', { text: num(total) }), h('span', { text: `t CO₂e · ${yr}` })));
  let a = -Math.PI / 2;
  for (const x of modes) {
    const frac = x.co2 / total, a1 = a + frac * Math.PI * 2;
    if (frac > 0.004) {
      const seg = s('path', { d: arcPath(cx, cy, rr, a + gap / 2, Math.max(a + gap / 2 + 0.001, a1 - gap / 2)), class: 'dseg ' + MODE_INFO[x.m].key, stroke: grad(dsvg, 'gr-mode ' + MODE_INFO[x.m].key, false), tabindex: '0',
        'aria-label': `${MODE_INFO[x.m].name}: ${num(x.co2)} t, ${num(frac * 100)} %` });
      const on = () => { fillTip(dtip, MODE_INFO[x.m].name, [{ key: MODE_INFO[x.m].key, value: `${num(x.co2)} t`, name: `${num(frac * 100)} % of CO₂` }]); placeTip(dwrap, dtip, dwrap.clientWidth / 2 - 90); };
      seg.addEventListener('pointerenter', on); seg.addEventListener('focus', on);
      dsvg.append(seg);
    }
    a = a1;
  }
  dsvg.addEventListener('pointerleave', () => dtip.classList.remove('on'));
  const mix = card('Mode mix', `Share of CO₂ by transport mode, ${yr}`, h('div', { class: 'card-b' }, dwrap,
    h('div', { class: 'dleg' }, modes.map((x) => h('div', {}, h('span', { class: 'sw ' + MODE_INFO[x.m].key }), h('span', { text: MODE_INFO[x.m].name }), h('strong', { text: num((x.co2 / total) * 100) + ' %' }))))));

  // ---- ranked list: CO2 vs freight
  const top = card('Top emitting modes', 'CO₂ compared with the freight each mode moves', h('div', { class: 'card-b' }, h('div', { class: 'rank' },
    modes.map((x, i) => {
      const mi = MODE_INFO[x.m], gpt = x.tkm ? (x.co2 * 1e6) / x.tkm : null;
      return h('div', { class: 'rk ' + mi.key, tabindex: '0', 'aria-label': `Rank ${i + 1}: ${mi.name}, ${num(x.co2)} t, ${num((x.tkm / tkmAll) * 100)} % of freight` },
        h('span', { class: 'rk-n', text: '#' + (i + 1) }),
        h('div', { class: 'rk-t' }, h('strong', {}, mi.name, mi.cold ? h('span', { class: 'cold-i', title: 'chilled / frozen' }, icon('snow')) : null),
          h('span', { text: `${num((x.tkm / tkmAll) * 100)} % of freight · ${gpt ? num(gpt) : '–'} g/tkm` })),
        h('div', { class: 'rk-v' }, h('span', { class: 'rk-pill', text: num(x.co2) + ' t' }), x.prev ? deltaChip(x.co2, x.prev, '') : null));
    }))));

  // ---- gauge: how much HVO100 could cut (upper bound)
  const saved = transport.hvo_whatif_2025_tco2e_saved, base25 = totals[years.indexOf(2025)] || totals[totals.length - 1];
  const share = isNum(saved) && base25 ? Math.min(1, saved / base25) : 0;
  const GW = 240, GH = 140, gr = 96, gcx = GW / 2, gcy = 124;
  const gsvg = s('svg', { viewBox: `0 0 ${GW} ${GH}`, class: 'chart gauge', role: 'img', 'aria-label': `HVO100 could cut up to ${num(share * 100)} % of 2025 transport CO2` });
  const gG = grad(gsvg, 'gr-gauge', false);
  gsvg.append(s('path', { d: arcPath(gcx, gcy, gr, Math.PI, 2 * Math.PI - 0.0001), class: 'g-track' }),
    s('path', { d: arcPath(gcx, gcy, gr, Math.PI, Math.PI + share * Math.PI), class: 'g-val', stroke: gG }),
    s('text', { x: gcx, y: gcy - 18, 'text-anchor': 'middle', class: 'g-pct' }, num(share * 100) + ' %'));
  const a5 = ((S.data.actions && S.data.actions.actions) || []).find((x) => x.lever && x.lever.lever_id === 'L20');
  const gauge = card('HVO100 potential', 'If all road legs ran on HVO100 (2025)', h('div', { class: 'card-b gauge-b' }, gsvg,
    h('strong', { class: 'g-big', text: isNum(saved) ? `−${num(saved)} t CO₂e` : '–' }),
    h('span', { class: 'muted small', text: 'of 2025 transport CO₂ (upper bound, design estimate, lever L20)' }),
    a5 && isNum(a5.eur_per_yr) ? h('div', { class: 'g-cost' }, h('span', { class: 'delta bad', text: '≈ ' + eur(a5.eur_per_yr) + ' / yr' }), h('span', { class: 'small muted', text: 'extra fuel cost' })) : null));

  return [overview, h('div', { class: 'grid g3' }, mix, top, gauge)];
}

function pageTransport() {
  const { transport } = S.data;
  const m = transport.method;
  const yItems = transport.summary.map((sm) => item('transport:' + sm.year, `Transport CO₂e ${sm.year}`, `Cat 4 ${num(sm.cat4_corrected_tco2e, 1)} t, cat 9 ${num(sm.cat9_tco2e, 1)} t`,
    { formula: m.formula, standard: m.standard, files: m.sources, assumptions: m.assumptions }));
  return [
    pageHead('Transport CO₂e', 'Scope 3 categories 4 and 9, calculated automatically from shipment legs instead of manual distance look-ups.'),
    ...transportPanel(transport),
    card('Yearly totals (t CO₂e)', 'Category 9 includes third-party frozen warehousing', h('div', { class: 'card-b tight' },
      table(['Year', 'Cat 4 raw', 'Added: missing sea legs', 'Cat 4 corrected', 'Cat 9 transport', 'Cat 9 warehousing', 'Cat 9 total', 'Review'], [1, 2, 3, 4, 5, 6],
        transport.summary.map((r, i) => h('tr', {}, h('td', { class: 'strong', text: r.year }), h('td', { class: 'num', text: num(r.cat4_raw_tco2e, 1) }),
          h('td', { class: 'num', text: num(r.missing_leg_tco2e, 1) }), h('td', { class: 'num strong', text: num(r.cat4_corrected_tco2e, 1) }),
          h('td', { class: 'num', text: num(r.cat9_transport_tco2e, 1) }), h('td', { class: 'num', text: num(r.cat9_warehousing_tco2e, 1) }),
          h('td', { class: 'num strong', text: num(r.cat9_tco2e, 1) }), h('td', {}, controls(yItems[i]))))))),
    h('div', { class: 'grid g2' },
      card(`Data quality: missing sea legs`, `Dev check: ${transport.dev_check.correct}/${transport.dev_check.true_labels} found, precision ${num(transport.dev_check.precision * 100)} %`, h('div', { class: 'card-b tight' },
        can('see_details')
          ? table(['Record key', 'Year', 'Origin', 'Estimated tkm'], [3], transport.missing_legs.slice().reverse().map((r) => h('tr', {}, h('td', {}, h('code', { text: r.record_key })),
            h('td', { text: r.year }), h('td', { text: r.origin }), h('td', { class: 'num', text: num(r.est_tkm) }))), 'No missing legs found.')
          : h('div', { class: 'empty', text: 'Record-level details are visible to reviewers, farm advisors and admins.' }))),
      card('Method and factors', 'kg CO₂e per tonne-km, well-to-wheel', h('div', { class: 'card-b' }, methodBox('Method', { formula: m.formula, standard: m.standard }),
        h('table', { class: 'kv' }, h('tbody', {}, Object.entries(transport.factors).map(([key, f]) => h('tr', {},
          h('td', {}, h('code', { text: key })), h('td', { class: 'small', text: f.name }), h('td', { class: 'num', text: num(f.kg_per_tkm, 3) }))))),
        h('p', { class: 'small muted', text: 'Source: emission_factor_library.csv (GLEC Framework style, calibrated_synthetic).' })))),
  ];
}

function pageCopilot() {
  const st = S.ui.copilot;
  const prepared = (S.health && S.health.prepared) || [];
  const out = h('div', { class: 'chat', 'aria-live': 'polite', id: 'chat-out' }, st.answer || 'Ask a question about the results. Answers name their evidence (file and row).');
  const info = h('p', { class: 'small muted', id: 'chat-info', text: st.info || '' });
  const ta = h('textarea', { maxlength: MAX_Q, placeholder: 'For example: Compare pea risk in Finland and Sweden under SSP5-8.5.', 'aria-label': 'Question' });
  ta.value = st.q || '';
  const count = h('span', { class: 'small muted', text: `${ta.value.length} / ${MAX_Q}` });
  const send = h('button', { class: 'btn primary', type: 'button', disabled: st.busy }, icon('bot'), st.busy ? 'Thinking…' : 'Ask');
  ta.addEventListener('input', () => { st.q = ta.value; count.textContent = `${ta.value.length} / ${MAX_Q}`; });
  const ask = async (q) => {
    q = (q || '').trim();
    if (!q) { info.textContent = 'Please type a question.'; return; }
    if (q.length > MAX_Q) { info.textContent = `Please keep your question under ${MAX_Q} characters.`; return; }
    if (st.busy) return;
    st.q = q; st.busy = true; st.answer = ''; st.info = 'Waiting for the answer…';
    render();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 100000);
    try {
      const res = await api('/api/chat', { method: 'POST', body: { question: q }, raw: true, signal: ctl.signal });
      if (res.status === 401) { S.me = null; renderLogin('Your session has ended. Please sign in again.'); return; }
      if (!res.ok) {
        let msg = 'The AI is not available right now. Please try again.';
        try { const j = await res.json(); if (j && typeof j.error === 'string') msg = j.error; } catch (e) { /* keep default */ }
        st.info = msg;
      } else {
        st.info = res.headers.get('X-Answer-Source') === 'prepared' ? 'Prepared answer, calculated directly from the pipeline results (no AI).' : 'AI answer (draft). Check the evidence before you use it.';
        const infoNow = document.getElementById('chat-info'); if (infoNow) infoNow.textContent = st.info;
        const reader = res.body.getReader(); const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          st.answer += dec.decode(value, { stream: true });
          const el = document.getElementById('chat-out'); if (el) el.textContent = st.answer;
        }
        st.answer += dec.decode();
        if (!st.answer.trim()) st.info = 'The AI returned an empty answer. Please try again.';
      }
    } catch (e) {
      st.info = 'The AI is taking too long or the server is not running. Please try again.';
    } finally {
      clearTimeout(timer); st.busy = false;
      if (S.me) render();
    }
  };
  send.addEventListener('click', () => ask(ta.value));
  return [
    pageHead('AI Copilot', 'Ask in plain English. The Copilot only uses TerraTrace results and the framework digest, and names its evidence. It can read data, never change it.'),
    card('Suggested questions', 'Instant answers calculated from the results (no AI needed)', h('div', { class: 'card-b' },
      h('div', { class: 'chips' }, prepared.length ? prepared.map((q) => h('button', { class: 'chip', type: 'button', text: q, disabled: st.busy, onclick: () => ask(q) })) : h('span', { class: 'muted', text: 'Not available.' })))),
    card('Ask your own question', S.health && S.health.ai_configured ? `Model: ${S.health.model} · max ${MAX_Q} characters · 10 questions per minute` : 'Free-text AI is off (no API key on the server). Suggested questions still work.',
      h('div', { class: 'card-b' }, ta, h('div', { class: 'toolbar', style: 'margin:8px 0' }, count, h('span', { class: 'spacer', style: 'flex:1' }), send), info, out)),
  ];
}

function releaseCard(approved) {
  const r = S.release || {};
  const has = !r.error && r.signed_at;
  const changed = (r.files || []).filter((f) => f.state !== 'OK');
  const signIt = async () => {
    try { S.release = await api('/api/release/sign', { method: 'POST', body: {} }); await refreshReviews(); render(); }
    catch (e) { if (e.message !== 'signed out') openDialog(h('h3', { text: 'Not signed' }), h('p', { text: e.message }), h('div', { class: 'dlg-actions' }, closeBtn())); }
  };
  const badge = !has ? h('span', { class: 'delta flat', text: 'Not signed yet' })
    : r.ok ? h('span', { class: 'delta good' }, icon('check'), 'Signature valid · nothing changed')
      : h('span', { class: 'delta bad' }, icon('x'), 'Changed after signing');
  return card('Signed results (digital signature)', 'Ed25519 signature over the SHA-256 hash of every result file and every approval', h('div', { class: 'card-b' },
    h('div', { class: 'sig' },
      h('div', { class: 'sig-ico' + (has && r.ok ? ' ok' : '') }, icon('lock')),
      h('div', { class: 'sig-main' }, badge,
        has ? h('p', { class: 'small muted', text: `Signed ${localTime(r.signed_at)} · ${r.approved_results} approved results · key ${r.key_fingerprint} · audit log continues: ${r.audit_continues ? 'yes' : 'no'}` })
          : h('p', { class: 'small muted', text: r.error || 'Sign the approved results so auditors can check that no number changes later.' }),
        changed.length ? h('p', { class: 'small', text: 'Changed: ' + changed.map((f) => f.path).join(', ') }) : null,
        h('p', { class: 'small muted', text: `AI agent access (MCP server): ${r.mcp_calls || 0} read-only calls logged · verify anywhere with: python3 signing.py verify` })),
      can('review') ? h('button', { class: 'btn primary', type: 'button', disabled: approved === 0, onclick: signIt }, icon('lock'), has ? 'Sign again' : 'Sign approved results') : null)));
}
function pageReview() {
  const { corrections } = S.data;
  const corr = corrections.entries.map((c) => item(`corr:${c.record_key}`, `Correction ${c.record_key}`,
    `${c.field}: ${c.old_value ?? '–'} → ${c.new_value ?? 'excluded'}`, { formula: c.rule_or_model, files: [c.record_key], assumptions: [c.evidence] }));
  const all = Object.values(S.reviews);
  const approved = all.filter((r) => r.status === 'approved').length;
  const rejected = all.filter((r) => r.status === 'rejected').length;
  const audit = (S.audit && S.audit.entries) || [];
  return [
    pageHead('Review & audit log', 'The pipeline proposes, a person decides. Only approved results can be exported. The audit log is append-only and hash-chained.',
      can('export') ? h('button', { class: 'btn primary', type: 'button', disabled: approved === 0, onclick: exportApproved }, icon('download'), `Export approved (${approved})`) : null),
    h('div', { class: 'grid g4' },
      stat('ok', 'c-green', 'Approved', String(approved), 'Results ready to publish'),
      stat('x', 'c-red', 'Rejected', String(rejected), 'With a written reason'),
      stat('check', 'c-amber', 'Corrections to review', String(corr.filter((c) => status(c.id) === 'draft').length), 'Proposed by the pipeline'),
      stat('lock', S.audit && S.audit.chain_valid ? 'c-blue' : 'c-red', 'Audit log integrity', S.audit && S.audit.chain_valid ? 'Verified' : 'Check failed', 'SHA-256 hash chain over all entries')),
    card(`Data corrections proposed by the pipeline (${corr.length})`, can('see_farm') ? 'Farm records are shown by code only' : 'Farm-level records are hidden for your role', h('div', { class: 'card-b tight' },
      table(['Record', 'Field', 'Old → new', 'Rule', 'Evidence', 'Review'], [],
        corrections.entries.map((c, i) => h('tr', {}, h('td', {}, h('code', { text: c.record_key })), h('td', { text: c.field }),
          h('td', { class: 'nowrap', text: `${c.old_value ?? '–'} → ${c.new_value ?? 'excluded'}` }), h('td', { class: 'small wide', text: c.rule_or_model }),
          h('td', { class: 'small wide', text: c.evidence }), h('td', {}, controls(corr[i])))), 'No corrections visible for your role.'))),
    releaseCard(approved),
    card(`Audit log (${audit.length} entries)`, 'Who decided what, and when. Stored on the server; nobody can edit or delete entries.', h('div', { class: 'card-b tight' },
      table(['Time (UTC)', 'Record', 'Old → new', 'By', 'Comment'], [],
        audit.map((e) => h('tr', {}, h('td', { class: 'small', text: e.timestamp }), h('td', {}, h('code', { text: e.record_key })),
          h('td', {}, h('span', { class: 'pill st-' + e.old_value, text: e.old_value }), ' → ', h('span', { class: 'pill st-' + e.new_value, text: e.new_value })),
          h('td', { text: e.approved_by }), h('td', { class: 'small', text: e.comment || '' }))), 'No decisions yet.'))),
  ];
}

function pageProfile() {
  const me = S.me;
  const tab = S.ui.profileTab || 'about';
  const audit = (S.audit && S.audit.entries) || [];
  const mine = audit.filter((e) => e.approved_by === me.email);
  const tabs = [['about', 'About'], ['mine', 'My decisions'], ['activity', 'Activity']];
  let body;
  if (tab === 'about') {
    body = h('div', { class: 'card-b' }, h('h3', { text: 'What you can do' }), h('ul', {}, me.roles.map((r) => h('li', {}, h('strong', { text: r + ': ' }), ROLE_TXT[r] || ''))),
      h('p', { class: 'small muted', text: 'Roles are checked by the server on every request. In production, sign-in uses Microsoft Entra ID.' }));
  } else if (tab === 'mine') {
    body = h('div', { class: 'card-b tight' }, table(['Time (UTC)', 'Record', 'Decision', 'Comment'], [],
      mine.map((e) => h('tr', {}, h('td', { class: 'small', text: e.timestamp }), h('td', {}, h('code', { text: e.record_key })), h('td', {}, h('span', { class: 'pill st-' + e.new_value, text: e.new_value })), h('td', { class: 'small', text: e.comment || '' }))),
      can('review') ? 'You have not approved or rejected anything yet.' : 'Only reviewers make decisions.'));
  } else {
    body = h('div', { class: 'card-b tight' }, table(['Time (UTC)', 'Record', 'Change', 'By'], [],
      audit.slice(0, 30).map((e) => h('tr', {}, h('td', { class: 'small', text: e.timestamp }), h('td', {}, h('code', { text: e.record_key })), h('td', { text: `${e.old_value} → ${e.new_value}` }), h('td', { text: e.approved_by }))), 'No activity yet.'));
  }
  return [
    pageHead('My profile', null),
    h('div', { class: 'card' }, h('div', { class: 'pbanner' }),
      h('div', { class: 'pinfo' }, h('div', { class: 'avatar', text: initials(me.email) }),
        h('div', {}, h('h2', { text: me.email }), h('div', { class: 'toolbar', style: 'margin-top:6px' }, me.roles.map((r) => h('span', { class: 'pill role', text: r })))),
        h('span', { style: 'flex:1' }),
        h('div', { class: 'toolbar' }, h('span', { class: 'pill tag', text: `${mine.length} decisions` }))),
      h('div', { class: 'tabs' }, tabs.map(([k, t]) => h('button', { type: 'button', class: k === tab ? 'on' : null, text: t, onclick: () => { S.ui.profileTab = k; render(); } }))),
      body),
  ];
}

function pagePrivacy() {
  const block = (t, items) => card(t, null, h('div', { class: 'card-b' }, h('ul', {}, items.map((x) => h('li', { text: x })))));
  return [
    pageHead('Privacy and security', 'How TerraTrace protects data today, and how it works with real company data.'),
    h('div', { class: 'grid g2' },
      block('What is stored', ['Results calculated from the synthetic Apetit × Since AI package.', 'For each user: email, role and a salted PBKDF2 password hash. No plain-text passwords.',
        'Review decisions in an append-only, hash-chained audit log.', 'No analytics, trackers or third-party scripts.']),
      block('Who can see what (need to know)', ['Viewers: totals for regions, crops and catchments.', 'Reviewers: also data corrections (farm records by code only) and approve/reject.',
        'Farm advisors: farm-level records by code, never names or addresses.', 'Admins: user management; no farm-level records by default.']),
      block('AI Copilot', ['Login required; 1,000 characters; 10 questions per minute per user.', 'Only a short summary of results is sent, never whole files or farm-level rows.',
        'Answers are drafts and name their evidence.', 'The API key stays on the server and is never sent to the browser.']),
      block('With real Apetit data', ['Runs inside Apetit\'s environment (Microsoft Fabric / Azure), hosted in the EU.', 'Sign-in with Microsoft Entra ID; access ends automatically when someone leaves.',
        'AI through Azure OpenAI in the EU under Apetit\'s agreement (no training on customer data).', 'Farmers stay pseudonymous; GDPR retention rules and data processing agreements apply.'])),
  ];
}

function pageUsers() {
  const users = S.ui.users || [];
  return [
    pageHead('Users and roles', 'Invite-only. Accounts are created by an admin with manage_users.py; there is no public sign-up.'),
    card('Accounts', 'Passwords are never shown or stored in plain text', h('div', { class: 'card-b tight' },
      table(['Email', 'Roles'], [], users.map((u) => h('tr', {}, h('td', { text: u.email }), h('td', {}, u.roles.map((r) => h('span', { class: 'pill role', text: r }))))), 'No users.'))),
  ];
}

// ---------------------------------------------------------------- export (CSV for Excel, safe)
function cell(v) {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t; // block spreadsheet formula injection
  return '"' + t.replace(/"/g, '""') + '"';
}
function exportApproved() {
  const rows = [['record_key', 'title', 'result', 'formula_or_rule', 'sources', 'approved_by', 'timestamp_utc', 'comment']];
  for (const [id, r] of Object.entries(S.reviews)) {
    if (r.status !== 'approved') continue;
    rows.push([id, r.title, r.summary, r.rule_or_model, r.evidence, r.by, r.ts, r.comment]);
  }
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `terratrace_approved_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- shell
const PAGES = [
  { group: 'Overview', key: 'dashboard', label: 'Dashboard', icon: 'dashboard', fn: pageDashboard },
  { group: 'Analysis', key: 'climate', label: 'Climate Risk', icon: 'cloud', fn: pageClimate },
  { group: 'Analysis', key: 'nature', label: 'Nature Map', icon: 'map', fn: pageNature },
  { group: 'Analysis', key: 'transport', label: 'Transport CO₂', icon: 'truck', fn: pageTransport },
  { group: 'Assistant', key: 'copilot', label: 'AI Copilot', icon: 'bot', fn: pageCopilot },
  { group: 'Governance', key: 'review', label: 'Review & Audit Log', icon: 'check', fn: pageReview, need: 'see_corrections', badge: true },
  { group: 'Governance', key: 'users', label: 'Users & Roles', icon: 'users', fn: pageUsers, need: 'admin' },
  { group: 'Governance', key: 'privacy', label: 'Privacy', icon: 'shield', fn: pagePrivacy },
  { group: null, key: 'profile', label: 'My profile', icon: 'user', fn: pageProfile, hiddenInNav: true },
];
const allowed = (p) => !p.need || can(p.need);
function current() {
  const k = (location.hash || '').replace(/^#\/?/, '');
  const p = PAGES.find((x) => x.key === k && allowed(x));
  return p || PAGES[0];
}
function draftCount() {
  const corrKeys = (S.data.corrections ? S.data.corrections.entries : []).map((c) => 'corr:' + c.record_key);
  return corrKeys.filter((k) => status(k) === 'draft').length;
}
function closeMenus() { S.ui.menu = null; }

function topbar(page) {
  const me = S.me;
  const latest = ((S.audit && S.audit.entries) || []).slice(0, 5);
  const themeDark = pref('theme') === 'dark';
  const bar = h('header', { class: 'topbar' },
    h('button', { class: 'iconbtn menu-btn', type: 'button', 'aria-label': 'Open menu', onclick: () => { document.querySelector('.shell').classList.toggle('mobile-open'); } }, icon('menu')),
    h('div', { class: 'titles' }, h('div', { class: 't1', text: page.label }), h('div', { class: 'crumbs', text: `TerraTrace › ${page.group || 'Account'} › ${page.label}` })),
    h('span', { class: 'spacer' }),
    h('button', { class: 'iconbtn', type: 'button', title: themeDark ? 'Light mode' : 'Dark mode', 'aria-label': 'Toggle dark mode',
      onclick: () => { pref('theme', themeDark ? 'light' : 'dark'); applyTheme(); render(); } }, icon(themeDark ? 'sun' : 'moon')),
    h('button', { class: 'iconbtn', type: 'button', title: 'Latest activity', 'aria-label': 'Notifications',
      onclick: (e) => { e.stopPropagation(); S.ui.menu = S.ui.menu === 'bell' ? null : 'bell'; render(); } }, icon('bell'), latest.length ? h('span', { class: 'dot' }) : null),
    h('button', { class: 'userbtn', type: 'button', 'aria-label': 'Account menu', onclick: (e) => { e.stopPropagation(); S.ui.menu = S.ui.menu === 'user' ? null : 'user'; render(); } },
      h('div', { class: 'avatar', text: initials(me.email) }), h('div', { class: 'who' }, h('div', { class: 'strong', text: me.email.split('@')[0] }), h('small', { text: me.roles.join(', ') }))));
  if (S.ui.menu === 'bell') {
    bar.append(h('div', { class: 'dropdown', onclick: (e) => e.stopPropagation() }, h('div', { class: 'dd-head strong', text: 'Latest activity' }),
      latest.length ? latest.map((e) => h('div', { class: 'notif' }, `${e.approved_by} ${e.new_value} `, h('code', { text: e.record_key }), h('small', { text: e.timestamp })))
        : h('div', { class: 'notif muted', text: 'No activity yet.' })));
  }
  if (S.ui.menu === 'user') {
    bar.append(h('div', { class: 'dropdown', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'dd-head' }, h('div', { class: 'strong', text: me.email }), h('div', { class: 'toolbar', style: 'margin-top:4px' }, me.roles.map((r) => h('span', { class: 'pill role', text: r })))),
      h('a', { href: '#/profile', onclick: closeMenus }, icon('user'), 'My profile'),
      h('a', { href: '#/privacy', onclick: closeMenus }, icon('shield'), 'Privacy'),
      h('button', { class: 'item', type: 'button', onclick: logout }, icon('logout'), 'Logout')));
  }
  return bar;
}

function sidebar(page) {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  let group = null;
  for (const p of PAGES) {
    if (p.hiddenInNav || !allowed(p)) continue;
    if (p.group !== group) { group = p.group; nav.append(h('div', { class: 'group', text: group.toUpperCase() })); }
    const n = p.badge ? draftCount() : 0;
    nav.append(h('a', { href: '#/' + p.key, class: p.key === page.key ? 'active' : null, 'aria-current': p.key === page.key ? 'page' : null, title: p.label,
      onclick: () => document.querySelector('.shell') && document.querySelector('.shell').classList.remove('mobile-open') },
      icon(p.icon), h('span', { class: 'label', text: p.label }), n ? h('span', { class: 'badge', text: String(n) }) : null));
  }
  return h('aside', { class: 'sidebar' },
    h('div', { class: 'brandmark' }, h('img', { class: 'logo', src: 'logo.svg', alt: 'TerraTrace logo' }), h('div', { class: 'brandtext' }, h('div', { class: 'brandname', text: 'TerraTrace' }), h('div', { class: 'brandsub', text: 'by Team FarmSense' }))),
    nav,
    h('div', { class: 'side-foot' }, h('button', { type: 'button', onclick: () => { pref('collapsed', pref('collapsed') === '1' ? '0' : '1'); render(); } }, icon('collapse'), h('span', { class: 'label', text: 'Collapse sidebar' }))));
}

function bottomNav(page) {
  const items = [['dashboard', 'Home', 'home'], ['climate', 'Climate', 'cloud'], ['nature', 'Nature', 'map'], ['transport', 'Transport', 'truck'], ['copilot', 'Copilot', 'spark']];
  return h('nav', { class: 'bottomnav', 'aria-label': 'Quick navigation' },
    items.map(([k, label, ic]) => h('a', { href: '#/' + k, class: page.key === k ? 'on' : null, 'aria-current': page.key === k ? 'page' : null }, icon(ic), h('span', { text: label }))));
}

function render() {
  if (!S.me) return renderLogin();
  const page = current();
  let content;
  try {
    content = page.fn();
  } catch (e) {
    console.error(e);
    content = [h('div', { class: 'err', text: 'This screen could not be shown. Please run "python3 run_all.py" again and reload. Details: ' + (e && e.message ? e.message : String(e)) })];
  }
  const entering = S.ui.lastPage !== page.key;
  S.ui.lastPage = page.key;
  const shell = h('div', { class: 'shell' + (pref('collapsed') === '1' ? ' collapsed' : '') },
    sidebar(page),
    h('div', { class: 'main' }, topbar(page),
      h('div', { class: 'banner' }, icon('alert'), `${(S.data.meta && S.data.meta.note) || 'Synthetic data.'} Every number is a draft until an expert approves it.`),
      h('main', { class: 'content' + (entering ? ' enter' : ''), id: 'main', tabindex: '-1' }, content),
      h('div', { class: 'footer', text: 'TerraTrace by Team FarmSense · Synthetic data · No personal data is stored except your login email.' })),
    h('div', { class: 'backdrop', onclick: () => document.querySelector('.shell').classList.remove('mobile-open') }),
    bottomNav(page));
  document.getElementById('root').replaceChildren(shell);
}

// ---------------------------------------------------------------- login / logout / loading
function renderLogin(msg) {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true, maxlength: 120 });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, maxlength: 200 });
  const err = h('p', { class: 'err-text', text: msg || '' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;justify-content:center;padding:10px' }, 'Sign in');
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!email.value || !pw.value) { err.textContent = 'Please enter your email and password.'; return; }
    btn.disabled = true; err.textContent = '';
    try {
      await api('/api/login', { method: 'POST', body: { email: email.value.trim(), password: pw.value } });
      pw.value = '';
      await boot();
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  } },
  h('label', { class: 'field' }, h('span', { text: 'Email' }), email),
  h('label', { class: 'field' }, h('span', { text: 'Password' }), pw), err, btn);
  const feat = (ic, t1, t2) => h('li', {}, h('span', { class: 'f-ico' }, icon(ic)), h('div', {}, h('strong', { text: t1 }), h('span', { text: t2 })));
  document.getElementById('root').replaceChildren(h('div', { class: 'login-wrap' },
    h('section', { class: 'login-brand' },
      h('div', { class: 'brandmark' }, h('img', { class: 'logo lg', src: 'logo.svg', alt: 'TerraTrace logo' }), h('div', {}, h('div', { class: 'brandname', text: 'TerraTrace' }), h('div', { class: 'brandsub', text: 'by Team FarmSense' }))),
      h('h2', { text: 'From field to fork: every climate and nature number, traced to its source.' }),
      h('ul', { class: 'features' },
        feat('euro', 'Climate risk in euros', 'Yield forecasts for contract crops under three climate scenarios'),
        feat('drop', 'Nature priorities', 'Phosphorus and nitrogen hot spots by catchment (SBTN)'),
        feat('truck', 'Transport CO₂', 'Scope 3 categories 4 and 9, with missing legs found and fixed'),
        feat('check', 'Expert review', 'Nothing is final until a named expert approves it'))),
    h('section', { class: 'login-side' }, h('div', { class: 'login-card' },
      h('div', { class: 'brandmark only-mobile' }, h('img', { class: 'logo', src: 'logo.svg', alt: 'TerraTrace logo' }), h('div', {}, h('div', { class: 'strong', text: 'TerraTrace' }), h('div', { class: 'small muted', text: 'Climate & Nature Navigator' }))),
      h('h1', { text: 'Welcome back' }), h('p', { text: 'Sign in to continue. Access is by invitation only.' }), form,
      h('div', { class: 'login-foot' }, icon('lock'), ' Secure session · synthetic data · no public sign-up')))));
  email.focus();
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  S.me = null; S.data = {}; S.reviews = {}; S.audit = null; S.items = {};
  location.hash = '';
  renderLogin('You are signed out.');
}
async function refreshReviews() {
  const [rv, au, rl] = await Promise.all([api('/api/reviews'), api('/api/audit'), api('/api/release').catch(() => null)]);
  S.reviews = rv || {}; S.audit = au; S.release = rl;
}
async function boot() {
  try {
    const me = await api('/api/me');
    S.me = me && me.email ? me : null;
  } catch (e) { S.me = null; }
  if (!S.me) return renderLogin();
  document.getElementById('root').replaceChildren(h('p', { class: 'empty', text: 'Loading results…' }));
  try {
    const names = ['climate', 'nature', 'transport', 'actions', 'corrections', 'meta'];
    const vals = await Promise.all(names.map((n) => api('/api/data/' + n)));
    names.forEach((n, i) => { S.data[n] = vals[i]; });
    S.health = await api('/api/health');
    await refreshReviews();
    if (S.ui.users === undefined && can('admin')) S.ui.users = await api('/api/users');
  } catch (e) {
    if (e.message === 'signed out') return;
    document.getElementById('root').replaceChildren(h('div', { class: 'content' }, h('div', { class: 'err', text: 'Results could not be loaded: ' + e.message })));
    return;
  }
  S.ui.nature.id = S.ui.nature.id || S.data.nature.catchments[0].catchment_id;
  render();
}

window.addEventListener('hashchange', () => { closeMenus(); if (S.me) render(); });
document.addEventListener('click', () => { if (S.ui.menu) { S.ui.menu = null; if (S.me) render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.ui.menu) { S.ui.menu = null; render(); } });
window.addEventListener('error', (e) => console.error('TerraTrace error:', e.message));
S.ui = { climate: { combo: 'FI_SW|pea', scen: 'ssp245' }, nature: { id: null }, copilot: { q: '', answer: '', info: '', busy: false }, menu: null };
applyTheme();
boot();
