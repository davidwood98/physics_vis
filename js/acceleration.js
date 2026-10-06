/**
 * acceleration.js: constant acceleration at 1:1 scale.
 *
 * Track view: a dot speeds up (or brakes) along a track the width of the
 * screen. Free-fall view: two apples dropped together, 1 g vs another g.
 *
 * Each run is a pure function of run time t (x = ut + ½at²), so it is exact
 * and frame-rate independent. Changing a setting restarts the run.
 */

import {
  clamp,
  G0,
  niceStep,
  msToKmh,
  msToMph,
  mphToMs,
  constAccelState,
  stoppingDistance,
  stoppingTime,
  speedAfterDistance,
  timeToCoverDistance,
  freeFallTime,
  freeFallSpeed,
} from './physics.js';
import { fmt, fmtAuto } from './common.js';
import { createSim, bindParam, initTabs, initPresets, setText } from './simkit.js';
import { drawDot, drawArrow, drawRuler, drawTag, lengthLabel, FONT_BOLD } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = { uMin: 0, uMax: 50, uStep: 0.1, aMin: 0.1, aMax: 30, aStep: 0.1 };
const MARGIN_PX = 28;            // track starts/ends this far from the canvas edges
const DOT_RADIUS_PX = 7;
const SPEED_ARROW_MAX_PX = 90;   // speed arrow length at the run's top speed (not to scale)
const APPLE_R_PX = 13;           // apple icon radius (not to scale)
const MPH_60 = mphToMs(60);

const COMPARE = {
  moon: { name: 'Moon', g: 1.62 },
  mars: { name: 'Mars', g: 3.71 },
  jupiter: { name: 'Jupiter', g: 24.79 },
  track: { name: 'Your track acceleration', g: null }, // uses state.a
};

const state = {
  view: 'track',
  mode: 'accelerate', // 'accelerate' | 'brake'
  u: 0,               // starting speed, m/s
  a: 4.47,            // acceleration magnitude, m/s²
  t: 0,               // track run time, s
  trackDone: false,
  compare: 'moon',
  tFall: 0,           // free-fall run time, s
  fallDone: false,
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));

/* =========================================================================
 * 2. Derived quantities (all from the current settings + canvas size)
 * ====================================================================== */

const signedA = () => (state.mode === 'accelerate' ? state.a : -state.a);
const trackLength = () => Math.max(0, (sim.width - 2 * MARGIN_PX) / sim.k);

/** When the track run ends: reaching the end (speeding up) or stopping (braking, even off-screen). */
function trackEndTime() {
  if (state.mode === 'accelerate') return timeToCoverDistance(state.u, state.a, trackLength());
  return stoppingTime(state.u, state.a);
}

/** Time the dot is visible on the track (for spacing the time marks). */
function visibleRunTime() {
  if (state.mode === 'accelerate') return trackEndTime();
  return Math.min(stoppingTime(state.u, state.a), timeToCoverDistance(state.u, -state.a, trackLength()));
}

const markInterval = (T) => (T > 0 && Number.isFinite(T) ? niceStep(T / 12) : 0);

// Free fall geometry: apple centres travel from FALL_TOP to the floor.
const FALL_TOP_PX = 40;
const FALL_BOTTOM_PX = 56;
const fallHeight = () => Math.max(0, (sim.height - FALL_TOP_PX - FALL_BOTTOM_PX) / sim.k);
const compareG = () => COMPARE[state.compare].g ?? state.a;
const compareName = () =>
  state.compare === 'track' ? `Your ${fmtAuto(state.a)} m/s²` : COMPARE[state.compare].name;
const fallEndTime = () => Math.max(freeFallTime(fallHeight(), G0), freeFallTime(fallHeight(), compareG()));

/* =========================================================================
 * 3. State setters + UI sync
 * ====================================================================== */

function resetTrack() {
  state.t = 0;
  state.trackDone = state.mode === 'brake' && state.u <= 0; // nothing to brake from
  updateAll();
}

function resetFall() {
  state.tFall = 0;
  state.fallDone = false;
  updateAll();
}

function resetCurrent() {
  if (state.view === 'track') resetTrack();
  else resetFall();
}

function setMode(mode) {
  state.mode = mode;
  $(`mode-${mode}`).checked = true;
  if (mode === 'brake' && state.u < 0.1) state.u = 13.4; // something to brake from: 30 mph
  params.forEach((p) => p.sync());
  resetTrack();
}

const params = [
  bindParam({ range: $('u-range'), num: $('u-num'), min: LIMITS.uMin, max: LIMITS.uMax, step: LIMITS.uStep,
    get: () => state.u, set: (v) => { state.u = clamp(v, LIMITS.uMin, LIMITS.uMax); resetTrack(); },
    decimals: 1, words: 'metres per second' }),
  bindParam({ range: $('a-range'), num: $('a-num'), min: LIMITS.aMin, max: LIMITS.aMax, step: LIMITS.aStep,
    get: () => state.a, set: (v) => { state.a = clamp(v, LIMITS.aMin, LIMITS.aMax); resetTrack(); if (state.compare === 'track') resetFall(); },
    decimals: 2, words: 'metres per second squared' }),
];

function updateAll() {
  params.forEach((p) => p.sync());
  setText($('u-alt'), `= ${fmtAuto(msToMph(state.u))} mph`);
  setText($('a-alt'), `= ${fmt(state.a / G0, 2)} g`);
  updateReadouts();
  updateEquations();
  updateResult();
  sim.refreshPlayButton();
  sim.updateAria();
  sim.requestDraw();
}

function trackState() {
  return constAccelState(state.u, signedA(), state.t);
}

function updateReadouts() {
  const L = trackLength();
  const { x, v } = trackState();
  setText(outputs.t, fmt(state.t, 3));
  setText(outputs.x, x < 1 ? `${fmt(x * 100, 1)} cm` : `${fmt(x, 2)} m`);
  setText(outputs.v, fmt(v, 2));
  setText(outputs.vkmh, fmtAuto(msToKmh(v)));
  setText(outputs.vmph, fmtAuto(msToMph(v)));

  if (state.mode === 'accelerate') {
    const vEnd = speedAfterDistance(state.u, state.a, L);
    setText(outputs['predict-label'], `At the end of the ${lengthLabel(L)} track`);
    setText(outputs.predict, `${fmt(vEnd, 2)} m/s (${fmtAuto(msToMph(vEnd))} mph)`);
    setText(outputs['predict-sub'], `after ${fmt(trackEndTime(), 3)} s`);
  } else {
    const d = stoppingDistance(state.u, state.a);
    const over = d - L;
    setText(outputs['predict-label'], 'Stopping distance');
    setText(outputs.predict, state.u > 0 ? `${lengthLabel(d)} in ${fmt(stoppingTime(state.u, state.a), 2)} s` : '–');
    setText(
      outputs['predict-sub'],
      state.u <= 0 ? 'Set a starting speed to brake from'
        : over > 0 ? `overshoots the ${lengthLabel(L)} track by ${lengthLabel(over)}`
        : `stops ${lengthLabel(-over)} before the end of the track`,
    );
  }

  const H = fallHeight();
  setText(outputs.H, `${lengthLabel(H)} (true scale)`);
  setText(outputs.tE, fmt(freeFallTime(H, G0), 3));
  setText(outputs.vE, fmt(freeFallSpeed(H, G0), 2));
  setText(outputs['cmp-name'], `${compareName()} (${fmt(compareG() / G0, 2)} g)`);
  setText(outputs.tC, fmt(freeFallTime(H, compareG()), 3));
  setText(outputs.vC, fmt(freeFallSpeed(H, compareG()), 2));
}

function updateEquations() {
  const a = signedA();
  const { x, v } = trackState();
  const t = fmt(state.t, 3);
  const us = fmt(state.u, 2);
  const as = fmt(a, 2);
  setText(equations.v, `${us} + (${as}) × ${t} = ${fmt(v, 2)} m/s`);
  setText(equations.x, `${us} × ${t} + ½ × (${as}) × ${t}² = ${fmt(x, 3)} m`);
  setText(equations.v2, `√(${us}² + 2 × (${as}) × ${fmt(x, 3)}) = ${fmt(v, 2)} m/s`);
  setText(equations.d, `${us}² / (2 × ${fmt(state.a, 2)}) = ${fmt(stoppingDistance(state.u, state.a), 2)} m`);
  setText(equations.g, `${fmt(state.a, 2)} / 9.81 = ${fmt(state.a / G0, 2)} g`);
  const H = fallHeight();
  const gC = compareG();
  setText(equations.tf, `√(2 × ${fmt(H, 3)} / 9.81) = ${fmt(freeFallTime(H, G0), 3)} s on Earth`);
  setText(equations.vf, `√(2 × 9.81 × ${fmt(H, 3)}) = ${fmt(freeFallSpeed(H, G0), 2)} m/s on Earth`);
  setText(equations.ratio, `√(9.81 / ${fmt(gC, 2)}) = ${fmt(Math.sqrt(G0 / gC), 2)}× as long for ${compareName()}`);
}

/** Result sentence, shown when a run finishes (announced politely). */
function updateResult() {
  const el = $('result');
  let text = '';
  let warn = false;
  if (state.view === 'track' && state.trackDone) {
    const L = trackLength();
    if (state.mode === 'accelerate') {
      const vEnd = speedAfterDistance(state.u, state.a, L);
      text = `Reached the end of the ${lengthLabel(L)} track after ${fmt(trackEndTime(), 3)} s, at ${fmt(vEnd, 2)} m/s (${fmtAuto(msToMph(vEnd))} mph).`;
      if (state.u < MPH_60) text += ` At this rate, 60 mph would take ${fmt((MPH_60 - state.u) / state.a, 2)} s.`;
    } else if (state.u <= 0) {
      text = 'Set a starting speed to brake from.';
    } else {
      const d = stoppingDistance(state.u, state.a);
      if (d > L) {
        warn = true;
        text = `Overshoot: the dot ran off the end of the track and stopped ${lengthLabel(d - L)} beyond it (stopping distance ${lengthLabel(d)}, ${fmt(stoppingTime(state.u, state.a), 2)} s).`;
      } else {
        text = `Stopped after ${lengthLabel(d)} in ${fmt(stoppingTime(state.u, state.a), 3)} s, ${lengthLabel(L - d)} before the end of the track.`;
      }
    }
  } else if (state.view === 'fall' && state.fallDone) {
    const H = fallHeight();
    const tE = freeFallTime(H, G0);
    const tC = freeFallTime(H, compareG());
    text = `From ${lengthLabel(H)}: Earth ${fmt(tE, 3)} s, ${compareName()} ${fmt(tC, 3)} s (${fmt(tC / tE, 2)}× as long).`;
  }
  setText(el, text);
  el.classList.toggle('result--warn', warn);
}

function describe() {
  const scaleWord = sim.scale.calibrated ? 'calibrated 1:1' : 'approximate';
  const timeWord = sim.timeScale === 1 ? 'real time' : `slow motion at ${sim.timeScale} times`;
  if (state.view === 'track') {
    const verb = state.mode === 'accelerate' ? 'speeding up' : 'braking';
    return `Track view at ${scaleWord} scale, ${timeWord}: a dot ${verb} at ${fmt(state.a, 2)} metres per second squared from ${fmt(state.u, 1)} metres per second along a ${lengthLabel(trackLength())} track. ${$('result').textContent}`;
  }
  return `Free fall view at ${scaleWord} scale, ${timeWord}: two apples dropped ${lengthLabel(fallHeight())}, one at 1 g and one at ${fmt(compareG() / G0, 2)} g (${compareName()}). ${$('result').textContent}`;
}

/* =========================================================================
 * 4. Step
 * ====================================================================== */

function step(simDt) {
  if (state.view === 'track') {
    if (state.trackDone) return;
    const tEnd = trackEndTime();
    state.t = Math.min(state.t + simDt, tEnd);
    if (state.t >= tEnd) finish(() => (state.trackDone = true));
  } else {
    if (state.fallDone) return;
    const tEnd = fallEndTime();
    state.tFall = Math.min(state.tFall + simDt, tEnd);
    if (state.tFall >= tEnd) finish(() => (state.fallDone = true));
  }
  updateReadouts();
  updateEquations();
}

function finish(markDone) {
  markDone();
  sim.setPaused(true);
  updateResult();
  sim.updateAria();
}

const isDone = () => (state.view === 'track' ? state.trackDone : state.fallDone);

/* =========================================================================
 * 5. Drawing
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  if (state.view === 'track') drawTrack(ctx, w, h, k, colors);
  else drawFall(ctx, w, h, k, colors);
}

function drawTrack(ctx, w, h, k, colors) {
  const L = trackLength();
  const x0 = MARGIN_PX;
  const xEnd = x0 + L * k;
  const y = h * 0.55;
  const a = signedA();

  // Track, start line, end line
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(xEnd, y);
  ctx.stroke();
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y - 18);
  ctx.lineTo(x0, y + 4);
  ctx.moveTo(xEnd, y - 18);
  ctx.lineTo(xEnd, y + 4);
  ctx.stroke();
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText('Start', x0 + 4, y - 20);
  ctx.textAlign = 'right';
  ctx.fillText('End of track', xEnd - 4, y - 20);
  drawRuler(ctx, colors, { x: x0, y, lengthM: L, k });

  // Equal-time marks behind the dot
  const dtMark = markInterval(visibleRunTime());
  if (dtMark > 0) {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    for (let i = 1; i * dtMark <= state.t + 1e-9; i++) {
      const xm = constAccelState(state.u, a, i * dtMark).x;
      if (xm > L) break;
      ctx.beginPath();
      ctx.arc(x0 + xm * k, y, DOT_RADIUS_PX - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Marks every ${fmtAuto(dtMark)} s of sim time`, 12, 12);
  }

  // Dot, or an off-screen indicator once it has run past the end
  const { x, v } = trackState();
  const vMax = Math.max(state.u, state.mode === 'accelerate' ? speedAfterDistance(state.u, state.a, L) : 0, 0.01);
  const px = x0 + x * k;
  if (x <= L + DOT_RADIUS_PX / k) {
    drawDot(ctx, px, y, DOT_RADIUS_PX, colors.accent);
    if (v > 0) {
      const len = (v / vMax) * SPEED_ARROW_MAX_PX;
      drawArrow(ctx, px, y - 34, px + len, y - 34, colors.fg);
      ctx.fillStyle = colors.fg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`v = ${fmt(v, 2)} m/s`, Math.min(px, w - 110), y - 44);
    }
  } else {
    const beyond = x - L;
    const label = v > 0 ? `→ ${lengthLabel(beyond)} past the end, ${fmt(v, 1)} m/s` : `Stopped ${lengthLabel(beyond)} past the end →`;
    drawTag(ctx, label, w - 10, y - 36, { align: 'right', color: colors.warn, background: colors.warnBg });
  }

  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const verb = state.mode === 'accelerate' ? 'Speeding up' : 'Braking';
  ctx.fillText(`${verb} at ${fmt(state.a, 2)} m/s² (${fmt(state.a / G0, 2)} g) from ${fmt(state.u, 1)} m/s`, 12, h - 12);
}

/** Apple icon: red body, stem, leaf. (x, y) = centre. */
function drawApple(ctx, x, y, r, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#d62839';
  ctx.beginPath();
  ctx.arc(x - r * 0.38, y + r * 0.08, r * 0.72, 0, Math.PI * 2);
  ctx.arc(x + r * 0.38, y + r * 0.08, r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#6b3f1d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.5);
  ctx.quadraticCurveTo(x + r * 0.1, y - r * 0.9, x + r * 0.25, y - r * 1.05);
  ctx.stroke();
  ctx.fillStyle = '#2f9e44';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.45, y - r * 0.8, r * 0.36, r * 0.16, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFall(ctx, w, h, k, colors) {
  const H = fallHeight();
  const yTop = FALL_TOP_PX;
  const yFloor = yTop + H * k;
  const columns = [
    { x: w * 0.4, g: G0, label: 'Earth · 1 g' },
    { x: w * 0.68, g: compareG(), label: `${compareName()} · ${fmt(compareG() / G0, 2)} g` },
  ];

  // Floor + true-scale ruler on the left measuring the drop
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, yFloor + APPLE_R_PX);
  ctx.lineTo(w, yFloor + APPLE_R_PX);
  ctx.stroke();
  drawRuler(ctx, colors, { x: 14, y: yTop, lengthM: H, k, vertical: true });

  const dtMark = markInterval(freeFallTime(H, G0) * 1.2);
  for (const col of columns) {
    const tLand = freeFallTime(H, col.g);
    const t = Math.min(state.tFall, tLand);
    // Ghost apples at equal time steps
    if (dtMark > 0) {
      for (let i = 1; i * dtMark < t; i++) {
        drawApple(ctx, col.x, yTop + 0.5 * col.g * (i * dtMark) ** 2 * k, APPLE_R_PX, 0.18);
      }
    }
    drawApple(ctx, col.x, yTop + 0.5 * col.g * t * t * k, APPLE_R_PX);
    ctx.font = FONT_BOLD;
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(col.label, col.x, yFloor + APPLE_R_PX + 8);
    if (state.tFall >= tLand) {
      ctx.fillStyle = colors.muted;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(`landed: ${fmt(tLand, 3)} s, ${fmt(freeFallSpeed(H, col.g), 2)} m/s`, col.x, yFloor + APPLE_R_PX + 24);
    }
  }

  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(`t = ${fmt(state.tFall, 3)} s`, w - 12, 44);
  if (dtMark > 0) ctx.fillText(`Ghosts every ${fmtAuto(dtMark)} s`, w - 12, 60);
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  startPaused: true,
  beforePlay: () => { if (isDone()) resetCurrent(); },
  playLabel: () => (isDone() ? 'Replay' : 'Play'),
  onResize: () => { resetTrack(); resetFall(); },
  onScaleChange: () => { resetTrack(); resetFall(); },
  debug: { state, trackLength, fallHeight },
});

initTabs({
  name: 'view',
  values: ['track', 'fall'],
  tallViews: ['fall'], // full screen height = longest possible drop
  onChange: (view) => {
    state.view = view;
    updateAll();
  },
});

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => setMode(radio.value));
}
$('compare-select').addEventListener('change', (e) => {
  state.compare = e.target.value;
  resetFall();
});
$('reset-btn').addEventListener('click', resetCurrent);
$('skip-btn').addEventListener('click', () => {
  if (isDone()) return;
  step(Infinity); // runs are pure functions of time, so jumping to the end is exact
  sim.requestDraw();
});

initPresets({
  car060: () => { state.u = 0; state.a = Number((MPH_60 / 6).toFixed(2)); setMode('accelerate'); },
  oneg: () => { state.u = 0; state.a = 9.81; setMode('accelerate'); },
  // Highway Code: 14 m braking distance from 30 mph → a = u² / 2d ≈ 6.4 m/s²
  brake30: () => { state.u = Number(mphToMs(30).toFixed(1)); state.a = 6.4; setMode('brake'); },
  rolling: () => { state.u = 0.5; state.a = 1; setMode('brake'); },
});

updateAll();
sim.start();
