/**
 * tolerance.js: ISO 286 limits and fits, at true size and magnified.
 *
 * Pick a nominal size and a hole-basis fit (H hole, shaft letter + grade). The
 * canvas shows three things side by side:
 *   - TRUE SIZE 1:1: an end-on section of the shaft in its hole at the nominal
 *     diameter. The gap is far below a pixel, so the two circles coincide; a tag
 *     says how many pixels it really is. Big parts show only the top region.
 *   - MAGNIFIED inset: a radial cut through the top of the shaft, as two strips:
 *     the loosest pair (largest hole, smallest shaft) and the tightest pair
 *     (smallest hole, largest shaft), with the gap (ok colour) or overlap (warn
 *     colour) dimensioned in µm, next to a human hair and one screen pixel drawn
 *     at the same magnification.
 *   - The classic ISO tolerance-zone diagram (deviations from the zero line).
 * Nothing moves: the sim loop only redraws when an input or the screen changes.
 *
 * Page pattern (as velocity.js): 1 constants + state, 2 setters, 3 UI sync,
 * 4 step, 5 draw, 6 wiring + start. Pure maths lives in tolerance-model.js and
 * the cited ISO 286 tables in data/tolerance-data.js.
 */

import { clamp, niceStep, niceFloor, devicePxPerMetreFromScreen, DEFAULT_SCREEN } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawScaleBar, drawArrowHead, FONT, FONT_BOLD } from './draw.js';
import { sigT } from './astro.js';
import * as M from './tolerance-model.js';
import { PREFERRED_FITS, ISO_PREFERRED_EXTRA, IT_FACTORS, IT_TABLE } from './data/tolerance-data.js';
import { PIXEL_REFERENCES } from './data/references.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const HAIR = PIXEL_REFERENCES.find((r) => r.id === 'hair');
const HAIR_UM = HAIR.typicalM * 1e6;          // typical human hair, µm (Ley 1999, references.js)
const PAD = 12;                               // canvas margin, CSS px
const MINUS = '−';

const state = {
  D: 25,            // nominal size, mm
  holeGrade: 7,     // H7
  letter: 'g',      // shaft fundamental deviation letter
  shaftGrade: 6,    // shaft IT grade
  mag: 'auto',      // 'auto' or a magnification from M.MAGNIFICATIONS
};

let fit = null;          // M.computeFit(...) for the current state
let magUsed = 2000;      // magnification the inset is drawn at (Auto resolved for the canvas size)
let geom = null;         // panel rectangles for the current canvas size

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const calcs = Object.fromEntries([...document.querySelectorAll('[data-calc]')].map((n) => [n.dataset.calc, n]));
const announce = createAnnouncer($('sr-summary'));

/* ---------- Formatting ---------- */

/** Size in mm without trailing zeros: 25, 24.5, 2.25. */
const fmtD = (D) => String(Number(D.toFixed(2)));
/** Deviation in µm with a real minus sign: +21, 0, −7, +10.5. */
const fmtDev = (v) => (v > 0 ? `+${fmtNum(v)}` : v < 0 ? `${MINUS}${fmtNum(-v)}` : '0');
const fmtNum = (v) => (Number.isInteger(v) ? fmt(v, 0) : fmt(v, 1));
/** Limit size in mm: 3 decimals, 4 when a js deviation ends in .5 µm. */
const fmtLimit = (mm, dev) => fmt(mm, Number.isInteger(dev) ? 3 : 4).replace('-', MINUS);
/** Small pixel counts to 2 significant figures: 0.076, 0.15, 1.2, 35. */
const fmtPx = (px) => (px >= 100 ? fmt(px, 0) : sigT(px, 2));
const fitName = (f) => `${fmtD(f.D)} ${f.label}`;
const rangeText = (r) => (r.lo === 0 ? `up to ${r.hi} mm` : `over ${r.lo} up to ${r.hi} mm`);

/** Physical pixel pitch (m) for this screen and zoom. */
const pitchM = () => M.pixelPitchM(sim.k, window.devicePixelRatio || 1);
const umToPx = (um) => M.micrometresInPixels(um, sim.k, window.devicePixelRatio || 1);

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setSize(D) {
  let v = clamp(D, M.SIZE_MIN, M.SIZE_MAX);
  // The log slider gives arbitrary values: snap them to tidy sizes. Typed sizes keep 0.01 mm.
  if (document.activeElement === $('size-range')) v = v < 10 ? Math.round(v * 10) / 10 : v < 100 ? Math.round(v) : Math.round(v / 5) * 5;
  else v = Math.round(v * 100) / 100;
  state.D = clamp(v, M.SIZE_MIN, M.SIZE_MAX);
  updateAll();
}

function setFit({ holeGrade = state.holeGrade, letter = state.letter, shaftGrade = state.shaftGrade } = {}) {
  Object.assign(state, { holeGrade, letter, shaftGrade });
  updateAll();
}

function setMag(value) {
  state.mag = value === 'auto' ? 'auto' : Number(value);
  updateAll();
}

const sizeParam = bindParam({
  range: $('size-range'), num: $('size-num'), min: M.SIZE_MIN, max: M.SIZE_MAX, log: true,
  decimals: 2, words: 'millimetres', get: () => state.D, set: setSize,
});

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

/** Magnification for the inset: the chosen one, or the largest that fits the zones. */
function resolveMag() {
  if (state.mag !== 'auto') return state.mag;
  if (!geom || !fit?.defined) return magUsed;
  const { hi, lo } = devSpan();
  const h = geom.inset.drawBottom - geom.inset.drawTop;
  const forZones = M.autoMagnification(Math.max(hi - lo, 4), h * 0.72, sim.k);
  const forHair = M.autoMagnification(HAIR_UM, h * 0.95, sim.k); // keep the hair recognisable as a circle
  return Math.min(forZones, forHair);
}

/** Highest and lowest deviation to show (µm), always including the zero line. */
function devSpan() {
  if (!fit?.defined) return { hi: fit?.hole.ES ?? 10, lo: 0 };
  return { hi: Math.max(fit.hole.ES, fit.shaft.es, 0), lo: Math.min(fit.hole.EI, fit.shaft.ei, 0) };
}

function updateAll() {
  fit = M.computeFit({ D: state.D, holeGrade: state.holeGrade, letter: state.letter, shaftGrade: state.shaftGrade });
  magUsed = resolveMag();
  syncControls();
  updateReadouts();
  updateEquations();
  sim.updateAria();
  sim.pixelCard?.update();
  sim.requestDraw();
  announce(fit.defined
    ? `${fitName(fit)}, ${fit.type} fit. Hole ${fmtLimit(fit.hole.min, 0)} to ${fmtLimit(fit.hole.max, 0)} millimetres, shaft ${fmtLimit(fit.shaft.min, fit.shaft.ei)} to ${fmtLimit(fit.shaft.max, fit.shaft.es)} millimetres. ${clearanceWords()}.`
    : `${fitName(fit)}: ${state.letter} shafts are not defined at this size.`);
}

function clearanceWords() {
  const { maxClearance: a, minClearance: b } = fit;
  if (fit.type === 'clearance') return `Clearance from ${fmtNum(b)} to ${fmtNum(a)} micrometres`;
  if (fit.type === 'interference') return `Interference from ${fmtNum(-a)} to ${fmtNum(-b)} micrometres`;
  return `From ${fmtNum(a)} micrometres clearance to ${fmtNum(-b)} micrometres interference`;
}

function syncControls() {
  sizeParam.sync();
  $('size-num').value = fmtD(state.D);
  $('size-range').setAttribute('aria-valuetext', `${fmtD(state.D)} millimetres`);
  $('hole-grade').value = String(state.holeGrade);
  $('shaft-letter').value = state.letter;
  $('shaft-grade').value = String(state.shaftGrade);
  const pref = M.findPreferred(state.holeGrade, state.letter, state.shaftGrade);
  $('fit-select').value = pref ? pref.id : 'custom';
  $('mag-select').value = String(state.mag);
  const autoOpt = $('mag-select').querySelector('option[value="auto"]');
  setText(autoOpt, `Auto (×${fmt(magUsed, 0)})`);
  const useText = pref?.use ? `${pref.name ? `${pref.name}: ` : ''}${pref.use}` : pref ? 'Preferred in ISO 286-1:2010.' : 'Custom fit.';
  setText($('fit-use'), useText + (pref?.id === 'H7/p6' && state.D <= 3 ? ' Up to 3 mm it is a transition fit.' : ''));
}

function updateReadouts() {
  const f = fit;
  const pref = M.findPreferred(f.holeGrade, f.letter, f.shaftGrade);
  setText(outputs.fitName, `${fitName(f)}${pref?.name ? ` · ${pref.name.toLowerCase()} fit` : ''}`);
  const pitchUm = pitchM() * 1e6;
  setText(outputs.pixel, `${sigT(pitchUm, 3)} µm across`);
  setText(outputs.pixelSub, `${ratioPhrase(pitchUm / HAIR_UM)} a typical human hair (${fmt(HAIR_UM, 0)} µm) · ${scaleSourceText(sim.scale)}`);
  setText(outputs.holeLimits, `${fmtLimit(f.hole.min, 0)} to ${fmtLimit(f.hole.max, 0)}`);
  setText(outputs.holeDev, `H${f.holeGrade}: EI 0, ES ${fmtDev(f.hole.ES)} µm`);
  setText(outputs.holeIT, fmtNum(f.hole.it));
  setText(outputs.holeITsub, `IT${f.holeGrade} · ${fmtPx(umToPx(f.hole.it))} px · ${ratioPhrase(f.hole.it / HAIR_UM)} a hair`);
  if (!f.defined) {
    for (const k of ['shaftLimits', 'maxC', 'minC', 'shaftIT']) setText(outputs[k], '–');
    setText(outputs.fitType, `Not defined: ISO 286 gives no ${f.letter} deviation ${rangeText(M.devRange(f.D))}.`);
    setText(outputs.shaftDev, '–');
    for (const k of ['maxSub', 'minSub', 'shaftITsub']) setText(outputs[k], '–');
    setText(outputs.ranges, `IT grades: ${rangeText(M.itRange(f.D))}. The letter t starts over 24 mm.`);
    return;
  }
  const typeText = {
    clearance: 'Clearance fit: always a gap',
    transition: 'Transition fit: a pair may have a gap or overlap',
    interference: 'Interference fit: always overlap, so it is pressed or shrunk together',
  }[f.type];
  setText(outputs.fitType, typeText);
  setText(outputs.shaftLimits, `${fmtLimit(f.shaft.min, f.shaft.ei)} to ${fmtLimit(f.shaft.max, f.shaft.es)}`);
  setText(outputs.shaftDev, `${f.letter}${f.shaftGrade}: es ${fmtDev(f.shaft.es)}, ei ${fmtDev(f.shaft.ei)} µm`);
  setText(outputs.shaftIT, fmtNum(f.shaft.it));
  setText(outputs.shaftITsub, `IT${f.shaftGrade} · ${fmtPx(umToPx(f.shaft.it))} px · ${ratioPhrase(f.shaft.it / HAIR_UM)} a hair`);
  const a = f.maxClearance;
  const b = f.minClearance;
  setText(outputs.maxLabel, a >= 0 ? 'Max clearance (loosest pair)' : 'Min interference (loosest pair)');
  setText(outputs.maxC, fmtNum(Math.abs(a)));
  setText(outputs.maxSub, `${fmt(Math.abs(a) / 1000, 3)} mm · ${fmtPx(umToPx(Math.abs(a)))} px`);
  setText(outputs.minLabel, b >= 0 ? 'Min clearance (tightest pair)' : 'Max interference (tightest pair)');
  setText(outputs.minC, fmtNum(Math.abs(b)));
  setText(outputs.minSub, `${fmt(Math.abs(b) / 1000, 3)} mm · ${fmtPx(umToPx(Math.abs(b)))} px`);
  const sr = f.shaft.range;
  const it = M.itRange(f.D);
  const sameRange = sr.lo === it.lo && sr.hi === it.hi;
  let rangesText = `IT grades: ${rangeText(it)}.`;
  if (f.letter !== 'js' && f.letter !== 'h') rangesText += sameRange ? ` Letter ${f.letter}: the same range.` : ` Letter ${f.letter}: ${rangeText(sr)} (the standard splits this range).`;
  if (f.letter === 'k' && (f.shaftGrade > 7)) rangesText += ' k only shifts for grades IT4 to IT7, so here ei = 0.';
  if (f.letter === 'js' && f.shaft.half1988 !== f.shaft.es) rangesText += ` ISO 286-1:1988 rounded js${f.shaftGrade} to ±${fmtNum(f.shaft.half1988)} µm.`;
  setText(outputs.ranges, rangesText);
}

/** "about a third of", "about 4 times" (+ "the size of" for multiples). */
function ratioPhrase(r) {
  const w = M.ratioWords(r);
  return w.endsWith('times') ? `${w} the size of` : w === 'about the same as' ? 'about the same size as' : w;
}

function updateEquations() {
  const f = fit;
  const it = M.itRange(f.D);
  const Dm = M.geometricMeanD(it.index);
  const i = M.toleranceFactor(Dm);
  const lo = it.index ? it.lo : 1;
  setText(equations.i, `D = √(${lo} × ${it.hi}) = ${fmt(Dm, 2)} mm, so i = ${fmt(i, 3)} µm`);
  const gH = f.holeGrade;
  const gS = f.shaftGrade;
  const itLine = (g) => `IT${g} = ${IT_FACTORS[g]} × ${fmt(i, 3)} = ${fmt(IT_FACTORS[g] * i, 1)} µm; table: ${IT_TABLE[g][it.index]} µm`;
  setText(equations.it, gH === gS ? itLine(gH) : `${itLine(gH)}. ${itLine(gS)}`);
  setText(equations.hole, `H${gH}: EI = 0, ES = 0 + ${f.hole.it} = ${fmtDev(f.hole.ES)} µm`);
  const pixUm = pitchM() * 1e6;
  if (!f.defined) {
    setText(equations.shaftRule, `shaft ${f.letter}: no value at this size`);
    for (const k of ['shaft', 'limits', 'maxC', 'minC']) setText(equations[k], '–');
    setText(equations.pixels, `1 pixel = ${sigT(pixUm, 3)} µm on this screen`);
    setText(equations.mag, '–');
    return;
  }
  const s = f.shaft;
  if (s.kind === 'es') {
    setText(equations.shaftRule, `shaft ${f.letter}: es = fundamental deviation, ei = es − IT`);
    setText(equations.shaft, `es = ${fmtDev(s.es)} µm (table), ei = ${fmtDev(s.es)} − ${s.it} = ${fmtDev(s.ei)} µm`);
  } else if (s.kind === 'ei') {
    setText(equations.shaftRule, `shaft ${f.letter}: ei = fundamental deviation, es = ei + IT`);
    setText(equations.shaft, `ei = ${fmtDev(s.ei)} µm (table${f.letter === 'k' && f.shaftGrade > 7 ? ': 0 above IT7' : ''}), es = ${fmtDev(s.ei)} + ${s.it} = ${fmtDev(s.es)} µm`);
  } else {
    setText(equations.shaftRule, 'shaft js: es = +IT/2, ei = −IT/2');
    setText(equations.shaft, `±${s.it}/2 = ±${fmtNum(s.es)} µm`);
  }
  setText(equations.limits, `hole ${fmtD(f.D)} + 0 … ${fmtD(f.D)} + ${fmt(f.hole.ES / 1000, 3)} = ${fmtLimit(f.hole.min, 0)} to ${fmtLimit(f.hole.max, 0)} mm; shaft ${fmtLimit(f.shaft.min, s.ei)} to ${fmtLimit(f.shaft.max, s.es)} mm`);
  setText(equations.maxC, `${fmtDev(f.hole.ES)} − (${fmtDev(s.ei)}) = ${fmtDev(f.maxClearance)} µm${f.maxClearance < 0 ? ' (negative: interference)' : ''}`);
  setText(equations.minC, `0 − (${fmtDev(s.es)}) = ${fmtDev(f.minClearance)} µm${f.minClearance < 0 ? ' (negative: interference)' : ''}`);
  const gap = Math.abs(f.maxClearance);
  setText(equations.pixels, `${fmtNum(gap)} µm ÷ ${sigT(pixUm, 3)} µm = ${fmtPx(umToPx(gap))} px (1 pixel on this screen = ${sigT(pixUm, 3)} µm)`);
  const onScreenMm = gap * 1e-3 * magUsed;
  setText(equations.mag, `${fmtNum(gap)} µm × ${fmt(magUsed, 0)} = ${sigT(onScreenMm, 3)} mm = ${fmtPx(onScreenMm * 1e-3 * sim.k)} px in the inset`);
}

/** Canvas description for screen readers. */
function describe() {
  if (!fit) return 'Tolerance and fit drawing';
  const scaleWord = sim.scale.calibrated ? 'calibrated true size' : 'approximate true size';
  if (!fit.defined) return `${fitName(fit)}: ${fit.letter} shafts have no ISO 286 value at ${fmtD(fit.D)} millimetres. The section is drawn at ${scaleWord}.`;
  const gap = Math.abs(fit.maxClearance);
  return `${fitName(fit)}, a ${fit.type} fit. Left: end-on section of the shaft in its hole at ${scaleWord}, ${fmtD(fit.D)} millimetres across; the largest ${fit.maxClearance >= 0 ? 'gap' : 'overlap'}, ${fmtNum(gap)} micrometres, is ${fmtPx(umToPx(gap))} of a pixel, so the circles coincide. ` +
    `Right: the same surfaces magnified ${fmt(magUsed, 0)} times, loosest and tightest pairs, ${clearanceWords().toLowerCase()}, beside a ${fmt(HAIR_UM, 0)} micrometre hair and one screen pixel at the same magnification. ` +
    `Bottom left: ISO tolerance zones, hole ${fmtDev(fit.hole.EI)} to ${fmtDev(fit.hole.ES)} and shaft ${fmtDev(fit.shaft.ei)} to ${fmtDev(fit.shaft.es)} micrometres.`;
}

/** Sentence for the shared Pixel size card. */
function pixelLine(info) {
  if (!fit) return '';
  const pitchUm = info.pitch * 1e6;
  const it = fit.hole.it;
  let s = `An IT${fit.holeGrade} hole tolerance at ${fmtD(fit.D)} mm is ${fmtNum(it)} µm wide: ${fmtPx(it / pitchUm)} of one pixel on this screen, ${ratioPhrase(it / HAIR_UM)} a human hair.`;
  if (fit.defined) {
    const gap = Math.abs(fit.maxClearance);
    s += ` The largest ${fit.maxClearance >= 0 ? 'gap' : 'overlap'} in ${fitName(fit)}, ${fmtNum(gap)} µm, is ${fmtPx(gap / pitchUm)} px.`;
  }
  return s;
}

/** Numbers in the explainer text: from the tables, and for the assumed 24″ 1080p screen. */
function fillExplainer() {
  setText(calcs['it7at6'], String(M.itValue(7, 6)));
  setText(calcs['it7at250'], String(M.itValue(7, 250)));
  const ex = M.computeFit({ D: 25, holeGrade: 7, letter: 'g', shaftGrade: 6 });
  setText(calcs['ex-it7'], String(ex.hole.it));
  setText(calcs['ex-it6'], String(ex.shaft.it));
  const k24 = devicePxPerMetreFromScreen(DEFAULT_SCREEN.diagonalIn, DEFAULT_SCREEN.resW, DEFAULT_SCREEN.resH);
  const pitch24 = M.pixelPitchM(k24) * 1e3;
  setText(calcs['px24'], sigT(pitch24, 3));
  setText(calcs['frac24'], fmtPx(M.micrometresInPixels(ex.hole.it, k24)));
  setText(calcs['gap24'], fmtPx(M.micrometresInPixels(ex.maxClearance, k24)));
  setText(calcs['hair24'], M.ratioWords(HAIR_UM / (pitch24 * 1e3)));
}

/* =========================================================================
 * 4. Step: nothing moves (a static page: createSim({ animated: false }))
 * ====================================================================== */

function step() {}

/* =========================================================================
 * 5. Drawing (CSS px; k = CSS px per metre; deviations in µm)
 * ====================================================================== */

/** Panel rectangles: true size (top left), zone diagram (bottom left), inset (right). */
function layout(w, h) {
  if (w >= 760) {
    const leftW = clamp(Math.round(w * 0.33), 270, 620);
    const topH = Math.round((h - 3 * PAD) * 0.6);
    const ix = PAD + leftW + 40;
    const inset = { x: ix, y: PAD, w: w - ix - PAD, h: h - 2 * PAD };
    return { stacked: false, truePanel: { x: PAD, y: PAD, w: leftW, h: topH }, zonePanel: { x: PAD, y: 2 * PAD + topH, w: leftW, h: h - 3 * PAD - topH }, inset: withDrawArea(inset) };
  }
  const a = Math.round((h - 4 * PAD) * 0.32);
  const c = Math.round((h - 4 * PAD) * 0.25);
  const inset = { x: PAD, y: 2 * PAD + a, w: w - 2 * PAD, h: h - 4 * PAD - a - c };
  return { stacked: true, truePanel: { x: PAD, y: PAD, w: w - 2 * PAD, h: a }, zonePanel: { x: PAD, y: h - PAD - c, w: w - 2 * PAD, h: c }, inset: withDrawArea(inset) };
}

function withDrawArea(I) {
  return { ...I, drawTop: I.y + 82, drawBottom: I.y + I.h - 46 };
}

function onResize(view) {
  geom = layout(view.width, view.height);
  const before = magUsed;
  magUsed = resolveMag();
  if (before !== magUsed) {
    syncControls();
    updateEquations();
    sim.updateAria();
  }
}

function draw(ctx, w, h, k, colors) {
  if (!geom) geom = layout(w, h);
  drawTruePanel(ctx, geom.truePanel, k, colors);
  drawZonePanel(ctx, geom.zonePanel, k, colors);
  drawInset(ctx, geom.inset, k, colors);
}

/* ---------- small helpers ---------- */

function frame(ctx, r, colors) {
  ctx.save();
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, 10);
  ctx.stroke();
  ctx.restore();
}

function text(ctx, str, x, y, { color, font = FONT, align = 'left', baseline = 'alphabetic' } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(str, x, y);
}

/** Diagonal hatch lines over the current clip region's bounding box (call inside save/clip). */
function hatch(ctx, x, y, w, h, color, spacing = 7, dir = 1, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let s = -h; s < w + h; s += spacing) {
    if (dir > 0) { ctx.moveTo(x + s, y + h); ctx.lineTo(x + s + h, y); } else { ctx.moveTo(x + s, y); ctx.lineTo(x + s + h, y + h); }
  }
  ctx.stroke();
}

/** Split text into lines no wider than maxW. */
function wrap(ctx, str, maxW) {
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** Vertical dimension arrow between y0 and y1 (both heads), arrows outside when short. */
function dimArrow(ctx, x, y0, y1, color) {
  const top = Math.min(y0, y1);
  const bot = Math.max(y0, y1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (bot - top >= 16) {
    ctx.moveTo(x, top + 5);
    ctx.lineTo(x, bot - 5);
    ctx.stroke();
    drawArrowHead(ctx, x, top, 0, -1, 7);
    drawArrowHead(ctx, x, bot, 0, 1, 7);
  } else {
    ctx.moveTo(x, top - 16);
    ctx.lineTo(x, top);
    ctx.moveTo(x, bot);
    ctx.lineTo(x, bot + 16);
    ctx.stroke();
    drawArrowHead(ctx, x, top, 0, 1, 7);
    drawArrowHead(ctx, x, bot, 0, -1, 7);
  }
  // extension ticks
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 8, top);
  ctx.lineTo(x + 8, top);
  ctx.moveTo(x - 8, bot);
  ctx.lineTo(x + 8, bot);
  ctx.stroke();
}

const okTag = (colors) => ({ color: colors.ok, background: colors.okBg });
const warnTag = (colors) => ({ color: colors.warn, background: colors.warnBg });

/* ---------- True size panel ---------- */

function drawTruePanel(ctx, P, k, colors) {
  frame(ctx, P, colors);
  const calibrated = sim.scale.calibrated;
  const tagW = drawTag(ctx, calibrated ? 'TRUE SIZE 1:1' : 'TRUE SIZE 1:1 (APPROX.)', P.x + 10, P.y + 20, calibrated ? okTag(colors) : warnTag(colors));
  text(ctx, `End-on section, Ø${fmtD(state.D)} mm`, P.x + 18 + tagW, P.y + 24, { color: colors.fg, font: FONT_BOLD });

  const A = { x: P.x + 10, y: P.y + 40, w: P.w - 20, h: P.h - 40 - 76 };
  const R = (state.D * 1e-3 * k) / 2;                       // shaft radius, px
  const blockHalf = R * 1.5 + 0.004 * k;                   // block: 1.5 × D plus 8 mm, square
  let cx = A.x + A.w / 2;
  let cy = A.y + A.h / 2;
  const whole = 2 * R + 40 <= Math.min(A.w, A.h);
  if (!whole) cy = A.y + Math.max(46, A.h * 0.32) + R;     // only the top of the shaft fits: show that region

  ctx.save();
  ctx.beginPath();
  ctx.rect(A.x, A.y, A.w, A.h);
  ctx.clip();
  // Block with the hole (even-odd: square minus circle)
  ctx.beginPath();
  ctx.rect(cx - blockHalf, cy - blockHalf, 2 * blockHalf, 2 * blockHalf);
  ctx.moveTo(cx + R, cy);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fillStyle = colors.block;
  ctx.fill('evenodd');
  ctx.save();
  ctx.clip('evenodd');
  hatch(ctx, cx - blockHalf, cy - blockHalf, 2 * blockHalf, 2 * blockHalf, colors.blockLine, 8, 1, 0.8);
  ctx.restore();
  ctx.strokeStyle = colors.blockLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - blockHalf, cy - blockHalf, 2 * blockHalf, 2 * blockHalf);
  // Shaft (same nominal circle: the real difference is a fraction of a pixel)
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = colors.shaft;
  ctx.fill();
  ctx.strokeStyle = colors.shaftLine;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Centre lines
  ctx.setLineDash([8, 3, 2, 3]);
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.moveTo(cx - R - 6, cy);
  ctx.lineTo(cx + R + 6, cy);
  ctx.moveTo(cx, cy - R - 6);
  ctx.lineTo(cx, cy + R + 6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Where the inset looks: the top of the shaft
  const mx = cx;
  const my = cy - R;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx, my, 9, 0, Math.PI * 2);
  ctx.stroke();
  // Leader lines to the inset (static): both run up and to the right, clear of the part
  const I = geom.inset;
  if (!geom.stacked) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx + 3, my - 9);
    ctx.lineTo(I.x, I.y + 1);
    ctx.moveTo(mx + 9, my - 1);
    ctx.lineTo(I.x, I.drawTop);
    ctx.stroke();
    ctx.restore();
  }
  // Label: above the block where there is room, else beside the ring on a background
  const labelY = Math.max(A.y + 12, cy - blockHalf - 10);
  const where = geom.stacked ? 'magnified below' : 'magnified on the right';
  if (labelY < my - 16) drawTag(ctx, where, mx, labelY - 4, { color: colors.muted, background: colors.bg, align: 'center', font: FONT, height: 18, padX: 5 });
  else drawTag(ctx, where, mx - 14, my, { color: colors.muted, background: colors.bg, align: 'right', font: FONT, height: 18, padX: 5 });

  // 1:1 scale bar, bottom right of the drawing area, on a background so it reads over the part
  const barMax = Math.min(140, A.w * 0.35);
  const barX = A.x + A.w - barMax - 4;
  const barY = A.y + A.h - 6;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(barX - 6, barY - 26, barMax + 10, 30);
  drawScaleBar(ctx, colors, { x: barX, y: barY, k, maxPx: barMax });

  // Static tags under the drawing: how big the gap and tolerances are in pixels
  const yb = P.y + P.h;
  if (fit.defined) {
    const a = fit.maxClearance;
    const gapText = a >= 0 ? `Largest gap ${fmtNum(a)} µm = ${fmtPx(umToPx(a))} px` : `Least overlap ${fmtNum(-a)} µm = ${fmtPx(umToPx(-a))} px`;
    drawTag(ctx, gapText, P.x + 10, yb - 60, a >= 0 ? okTag(colors) : warnTag(colors));
    text(ctx, `Tolerance: hole ${fmtNum(fit.hole.it)} µm = ${fmtPx(umToPx(fit.hole.it))} px, shaft ${fmtNum(fit.shaft.it)} µm = ${fmtPx(umToPx(fit.shaft.it))} px`, P.x + 12, yb - 32, { color: colors.fg });
  } else {
    drawTag(ctx, `${state.letter}${state.shaftGrade}: no ISO 286 value at ${fmtD(state.D)} mm`, P.x + 10, yb - 60, warnTag(colors));
  }
  const note = whole
    ? `A ${fmt(HAIR_UM, 0)} µm hair would be ${fmtPx(umToPx(HAIR_UM))} px wide here.`
    : `Only the top of the section fits: the whole would be ${fmt(2 * R, 0)} px across.`;
  ctx.font = FONT;
  const lines = wrap(ctx, note, P.w - 24);
  text(ctx, lines[0] + (lines.length > 1 ? ' …' : ''), P.x + 12, yb - 12, { color: colors.muted });
}

/* ---------- Magnified inset ---------- */

function drawInset(ctx, I, k, colors) {
  frame(ctx, I, colors);
  const tagW = drawTag(ctx, `MAGNIFIED ×${fmt(magUsed, 0)}`, I.x + 10, I.y + 20, warnTag(colors));
  text(ctx, 'Cut through the top of the shaft, with the hole wall above', I.x + 18 + tagW, I.y + 24, { color: colors.fg, font: FONT_BOLD });

  const top = I.drawTop;
  const bottom = I.drawBottom;
  const axisW = 58;
  const compW = clamp(Math.round(I.w * 0.28), 140, 380);
  const sx0 = I.x + axisW;
  const sx1 = I.x + I.w - compW - 14;
  const gapX = 14;
  const stripW = (sx1 - sx0 - gapX) / 2;
  const pxPerUm = magUsed * k * 1e-6;
  const { hi, lo } = devSpan();
  const midY = (top + bottom) / 2;
  const y = (dev) => midY - (dev - (hi + lo) / 2) * pxPerUm;

  if (!fit.defined) {
    ctx.font = FONT_BOLD;
    const msg = `ISO 286 gives no deviation for ${state.letter} shafts at ${fmtD(state.D)} mm (t starts over 24 mm). Choose a larger size or another letter.`;
    wrap(ctx, msg, I.w - 60).forEach((ln, i) => text(ctx, ln, I.x + I.w / 2, midY + i * 18, { color: colors.warn, font: FONT_BOLD, align: 'center' }));
    return;
  }

  // µm axis + faint grid across the strips
  const umTop = (hi + lo) / 2 + (midY - top) / pxPerUm;
  const umBot = (hi + lo) / 2 - (bottom - midY) / pxPerUm;
  const tick = niceStep((umTop - umBot) / 8);
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(umBot / tick) * tick; v <= umTop + 1e-9; v += tick) {
    const yy = y(v);
    const zero = Math.abs(v) < tick * 1e-6;
    ctx.globalAlpha = zero ? 1 : 0.45;
    ctx.strokeStyle = colors.track;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx0 - 6, yy);
    ctx.lineTo(sx1, yy);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = zero ? colors.fg : colors.muted;
    ctx.fillText(zero ? '0' : `${fmtDev(Number(v.toPrecision(6)))}`, sx0 - 10, yy);
  }
  text(ctx, 'µm', sx0 - 10, top - 8, { color: colors.muted, align: 'right' });
  ctx.restore();

  // The two worst-case pairs
  const strips = [
    { x: sx0, hole: fit.hole.ES, shaft: fit.shaft.ei, title: 'Loosest pair', sub: `largest hole ${fmtDev(fit.hole.ES)}, smallest shaft ${fmtDev(fit.shaft.ei)}` },
    { x: sx0 + stripW + gapX, hole: fit.hole.EI, shaft: fit.shaft.es, title: 'Tightest pair', sub: `smallest hole ${fmtDev(fit.hole.EI)}, largest shaft ${fmtDev(fit.shaft.es)}` },
  ];
  for (const s of strips) drawStrip(ctx, s, stripW, top, bottom, y, colors);

  // Nominal (zero) line, then the limit lines (dashed), clipped to the drawing area
  const limits = [
    { v: fit.hole.ES, t: `ES ${fmtDev(fit.hole.ES)}`, c: colors.blockLine },
    { v: fit.hole.EI, t: `EI ${fmtDev(fit.hole.EI)}`, c: colors.blockLine },
    { v: fit.shaft.es, t: `es ${fmtDev(fit.shaft.es)}`, c: colors.shaftLine },
    { v: fit.shaft.ei, t: `ei ${fmtDev(fit.shaft.ei)}`, c: colors.shaftLine },
  ];
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx0 - 6, top, sx1 - sx0 + 6, bottom - top);
  ctx.clip();
  ctx.setLineDash([10, 4]);
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx0 - 4, y(0));
  ctx.lineTo(sx1, y(0));
  ctx.stroke();
  ctx.setLineDash([3, 3]);
  for (const L of limits) {
    ctx.strokeStyle = L.c;
    ctx.beginPath();
    ctx.moveTo(sx0, y(L.v));
    ctx.lineTo(sx1, y(L.v));
    ctx.stroke();
  }
  ctx.restore();
  // Labels at the right of the second strip: at their lines, pushed 20 px apart, kept inside the area
  const sorted = [...limits].sort((a, b) => y(a.v) - y(b.v));
  const ly = sorted.map((L) => clamp(y(L.v), top + 10, bottom - 10));
  for (let i = 1; i < ly.length; i++) ly[i] = Math.max(ly[i], ly[i - 1] + 20);
  for (let i = ly.length - 1; i >= 0; i--) ly[i] = Math.min(ly[i], i < ly.length - 1 ? ly[i + 1] - 20 : bottom - 10);
  sorted.forEach((L, i) => drawTag(ctx, L.t, sx1 - 4, ly[i], { color: colors.fg, background: colors.bg, border: L.c, align: 'right', height: 18, padX: 6 }));
  for (const s of strips) drawStripDimension(ctx, s, stripW, top, bottom, y, colors);
  if (limits.some((L) => y(L.v) < top || y(L.v) > bottom)) {
    drawTag(ctx, 'Some limits are beyond this view: choose Auto magnification', sx0 + 6, bottom - 14, warnTag(colors));
  }

  drawComparison(ctx, { x: I.x + I.w - compW - 6, w: compW - 4, top, bottom, midY }, pxPerUm, colors);

  // Caption (static)
  ctx.font = FONT;
  const cap = 'Sizes are diameters: each strip puts all of the clearance (or overlap) on this side, as if the shaft rested against the far side of the hole.';
  wrap(ctx, cap, I.w - 24).slice(0, 2).forEach((ln, i) => text(ctx, ln, I.x + 12, I.y + I.h - 26 + i * 15, { color: colors.muted }));
}

/** One worst-case pair: hole wall above its surface, shaft below its surface, gap or overlap between. */
function drawStrip(ctx, s, w, top, bottom, y, colors) {
  const yh = y(s.hole);
  const ys = y(s.shaft);
  ctx.font = FONT;
  const sub = wrap(ctx, s.sub, w).slice(0, 2);
  const titleY = sub.length > 1 ? top - 40 : top - 30;
  text(ctx, s.title, s.x + w / 2, titleY, { color: colors.fg, font: FONT_BOLD, align: 'center' });
  sub.forEach((ln, i) => text(ctx, ln, s.x + w / 2, titleY + 15 + i * 13, { color: colors.muted, align: 'center' }));

  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, top, w, bottom - top);
  ctx.clip();
  // hole wall: material above the hole surface
  const holeBottom = clamp(yh, top, bottom);
  ctx.fillStyle = colors.block;
  ctx.fillRect(s.x, top, w, holeBottom - top);
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, top, w, holeBottom - top);
  ctx.clip();
  hatch(ctx, s.x, top, w, holeBottom - top, colors.blockLine, 9, 1, 0.8);
  ctx.restore();
  // shaft: material below the shaft surface
  const shaftTop = clamp(ys, top, bottom);
  ctx.fillStyle = colors.shaft;
  ctx.fillRect(s.x, shaftTop, w, bottom - shaftTop);
  ctx.save();
  ctx.beginPath();
  ctx.rect(s.x, shaftTop, w, bottom - shaftTop);
  ctx.clip();
  hatch(ctx, s.x, shaftTop, w, bottom - shaftTop, colors.shaftLine, 9, -1, 0.6);
  ctx.restore();
  // gap (clearance) or overlap (interference)
  const gap = s.hole - s.shaft; // µm, diametral
  if (gap > 0) {
    ctx.fillStyle = colors.okBg;
    ctx.fillRect(s.x, yh, w, ys - yh);
  } else if (gap < 0) {
    ctx.fillStyle = colors.warnBg;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(s.x, ys, w, yh - ys);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(s.x, ys, w, yh - ys);
    ctx.clip();
    hatch(ctx, s.x, ys, w, yh - ys, colors.warn, 6, 1, 1);
    hatch(ctx, s.x, ys, w, yh - ys, colors.warn, 6, -1, 1);
    ctx.restore();
  }
  // surfaces
  ctx.lineWidth = 2;
  ctx.strokeStyle = colors.blockLine;
  ctx.beginPath();
  ctx.moveTo(s.x, yh);
  ctx.lineTo(s.x + w, yh);
  ctx.stroke();
  ctx.strokeStyle = colors.shaftLine;
  ctx.beginPath();
  ctx.moveTo(s.x, ys);
  ctx.lineTo(s.x + w, ys);
  ctx.stroke();
  // material names, where there is room
  ctx.font = FONT_BOLD;
  if (holeBottom - top > 40) text(ctx, 'hole wall', s.x + 10, top + 18, { color: colors.fg, font: FONT_BOLD });
  if (bottom - shaftTop > 40) text(ctx, 'shaft', s.x + 10, bottom - 10, { color: colors.fg, font: FONT_BOLD });
  ctx.restore();
}

/** The gap or overlap of one strip, dimensioned in µm (drawn after the limit lines). */
function drawStripDimension(ctx, s, w, top, bottom, y, colors) {
  const gap = s.hole - s.shaft; // µm, diametral
  const ya = clamp(y(s.hole), top, bottom);
  const yb = clamp(y(s.shaft), top, bottom);
  const narrow = w < 200;
  const ax = s.x + w * (narrow ? 0.22 : 0.42);
  const color = gap >= 0 ? colors.ok : colors.warn;
  if (gap !== 0) dimArrow(ctx, ax, ya, yb, color);
  const n = `${fmtNum(Math.abs(gap))} µm`;
  const label = narrow ? n : gap > 0 ? `gap ${n}` : gap < 0 ? `overlap ${n}` : 'touching: 0 µm';
  const ly = clamp((ya + yb) / 2, top + 12, bottom - 12);
  drawTag(ctx, label, ax + 12, ly, gap >= 0 ? { ...okTag(colors), border: colors.ok } : { ...warnTag(colors), border: colors.warn });
}

/** A human hair and one screen pixel at the inset's magnification. */
function drawComparison(ctx, C, pxPerUm, colors) {
  text(ctx, 'At the same', C.x + C.w / 2, C.top - 30, { color: colors.fg, font: FONT_BOLD, align: 'center' });
  text(ctx, 'magnification', C.x + C.w / 2, C.top - 16, { color: colors.fg, font: FONT_BOLD, align: 'center' });
  const cx = C.x + C.w / 2;
  const cy = C.midY;
  const pitchUm = pitchM() * 1e6;
  const side = pitchUm * pxPerUm;             // one device pixel, magnified (CSS px)
  const hairD = HAIR_UM * pxPerUm;
  const box = { x: C.x, y: C.top, w: C.w, h: C.bottom - C.top };

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  // pixel: a pale square with a dashed outline
  const px0 = cx - side / 2;
  const py0 = cy - side / 2;
  ctx.fillStyle = colors.pixel;
  ctx.fillRect(px0, py0, side, side);
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(px0, py0, side, side);
  ctx.setLineDash([]);
  // hair cross-section
  ctx.beginPath();
  ctx.arc(cx, cy, hairD / 2, 0, Math.PI * 2);
  ctx.fillStyle = colors.refFill;
  ctx.fill();
  ctx.strokeStyle = colors.ref;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const inside = side > box.w && side > box.h;
  const pxLabel = inside ? 'This whole column lies inside' : 'One screen pixel,';
  const pxLabel2 = inside ? `one screen pixel (${sigT(pitchUm, 3)} µm)` : `${sigT(pitchUm, 3)} µm (dashed)`;
  const ply = inside ? box.y + 14 : Math.max(box.y + 14, py0 - 30);
  drawTag(ctx, pxLabel, cx, ply, { color: colors.fg, background: colors.bg, align: 'center', height: 18, padX: 6 });
  drawTag(ctx, pxLabel2, cx, ply + 19, { color: colors.fg, background: colors.bg, align: 'center', height: 18, padX: 6 });
  const hairFits = hairD <= Math.min(box.w, box.h) - 50;
  const hy = hairFits ? Math.min(cy + hairD / 2 + 14, box.y + box.h - 34) : box.y + box.h - 34;
  const hairNote = hairFits ? '' : hairD > box.h ? ' (larger than this box)' : ' (wider than this box)';
  drawTag(ctx, `Human hair, ${fmt(HAIR_UM, 0)} µm${hairNote}`, cx, hy, { color: colors.ref, background: colors.bg, align: 'center', height: 18, padX: 6 });
  // micrometre scale bar
  const barUm = niceFloor((C.w * 0.5) / pxPerUm);
  if (barUm > 0) {
    const bw = barUm * pxPerUm;
    const bx = cx - bw / 2;
    const by = box.y + box.h - 8;
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx, by - 5);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx + bw, by);
    ctx.lineTo(bx + bw, by - 5);
    ctx.stroke();
    text(ctx, `${fmtNum(barUm)} µm`, cx, by - 7, { color: colors.fg, align: 'center' });
  }
}

/* ---------- ISO tolerance-zone diagram ---------- */

function drawZonePanel(ctx, Z, k, colors) {
  frame(ctx, Z, colors);
  text(ctx, 'ISO tolerance zones', Z.x + 12, Z.y + 24, { color: colors.fg, font: FONT_BOLD });
  text(ctx, `zero line = nominal size, Ø${fmtD(state.D)} mm`, Z.x + 12, Z.y + 42, { color: colors.muted });
  const plot = { x: Z.x + 64, y: Z.y + 74, w: Z.w - 64 - 16, h: Z.h - 74 - 14 };
  const { hi, lo } = devSpan();
  const mz = M.autoMagnification(Math.max(hi - lo, 4), plot.h * 0.8, k);
  const pxPerUm = mz * k * 1e-6;
  ctx.font = FONT_BOLD;
  const titleW = ctx.measureText('ISO tolerance zones').width;
  const tagText = `DEVIATIONS ×${fmt(mz, 0)}`;
  const tagW = ctx.measureText(tagText).width + 16;
  if (titleW + tagW + 40 < Z.w) drawTag(ctx, tagText, Z.x + Z.w - 10, Z.y + 20, { ...warnTag(colors), align: 'right' });
  else drawTag(ctx, tagText, Z.x + Z.w - 10, Z.y + 64, { ...warnTag(colors), align: 'right' });

  const midY = plot.y + plot.h / 2;
  const y = (dev) => midY - (dev - (hi + lo) / 2) * pxPerUm;
  // axis ticks
  const umTop = (hi + lo) / 2 + (plot.h / 2) / pxPerUm;
  const umBot = (hi + lo) / 2 - (plot.h / 2) / pxPerUm;
  const tick = niceStep((umTop - umBot) / 5);
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.moveTo(plot.x, plot.y);
  ctx.lineTo(plot.x, plot.y + plot.h);
  ctx.stroke();
  for (let v = Math.ceil(umBot / tick) * tick; v <= umTop + 1e-9; v += tick) {
    const yy = y(v);
    ctx.beginPath();
    ctx.moveTo(plot.x - 4, yy);
    ctx.lineTo(plot.x, yy);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(Math.abs(v) < 1e-9 ? '0' : fmtDev(Number(v.toPrecision(6))), plot.x - 7, yy);
  }
  ctx.restore();
  text(ctx, 'µm', plot.x - 7, plot.y - 10, { color: colors.muted, align: 'right' });
  // zero line
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plot.x, y(0));
  ctx.lineTo(plot.x + plot.w, y(0));
  ctx.stroke();

  const zone = (x0, x1, a, b, fill, line, label, flip) => {
    const ya = y(Math.max(a, b));
    const yb = Math.max(y(Math.min(a, b)), ya + 2);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, ya, x1 - x0, yb - ya);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, ya, x1 - x0, yb - ya);
    ctx.clip();
    hatch(ctx, x0, ya, x1 - x0, yb - ya, line, 7, flip, 0.8);
    ctx.restore();
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0, ya, x1 - x0, yb - ya);
    // name above the box, or below it when the zero line runs just above the box
    const y0 = y(0);
    const nameY = y0 > ya - 20 && y0 < ya ? yb + 15 : ya - 6;
    text(ctx, label, (x0 + x1) / 2, nameY, { color: colors.fg, font: FONT_BOLD, align: 'center' });
    // deviation labels at the box corners, kept apart when the box is thin
    let ty = ya + 5;
    let by = yb - 5;
    if (by - ty < 14) { ty = (ya + yb) / 2 - 7; by = ty + 14; }
    text(ctx, fmtDev(Math.max(a, b)), x1 + 5, ty, { color: colors.fg, baseline: 'middle' });
    text(ctx, fmtDev(Math.min(a, b)), x1 + 5, by, { color: colors.fg, baseline: 'middle' });
  };
  const bw = Math.min(90, plot.w * 0.22);
  const hx = plot.x + plot.w * 0.18;
  zone(hx, hx + bw, fit.hole.EI, fit.hole.ES, colors.block, colors.blockLine, `hole H${state.holeGrade}`, 1);
  if (fit.defined) {
    const sx = plot.x + plot.w * 0.56;
    zone(sx, sx + bw, fit.shaft.ei, fit.shaft.es, colors.shaft, colors.shaftLine, `shaft ${state.letter}${state.shaftGrade}`, -1);
  }
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

function fillSelects() {
  const optionFor = (f) => {
    const o = document.createElement('option');
    o.value = f.id;
    o.textContent = f.name ? `${f.id} · ${f.name}` : f.id;
    return o;
  };
  for (const f of PREFERRED_FITS) $('fit-group-preferred').append(optionFor(f));
  for (const f of ISO_PREFERRED_EXTRA) $('fit-group-iso').append(optionFor(f));
  for (const g of M.GRADES) {
    $('hole-grade').append(new Option(`H${g}`, String(g)));
    $('shaft-grade').append(new Option(`${g} (IT${g})`, String(g)));
  }
  for (const L of M.SHAFT_LETTERS) $('shaft-letter').append(new Option(L, L));
  $('mag-select').append(new Option('Auto', 'auto'));
  for (const m of M.MAGNIFICATIONS) $('mag-select').append(new Option(`×${fmt(m, 0)}`, String(m)));
}

fillSelects();

const sim = createSim({
  step,
  draw,
  describe,
  animated: false,            // nothing moves; the loop only redraws on changes
  onResize,
  onScaleChange: () => updateAll(),
  pixelLine,
  colorsFrom: document.body,  // page colours are defined on body.page-tolerance
  colorVars: {
    pixel: '--tol-pixel',
    block: '--tol-block', blockLine: '--tol-block-line', shaft: '--tol-shaft', shaftLine: '--tol-shaft-line',
  },
  debug: {
    state,
    getFit: () => fit,
    getMag: () => magUsed,
    getGeom: () => geom,
    model: M,
  },
});

$('fit-select').addEventListener('change', (e) => {
  const f = [...PREFERRED_FITS, ...ISO_PREFERRED_EXTRA].find((p) => p.id === e.target.value);
  if (f) setFit({ holeGrade: f.hole, letter: f.letter, shaftGrade: f.shaft });
  else syncControls(); // "Custom": keep the current parts; they are edited under Controls
});
$('hole-grade').addEventListener('change', (e) => setFit({ holeGrade: Number(e.target.value) }));
$('shaft-letter').addEventListener('change', (e) => setFit({ letter: e.target.value }));
$('shaft-grade').addEventListener('change', (e) => setFit({ shaftGrade: Number(e.target.value) }));
$('mag-select').addEventListener('change', (e) => setMag(e.target.value));

const example = (D, holeGrade, letter, shaftGrade) => () => { state.D = D; setFit({ holeGrade, letter, shaftGrade }); };
const size = (D) => () => { state.D = D; updateAll(); };
initPresets({
  size6: size(6), size10: size(10), size25: size(25), size50: size(50), size100: size(100), size250: size(250),
  ex25g6: example(25, 7, 'g', 6),
  ex25p6: example(25, 7, 'p', 6),
  ex50s6: example(50, 7, 's', 6),
  ex10f7: example(10, 8, 'f', 7),
  ex100c11: example(100, 11, 'c', 11),
  ex40k6: example(40, 7, 'k', 6),
});

fillExplainer();
updateAll();
sim.start();
updateAll(); // again now the canvas size, scale and pixel card exist
