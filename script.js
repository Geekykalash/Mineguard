'use strict';

/* =====================================================================
   MineGuard AI - frontend logic
   Sections: helpers, config, theme, login, navigation, DEMO simulation,
             alerts, mine map, workers, LIVE monitoring, reports
   ===================================================================== */

/* ---------- helpers ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = ts => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' min ago';
  return Math.floor(m / 60) + ' h ago';
};
const clock = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ---------- config ---------- */
const DEMO_USER = { email: 'supervisor@mineguard.demo', password: 'mineguard123' }; // demo only, NOT secure
// If the page is served by the Node server (port 3000) use relative URLs, otherwise call it directly.
const API_BASE = location.port === '3000' ? '' : 'http://localhost:3000';
const STALE_MS = 10000;   // no new reading for 10 s  => device treated as disconnected
const POLL_MS  = 2000;    // how often the dashboard asks the backend
const SIM_MS   = 2500;    // demo simulation step

/* ---------- theme ---------- */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mg-theme', t); } catch (e) {}
  $$('.theme-toggle span').forEach(s => s.textContent = t === 'dark' ? 'Light mode' : 'Dark mode');
}
$$('.theme-toggle').forEach(b => b.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}));
setTheme(document.documentElement.dataset.theme || 'dark');

/* ---------- login ---------- */
$('#pw-toggle').addEventListener('click', () => {
  const i = $('#password');
  const show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  $('#pw-toggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('#login-form').addEventListener('submit', e => {
  e.preventDefault();
  const email = $('#email').value.trim().toLowerCase();
  const pw = $('#password').value;
  const err = $('#login-error');
  if (!email || !pw) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  if (email === DEMO_USER.email && pw === DEMO_USER.password) {
    err.hidden = true;
    try { sessionStorage.setItem('mg-auth', '1'); } catch (x) {}
    showApp();
  } else {
    err.textContent = 'Incorrect email or password.';
    err.hidden = false;
  }
});

$('#signout').addEventListener('click', () => {
  try { sessionStorage.removeItem('mg-auth'); } catch (x) {}
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#password').value = '';
});

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  startApp();
}

/* ---------- navigation ---------- */
const VIEWS = {
  overview: { title: 'Overview',        chip: ['DEMO DATA', 'demo'] },
  live:     { title: 'Live Monitoring', chip: ['LIVE HARDWARE', 'live'] },
  map:      { title: 'Mine Map',        chip: ['SIMULATED', 'demo'] },
  workers:  { title: 'Workers & Helmets', chip: ['DEMO DATA', 'demo'] },
  alerts:   { title: 'Safety Alerts',   chip: ['DEMO + LIVE', 'demo'] },
  reports:  { title: 'Reports',         chip: ['DEMO + LIVE', 'demo'] }
};
function go(name) {
  Object.keys(VIEWS).forEach(v => { $('#view-' + v).hidden = v !== name; });
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  $('#page-title').textContent = VIEWS[name].title;
  const chip = $('#page-chip');
  chip.textContent = VIEWS[name].chip[0];
  chip.className = 'chip ' + VIEWS[name].chip[1];
  if (name === 'reports') renderReports();
  refreshAll();
}
$$('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.view)));
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

/* =====================================================================
   DEMO DATA + SIMULATION  (never mixed with live hardware data)
   ===================================================================== */
const ZONES = {
  entrance:   { name: 'Entrance',           type: 'safe',       path: 'M400 450 L400 318', slots: [[400, 428], [400, 394], [400, 360]], label: [430, 446] },
  junction:   { name: 'Central Junction',   type: 'safe',       slots: [[386, 292], [414, 292], [400, 274]], label: [450, 336] },
  north:      { name: 'North Tunnel',       type: 'safe',       path: 'M400 256 L400 60', slots: [[400, 226], [400, 172], [400, 118], [400, 84]], label: [430, 92] },
  east:       { name: 'East Tunnel',        type: 'caution',    path: 'M434 290 L690 290 L690 110', slots: [[484, 290], [560, 290], [636, 290], [690, 232], [690, 152]], label: [500, 262], suffix: ' · Caution' },
  west:       { name: 'West Tunnel',        type: 'safe',       path: 'M366 290 L110 290', slots: [[322, 290], [252, 290], [182, 290], [132, 290]], label: [200, 262] },
  restricted: { name: 'Restricted Section', type: 'restricted', path: 'M110 290 L110 430', slots: [[110, 336], [110, 380], [110, 418]], label: [140, 408], suffix: ' · Restricted' }
};
const isHaz = z => ZONES[z].type === 'restricted';

const WORKERS = [
  { id: 'W-101', name: 'Rahul Sharma', helmet: 'HLM-001', role: 'Haulage operator', assigned: 'North Tunnel',
    route: [['north',0],['north',1],['north',2],['north',3],['north',2],['north',1]] },
  { id: 'W-102', name: 'Amit Verma',   helmet: 'HLM-002', role: 'Continuous miner', assigned: 'East Tunnel',
    route: [['east',0],['east',1],['east',2],['east',3],['east',4],['east',3],['east',2],['east',1]] },
  { id: 'W-103', name: 'Priya Singh',  helmet: 'HLM-003', role: 'Safety inspector', assigned: 'West Tunnel',
    route: [['west',0],['west',1],['west',2],['west',3],['west',2],['west',1]] },
  { id: 'W-104', name: 'Arjun Kumar',  helmet: 'HLM-004', role: 'Roof bolter', assigned: 'North Tunnel',
    route: [['north',0],['north',1],['north',0],['junction',2],['west',0],['west',1],['west',2],['west',3],
            ['restricted',0],['restricted',1],['restricted',2],['restricted',1],['restricted',0],
            ['west',3],['west',2],['west',1],['west',0],['junction',1]] },
  { id: 'W-105', name: 'Neha Patel',   helmet: 'HLM-005', role: 'Ventilation tech', assigned: 'East Tunnel',
    route: [['east',0],['east',1],['east',2],['east',1]] },
  { id: 'W-106', name: 'Vikram Yadav', helmet: 'HLM-006', role: 'Electrician', assigned: 'West Tunnel',
    route: [['west',0],['west',1],['west',2],['west',1]] }
];

let alerts = [];
let alertSeq = 100;
let alertFilter = 'all';
let selectedId = null;
let simRunning = true;
let simTicks = 0;
let appStarted = false;

function initWorkers() {
  WORKERS.forEach((w, i) => {
    w.idx = (i * 2) % w.route.length;
    if (w.id === 'W-104') w.idx = 0;
    [w.zone, w.slot] = w.route[w.idx];
    w.online = true;
    w.updated = Date.now();
    w.override = null;
  });
}

function seedAlerts() {
  alerts = alerts.filter(a => a.source === 'live');
  alerts.push(
    { id: 'ALT-099', source: 'demo', type: 'Gas threshold warning', severity: 'warning', title: 'Gas level above warning limit',
      detail: 'Sample event for North Tunnel.', workerId: '', zone: 'North Tunnel', ts: Date.now() - 9 * 60000, ack: false },
    { id: 'ALT-098', source: 'demo', type: 'Helmet offline', severity: 'info', title: 'HLM-005 reconnected',
      detail: 'Sample event.', workerId: 'W-105', zone: 'East Tunnel', ts: Date.now() - 26 * 60000, ack: true }
  );
  alerts.sort((a, b) => b.ts - a.ts);
}

function addAlert(o) {
  alertSeq++;
  const a = Object.assign({ id: 'ALT-' + alertSeq, ts: Date.now(), ack: false, workerId: '', zone: '' }, o);
  alerts.unshift(a);
  if (alerts.length > 80) alerts.pop();
  if (o.toast) toast(a.title, a.detail);
  renderAlerts(); updateBadge();
  return a;
}

function moveWorker(w, zone, slot) {
  const prev = w.zone;
  w.zone = zone; w.slot = slot; w.updated = Date.now();
  const was = isHaz(prev), now = isHaz(zone);
  // alert only on the transition, so staying inside the zone never spams
  if (now && !was) {
    addAlert({ source: 'demo', type: 'Hazardous-zone entry', severity: 'critical', toast: true,
      title: `${w.name} entered ${ZONES[zone].name}`,
      detail: `Helmet ${w.helmet} detected in a configured restricted zone (simulated).`,
      workerId: w.id, zone: ZONES[zone].name });
  } else if (!now && was) {
    addAlert({ source: 'demo', type: 'Hazardous-zone exit', severity: 'info', ack: true,
      title: `${w.name} left ${ZONES[prev].name}`,
      detail: 'Worker is no longer inside a restricted zone (simulated).',
      workerId: w.id, zone: ZONES[zone].name });
  }
}

function setOnline(w, flag) {
  if (w.online === flag) return;
  w.online = flag; w.updated = Date.now();
  if (!flag) {
    addAlert({ source: 'demo', type: 'Helmet offline', severity: 'warning',
      title: `${w.helmet} went offline`, detail: `Last known zone: ${ZONES[w.zone].name}. Offline does not mean safe (simulated).`,
      workerId: w.id, zone: ZONES[w.zone].name });
  } else {
    addAlert({ source: 'demo', type: 'Helmet offline', severity: 'info', ack: true,
      title: `${w.helmet} back online`, detail: 'Connection restored (simulated).', workerId: w.id, zone: ZONES[w.zone].name });
  }
}

function simTick() {
  if (!simRunning) return;
  simTicks++;
  WORKERS.forEach(w => {
    if (w.id === 'W-105') { const ph = simTicks % 24; setOnline(w, !(ph >= 14 && ph <= 17)); }
    if (!w.online) return;
    if (w.override) { w.override.ticks--; if (w.override.ticks <= 0) w.override = null; return; }
    w.idx = (w.idx + 1) % w.route.length;
    const [z, s] = w.route[w.idx];
    moveWorker(w, z, s);
  });
  refreshAll();
}

const statusOf = w => !w.online ? 'offline' : (isHaz(w.zone) ? 'danger' : 'safe');
const activeAlerts = src => alerts.filter(a => !a.ack && a.severity !== 'info' && (!src || a.source === src));

/* ---------- controls on the map ---------- */
$('#sim-toggle').addEventListener('click', () => {
  simRunning = !simRunning;
  $('#sim-toggle').textContent = simRunning ? 'Pause' : 'Resume';
});
$('#sim-danger').addEventListener('click', () => {
  const w = WORKERS.find(x => x.id === 'W-106');
  if (!w.online || isHaz(w.zone)) return;
  w.override = { ticks: 4 };
  moveWorker(w, 'restricted', 0);
  selectedId = w.id;
  refreshAll();
});
$('#sim-reset').addEventListener('click', () => {
  simTicks = 0; initWorkers(); seedAlerts(); selectedId = null; refreshAll(); renderAlerts(); updateBadge();
});

/* =====================================================================
   RENDERING
   ===================================================================== */
function refreshAll() {
  renderOverview(); updateMap(); renderWorkers(); renderAlerts(); updateBadge();
}

/* ---------- overview ---------- */
function renderOverview() {
  const online = WORKERS.filter(w => w.online).length;
  $('#m-total').textContent = WORKERS.length;
  $('#m-online').textContent = `${online}/${WORKERS.length}`;
  $('#m-alerts').textContent = activeAlerts('demo').length;

  $('#zone-summary').innerHTML = ['north', 'east', 'west', 'restricted'].map(id => {
    const z = ZONES[id];
    const n = WORKERS.filter(w => w.online && w.zone === id).length;
    let chip = '<span class="chip ok">Safe</span>';
    if (z.type === 'caution') chip = '<span class="chip warn">Caution</span>';
    if (z.type === 'restricted') chip = n ? '<span class="chip danger">Occupied</span>' : '<span class="chip mute">Restricted</span>';
    const dot = z.type === 'restricted' ? 'danger' : z.type === 'caution' ? 'warn' : 'ok';
    return `<div class="list-row"><span class="dot ${dot}" style="box-shadow:none"></span>
      <div class="grow"><div class="t">${z.name}</div><div class="s">${n} worker${n === 1 ? '' : 's'} detected</div></div>${chip}</div>`;
  }).join('');

  const recent = alerts.slice(0, 5);
  $('#recent').innerHTML = recent.length ? recent.map(a => {
    const dot = a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : '';
    return `<div class="list-row"><span class="dot ${dot}" style="box-shadow:none"></span>
      <div class="grow"><div class="t">${esc(a.title)}</div><div class="s">${ago(a.ts)} · ${a.source === 'live' ? 'LIVE' : 'DEMO'}</div></div></div>`;
  }).join('') : '<p class="empty">No activity yet.</p>';
}

/* ---------- mine map ---------- */
function buildMap() {
  const svg = $('#mine-svg');
  const zs = Object.entries(ZONES);
  let s = '<g>';
  zs.forEach(([, z]) => { if (z.path) s += `<path class="t-out ${z.type}" d="${z.path}"/>`; });
  s += '<circle class="t-out safe" cx="400" cy="290" r="34" style="stroke-width:6;fill:none"/>';
  s += '</g><g>';
  zs.forEach(([, z]) => { if (z.path) s += `<path class="t-core" d="${z.path}"/>`; });
  s += '<circle cx="400" cy="290" r="34" class="t-core" style="stroke-width:0;fill:var(--tunnel)"/>';
  s += '</g>';
  zs.forEach(([, z]) => {
    s += `<text class="zlabel ${z.type === 'safe' ? '' : z.type}" x="${z.label[0]}" y="${z.label[1]}">${z.name}${z.suffix || ''}</text>`;
  });
  s += '<g id="markers"></g>';
  svg.innerHTML = s;
  // core fill for junction in both themes
  const j = svg.querySelector('circle.t-core');
  j.style.fill = getComputedStyle(document.documentElement).getPropertyValue('--tunnel');
}

function markerPos(w, i) {
  const [x, y] = ZONES[w.zone].slots[w.slot];
  let k = 0;
  for (let j = 0; j < i; j++) if (WORKERS[j].zone === w.zone && WORKERS[j].slot === w.slot) k++;
  return [x + k * 16, y + k * 4];
}

function updateMap() {
  const g = $('#markers');
  if (!g) return;
  WORKERS.forEach((w, i) => {
    let el = g.querySelector(`[data-id="${w.id}"]`);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      el.setAttribute('class', 'mk');
      el.dataset.id = w.id;
      el.innerHTML = `<circle class="pulse" r="10"/><circle class="ring" r="15"/><circle class="dot-c" r="11"/>
        <text class="num">${i + 1}</text><text class="mkname" x="18" y="4">${esc(w.name)}</text>`;
      g.appendChild(el);
    }
    const [x, y] = markerPos(w, i);
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.classList.remove('danger', 'offline');
    const st = statusOf(w);
    if (st !== 'safe') el.classList.add(st);
    el.classList.toggle('sel', w.id === selectedId);
  });
  renderDetail();
}

$('#mine-svg').addEventListener('click', e => {
  const m = e.target.closest('.mk');
  selectedId = m ? m.dataset.id : null;
  updateMap();
});

function renderDetail() {
  const box = $('#map-detail');
  const w = WORKERS.find(x => x.id === selectedId);
  if (!w) {
    box.innerHTML = '<h3>Worker details</h3><p class="empty-state muted" style="margin-top:8px">Select a worker marker on the map to see details. Positions here are simulated.</p>';
    return;
  }
  const st = statusOf(w);
  const stChip = st === 'danger' ? '<span class="chip danger">In restricted zone</span>' : st === 'offline' ? '<span class="chip mute">Offline</span>' : '<span class="chip ok">Safe</span>';
  box.innerHTML = `
    <div class="card-head" style="margin-bottom:10px"><h3>${esc(w.name)}</h3><span class="chip demo">SIMULATED</span></div>
    <p class="muted small" style="margin-bottom:14px">${esc(w.role)}</p>
    <div class="kv"><span>Worker ID</span><strong class="mono">${w.id}</strong></div>
    <div class="kv"><span>Helmet</span><strong class="mono">${w.helmet}</strong></div>
    <div class="kv"><span>Assigned zone</span><strong>${w.assigned}</strong></div>
    <div class="kv"><span>Detected zone</span><strong>${w.online ? ZONES[w.zone].name : 'Unknown'}</strong></div>
    <div class="kv"><span>Connection</span><strong>${w.online ? 'Online' : 'Offline'}</strong></div>
    <div class="kv"><span>Safety status</span>${stChip}</div>
    <div class="kv"><span>Last update</span><strong>${ago(w.updated)}</strong></div>`;
}

/* ---------- workers table ---------- */
function renderWorkers() {
  const q = $('#worker-search').value.trim().toLowerCase();
  const rows = WORKERS.filter(w => !q || [w.name, w.id, w.helmet].join(' ').toLowerCase().includes(q));
  $('#workers-body').innerHTML = rows.map(w => {
    const st = statusOf(w);
    const stChip = st === 'danger' ? '<span class="chip danger">Restricted zone</span>' : st === 'offline' ? '<span class="chip mute">Unknown</span>' : '<span class="chip ok">Safe</span>';
    const conn = w.online ? '<span class="chip ok">Online</span>' : '<span class="chip warn">Offline</span>';
    return `<tr>
      <td><div class="t">${esc(w.name)}</div><div class="s mono">${w.id}</div></td>
      <td class="mono">${w.helmet}</td>
      <td>${w.assigned}</td>
      <td>${w.online ? ZONES[w.zone].name : '—'}</td>
      <td>${conn}</td><td>${stChip}</td>
      <td class="muted">${ago(w.updated)}</td>
      <td><button class="btn sm" data-locate="${w.id}">Locate</button></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">No workers match.</td></tr>';
}
$('#worker-search').addEventListener('input', renderWorkers);
$('#workers-body').addEventListener('click', e => {
  const b = e.target.closest('[data-locate]');
  if (!b) return;
  selectedId = b.dataset.locate;
  go('map');
});

/* ---------- alerts ---------- */
function renderAlerts() {
  const list = alerts.filter(a => alertFilter === 'all' || (alertFilter === 'active' ? !a.ack : a.ack));
  $('#alert-list').innerHTML = list.length ? list.map(a => {
    const sev = a.severity === 'critical' ? '<span class="chip danger">CRITICAL</span>' : a.severity === 'warning' ? '<span class="chip warn">WARNING</span>' : '<span class="chip info">INFO</span>';
    const src = a.source === 'live' ? '<span class="chip live">LIVE</span>' : '<span class="chip demo">DEMO</span>';
    const who = [a.workerId && (WORKERS.find(w => w.id === a.workerId) || {}).name, a.zone].filter(Boolean).join(' · ');
    return `<div class="alert ${a.severity} ${a.ack ? 'done' : ''}">
      <div class="alert-top">${sev}<strong>${esc(a.type)}</strong>${src}<span class="time">${ago(a.ts)} · ${clock(a.ts)}</span></div>
      <h4>${esc(a.title)}</h4>
      <p>${esc(a.detail)}${who ? ' — ' + esc(who) : ''}</p>
      <div class="alert-foot"><span class="ref">${a.id}</span>
        ${a.ack ? '<span class="chip mute">Acknowledged</span>' : `<button class="btn sm" data-ack="${a.id}">Acknowledge</button>`}</div></div>`;
  }).join('') : '<div class="card"><p class="muted">No alerts.</p></div>';
}
$('#alert-tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  alertFilter = t.dataset.filter;
  $$('.tab').forEach(x => x.classList.toggle('active', x === t));
  renderAlerts();
});
$('#alert-list').addEventListener('click', e => {
  const b = e.target.closest('[data-ack]'); if (!b) return;
  const a = alerts.find(x => x.id === b.dataset.ack);
  if (a) { a.ack = true; renderAlerts(); updateBadge(); renderOverview(); }
});
function updateBadge() {
  const n = activeAlerts().length;
  const b = $('#nav-badge');
  b.textContent = n; b.hidden = n === 0;
}

/* ---------- toast ---------- */
let toastTimer;
function toast(title, text) {
  const t = $('#toast');
  t.innerHTML = `<strong>${esc(title)}</strong><span>${esc(text)}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

/* =====================================================================
   LIVE MONITORING - real ESP8266 data only (polls the Node backend)
   Nothing here is simulated. No data => "Disconnected", never "Safe".
   ===================================================================== */
const live = {
  backend: false,      // can we reach the server?
  hasData: false,      // has any device ever sent data?
  deviceId: null,
  value: null,
  ageMs: null,
  receivedAt: null,    // server timestamp (ms) of latest reading
  connected: false,
  risk: 'unknown',
  history: []          // {t, v, device, risk}
};
let threshold = null;
try { const t = parseFloat(localStorage.getItem('mg-threshold')); if (t > 0) threshold = t; } catch (e) {}
$('#thr-input').value = threshold || '';

$('#thr-save').addEventListener('click', () => {
  const v = parseFloat($('#thr-input').value);
  threshold = v > 0 ? v : null;
  try { threshold ? localStorage.setItem('mg-threshold', threshold) : localStorage.removeItem('mg-threshold'); } catch (e) {}
  live.risk = 'unknown';
  computeRisk(); renderLive();
});

function computeRisk() {
  const prev = live.risk;
  if (!live.connected || live.value == null || !threshold) { live.risk = 'unknown'; return; }
  const v = live.value;
  if (v >= threshold) live.risk = 'high';
  else if (prev === 'high' && v >= threshold * 0.95) live.risk = 'high'; // small hysteresis
  else if (v >= threshold * 0.7) live.risk = 'medium';
  else live.risk = 'low';
  if (live.risk === 'high' && prev !== 'high') {
    addAlert({ source: 'live', type: 'Gas threshold warning', severity: 'critical', toast: true,
      title: `High gas reading on ${live.deviceId}`,
      detail: `Raw value ${v} reached the configured threshold ${threshold}.`, workerId: '', zone: '' });
  }
}

async function pollLive() {
  const wasConnected = live.connected;
  try {
    const r = await fetch(API_BASE + '/api/latest', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    live.backend = true;
    if (d.value == null) {
      live.hasData = false; live.connected = false;
    } else {
      live.hasData = true;
      live.deviceId = d.device_id;
      live.value = d.value;
      live.receivedAt = d.received_at;
      live.ageMs = d.server_time - d.received_at;   // both from the server clock
      live.connected = live.ageMs < STALE_MS;
      if (live.connected && (!live.history.length || live.history[live.history.length - 1].t !== d.received_at)) {
        computeRisk();
        live.history.push({ t: d.received_at, v: d.value, device: d.device_id, risk: live.risk });
        if (live.history.length > 500) live.history.shift();
      }
    }
  } catch (err) {
    live.backend = false; live.connected = false;
  }
  if (wasConnected && !live.connected && live.hasData) {
    addAlert({ source: 'live', type: 'Helmet offline', severity: 'warning',
      title: `${live.deviceId} stopped sending data`,
      detail: 'No fresh reading received. This does not mean the area is safe.', workerId: '', zone: '' });
  }
  computeRisk();
  renderLive();
}

function renderLive() {
  const st = $('#live-status'), msg = $('#live-msg'), dot = $('#live-dot');
  if (live.connected) {
    st.textContent = 'Connected';
    msg.textContent = 'Receiving fresh readings from the device.';
    dot.className = 'dot ok';
  } else {
    st.textContent = 'Disconnected';
    dot.className = 'dot warn';
    if (!live.backend) msg.textContent = 'Cannot reach the live-data backend. Start the Node server and check the connection.';
    else if (!live.hasData) msg.textContent = 'Backend is running, but no device has sent data yet.';
    else msg.textContent = `No new data for ${Math.round(live.ageMs / 1000)} s. Data unavailable. Check the device.`;
  }

  $('#live-value').textContent = live.connected ? live.value : '—';
  $('#live-device').textContent = live.deviceId || 'Not detected';

  const rEl = $('#live-risk');
  const labels = { low: 'Low risk', medium: 'Medium risk', high: 'High risk', unknown: 'Unknown' };
  rEl.textContent = labels[live.risk];
  rEl.className = 'big risk-' + live.risk;
  $('#live-risk-note').textContent = !live.connected ? 'No fresh data, so risk cannot be determined'
    : !threshold ? 'Set a threshold below to enable risk status'
    : `Threshold: ${threshold} (raw value)`;

  if (live.hasData) {
    $('#live-last').textContent = clock(live.receivedAt);
    $('#live-age').textContent = live.connected ? 'Updated ' + Math.round(live.ageMs / 1000) + ' s ago' : 'Last data received at this time';
  } else {
    $('#live-last').textContent = '—';
    $('#live-age').textContent = 'No data received';
  }
  drawChart();
}

function drawChart() {
  const svg = $('#live-chart');
  const pts = live.history.slice(-60);
  if (pts.length < 2) {
    svg.innerHTML = '<text x="300" y="80" text-anchor="middle">Waiting for live readings…</text>';
    return;
  }
  const max = Math.max(1023, ...pts.map(p => p.v), threshold || 0);
  const W = 600, H = 150, pad = 14;
  const x = i => (i / (pts.length - 1)) * W;
  const y = v => H - pad - (v / max) * (H - pad * 2);
  let s = [0.25, 0.5, 0.75].map(f => `<line class="grid" x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}"/>`).join('');
  if (threshold) s += `<line class="thr" x1="0" x2="${W}" y1="${y(threshold)}" y2="${y(threshold)}"/>`;
  s += `<polyline class="line" points="${pts.map((p, i) => x(i) + ',' + y(p.v)).join(' ')}"/>`;
  svg.innerHTML = s;
}

/* =====================================================================
   REPORTS (CSV)
   ===================================================================== */
function renderReports() {
  const d = alerts.filter(a => a.source === 'demo').length;
  const l = alerts.filter(a => a.source === 'live').length;
  $('#rep-alerts').textContent = `${alerts.length} events (${d} demo, ${l} live)`;
  $('#rep-readings').textContent = `${live.history.length} real readings this session`;
}
function csv(rows) { return rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n'); }
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
$('#exp-alerts').addEventListener('click', () => {
  const rows = [['alert_id', 'source', 'type', 'severity', 'worker', 'zone', 'timestamp_iso', 'acknowledged', 'detail']];
  alerts.forEach(a => rows.push([a.id, a.source === 'live' ? 'LIVE' : 'DEMO', a.type, a.severity,
    (WORKERS.find(w => w.id === a.workerId) || {}).name || a.workerId, a.zone, new Date(a.ts).toISOString(), a.ack ? 'yes' : 'no', a.detail]));
  download('mineguard_alerts.csv', csv(rows));
});
$('#exp-readings').addEventListener('click', () => {
  const rows = [['source', 'timestamp_iso', 'device_id', 'raw_value', 'risk_at_reading']];
  live.history.forEach(h => rows.push(['LIVE', new Date(h.t).toISOString(), h.device, h.v, h.risk]));
  download('mineguard_live_readings.csv', csv(rows));
});

/* =====================================================================
   QUICK ASSISTANT - rule-based chatbot (NOT an AI model, no internet).
   It only answers from data already on the dashboard, and keeps
   demo/simulated data clearly separate from real ESP8266 data.
   ===================================================================== */
const chatState = { greeted: false };
const hasAny = (q, words) => words.some(w => new RegExp('\\b' + w).test(q));
const srcTag = a => (a.source === 'live' ? 'LIVE' : 'DEMO');

function riskText() {
  const label = { low: 'Low', medium: 'Medium', high: 'High', unknown: 'Unknown' }[live.risk];
  return label + (threshold ? ` (threshold ${threshold})` : ' (no threshold set)');
}

function replyAlerts() {
  const lv = activeAlerts('live'), dm = activeAlerts('demo');
  let t = `Unacknowledged warning/critical alerts: ${lv.length + dm.length}\n• Live: ${lv.length}\n• Demo: ${dm.length}`;
  const top = lv.concat(dm).sort((a, b) => b.ts - a.ts).slice(0, 3);
  if (top.length) t += '\n\nLatest:\n' + top.map(a => `• ${a.title} (${srcTag(a)}, ${ago(a.ts)})`).join('\n');
  return t + '\n\nOpen Safety Alerts to acknowledge them.';
}

function replyOffline() {
  const off = WORKERS.filter(w => !w.online);
  let t = off.length
    ? `Offline helmets (demo): ${off.length}\n` +
      off.map(w => `• ${w.helmet} - ${w.name}, last known zone: ${ZONES[w.zone].name}`).join('\n') +
      '\nOffline does not mean safe. Their current location is unknown.'
    : 'All demo helmets are online right now (simulated).';
  t += '\n\nReal ESP8266 device: ' +
    (live.connected ? `${live.deviceId} is connected.`
      : live.hasData ? `${live.deviceId} is disconnected (no fresh data).`
      : 'no device has reported yet.');
  return t;
}

function replyRestricted() {
  const inHaz = WORKERS.filter(w => w.online && isHaz(w.zone));
  const off = WORKERS.filter(w => !w.online).length;
  let t = inHaz.length
    ? `In a restricted zone now (simulated): ${inHaz.length}\n` +
      inHaz.map(w => `• ${w.name} (${w.helmet}) in ${ZONES[w.zone].name}, updated ${ago(w.updated)}`).join('\n')
    : 'No online demo worker is detected in a restricted zone right now (simulated).';
  if (off) t += `\n\n${off} helmet(s) are offline, so their location is unknown.`;
  return t + '\n\nPositions are simulated until real positioning hardware is connected.';
}

function replyLive() {
  if (!live.backend) return 'Live data unavailable. I cannot reach the backend server. Start it with "node server.js" and check the connection.';
  if (!live.hasData) return 'The backend is running, but no ESP8266 has sent any data yet.';
  if (!live.connected) return `${live.deviceId} is disconnected. No fresh data for ${Math.round(live.ageMs / 1000)} s, so the data is unavailable. This does not mean the area is safe.`;
  return `Live device ${live.deviceId} (real hardware)\n• Raw gas value: ${live.value} (uncalibrated, not ppm)\n• Updated ${Math.round(live.ageMs / 1000)} s ago\n• Risk: ${riskText()}`;
}

function replyRisk() {
  if (!live.connected) return 'Risk status: Unknown. There is no fresh live data, so risk cannot be determined. Unknown is not the same as safe.';
  if (!threshold) return 'Risk status: Unknown. No threshold is set yet. Set one in Live Monitoring > Device details.';
  return `Live risk: ${riskText()}\nRaw value ${live.value} on ${live.deviceId}.`;
}

function replyThreshold() {
  return threshold
    ? `High-risk threshold: ${threshold} (raw sensor value).\nMedium risk starts at ${Math.round(threshold * 0.7)}.\nYou can change it in Live Monitoring > Device details.`
    : 'No threshold is set yet, so live risk shows Unknown. Set one in Live Monitoring > Device details, using values from your own sensor tests.';
}

function replySafe() {
  return 'I cannot confirm that the mine is safe. This prototype only shows sensor readings and sample data. It is not a certified safety system.\n\n' + replyLive();
}

function replyWorkers() {
  const on = WORKERS.filter(w => w.online).length;
  const haz = WORKERS.filter(w => w.online && isHaz(w.zone)).length;
  return `Demo workers: ${WORKERS.length}\n• Helmets online: ${on}\n• Offline: ${WORKERS.length - on}\n• In a restricted zone: ${haz}\n\nThese are fictional sample records (demo). Ask about a worker by name, for example "Where is Arjun?".`;
}

function replyZone(id) {
  const ws = WORKERS.filter(w => w.online && w.zone === id);
  return `${ZONES[id].name} (${ZONES[id].type}, simulated)\n` +
    (ws.length ? ws.map(w => `• ${w.name} (${w.helmet})`).join('\n') : 'No online worker detected here right now.');
}

function replyWorker(w) {
  const st = statusOf(w);
  const status = st === 'danger' ? 'In restricted zone' : st === 'offline' ? 'Unknown (helmet offline)' : 'Safe';
  return `${w.name} (${w.id}, ${w.helmet}) - demo\n• Role: ${w.role}\n• Assigned zone: ${w.assigned}\n• Detected zone: ${w.online ? ZONES[w.zone].name : 'Unknown (helmet offline)'}\n• Connection: ${w.online ? 'Online' : 'Offline'}\n• Status: ${status}\n• Updated ${ago(w.updated)}\nPosition is simulated.`;
}

function replyModes() {
  return 'Two kinds of data here:\n• DEMO / SIMULATED: sample workers, positions and alerts (Overview, Mine Map, Workers, demo alerts).\n• LIVE: real readings from your ESP8266 (Live Monitoring only).\n\nDemo data is never shown as real, and missing live data is never replaced with fake values.';
}

function replyHelp() {
  return 'I can answer questions about:\n• active alerts\n• offline helmets\n• who is in the restricted zone\n• live gas reading and risk status\n• the risk threshold\n• workers (try a name, like "Where is Priya?")\n• a zone (north, east, west, junction, entrance)\n\nTap a quick button below or type your question.';
}

const ZONE_WORDS = { north: 'north', east: 'east', west: 'west', junction: 'junction', entrance: 'entrance' };

function chatAnswer(raw) {
  const q = raw.toLowerCase().trim();
  if (!q) return null;

  const w = WORKERS.find(x => [x.name.split(' ')[0], x.name, x.id, x.helmet]
    .some(k => new RegExp('\\b' + k.toLowerCase() + '\\b').test(q)));
  if (w) return replyWorker(w);

  if (/\bsafe\b/.test(q)) return replySafe();
  if (hasAny(q, ['restricted', 'danger', 'hazard', 'khatra', 'khatre'])) return replyRestricted();
  if (hasAny(q, ['offline', 'disconnect', 'not connected'])) return replyOffline();
  if (hasAny(q, ['alert', 'alarm', 'warning', 'notification'])) return replyAlerts();
  if (hasAny(q, ['threshold', 'limit'])) return replyThreshold();
  if (hasAny(q, ['risk'])) return replyRisk();
  if (hasAny(q, ['gas', 'live', 'reading', 'sensor', 'esp', 'value', 'device', 'hardware'])) return replyLive();

  const zid = Object.keys(ZONE_WORDS).find(k => new RegExp('\\b' + k).test(q));
  if (zid) return replyZone(ZONE_WORDS[zid]);

  if (hasAny(q, ['demo', 'simulat', 'real', 'fake'])) return replyModes();
  if (hasAny(q, ['worker', 'helmet', 'people', 'total', 'online', 'staff', 'kitne'])) return replyWorkers();
  if (/\b(hi|hello|hey|namaste|help|menu)\b/.test(q)) return replyHelp();

  return "I didn't understand that. I can only answer from the dashboard data.\n\n" + replyHelp();
}

function chatAdd(role, text) {
  const log = $('#chat-log');
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

function chatSend(text) {
  const t = String(text).trim();
  if (!t) return;
  chatAdd('user', t);
  const answer = chatAnswer(t);
  setTimeout(() => chatAdd('bot', answer), 250);
}

function toggleChat(force) {
  const panel = $('#chat-panel');
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  $('#chat-fab').setAttribute('aria-expanded', String(open));
  if (open) {
    if (!chatState.greeted) {
      chatState.greeted = true;
      chatAdd('bot', "Hi! I'm the MineGuard quick assistant. I answer from this dashboard's data using simple rules. I'm not an AI model.\n\nTry a quick button below, or type a question.");
    }
    $('#chat-input').focus();
  }
}

$('#chat-fab').addEventListener('click', () => toggleChat());
$('#chat-close').addEventListener('click', () => toggleChat(false));
$('#chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#chat-input');
  chatSend(input.value);
  input.value = '';
});
$('#chat-quick').addEventListener('click', e => {
  const b = e.target.closest('[data-q]');
  if (b) chatSend(b.dataset.q);
});

/* =====================================================================
   START
   ===================================================================== */
function startApp() {
  if (appStarted) { go('overview'); return; }
  appStarted = true;
  initWorkers(); seedAlerts(); buildMap();
  go('overview');
  setInterval(simTick, SIM_MS);
  setInterval(() => { if (!$('#view-reports').hidden) renderReports(); }, 3000);
  pollLive(); setInterval(pollLive, POLL_MS);
  setInterval(() => { renderOverview(); renderWorkers(); renderAlerts(); renderDetail(); }, 5000);
}

// keep the session if the page is refreshed
try { if (sessionStorage.getItem('mg-auth') === '1') showApp(); } catch (e) {}
