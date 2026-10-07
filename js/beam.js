/**
 * beam.js: beam deflection drawn at true size (a static, calibrated drawing).
 *
 * The user picks a beam (cantilever or simply supported, point load or load
 * spread evenly), a cross-section, a material, a span and a load. The page
 * computes the deflection curve, slopes, bending moment and stress from the
 * cited formulas (js/beam-model.js) and draws a side view in which the span,
 * the depth of the section and the deflection all share ONE scale: 1:1 when
 * the beam fits the canvas, otherwise 1:N for everything at once. So the bend
 * is usually invisible, which is the point. Two clearly badged aids make it
 * visible: an exaggeration control that multiplies only the bend (drawn in the
 * warn colour), and a magnified callout of the real deflection with a small
 * µm/mm ruler.
 *
 * Nothing moves, so there is no play button: the drawing is redrawn only when
 * an input, the canvas size, the theme or the screen calibration changes.
 *
 * Page pattern (as velocity.js): 1 constants + state, 2 setters, 3 UI sync,
 * 4 step (none), 5 draw (metres → px only here), 6 wiring + start.
 */

import { clamp, niceStep, radToDeg, devicePxPerMetreFromScreen, DEFAULT_SCREEN } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { sig, sigT, sci } from './astro.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawArrow, drawArrowHead, drawRuler, drawTag, drawChart, drawDot, tickLabel, withAlpha, FONT, FONT_BOLD } from './draw.js';
import {
  CASES,
  analyseBeam,
  sectionProperties,
  selfWeightPerMetre,
  loadPosition,
  kgToNewtons,
  newtonsToKg,
  deltaCantileverEnd,
  deltaCantileverUdl,
  deltaSimpleCentre,
  deltaSimpleUdl,
  deltaSimplePoint,
  fitScale,
  calloutMagnification,
  G0,
} from './beam-model.js';
import { MATERIALS, PRESET_SIZES } from './data/beam-data.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  L: [0.02, 3],       // span, m (log slider)
  P: [0.01, 50000],   // applied load, N (log slider)
};

/** Section dimensions (m): slider limits; max may depend on the other dimensions. */
const DIMS = {
  rect: { b: [0.001, 0.6], h: [0.0002, 0.6] },
  round: { d: [0.0005, 0.3] },
  tube: { D: [0.002, 0.3], t: [0.0002, (s) => s.D / 2] },
  rhs: { B: [0.004, 0.4], H: [0.004, 0.6], t: [0.0002, (s) => Math.min(s.B, s.H) / 2] },
  i: { bf: [0.01, 0.4], h: [0.02, 0.6], tf: [0.001, (s) => s.h / 2], tw: [0.001, (s) => s.bf] },
};

// Drawing layout, CSS px (symbols, margins and boxes: deliberately not to scale).
// Margins are small so a 500 mm span still fits at 1:1 on a 24″ 1080p screen.
const MARGIN_L = 28;         // room for the wall hatching or the pin
const MARGIN_R = 24;
const CHART_LABEL_W = 52;    // the moment chart's y tick labels sit left of its box
const ARROW_PX = 46;         // load arrow length
const ARROWS_H = 74;         // band above the beam for load arrows and their label
const SUPPORT_H = { simple: 44, cantilever: 52 }; // support symbol + its label, under the beam
const RULER_H = 50;          // ruler ticks + labels
const CHART_H = 140;         // bending-moment diagram band (title, box, tick labels)
const CHART_H_MIN = 104;     // ...squeezed this far before an exaggerated bend hides it
const CALLOUT = { w: 340, h: 132, targetPx: 64 };
const BIG_FONT = '700 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LARGE_DEFLECTION = 0.1; // warn when δ > L / 10 (the formulas assume small deflections)

const shelf = PRESET_SIZES.shelfBoard;
const { aluBox, ipe100 } = PRESET_SIZES;
const state = {
  caseId: 'simple-centre',
  L: 0.5,                  // span, m
  P: kgToNewtons(20),      // applied load, N (point load, or the total of a UDL)
  aFrac: 0.3,              // simple-point: a / L
  selfWeight: false,
  section: 'rect',
  dims: {
    rect: { b: shelf.width, h: shelf.thickness },
    round: { d: 0.02 },                // neutral starting sizes (inputs, not data)
    tube: { D: 0.03, t: 0.002 },
    rhs: { B: aluBox.B, H: aluBox.H, t: aluBox.t },
    i: { bf: ipe100.b, h: ipe100.h, tf: ipe100.tf, tw: ipe100.tw },
  },
  materialId: 'c24',
  exag: 1,                 // drawn bend = real bend × exag (length never changes)
  showMoment: true,
  showCallout: true,
};

let S = null;      // section properties of the current section
let R = null;      // analysis results
let lastLayout = null;

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = {};
for (const n of document.querySelectorAll('[data-eq]')) (equations[n.dataset.eq] ??= []).push(n);
const announce = createAnnouncer($('sr-summary'));

const material = () => MATERIALS.find((m) => m.id === state.materialId);
const dims = () => state.dims[state.section];
const isCantilever = () => CASES[state.caseId].support === 'cantilever';
const isUdl = () => CASES[state.caseId].load === 'udl';
const wSelf = () => (state.selfWeight ? selfWeightPerMetre(material().density, S.A) : 0);

/** Number with 3 significant figures, powers of ten when very large or small. */
const num = (x, n = 3) => (x !== 0 && (Math.abs(x) >= 1e6 || Math.abs(x) < 1e-3) ? sci(x, n) : sigT(x, n));
const mm = (m, n = 3) => sigT(m * 1000, n);
const setEq = (key, text) => (equations[key] || []).forEach((node) => setText(node, text));
const dpr = () => window.devicePixelRatio || 1;
/** Screen (device) pixels covered by a real length at true size: metres × CSS px per metre × devicePixelRatio. */
const screenPx = (m) => m * sim.k * dpr();

/* =========================================================================
 * 2. Setters: every change goes through these, then recompute()
 * ====================================================================== */

function setSpan(L) {
  state.L = clamp(L, ...LIMITS.L);
  recompute();
}

function setLoad(P) {
  state.P = clamp(P, ...LIMITS.P);
  recompute();
}

/** a is stored as a fraction of the span, so changing L keeps the load at the same relative place. */
function setPosition(a) {
  state.aFrac = clamp(a / state.L, 0, 1);
  recompute();
}

function dimLimit(sec, key, which) {
  const lim = DIMS[sec][key][which];
  return typeof lim === 'function' ? lim(state.dims[sec]) : lim;
}

/** Set one dimension, then pull dependent ones back inside their limits (wall ≤ half the size, etc.). */
function setDim(sec, key, v) {
  const d = state.dims[sec];
  d[key] = clamp(v, dimLimit(sec, key, 0), dimLimit(sec, key, 1));
  for (const k of Object.keys(DIMS[sec])) d[k] = clamp(d[k], dimLimit(sec, k, 0), Math.max(dimLimit(sec, k, 0), dimLimit(sec, k, 1)));
  recompute();
}

function setCase(id) {
  state.caseId = CASES[id] ? id : 'simple-centre';
  recompute();
}

function setSection(id) {
  state.section = DIMS[id] ? id : 'rect';
  recompute();
}

function setMaterial(id) {
  state.materialId = MATERIALS.some((m) => m.id === id) ? id : 'c24';
  recompute();
}

function setExaggeration(x) {
  state.exag = [1, 10, 50, 200].includes(x) ? x : 1;
  const radio = document.querySelector(`input[name="exag"][value="${state.exag}"]`);
  if (radio) radio.checked = true;
  sim.updateAria();
  sim.requestDraw();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const params = [
  bindParam({ range: $('L-range'), num: $('L-num'), min: LIMITS.L[0], max: LIMITS.L[1], log: true,
    scale: 1000, decimals: 0, words: 'millimetres', get: () => state.L, set: setSpan }),
  bindParam({ range: $('P-range'), num: $('P-num'), min: LIMITS.P[0], max: LIMITS.P[1], log: true,
    decimals: 2, words: 'newtons', get: () => state.P, set: setLoad }),
  bindParam({ range: $('a-range'), num: $('a-num'), min: 0, max: () => state.L, step: 0.001,
    scale: 1000, decimals: 0, words: 'millimetres from the left support', get: () => state.aFrac * state.L, set: setPosition }),
];
for (const [sec, keys] of Object.entries(DIMS)) {
  for (const key of Object.keys(keys)) {
    params.push(bindParam({
      range: $(`${sec}-${key}-range`), num: $(`${sec}-${key}-num`), log: true,
      min: () => dimLimit(sec, key, 0), max: () => Math.max(dimLimit(sec, key, 0) * 1.0001, dimLimit(sec, key, 1)),
      scale: 1000, decimals: 1, words: 'millimetres',
      get: () => state.dims[sec][key], set: (v) => setDim(sec, key, v),
    }));
  }
}

/** Recompute the section and the analysis, then refresh everything that shows them. */
function recompute() {
  S = sectionProperties(state.section, dims());
  const m = material();
  R = analyseBeam({ caseId: state.caseId, L: state.L, P: state.P, aFrac: state.aFrac, E: m.E, I: S.I, c: S.c, wSelf: wSelf() });
  syncControls();
  updateReadouts();
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  announce(
    `Maximum deflection ${mm(R.deltaMax)} millimetres, ${sigT(screenPx(R.deltaMax), 2)} pixels at true size. ` +
      `Bending stress ${sigT(R.sigmaMax / 1e6, 3)} megapascals, ${sigT((R.sigmaMax / m.strength) * 100, 2)} percent of the ${m.strengthShort}.`,
  );
}

function syncControls() {
  for (const p of params) p.sync();
  $('case-select').value = state.caseId;
  $('section-select').value = state.section;
  $('material-select').value = state.materialId;
  $('self-weight').checked = state.selfWeight;
  for (const el of document.querySelectorAll('.controls-card [data-section]')) el.hidden = el.dataset.section !== state.section;
  $('a-control').hidden = state.caseId !== 'simple-point';
  setText($('a-max'), `right support (${mm(state.L, 4)} mm)`);

  const udl = isUdl();
  $('P-label').innerHTML = udl ? 'Total load <var>W</var>, spread evenly' : 'Point load <var>P</var>';
  setText($('P-note'), udl
    ? `= ${sigT(newtonsToKg(state.P), 3)} kg spread evenly (weight at g₀), w = W / L = ${num(state.P / state.L)} N/m`
    : `= the weight of ${sigT(newtonsToKg(state.P), 3)} kg (at g₀ = 9.80665 m/s²)`);

  const m = material();
  const ws = selfWeightPerMetre(m.density, S.A);
  setText($('sw-note'), `${num(ws)} N/m, ${sigT(ws * state.L / G0, 3)} kg over the span`);

  const note = $('material-note');
  note.textContent = '';
  const b = (t) => Object.assign(document.createElement('b'), { textContent: t });
  note.append('E = ', b(`${sigT(m.E / 1e9, 3)} GPa`), ' · ρ = ', b(`${sigT(m.density, 4)} kg/m³`),
    ` · ${m.strengthName}: `, b(`${sigT(m.strength / 1e6, 3)} MPa`), `. ${m.note} Source: `);
  const a = Object.assign(document.createElement('a'), { href: m.url, textContent: m.source });
  note.append(a, '.');

  if (state.section === 'i') {
    const ipe = PRESET_SIZES.ipe100;
    const simple = sectionProperties('i', { bf: ipe.b, h: ipe.h, tf: ipe.tf, tw: ipe.tw });
    setText($('i-note'), `Simplified: no root radii between web and flanges, so a rolled beam is a few per cent stiffer (IPE 100: ${sigT(simple.I * 1e8, 3)} cm⁴ here, ${sigT(ipe.Iy * 1e8, 3)} cm⁴ in the steel maker's table).`);
  }
}

function whereText(x) {
  if (isCantilever()) return `at the free end, ${mm(state.L, 4)} mm from the wall`;
  if (Math.abs(x - state.L / 2) < state.L * 1e-4) return `at mid-span, ${mm(x, 4)} mm from each support`;
  return `${mm(x, 3)} mm from the left support`;
}

function updateReadouts() {
  const m = material();
  const d = R.deltaMax;
  setText(outputs.delta, mm(d));
  setText(outputs.deltaUm, sigT(d * 1e6, 3));
  setText(outputs.deltaPx, sigT(screenPx(d), 2));
  setText(outputs.where, d > 0 ? `${whereText(R.xDelta)[0].toUpperCase()}${whereText(R.xDelta).slice(1)}` : 'No load: no deflection');
  setText(outputs.slope, sigT(radToDeg(R.endSlope), 3));
  setText(outputs.slopeSub, `${sigT(R.endSlope * 1000, 3)} mrad, ${isCantilever() ? 'at the free end' : `at the ${R.slopeEnd} support`}`);
  setText(outputs.ratio, Number.isFinite(R.spanRatio) ? `L/${sig(R.spanRatio, 3)}` : 'no deflection');
  setText(outputs.M, sigT(Math.abs(R.Mmax), 3));
  setText(outputs.Mwhere, isCantilever() ? 'at the wall (hogging)' : (state.caseId !== 'simple-udl' && !state.selfWeight)
    ? 'under the load' : whereText(R.xM));
  setText(outputs.sigma, sigT(R.sigmaMax / 1e6, 3));
  setText(outputs.strengthName, m.strengthShort);
  setText(outputs.pct, sigT((R.sigmaMax / m.strength) * 100, 3));
  setText(outputs.strength, `${m.strengthShort} ${sigT(m.strength / 1e6, 3)}`);
  setText(outputs.I, S.I * 1e12 < 1e9 ? sig(S.I * 1e12, 4) : sci(S.I * 1e12, 4));
  setText(outputs.Icm, num(S.I * 1e8, 3));
  setText(outputs.Z, num(S.Z * 1e9, 3));
  setText(outputs.EI, num(R.EI, 3));
  setText(outputs.A, num(S.A * 1e6, 3));

  const warn = [];
  if (R.sigmaMax > m.strength) warn.push(`The stress is above the ${m.strengthShort} of this material: a real beam would bend permanently or break, and these elastic formulas no longer apply.`);
  if (d > LARGE_DEFLECTION * state.L) warn.push('The deflection is more than a tenth of the span: these formulas assume small deflections, so treat the numbers as rough.');
  setText($('warn-line'), warn.join(' '));
}

/** Live-substituted equations in "The maths" card. */
function updateEquations() {
  for (const el of document.querySelectorAll('.maths-card [data-case]')) el.hidden = el.dataset.case !== state.caseId;
  for (const el of document.querySelectorAll('.maths-card [data-section]')) el.hidden = el.dataset.section !== state.section;

  const m = material();
  const { L, P } = state;
  const EI = R.EI;
  const Ls = sigT(L, 4);
  const EIs = num(EI);
  const Ps = num(P);
  const w = P / L;
  const ws = num(w);
  const deg = (rad) => `${num(rad)} rad = ${sigT(radToDeg(rad), 3)}°`;
  const len = (x) => `${num(x)} m = ${mm(x)} mm`;
  let load = 0; // deflection from the applied load alone
  switch (state.caseId) {
    case 'cantilever-end':
      load = deltaCantileverEnd(P, L, EI);
      setEq('deltaLoad', `P = ${Ps} N, L = ${Ls} m, EI = ${EIs} N·m²: δ = ${Ps} × ${Ls}³ / (3 × ${EIs}) = ${len(load)}.`);
      setEq('mLoad', `M = ${Ps} × ${Ls} = ${num(P * L)} N·m; θ = ${Ps} × ${Ls}² / (2 × ${EIs}) = ${deg((P * L * L) / (2 * EI))}.`);
      break;
    case 'cantilever-udl':
      load = deltaCantileverUdl(w, L, EI);
      setEq('deltaLoad', `w = ${Ps} / ${Ls} = ${ws} N/m: δ = ${ws} × ${Ls}⁴ / (8 × ${EIs}) = ${len(load)}.`);
      setEq('mLoad', `M = ${ws} × ${Ls}² / 2 = ${num((w * L * L) / 2)} N·m; θ = ${deg((w * L ** 3) / (6 * EI))}.`);
      break;
    case 'simple-centre':
      load = deltaSimpleCentre(P, L, EI);
      setEq('deltaLoad', `P = ${Ps} N, L = ${Ls} m, EI = ${EIs} N·m²: δ = ${Ps} × ${Ls}³ / (48 × ${EIs}) = ${len(load)}.`);
      setEq('mLoad', `M = ${Ps} × ${Ls} / 4 = ${num((P * L) / 4)} N·m; θ = ${deg((P * L * L) / (16 * EI))}.`);
      break;
    case 'simple-udl':
      load = deltaSimpleUdl(w, L, EI);
      setEq('deltaLoad', `w = ${Ps} / ${Ls} = ${ws} N/m: δ = 5 × ${ws} × ${Ls}⁴ / (384 × ${EIs}) = ${len(load)}.`);
      setEq('mLoad', `M = ${ws} × ${Ls}² / 8 = ${num((w * L * L) / 8)} N·m; θ = ${deg((w * L ** 3) / (24 * EI))}.`);
      break;
    case 'simple-point': {
      const a = loadPosition(state.caseId, L, state.aFrac);
      const b = L - a;
      const pt = deltaSimplePoint(P, a, L, EI);
      load = pt.delta;
      setEq('deltaA', `a = ${num(a)} m, b = ${num(b)} m: δa = ${len((P * a * a * b * b) / (3 * EI * L))}.`);
      setEq('deltaLoad', `δmax = ${len(load)}, at x = ${mm(pt.x)} mm.`);
      setEq('mLoad', `M = ${Ps} × ${num(a)} × ${num(b)} / ${Ls} = ${num((P * a * b) / L)} N·m.`);
      break;
    }
    default:
      break;
  }

  const ws0 = selfWeightPerMetre(m.density, S.A);
  const selfAlone = isCantilever() ? deltaCantileverUdl(ws0, L, EI) : deltaSimpleUdl(ws0, L, EI);
  setEq('self', state.selfWeight
    ? `${sigT(m.density, 4)} kg/m³ × ${num(S.A)} m² × 9.80665 = ${num(ws0)} N/m, which alone sags ${mm(selfAlone)} mm. The combined curve's maximum is ${mm(R.deltaMax)} mm.`
    : `Self-weight is off. It would add ${num(ws0)} N/m, which alone sags ${mm(selfAlone)} mm.`);

  const d = dims();
  const Imm = S.I * 1e12 < 1e9 ? sig(S.I * 1e12, 4) : sci(S.I * 1e12, 4);
  const Im4 = sci(S.I, 3);
  const f = (v) => sigT(v * 1000, 4); // mm
  const iText = {
    rect: () => `${f(d.b)} × ${f(d.h)}³ / 12`,
    round: () => `π × ${f(d.d)}⁴ / 64`,
    tube: () => `π × (${f(d.D)}⁴ − ${f(d.D - 2 * Math.min(d.t, d.D / 2))}⁴) / 64`,
    rhs: () => `(${f(d.B)} × ${f(d.H)}³ − ${f(d.B - 2 * d.t)} × ${f(d.H - 2 * d.t)}³) / 12`,
    i: () => `(${f(d.bf)} × ${f(d.h)}³ − ${f(d.bf - d.tw)} × ${f(d.h - 2 * d.tf)}³) / 12`,
  }[state.section]();
  setEq('I', `${iText} = ${Imm} mm⁴ = ${Im4} m⁴.`);
  setEq('sigma', `M = ${num(Math.abs(R.Mmax))} N·m, c = ${mm(S.c)} mm: σ = ${num(Math.abs(R.Mmax))} × ${num(S.c)} / ${Im4} = ${sigT(R.sigmaMax / 1e6, 3)} MPa.`);
  const dprText = dpr() === 1 ? '' : ` × ${sigT(dpr(), 3)} device pixels per CSS pixel`;
  setEq('px', `δ = ${num(R.deltaMax)} m × ${fmt(sim.k, 0)} px/m${dprText} = ${sigT(screenPx(R.deltaMax), 2)} screen pixels (${scaleSourceText(sim.scale)}).`);
}

/** Numbers quoted in the explainer, computed from the cited data (see tests/beam.test.html). */
function updateExplainer() {
  const calc = (key, text) => document.querySelectorAll(`[data-calc="${key}"]`).forEach((n) => setText(n, text));
  const steel = MATERIALS.find((m) => m.id === 's355');
  const alu = MATERIALS.find((m) => m.id === 'al6082');
  const c24 = MATERIALS.find((m) => m.id === 'c24');
  const pmma = MATERIALS.find((m) => m.id === 'pmma');
  calc('steelAlu', sigT(steel.E / alu.E, 2));
  calc('steelWood', sigT(steel.E / c24.E, 2));
  const { width: b, thickness: t } = PRESET_SIZES.shelfBoard;
  calc('edgeRatio', fmt((b / t) ** 2, 0));

  const ipe = PRESET_SIZES.ipe100;
  const ipeS = sectionProperties('i', { bf: ipe.b, h: ipe.h, tf: ipe.tf, tw: ipe.tw });
  const ipeR = analyseBeam({ caseId: 'simple-centre', L: 1, P: kgToNewtons(4000), E: steel.E, I: ipeS.I, c: ipeS.c });
  const k24 = devicePxPerMetreFromScreen(DEFAULT_SCREEN.diagonalIn, DEFAULT_SCREEN.resW, DEFAULT_SCREEN.resH);
  calc('ipePct', fmt((ipeR.sigmaMax / steel.strength) * 100, 0));
  calc('ipeDelta', sigT(ipeR.deltaMax * 1000, 2));
  calc('ipePx', fmt(ipeR.deltaMax * k24, 0));
  calc('ipeI', sigT(ipeS.I * 1e8, 3));
  calc('pmmaStrength', sigT(pmma.strength / 1e6, 3));
  calc('pmmaLong', `${pmma.longTermStressMPa[0]} to ${pmma.longTermStressMPa[1]}`);

  const P = kgToNewtons(20);
  const sec = sectionProperties('rect', { b, h: t });
  const we = analyseBeam({ caseId: 'simple-centre', L: 1, P, E: c24.E, I: sec.I, c: sec.c });
  const half = analyseBeam({ caseId: 'simple-centre', L: 0.5, P, E: c24.E, I: sec.I, c: sec.c });
  calc('weP', sigT(P, 3));
  calc('weI', fmt(sec.I * 1e12, 0));
  calc('weE', sigT(c24.E / 1e9, 3));
  calc('weDelta', sigT(we.deltaMax * 1000, 3));
  calc('weRatio', fmt(we.spanRatio, 0));
  calc('weM', sigT(we.Mmax, 2));
  calc('weSigma', sigT(we.sigmaMax / 1e6, 3));
  calc('wePct', fmt((we.sigmaMax / c24.strength) * 100, 0));
  calc('weHalf', sigT(half.deltaMax * 1000, 2));
}

function describe() {
  if (!R) return 'Beam deflection drawing';
  const lay = sim.width > 0 ? layout(sim.width, sim.height, sim.k) : null;
  const m = material();
  const scaleWord = !lay || lay.N === 1 ? `true size 1:1${sim.scale.calibrated ? '' : ' (approximate until the screen is calibrated)'}` : `scaled 1:${lay.N}, length and deflection together`;
  const exag = state.exag === 1 ? 'The bend is drawn at the same scale' : `The bend is exaggerated ${state.exag} times`;
  const loadWords = isUdl()
    ? `${sigT(state.P, 3)} newtons spread evenly`
    : `${sigT(state.P, 3)} newtons (${sigT(newtonsToKg(state.P), 3)} kilograms) ${isCantilever() ? 'at the free end' : state.caseId === 'simple-centre' ? 'at mid-span' : `at ${mm(state.aFrac * state.L)} millimetres from the left support`}`;
  return `Side view, ${scaleWord}, of a ${isCantilever() ? 'cantilever' : 'simply supported beam'} ${mm(state.L, 4)} millimetres long in ${m.name}, ` +
    `depth ${mm(S.depth)} millimetres, carrying ${loadWords}${state.selfWeight ? ' plus its own weight' : ''}. ` +
    `${exag}. Maximum deflection ${mm(R.deltaMax)} millimetres, ${sigT(screenPx(R.deltaMax), 2)} screen pixels at true size.`;
}

/* =========================================================================
 * 4. Step: nothing moves (static drawing)
 * ====================================================================== */

function step() {}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre; kd = k / N is the drawing scale)
 * ====================================================================== */

/** Where everything goes for this canvas size and these inputs (static: depends only on inputs). */
function layout(w, h, k) {
  const exag = state.exag;
  const d = R.deltaMax;
  const mag = calloutMagnification(d * k, CALLOUT.targetPx);
  const callout = state.showCallout && mag >= 2 && d > 0;
  // Room for the scale badge, the exaggeration badge and one exaggeration note is kept whatever
  // the factor, so the badges never push the beam around.
  const warnTags = warnings().length;
  const badgesH = 12 + 26 + 38 + (1 + warnTags) * 28 + 6;
  const topH = Math.max(badgesH, callout ? CALLOUT.h + 20 : 0);
  const chartH = state.showMoment ? CHART_H : 0;
  const support = SUPPORT_H[CASES[state.caseId].support];
  const rulerMax = h - chartH - RULER_H - 6;                // the ruler never goes lower than this
  const beamTop = topH + ARROWS_H;
  const zoneH = rulerMax - beamTop;                         // depth + true bend + supports must fit here
  const availW = w - MARGIN_L - MARGIN_R;
  // One scale for everything: the smallest whole 1:N that fits the span across and the depth plus the TRUE bend down.
  const N = Math.max(
    fitScale(state.L * k, availW),
    fitScale((S.depth + d) * k, Math.max(20, zoneH - support)),
  );
  const kd = k / N;
  const beamPx = state.L * kd;
  const x0 = MARGIN_L + Math.max(0, (availW - beamPx) / 2);
  const depthPx = Math.max(1, S.depth * kd);
  // Spare height is shared: 40% above the drawing, the rest below. With the true bend that spare is
  // what an exaggerated bend can use, so the beam only moves up when an exaggerated bend needs more.
  const below = (sag) => Math.max(support, sag + 36);
  const sagPx = d * kd * exag;                              // drawn bend at its lowest point
  const spareTrue = rulerMax - (beamTop + depthPx + below(d * kd));
  const spareNow = rulerMax - (beamTop + depthPx + below(sagPx));
  const shift = clamp(spareNow, 0, Math.max(0, spareTrue) * 0.4);
  const beamBottom = beamTop + shift + depthPx;
  // An exaggerated bend that still needs more room first squeezes the moment diagram, then hides it
  // (it comes back at smaller factors).
  const chartRoom = h - (beamBottom + below(sagPx)) - RULER_H - 6;
  const chartFinal = chartH > 0 && chartRoom < chartH ? (chartRoom >= CHART_H_MIN ? chartRoom : 0) : chartH;
  const chartMakesRoom = chartH > 0 && chartFinal === 0;
  const rulerLimit = h - chartFinal - RULER_H - 6;
  // The ruler sits just under the supports, or under the drawn bend when that hangs lower.
  const rulerY = Math.min(rulerLimit, beamBottom + below(sagPx));
  return {
    N, kd, x0, x1: x0 + beamPx, beamPx, beamTop: beamTop + shift, beamBottom, depthPx, rulerY, topH,
    chartH: chartFinal, chartMakesRoom,
    chartY: rulerY + RULER_H + 6,                           // the moment diagram follows the ruler
    clipY: rulerY - 4, callout, mag, exag,
  };
}

function warnings() {
  const out = [];
  if (R.sigmaMax > material().strength) out.push(`Stress above the ${material().strengthShort}: the formulas no longer apply`);
  if (R.deltaMax > LARGE_DEFLECTION * state.L) out.push('Deflection over a tenth of the span: small-deflection formulas are rough here');
  return out;
}

function draw(ctx, w, h, k, colors) {
  if (!R) return;
  const lay = layout(w, h, k);
  lastLayout = lay;
  const { kd, x0, beamTop, depthPx, exag } = lay;
  const L = state.L;
  const X = (x) => x0 + x * kd;
  const vPx = (x) => R.v(x) * kd * exag;               // drawn bend, px (down +)
  const exaggerated = exag !== 1;
  const stroke = exaggerated ? colors.warn : colors.accent;
  const fill = exaggerated ? colors.warnBg : withAlpha(colors.accentRgb, 0.2);

  drawSupports(ctx, lay, colors);
  if (lay.callout) drawLeader(ctx, w, lay, vPx(R.xDelta), colors); // under the beam's translucent fill

  // Deflected beam: a band of the true depth, displaced by the (possibly exaggerated) bend
  const n = clamp(Math.round(lay.beamPx / 2), 24, 600);
  const top = [];
  for (let i = 0; i <= n; i++) {
    const x = (L * i) / n;
    top.push([X(x), beamTop + vPx(x)]);
  }
  const maxDrawn = vPx(R.xDelta);
  const clipped = lay.beamBottom + maxDrawn > lay.clipY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, lay.clipY);
  ctx.clip();
  ctx.beginPath();
  top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  for (let i = n; i >= 0; i--) ctx.lineTo(top[i][0], top[i][1] + depthPx);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = depthPx < 3 ? 1 : 1.5;
  ctx.stroke();
  if (depthPx >= 14) drawSectionLines(ctx, top, depthPx, kd, colors, exaggerated);
  ctx.restore();

  // Undeformed beam: dashed outline on top, so it stays visible where they overlap
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x0, beamTop, lay.beamPx, depthPx);
  ctx.restore();

  drawLoads(ctx, lay, vPx, colors);
  drawRuler(ctx, colors, { x: x0, y: lay.rulerY, lengthM: L, k: kd });

  drawDeflectionTag(ctx, lay, maxDrawn, colors);
  drawBadges(ctx, lay, clipped, colors);
  if (lay.callout) drawCallout(ctx, w, lay, colors);
  if (lay.chartH > 0) drawMomentDiagram(ctx, w, h, lay, colors);
}

/** Hidden walls of hollow sections (dashed) and the flanges of an I-section, following the bend. */
function drawSectionLines(ctx, top, depthPx, kd, colors, exaggerated) {
  const d = dims();
  let offsets = [];
  if (state.section === 'i') offsets = [d.tf, d.h - d.tf];
  else if (state.section === 'rhs') offsets = [d.t, d.H - d.t];
  else if (state.section === 'tube') offsets = [d.t, d.D - d.t];
  if (!offsets.length) return;
  ctx.save();
  ctx.strokeStyle = exaggerated ? colors.warn : colors.accent;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  if (state.section !== 'i') ctx.setLineDash([4, 3]);
  for (const off of offsets) {
    const dy = off * kd;
    if (dy < 2 || depthPx - dy < 2) continue;
    ctx.beginPath();
    top.forEach(([px, py], i) => (i ? ctx.lineTo(px, py + dy) : ctx.moveTo(px, py + dy)));
    ctx.stroke();
  }
  ctx.restore();
}

/** Hatched wall for a cantilever; pin and roller (with ground hatching) for a simple beam. */
function drawSupports(ctx, lay, colors) {
  const { x0, x1, beamTop, beamBottom } = lay;
  ctx.save();
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 1.5;
  if (isCantilever()) {
    const yTop = beamTop - 34;
    const yBot = beamBottom + 34;
    ctx.beginPath();
    ctx.moveTo(x0, yTop);
    ctx.lineTo(x0, yBot);
    ctx.stroke();
    hatch(ctx, x0 - 18, yTop, 18, yBot - yTop, colors.muted);
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('wall', x0 - 18, yBot + 4);
  } else {
    const tri = 18;
    const half = 11;
    // Pin (left): triangle on the ground
    ctx.beginPath();
    ctx.moveTo(x0, beamBottom);
    ctx.lineTo(x0 - half, beamBottom + tri);
    ctx.lineTo(x0 + half, beamBottom + tri);
    ctx.closePath();
    ctx.stroke();
    groundLine(ctx, x0, beamBottom + tri, colors);
    // Roller (right): triangle on two wheels
    ctx.beginPath();
    ctx.moveTo(x1, beamBottom);
    ctx.lineTo(x1 - half, beamBottom + tri - 7);
    ctx.lineTo(x1 + half, beamBottom + tri - 7);
    ctx.closePath();
    ctx.stroke();
    for (const dx of [-5.5, 5.5]) {
      ctx.beginPath();
      ctx.arc(x1 + dx, beamBottom + tri - 3.5, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    groundLine(ctx, x1, beamBottom + tri, colors);
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.fillText('pin', x0, beamBottom + tri + 10);
    ctx.fillText('roller', x1, beamBottom + tri + 10);
  }
  ctx.restore();
}

function groundLine(ctx, x, y, colors) {
  ctx.beginPath();
  ctx.moveTo(x - 16, y);
  ctx.lineTo(x + 16, y);
  ctx.stroke();
  ctx.save();
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -16; i < 16; i += 5) {
    ctx.moveTo(x + i + 4, y);
    ctx.lineTo(x + i, y + 5);
  }
  ctx.stroke();
  ctx.restore();
}

function hatch(ctx, x, y, w, h, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let t = -w; t < h + w; t += 7) {
    ctx.moveTo(x + w, y + t);
    ctx.lineTo(x, y + t + w);
  }
  ctx.stroke();
  ctx.restore();
}

/** Load arrows touching the (drawn) top of the beam, and their label. */
function drawLoads(ctx, lay, vPx, colors) {
  const { x0, x1, beamTop } = lay;
  const L = state.L;
  const X = (x) => x0 + x * lay.kd;
  const kg = sigT(newtonsToKg(state.P), 3);
  ctx.save();
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = 'bottom';
  let labelX;
  let labelY;
  if (isUdl()) {
    const lineY = beamTop - ARROW_PX + 14;
    const count = clamp(Math.round(lay.beamPx / 26), 3, 60);
    ctx.strokeStyle = colors.fg;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, lineY);
    ctx.lineTo(x1, lineY);
    ctx.stroke();
    for (let i = 0; i <= count; i++) {
      const x = (L * i) / count;
      drawArrow(ctx, X(x), lineY, X(x), Math.min(beamTop + vPx(x), lay.clipY) - 1, colors.fg, { width: 1.5, head: 7 });
    }
    labelX = (x0 + x1) / 2;
    labelY = lineY - 6;
    ctx.textAlign = 'center';
    const text = `W = ${sigT(state.P, 3)} N (${kg} kg) spread evenly: w = ${num(state.P / L)} N/m`;
    ctx.fillText(text, clamp(labelX, ctx.measureText(text).width / 2 + 8, sim.width - ctx.measureText(text).width / 2 - 8), labelY);
  } else {
    const a = loadPosition(state.caseId, L, state.aFrac);
    const xa = X(a);
    // The tail and label stay put above the unloaded beam; the tip follows the drawn bend.
    const tipY = Math.min(beamTop + vPx(a), lay.clipY) - 1;
    drawArrow(ctx, xa, beamTop - ARROW_PX, xa, tipY, colors.fg, { width: 2.5, head: 11 });
    const where = state.caseId === 'simple-point' ? ` at a = ${mm(a, 4)} mm` : '';
    const text = `P = ${sigT(state.P, 3)} N (${kg} kg)${where}`;
    const tw = ctx.measureText(text).width;
    ctx.textAlign = 'left';
    labelX = clamp(xa - tw / 2, 8, sim.width - tw - 8);
    labelY = beamTop - ARROW_PX - 6;
    ctx.fillText(text, labelX, labelY);
  }
  if (state.selfWeight) {
    // Own weight is spread along the whole beam: noted in words (cantilever: by the wall, clear of the end load)
    const ws = wSelf();
    const text = `+ own weight ${num(ws)} N/m (${sigT((ws * L) / G0, 3)} kg in all)`;
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.textBaseline = 'bottom';
    const y = isUdl() ? labelY - 18 : beamTop - 6;
    if (isCantilever()) {
      ctx.textAlign = 'left';
      ctx.fillText(text, x0 + 6, y);
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(text, x1 - 2, y);
    }
  }
  ctx.restore();
}

/** "Max deflection 0.38 mm = 1.4 px" under the deflected beam at its lowest point. */
function drawDeflectionTag(ctx, lay, maxDrawn, colors) {
  const d = R.deltaMax;
  if (!(d > 0)) return;
  const xPx = lay.x0 + R.xDelta * lay.kd;
  const yBottom = Math.min(lay.beamBottom + maxDrawn, lay.clipY);
  const px = screenPx(d);
  let text = `Max deflection ${mm(d)} mm = ${sigT(px, 2)} px`;
  if (lay.N !== 1) text += ` at 1:1 (${sigT(px / lay.N, 2)} px at 1:${lay.N})`;
  if (lay.exag !== 1) text += `, drawn ×${lay.exag} = ${sigT(maxDrawn * dpr(), 2)} px`;

  // Dimension arrow for the drawn bend, when it is big enough to show
  if (maxDrawn >= 16) {
    const ax = xPx + (isCantilever() ? 14 : 14);
    ctx.save();
    ctx.strokeStyle = lay.exag !== 1 ? colors.warn : colors.fg;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xPx - 4, lay.beamBottom);
    ctx.lineTo(ax + 6, lay.beamBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax, lay.beamBottom + 1);
    ctx.lineTo(ax, yBottom - 1);
    ctx.stroke();
    drawArrowHead(ctx, ax, lay.beamBottom, 0, -1, 6);
    drawArrowHead(ctx, ax, yBottom, 0, 1, 6);
    ctx.restore();
  }

  ctx.save();
  ctx.font = FONT_BOLD;
  const tw = ctx.measureText(text).width + 16;
  let x;
  let y = Math.min(yBottom + 20, lay.rulerY - 16);
  let align = 'center';
  if (isCantilever()) {
    // Beside the free end when there is room (clear of the wall), otherwise under it
    if (lay.x1 + 30 + tw < sim.width - 8) {
      x = lay.x1 + 30;
      y = Math.max(lay.beamBottom, yBottom - 4);
      align = 'left';
    } else {
      x = Math.min(lay.x1 + 6, sim.width - 8);
      align = 'right';
    }
  } else {
    x = clamp(xPx, tw / 2 + 8, sim.width - tw / 2 - 8);
  }
  drawTag(ctx, text, x, y, {
    align,
    color: lay.exag !== 1 ? colors.warn : colors.fg,
    background: lay.exag !== 1 ? colors.warnBg : colors.bg,
    border: lay.exag !== 1 ? colors.warn : colors.track,
  });
  ctx.restore();
}

/** Scale badge, exaggeration badge and warnings, stacked at the top left. */
function drawBadges(ctx, lay, clipped, colors) {
  const warn = { color: colors.warn, background: colors.warnBg };
  let y = 12 + 13;
  const bent = lay.exag !== 1;
  if (lay.N === 1) {
    const text = bent ? 'SPAN AND DEPTH AT TRUE SIZE 1:1' : 'TRUE SIZE 1:1';
    drawTag(ctx, sim.scale.calibrated ? text : `${text} (approximate: calibrate your screen)`, 12, y,
      sim.scale.calibrated ? { color: colors.ok, background: colors.okBg } : warn);
  } else {
    drawTag(ctx, bent ? `SPAN AND DEPTH SCALED 1:${lay.N}` : `SCALED 1:${lay.N} (length and deflection scaled together)`, 12, y, warn);
  }
  y += 13;
  if (lay.exag !== 1) {
    y += 8 + 15;
    drawTag(ctx, `EXAGGERATED ×${lay.exag}: the bend is drawn ${lay.exag} times larger than real`, 12, y, {
      ...warn, border: colors.warn, font: BIG_FONT, height: 30, padX: 12,
    });
    y += 15;
  }
  const notes = warnings();
  if (clipped) notes.push(`At ×${lay.exag} the bend runs off the drawing${lay.chartMakesRoom ? ' (moment diagram hidden)' : ''}: try a smaller factor`);
  else if (lay.chartMakesRoom) notes.push(`Moment diagram hidden to make room for the ×${lay.exag} bend`);
  for (const t of notes) {
    y += 6 + 11;
    drawTag(ctx, t, 12, y, warn);
    y += 11;
  }
}

/** Box position of the magnified callout (top right). */
function calloutBox(w) {
  const bw = Math.min(CALLOUT.w, w * 0.42);
  return { bx: w - bw - 12, by: 10, bw, bh: CALLOUT.h };
}

/** Ring at the lowest point of the drawn beam, and a dashed leader up to the callout. */
function drawLeader(ctx, w, lay, maxDrawn, colors) {
  const { bx, by, bw, bh } = calloutBox(w);
  const px = lay.x0 + R.xDelta * lay.kd;
  const py = Math.min(lay.beamBottom + maxDrawn, lay.clipY);
  ctx.save();
  ctx.strokeStyle = colors.warn;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.stroke();
  const tx = clamp(px, bx + 16, bx + bw - 16);
  const len = Math.hypot(tx - px, by + bh - py);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(px + ((tx - px) / len) * 8, py + ((by + bh - py) / len) * 8);
  ctx.lineTo(tx, by + bh);
  ctx.stroke();
  ctx.restore();
}

/**
 * Magnified callout of the REAL deflection at its maximum (independent of the
 * drawing scale and of the exaggeration): the underside of the beam before
 * and after loading, with a small ruler in µm or mm at the same magnification.
 */
function drawCallout(ctx, w, lay, colors) {
  const k = sim.k;
  const M = lay.mag;
  const d = R.deltaMax;
  const { bx, by, bw, bh } = calloutBox(w);
  const kM = k * M;              // px per metre inside the callout
  const gapPx = d * kM;

  // Box
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.strokeStyle = colors.warn;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.clip();

  const top = by + 32;           // drawing area starts under the header
  const yU = by + 50;            // underside before loading
  const yD = yU + gapPx;         // underside after loading
  const left = bx + 10;
  const rx = bx + bw - 14;       // ruler line (ticks and labels to its left)
  ctx.fillStyle = withAlpha(colors.accentRgb, 0.18);
  ctx.fillRect(left, top, rx - 4 - left, yD - top);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, yD);
  ctx.lineTo(rx - 4, yD);
  ctx.stroke();
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(left, yU);
  ctx.lineTo(rx - 4, yU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'bottom';
  ctx.fillText('underside before loading', left + 2, yU - 2);
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = 'top';
  ctx.fillText('after loading', left + 2, yD + 3);

  // Dimension arrow and value
  const ax = bx + bw - 150;
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.beginPath();
  ctx.moveTo(ax, yU + 1);
  ctx.lineTo(ax, yD - 1);
  ctx.stroke();
  drawArrowHead(ctx, ax, yU, 0, -1, 6);
  drawArrowHead(ctx, ax, yD, 0, 1, 6);
  ctx.font = FONT_BOLD;
  ctx.textBaseline = 'middle';
  const um = d * 1e6;
  ctx.fillText(um < 1000 ? `${sigT(um, 3)} µm` : `${mm(d)} mm`, ax + 8, (yU + yD) / 2);

  // Ruler at the same magnification: minor ticks every 1-2-5 step at least 7 px apart, labels every 5
  const stepM = niceStep(7 / kM);
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.beginPath();
  ctx.moveTo(rx, yU);
  ctx.lineTo(rx, by + bh);
  for (let i = 0; yU + i * stepM * kM <= by + bh; i++) {
    const y = yU + i * stepM * kM;
    const major = i % 5 === 0;
    ctx.moveTo(rx, y);
    ctx.lineTo(rx - (major ? 9 : 5), y);
    if (major && y < by + bh - 7) {
      const v = i * stepM;
      const t = i === 0 ? '0' : v < 1e-3 - 1e-12 ? `${tickLabel(v * 1e6)} µm` : `${tickLabel(v * 1e3)} mm`;
      const tw = ctx.measureText(t).width;
      ctx.save();
      ctx.fillStyle = colors.bg; // readable where it crosses the loaded underside
      ctx.fillRect(rx - 14 - tw, y - 7, tw + 4, 14);
      ctx.restore();
      ctx.fillText(t, rx - 12, y);
    }
  }
  ctx.stroke();
  ctx.restore();

  drawTag(ctx, `MAGNIFIED ×${fmt(M, 0)}`, bx + 8, by + 16, { color: colors.warn, background: colors.warnBg });
  ctx.save();
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(isCantilever() ? 'real bend at the free end' : 'real bend at the lowest point', bx + bw - 10, by + 16);
  ctx.restore();
}

/** Bending-moment diagram under the beam, aligned with it when it is wide enough. */
function drawMomentDiagram(ctx, w, h, lay, colors) {
  const L = state.L;
  const minW = 360;
  // Aligned with the beam (same x for the same point) when wide enough; the box may start a
  // little right of the beam's end to leave room for the tick labels, with the axis range trimmed to match.
  let bx = Math.max(lay.x0, CHART_LABEL_W);
  let bw = lay.x1 - bx;
  let xr = [(bx - lay.x0) / lay.kd, L];
  if (bw < minW) {
    bw = Math.min(minW, w - CHART_LABEL_W - MARGIN_R);
    bx = clamp((lay.x0 + lay.x1) / 2 - bw / 2, CHART_LABEL_W, w - MARGIN_R - bw);
    xr = [0, L];
  }
  const box = { x: bx, y: lay.chartY + 26, w: bw, h: lay.chartH - 26 - 30 };
  const n = 240;
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(xr[0] + ((L - xr[0]) * i) / n);
  const a = loadPosition(state.caseId, L, state.aFrac);
  if (a !== null && a > xr[0] && a < L) xs.push(a);
  xs.sort((p, q) => p - q);
  const pts = xs.map((x) => [x, R.M(x)]);
  let lo = Math.min(0, ...pts.map((p) => p[1]));
  let hi = Math.max(0, ...pts.map((p) => p[1]));
  if (hi - lo <= 0) { lo = -1; hi = 1; }
  const pad = (hi - lo) * 0.45; // room for the peak's label inside the box
  const yr = [lo < 0 ? lo - pad * 0.2 : 0, hi > 0 ? hi + pad : 0];
  const title = `Bending moment M (N·m), ${isCantilever() ? 'hogging, so negative' : 'sagging +'}`;
  let xLabel = isCantilever() ? 'distance from the wall (mm)' : 'distance from the left support (mm)';
  ctx.font = FONT_BOLD;
  const titleW = ctx.measureText(title).width;
  ctx.font = FONT;
  if (titleW + ctx.measureText(xLabel).width + 24 > bw) xLabel = 'mm';
  const { X, Y } = drawChart(ctx, colors, {
    box, xr, yr,
    series: [{ points: pts, color: colors.accent, width: 2 }],
    title,
    xLabel,
    xFmt: (v) => tickLabel(v * 1000), yFmt: tickLabel, xTicks: Math.max(2, Math.round(bw / 120)), yTicks: 3,
  });
  // Shade between the curve and zero
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(X(xr[0]), Y(0));
  for (const [x, m] of pts) ctx.lineTo(X(x), Y(m));
  ctx.lineTo(X(L), Y(0));
  ctx.closePath();
  ctx.fillStyle = withAlpha(colors.accentRgb, 0.12);
  ctx.fill();
  ctx.restore();
  // Peak
  const xm = R.xM;
  const mmax = R.Mmax;
  drawDot(ctx, X(xm), Y(mmax), 4, colors.accent);
  ctx.font = FONT_BOLD;
  const label = `Mmax = ${sigT(Math.abs(mmax), 3)} N·m`;
  const tw = ctx.measureText(label).width;
  const lx = clamp(X(xm) + 6, box.x + 4, box.x + box.w - tw - 12);
  // Above the dot (a hogging peak sits on the bottom axis), on the canvas colour so the curve can't strike it through
  drawTag(ctx, label, lx, Y(mmax) - 15, { color: colors.fg, background: colors.bg, height: 18, padX: 4 });
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  animated: false, // static drawing: there is nothing to play
  onScaleChange: () => {
    updateReadouts();
    updateEquations();
    sim.requestDraw();
  },
  debug: {
    state,
    results: () => R,
    section: () => S,
    layout: () => lastLayout,
    recompute,
  },
});

for (const m of MATERIALS) {
  $('material-select').append(new Option(m.name, m.id));
}
$('case-select').addEventListener('change', (e) => setCase(e.target.value));
$('section-select').addEventListener('change', (e) => setSection(e.target.value));
$('material-select').addEventListener('change', (e) => setMaterial(e.target.value));
$('self-weight').addEventListener('change', (e) => { state.selfWeight = e.target.checked; recompute(); });
$('show-moment').addEventListener('change', (e) => { state.showMoment = e.target.checked; sim.requestDraw(); });
$('show-callout').addEventListener('change', (e) => { state.showCallout = e.target.checked; sim.requestDraw(); });
for (const radio of document.querySelectorAll('input[name="exag"]')) {
  radio.addEventListener('change', () => setExaggeration(Number(radio.value)));
}

/** Presets: realistic sizes from the cited product pages; the loads are illustrative. */
function applyPreset(p, note) {
  Object.assign(state, { aFrac: 0.5, selfWeight: false, ...p.state });
  if (p.dims) Object.assign(state.dims[state.section], p.dims);
  setText($('preset-note'), note);
  recompute();
}
const board = PRESET_SIZES.shelfBoard;
const desk = PRESET_SIZES.deskBoard;
const rule = PRESET_SIZES.rule;
const box = PRESET_SIZES.aluBox;
const ipe = PRESET_SIZES.ipe100;
const pineNote = `Board ${mm(board.width)} × ${mm(board.thickness)} mm (${board.source}). Pine furniture board is not strength graded: C24 softwood values stand in for it.`;
initPresets({
  shelfShort: () => applyPreset({ state: { caseId: 'simple-centre', L: 0.5, P: kgToNewtons(20), section: 'rect', materialId: 'c24' },
    dims: { b: board.width, h: board.thickness } }, pineNote),
  bookshelf: () => applyPreset({ state: { caseId: 'simple-centre', L: 1, P: kgToNewtons(20), section: 'rect', materialId: 'c24' },
    dims: { b: board.width, h: board.thickness } }, pineNote),
  onEdge: () => applyPreset({ state: { caseId: 'simple-centre', L: 1, P: kgToNewtons(20), section: 'rect', materialId: 'c24' },
    dims: { b: board.thickness, h: board.width } }, `The same ${mm(board.width)} × ${mm(board.thickness)} mm board stood on its edge (it would need holding upright).`),
  rule: () => applyPreset({ state: { caseId: 'cantilever-end', L: 0.25, P: kgToNewtons(0.1), section: 'rect', materialId: 'ss304', selfWeight: true },
    dims: { b: rule.width, h: rule.thickness } }, `A ${mm(rule.width)} × ${mm(rule.thickness)} mm rule (${rule.source}) with 250 mm over the edge, 100 g on the end and its own weight. Real rules are hardened, so they are stronger than the 304 sheet used here.`),
  aluBox: () => applyPreset({ state: { caseId: 'simple-centre', L: box.length, P: kgToNewtons(10), section: 'rhs', materialId: 'al6082' },
    dims: { B: box.B, H: box.H, t: box.t } }, `${box.source}.`),
  desk: () => applyPreset({ state: { caseId: 'simple-centre', L: 1.1, P: kgToNewtons(15), section: 'rect', materialId: 'c24' },
    dims: { b: desk.width, h: desk.thickness } }, `A ${mm(desk.length, 4)} × ${mm(desk.width)} × ${mm(desk.thickness)} mm board (${desk.source}) on two trestles 1.1 m apart, with 15 kg in the middle. C24 values stand in for the pine.`),
  acrylic: () => applyPreset({ state: { caseId: 'simple-udl', L: 0.6, P: kgToNewtons(5), section: 'rect', materialId: 'pmma' },
    dims: { b: 0.2, h: PRESET_SIZES.acrylicSheet.thickness } }, `A 200 mm wide strip of ${mm(PRESET_SIZES.acrylicSheet.thickness)} mm cast acrylic sheet over 600 mm, with 5 kg spread along it. Under a load left for months, acrylic keeps creeping.`),
  ipe: () => applyPreset({ state: { caseId: 'simple-centre', L: 1, P: kgToNewtons(4000), section: 'i', materialId: 's355' },
    dims: { bf: ipe.b, h: ipe.h, tf: ipe.tf, tw: ipe.tw } }, `IPE 100: ${mm(ipe.h, 4)} × ${mm(ipe.b)} mm, web ${mm(ipe.tw)} mm, flanges ${mm(ipe.tf)} mm (${ipe.source}). 4 tonnes at mid-span takes it close to yield, yet it sags only a couple of millimetres. No lateral buckling check.`),
});

updateExplainer();
recompute();
sim.start();
