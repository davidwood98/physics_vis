/**
 * compact-objects.js: compact objects and the Schwarzschild radius (three views on one canvas).
 *
 *   squeeze  "Squeeze the Sun": the Sun's mass held fixed while its radius shrinks,
 *            through real measured sizes (Sirius B, PSR J0437−4715) down to its
 *            horizon. SCALED: the top shows the current object on a log-radius
 *            scale inside static rings for the four stages; the strip below shows
 *            each stage at its own linear scale, with a scale bar. Run-based: the
 *            Squeeze button animates the radius down (starts paused).
 *   earth    "Earth as a black hole (1:1)": Earth's horizon (2GM/c² = 8.87 mm) at TRUE
 *            SIZE beside a UK 5p coin and the space page's 2 cm Earth, and a black hole
 *            of any mass drawn 1:1 while it fits.
 *   sgra     "Sagittarius A*": its horizon (0.085 AU) drawn where the Sun would be, with
 *            Mercury's and Earth's orbits, the Sun at the same scale and the EHT shadow.
 *            SCALED, with a scale bar.
 *
 * Page pattern (as velocity.js): 1 constants + state, 2 setters, 3 UI sync,
 * 4 step, 5 draw (metres, converted to px only in draw), 6 wiring + start.
 * The maths is in compact-objects-model.js (unit tested); cited values in
 * data/compact-objects-data.js.
 */

import { TAU, clamp, G0, valueToLogFraction } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { createSim, bindParam, initTabs, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawDot, drawTag, drawRuler, drawArrowHead, FONT, FONT_BOLD } from './draw.js';
import {
  AU, PARSEC, LIGHT_YEAR, NEAR_EARTH_SCREEN_SIZE, sig, sigT, sci, sigWords, formatDistance,
  niceWorldBar, travelHint, trueSizeAlpha,
} from './astro.js';
import * as M from './compact-objects-model.js';
import {
  G, GM_SUN, GM_EARTH, GM_JUPITER, R_SUN, SIRIUS_B, NEUTRON_STARS, SGR_A, EHT_SGR_A, UK_5P_DIAMETER,
  PROTON_RADIUS, DEFAULT_PERSON_MASS,
} from './data/compact-objects-data.js';
import { PLANETS } from './data/bodies.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  rMin: M.RS_SUN, rMax: R_SUN,          // view 1 radius, m
  mMin: 1, mMax: 1e10 * M.M_SUN,        // view 2 mass, kg
  personMin: 1, personMax: 1000,        // your mass, kg
};
const SQUEEZE_DECADES_PER_S = 0.9;      // Squeeze animation: about 6 s from the Sun to the horizon
const MERCURY = PLANETS.find((p) => p.id === 'mercury');
const EARTH_ORBIT = PLANETS.find((p) => p.id === 'earth');
const NS = M.NEUTRON_STAR;

/** Stage details for labels (radius and the measured star behind it). */
const STAGE_INFO = {
  sun: { label: 'Sun', now: 'the Sun', who: 'IAU nominal radius' },
  wd: { label: 'White dwarf', now: 'white dwarf size', who: `size of Sirius B (${SIRIUS_B.massSun} Suns)` },
  ns: { label: 'Neutron star', now: 'neutron star size', who: `size of ${NS.name} (${NS.massSun} Suns)` },
  bh: { label: 'Black hole', now: 'its horizon', who: 'event horizon, 2GM/c²' },
};

const state = {
  view: 'squeeze',
  R: R_SUN,                 // view 1: radius of the squeezed Sun, m
  gm: GM_EARTH,             // view 2: mass parameter of the general black hole, m³/s²
  personKg: DEFAULT_PERSON_MASS,
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/* ---------- Formatting ---------- */

/** Plain number below a million, powers of ten above: "1,410", "2.65 × 10⁹". */
const num = (x, n = 3) => (Math.abs(x) < 1e6 && Math.abs(x) >= 1e-3 ? sig(x, n) : sci(x, n));
/**
 * A length (m): mm below 10 cm, then cm, m, km (up to 4 significant figures, so stage radii
 * read 695,700 / 5,634 / 11.36 / 2.953 km), and the site's ladder (AU, light-years) beyond.
 */
function len(m, n = 3) {
  if (m < 1e-3) return formatDistance(m, { about: false });
  if (m < 0.1) return `${sigT(m * 1e3, n)} mm`;
  if (m < 1) return `${sigT(m * 100, n)} cm`;
  if (m < 1e3) return `${sigT(m, n)} m`;
  if (m < 0.1 * AU) return `${sigWords(m / 1e3, n)} km`;
  return formatDistance(m, { about: false });
}
/** A mass (kg): "7.05 g", "13.3 tonnes", "1.62 billion tonnes". */
function massText(kg) {
  if (kg < 1) return `${sigT(kg * 1e3, 3)} g`;
  if (kg < 1e3) return `${sigT(kg, 3)} kg`;
  if (kg < 1e18) return `${sigWords(kg / 1e3, 3)} tonnes`;
  return `${sci(kg, 3)} kg`;
}
/** Mass in kg as a short sci string. */
const kgText = (kg) => (kg < 1e6 ? `${sigT(kg, 3)} kg` : `${sci(kg, 3)} kg`);
/** Number input text without float noise or 30-digit integers. */
const inputText = (x) => (x >= 1e6 || x < 1e-3 ? x.toPrecision(4).replace('e+', 'e') : String(Number(x.toPrecision(5))));
const pctText = (f) => (f >= 0.1 ? `${sigT(f * 100, 3)}%` : `${sig(f * 100, 2)}%`);

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setRadius(R) {
  state.R = clamp(R, LIMITS.rMin, LIMITS.rMax);
  radiusChanged();
}

function setMassParameter(gm) {
  state.gm = clamp(gm, LIMITS.mMin * G, LIMITS.mMax * G);
  massChanged();
}

function setPerson(kg) {
  state.personKg = clamp(kg, LIMITS.personMin, LIMITS.personMax);
  updatePerson();
  updateProse();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const rParam = bindParam({
  range: $('r-range'), num: $('r-num'), min: LIMITS.rMin, max: LIMITS.rMax, log: true, scale: 1e-3, decimals: 2,
  words: 'kilometres', get: () => state.R, set: setRadius,
});
const mParam = bindParam({
  range: $('m-range'), num: $('m-num'), min: LIMITS.mMin, max: LIMITS.mMax, log: true, decimals: 0,
  words: 'kilograms', get: () => state.gm / G, set: (kg) => setMassParameter(kg * G),
});

/** bindParam with tidy number text (its fixed decimals suit neither 2.95 km nor 695,700 km). */
function syncParam(p, input, value, words) {
  p.sync();
  input.value = inputText(value);
  const range = input.closest('.control').querySelector('input[type="range"]');
  range.setAttribute('aria-valuetext', `${value < 1e6 ? sigT(value, 4) : sci(value, 3)} ${words}`);
}

/** Nearest stage to radius R (in log space). */
function nearestStage(R) {
  let best = M.STAGES[0];
  for (const s of M.STAGES) if (Math.abs(Math.log(R / s.R)) < Math.abs(Math.log(R / best.R))) best = s;
  return best;
}

function radiusChanged() {
  syncParam(rParam, $('r-num'), state.R / 1e3, 'kilometres');
  const q = M.squeeze(GM_SUN, state.R);
  setText(outputs.rho, num(q.rho));
  setText(outputs.rhoSub, `${num(q.rho / 1e3)} g/cm³ (water is 1)`);
  setText(outputs.tsp, massText(q.teaspoon));
  setText(outputs.g, num(q.g));
  setText(outputs.gSub, `${num(q.g / G0)} times Earth's standard gravity`);
  setText(outputs.vEsc, num(q.vEsc / 1e3));
  setText(outputs.vSub, q.compactness >= 1 - 1e-9 ? 'the speed of light: nothing gets out' : `${pctText(q.vOverC)} of the speed of light`);
  setText(outputs.comp, q.compactness >= 1 - 1e-9 ? '1 (a black hole)' : num(q.compactness));
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  sim.refreshPlayButton();
  announce(`Radius ${len(state.R)}: density ${num(q.rho)} kilograms per cubic metre, a teaspoon weighs ${massText(q.teaspoon)}, ` +
    `escape speed ${pctText(q.vOverC)} of the speed of light, compactness ${num(q.compactness)}.`);
}

function massChanged() {
  syncParam(mParam, $('m-num'), state.gm / G, 'kilograms');
  const rs = M.schwarzschildRadius(state.gm);
  const kg = state.gm / G;
  setText(outputs.mass, kgText(kg));
  setText(outputs.massSub, `${num(state.gm / GM_EARTH)} Earth masses · ${num(state.gm / GM_SUN)} Suns`);
  setText(outputs.rs, len(rs));
  const dia = 2 * rs;
  const hint = travelHint(dia);
  setText(outputs.rsDia, `${len(dia)}${hint ? ` (${hint})` : ''}`);
  updateFitText();
  const eRs = M.RS_EARTH;
  setText(outputs.earthRs, `${sigT(eRs * 1e3, 3)} mm radius, ${sigT(2 * eRs * 1e3, 3)} mm across`);
  setText(outputs.earthRsSub, `${fmt(2 * eRs * sim.k, 1)} px on this screen; a UK 5p coin is ${sig(UK_5P_DIAMETER * 1e3, 3)} mm`);
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  announce(`Black hole of ${kgText(kg)}: horizon ${len(dia)} across.`);
}

/** Room (px radius) for the general black hole in the Earth view's right half: shared by draw and readouts. */
function holeRoom(w, h) {
  return Math.min(w * 0.5 - 60, h - 200) / 2;
}

/** "On this screen" readout: true size, too small, or only the edge fits the canvas. */
function updateFitText() {
  const dia = 2 * M.schwarzschildRadius(state.gm);
  const px = dia * sim.k;
  setText(outputs.rsPx, px >= 1 ? `${num(px)} px across` : `${sci(px, 3)} of a pixel`);
  let sub = 'far too small to see: the ring marks where it is';
  if (px >= 1) sub = sim.width && px / 2 > holeRoom(sim.width, sim.height) ? 'bigger than the canvas: only the edge of its horizon is drawn' : 'drawn at true size on the canvas';
  setText(outputs.rsPxSub, sub);
}

function updatePerson() {
  const rs = M.schwarzschildRadius(state.personKg * G);
  setText(outputs.personLine, `Your horizon would be ${len(2 * rs)} across, ${sigWords((2 * PROTON_RADIUS) / (2 * rs), 2)} times smaller than a proton.`);
}

function updateSgrA() {
  const rs = M.RS_SGR_A;
  setText(outputs.sgaMass, `${sigT(SGR_A.massSun / 1e6, 4)} million Suns`);
  setText(outputs.sgaMassSub, `± ${SGR_A.massStat / 1e6} million (statistical), about ± ${SGR_A.massSys / 1e6} million (systematic) · ${sci(M.massFromGM(M.GM_SGR_A), 3)} kg`);
  setText(outputs.sgaRs, `${sigT(rs / 1e9, 3)} million km = ${sigT(M.RS_SGR_A_AU, 3)} AU`);
  setText(outputs.sgaRsSub, `${sigT(rs / R_SUN, 3)} times the Sun's radius · ± ${sig(M.RS_SGR_A_AU * M.SGR_A_FRACTION_STAT, 1)} AU (statistical), ± ${sig(M.RS_SGR_A_AU * M.SGR_A_FRACTION_SYS, 1)} AU (systematic)`);
  setText(outputs.sgaDist, `${fmt(SGR_A.distancePc, 0)} parsecs`);
  setText(outputs.sgaDistSub, `about ${sig((SGR_A.distancePc * PARSEC) / LIGHT_YEAR, 3)} light-years`);
  setText(outputs.sgaAngle, `${sigT(M.SGR_A_HORIZON_ANGLE, 3)} micro-arcseconds`);
  setText(outputs.sgaShadow, `${EHT_SGR_A.shadowMicroArcsec} ± ${EHT_SGR_A.shadowErr.toFixed(1)} micro-arcseconds = ${sig(M.SGR_A_SHADOW_MEASURED / AU, 2)} AU across`);
  setText(outputs.sgaShadowSub, `General relativity predicts √27 Rs = ${sigT(M.SGR_A_SHADOW_PREDICTED / AU, 2)} AU (${sigT(M.angleFromSize(M.SGR_A_SHADOW_PREDICTED, SGR_A.distancePc), 2)} micro-arcseconds)`);
}

/** Live-substituted equations in "The maths" card (values for the current view). */
function updateEquations() {
  const c2 = '299,792,458²';
  if (state.view === 'squeeze') {
    const q = M.squeeze(GM_SUN, state.R);
    setText(equations.rs, `2 × 1.3271244 × 10²⁰ / ${c2} = ${fmt(M.RS_SUN, 0)} m (the Sun's horizon)`);
    setText(equations.mass, `1.3271244 × 10²⁰ / 6.6743 × 10⁻¹¹ = ${sci(M.M_SUN, 4)} kg`);
    setText(equations.rho, `${sci(M.M_SUN, 3)} kg / (4/3 π × (${sci(state.R, 3)} m)³) = ${num(q.rho)} kg/m³`);
    setText(equations.g, `1.327 × 10²⁰ / (${sci(state.R, 3)} m)² = ${num(q.g)} m/s²`);
    setText(equations.vEsc, `√(2 × 1.327 × 10²⁰ / ${sci(state.R, 3)} m) = ${num(q.vEsc / 1e3)} km/s`);
    setText(equations.comp, `${fmt(M.RS_SUN, 0)} m / ${sci(state.R, 3)} m = ${num(q.compactness)}`);
  } else if (state.view === 'earth') {
    const rs = M.schwarzschildRadius(state.gm);
    setText(equations.rs, `2 × ${sci(state.gm, 4)} / ${c2} = ${len(rs)}`);
    setText(equations.mass, `${sci(state.gm, 4)} / 6.6743 × 10⁻¹¹ = ${kgText(state.gm / G)}`);
    setText(equations.screen, `${len(2 * rs)} × ${fmt(sim.k, 0)} px/m = ${num(2 * rs * sim.k)} px (${scaleSourceText(sim.scale)})`);
  } else {
    setText(equations.rs, `2 × ${sci(M.GM_SGR_A, 4)} / ${c2} = ${sci(M.RS_SGR_A, 4)} m = ${sigT(M.RS_SGR_A_AU, 3)} AU`);
    setText(equations.mass, `${sci(M.GM_SGR_A, 4)} / 6.6743 × 10⁻¹¹ = ${sci(M.massFromGM(M.GM_SGR_A), 3)} kg`);
    setText(equations.angle, `${EHT_SGR_A.shadowMicroArcsec} μas × ${fmt(SGR_A.distancePc, 0)} pc = ${sigT(M.SGR_A_SHADOW_MEASURED / AU, 3)} AU`);
    setText(equations.shadow, `√27 × ${sigT(M.RS_SGR_A_AU, 3)} AU = ${sigT(M.SGR_A_SHADOW_PREDICTED / AU, 3)} AU (${sigT(M.angleFromSize(M.SGR_A_SHADOW_PREDICTED, SGR_A.distancePc), 3)} μas)`);
  }
}

/** Numbers in the prose (data-calc spans), all computed from the cited values. */
function updateProse() {
  const sun = M.squeeze(GM_SUN, R_SUN);
  const wd = M.squeeze(GM_SUN, M.SIRIUS_B_RADIUS);
  const ns = M.squeeze(GM_SUN, NS.radius);
  const personRs = M.schwarzschildRadius(state.personKg * G);
  const [, j0030r, j0030m] = NEUTRON_STARS;
  const calc = {
    sunMkm: `${sigT((2 * R_SUN) / 1e9, 3)} million km`,
    earthRsDiaMm: `${sigT(2 * M.RS_EARTH * 1e3, 3)} mm`,
    mSun: `${sci(M.M_SUN, 3)} kg`,
    rhoSun: `${sigT(sun.rho / 1e3, 3)} g/cm³`,
    tspSun: massText(sun.teaspoon),
    wdKm: `${fmt(M.SIRIUS_B_RADIUS / 1e3, 0)} km`,
    tspWd: massText(wd.teaspoon),
    tspNs: massText(ns.teaspoon),
    rsSun: `${sigT(M.RS_SUN / 1e3, 3)} km`,
    compSun: sun.compactness.toFixed(7).replace(/0+$/, ''),
    compNs: sigT(ns.compactness, 2),
    earthRsMm: `${sigT(M.RS_EARTH * 1e3, 3)} mm`,
    mEarth: `${sci(M.M_EARTH, 3)} kg`,
    personKg: `${sigT(state.personKg, 3)} kg`,
    personDia: len(2 * personRs),
    personVsProton: sigWords(PROTON_RADIUS / personRs, 2),
    sgaMass: `${sigT(SGR_A.massSun / 1e6, 4)} million`,
    sgaRsKm: `${sigT(M.RS_SGR_A / 1e9, 3)} million km`,
    sgaRsAu: `${sigT(M.RS_SGR_A_AU, 3)} AU`,
    sgaRsRsun: sigT(M.RS_SGR_A / R_SUN, 2),
    mercQ: `${sigT(MERCURY.a * (1 - MERCURY.e), 2)} AU`,
    shadowRatio: sigT(M.SGR_A_SHADOW_MEASURED / (2 * M.RS_SGR_A), 2),
    rsSunM: `${fmt(M.RS_SUN, 0)} m`,
    sunOverRs: fmt(Math.round(R_SUN / M.RS_SUN / 100) * 100, 0),
    vSun: `${sigT(sun.vEsc / 1e3, 3)} km/s`,
    vSunPct: pctText(sun.vOverC),
    wdMass: String(SIRIUS_B.massSun),
    nsMass: String(NS.massSun),
    nsRange: `+${NS.radiusPlus / 1e3} / −${NS.radiusMinus / 1e3} km`,
    ns2: `${sig(j0030r.radius / 1e3, 3)} to ${sig(j0030m.radius / 1e3, 3)} km`,
    nsDiaKm: `${sigT((2 * NS.radius) / 1e3, 2)} km`,
    bhDiaKm: `${sigT((2 * M.RS_SUN) / 1e3, 2)} km`,
  };
  for (const node of document.querySelectorAll('[data-calc]')) {
    const v = calc[node.dataset.calc];
    if (v !== undefined) setText(node, v);
  }
}

function describe() {
  const scaleWord = sim.scale.calibrated ? 'calibrated true size' : 'approximate size';
  if (state.view === 'squeeze') {
    const q = M.squeeze(GM_SUN, state.R);
    return `Scaled drawing: the Sun's mass squeezed to a radius of ${len(state.R)}, on a logarithmic radius scale inside rings for the Sun, ` +
      `a white dwarf, a neutron star and the horizon, with the four stages below at their own scales. Density ${num(q.rho)} kilograms per cubic metre, ` +
      `escape speed ${pctText(q.vOverC)} of the speed of light${sim.paused ? '' : ', squeezing'}.`;
  }
  if (state.view === 'earth') {
    const rs = M.schwarzschildRadius(state.gm);
    return `At ${scaleWord}: Earth squeezed into a black hole ${sigT(2 * M.RS_EARTH * 1e3, 3)} millimetres across, beside an 18 millimetre UK 5p coin ` +
      `and the 2 centimetre Earth of the space page. On the right, a black hole of ${kgText(state.gm / G)} with a horizon ${len(2 * rs)} across.`;
  }
  return `Scaled drawing: the horizon of Sagittarius A*, radius ${sigT(M.RS_SGR_A_AU, 3)} AU, drawn where the Sun is, well inside Mercury's orbit ` +
    `(${sigT(MERCURY.a * (1 - MERCURY.e), 2)} to ${sigT(MERCURY.a * (1 + MERCURY.e), 2)} AU). The Sun at the same scale is a dot ${sigT(M.RS_SGR_A / R_SUN, 2)} times smaller ` +
    `than the horizon, and the Event Horizon Telescope shadow is a ring ${sig(M.SGR_A_SHADOW_MEASURED / AU, 2)} AU across.`;
}

/* =========================================================================
 * 4. Step: the Squeeze run (radius falls at a steady rate in powers of ten)
 * ====================================================================== */

const atHorizon = () => state.R <= M.RS_SUN * (1 + 1e-9);

function step(simDt, realDt) {
  if (state.view !== 'squeeze') {
    sim.setPaused(true); // only the first view has a run (Space elsewhere does nothing)
    return;
  }
  state.R = Math.max(M.RS_SUN, state.R * 10 ** (-SQUEEZE_DECADES_PER_S * realDt));
  radiusChanged();
  if (atHorizon()) sim.setPaused(true);
}

/* =========================================================================
 * 5. Drawing
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  if (state.view === 'squeeze') drawSqueeze(ctx, w, h, colors);
  else if (state.view === 'earth') drawEarth(ctx, w, h, k, colors);
  else drawSgrA(ctx, w, h, colors);
}

/** Fill colour for a body of radius R (nearest stage). */
function bodyColour(R, colors) {
  const s = nearestStage(R).id;
  return { sun: colors.star, wd: colors.dwarf, ns: colors.neutron, bh: colors.hole }[s];
}

/** A disc; black holes get a thin glowing ring so they read on any background. */
function body(ctx, x, y, r, R, colors) {
  const hole = R <= M.RS_SUN * (1 + 1e-9);
  drawDot(ctx, x, y, Math.max(r, 0.5), bodyColour(R, colors));
  ctx.lineWidth = hole ? 2 : 1;
  ctx.strokeStyle = hole ? colors.glow : colors.muted;
  ctx.globalAlpha = hole ? 1 : 0.6;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0.5), 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function textLines(ctx, colors, x, y, lines, { color = colors.fg, align = 'left', gap = 16 } = {}) {
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = i === 0 ? FONT_BOLD : FONT;
    ctx.fillStyle = i === 0 ? color : colors.muted;
    ctx.fillText(t, x, y + i * gap);
  });
}

function leader(ctx, x0, y0, x1, y1, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawDot(ctx, x0, y0, 2, color);
}

/** Scale bar for a scaled view: the longest 1-2-5 world length under maxPx (pxPerM = px per metre). */
function worldScaleBar(ctx, colors, x, y, pxPerM, maxPx) {
  const bar = niceWorldBar(maxPx / pxPerM);
  const px = bar.metres * pxPerM;
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 6);
  ctx.stroke();
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(bar.label, x, y - 8);
}

/* ---------- View 1: Squeeze the Sun ---------- */

function drawSqueeze(ctx, w, h, colors) {
  const topH = Math.round(h * 0.57);
  const rhoMax = Math.max(60, Math.min((topH - 76) / 2, w * 0.17));
  const cx = 30 + rhoMax;
  const cy = 40 + rhoMax + 6;
  const rLo = M.RS_SUN / 4; // the log scale's zero, a little inside the horizon
  const rho = (R) => (rhoMax * Math.log(R / rLo)) / Math.log(R_SUN / rLo);

  drawTag(ctx, 'SCALED · log radius: each step is ×10', 14, 20, { color: colors.warn, background: colors.warnBg });

  // Stage rings (static) and the current body
  const ringR = M.STAGES.map((s) => rho(s.R));
  body(ctx, cx, cy, rho(state.R), state.R, colors);
  ctx.setLineDash([4, 4]);
  M.STAGES.forEach((s, i) => {
    ctx.strokeStyle = s.id === 'bh' ? colors.glow : colors.fg;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR[i], 0, TAU);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Log ruler along the radius, below the disc: ticks at each power of ten
  const ry = cy + rhoMax + 18;
  ctx.strokeStyle = colors.muted;
  ctx.fillStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, ry);
  ctx.lineTo(cx + rhoMax, ry);
  ctx.stroke();
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let p = 3; p <= 8; p++) {
    const x = cx + rho(10 ** p);
    ctx.beginPath();
    ctx.moveTo(x, ry - 4);
    ctx.lineTo(x, ry + 4);
    ctx.stroke();
    ctx.fillText(p < 6 ? `${fmt(10 ** (p - 3), 0)}` : `10${'⁰¹²³⁴⁵⁶⁷⁸⁹'[p - 3]}`, x, ry + 6);
  }
  ctx.textAlign = 'left';
  ctx.fillText('radius, km', cx + rhoMax + 8, ry + 6);
  drawDot(ctx, cx + rho(state.R), ry, 4, colors.accent);

  // Static labels for the rings, in a column to the right
  const lx = cx + rhoMax + 40;
  const rows = [cy - rhoMax * 0.85, cy - rhoMax * 0.42, cy + rhoMax * 0.02, cy + rhoMax * 0.46];
  const angles = [0.75, 0.42, 0.12, -0.25];
  M.STAGES.forEach((s, i) => {
    const a = angles[i];
    const px = cx + ringR[i] * Math.cos(a);
    const py = cy - ringR[i] * Math.sin(a);
    const top = rows[i];
    const col = s.id === 'bh' ? colors.glow : colors.fg;
    leader(ctx, px, py, lx - 6, top + 8, col);
    textLines(ctx, colors, lx, top, [`${STAGE_INFO[s.id].label}: radius ${len(s.R, 4)}`, STAGE_INFO[s.id].who], { color: col });
  });

  // Current values (also in the readouts), right of the labels when there is room
  const q = M.squeeze(GM_SUN, state.R);
  const bx = lx + 320;
  if (bx + 360 < w) {
    const st = nearestStage(state.R);
    const exact = Math.abs(Math.log(state.R / st.R)) < 1e-6;
    const hole = q.compactness >= 1 - 1e-9;
    const rows = [
      ['Radius', `${len(state.R, 4)}${exact ? ` (${STAGE_INFO[st.id].now})` : ''}`],
      ['Mass (held fixed)', `1 Sun = ${sci(M.M_SUN, 3)} kg`],
      ['Mean density', `${num(q.rho)} kg/m³`],
      ['A teaspoon (5 ml) weighs', massText(q.teaspoon)],
      ['Surface gravity (Newtonian)', `${num(q.g)} m/s² (${num(q.g / G0)} g)`],
      ['Escape speed', hole ? 'the speed of light' : `${num(q.vEsc / 1e3)} km/s (${pctText(q.vOverC)} of light)`],
      ['Compactness Rs / R', hole ? '1: a black hole' : num(q.compactness)],
    ];
    ctx.textBaseline = 'middle';
    rows.forEach(([label, value], i) => {
      const y = 50 + i * 34;
      ctx.font = FONT;
      ctx.fillStyle = colors.muted;
      ctx.textAlign = 'left';
      ctx.fillText(label, bx, y);
      ctx.font = '600 17px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = i === 0 ? colors.accent : colors.fg;
      ctx.fillText(value, bx + 170, y);
    });
  }

  drawStageStrip(ctx, w, h, topH, colors);
}

/** The four stages at their own linear scales, each with a scale bar and the next stage drawn at the same scale. */
function drawStageStrip(ctx, w, h, y0, colors) {
  const gap = 46;
  const x0 = 12;
  const pw = (w - 2 * x0 - 3 * gap) / 4;
  const top = y0 + 30;
  const ph = h - top - 12;
  if (ph < 90 || pw < 80) return;
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('The four stages, each at its own scale (each panel zooms in on the next)', x0, top - 8);
  const current = nearestStage(state.R).id;
  M.STAGES.forEach((s, i) => {
    const px = x0 + i * (pw + gap);
    const isCur = s.id === current;
    ctx.strokeStyle = isCur ? colors.accent : colors.track;
    ctx.lineWidth = isCur ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(px + 0.5, top + 0.5, pw - 1, ph - 1, 8);
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, top, pw, ph);
    ctx.clip();
    const r = Math.max(10, 0.3 * Math.min(pw, ph - 76));
    const sc = r / s.R; // px per metre in this panel
    const bx = px + pw / 2;
    const by = top + 40 + (ph - 82) / 2;
    body(ctx, bx, by, r, s.R, colors);
    // The next stage at the same scale
    const next = M.STAGES[i + 1];
    if (next) {
      const rn = next.R * sc;
      const nx = bx;
      const ny = by;
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      if (rn >= 1.5) {
        ctx.strokeStyle = next.id === 'bh' ? colors.glow : colors.fg;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(nx, ny, rn, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = colors.fg;
        ctx.textAlign = 'center';
        ctx.fillText(`${STAGE_INFO[next.id].label.toLowerCase()} (dashed), same scale`, bx, by + r + 14);
      } else {
        drawDot(ctx, nx, ny, 1.2, colors.fg);
        ctx.fillStyle = colors.fg;
        ctx.textAlign = 'center';
        ctx.fillText(`${STAGE_INFO[next.id].label.toLowerCase()} at this scale: ${sig(2 * rn, 1)} px across`, bx, by + r + 14);
      }
    }
    ctx.restore();
    // Title and scale bar
    ctx.font = FONT_BOLD;
    ctx.fillStyle = isCur ? colors.accent : colors.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${i + 1}. ${STAGE_INFO[s.id].label}`, px + 10, top + 8);
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.fillText(`radius ${len(s.R, 4)}`, px + 10, top + 24);
    worldScaleBar(ctx, colors, px + 10, top + ph - 10, sc, pw * 0.4);
    // Zoom arrow to the next panel
    if (next) {
      const ax = px + pw + 4;
      const ay = top + ph / 2;
      ctx.strokeStyle = colors.muted;
      ctx.fillStyle = colors.muted;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + gap - 14, ay);
      ctx.stroke();
      drawArrowHead(ctx, ax + gap - 8, ay, 1, 0, 8);
      ctx.font = FONT_BOLD;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`×${sigT(s.R / next.R, 3)}`, ax + (gap - 8) / 2, ay - 5);
    }
  });
}

/* ---------- View 2: Earth as a black hole, true size ---------- */

const FONT_BIG = '600 18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FONT_MID = '14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Headline (18 px) with a muted sub-line (14 px). */
function headline(ctx, colors, x, y, title, sub) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = FONT_BIG;
  ctx.fillStyle = colors.fg;
  ctx.fillText(title, x, y);
  ctx.font = FONT_MID;
  ctx.fillStyle = colors.muted;
  if (sub) ctx.fillText(sub, x, y + 26);
}

/** A horizon: black disc with a thin glowing rim. */
function horizon(ctx, colors, x, y, r) {
  drawDot(ctx, x, y, r, colors.hole);
  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = r > 3 ? 2 : 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
}

function drawEarth(ctx, w, h, k, colors) {
  const half = w >= 900 ? w * 0.5 : w;
  if (sim.scale.calibrated) drawTag(ctx, 'TRUE SIZE 1:1', 14, 20, { color: colors.ok, background: colors.okBg });
  else drawTag(ctx, 'APPROXIMATE SIZE: calibrate for 1:1', 14, 20, { color: colors.warn, background: colors.warnBg });

  // Left: Earth's horizon, a 5p coin and the 2 cm Earth, side by side at true size
  const rs = M.RS_EARTH * k;
  const coin = (UK_5P_DIAMETER / 2) * k;
  const earth = (NEAR_EARTH_SCREEN_SIZE / 2) * k;
  const step = Math.max(2.6 * earth, 150);
  const x1 = 40 + Math.max(rs, 60);
  const cyRow = clamp(h * 0.42, 190, h - 230);
  headline(ctx, colors, 24, 46, `All of Earth inside a horizon ${sigT(2 * M.RS_EARTH * 1e3, 3)} mm across`,
    `Earth's ${sci(M.M_EARTH, 3)} kg squeezed to its Schwarzschild radius, 2GM/c² = ${sigT(M.RS_EARTH * 1e3, 3)} mm`);

  const items = [
    { x: x1, r: rs, kind: 'hole', lines: ['Earth as a black hole', `${sigT(2 * M.RS_EARTH * 1e3, 3)} mm across`] },
    { x: x1 + step, r: coin, kind: 'coin', lines: ['UK 5p coin', `${sig(UK_5P_DIAMETER * 1e3, 3)} mm across`] },
    { x: x1 + 2 * step, r: earth, kind: 'earth', lines: ['Earth on the space page', '2 cm (scale 1 : 637 million)'] },
  ];
  for (const it of items) {
    if (it.kind === 'hole') horizon(ctx, colors, it.x, cyRow, it.r);
    else if (it.kind === 'coin') {
      drawDot(ctx, it.x, cyRow, it.r, colors.coin);
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(it.x, cyRow, it.r * 0.88, 0, TAU);
      ctx.stroke();
      ctx.font = FONT_BOLD;
      ctx.fillStyle = colors.bg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('5p', it.x, cyRow);
    } else drawDot(ctx, it.x, cyRow, it.r, colors.earth);
    textLines(ctx, colors, it.x, cyRow + Math.max(earth, 30) + 12, it.lines, { align: 'center' });
  }
  // True-scale ruler under the row, then two facts
  const rulerY = cyRow + Math.max(earth, 30) + 66;
  const rulerX = x1 - Math.max(rs, 30);
  const rulerLen = Math.min(0.1, Math.floor(((half - rulerX - 30) / k) * 100) / 100);
  let factY = rulerY + 8;
  if (rulerLen >= 0.02 && rulerY + 40 < h) {
    drawRuler(ctx, colors, { x: rulerX, y: rulerY, lengthM: rulerLen, k });
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('true-scale ruler, cm', rulerX, rulerY + 52);
    factY = rulerY + 86;
  }
  if (factY + 40 < h) {
    ctx.font = FONT_MID;
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`Mean density inside: ${sci(M.meanDensity(M.M_EARTH, M.RS_EARTH), 3)} kg/m³`, 24, factY);
    ctx.fillStyle = colors.muted;
    ctx.fillText('Its mass is unchanged, so the Moon would go on orbiting it just as before.', 24, factY + 22);
  }

  // Right: a black hole of the chosen mass, at true size while it fits
  if (half === w) return; // narrow canvas: the readouts below describe it
  const R0 = { x0: half, x1: w, y0: 0, y1: h };
  ctx.strokeStyle = colors.track;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(half + 0.5, 16);
  ctx.lineTo(half + 0.5, h - 16);
  ctx.stroke();
  ctx.globalAlpha = 1;
  const rsM = M.schwarzschildRadius(state.gm);
  const rPx = rsM * k;
  const cx = (R0.x0 + R0.x1) / 2;
  const cy = (h + 110) / 2;
  const room = holeRoom(w, h);
  const kg = state.gm / G;
  let sub;
  ctx.save();
  ctx.beginPath();
  ctx.rect(R0.x0 + 1, 100, R0.x1 - R0.x0 - 1, R0.y1 - 100);
  ctx.clip();
  if (rPx > room) {
    // Too big: only the edge of the horizon fits (its curve drawn true to scale)
    const edgeX = cx - room * 0.4;
    ctx.fillStyle = colors.hole;
    if (rPx < 20000) {
      horizon(ctx, colors, edgeX + rPx, cy, rPx);
    } else {
      ctx.fillRect(edgeX, 0, R0.x1 - edgeX, h);
      ctx.strokeStyle = colors.glow;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(edgeX, 0);
      ctx.lineTo(edgeX, h);
      ctx.stroke();
    }
    const hint = travelHint(2 * rsM);
    sub = `Too big for the canvas: only the edge of its horizon is drawn.${hint ? ` Crossing it would take ${hint}.` : ''}`;
  } else if (rPx * 2 >= 1) {
    horizon(ctx, colors, cx, cy, rPx);
    sub = `${num(2 * rPx)} px across on this screen, ${sim.scale.calibrated ? 'drawn 1:1' : 'approximately true size until you calibrate'}`;
  } else {
    // Under a pixel: one pixel at the fraction of it the horizon would cover, ringed so it can be found
    ctx.globalAlpha = trueSizeAlpha(2 * rPx);
    ctx.fillStyle = colors.hole;
    ctx.fillRect(Math.round(cx), Math.round(cy), 1, 1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + 0.5, cy + 0.5, 7, 0, TAU);
    ctx.stroke();
    sub = `${sci(2 * rPx, 2)} of a pixel across: far too small to see (it is at the centre of the small blue ring)`;
  }
  // Earth's horizon for comparison, dashed, when both fit
  if (rPx <= room && Math.abs(Math.log(rPx / rs)) > 0.05 && rs < room) {
    ctx.strokeStyle = colors.muted;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, rs, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = FONT;
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Earth\'s horizon (dashed)', cx + Math.max(rs, rPx) + 10, cy);
  }
  ctx.restore();
  headline(ctx, colors, R0.x0 + 24, 46, `A black hole of ${kgText(kg)}: horizon ${len(2 * rsM)} across`, sub);
}

/* ---------- View 3: Sagittarius A* ---------- */

function drawSgrA(ctx, w, h, colors) {
  const a = MERCURY.a;
  const e = MERCURY.e;
  const q = a * (1 - e);
  const Q = a * (1 + e);
  const b = a * Math.sqrt(1 - e * e);
  const cx = Math.max(w * 0.3, 40 + q * 300);
  const cy = h / 2 + 10;
  const s = Math.min((cx - 30) / q, (w * 0.62 - cx) / Q, (h / 2 - 50) / b); // px per AU
  const pxPerM = s / AU;
  const rH = M.RS_SGR_A_AU * s;

  drawTag(ctx, `SCALED · 1 px = ${sigWords(1 / pxPerM / 1e3, 3)} km`, 14, 20, { color: colors.warn, background: colors.warnBg });
  textLines(ctx, colors, 14, 40, [`Sagittarius A*: ${sigT(SGR_A.massSun / 1e6, 4)} million Suns, ${fmt(SGR_A.distancePc, 0)} parsecs away`, 'Its horizon drawn where the Sun would be'], { gap: 16 });

  // Earth's orbit (partly visible), Mercury's orbit (perihelion to the left of the focus)
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, EARTH_ORBIT.a * s, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(cx + a * e * s, cy, a * s, b * s, 0, 0, TAU);
  ctx.stroke();

  // EHT shadow: measured diameter with its uncertainty band
  const shR = (M.SGR_A_SHADOW_MEASURED / AU / 2) * s;
  const band = (EHT_SGR_A.shadowErr / EHT_SGR_A.shadowMicroArcsec) * shR;
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = colors.glow;
  ctx.beginPath();
  ctx.arc(cx, cy, shR + band, 0, TAU);
  ctx.arc(cx, cy, Math.max(0, shR - band), 0, TAU, true);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.glow;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, shR, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);

  // The horizon and the Sun at the same scale
  drawDot(ctx, cx, cy, rH, colors.hole);
  ctx.strokeStyle = colors.glow;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, rH, 0, TAU);
  ctx.stroke();
  drawDot(ctx, cx, cy, Math.max(1, (R_SUN / AU) * s), colors.star);

  // Static labels with leader lines
  const lx = Math.min(cx + Q * s + 36, w - 300);
  const sp = Math.max(rH * 1.6, 60);
  const labels = [
    { y: cy - sp * 2.2, px: cx + rH * Math.cos(0.9), py: cy - rH * Math.sin(0.9), color: colors.glow,
      lines: [`Event horizon: radius ${sigT(M.RS_SGR_A_AU, 3)} AU`, `${sigT(M.RS_SGR_A / 1e9, 3)} million km, ${sigT(M.RS_SGR_A / R_SUN, 3)} Sun radii`] },
    { y: cy - sp * 1.15, px: cx + shR * Math.cos(0.45), py: cy - shR * Math.sin(0.45), color: colors.glow,
      lines: [`Shadow imaged by the EHT: ${sig(M.SGR_A_SHADOW_MEASURED / AU, 2)} AU across`, `${EHT_SGR_A.shadowMicroArcsec} ± ${EHT_SGR_A.shadowErr.toFixed(1)} micro-arcseconds (shaded: the uncertainty)`] },
    { y: cy - 8, px: cx + 2, py: cy, color: colors.fg,
      lines: ['The Sun, at the same scale (yellow dot)', `radius ${sigT(R_SUN / AU, 2)} AU`] },
    { y: cy + sp * 0.9, px: cx + a * e * s + a * s * Math.cos(-0.5), py: cy - b * s * Math.sin(-0.5), color: colors.muted,
      lines: ['Mercury\'s orbit', `${sigT(q, 2)} to ${sigT(Q, 2)} AU from the Sun`] },
  ];
  for (const l of labels) {
    const top = clamp(l.y, 70, h - 50);
    leader(ctx, l.px, l.py, lx - 6, top + 8, l.color);
    textLines(ctx, colors, lx, top, l.lines, { color: l.color === colors.muted ? colors.fg : l.color });
  }
  // Earth's orbit label where the circle crosses the horizontal through the focus (if on screen)
  const ex = cx + EARTH_ORBIT.a * s;
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textBaseline = 'bottom';
  if (ex < w - 8) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('Earth\'s orbit, 1 AU', ex - 8, cy + 30);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText('Earth\'s orbit, 1 AU (grey arc)', 14, h - 40);
  }
  worldScaleBar(ctx, colors, 14, h - 14, pxPerM, Math.min(220, w * 0.25));
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  startPaused: true,
  playLabel: () => (atHorizon() ? 'Squeeze again' : 'Squeeze'),
  beforePlay: () => {
    if (atHorizon()) setRadius(R_SUN); // run again from the Sun
  },
  colorVars: {
    star: '--co-star', dwarf: '--co-dwarf', neutron: '--co-neutron', hole: '--co-hole', glow: '--co-glow',
    coin: '--co-coin', earth: '--co-earth',
  },
  onScaleChange: () => {
    massChanged();
    updateEquations();
  },
  onResize: () => updateFitText(),
  debug: { state, M, setRadius, setMassParameter },
});

initTabs({
  name: 'view',
  values: ['squeeze', 'earth', 'sgra'],
  tallViews: ['squeeze', 'earth', 'sgra'],
  onChange: (view) => {
    state.view = view;
    if (view !== 'squeeze' && !sim.paused) sim.setPaused(true);
    updateEquations();
    sim.updateAria();
    sim.requestDraw();
  },
});

initPresets({
  sun: () => setRadius(R_SUN),
  wd: () => setRadius(M.SIRIUS_B_RADIUS),
  ns: () => setRadius(NS.radius),
  bh: () => setRadius(M.RS_SUN),
  kg: () => setMassParameter(G * 1),
  person: () => setMassParameter(G * state.personKg),
  earthMass: () => setMassParameter(GM_EARTH),
  jupiter: () => setMassParameter(GM_JUPITER),
  sunMass: () => setMassParameter(GM_SUN),
  sgraMass: () => setMassParameter(M.GM_SGR_A),
  m87: () => setMassParameter(M.GM_M87),
});

// Tick marks on the radius slider at the four stages (the slider is logarithmic, 0 to 1000)
for (const st of M.STAGES) {
  const opt = document.createElement('option');
  opt.value = String(Math.round(1000 * valueToLogFraction(st.R, LIMITS.rMin, LIMITS.rMax)));
  opt.label = STAGE_INFO[st.id].label;
  $('stage-ticks').append(opt);
}

$('reset-btn').addEventListener('click', () => {
  sim.setPaused(true);
  setRadius(R_SUN);
});
$('person-num').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  if (Number.isFinite(v) && e.target.value.trim() !== '') setPerson(v);
  e.target.value = String(state.personKg);
});

radiusChanged();
massChanged();
updatePerson();
updateSgrA();
updateProse();
sim.start();
