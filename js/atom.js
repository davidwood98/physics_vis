/**
 * atom.js: "Atom = 1 cm, proton = 1 cm" (two views on one calibrated canvas).
 *
 *   atom    The chosen element's atom drawn exactly 1 cm across at true size: its
 *           electron cloud, edged where the free atom's density falls to 0.001
 *           electrons per bohr³ (Rahm et al. 2016), fading on beyond the edge. The
 *           nucleus is far below a pixel, so a cascade of insets, each magnifying the
 *           centre of the one before, zooms in until it shows. A log chart compares
 *           atom and nucleus radii for every element. "In a solid" draws the
 *           neighbouring atoms at the measured lattice spacing, at the same scale.
 *   proton  A proton drawn 1 cm across at true size, and magnified, filled with an
 *           illustrative animated sea of quark-antiquark pairs and gluons (markers,
 *           not to scale), with the valence quarks only hinted.
 *
 * Page pattern (as velocity.js):
 *   1. constants + state   2. setters   3. UI sync (readouts, maths, aria)
 *   4. step (the illustrative quark sea)   5. draw   6. wiring + start
 * Pure maths and formatting: atomic-model.js (unit tested, tests/atom.test.html).
 * Cited data: data/atomic-data.js. Drawing works in CSS px; k = CSS px per metre.
 */

import * as M from './atomic-model.js';
import { CODATA, PDG_QUARKS, LIMITS, ATOM_RADII_ANGSTROM, LATTICES } from './data/atomic-data.js';
import { fmt, scaleSourceText } from './common.js';
import { createSim, initTabs, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawChart, withAlpha, FONT, FONT_BOLD } from './draw.js';
import { sig, sigT, sci, formatDistance, travelHint } from './astro.js';
import { TAU, clamp } from './physics.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const CM = 0.01;                 // the 1 cm the atom (or proton) is drawn across
const SEA = { pairs: 24, gluons: 18 };
const CLOUD_ALPHA = 0.6;        // opacity of the densest part of a drawn electron cloud
const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** Nuclear sizes always in femtometres: "1.68 fm". */
const fm = (m, n = 3) => `${sigT(m * 1e15, n)} fm`;

const state = {
  view: 'atom',
  el: M.elementBySymbol('H'),
  solid: false,
  time: 0,                       // illustrative clock of the quark sea (s)
  sea: { pairs: [], gluons: [] },
};

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/** Physical size of one device pixel on this screen (m). */
const pitch = () => 1 / (sim.k * (sim.view?.dpr || window.devicePixelRatio || 1));

/* Chart series (static): free-atom radius for Z = 1-96, nuclear rms radius, A^(1/3) fit. */
const R0 = M.fitR0(M.ELEMENTS);
const CHART = {
  atoms: ATOM_RADII_ANGSTROM.map((a, i) => [i + 1, Math.log10(a * M.ANGSTROM)]),
  nuclei: M.ELEMENTS.map((e) => [e.z, Math.log10(e.nucleusRadius)]),
  fit: M.ELEMENTS.map((e) => [e.z, Math.log10(R0 * Math.cbrt(e.A))]),
};

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setElement(symbol) {
  const el = M.elementBySymbol(symbol);
  if (!el) return;
  state.el = el;
  if (!el.lattice) state.solid = false;
  changed();
  announce(`${cap(el.name)}: atom ${sigT(M.atomDiameter(el) * 1e12, 3)} picometres across, nucleus ${sigT(M.nucleusDiameter(el) * 1e15, 3)} femtometres. At atom = 1 centimetre the nucleus is ${sig(M.nucleusAtAtomScale(el) * 1e6, 2)} micrometres, ${M.pixelFraction(M.nucleusAtAtomScale(el) / pitch())}.`);
}

function setSolid(on) {
  state.solid = Boolean(on) && Boolean(state.el.lattice);
  changed();
  if (state.solid) {
    const nn = M.nearestNeighbour(state.el.lattice);
    announce(`In ${state.el.lattice.name}, neighbouring atoms are ${sigT(nn * 1e12, 3)} picometres apart: ${sigT(M.atAtomScale(state.el, nn) * 1e3, 2)} millimetres at this scale, closer than the 1 centimetre free atom is wide.`);
  }
}

function changed() {
  syncControls();
  updateReadouts();
  updateEquations();
  updatePixelLine();
  sim.updateAria();
  sim.requestDraw();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

function syncControls() {
  $('element-select').value = state.el.symbol;
  const box = $('solid-check');
  box.checked = state.solid;
  box.disabled = !state.el.lattice;
  box.closest('label').title = state.el.lattice ? '' : 'Lattice data for copper, silicon and gold only';
  for (const b of document.querySelectorAll('[data-preset]')) {
    const p = b.dataset.preset;
    const on = p.startsWith('solid-') ? state.solid && p === `solid-${state.el.symbol}` : !state.solid && p === state.el.symbol;
    b.setAttribute('aria-pressed', String(on));
  }
}

function updateReadouts() {
  const el = state.el;
  const d = M.atomDiameter(el);
  const mag = M.magnification(d);
  const nucScreen = M.nucleusAtAtomScale(el);
  const nucPx = nucScreen / pitch();
  setText(outputs.magLine, `1 cm here = ${M.formatLength(d)} of real ${el.name}`);
  setText(outputs.magSub, `magnified ${M.ratioWords(mag, 2)} times`);
  setText(outputs.atomPm, sigT(d * 1e12, 3));
  setText(outputs.nucFm, sigT(M.nucleusDiameter(el) * 1e15, 3));
  setText(outputs.nucUm, sig(nucScreen * 1e6, 2));
  setText(outputs.nucPx, M.formatPx(nucPx, 2));
  setText(outputs.nucSub, `${M.pixelFraction(nucPx)} on this screen`);
  const vf = M.nuclearVolumeFraction(el);
  setText(outputs.volFrac, `1 part in ${sci(1 / vf, 2)}`);
  setText(outputs.volSub, 'the rest holds the electron cloud');
  setText(outputs.massShare, `${fmt(M.nucleusMassShare(el) * 100, 3)}%`);
  setText(outputs.massNum, String(el.A));
  setText(outputs.massNumSub, `${el.z} ${el.z === 1 ? 'proton' : 'protons'} + ${el.N} ${el.N === 1 ? 'neutron' : 'neutrons'} (${el.name}-${el.A})`);
  const solidWrap = document.querySelector('[data-out-wrap="solid"]');
  solidWrap.hidden = !el.lattice;
  if (el.lattice) {
    const nn = M.nearestNeighbour(el.lattice);
    setText(outputs.solidNn, `${sigT(nn * 1e12, 3)} pm apart`);
    setText(outputs.solidSub, `${sigT(M.atAtomScale(el, nn) * 1e3, 2)} mm at this scale (the free atom: 10 mm)`);
  }

  // Proton = 1 cm
  const pMag = M.magnification(M.PROTON_DIAMETER);
  const H = M.elementBySymbol('H');
  const Au = M.elementBySymbol('Au');
  const hAt = M.atProtonScale(M.atomDiameter(H));
  const auAt = M.atProtonScale(M.atomDiameter(Au));
  setText(outputs.pMag, `${M.ratioWords(pMag, 2)} times`);
  setText(outputs.pMagSub, `1 cm ÷ ${M.formatLength(M.PROTON_DIAMETER)} (twice the ${sigT(CODATA.protonRadius * 1e15, 4)} fm rms charge radius)`);
  setText(outputs.pH, formatDistance(hAt, { about: false }));
  setText(outputs.pHSub, `${travelHint(hAt)}. With the Bohr radius instead: ${formatDistance(M.atProtonScale(2 * M.BOHR_RADIUS), { about: false })}`);
  setText(outputs.pAu, formatDistance(auAt, { about: false }));
  setText(outputs.pAuSub, travelHint(auAt));
  const q = M.atProtonScale(M.QUARK_LIMIT_DIAMETER);
  setText(outputs.pQuark, `under ${M.formatLength(q, 2)}`);
  setText(outputs.pQuarkSub, `no measured size: under ${sigT(q / pitch(), 2)} px, if any`);
  const e = M.atProtonScale(M.ELECTRON_LIMIT_DIAMETER);
  setText(outputs.pElectron, `under ${M.formatLength(e, 2)}`);
  setText(outputs.pElectronSub, `no measured size: under ${sigT(e / pitch(), 2)} px, if any`);
  const vq = M.valenceQuarkMassMeV();
  const frac = M.valenceMassFraction();
  setText(outputs.pValence, fmt(vq, 2));
  setText(outputs.pValenceSub, `2 × ${fmt(PDG_QUARKS.upMeV, 2)} (up) + ${fmt(PDG_QUARKS.downMeV, 2)} (down), ${fmt(frac * 100, 2)}% of the proton`);
  setText(outputs.pMass, fmt(CODATA.protonMassMeV, 2));
  setText(outputs.pMassSub, `the other ${fmt((1 - frac) * 100, 0)}%: energy of the moving quarks and the gluon field`);
  $('mass-bar-quarks').style.width = `${frac * 100}%`;
  $('mass-bar').setAttribute('aria-label', `Proton mass budget: valence quark masses ${fmt(frac * 100, 2)}%, field energy ${fmt((1 - frac) * 100, 2)}%`);
}

function updateEquations() {
  const el = state.el;
  const d = M.atomDiameter(el);
  const mag = M.magnification(d);
  const nuc = M.nucleusAtAtomScale(el);
  const p = pitch();
  setText(equations.mag, `1 cm ÷ ${M.formatLength(d)} = ${M.ratioWords(mag, 3)} (${el.name})`);
  setText(equations.nuc, `${M.ratioWords(mag, 3)} × ${M.formatLength(M.nucleusDiameter(el))} = ${M.formatLength(nuc)}`);
  setText(equations.px, `${M.formatLength(nuc)} ÷ ${M.formatLength(p)} = ${M.formatPx(nuc / p, 2)} (${scaleSourceText(sim.scale)})`);
  setText(equations.vol, `(${sigT(el.nucleusRadius * 1e15, 4)} fm ÷ ${sigT(el.atomRadius * 1e12, 3)} pm)³ = ${sci(M.nuclearVolumeFraction(el), 2)}`);
  setText(equations.mass, `1 − ${el.z} × ${sigT(CODATA.electronMassU, 4)} u ÷ ${sigT(el.massU, 7)} u = ${fmt(M.nucleusMassShare(el) * 100, 3)}%`);
  const rEdge = M.hydrogenRadiusAtDensity(M.EDGE_DENSITY_PER_BOHR3);
  setText(equations.h1s, `a₀ = ${sigT(M.BOHR_RADIUS * 1e12, 4)} pm; density falls to ${M.EDGE_DENSITY_PER_BOHR3} e/bohr³ at ${sigT(rEdge * 1e12, 3)} pm, with ${fmt(M.hydrogenFractionInside(rEdge) * 100, 0)}% of the electron inside`);
  const lat = el.lattice || LATTICES.Cu;
  const nn = M.nearestNeighbour(lat);
  setText(equations.nn, `${lat.name}: a = ${sigT(lat.a * 1e12, 5)} pm → ${sigT(nn * 1e12, 3)} pm${el.lattice ? `, ${sigT(M.atAtomScale(el, nn) * 1e3, 2)} mm at atom = 1 cm` : ''}`);
  const pMag = M.magnification(M.PROTON_DIAMETER);
  setText(equations.pmag, `1 cm ÷ (2 × ${sigT(CODATA.protonRadius * 1e15, 5)} fm) = ${sci(pMag, 3)}; hydrogen atom → ${formatDistance(M.atProtonScale(M.atomDiameter(M.elementBySymbol('H'))), { about: false })}`);
  setText(equations.budget, `(2 × ${fmt(PDG_QUARKS.upMeV, 2)} + ${fmt(PDG_QUARKS.downMeV, 2)}) ÷ ${fmt(CODATA.protonMassMeV, 2)} MeV = ${fmt(M.valenceMassFraction() * 100, 2)}%`);
}

let pixelLineText = '';
function updatePixelLine() {
  let text;
  if (state.view === 'proton') {
    const q = M.atProtonScale(M.QUARK_LIMIT_DIAMETER);
    text = `At proton = 1 cm, a quark is under ${M.formatLength(q, 2)} across if it has any size: ${M.pixelFraction(q / pitch()).replace('about ', 'under ')}.`;
  } else {
    const nuc = M.nucleusAtAtomScale(state.el);
    text = `At atom = 1 cm, a ${state.el.name} nucleus is ${sig(nuc * 1e6, 2)} µm: ${M.pixelFraction(nuc / pitch())}.`;
  }
  if (text !== pixelLineText) {
    pixelLineText = text;
    sim.pixelCard?.update();
  }
}

function describe() {
  const scaleWord = sim.scale.calibrated ? 'calibrated true scale' : 'approximate scale';
  if (state.view === 'proton') {
    return `A proton drawn 1 centimetre across at ${scaleWord}, and magnified with an illustrative sea of quark and antiquark pairs and gluons. Quarks have no measured size: under ${M.formatLength(M.atProtonScale(M.QUARK_LIMIT_DIAMETER), 2)} at this scale. A hydrogen atom would be ${formatDistance(M.atProtonScale(M.atomDiameter(M.elementBySymbol('H'))), { about: false })} across.`;
  }
  const el = state.el;
  return `A ${el.name} atom drawn 1 centimetre across at ${scaleWord}${state.solid ? `, with its neighbours in solid ${el.lattice.name} ${sigT(M.atAtomScale(el, M.nearestNeighbour(el.lattice)) * 1e3, 2)} millimetres apart` : ''}. Magnified insets zoom in on its centre until the nucleus appears: ${sig(M.nucleusAtAtomScale(el) * 1e6, 2)} micrometres at this scale. A chart compares atom and nucleus radii for every element.`;
}

/* =========================================================================
 * 4. Step: the illustrative quark sea (positions in proton radii)
 * ====================================================================== */

/** Small seeded random generator (mulberry32), so the sea looks the same on every load. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261007);

function randomPoint(spread = 1) {
  const r = spread * 1.02 * rand() ** 0.75;
  const a = rand() * TAU;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}
function spawnPair(t, age = 0) {
  const p = randomPoint();
  const life = 0.5 + rand() * 1.1;
  return { ...p, ang: rand() * TAU, sep: 0.05 + rand() * 0.09, colour: Math.floor(rand() * 3), born: t - age * life, life };
}
function spawnGluon(t, age = 0) {
  const a = randomPoint(0.95);
  const len = 0.12 + rand() * 0.3;
  const ang = rand() * TAU;
  const life = 0.35 + rand() * 0.8;
  return { x0: a.x, y0: a.y, x1: a.x + len * Math.cos(ang), y1: a.y + len * Math.sin(ang), waves: 3 + Math.floor(rand() * 4), born: t - age * life, life };
}
function seedSea() {
  state.sea.pairs = Array.from({ length: SEA.pairs }, () => spawnPair(0, rand()));
  state.sea.gluons = Array.from({ length: SEA.gluons }, () => spawnGluon(0, rand()));
}

function step(dt) {
  if (state.view !== 'proton') return;
  state.time += dt;
  const t = state.time;
  const s = state.sea;
  s.pairs = s.pairs.map((p) => (t - p.born > p.life ? spawnPair(t) : p));
  s.gluons = s.gluons.map((g) => (t - g.born > g.life ? spawnGluon(t) : g));
}

/* =========================================================================
 * 5. Drawing (CSS px; k = CSS px per metre)
 * ====================================================================== */

function draw(ctx, w, h, k, c) {
  if (state.view === 'proton') drawProtonView(ctx, w, h, k, c);
  else drawAtomView(ctx, w, h, k, c);
}

const okTag = (c) => ({ color: c.ok, background: c.okBg });
const warnTag = (c) => ({ color: c.warn, background: c.warnBg });

/** A radial cloud: brightness from the model at radius r (px) for an atom of edge radius R (px). */
function cloudGradient(ctx, x, y, R, c, alpha = CLOUD_ALPHA, r1 = 1.7 * R) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r1);
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const b = M.cloudBrightness(M.cloudRelativeDensity((r1 * i) / n, R));
    g.addColorStop(i / n, withAlpha(c.cloudRgb, alpha * b));
  }
  return g;
}

function dashedCircle(ctx, x, y, r, colour, dash = [4, 3], width = 1.2) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/** A 1 cm bar with end ticks, centred on x. */
function cmBar(ctx, x, y, cmPx, c, label = '1 cm') {
  ctx.save();
  ctx.strokeStyle = c.fg;
  ctx.fillStyle = c.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - cmPx / 2, y - 5);
  ctx.lineTo(x - cmPx / 2, y + 5);
  ctx.moveTo(x - cmPx / 2, y);
  ctx.lineTo(x + cmPx / 2, y);
  ctx.moveTo(x + cmPx / 2, y - 5);
  ctx.lineTo(x + cmPx / 2, y + 5);
  ctx.stroke();
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, x, y + 8);
  ctx.restore();
}

/** Wrapped text; returns the y below the last line. */
function wrapText(ctx, text, x, y, maxW, lineH = 16) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineH;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}

/* ---------- Atom view ---------- */

function drawAtomView(ctx, w, h, k, c) {
  const wide = w >= 980;
  const split = wide ? Math.round(w * 0.6) : Math.round(h * 0.56);
  const cascade = wide ? { x: 0, y: 0, w: split, h } : { x: 0, y: 0, w, h: split };
  const chart = wide ? { x: split, y: 0, w: w - split, h } : { x: 0, y: split, w, h: h - split };
  drawCascade(ctx, cascade, k, c);
  // separator
  ctx.strokeStyle = c.track;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  if (wide) {
    ctx.moveTo(split + 0.5, 16);
    ctx.lineTo(split + 0.5, h - 16);
  } else {
    ctx.moveTo(16, split + 0.5);
    ctx.lineTo(w - 16, split + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawRadiusChart(ctx, chart, c);
}

function drawCascade(ctx, box, k, c) {
  const el = state.el;
  const cmPx = CM * k;
  const R = cmPx / 2;                                  // the atom's edge radius on screen
  const kAtom = cmPx / M.atomDiameter(el);             // CSS px per real metre in the true-size drawing
  const cy = box.y + box.h * 0.5;

  // True-size panel: the atom (or its row of neighbours in the solid).
  const chain = state.solid ? M.neighbourChain(el.lattice, 7) : null;
  const chainHalf = chain ? Math.max(...chain.map((p) => Math.abs(p.x))) * kAtom : 0;
  const panelW = Math.max(150, 2 * (chainHalf + R) + 40, 3.4 * cmPx);
  const ax = box.x + 24 + panelW / 2;

  // Insets: a ×100 chain, then a last nice step so the nucleus shows.
  const gap = 40;
  const nIns = 3;
  let B = Math.floor(Math.min((box.w - panelW - 24 - 16 - gap * nIns) / nIns, box.h - 120, 300));
  B = Math.max(B, 90);
  const mags = M.cascadeMagnifications(M.nucleusDiameter(el) * kAtom, B);
  const insets = mags.map((m, i) => ({ m, x: box.x + 24 + panelW + gap + i * (B + gap), y: cy - B / 2 }));

  // --- true-size panel ---
  if (chain) drawSolidRow(ctx, ax, cy, chain, kAtom, R, c);
  else {
    ctx.fillStyle = cloudGradient(ctx, ax, cy, R, c);
    ctx.beginPath();
    ctx.arc(ax, cy, 1.7 * R, 0, TAU);
    ctx.fill();
    dashedCircle(ctx, ax, cy, R, c.fg, [3, 2], 1);
  }
  drawTag(ctx, 'TRUE SIZE 1:1', ax, cy - Math.max(R * 1.8, 40) - 14, { ...okTag(c), align: 'center' });
  cmBar(ctx, ax, cy + Math.max(R * 1.8, 40) + 10, cmPx, c);
  ctx.font = FONT_BOLD;
  ctx.fillStyle = c.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const title = state.solid ? `${cap(el.lattice.name)} ${el.lattice.structure === 'fcc' ? 'metal' : 'crystal'}` : `${cap(el.name)} atom = 1 cm`;
  ctx.fillText(title, ax, cy + Math.max(R * 1.8, 40) + 40);
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  const sub = state.solid
    ? `neighbours ${sigT(M.atAtomScale(el, M.nearestNeighbour(el.lattice)) * 1e3, 2)} mm apart`
    : `edge (dashed): ${M.EDGE_DENSITY_PER_BOHR3} e/bohr³`;
  ctx.fillText(sub, ax, cy + Math.max(R * 1.8, 40) + 58);

  // Field of the first inset, marked at the centre of the atom.
  if (insets.length) fieldSquare(ctx, ax, cy, B / insets[0].m, c);

  // --- insets ---
  let prev = { x: ax, y: cy, side: insets.length ? B / insets[0].m : 0 };
  insets.forEach((ins, i) => {
    zoomLines(ctx, prev, ins, B, c);
    drawInset(ctx, ins, B, kAtom, R, c, insets[i + 1] ? insets[i + 1].m / ins.m : null, i === insets.length - 1);
    prev = { x: ins.x + B / 2, y: ins.y + B / 2, side: insets[i + 1] ? (B * ins.m) / insets[i + 1].m : 0 };
  });

  // Captions (static).
  ctx.font = FONT_BOLD;
  ctx.fillStyle = c.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${cap(el.name)}-${el.A}: the atom at 1 cm, then zooming in on its centre`, box.x + 24, box.y + 18, box.w - 48);
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  const y0 = box.y + box.h - 52;
  ctx.fillText('Each inset magnifies the small square at the centre of the one before. Magnifications are relative to the 1 cm drawing.', box.x + 24, y0, box.w - 48);
  ctx.fillText('Blue is the electron cloud (brightness compressed so the faint outer part shows). It is densest at the centre, so it fills every inset.', box.x + 24, y0 + 18, box.w - 48);
}

function fieldSquare(ctx, x, y, side, c) {
  const s = Math.max(side, 3);
  ctx.save();
  ctx.strokeStyle = c.fg;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - s / 2, y - s / 2, s, s);
  ctx.restore();
}

function zoomLines(ctx, from, ins, B, c) {
  const s = Math.max(from.side, 3) / 2;
  ctx.save();
  ctx.strokeStyle = c.muted;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(from.x + s, from.y - s);
  ctx.lineTo(ins.x, ins.y);
  ctx.moveTo(from.x + s, from.y + s);
  ctx.lineTo(ins.x, ins.y + B);
  ctx.stroke();
  ctx.restore();
}

/** One magnified inset: the centre of the atom at m times the true-size drawing. */
function drawInset(ctx, ins, B, kAtom, R, c, nextStep, last) {
  const el = state.el;
  const s = kAtom * ins.m;                    // CSS px per real metre inside this inset
  const x0 = ins.x;
  const y0 = ins.y;
  const cx = x0 + B / 2;
  const cy = y0 + B / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, B, B);
  ctx.clip();
  ctx.fillStyle = c.bg;
  ctx.fillRect(x0, y0, B, B);
  // The cloud near the centre: same density profile, sampled across the inset.
  const Rin = R * ins.m;                      // edge radius in this inset's px (huge)
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, B * 0.75);
  for (let i = 0; i <= 8; i++) {
    const r = (B * 0.75 * i) / 8;
    g.addColorStop(i / 8, withAlpha(c.cloudRgb, CLOUD_ALPHA * M.cloudBrightness(M.cloudRelativeDensity(r, Rin))));
  }
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, B, B);
  // The nucleus, at its size for this magnification.
  const nPx = M.nucleusDiameter(el) * s;
  if (nPx >= 1.5) {
    const ng = ctx.createRadialGradient(cx, cy, 0, cx, cy, nPx * 0.62);
    ng.addColorStop(0, c.nucleus);
    ng.addColorStop(0.75, c.nucleus);
    ng.addColorStop(1, withAlpha(c.cloudRgb, 0));
    ctx.fillStyle = ng;
    ctx.beginPath();
    ctx.arc(cx, cy, nPx * 0.62, 0, TAU);
    ctx.fill();
    if (nPx >= 12) dashedCircle(ctx, cx, cy, nPx / 2, c.fg, [3, 3], 1);
  } else if (nPx > 0.05) {
    ctx.fillStyle = c.nucleus;
    ctx.globalAlpha = Math.min(1, nPx);
    ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
    ctx.globalAlpha = 1;
  }
  if (nextStep) fieldSquare(ctx, cx, cy, B / nextStep, c);
  ctx.restore();

  ctx.strokeStyle = c.fg;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, B - 1, B - 1);
  drawTag(ctx, `MAGNIFIED ${M.magnificationText(ins.m)}`, cx, y0 - 14, { ...warnTag(c), align: 'center' });

  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = c.muted;
  let y = y0 + B + 8;
  ctx.fillText(`box: ${M.formatLength(B / s, 2)} of real atom`, cx, y, B + 30);
  y += 16;
  ctx.fillStyle = last ? c.fg : c.muted;
  if (last) ctx.font = FONT_BOLD;
  const nucTxt = last ? `nucleus: ${fm(M.nucleusDiameter(el))} across` : `nucleus here: ${M.formatPx(nPx, 2)}`;
  ctx.fillText(nucTxt, cx, y, B + 30);
  if (last) {
    ctx.font = FONT;
    ctx.fillStyle = c.muted;
    const at1 = M.nucleusAtAtomScale(el);
    ctx.fillText(`at 1:1: ${sig(at1 * 1e6, 2)} µm = ${M.formatPx(at1 / pitch(), 2)}`, cx, y + 16, B + 30);
  }
}

/** The solid: a chain of nearest neighbours at the measured spacing, at the same scale. */
function drawSolidRow(ctx, ax, cy, chain, kAtom, R, c) {
  const el = state.el;
  const nn = M.nearestNeighbour(el.lattice) * kAtom;
  // Free-atom clouds, faint so the overlaps show.
  for (const p of chain) {
    ctx.fillStyle = cloudGradient(ctx, ax + p.x * kAtom, cy - p.y * kAtom, R, c, 0.42);
    ctx.beginPath();
    ctx.arc(ax + p.x * kAtom, cy - p.y * kAtom, 1.7 * R, 0, TAU);
    ctx.fill();
  }
  // Bonds / neighbour lines and touching spheres of the lattice spacing.
  ctx.strokeStyle = c.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  chain.forEach((p, i) => (i ? ctx.lineTo(ax + p.x * kAtom, cy - p.y * kAtom) : ctx.moveTo(ax + p.x * kAtom, cy - p.y * kAtom)));
  ctx.stroke();
  for (const p of chain) {
    ctx.beginPath();
    ctx.arc(ax + p.x * kAtom, cy - p.y * kAtom, nn / 2, 0, TAU);
    ctx.stroke();
  }
  // The middle atom's free-atom edge, for comparison.
  const mid = chain[Math.floor(chain.length / 2)];
  dashedCircle(ctx, ax + mid.x * kAtom, cy - mid.y * kAtom, R, c.fg, [3, 2], 1);
}

function drawRadiusChart(ctx, box, c) {
  const el = state.el;
  const plot = { x: box.x + 64, y: box.y + 56, w: box.w - 64 - 28, h: box.h - 56 - 64 };
  if (plot.w < 120 || plot.h < 80) return;
  const yFmt = (v) => M.formatLength(10 ** Math.round(v), 1);
  const { X, Y } = drawChart(ctx, c, {
    box: plot,
    xr: [0, 100],
    yr: [-15.5, -9],
    xTicks: 5,
    yTicks: 7,
    yFmt,
    title: 'Radius (log scale)',
    xLabel: 'atomic number Z',
    marker: el.z,
    series: [
      { points: CHART.fit, color: c.muted, width: 1.2, dash: [5, 4] },
      { points: CHART.atoms, color: c.accent, width: 2 },
      { points: CHART.nuclei, color: c.nucleus, width: 2 },
    ],
  });
  // Selected element on both lines, and the ratio between them.
  const ya = Y(Math.log10(el.atomRadius));
  const yn = Y(Math.log10(el.nucleusRadius));
  const xz = X(el.z);
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(xz, ya, 4.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = c.nucleus;
  ctx.beginPath();
  ctx.arc(xz, yn, 4.5, 0, TAU);
  ctx.fill();
  const right = xz < plot.x + plot.w * 0.6;
  const side = { align: right ? 'left' : 'right', color: c.fg, background: c.bg, border: c.track };
  const dx = right ? 9 : -9;
  drawTag(ctx, `${el.symbol} atom: ${M.formatLength(el.atomRadius)}`, xz + dx, ya - 14, side);
  drawTag(ctx, `${el.symbol} nucleus: ${fm(el.nucleusRadius)}`, xz + dx, yn + 15, side);
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  ctx.textAlign = right ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`atom ${M.ratioWords(el.atomRadius / el.nucleusRadius, 3)} × wider`, xz + dx + (right ? 2 : -2), (ya + yn) / 2);

  // Series labels (static, in the empty corners).
  ctx.font = FONT_BOLD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = c.accent;
  ctx.fillText('Atoms: free-atom radius', plot.x + plot.w * 0.12, Y(Math.log10(7e-10)));
  ctx.fillStyle = c.nucleus;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('Nuclei: rms charge radius', plot.x + plot.w - 4, Y(Math.log10(1.9e-15)));
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  ctx.fillText(`dashed: ${sigT(R0 * 1e15, 2)} fm × A^(1/3)`, plot.x + plot.w - 4, Y(Math.log10(1.9e-15)) + 16);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Atoms go up and down along each row but barely grow; nuclei grow steadily with mass.', plot.x, plot.y + plot.h + 26, plot.w);
}

/* ---------- Proton view ---------- */

function drawProtonView(ctx, w, h, k, c) {
  const cmPx = CM * k;
  const wide = w >= 1000;
  const legendW = wide ? Math.min(340, Math.round(w * 0.27)) : 0;
  const legendH = wide ? 0 : 170;
  const areaH = h - legendH;
  const cy = areaH * 0.5;

  // True-size proton.
  const tx = 30 + Math.max(60, cmPx * 1.2);
  const r1 = cmPx / 2;
  protonCloud(ctx, tx, cy, r1, c);
  dashedCircle(ctx, tx, cy, r1, c.fg, [3, 2], 1);
  drawTag(ctx, 'TRUE SIZE 1:1', tx, cy - Math.max(r1 * 1.6, 36) - 14, { ...okTag(c), align: 'center' });
  cmBar(ctx, tx, cy + Math.max(r1 * 1.6, 36) + 10, cmPx, c);
  ctx.font = FONT_BOLD;
  ctx.fillStyle = c.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Proton = 1 cm', tx, cy + Math.max(r1 * 1.6, 36) + 40);

  // Magnified proton.
  const left = tx + Math.max(60, cmPx * 1.2) + 30;
  const right = w - legendW - 24;
  const R = Math.max(40, Math.min((right - left) * 0.4, areaH * 0.38));
  const cx = (left + right) / 2;
  const mag = (2 * R) / cmPx;
  ctx.save();
  ctx.strokeStyle = c.muted;
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  // Zoom lines to the big disc's left flank (they never cross the picture).
  const fx = cx - R * Math.cos(Math.PI / 5);
  const fy = R * Math.sin(Math.PI / 5);
  ctx.moveTo(tx, cy - r1);
  ctx.lineTo(fx, cy - fy);
  ctx.moveTo(tx, cy + r1);
  ctx.lineTo(fx, cy + fy);
  ctx.stroke();
  ctx.restore();
  protonCloud(ctx, cx, cy, R, c);
  drawSea(ctx, cx, cy, R, c);
  dashedCircle(ctx, cx, cy, R, c.fg, [5, 4], 1.2);
  drawTag(ctx, `MAGNIFIED ${M.magnificationText(mag)}`, cx, cy - R - 26, { ...warnTag(c), align: 'center' });
  ctx.font = FONT;
  ctx.fillStyle = c.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`dashed circle: ${M.formatLength(M.PROTON_DIAMETER)} across (twice the rms charge radius); the proton has no sharp edge`, cx, cy + R + 14, right - left);

  drawProtonLegend(ctx, wide ? { x: w - legendW - 8, y: 56, w: legendW - 8 } : { x: 20, y: areaH + 4, w: w - 40 }, mag, c, wide);
}

function protonCloud(ctx, x, y, R, c) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, 1.35 * R);
  g.addColorStop(0, withAlpha(c.protonRgb, 0.42));
  g.addColorStop(0.45, withAlpha(c.protonRgb, 0.3));
  g.addColorStop(0.74, withAlpha(c.protonRgb, 0.15));
  g.addColorStop(1, withAlpha(c.protonRgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 1.35 * R, 0, TAU);
  ctx.fill();
}

const QUARK_COLOURS = (c) => [c.quarkR, c.quarkG, c.quarkB];

/** Smooth 0 → 1 → 0 over a lifetime. */
const fade = (age, life) => Math.sin(Math.PI * clamp(age / life, 0, 1));

function drawSea(ctx, cx, cy, R, c) {
  const t = state.time;
  const cols = QUARK_COLOURS(c);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.25 * R, 0, TAU);
  ctx.clip();

  // Valence quarks: soft colour-charge hints that drift, not dots.
  [[0.9, 0.2], [2.7, 2.4], [4.6, 4.1]].forEach(([p, q], i) => {
    const x = cx + R * 0.36 * Math.sin(0.27 * t + p) + R * 0.08 * Math.sin(0.71 * t + q);
    const y = cy + R * 0.36 * Math.cos(0.21 * t + q) + R * 0.08 * Math.cos(0.63 * t + p);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.34);
    g.addColorStop(0, withAlpha(c[['quarkRRgb', 'quarkGRgb', 'quarkBRgb'][i]], 0.3));
    g.addColorStop(1, withAlpha(c[['quarkRRgb', 'quarkGRgb', 'quarkBRgb'][i]], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R * 0.34, 0, TAU);
    ctx.fill();
  });

  // Gluons: short-lived wavy lines.
  ctx.strokeStyle = c.gluon;
  ctx.lineWidth = 1.4;
  for (const gl of state.sea.gluons) {
    const a = fade(t - gl.born, gl.life);
    if (a <= 0.02) continue;
    ctx.globalAlpha = 0.85 * a;
    squiggle(ctx, cx + gl.x0 * R, cy + gl.y0 * R, cx + gl.x1 * R, cy + gl.y1 * R, gl.waves, Math.max(2, R * 0.018));
  }

  // Quark-antiquark pairs: markers only (filled = quark, ring = antiquark), born together and rejoining.
  for (const p of state.sea.pairs) {
    const age = t - p.born;
    const a = fade(age, p.life);
    if (a <= 0.02) continue;
    const sep = p.sep * R * a;
    const dx = Math.cos(p.ang) * sep / 2;
    const dy = Math.sin(p.ang) * sep / 2;
    const col = cols[p.colour];
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + p.x * R + dx, cy + p.y * R + dy, 2.6, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(cx + p.x * R - dx, cy + p.y * R - dy, 2.6, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function squiggle(ctx, x0, y0, x1, y1, waves, amp) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 2) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  const n = Math.max(12, Math.round(waves * 10));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const o = amp * Math.sin(s * waves * TAU);
    const x = x0 + ux * len * s - uy * o;
    const y = y0 + uy * len * s + ux * o;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

/** Static legend for the proton picture. */
function drawProtonLegend(ctx, box, mag, c, wide) {
  const q1 = M.atProtonScale(M.QUARK_LIMIT_DIAMETER) / pitch();
  const items = [
    { glyph: 'cloud', text: `Proton: a fuzzy region ${M.formatLength(M.PROTON_DIAMETER)} across. Here it is magnified ${M.magnificationText(mag)} beyond the true-size 1 cm.` },
    { glyph: 'valence', text: 'Valence quarks (up, up, down): only a hint of where they tend to be. They are not three balls.' },
    { glyph: 'quark', text: `Quark (marker only): no measured size, under ${sigT(q1, 2)} px at true size, if any.` },
    { glyph: 'anti', text: 'Antiquark (marker only): quark and antiquark pairs appear and vanish all the time.' },
    { glyph: 'gluon', text: 'Gluon: a quantum of the force field, with no size to draw.' },
  ];
  ctx.save();
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const cols = QUARK_COLOURS(c);
  if (wide) {
    let y = box.y;
    ctx.font = FONT_BOLD;
    ctx.fillStyle = c.fg;
    ctx.fillText('Inside a proton', box.x, y);
    y += 22;
    ctx.font = FONT;
    for (const it of items) {
      legendGlyph(ctx, it.glyph, box.x + 10, y + 7, c, cols);
      ctx.fillStyle = c.fg;
      y = wrapText(ctx, it.text, box.x + 28, y, box.w - 28) + 8;
    }
    ctx.fillStyle = c.muted;
    wrapText(ctx, 'The motion is an illustration: real fluctuations are far too fast and too small to show, and the numbers of pairs and gluons are not to scale.', box.x, y + 4, box.w);
  } else {
    const colW = (box.w - 16) / 2;
    items.forEach((it, i) => {
      const x = box.x + (i % 2) * (colW + 16);
      const y = box.y + Math.floor(i / 2) * 46;
      legendGlyph(ctx, it.glyph, x + 10, y + 7, c, cols);
      ctx.fillStyle = c.fg;
      wrapText(ctx, it.text, x + 28, y, colW - 28, 15);
    });
  }
  ctx.restore();
}

function legendGlyph(ctx, kind, x, y, c, cols) {
  ctx.save();
  if (kind === 'cloud') {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
    g.addColorStop(0, withAlpha(c.protonRgb, 0.6));
    g.addColorStop(1, withAlpha(c.protonRgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.fill();
  } else if (kind === 'valence') {
    ['quarkRRgb', 'quarkGRgb', 'quarkBRgb'].forEach((key, i) => {
      const gx = x - 5 + i * 5;
      const g = ctx.createRadialGradient(gx, y, 0, gx, y, 7);
      g.addColorStop(0, withAlpha(c[key], 0.55));
      g.addColorStop(1, withAlpha(c[key], 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(gx, y, 7, 0, TAU);
      ctx.fill();
    });
  } else if (kind === 'quark') {
    ctx.fillStyle = cols[0];
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, TAU);
    ctx.fill();
  } else if (kind === 'anti') {
    ctx.strokeStyle = cols[2];
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 2.6, 0, TAU);
    ctx.stroke();
  } else if (kind === 'gluon') {
    ctx.strokeStyle = c.gluon;
    ctx.lineWidth = 1.4;
    squiggle(ctx, x - 9, y, x + 9, y, 3, 2.5);
  }
  ctx.restore();
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  colorVars: {
    cloudRgb: '--atom-cloud-rgb',
    nucleus: '--atom-nucleus',
    protonRgb: '--atom-proton-rgb',
    quarkR: '--atom-quark-r',
    quarkG: '--atom-quark-g',
    quarkB: '--atom-quark-b',
    quarkRRgb: '--atom-quark-r-rgb',
    quarkGRgb: '--atom-quark-g-rgb',
    quarkBRgb: '--atom-quark-b-rgb',
    gluon: '--atom-gluon',
  },
  onScaleChange: () => {
    updateReadouts();
    updateEquations();
    updatePixelLine();
  },
  pixelLine: () => pixelLineText,
  debug: {
    state,
    M,
    setElement,
    setSolid,
    step,
    get pitch() { return pitch(); },
  },
});

// Element list: every element with full data.
const sel = $('element-select');
for (const e of M.ELEMENTS) {
  const o = document.createElement('option');
  o.value = e.symbol;
  o.textContent = `${e.z} ${e.symbol}, ${e.name}`;
  sel.append(o);
}
sel.addEventListener('change', () => setElement(sel.value));
$('solid-check').addEventListener('change', (e) => setSolid(e.target.checked));

initPresets(Object.fromEntries([
  ...['H', 'He', 'C', 'O', 'Fe', 'Ba', 'Pb', 'U'].map((s) => [s, () => {
    state.solid = false;
    setElement(s);
  }]),
  ...['Cu', 'Si', 'Au'].map((s) => [`solid-${s}`, () => {
    state.el = M.elementBySymbol(s);
    setSolid(true);
  }]),
]));

/*
 * Only the proton view moves. The atom view keeps the loop paused so nothing is
 * redrawn until something changes, and Space does nothing there; the visitor's
 * play / pause choice for the quark sea is remembered across view switches.
 */
let seaPaused = sim.paused;
function syncMotion(view) {
  if (view === 'proton') sim.setPaused(seaPaused);
  else {
    if (state.view === 'proton') seaPaused = sim.paused;
    sim.setPaused(true);
  }
}
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state.view === 'atom') e.stopPropagation(); // keep simkit's play toggle out of the static view
}, true);

initTabs({
  name: 'view',
  values: ['atom', 'proton'],
  tallViews: ['atom', 'proton'],
  onChange: (view) => {
    syncMotion(view);
    state.view = view;
    updatePixelLine();
    sim.updateAria();
    sim.requestDraw();
  },
});

/* Explainer numbers, computed from the data (no hand-typed figures). */
function fillExplainer() {
  const set = (key, text, html = false) => {
    for (const n of document.querySelectorAll(`[data-calc="${key}"]`)) {
      if (html) n.innerHTML = text;
      else n.textContent = text;
    }
  };
  /** "6.1 × 10<sup>15</sup>" (2 significant figures). */
  const supHtml = (x) => {
    let p = Math.floor(Math.log10(x));
    let m = Number((x / 10 ** p).toPrecision(2));
    if (m >= 10) {
      m /= 10;
      p += 1;
    }
    return `${sigT(m, 2)} × 10<sup>${String(p).replace('-', '−')}</sup>`;
  };
  const H = M.elementBySymbol('H');
  const Au = M.elementBySymbol('Au');
  const U = M.elementBySymbol('U');
  const P = M.DEFAULT_PITCH;
  set('hMag', M.ratioWords(M.magnification(M.atomDiameter(H)), 2));
  set('cmPx', fmt(CM / P, 0));
  set('hNucUm', sig(M.nucleusAtAtomScale(H) * 1e6, 2));
  set('auNucUm', sig(M.nucleusAtAtomScale(Au) * 1e6, 2));
  set('auNucUm2', sig(M.nucleusAtAtomScale(Au) * 1e6, 2));
  set('auNucPx', M.pixelFraction(M.nucleusAtAtomScale(Au) / P));
  set('auNucPx2', M.pixelFraction(M.nucleusAtAtomScale(Au) / P));
  set('edgeRho', String(M.EDGE_DENSITY_PER_BOHR3));
  const rEdge = M.hydrogenRadiusAtDensity(M.EDGE_DENSITY_PER_BOHR3);
  set('hEdgePm', sigT(rEdge * 1e12, 3));
  set('hRahmPm', sigT(H.atomRadius * 1e12, 3));
  set('hInside', fmt(M.hydrogenFractionInside(rEdge) * 100, 0));
  set('bohrPm', sigT(M.BOHR_RADIUS * 1e12, 3));
  const rr = M.atomRadiusRange();
  const nm = (z) => ATOM_NAME(z);
  set('minAtom', `${nm(rr.min.z)} (${sigT(rr.min.r * 1e12, 3)} pm)`);
  set('maxAtom', `${nm(rr.max.z)} (${sigT(rr.max.r * 1e12, 3)} pm)`);
  set('atomRatio', sigT(rr.ratio, 2));
  set('hNucFm', sigT(M.nucleusDiameter(H) * 1e15, 3));
  set('uNucFm', sigT(M.nucleusDiameter(U) * 1e15, 3));
  const fr = M.ELEMENTS.map(M.nuclearVolumeFraction);
  set('volMin', `one part in ${supHtml(1 / Math.min(...fr))}`, true);
  set('volMax', `one part in ${supHtml(1 / Math.max(...fr))}`, true);
  set('massMin', fmt(Math.floor(Math.min(...M.ELEMENTS.map(M.nucleusMassShare)) * 1000) / 10, 1));
  set('cuNn', sigT(M.nearestNeighbour(LATTICES.Cu) * 1e12, 3));
  set('pMag', M.ratioWords(M.magnification(M.PROTON_DIAMETER), 2));
  set('pH', formatDistance(M.atProtonScale(M.atomDiameter(H)), { about: false }));
  set('pAu', formatDistance(M.atProtonScale(M.atomDiameter(Au)), { about: false }));
  set('pBohr', formatDistance(M.atProtonScale(2 * M.BOHR_RADIUS), { about: false }));
  set('qLimit', supHtml(LIMITS.quarkRadius), true);
  set('qUm', sigT(M.atProtonScale(M.QUARK_LIMIT_DIAMETER) * 1e6, 2));
  set('qPx', `under ${sigT(M.atProtonScale(M.QUARK_LIMIT_DIAMETER) / P, 1)} of a pixel`);
  set('valence', fmt(M.valenceQuarkMassMeV(), 2));
  set('valencePct', fmt(M.valenceMassFraction() * 100, 2));
  set('pMassMeV', fmt(CODATA.protonMassMeV, 2));
  set('auAtomPm', sigT(M.atomDiameter(Au) * 1e12, 3));
  set('auMag', M.ratioWords(M.magnification(M.atomDiameter(Au)), 2));
  set('auNucFm', sigT(M.nucleusDiameter(Au) * 1e15, 3));
  set('auRms', sigT(Au.nucleusRadius * 1e15, 3));
  set('pitchUm', fmt(P * 1e6, 0));
  set('sharp', fmt(Math.sqrt(5 / 3), 2));
}
const ATOM_NAME = (z) => (M.ELEMENTS.find((e) => e.z === z)?.name) ?? `element ${z}`;

seedSea();
changed();
sim.start();
fillExplainer();
updatePixelLine();
sim.pixelCard?.update();
