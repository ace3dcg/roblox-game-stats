// Adds a "Stats" button to a Roblox game page and a side panel with CreatorExchange, RoTerminal and RoTrends data.

const meta = document.querySelector('#game-detail-meta-data');
const anchor = document.querySelector('.game-buttons-container');

function init() {
  const uid = meta.dataset.universeId;
  // data-source-text holds the untranslated name; the visible one may be localized.
  const name = document.querySelector('.game-name')?.dataset.sourceText || meta.dataset.placeName || '';

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
    <button class="open">📊 Stats</button>
    <aside hidden>
      <header><b></b><button class="close" aria-label="Close">✕</button></header>
      <section id="ce"><h2>CreatorExchange</h2><div class="body">Loading…</div></section>
      <section id="rt"><h2>RoTerminal</h2><div class="body">Loading…</div></section>
      <section id="rtr"><h2>RoTrends</h2><div class="body">Loading…</div></section>
      <section id="pt"><h2>Playtime (RoTerminal)</h2><div class="body">Loading…</div></section>
      <section id="ccu"><h2>CCU (RoTerminal)</h2><div class="body">Loading…</div></section>
    </aside>`;
  anchor.after(host);
  root.querySelector('header b').textContent = name;

  const panel = root.querySelector('aside');
  let loaded = false;
  root.querySelector('.open').onclick = () => {
    panel.hidden = !panel.hidden;
    if (loaded) return;
    loaded = true;
    load(root, ['ce'], 'creatorExchange', { uid, name }, ([el], d) => renderCE(el, d));
    load(root, ['rt', 'pt', 'ccu'], 'roTerminal', { uid }, ([rt, pt, ccu], d) => {
      renderRT(rt, d);
      renderPlaytime(pt, d.playtime);
      renderCCU(ccu, d.history);
    });
    load(root, ['rtr'], 'roTrends', { uid }, ([el], d) => renderRTR(el, d));
  };
  root.querySelector('.close').onclick = () => (panel.hidden = true);
}

// One request can fill several sections (RoTerminal feeds three).
function load(root, ids, source, args, render) {
  const bodies = ids.map((id) => root.querySelector(`#${id} .body`));
  chrome.runtime.sendMessage({ source, ...args }, (res) => {
    const error = !res || res.error ? `Error: ${res?.error ?? chrome.runtime.lastError?.message}` : null;
    bodies.forEach((b) => (error ? (b.textContent = error) : b.replaceChildren()));
    if (!error) render(bodies, res.data);
  });
}

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const day = (t) => new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

function renderCE(el, { game, exact, searchUrl }) {
  if (!game) return (el.innerHTML = `No results. <a href="${esc(searchUrl)}" target="_blank">Open search</a>`);
  const up = game.revenueIndicator > 0;
  el.innerHTML = `
    ${exact ? '' : '<p class="warn">No exact match, showing the first result.</p>'}
    <div class="ce-head"><img src="${esc(game.iconUrl)}" alt=""><b>${esc(game.name)}</b></div>
    <div class="grid">
      <span title="Playing now">▶ ${compact(game.playing)}</span>
      <span title="Visits">👥 ${compact(game.visits)}</span>
      <span title="Like ratio">👍 ${Math.round(game.likeRatio)}%</span>
      <span title="Revenue estimate">R$ ${compact(game.revenue)} ${game.revenueIndicator == null ? '' : `<i class="${up ? 'up' : 'down'}">${up ? '↑' : '↓'}</i>`}</span>
    </div>
    <a href="${esc(searchUrl)}" target="_blank">Search on CreatorExchange</a>`;
}

function bars(points, open, color) {
  const pts = points.slice(-14);
  if (!pts.length) return '';
  const max = Math.max(...pts.map((p) => p[1]), 1);
  const best = pts.reduce((a, p) => (p[1] > a[1] ? p : a), pts[0]);
  const cols = pts
    .map(([t, v]) => `<i style="height:${(v / max) * 100}%;background:${color}" class="${t === open ? 'open' : ''} ${t === best[0] ? 'best' : ''}" title="${day(t)}: ${compact(v)}"></i>`)
    .join('');
  return `<div class="best-v" style="color:${color}">${compact(best[1])}</div><div class="bars">${cols}</div>
    <div class="axis"><span>${day(pts[0][0])}</span><span>${day(pts.at(-1)[0])}</span></div>`;
}

function renderRT(el, d) {
  const month = d.verified?.month ?? d.mine?.month ?? d.est?.mid;
  const days = d.verified?.days ?? d.mine?.days ?? d.est?.days?.robux;
  const robux =
    month == null
      ? `<p class="muted">${d.shows === 'private' ? 'The developer keeps it private.' : 'Sign in to roterminal.co in Chrome to see it.'}</p>`
      : `<div class="big">R$ ${compact(month)} <small>$${compact(month * d.devex)}</small></div>
         ${d.est?.rank ? `<span class="pill">#${d.est.rank} Top Earning</span>` : ''}
         ${days?.length ? bars(days, d.est?.days?.open, '#e0b400') : ''}`;
  const p = d.play;
  const change = p?.was ? p.day / p.was - 1 : null;
  const hours =
    p?.day == null
      ? '<p class="muted">No data</p>'
      : `<div class="big">${compact(p.day)}</div>
         ${change == null ? '' : `<span class="pill ${change < 0 ? 'down' : 'up'}">${change < 0 ? '▼' : '▲'} ${Math.abs(change * 100).toFixed(1)}% <small>from ${compact(p.was)}</small></span>`}
         ${bars(p.days, p.open, '#2f7cf6')}`;
  el.innerHTML = `<div class="tiles">
    <div class="tile"><h3>Monthly Robux <small>Estimate</small></h3>${robux}</div>
    <div class="tile"><h3>Daily hours played</h3>${hours}</div></div>`;
}

// RoTerminal's own formula: minutes per visit between samples a and b, with area scaled up for gaps in coverage.
function perVisit(p, a, b) {
  const dt = p.t[b] - p.t[a], dv = p.visits[b] - p.visits[a], dc = p.covered[b] - p.covered[a];
  if (dv <= 0 || dc < dt * 0.8) return null;
  const m = ((p.area[b] - p.area[a]) * (dt / dc)) / 60 / dv;
  return m > 0 && m < 1440 ? m : null;
}

function renderPlaytime(el, p) {
  if (!p?.t?.length) return (el.innerHTML = '<p class="muted">No data</p>');
  const k = Math.round(86400 / (p.t[1] - p.t[0])); // samples in a 24h window
  const all = [];
  for (let i = k; i < p.t.length; i++) {
    const v = perVisit(p, i - k, i);
    if (v != null) all.push([p.t[i], v]);
  }
  // Values are 24h rolling already; 2h (1W) / 4h (All) steps make the line read like RoTerminal's. 1D keeps every 30-min sample.
  lineChart(el, all, {
    color: '#ff7a3d',
    ranges: [['1D', 86400, 1800], ['1W', 7 * 86400, 7200], ['All', Infinity, 14400]],
    value: (v) => `${v < 100 ? v.toFixed(1) : Math.round(v)} min`,
    sub: (t) => `Per visit · 24h to ${when(t)}`,
  });
}

// RoTerminal sends CCU history delta-encoded: dt in minutes (first entry absolute seconds), dv in players.
function renderCCU(el, h) {
  const all = [];
  let t = 0, v = 0;
  h?.dt?.forEach((dt, i) => all.push([(t = i ? t + dt * 60 : dt), (v += h.dv[i])]));
  lineChart(el, all, {
    color: '#2f7cf6',
    ranges: [['1D', 86400, 600], ['1W', 7 * 86400, 3600], ['All', Infinity, 10800]],
    value: (v) => `${Math.round(v).toLocaleString('en-US')} playing`,
    sub: (t) => when(t),
  });
}

const when = (t) => new Date(t * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Line chart with range buttons; hovering shows the nearest point's value and time in the header.
// ranges: [label, seconds back from the latest point, bucket size in seconds (latest point per bucket is kept)].
function lineChart(el, all, { color, ranges, value, sub }) {
  if (all.length < 2) return (el.innerHTML = '<p class="muted">Not enough data</p>');
  el.innerHTML = `<div class="pt-head"><div class="big pt-v"></div><small class="pt-when"></small></div>
    <svg class="pt" viewBox="0 0 400 130" preserveAspectRatio="none"></svg>
    <div class="toggle">${ranges.map(([r], i) => `<button class="${i ? '' : 'on'}" data-i="${i}">${r}</button>`).join('')}</div>`;
  const svg = el.querySelector('svg');
  const id = `g${color.slice(1)}`; // gradient ids share one shadow root
  const last = all.at(-1)[0];
  const show = ([t, v]) => {
    el.querySelector('.pt-v').textContent = value(v);
    el.querySelector('.pt-when').textContent = sub(t);
  };

  const draw = ([, back, gap]) => {
    const buckets = new Map();
    for (const p of all) if (p[0] >= last - back) buckets.set(Math.floor((last - p[0]) / gap), p); // all is time-sorted, so each bucket ends up with its latest point
    const pts = [...buckets.values()].sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) return (svg.innerHTML = '');
    const t0 = pts[0][0], t1 = pts.at(-1)[0];
    const vs = pts.map((p) => p[1]);
    const lo = Math.min(...vs), hi = Math.max(...vs), pad = (hi - lo) * 0.15 || 1;
    const X = (t) => ((t - t0) / (t1 - t0 || 1)) * 400;
    const Y = (v) => 125 - ((v - lo + pad) / (hi - lo + 2 * pad)) * 120;
    const line = pts.map(([t, v], i) => `${i ? 'L' : 'M'}${X(t).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line}L400,130L0,130Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      <line class="cross" y1="0" y2="130" stroke="#888" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
    const cross = svg.querySelector('.cross');
    show(pts.at(-1));
    svg.onpointermove = (e) => {
      const r = svg.getBoundingClientRect();
      const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
      const p = pts.reduce((a, b) => (Math.abs(b[0] - t) < Math.abs(a[0] - t) ? b : a));
      cross.setAttribute('x1', X(p[0]));
      cross.setAttribute('x2', X(p[0]));
      cross.setAttribute('visibility', 'visible');
      show(p);
    };
    svg.onpointerleave = () => {
      cross.setAttribute('visibility', 'hidden');
      show(pts.at(-1));
    };
  };

  el.querySelectorAll('.toggle button').forEach(
    (b) =>
      (b.onclick = () => {
        el.querySelectorAll('.toggle button').forEach((x) => x.classList.toggle('on', x === b));
        draw(ranges[b.dataset.i]);
      }),
  );
  draw(ranges[0]);
}

function renderRTR(el, d) {
  const today = Date.now();
  // A placement counts as active if its range ended within the last 2 days.
  const charts = d.charts.map((c) => ({ ...c, active: today - Date.parse(c.to) < 2 * 864e5 }));
  el.innerHTML = `
    <div class="stats">
      <div><small>Charts</small><b>${esc(d.placements ?? '-')}</b></div>
      <div><small>Global Rank</small><b>${esc(d.globalRank ?? '-')}</b></div>
      <div><small>Platform Share</small><b>${esc(d.share ?? '-')}</b></div>
    </div>
    <div class="toggle"><button class="on" data-f="all">All</button><button data-f="active">Active</button></div>
    <div class="cards">${charts
      .map(
        (c) => `<div class="card" data-active="${c.active}"><small>${esc(c.name)}</small>
        <div><b>#${c.rank}</b>${c.dir ? ` <span class="pill ${c.dir === 'rise' ? 'up' : 'down'}">${c.dir === 'rise' ? '↗' : '↘'} ${c.delta}</span>` : ''}</div>
        <small>${esc(c.from)} - ${esc(c.to)}</small></div>`,
      )
      .join('')}</div>
    <a href="${esc(d.url)}" target="_blank">Open on RoTrends</a>`;
  el.querySelectorAll('.toggle button').forEach(
    (b) =>
      (b.onclick = () => {
        el.querySelectorAll('.toggle button').forEach((x) => x.classList.toggle('on', x === b));
        el.querySelectorAll('.card').forEach((c) => (c.hidden = b.dataset.f === 'active' && c.dataset.active !== 'true'));
      }),
  );
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Builder Sans", system-ui, sans-serif; }
.open { margin-top: 8px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #1e2433; color: #fff; font-weight: 700; font-size: 15px; cursor: pointer; }
.open:hover { background: #2a3245; }
aside { position: fixed; top: 70px; right: 16px; bottom: 16px; width: min(440px, calc(100vw - 32px)); overflow-y: auto; z-index: 2147483647;
  background: #111; color: #eee; border: 1px solid #333; border-radius: 16px; padding: 16px; box-shadow: 0 10px 40px #000a; font-size: 13px; }
aside[hidden] { display: none; }
header { display: flex; justify-content: space-between; align-items: center; font-size: 16px; margin-bottom: 8px; }
.close { background: none; border: 0; color: #aaa; font-size: 18px; cursor: pointer; }
section { border-top: 1px solid #2a2a2a; padding: 12px 0; }
h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #888; }
h3 { margin: 0 0 6px; font-size: 13px; font-weight: 400; color: #aaa; display: flex; justify-content: space-between; }
a { color: #4c8dff; font-size: 12px; display: inline-block; margin-top: 8px; }
small, .muted { color: #999; }
.warn { color: #e0b400; margin: 0 0 6px; }
.ce-head { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; font-size: 15px; }
.ce-head img { width: 44px; height: 44px; border-radius: 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.grid span { background: #1b2233; border-radius: 6px; padding: 6px; text-align: center; font-weight: 700; color: #7fa7ff; }
.up { color: #3ccf7a; } .down { color: #ff5a5a; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tile { background: #1a1a1a; border: 1px solid #2c2c2c; border-radius: 14px; padding: 10px; }
.big { font-size: 22px; font-weight: 700; } .big small { font-size: 13px; color: #ddd; }
.pill { display: inline-block; background: #262626; border-radius: 999px; padding: 2px 8px; margin: 4px 0; font-size: 12px; }
.best-v { font-size: 11px; font-weight: 700; margin-top: 6px; }
.bars { display: flex; align-items: flex-end; gap: 2px; height: 60px; }
.bars i { flex: 1; border-radius: 2px 2px 0 0; opacity: .75; min-height: 2px; }
.bars i.best { opacity: 1; }
.bars i.open { background: repeating-linear-gradient(135deg, #888 0 2px, transparent 2px 4px) !important; }
.axis { display: flex; justify-content: space-between; color: #777; font-size: 10px; }
.stats { display: flex; gap: 18px; margin-bottom: 8px; } .stats div { display: flex; flex-direction: column; } .stats b { font-size: 16px; }
.toggle { display: inline-flex; background: #000; border-radius: 6px; padding: 2px; margin-bottom: 8px; }
.toggle button { background: none; border: 0; color: #aaa; padding: 3px 10px; border-radius: 4px; cursor: pointer; }
.toggle button.on { background: #333; color: #fff; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.card { background: #1a1a1a; border: 1px solid #2c2c2c; border-radius: 10px; padding: 8px; }
.card[hidden] { display: none; }
.card b { font-size: 17px; }
.pt-head { display: flex; flex-direction: column; margin-bottom: 4px; }
svg.pt { width: 100%; height: 130px; display: block; cursor: crosshair; touch-action: none; margin-bottom: 8px; }
`;

// Called last so the consts above (CSS etc.) are initialized.
if (meta && anchor) init();
