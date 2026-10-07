/**
 * wavelength.js: the wavelength ruler (Wavelength | Microwave door | Standing waves).
 *
 * Wavelength: pick a frequency (or type a wavelength) and λ = v/f is drawn at
 *   true size: a sine wave with exactly one wavelength marked by a fixed
 *   dimension line. Longer than the canvas: the part that fits, and how far it
 *   carries on. Under two device pixels (light): one pixel magnified with the
 *   waves inside it at the same magnification, then a further zoom.
 * Microwave door: the oven's 12.2 cm wavelength, the door mesh and its holes at
 *   true size, the hole's TE₁₁ cut-off wavelength, and a graph of how fast the
 *   microwaves fade inside a hole while light passes.
 * Standing waves: mode n between two hard walls, true size when the box fits
 *   (scaled and badged when it doesn't), animated slowly and labelled so.
 *
 * Page pattern as velocity.js:
 *   1. constants + state
 *   2. setters (enforce limits; f and λ are always linked by λ = v/f)
 *   3. UI sync (inputs, readouts, equations, aria)
 *   4. step(): advance the slowed animations
 *   5. draw(): world units are metres, converted to px only here (k = CSS px per metre)
 *   6. wiring + start
 * Every reference value comes from js/data/wavelength-data.js (cited there);
 * the maths is in js/wavelength-model.js (unit tested).
 */

import { TAU, clamp, niceStep, logFractionToValue, valueToLogFraction } from './physics.js';
import { fmt, scaleSourceText, smallLength } from './common.js';
import { createSim, bindParam, initTabs, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawRuler, drawChart, drawArrowHead, withAlpha, FONT, FONT_BOLD } from './draw.js';
import { sig, sigT, sigWords } from './astro.js';
import * as M from './wavelength-model.js';
import {
  C_LIGHT,
  PRESETS,
  STANDING_PRESETS,
  DOOR_MESH,
  BANDS,
  OVEN_CAVITY,
  GREEN_LASER_M,
  ULTRASONIC_SENSOR,
  AIR_REFRACTIVE_INDEX,
  AIR_CRAMER,
  WATER_MARCZAK,
  STANDARD_PRESSURE_KPA,
} from './data/wavelength-data.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  fMin: 1, fMaxSound: 1e8, fMaxEm: 1e15, // Hz (log slider)
  rhMin: 0, rhMax: 100, rhStep: 1,        // % relative humidity
  tStep: 0.5,                             // °C (range depends on the medium's formula)
  dMin: 0.2e-3, dMax: 0.1,                // hole diameter, m (log)
  LMin: 0.01, LMax: 10,                   // wall spacing, m (log)
  nMin: 1, nMax: 12,                      // mode number
};

const MARGIN = 24;                    // CSS px either side of true-size drawings
const PIXEL_MODE_DEVICE_PX = 2;       // under 2 device px per wavelength: magnified-pixel view
const WAVE_SHOWN_CYCLES_PER_S = 0.5;  // the travelling wave is drawn moving at most this many cycles per second...
const WAVE_SHOWN_MAX_PX_PER_S = 90;   // ...and never faster than this across the screen
const STANDING_SHOWN_HZ = 0.5;        // the standing wave is drawn oscillating at 0.5 Hz
const MODE_LIST_COUNT = 6;            // readout: the first 6 modes
const ISM = BANDS.find((b) => b.id === 'ism');
const MICROWAVE_HZ = ISM.centre;                          // 2.45 GHz
const MICROWAVE_LAMBDA = M.wavelength(C_LIGHT, MICROWAVE_HZ); // 12.24 cm
const LIGHT_LAMBDA = GREEN_LASER_M;                      // 532 nm
const MESH_PITCH_RATIO = DOOR_MESH.pitchM / DOOR_MESH.holeM; // holes drawn this many diameters apart
const SUBPIXEL_RGB = ['#e5484d', '#30a46c', '#3e63dd'];  // same stripe colours as the shared Pixel size card

const state = {
  view: 'wave',
  medium: 'air',      // 'air' | 'water' | 'em'
  tC: 20,             // °C (air and water)
  rh: 0,              // % relative humidity (air only)
  f: PRESETS.a4.f,    // Hz
  name: PRESETS.a4.short, // what the wave is, for labels ('' = just numbers)
  fUnit: null,        // unit picked by the user for the frequency box (null = automatic)
  lamUnit: null,      // same for the wavelength box
  phase: 0,           // travelling-wave phase, cycles (drawn motion only)
  holeD: DOOR_MESH.holeM, // m
  L: STANDING_PRESETS.room.L, // m
  n: 1,
  standPhase: 0,      // standing-wave display phase, rad
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

// Derived quantities
const speed = () => M.waveSpeed(state.medium, state.tC, state.rh);
const lambda = () => M.wavelength(speed(), state.f);
const fMax = () => (state.medium === 'em' ? LIMITS.fMaxEm : LIMITS.fMaxSound);
const tRange = () => M.temperatureRange(state.medium);
const modeKind = () => (state.medium === 'em' ? 'field' : 'pressure');
const modeFreq = (n = state.n) => M.modeFrequency(n, speed(), state.L);
/** Size of one device pixel on this screen, m. */
const pixelPitch = () => 1 / (sim.k * (sim.view?.dpr || window.devicePixelRatio || 1));
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setFrequency(f, { name = '', keepUnits = false } = {}) {
  state.f = clamp(f, LIMITS.fMin, fMax());
  state.name = name;
  if (!keepUnits) {
    state.fUnit = null;
    state.lamUnit = null;
  }
  paramsChanged();
}

/** Typed wavelength: f = v / λ (clamped to the frequency range). */
function setWavelength(lam) {
  setFrequency(M.frequency(speed(), lam), { keepUnits: true });
}

function setMedium(medium) {
  if (medium === state.medium) return;
  state.medium = medium;
  const [lo, hi] = tRange();
  state.tC = clamp(state.tC, lo, hi);
  state.f = clamp(state.f, LIMITS.fMin, fMax());
  state.name = '';
  state.fUnit = null;
  state.lamUnit = null;
  paramsChanged();
}

function applyPreset(id) {
  const p = PRESETS[id];
  state.medium = p.medium;
  state.tC = clamp(state.tC, ...tRange());
  const f = p.f ?? M.frequency(C_LIGHT, p.lambda);
  setFrequency(f, { name: p.short ?? capital(p.name) });
}

function applyStandingPreset(id) {
  const p = STANDING_PRESETS[id];
  state.medium = p.medium;
  state.tC = clamp(state.tC, ...tRange());
  state.L = p.L;
  state.n = p.n ?? clamp(M.nearestMode(MICROWAVE_HZ, speed(), p.L), LIMITS.nMin, LIMITS.nMax);
  paramsChanged();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const params = [
  bindParam({ range: $('t-range'), num: $('t-num'), min: () => tRange()[0], max: () => tRange()[1], step: LIMITS.tStep,
    decimals: 1, words: 'degrees Celsius', get: () => state.tC,
    set: (t) => { state.tC = clamp(t, ...tRange()); paramsChanged(); } }),
  bindParam({ range: $('rh-range'), num: $('rh-num'), min: LIMITS.rhMin, max: LIMITS.rhMax, step: LIMITS.rhStep,
    decimals: 0, words: 'percent relative humidity', get: () => state.rh,
    set: (rh) => { state.rh = clamp(Math.round(rh), LIMITS.rhMin, LIMITS.rhMax); paramsChanged(); } }),
  bindParam({ range: $('d-range'), num: $('d-num'), min: LIMITS.dMin, max: LIMITS.dMax, log: true, scale: 1000,
    decimals: 2, words: 'millimetres', get: () => state.holeD,
    set: (d) => { state.holeD = clamp(d, LIMITS.dMin, LIMITS.dMax); paramsChanged(); } }),
  bindParam({ range: $('L-range'), num: $('L-num'), min: LIMITS.LMin, max: LIMITS.LMax, log: true,
    decimals: 3, words: 'metres', get: () => state.L,
    set: (L) => { state.L = clamp(L, LIMITS.LMin, LIMITS.LMax); paramsChanged(); } }),
  bindParam({ range: $('n-range'), num: $('n-num'), min: LIMITS.nMin, max: LIMITS.nMax, step: 1,
    decimals: 0, words: '', get: () => state.n,
    set: (n) => { state.n = clamp(Math.round(n), LIMITS.nMin, LIMITS.nMax); paramsChanged(); } }),
];

/* Frequency and wavelength boxes: a number plus a unit picker each, and a log slider for f. */
const fNum = $('f-num');
const fUnitSel = $('f-unit');
const fRange = $('f-range');
const lamNum = $('lam-num');
const lamUnitSel = $('lam-unit');
for (const u of M.FREQUENCY_UNITS) fUnitSel.add(new Option(u.unit, u.unit));
for (const u of M.LENGTH_UNITS) lamUnitSel.add(new Option(u.unit, u.unit));
const unitBy = (list, name) => list.find((u) => u.unit === name);

function syncWaveInputs() {
  const f = state.f;
  const lam = lambda();
  const fu = state.fUnit ?? M.pickUnit(f, M.FREQUENCY_UNITS);
  const lu = state.lamUnit ?? M.pickUnit(lam, M.LENGTH_UNITS);
  fUnitSel.value = fu.unit;
  lamUnitSel.value = lu.unit;
  if (document.activeElement !== fNum) fNum.value = M.inputNumber(f / fu.size);
  if (document.activeElement !== lamNum) lamNum.value = M.inputNumber(lam / lu.size, 5);
  fRange.value = String(1000 * valueToLogFraction(f, LIMITS.fMin, fMax()));
  fRange.setAttribute('aria-valuetext', M.formatFrequency(f));
  setText($('f-max'), M.formatFrequency(fMax()));
}

fRange.addEventListener('input', () => {
  setFrequency(logFractionToValue(Number(fRange.value) / 1000, LIMITS.fMin, fMax()));
});
fNum.addEventListener('change', () => {
  const v = Number(fNum.value);
  if (fNum.value.trim() === '' || !(v > 0)) { syncWaveInputs(); return; }
  state.fUnit = unitBy(M.FREQUENCY_UNITS, fUnitSel.value);
  setFrequency(v * state.fUnit.size, { keepUnits: true });
});
fUnitSel.addEventListener('change', () => { state.fUnit = unitBy(M.FREQUENCY_UNITS, fUnitSel.value); syncWaveInputs(); });
lamNum.addEventListener('change', () => {
  const v = Number(lamNum.value);
  if (lamNum.value.trim() === '' || !(v > 0)) { syncWaveInputs(); return; }
  state.lamUnit = unitBy(M.LENGTH_UNITS, lamUnitSel.value);
  setWavelength(v * state.lamUnit.size);
});
lamUnitSel.addEventListener('change', () => { state.lamUnit = unitBy(M.LENGTH_UNITS, lamUnitSel.value); syncWaveInputs(); });

/** Words for the medium and its conditions: "dry air at 20 °C". */
function conditionsText() {
  if (state.medium === 'em') return 'in a vacuum (air changes it by under 0.03%)';
  const t = `${fmt(state.tC, state.tC % 1 ? 1 : 0)} °C`;
  if (state.medium === 'water') return `pure water at ${t}`;
  return state.rh === 0 ? `dry air at ${t}` : `air at ${t}, ${fmt(state.rh, 0)}% humidity`;
}

function speedText(v = speed()) {
  return state.medium === 'em' ? `${fmt(v, 0)} m/s` : `${fmt(v, 1)} m/s`;
}

/** Called after any change. */
function paramsChanged() {
  for (const p of params) p.sync();
  syncWaveInputs();
  updateMediumUI();
  updateReadouts();
  updateEquations();
  sim.pixelCard?.update();
  sim.updateAria();
  sim.requestDraw();
  announce(summary());
}

function updateMediumUI() {
  const m = state.medium;
  $('medium-select').value = m;
  $('t-control').hidden = m === 'em';
  $('rh-control').hidden = m !== 'air';
  setText($('t-label'), m === 'water' ? 'Water temperature' : 'Air temperature');
  const [lo, hi] = tRange();
  setText($('t-min'), `${lo} °C`);
  setText($('t-max'), `${hi} °C`);
  setText($('t-note'), m === 'water'
    ? `Marczak's formula for pure water, valid ${lo} to ${hi} °C.`
    : `Cramer's formula as used by NPL, valid ${lo} to ${hi} °C at normal pressure.`);
  setText($('speed-note'), `v = ${speedText()}, ${conditionsText()}`);
  // The wave-speed equation shown in the maths card follows the medium (the door view is all light/radio).
  const shown = state.view === 'door' ? 'em' : m;
  for (const li of document.querySelectorAll('[data-medium]')) li.hidden = li.dataset.medium !== shown;
}

function updateReadouts() {
  const v = speed();
  const lam = lambda();
  const f = state.f;
  const dpr = sim.view?.dpr || window.devicePixelRatio || 1;
  const pitch = pixelPitch();

  // Wavelength view
  setText(outputs.lam, M.formatLength(lam));
  setText(outputs.lamSub, `${speedText(v)} ÷ ${M.formatFrequency(f)}`);
  setText(outputs.f, M.formatFrequency(f));
  setText(outputs.band, capital(M.describeWave(state.medium, f, lam)));
  setText(outputs.T, M.formatPeriod(M.period(f)));
  setText(outputs.v, speedText(v));
  setText(outputs.vSub, state.medium === 'em' ? 'light and radio, exact (in a vacuum)' : `sound in ${conditionsText()}`);
  const devPx = lam / pitch;
  setText(outputs.px, devPx >= 1 ? `${devPx < 1e6 ? fmt(devPx, devPx < 10 ? 1 : 0) : sigWords(devPx, 3)} pixels` : `${sig(1 / devPx, 3)} per pixel`);
  setText(outputs.pxSub, devPx >= 1
    ? `per wavelength; 1 pixel = ${smallLength(pitch)}`
    : `wavelengths fit across 1 pixel (${smallLength(pitch)})`);
  setText(outputs.compare, capital(M.comparisonText(lam)));

  // Microwave door view
  const d = state.holeD;
  const lc = M.te11Cutoff(d);
  const alpha = M.belowCutoffAttenuation(MICROWAVE_LAMBDA, lc);
  setText(outputs.d, M.formatLength(d));
  setText(outputs.dPx, `${fmt(d / pitch, d / pitch < 10 ? 1 : 0)} pixels on this screen`);
  setText(outputs.lc, M.formatLength(lc));
  setText(outputs.fc, `1.706 × d; cut-off frequency ${M.formatFrequency(C_LIGHT / lc, 3)}`);
  setText(outputs.mwLam, M.formatLength(MICROWAVE_LAMBDA));
  setText(outputs.mwVerdict, alpha > 0
    ? `${sigT(MICROWAVE_LAMBDA / lc, 2)} × the cut-off: blocked`
    : 'shorter than the cut-off: microwaves get through!');
  setText(outputs.fade, alpha > 0 ? `${sigT(M.lossDb(alpha, 1e-3), 3)} dB per mm` : 'none');
  setText(outputs.fadeSub, alpha > 0
    ? `power falls to 1/${sig(1 / M.powerFraction(alpha, 1e-3), 2)} in each millimetre of depth`
    : 'the hole is wide enough to carry them');
  setText(outputs.light, `${sig(d / LIGHT_LAMBDA, 3)} wavelengths across the hole`);

  // Standing waves view
  const fn = modeFreq();
  setText(outputs.fn, M.formatFrequency(fn));
  setText(outputs.fnSub, state.n === 1 ? 'the lowest mode' : `${state.n} × ${M.formatFrequency(modeFreq(1))}`);
  setText(outputs.lamN, M.formatLength(M.modeWavelength(state.n, state.L)));
  setText(outputs.nodeGap, `nodes every ${M.formatLength(state.L / state.n)} (half a wavelength)`);
  const list = outputs.modes;
  list.textContent = '';
  for (let i = 1; i <= MODE_LIST_COUNT; i++) {
    const li = document.createElement('li');
    if (i === state.n) li.className = 'is-current';
    li.innerHTML = '<span></span><b></b>';
    li.firstChild.textContent = `Mode ${i}${i === state.n ? ' (shown)' : ''}`;
    li.lastChild.textContent = M.formatFrequency(modeFreq(i));
    list.append(li);
  }
  if (state.medium === 'em') {
    const nOven = M.nearestMode(MICROWAVE_HZ, speed(), state.L);
    const li = document.createElement('li');
    li.innerHTML = '<span></span><b></b>';
    li.firstChild.textContent = `Mode nearest an oven's ${M.formatFrequency(MICROWAVE_HZ)}`;
    li.lastChild.textContent = `n = ${fmt(nOven, 0)} (${M.formatFrequency(modeFreq(nOven))})`;
    list.append(li);
  }
  updateBadge();
}

/** Live-substituted equations in "The maths" card. */
function updateEquations() {
  const v = speed();
  const lam = lambda();
  const f = state.f;
  setText(equations.lam, `${speedText(v)} ÷ ${M.formatFrequency(f)} = ${M.formatLength(lam)}`);
  setText(equations.T, `1 ÷ ${M.formatFrequency(f)} = ${M.formatPeriod(M.period(f))}`);
  const t = fmt(state.tC, 1);
  setText(equations.vAir, `Cramer's equation, dry-air terms (θ in °C); the full one adds humidity, pressure and CO₂. At ${t} °C, ${fmt(state.rh, 0)}% humidity, ${STANDARD_PRESSURE_KPA} kPa: v = ${fmt(M.soundSpeedAir(state.tC, state.rh), 2)} m/s. Valid ${AIR_CRAMER.tRangeC[0]} to ${AIR_CRAMER.tRangeC[1]} °C.`);
  setText(equations.vWater, `Marczak's equation for pure water (θ in °C, terms up to θ⁵): at θ = ${t} °C, v = ${fmt(M.soundSpeedWater(state.tC), 1)} m/s. Valid ${WATER_MARCZAK.tRangeC[0]} to ${WATER_MARCZAK.tRangeC[1]} °C.`);
  setText(equations.vEm, `Exact by definition. In air light is slower by a factor of ${AIR_REFRACTIVE_INDEX.n} (NIST, 20 °C), so ${state.view === 'door' ? `2.45 GHz microwaves are ${M.formatLength(MICROWAVE_LAMBDA, 4)} long` : `this wave would be ${M.formatLength(lam / AIR_REFRACTIVE_INDEX.n, 5)} in air instead of ${M.formatLength(lam, 5)}`}.`);
  const pitch = pixelPitch();
  setText(equations.px, lam < pitch
    ? `${smallLength(pitch)} ÷ ${M.formatLength(lam)} = ${sig(pitch / lam, 3)} wavelengths per pixel`
    : `one wavelength = ${M.formatLength(lam)} ÷ ${smallLength(pitch)} = ${sig(lam / pitch, 3)} pixels`);

  const d = state.holeD;
  const lc = M.te11Cutoff(d);
  const alpha = M.belowCutoffAttenuation(MICROWAVE_LAMBDA, lc);
  setText(equations.lc, `p′₁₁ = ${M.P11.toFixed(4)} (first zero of J₁′): π × ${M.formatLength(d)} ÷ ${M.P11.toFixed(4)} = ${M.formatLength(lc)}`);
  setText(equations.alpha, alpha > 0
    ? `λ = ${M.formatLength(MICROWAVE_LAMBDA)}, λc = ${M.formatLength(lc)}: α = ${sig(alpha, 3)} per metre (the field falls by e every ${M.formatLength(1 / alpha)})`
    : `λ = ${M.formatLength(MICROWAVE_LAMBDA)} is shorter than λc = ${M.formatLength(lc)}: the wave travels through (α = 0)`);
  setText(equations.loss, alpha > 0
    ? `${sigT(M.lossDb(alpha, 1e-3), 3)} dB per millimetre of depth, ${sigT(M.lossDb(alpha, d), 3)} dB per hole diameter`
    : 'no fading: the hole is above cut-off for these microwaves');

  const L = state.L;
  setText(equations.fn, `${state.n} × ${speedText(v)} ÷ (2 × ${M.formatLength(L)}) = ${M.formatFrequency(modeFreq())}`);
  setText(equations.lamN, `2 × ${M.formatLength(L)} ÷ ${state.n} = ${M.formatLength(M.modeWavelength(state.n, L))}`);
  setText(equations.scale, `1 m = ${fmt(sim.k, 0)} CSS px on this screen (${scaleSourceText(sim.scale)})`);
}

/** The animation badge: the motion on this page is always slowed, never real time. */
function updateBadge() {
  const b = $('anim-badge');
  b.hidden = state.view === 'door';
  let text;
  if (state.view === 'standing') text = `real ${M.formatFrequency(modeFreq())}, shown at ${STANDING_SHOWN_HZ} Hz`;
  else text = `real ${M.formatFrequency(state.f)}`;
  setText(b, `${sim.paused ? 'PAUSED' : 'SLOWED'} · ${text}`);
}

/** What the current wave is, for labels: the preset name, or e.g. "Sound of 440 Hz". */
function waveName() {
  if (state.name) return state.name;
  return state.medium === 'em' ? `A ${M.formatFrequency(state.f)} wave` : `Sound of ${M.formatFrequency(state.f)}`;
}

function summary() {
  if (state.view === 'door') {
    const lc = M.te11Cutoff(state.holeD);
    return `Hole ${M.formatLength(state.holeD)} across: cut-off wavelength ${M.formatLength(lc)}. Microwaves of ${M.formatLength(MICROWAVE_LAMBDA)} are ${MICROWAVE_LAMBDA > lc ? 'blocked' : 'not blocked'}.`;
  }
  if (state.view === 'standing') {
    return `Mode ${state.n} between walls ${M.formatLength(state.L)} apart: ${M.formatFrequency(modeFreq())}.`;
  }
  return `${M.formatFrequency(state.f)}: wavelength ${M.formatLength(lambda())} at ${speedText()}.`;
}

/** Canvas description for screen readers. */
function describe() {
  const scaleWord = sim.scale.calibrated ? 'true-size' : 'approximately true-size';
  const pausedWord = sim.paused ? ', paused' : '';
  if (state.view === 'door') {
    const lc = M.te11Cutoff(state.holeD);
    const alpha = M.belowCutoffAttenuation(MICROWAVE_LAMBDA, lc);
    return `Microwave door, ${scaleWord} drawing: one 2.45 gigahertz microwave wavelength (${M.formatLength(MICROWAVE_LAMBDA)}) over a strip of door mesh with ${M.formatLength(state.holeD)} holes, the hole's cut-off wavelength of ${M.formatLength(lc)}, and green light at 532 nanometres, far smaller than a pixel. Graph: ${alpha > 0 ? `microwave power falls by ${sigT(M.lossDb(alpha, 1e-3), 3)} decibels per millimetre inside the hole, while light passes` : 'the hole is wider than the cut-off, so microwaves pass'}.`;
  }
  if (state.view === 'standing') {
    const fits = state.L * sim.k <= sim.width - 2 * MARGIN - 20;
    return `Standing waves, ${fits ? scaleWord : 'scaled to fit'}: mode ${state.n} between two hard walls ${M.formatLength(state.L)} apart, ${M.formatFrequency(modeFreq())}, drawn oscillating slowly at ${STANDING_SHOWN_HZ} hertz${pausedWord}.`;
  }
  const lam = lambda();
  const lamPx = lam * sim.k;
  const extra = lamPx * (sim.view?.dpr || 1) < PIXEL_MODE_DEVICE_PX
    ? `Too small to draw: about ${sig(pixelPitch() / lam, 3)} wavelengths fit across one pixel, shown in a magnified pixel.`
    : lamPx > sim.width - 2 * MARGIN
      ? `Longer than the canvas: ${M.formatLength((sim.width - 2 * MARGIN) / sim.k)} is shown and the wavelength carries on off screen.`
      : `About ${sig((sim.width - 2 * MARGIN) / lamPx, 3)} wavelengths across the canvas.`;
  return `${scaleWord} wave: ${waveName()}, ${M.formatFrequency(state.f)} at ${speedText()}, one wavelength ${M.formatLength(lam)} marked by a dimension line. ${extra} The wave is drawn moving slowly${pausedWord}.`;
}

/* =========================================================================
 * 4. Step: only the drawn motion moves (both animations are slowed)
 * ====================================================================== */

function step(simDt) {
  if (state.view === 'wave') {
    const lamPx = Math.max(1e-9, lambda() * sim.k);
    // Cycles per second of the drawn wave: slow enough to follow on screen.
    const rate = Math.min(WAVE_SHOWN_CYCLES_PER_S, WAVE_SHOWN_MAX_PX_PER_S / lamPx);
    state.phase = (state.phase + rate * simDt) % 1;
  } else if (state.view === 'standing') {
    state.standPhase = (state.standPhase + TAU * STANDING_SHOWN_HZ * simDt) % TAU;
  }
}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre)
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  updateBadge();
  if (state.view === 'door') drawDoor(ctx, w, h, k, colors);
  else if (state.view === 'standing') drawStanding(ctx, w, h, k, colors);
  else drawWave(ctx, w, h, k, colors);
}

/** TRUE SIZE badge (or a warning while the screen isn't calibrated). */
function trueSizeTag(ctx, colors, x, y, align = 'left') {
  const ok = sim.scale.calibrated;
  return drawTag(ctx, ok ? 'TRUE SIZE 1:1' : 'TRUE SIZE 1:1 once calibrated (approximate now)', x, y, {
    align, color: ok ? colors.ok : colors.warn, background: ok ? colors.okBg : colors.warnBg,
  });
}

function magnifiedTag(ctx, colors, m, x, y, align = 'left') {
  return drawTag(ctx, `MAGNIFIED ×${sig(m, 2)}`, x, y, { align, color: colors.warn, background: colors.warnBg });
}

/** Text helper. */
function text(ctx, s, x, y, { color, font = FONT, align = 'left', baseline = 'alphabetic', maxWidth } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (maxWidth) ctx.fillText(s, x, y, maxWidth);
  else ctx.fillText(s, x, y);
}

/** Path of y = mid − amp·sin(2π((x − originX)/lamPx − phase)) from xa to xb. */
function sinePath(ctx, xa, xb, mid, amp, lamPx, phase, originX) {
  const stepPx = clamp(lamPx / 16, 0.25, 3);
  ctx.beginPath();
  for (let x = xa; ; x += stepPx) {
    const xx = Math.min(x, xb);
    const y = mid - amp * Math.sin(TAU * ((xx - originX) / lamPx - phase));
    if (x === xa) ctx.moveTo(xx, y);
    else ctx.lineTo(xx, y);
    if (xx >= xb) break;
  }
}

/**
 * Static horizontal dimension line x0..x1 at y, with end stops and a label
 * above (inside when it fits, else beside it). openRight: the length carries
 * on past x1 (arrow instead of a stop).
 */
function drawDimension(ctx, x0, x1, y, label, colors, { w = Infinity, openRight = false, color = colors.fg, font = FONT_BOLD } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(openRight ? x1 - 6 : x1, y);
  ctx.moveTo(x0, y - 7);
  ctx.lineTo(x0, y + 7);
  if (!openRight) {
    ctx.moveTo(x1, y - 7);
    ctx.lineTo(x1, y + 7);
  }
  ctx.stroke();
  if (openRight) drawArrowHead(ctx, x1, y, 1, 0, 10);
  ctx.font = font;
  const tw = ctx.measureText(label).width;
  if (tw + 10 <= x1 - x0) {
    text(ctx, label, (x0 + x1) / 2, y - 7, { color, font, align: 'center', baseline: 'bottom' });
  } else if (x1 + 10 + tw <= w - 6) {
    text(ctx, label, x1 + 10, y, { color, font, baseline: 'middle' });
  } else {
    text(ctx, label, x0 - 10, y, { color, font, align: 'right', baseline: 'middle' });
  }
  ctx.restore();
}

/* ---------- Wavelength view ---------- */

function drawWave(ctx, w, h, k, colors) {
  const lam = lambda();
  const dpr = sim.view.dpr;
  const lamPx = lam * k;
  if (lamPx * dpr < PIXEL_MODE_DEVICE_PX) {
    drawPixelZoom(ctx, w, h, k, colors, lam);
    return;
  }
  const x0 = MARGIN;
  const span = w - 2 * MARGIN;
  const fits = lamPx <= span;
  const axisY = Math.round(h * 0.5) + 6;
  const amp = clamp(h * 0.2, 22, 190);
  const dimY = axisY - amp - 26;

  trueSizeTag(ctx, colors, 12, 22);
  text(ctx, `${waveName()}${state.medium === 'em' ? '' : ` in ${conditionsText()}`}: one wavelength = ${M.formatLength(lam)}`, 12, 54,
    { color: colors.fg, font: FONT_BOLD, maxWidth: w - 24 });

  // Axis and the wave (lengths true size; height illustrative)
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, axisY);
  ctx.lineTo(w, axisY);
  ctx.stroke();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = lamPx < 10 ? 1 : 2.5;
  sinePath(ctx, 0, w, axisY, amp, lamPx, state.phase, x0);
  ctx.stroke();

  // Fixed guides and dimension line for exactly one wavelength
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (const x of fits ? [x0, x0 + lamPx] : [x0]) {
    ctx.moveTo(x, dimY + 8);
    ctx.lineTo(x, axisY + amp + 8);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  drawDimension(ctx, x0, fits ? x0 + lamPx : w - 8, dimY,
    fits ? `λ = ${M.formatLength(lam)}` : `λ = ${M.formatLength(lam)}: carries on off screen`,
    colors, { w, openRight: !fits });

  // Only a few pixels per wave: add a magnified inset of four wavelengths (top right, clear of the dimension line)
  if (lamPx * dpr < 16) {
    const W = Math.min(420, w * 0.35);
    const H = dimY - 76;
    if (H >= 60) {
      const bx = w - W - 16;
      const by = 66;
      const lamIn = W / 4;
      ctx.fillStyle = colors.bg;
      ctx.fillRect(bx, by, W, H);
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, W - 1, H - 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(bx, by, W, H);
      ctx.clip();
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2;
      sinePath(ctx, bx, bx + W, by + H * 0.66, H * 0.22, lamIn, state.phase, bx);
      ctx.stroke();
      ctx.restore();
      magnifiedTag(ctx, colors, lamIn / lamPx, bx, by - 13);
      drawDimension(ctx, bx + lamIn * 0.5, bx + lamIn * 1.5, by + 24, `λ = ${M.formatLength(lam)}`, colors, { w: bx + W });
    }
  }

  // True-scale ruler under the wave
  const rulerY = axisY + amp + 22;
  drawRuler(ctx, colors, { x: x0, y: rulerY, lengthM: (w - x0 - 8) / k, k });

  // Longer than the canvas: the whole wavelength, scaled down, with the part on screen marked
  if (!fits) drawOverview(ctx, w, colors, rulerY + 66, span, lamPx);

  // Off-screen / count note (static)
  const shownM = span / k;
  const note = fits
    ? `${sig(span / lamPx, 3)} wavelengths across ${M.formatLength(shownM)} of canvas · one wavelength = ${fmt(lamPx * dpr, 0)} pixels on this screen`
    : `One wavelength is ${M.formatLength(lam)}: ${M.formatLength(shownM)} of it is on screen and it carries on for another ${M.formatLength(lam - shownM)} to the right (${sigWords(lam / shownM, 3, sig)} canvas widths in all).`;
  text(ctx, note, 12, h - 12, { color: colors.muted, maxWidth: w - 24 });
}

/** One whole wavelength shrunk to fit (badged SCALED), with the part on screen highlighted. */
function drawOverview(ctx, w, colors, y, span, lamPx) {
  const tagW = drawTag(ctx, `WHOLE WAVELENGTH, SCALED 1 : ${sigWords(lamPx / span, 2, sig)}`, MARGIN, y, {
    color: colors.warn, background: colors.warnBg,
  });
  const sx0 = MARGIN + tagW + 16;
  const sw = w - MARGIN - sx0;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  sinePath(ctx, sx0, sx0 + sw, y, 9, sw, 0, sx0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(sx0, y - 12);
  ctx.lineTo(sx0, y + 12);
  ctx.moveTo(sx0 + sw, y - 12);
  ctx.lineTo(sx0 + sw, y + 12);
  ctx.stroke();
  const part = Math.max(2, (sw * span) / lamPx);
  ctx.fillStyle = withAlpha(colors.accentRgb, 0.22);
  ctx.fillRect(sx0, y - 14, part, 28);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx0, y - 14, part, 28);
  const pct = (100 * span) / lamPx;
  const share = pct >= 0.1 ? `${sig(pct, 2)}%` : `1/${sigWords(lamPx / span, 3)}`;
  drawTag(ctx, `▲ the part on this screen: ${share} of one wavelength`, sx0, y + 30, {
    color: colors.fg, background: colors.bg, border: colors.track, font: FONT,
  });
}

/**
 * Light and other sub-pixel waves: one real pixel at true size, the same pixel
 * magnified with the waves drawn inside it at the same magnification, and (when
 * those are still too fine) a further zoom on a few wavelengths.
 */
function drawPixelZoom(ctx, w, h, k, colors, lam) {
  const dpr = sim.view.dpr;
  const pitch = pixelPitch();
  const N = pitch / lam; // wavelengths per pixel
  const top = 78;
  const bottom = h - 34;

  text(ctx, N >= 1.5
    ? `${waveName()}: about ${sig(N, 3)} wavelengths fit across one pixel of this screen`
    : `${waveName()}: one wavelength is ${sigT(1 / N, 2)} pixels, too small to draw at true size`,
  12, 54, { color: colors.fg, font: FONT_BOLD, maxWidth: w - 24 });

  // Panel 1: the real pixel, true size
  const p1w = clamp(w * 0.16, 140, 240);
  trueSizeTag(ctx, colors, 12, 22);
  const cy = (top + bottom) / 2;
  const px = Math.round((12 + p1w / 2) * dpr) / dpr;
  const py = Math.round(cy * dpr) / dpr;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(px, py, 1 / dpr, 1 / dpr);
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(px + 0.5 / dpr, py + 0.5 / dpr, 12, 0, TAU);
  ctx.stroke();
  text(ctx, '1 pixel, true size', px, py + 34, { color: colors.fg, font: FONT_BOLD, align: 'center' });
  text(ctx, `${smallLength(pitch)} across`, px, py + 52, { color: colors.muted, align: 'center' });
  text(ctx, `holds ${N >= 1.5 ? `${sig(N, 3)} waves` : 'about one wave'}`, px, py + 70, { color: colors.muted, align: 'center' });

  // Panel 2: the pixel magnified, waves inside at the same magnification
  const x2 = 12 + p1w + 28;
  const room = w - x2 - 16;
  const availH = bottom - top - 54; // room for the tags above and the captions below the panels
  const S1a = Math.min(availH, room * 0.42);
  const zoomNeeded = S1a / N < 24;
  const S1 = zoomNeeded ? S1a : Math.min(availH, room * 0.7);
  const y2 = top + 26 + (availH - S1) / 2;
  const M1 = S1 * dpr; // a device pixel is 1/dpr CSS px wide
  magnifiedTag(ctx, colors, M1, x2, y2 - 16);
  SUBPIXEL_RGB.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(x2 + (i * S1) / 3, y2, S1 / 3, S1);
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1;
  ctx.strokeRect(x2 + 0.5, y2 + 0.5, S1 - 1, S1 - 1);
  text(ctx, 'the same pixel, with its red, green and blue sub-pixels', x2, y2 + S1 + 16, { color: colors.muted, maxWidth: S1 });

  const lam1 = S1 / N; // CSS px per wavelength at this magnification
  const mid2 = y2 + S1 / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x2, y2, S1, S1);
  ctx.clip();
  ctx.strokeStyle = colors.accent;
  if (lam1 >= 3) {
    ctx.lineWidth = lam1 < 10 ? 1 : 2;
    sinePath(ctx, x2, x2 + S1, mid2, S1 * 0.2, lam1, state.phase, x2);
    ctx.stroke();
  } else {
    // Too fine to draw each wave at this magnification: one line per m wavelengths.
    const m = niceStep(5 / lam1);
    const gap = m * lam1;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x2 + (state.phase * lam1) % gap; x <= x2 + S1; x += gap) {
      ctx.moveTo(x, mid2 - S1 * 0.2);
      ctx.lineTo(x, mid2 + S1 * 0.2);
    }
    ctx.stroke();
    ctx.restore();
    ctx.save();
    drawTag(ctx, `each line = ${sig(m, 1)} wavelengths`, x2 + S1 / 2, y2 + S1 - 22, {
      align: 'center', color: colors.fg, background: colors.bg, border: colors.track, font: FONT,
    });
  }
  ctx.restore();
  if (!zoomNeeded && lam1 <= S1 - 8) {
    drawDimension(ctx, x2 + 4, x2 + 4 + lam1, y2 + S1 * 0.18, `λ = ${M.formatLength(lam)}`, colors, { w });
  }

  // Panel 3: zoom on a few wavelengths
  if (zoomNeeded) {
    const cycles = 6;
    const x3 = x2 + S1 + 56;
    const W3 = w - x3 - 16;
    const H3 = S1;
    const bw = Math.max(6, cycles * lam1); // zoom box width in panel-2 px
    const zoom = W3 / bw;
    const bh = H3 / zoom;
    const bx = x2 + S1 * 0.08;
    const by = mid2 - bh / 2;
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, Math.max(bh, 2));
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(bx + bw, by);
    ctx.lineTo(x3, y2);
    ctx.moveTo(bx + bw, by + bh);
    ctx.lineTo(x3, y2 + H3);
    ctx.stroke();
    ctx.setLineDash([]);
    magnifiedTag(ctx, colors, M1 * zoom, x3, y2 - 16);
    ctx.strokeStyle = colors.fg;
    ctx.strokeRect(x3 + 0.5, y2 + 0.5, W3 - 1, H3 - 1);
    const lam3 = lam1 * zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x3, y2, W3, H3);
    ctx.clip();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2.5;
    sinePath(ctx, x3, x3 + W3, y2 + H3 / 2, H3 * 0.22, lam3, state.phase, x3);
    ctx.stroke();
    ctx.restore();
    drawDimension(ctx, x3 + lam3 * 0.5, x3 + lam3 * 1.5, y2 + H3 * 0.16, `λ = ${M.formatLength(lam)}`, colors, { w });
    text(ctx, `${cycles} wavelengths from the box in the pixel`, x3, y2 + H3 + 16, { color: colors.muted, maxWidth: W3 });
  }

  text(ctx, `1 pixel = ${smallLength(pitch)} (${scaleSourceText(sim.scale)}) · λ = ${M.formatLength(lam)} · ${N >= 1 ? `about ${sig(N, 3)} wavelengths per pixel` : `${sigT(1 / N, 2)} pixels per wavelength`}`,
    12, h - 12, { color: colors.muted, maxWidth: w - 24 });
}

/* ---------- Microwave door view ---------- */

function drawDoor(ctx, w, h, k, colors) {
  const d = state.holeD;
  const lc = M.te11Cutoff(d);
  const alpha = M.belowCutoffAttenuation(MICROWAVE_LAMBDA, lc);
  const dpr = sim.view.dpr;
  const chartW = clamp(w * 0.4, 300, 760);
  const leftEnd = w - chartW - 40;
  const x0 = MARGIN;

  const tagW = trueSizeTag(ctx, colors, 12, 22);
  text(ctx, 'everything left of the graph; the graph is not to scale', 12 + tagW + 10, 22, { color: colors.muted, baseline: 'middle' });

  // Column A: one microwave wavelength (2.45 GHz) over a strip of door mesh, both true size
  const lamPx = MICROWAVE_LAMBDA * k;
  const colB = x0 + lamPx + 56;
  const side = leftEnd - colB >= 260; // room for the three items beside the wave?
  const xw1 = Math.min(x0 + lamPx, leftEnd);
  const amp = clamp(h * 0.1, 16, 60);
  const dimY = 84;
  const axisY = dimY + 20 + amp;
  text(ctx, `Oven microwaves, ${M.formatFrequency(MICROWAVE_HZ)}: one wavelength`, x0, dimY - 30, { color: colors.fg, font: FONT_BOLD });
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, axisY);
  ctx.lineTo(xw1, axisY);
  ctx.stroke();
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2.5;
  sinePath(ctx, x0, xw1, axisY, amp, lamPx, 0, x0);
  ctx.stroke();
  drawDimension(ctx, x0, xw1, dimY, `λ = ${M.formatLength(MICROWAVE_LAMBDA)}`, colors, { w: leftEnd, openRight: xw1 < x0 + lamPx });

  const pitch = d * MESH_PITCH_RATIO;
  const dPx = d * k;
  const pPx = pitch * k;
  const rowGap = (pPx * Math.sqrt(3)) / 2; // triangular pattern
  const stripTop = axisY + amp + 26;
  const rows = clamp(Math.floor((Math.min(70, h * 0.14) - pPx) / rowGap) + 1, 1, 6);
  const stripH = clamp((rows - 1) * rowGap + pPx, 22, Math.min(70, h * 0.14));
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, stripTop, xw1 - x0, stripH);
  ctx.clip();
  ctx.fillStyle = colors.track;
  ctx.fillRect(x0, stripTop, xw1 - x0, stripH);
  ctx.fillStyle = colors.bg;
  for (let r = 0; r <= rows; r++) {
    const cy = stripTop + stripH / 2 + (r - (rows - 1) / 2) * rowGap;
    for (let cx = x0 + pPx / 2 + (r % 2 ? pPx / 2 : 0); cx - dPx / 2 < xw1; cx += pPx) {
      ctx.beginPath();
      ctx.arc(cx, cy, dPx / 2, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  text(ctx, `Door mesh: ${M.formatLength(d)} holes, ${M.formatLength(pitch)} apart`, x0, stripTop + stripH + 20, { color: colors.fg, font: FONT_BOLD, maxWidth: xw1 - x0 });
  text(ctx, `about ${sig(MICROWAVE_LAMBDA / pitch, 2)} holes along one wavelength`, x0, stripTop + stripH + 38, { color: colors.muted, maxWidth: xw1 - x0 });

  // Column B (or a row underneath): one hole, its cut-off wavelength, and green light, all true size
  const bx = side ? colB : x0;
  const bw = side ? leftEnd - colB : leftEnd - x0;
  const itemY = [dimY - 6, dimY + 80, dimY + 166];
  const rowY = stripTop + stripH + 92;
  const slot = bw / 3;
  const at = (i) => (side ? { x: bx, y: itemY[i] } : { x: bx + i * slot, y: rowY });
  const maxItemPx = side ? 46 : 60;

  { // (a) one hole
    const { x, y } = at(0);
    const shown = Math.min(dPx, maxItemPx);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 1, y + 10, maxItemPx + 2, maxItemPx + 2);
    ctx.clip();
    ctx.fillStyle = colors.track;
    ctx.beginPath();
    // Too big for the slot: show the top of the hole, centred in it.
    ctx.arc(x + (dPx > maxItemPx ? maxItemPx : dPx) / 2, y + 12 + dPx / 2, dPx / 2, 0, TAU);
    ctx.fill();
    ctx.restore();
    drawDimension(ctx, x, x + shown, y, `one hole: d = ${M.formatLength(d)}${dPx > maxItemPx ? ' (cropped)' : ''}`, colors, { w: x + (side ? bw : slot) });
  }
  { // (b) the cut-off wavelength
    const { x, y } = at(1);
    const lcPx = lc * k;
    const room = side ? bw - 8 : slot - 20;
    const xe = x + Math.min(lcPx, room);
    drawDimension(ctx, x, xe, y, `cut-off λc = 1.706 d = ${M.formatLength(lc)}`, colors, { w: x + room + 8, color: colors.ref, openRight: lcPx > room });
    ctx.strokeStyle = colors.ref;
    ctx.lineWidth = 2;
    sinePath(ctx, x, xe, y + 22, 8, lcPx, 0, x);
    ctx.stroke();
    text(ctx, 'the longest wave that can', x, y + 46, { color: colors.muted, maxWidth: room });
    text(ctx, 'travel through the hole', x, y + 64, { color: colors.muted, maxWidth: room });
  }
  { // (c) green light: one pixel holds hundreds of its waves
    const { x, y } = at(2);
    const px = Math.round((x + 9) * dpr) / dpr;
    const py = Math.round(y * dpr) / dpr;
    ctx.fillStyle = colors.ok;
    ctx.fillRect(px, py, 1 / dpr, 1 / dpr);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px + 0.5 / dpr, py + 0.5 / dpr, 9, 0, TAU);
    ctx.stroke();
    const room = side ? bw - 30 : slot - 30;
    text(ctx, `green light, λ = ${M.formatLength(LIGHT_LAMBDA)}`, x + 26, y, { color: colors.fg, font: FONT_BOLD, baseline: 'middle', maxWidth: room });
    text(ctx, `each wave is 1/${fmt(pixelPitch() / LIGHT_LAMBDA, 0)} of the ringed pixel:`, x, y + 32, { color: colors.muted, maxWidth: room + 26 });
    text(ctx, `${sig(d / LIGHT_LAMBDA, 3)} of them fit across one hole`, x, y + 50, { color: colors.muted, maxWidth: room + 26 });
  }

  // Tall canvas (full screen): one hole magnified, with half the cut-off wavelength across it
  const panelTop = Math.max(stripTop + stripH + 92, side ? itemY[2] + 96 : rowY + 110);
  const panelRoom = h - 44 - panelTop;
  const D = Math.min((panelRoom - 24) / 1.3, 220);
  if (D >= 120) {
    const mag = D / dPx;
    const plateW = D * 1.6;
    const px0 = x0;
    const py0 = panelTop + 22;
    magnifiedTag(ctx, colors, mag, px0, panelTop);
    ctx.fillStyle = colors.track;
    ctx.fillRect(px0, py0, plateW, D * 1.3);
    const hcx = px0 + plateW / 2;
    const hcy = py0 + D * 0.65;
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.arc(hcx, hcy, D / 2, 0, TAU);
    ctx.fill();
    // Half a cut-off wavelength (0.853 d) spans the hole
    const halfLc = (lc / 2 / d) * D;
    ctx.strokeStyle = colors.ref;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const x = hcx - halfLc / 2 + (i / 48) * halfLc;
      const y = hcy - D * 0.28 * Math.sin((Math.PI * i) / 48);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    drawDimension(ctx, hcx - D / 2, hcx + D / 2, hcy + D * 0.24, `d = ${M.formatLength(d)}`, colors, { w: leftEnd });
    const tx = px0 + plateW + 24;
    const tw = leftEnd - tx;
    if (tw > 200) {
      const lines = [
        [`One hole, magnified ×${sig(mag, 2)}.`, colors.fg, FONT_BOLD],
        [`About half a wavelength has to fit across a hole for a wave to`, colors.muted, FONT],
        [`get through: the arch is half the cut-off wavelength (${M.formatLength(lc / 2)}).`, colors.muted, FONT],
        [`At this magnification half a microwave wave would be ${M.formatLength((MICROWAVE_LAMBDA / 2) * mag)} long,`, colors.muted, FONT],
        [`so it cannot get in. Each wave of green light would be`, colors.muted, FONT],
        [`${sigT(LIGHT_LAMBDA * k * mag, 2)} px: thousands fit across the hole, so light passes.`, colors.muted, FONT],
      ];
      lines.forEach(([s, c, f], i) => text(ctx, s, tx, py0 + 14 + i * 20, { color: c, font: f, maxWidth: tw }));
    }
  }

  // Verdict (static)
  const verdict = alpha > 0
    ? `Microwaves are ${sigT(MICROWAVE_LAMBDA / lc, 2)} times longer than the cut-off: blocked. Light is ${sig(lc / LIGHT_LAMBDA, 2)} times shorter: it passes.`
    : `This hole is wider than ${M.formatLength(M.holeForCutoff(MICROWAVE_LAMBDA), 2)}: its cut-off is longer than the microwaves, so they get through.`;
  drawTag(ctx, verdict, 12, h - 20, alpha > 0
    ? { color: colors.fg, background: colors.bg, border: colors.track, font: FONT_BOLD }
    : { color: colors.warn, background: colors.warnBg, font: FONT_BOLD });

  // Graph: power left vs depth into the hole (not to scale)
  const box = { x: w - chartW + 24, y: 84, w: chartW - 44, h: Math.max(120, h - 84 - 92) };
  const zMaxMm = 2 * d * 1000;
  const lossAtMax = M.lossDb(alpha, zMaxMm / 1000);
  const yMin = -Math.max(10, Math.ceil((lossAtMax + 1e-9) / 10) * 10);
  const { X, Y } = drawChart(ctx, colors, {
    box,
    xr: [0, zMaxMm],
    yr: [yMin, 0],
    series: [
      { points: [[0, 0], [zMaxMm, 0]], color: colors.ok, width: 2.5 },
      { points: [[0, 0], [zMaxMm, -lossAtMax]], color: colors.accent, width: 2.5 },
    ],
    title: `Power left inside a ${M.formatLength(d)} hole (dB)`,
    xLabel: 'depth (mm)',
    xFmt: (v) => sigT(v, 3),
    yFmt: (v) => (v === 0 ? '0' : sigT(v, 3)),
  });
  text(ctx, 'green light: passes, no fading', X(zMaxMm) - 4, Y(0) + 14, { color: colors.ok, font: FONT_BOLD, align: 'right' });
  if (alpha > 0) {
    const zLabel = zMaxMm * 0.35;
    // Above the falling line, starting at zLabel: the line only drops away to the right of it.
    text(ctx, `microwaves: −${sigT(M.lossDb(alpha, 1e-3), 3)} dB per mm`, X(zLabel) + 10, Y(-M.lossDb(alpha, zLabel / 1000)) - 6,
      { color: colors.accent, font: FONT_BOLD, baseline: 'bottom' });
  } else {
    text(ctx, 'microwaves: get through too (above cut-off)', X(zMaxMm) - 4, Y(0) + 32, { color: colors.warn, font: FONT_BOLD, align: 'right' });
  }
  text(ctx, '−10 dB = 1/10 of the power, −20 dB = 1/100, −60 dB = one millionth', box.x, box.y + box.h + 38, { color: colors.muted, maxWidth: box.w });
}

/* ---------- Standing waves view ---------- */

function drawStanding(ctx, w, h, k, colors) {
  const L = state.L;
  const n = state.n;
  const kind = modeKind();
  const avail = w - 2 * MARGIN - 20;
  const fits = L * k <= avail;
  const s = fits ? k : avail / L; // px per metre actually used
  const x0 = (w - L * s) / 2;
  const x1 = x0 + L * s;
  const boxH = clamp(h * 0.42, 70, 460);
  const mid = Math.round(h * 0.5);
  const top = mid - boxH / 2;
  const bot = mid + boxH / 2;
  const A = boxH * 0.4;

  if (fits) trueSizeTag(ctx, colors, 12, 22);
  else drawTag(ctx, `SCALED TO FIT 1 : ${sigT(k / s, k / s < 10 ? 3 : 2)}, not true size`, 12, 22, { color: colors.warn, background: colors.warnBg });
  text(ctx, `Mode ${n} between hard walls ${M.formatLength(L)} apart: ${M.formatFrequency(modeFreq())} (${state.medium === 'em' ? 'radio waves' : `sound in ${conditionsText()}`})`,
    12, 54, { color: colors.fg, font: FONT_BOLD, maxWidth: w - 24 });

  // Box: two walls and the tube between them
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x1, top);
  ctx.moveTo(x0, bot);
  ctx.lineTo(x1, bot);
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  ctx.fillRect(x0 - 8, top - 6, 8, boxH + 12);
  ctx.fillRect(x1, top - 6, 8, boxH + 12);
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(x0, mid);
  ctx.lineTo(x1, mid);
  ctx.stroke();
  ctx.setLineDash([]);

  // Envelope (fixed) and the wave now (slowed)
  const pts = Math.max(64, Math.ceil((x1 - x0) / 2));
  const shapeAt = (i) => M.modeShape(kind, n, (i / pts) * L, L);
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  for (const sign of [1, -1]) {
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const x = x0 + (i / pts) * (x1 - x0);
      const y = mid - sign * A * Math.abs(shapeAt(i));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const c = Math.cos(state.standPhase);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const x = x0 + (i / pts) * (x1 - x0);
    const y = mid - A * c * shapeAt(i);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Nodes (fixed)
  const nodes = M.nodePositions(kind, n, L);
  ctx.fillStyle = colors.fg;
  for (const xn of nodes) {
    ctx.beginPath();
    ctx.arc(x0 + xn * s, mid, 3.5, 0, TAU);
    ctx.fill();
  }
  if ((L / n) * s > 44) {
    for (const xn of nodes) {
      if (xn > 1e-9 && xn < L - 1e-9) text(ctx, 'node', x0 + xn * s, mid + 16, { color: colors.muted, align: 'center', baseline: 'top' });
    }
  }
  text(ctx, kind === 'pressure'
    ? 'Sound pressure: largest at the hard walls, zero at the nodes'
    : 'Electric field: zero at the metal walls and at the nodes',
  x0, top - 14, { color: colors.muted, maxWidth: Math.max(200, x1 - x0) });

  // Static dimensions: L below the box, λ/2 above it
  drawDimension(ctx, x0, x1, bot + 26, `L = ${M.formatLength(L)}`, colors, { w });
  if (n > 1) {
    drawDimension(ctx, x0, x0 + (L / n) * s, top - 40, `λ/2 = ${M.formatLength(L / n)}`, colors, { w, color: colors.accent });
  } else {
    text(ctx, `λ/2 = L: half a wavelength fits (λ = ${M.formatLength(2 * L)})`, x0, top - 34, { color: colors.accent, font: FONT_BOLD });
  }
  if (fits) drawRuler(ctx, colors, { x: x0, y: bot + 48, lengthM: Math.min(L, (w - x0 - 8) / k), k });

  text(ctx, `Real frequency ${M.formatFrequency(modeFreq())}: drawn ${sigWords(modeFreq() / STANDING_SHOWN_HZ, 2, sig)} times slower, at ${STANDING_SHOWN_HZ} Hz`,
    12, h - 12, { color: colors.muted, maxWidth: w - 24 });
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

/** Static numbers in the explainer, computed from the cited data (covered by the unit tests). */
function fillCalcs() {
  const calc = {};
  const vAir20 = M.soundSpeedAir(20, 0);
  const lamA4 = M.wavelength(vAir20, PRESETS.a4.f);
  const lam20 = M.wavelength(vAir20, PRESETS.hz20.f);
  const lam40k = M.wavelength(vAir20, ULTRASONIC_SENSOR.fHz);
  const wifi24 = BANDS.find((b) => b.id === 'wifi24');
  const wifi5 = BANDS.find((b) => b.id === 'wifi5');
  const range = (a, b, n) => {
    const u = M.pickUnit(Math.min(a, b), M.LENGTH_UNITS);
    return `${sigT(Math.min(a, b) / u.size, n)} to ${sigT(Math.max(a, b) / u.size, n)} ${u.unit}`;
  };
  const pitch24 = M.screenPixelPitch(24, 1920, 1080);
  const lc15 = M.te11Cutoff(DOOR_MESH.holeM);
  const vRoom = vAir20;
  Object.assign(calc, {
    vAir20: sigT(vAir20, 3),
    vAir20d: fmt(vAir20, 1),
    vWater20: fmt(M.soundSpeedWater(20), 0),
    a4m: fmt(lamA4, 3),
    a4: M.formatLength(lamA4, 2),
    hz20: M.formatLength(lam20, 2),
    hz20Court: M.comparisonText(lam20),
    khz40: M.formatLength(lam40k, 2),
    canD: `${sigT(ULTRASONIC_SENSOR.canDiameterM * 1e3, 3)} mm`,
    canLam: sigT(ULTRASONIC_SENSOR.canDiameterM / lam40k, 2),
    canDir: String(ULTRASONIC_SENSOR.directivityDeg),
    speakerD: M.formatLength((ULTRASONIC_SENSOR.canDiameterM / lam40k) * lamA4, 2),
    wifi24: range(M.wavelength(C_LIGHT, wifi24.hi), M.wavelength(C_LIGHT, wifi24.lo), 3),
    wifiQuarter: M.formatLength(M.wavelength(C_LIGHT, PRESETS.wifi24.f) / 4, 2),
    wifiHalf: M.formatLength(M.wavelength(C_LIGHT, PRESETS.wifi24.f) / 2, 2),
    oven: M.formatLength(MICROWAVE_LAMBDA, 3),
    wifi5: range(M.wavelength(C_LIGHT, wifi5.hi), M.wavelength(C_LIGHT, wifi5.lo), 2),
    fm: M.formatLength(M.wavelength(C_LIGHT, PRESETS.fm.f), 2),
    fmQuarter: M.formatLength(M.wavelength(C_LIGHT, PRESETS.fm.f) / 4, 2),
    pitch24: `${sigT(pitch24 * 1e3, 3)} mm`,
    red24: fmt(pitch24 / PRESETS.red.lambda, 0),
    violet24: fmt(pitch24 / PRESETS.violet.lambda, 0),
    green24: fmt(pitch24 / GREEN_LASER_M, 0),
    meshHole: M.formatLength(DOOR_MESH.holeM),
    meshHole2: M.formatLength(DOOR_MESH.holeM),
    meshPitch: M.formatLength(DOOR_MESH.pitchM),
    lc15: M.formatLength(lc15),
    lc2: M.formatLength(M.te11Cutoff(2e-3)),
    lamOverLc: fmt(MICROWAVE_LAMBDA / lc15, 0),
    dbPerD: fmt(M.lossDb(M.belowCutoffAttenuation(Infinity, 1), 1 / M.TE11_CUTOFF_FACTOR), 0),
    dbPerMm: fmt(M.lossDb(M.belowCutoffAttenuation(MICROWAVE_LAMBDA, lc15), 1e-3), 0),
    greenAcross: sig(DOOR_MESH.holeM / GREEN_LASER_M, 3),
    leakD: M.formatLength(M.holeForCutoff(MICROWAVE_LAMBDA), 2),
    room1: M.formatFrequency(M.modeFrequency(1, vRoom, STANDING_PRESETS.room.L), 3),
    room2: sigT(M.modeFrequency(2, vRoom, STANDING_PRESETS.room.L), 3),
    room3: sigT(M.modeFrequency(3, vRoom, STANDING_PRESETS.room.L), 3),
    ovenW: `${fmt(OVEN_CAVITY.widthM * 1e3, 0)} mm`,
    ovenF1: M.formatFrequency(M.modeFrequency(1, C_LIGHT, OVEN_CAVITY.widthM), 3),
    ovenN: String(M.nearestMode(MICROWAVE_HZ, C_LIGHT, OVEN_CAVITY.widthM)),
    ovenHalf: M.formatLength(MICROWAVE_LAMBDA / 2, 1),
  });
  for (const el of document.querySelectorAll('[data-calc]')) {
    if (calc[el.dataset.calc] !== undefined) el.textContent = calc[el.dataset.calc];
  }
  return calc;
}

/** Sentence for the shared Pixel size card. */
function pixelLine(info) {
  const lam = lambda();
  const greenLine = `Green laser light (532 nm) is about ${fmt(info.pitch / GREEN_LASER_M, 0)} times smaller than one pixel on this screen.`;
  if (lam < info.pitch) return `${waveName()} is about ${sig(info.pitch / lam, 3)} times smaller than one pixel on this screen.`;
  return `${greenLine} The wave above, ${M.formatLength(lam)} long, spans ${sig(lam / info.pitch, 3)} pixels.`;
}

let pausedBeforeDoor = null;

const sim = createSim({
  step,
  draw,
  describe,
  pixelLine,
  onResize: () => { updateReadouts(); updateEquations(); },
  onScaleChange: () => { updateReadouts(); updateEquations(); sim.pixelCard?.update(); },
  debug: {
    state,
    lambda,
    speed,
    model: M,
    get scale() { return sim.scale; },
    get calc() { return fillCalcs(); },
  },
});

initTabs({
  name: 'view',
  values: ['wave', 'door', 'standing'],
  onChange: (view) => {
    const was = state.view;
    state.view = view;
    // The door view is a still drawing: pause the loop there and restore play state after.
    if (view === 'door' && was !== 'door') {
      pausedBeforeDoor = sim.paused;
      sim.setPaused(true);
    } else if (view !== 'door' && was === 'door' && pausedBeforeDoor !== null) {
      sim.setPaused(pausedBeforeDoor);
      pausedBeforeDoor = null;
    }
    updateMediumUI();
    updateBadge();
    updateEquations();
    sim.updateAria();
    sim.requestDraw();
  },
});

$('medium-select').addEventListener('change', (e) => setMedium(e.target.value));

initPresets({
  ...Object.fromEntries(Object.keys(PRESETS).map((id) => [id, () => applyPreset(id)])),
  holeTypical: () => { state.holeD = DOOR_MESH.holeM; paramsChanged(); },
  hole2: () => { state.holeD = 2e-3; paramsChanged(); },
  hole10: () => { state.holeD = 10e-3; paramsChanged(); },
  holeBig: () => { state.holeD = 80e-3; paramsChanged(); },
  room: () => applyStandingPreset('room'),
  guitar: () => applyStandingPreset('guitar'),
  ovenCavity: () => applyStandingPreset('oven'),
  modeDown: () => { state.n = Math.max(LIMITS.nMin, state.n - 1); paramsChanged(); },
  modeUp: () => { state.n = Math.min(LIMITS.nMax, state.n + 1); paramsChanged(); },
});

fillCalcs();
paramsChanged();
sim.start();
