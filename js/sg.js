// Strokes-gained math. Pure functions; no storage or UI.
export async function loadBaseline(url) {
  const b = await (await fetch(url)).json();
  const off = b.scratch_offset || {}, tables = {};
  for (const [lie, rows] of Object.entries(b.tables))
    tables[lie] = rows.map(([d, e]) => [d, e + (typeof off[lie] === 'number' ? off[lie] : 0)]);
  return { id: b.id, tables };
}

// Expected strokes to hole out. Fringe uses the fairway table. Linear interpolation, clamped at the ends.
export function expected(B, lie, d) {
  const t = B.tables[lie === 'fringe' ? 'fairway' : lie];
  if (!t) throw new Error('No baseline for lie ' + lie);
  if (d <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (d <= t[i][0]) {
    const [a, b] = [t[i - 1], t[i]];
    return a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0]);
  }
  return t[t.length - 1][1];
}

// The hole card doesn't record short-game distance; these are the assumed starting points.
export const OFF_GREEN_YDS = { fringe: 5, rough: 10, sand: 10 };

export const EXTRA_TO = ['ott', 'app', 'arg', 'putt'];
export const defaultExtraTo = par => par === 3 ? 'app' : 'ott';

// h = {par, yds}; e = HoleEntry fields. Returns score, per-category SG (null = not applicable) and total.
export function holeSG(B, h, e) {
  const E = (lie, d) => expected(B, lie, d), { par, yds } = h;
  let ott = null, app = 0, arg = null, putt = null, score = 0, lieApp, A = e.approach_from_yds, d1 = null, pen = 0;
  const layup = par === 5 && e.go_for_green_on === 3;
  if (par === 3) { lieApp = 'tee'; A = yds; }
  else {
    pen = e.tee_result === 'penalty' ? 1 : 0;
    const l1 = pen ? 'rough' : e.tee_result;
    d1 = layup ? e.layup_from_yds : A;
    ott = E('tee', yds) - E(l1, d1) - 1 - pen;
    score = 1 + pen;
    if (layup) { app += E(l1, e.layup_from_yds) - E(e.layup_lie, A) - 1; score++; lieApp = e.layup_lie; }
    else lieApp = l1;
  }
  const onGreen = e.approach_result === 'green';
  const putts = e.putts || 0, fpE = putts > 0 ? E('green', e.first_putt_ft) : 0;
  const offD = OFF_GREEN_YDS[e.approach_result];
  app += E(lieApp, A) - (onGreen ? fpE : E(e.approach_result, offD)) - 1; score++;
  if (!onGreen) { arg = E(e.approach_result, offD) - fpE - e.short_game_shots; score += e.short_game_shots; }
  if (putts > 0) { putt = fpE - putts; score += putts; }
  // Handicap-level baseline (B.adjust): add a fixed amount to each category that applies on this hole.
  // Scratch has none. Categories still sum to the hole total.
  let total = E('tee', yds) - score;
  const adj = B.adjust;
  if (adj) {
    if (ott !== null) { ott += adj.ott; total += adj.ott; }
    app += adj.app; total += adj.app;
    if (arg !== null) { arg += adj.arg; total += adj.arg; }
    if (putt !== null) { putt += adj.putt; total += adj.putt; }
  }
  // Extra strokes the shot questions don't capture (e.g. two to get out of the trees), entered on the score box.
  // Each costs 1 in the chosen category (default: off the tee, or approach on a par 3). Categories still sum to the total.
  const x = Math.trunc(e.extra_strokes || 0);
  const extraTo = x ? (EXTRA_TO.includes(e.extra_to) ? e.extra_to : defaultExtraTo(par)) : null;
  if (x) {
    if (extraTo === 'ott') ott = (ott ?? 0) - x;
    else if (extraTo === 'app') app -= x;
    else if (extraTo === 'arg') arg = (arg ?? 0) - x;
    else putt = (putt ?? 0) - x;
    score += x; total -= x;
  }
  return { par, yds, score, cats: { ott, app, arg, putt }, total, A, d1, pen, layup, onGreen, extra: x, extraTo };
}