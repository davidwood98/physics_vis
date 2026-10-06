/**
 * pendulum.js: a real-length pendulum at 1:1 scale.
 *
 * Solves the full (nonlinear, optionally damped) pendulum equation
 *   θ" = −(g/L)·sin θ − (b/m)·θ'
 * with fixed 0.5 ms RK4 steps. The number of steps is derived from total
 * elapsed time, so any frame rate takes exactly the same steps.
 */

import {
  TAU,
  G0,
  clamp,
  degToRad,
  radToDeg,
  pendulumStep,
  pendulumPeriod,
  pendulumSmallAnglePeriod,
  pendulumLengthForPeriod,
  pendulumMaxSpeed,
  steelBallRadius,
} from './physics.js';
import { fmt, fmtAuto } from './common.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawRuler, drawTag, lengthLabel } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  Lmin: 0.05, Lmax: 0.4, Lstep: 0.005,   // m
  thMin: 1, thMax: 80, thStep: 1,        // degrees
  mMin: 0.01, mMax: 1, mStep: 0.01,      // kg
};
const DAMPING_B = { off: 0, light: 0.002, strong: 0.02 }; // linear air drag b, kg/s
const H_STEP = 1 / 2000;                 // integration step, s
const TOP_PX = 60;           // pivot sits this far below the top of the view (room for labels)
const BOTTOM_SPACE_PX = 56;  // room under the bob for the pass marker and the clock
const FLASH_MS = 160;

const state = {
  L: 0.25,           // length pivot → bob centre, m
  theta0Deg: 15,     // release angle
  m: 0.1,            // bob mass, kg
  damping: 'off',
  viewMode: 'true',  // 'true' (1:1) | 'fit'
  theta: 0,          // angle, rad (0 = hanging straight down, + = to the right)
  omega: 0,          // angular velocity, rad/s
  t: 0,              // simulated time since release, s (= steps × H_STEP)
  elapsed: 0,        // sim time requested since release (may run ahead of t by < H_STEP)
  steps: 0,          // RK4 steps taken since release
  lastUpCross: null, // time of last upward zero crossing (for the measured period)
  measuredT: null,
  passes: 0,         // passes through the middle
  flashAt: -Infinity,
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

const theta0 = () => degToRad(state.theta0Deg);
const gamma = () => DAMPING_B[state.damping] / state.m;

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

/** Put the bob back at the release angle, at rest. */
function release() {
  Object.assign(state, {
    theta: theta0(), omega: 0, t: 0, elapsed: 0, steps: 0,
    lastUpCross: null, measuredT: null, passes: 0, flashAt: -Infinity,
  });
  updateAll();
}

const params = [
  bindParam({ range: $('L-range'), num: $('L-num'), min: LIMITS.Lmin, max: LIMITS.Lmax, step: LIMITS.Lstep,
    scale: 100, decimals: 1, words: 'centimetres',
    get: () => state.L, set: (v) => { state.L = clamp(v, LIMITS.Lmin, LIMITS.Lmax); release(); } }),
  bindParam({ range: $('th-range'), num: $('th-num'), min: LIMITS.thMin, max: LIMITS.thMax, step: LIMITS.thStep,
    decimals: 0, words: 'degrees',
    get: () => state.theta0Deg, set: (v) => { state.theta0Deg = clamp(v, LIMITS.thMin, LIMITS.thMax); release(); } }),
  bindParam({ range: $('m-range'), num: $('m-num'), min: LIMITS.mMin, max: LIMITS.mMax, step: LIMITS.mStep,
    scale: 1000, decimals: 0, words: 'grams',
    get: () => state.m, set: (v) => { state.m = clamp(v, LIMITS.mMin, LIMITS.mMax); updateAll(); } }),
];

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

function updateAll() {
  params.forEach((p) => p.sync());
  fitCanvasHeight();
  setText($('m-alt'), `steel ball Ø ${lengthLabel(2 * steelBallRadius(state.m))}`);
  updateReadouts();
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  announce(`Length ${fmt(state.L * 100, 1)} centimetres, period ${fmt(pendulumPeriod(state.L, G0, theta0()), 3)} seconds.`);
}

function updateReadouts() {
  const T0 = pendulumSmallAnglePeriod(state.L, G0);
  const T = pendulumPeriod(state.L, G0, theta0());
  setText(outputs.T0, fmt(T0, 3));
  setText(outputs.T, fmt(T, 3));
  setText(outputs.Tpct, `${fmt((T / T0 - 1) * 100, 2)}% longer than T₀`);
  setText(outputs.Tm, state.measuredT ? fmt(state.measuredT, 3) : '…');
  setText(outputs.f, fmt(1 / T, 3));
  setText(outputs.bpm, fmt(120 / T, 1)); // two swings (one each way) per period
  setText(outputs.vmax, fmt(pendulumMaxSpeed(state.L, G0, theta0()), 2));
  setText(outputs.angle, fmt(radToDeg(state.theta), 1));
  setText(outputs.swings, String(state.passes));
  const b = DAMPING_B[state.damping];
  setText(
    outputs.halflife,
    b === 0 ? 'Off: swings forever' : `Swing size halves every ${fmtAuto((2 * Math.LN2 * state.m) / b)} s (heavier bob = slower decay)`,
  );
}

function updateEquations() {
  const T0 = pendulumSmallAnglePeriod(state.L, G0);
  const T = pendulumPeriod(state.L, G0, theta0());
  setText(equations.T0, `2π √(${fmt(state.L, 3)} / 9.81) = ${fmt(T0, 3)} s`);
  setText(equations.T, `exact at ${state.theta0Deg}°: ${fmt(T, 3)} s (simple estimate ${fmt(T0 * (1 + theta0() ** 2 / 16), 3)} s)`);
  setText(equations.Lfor, `for T = 1 s: L = ${lengthLabel(pendulumLengthForPeriod(1, G0))}; for 2 s: ${lengthLabel(pendulumLengthForPeriod(2, G0))}`);
  setText(equations.v, `√(2 × 9.81 × ${fmt(state.L, 3)} × (1 − cos ${state.theta0Deg}°)) = ${fmt(pendulumMaxSpeed(state.L, G0, theta0()), 2)} m/s`);
}

function describe() {
  const scaleWord = state.viewMode === 'fit' ? 'scaled to fit' : sim.scale.calibrated ? 'calibrated 1:1' : 'approximate 1:1';
  return `Pendulum, ${scaleWord} view: length ${fmt(state.L * 100, 1)} centimetres, released from ${state.theta0Deg} degrees, period ${fmt(pendulumPeriod(state.L, G0, theta0()), 3)} seconds${sim.paused ? ', paused' : ''}.`;
}

/* =========================================================================
 * 4. Step: fixed RK4 sub-steps
 * ====================================================================== */

function step(simDt) {
  state.elapsed += simDt;
  const target = Math.floor(state.elapsed / H_STEP + 1e-6); // tolerant of float noise in the sum
  const g = gamma();
  while (state.steps < target) {
    state.steps++;
    const prev = state.theta;
    ({ theta: state.theta, omega: state.omega } = pendulumStep(state.theta, state.omega, H_STEP, state.L, G0, g));
    state.t = state.steps * H_STEP;
    if ((prev < 0) !== (state.theta < 0)) {
      // Crossed the middle: interpolate the crossing time within the step
      const tc = state.t - H_STEP * (state.theta / (state.theta - prev));
      state.passes++;
      state.flashAt = performance.now();
      if (prev < 0) {
        if (state.lastUpCross !== null) state.measuredT = tc - state.lastUpCross;
        state.lastUpCross = tc;
      }
    }
  }
  updateReadouts();
}

/* =========================================================================
 * 5. Drawing
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  const bobR = steelBallRadius(state.m); // m
  const th0 = theta0();

  // Pixels per metre for this view: true 1:1 (the canvas grows to fit, see
  // fitCanvasHeight), or scaled down so it all fits the screen.
  let s = k;
  if (state.viewMode === 'fit') {
    const fitV = (h - TOP_PX - BOTTOM_SPACE_PX) / (state.L + bobR);
    const fitH = (w / 2 - 40) / (state.L * Math.sin(Math.min(th0, Math.PI / 2)) + bobR);
    s = Math.min(k, fitV, fitH);
  }
  const bobPx = Math.max(3, bobR * s);
  const px = w / 2;
  const py = TOP_PX;               // pivot, near the top
  const yLow = py + state.L * s;   // bob centre at the bottom of the swing

  // True-scale ruler down the left, measured from the pivot
  drawRuler(ctx, colors, { x: 14, y: py, lengthM: state.L + bobR, k: s, vertical: true });

  // Rest line and swing arc
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px, yLow + bobPx + 8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, state.L * s, Math.PI / 2 - th0, Math.PI / 2 + th0);
  ctx.stroke();

  // Flash marker at the middle of the swing
  const flash = Math.max(0, 1 - (performance.now() - state.flashAt) / FLASH_MS);
  ctx.fillStyle = flash > 0 ? colors.accent : colors.track;
  ctx.globalAlpha = 0.35 + 0.65 * flash;
  ctx.beginPath();
  ctx.arc(px, yLow + bobPx + 14, 5, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (flash > 0) sim.requestDraw(); // keep fading even when paused

  // String + bob (canvas y is down, so +θ swings to the right)
  const bx = px + state.L * s * Math.sin(state.theta);
  const by = py + state.L * s * Math.cos(state.theta);
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  ctx.fillRect(px - 14, py - 4, 28, 4);
  const grad = ctx.createRadialGradient(bx - bobPx * 0.35, by - bobPx * 0.35, bobPx * 0.1, bx, by, bobPx);
  grad.addColorStop(0, '#e5e7eb');
  grad.addColorStop(1, '#4b5563');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(bx, by, bobPx, 0, TAU);
  ctx.fill();

  // Labels
  const scaleTag = s < k
    ? { text: `SCALED TO FIT 1 : ${fmtAuto(k / s)}, not true scale`, color: colors.warn, background: colors.warnBg }
    : { text: 'TRUE SCALE 1:1', color: colors.ok, background: colors.okBg };
  drawTag(ctx, scaleTag.text, 12, 22, scaleTag);
  if (bx + bobPx < 0 || bx - bobPx > w) {
    drawTag(ctx, bx < 0 ? '← bob off-screen' : 'bob off-screen →', bx < 0 ? 12 : w - 12, yLow, {
      align: bx < 0 ? 'left' : 'right', color: colors.warn, background: colors.warnBg,
    });
  }
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`t = ${fmt(state.t, 2)} s`, w - 12, h - 10);
}

/**
 * In true-scale view the canvas grows to fit the whole pendulum, pivot to bob,
 * so a long pendulum simply extends down the page (scroll to follow it).
 * In fit view the canvas keeps its normal screen-height size.
 */
function fitCanvasHeight() {
  const wrap = $('sim-canvas').parentElement;
  if (state.viewMode !== 'true') {
    wrap.style.minHeight = '';
    return;
  }
  const bobPx = Math.max(3, steelBallRadius(state.m) * sim.k);
  wrap.style.minHeight = `${Math.ceil(TOP_PX + state.L * sim.k + bobPx + BOTTOM_SPACE_PX)}px`;
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  onScaleChange: fitCanvasHeight,
  debug: { state, release },
});

$('release-btn').addEventListener('click', release);
$('damping-select').addEventListener('change', (e) => {
  state.damping = e.target.value;
  updateAll();
});
$('view-mode').addEventListener('change', (e) => {
  state.viewMode = e.target.value;
  fitCanvasHeight();
  sim.updateAria();
  sim.requestDraw();
});

initPresets({
  tenth: () => { state.L = 0.1; state.theta0Deg = 10; release(); },
  quarter: () => { state.L = 0.25; state.theta0Deg = 10; release(); },
  forty: () => { state.L = 0.4; state.theta0Deg = 10; release(); },
  wide: () => { state.theta0Deg = 60; release(); },
  heavy: () => { state.m = Math.min(LIMITS.mMax, state.m * 10); updateAll(); },
});

release();
sim.start();
