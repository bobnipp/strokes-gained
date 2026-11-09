import * as db from './db.js';
import { loadBaseline, holeSG } from './sg.js';
import * as sync from './sync.js';

const $ = document.getElementById('app');
let B, lastKey = '', armTimer, syncTimer;
const S = {
  screen: 'home', courses: [], rounds: [], holes: {}, cur: 0, draft: null, viewId: null,
  pad: null, sheet: null, arm: null, ec: null, et: 0, err: '',
  nr: { courseId: null, tee: null, range: '18', date: today() },
  sync: { state: 'off', at: 0, email: null, error: '' }, email: '', sent: false, update: false,
  prog: { range: '10', cat: 'total' }, from: null
};
const KEYS = ['ott', 'app', 'arg', 'putt'];
const SHORT = { ott: 'Tee', app: 'App', arg: 'ARG', putt: 'Putt' };
const NAME = { ott: 'Off the tee', app: 'Approach', arg: 'Around green', putt: 'Putting' };
const RANGE = { '18': [0, 18], front: [0, 9], back: [9, 9] };
const CLAMP = { approach_from_yds: [10, 650], layup_from_yds: [30, 650], first_putt_ft: [1, 150] };

function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
const fmt = v => Math.abs(v) < 0.005 ? '0.00' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
const fmt1 = v => Math.abs(v) < 0.05 ? '0.0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1);
const neg = v => v < -0.005 ? ' neg' : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const V = x => ` data-v='${esc(JSON.stringify(x))}'`;
const dfmt = s => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const toPar = n => n === 0 ? 'E' : n > 0 ? '+' + n : '−' + (-n);
const scoreName = (s, p) => s === 1 ? 'Ace' : ({ '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double bogey', '3': 'Triple bogey' })[s - p] || '+' + (s - p);
const r5 = v => Math.round(v / 5) * 5;
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const heat = v => v == null ? 'var(--color-neutral-200)' : `color-mix(in srgb, var(${v >= 0 ? '--color-text' : '--color-accent'}) ${Math.round(Math.min(1, Math.abs(v) / 0.6) * 80 + 15)}%, transparent)`;

// ---- data helpers
const idxs = r => { const [a, n] = RANGE[r.range] || RANGE['18']; return Array.from({ length: n }, (_, j) => a + j); };
const entry = (r, i) => S.holes[r.id]?.[i + 1];
const active = () => S.rounds.find(r => r.status === 'active');
const firstOpen = r => { const ix = idxs(r); return ix.find(i => !entry(r, i)) ?? ix[ix.length - 1]; };
const rangeTxt = r => r.range === 'front' ? ' · Front 9' : r.range === 'back' ? ' · Back 9' : '';
function stats(r) {
  const ix = idxs(r), hs = ix.map(i => { const e = entry(r, i); return e ? holeSG(B, r.holes_snapshot[i], e) : null; });
  let score = 0, par = 0, n = 0; const cats = { ott: 0, app: 0, arg: 0, putt: 0 };
  for (const h of hs) { if (!h) continue; n++; score += h.score; par += h.par; for (const k of KEYS) cats[k] += h.cats[k] || 0; }
  return { ix, hs, count: ix.length, n, score, par, cats, total: sum(KEYS, k => cats[k]) };
}
// ---- progress over time
// Saved rounds, oldest first, SG scaled to 18 holes so 9-hole and partial rounds compare.
function history() {
  return S.rounds.filter(r => r.status === 'saved').map(r => ({ r, st: stats(r) })).filter(x => x.st.n > 0).reverse().map(({ r, st }) => {
    const f = 18 / st.n, cats = {};
    for (const k of KEYS) cats[k] = st.cats[k] * f;
    return { id: r.id, date: r.played_on, course: r.course_name, cats, total: st.total * f };
  });
}
const mean = a => a.length ? sum(a, x => x) / a.length : 0;
const pv = (x, k) => k === 'total' ? x.total : x.cats[k];
const arrow = d => (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1);
// Change in avg SG: vs the window before it when there is one, else recent half vs earlier half.
function change(win, prev, k) {
  const m = a => mean(a.map(x => pv(x, k)));
  if (prev.length) return { d: m(win) - m(prev), note: `vs previous ${prev.length}` };
  if (win.length >= 4) { const h = win.length >> 1; return { d: m(win.slice(h)) - m(win.slice(0, h)), note: 'recent half vs earlier' }; }
  return null;
}
// Bar per round (dark = gained, red = lost), optional axis, rolling-average line and tap-to-open.
function chart(pts, { h = 180, axis = true, label = '' } = {}) {
  const W = 340, X0 = axis ? 30 : 0, top = 8, bot = h - 8, vs = pts.flatMap(p => p.avg != null ? [p.v, p.avg] : [p.v]);
  const mx = Math.max(0, ...vs), mn = Math.min(0, ...vs), raw = Math.max(1, mx - mn);
  const step = raw <= 3 ? 1 : raw <= 8 ? 2 : raw <= 20 ? 5 : 10, hi = Math.max(axis ? step : 0.5, Math.ceil(mx / step) * step), lo = Math.min(axis ? -step : -0.5, Math.floor(mn / step) * step);
  const y = v => top + (hi - v) / (hi - lo) * (bot - top), slot = (W - X0) / pts.length, y0 = y(0);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${h}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>`;
  if (axis) for (let g = lo; g <= hi; g += step)
    s += `<line class="${g ? 'grid' : 'zero'}" x1="${X0 - 4}" x2="${W}" y1="${y(g)}" y2="${y(g)}"/><text x="0" y="${y(g) + 3.5}">${g ? (g > 0 ? '+' : '−') + Math.abs(g) : '0'}</text>`;
  else s += `<line class="zero" x1="0" x2="${W}" y1="${y0}" y2="${y0}"/>`;
  pts.forEach((p, i) => {
    const yv = y(p.v), x = X0 + i * slot;
    s += `<rect class="${p.v >= 0 ? 'bg' : 'bl'}" x="${(x + slot * 0.18).toFixed(1)}" y="${Math.min(y0, yv).toFixed(1)}" width="${Math.max(1, slot * 0.64).toFixed(1)}" height="${Math.max(1.5, Math.abs(yv - y0)).toFixed(1)}"/>`;
    if (p.id) s += `<rect class="hit" x="${x.toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${h}" data-a="viewRound"${V(p.id)}><title>${esc(p.title)}</title></rect>`;
  });
  const line = pts.filter(p => p.avg != null).map((p, i, a) => [X0 + pts.indexOf(p) * slot + slot / 2, y(p.avg)]);
  if (line.length > 1) {
    const [lx, ly] = line[line.length - 1];
    s += `<path class="avg" d="${line.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}"/><circle class="dot" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4"/>`;
  }
  return s + '</svg>';
}

async function reload() {
  const [cs, rs, hs] = await Promise.all([db.all('courses'), db.all('rounds'), db.all('holes')]);
  S.courses = cs.filter(x => !x.deleted_at).sort((a, b) => (b.home ? 1 : 0) - (a.home ? 1 : 0) || a.name.localeCompare(b.name));
  S.rounds = rs.filter(x => !x.deleted_at).sort((a, b) => b.played_on.localeCompare(a.played_on) || b.updated_at.localeCompare(a.updated_at));
  S.holes = {};
  for (const h of hs) if (!h.deleted_at) (S.holes[h.round_id] ??= {})[h.hole] = h;
}
function defEntry({ par, yds }) {
  return {
    tee_result: par === 3 ? null : 'fairway', go_for_green_on: par === 5 ? 3 : null,
    layup_from_yds: par === 5 ? Math.max(120, r5(yds - 275)) : null, layup_lie: par === 5 ? 'fairway' : null,
    approach_from_yds: par === 4 ? Math.max(60, r5(yds - 270)) : par === 5 ? 90 : yds,
    approach_result: 'green', short_game_shots: 1, first_putt_ft: 20, putts: 2
  };
}
function draftFor(r, i) {
  const e = entry(r, i), d = defEntry(r.holes_snapshot[i]);
  if (e) for (const k in d) if (e[k] != null && !(k === 'short_game_shots' && !e[k])) d[k] = e[k];
  return d;
}
function normalize(h, d) {
  const e = { ...d };
  if (h.par === 3) { e.tee_result = null; e.approach_from_yds = h.yds; }
  if (h.par !== 5) e.go_for_green_on = null;
  if (!(h.par === 5 && e.go_for_green_on === 3)) { e.layup_from_yds = null; e.layup_lie = null; }
  if (e.approach_result === 'green') e.short_game_shots = 0;
  if (!e.putts) e.first_putt_ft = null;
  return e;
}
function openHole(i) { S.cur = i; S.draft = draftFor(active(), i); S.screen = 'card'; }
async function discardRound(r) {
  await db.put('rounds', { ...r, deleted_at: new Date().toISOString() });
  for (const h of await db.holesFor(r.id)) await db.put('holes', { ...h, deleted_at: new Date().toISOString() });
  await reload();
}
function arm(key) {
  if (S.arm === key) { S.arm = null; clearTimeout(armTimer); return true; }
  S.arm = key; clearTimeout(armTimer);
  armTimer = setTimeout(() => { if (S.arm === key) { S.arm = null; render(); } }, 3000);
  return false;
}

// ---- markup pieces
const bar = (left, right = '') => `<div class="bar"><div class="grp">${left}</div>${right}</div>`;
const L = (a, label, cls = '', v) => `<button class="link ${cls}" data-a="${a}"${v !== undefined ? V(v) : ''}>${label}</button>`;
const cta = (a, label, cls = '', v) => `<button class="cta ${cls}" data-a="${a}"${v !== undefined ? V(v) : ''}><span>${label}</span><span>→</span></button>`;
const btn2 = (a, label) => `<button class="btn2" data-a="${a}">${label}</button>`;
const q = (label, hint, body) => `<div class="q"><div class="lbl"><span class="kicker">${label}</span><span class="hint">${hint}</span></div>${body}</div>`;
const opts = (a, cur, vals, labels, cls = '') => `<div class="opts ${cls}">${vals.map((v, j) => `<button class="${cur === v ? 'on' : ''}" data-a="${a}"${V(v)}>${labels ? labels[j] : v}</button>`).join('')}</div>`;
const homeL = () => L('go', '‹ Home', '', 'home');
const syncTxt = () => ({ off: 'Not set up', 'signed-out': 'Signed out', syncing: 'Syncing…', ok: 'Synced ' + (S.sync.at ? ago(S.sync.at) : ''), error: 'Sync error', offline: 'Offline · saved on phone' })[S.sync.state] || '';
function strip(st, cur, buttons) {
  return `<div class="strip" style="grid-template-columns:repeat(${st.count},1fr)">${st.hs.map((x, j) => {
    const i = st.ix[j], cls = (x ? (x.total >= 0 ? 'g' : 'l') : '') + (i === cur ? ' cur' : '');
    return buttons ? `<button class="${cls}" data-a="hole"${V(i)}>${i + 1}</button>` : `<div class="${cls}"></div>`;
  }).join('')}</div>`;
}

// ---- screens
function home() {
  const a = active(), past = S.rounds.filter(r => r.status === 'saved');
  let top;
  if (a) {
    const st = stats(a);
    top = `<div class="pad col"><span class="kicker">In progress · ${dfmt(a.played_on)}</span><span class="h2">${esc(a.course_name)}</span><span class="meta">${esc(a.tee_name)} tees${rangeTxt(a)}</span></div>
    <div class="grid3"><div class="stat"><span class="kicker">Thru</span><span class="big">${st.n}/${st.count}</span></div><div class="stat"><span class="kicker">To par</span><span class="big">${st.n ? toPar(st.score - st.par) : '—'}</span></div><div class="stat"><span class="kicker">SG</span><span class="big${neg(st.total)}">${fmt(st.total)}</span></div></div>
    ${cta('resume', st.n >= st.count ? 'Review round' : 'Resume · hole ' + (firstOpen(a) + 1))}
    <div class="links">${L('roundActive', 'Round summary', 'u')}${L('openEnd', 'End round', 'red')}</div>`;
  } else top = `<div class="pad">${cta('go', 'Start new round', 'inset', 'newRound')}</div>`;
  const rows = past.map(r => {
    const st = stats(r);
    return `<button class="list-row" data-a="viewRound"${V(r.id)}><span class="col" style="gap:3px"><span class="t">${esc(r.course_name)}</span><span class="m">${dfmt(r.played_on)}${rangeTxt(r)}${st.n < st.count ? ` · ${st.n} of ${st.count} holes` : ''}</span></span><span class="sc">${st.score}</span><span class="sg${neg(st.total)}">${fmt(st.total)}</span></button>`;
  }).join('');
  const hist = history();
  let trend = '';
  if (hist.length) {
    const win = hist.slice(-10), prev = hist.slice(-20, -10), avg = mean(win.map(x => x.total)), ch = change(win, prev, 'total');
    trend = `<div class="pad kicker" style="padding-bottom:8px;display:flex;justify-content:space-between"><span>Progress · last ${win.length} round${win.length === 1 ? '' : 's'}</span><span>per 18 holes</span></div>
    <button class="trend rule rule-b" data-a="go"${V('progress')}>
      <span class="trend-top"><span class="col"><span class="big${neg(avg)}" style="font-size:34px">${fmt1(avg)}</span><span class="meta">avg SG per round</span></span>
        ${ch ? `<span class="col" style="align-items:flex-end"><span class="delta">${arrow(ch.d)}</span><span class="meta">${ch.note}</span></span>` : ''}</span>
      ${chart(win.map(x => ({ v: x.total })), { h: 56, axis: false })}
      <span class="trend-cats">${KEYS.map(k => { const a = mean(win.map(x => x.cats[k])), c = change(win, prev, k); return `<span class="col" style="gap:4px"><span class="kicker">${SHORT[k]}</span><span class="cv${neg(a)}">${fmt1(a)}</span><span class="m">${c ? arrow(c.d) : '—'}</span></span>`; }).join('')}</span>
      <span class="trend-more">See progress ›</span>
    </button>`;
  }
  return `<div class="scroll">
    <div class="head rule-b" style="padding-top:14px"><span class="kicker">Baseline · Scratch (est.)</span><h1 class="h1 xl">Strokes gained</h1></div>
    ${top}
    ${trend}
    <div class="pad kicker" style="padding-bottom:8px">Past rounds</div>
    <div class="rule">${rows || `<p class="body pad meta">No saved rounds yet.</p>`}</div>
    <div style="flex:1;min-height:24px"></div>
    <div class="menu">
      ${S.update ? '<button class="menu-row" data-a="reload"><span>Update ready</span><span class="m neg">Tap to reload</span></button>' : ''}
      <button class="menu-row" data-a="go"${V('courses')}><span>Courses</span><span class="m">${S.courses.length} saved</span></button>
      <button class="menu-row" data-a="go"${V('sync')}><span>Sync</span><span class="m${S.sync.state === 'error' ? ' neg' : ''}">${syncTxt()}</span></button>
      <button class="menu-row" data-a="exportData"><span>Export backup (JSON)</span></button>
      <label class="menu-row"><span>Import backup</span><input type="file" accept="application/json,.json" data-in="import" hidden></label>
    </div>
  </div>`;
}

// New round's course and tees: your pick, else the home course, else the last course played, else the first.
function nrPick() {
  const last = S.rounds.find(r => S.courses.some(x => x.id === r.course_id));
  const c = S.courses.find(x => x.id === S.nr.courseId) || S.courses.find(x => x.home) || (last && S.courses.find(x => x.id === last.course_id)) || S.courses[0];
  const lastTee = S.rounds.find(r => r.course_id === c.id)?.tee_name, t = c.tees.find(x => x.name === S.nr.tee) || c.tees.find(x => x.name === lastTee) || c.tees[0];
  return { c, t, last };
}
function newRound() {
  if (!S.courses.length) return `${bar(homeL())}<div class="head"><span class="kicker">New round</span><h1 class="h1">Add a course first</h1></div>
    <div class="scroll"><p class="body pad">Rounds copy par and yardage from a saved course.</p></div>${cta('newCourse', 'Add course')}`;
  const n = S.nr, { c, t, last } = nrPick();
  return `${bar(homeL())}<div class="head"><span class="kicker">New round</span><h1 class="h1">${esc(c.name)}</h1></div>
  <div class="scroll rule">
    ${S.courses.length > 1 ? q('Course', c.home ? 'home course' : last && last.course_id === c.id ? 'last played' : '', `<select class="txt sel" data-in="nrCourse">${S.courses.map(x => `<option value="${esc(x.id)}"${x.id === c.id ? ' selected' : ''}>${x.home ? '★ ' : ''}${esc(x.name)}</option>`).join('')}</select>`) : ''}
    ${q('Tees', `Par ${sum(t.holes, h => h.par)} · ${sum(t.holes, h => h.yds).toLocaleString()} yds`, `<div class="opts">${c.tees.map(x => `<button class="${x.name === t.name ? 'on' : ''}" data-a="nrTee"${V(x.name)}>${esc(x.name)}</button>`).join('')}</div>`)}
    ${q('Holes', '', opts('nrRange', n.range, ['18', 'front', 'back'], ['18 holes', 'Front 9', 'Back 9']))}
    ${q('Date', '', `<input class="txt" type="date" data-in="nrDate" value="${esc(n.date)}">`)}
  </div>${cta('startRound', { '18': 'Start 18 holes', front: 'Start front 9', back: 'Start back 9' }[n.range])}`;
}

function courses() {
  const row = c => `<div class="crow${c.home ? ' home' : ''}"><button class="list-row two" data-a="editCourse"${V(c.id)}><span class="col" style="gap:3px"><span class="t">${esc(c.name)}</span><span class="m">${c.tees.map(t => esc(t.name)).join(' · ')}</span></span><span class="m">Par ${sum(c.tees[0].holes, h => h.par)}</span></button><button class="star" data-a="homeCourse"${V(c.id)} aria-pressed="${!!c.home}" aria-label="${c.home ? 'Remove ' + esc(c.name) + ' as home course' : 'Make ' + esc(c.name) + ' your home course'}">${c.home ? '★' : '☆'}</button></div>`;
  const home = S.courses.find(c => c.home), rest = S.courses.filter(c => !c.home);
  const body = !S.courses.length ? `<p class="body pad meta">No courses yet.</p><div class="pad" style="padding-top:0">${btn2('sampleCourse', 'Add a sample course for testing')}</div>`
    : (home ? `<div class="pad kicker" style="padding-bottom:8px;color:var(--color-accent-700)">Home course</div><div class="rule">${row(home)}</div><div class="pad kicker" style="padding-bottom:8px;padding-top:20px">All courses · A–Z</div>` : '')
      + `<div class="rule">${rest.map(row).join('')}</div>`
      + (home ? '' : `<p class="body pad meta" style="font-size:12px">Tap ☆ to set your home course. It's listed first when you start a round.</p>`);
  return `${bar(homeL())}<div class="head"><span class="kicker">${S.courses.length} saved</span><h1 class="h1">Courses</h1></div>
  <div class="scroll${home ? '' : ' rule'}">${body}</div>
  ${cta('newCourse', 'Add course')}`;
}

const teeTot = () => { const t = S.ec.tees[S.et]; return `Par ${sum(t.holes, h => h.par)} · ${sum(t.holes, h => +h.yds || 0).toLocaleString()} yds`; };
function courseEdit() {
  const c = S.ec, t = c.tees[S.et];
  return `${bar(L('go', '‹ Courses', '', 'courses'), c.id ? L('delCourse', S.arm === 'delCourse' ? 'Tap again to delete' : 'Delete course', 'red') : '')}
  <div class="head"><span class="kicker">Par and yardage per hole</span><h1 class="h1">${c.id ? 'Edit course' : 'New course'}</h1></div>
  <div class="scroll rule">
    ${q('Course name', '', `<input class="txt" data-in="cname" value="${esc(c.name)}" placeholder="e.g. Marsh Creek GC" autocomplete="off">`)}
    <div class="q"><div class="lbl"><span class="kicker">Tee set</span><span class="hint" id="teeTot">${teeTot()}</span></div>
      <div class="opts">${c.tees.map((x, j) => `<button class="${j === S.et ? 'on' : ''}" data-a="tee"${V(j)}>${esc(x.name) || 'Tee ' + (j + 1)}</button>`).join('')}<button data-a="addTee">+ Tee</button></div></div>
    ${q('Tee name', c.tees.length > 1 ? '' : 'new tees copy this one', `<input class="txt" data-in="tname" value="${esc(t.name)}" placeholder="e.g. Blue" autocomplete="off">`)}
    ${t.holes.map((h, i) => `<div class="hrow"><span class="hn">${i + 1}</span>${opts('par', h.par, [3, 4, 5], ['Par 3', 'Par 4', 'Par 5']).replace(/data-v='(\d)'/g, (m, p) => V([i, +p]))}<input class="txt" inputmode="numeric" data-in="yds" data-i="${i}" value="${esc(h.yds)}" placeholder="yds"></div>`).join('')}
    ${c.tees.length > 1 ? `<div class="pad">${L('delTee', S.arm === 'delTee' ? 'Tap again to remove ' + (esc(t.name) || 'this tee set') : 'Remove this tee set', 'red')}</div>` : ''}
  </div>
  ${S.err ? `<p class="err">${esc(S.err)}</p>` : ''}${cta('saveCourse', 'Save course')}`;
}

function card() {
  const a = active(), i = S.cur, h = a.holes_snapshot[i], d = S.draft, c = holeSG(B, h, d), st = stats(a), layup = h.par === 5 && d.go_for_green_on === 3, rows = [];
  const chip = (k, label, vals, labels, hint = '') => rows.push(q(label, hint, `<div class="opts">${vals.map((v, j) => `<button class="${d[k] === v ? 'on' : ''}" data-a="set"${V([k, v])}>${labels ? labels[j] : v}</button>`).join('')}</div>`));
  const step = (k, label, s, unit, hint = '') => rows.push(q(label, hint, `<div class="opts"><button data-a="adj"${V([k, -s])}>−${s}</button><button class="on" data-a="pad"${V([k, label, unit])}>${d[k]} ${unit}</button><button data-a="adj"${V([k, s])}>+${s}</button><button data-a="pad"${V([k, label, unit])}>Edit</button></div>`));
  if (h.par !== 3) chip('tee_result', 'Tee shot', ['fairway', 'rough', 'sand', 'penalty'], ['Fwy', 'Rough', 'Sand', 'Pen'], d.tee_result === 'penalty' ? 'drop in rough, +1 stroke' : '');
  if (h.par === 5) chip('go_for_green_on', 'Went for the green on', [2, 3], ['Shot 2', 'Shot 3']);
  if (layup) { step('layup_from_yds', 'Layup from', 10, 'yds', 'drive ≈ ' + Math.max(0, h.yds - d.layup_from_yds) + ' yds'); chip('layup_lie', 'Layup finished', ['fairway', 'rough', 'sand'], ['Fwy', 'Rough', 'Sand']); }
  if (h.par !== 3) step('approach_from_yds', 'Approach from', 5, 'yds', (layup ? 'layup ≈ ' + Math.max(0, d.layup_from_yds - d.approach_from_yds) : 'drive ≈ ' + Math.max(0, h.yds - d.approach_from_yds)) + ' yds');
  chip('approach_result', h.par === 3 ? 'Tee shot finished' : 'Approach finished', ['green', 'fringe', 'rough', 'sand'], ['Green', 'Fringe', 'Rough', 'Sand']);
  if (d.approach_result !== 'green') chip('short_game_shots', 'Short-game shots', [1, 2, 3], null, 'chips, pitches, bunker');
  if (d.putts > 0) step('first_putt_ft', 'First putt', 1, 'ft');
  chip('putts', 'Putts', [0, 1, 2, 3, 4], null, d.putts === 0 ? (d.approach_result === 'green' ? 'holed the approach' : 'holed from off the green') : '');
  return `${bar(homeL() + L('openEnd', 'End round', 'red'), L('roundActive', `Round ${fmt(st.total)} thru ${st.n} ›`, neg(st.total)))}
  <div class="head split"><div class="col"><span class="kicker">Hole ${i + 1} · Par ${h.par} · ${h.yds} yds</span><h1 class="h1">Hole ${i + 1}</h1></div><div class="score"><span class="sv">${c.score}</span><span class="sn">${scoreName(c.score, h.par)}</span></div></div>
  <div class="rule-b">${strip(st, i, true)}</div>
  <div class="scroll">${rows.join('')}</div>
  ${cta('saveHole', `Save hole ${i + 1} · ${fmt(c.total)}`)}`;
}

function hole() {
  const a = active(), i = S.cur, e = entry(a, i), st = stats(a);
  if (!e) { openHole(i); return card(); }
  const c = holeSG(B, a.holes_snapshot[i], e), cats = c.cats;
  const subs = {
    ott: c.par === 3 ? 'Par 3 · counted as approach' : (c.pen ? 'Penalty, played from ' : e.tee_result[0].toUpperCase() + e.tee_result.slice(1) + ', ') + c.d1 + ' yds left',
    app: (c.layup ? 'Layup + ' : '') + c.A + ' yds → ' + (c.onGreen ? (e.putts ? e.first_putt_ft + ' ft' : 'holed') : e.approach_result),
    arg: cats.arg === null ? 'Hit the green' : `${e.short_game_shots} shot${e.short_game_shots > 1 ? 's' : ''} from ${e.approach_result}`,
    putt: cats.putt === null ? 'No putts' : `${e.first_putt_ft} ft, ${e.putts} putt${e.putts > 1 ? 's' : ''}`
  };
  const ix = idxs(a), nx = ix.find(j => !entry(a, j) && j > i) ?? ix.find(j => !entry(a, j));
  return `${bar(homeL() + L('openEnd', 'End round', 'red'), L('editHole', 'Edit card', 'u'))}
  <div class="scroll">
    <div class="head"><span class="kicker">Hole ${i + 1} · Par ${c.par} · ${c.yds} yds</span><h1 class="h1">${scoreName(c.score, c.par)}, ${fmt(c.total)} ${c.total >= -0.005 ? 'gained' : 'lost'}</h1></div>
    <div class="tiles">${KEYS.map(k => { const x = cats[k]; return `<div class="tile${x === null ? ' na' : x < -0.005 ? ' lost' : ''}"><span class="kicker">${NAME[k]}</span><div class="col"><span class="v">${x === null ? '—' : fmt(x)}</span><span class="s">${esc(subs[k])}</span></div></div>`; }).join('')}</div>
    <div class="pad kicker" style="padding-bottom:8px;display:flex;justify-content:space-between"><span>Round so far · thru ${st.n}</span><span class="${neg(st.total)}">${fmt(st.total)}</span></div>
    ${strip(st, i, false)}
  </div>
  ${nx === undefined ? cta('roundActive', 'See round summary') : cta('hole', `Hole ${nx + 1} · Par ${a.holes_snapshot[nx].par} · ${a.holes_snapshot[nx].yds} yds`, '', nx)}`;
}

function round() {
  const r = S.viewId ? S.rounds.find(x => x.id === S.viewId) : active();
  if (!r) { S.screen = 'home'; return home(); }
  const st = stats(r), isActive = r.status === 'active', cols = `40px repeat(${st.count},1fr) 44px`, notes = [];
  if (st.n) {
    const played = st.hs.filter(Boolean), sorted = KEYS.slice().sort((x, y) => st.cats[x] - st.cats[y]), worst = sorted[0], best = sorted[3];
    if (st.cats[worst] < 0) notes.push(['Biggest leak', `${NAME[worst]} lost ${fmt(st.cats[worst])}, losing strokes on ${played.filter(h => h.cats[worst] !== null && h.cats[worst] < 0).length} of ${played.filter(h => h.cats[worst] !== null).length} holes.`]);
    if (st.cats[best] > 0) notes.push(['Strength', `${NAME[best]} gained ${fmt(st.cats[best])}.`]);
    let wi = -1; st.hs.forEach((h, j) => { if (h && (wi < 0 || h.total < st.hs[wi].total)) wi = j; });
    if (wi >= 0 && st.hs[wi].total < 0) notes.push(['Costliest hole', `Hole ${st.ix[wi] + 1} · ${scoreName(st.hs[wi].score, st.hs[wi].par)} · ${fmt(st.hs[wi].total)}`]);
  } else notes.push(['No holes yet', 'Card a hole to see where strokes went.']);
  const right = isActive ? '<span class="meta" style="font-size:12px">vs Scratch (est.)</span>' : L('delRound', S.arm === 'delRound' ? 'Tap again to delete' : 'Delete round', 'red');
  const fo = isActive ? firstOpen(r) : 0;
  const fromP = !isActive && S.from === 'progress';
  return `${bar(fromP ? L('go', '‹ Progress', '', 'progress') : homeL(), right)}
  <div class="scroll">
    <div class="head split"><div class="col"><span class="kicker">${esc(r.course_name)}${rangeTxt(r)} · ${st.score} (${toPar(st.score - st.par)})${st.n < st.count ? ' · thru ' + st.n : ''}</span><h1 class="h1">Where it went</h1></div><span class="big${neg(st.total)}" style="font-size:30px">${fmt(st.total)}</span></div>
    <div class="heat rule">
      <div class="r" style="grid-template-columns:${cols};padding-bottom:4px"><span></span>${st.ix.map(i => `<span class="n">${i + 1}</span>`).join('')}<span class="n" style="text-align:right">SG</span></div>
      <div class="r scores" style="grid-template-columns:${cols}"><span class="lab">Score</span>${st.hs.map(h => { const d = h ? h.score - h.par : 0; return h ? `<span class="hs${d <= -1 ? ' under' : d === 1 ? ' bogey' : d >= 2 ? ' dbl' : ''}" title="${scoreName(h.score, h.par)}">${h.score}</span>` : '<span class="hs none">·</span>'; }).join('')}<span class="tot">${st.n ? st.score : '—'}</span></div>
      ${KEYS.map(k => `<div class="r" style="grid-template-columns:${cols}"><span class="lab">${SHORT[k]}</span>${st.hs.map(h => `<div class="c" style="background:${heat(h ? h.cats[k] : null)}"></div>`).join('')}<span class="tot${neg(st.cats[k])}">${fmt1(st.cats[k])}</span></div>`).join('')}
      <div class="r sum" style="grid-template-columns:${cols}"><span class="lab">Hole</span>${st.hs.map(h => `<div class="c" style="background:${heat(h ? h.total : null)}"></div>`).join('')}<span class="tot${neg(st.total)}">${fmt1(st.total)}</span></div>
    </div>
    <div class="legend"><span><i style="background:var(--color-text)"></i>Gained</span><span><i style="background:var(--color-accent)"></i>Lost</span><span>Darker = more</span><span style="margin-left:auto">${dfmt(r.played_on)}</span></div>
    <div class="notes">${notes.map(([l, t]) => `<div class="note"><span class="kicker">${l}</span><b>${esc(t)}</b></div>`).join('')}</div>
    <div style="flex:1;min-height:18px"></div>
  </div>
  ${isActive ? `<div class="two"><button class="sheet-row" data-a="hole"${V(fo)}>‹ Hole ${fo + 1}</button>${cta('finish', 'Finish &amp; save')}</div>` : fromP ? cta('go', 'Back to progress', '', 'progress') : cta('go', 'Back to home', '', 'home')}`;
}

function progress() {
  const hist = history(), P = S.prog, k = P.cat, LONG = { total: 'Total SG', ...NAME };
  const head = kick => `${bar(homeL())}<div class="head rule-b"><span class="kicker">${kick}</span><h1 class="h1 xl">Progress</h1></div>`;
  if (!hist.length) return `${head('Strokes gained over time')}<div class="scroll"><p class="body pad meta">Save a round to start tracking progress.</p></div>`;
  const n = P.range === 'all' ? hist.length : +P.range, win = hist.slice(-n), prev = P.range === 'all' ? [] : hist.slice(-2 * n, -n), off = hist.length - win.length;
  const avg = mean(win.map(x => pv(x, k))), ch = change(win, prev, k), rl = `${win.length} round${win.length === 1 ? '' : 's'}`;
  const pts = win.map((x, i) => {
    const gi = off + i, v = pv(x, k);
    return { v, id: x.id, title: `${dfmt(x.date)} · ${x.course} · ${fmt1(v)}`, avg: gi >= 1 ? mean(hist.slice(Math.max(0, gi - 4), gi + 1).map(z => pv(z, k))) : null };
  });
  const rows = ['total', ...KEYS].map(key => {
    const a = mean(win.map(x => pv(x, key))), c = change(win, prev, key);
    return `<button class="list-row" style="grid-template-columns:1fr 60px 64px${key === k ? ';background:var(--color-neutral-200)' : ''}" data-a="progCat"${V(key)}><span class="t">${LONG[key]}</span><span class="sg${neg(a)}">${fmt1(a)}</span><span class="m" style="text-align:right;font-size:12px;font-weight:600">${c ? arrow(c.d) : '—'}</span></button>`;
  }).join('');
  const cat = KEYS.map(key => [key, mean(win.map(x => x.cats[key])), change(win, prev, key)]);
  const worst = cat.slice().sort((a, b) => a[1] - b[1])[0], best = cat.filter(c => c[2]).sort((a, b) => b[2].d - a[2].d)[0], notes = [];
  if (worst[1] < 0) notes.push(['Biggest leak', `${NAME[worst[0]]} costs you ${fmt1(-worst[1]).replace('+', '')} strokes per round.`]);
  if (best && best[2].d > 0.05) notes.push(['Most improved', `${NAME[best[0]]}, ${arrow(best[2].d)} per round (${best[2].note}).`]);
  return `${head(`${rl} · ${LONG[k]}`)}
  <div class="scroll">
    <div class="pad col" style="gap:10px">${opts('progRange', P.range, ['10', '20', 'all'], ['Last 10', 'Last 20', 'All'])}${opts('progCat', k, ['total', ...KEYS], ['Total', 'Tee', 'App', 'ARG', 'Putt'])}</div>
    <div class="grid3" style="grid-template-columns:1fr 1fr"><div class="stat"><span class="kicker">Avg / round</span><span class="big${neg(avg)}">${fmt1(avg)}</span></div>
      <div class="stat"><span class="kicker">Trend</span><span class="big">${ch ? arrow(ch.d) : '—'}</span><span class="meta" style="font-size:11px">${ch ? ch.note : 'needs 4+ rounds'}</span></div></div>
    <div class="pad" style="padding-bottom:0">${chart(pts, { label: `${LONG[k]} per round, ${rl}, average ${fmt1(avg)}` })}</div>
    <div class="legend" style="padding-top:8px"><span><i style="background:var(--color-text)"></i>Gained</span><span><i style="background:var(--color-accent)"></i>Lost</span><span><i style="height:3px;vertical-align:3px;background:var(--color-text)"></i>5-round avg</span></div>
    <div class="pad kicker" style="padding-bottom:8px;padding-top:22px;display:flex;justify-content:space-between"><span>By category</span><span>avg · change</span></div>
    <div class="rule">${rows}</div>
    ${notes.length ? `<div class="notes">${notes.map(([l, t]) => `<div class="note"><span class="kicker">${l}</span><b>${esc(t)}</b></div>`).join('')}</div>` : ''}
    <p class="body pad meta" style="font-size:12px">Each round is scaled to 18 holes. Tap a bar to open that round.</p>
  </div>`;
}

function syncScreen() {
  let body;
  if (!sync.enabled()) body = `<p class="body pad">Server sync isn't configured yet, so rounds are saved on this phone only. In step 5 you'll create a free Supabase project and paste its URL and anon key into <code>config.js</code>.</p>`;
  else if (!S.sync.email) body = `${q('Email', '', `<input class="txt" type="email" data-in="email" value="${esc(S.email)}" placeholder="you@example.com" autocomplete="email">`)}
    <div class="pad col" style="gap:10px">${btn2('signIn', S.sent ? 'Link sent · check your email' : 'Send sign-in link')}<span class="meta">Open the link on this device. You stay signed in after that.</span></div>`;
  else body = `<div class="kv"><div><span class="kicker">Signed in</span><b>${esc(S.sync.email)}</b></div><div><span class="kicker">Status</span><b class="${S.sync.state === 'error' ? 'neg' : ''}">${syncTxt()}</b></div></div>
    <div class="pad col" style="gap:14px">${btn2('syncNow', 'Sync now')}${L('signOut', 'Sign out', 'u')}</div>`;
  return `${bar(homeL())}<div class="head"><span class="kicker">Supabase</span><h1 class="h1">Sync</h1></div>
  <div class="scroll rule">${body}${S.sync.error ? `<p class="err">${esc(S.sync.error)}</p>` : ''}
  <p class="body pad meta">Every change saves on the phone first. Sync runs when you open the home screen, a few seconds after each change, and when the phone comes back online.</p></div>`;
}

function overlay() {
  if (S.sheet === 'end') {
    const a = active(); if (!a) return '';
    const st = stats(a);
    return `<div class="sheet-bg" data-a="closeSheet"><div class="sheet" data-a="noop">
      <div class="sheet-head"><span class="kicker">${esc(a.course_name)} · ${st.n} of ${st.count} holes carded</span><h2 class="h1">End this round?</h2></div>
      ${st.n ? cta('endSave', `Save ${st.n} hole${st.n === 1 ? '' : 's'} · ${fmt(st.total)}`) : ''}
      <button class="sheet-row red" data-a="endDiscard">${S.arm === 'discard' ? 'Tap again to discard' : 'Discard round'}</button>
      <button class="sheet-row" data-a="closeSheet">Keep playing</button></div></div>`;
  }
  if (S.pad) {
    const p = S.pad;
    return `<div class="sheet-bg" data-a="padCancel"><div class="sheet" data-a="noop">
      <div class="sheet-head"><span class="kicker">${p.label}</span><div class="padv"><span>${p.val || '—'}</span><span>${p.unit}</span></div></div>
      <div class="keys">${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫'].map(k => `<button data-a="key"${V(k)}>${k}</button>`).join('')}</div>
      <div class="two" style="grid-template-columns:1fr 1.6fr"><button class="sheet-row" data-a="padCancel">Cancel</button>${cta('padSet', 'Set')}</div></div></div>`;
  }
  return '';
}

const SCREENS = { home, newRound, courses, courseEdit, card, hole, round, progress, sync: syncScreen };
function render() {
  if (['card', 'hole'].includes(S.screen) && !active()) S.screen = 'home';
  const key = S.screen + ':' + S.cur + ':' + S.viewId, sc = $.querySelector('.scroll'), top = sc && key === lastKey ? sc.scrollTop : 0;
  $.innerHTML = SCREENS[S.screen]() + overlay();
  lastKey = key;
  const ns = $.querySelector('.scroll'); if (ns) ns.scrollTop = top;
}

// ---- actions
const SAMPLE = { pars: [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4], yds: [395, 532, 178, 441, 372, 204, 418, 521, 436, 401, 165, 548, 428, 389, 212, 452, 560, 447] };
const A = {
  noop: () => false,
  reload: () => { location.reload(); return false; },
  go: v => { if (v === 'newRound') S.nr = { ...S.nr, courseId: null, tee: null, date: today() }; S.screen = v; S.err = ''; S.arm = null; if (v === 'home') kick(true); },
  resume: () => openHole(firstOpen(active())),
  roundActive: () => { S.viewId = null; S.from = null; S.screen = 'round'; },
  viewRound: id => { S.from = S.screen === 'progress' ? 'progress' : null; S.viewId = id; S.screen = 'round'; S.arm = null; },
  progRange: v => { S.prog.range = v; },
  progCat: v => { S.prog.cat = v; },
  hole: i => openHole(i),
  openEnd: () => { S.sheet = 'end'; S.pad = null; S.arm = null; },
  closeSheet: () => { S.sheet = null; S.arm = null; },
  endSave: async () => { const a = active(); await db.put('rounds', { ...a, status: 'saved' }); await reload(); S.sheet = null; S.viewId = a.id; S.from = null; S.screen = 'round'; },
  finish: () => A.endSave(),
  endDiscard: async () => { if (!arm('discard')) return; await discardRound(active()); S.sheet = null; S.screen = 'home'; },
  delRound: async () => { if (!arm('delRound')) return; await discardRound(S.rounds.find(r => r.id === S.viewId)); S.screen = 'home'; },
  set: ([k, v]) => {
    S.draft = { ...S.draft, [k]: v };
    if (k === 'approach_result' && v !== 'green' && !(S.draft.short_game_shots > 0)) S.draft.short_game_shots = 1;
    if (k === 'putts' && v > 0 && !S.draft.first_putt_ft) S.draft.first_putt_ft = 20;
  },
  adj: ([k, n]) => { const [lo, hi] = CLAMP[k]; S.draft = { ...S.draft, [k]: Math.max(lo, Math.min(hi, S.draft[k] + n)) }; },
  pad: ([k, label, unit]) => { S.pad = { k, label, unit, val: '' }; },
  key: k => { const p = S.pad; p.val = k === '⌫' ? p.val.slice(0, -1) : k === 'Clear' ? '' : p.val.length < 3 ? (p.val + k).replace(/^0+/, '') : p.val; },
  padCancel: () => { S.pad = null; },
  padSet: () => { const p = S.pad, n = parseInt(p.val, 10); S.pad = null; if (n > 0) { const [lo, hi] = CLAMP[p.k]; S.draft = { ...S.draft, [p.k]: Math.max(lo, Math.min(hi, n)) }; } },
  saveHole: async () => {
    const a = active(), i = S.cur, e = normalize(a.holes_snapshot[i], S.draft);
    await db.put('holes', { ...e, id: a.id + '-' + (i + 1), round_id: a.id, hole: i + 1, deleted_at: null });
    await reload(); S.screen = 'hole';
  },
  editHole: () => { S.draft = draftFor(active(), S.cur); S.screen = 'card'; },
  nrCourse: id => { S.nr = { ...S.nr, courseId: id, tee: null }; },
  nrTee: t => { S.nr.tee = t; },
  nrRange: r => { S.nr.range = r; },
  startRound: async () => {
    if (active()) return;
    const { c, t } = nrPick();
    const r = await db.put('rounds', { id: db.uuid(), course_id: c.id, course_name: c.name, tee_name: t.name, holes_snapshot: t.holes.map(h => ({ par: h.par, yds: h.yds })), played_on: S.nr.date || today(), range: S.nr.range, status: 'active', baseline_id: B.id, deleted_at: null });
    await reload(); openHole(RANGE[r.range][0]);
  },
  newCourse: () => { S.ec = { name: '', tees: [{ name: '', holes: Array.from({ length: 18 }, () => ({ par: 4, yds: '' })) }] }; S.et = 0; S.err = ''; S.arm = null; S.screen = 'courseEdit'; },
  // One home course: starring a course clears the flag elsewhere; starring the home course clears it.
  homeCourse: async id => {
    for (const c of S.courses) {
      const want = c.id === id ? !c.home : false;
      if (!!c.home !== want) { const { dirty, ...rest } = c; await db.put('courses', { ...rest, home: want }); }
    }
    await reload();
  },
  editCourse: id => { S.ec = structuredClone(S.courses.find(c => c.id === id)); S.et = 0; S.err = ''; S.arm = null; S.screen = 'courseEdit'; },
  tee: j => { S.et = j; },
  addTee: () => { S.ec.tees.push({ name: '', holes: S.ec.tees[S.et].holes.map(h => ({ ...h })) }); S.et = S.ec.tees.length - 1; },
  delTee: () => { if (!arm('delTee')) return; S.ec.tees.splice(S.et, 1); S.et = 0; },
  par: ([i, p]) => { S.ec.tees[S.et].holes[i].par = p; },
  saveCourse: async () => {
    const c = S.ec, name = c.name.trim(), seen = new Set();
    if (!name) { S.err = 'Course needs a name.'; return; }
    for (const [j, t] of c.tees.entries()) {
      const tn = t.name.trim();
      if (!tn) { S.et = j; S.err = 'Each tee set needs a name.'; return; }
      if (seen.has(tn.toLowerCase())) { S.et = j; S.err = 'Tee set names must be different.'; return; }
      seen.add(tn.toLowerCase());
      const bad = t.holes.findIndex(h => !(+h.yds >= 50 && +h.yds <= 700));
      if (bad >= 0) { S.et = j; S.err = `${tn}: hole ${bad + 1} needs a yardage between 50 and 700.`; return; }
    }
    const { dirty, ...rest } = c;
    await db.put('courses', { ...rest, id: c.id || db.uuid(), name, deleted_at: null, tees: c.tees.map(t => ({ name: t.name.trim(), holes: t.holes.map(h => ({ par: h.par, yds: +h.yds })) })) });
    await reload(); S.err = ''; S.screen = 'courses';
  },
  delCourse: async () => { if (!arm('delCourse')) return; await db.put('courses', { ...S.courses.find(c => c.id === S.ec.id), deleted_at: new Date().toISOString() }); await reload(); S.screen = 'courses'; },
  sampleCourse: async () => {
    await db.put('courses', { id: db.uuid(), name: 'Marsh Creek GC (sample)', deleted_at: null, tees: [
      { name: 'Blue', holes: SAMPLE.pars.map((p, i) => ({ par: p, yds: SAMPLE.yds[i] })) },
      { name: 'White', holes: SAMPLE.pars.map((p, i) => ({ par: p, yds: r5(SAMPLE.yds[i] * 0.93) })) }] });
    await reload();
  },
  exportData: async () => {
    const out = { app: 'strokes-gained', exported_at: new Date().toISOString(), baseline_id: B.id };
    for (const s of ['courses', 'rounds', 'holes']) out[s] = (await db.all(s)).map(({ dirty, ...r }) => r);
    const l = document.createElement('a');
    l.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
    l.download = `strokes-gained-${today()}.json`; l.click();
    return false;
  },
  signIn: async () => {
    const em = S.email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { S.sync.error = 'Enter a valid email.'; return; }
    S.sync.error = ''; await sync.signIn(em); S.sent = true;
  },
  syncNow: () => { kick(true); return false; },
  signOut: async () => { await sync.signOut(); S.sync = { state: 'signed-out', at: 0, email: null, error: '' }; S.sent = false; }
};

async function importFile(f) {
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== 'strokes-gained') throw new Error('Not a Strokes Gained backup file.');
    let n = 0;
    for (const s of ['courses', 'rounds', 'holes']) for (const r of d[s] || []) {
      const l = await db.get(s, r.id);
      if (!l || Date.parse(l.updated_at) < Date.parse(r.updated_at)) { await db.putRaw(s, { ...r, dirty: 1 }); n++; }
    }
    await reload(); render(); kick(true);
    alert(`Imported ${n} record${n === 1 ? '' : 's'}.`);
  } catch (e) { alert('Import failed: ' + e.message); }
}

// ---- sync scheduling
function kick(now) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, now ? 0 : 2500); }
async function runSync() {
  if (!sync.enabled()) { S.sync.state = 'off'; return; }
  S.sync.state = 'syncing'; soft(false);
  try {
    const r = await sync.sync();
    S.sync.state = r.status; S.sync.error = '';
    if (r.email) S.sync.email = r.email;
    if (r.status === 'ok') { S.sync.at = Date.now(); if (r.changed) await reload(); }
    soft(r.changed);
  } catch (e) { S.sync.state = 'error'; S.sync.error = e.message || String(e); soft(false); }
}
function soft(changed) {
  if (S.screen === 'courseEdit' || S.pad || document.activeElement?.tagName === 'INPUT') return;
  if (changed || S.screen === 'home' || S.screen === 'sync') render();
}

// ---- events
$.addEventListener('click', async e => {
  const el = e.target.closest('[data-a]'); if (!el) return;
  const fn = A[el.dataset.a]; if (!fn) return;
  const v = el.dataset.v !== undefined ? JSON.parse(el.dataset.v) : undefined;
  try { if (await fn(v, el) !== false) render(); }
  catch (err) { console.error(err); alert(err.message || String(err)); render(); }
});
const IN = {
  cname: v => { S.ec.name = v; },
  tname: v => { S.ec.tees[S.et].name = v; },
  yds: (v, el) => { S.ec.tees[S.et].holes[+el.dataset.i].yds = v.replace(/\D/g, ''); const t = document.getElementById('teeTot'); if (t) t.textContent = teeTot(); },
  nrDate: v => { S.nr.date = v; },
  nrCourse: v => { S.nr = { ...S.nr, courseId: v, tee: null }; render(); },
  email: v => { S.email = v; }
};
$.addEventListener('input', e => { const f = IN[e.target.dataset.in]; if (f) f(e.target.value, e.target); });
$.addEventListener('change', e => { if (e.target.dataset.in === 'import') { importFile(e.target.files[0]); e.target.value = ''; } });
addEventListener('online', () => kick(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(true); });
db.onChange(() => kick());

// ---- offline + install
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) { S.update = true; soft(true); } });
}
navigator.storage?.persist?.();

// ---- boot
(async () => {
  B = await loadBaseline(new URL('../baseline/broadie-2011-scratch-v1.json', import.meta.url));
  await reload();
  render();
  if (sync.enabled()) { const s = await sync.session(); S.sync.email = s?.user?.email || null; S.sync.state = s ? 'ok' : 'signed-out'; }
  kick(true);
})();