/**
 * rutherford.js: Rutherford scattering at true scale (a calibrated page).
 *
 * Alpha particles are fired at a metal foil drawn at 1 cm per atom: the
 * nearest-neighbour distance of the crystal (a/√2, from its cited lattice
 * constant) is exactly 1 cm on the calibrated screen. Each alpha gets one
 * encounter, with the nucleus it passes closest to: its impact parameter b is
 * sampled with P(b) ∝ b over the patch of foil that holds one atom through
 * the whole thickness, and it turns through θ = 2·arctan(d/2b) (centre-of-mass
 * frame, then converted to the lab). So the fraction beyond 90° converges on
 * the cross-section result P = n·t·σ(>90°), which the page also computes
 * directly. Nothing about the historical "1 in 8,000" is hardcoded.
 *
 * The canvas has three parts:
 *   top           the foil at 1 cm per atom with the alphas (slowed ~10¹⁵ times)
 *   bottom left   one nucleus, magnified ~10¹¹ times: hyperbolic paths, the
 *                 head-on turn-back distance d and the nucleus at its measured size
 *   bottom right  histogram (log y) of the angles so far vs the Rutherford prediction
 *
 * Page pattern: 1 constants + state, 2 setters, 3 UI sync, 4 step, 5 draw, 6 wiring.
 * Alpha positions are in metres on the screen (the 1 cm-per-atom model), relative
 * to the foil's front face and the scene's middle; px only in draw (k = px per metre).
 * Pure maths: js/rutherford-model.js. Cited data: js/data/rutherford-data.js.
 */

import { clamp } from './physics.js';
import { fmt, scaleSourceText } from './common.js';
import { sig, sigT, sci, sigWords } from './astro.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawChart, drawArrowHead, FONT, FONT_BOLD, withAlpha } from './draw.js';
import * as M from './rutherford-model.js';
import { CONSTANTS as C, TARGETS, AIR, ALPHA_SOURCES, HISTORY } from './data/rutherford-data.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const { FM, DEG } = M;
const K = M.coulombMeVm(C.fineStructure, C.hbarcMeVfm); // e²/4πε₀, MeV·m
const Z_ALPHA = C.alphaChargeZ;
const R_ALPHA = M.uniformSphereRadius(C.alphaRmsRadiusFm * FM); // alpha's own edge, m
const C_LIGHT = 299792458; // m/s (exact)

const LIMITS = {
  eMin: 1, eMax: 10, eStep: 0.01,      // alpha energy, MeV
  tMin: 0.1e-6, tMax: 5e-6,            // foil thickness, m (log slider)
  rateMin: 1, rateMax: 500,            // alphas per second (log slider)
};
const BIN_DEG = 5;
const N_BINS = 180 / BIN_DEG;
const SCREEN_SPEED = 0.25;     // alpha speed on the screen, m/s (the real one is ~10¹⁵ times more, scaled)
const BURST = 10000;           // "Fire 10,000"
const BURST_RATE = 2500;       // alphas per second during a burst
const BURST_DRAW_EVERY = 40;   // a burst draws 1 in 40 of the alphas turned less than 10° (all the others)
const MAX_ANIMATED = 2500;     // beyond this many in flight, extra alphas are counted without drawing
const TRAIL_M = 0.035;         // trail length on screen, m
const MAX_TRACKS = 40;         // back-scatter paths kept on screen
const FRONT_COLS = 3;          // atomic layers drawn at the front of the foil...
const GAP_COLS = 2;            // ...a break standing for the thousands not drawn...
const BACK_COLS = 2;           // ...and the back layers
const SLAB_M = (FRONT_COLS + GAP_COLS + BACK_COLS) * 0.01; // drawn foil width on screen, m
const DOT_PX = 2.6;            // alpha marker radius (not to scale)
const ONE_MILLION = 1e6;

const PROPS = Object.fromEntries(Object.entries(TARGETS).map(([id, t]) => [id, M.targetProperties(t, C)]));
const kgPerM2 = (t, target) => t * target.densityGcm3 * 1000; // areal density of a foil, kg/m²
/** Radium C' alphas after the "little over a centimetre of air" of the 1909 set-up (ASTAR ranges). */
const E_1909 = M.energyAfter(AIR.range, ALPHA_SOURCES.po214.energyMeV, HISTORY.gm1909.airCm * 1e-2 * AIR.densityGcm3 * 1000);

const state = {
  E: 5,              // alpha energy, MeV (lab)
  target: 'gold',
  t: 1e-6,           // foil thickness, m
  rate: 20,          // alphas per second while the beam is on
  setup: null,       // M.scatteringSetup(...) for the current inputs
  alphas: [],        // alphas in flight (see spawn())
  queue: 0,          // burst alphas still to fire
  carry: 0,          // fractional alpha carried between frames
  tally: M.newTally(BIN_DEG),
  tracks: [],        // recent back-scatter paths, kept on screen
  version: 0,        // bumps whenever the tallies change
};

let shownVersion = -1;
let insetCache = null;

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));

/** Everything derived from the inputs (recomputed by setupChanged()). */
const cur = {};

function derive() {
  const tgt = TARGETS[state.target];
  const p = PROPS[state.target];
  const s = M.scatteringSetup({ E: state.E, t: state.t, p, z: Z_ALPHA, kMeVm: K });
  const touch = p.radius + R_ALPHA;
  const eOut = M.energyAfter(tgt.range, state.E, kgPerM2(state.t, tgt));
  const speed = M.speedFraction(state.E, C.alphaMassMeV);
  Object.assign(cur, {
    tgt, p, s,
    touch,
    touching: s.d < touch,
    eTouch: M.energyToReach(Z_ALPHA, p.Z, K, touch, p.massRatio),
    p90: M.probabilityBeyond(Math.PI / 2, s),
    p10: M.probabilityBeyond(10 * DEG, s),
    theta90cm: M.cmAngle(Math.PI / 2, p.massRatio),
    eOut,
    eLoss: state.E - eOut,
    speed,
    mag: 0.01 / p.dnn,               // 1 cm per atom spacing
    slow: (speed * C_LIGHT * (0.01 / p.dnn)) / SCREEN_SPEED,
  });
  state.setup = s;
  insetCache = null;
}

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setEnergy(E) {
  state.E = clamp(E, LIMITS.eMin, LIMITS.eMax);
  setupChanged();
}

function setTarget(id) {
  if (!TARGETS[id]) return;
  state.target = id;
  $('target-select').value = id;
  setupChanged();
}

function setThickness(t) {
  state.t = clamp(t, LIMITS.tMin, LIMITS.tMax);
  setupChanged();
}

function setRate(r) {
  state.rate = clamp(Math.round(r), LIMITS.rateMin, LIMITS.rateMax);
  params.forEach((q) => q.sync());
}

/** A new setup makes earlier counts meaningless: clear the run (keep playing if it was). */
function setupChanged() {
  derive();
  clearRun();
  params.forEach((q) => q.sync());
  updateAll();
  announce(
    `${fmt(state.E, 2)} MeV alphas on ${micro(state.t)} micrometres of ${cur.tgt.name}: a head-on alpha turns back ` +
      `${sigT(cur.s.d / FM, 3)} femtometres from the nucleus, ${sigT(cur.s.d / cur.p.radius, 2)} times its radius. ` +
      `About 1 in ${oneIn(cur.p90)} should come back beyond 90 degrees.`,
  );
}

function clearRun() {
  state.alphas = [];
  state.queue = 0;
  state.carry = 0;
  state.tally = M.newTally(BIN_DEG);
  state.tracks = [];
  state.version++;
}

function reset() {
  clearRun();
  sim.setPaused(true);
  updateRunReadouts();
  sim.updateAria();
  sim.requestDraw();
}

function fireBurst() {
  state.queue += BURST;
  if (sim.paused) sim.setPaused(false);
  sim.requestDraw();
}

function fireMillion() {
  M.fireMany(ONE_MILLION, state.setup, state.tally);
  state.version++;
  updateRunReadouts();
  sim.updateAria();
  sim.requestDraw();
  const { total, beyond90 } = state.tally;
  announce(
    `Fired a million alphas instantly. ${fmt(total, 0)} so far, ${fmt(beyond90, 0)} came back beyond 90 degrees` +
      `${beyond90 ? ` (1 in ${oneIn(beyond90 / total)})` : ''}. The cross-section predicts 1 in ${oneIn(cur.p90)}.`,
  );
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const params = [
  bindParam({ range: $('e-range'), num: $('e-num'), min: LIMITS.eMin, max: LIMITS.eMax, step: LIMITS.eStep,
    decimals: 2, words: 'mega-electronvolts', get: () => state.E, set: setEnergy }),
  bindParam({ range: $('t-range'), num: $('t-num'), min: LIMITS.tMin, max: LIMITS.tMax, log: true, scale: 1e6,
    decimals: 2, words: 'micrometres', get: () => state.t, set: setThickness }),
  bindParam({ range: $('rate-range'), num: $('rate-num'), min: LIMITS.rateMin, max: LIMITS.rateMax, log: true,
    decimals: 0, words: 'alphas per second', get: () => state.rate, set: setRate }),
];

/** "10,400", "80", "3.2": the N in "1 in N". */
function oneIn(P) {
  if (!(P > 0)) return '∞';
  const n = 1 / P;
  if (n < 10) return sigT(n, 2);
  if (n < 100) return sig(n, 2);
  return n < 1e6 ? sig(n, 3) : sigWords(n, 3, sigT);
}
/** Lengths at nuclear scale: "46.4 fm", "2.15 pm". */
function nuclear(m) {
  if (m < 1e-12) return `${sigT(m / FM, 3)} fm`;
  return `${sigT(m * 1e12, 3)} pm`;
}
const micro = (t) => sigT(t * 1e6, 3);
const angle = (rad) => `${sigT(rad / DEG, 3)}°`;
const pct = (P) => `${sigT(P * 100, 2)}%`;

function updateAll() {
  updateReadouts();
  updateRunReadouts();
  updateEquations();
  updateWarning();
  sim.updateAria();
  sim.requestDraw();
}

function updateReadouts() {
  const { s, p, tgt } = cur;
  setText(outputs.d, sigT(s.d / FM, 3));
  setText(outputs.dSub, `${sigT(s.dFixed / FM, 3)} fm if the nucleus did not recoil`);
  setText(outputs.R, sigT(p.radius / FM, 3));
  setText(outputs.RSub, `uniform sphere; rms charge radius ${sigT(p.rmsRadius / FM, 4)} fm (${tgt.isotope})`);
  const ratio = sigT(s.d / p.radius, 2);
  setText(outputs.ratio, `${ratio} ×`);
  setText(outputs.ratioSub, cur.touching
    ? `Touches the nucleus (surfaces meet at ${sigT(cur.touch / FM, 3)} fm): the formula fails here`
    : `Turned back ${ratio} times further out than the nucleus' edge: repelled before touching`);
  setText(outputs.p90, `about 1 in ${oneIn(cur.p90)}`);
  setText(outputs.p90Sub, `P = n·t·σ(>90°) = ${sci(cur.p90, 3)}`);
  setText(outputs.p10, `about 1 in ${oneIn(cur.p10)}`);
  setText(outputs.p10Sub, `P = n·t·σ(>10°) = ${pct(cur.p10)}`);
  setText(outputs.speed, sig((cur.speed * C_LIGHT) / 1000, 3));
  setText(outputs.speedSub, `${sigT(cur.speed * 100, 2)}% of light speed`);
  setText(outputs.layers, fmt(state.t / p.dnn, 0));
  setText(outputs.foilSub, cur.eOut > 0
    ? `${micro(state.t)} µm; an alpha loses about ${sigT(cur.eLoss, 2)} MeV crossing it`
    : `${micro(state.t)} µm; a ${fmt(state.E, 2)} MeV alpha stops inside it`);
}

/** Readouts that change as alphas are counted (cheap: only when the tallies changed). */
function updateRunReadouts() {
  if (shownVersion === state.version) return;
  shownVersion = state.version;
  const { total, beyond90, beyond10, latest } = state.tally;
  setText(outputs.fired, fmt(total, 0));
  setText(outputs.mc90, `beyond 90°: ${fmt(beyond90, 0)}${beyond90 ? ` (1 in ${oneIn(beyond90 / total)})` : ''}`);
  setText(outputs.mc10, `beyond 10°: ${fmt(beyond10, 0)}${beyond10 ? ` (1 in ${oneIn(beyond10 / total)})` : ''}`);
  if (latest) {
    setText(outputs.rmin, nuclear(latest.rMin));
    setText(outputs.rminSub, `aimed ${nuclear(latest.b)} from the nucleus (b), turned ${angle(latest.theta)}`);
    setText(equations.rmin,
      `Latest alpha: b = ${nuclear(latest.b)}, θ = ${angle(latest.thetaCm)}, r_min = ${nuclear(latest.rMin)}. Head-on (b = 0): r_min = d = ${nuclear(cur.s.d)}.`);
  } else {
    setText(outputs.rmin, '–');
    setText(outputs.rminSub, 'Fire the beam to see one.');
    setText(equations.rmin, `Head-on (b = 0): r_min = d = ${nuclear(cur.s.d)}. At b = d/2 (90°): r_min = ${nuclear(M.closestApproach(cur.s.d / 2, cur.s.d))}.`);
  }
  const N = total || 10000;
  const bins = M.expectedBins(N, state.setup, BIN_DEG, N_BINS);
  setText(equations.bin, `For ${fmt(N, 0)} alphas: 0–5° ${sig(bins[0], 3)}, 45–50° ${sig(bins[9], 2)}, 90–95° ${sig(bins[18], 2)}, 175–180° ${sig(bins[35], 2)} expected.`);
}

function updateEquations() {
  const { s, p, tgt } = cur;
  const k = K / FM;
  setText(equations.k, `${sigT(C.fineStructure * 1e3, 11)} × 10⁻³ × ${C.hbarcMeVfm} MeV·fm = ${sigT(k, 7)} MeV·fm`);
  setText(equations.ecm, `${fmt(state.E, 2)} × ${tgt.molarMassG} / (${tgt.molarMassG} + ${sigT(C.alphaMassU, 6)}) = ${sig(s.Ecm, 4)} MeV`);
  setText(equations.d, `2 × ${p.Z} × ${sigT(k, 6)} MeV·fm / ${sig(s.Ecm, 4)} MeV = ${sig(s.d / FM, 4)} fm (${sig(s.dFixed / FM, 4)} fm with a fixed nucleus)`);
  setText(equations.theta, `b = d/2 = ${nuclear(s.d / 2)} gives 90°; b = 1 pm gives ${angle(M.deflection(1e-12, s.d))} (centre-of-mass angles)`);
  setText(equations.lab, `m/M = ${sigT(C.alphaMassU, 6)} / ${tgt.molarMassG} = ${sigT(p.massRatio, 3)}; 90° in the lab is ${sigT(cur.theta90cm / DEG, 4)}° here`);
  setText(equations.dsdo, `At 90°: ${sig(M.diffCrossSection(Math.PI / 2, s.d) / FM ** 2, 3)} fm² per steradian (centre-of-mass frame)`);
  const sig90 = M.crossSectionBeyond(cur.theta90cm, s.d);
  setText(equations.sigma, `σ(>90°) = ${sig(sig90 / FM ** 2, 3)} fm² = ${sci(sig90, 3)} m²; σ(>10°) = ${sci(M.crossSectionBeyond(M.cmAngle(10 * DEG, p.massRatio), s.d), 3)} m²`);
  setText(equations.n, `${tgt.densityGcm3} g/cm³ × ${sci(C.avogadro, 4)} /mol ÷ ${tgt.molarMassG} g/mol = ${sci(p.n, 3)} atoms per m³`);
  setText(equations.p, `${sci(p.n, 3)} m⁻³ × ${micro(state.t)} µm × ${sci(sig90, 3)} m² = ${sci(cur.p90, 3)}, about 1 in ${oneIn(cur.p90)}`);
  setText(equations.bmax, `b_max = ${nuclear(s.bMax)}: every alpha passes this close to some nucleus, so none turns less than ${angle(s.minAngle)} in the lab`);
  setText(equations.scale, `a = ${tgt.latticeA} Å, a/√2 = ${sigT(p.dnn * 1e10, 4)} Å: magnified ${sigWords(cur.mag, 3)} times. 1 cm = ${fmt(sim.k / 100, 1)} px on this screen (${scaleSourceText(sim.scale)}).`);
  shownVersion = -1; // the r_min and bin lines depend on the setup too
  updateRunReadouts();
}

function updateWarning() {
  const msgs = [];
  if (cur.touching) {
    msgs.push(`At ${fmt(state.E, 2)} MeV a head-on alpha would reach ${sigT(cur.s.d / FM, 3)} fm, inside the ${sigT(cur.touch / FM, 3)} fm where it touches the ${cur.tgt.name} nucleus. ` +
      'The nuclear force joins in, so real counts at large angles fall below these Rutherford numbers.');
  }
  if (cur.s.minAngle > 5 * DEG) {
    msgs.push(`With ${fmt(state.t / cur.p.dnn, 0)} layers of atoms in the way, every alpha passes close enough to some nucleus to turn at least ${angle(cur.s.minAngle)}. ` +
      'A real foil this thick turns them through many small encounters instead (multiple scattering), which this single-scattering model leaves out.');
  }
  if (cur.eOut === 0) {
    msgs.push(`A ${fmt(state.E, 2)} MeV alpha stops inside ${micro(state.t)} µm of ${cur.tgt.name}. The thin-foil formula assumes it keeps its energy.`);
  } else if (cur.eLoss / state.E > 0.2) {
    msgs.push(`This foil is thick for ${fmt(state.E, 2)} MeV alphas: they lose about ${Math.round((100 * cur.eLoss) / state.E)}% of their energy crossing it, which the thin-foil formula ignores.`);
  }
  setText($('model-warn'), msgs.join(' '));
}

function describe() {
  const { total, beyond90 } = state.tally;
  return `A ${cur.tgt.name} foil drawn at 1 centimetre per atom (magnified ${sigWords(cur.mag, 3)} times), ` +
    `with ${fmt(state.E, 2)} MeV alpha particles fired at it from the left${sim.paused ? ', paused' : ''}. ` +
    `${fmt(total, 0)} fired so far, ${fmt(beyond90, 0)} came back beyond 90 degrees; the cross-section predicts about 1 in ${oneIn(cur.p90)}. ` +
    `Inset: paths around one ${cur.tgt.name} nucleus; a head-on alpha turns back ${sigT(cur.s.d / FM, 3)} femtometres from its centre, ` +
    `${sigT(cur.s.d / cur.p.radius, 2)} times its radius. Histogram of the angles counted so far against the Rutherford prediction.`;
}

/* =========================================================================
 * 4. Step: fire, move and count the alphas
 * ====================================================================== */

/**
 * Fire one alpha. It is drawn unless too many are in flight already, or it is
 * part of a burst and turned less than 10° (a burst draws every alpha turned
 * more than that, and 1 in BURST_DRAW_EVERY of the rest); undrawn alphas are
 * counted at once. s0 spreads the alphas fired in one frame along the beam.
 */
function spawn(g, s0, fromBurst) {
  const a = M.scatterOne(1 - Math.random(), state.setup);
  const skip = state.alphas.length >= MAX_ANIMATED ||
    (fromBurst && a.theta <= 10 * DEG && Math.random() * BURST_DRAW_EVERY >= 1);
  if (skip) {
    M.record(state.tally, a);
    state.version++;
    return;
  }
  const xStart = -g.foilX0 / g.k - 0.004;
  const xBend = Math.random() * SLAB_M;
  Object.assign(a, {
    xStart,
    y0: (Math.random() - 0.5) * g.beamH,
    xBend,
    sBend: xBend - xStart,
    dir: Math.random() < 0.5 ? 1 : -1, // turns up or down, in the plane of the screen
    s: s0,
    counted: false,
  });
  state.alphas.push(a);
}

/** Position (screen metres from the foil's front face and the scene's middle, y down) at path length s. */
function alphaPos(a, s) {
  if (s <= a.sBend) return [a.xStart + s, a.y0];
  const r = s - a.sBend;
  return [a.xBend + r * Math.cos(a.theta), a.y0 - a.dir * r * Math.sin(a.theta)];
}

function step(simDt) {
  const g = geometry(sim.width, sim.height, sim.k);
  const ds = SCREEN_SPEED * simDt;
  state.carry += state.rate * simDt;
  const n = Math.floor(state.carry);
  state.carry -= n;
  for (let i = 0; i < n; i++) spawn(g, Math.random() * ds, false);
  if (state.queue > 0) {
    const b = Math.min(state.queue, Math.max(1, Math.round(BURST_RATE * simDt)));
    state.queue -= b;
    for (let i = 0; i < b; i++) spawn(g, Math.random() * ds, true);
  }

  const { xMin, xMax, yMin, yMax } = g.boundsM;
  let w = 0;
  for (const a of state.alphas) {
    a.s += ds;
    if (!a.counted && a.s >= a.sBend) {
      a.counted = true;
      M.record(state.tally, a);
      state.version++;
      if (a.theta > Math.PI / 2) {
        state.tracks.push({ xStart: a.xStart, y0: a.y0, xBend: a.xBend, theta: a.theta, dir: a.dir });
        if (state.tracks.length > MAX_TRACKS) state.tracks.shift();
      }
    }
    const [x, y] = alphaPos(a, a.s);
    const alive = a.s < a.sBend || (x > xMin && x < xMax && y > yMin && y < yMax);
    if (alive) state.alphas[w++] = a;
  }
  state.alphas.length = w;
  updateRunReadouts();
}

/* =========================================================================
 * 5. Drawing (k = CSS px per metre; the foil model is 1 cm per atom spacing)
 * ====================================================================== */

/** Canvas regions: the foil scene on top, the inset and the histogram below. */
function layout(w, h) {
  const pad = 12;
  if (w < 760) { // narrow screens: the three parts stacked
    const sceneH = Math.round(h * 0.42);
    const ph = Math.round((h - sceneH - 12 - 2 * pad) / 2);
    return {
      scene: { x: 0, y: 0, w, h: sceneH },
      inset: { x: pad, y: sceneH + 12, w: w - 2 * pad, h: ph },
      hist: { x: pad, y: sceneH + 12 + ph + pad, w: w - 2 * pad, h: ph },
    };
  }
  const sceneH = Math.round(h * (h < 760 ? 0.52 : 0.56)); // short canvases give the panels a bit more
  const y = sceneH + 12;
  const bh = Math.max(120, h - y - pad);
  const insetW = Math.round(clamp(w * 0.39, 280, 680));
  const hx = pad + insetW + 28;
  return {
    scene: { x: 0, y: 0, w, h: sceneH },
    inset: { x: pad, y, w: insetW, h: bh },
    hist: { x: hx, y, w: w - hx - pad, h: bh },
  };
}

/** The foil scene in px: columns of atoms 1 cm apart, rows 1 cm apart, the beam band. */
function geometry(w, h, k) {
  const L = layout(w, h);
  const sp = 0.01 * k; // one atom spacing = 1 cm
  const foilX0 = Math.round(clamp(w * 0.3, 200, 600));
  const top = L.scene.y + 56;
  const bottom = L.scene.y + L.scene.h - 34;
  const nRows = Math.max(3, Math.floor((bottom - top) / sp));
  const yMid = (top + bottom) / 2;
  const rows = Array.from({ length: nRows }, (_, j) => yMid + (j - (nRows - 1) / 2) * sp);
  const cols = [];
  for (let i = 0; i < FRONT_COLS; i++) cols.push(foilX0 + (i + 0.5) * sp);
  for (let i = 0; i < BACK_COLS; i++) cols.push(foilX0 + (FRONT_COLS + GAP_COLS + i + 0.5) * sp);
  const toPx = ([x, y]) => [foilX0 + x * k, yMid + y * k];
  return {
    L, k, sp, foilX0, foilX1: foilX0 + SLAB_M * k, yMid, rows, cols, toPx,
    gapX0: foilX0 + FRONT_COLS * sp,
    gapX1: foilX0 + (FRONT_COLS + GAP_COLS) * sp,
    beamH: (nRows * sp) / k, // beam band height, m on screen
    boundsM: {
      xMin: -foilX0 / k - 0.01, xMax: (w - foilX0) / k + 0.01,
      yMin: (L.scene.y - yMid) / k - 0.01, yMax: (L.scene.y + L.scene.h - yMid) / k + 0.01,
    },
  };
}

function draw(ctx, w, h, k, colors) {
  const g = geometry(w, h, k);
  drawScene(ctx, g, w, colors);
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, g.L.scene.h + 0.5);
  ctx.lineTo(w, g.L.scene.h + 0.5);
  ctx.stroke();
  drawInset(ctx, g, colors);
  drawHistogram(ctx, g.L.hist, colors);
  const badge = `${sim.paused ? 'PAUSED · ' : ''}SLOWED ABOUT ${sci(cur.slow, 1)} TIMES`;
  setText($('motion-badge'), badge);
}

/* ---------- Top: the foil at 1 cm per atom ---------- */

function drawScene(ctx, g, w, colors) {
  const { L, sp, rows, cols, foilX0, foilX1, gapX0, gapX1 } = g;
  const sceneBottom = L.scene.y + L.scene.h;

  // Foil slab background
  ctx.fillStyle = withAlpha(colors.atomRgb, 0.06);
  ctx.fillRect(foilX0, rows[0] - sp / 2, foilX1 - foilX0, rows.length * sp);

  // Atoms: fuzzy electron clouds, nearest neighbours 1 cm apart
  const rCloud = sp * 0.56;
  for (const x of cols) {
    for (const y of rows) {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rCloud);
      grad.addColorStop(0, withAlpha(colors.atomRgb, 0.55));
      grad.addColorStop(0.35, withAlpha(colors.atomRgb, 0.3));
      grad.addColorStop(0.7, withAlpha(colors.atomRgb, 0.1));
      grad.addColorStop(1, withAlpha(colors.atomRgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, rCloud, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The break: thousands of layers not drawn
  drawBreak(ctx, gapX0 + sp * 0.3, rows[0] - sp / 2, rows[rows.length - 1] + sp / 2, colors);
  drawBreak(ctx, gapX1 - sp * 0.3, rows[0] - sp / 2, rows[rows.length - 1] + sp / 2, colors);
  const hidden = Math.max(0, Math.round(state.t / cur.p.dnn) - FRONT_COLS - BACK_COLS);
  ctx.save();
  ctx.translate((gapX0 + gapX1) / 2, g.yMid);
  ctx.rotate(-Math.PI / 2);
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${fmt(hidden, 0)} more layers, not drawn`, 0, 0);
  ctx.restore();

  // Back-scatter paths kept on screen, then the alphas in flight
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, L.scene.y, w, L.scene.h);
  ctx.clip();
  drawTracks(ctx, g, colors);
  drawAlphas(ctx, g, colors);
  ctx.restore();

  drawSceneLabels(ctx, g, w, colors, sceneBottom);
}

function drawBreak(ctx, x, y0, y1, colors) {
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const step = 8;
  for (let y = y0, i = 0; y <= y1; y += step, i++) {
    const xx = x + (i % 2 ? 4 : -4);
    if (i === 0) ctx.moveTo(xx, y);
    else ctx.lineTo(xx, y);
  }
  ctx.stroke();
}

function drawTracks(ctx, g, colors) {
  if (!state.tracks.length) return;
  ctx.strokeStyle = withAlpha(colors.hotRgb, 0.5);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const far = (g.L.scene.w + g.L.scene.h) / g.k;
  for (const t of state.tracks) {
    const [x0, y0] = g.toPx([t.xBend - 0.06, t.y0]);
    const [xb, yb] = g.toPx([t.xBend, t.y0]);
    const [x1, y1] = g.toPx([t.xBend + far * Math.cos(t.theta), t.y0 - t.dir * far * Math.sin(t.theta)]);
    ctx.moveTo(x0, y0);
    ctx.lineTo(xb, yb);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

/** Append the part of an alpha's path between path lengths s1 < s2 to the current path. */
function pathSegment(ctx, g, a, s1, s2) {
  const [x1, y1] = g.toPx(alphaPos(a, s1));
  ctx.moveTo(x1, y1);
  if (s1 < a.sBend && s2 > a.sBend) {
    const [xb, yb] = g.toPx([a.xBend, a.y0]);
    ctx.lineTo(xb, yb);
  }
  const [x2, y2] = g.toPx(alphaPos(a, s2));
  ctx.lineTo(x2, y2);
}

function drawAlphas(ctx, g, colors) {
  const list = state.alphas;
  if (!list.length) return;
  const hot = (a) => a.counted && a.theta > Math.PI / 2;
  // Fading trails: three bands, faint at the tail, stronger near the head
  const bands = [0.12, 0.25, 0.45];
  ctx.lineWidth = 2;
  for (let band = 0; band < 3; band++) {
    for (const isHot of [false, true]) {
      ctx.strokeStyle = withAlpha(isHot ? colors.hotRgb : colors.accentRgb, isHot ? bands[band] + 0.3 : bands[band]);
      ctx.beginPath();
      for (const a of list) {
        if (hot(a) !== isHot) continue;
        const s2 = a.s - (TRAIL_M * band) / 3;
        const s1 = Math.max(0, a.s - (TRAIL_M * (band + 1)) / 3);
        if (s2 > s1) pathSegment(ctx, g, a, s1, s2);
      }
      ctx.stroke();
    }
  }
  // Heads
  for (const isHot of [false, true]) {
    ctx.fillStyle = isHot ? colors.hot : colors.accent;
    ctx.beginPath();
    for (const a of list) {
      if (hot(a) !== isHot) continue;
      const [x, y] = g.toPx(alphaPos(a, a.s));
      const r = isHot ? DOT_PX + 1.4 : DOT_PX;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function drawSceneLabels(ctx, g, w, colors, sceneBottom) {
  const { sp, rows, cols, foilX0, k } = g;
  const calibrated = sim.scale.calibrated;

  // Scale badges: the drawing is a magnified model, its 1 cm is true 1 cm when calibrated
  let x = 12;
  x += drawTag(ctx, `MAGNIFIED ×${sigWords(cur.mag, 3).toUpperCase()}`, x, 18, { color: colors.warn, background: colors.warnBg }) + 8;
  drawTag(ctx, calibrated ? '1 cm PER ATOM: TRUE 1 cm ON YOUR SCREEN' : '1 cm PER ATOM (APPROXIMATE: CALIBRATE FOR A TRUE 1 cm)', x, 18,
    { color: calibrated ? colors.ok : colors.warn, background: calibrated ? colors.okBg : colors.warnBg });

  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${cur.tgt.Name} foil ${micro(state.t)} µm thick: ${fmt(state.t / cur.p.dnn, 0)} atoms deep, ${lengthWords(state.t * cur.mag)} at this scale. ` +
      'Only its front and back layers are drawn.',
    12, 44,
  );

  // The beam
  drawTag(ctx, `α particles, ${fmt(state.E, 2)} MeV →`, 12, g.yMid, { color: colors.fg, background: colors.bg, border: colors.track });

  const narrow = w < 760; // phones: keep only the essential labels

  // A nucleus is far below one pixel
  const ax = cols[0];
  const ay = rows[0];
  const nucleusPx = 2 * cur.p.radius * cur.mag * k; // CSS px
  if (!narrow) {
    ctx.strokeStyle = colors.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ax, ay, 3, 0, Math.PI * 2);
    ctx.moveTo(ax - 4, ay - 3);
    ctx.lineTo(foilX0 - 14, ay - 3);
    ctx.stroke();
    drawTag(ctx, `nucleus: ${sigT(2 * cur.p.radius * cur.mag * 1e6, 2)} µm across here, 1/${sig(1 / nucleusPx, 2)} of a pixel`,
      foilX0 - 14, ay - 3, { align: 'right', color: colors.fg, background: colors.bg, border: colors.track, height: 20 });
  }

  // Legend (right, under the motion badge)
  if (!narrow) drawLegend(ctx, w, colors);

  // True-size 1 cm bar (bottom right)
  drawCmBar(ctx, g, w, colors, sceneBottom);

  // Nothing fired yet
  if (!state.tally.total && !state.alphas.length && sim.paused) {
    drawTag(ctx, 'Press Fire beam, Fire 10,000 or Fire 1,000,000 to start', (g.foilX1 + w) / 2, g.yMid,
      { align: 'center', color: colors.muted, background: colors.bg, border: colors.track });
  }

  // Burst in progress
  if (state.queue > 0) {
    drawTag(ctx, `burst: ${fmt(state.queue, 0)} to go. Drawn: every alpha turned over 10°, 1 in ${BURST_DRAW_EVERY} of the rest`,
      12, g.yMid + 28, { color: colors.warn, background: colors.warnBg });
  }

  // Where the magnified inset comes from
  const ix = cols[1];
  const iy = rows[rows.length - 1];
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(ix, iy, sp * 0.18, 0, Math.PI * 2);
  ctx.moveTo(ix - sp * 0.18, iy);
  ctx.lineTo(g.L.inset.x + 1, g.L.inset.y + 1);
  ctx.moveTo(ix + sp * 0.18, iy);
  ctx.lineTo(g.L.inset.x + g.L.inset.w - 1, g.L.inset.y + 1);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Legend in the scene's top right, under the motion badge. */
function drawLegend(ctx, w, colors) {
  ctx.font = FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const lx = w - 12;
  ctx.fillStyle = colors.fg;
  ctx.fillText('alpha particles (markers not to scale)', lx - 16, 54);
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.arc(lx - 5, 54, DOT_PX + 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.fg;
  ctx.fillText('back-scattered beyond 90°: their paths stay on screen', lx - 16, 72);
  ctx.fillStyle = colors.hot;
  ctx.beginPath();
  ctx.arc(lx - 5, 72, DOT_PX + 1.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = colors.muted;
  ctx.fillText(cur.p10 < 0.5
    ? `most pass straight through: only 1 in ${oneIn(cur.p10)} turns more than 10°`
    : `this foil is so thick that every alpha turns at least ${angle(cur.s.minAngle)}`, lx, 90);
}

/** True-size 1 cm bar in the scene's bottom right: one atom spacing. */
function drawCmBar(ctx, g, w, colors, sceneBottom) {
  const { sp } = g;
  const by = sceneBottom - 12;
  const label = `1 cm = one atom spacing (${sigT(cur.p.dnn * 1e9, 3)} nm)`;
  ctx.font = FONT;
  const bx1 = w - 12;
  const bx0 = bx1 - sp;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx0, by - 6);
  ctx.lineTo(bx0, by);
  ctx.lineTo(bx1, by);
  ctx.lineTo(bx1, by - 6);
  ctx.stroke();
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx0 - 8, by - 3);
}

/** "34.7 m", "3.47 m", "347 cm"-style length words for the foil at model scale. */
function lengthWords(m) {
  if (m >= 1) return `${sigT(m, 3)} m`;
  return `${sigT(m * 100, 3)} cm`;
}

/* ---------- Bottom left: one nucleus, magnified ---------- */

function drawInset(ctx, g, colors) {
  const box = g.L.inset;
  const { s, p } = cur;
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 8);
  ctx.stroke();

  // Plot area; the nucleus sits low and right, paths arrive from the left above it
  const area = { x: box.x + 8, y: box.y + 32, w: box.w - 16, h: box.h - 58 };
  const cx = area.x + area.w * 0.62;
  const cy = area.y + area.h * 0.68;
  const span = Math.max(s.d, 1.35 * cur.touch);
  const ppm = Math.min( // px per metre
    (cx - area.x - 6) / (4.2 * span),
    (cy - area.y - 4) / (3 * span),
    (area.y + area.h - cy - 4) / (1.05 * span),
  );
  const mag = ppm / g.k;

  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Around one ${cur.tgt.name} nucleus`, box.x + 10, box.y + 17);
  drawTag(ctx, `MAGNIFIED ×${sci(mag, 2)}`, box.x + box.w - 8, box.y + 17,
    { align: 'right', color: colors.warn, background: colors.warnBg });

  // Paths for aims b = d/4, d/2, d, 2d (cached: they change only with the inputs and the canvas size)
  const key = `${area.w}x${area.h}:${ppm}`;
  if (!insetCache || insetCache.key !== key) {
    const rMax = Math.hypot(area.w, area.h) / ppm;
    const aims = area.h >= 280 ? [0.25, 0.5, 1, 2] : [0.25, 0.5, 1]; // b = 2d needs the height
    const paths = aims.map((f) => ({
      f, pts: M.hyperbolaPoints(f * s.d, s.d, rMax, 160), theta: M.deflection(f * s.d, s.d),
    }));
    insetCache = { key, paths, rMax };
  }
  const X = (x) => cx + x * ppm;
  const Y = (y) => cy - y * ppm;
  const inside = (px, py, m) => px > area.x + m && px < area.x + area.w - m && py > area.y + m && py < area.y + area.h - m;
  const stroke = (pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();

  // Turn-back distance d, and where the alpha would touch the nucleus
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.arc(cx, cy, s.d * ppm, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = cur.touching ? colors.warn : colors.track;
  ctx.beginPath();
  ctx.arc(cx, cy, cur.touch * ppm, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hyperbolic paths
  const placed = []; // angle-label positions so far
  for (const path of insetCache.paths) {
    ctx.strokeStyle = path.theta > Math.PI / 2 ? colors.hot : colors.accent;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 1.6;
    stroke(path.pts);
    // arrowhead where the path leaves the view
    let i = path.pts.length - 1;
    while (i > 1 && !inside(X(path.pts[i][0]), Y(path.pts[i][1]), 14)) i--;
    const [xa, ya] = path.pts[i - 1];
    const [xb, yb] = path.pts[i];
    const len = Math.hypot(xb - xa, yb - ya) || 1;
    path.dir = [(xb - xa) / len, -(yb - ya) / len];
    drawArrowHead(ctx, X(xb), Y(yb), path.dir[0], path.dir[1], 7);
    // angle label: from the exit back towards the closest approach, the first spot clear of the other labels
    const pts = path.pts;
    let apex = 0;
    for (let q = 1; q < pts.length; q++) if (Math.hypot(...pts[q]) < Math.hypot(...pts[apex])) apex = q;
    path.labelAt = [X(xb), Y(yb)];
    for (let q = i; q > apex; q -= 2) {
      const px = X(pts[q][0]);
      const py = Y(pts[q][1]);
      if (inside(px, py, 12) && placed.every(([ox, oy]) => Math.abs(px - ox) > 36 || Math.abs(py - oy) > 16)) {
        path.labelAt = [px, py];
        break;
      }
    }
    placed.push(path.labelAt);
  }

  // The latest back-scatter from the Monte Carlo, if any
  const lb = state.tally.lastBack;
  if (lb !== null) {
    ctx.strokeStyle = colors.fg;
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1.4;
    stroke(M.hyperbolaPoints(lb, s.d, insetCache.rMax, 160));
    ctx.setLineDash([]);
  }

  // Head-on: comes in along the axis, stops at d and goes back
  const stopX = X(-s.d);
  ctx.strokeStyle = colors.hot;
  ctx.fillStyle = colors.hot;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(area.x, cy);
  ctx.lineTo(stopX - 6, cy);
  ctx.stroke();
  drawArrowHead(ctx, stopX, cy, 1, 0, 8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(stopX + 1, cy - 5);
  ctx.lineTo(stopX + 1, cy + 5);
  ctx.stroke();

  // The nucleus at its measured size
  ctx.fillStyle = colors.nucleus;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, p.radius * ppm), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Labels (static: they change only with the inputs)
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const path of insetCache.paths) {
    const [lx, ly] = path.labelAt;
    ctx.fillStyle = path.theta > Math.PI / 2 ? colors.hot : colors.accent;
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(path.theta / DEG)}°`, lx + 7, ly + 2);
  }
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'left';
  for (const path of insetCache.paths) {
    if (path.f !== 0.5 && path.f !== 2) continue;
    const edge = path.pts.find((q) => X(q[0]) >= area.x + 100) ?? path.pts[0]; // where the label ends
    const y = Y(edge[1]) - 9;
    if (y > area.y + 6) ctx.fillText(`b = ${path.f === 0.5 ? 'd/2' : '2d'} = ${nuclear(path.f * s.d)}`, area.x + 4, y);
  }
  ctx.fillStyle = colors.fg;
  ctx.fillText(`head-on: stops ${nuclear(s.d)} from the centre (d)`, area.x + 4, cy + 14);
  // nucleus label outside the d circle, with a leader line
  const nr = Math.max(p.radius * ppm, 2);
  const lx = cx + Math.max(s.d, cur.touch) * ppm + 10;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + nr + 2, cy);
  ctx.lineTo(lx - 4, cy);
  ctx.stroke();
  ctx.fillText(`nucleus, radius ${sigT(p.radius / FM, 2)} fm`, lx, cy);
  if (lb !== null) {
    ctx.fillStyle = colors.muted;
    ctx.fillText(`dotted: the latest back-scatter, b = ${nuclear(Math.abs(lb))}`, area.x + 4, area.y + area.h - 8);
  }

  // Verdict + scale bar along the bottom
  const by = box.y + box.h - 13;
  ctx.font = FONT_BOLD;
  ctx.fillStyle = cur.touching ? colors.warn : colors.fg;
  ctx.textAlign = 'left';
  ctx.fillText(cur.touching
    ? `Touches the nucleus: d is inside the ${sigT(cur.touch / FM, 3)} fm contact distance`
    : `Repelled before touching: d = ${sigT(s.d / p.radius, 2)} × the nucleus' radius`, box.x + 10, by);
  const barM = niceFm((area.w * 0.16) / ppm);
  const barPx = barM * ppm;
  const bx1 = box.x + box.w - 12;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx1 - barPx, by - 6);
  ctx.lineTo(bx1 - barPx, by);
  ctx.lineTo(bx1, by);
  ctx.lineTo(bx1, by - 6);
  ctx.stroke();
  ctx.font = FONT;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'right';
  ctx.fillText(`${sigT(barM / FM, 2)} fm`, bx1 - barPx - 6, by - 2);
}

/** Largest 1-2-5 × 10ⁿ fm length that is <= m (metres). */
function niceFm(m) {
  const fm = m / FM;
  const p = 10 ** Math.floor(Math.log10(fm));
  for (const f of [5, 2, 1]) if (f * p <= fm) return f * p * FM;
  return p * FM;
}

/* ---------- Bottom right: histogram of angles ---------- */

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** Log-axis tick label: −1 → "0.1", 2 → "100", 5 → "10⁵". */
function pow10Label(v) {
  const e = Math.round(v);
  if (e < 0) return String(10 ** e);
  if (e <= 3) return fmt(10 ** e, 0);
  return `10${String(e).split('').map((c) => SUP[c]).join('')}`;
}

function drawHistogram(ctx, box, colors) {
  const { bins, total } = state.tally;
  const N = total || 10000;
  const expected = M.expectedBins(N, state.setup, BIN_DEG, N_BINS);
  const top = Math.max(2, Math.ceil(Math.log10(N * 1.6)));
  const yr = [-1, top];
  const plot = { x: box.x + 50, y: box.y + 30, w: box.w - 58, h: box.h - 30 - 34 };
  const { X, Y } = drawChart(ctx, colors, {
    box: plot, xr: [0, 180], yr, series: [],
    title: 'Scattering angles: alphas per 5° band (log scale)', xLabel: 'angle θ',
    xTicks: 9, yTicks: yr[1] - yr[0], xFmt: (v) => `${v}°`, yFmt: pow10Label, marker: 90,
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 2, plot.w, plot.h + 2);
  ctx.clip();
  const y0 = Y(yr[0]);
  // Monte Carlo bars
  for (let i = 0; i < N_BINS; i++) {
    if (!bins[i]) continue;
    const back = i * BIN_DEG >= 90;
    ctx.fillStyle = withAlpha(back ? colors.hotRgb : colors.accentRgb, back ? 0.85 : 0.6);
    const x0 = X(i * BIN_DEG) + 1;
    const x1 = X((i + 1) * BIN_DEG) - 1;
    const y = Y(Math.log10(bins[i]));
    ctx.fillRect(x0, y, Math.max(1, x1 - x0), y0 - y);
  }
  // Rutherford prediction, as a step line over the same bands
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < N_BINS; i++) {
    const v = expected[i];
    const y = Y(v > 0 ? Math.max(yr[0] - 0.5, Math.log10(v)) : yr[0] - 0.5);
    const xa = X(i * BIN_DEG);
    const xb = X((i + 1) * BIN_DEG);
    if (!started) {
      ctx.moveTo(xa, y);
      started = true;
    } else ctx.lineTo(xa, y);
    ctx.lineTo(xb, y);
  }
  ctx.stroke();
  ctx.restore();

  // 90° marker label and legend
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = colors.fg;
  ctx.fillText('back-scattered →', X(90) + 6, plot.y + 10);
  const lx = plot.x + plot.w - 8;
  const { beyond90 } = state.tally;
  const legend = [
    [colors.accent, 'box', total ? `Monte Carlo: ${fmt(total, 0)} alphas fired` : 'Monte Carlo: none fired yet'],
    [colors.hot, 'box', `beyond 90°: ${fmt(beyond90, 0)}${beyond90 ? ` (1 in ${oneIn(beyond90 / total)})` : ''}`],
    [colors.fg, 'line', `${total ? 'Rutherford prediction' : 'Prediction for 10,000 alphas'}: 1 in ${oneIn(cur.p90)} beyond 90°`],
  ];
  ctx.textAlign = 'right';
  legend.forEach(([col, kind, text], i) => {
    const y = plot.y + 30 + i * 18;
    ctx.fillStyle = colors.fg;
    ctx.fillText(text, lx - 20, y);
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (kind === 'box') ctx.fillRect(lx - 12, y - 5, 12, 10);
    else {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx - 14, y);
      ctx.lineTo(lx, y);
      ctx.stroke();
    }
  });
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  startPaused: true,
  playLabel: () => 'Fire beam',
  colorVars: { atomRgb: '--ruth-atom-rgb', hot: '--ruth-hot', hotRgb: '--ruth-hot-rgb', nucleus: '--ruth-nucleus' },
  onResize: () => { insetCache = null; },
  onScaleChange: () => {
    insetCache = null;
    updateEquations();
    sim.requestDraw();
  },
  debug: {
    state,
    cur,
    model: M,
    fire: (n) => { M.fireMany(n, state.setup, state.tally); state.version++; updateRunReadouts(); sim.requestDraw(); },
    step,
    geometry: () => geometry(sim.width, sim.height, sim.k),
    E1909: E_1909,
  },
});

$('target-select').addEventListener('change', (e) => setTarget(e.target.value));
$('fire-10k').addEventListener('click', fireBurst);
$('fire-1m').addEventListener('click', fireMillion);
$('reset-btn').addEventListener('click', reset);

const setAll = (o) => {
  Object.assign(state, o);
  $('target-select').value = state.target;
  setupChanged();
};
initPresets({
  po210: () => setEnergy(ALPHA_SOURCES.po210.energyMeV),
  rn222: () => setEnergy(ALPHA_SOURCES.rn222.energyMeV),
  po218: () => setEnergy(ALPHA_SOURCES.po218.energyMeV),
  po214: () => setEnergy(ALPHA_SOURCES.po214.energyMeV),
  standard: () => setAll({ E: 5, target: 'gold', t: 1e-6 }),
  breakdown: () => setAll({ E: 9, target: 'aluminium', t: 1e-6 }),
  gm1909: () => setAll({ E: E_1909, target: 'platinum', t: 1e-6 }),
});
for (const btn of document.querySelectorAll('[data-source-label]')) {
  const src = ALPHA_SOURCES[btn.dataset.sourceLabel];
  btn.textContent = `${src.label}, ${fmt(src.energyMeV, 2)} MeV`;
  btn.title = `${src.oldName}; ${src.source}`;
}

/** Fixed figures in the explainer, computed from the cited data (default and historical set-ups). */
function fillExplainer() {
  const gold = PROPS.gold;
  const au = M.scatteringSetup({ E: 5, t: 1e-6, p: gold, z: Z_ALPHA, kMeVm: K });
  const thomson = M.thomsonMaxDeflection(au.dFixed / gold.atomRadius);
  const layers = 1e-6 / gold.dnn;
  const sig90 = M.crossSectionBeyond(M.cmAngle(Math.PI / 2, gold.massRatio), au.d);
  const p90 = M.probabilityBeyond(Math.PI / 2, au);
  const pt = M.scatteringSetup({ E: E_1909, t: 1e-6, p: PROPS.platinum, z: Z_ALPHA, kMeVm: K });
  const touchE = (id) => M.energyToReach(Z_ALPHA, PROPS[id].Z, K, PROPS[id].radius + R_ALPHA, PROPS[id].massRatio);
  const speed = M.speedFraction(5, C.alphaMassMeV);
  const slow = (speed * C_LIGHT * (0.01 / gold.dnn)) / SCREEN_SPEED;
  const values = {
    atomNm: sigT(gold.atomRadius * 1e9, 3),
    thomsonDeg: sigT(thomson / DEG, 1),
    layers: sig(layers, 2),
    thomsonTotal: sigT((thomson * Math.sqrt(layers)) / DEG, 1),
    electronPct: sigT((100 * TARGETS.gold.Z * C.electronMassU) / TARGETS.gold.molarMassG, 2),
    nucleusFm: sigT(gold.radius / FM, 2),
    spacingNm: sigT(gold.dnn * 1e9, 3),
    volFrac: sigWords(1 / ((4 / 3) * Math.PI * gold.radius ** 3 * gold.n), 2),
    nucleusScreen: sigT(2 * gold.radius * (0.01 / gold.dnn) * 1e6, 2),
    dFixed: sigT(au.dFixed / FM, 3),
    dCm: sigT(au.d / FM, 3),
    nucleusFm2: sigT(gold.radius / FM, 2),
    rmsFm: sigT(gold.rmsRadius / FM, 3),
    ratio: sigT(au.d / gold.radius, 2),
    b90: sigT(au.d / 2 / FM, 2),
    theta1pm: sigT(M.deflection(1e-12, au.d) / DEG, 2),
    nGold: sci(gold.n, 3),
    ntGold: sci(au.nt, 3),
    sig90: sig(sig90 / FM ** 2, 3),
    sig90m: sci(sig90, 3),
    p90: sci(p90, 2),
    oneIn90: oneIn(p90),
    oneIn10: oneIn(M.probabilityBeyond(10 * DEG, au)),
    po214: sigT(ALPHA_SOURCES.po214.energyMeV, 3),
    e1909: sigT(E_1909, 2),
    e1909b: sigT(E_1909, 2),
    halfLayer: sigT(HISTORY.gm1909.halfLayerCm * 1e4, 1),
    oneIn1909: oneIn(M.probabilityBeyond(Math.PI / 2, pt)),
    speedPct: sigT(speed * 100, 2),
    eTouchAu: sig(touchE('gold'), 2),
    eTouchAl: sigT(touchE('aluminium'), 1),
    lossAu: sigT(5 - M.energyAfter(TARGETS.gold.range, 5, kgPerM2(1e-6, TARGETS.gold)), 2),
    slowPow: String(Math.floor(Math.log10(slow))),
  };
  for (const [key, text] of Object.entries(values)) {
    for (const el of document.querySelectorAll(`[data-calc="${key}"]`)) el.textContent = text;
  }
  setText($('preset-note'), `The 1909 preset: platinum, polonium-214 ("radium C") alphas after 1 cm of air (${sigT(E_1909, 2)} MeV), 1 µm of metal. A rough check on Geiger and Marsden's figure, explained below.`);
}

derive();
fillExplainer();
params.forEach((q) => q.sync());
sim.start();
updateAll();
