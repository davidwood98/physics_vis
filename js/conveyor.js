/**
 * conveyor.js: products on a belt at a fixed rate (a scaled view, not 1:1).
 *
 * Rate and product length are fixed; the belt speed is the variable. The pitch
 * follows from them (p = v·T, T = 60/rate), so a faster belt spreads the same
 * products further apart. A reference point in the middle of the view shows
 * how long it is covered by each product (l/v) and how long it sits empty
 * (gap/v) in every cycle T.
 *
 * Everything is time and length along the belt: no screen calibration. The
 * view shows a fixed length of belt, so speeding up visibly opens the gaps.
 * The belt's travel s accumulates (s += v·dt); products sit at trailing edges
 * ≡ s (mod pitch).
 */

import {
  clamp,
  wrap,
  niceStep,
  productInterval,
  pitchForRate,
  minBeltSpeed,
  occupiedTime,
  freeTime,
  pointOccupied,
} from './physics.js';
import { fmt, fmtAuto } from './common.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawScaleBar, lengthLabel, FONT_BOLD } from './draw.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  rateMin: 1, rateMax: 1000,             // products per minute
  lMin: 0.01, lMax: 0.5, lStep: 0.005,   // product length, m
  vMin: 0.01, vMax: 3, vStep: 0.01,      // belt speed, m/s
  LMin: 0.25, LMax: 20,                  // belt length shown, m
};
const SIDE_MARGIN_PX = 16;
const TIMELINE_CYCLES = 4;               // the occupancy strip shows the last 4 cycles
const MAX_BLUR_SAMPLES = 12;

const state = {
  rate: 120,      // products per minute (fixed)
  length: 0.1,    // product length along the belt, m (fixed)
  v: 0.25,        // belt speed, m/s (the variable)
  viewL: 2,       // length of belt shown, m
  s: 0,           // belt travel, m (accumulated)
  frameTravel: 0, // travel during the last frame (for motion blur), m
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

// Derived quantities
const T = () => productInterval(state.rate);
const pitch = () => pitchForRate(state.v, state.rate);
const gap = () => Math.max(0, pitch() - state.length);
const slowestSpeed = () => Math.max(LIMITS.vMin, minBeltSpeed(state.rate, state.length));
const refPoint = () => state.viewL / 2;

/* =========================================================================
 * 2. Setters: rate and length are fixed inputs; the belt can't go slower
 *    than "products touching" (and that must fit under the top speed)
 * ====================================================================== */

function setRate(r) {
  const maxRate = Math.floor((60 * LIMITS.vMax) / state.length); // fastest belt, products touching
  state.rate = clamp(Math.round(r), LIMITS.rateMin, Math.min(LIMITS.rateMax, maxRate));
  state.v = Math.max(state.v, slowestSpeed());
  updateAll();
}

function setLength(l) {
  const maxLen = LIMITS.vMax * T();
  state.length = clamp(l, LIMITS.lMin, Math.min(LIMITS.lMax, maxLen));
  state.v = Math.max(state.v, slowestSpeed());
  updateAll();
}

function setSpeed(v) {
  state.v = clamp(v, slowestSpeed(), LIMITS.vMax);
  updateAll();
}

const params = [
  bindParam({ range: $('rate-range'), num: $('rate-num'), min: LIMITS.rateMin, max: LIMITS.rateMax, log: true,
    decimals: 0, words: 'products per minute', get: () => state.rate, set: setRate }),
  bindParam({ range: $('l-range'), num: $('l-num'), min: LIMITS.lMin, max: LIMITS.lMax, step: LIMITS.lStep,
    scale: 1000, decimals: 0, words: 'millimetres', get: () => state.length, set: setLength }),
  bindParam({ range: $('v-range'), num: $('v-num'), min: slowestSpeed, max: LIMITS.vMax, step: LIMITS.vStep,
    decimals: 2, words: 'metres per second', get: () => state.v, set: setSpeed }),
  bindParam({ range: $('L-range'), num: $('L-num'), min: LIMITS.LMin, max: LIMITS.LMax, log: true,
    decimals: 2, words: 'metres',
    get: () => state.viewL, set: (L) => { state.viewL = clamp(L, LIMITS.LMin, LIMITS.LMax); updateAll(); } }),
];

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

function updateAll() {
  params.forEach((p) => p.sync());
  setText($('v-min'), `${fmt(slowestSpeed(), 2)} m/s (touching)`);
  setText($('v-alt'), `= ${fmtAuto(state.v * 60)} m/min`);
  updateReadouts();
  sim.updateAria();
  sim.requestDraw();
  announce(
    `${fmtAuto(state.rate)} per minute at ${fmt(state.v, 2)} metres per second: gap ${fmt(gap() * 1000, 0)} millimetres, ` +
      `reference point free for ${fmt(freeTime(pitch(), state.length, state.v), 3)} of every ${fmt(T(), 3)} seconds.`,
  );
}

function updateReadouts() {
  const p = pitch();
  const occ = occupiedTime(state.length, state.v);
  const free = freeTime(p, state.length, state.v);
  setText(outputs.T, fmt(T(), 3));
  setText(outputs.pitch, fmt(p * 1000, 0));
  setText(outputs.gap, fmt(gap() * 1000, 0));
  setText(outputs.mmin, fmtAuto(state.v * 60));
  setText(outputs.occ, fmt(occ, 3));
  setText(outputs.free, fmt(free, 3));
  setText(outputs.freePct, fmt((free / T()) * 100, 0));
  setText(outputs.cross, fmtAuto(state.viewL / state.v));
  setText(outputs.onBelt, fmtAuto(state.viewL / p));

  const ts = fmt(T(), 3);
  const vs = fmt(state.v, 2);
  const ls = fmt(state.length, 3);
  setText(equations.T, `60 / ${fmtAuto(state.rate)} = ${ts} s`);
  setText(equations.pitch, `${vs} × ${ts} = ${fmt(p, 3)} m (${fmt(p * 1000, 0)} mm)`);
  setText(equations.gap, `${fmt(p * 1000, 0)} − ${fmt(state.length * 1000, 0)} = ${fmt(gap() * 1000, 0)} mm`);
  setText(equations.occ, `${ls} / ${vs} = ${fmt(occ, 3)} s`);
  setText(equations.free, `${ts} − ${fmt(occ, 3)} = ${fmt(free, 3)} s (${fmt((free / T()) * 100, 0)}% of each cycle)`);
  setText(equations.vmin, `${ls} / ${ts} = ${fmt(minBeltSpeed(state.rate, state.length), 3)} m/s`);
}

function describe() {
  return `Conveyor (scaled view of ${lengthLabel(state.viewL)} of belt): ${fmtAuto(state.rate)} products per minute, ${fmt(state.length * 1000, 0)} millimetres long, belt at ${fmt(state.v, 2)} metres per second. Pitch ${fmt(pitch() * 1000, 0)} millimetres, gap ${fmt(gap() * 1000, 0)} millimetres. The reference point is covered for ${fmt(occupiedTime(state.length, state.v), 3)} seconds and empty for ${fmt(freeTime(pitch(), state.length, state.v), 3)} seconds in every ${fmt(T(), 3)} second cycle${sim.paused ? ', paused' : ''}.`;
}

/* =========================================================================
 * 4. Step
 * ====================================================================== */

function step(simDt) {
  state.frameTravel = state.v * simDt;
  state.s += state.frameTravel;
}

/* =========================================================================
 * 5. Drawing (scaled: sc = px per metre of belt, so the chosen length fits)
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  const L = state.viewL;
  const sc = (w - 2 * SIDE_MARGIN_PX) / L;
  const X = (m) => SIDE_MARGIN_PX + m * sc;
  const p = pitch();
  const beltY = h * 0.44;
  const beltPx = 12;
  const prodH = clamp(state.length * sc * 0.6, 8, h * 0.2); // illustrative height
  const refX = X(refPoint());
  const occupied = pointOccupied(refPoint(), state.s, p, state.length);

  // Belt with moving texture (marks on a 1-2-5 step, about 30 across the view)
  const markM = niceStep(L / 30);
  ctx.fillStyle = colors.track;
  ctx.fillRect(0, beltY, w, beltPx);
  ctx.strokeStyle = colors.bg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let m = wrap(state.s, markM) - markM; X(m) < w; m += markM) {
    ctx.moveTo(X(m), beltY + 3);
    ctx.lineTo(X(m), beltY + beltPx - 3);
  }
  ctx.stroke();

  // Distance axis under the belt
  const tick = niceStep(90 / sc);
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (let i = 0; i * tick <= L + 1e-9; i++) {
    const m = i * tick;
    ctx.beginPath();
    ctx.moveTo(X(m), beltY + beltPx + 2);
    ctx.lineTo(X(m), beltY + beltPx + 8);
    ctx.stroke();
    ctx.textAlign = i === 0 ? 'left' : 'center';
    ctx.fillText(i === 0 ? '0' : tick < 1 ? `${fmt(m * 1000, 0)} mm` : `${fmtAuto(m)} m`, X(m), beltY + beltPx + 11);
  }

  // Products, motion-blurred over the frame when they move more than a few px
  const travelPx = sim.paused ? 0 : state.frameTravel * sc;
  const n = clamp(Math.ceil(travelPx / 6), 1, MAX_BLUR_SAMPLES);
  const alpha = n === 1 ? 1 : clamp(1.8 / n, 0.15, 1);
  const first = wrap(state.s, p) - p; // trailing edge of the first product, m
  ctx.fillStyle = colors.accent;
  for (let j = 0; j < n; j++) {
    const back = (travelPx * j) / n;
    ctx.globalAlpha = alpha;
    for (let m = first; X(m) < w; m += p) {
      const left = X(m) - back;
      const width = Math.max(1, state.length * sc);
      if (left + width < 0) continue;
      ctx.beginPath();
      ctx.roundRect(left, beltY - prodH, width, prodH, Math.min(6, prodH / 4, width / 2));
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Fixed dimension ruler above the belt: it stays put while products pass
  // underneath, and only changes when the inputs change.
  const d0 = L * 0.03;                                    // start of the ruler, m
  const dx = (m) => Math.min(X(d0 + m), w - SIDE_MARGIN_PX); // clipped to the view
  const rowPitch = beltY - prodH - 50;
  const rowParts = beltY - prodH - 22;
  const mm = (m) => `${fmt(m * 1000, 0)} mm`;
  drawDimension(ctx, dx(0), dx(p), rowPitch,
    [`pitch ${mm(p)}${d0 + p > L ? ' (longer than view)' : ''}`, mm(p)], colors, { outside: true });
  drawDimension(ctx, dx(0), dx(state.length), rowParts, [`product ${mm(state.length)}`, mm(state.length)], colors);
  if (gap() > 0) {
    drawDimension(ctx, dx(state.length), dx(p), rowParts, [`gap ${mm(gap())}`, mm(gap())], colors, { outside: true });
  }

  // Reference point: a fixed line across the belt, coloured by its current state
  const refColor = occupied ? colors.accent : colors.ok;
  ctx.strokeStyle = refColor;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(refX, beltY - prodH - 70);
  ctx.lineTo(refX, beltY + beltPx + 2);
  ctx.stroke();
  ctx.setLineDash([]);
  drawTag(ctx, occupied ? 'Reference point: OCCUPIED' : 'Reference point: FREE', refX, beltY - prodH - 84, {
    align: 'center', color: occupied ? colors.fg : colors.ok, background: occupied ? colors.bg : colors.okBg, border: refColor,
  });

  drawTimeline(ctx, w, h, colors);

  // Scale + summary
  drawScaleBar(ctx, colors, { x: w - SIDE_MARGIN_PX - 160, y: h - 30, k: sc, maxPx: 150 });
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${fmtAuto(state.rate)}/min · one every ${fmt(T(), 2)} s · ${lengthLabel(L)} of belt shown`, 12, h - 12);
}

/**
 * Strip chart of the reference point over the last few cycles (now at the right):
 * blue while a product covers it, green while it is empty. Drawn from the exact
 * occupied intervals, so even very short ones show up.
 */
function drawTimeline(ctx, w, h, colors) {
  const x0 = SIDE_MARGIN_PX;
  const x1 = w - SIDE_MARGIN_PX;
  const y = h * 0.7;
  const barH = 26;
  const p = pitch();
  const span = TIMELINE_CYCLES * T();
  const toX = (tau) => x1 - (tau / span) * (x1 - x0); // tau = seconds ago

  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Reference point over the last ${fmtAuto(span)} s (${TIMELINE_CYCLES} cycles)`, x0, y - 8);

  ctx.fillStyle = colors.ok;
  ctx.fillRect(x0, y, x1 - x0, barH);

  // Looking back in time, the belt position under the point is u = φ0 + v·tau;
  // the point is covered while u mod p is within [0, l].
  const phi0 = wrap(refPoint() - state.s, p);
  const uEnd = phi0 + state.v * span;
  ctx.fillStyle = colors.accent;
  for (let kk = Math.floor(phi0 / p) - 1; kk * p <= uEnd; kk++) {
    const a = Math.max(kk * p, phi0);
    const b = Math.min(kk * p + state.length, uEnd);
    if (b <= a) continue;
    const xa = toX((b - phi0) / state.v);
    const xb = toX((a - phi0) / state.v);
    ctx.fillRect(xa, y, Math.max(1, xb - xa), barH);
  }

  // Cycle ticks + legend
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= TIMELINE_CYCLES; i++) {
    const x = toX(i * T());
    ctx.beginPath();
    ctx.moveTo(x, y + barH);
    ctx.lineTo(x, y + barH + 6);
    ctx.stroke();
    ctx.textAlign = i === 0 ? 'right' : i === TIMELINE_CYCLES ? 'left' : 'center';
    ctx.fillText(i === 0 ? 'now' : `−${fmtAuto(i * T())} s`, x, y + barH + 9);
  }
  const occ = occupiedTime(state.length, state.v);
  const free = freeTime(p, state.length, state.v);
  const ly = y + barH + 30;
  const occText = `occupied ${fmt(occ, 3)} s`;
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x0, ly, 12, 12);
  ctx.fillStyle = colors.fg;
  ctx.fillText(occText, x0 + 18, ly);
  const fx = x0 + 18 + ctx.measureText(occText).width + 20;
  ctx.fillStyle = colors.ok;
  ctx.fillRect(fx, ly, 12, 12);
  ctx.fillStyle = colors.fg;
  ctx.fillText(`free ${fmt(free, 3)} s  (per ${fmt(T(), 3)} s cycle)`, fx + 18, ly);
}

/**
 * Horizontal dimension line with end stops and a centred label. labels is a
 * list from longest to shortest; the first that fits between the stops is used.
 * If none fits and outside is set, the first label goes just right of the line.
 */
function drawDimension(ctx, x0, x1, y, labels, colors, { outside = false } = {}) {
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x0, y - 5);
  ctx.lineTo(x0, y + 5);
  ctx.moveTo(x1, y - 5);
  ctx.lineTo(x1, y + 5);
  ctx.stroke();
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = labels.find((t) => ctx.measureText(t).width + 6 <= Math.abs(x1 - x0));
  if (label) {
    ctx.fillText(label, (x0 + x1) / 2, y - 3);
  } else if (outside) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labels[0], x1 + 8, y);
  }
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  calibration: false, // scaled view: timings and lengths only, no screen calibration
  debug: { state, pitch, T },
});

initPresets({
  touching: () => setSpeed(slowestSpeed()),
  half: () => setSpeed(state.v / 2),
  double: () => setSpeed(state.v * 2),
  slow: () => { Object.assign(state, { rate: 120, length: 0.1, v: 0.25 }); updateAll(); },
  fast: () => { Object.assign(state, { rate: 120, length: 0.1, v: 1 }); updateAll(); },
  bottles: () => { Object.assign(state, { rate: 600, length: 0.065, v: 1 }); updateAll(); },
});

updateAll();
sim.start();
