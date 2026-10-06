/**
 * frequency.js: vibration and frequency at 1:1 scale.
 *
 * Vibration view: a string fixed at both ends vibrating in its fundamental
 * mode, y(x, t) = A·sin(πx/ℓ)·sin(2πft), with A at true scale.
 * Time view: a scrolling sine wave against a time axis, with a light that is
 * on for the positive half of each cycle.
 *
 * Honest rendering of fast motion: each frame shows everything that happened
 * during that frame (motion blur for the string, average brightness for the
 * light), instead of a single sample that would alias into fake slow motion.
 */

import {
  TAU,
  G0,
  clamp,
  niceStep,
  niceFloor,
  shmPeakVelocity,
  shmPeakAcceleration,
  sineRms,
  squareWaveOnFraction,
} from './physics.js';
import { fmt, fmtAuto } from './common.js';
import { createSim, bindParam, initTabs, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, lengthLabel, withAlpha, FONT_BOLD } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = { fMin: 0.5, fMax: 100, aMin: 0.0001, aMax: 0.05, dMin: 0.01, dMax: 0.99, dStep: 0.01 }; // Hz, m, fraction
const END_MARGIN_PX = 56;
const MAX_BLUR_SAMPLES = 32;

/** Typical rates, for a sense of scale (approximate). */
const EXAMPLES = [
  [0.2, 'Tall building swaying in wind'],
  [1, 'Footbridge swaying under walkers'],
  [1.2, 'Resting heartbeat'],
  [2, 'Walking footsteps'],
  [3, 'Running footsteps'],
  [6, 'Whole-body vibration people feel most (4–8 Hz)'],
  [10, 'Hand tremor (8–12 Hz)'],
  [20, 'Lowest pitch most people can hear'],
  [25, 'Motor shaft at 1,500 rpm'],
  [50, 'UK/EU mains; motor shaft at 3,000 rpm'],
  [60, 'US mains electricity'],
  [100, 'Transformer hum on 50 Hz mains'],
];

const state = {
  view: 'vibration',
  f: 2,          // Hz
  A: 0.005,      // amplitude (centre to peak), m
  duty: 0.5,     // fraction of each cycle the light is on (Time view)
  phase: 0,      // 2πft accumulated (never recomputed from a start time)
  prevPhase: 0,  // phase at the previous frame: the frame covers [prevPhase, phase]
  simTime: 0,
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/* =========================================================================
 * 2. Setters + UI sync
 * ====================================================================== */

const params = [
  bindParam({ range: $('f-range'), num: $('f-num'), min: LIMITS.fMin, max: LIMITS.fMax, log: true,
    decimals: 2, words: 'hertz',
    get: () => state.f, set: (v) => { state.f = clamp(v, LIMITS.fMin, LIMITS.fMax); updateAll(); } }),
  bindParam({ range: $('A-range'), num: $('A-num'), min: LIMITS.aMin, max: LIMITS.aMax, log: true,
    scale: 1000, decimals: 2, words: 'millimetres',
    get: () => state.A, set: (v) => { state.A = clamp(v, LIMITS.aMin, LIMITS.aMax); updateAll(); } }),
  bindParam({ range: $('d-range'), num: $('d-num'), min: LIMITS.dMin, max: LIMITS.dMax, step: LIMITS.dStep,
    scale: 100, decimals: 0, words: 'percent on',
    get: () => state.duty, set: (v) => { state.duty = clamp(v, LIMITS.dMin, LIMITS.dMax); updateAll(); } }),
];

const timeLabel = (s) => (s >= 1 ? `${fmtAuto(s)} s` : `${fmtAuto(s * 1000)} ms`);

function updateAll() {
  params.forEach((p) => p.sync());
  updateReadouts();
  updateExamples();
  sim.updateAria();
  sim.requestDraw();
  announce(`Frequency ${fmtAuto(state.f)} hertz, period ${timeLabel(1 / state.f)}, amplitude ${fmtAuto(state.A * 1000)} millimetres.`);
}

function updateReadouts() {
  const { f, A } = state;
  const vpk = shmPeakVelocity(f, A);
  const apk = shmPeakAcceleration(f, A);
  setText(outputs.T, timeLabel(1 / f));
  setText(outputs.perMin, fmtAuto(f * 60));
  setText(outputs.perDay, Math.round(f * 86400).toLocaleString('en-GB'));
  setText(outputs.pp, fmtAuto(2 * A * 1000));
  setText(outputs.vpk, fmtAuto(vpk * 1000));
  setText(outputs.vrms, fmtAuto(sineRms(vpk) * 1000));
  setText(outputs.apk, fmtAuto(apk));
  setText(outputs.g, fmtAuto(apk / G0));
  setText(outputs.onoff, `${timeLabel(state.duty / f)} on, ${timeLabel((1 - state.duty) / f)} off`);
  setText(equations.onoff, `on ${fmt(state.duty, 2)} × ${timeLabel(1 / f)} = ${timeLabel(state.duty / f)}, off ${timeLabel((1 - state.duty) / f)}`);
  setText(outputs.refresh, fmt(sim.refreshHz, 0));

  setText(equations.T, `1 / ${fmtAuto(f)} = ${timeLabel(1 / f)}`);
  setText(equations.x, `swings ${fmtAuto(A * 1000)} mm either side of centre, ${fmtAuto(f)} times a second`);
  setText(equations.v, `2π × ${fmtAuto(f)} × ${fmtAuto(A)} m = ${fmtAuto(vpk * 1000)} mm/s peak, ${fmtAuto(sineRms(vpk) * 1000)} mm/s RMS`);
  setText(equations.a, `(2π × ${fmtAuto(f)})² × ${fmtAuto(A)} m = ${fmtAuto(apk)} m/s² = ${fmtAuto(apk / G0)} g`);
}

/** The three examples nearest the current frequency (on a log scale). */
function updateExamples() {
  const nearest = [...EXAMPLES]
    .sort((a, b) => Math.abs(Math.log(a[0] / state.f)) - Math.abs(Math.log(b[0] / state.f)))
    .slice(0, 3)
    .sort((a, b) => a[0] - b[0]);
  const list = $('examples');
  const html = nearest.map(([hz, text]) => `<li><span>${text}</span><b>≈ ${fmtAuto(hz)} Hz</b></li>`).join('');
  if (list.innerHTML !== html) list.innerHTML = html;
}

function describe() {
  const base = `${fmtAuto(state.f)} hertz, period ${timeLabel(1 / state.f)}`;
  if (state.view === 'vibration') {
    return `Vibration view: a string vibrating at ${base}, ${fmtAuto(state.A * 1000)} millimetres either side of centre at ${sim.scale.calibrated ? 'calibrated' : 'approximate'} true scale${sim.paused ? ', paused' : ''}.`;
  }
  return `Time view: a sine wave at ${base}, and a light that is on for ${timeLabel(state.duty / state.f)} and off for ${timeLabel((1 - state.duty) / state.f)} in each cycle (${fmt(state.duty * 100, 0)}% on)${sim.paused ? ', paused' : ''}.`;
}

/* =========================================================================
 * 3. Step
 * ====================================================================== */

function step(simDt) {
  state.prevPhase = state.phase;
  state.phase += TAU * state.f * simDt;
  state.simTime += simDt;
  if (state.phase > 1e6) {
    // keep the numbers small; whole turns don't change anything
    const turns = Math.floor(state.prevPhase / TAU) * TAU;
    state.phase -= turns;
    state.prevPhase -= turns;
  }
  setText(outputs.refresh, fmt(sim.refreshHz, 0));
}

/** Phase span covered by this frame (0 when paused, capped at one full cycle). */
function frameSpan() {
  return sim.paused ? 0 : Math.min(state.phase - state.prevPhase, TAU);
}

const tooFastForScreen = () => state.f * sim.timeScale > sim.refreshHz / 2;

/* =========================================================================
 * 4. Drawing
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  if (state.view === 'vibration') drawVibration(ctx, w, h, k, colors);
  else drawTime(ctx, w, h, colors);
}

function drawVibration(ctx, w, h, k, colors) {
  const xL = END_MARGIN_PX;
  const xR = w - END_MARGIN_PX;
  const y0 = h / 2;
  const Apx = state.A * k;

  // Clamped ends
  ctx.fillStyle = colors.fg;
  ctx.fillRect(xL - 12, y0 - 24, 12, 48);
  ctx.fillRect(xR, y0 - 24, 12, 48);

  // ±A guide lines near the middle (true scale)
  const xm = (xL + xR) / 2;
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(xm - 120, y0 - Apx);
  ctx.lineTo(xm + 120, y0 - Apx);
  ctx.moveTo(xm - 120, y0 + Apx);
  ctx.lineTo(xm + 120, y0 + Apx);
  ctx.stroke();
  ctx.setLineDash([]);

  // String, motion-blurred over the frame
  const span = frameSpan();
  const n = span > 0 ? clamp(Math.ceil(span / (TAU / 24)), 1, MAX_BLUR_SAMPLES) : 1;
  const alpha = n === 1 ? 1 : clamp(2 / n, 0.08, 1);
  const segments = 120;
  ctx.lineWidth = 2;
  ctx.strokeStyle = withAlpha(colors.accentRgb, alpha);
  for (let i = 0; i < n; i++) {
    const phi = state.phase - span * (i / n);
    const s = Math.sin(phi);
    ctx.beginPath();
    for (let j = 0; j <= segments; j++) {
      const u = j / segments;
      const x = xL + (xR - xL) * u;
      const y = y0 - Apx * Math.sin(Math.PI * u) * s;
      if (j === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Peak-to-peak marker and a comparison bar, either side of the middle, labelled above
  const refLen = clamp(niceFloor(Math.max(state.A * 4, 0.002)), 0.001, 0.05);
  const quarter = (xR - xL) / 4;
  drawSpan(ctx, xm + quarter, y0, Apx, `${fmtAuto(2 * state.A * 1000)} mm peak to peak`, colors.fg, FONT_BOLD);
  drawSpan(ctx, xm - quarter, y0, (refLen * k) / 2, `${lengthLabel(refLen)} for comparison`, colors.muted, '12px system-ui, sans-serif');

  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`String ${lengthLabel((xR - xL) / k)} long, fixed at both ends, vibrating at ${fmtAuto(state.f)} Hz`, 12, h - 12);
  if (tooFastForScreen() && !sim.paused) {
    drawTag(ctx, `Faster than your screen's ~${fmt(sim.refreshHz, 0)} Hz refresh: shown as a blur, as your eye sees it`, 12, 22, {
      color: colors.warn, background: colors.warnBg,
    });
  }
}

/** Vertical span of ±half px centred on (x, y), with a label above it. */
function drawSpan(ctx, x, y, half, label, color, font) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - half);
  ctx.lineTo(x + 5, y - half);
  ctx.moveTo(x, y - half);
  ctx.lineTo(x, y + half);
  ctx.moveTo(x - 5, y + half);
  ctx.lineTo(x + 5, y + half);
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(label, x, y - Math.max(half, 24) - 8);
}

/** Seconds of history shown across the time plot. */
const timeWindow = () => (state.f < 1 ? 4 : state.f < 4 ? 2 : 1);

function drawTime(ctx, w, h, colors) {
  const xL = 48;
  const xR = w - 48;
  const W = timeWindow();
  const yMid = h * 0.24;
  const amp = Math.min(h * 0.13, 80);
  const toX = (tau) => xR - (tau / W) * (xR - xL); // tau = seconds before now

  // Axis + time ticks (time before now)
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(xL, yMid);
  ctx.lineTo(xR, yMid);
  ctx.stroke();
  const tick = niceStep(W / Math.max(2, Math.floor((xR - xL) / 80))); // labels ≥ 80 px apart
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i * tick <= W + 1e-9; i++) {
    const tau = i * tick;
    const x = toX(tau);
    ctx.beginPath();
    ctx.moveTo(x, yMid + amp + 6);
    ctx.lineTo(x, yMid + amp + 12);
    ctx.stroke();
    ctx.fillText(tau === 0 ? 'now' : `−${Number(tau.toFixed(3))} s`, x, yMid + amp + 15);
  }

  // Sine wave: value at "τ seconds ago" is sin(phase − 2πfτ)
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = xL; x <= xR; x += 1.5) {
    const tau = ((xR - x) / (xR - xL)) * W;
    const y = yMid - amp * Math.sin(state.phase - TAU * state.f * tau);
    if (x === xL) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.arc(xR, yMid - amp * Math.sin(state.phase), 5, 0, TAU);
  ctx.fill();

  // One period marked on the wave, if it's wide enough to label
  const periodPx = (xR - xL) / (W * state.f);
  if (periodPx > 50) {
    const yb = yMid - amp - 14;
    ctx.strokeStyle = colors.fg;
    // drawn at the left end, clear of the time badge (any cycle is the same length)
    ctx.beginPath();
    ctx.moveTo(xL, yb);
    ctx.lineTo(xL + periodPx, yb);
    ctx.moveTo(xL, yb - 4);
    ctx.lineTo(xL, yb + 4);
    ctx.moveTo(xL + periodPx, yb - 4);
    ctx.lineTo(xL + periodPx, yb + 4);
    ctx.stroke();
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`one cycle = ${timeLabel(1 / state.f)}`, xL + periodPx / 2, yb - 4);
  }

  // On/off strip, lined up with the wave: the light is on for the first
  // duty × T of every cycle (where the wave starts rising through zero).
  const stripY = yMid + amp + 52;
  const stripH = 18;
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Light: on ${fmt(state.duty * 100, 0)}% of each cycle`, xL, stripY - 4);
  ctx.fillStyle = colors.track;
  ctx.fillRect(xL, stripY, xR - xL, stripH);
  ctx.fillStyle = colors.accent;
  const phiOld = state.phase - TAU * state.f * W; // phase at the left edge
  for (let c = Math.floor(phiOld / TAU); c * TAU <= state.phase; c++) {
    const a = Math.max(c * TAU, phiOld);                      // on from the start of the cycle...
    const b = Math.min(c * TAU + state.duty * TAU, state.phase); // ...for duty × 2π of phase
    if (b <= a) continue;
    const xa = toX((state.phase - a) / (TAU * state.f));
    const xb = toX((state.phase - b) / (TAU * state.f));
    ctx.fillRect(xa, stripY, Math.max(1, xb - xa), stripH);
  }

  // The light: brightness = fraction of this frame it was on
  const span = frameSpan();
  const on = squareWaveOnFraction(state.phase - span, state.phase, state.duty);
  const lx = w / 2;
  const ly = h * 0.78;
  const lr = Math.min(46, h * 0.09);
  ctx.fillStyle = colors.track;
  ctx.beginPath();
  ctx.arc(lx, ly, lr, 0, TAU);
  ctx.fill();
  ctx.fillStyle = withAlpha(colors.accentRgb, on);
  ctx.beginPath();
  ctx.arc(lx, ly, lr, 0, TAU);
  ctx.fill();
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`On for ${timeLabel(state.duty / state.f)}, off for ${timeLabel((1 - state.duty) / state.f)}`, lx + lr + 16, ly - 9);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = colors.muted;
  ctx.fillText('Lit during the blue parts of the strip above', lx + lr + 16, ly + 9);

  if (tooFastForScreen() && !sim.paused) {
    drawTag(ctx, `Faster than your screen's ~${fmt(sim.refreshHz, 0)} Hz refresh can show: the light blends to its average, like your eye does`, 12, 22, {
      color: colors.warn, background: colors.warnBg,
    });
  }
}

/* =========================================================================
 * 5. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  debug: { state },
});

initTabs({
  name: 'view',
  values: ['vibration', 'time'],
  onChange: (view) => {
    state.view = view;
    sim.updateAria();
    sim.requestDraw();
  },
});

initPresets({
  motor: () => { state.f = 50; state.A = 0.001; updateAll(); },
  heart: () => { state.f = 1.2; updateAll(); },
  bridge: () => { state.f = 1; state.A = 0.02; updateAll(); },
  hearing: () => { state.f = 20; updateAll(); },
});

updateAll();
sim.start();
