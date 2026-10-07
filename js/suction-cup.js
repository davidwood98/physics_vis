/**
 * suction-cup.js: vacuum gripper sizing with a true-size side view.
 *
 * The cups and an illustrative product box are drawn at true size. Forces are
 * not lengths, so they get their own scale ("arrow scale: 1 cm = 20 N"): a
 * force panel compares the holding force Δp·A·n with the force the chosen
 * convention (Schmalz or SMC) requires, split into its parts, and bars along
 * the bottom give the verdict (OK / NOT ENOUGH).
 *
 * The page is static. "Show horizontal acceleration" switches to load case II
 * and moves the gripper sideways back and forth at the chosen acceleration (a
 * bang-bang move from motion-profile-model.js); the inertial force and the
 * friction demand m·a/μ rise and fall with it, live.
 *
 * Sections: 1 constants + state, 2 setters, 3 UI sync, 4 step, 5 draw, 6 wiring.
 */

import { clamp, G0, niceStep } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { sigT } from './astro.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawArrowHead, drawTag, FONT, FONT_BOLD } from './draw.js';
import * as V from './suction-cup-model.js';
import { trapezoid, cycleState } from './motion-profile-model.js';
import {
  CONVENTIONS, FRICTION, SMC_PAD_DIAMETERS_MM, SCHMALZ_EXAMPLE, SUF90, DENSITY_KG_M3,
} from './data/suction-cup-data.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  dMin: 0.005, dMax: 0.15, dStep: 0.001,  // cup diameter, m
  nMin: 1, nMax: 8,                       // cups
  pMin: -90, pMax: -10, pStep: 1,         // gauge vacuum, kPa
  mMin: 0.01, mMax: 100,                  // payload, kg (log); 100 kg so Schmalz's 61.33 kg sheet fits
  aMin: 0, aMax: 50, aStep: 0.1,          // m/s²
  muMin: 0.05, muMax: 1, muStep: 0.01,
  LMin: 0.002, LMax: 2.5,                 // product length in the side view, m (log)
  HMin: 0.002, HMax: 0.5,                 // product height, m (log)
};

const CASE_TEXT = {
  I: 'Cup horizontal, lifting: the cups carry the weight plus the upward acceleration.',
  II: 'Cup horizontal, moving sideways: the sideways force comes through friction at the cup lip.',
  III: 'Cup vertical, on a vertical face: the whole weight hangs on friction.',
};
const A_NOTE = {
  I: 'Upward acceleration while lifting.',
  II: 'Sideways acceleration: check the hardest braking, such as an emergency stop.',
  III: 'Acceleration of the load, added to g as in Schmalz\'s case III.',
};

const MOVE_DWELL_S = 0.5;          // pause at each end of the sideways demonstration move
const MOVE_SPEED_CAP = 5;          // m/s, so the demonstration move is (nearly) all acceleration
const BARS_H = 132;                // force bars along the bottom, CSS px
const PANEL_W = 300;               // force panel on the right, CSS px

const DEFAULTS = {
  d: 0.04, n: 2, p: -60, m: 3, a: 5, mu: 0.5, surface: 'dry',
  loadCase: 'I', convention: 'schmalz', S: 1.5, L: 0.25, H: 0.12,
};

const state = { ...DEFAULTS, animate: false, t: 0 };
let move = null; // demonstration move (motion-profile-model trapezoid), rebuilt on change

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/* ---------- Derived quantities ---------- */

const g = G0;
const reqParams = (over = {}) => ({
  convention: state.convention, loadCase: state.loadCase, m: state.m, a: state.a, mu: state.mu, S: state.S, g, ...over,
});
const holding = () => V.holdingForce(state.p, state.d, state.n);
const design = () => V.requirement(reqParams());
const otherConvention = () => (state.convention === 'schmalz' ? 'smc' : 'schmalz');

/* ---------- Formatting ---------- */

/** Forces: "1,822 N", "44.4 N", "3.27 N". */
function fmtN(F) {
  const a = Math.abs(F);
  return `${a >= 100 ? fmt(F, 0) : a >= 10 ? fmt(F, 1) : fmt(F, 2)} N`;
}
const fmtMass = (m) => (m < 1 ? `${sigT(m * 1000, 3)} g` : `${sigT(m, 3)} kg`);
const fmtMm = (m) => `${sigT(m * 1000, 3)} mm`;
const factorText = () => (state.convention === 'smc' ? `t = ${V.smcFactor(state.loadCase)}` : `S = ${sigT(state.S, 2)}`);
const convText = () => `${CONVENTIONS[state.convention].name}, load case ${state.loadCase}, ${factorText()}`;

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

const roundStep = (x, step) => Number((Math.round(x / step) * step).toFixed(6));
const roundSig = (x, n = 3) => Number(x.toPrecision(n));

function setValue(key, v) {
  state[key] = v;
  paramsChanged();
}

const params = [
  bindParam({ range: $('d-range'), num: $('d-num'), min: LIMITS.dMin, max: LIMITS.dMax, step: LIMITS.dStep, scale: 1000, decimals: 0,
    words: 'millimetres', get: () => state.d, set: (v) => setValue('d', clamp(roundStep(v, 0.0005), LIMITS.dMin, LIMITS.dMax)) }),
  bindParam({ range: $('n-range'), num: $('n-num'), min: LIMITS.nMin, max: LIMITS.nMax, step: 1, decimals: 0,
    words: 'cups', get: () => state.n, set: (v) => setValue('n', clamp(Math.round(v), LIMITS.nMin, LIMITS.nMax)) }),
  bindParam({ range: $('p-range'), num: $('p-num'), min: LIMITS.pMin, max: LIMITS.pMax, step: LIMITS.pStep, decimals: 0,
    words: 'kilopascals gauge', get: () => state.p, set: (v) => setValue('p', clamp(roundStep(v, 1), LIMITS.pMin, LIMITS.pMax)) }),
  bindParam({ range: $('m-range'), num: $('m-num'), min: LIMITS.mMin, max: LIMITS.mMax, log: true, decimals: 2,
    words: 'kilograms', get: () => state.m, set: (v) => setValue('m', clamp(roundSig(v, 3), LIMITS.mMin, LIMITS.mMax)) }),
  bindParam({ range: $('a-range'), num: $('a-num'), min: LIMITS.aMin, max: LIMITS.aMax, step: LIMITS.aStep, decimals: 1,
    words: 'metres per second squared', get: () => state.a, set: (v) => setValue('a', clamp(roundStep(v, 0.1), LIMITS.aMin, LIMITS.aMax)) }),
  bindParam({ range: $('mu-range'), num: $('mu-num'), min: LIMITS.muMin, max: LIMITS.muMax, step: LIMITS.muStep, decimals: 2,
    words: '', get: () => state.mu, set: (v) => { state.surface = 'custom'; setValue('mu', clamp(roundStep(v, 0.01), LIMITS.muMin, LIMITS.muMax)); } }),
  bindParam({ range: $('L-range'), num: $('L-num'), min: LIMITS.LMin, max: LIMITS.LMax, log: true, scale: 1000, decimals: 1,
    words: 'millimetres', get: () => state.L, set: (v) => setValue('L', clamp(roundSig(v, 3), LIMITS.LMin, LIMITS.LMax)) }),
  bindParam({ range: $('H-range'), num: $('H-num'), min: LIMITS.HMin, max: LIMITS.HMax, log: true, scale: 1000, decimals: 1,
    words: 'millimetres', get: () => state.H, set: (v) => setValue('H', clamp(roundSig(v, 3), LIMITS.HMin, LIMITS.HMax)) }),
];

function setLoadCase(c) {
  state.loadCase = c;
  if (c !== 'II' && state.animate) setAnimate(false);
  paramsChanged();
}

/** "Show horizontal acceleration": sideways moves are load case II, so switch to it. */
function setAnimate(on) {
  state.animate = on;
  $('accel-check').checked = on;
  state.t = 0;
  if (on && state.loadCase !== 'II') state.loadCase = 'II';
  for (const el of [$('play-btn'), $('time-scale'), $('time-badge')]) el.hidden = !on;
  sim.setPaused(!on || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  paramsChanged();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

function paramsChanged() {
  move = trapezoid(demoStroke(), MOVE_SPEED_CAP, Math.max(state.a, 1e-6));
  for (const p of params) p.sync();
  $(`case-${state.loadCase}`).checked = true;
  $(`conv-${state.convention}`).checked = true;
  $('surface-select').value = state.surface;
  $('s-select').value = String(state.S);
  $('s-row').hidden = state.convention !== 'schmalz';
  setText($('p-alt'), `${fmt(V.vacuumPercent(state.p), 1)}% vacuum`);
  setText($('a-alt'), `= ${fmt(state.a / G0, 2)} g`);
  setText($('a-note'), A_NOTE[state.loadCase]);
  setText($('case-note'), CASE_TEXT[state.loadCase]);
  setText($('conv-note'), state.convention === 'schmalz'
    ? 'Schmalz: the load includes acceleration and friction, then × S (at least 1.5; 2 or more for porous, rough or oiled; 2.5 if swivelled).'
    : `SMC: theoretical force ÷ t must exceed the weight; t = 4 with the pad horizontal, 8 with it vertical. No acceleration or friction term: t is meant to cover them.`);
  updateReadouts();
  updateEquations();
  updateResult();
  sim.updateAria();
  sim.requestDraw();
  const F = holding();
  const r = design();
  announce(`Holding force ${fmtN(F)}, required ${fmtN(r.required)} (${convText()}): ${F >= r.required ? 'OK' : 'not enough'}.`);
}

/**
 * What would make it pass: the smallest standard size at this vacuum and cup
 * count, and the vacuum needed with these cups. Returns the options as phrases
 * (empty when nothing within reach would do).
 */
function fixes(required) {
  const dPass = V.smallestPassingSize(required, state.p, state.n, SMC_PAD_DIAMETERS_MM, 150);
  const pNeed = V.vacuumForForce(required, state.d, state.n);
  const options = [];
  if (dPass) options.push(`ø${sigT(dPass * 1000, 3)} mm cups (the smallest SMC standard size that passes)`);
  if (pNeed <= -LIMITS.pMin) options.push(`−${fmt(Math.ceil(pNeed), 0)} kPa with these cups`);
  else if (pNeed < 101.325) options.push(`−${fmt(Math.ceil(pNeed), 0)} kPa with these cups (beyond this page's −90 kPa)`);
  const advice = options.length
    ? `Try ${options.join(', or ')}.`
    : `No standard cup up to ø150 mm, and no vacuum, is enough with ${state.n} ${state.n === 1 ? 'cup' : 'cups'}: add cups or lighten the load.`;
  return { dPass, pNeed, advice };
}
/** Ratio of holding to required force, "1.05×", "13.6×", "0.0009×". */
const ratioText = (F, req) => `${sigT(F / req, 3)}×`;

function updateReadouts() {
  const F = holding();
  const r = design();
  const other = V.requirement(reqParams({ convention: otherConvention() }));
  const ok = F >= r.required;
  setText(outputs.hold, fmtN(F).replace(' N', ''));
  setText(outputs.holdKgf, sigT(V.toKgf(F), 3));
  setText(outputs.req, fmtN(r.required).replace(' N', ''));
  setText(outputs.reqSub, `${convText()}; ${CONVENTIONS[otherConvention()].name} would ask for ${fmtN(other.required)}`);
  setText(outputs.sf, fmt(F / r.demand, 2));
  setText(outputs.sfNeed, state.convention === 'smc' ? `t ≥ ${r.factor}` : `S ≥ ${sigT(r.factor, 2)}`);
  setText(outputs.verdict, `${ok ? 'OK' : 'NOT ENOUGH'}: ${ratioText(F, r.required)} the required force`);
  outputs.verdict.classList.toggle('verdict--ok', ok);
  outputs.verdict.classList.toggle('verdict--warn', !ok);
  setText(outputs.mMax, fmtMass(V.maxMass(F, reqParams())));
  const aMax = V.maxAcceleration(F, reqParams());
  if (aMax === null) {
    setText(outputs.aMax, 'not in SMC\'s formula');
    setText(outputs.aMaxSub, 'its factor t is meant to cover acceleration');
  } else if (aMax < 0) {
    setText(outputs.aMax, 'none');
    setText(outputs.aMaxSub, 'too little force even at rest');
  } else {
    setText(outputs.aMax, `${sigT(aMax, 3)} m/s²`);
    setText(outputs.aMaxSub, `${fmt(aMax / G0, 2)} g, ${state.loadCase === 'II' ? 'sideways' : state.loadCase === 'I' ? 'upwards' : 'with the cup vertical'}`);
  }
  setText(outputs.vac, `${fmt(state.p, 0).replace('-', '−')}`);
  setText(outputs.vacPct, fmt(V.vacuumPercent(state.p), 1));
  setText(outputs.vacAbs, fmt(V.absolutePressureKPa(state.p), 1));
  setText(outputs.nCups, `${state.n} ${state.n === 1 ? 'cup' : 'cups'}`);
  const f = fixes(r.required);
  setText(outputs.fix, ok
    ? `Passes. Smallest standard size that would also pass: ${f.dPass ? `ø${sigT(f.dPass * 1000, 3)} mm` : '–'}; least vacuum with these cups: −${fmt(Math.ceil(f.pNeed), 0)} kPa.`
    : f.advice);
}

function updateEquations() {
  const F = holding();
  const { m, a, mu, S, d, n, p } = state;
  const ms = sigT(m, 3);
  const gs = '9.807';
  const as = sigT(a, 3);
  const mus = sigT(mu, 2);
  const Ss = sigT(S, 2);
  setText(equations.hold, `${fmt(-p * 1000, 0)} Pa × π × (${sigT(d, 3)} m)² / 4 × ${n} = ${fmtN(F)}`);
  const sch = (lc) => V.requirement(reqParams({ convention: 'schmalz', loadCase: lc })).required;
  const mine = (lc) => (state.convention === 'schmalz' && state.loadCase === lc ? ' ← your case' : '');
  setText(equations.I, `${ms} × (${gs} + ${as}) × ${Ss} = ${fmtN(sch('I'))}${mine('I')}`);
  setText(equations.II, `${ms} × (${gs} + ${as} / ${mus}) × ${Ss} = ${fmtN(sch('II'))}${mine('II')}`);
  setText(equations.III, `(${ms} / ${mus}) × (${gs} + ${as}) × ${Ss} = ${fmtN(sch('III'))}${mine('III')}`);
  const t = V.smcFactor(state.loadCase);
  const areaCm2 = V.cupArea(d) * 1e4 * n;
  const W = V.smcLiftingForce(p, areaCm2, t);
  setText(equations.smc, `${fmt(-p, 0)} × ${sigT(areaCm2, 4)} cm² × 0.1 / ${t} = ${fmtN(W)} against m·g = ${fmtN(m * G0)}: ` +
    `${W >= m * G0 ? 'passes' : 'fails'}${state.convention === 'smc' ? ' ← your case' : ''}`);
  const r = design();
  setText(equations.sf, `${fmtN(F)} / ${fmtN(r.demand)} = ${fmt(F / r.demand, 2)} (needs ${state.convention === 'smc' ? `t ≥ ${r.factor}` : `S ≥ ${Ss}`})`);
  setText(equations.vac, `${fmt(-p, 0)} / 101.325 = ${fmt(V.vacuumPercent(p), 1)}%; 101.325 − ${fmt(-p, 0)} = ${fmt(V.absolutePressureKPa(p), 1)} kPa absolute`);
  setText(equations.scale, `1 m = ${fmt(sim.k, 0)} CSS px on this screen (${scaleSourceText(sim.scale)}); forces: 1 cm = ${forceScaleText()}`);
}

function updateResult() {
  const F = holding();
  const r = design();
  const el = $('result');
  const ok = F >= r.required;
  let text = `${ok ? 'OK' : 'NOT ENOUGH'}: ${fmtN(F)} of holding force against ${fmtN(r.required)} required (${convText()}), ${ratioText(F, r.required)} what is needed.`;
  if (!ok) text += ` ${fixes(r.required).advice}`;
  const fit = fitWarning();
  if (fit) text += ` ${fit}`;
  setText(el, text);
  el.classList.toggle('result--warn', !ok);
}

/** Geometry check: a cup that is wider than the face it sits on can't seal. */
function fitWarning() {
  const face = state.loadCase === 'III' ? state.H : state.L;
  if (state.d > face) return `Note: a ${fmtMm(state.d)} cup is bigger than the ${fmtMm(face)} face it sits on, so it can't seal.`;
  return '';
}

function describe() {
  const F = holding();
  const r = design();
  const scaleWord = sim.scale.calibrated ? 'calibrated true size' : 'approximate true size';
  const where = state.loadCase === 'III' ? 'on the side of' : 'on top of';
  const anim = state.animate ? ` The gripper moves sideways back and forth at ${sigT(state.a, 3)} metres per second squared${sim.timeScale !== 1 ? ` in slow motion, ${sim.timeScale} times` : ''}${sim.paused ? ', paused' : ''}.` : '';
  return `Side view at ${scaleWord}: ${state.n} ${state.n === 1 ? 'cup' : 'cups'} of ${fmtMm(state.d)} diameter ${where} a ${fmtMm(state.L)} by ${fmtMm(state.H)} box, ` +
    `load case ${state.loadCase}. Holding force ${fmtN(F)}, required ${fmtN(r.required)} (${convText()}): ${F >= r.required ? 'OK' : 'not enough'}.${anim}`;
}

/* =========================================================================
 * 4. Step: the sideways demonstration move (only while it is switched on)
 * ====================================================================== */

/** Length of the back-and-forth demonstration move, m: what fits beside the product. */
function demoStroke() {
  const k = sim?.k || 3780;
  const room = (sceneRightPx(sim?.width || 1200) - 60) / k - Math.min(state.L, 0.4);
  return clamp(room, 0.05, 0.25);
}

const cycleLength = () => 2 * move.T + 2 * MOVE_DWELL_S;

function step(simDt) {
  if (!state.animate) {
    sim.setPaused(true); // e.g. Space pressed while static: nothing to run
    return;
  }
  state.t = (state.t + simDt) % cycleLength();
}

/** Position (m) and signed acceleration (m/s²) of the gripper along the demonstration move. */
function moveNow() {
  if (!state.animate || state.a <= 0) return { x: 0, a: 0 };
  const s = cycleState(move, state.t, MOVE_DWELL_S, MOVE_DWELL_S);
  return { x: s.p, a: s.a };
}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre; forces use their own N-per-cm scale)
 * ====================================================================== */

const sceneRightPx = (w) => w - PANEL_W - 24;

/** Force scale in N per screen centimetre: a 1-2-5 value so the biggest force fits in maxPx. */
function forceScale(maxF, maxPx, k) {
  const cm = Math.max(1, maxPx / (0.01 * k));
  return niceStep(maxF / cm);
}
let lastForceScale = 0;
const forceScaleText = () => (lastForceScale ? `${sigT(lastForceScale, 3)} N` : '–');

function draw(ctx, w, h, k, colors) {
  const F = holding();
  const r = design();
  const now = moveNow();
  const live = state.animate ? V.requirement(reqParams({ a: Math.abs(now.a) })) : r;
  const sceneTop = 46;
  const sceneBottom = h - BARS_H - 18;
  // Leave room above the arrows for the panel's title, scale bar and inertia lines
  const nPerCm = forceScale(Math.max(F, r.required, state.m * state.a), sceneBottom - sceneTop - 140, k);
  if (nPerCm !== lastForceScale) {
    lastForceScale = nPerCm;
    setText(equations.scale, `1 m = ${fmt(sim.k, 0)} CSS px on this screen (${scaleSourceText(sim.scale)}); forces: 1 cm = ${forceScaleText()}`);
  }
  const fpx = (N) => (N / nPerCm) * 0.01 * k; // force → arrow length in px

  // Badge row
  const bw = drawTag(ctx, 'TRUE SIZE 1:1', 12, 20, { color: colors.ok, background: colors.okBg });
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Cups and product at real size. Forces are arrows: 1 cm = ${sigT(nPerCm, 3)} N.`, 12 + bw + 10, 20);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, sceneTop - 6, sceneRightPx(w) + 8, sceneBottom - sceneTop + 12);
  ctx.clip();
  if (state.loadCase === 'III') drawSceneVertical(ctx, w, k, colors, sceneTop, sceneBottom);
  else drawSceneHorizontal(ctx, w, k, colors, sceneTop, sceneBottom, now, fpx);
  ctx.restore();

  drawForcePanel(ctx, w, colors, sceneTop, sceneBottom, F, live, r, fpx, nPerCm, k, now);
  drawBars(ctx, w, h, colors, F, live, r);
}

/** Cup outline for a cup centred at (cx, lipY) seen from the side, lip down (dir = 1) . */
function cupPath(ctx, cx, lip, Dpx, Hpx) {
  ctx.beginPath();
  ctx.moveTo(cx - Dpx / 2, lip);
  ctx.lineTo(cx + Dpx / 2, lip);
  ctx.lineTo(cx + Dpx * 0.36, lip - Hpx * 0.55);
  ctx.lineTo(cx + Dpx * 0.2, lip - Hpx);
  ctx.lineTo(cx - Dpx * 0.2, lip - Hpx);
  ctx.lineTo(cx - Dpx * 0.36, lip - Hpx * 0.55);
  ctx.closePath();
}

/**
 * Where cups go along a face of length faceM: evenly spread, as many as fit in
 * one row. On a face much longer than the view (visibleM), the spacing is
 * shortened so at least the first cup is fully in view (`squeezed`).
 */
function cupLayout(faceM, visibleM) {
  const cols = Math.max(1, Math.min(state.n, Math.floor(faceM / (state.d * 1.1)) || 1));
  const rows = Math.ceil(state.n / cols);
  const even = faceM / cols;
  const fit = Math.max(1.2 * state.d, 2 * (0.8 * visibleM - state.d / 2));
  const spacing = Math.min(even, fit);
  const centres = Array.from({ length: cols }, (_, i) => (i + 0.5) * spacing);
  return { cols, rows, centres, squeezed: spacing < even * (1 - 1e-9) };
}

/** Zig-zag break line along a horizontal or vertical edge (the product continues beyond the view). */
function breakLine(ctx, x0, y0, x1, y1, colors) {
  ctx.strokeStyle = colors.ref;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.round(len / 10));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = i % 2 ? 4 : -4;
    const x = x0 + (x1 - x0) * t + (x1 === x0 ? off : 0);
    const y = y0 + (y1 - y0) * t + (y1 === y0 ? off : 0);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Product box at true size, clipped to the scene with break lines and a note. */
function drawProduct(ctx, colors, left, top, Lpx, Hpx, right, bottom) {
  const x1 = Math.min(left + Lpx, right);
  const y1 = Math.min(top + Hpx, bottom);
  ctx.fillStyle = colors.refFill;
  ctx.fillRect(left, top, x1 - left, y1 - top);
  ctx.strokeStyle = colors.ref;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, top);
  ctx.lineTo(left, top);
  ctx.lineTo(left, y1);
  if (y1 === top + Hpx) ctx.lineTo(x1, y1);
  ctx.moveTo(x1, top);
  if (x1 === left + Lpx) ctx.lineTo(x1, y1);
  ctx.stroke();
  const notes = [];
  if (left + Lpx > right) {
    breakLine(ctx, x1, top, x1, y1, colors);
    notes.push(`${fmtMm(state.L)} long`);
  }
  if (top + Hpx > bottom) {
    breakLine(ctx, left, y1, x1, y1, colors);
    notes.push(`${fmtMm(state.H)} high`);
  }
  return { x1, y1, clipped: notes.length ? `continues beyond the view: ${notes.join(', ')}` : '' };
}

/** Cases I and II: cups on top of the product, gripper above. */
function drawSceneHorizontal(ctx, w, k, colors, top, bottom, now, fpx) {
  const right = sceneRightPx(w);
  const Dpx = state.d * k;
  const cupH = Math.max(6, 0.2 * Dpx);
  const fitH = 12;
  const hose = 26;
  const productTop = top + 34 + hose + fitH + cupH;
  const left = 40 + now.x * k;
  const Lpx = state.L * k;
  const Hpx = state.H * k;
  const prod = drawProduct(ctx, colors, left, productTop, Lpx, Hpx, right + 400, bottom);

  // Cups, fittings, hoses, manifold, arm
  const { cols, rows, centres, squeezed } = cupLayout(state.L, (right - 40) / k);
  const xs = centres.map((c) => left + c * k);
  const visible = xs.filter((x) => x - Dpx / 2 < right + 8);
  const manifoldY = productTop - cupH - fitH - hose;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const x of visible) {
    ctx.moveTo(x, productTop - cupH - fitH);
    ctx.lineTo(x, manifoldY);
  }
  ctx.stroke();
  const mx0 = Math.min(...visible) - 14;
  const mx1 = Math.max(...visible) + 14;
  ctx.fillStyle = colors.muted;
  ctx.fillRect(mx0, manifoldY - 8, mx1 - mx0, 10);
  const armX = (mx0 + Math.min(mx1, right)) / 2;
  ctx.fillRect(armX - 9, top - 10, 18, manifoldY - top + 4);
  for (const x of visible) {
    const fw = Math.max(8, 0.16 * Dpx);
    ctx.fillStyle = colors.muted;
    ctx.fillRect(x - fw / 2, productTop - cupH - fitH, fw, fitH + 1);
    cupPath(ctx, x, productTop, Dpx, cupH);
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Diameter of the first cup, marked inside (or under) the product
  const x0 = xs[0];
  const dimY = Hpx >= 34 ? productTop + 18 : Math.min(productTop + Hpx, bottom) + 18;
  drawDimension(ctx, x0 - Dpx / 2, x0 + Dpx / 2, dimY, `ø${sigT(state.d * 1000, 3)} mm`, colors);

  // Notes in a fixed place
  const lines = [`Product: ${fmtMm(state.L)} × ${fmtMm(state.H)} box (illustrative), ${fmtMass(state.m)}`];
  const shown = visible.length;
  if (rows > 1) lines.push(`${state.n} cups: ${cols} in this row, the rest in ${rows - 1} row${rows > 2 ? 's' : ''} behind`);
  else if (shown < state.n) lines.push(`${state.n} cups: ${shown} in view, the others further along`);
  if (squeezed) lines.push('cups drawn closer together than an even spread, to fit the view');
  if (prod.clipped) lines.push(prod.clipped);
  drawNotes(ctx, lines, right, bottom, colors);

  // Inertial force on the product (case II), opposite to the acceleration: drawn on
  // the product (middle of it, or just under a thin one); its value is in the force panel.
  if (state.loadCase === 'II') {
    const visH = prod.y1 - productTop;
    const aNow = state.animate ? now.a : state.a;
    const Fi = state.m * Math.abs(aNow);
    const cx = clamp(left + Math.min(Lpx, right - left) / 2, 140, right - 140);
    const cy = visH >= 60 ? productTop + visH / 2 : prod.y1 + 58;
    if (Fi > 0 && fpx(Fi) > 2) {
      const dir = aNow >= 0 ? -1 : 1;
      drawForceArrow(ctx, cx, cy, cx + dir * fpx(Fi), cy, colors.fg);
      ctx.font = FONT_BOLD;
      ctx.fillStyle = colors.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('m·a', cx + (dir * fpx(Fi)) / 2, cy - 6);
    }
  }
}

/** Case III: cups on the left face of the product, gripper to the left. */
function drawSceneVertical(ctx, w, k, colors, top, bottom) {
  const right = sceneRightPx(w);
  const Dpx = state.d * k;
  const cupH = Math.max(6, 0.2 * Dpx);
  const fitW = 12;
  const hose = 26;
  const faceX = 40 + 34 + hose + fitW + cupH;
  const productTop = top + 6;
  const Lpx = state.L * k;
  const Hpx = state.H * k;
  const prod = drawProduct(ctx, colors, faceX, productTop, Lpx, Hpx, right + 400, bottom);

  const { cols, rows, centres, squeezed } = cupLayout(state.H, (bottom - productTop) / k);
  const ys = centres.map((c) => productTop + c * k);
  const visible = ys.filter((y) => y - Dpx / 2 < bottom);
  const manifoldX = faceX - cupH - fitW - hose;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const y of visible) {
    ctx.moveTo(faceX - cupH - fitW, y);
    ctx.lineTo(manifoldX, y);
  }
  ctx.stroke();
  const my0 = Math.min(...visible) - 14;
  const my1 = Math.max(...visible) + 14;
  ctx.fillStyle = colors.muted;
  ctx.fillRect(manifoldX - 8, my0, 10, my1 - my0);
  const armY = (my0 + Math.min(my1, bottom)) / 2;
  ctx.fillRect(0, armY - 9, manifoldX - 4, 18);
  for (const y of visible) {
    const fw = Math.max(8, 0.16 * Dpx);
    ctx.fillStyle = colors.muted;
    ctx.fillRect(faceX - cupH - fitW, y - fw / 2, fitW + 1, fw);
    // Cup rotated a quarter turn: lip on the vertical face
    ctx.save();
    ctx.translate(faceX, y);
    ctx.rotate(-Math.PI / 2); // head towards the gripper on the left
    cupPath(ctx, 0, 0, Dpx, cupH);
    ctx.restore();
    ctx.fillStyle = colors.accent;
    ctx.fill();
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Diameter of the first cup, measured along the face (inside the product if there is room)
  const y0 = ys[0];
  const dimX = Lpx >= 40 ? faceX + 18 : Math.min(faceX + Lpx, right) + 18;
  drawDimension(ctx, dimX, dimX, y0, `ø${sigT(state.d * 1000, 3)} mm`, colors, { vertical: true, y0: y0 - Dpx / 2, y1: y0 + Dpx / 2 });

  const lines = [`Product: ${fmtMm(state.L)} × ${fmtMm(state.H)} box (illustrative), ${fmtMass(state.m)}`, 'The weight is held by friction at the cup lips'];
  if (rows > 1) lines.push(`${state.n} cups: ${cols} in this column, the rest behind`);
  else if (visible.length < state.n) lines.push(`${state.n} cups: ${visible.length} in view, the others further down`);
  if (squeezed) lines.push('cups drawn closer together than an even spread, to fit the view');
  if (prod.clipped) lines.push(prod.clipped);
  drawNotes(ctx, lines, right, bottom, colors);
}

/** Notes about the product, in a fixed place (bottom-right of the scene) so they never move with it. */
function drawNotes(ctx, lines, right, bottom, colors) {
  lines.forEach((t, i) => {
    drawTag(ctx, t, right, bottom - 14 - (lines.length - 1 - i) * 24, {
      align: 'right', color: colors.muted, background: colors.bg, border: colors.track, font: FONT, height: 20,
    });
  });
}

/** Dimension line with end stops and a label (horizontal, or vertical from y0 to y1 at x0). */
function drawDimension(ctx, x0, x1, y, label, colors, { vertical = false, y0 = 0, y1 = 0 } = {}) {
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.moveTo(x0 - 5, y0);
    ctx.lineTo(x0 + 5, y0);
    ctx.moveTo(x0 - 5, y1);
    ctx.lineTo(x0 + 5, y1);
  } else {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.moveTo(x0, y - 5);
    ctx.lineTo(x0, y + 5);
    ctx.moveTo(x1, y - 5);
    ctx.lineTo(x1, y + 5);
  }
  ctx.stroke();
  ctx.font = FONT_BOLD;
  if (vertical) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} (true size)`, x0 + 9, (y0 + y1) / 2);
  } else {
    const text = `${label} (true size)`;
    const fits = ctx.measureText(text).width + 8 < x1 - x0;
    ctx.textAlign = fits ? 'center' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, fits ? (x0 + x1) / 2 : x1 + 8, fits ? y - 4 : y + 6);
  }
}

/** Straight force arrow (thick line + head). */
function drawForceArrow(ctx, x0, y0, x1, y1, color) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const head = Math.min(12, len * 0.6);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head * 0.7, y1 - uy * head * 0.7);
  ctx.stroke();
  drawArrowHead(ctx, x1, y1, ux, uy, head);
}

const PART_LABEL = {
  weight: 'weight m·g',
  lift: 'lifting m·a',
  friction: 'sideways m·a/μ',
  weightFriction: 'weight m·g/μ',
  accelFriction: 'acceleration m·a/μ',
};

/**
 * Force panel: two upward arrows on the same force scale from one baseline,
 * the holding force and the required force (its parts stacked, the safety
 * margin dashed). While the demonstration runs, the required arrow is live and
 * a dashed outline marks the design value at full acceleration.
 */
function drawForcePanel(ctx, w, colors, top, bottom, F, live, design, fpx, nPerCm, k, now) {
  const x0 = w - PANEL_W;
  const base = bottom - 6;
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 - 12, top - 4);
  ctx.lineTo(x0 - 12, bottom);
  ctx.stroke();

  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Forces along the cup axis', x0, top);
  // Force scale bar: exactly 1 cm on screen
  const cmPx = 0.01 * k;
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.fillText(`arrow scale: 1 cm = ${sigT(nPerCm, 3)} N`, x0, top + 18);
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, top + 42);
  ctx.lineTo(x0, top + 48);
  ctx.lineTo(x0 + cmPx, top + 48);
  ctx.lineTo(x0 + cmPx, top + 42);
  ctx.stroke();

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.lineTo(w - 16, base);
  ctx.stroke();

  const barW = 18;
  // Holding force
  const xh = x0 + 30;
  const hh = fpx(F);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(xh - barW / 2, base - Math.max(0, hh - 10), barW, Math.max(0, hh - 10));
  drawArrowHead(ctx, xh, base - hh, 0, -1, Math.min(16, hh));
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('holding', xh, base - hh - 18);
  ctx.font = FONT;
  ctx.fillText(fmtN(F), xh, base - hh - 4);

  // Required force: parts stacked, then the safety margin
  const xr = x0 + 104;
  let y = base;
  const labels = [];
  live.parts.forEach((part, i) => {
    const len = fpx(part.N);
    ctx.globalAlpha = i === 0 ? 0.95 : 0.55;
    ctx.fillStyle = colors.ref;
    ctx.fillRect(xr - barW / 2, y - len, barW, len);
    ctx.globalAlpha = 1;
    labels.push({ y: y - len / 2, len, text: `${PART_LABEL[part.key]} ${fmtN(part.N)}` });
    y -= len;
  });
  const margin = fpx(live.required - live.demand);
  ctx.strokeStyle = colors.ref;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(xr - barW / 2, y - margin, barW, margin);
  ctx.setLineDash([]);
  const factorWord = state.convention === 'smc' ? `t = ${live.factor}` : `S = ${sigT(live.factor, 2)}`;
  labels.push({ y: y - margin / 2, len: margin, text: `safety (${factorWord}) +${fmtN(live.required - live.demand)}` });
  const tip = base - fpx(live.required);
  ctx.fillStyle = colors.ref;
  drawArrowHead(ctx, xr, tip - 2, 0, -1, 12);
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('required', xr, tip - 32);
  ctx.font = FONT;
  ctx.fillText(fmtN(live.required), xr, tip - 18);
  if (state.animate && design.required > live.required + 1e-9) {
    const dt = base - fpx(design.required);
    ctx.strokeStyle = colors.ref;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xr - barW, dt);
    ctx.lineTo(xr + barW, dt);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`at full acceleration: ${fmtN(design.required)}`, xr + barW + 6, dt);
  }
  if (state.loadCase === 'II') {
    // The sideways inertia right now (static text, so the number never moves with the product)
    const aNow = state.animate ? Math.abs(now.a) : state.a;
    ctx.font = FONT;
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`sideways inertia m·a${state.animate ? ' now' : ''}: ${fmtN(state.m * aNow)}`, x0, top + 58);
    ctx.fillStyle = colors.muted;
    ctx.fillText(state.convention === 'smc'
      ? 'SMC’s formula has no term for it (t covers it)'
      : `friction needs m·a/μ = ${fmtN((state.m * aNow) / state.mu)} more holding`, x0, top + 74);
  }

  // Part labels to the right of the required arrow, spaced so they never overlap
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lastY = Infinity;
  for (const lab of labels) {
    if (lab.len < 1) continue;
    const ly = Math.min(lab.y, lastY - 15);
    if (ly < top + 60) break;
    ctx.fillStyle = colors.fg;
    ctx.fillText(lab.text, xr + barW / 2 + 8, ly);
    lastY = ly;
  }
}

/** Bars along the bottom: holding vs required (with safety factor) and the verdict. */
function drawBars(ctx, w, h, colors, F, live, design) {
  const top = h - BARS_H;
  const ok = F >= design.required;
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(12, top - 8);
  ctx.lineTo(w - 12, top - 8);
  ctx.stroke();

  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Holding force vs required force (${convText()})`, 12, top + 2);

  const verdict = `${ok ? 'OK' : 'NOT ENOUGH'}: ${ratioText(F, design.required)} the required force`;
  const tagW = drawTag(ctx, verdict, w - 12, top + 10, {
    align: 'right', color: ok ? colors.ok : colors.warn, background: ok ? colors.okBg : colors.warnBg, height: 26,
  });

  const labelW = 150;
  const x0 = 12 + labelW;
  const x1 = w - 120;
  const maxF = Math.max(F, design.required) * 1.04;
  const X = (N) => x0 + (N / maxF) * (x1 - x0);
  const rows = [
    { label: 'Holding Δp·A·n', N: F, color: colors.accent },
    { label: state.animate && state.convention === 'schmalz' ? 'Required (live)' : 'Required', N: live.required, color: colors.ref },
  ];
  rows.forEach((row, i) => {
    const y = top + 32 + i * 40;
    ctx.font = FONT;
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(row.label, 12, y + 12);
    ctx.fillStyle = colors.track;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x0, y, x1 - x0, 24);
    ctx.globalAlpha = 1;
    ctx.fillStyle = row.color;
    ctx.fillRect(x0, y, Math.max(1, X(row.N) - x0), 24);
    ctx.fillStyle = colors.fg;
    ctx.font = FONT_BOLD;
    ctx.fillText(fmtN(row.N), Math.min(X(row.N), x1) + 8, y + 12);
  });
  // The design requirement (full acceleration) as a dashed line across both bars
  const xd = X(design.required);
  ctx.strokeStyle = colors.fg;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xd, top + 26);
  ctx.lineTo(xd, top + 32 + 40 + 28);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = xd > x1 - 200 ? 'right' : 'left';
  ctx.textBaseline = 'top';
  const full = state.animate && state.convention === 'schmalz';
  ctx.fillText(full ? 'required at full acceleration' : 'required', xd + (xd > x1 - 200 ? -6 : 6), top + 32 + 40 + 28);
  return tagW;
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

// Friction and safety-factor menus from the cited data
for (const f of FRICTION) $('surface-select').add(new Option(f.label, f.id));
$('surface-select').add(new Option('Custom (slider)', 'custom'));
for (const s of CONVENTIONS.schmalz.safetyFactors) $('s-select').add(new Option(s.label, String(s.S)));

const sim = createSim({
  step,
  draw,
  describe,
  startPaused: true, // static until the horizontal acceleration is switched on
  onResize: () => { move = trapezoid(demoStroke(), MOVE_SPEED_CAP, Math.max(state.a, 1e-6)); },
  onScaleChange: () => { updateEquations(); sim.updateAria(); },
  debug: { state, V, getMove: () => move, holding, design, renderAt: (t) => { state.t = t; sim.requestDraw(); } },
});

$('surface-select').addEventListener('change', (e) => {
  state.surface = e.target.value;
  const f = FRICTION.find((x) => x.id === state.surface);
  if (f) state.mu = f.mu;
  paramsChanged();
});
$('s-select').addEventListener('change', (e) => setValue('S', Number(e.target.value)));
for (const radio of document.querySelectorAll('input[name="loadcase"]')) radio.addEventListener('change', () => setLoadCase(radio.value));
for (const radio of document.querySelectorAll('input[name="convention"]')) radio.addEventListener('change', () => setValue('convention', radio.value));
$('accel-check').addEventListener('change', (e) => setAnimate(e.target.checked));
for (const btn of document.querySelectorAll('[data-size]')) {
  btn.addEventListener('click', () => setValue('d', Number(btn.dataset.size) / 1000));
}

const preset = (values) => () => {
  Object.assign(state, DEFAULTS, { convention: state.convention }, values); // keep the chosen convention
  if (state.loadCase !== 'II' && state.animate) setAnimate(false);
  else paramsChanged();
};
const ex = SCHMALZ_EXAMPLE;
initPresets({
  part: preset({ d: 0.02, n: 1, m: 0.2, a: 10, L: 0.06, H: 0.03 }),
  box: preset({ d: 0.05, n: 2, m: 5, a: 10, loadCase: 'II', L: 0.3, H: 0.2 }),
  // 500 × 400 × 4 mm pane held on its face, cups vertical; mass from Schmalz's glass density 2.50 kg/dm³
  glass: preset({ d: 0.08, n: 2, m: roundSig(0.5 * 0.4 * 0.004 * DENSITY_KG_M3.glass, 3), a: 5, loadCase: 'III', L: 0.004, H: 0.4 }),
  sheet: preset({ d: SUF90.diameterMm / 1000, n: 6, p: -60, m: ex.massKg, a: ex.a, mu: ex.mu, loadCase: 'II', S: ex.caseII.S, L: ex.lengthM, H: ex.thicknessM }),
});

/** Numbers in the explainer, computed from the model and the cited data (see the tests). */
function fillExplainer() {
  const gS = CONVENTIONS.schmalz.gWritten;
  const sheet = { m: ex.massKg, a: ex.a, mu: ex.mu, g: gS };
  const schII = V.requirement({ convention: 'schmalz', loadCase: 'II', S: ex.caseII.S, ...sheet }).required;
  const smcII = V.requirement({ convention: 'smc', loadCase: 'II', S: ex.caseII.S, ...sheet }).required;
  const nominal = V.holdingForce(SUF90.vacuumKPa, SUF90.diameterMm / 1000);
  // Sideways acceleration above which Schmalz (μ 0.5, S 1.5) asks for more than SMC's 4·m·g
  const cross = 0.5 * ((V.smcFactor('II') * G0) / 1.5 - G0);
  const values = {
    pct60: fmt(V.vacuumPercent(-60), 0),
    suf: fmt(SUF90.suctionForceN, 0),
    sufNom: fmt(nominal, 0),
    sufEff: fmt(V.diameterForForce(SUF90.suctionForceN, SUF90.vacuumKPa) * 1000, 0),
    schII: fmt(schII, 0),
    perCup: fmt(schII / 6, 0),
    dSch: fmt(V.diameterForForce(schII / 6, -60) * 1000, 0),
    smcII: fmt(smcII, 0),
    smcPerCup: fmt(smcII / 6, 0),
    dSmc: fmt(V.diameterForForce(smcII / 6, -60) * 1000, 0),
    cross: fmt(cross, 1),
  };
  for (const el of document.querySelectorAll('[data-calc]')) {
    if (values[el.dataset.calc] !== undefined) el.textContent = values[el.dataset.calc];
  }
}

fillExplainer();
paramsChanged();
sim.start();
