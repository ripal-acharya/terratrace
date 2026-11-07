// TerraTrace web app. No external libraries: all text is set with textContent (no innerHTML),
// so data, reviewer comments and AI answers can never run as code in the page.
'use strict';

const STORE_KEY = 'farmsense.review.v1';
const MAX_Q = 1000;
const S = { data: {}, items: {}, reviews: {}, log: [], reviewer: '', health: null, ui: {} };
const PAGES = [
  ['dashboard', 'Dashboard'], ['climate', 'Climate Risk'], ['nature', 'Nature Map'],
  ['transport', 'Transport CO₂'], ['copilot', 'AI Copilot'], ['review', 'Review & Audit Log'],
];
const SCEN = { ssp126: 'SSP1-2.6 (low warming)', ssp245: 'SSP2-4.5 (middle)', ssp585: 'SSP5-8.5 (high warming)' };
const SCOL = { historical: '#6b7a71', ssp126: '#2f7d4a', ssp245: '#c58a00', ssp585: '#b3261e' };
const CROPS = { pea: 'Pea', potato: 'Potato', carrot: 'Carrot', spinach: 'Spinach', turnip_rape: 'Turnip rape' };
const REG = { FI_SW: 'Finland (SW)', SE_SKANE: 'Sweden (Skåne)' };

// ---------------------------------------------------------------- helpers
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM: allowed by the strict CSP
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
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => (isNum(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const eur = (v) => (isNum(v) ? '€' + num(Math.round(v)) : '–');
const pct = (v, d = 1) => (isNum(v) ? (v > 0 ? '+' : '') + num(v, d) + ' %' : '–');
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

// ---------------------------------------------------------------- storage (safe)
function loadStore() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      S.reviews = o && typeof o.reviews === 'object' && o.reviews ? o.reviews : {};
      S.log = o && Array.isArray(o.log) ? o.log : [];
      S.reviewer = o && typeof o.reviewer === 'string' ? o.reviewer : '';
    }
  } catch (e) { /* storage blocked or broken: keep in memory */ }
}
function saveStore() {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ reviews: S.reviews, log: S.log, reviewer: S.reviewer })); } catch (e) { /* ignore */ }
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
function message(title, text) { openDialog(h('h3', { text: title }), h('p', { text })); }

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
    h('p', { class: 'small muted', text: 'Review status: ' + status(it.id) + (r ? ` by ${r.by} at ${r.ts}` : '') }),
  );
}

function decide(it, newStatus, comment) {
  const old = status(it.id);
  const rec = { status: newStatus, by: S.reviewer.trim(), ts: nowIso(), comment: comment || '' };
  S.reviews[it.id] = rec;
  // append-only audit log; fields from docs/AZURE_FABRIC_QUICKSTART.md
  S.log.push({
    record_key: it.id, field: 'review_status', old_value: old, new_value: newStatus,
    rule_or_model: (it.src && it.src.formula) || 'TerraTrace pipeline result',
    evidence: ((it.src && it.src.files) || []).join('; '), proposed_by: 'TerraTrace pipeline (agent)',
    approved_by: rec.by, timestamp: rec.ts, comment: rec.comment,
  });
  saveStore();
  render();
}

function needReviewer() {
  if (S.reviewer.trim().length >= 2) return false;
  message('Reviewer name needed', 'Please type your name in the "Reviewer" box at the top. Every decision is stored with the reviewer name.');
  return true;
}
function approve(it) { if (!needReviewer()) decide(it, 'approved', ''); }
function reject(it) {
  if (needReviewer()) return;
  const ta = h('textarea', { maxlength: 500, placeholder: 'Why do you reject this result? (required)' });
  const err = h('p', { class: 'small err-text' });
  openDialog(h('h3', { text: 'Reject: ' + it.title }), ta, err,
    h('div', { class: 'row' }, h('button', {
      class: 'btn no', type: 'button', text: 'Reject',
      onclick: () => {
        const c = ta.value.replace(/[\u0000-\u001f]/g, ' ').trim();
        if (c.length < 3) { err.textContent = 'Please write a short reason.'; return; }
        closeDialog();
        decide(it, 'rejected', c);
      },
    })));
  ta.focus();
}

function controls(it) {
  return h('div', { class: 'row nowrap' }, pill(it.id),
    h('button', { class: 'btn src', type: 'button', text: 'ⓘ Source', onclick: () => showSource(it) }),
    h('button', { class: 'btn ok', type: 'button', text: '✓ Approve', onclick: () => approve(it), disabled: status(it.id) === 'approved' }),
    h('button', { class: 'btn no', type: 'button', text: '✕ Reject', onclick: () => reject(it), disabled: status(it.id) === 'rejected' }));
}

function methodBox(title, m) {
  return h('div', { class: 'method' }, h('h3', { text: title }),
    h('ul', {}, Object.entries(m).filter(([, v]) => typeof v === 'string').map(([k, v]) => h('li', {}, h('strong', { text: k + ': ' }), v))));
}

// ---------------------------------------------------------------- charts
function lineChart(series, opt) {
  opt = opt || {};
  const W = 760, H = opt.h || 300, L = 48, R = 12, T = 26, B = 30;
  const pts = series.flatMap((x) => x.points).filter((p) => isNum(p[0]) && isNum(p[1]));
  if (!pts.length) return h('p', { class: 'muted', text: 'No data.' });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = 0, y1 = Math.max(...ys) * 1.1 || 1;
  const X = (v) => L + ((v - x0) / Math.max(1, x1 - x0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opt.label || 'chart' });
  for (let i = 0; i <= 4; i++) {
    const v = y0 + ((y1 - y0) * i) / 4;
    g.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: '#e6e9e4' }),
      s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, num(v, v < 10 ? 1 : 0)));
  }
  for (let v = Math.ceil(x0 / 10) * 10; v <= x1; v += 10) g.append(s('text', { x: X(v), y: H - 10, 'text-anchor': 'middle' }, v));
  for (const se of series) {
    const p = se.points.filter((q) => isNum(q[0]) && isNum(q[1])).sort((a, b) => a[0] - b[0]);
    if (!p.length) continue;
    g.append(s('path', {
      d: p.map((q, i) => (i ? 'L' : 'M') + X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1)).join(''),
      fill: 'none', stroke: se.color, 'stroke-width': se.width || 2, 'stroke-dasharray': se.dash || null,
    }));
    if (se.dots) for (const q of p) g.append(s('circle', { cx: X(q[0]), cy: Y(q[1]), r: 2.6, fill: se.color }, s('title', {}, `${se.name} ${q[0]}: ${num(q[1], 2)}`)));
  }
  if (opt.ylabel) g.append(s('text', { x: 4, y: 10 }, opt.ylabel));
  return h('div', {}, g, h('div', { class: 'legend' }, series.map((x) => h('span', {}, h('span', { class: 'sw', style: 'background:' + x.color }), x.name))));
}

function stackedBars(cats, groups, colors, opt) {
  opt = opt || {};
  const W = 760, H = opt.h || 280, L = 56, R = 12, T = 26, B = 30;
  const tot = cats.map((c) => groups.reduce((a, gname) => a + (c.v[gname] || 0), 0));
  const y1 = Math.max(1, ...tot) * 1.1;
  const bw = ((W - L - R) / cats.length) * 0.6;
  const X = (i) => L + ((i + 0.5) * (W - L - R)) / cats.length;
  const Y = (v) => T + (1 - v / y1) * (H - T - B);
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opt.label || 'bar chart' });
  for (let i = 0; i <= 4; i++) {
    const v = (y1 * i) / 4;
    g.append(s('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), stroke: '#e6e9e4' }), s('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end' }, num(v)));
  }
  cats.forEach((c, i) => {
    let acc = 0;
    for (const gname of groups) {
      const v = c.v[gname] || 0;
      if (v > 0) {
        g.append(s('rect', { x: X(i) - bw / 2, y: Y(acc + v), width: bw, height: Math.max(0.5, Y(acc) - Y(acc + v)), fill: colors[gname] },
          s('title', {}, `${c.label} ${gname}: ${num(v, 1)} t`)));
      }
      acc += v;
    }
    g.append(s('text', { x: X(i), y: H - 10, 'text-anchor': 'middle' }, c.label));
  });
  if (opt.ylabel) g.append(s('text', { x: 4, y: 10 }, opt.ylabel));
  return h('div', {}, g, h('div', { class: 'legend' }, groups.map((x) => h('span', {}, h('span', { class: 'sw', style: 'background:' + colors[x] }), x))));
}

function table(headers, numCols, rows) {
  return h('div', { class: 'tablewrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map((x, i) => h('th', { class: numCols.includes(i) ? 'num' : null, text: x })))),
    h('tbody', {}, rows)));
}

// ---------------------------------------------------------------- pages
function kpi(label, value, note) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }), h('div', { class: 'note', text: note }));
}

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
  return [
    h('h1', { text: 'Dashboard' }),
    h('p', { class: 'lead', text: 'Climate and nature risks across the value chain, in euros and tonnes, with actions and owners. Climate figures: SSP2-4.5, 2041–2060 vs 1991–2020.' }),
    h('div', { class: 'grid g4' },
      kpi('Climate risk to contract crops', eur(totalEur) + ' / yr', 'Replacement cost of the expected shortfall, all crops (SSP2-4.5)'),
      kpi('Largest yield loss', `${CROPS[worst.crop]} ${pct(worst.mean_yield_change_pct)}`, `${REG[worst.region]}, bad-year probability ${num(worst.p_bad_year * 100)} %`),
      kpi('Transport CO₂e ' + t25.year, num(t25.cat4_corrected_tco2e + t25.cat9_tco2e) + ' t', 'Scope 3 cat 4 + cat 9, incl. corrected missing legs'),
      kpi('Top nature priority', `${top.catchment_id} (${top.region === 'FI_SW' ? 'Finland' : 'Sweden'})`, `${num(top.p_kg)} kg P and ${num(top.n_kg)} kg N to water in 2025; status ${top.status}`)),
    h('div', { class: 'card' }, h('h2', { text: 'Next-week action list' }),
      table(['#', 'Action', 'Evidence', '€ / year', 't CO₂e', 'Owner', 'Next week', 'Review'], [3, 4],
        actions.actions.map((a, i) => h('tr', {},
          h('td', { text: a.priority }),
          h('td', {}, h('strong', { text: a.action }), h('div', { class: 'small muted', text: a.area })),
          h('td', { class: 'small', text: a.evidence }),
          h('td', { class: 'num' }, eur(a.eur_per_yr), a.eur_label ? h('div', { class: 'small muted', text: a.eur_label }) : null),
          h('td', { class: 'num', text: isNum(a.tco2e) ? num(a.tco2e) : '–' }),
          h('td', { text: a.owner }), h('td', { class: 'small', text: a.next_week }), h('td', {}, controls(acts[i])))))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', { text: 'Not a reduction' }), h('p', { text: nr.note }),
        h('p', { class: 'small muted', text: `Lever ${nr.lever.lever_id}: ${nr.lever.lever_name}` })),
      h('div', { class: 'card' }, h('h2', { text: 'Reliability checks' }),
        h('ul', {},
          h('li', { text: `Transport 2024: category 4 ${num(dv.cat4_ours, 1)} t vs ${num(dv.cat4_truth, 1)} t and category 9 ${num(dv.cat9_ours, 1)} t vs ${num(dv.cat9_truth, 1)} t in Apetit's public dev inventory.` }),
          h('li', { text: `Missing sea legs on 2023–2024 dev labels: ${transport.dev_check.correct} of ${transport.dev_check.true_labels} found, precision ${num(transport.dev_check.precision * 100)} %.` }),
          h('li', { text: `Nature D1 dev score ${num(nature.calibration.dev_score.score, 1)} (package baseline ${num(nature.calibration.baseline_dev_score, 1)}); calibrated on the 6 dev catchments.` }),
          h('li', { text: 'Yield model beats the farm-average baseline in the 2023–2026 back-test for every crop (see Climate Risk).' })))),
  ];
}

function pageClimate() {
  const { climate } = S.data;
  const sel = S.ui.climate;
  const combos = [...new Set(climate.risk.map((r) => r.region + '|' + r.crop))];
  if (!combos.includes(sel.combo)) sel.combo = combos[0];
  const pick = h('select', { 'aria-label': 'Crop', onchange: (e) => { sel.combo = e.target.value; render(); } },
    combos.map((c) => { const [r, cr] = c.split('|'); return h('option', { value: c, selected: c === sel.combo, text: `${CROPS[cr]} – ${REG[r]}` }); }));
  const scen = h('select', { 'aria-label': 'Scenario', onchange: (e) => { sel.scen = e.target.value; render(); } },
    Object.entries(SCEN).map(([k, v]) => h('option', { value: k, selected: k === sel.scen, text: v })));
  const [reg, crop] = sel.combo.split('|');
  const ser = climate.series.filter((x) => x.region === reg && x.crop === crop);
  const obs = climate.observed_yield.filter((x) => x.region === reg && x.crop === crop);
  const c1 = climate.c1_summary.filter((x) => x.region === reg && x.crop === crop);
  const lines = [
    { name: 'Observed (farm data)', color: '#1d2a22', points: obs.map((x) => [x.year, x.yield_t_ha]), dots: true, width: 1 },
    { name: 'Model, 1991–2020 weather', color: SCOL.historical, points: ser.filter((x) => x.scenario === 'historical').map((x) => [x.year, x.yield_t_ha]), width: 1.5 },
    { name: 'C1 forecast 2027–2031 (SSP2-4.5)', color: '#1f5fa8', points: c1.map((x) => [x.year, x.yield_t_ha]), dots: true, width: 2.5 },
    ...['ssp126', 'ssp245', 'ssp585'].map((k) => ({
      name: SCEN[k] + ', 2041–2060', color: SCOL[k], points: ser.filter((x) => x.scenario === k).map((x) => [x.year, x.yield_t_ha]),
      width: k === sel.scen ? 2.5 : 1.2, dash: k === sel.scen ? null : '4 3',
    })),
  ];
  const rows = climate.risk.filter((r) => r.scenario === sel.scen);
  return [
    h('h1', { text: 'Climate risk to farming' }),
    h('p', { class: 'lead', text: 'How weather in a changing climate affects contract-crop yields, what the shortfall costs, and what reduces it (tasks C1, C2, C3).' }),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { text: 'Yield per hectare (t/ha)' }), h('span', { class: 'spacer' }), pick, scen),
      lineChart(lines, { ylabel: 't/ha', label: 'Yield chart' })),
    h('div', { class: 'card' }, h('h2', { text: `All crops – ${SCEN[sel.scen]}, 2041–2060 vs 1991–2020` }),
      table(['Crop', 'Region', 'Yield change', 'Bad-year probability', 'Shortfall t/yr', 'Price €/t × premium', '€ risk / yr', 'Saved by irrigation / yr', 'Review'], [2, 3, 4, 5, 6, 7],
        rows.map((r) => {
          const it = item(`risk:${r.region}:${r.crop}:${r.scenario}`, `${CROPS[r.crop]} ${REG[r.region]} ${r.scenario}`,
            `Yield ${pct(r.mean_yield_change_pct)}, shortfall ${num(r.expected_shortfall_t_per_yr)} t/yr, risk ${eur(r.eur_risk_per_yr)}/yr`,
            { formula: r.formula, files: r.sources, assumptions: r.assumptions, standard: climate.method.standards });
          return h('tr', {}, h('td', { text: CROPS[r.crop] }), h('td', { text: REG[r.region] }),
            h('td', { class: 'num', text: pct(r.mean_yield_change_pct) }), h('td', { class: 'num', text: num(r.p_bad_year * 100) + ' %' }),
            h('td', { class: 'num', text: num(r.expected_shortfall_t_per_yr) }),
            h('td', { class: 'num', text: `${num(r.contract_price_eur_t, 1)} × ${num(r.replacement_premium_frac, 2)}` }),
            h('td', { class: 'num' }, h('strong', { text: eur(r.eur_risk_per_yr) })),
            h('td', { class: 'num', title: r.irrigation_note, text: isNum(r.eur_saved_by_irrigation_per_yr) ? eur(r.eur_saved_by_irrigation_per_yr) : 'not enough data' }),
            h('td', {}, controls(it)));
        }))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', { text: 'Back-test: trained 2012–2022, tested 2023–2026' }),
        table(['Crop', 'Region', 'Model error (production)', 'Farm-average baseline'], [2, 3],
          climate.backtest.map((b) => h('tr', {}, h('td', { text: CROPS[b.crop] }), h('td', { text: REG[b.region] }),
            h('td', { class: 'num', text: num(b.model_mape_pct, 1) + ' %' }), h('td', { class: 'num', text: num(b.baseline_mape_pct, 1) + ' %' }))))),
      h('div', { class: 'card' }, methodBox('Method', climate.method),
        h('p', { class: 'small muted', text: 'Note: € risk counts the shortfall in bad years, so a crop can carry risk even when its average yield rises.' }),
        h('p', { class: 'small muted', text: 'Adaptation: irrigation is modelled from history. Earlier sowing and tolerant varieties are not modelled (the package weather has no adaptation). A wider sourcing area is action A1 on the Dashboard.' }))),
  ];
}

function pageNature() {
  const { nature } = S.data;
  const byId = Object.fromEntries(nature.catchments.map((c) => [c.catchment_id, c]));
  const sel = S.ui.nature;
  const feats = nature.geojson.features.filter((f) => f.geometry && f.geometry.type === 'Polygon');
  const color = (c) => (!c || c.p_kg <= 0 ? '#e7ebe5' : c.rank <= 5 ? '#b3261e' : c.rank <= 12 ? '#e0803a' : c.rank <= 25 ? '#f2c14e' : '#b9d7a8');
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
      const path = s('path', { d, fill: color(c), class: sel.id === id ? 'sel' : null },
        s('title', {}, c ? `${id}: rank ${c.rank}, P ${num(c.p_kg)} kg, N ${num(c.n_kg)} kg, ${c.status}` : id));
      path.addEventListener('click', () => { sel.id = id; render(); });
      svg.append(path);
    }
    return h('div', {}, h('div', { class: 'small muted', text: REG[region] }), svg);
  };
  const map = h('div', { class: 'maps' }, panel('FI_SW'), panel('SE_SKANE'));
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
    h('h1', { text: 'Nature: nutrient pressure on waters (SBTN)' }),
    h('p', { class: 'lead', text: 'Phosphorus (P) and nitrogen (N) from Apetit contract parcels that reach lakes and rivers in 2025, and where to act first (task D1).' }),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', { text: 'Priority map (click a catchment)' }), map,
        h('div', { class: 'legend' }, [['#b3261e', 'Rank 1–5'], ['#e0803a', '6–12'], ['#f2c14e', '13–25'], ['#b9d7a8', '26+'], ['#e7ebe5', 'No Apetit parcels']]
          .map(([c, t]) => h('span', {}, h('span', { class: 'sw', style: 'background:' + c }), t))),
        h('p', { class: 'small muted', text: 'Synthetic catchment polygons placed in the real sourcing regions (not to the same scale). Hover for values.' })),
      h('div', { class: 'card' }, h('h2', { text: `${cur.catchment_id} – rank ${cur.rank}` }),
        h('table', {}, h('tbody', {}, facts.map(([a, b]) => h('tr', {}, h('th', { text: a }), h('td', { text: b }))))),
        methodBox('Method', { formula: nature.method.formula, loads: nature.method.loads, standard: nature.method.standard, actions: nature.method.actions }),
        h('p', { class: 'small muted', text: `Calibration: decay length ${cal.decay_length_m} m; dev score ${num(cal.dev_score.score, 1)} vs baseline ${cal.baseline_dev_score}. ${cal.note}` }))),
    h('div', { class: 'card' }, h('h2', { text: 'Top 10 catchments' }),
      table(['Rank', 'Catchment', 'Region', 'P kg', 'N kg', 'Status', 'Score', 'Review'], [3, 4, 6],
        nature.catchments.slice(0, 10).map((c) => {
          const it = item('nature:' + c.catchment_id, `Catchment ${c.catchment_id} priority`, `Rank ${c.rank}: ${num(c.p_kg, 1)} kg P, ${num(c.n_kg)} kg N, status ${c.status}`,
            { formula: nature.method.formula, standard: nature.method.standard, files: nature.method.sources, assumptions: [nature.method.loads] });
          return h('tr', {}, h('td', { text: c.rank }),
            h('td', {}, h('button', { class: 'btn', type: 'button', text: c.catchment_id, onclick: () => { sel.id = c.catchment_id; render(); } })),
            h('td', { text: REG[c.region] }), h('td', { class: 'num', text: num(c.p_kg, 1) }), h('td', { class: 'num', text: num(c.n_kg) }),
            h('td', { text: c.status }), h('td', { class: 'num', text: num(c.priority_score, 2) }), h('td', {}, controls(it)));
        }))),
  ];
}

function pageTransport() {
  const { transport } = S.data;
  const modes = ['truck', 'truck-reefer', 'ropax', 'ship-bulk', 'ship-reefer'];
  const colors = { truck: '#2f7d4a', 'truck-reefer': '#7fb38f', ropax: '#1f5fa8', 'ship-bulk': '#c58a00', 'ship-reefer': '#e0b860' };
  const cats = transport.summary.map((sm) => ({
    label: String(sm.year),
    v: Object.fromEntries(modes.map((m) => [m, transport.by_mode.filter((r) => r.year === sm.year && r.mode === m).reduce((a, r) => a + r.tco2e, 0)])),
  }));
  const m = transport.method;
  const yItems = transport.summary.map((sm) => item('transport:' + sm.year, `Transport CO₂e ${sm.year}`,
    `Cat 4 ${num(sm.cat4_corrected_tco2e, 1)} t, cat 9 ${num(sm.cat9_tco2e, 1)} t`,
    { formula: m.formula, standard: m.standard, files: m.sources, assumptions: m.assumptions }));
  return [
    h('h1', { text: 'Transport CO₂e (Scope 3 categories 4 and 9)' }),
    h('p', { class: 'lead', text: 'Calculated automatically from shipment legs instead of manual distance look-ups, with data-quality checks.' }),
    h('div', { class: 'card' }, h('h2', { text: 'tCO₂e by transport mode (inbound + outbound legs)' }), stackedBars(cats, modes, colors, { ylabel: 't CO₂e' })),
    h('div', { class: 'card' }, h('h2', { text: 'Yearly totals' }),
      table(['Year', 'Cat 4 raw', 'Added: missing sea legs', 'Cat 4 corrected', 'Cat 9 transport', 'Cat 9 warehousing', 'Cat 9 total', 'Review'], [1, 2, 3, 4, 5, 6],
        transport.summary.map((r, i) => h('tr', {}, h('td', { text: r.year }), h('td', { class: 'num', text: num(r.cat4_raw_tco2e, 1) }),
          h('td', { class: 'num', text: num(r.missing_leg_tco2e, 1) }), h('td', { class: 'num' }, h('strong', { text: num(r.cat4_corrected_tco2e, 1) })),
          h('td', { class: 'num', text: num(r.cat9_transport_tco2e, 1) }), h('td', { class: 'num', text: num(r.cat9_warehousing_tco2e, 1) }),
          h('td', { class: 'num' }, h('strong', { text: num(r.cat9_tco2e, 1) })), h('td', {}, controls(yItems[i])))))),
    h('div', { class: 'grid g2' },
      h('div', { class: 'card' }, h('h2', { text: `Data-quality findings: ${transport.missing_legs.length} missing sea legs` }),
        h('p', { class: 'small muted', text: `Check on 2023–2024 dev labels: ${transport.dev_check.correct}/${transport.dev_check.true_labels} found, precision ${num(transport.dev_check.precision * 100)} %. Mode/factor mismatches: ${transport.mislabels}. Approve or reject each correction on the Review page.` }),
        table(['Record key', 'Year', 'Origin', 'Estimated tkm'], [3],
          transport.missing_legs.slice().reverse().map((r) => h('tr', {}, h('td', {}, h('code', { text: r.record_key })),
            h('td', { text: r.year }), h('td', { text: r.origin }), h('td', { class: 'num', text: num(r.est_tkm) }))))),
      h('div', { class: 'card' }, methodBox('Method', { formula: m.formula, standard: m.standard }),
        h('h3', { text: 'Factors used (kg CO₂e per tkm, well-to-wheel)' }),
        h('table', {}, h('tbody', {}, Object.entries(transport.factors).map(([key, f]) => h('tr', {},
          h('td', {}, h('code', { text: key })), h('td', { class: 'small', text: f.name }), h('td', { class: 'num', text: num(f.kg_per_tkm, 3) }))))),
        h('p', { class: 'small muted', text: 'Source: emission_factor_library.csv (GLEC Framework style, calibrated_synthetic).' }))),
  ];
}

function pageCopilot() {
  const st = S.ui.copilot;
  const prepared = (S.health && S.health.prepared) || [];
  const out = h('div', { class: 'chat', 'aria-live': 'polite', id: 'chat-out' }, st.answer || 'Ask a question about the results. Answers name their evidence (file and row).');
  const info = h('p', { class: 'small muted', text: st.info || '' });
  const ta = h('textarea', { maxlength: MAX_Q, placeholder: 'For example: Compare pea risk in Finland and Sweden under SSP5-8.5.', 'aria-label': 'Question' });
  ta.value = st.q || '';
  const count = h('span', { class: 'small muted', text: `${ta.value.length} / ${MAX_Q}` });
  const send = h('button', { class: 'btn primary', type: 'button', text: st.busy ? 'Thinking…' : 'Ask', disabled: st.busy });
  ta.addEventListener('input', () => { st.q = ta.value; count.textContent = `${ta.value.length} / ${MAX_Q}`; });
  const ask = async (q) => {
    q = (q || '').trim();
    if (!q) { info.textContent = 'Please type a question.'; return; }
    if (q.length > MAX_Q) { info.textContent = `Please keep your question under ${MAX_Q} characters.`; return; }
    if (st.busy) return;
    st.q = q; st.busy = true; st.answer = ''; st.info = 'Waiting for the answer…';
    render();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 70000);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q }), signal: ctl.signal });
      if (!res.ok) {
        let msg = 'The AI is not available right now. Please try again.';
        try { const j = await res.json(); if (j && typeof j.error === 'string') msg = j.error; } catch (e) { /* keep default */ }
        st.info = msg;
      } else {
        const src = res.headers.get('X-Answer-Source');
        st.info = src === 'prepared' ? 'Prepared answer, calculated directly from the pipeline results (no AI).' : 'AI answer (draft). Check the evidence before you use it.';
        const infoNow = document.getElementById('chat-info'); if (infoNow) infoNow.textContent = st.info;
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          st.answer += dec.decode(value, { stream: true });
          const el = document.getElementById('chat-out');
          if (el) el.textContent = st.answer;
        }
        st.answer += dec.decode();
        if (!st.answer.trim()) st.info = 'The AI returned an empty answer. Please try again.';
      }
    } catch (e) {
      st.info = 'The AI is taking too long or the server is not running. Please try again.';
    } finally {
      clearTimeout(timer);
      st.busy = false;
      render();
    }
  };
  send.addEventListener('click', () => ask(ta.value));
  info.id = 'chat-info';
  return [
    h('h1', { text: 'AI Copilot' }),
    h('p', { class: 'lead', text: 'Ask in plain English. The Copilot only uses TerraTrace results and the framework digest, and names its evidence. It can read data, never change it.' }),
    h('div', { class: 'card' }, h('h2', { text: 'Suggested questions (instant)' }),
      h('div', { class: 'row' }, prepared.length
        ? prepared.map((q) => h('button', { class: 'btn', type: 'button', text: q, disabled: st.busy, onclick: () => ask(q) }))
        : h('span', { class: 'muted', text: 'Start the app with "python3 server.py" to use the Copilot.' }))),
    h('div', { class: 'card' }, ta, h('div', { class: 'row' }, count, h('span', { class: 'spacer' }), send), info, out,
      h('p', { class: 'small muted', text: S.health && S.health.ai_configured
        ? `Model: ${S.health.model}. Limits: ${MAX_Q} characters, 10 questions per minute. AI answers are drafts.`
        : 'Free-text AI is off (no API key on the server). Suggested questions still work.' })),
  ];
}

function pageReview() {
  const { corrections } = S.data;
  const corr = corrections.entries.map((c, i) => item(`corr:${i}:${c.record_key}`, `Correction ${c.record_key}`,
    `${c.field}: ${c.old_value ?? '–'} → ${c.new_value ?? 'excluded'}`, { formula: c.rule_or_model, files: [c.record_key], assumptions: [c.evidence] }));
  const approved = Object.values(S.reviews).filter((r) => r.status === 'approved').length;
  const rejected = Object.values(S.reviews).filter((r) => r.status === 'rejected').length;
  const exportBtn = h('button', { class: 'btn primary', type: 'button', text: `Export approved results (${approved}) for Excel (CSV)`, disabled: approved === 0, onclick: exportApproved });
  return [
    h('h1', { text: 'Review & audit log' }),
    h('p', { class: 'lead', text: 'The pipeline proposes, a person approves. Only approved results can be exported. The audit log cannot be edited or deleted in the app.' }),
    h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { text: 'Publish' }), h('span', { class: 'spacer' }), exportBtn),
      h('p', { class: 'small muted', text: `${approved} approved, ${rejected} rejected. Results that are not approved stay drafts and are not exported.` })),
    h('div', { class: 'card' }, h('h2', { text: `Data corrections proposed by the pipeline (${corr.length})` }),
      table(['Record key', 'Field', 'Old → new', 'Rule', 'Evidence', 'Review'], [],
        corrections.entries.map((c, i) => h('tr', {}, h('td', {}, h('code', { text: c.record_key })), h('td', { text: c.field }),
          h('td', { text: `${c.old_value ?? '–'} → ${c.new_value ?? 'excluded'}` }), h('td', { class: 'small', text: c.rule_or_model }),
          h('td', { class: 'small', text: c.evidence }), h('td', {}, controls(corr[i])))))),
    h('div', { class: 'card' }, h('h2', { text: `Audit log (${S.log.length} entries)` }),
      S.log.length
        ? table(['Time (UTC)', 'Record', 'Old → new', 'Approved by', 'Comment'], [],
          S.log.slice().reverse().map((e) => h('tr', {}, h('td', { class: 'small', text: e.timestamp }), h('td', {}, h('code', { text: e.record_key })),
            h('td', { text: `${e.old_value} → ${e.new_value}` }), h('td', { text: e.approved_by }), h('td', { class: 'small', text: e.comment || '' }))))
        : h('p', { class: 'muted', text: 'No decisions yet.' }),
      h('p', { class: 'small muted', text: 'Fields follow the audit-trail pattern in docs/AZURE_FABRIC_QUICKSTART.md. In production the log goes to a Fabric Delta table with Microsoft Entra ID sign-in.' })),
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
    const it = S.items[id] || { title: id, summary: '', src: {} };
    rows.push([id, it.title, it.summary, it.src.formula || '', (it.src.files || []).join('; '), r.by, r.ts, r.comment]);
  }
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = h('a', { href: url, download: `terratrace_approved_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- router
const ROUTES = { dashboard: pageDashboard, climate: pageClimate, nature: pageNature, transport: pageTransport, copilot: pageCopilot, review: pageReview };
function current() { const k = (location.hash || '').replace(/^#\/?/, ''); return ROUTES[k] ? k : 'dashboard'; }
function render() {
  const page = current();
  document.getElementById('tabs').replaceChildren(...PAGES.map(([k, t]) => h('a', { href: '#/' + k, class: k === page ? 'active' : null, 'aria-current': k === page ? 'page' : null, text: t })));
  const main = document.getElementById('main');
  try {
    main.replaceChildren(...ROUTES[page]());
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div', { class: 'err', text: 'This screen could not be shown. Please run "python3 run_all.py" again and reload the page. Details: ' + (e && e.message ? e.message : String(e)) }));
  }
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' (' + r.status + ')');
  return r.json();
}

async function start() {
  loadStore();
  S.ui = { climate: { combo: 'FI_SW|pea', scen: 'ssp245' }, nature: { id: null }, copilot: { q: '', answer: '', info: '', busy: false } };
  const rv = document.getElementById('reviewer');
  rv.value = S.reviewer;
  rv.addEventListener('input', () => { S.reviewer = rv.value.replace(/[\u0000-\u001f]/g, '').slice(0, 60); saveStore(); });
  try {
    const names = ['climate', 'nature', 'transport', 'actions', 'corrections', 'meta'];
    const vals = await Promise.all(names.map((n) => getJson(`data/${n}.json`)));
    names.forEach((n, i) => { S.data[n] = vals[i]; });
  } catch (e) {
    document.getElementById('main').replaceChildren(h('div', { class: 'err', text: 'Results not found. In the project folder run "python3 run_all.py", then "python3 server.py", and open http://127.0.0.1:8000 (' + e.message + ').' }));
    return;
  }
  S.ui.nature.id = S.data.nature.catchments[0].catchment_id;
  document.getElementById('banner').textContent = `${S.data.meta.note} Every number is a draft until an expert approves it. Results generated ${S.data.meta.generated_utc}.`;
  try { S.health = await getJson('/api/health'); } catch (e) { S.health = null; }
  window.addEventListener('hashchange', () => { render(); document.getElementById('main').focus(); });
  render();
}

window.addEventListener('error', (e) => console.error('TerraTrace error:', e.message));
start();
