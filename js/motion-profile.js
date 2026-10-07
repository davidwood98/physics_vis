/**
 * motion-profile.js: trapezoidal vs S-curve point-to-point moves at 1:1 scale.
 *
 * Two lanes run the same pick-and-place cycle (move out, place dwell, move
 * back, pick dwell): the top dot follows a trapezoidal profile (acceleration
 * limited, infinite jerk), the bottom one a jerk-limited double S. Both start
 * together each cycle; the quicker one finishes first and waits. Under the
 * lanes, position, velocity and acceleration (and optionally jerk) graphs of
 * both profiles over one cycle, with a moving "now" marker and the limits as
 * dashed lines, show that a short move never reaches its speed limit.
 *
 * The lanes are true size when the move fits on screen; a longer move is
 * scaled to fit and badged "SCALED 1:N". All profile maths lives in
 * motion-profile-model.js (closed form, unit tested).
 *
 * Sections: 1 constants + state, 2 setters, 3 UI sync, 4 step, 5 draw, 6 wiring.
 */

import { clamp, G0 } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { sigT } from './astro.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawDot, drawArrowHead, drawRuler, drawTag, drawChart, tickLabel, FONT, FONT_BOLD } from './draw.js';
import * as M from './motion-profile-model.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  dMin: 0.001, dMax: 2,      // move distance, m (log slider)
  vMin: 0.01, vMax: 10,      // speed limit, m/s (log)
  aMin: 0.1, aMax: 200,      // acceleration limit, m/s² (log)
  jMin: 1, jMax: 1e5,        // jerk limit, m/s³ (log)
  dwellMax: 2, dwellStep: 0.01, // s
};

/** Page defaults, also the worked example in the explainer (illustrative values). */
const DEFAULTS = { d: 0.05, vMax: 2, aMax: 10, jMax: 500, dwellPick: 0.15, dwellPlace: 0.15 };

// On-screen sizes in CSS px (not to scale)
const DOT_RADIUS_PX = 7;
const LANE_LEFT_PX = 28;        // the pick mark
const LANE_RIGHT_PX = 32;       // room right of the place mark
const TRAIL_SECONDS = 0.08;     // trail = last 0.08 s of on-screen motion...
const TRAIL_MAX_FRACTION = 0.35; // ...capped at 35% of the lane
const CHART_LEFT_PX = 64;       // room for y tick labels
const CHART_RIGHT_PX = 18;

const state = {
  ...DEFAULTS,
  t: 0,            // time since the current cycle started, s
  showJerk: false, // fourth graph
};

let model = null;   // profiles, cycle times and cached graph points (recompute())

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/* ---------- Formatting ---------- */

/** "141 ms", "8.3 ms", "0 ms", "1.23 s". */
function fmtTime(s) {
  if (!Number.isFinite(s)) return '∞';
  const a = Math.abs(s);
  if (a < 0.00005) return '0 ms';
  if (a < 0.0095) return `${sigT(s * 1000, 2)} ms`;
  if (a < 1) return `${fmt(s * 1000, 0)} ms`;
  if (a < 100) return `${fmt(s, 2)} s`;
  return `${fmt(s, 0)} s`;
}
/** Two times in the same unit (ms unless either is a second or more), for the comparison table. */
function fmtTimePair(a, b) {
  if (Math.max(a, b) < 1) return [fmtTime(a), fmtTime(b)];
  const f = (x) => (x < 0.00005 ? '0 s' : `${sigT(x, 3)} s`);
  return [f(a), f(b)];
}
/** Seconds for the maths card: 4 significant figures. */
const fmtS = (s) => `${sigT(s, 4)} s`;
/** "50 mm", "2.5 mm", "1.5 m" (3 significant figures, no trailing zeros). */
const fmtLen = (m) => (m < 1 ? `${sigT(m * 1000, 3)} mm` : `${sigT(m, 3)} m`);
const fmtV = (v, n = 3) => `${sigT(v, n)} m/s`;
const pct = (x, of) => `${fmt((100 * x) / of, 0)}%`;

/* =========================================================================
 * 2. Setters (round to what the number boxes show, so readouts match them)
 * ====================================================================== */

const roundStep = (x, step) => Number((Math.round(x / step) * step).toFixed(6));

function setParam(key, value, lo, hi, step) {
  state[key] = clamp(roundStep(value, step), lo, hi);
  paramsChanged();
}

const params = [
  bindParam({ range: $('d-range'), num: $('d-num'), min: LIMITS.dMin, max: LIMITS.dMax, log: true, scale: 1000, decimals: 1,
    words: 'millimetres', get: () => state.d, set: (v) => setParam('d', v, LIMITS.dMin, LIMITS.dMax, 1e-4) }),
  bindParam({ range: $('v-range'), num: $('v-num'), min: LIMITS.vMin, max: LIMITS.vMax, log: true, decimals: 2,
    words: 'metres per second', get: () => state.vMax, set: (v) => setParam('vMax', v, LIMITS.vMin, LIMITS.vMax, 0.01) }),
  bindParam({ range: $('a-range'), num: $('a-num'), min: LIMITS.aMin, max: LIMITS.aMax, log: true, decimals: 1,
    words: 'metres per second squared', get: () => state.aMax, set: (v) => setParam('aMax', v, LIMITS.aMin, LIMITS.aMax, 0.1) }),
  bindParam({ range: $('j-range'), num: $('j-num'), min: LIMITS.jMin, max: LIMITS.jMax, log: true, decimals: 0,
    words: 'metres per second cubed', get: () => state.jMax, set: (v) => setParam('jMax', v, LIMITS.jMin, LIMITS.jMax, 1) }),
  bindParam({ range: $('pick-range'), num: $('pick-num'), min: 0, max: LIMITS.dwellMax, step: LIMITS.dwellStep, decimals: 2,
    words: 'seconds', get: () => state.dwellPick, set: (v) => setParam('dwellPick', v, 0, LIMITS.dwellMax, LIMITS.dwellStep) }),
  bindParam({ range: $('place-range'), num: $('place-num'), min: 0, max: LIMITS.dwellMax, step: LIMITS.dwellStep, decimals: 2,
    words: 'seconds', get: () => state.dwellPlace, set: (v) => setParam('dwellPlace', v, 0, LIMITS.dwellMax, LIMITS.dwellStep) }),
];

/** Profiles, cycle times and graph points for the current settings. */
function recompute() {
  const { d, vMax, aMax, jMax, dwellPick, dwellPlace } = state;
  const trap = M.trapezoid(d, vMax, aMax);
  const s = M.sCurve(d, vMax, aMax, jMax);
  const cycT = M.cycleTime(trap, dwellPick, dwellPlace);
  const cycS = M.cycleTime(s, dwellPick, dwellPlace);
  const cycShow = Math.max(cycT, cycS); // both lanes restart together at this pace
  const series = {};
  for (const key of ['p', 'v', 'a', 'j']) {
    series[key] = {
      trap: M.cycleSeries(trap, key, dwellPick, dwellPlace, cycShow),
      s: M.cycleSeries(s, key, dwellPick, dwellPlace, cycShow),
    };
  }
  model = { trap, s, cycT, cycS, cycShow, series };
  state.t %= cycShow;
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

function paramsChanged() {
  recompute();
  for (const p of params) p.sync();
  setText($('a-alt'), `= ${fmt(state.aMax / G0, 2)} g`);
  setText($('j-alt'), 'log scale');
  updateReadouts();
  updateEquations();
  updateResult();
  sim.updateAria();
  sim.requestDraw();
  const { trap, s, cycT, cycS } = model;
  announce(
    `${fmtLen(state.d)} move: trapezoid ${fmtTime(trap.T)}, S-curve ${fmtTime(s.T)} per move; ` +
      `${fmt(M.picksPerMinute(cycT), 0)} and ${fmt(M.picksPerMinute(cycS), 0)} picks per minute.`,
  );
}

function updateReadouts() {
  const { trap, s, cycT, cycS } = model;
  const { d, vMax, aMax, jMax } = state;
  const pair = (key, a, b) => {
    const [ta, tb] = fmtTimePair(a, b);
    setText(outputs[`${key}-t`], ta);
    setText(outputs[`${key}-s`], tb);
  };
  for (const [suffix, p] of Object.entries({ t: trap, s })) {
    setText(outputs[`vp-${suffix}`], `${fmtV(p.vPeak)} (${pct(p.vPeak, vMax)})`);
    setText(outputs[`ap-${suffix}`], `${sigT(p.aPeak, 3)} m/s² (${pct(p.aPeak, aMax)})`);
  }
  const save = (kind, which) => M.savingFrom(kind, d, vMax, aMax, jMax, which);
  pair('T', trap.T, s.T);
  pair('Tv', trap.Tv, s.Tv);
  if (!(trap.Tv > 0)) setText(outputs['Tv-t'], 'none');
  if (!(s.Tv > 0)) setText(outputs['Tv-s'], 'none');
  pair('Ta', M.rampTime(trap), M.rampTime(s));
  pair('sv', save('trapezoid', 'v'), save('scurve', 'v'));
  pair('sa', save('trapezoid', 'a'), save('scurve', 'a'));
  pair('cyc', cycT, cycS);
  setText(outputs['sj-t'], 'no jerk limit');
  setText(outputs['sj-s'], fmtTime(save('scurve', 'j')));
  setText(outputs['ppm-t'], fmt(M.picksPerMinute(cycT), 1));
  setText(outputs['ppm-s'], fmt(M.picksPerMinute(cycS), 1));
  setText(outputs['be-t'], fmtLen(M.breakEvenTrapezoid(vMax, aMax)));
  setText(outputs['be-s'], fmtLen(M.breakEvenSCurve(vMax, aMax, jMax)));
  setText(outputs.g, fmt(aMax / G0, 2));
}

/** The maths card, with the current values substituted. */
function updateEquations() {
  const { trap, s, cycT, cycS } = model;
  const { d, vMax: v, aMax: a, jMax: j, dwellPick, dwellPlace } = state;
  const ds = `${sigT(d, 4)} m`;
  const vs = sigT(v, 4);
  const as = sigT(a, 4);
  const js = sigT(j, 5);
  const beT = M.breakEvenTrapezoid(v, a);

  setText(equations.trapT, trap.vReached
    ? `${sigT(d, 4)} / ${vs} + ${vs} / ${as} = ${fmtS(trap.T)}, with a ${fmtS(trap.Tv)} cruise (d = ${ds} ≥ v²/a = ${sigT(beT, 4)} m)`
    : `Not this time: d = ${ds} is less than v²/a = ${sigT(beT, 4)} m, so the trapezoid never reaches v_max.`);
  setText(equations.trapTri, trap.vReached
    ? 'Not used: the move is long enough to reach v_max.'
    : `2√(${sigT(d, 4)} / ${as}) = ${fmtS(trap.T)}; v_peak = √(${as} × ${sigT(d, 4)}) = ${fmtV(trap.vPeak, 4)}`);

  const kase = M.limitCase(s);
  if (kase === 'both' || kase === 'acceleration') {
    setText(equations.sTj, `${as} / ${js} = ${fmtS(s.Tj)} to ramp the acceleration up or down`);
  } else if (kase === 'speed') {
    setText(equations.sTj, `v·j < a², so a_max is never reached: T_j = √(v / j) = √(${vs} / ${js}) = ${fmtS(s.Tj)}`);
  } else {
    setText(equations.sTj, `Neither limit is reached: T_j = (d / 2j)^⅓ = (${sigT(d, 4)} / (2 × ${js}))^⅓ = ${fmtS(s.Tj)}`);
  }
  if (kase === 'both') {
    setText(equations.sTa, `T_a = T_j + v / a = ${fmtS(s.Ta)}; T_v = d / v − T_a = ${sigT(d, 4)} / ${vs} − ${sigT(s.Ta, 4)} = ${fmtS(s.Tv)}`);
  } else if (kase === 'speed') {
    setText(equations.sTa, `T_a = 2 T_j = ${fmtS(s.Ta)}; T_v = d / v − T_a = ${fmtS(s.Tv)}`);
  } else if (kase === 'acceleration') {
    setText(equations.sTa, `v_max not reached, T_v = 0: T_a = T_j / 2 + √((T_j / 2)² + d / a) = ${fmtS(s.Ta)}`);
  } else {
    setText(equations.sTa, `T_a = 2 T_j = ${fmtS(s.Ta)}, T_v = 0`);
  }
  setText(equations.sT, `2 × ${sigT(s.Ta, 4)} + ${sigT(s.Tv, 4)} = ${fmtS(s.T)}; peak a = j·T_j = ${sigT(s.aPeak, 4)} m/s², peak v = ${fmtV(s.vPeak, 4)}`);
  setText(equations.seg, `Here: the trapezoid has ${trap.segments.length} constant-acceleration segments, the S-curve ${s.segments.length} constant-jerk segments.`);

  const sBe = v * j >= a * a
    ? `S-curve v²/a + v·a/j = ${sigT(M.breakEvenSCurve(v, a, j), 4)} m`
    : `S-curve 2v√(v/j) = ${sigT(M.breakEvenSCurve(v, a, j), 4)} m (a_max is never reached)`;
  setText(equations.be, `Trapezoid ${vs}² / ${as} = ${sigT(beT, 4)} m; ${sBe}`);
  const dw = `${sigT(dwellPick, 3)} + ${sigT(dwellPlace, 3)}`;
  setText(equations.cyc, `Trapezoid 2 × ${sigT(trap.T, 4)} + ${dw} = ${fmtS(cycT)}; S-curve 2 × ${sigT(s.T, 4)} + ${dw} = ${fmtS(cycS)}`);
  setText(equations.ppm, `60 / ${sigT(cycT, 4)} = ${fmt(M.picksPerMinute(cycT), 1)} (trapezoid); 60 / ${sigT(cycS, 4)} = ${fmt(M.picksPerMinute(cycS), 1)} (S-curve)`);
  const N = laneScale(sim.width, sim.k);
  setText(equations.scale, `1 m = ${fmt(sim.k, 0)} CSS px on this screen (${scaleSourceText(sim.scale)})` +
    (N > 1 ? `; the lanes are scaled 1:${sigT(N, 3)} to fit this move` : ''));
}

/** The main lesson, computed live: is v_max reached, and what would help? */
function updateResult() {
  const { trap, s } = model;
  const { d, vMax: v, aMax: a, jMax: j } = state;
  const len = fmtLen(d);
  let text;
  if (!trap.vReached) {
    text = `This ${len} move never reaches ${fmtV(v, 3)}: the trapezoid peaks at ${fmtV(trap.vPeak, 2)} (${pct(trap.vPeak, v)} of the limit), the S-curve at ${fmtV(s.vPeak, 2)} (${pct(s.vPeak, v)}).`;
  } else if (!s.vReached) {
    text = `The trapezoid just reaches ${fmtV(v, 3)} on this ${len} move, but the S-curve peaks at ${fmtV(s.vPeak, 2)} (${pct(s.vPeak, v)}): it needs ${fmtLen(M.breakEvenSCurve(v, a, j))} to reach the limit.`;
  } else {
    text = `This ${len} move reaches ${fmtV(v, 3)} and cruises for ${fmtTime(trap.Tv)} (trapezoid) or ${fmtTime(s.Tv)} (S-curve).`;
  }
  const save = (which) => fmtTime(M.savingFrom('scurve', d, v, a, j, which));
  text += ` Per S-curve move, doubling the speed limit saves ${save('v')}; doubling the acceleration saves ${save('a')}; doubling the jerk saves ${save('j')}.`;
  setText($('result'), text);
}

function describe() {
  if (!model) return 'Motion profile simulation';
  const { trap, s, cycShow } = model;
  const N = laneScale(sim.width, sim.k);
  const scaleWord = N > 1 ? `scaled 1 to ${sigT(N, 3)}` : sim.scale.calibrated ? 'calibrated 1:1 scale' : 'approximate 1:1 scale';
  const timeWord = sim.timeScale === 1 ? 'real time' : `slow motion at ${sim.timeScale} times`;
  return `Two lanes at ${scaleWord}, ${timeWord}${sim.paused ? ', paused' : ''}: a ${fmtLen(state.d)} pick-and-place move. ` +
    `Top lane trapezoidal profile, ${fmtTime(trap.T)} per move, peak speed ${fmtV(trap.vPeak, 2)}. ` +
    `Bottom lane S-curve, ${fmtTime(s.T)} per move, peak speed ${fmtV(s.vPeak, 2)}. Speed limit ${fmtV(state.vMax, 3)}. ` +
    `Below: graphs of position, velocity, acceleration${state.showJerk ? ' and jerk' : ''} for both over one ${fmtTime(cycShow)} cycle.`;
}

/* =========================================================================
 * 4. Step: one shared cycle clock; each lane reads its own profile from it
 * ====================================================================== */

function step(simDt) {
  state.t = (state.t + simDt) % model.cycShow;
}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre)
 * ====================================================================== */

/** Smallest "nice" reduction (1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8 × 10ⁿ) that is ≥ ratio. */
function niceReduction(ratio) {
  if (ratio <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(ratio));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= ratio * (1 - 1e-9)) return m * p;
  return 10 * p;
}

/** 1 when the move fits the lane at true size, else the N of "SCALED 1:N". */
function laneScale(w, k) {
  const avail = Math.max(40, w - LANE_LEFT_PX - LANE_RIGHT_PX);
  return niceReduction((state.d * k) / avail);
}

const PHASE_WORDS = { out: 'moving out', place: 'placing', back: 'moving back', pick: 'picking' };

function draw(ctx, w, h, k, colors) {
  const lanesBottom = drawLanes(ctx, w, k, colors);
  drawGraphs(ctx, w, h, colors, lanesBottom);
}

function drawLanes(ctx, w, k, colors) {
  const N = laneScale(w, k);
  const kd = k / N;
  const x0 = LANE_LEFT_PX;
  const xEnd = x0 + state.d * kd;
  const yMarks = 50;
  const lanes = [
    { y: 96, prof: model.trap, color: colors.accent, name: 'Trapezoid' },
    { y: 150, prof: model.s, color: colors.ref, name: 'S-curve' },
  ];

  // Scale badge + what it means (top-left; the time badge sits top-right)
  ctx.font = FONT;
  const bw = N === 1
    ? drawTag(ctx, 'TRUE SIZE 1:1', 12, 20, { color: colors.ok, background: colors.okBg })
    : drawTag(ctx, `SCALED 1:${sigT(N, 3)}`, 12, 20, { color: colors.warn, background: colors.warnBg });
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(N === 1
    ? `${fmtLen(state.d)} move at real size and real speed`
    : `This ${fmtLen(state.d)} move is wider than your screen at true size: drawn ${sigT(N, 3)}× smaller, timing is real`,
  12 + bw + 10, 20);

  // Pick and place marks (static): a short upright on each lane, labelled once at the top
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const lane of lanes) {
    for (const x of [x0, xEnd]) {
      ctx.moveTo(x, lane.y - 11);
      ctx.lineTo(x, lane.y + 11);
    }
  }
  ctx.stroke();
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = 'middle';
  const placeText = `Place (${fmtLen(state.d)})`;
  ctx.textAlign = 'left';
  ctx.fillText('Pick', x0 - 4, yMarks);
  const pickW = ctx.measureText('Pick').width;
  if (xEnd - ctx.measureText(placeText).width / 2 > x0 + pickW + 8) {
    ctx.textAlign = 'center';
    ctx.fillText(placeText, Math.min(xEnd, w - 12 - ctx.measureText(placeText).width / 2), yMarks);
  } else {
    ctx.fillText(placeText, x0 + pickW + 10, yMarks); // tiny move: keep the label clear of "Pick"
  }

  // Lanes: track, label (fixed position), dot + trail
  const laneLen = w - 8; // track runs across the view like the velocity page
  for (const lane of lanes) {
    ctx.strokeStyle = colors.track;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(8, lane.y);
    ctx.lineTo(laneLen, lane.y);
    ctx.stroke();

    const st = M.cycleState(lane.prof, state.t, state.dwellPick, state.dwellPlace);
    const other = lane.prof === model.trap ? 'S-curve' : 'trapezoid';
    const phase = st.phase === 'wait' ? `done, waiting for the ${other}` : PHASE_WORDS[st.phase];
    ctx.font = FONT_BOLD;
    ctx.fillStyle = lane.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const head = `${lane.name} · ${fmtTime(lane.prof.T)} per move:`;
    ctx.fillText(head, x0 - 4, lane.y - 14);
    const headW = ctx.measureText(head).width;
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.fillText(phase, x0 - 4 + headW + 5, lane.y - 14);

    const x = x0 + st.p * kd;
    const trail = Math.min(Math.abs(st.v) * sim.timeScale * TRAIL_SECONDS * kd, (w - x0) * TRAIL_MAX_FRACTION);
    drawTrail(ctx, x, lane.y, Math.sign(st.v), trail, lane.color);
    drawDot(ctx, x, lane.y, DOT_RADIUS_PX, lane.color);
  }

  // Ruler under the lower lane, from the pick point
  drawRuler(ctx, colors, { x: x0, y: lanes[1].y + 6, lengthM: Math.max(0, (w - x0 - 8) / kd), k: kd });
  return lanes[1].y + 64;
}

/** Fading trail behind a dot moving in direction dir (±1), lenPx long. */
function drawTrail(ctx, x, y, dir, lenPx, color) {
  if (!(lenPx > 1) || dir === 0) return;
  const n = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = DOT_RADIUS_PX * 1.4;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = (0.5 * (i + 1)) / n;
    ctx.beginPath();
    ctx.moveTo(x - dir * lenPx * (1 - i / n), y);
    ctx.lineTo(x - dir * lenPx * (1 - (i + 1) / n), y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Tick labels with thousands separators for big values (jerk). */
const yFmt = (v) => (Math.abs(v) >= 1000 ? fmt(v, 0) : tickLabel(v));

function drawGraphs(ctx, w, h, colors, top) {
  const { trap, s, series, cycShow } = model;
  const keys = state.showJerk ? ['p', 'v', 'a', 'j'] : ['p', 'v', 'a'];
  const left = CHART_LEFT_PX;
  const boxW = w - left - CHART_RIGHT_PX;
  if (boxW < 80) return;

  // Legend
  let lx = left;
  const ly = top + 2;
  const legend = (text, color, dash, width = 2.5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 24, ly);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.fg;
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 30, ly);
    lx += 30 + ctx.measureText(text).width + 26;
  };
  legend('Trapezoid (infinite jerk)', colors.accent, []);
  legend('S-curve (jerk-limited)', colors.ref, [7, 4]);
  legend('Limit', colors.muted, [2, 4], 1.5);
  legend('Now', colors.fg, [3, 3], 1);

  const areaTop = top + 18;
  const slot = (h - areaTop - 4) / keys.length;
  const units = state.d < 1 ? { f: 1000, name: 'mm' } : { f: 1, name: 'm' };

  keys.forEach((key, i) => {
    const box = { x: left, y: areaTop + i * slot + 24, w: boxW, h: Math.max(24, slot - 24 - 22) };
    let yr;
    let title;
    let limit = null;      // value of the dashed ± limit lines
    let offChart = null;   // text when the limit is far above the curves
    let scale = 1;
    if (key === 'p') {
      scale = units.f;
      yr = [0, state.d * units.f * 1.12];
      title = `Position (${units.name})`;
    } else if (key === 'v') {
      const peak = Math.max(trap.vPeak, s.vPeak);
      const top2 = state.vMax <= 5 * peak ? state.vMax * 1.15 : peak * 1.3; // show the limit unless it would flatten the curves
      yr = [-top2, top2];
      title = `Velocity (m/s): peaks ${sigT(trap.vPeak, 2)} and ${sigT(s.vPeak, 2)}, limit ${sigT(state.vMax, 3)}`;
      limit = state.vMax;
      if (state.vMax > top2) offChart = `limit ${sigT(state.vMax, 3)} m/s is ${sigT(state.vMax / peak, 2)}× the peak: far above this graph ↑`;
    } else if (key === 'a') {
      yr = [-state.aMax * 1.2, state.aMax * 1.2];
      title = `Acceleration (m/s²): limit ${sigT(state.aMax, 3)} (${fmt(state.aMax / G0, 2)} g)` +
        (s.aReached ? '' : `, S-curve peaks at ${sigT(s.aPeak, 2)}`);
      limit = state.aMax;
    } else {
      yr = [-state.jMax * 1.25, state.jMax * 1.25];
      title = `Jerk (m/s³): S-curve ±${fmt(state.jMax, 0)}; trapezoid infinite at each corner (spikes)`;
      limit = state.jMax;
    }
    const pts = (arr) => (scale === 1 ? arr : arr.map(([t, y]) => [t, y * scale]));
    const plotted = [];
    if (key !== 'j') plotted.push({ points: pts(series[key].trap), color: colors.accent, width: 2.5 });
    plotted.push({ points: pts(series[key].s), color: colors.ref, width: 2.5, dash: [7, 4] });

    const { X, Y } = drawChart(ctx, colors, {
      box, xr: [0, cycShow], yr, series: plotted, title, xLabel: 'time (s)', marker: state.t,
      xTicks: clamp(Math.round(boxW / 90), 4, 20), yTicks: key === 'p' ? 3 : 4, yFmt,
    });

    // Dashed limit lines, labelled at the right end
    ctx.save();
    ctx.font = FONT;
    if (limit !== null && limit <= yr[1]) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      for (const yv of [limit, -limit]) {
        ctx.moveTo(box.x, Y(yv));
        ctx.lineTo(box.x + box.w, Y(yv));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (offChart) {
      ctx.fillStyle = colors.warn;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(offChart, box.x + box.w - 4, box.y + 3);
    }
    if (key === 'j') drawJerkSpikes(ctx, colors, box, X, Y, yr);
    ctx.restore();
  });
}

/** The trapezoid's jerk is an impulse at every change of acceleration: draw each as a spike to the edge. */
function drawJerkSpikes(ctx, colors, box, X, Y, yr) {
  const { trap } = model;
  const corners = []; // [time, sign of the acceleration step]
  const add = (offset, back) => {
    let aPrev = 0;
    for (const seg of trap.segments) {
      const a = back ? -seg.a0 : seg.a0;
      if (a !== aPrev) corners.push([offset + seg.t0, Math.sign(a - aPrev)]);
      aPrev = a;
    }
    if (aPrev !== 0) corners.push([offset + trap.T, Math.sign(-aPrev)]);
  };
  add(0, false);
  add(trap.T + state.dwellPlace, true);
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.lineWidth = 2;
  for (const [t, sgn] of corners) {
    const x = X(t);
    const yTip = sgn > 0 ? Y(yr[1]) + 2 : Y(yr[0]) - 2;
    ctx.beginPath();
    ctx.moveTo(x, Y(0));
    ctx.lineTo(x, yTip + sgn * 6);
    ctx.stroke();
    drawArrowHead(ctx, x, yTip, 0, -sgn, 7);
  }
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  onResize: () => { updateEquations(); sim.updateAria(); },
  onScaleChange: () => { updateEquations(); sim.updateAria(); },
  debug: {
    state,
    getModel: () => model,
    M,
    laneScale: () => laneScale(sim.width, sim.k),
    renderAt: (t) => { state.t = t % model.cycShow; sim.requestDraw(); },
  },
});

$('restart-btn').addEventListener('click', () => {
  state.t = 0;
  sim.requestDraw();
});
$('jerk-check').addEventListener('change', (e) => {
  state.showJerk = e.target.checked;
  sim.updateAria();
  sim.requestDraw();
});

const preset = (values) => () => {
  Object.assign(state, values);
  state.t = 0;
  paramsChanged();
};
initPresets({
  short: preset({ ...DEFAULTS }),
  transfer: preset({ ...DEFAULTS, d: 0.3 }),
  gantry: preset({ ...DEFAULTS, d: 1.5 }),
  doubleV: () => setParam('vMax', state.vMax * 2, LIMITS.vMin, LIMITS.vMax, 0.01),
  doubleA: () => setParam('aMax', state.aMax * 2, LIMITS.aMin, LIMITS.aMax, 0.1),
  doubleJ: () => setParam('jMax', state.jMax * 2, LIMITS.jMin, LIMITS.jMax, 1),
});

/** Numbers in the explainer's worked example, computed from the model (see the tests). */
function fillWorkedExample() {
  const { d, vMax, aMax, jMax, dwellPick, dwellPlace } = DEFAULTS;
  const trap = M.trapezoid(d, vMax, aMax);
  const s = M.sCurve(d, vMax, aMax, jMax);
  const cycT = M.cycleTime(trap, dwellPick, dwellPlace);
  const cycS = M.cycleTime(s, dwellPick, dwellPlace);
  const ms = (x) => fmt(x * 1000, 0);
  const values = {
    be: fmtLen(M.breakEvenTrapezoid(vMax, aMax)).replace(' ', ' '),
    vpT: sigT(trap.vPeak, 2),
    TT: ms(trap.T),
    Tj: ms(s.Tj),
    vpS: sigT(s.vPeak, 2),
    TS: ms(s.T),
    cycT: fmt(cycT, 3),
    ppmT: fmt(M.picksPerMinute(cycT), 0),
    cycS: fmt(cycS, 3),
    ppmS: fmt(M.picksPerMinute(cycS), 0),
    saS: ms(M.savingFrom('scurve', d, vMax, aMax, jMax, 'a')),
    sjS: ms(M.savingFrom('scurve', d, vMax, aMax, jMax, 'j')),
    cut: fmt(100 * M.savingFrom('trapezoid', d, vMax, aMax, jMax, 'a') / trap.T, 0),
  };
  for (const el of document.querySelectorAll('[data-calc]')) {
    if (values[el.dataset.calc] !== undefined) el.textContent = values[el.dataset.calc];
  }
}

fillWorkedExample();
paramsChanged();
sim.start();
