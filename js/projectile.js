/**
 * projectile.js: a thrown ball (a scaled view, not 1:1).
 *
 * The flight is a pure function of time (no air resistance), so it is exact
 * and frame-rate independent. The view is scaled to fit the whole throw (and a
 * 1.8 m person for comparison); times are real. No screen calibration needed.
 */

import {
  TAU,
  G0,
  clamp,
  degToRad,
  niceStep,
  msToKmh,
  msToMph,
  projectileState,
  projectileFlightTime,
  projectileRange,
  projectileApexTime,
  projectileMaxHeight,
} from './physics.js';
import { fmt, fmtAuto } from './common.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawArrow, drawTag, drawScaleBar, lengthLabel } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = { vMin: 1, vMax: 30, vStep: 0.1, angMin: 0, angMax: 90, angStep: 1, hMin: 0, hMax: 2, hStep: 0.05 };
const BALL_RADIUS_M = 0.0335;      // tennis ball, 67 mm
const PERSON_HEIGHT_M = 1.8;
const PERSON_X_M = -0.45;          // stands just behind the launch point
const ORIGIN_MIN_PX = 90;          // launch point, px from the left (moves right, up to
const ORIGIN_MAX_PX = 170;         // ORIGIN_MAX_PX, so the person fits)
const MIN_VIEW_M = 2;              // never zoom in further than ~2 m of ground
const GROUND_MARGIN_PX = 46;       // ground line, px from the bottom
const PAD_PX = 36;                 // keep the ball this far from the top/right edges
const ARROW_PX_PER_MS = 4;         // velocity arrow scale (not to scale)

const state = {
  v: 10,
  angleDeg: 45,
  h0: 0,
  t: 0,
  done: false,
  showPath: true,
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

const theta = () => degToRad(state.angleDeg);
const flightTime = () => projectileFlightTime(state.v, theta(), state.h0, G0);
const range = () => projectileRange(state.v, theta(), state.h0, G0);
const apexTime = () => projectileApexTime(state.v, theta(), G0);
const maxHeight = () => projectileMaxHeight(state.v, theta(), state.h0, G0);
const ballAt = (t) => projectileState(state.v, theta(), state.h0, G0, t);

/* =========================================================================
 * 2. Setters + UI sync
 * ====================================================================== */

function reset() {
  state.t = 0;
  state.done = false;
  updateAll();
}

const params = [
  bindParam({ range: $('v-range'), num: $('v-num'), min: LIMITS.vMin, max: LIMITS.vMax, step: LIMITS.vStep,
    decimals: 1, words: 'metres per second',
    get: () => state.v, set: (v) => { state.v = clamp(v, LIMITS.vMin, LIMITS.vMax); reset(); } }),
  bindParam({ range: $('ang-range'), num: $('ang-num'), min: LIMITS.angMin, max: LIMITS.angMax, step: LIMITS.angStep,
    decimals: 0, words: 'degrees',
    get: () => state.angleDeg, set: (v) => { state.angleDeg = clamp(v, LIMITS.angMin, LIMITS.angMax); reset(); } }),
  bindParam({ range: $('h-range'), num: $('h-num'), min: LIMITS.hMin, max: LIMITS.hMax, step: LIMITS.hStep,
    decimals: 2, words: 'metres',
    get: () => state.h0, set: (v) => { state.h0 = clamp(v, LIMITS.hMin, LIMITS.hMax); reset(); } }),
];

function updateAll() {
  params.forEach((p) => p.sync());
  setText($('v-alt'), `= ${fmtAuto(msToKmh(state.v))} km/h, ${fmtAuto(msToMph(state.v))} mph`);
  updateReadouts();
  updateResult();
  sim.refreshPlayButton();
  sim.updateAria();
  sim.requestDraw();
  announce(`Range ${fmt(range(), 2)} metres, max height ${fmt(maxHeight(), 2)} metres, flight time ${fmt(flightTime(), 2)} seconds.`);
}

function updateReadouts() {
  const b = ballAt(state.t);
  setText(outputs.R, fmt(range(), 2));
  setText(outputs.H, fmt(maxHeight(), 2));
  setText(outputs.T, fmt(flightTime(), 3));
  setText(outputs.t, fmt(state.t, 3));
  setText(outputs.pos, `x ${fmt(b.x, 2)} m, height ${fmt(Math.max(0, b.y), 2)} m`);
  setText(outputs.vel, `speed ${fmt(Math.hypot(b.vx, b.vy), 2)} m/s (${fmt(b.vx, 2)} across, ${fmt(b.vy, 2)} up)`);

  const vx = state.v * Math.cos(theta());
  const vy = state.v * Math.sin(theta());
  setText(equations.comp, `${fmt(state.v, 1)} cos ${state.angleDeg}° = ${fmt(vx, 2)} m/s, ${fmt(state.v, 1)} sin ${state.angleDeg}° = ${fmt(vy, 2)} m/s`);
  setText(equations.pos, `at t = ${fmt(state.t, 2)} s: x = ${fmt(b.x, 2)} m, y = ${fmt(Math.max(0, b.y), 2)} m`);
  setText(equations.H, `${fmt(state.h0, 2)} + ${fmt(vy, 2)}² / (2 × 9.81) = ${fmt(maxHeight(), 2)} m`);
  setText(
    equations.R,
    state.h0 === 0
      ? `${fmt(state.v, 1)}² × sin ${2 * state.angleDeg}° / 9.81 = ${fmt(range(), 2)} m`
      : `launched from ${fmt(state.h0, 2)} m, so it flies further: ${fmt(range(), 2)} m`,
  );
}

function updateResult() {
  const el = $('result');
  if (!state.done) return setText(el, '');
  setText(
    el,
    `Landed ${fmt(range(), 2)} m away after ${fmt(flightTime(), 2)} s, peaking at ${fmt(maxHeight(), 2)} m: ` +
      `about ${fmtAuto(range() / PERSON_HEIGHT_M)} times the person's height away.`,
  );
}

function describe() {
  return `Projectile: a ball thrown at ${fmt(state.v, 1)} metres per second at ${state.angleDeg} degrees from ${fmt(state.h0, 2)} metres. It lands ${fmt(range(), 2)} metres away after ${fmt(flightTime(), 2)} seconds, peaking at ${fmt(maxHeight(), 2)} metres. ${state.done ? 'Landed.' : sim.paused ? 'Ready to throw.' : 'In flight.'}`;
}

/* =========================================================================
 * 3. Step
 * ====================================================================== */

function step(simDt) {
  if (state.done) return;
  const T = flightTime();
  state.t = Math.min(state.t + simDt, T);
  if (state.t >= T) {
    state.done = true;
    sim.setPaused(true);
    updateResult();
    sim.updateAria();
  }
  updateReadouts();
}

/* =========================================================================
 * 4. Drawing
 * ====================================================================== */

/** Launch point in px: far enough right to show the person. */
const originPx = (s) => clamp((0.3 - PERSON_X_M) * s + 10, ORIGIN_MIN_PX, ORIGIN_MAX_PX);

/** Pixels per metre: fit the whole throw and the person, fixed for the throw. */
function viewScale(w, h) {
  const availW = w - ORIGIN_MAX_PX - PAD_PX;
  const availH = h - GROUND_MARGIN_PX - PAD_PX;
  const spanX = Math.max(range() + BALL_RADIUS_M, MIN_VIEW_M);
  const spanY = Math.max(maxHeight() + BALL_RADIUS_M, PERSON_HEIGHT_M + 0.15);
  return Math.min(availW / spanX, availH / spanY);
}

function draw(ctx, w, h, k, colors) {
  const s = viewScale(w, h); // k (screen calibration) isn't used: this view is scaled
  const gy = h - GROUND_MARGIN_PX;
  const ox = originPx(s);
  const X = (x) => ox + x * s;
  const Y = (y) => gy - y * s;

  // Ground + distance ticks
  ctx.fillStyle = colors.refFill;
  ctx.fillRect(0, gy, w, GROUND_MARGIN_PX);
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(w, gy);
  ctx.stroke();
  const tick = niceStep(80 / s);
  ctx.lineWidth = 1;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; X(x) <= w; x += tick) {
    ctx.beginPath();
    ctx.moveTo(X(x), gy);
    ctx.lineTo(X(x), gy + 8);
    ctx.stroke();
    ctx.fillText(x === 0 ? '0' : lengthLabel(x), X(x), gy + 11);
  }

  drawPerson(ctx, X, Y, s, colors);

  // Predicted path (dashed) and path so far (solid)
  const T = flightTime();
  if (state.showPath) {
    ctx.strokeStyle = colors.track;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    tracePath(ctx, 0, T, X, Y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.t > 0) {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    tracePath(ctx, 0, state.t, X, Y);
    ctx.stroke();
    // Equal-time marks
    const dtMark = niceStep(T / 12);
    ctx.fillStyle = colors.accent;
    for (let i = 1; i * dtMark < state.t; i++) {
      const p = ballAt(i * dtMark);
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 2.5, 0, TAU);
      ctx.fill();
    }
  }

  // Apex and landing markers
  if (state.t >= apexTime() && apexTime() > 0) {
    const a = ballAt(apexTime());
    markHeight(ctx, X(a.x), Y(a.y), gy, `max height ${fmt(maxHeight(), 2)} m`, colors);
  }
  if (state.done) {
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(X(range()), gy - 10);
    ctx.lineTo(X(range()), gy + 10);
    ctx.stroke();
    drawTag(ctx, `range ${fmt(range(), 2)} m`, X(range()), gy - 24, {
      align: X(range()) > w - 120 ? 'right' : 'center', color: colors.fg, background: colors.bg, border: colors.track,
    });
  }

  // Launch angle hint before the throw
  if (state.t === 0) {
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(X(0), Y(state.h0), 36, -theta(), 0);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${state.angleDeg}°`, X(0) + 40, Y(state.h0) - 4);
  }

  // Ball (true size, never smaller than a few px) + velocity arrow
  // The path is the ball's centre; it never sinks below the ground when drawn.
  const b = ballAt(state.t);
  const bx = X(b.x);
  const by = Y(Math.max(b.y, BALL_RADIUS_M));
  const r = Math.max(3, BALL_RADIUS_M * s);
  ctx.fillStyle = '#c8dc3c';
  ctx.strokeStyle = '#6b7a16';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, TAU);
  ctx.fill();
  ctx.stroke();
  if (!state.done) {
    // Arrow starts at the ball's edge so it stays visible when the ball is big (1:1)
    const speed = Math.hypot(b.vx, b.vy) || 1;
    const sx = bx + (b.vx / speed) * r;
    const sy = by - (b.vy / speed) * r;
    const ex = sx + b.vx * ARROW_PX_PER_MS;
    const ey = sy - b.vy * ARROW_PX_PER_MS;
    drawArrow(ctx, sx, sy, ex, ey, colors.fg, { width: 1.5, head: 8 });
    ctx.fillStyle = colors.fg;
    const nearRight = ex > w - 90;
    ctx.textAlign = nearRight ? 'right' : 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`v = ${fmt(Math.hypot(b.vx, b.vy), 1)} m/s`, nearRight ? ex - 6 : ex + 6, ey - 2);
  }

  // Scale bar (top left): this view is scaled to fit, not true size
  drawScaleBar(ctx, colors, { x: 14, y: 34, k: s, maxPx: 160 });
}

/** Build a path along the trajectory from t0 to t1. */
function tracePath(ctx, t0, t1, X, Y) {
  const n = 80;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const p = ballAt(t0 + ((t1 - t0) * i) / n);
    if (i === 0) ctx.moveTo(X(p.x), Y(p.y));
    else ctx.lineTo(X(p.x), Y(p.y));
  }
}

function markHeight(ctx, x, y, gy, label, colors) {
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, gy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, x, y - 8);
}

/** Simple 1.8 m person silhouette in true proportions. */
function drawPerson(ctx, X, Y, s, colors) {
  const x = PERSON_X_M;
  ctx.fillStyle = colors.refFill;
  ctx.strokeStyle = colors.ref;
  ctx.lineWidth = 1.5;
  const shape = (draw) => { ctx.beginPath(); draw(); ctx.fill(); ctx.stroke(); };
  // legs, body, arms, head (metres)
  shape(() => ctx.roundRect(X(x - 0.15), Y(0.88), 0.13 * s, 0.88 * s, 0.04 * s));
  shape(() => ctx.roundRect(X(x + 0.02), Y(0.88), 0.13 * s, 0.88 * s, 0.04 * s));
  shape(() => ctx.roundRect(X(x - 0.19), Y(1.5), 0.38 * s, 0.66 * s, 0.08 * s));
  shape(() => ctx.roundRect(X(x - 0.27), Y(1.46), 0.08 * s, 0.62 * s, 0.04 * s));
  shape(() => ctx.roundRect(X(x + 0.19), Y(1.46), 0.08 * s, 0.62 * s, 0.04 * s));
  shape(() => ctx.arc(X(x), Y(PERSON_HEIGHT_M - 0.12), 0.12 * s, 0, TAU));
  // label at the head, or at the top edge if the head is off-screen
  const labelY = Math.max(Y(PERSON_HEIGHT_M) - 6, 64);
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  if (X(x + 0.3) > 0) ctx.fillText('1.8 m person', Math.max(X(x), 50), labelY);
}

/* =========================================================================
 * 5. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  startPaused: true,
  calibration: false, // scaled to fit the throw: no screen calibration
  beforePlay: () => { if (state.done) reset(); },
  playLabel: () => (state.done ? 'Throw again' : state.t > 0 ? 'Resume' : 'Throw'),
  debug: { state, range, flightTime, maxHeight },
});

$('reset-btn').addEventListener('click', reset);
$('show-path').addEventListener('change', (e) => {
  state.showPath = e.target.checked;
  sim.requestDraw();
});

initPresets({
  ten: () => { Object.assign(state, { v: 10, angleDeg: 45, h0: 0 }); reset(); },
  lob: () => { Object.assign(state, { v: 5, angleDeg: 60 }); reset(); },
  flat: () => { Object.assign(state, { v: 25, angleDeg: 10 }); reset(); },
  shoulder: () => { state.h0 = 1.5; reset(); },
});

updateAll();
sim.start();
