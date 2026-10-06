/**
 * velocity.js: the 1:1 velocity simulator (Linear | Angular views).
 *
 * Page pattern shared by every sim (copy this layout for new ones):
 *   1. constants + state
 *   2. state setters (enforce invariants, here v = ω·r)
 *   3. UI sync (readouts, equations, aria)
 *   4. step(): advance the simulation by simDt seconds
 *   5. draw(): world units are metres, converted to px only here (k = px per metre)
 *   6. wiring + start
 * The loop, play/pause, time scale, calibration and canvas live in simkit.js.
 */

import {
  TAU,
  clamp,
  wrap,
  wrapAngle,
  advance,
  coupleFromSpeed,
  coupleFromOmega,
  omegaRange,
  msToKmh,
  msToMph,
  radPerSecToRpm,
  frequencyFromOmega,
  periodFromOmega,
  centripetalAcceleration,
  maxRadiusToFit,
  snapDown,
  niceScaleBarLength,
  G0,
} from './physics.js';
import { fmt, fmtAuto, scaleSourceText } from './common.js';
import { createSim, bindParam, initTabs, setText, createAnnouncer } from './simkit.js';
import { drawDot, drawArrowHead, drawRuler, drawTag, lengthLabel, withAlpha } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  vMin: 0.1, vMax: 10, vStep: 0.1,       // m/s
  rMin: 0.02, rMax: 0.15, rStep: 0.005,  // m
  wStep: 0.1,                            // rad/s (range derived from v limits and r)
};

// On-screen sizes in CSS px (deliberately NOT to scale)
const DOT_RADIUS_PX = 7;
const ARROW_PX = 56;                     // tangent velocity arrow length
const CIRCLE_MARGIN_PX = 24;             // keep the orbit this far from the canvas edge
const TRAIL_SECONDS = 0.08;              // trail = last 0.08 s of on-screen motion...
const TRAIL_MAX_TRACK_FRACTION = 0.35;   // ...capped at 35% of the screen width
const LOOP_M = 1;                        // linear view loops every 1 m of travel
const TRAIL_MAX_ANGLE = 0.75 * TAU;      // ...or three-quarters of a turn

const state = {
  v: 1,               // linear speed, m/s
  r: 0.05,            // radius, m (effective: never larger than fits the canvas)
  rRequested: 0.05,   // radius the user asked for; restored if the canvas grows again
  omega: 20,          // angular speed, rad/s (always v / r)
  direction: 1,       // +1 = right / anticlockwise, -1 = left / clockwise
  view: 'linear',
  reference: 'none',  // linear-view reference object: none | ruler | football
  // Accumulated motion (never recomputed from a start time, so slider changes can't jump):
  x: 0.01,            // linear position along the track, m (wrapped only when drawn)
  theta: 0,           // orbit angle, rad, kept in [0, 2π)
  simTime: 0,         // total simulated time, s
};

let rMaxFit = LIMITS.rMax; // largest r whose circle fits the canvas at this scale

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/* =========================================================================
 * 2. State setters: every change goes through these so v = ω·r always holds
 * ====================================================================== */

/** v changed (slider or typed): keep r, derive ω. */
function setSpeed(v) {
  Object.assign(state, coupleFromSpeed({ v: clamp(v, LIMITS.vMin, LIMITS.vMax), r: state.r }));
  paramsChanged();
}

/** r changed by the user: keep v, derive ω. */
function setRadius(r) {
  state.rRequested = clamp(r, LIMITS.rMin, LIMITS.rMax);
  applyRadius();
}

/** Effective r = requested r limited to what fits on screen (keep v, derive ω). */
function applyRadius() {
  const r = clamp(state.rRequested, LIMITS.rMin, rMaxFit);
  Object.assign(state, coupleFromSpeed({ v: state.v, r }));
  paramsChanged();
}

/** ω changed: keep r, derive v (ω limited so v stays inside its range). */
function setOmega(omega) {
  const { min, max } = omegaRange(state.r, LIMITS.vMin, LIMITS.vMax);
  Object.assign(state, coupleFromOmega({ omega: clamp(omega, min, max), r: state.r }));
  paramsChanged();
}

function toggleDirection() {
  state.direction = -state.direction;
  updateDirectionButton();
  sim.updateAria();
  sim.requestDraw();
}

/** Clamp r's maximum so the whole circle fits the canvas at the current scale. */
function updateRadiusLimit() {
  const fit = maxRadiusToFit(sim.width, sim.height, sim.k, CIRCLE_MARGIN_PX);
  rMaxFit = clamp(snapDown(fit, LIMITS.rStep), LIMITS.rMin, LIMITS.rMax);
  $('r-note').hidden = rMaxFit >= LIMITS.rMax;
  if (Math.min(state.rRequested, rMaxFit) !== state.r) applyRadius();
  else syncControls();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const ceilTo = (x, step) => Number((Math.ceil(x / step - 1e-9) * step).toFixed(1));
const floorTo = (x, step) => Number((Math.floor(x / step + 1e-9) * step).toFixed(1));
const omegaMin = () => ceilTo(LIMITS.vMin / state.r, LIMITS.wStep);
const omegaMax = () => floorTo(LIMITS.vMax / state.r, LIMITS.wStep);

const params = [
  bindParam({ range: $('v-range'), num: $('v-num'), min: LIMITS.vMin, max: LIMITS.vMax, step: LIMITS.vStep,
    get: () => state.v, set: setSpeed, decimals: 2, words: 'metres per second' }),
  bindParam({ range: $('r-range'), num: $('r-num'), min: LIMITS.rMin, max: () => rMaxFit, step: LIMITS.rStep,
    get: () => state.r, set: setRadius, decimals: 3, words: 'metres' }),
  bindParam({ range: $('w-range'), num: $('w-num'), min: omegaMin, max: omegaMax, step: LIMITS.wStep,
    get: () => state.omega, set: setOmega, decimals: 2, words: 'radians per second' }),
];

/** Called after any v / r / ω change. */
function paramsChanged() {
  syncControls();
  updateReadouts();
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  announce(
    `Speed ${fmt(state.v, 2)} metres per second, radius ${fmt(state.r, 3)} metres, ` +
      `angular speed ${fmtAuto(state.omega)} radians per second, ${fmtAuto(radPerSecToRpm(state.omega))} rpm.`,
  );
}

function syncControls() {
  for (const p of params) p.sync();
  setText($('r-max'), `${rMaxFit.toFixed(3)} m`);
  setText($('w-min'), fmt(omegaMin(), 1));
  setText($('w-max'), `${fmt(omegaMax(), 1)} rad/s`);
}

function updateReadouts() {
  const { v, r, omega } = state;
  const a = centripetalAcceleration(v, r);
  setText(outputs.v, fmt(v, 2));
  setText(outputs.kmh, fmtAuto(msToKmh(v)));
  setText(outputs.mph, fmtAuto(msToMph(v)));
  setText(outputs.w, fmtAuto(omega));
  setText(outputs.rpm, fmtAuto(radPerSecToRpm(omega)));
  setText(outputs.f, fmtAuto(frequencyFromOmega(omega)));
  setText(outputs.T, fmtAuto(periodFromOmega(omega)));
  setText(outputs.a, fmtAuto(a));
  setText(outputs.g, fmtAuto(a / G0));
}

/** Live-substituted equations in "The maths" card. */
function updateEquations() {
  const { v, r, omega } = state;
  const f = frequencyFromOmega(omega);
  const vs = fmt(v, 2);
  const rs = fmt(r, 3);
  const ws = fmtAuto(omega);
  setText(equations.dist, vs);
  setText(equations.ang, ws);
  setText(equations.vwr, `${ws} rad/s × ${rs} m = ${vs} m/s`);
  setText(equations.fT, `f = ${ws} / 2π = ${fmtAuto(f)} Hz, T = ${fmtAuto(periodFromOmega(omega))} s`);
  setText(equations.rpm, `60 × ${fmtAuto(f)} Hz = ${fmtAuto(radPerSecToRpm(omega))} rpm`);
  setText(equations.acc, `${vs}² / ${rs} = ${fmtAuto(centripetalAcceleration(v, r))} m/s²`);
  setText(equations.units, `${vs} m/s = ${fmtAuto(msToKmh(v))} km/h = ${fmtAuto(msToMph(v))} mph`);
  setText(
    equations.scale,
    `1 m = ${fmt(sim.k, 0)} CSS px on this screen (${scaleSourceText(sim.scale)})`,
  );
}

function directionWords() {
  if (state.view === 'linear') return state.direction > 0 ? 'right' : 'left';
  return state.direction > 0 ? 'anticlockwise' : 'clockwise';
}

function updateDirectionButton() {
  const arrows = { right: '→', left: '←', anticlockwise: '↺', clockwise: '↻' };
  const word = directionWords();
  setText($('dir-btn'), `Direction: ${word} ${arrows[word]}`);
}

/** Canvas description for screen readers; updated on input changes, not per frame. */
function describe() {
  const scaleWord = sim.scale.calibrated ? 'calibrated 1:1' : 'approximate';
  const timeWord = sim.timeScale === 1 ? 'in real time' : `in slow motion at ${sim.timeScale} times`;
  const pausedWord = sim.paused ? ', paused' : '';
  if (state.view === 'linear') {
    const screenM = sim.width / sim.k;
    return `Linear view at ${scaleWord} scale: a dot moving ${directionWords()} along a 1 metre loop, ${fmt(Math.min(screenM, LOOP_M), 2)} metres of it on screen, at ${fmt(state.v, 2)} metres per second (${fmtAuto(msToKmh(state.v))} km/h), ${timeWord}${pausedWord}.`;
  }
  return `Angular view at ${scaleWord} scale: a dot moving ${directionWords()} round a circle of radius ${fmt(state.r * 100, 1)} centimetres at ${fmtAuto(state.omega)} radians per second (${fmtAuto(radPerSecToRpm(state.omega))} rpm), rim speed ${fmt(state.v, 2)} metres per second, ${timeWord}${pausedWord}.`;
}

/* =========================================================================
 * 4. Simulation step
 * ====================================================================== */

/**
 * Velocity is constant, so x += v·dir·dt and θ += ω·dir·dt are exact for any dt:
 * the result depends only on elapsed time, never on the frame rate.
 */
function step(simDt) {
  state.simTime += simDt;
  state.x = advance(state.x, state.v, state.direction, simDt);
  state.theta = wrapAngle(advance(state.theta, state.omega, state.direction, simDt));
}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre)
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  if (state.view === 'linear') drawLinear(ctx, w, h, k, colors);
  else drawAngular(ctx, w, h, k, colors);
}

/** Trail length along the path (m): proportional to on-screen speed, capped. */
function trailLength(maxMetres) {
  return Math.min(state.v * sim.timeScale * TRAIL_SECONDS, maxMetres);
}

/**
 * The dot travels a 1 m loop. The screen shows the first part of it; for the
 * rest of the metre the dot is off-screen, so each lap takes the real time to
 * travel 1 m (e.g. 0.5 s at 2 m/s), whatever the screen size.
 */
function drawLinear(ctx, w, h, k, colors) {
  const screenM = w / k;
  const loopPx = LOOP_M * k;
  const trackY = h * 0.6;

  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, trackY);
  ctx.lineTo(Math.min(w, loopPx), trackY);
  ctx.stroke();

  drawRuler(ctx, colors, { x: 0, y: trackY, lengthM: Math.min(screenM, LOOP_M), k });
  if (state.reference !== 'none') drawReference(ctx, k, trackY, w, colors);

  // On screens wider than 1 m, mark where the loop wraps
  if (loopPx < w) {
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(loopPx, trackY - 40);
    ctx.lineTo(loopPx, trackY + 40);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    screenM < LOOP_M
      ? `Loops every 1 m: ${fmt(screenM * 100, 1)} cm on screen, then ${fmt((LOOP_M - screenM) * 100, 1)} cm off-screen`
      : 'Loops every 1 m (dashed line)',
    12, h - 12,
  );

  // Dot + trail, drawn up to three times so crossing the loop point is seamless.
  const pos = wrap(state.x, LOOP_M);            // position around the loop, m
  const headPx = pos * k;
  const trailPx = trailLength(Math.min(screenM, LOOP_M) * TRAIL_MAX_TRACK_FRACTION) * k;
  let visible = false;
  for (const offset of [-loopPx, 0, loopPx]) {
    const head = headPx + offset;
    const tail = head - state.direction * trailPx;
    if (Math.max(head, tail) + DOT_RADIUS_PX < 0 || Math.min(head, tail) - DOT_RADIUS_PX > w) continue;
    visible ||= head + DOT_RADIUS_PX >= 0 && head - DOT_RADIUS_PX <= w;
    if (trailPx > 1) {
      const g = ctx.createLinearGradient(tail, 0, head, 0);
      g.addColorStop(0, withAlpha(colors.accentRgb, 0));
      g.addColorStop(1, withAlpha(colors.accentRgb, 0.55));
      ctx.strokeStyle = g;
      ctx.lineWidth = DOT_RADIUS_PX * 1.4;
      ctx.beginPath();
      ctx.moveTo(tail, trackY);
      ctx.lineTo(head, trackY);
      ctx.stroke();
    }
    drawDot(ctx, head, trackY, DOT_RADIUS_PX, colors.accent);
  }

  // While it's off-screen, say where and when it comes back (in real seconds)
  if (!visible) {
    const right = state.direction > 0;
    const offM = right ? LOOP_M - pos : pos - screenM; // distance until it re-enters
    const back = offM / state.v / sim.timeScale;
    drawTag(ctx, right ? `← back from the left in ${fmt(back, 2)} s` : `back from the right in ${fmt(back, 2)} s →`,
      right ? 12 : w - 12, trackY + 64, { align: right ? 'left' : 'right', color: colors.fg, background: colors.bg, border: colors.track });
  }
}

/** Optional true-scale reference object above the track. */
function drawReference(ctx, k, trackY, w, colors) {
  const x0 = 0; // same zero as the track ruler, so the ticks line up
  const base = trackY - 18; // object sits just above the track
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.ref;
  ctx.fillStyle = colors.refFill;
  let caption;
  let clipped = false;

  if (state.reference === 'ruler') {
    const len = 0.3 * k;
    const height = 0.03 * k;
    const top = base - height;
    ctx.beginPath();
    ctx.rect(x0, top, len, height);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let cm = 0; cm <= 30; cm++) {
      const x = x0 + cm * 0.01 * k;
      const tick = cm % 10 === 0 ? height * 0.45 : cm % 5 === 0 ? height * 0.32 : height * 0.2;
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - tick);
    }
    ctx.stroke();
    caption = '30 cm ruler (true scale)';
    clipped = x0 + len > w || top < 0;
  } else if (state.reference === 'football') {
    const radius = 0.11 * k;
    const cx = x0 + radius;
    const cy = base - radius;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // simple centre pentagon so it reads as a ball
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 5;
      const px = cx + Math.cos(a) * radius * 0.3;
      const py = cy + Math.sin(a) * radius * 0.3;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = colors.ref;
    ctx.fill();
    caption = 'Football, 22 cm diameter (true scale)';
    clipped = cy - radius < 0 || cx + radius > w;
  }

  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(clipped ? `${caption}, extends beyond view` : caption, x0 + 4, trackY - 4);
  ctx.restore();
}

function drawAngular(ctx, w, h, k, colors) {
  const cx = w / 2;
  const cy = h / 2;
  const R = state.r * k;
  const dir = state.direction;
  const theta = state.theta;
  // Maths angles are anticlockwise-positive; canvas y points down, so y uses −sin.
  const dotX = cx + R * Math.cos(theta);
  const dotY = cy - R * Math.sin(theta);

  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();

  drawDirectionArc(ctx, cx, cy, clamp(R * 0.3, 10, 28), dir, colors);

  // Fading trail: short arc segments behind the dot with increasing opacity
  const phi = Math.min(trailLength(Infinity) / state.r, TRAIL_MAX_ANGLE);
  if (phi * R > 1) {
    const n = Math.max(2, Math.ceil(phi / 0.05));
    ctx.lineWidth = DOT_RADIUS_PX * 1.4;
    for (let i = 0; i < n; i++) {
      const a0 = theta - dir * phi * (1 - i / n);
      const a1 = theta - dir * phi * (1 - (i + 1) / n);
      ctx.strokeStyle = withAlpha(colors.accentRgb, 0.55 * ((i + 1) / n));
      ctx.beginPath();
      ctx.arc(cx, cy, R, -a0, -a1, dir > 0);
      ctx.stroke();
    }
  }

  // Radius line + centre
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(dotX, dotY);
  ctx.stroke();
  drawDot(ctx, cx, cy, 3, colors.muted);
  drawDot(ctx, dotX, dotY, DOT_RADIUS_PX, colors.accent);

  // Tangent velocity arrow (fixed length: a 1:1 velocity arrow has no meaning)
  const ux = -Math.sin(theta) * dir;
  const uy = -Math.cos(theta) * dir;
  const sx = dotX + ux * (DOT_RADIUS_PX + 2);
  const sy = dotY + uy * (DOT_RADIUS_PX + 2);
  const ex = sx + ux * ARROW_PX;
  const ey = sy + uy * ARROW_PX;
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex - ux * 6, ey - uy * 6);
  ctx.stroke();
  drawArrowHead(ctx, ex, ey, ux, uy, 10);
  ctx.textAlign = ux >= 0 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`v = ${fmt(state.v, 2)} m/s`, ex + ux * 8 + (ux >= 0 ? 4 : -4), ey + uy * 8);

  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`r = ${fmt(state.r * 100, 1)} cm (true scale)`, 12, 12);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('v = ω × r', w - 12, h - 12);
  drawVelocityScaleBar(ctx, k, 12, h - 14, w, colors);
}

/** Small static arc with an arrowhead showing the sense of rotation. */
function drawDirectionArc(ctx, cx, cy, rho, dir, colors) {
  const start = Math.PI * 0.15; // maths angle
  const end = start + Math.PI * 1.3 * dir;
  ctx.strokeStyle = colors.accent;
  ctx.fillStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, rho, -start, -end, dir > 0);
  ctx.stroke();
  drawArrowHead(ctx, cx + rho * Math.cos(end), cy - rho * Math.sin(end), -Math.sin(end) * dir, -Math.cos(end) * dir, 6);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('ω', cx + rho + 4, cy - rho * 0.6);
}

/** 1 m scale bar when it fits, otherwise the longest of 50/20/10/5/2/1 cm that does. */
function drawVelocityScaleBar(ctx, k, x, y, w, colors) {
  const len = niceScaleBarLength((w * 0.4) / k);
  const px = len * k;
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 6);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(lengthLabel(len), x, y - 8);
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  onResize: updateRadiusLimit,
  onScaleChange: () => {
    updateRadiusLimit();
    updateEquations();
  },
  debug: {
    state,
    step,
    get scale() { return sim.scale; },
    loopM: LOOP_M,
  },
});

initTabs({
  name: 'view',
  values: ['linear', 'angular'],
  tallViews: ['angular'], // full screen height = biggest possible circle
  onChange: (view) => {
    state.view = view;
    updateDirectionButton();
    sim.updateAria();
    sim.requestDraw();
  },
});

$('dir-btn').addEventListener('click', toggleDirection);
$('ref-select').addEventListener('change', (e) => {
  state.reference = e.target.value;
  sim.requestDraw();
});
setText($('v-min'), fmt(LIMITS.vMin, 1));
setText($('v-max'), `${fmt(LIMITS.vMax, 0)} m/s`);
setText($('r-min'), fmt(LIMITS.rMin, 3));

paramsChanged();
sim.start();
