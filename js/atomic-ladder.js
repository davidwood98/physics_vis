/**
 * atomic-ladder.js: the atomic scale ladder, an on-rails log zoom from one
 * true-size pixel of the visitor's calibrated screen down to the quark-size limit.
 *
 * The view's single state is the scale: metres of the world per DEVICE pixel
 * (mpp). At the first stop mpp = the physical pixel pitch, so the drawing is
 * TRUE SIZE 1:1; every other zoom is badged MAGNIFIED ×(pitch / mpp). Objects
 * (pixel, hair, red blood cell, E. coli, a virus, DNA, a gold atom, its nucleus,
 * a proton, the quark-size limit) stand in a line at their true sizes for the
 * current scale (atomic-model.js ladderLayout); the gold nucleus sits at the
 * centre of its atom. Quarks and electrons have no measured size: markers only.
 *
 * Navigation reuses the space page's rail (solar.js, galactic view): places to
 * visit, +/− and arrow keys, the wheel, a range slider, and astro.js's
 * railLengths / railSFromLength / railLengthFromS / easeInOutCubic / railDuration
 * and metresPerPx / tFromMetresPerPx. Between two stops the scale is log-linear
 * and the camera zooms about the one world point that stays still on screen, so
 * the next object glides to the centre without overshooting.
 *
 * Page pattern (as velocity.js / solar.js):
 *   1. constants + state   2. world, rail and camera   3. UI sync (readouts, maths, aria)
 *   4. animate (rail motion)   5. draw   6. wiring + start
 * Drawing is in CSS px; sc = CSS px per world metre = 1 / (devicePixelRatio × mpp).
 */

import * as A from './astro.js';
import * as M from './atomic-model.js';
import { LATTICES, LIMITS } from './data/atomic-data.js';
import { fmt, scaleSourceText, prefersReducedMotion } from './common.js';
import { createSim, setText, createAnnouncer } from './simkit.js';
import { drawTag, withAlpha, FONT, FONT_BOLD } from './draw.js';

const { clamp, TAU, sig, sigT, sigWords } = A;

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));
const canvas = $('sim-canvas');
const tipEl = $('ladder-tip');
const hudEl = $('travel-hud');
const factEl = $('fact');

const LABEL_MIN_PX = 14;   // objects at least this big get a name tag
const MARK_PX = 9;         // radius of a marker ring
const HUGE_PX = 2e4;       // beyond this radius, discs are drawn without gradients/arcs
const CLOUD_ALPHA = 0.5;
const SI = LATTICES.Si;

const state = {
  rail: { s: 0, anim: null, goal: null },  // position along the stops (fractional index)
  mpp: M.DEFAULT_PITCH,                    // metres per device pixel (set by applyRail)
  cam: { x: 0, y: 0 },                     // world point at the canvas centre (m)
  zoomT: 1,                                // 1 at the true-size pixel, 0 at the last stop
  hover: null,                             // pointer position (CSS px) for the tooltip
  hits: [],                                // hover/click targets from the last draw
  factId: null,                            // object shown in the fact line
};

/* =========================================================================
 * 2. World, rail and camera
 * ====================================================================== */

const dpr = () => sim.view?.dpr || window.devicePixelRatio || 1;
/** Physical size of one device pixel on this screen (m). */
const pitch = () => 1 / (sim.k * dpr());
const shortDev = () => Math.max(1, Math.min(sim.view?.width || 1200, sim.view?.height || 700) * dpr());

let world = { key: '', objs: [], by: {}, stops: [], L: [0] };
/** Objects, their positions and the stops: rebuilt when the pixel size or the canvas changes. */
function ensureWorld() {
  const key = `${pitch()}|${shortDev()}`;
  if (world.key !== key) {
    const objs = M.ladderLayout(pitch());
    const stops = M.ladderStops(objs, pitch(), shortDev());
    world = {
      key, objs, stops,
      by: Object.fromEntries(objs.map((o) => [o.id, o])),
      L: A.railLengths(stops.map((s) => s.log), { minSeg: 0.6 }),
    };
  }
  return world;
}

/** Zoom limits for astro.js's log-zoom helpers: far = the true pixel, near = the last stop. */
function zoomLimits() {
  const { stops } = ensureWorld();
  return { near: 10 ** stops[stops.length - 1].log, far: pitch() };
}

/** Scale and camera from the rail position (atomic-model.js ladderView: log-linear scale, fixed-point zoom). */
function applyRail() {
  const v = M.ladderView(ensureWorld().stops, state.rail.s, pitch());
  state.mpp = v.mpp;
  state.zoomT = v.t;
  state.cam = v.cam;
}

const nearestStop = () => Math.round(clamp(state.rail.s, 0, ensureWorld().stops.length - 1));

/** Animate along the rail to stop j (eased, through the stops in between). Instant for reduced motion. */
function railGo(j) {
  const { L, stops } = ensureWorld();
  const to = clamp(j, 0, stops.length - 1);
  const fromLen = A.railLengthFromS(L, state.rail.s);
  const toLen = L[to];
  state.rail.goal = null;
  if (Math.abs(toLen - fromLen) < 1e-6) {
    showFact(stops[to].id);
    return;
  }
  if (prefersReducedMotion()) {
    state.rail.anim = null;
    state.rail.s = to;
    arrived();
  } else {
    state.rail.anim = { fromLen, toLen, to, start: performance.now(), dur: A.railDuration(Math.abs(toLen - fromLen)), label: stops[to].label };
    announce(`Going to ${stops[to].label}.`);
  }
  sim.requestDraw();
}
function railStep(dir) {
  const s = state.rail.anim ? state.rail.anim.to : state.rail.s;
  railGo(dir > 0 ? Math.floor(s + 1e-6) + 1 : Math.ceil(s - 1e-6) - 1);
}

function arrived() {
  const st = ensureWorld().stops[nearestStop()];
  showFact(st.id);
  panelsDue = true;
  announce(describe());
}

/* =========================================================================
 * 3. UI sync: readouts, maths, fact line, pixel card, aria
 * ====================================================================== */

let panelsDue = true;
let panelTime = 0;
function throttledPanels() {
  const now = performance.now();
  if (!panelsDue && now - panelTime < 200) return;
  panelTime = now;
  panelsDue = false;
  updateReadouts();
  updateEquations();
  updatePixelLine();
  updateRailUi();
  sim.updateAria();
}

function atomsText(mpp) {
  const n = M.siliconAtomsPerPixel(mpp);
  return n >= 1 ? `${sigWords(n, 3)} silicon ${n < 1.5 ? 'atom' : 'atoms'} per pixel` : `one silicon atom spans ${sigWords(1 / n, 3)} pixels`;
}

function updateReadouts() {
  const { mpp } = state;
  const p = pitch();
  const nearest = ensureWorld().by[ensureWorld().stops[nearestStop()].id];
  const lim = zoomLimits();
  const total = A.zoomDecades(lim);
  setText(outputs.pxIs, M.formatLength(mpp));
  setText(outputs.pxSub, `true pixel size ${M.formatLength(p)} (${scaleSourceText(sim.scale)})`);
  setText(outputs.mag, isTrueSize() ? 'TRUE SIZE 1:1' : M.magnificationText(M.ladderMagnification(mpp, p)));
  setText(outputs.magSub, `${fmt((1 - state.zoomT) * total, 1)} of ${fmt(total, 1)} powers of ten down`);
  const wDev = (screen.width || sim.width) * dpr();
  setText(outputs.span, M.formatLength(wDev * mpp));
  setText(outputs.spanSub, `${fmt(wDev, 0)} pixels across`);
  setText(outputs.atoms1, sigWords(M.siliconAtomsPerPixel(p), 3));
  setText(outputs.atoms1Sub, `a row at their average spacing a/2 = ${M.formatLength(M.meanSpacing(SI))} in a silicon crystal`);
  setText(outputs.atomsNow, atomsText(mpp));
  setText(outputs.atomsNowSub, `1 pixel = ${M.formatLength(mpp)}`);
  setText(outputs.nearName, nearest.name);
  setText(outputs.nearSize, `${nearest.noSize ? 'under ' : ''}${M.formatLength(nearest.size)}`);
  setText(outputs.nearSub, `${M.formatPx(nearest.size / mpp, 2)} on your screen at this zoom`);
}

function updateEquations() {
  const { mpp } = state;
  const p = pitch();
  const { stops, by } = ensureWorld();
  const near = by[stops[nearestStop()].id];
  const s = clamp(state.rail.s, 0, stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(s));
  setText(equations.pitch, `1 / ${fmt(1 / p, 0)} px per m = ${M.formatLength(p)} (${scaleSourceText(sim.scale)})`);
  setText(equations.mag, `${M.formatLength(p)} / ${M.formatLength(mpp)} = ${isTrueSize() ? '1 (true size)' : M.magnificationText(p / mpp)}`);
  setText(equations.size, `${near.name}: ${M.formatLength(near.size)} / ${M.formatLength(mpp)} = ${M.formatPx(near.size / mpp, 3)}`);
  setText(equations.atoms, `${M.formatLength(mpp)} × 2 / ${M.formatLength(SI.a, 7)} = ${sig(M.siliconAtomsPerPixel(mpp), 3)} atoms`);
  setText(equations.rail, `${stops[i].label} → ${stops[i + 1].label}: f = ${fmt(s - i, 2)}, log₁₀(m per px) = ${fmt(Math.log10(mpp), 2)}`);
}

let pixelLineText = '';
function updatePixelLine() {
  const p = pitch();
  const text = isTrueSize()
    ? `At true size one pixel (${M.formatLength(p)}) spans about ${sigWords(M.siliconAtomsPerPixel(p), 3)} silicon atoms.`
    : `At this zoom one screen pixel (${M.formatLength(p)}) shows ${M.formatLength(state.mpp)} of the world: ${atomsText(state.mpp)}.`;
  if (text !== pixelLineText) {
    pixelLineText = text;
    sim.pixelCard?.update();
  }
}

const railRange = $('rail-range');
function updateRailUi() {
  const { L, stops } = ensureWorld();
  const total = L[L.length - 1] || 1;
  if (document.activeElement !== railRange) railRange.value = String(Math.round((A.railLengthFromS(L, state.rail.s) / total) * 1000));
  const k = nearestStop();
  railRange.setAttribute('aria-valuetext', `Near ${stops[k].label}; 1 pixel = ${M.formatLength(state.mpp)}`);
  const at = Math.abs(state.rail.s - k) < 0.02;
  for (const b of document.querySelectorAll('[data-stop]')) {
    const on = at && Number(b.dataset.stop) === k;
    b.classList.toggle('is-current', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

function showFact(id) {
  const o = ensureWorld().by[id];
  if (!o) return;
  state.factId = id;
  factEl.textContent = '';
  const b = document.createElement('strong');
  b.textContent = `${o.name}: `;
  const span = document.createElement('span');
  span.textContent = `${o.fact} `;
  const src = document.createElement('span');
  src.className = 'muted';
  src.textContent = `Source: ${o.source}.`;
  factEl.append(b, span, src);
}

const isTrueSize = () => state.rail.s <= 1e-9;

function describe() {
  const { stops } = ensureWorld();
  const st = stops[nearestStop()];
  const mag = isTrueSize() ? 'true size, 1:1' : `magnified ${M.magnificationText(M.ladderMagnification(state.mpp, pitch())).replace('×', '')} times`;
  return `Atomic scale ladder, near ${st.label}: one screen pixel shows ${M.formatLength(state.mpp)} of the world (${mag}); ${atomsText(state.mpp)}. Objects are drawn at their true size for this zoom.`;
}

/* =========================================================================
 * 4. Animate: rail motion (runs whether or not the sim is "paused")
 * ====================================================================== */

function animate(dt) {
  const rail = state.rail;
  const now = performance.now();
  if (rail.anim) {
    const { L } = ensureWorld();
    const tau = clamp((now - rail.anim.start) / (rail.anim.dur * 1000), 0, 1);
    const len = rail.anim.fromLen + (rail.anim.toLen - rail.anim.fromLen) * A.easeInOutCubic(tau);
    rail.s = tau >= 1 ? rail.anim.to : A.railSFromLength(L, len);
    panelsDue = true;
    if (tau >= 1) {
      rail.anim = null;
      arrived();
    }
    return true;
  }
  if (rail.goal !== null) {
    const { L } = ensureWorld();
    const cur = A.railLengthFromS(L, rail.s);
    const next = cur + (rail.goal - cur) * (1 - Math.exp(-dt / 0.18));
    const done = Math.abs(rail.goal - next) < 1e-4;
    rail.s = A.railSFromLength(L, done ? rail.goal : next);
    if (done) rail.goal = null;
    panelsDue = true;
    return true;
  }
  return false;
}

/* =========================================================================
 * 5. Drawing (CSS px)
 * ====================================================================== */

let C = {};      // colours for this frame
let V = null;    // view for this frame: { w, h, cx, cy, sc, rect }
const placed = [];

function draw(ctx, w, h) {
  applyRail();
  C = sim.colors;
  const d = dpr();
  // Centre on a device-pixel centre, so the true-size pixel is exactly one device pixel.
  const cx = (Math.floor((w * d) / 2) + 0.5) / d;
  const cy = (Math.floor((h * d) / 2) + 0.5) / d;
  V = { w, h, cx, cy, sc: 1 / (d * state.mpp), rect: { x0: -4, y0: -4, x1: w + 4, y1: h + 4 } };
  state.hits = [];
  placed.length = 0;
  placed.push({ x0: 0, y0: 0, x1: 560, y1: 62 }); // the badge and the scale readout (drawOverlay)

  const { objs } = ensureWorld();
  for (const o of objs) drawObject(ctx, o);
  drawMarkers(ctx, objs);
  drawLabels(ctx, objs);
  drawOverlay(ctx);
  updateHud();
  if (state.hover) updateTooltip();
  throttledPanels();
}

const toX = (x) => V.cx + (x - state.cam.x) * V.sc;
const toY = (y) => V.cy - (y - state.cam.y) * V.sc;

/** Screen box of an object (CSS px); vertical strands (hair, DNA) run the full height. */
function screenBox(o) {
  const X = toX(o.x);
  const Y = toY(o.y);
  const hw = (o.w / 2) * V.sc;
  const hh = o.kind === 'hair' ? Infinity : (((o.h ?? o.w) / 2) * V.sc) * (o.kind === 'cloud' ? 1.7 : 1);
  const ex = o.kind === 'cloud' ? hw * 1.7 : hw;
  return { X, Y, hw, hh, x0: X - ex, x1: X + ex, y0: Y - hh, y1: Y + hh, sizePx: o.size * V.sc };
}
const onScreen = (b) => b.x1 >= -2 && b.x0 <= V.w + 2 && b.y1 >= -2 && b.y0 <= V.h + 2;

function clipRect(x0, y0, x1, y1) {
  return { x0: Math.max(x0, -4), y0: Math.max(y0, -4), x1: Math.min(x1, V.w + 4), y1: Math.min(y1, V.h + 4) };
}

/** A sub-pixel object: one device pixel as bright as the share of it the object would cover. */
function truePixel(ctx, X, Y, sizeCss, colour) {
  const d = dpr();
  const a = A.trueSizeAlpha(sizeCss * d);
  if (a <= 0.003) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.fillStyle = colour;
  ctx.fillRect(Math.floor(X * d) / d, Math.floor(Y * d) / d, 1 / d, 1 / d);
  ctx.restore();
}

/** Fill a disc of any radius (huge ones as a clipped polygon). */
function discPath(ctx, X, Y, r) {
  ctx.beginPath();
  if (r < HUGE_PX) {
    ctx.arc(X, Y, r, 0, TAU);
    return true;
  }
  const pts = A.discRectPolygon(X, Y, r, V.rect);
  if (pts.length < 3) return false;
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  return true;
}

/** Dashed circle of any radius (huge ones only where they cross the view). */
function dashedCircle(ctx, X, Y, r, colour, dash = [5, 4]) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.2;
  ctx.setLineDash(dash);
  ctx.beginPath();
  if (r < 5000) ctx.arc(X, Y, r, 0, TAU);
  else {
    for (const [a0, a1] of A.clipArcToViewport(X, Y, r, V.rect)) {
      const n = clamp(Math.ceil(((a1 - a0) * r) / 6), 8, 1500);
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        const x = X + r * Math.cos(a);
        const y = Y + r * Math.sin(a);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawObject(ctx, o) {
  const b = screenBox(o);
  if (!onScreen(b)) return;
  switch (o.kind) {
    case 'pixel': drawPixel(ctx, o, b); break;
    case 'hair': drawStrandBand(ctx, o, b); break;
    case 'rbc': drawCell(ctx, o, b); break;
    case 'rod': drawRod(ctx, o, b); break;
    case 'virus': drawVirus(ctx, o, b); break;
    case 'dna': drawDna(ctx, o, b); break;
    case 'cloud': drawCloud(ctx, o, b); break;
    case 'nucleus': drawBall(ctx, o, b, C.nucleus, 0.85); break;
    case 'proton': drawBall(ctx, o, b, C.proton, 0.55); drawQuarkMarkers(ctx, o, b); break;
    case 'limit': drawLimit(ctx, o, b); break;
    default: break;
  }
  if (b.sizePx >= 4) {
    const r = clipRect(b.x0, Math.max(b.y0, -4), b.x1, Math.min(b.y1, V.h + 4));
    state.hits.push({ id: o.id, ...r, area: (r.x1 - r.x0) * (r.y1 - r.y0) });
  }
}

function drawPixel(ctx, o, b) {
  const side = o.size * V.sc;
  const devSide = side * dpr();
  if (devSide < 2.5) {
    if (devSide >= 0.999) {
      ctx.fillStyle = C.fg;
      ctx.fillRect(b.X - side / 2, b.Y - side / 2, side, side);
    } else truePixel(ctx, b.X, b.Y, side, C.fg);
    return;
  }
  const x0 = b.X - side / 2;
  const y0 = b.Y - side / 2;
  const r = clipRect(x0, y0, x0 + side, y0 + side);
  ctx.save();
  ctx.fillStyle = withAlpha(C.gapRgb, 0.5);  // the dark gaps between sub-pixels
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  [C.subR, C.subG, C.subB].forEach((rgb, i) => {
    const sx0 = x0 + (i * side) / 3 + side * 0.03;
    const s = clipRect(sx0, y0 + side * 0.04, sx0 + side * 0.27, y0 + side * 0.96);
    if (s.x1 <= s.x0 || s.y1 <= s.y0) return;
    ctx.fillStyle = withAlpha(rgb, 0.75);
    ctx.fillRect(s.x0, s.y0, s.x1 - s.x0, s.y1 - s.y0);
  });
  ctx.strokeStyle = C.fg;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, r.y1 - r.y0 - 1);
  ctx.restore();
}

/** A hair: a long strand (drawn vertical) shaded like a cylinder. */
function drawStrandBand(ctx, o, b) {
  if (b.hw * 2 * dpr() < 1) {
    truePixelColumn(ctx, b.X, b.hw * 2, C.hair);
    return;
  }
  const r = clipRect(b.X - b.hw, -4, b.X + b.hw, V.h + 4);
  if (r.x1 <= r.x0) return;
  const g = ctx.createLinearGradient(b.X - b.hw, 0, b.X + b.hw, 0);
  g.addColorStop(0, withAlpha(C.hair, 0.85));
  g.addColorStop(0.3, withAlpha(C.hair, 0.55));
  g.addColorStop(0.5, withAlpha(C.hair, 0.45));
  g.addColorStop(0.7, withAlpha(C.hair, 0.55));
  g.addColorStop(1, withAlpha(C.hair, 0.85));
  ctx.fillStyle = b.hw < HUGE_PX ? g : withAlpha(C.hair, 0.5);
  ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
}

/** A vertical line narrower than a device pixel, as bright as its share of the pixel. */
function truePixelColumn(ctx, X, widthCss, rgb) {
  const d = dpr();
  const a = clamp(widthCss * d, 0, 1);
  if (a <= 0.01) return;
  ctx.fillStyle = withAlpha(rgb, 0.85 * a);
  ctx.fillRect(Math.floor(X * d) / d, 0, 1 / d, V.h);
}

/** A red blood cell: a disc with a paler middle (biconcave). */
function drawCell(ctx, o, b) {
  const r = b.hw;
  if (r * 2 * dpr() < 2) {
    truePixel(ctx, b.X, b.Y, r * 2, withAlpha(C.rbc, 1));
    return;
  }
  if (!discPath(ctx, b.X, b.Y, r)) return;
  if (r < HUGE_PX) {
    const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, r);
    g.addColorStop(0, withAlpha(C.rbc, 0.3));
    g.addColorStop(0.45, withAlpha(C.rbc, 0.42));
    g.addColorStop(0.8, withAlpha(C.rbc, 0.75));
    g.addColorStop(1, withAlpha(C.rbc, 0.85));
    ctx.fillStyle = g;
  } else ctx.fillStyle = withAlpha(C.rbc, 0.4);
  ctx.fill();
}

/** E. coli: a rod with rounded ends. */
function drawRod(ctx, o, b) {
  const L = o.w * V.sc;
  const D = o.h * V.sc;
  if (L * dpr() < 2) {
    truePixel(ctx, b.X, b.Y, Math.sqrt(L * D), withAlpha(C.ecoli, 1));
    return;
  }
  if (L > 1e6) return;
  ctx.beginPath();
  ctx.roundRect(b.X - L / 2, b.Y - D / 2, L, D, D / 2);
  ctx.fillStyle = withAlpha(C.ecoli, 0.45);
  ctx.fill();
  ctx.strokeStyle = withAlpha(C.ecoli, 0.95);
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** A virus particle with spikes (the number of spikes is illustrative). */
function drawVirus(ctx, o, b) {
  const r = (o.size / 2) * V.sc;
  const spike = o.spike * V.sc;
  if (r * 2 * dpr() < 2) {
    truePixel(ctx, b.X, b.Y, r * 2, withAlpha(C.virus, 1));
    return;
  }
  if (r > 1e6) return;
  ctx.save();
  ctx.strokeStyle = withAlpha(C.virus, 0.9);
  ctx.fillStyle = withAlpha(C.virus, 0.9);
  ctx.lineWidth = Math.max(1, spike * 0.18);
  if (spike >= 1.5) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(b.X + ux * r, b.Y + uy * r);
      ctx.lineTo(b.X + ux * (r + spike * 0.75), b.Y + uy * (r + spike * 0.75));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.X + ux * (r + spike * 0.8), b.Y + uy * (r + spike * 0.8), spike * 0.22, 0, TAU);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(b.X, b.Y, r, 0, TAU);
  ctx.fillStyle = withAlpha(C.virus, 0.35);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** DNA: a vertical double helix, 2 nm wide, one turn per 3.6 nm, a rung per base pair. */
function drawDna(ctx, o, b) {
  const half = b.hw;
  const top = Math.max(-4, b.Y - b.hh);
  const bottom = Math.min(V.h + 4, b.Y + b.hh);
  if (half * 2 * dpr() < 1.5) {
    if (b.hh * 2 * dpr() >= 1) {
      ctx.fillStyle = withAlpha(C.dna, 0.85 * clamp(half * 2 * dpr(), 0, 1));
      ctx.fillRect(Math.floor(b.X * dpr()) / dpr(), top, 1 / dpr(), bottom - top);
    } else truePixel(ctx, b.X, b.Y, Math.sqrt(half * 2 * b.hh * 2), withAlpha(C.dna, 1));
    return;
  }
  if (half > 1e6) return;
  const turnPx = o.turn * V.sc;
  const risePx = o.rise * V.sc;
  const yWorld = (Y) => state.cam.y + (V.cy - Y) / V.sc;
  const phase = (Y) => (TAU * yWorld(Y)) / o.turn;
  ctx.save();
  // Rungs (base pairs) when they are far enough apart to see.
  if (risePx >= 3) {
    ctx.strokeStyle = withAlpha(C.dna, 0.45);
    ctx.lineWidth = Math.max(1, Math.min(4, risePx * 0.25));
    const k0 = Math.ceil(yWorld(bottom) / o.rise);
    const k1 = Math.floor(yWorld(top) / o.rise);
    if (k1 - k0 < 4000) {
      ctx.beginPath();
      for (let k = k0; k <= k1; k++) {
        const Y = toY(k * o.rise);
        const p = (TAU * k * o.rise) / o.turn;
        ctx.moveTo(b.X + half * Math.sin(p), Y);
        ctx.lineTo(b.X + half * Math.sin(p + Math.PI), Y);
      }
      ctx.stroke();
    }
  }
  // The two backbones.
  const step = clamp(turnPx / 40, 1, 4);
  ctx.strokeStyle = withAlpha(C.dna, 0.95);
  ctx.lineWidth = clamp(half * 0.12, 1.2, 6);
  for (const off of [0, Math.PI]) {
    ctx.beginPath();
    for (let Y = top, i = 0; Y <= bottom + step / 2; Y += step, i++) {
      const x = b.X + half * Math.sin(phase(Y) + off);
      if (i) ctx.lineTo(x, Y);
      else ctx.moveTo(x, Y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** The gold atom's electron cloud: radial density (as on the atom page), edge dashed. */
function drawCloud(ctx, o, b) {
  const R = (o.size / 2) * V.sc;
  if (R * 2 * dpr() < 2) {
    truePixel(ctx, b.X, b.Y, R * 2, withAlpha(C.cloud, 1));
    return;
  }
  const bright = (r) => CLOUD_ALPHA * M.cloudBrightness(M.cloudRelativeDensity(r, R));
  if (1.7 * R < HUGE_PX) {
    const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, 1.7 * R);
    for (let i = 0; i <= 14; i++) g.addColorStop(i / 14, withAlpha(C.cloud, bright((1.7 * R * i) / 14)));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.X, b.Y, 1.7 * R, 0, TAU);
    ctx.fill();
  } else {
    // Far bigger than the view: the density barely changes across it.
    const r = Math.hypot(V.cx - b.X, V.cy - b.Y);
    if (r < 1.7 * R) {
      ctx.fillStyle = withAlpha(C.cloud, bright(r));
      ctx.fillRect(0, 0, V.w, V.h);
    }
  }
  dashedCircle(ctx, b.X, b.Y, R, C.fg);
}

/** A fuzzy ball (nucleus, proton) of diameter 2 × rms radius, edge dashed. */
function drawBall(ctx, o, b, rgb, alpha) {
  const r = (o.size / 2) * V.sc;
  if (r * 2 * dpr() < 2) {
    truePixel(ctx, b.X, b.Y, r * 2, withAlpha(rgb, 1));
    return;
  }
  if (1.3 * r < HUGE_PX) {
    const g = ctx.createRadialGradient(b.X, b.Y, 0, b.X, b.Y, 1.3 * r);
    g.addColorStop(0, withAlpha(rgb, alpha));
    g.addColorStop(0.55, withAlpha(rgb, alpha * 0.85));
    g.addColorStop(0.77, withAlpha(rgb, alpha * 0.45));
    g.addColorStop(1, withAlpha(rgb, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.X, b.Y, 1.3 * r, 0, TAU);
    ctx.fill();
  } else if (Math.hypot(V.cx - b.X, V.cy - b.Y) < r) {
    ctx.fillStyle = withAlpha(rgb, alpha * 0.8);
    ctx.fillRect(0, 0, V.w, V.h);
  }
  dashedCircle(ctx, b.X, b.Y, r, C.fg);
}

/** Positions (in proton diameters from its centre) of the three quark markers: the first is the limit's centre. */
const QUARK_SPOTS = [M.QUARK_MARK, { x: 0.2, y: 0.18 }, { x: 0.04, y: -0.25 }];
function drawQuarkMarkers(ctx, o, b) {
  const dp = o.size * V.sc;
  if (dp < 60) return;
  for (const q of QUARK_SPOTS) marker(ctx, b.X + q.x * dp, b.Y - q.y * dp, C.fg);
  if (dp < 2000) {
    const q = QUARK_SPOTS[1];
    const x = b.X + q.x * dp;
    const y = b.Y - q.y * dp;
    labelAt(ctx, `Quarks (markers only): no measured size, under ${M.formatLength(M.QUARK_LIMIT_DIAMETER)} across if any`, x + 14, y - 26, { leader: [x + 6, y - 6], id: 'quark' });
  }
}

/** A ring marker (not a size); dot = false leaves the centre clear so what it rings stays visible. */
function marker(ctx, x, y, colour, r = MARK_PX, dot = true) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  if (dot) {
    ctx.fillStyle = colour;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  ctx.restore();
}

/** The quark-size limit: a dashed circle a quark, if it has any size, must fit inside. */
function drawLimit(ctx, o, b) {
  const r = (o.size / 2) * V.sc;
  if (r < 2) return;
  dashedCircle(ctx, b.X, b.Y, r, C.warn, [6, 4]);
  if (r > 20) marker(ctx, b.X, b.Y, C.fg, 6);
  if (r > 40) labelAt(ctx, 'If a quark has any size at all, it fits inside this circle (95% confidence). The marker is not a size.', b.X, b.Y + r + 22, { center: true, id: o.id, muted: true });
}

/** Markers for things too small to see: the next object down, and the electron in the atom. */
function drawMarkers(ctx, objs) {
  // The biggest object that is under LABEL_MIN_PX but on screen gets a ring and a label.
  let next = null;
  for (const o of objs) {
    const b = screenBox(o);
    if (o.id === 'pixel' && isTrueSize()) continue; // ringed by the overlay instead
    if (b.sizePx >= LABEL_MIN_PX || b.X < 0 || b.X > V.w || b.Y < 0 || b.Y > V.h) continue;
    if (!next || o.size > next.o.size) next = { o, b };
  }
  if (next) {
    const { o, b } = next;
    marker(ctx, b.X, b.Y, C.accent, MARK_PX, false);
    const what = o.noSize ? `under ${M.formatLength(o.size)}` : M.formatLength(o.size);
    const text = `${o.name}: ${what}, ${M.formatPx(b.sizePx * dpr(), 2)} here`;
    labelAt(ctx, text, b.X + 14, b.Y + 26, { leader: [b.X + MARK_PX * 0.7, b.Y + MARK_PX * 0.7], id: o.id, colour: C.accent });
  }
  // The electron: inside the gold atom's cloud, as a marker only.
  const atom = ensureWorld().by.atom;
  const R = (atom.size / 2) * V.sc;
  if (R >= 90 && R < 6000) {
    const x = toX(atom.x) + 0.45 * R;
    const y = toY(atom.y) - 0.32 * R;
    if (x > 0 && x < V.w && y > 0 && y < V.h) {
      marker(ctx, x, y, C.fg, 6);
      const d = M.ELECTRON_LIMIT_DIAMETER;
      labelAt(ctx, `Electron (marker only): no measured size, under ${M.formatLength(d, 2)} across if any`, x + 12, y - 20, { leader: [x + 5, y - 4], id: 'electron' });
    }
  }
}

/** Name tags for the objects big enough to see. */
function drawLabels(ctx, objs) {
  for (const o of objs) {
    const b = screenBox(o);
    if (!onScreen(b) || b.sizePx < LABEL_MIN_PX) continue;
    const size = o.noSize ? `under ${M.formatLength(o.size)}` : M.formatLength(o.size);
    const covers = b.x0 <= 0 && b.x1 >= V.w && b.y0 <= 0 && b.y1 >= V.h;
    if (covers) {
      const inside = o.kind === 'cloud' ? `Inside the ${o.name.toLowerCase()}'s electron cloud` : `Inside the ${o.name.toLowerCase()}`;
      labelAt(ctx, `${inside} (${size} across)`, V.w / 2, V.h - 46, { center: true, id: o.id, muted: true });
      continue;
    }
    const y = o.kind === 'hair' ? 64 : clamp(b.Y - b.hh * (o.kind === 'cloud' ? 1 / 1.7 : 1) - 16, 64, V.h - 60);
    const x = clamp(b.X, 0, V.w);
    labelAt(ctx, `${o.name} · ${size}`, x, y, { center: true, id: o.id });
  }
}

/** A tag that avoids earlier tags (moves down), kept inside the canvas. */
function labelAt(ctx, text, x, y, { center = false, leader = null, id = null, colour = null, muted = false } = {}) {
  ctx.save();
  ctx.font = FONT_BOLD;
  const tw = ctx.measureText(text).width + 16;
  let left = center ? x - tw / 2 : x;
  left = clamp(left, 8, Math.max(8, V.w - tw - 8));
  let cy = clamp(y, 14, V.h - 14);
  for (let i = 0; i < 8; i++) {
    const r = { x0: left, y0: cy - 11, x1: left + tw, y1: cy + 11 };
    if (!placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) break;
    cy += 26;
  }
  placed.push({ x0: left, y0: cy - 11, x1: left + tw, y1: cy + 11 });
  if (leader) {
    ctx.strokeStyle = colour || C.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(leader[0], leader[1]);
    ctx.lineTo(left, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  drawTag(ctx, text, left, cy, { color: muted ? C.muted : colour || C.fg, background: C.bg, border: C.track });
  if (id) state.hits.push({ id, x0: left, y0: cy - 11, x1: left + tw, y1: cy + 11, area: 0, tag: true });
  ctx.restore();
}

function drawOverlay(ctx) {
  const p = pitch();
  const trueSize = isTrueSize();
  drawTag(ctx, trueSize ? 'TRUE SIZE 1:1' : `MAGNIFIED ${M.magnificationText(M.ladderMagnification(state.mpp, p))}`, 12, 20, trueSize ? { color: C.ok, background: C.okBg } : { color: C.warn, background: C.warnBg });
  drawTag(ctx, `1 screen pixel = ${M.formatLength(state.mpp)} · ${atomsText(state.mpp)}`, 12, 46, { color: C.fg, background: C.bg, border: C.track, font: FONT });
  if (trueSize) {
    // At 1:1 the pixel is one device pixel: ring it so it can be found.
    const X = toX(ensureWorld().by.pixel.x);
    const Y = toY(ensureWorld().by.pixel.y);
    marker(ctx, X, Y, C.accent, 12, false);
    labelAt(ctx, `One pixel of your screen at true size: ${M.formatLength(p)}`, X + 18, Y - 30, { leader: [X + 9, Y - 9], id: 'pixel', colour: C.accent });
    labelAt(ctx, 'Everything on this journey, down to a quark, is smaller than this pixel. Press + to zoom in.', X + 18, Y + 56, { muted: true });
  }
  // Scale bar (bottom left).
  const maxCss = Math.min(220, V.w * 0.3);
  const bar = M.scaleBar(maxCss / V.sc);
  const px = bar.metres * V.sc;
  const x = 14;
  const y = V.h - 16;
  ctx.save();
  ctx.strokeStyle = C.fg;
  ctx.fillStyle = C.fg;
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
  ctx.restore();
}

function updateHud() {
  const anim = state.rail.anim;
  hudEl.hidden = !anim;
  if (anim) setText(hudEl, `Travelling to ${anim.label} · 1 pixel = ${M.formatLength(state.mpp)}`);
}

/* ---------- Tooltip ---------- */

function hitAt(x, y) {
  let best = null;
  for (const h of state.hits) {
    if (x < h.x0 || x > h.x1 || y < h.y0 || y > h.y1) continue;
    if (!best || h.tag || (!best.tag && h.area < best.area)) best = h;
  }
  return best;
}

function objectFor(id) {
  if (id === 'electron') {
    return { name: 'Electron', size: M.ELECTRON_LIMIT_DIAMETER, noSize: true,
      fact: `No measured size: point-like in every experiment so far. If it has a size, its radius is under ${A.sci(LIMITS.electronRadius, 2)} m. In an atom it is spread through the cloud, so this marker only shows where to look.`,
      source: LIMITS.electronSource };
  }
  return ensureWorld().by[id];
}

function updateTooltip() {
  const h = state.hover && hitAt(state.hover.x, state.hover.y);
  const o = h && objectFor(h.id);
  if (!o) {
    tipEl.hidden = true;
    return;
  }
  tipEl.textContent = '';
  const t = document.createElement('strong');
  t.textContent = o.name;
  const s1 = document.createElement('span');
  s1.textContent = `${o.noSize ? 'Under ' : 'True size '}${M.formatLength(o.size)}; ${M.formatPx((o.size / state.mpp), 3)} on your screen now`;
  const s2 = document.createElement('span');
  s2.textContent = o.fact;
  const s3 = document.createElement('span');
  s3.textContent = `Source: ${o.source}`;
  tipEl.append(t, s1, s2, s3);
  tipEl.hidden = false;
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  tipEl.style.left = `${clamp(state.hover.x + 14, 8, V.w - tw - 8)}px`;
  tipEl.style.top = `${clamp(state.hover.y + 14, 8, V.h - th - 8)}px`;
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

// Nothing on this page moves with time (only the camera, through animate), so the
// loop stays paused and redraws only on changes; Space keeps its usual job.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.stopPropagation();
}, true);

const sim = createSim({
  startPaused: true,
  step: () => {},
  draw,
  describe,
  animate,
  colorVars: {
    gapRgb: '--ladder-gap',
    subR: '--ladder-sub-r', subG: '--ladder-sub-g', subB: '--ladder-sub-b',
    hair: '--ladder-hair', rbc: '--ladder-rbc', ecoli: '--ladder-ecoli', virus: '--ladder-virus',
    dna: '--ladder-dna', cloud: '--ladder-cloud', nucleus: '--ladder-nucleus', proton: '--ladder-proton',
  },
  onResize: () => {
    panelsDue = true;
    fillExplainer();
  },
  onScaleChange: () => {
    panelsDue = true;
    fillExplainer();
  },
  pixelLine: () => pixelLineText,
  debug: {
    state, ensureWorld, applyRail, railGo, railStep, M, A,
    get pitch() { return pitch(); },
    /** Jump to rail position s (no animation) and draw synchronously. */
    jump(s) {
      state.rail.anim = null;
      state.rail.goal = null;
      state.rail.s = s;
      panelsDue = true;
      if (Number.isInteger(s)) showFact(ensureWorld().stops[s].id);
      const v = sim.view;
      v.ctx.clearRect(0, 0, v.width, v.height);
      draw(v.ctx, v.width, v.height);
      return { mpp: state.mpp, cam: state.cam };
    },
  },
});

/* Places to visit */
const stopsEl = $('rail-stops');
M.ladderStops(M.ladderLayout(M.DEFAULT_PITCH), M.DEFAULT_PITCH, 1000).forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-small stop-btn';
  b.dataset.stop = String(i);
  b.textContent = s.label;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => railGo(i));
  stopsEl.append(b);
});
$('rail-in').addEventListener('click', () => railStep(1));
$('rail-out').addEventListener('click', () => railStep(-1));
railRange.addEventListener('input', () => {
  state.rail.anim = null;
  state.rail.goal = null;
  const { L } = ensureWorld();
  state.rail.s = A.railSFromLength(L, (Number(railRange.value) / 1000) * L[L.length - 1]);
  panelsDue = true;
  sim.requestDraw();
});
railRange.addEventListener('change', arrived);

/* Wheel: scroll up (or pinch out) to zoom in, i.e. further down the ladder. */
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
  const decades = -clamp(e.deltaY * unit, -400, 400) * 0.0025;
  const { L } = ensureWorld();
  state.rail.anim = null;
  state.rail.goal = clamp((state.rail.goal ?? A.railLengthFromS(L, state.rail.s)) + decades, 0, L[L.length - 1]);
}, { passive: false });
canvas.addEventListener('dblclick', (e) => {
  e.preventDefault();
  railStep(1);
});

/* Pointer: hover for the tooltip, click/tap for the fact line, pinch to zoom. */
const pointers = new Map();
let pinch = null;
let moved = 0;
const localPoint = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    if (e.pointerType === 'mouse') {
      state.hover = localPoint(e);
      updateTooltip();
    }
    return;
  }
  moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > 0) {
      const { L } = ensureWorld();
      state.rail.anim = null;
      state.rail.goal = null;
      state.rail.s = A.railSFromLength(L, clamp(A.railLengthFromS(L, state.rail.s) + Math.log10(dist / pinch), 0, L[L.length - 1]));
      panelsDue = true;
      sim.requestDraw();
    }
    pinch = dist;
  }
});
function endPointer(e) {
  const tap = pointers.size === 1 && moved <= 4;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (tap && e.type === 'pointerup') {
    const p = localPoint(e);
    const h = hitAt(p.x, p.y);
    if (h) {
      const o = objectFor(h.id);
      if (h.id === 'electron') {
        factEl.textContent = `${o.name}: ${o.fact} Source: ${o.source}.`;
      } else showFact(h.id);
    } else if (e.pointerType !== 'mouse') {
      state.hover = p;
      updateTooltip();
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !pointers.size) {
    state.hover = null;
    tipEl.hidden = true;
  }
});

/* Keyboard: + / − and the left / right arrows step between places. */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t?.closest?.('dialog') || t?.matches?.('input, select, textarea, [contenteditable]')) return;
  if (e.key === '+' || e.key === '=' || e.key === 'ArrowRight') {
    e.preventDefault();
    railStep(1);
  } else if (e.key === '-' || e.key === '_' || e.key === 'ArrowLeft') {
    e.preventDefault();
    railStep(-1);
  }
});

/* Explainer numbers, computed from the data (no hand-typed figures). */
function fillExplainer() {
  const set = (key, text, html = false) => {
    for (const n of document.querySelectorAll(`[data-calc="${key}"]`)) {
      if (html) n.innerHTML = text;
      else n.textContent = text;
    }
  };
  const supHtml = (x) => {
    let p = Math.floor(Math.log10(x));
    let m = Number((x / 10 ** p).toPrecision(2));
    if (m >= 10) {
      m /= 10;
      p += 1;
    }
    return `${sigT(m, 2)} × 10<sup>${String(p).replace('-', '−')}</sup>`;
  };
  const P = M.DEFAULT_PITCH;
  const objs = M.ladderLayout(P);
  const by = Object.fromEntries(objs.map((o) => [o.id, o]));
  set('pitchMm', sigT(P * 1e3, 3));
  set('hairUm', sigT(by.hair.size * 1e6, 2));
  set('hairRatio', fmt(P / by.hair.size, 0));
  set('siSpacing', sigT(M.meanSpacing(SI) * 1e12, 3));
  set('siA', sigT(SI.a * 1e12, 4));
  set('atoms24', sigWords(M.siliconAtomsPerPixel(P), 3));
  set('auAtom', M.formatLength(by.atom.size));
  set('auNuc', M.formatLength(by.nucleus.size));
  set('auRatio', sig(by.atom.size / by.nucleus.size, 3));
  set('proton', M.formatLength(by.proton.size));
  set('eLimit', supHtml(LIMITS.electronRadius), true);
  set('qLimit', supHtml(LIMITS.quarkRadius), true);
  if (sim.view) set('decades', fmt(A.zoomDecades(zoomLimits()), 0));
  set('belowDec', fmt(Math.log10(P / M.QUARK_LIMIT_DIAMETER), 0));
  set('aboveDec', fmt(Math.log10(A.MILKY_WAY_DIAMETER / P), 0));
}

sim.start();
fillExplainer();
showFact('pixel');
panelsDue = true;
sim.pixelCard?.update();
