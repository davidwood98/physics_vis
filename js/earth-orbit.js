/**
 * earth-orbit.js: Earth to orbit at the space page's "Earth = 2 cm" scale.
 *
 * One tall canvas, two panels:
 *   left   Earth drawn exactly 2 cm across (the same scale as the space page's
 *          closest zoom stop, so it is calibrated true size), with the ISS, GPS
 *          and geostationary orbits at their true heights and angular speeds,
 *          a ground station turning with the Earth, the user's own satellite,
 *          the Moon as an edge pointer, and a static MAGNIFIED inset of the
 *          surface where the Kármán line and the ISS separate visibly.
 *   right  "Speed, not height": circular and escape speed against height
 *          (log axis), and bars splitting the energy per kg into climb and speed.
 * Labels are static (fixed positions with leader lines); only the satellite
 * dots move. The time rate (real time to 1 hour per second) works like the
 * space page's rate radios, with its own badge.
 *
 * Page pattern (as velocity.js):
 *   1. constants + state
 *   2. setters
 *   3. UI sync (readouts, equations, prose numbers, aria)
 *   4. step
 *   5. draw (world lengths in metres, shrunk by the 2 cm scale, then k = CSS px per metre)
 *   6. wiring + start
 * The physics lives in earth-orbit-model.js (unit tested), the cited values in
 * data/earth-orbit-data.js.
 */

import { TAU, clamp, niceFloor, devicePxPerMetreFromScreen, DEFAULT_SCREEN } from './physics.js';
import { fmt, scaleSourceText, referenceTypical } from './common.js';
import { createSim, bindParam, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawDot, drawTag, drawChart, drawArrowHead, drawRuler, FONT, FONT_BOLD } from './draw.js';
import { EARTH_MOON_DISTANCE, sigT, sig, sci, formatDistance, rateLabel } from './astro.js';
import * as M from './earth-orbit-model.js';
import {
  GM_EARTH, EARTH_MEAN_RADIUS, EARTH_EQUATORIAL_RADIUS, SIDEREAL_DAY, KARMAN_LINE, ISS, GPS,
} from './data/earth-orbit-data.js';
import { PIXEL_REFERENCES } from './data/references.js';

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

/** Time rates, simulated seconds per real second (as the space page's radios). */
const RATES = {
  real: { s: 1, name: '1 second', words: 'real time' },
  min: { s: 60, name: '1 minute', words: '1 minute per second' },
  min10: { s: 600, name: '10 minutes', words: '10 minutes per second' },
  hour: { s: 3600, name: '1 hour', words: '1 hour per second' },
};
const LIMITS = { altMin: 100e3, altMax: 400000e3 }; // the user's satellite, m
const CHART_X = [2, 5.7];                          // log10(height in km): 100 km to 500,000 km
const CHART_Y = [0, 14];                           // km/s (headroom above 11.2 for the tags)
const LABEL_W = 250;                               // static label column right of the rings, px
const MOON = M.orbitFacts(EARTH_MOON_DISTANCE - EARTH_MEAN_RADIUS);
const EARTH_SPIN = TAU / SIDEREAL_DAY;             // rad/s, one turn per sidereal day
const ESCAPE_ENERGY = M.escapeEnergy(GM_EARTH, EARTH_MEAN_RADIUS);
const HAIR = PIXEL_REFERENCES.find((r) => r.id === 'hair');
const FALLBACK_PITCH = 1 / devicePxPerMetreFromScreen(DEFAULT_SCREEN.diagonalIn, DEFAULT_SCREEN.resW, DEFAULT_SCREEN.resH);

/** Starting angles (rad, anticlockwise from the right) so the dots begin apart. */
const PHASE = { iss: 2.4, gps: 0.9, station: 0.5, custom: 4.4 };

const state = {
  simTime: 0,        // simulated seconds since the page opened
  rateId: 'min10',
  alt: 1000e3,       // the user's satellite height above the mean surface, m
};
let custom = M.orbitFacts(state.alt);

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));
const rate = () => RATES[state.rateId].s;

/* ---------- Formatting ---------- */

const km = (m) => `${fmt(m / 1e3, 0)} km`;
const kms = (v) => sigT(v / 1e3, 3);
const MJ = (e) => sigT(e / 1e6, 3);
const pct = (f) => `${fmt(f * 100, 0)}%`;
/** Screen length (m) as text: "0.632 mm", "5.62 cm", "60.3 cm". */
const screenLen = (m) => formatDistance(m, { about: false });

/** Lap time: "92.5 minutes", "11 h 58 min", "29.5 days". */
function lapTime(s) {
  if (s < 7200) return `${sigT(s / 60, 3)} minutes`;
  if (s < 2 * 86400) {
    let h = Math.floor(s / 3600);
    let m = Math.round((s - h * 3600) / 60);
    if (m === 60) { h += 1; m = 0; }
    return `${h} h ${m} min`;
  }
  return `${sigT(s / 86400, 3)} days`;
}

/** On-screen speed (m/s) as text: "0.012 mm/s", "7.22 mm/s", "4.33 cm/s". */
function screenSpeedText(mps) {
  const mm = mps * 1e3;
  if (mm < 10) return `${sigT(mm, mm < 0.1 ? 2 : 3)} mm/s`;
  if (mm < 1000) return `${sigT(mm / 10, 3)} cm/s`;
  return `${sigT(mps, 3)} m/s`;
}

/* =========================================================================
 * 2. Setters
 * ====================================================================== */

function setAltitude(h) {
  state.alt = clamp(h, LIMITS.altMin, LIMITS.altMax);
  custom = M.orbitFacts(state.alt);
  altChanged();
}

function setRate(id) {
  if (!RATES[id]) return;
  state.rateId = id;
  const radio = document.querySelector(`input[name="rate"][value="${id}"]`);
  if (radio) radio.checked = true;
  updateIssReadouts();
  updateRateBadge();
  sim.updateAria();
  sim.requestDraw();
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

const altParam = bindParam({
  range: $('alt-range'), num: $('alt-num'), min: LIMITS.altMin, max: LIMITS.altMax, log: true,
  scale: 1e-3, decimals: 0, words: 'kilometres', get: () => state.alt, set: setAltitude,
});

function altChanged() {
  altParam.sync();
  updateCustomReadouts();
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  announce(`Your satellite at ${km(state.alt)}: ${kms(custom.v)} kilometres per second, one lap in ${lapTime(custom.period)}, ` +
    `escape speed there ${kms(custom.vEsc)} kilometres per second, ${screenLen(custom.screenHeight)} above the 2 centimetre Earth.`);
}

function updateCustomReadouts() {
  const k = sim.k;
  const px = custom.screenHeight * k;
  const split = M.energySplit(GM_EARTH, EARTH_MEAN_RADIUS, state.alt);
  setText(outputs.v, kms(custom.v));
  setText(outputs.vKmh, sig(custom.v * 3.6, 3));
  setText(outputs.T, lapTime(custom.period));
  setText(outputs.vEsc, kms(custom.vEsc));
  setText(outputs.hMm, screenLen(custom.screenHeight));
  setText(outputs.hPx, `${fmt(px, px < 10 ? 1 : 0)} px on this screen${px < 1 ? ', less than one pixel' : ''}`);
  setText(outputs.eTotal, MJ(split.total));
  setText(outputs.eSplit, `${pct(split.heightFraction)} height, ${pct(split.speedFraction)} speed`);
}

function updateIssReadouts() {
  const iss = M.ISS_FACTS;
  const px = iss.screenHeight * sim.k;
  setText(outputs.issV, kms(iss.v));
  setText(outputs.issT, lapTime(iss.period));
  setText(outputs.issMm, sigT(iss.screenHeight * 1e3, 2));
  setText(outputs.issPx, `${fmt(px, 1)} px on this screen`);
  const now = M.screenSpeed(iss.v, rate());
  setText(outputs.issScreen, state.rateId === 'real' ? `${screenSpeedText(now)} in real time` : `${screenSpeedText(now)} at ${RATES[state.rateId].words}`);
  setText(outputs.issScreenSub, `${fmt(now * sim.k, now * sim.k < 10 ? 2 : 0)} px/s · real time: ${screenSpeedText(M.screenSpeed(iss.v))}`);
  setText(outputs.issSplit, `${pct(M.ISS_ENERGY.heightFraction)} height, ${pct(M.ISS_ENERGY.speedFraction)} speed`);
  setText(outputs.issSplitSub, `${MJ(M.ISS_ENERGY.climb)} MJ to climb + ${MJ(M.ISS_ENERGY.kinetic)} MJ of speed, per kg`);
}

/** Live-substituted equations in "The maths" card. */
function updateEquations() {
  const c = custom;
  const split = M.energySplit(GM_EARTH, EARTH_MEAN_RADIUS, state.alt);
  setText(equations.scale, `1 km on screen = ${sigT(M.toScreen(1e3) * 1e3, 3)} mm (1 : ${sig(M.SCALE_RATIO / 1e6, 3)} million)`);
  setText(equations.r, `${fmt(EARTH_MEAN_RADIUS / 1e3, 0)} + ${fmt(state.alt / 1e3, 0)} = ${km(c.r)}`);
  setText(equations.v, `√(3.986 × 10¹⁴ / ${sci(c.r, 4)} m) = ${fmt(c.v, 0)} m/s = ${kms(c.v)} km/s`);
  setText(equations.T, `2π × ${km(c.r)} / ${kms(c.v)} km/s = ${fmt(c.period, 0)} s = ${lapTime(c.period)}`);
  setText(equations.esc, `√2 × ${kms(c.v)} = ${kms(c.vEsc)} km/s (from the surface: ${kms(M.SURFACE_ESCAPE_SPEED)} km/s)`);
  setText(equations.geo, `T = ${fmt(SIDEREAL_DAY, 2)} s → r = ${km(M.GEO_RADIUS)}, ${km(M.GEO_RADIUS)} − ${fmt(EARTH_EQUATORIAL_RADIUS / 1e3, 0)} = ${km(M.GEO_ALTITUDE)} above the equator`);
  setText(equations.climb, `${MJ(split.climb)} MJ per kg (ISS: ${MJ(M.ISS_ENERGY.climb)} MJ)`);
  setText(equations.ke, `${MJ(split.kinetic)} MJ per kg, ${pct(split.speedFraction)} of the total (ISS: ${MJ(M.ISS_ENERGY.kinetic)} MJ, ${pct(M.ISS_ENERGY.speedFraction)})`);
  setText(equations.screen, `${km(state.alt)} → ${screenLen(c.screenHeight)} = ${fmt(c.screenHeight * sim.k, 1)} px at ${fmt(sim.k, 0)} px per metre (${scaleSourceText(sim.scale)})`);
}

/** Numbers in the prose and hint, all computed (data-calc spans). */
function updateProse() {
  const iss = M.ISS_FACTS;
  const issScreen = M.screenSpeed(iss.v);
  const sd = SIDEREAL_DAY;
  const sdH = Math.floor(sd / 3600);
  const sdM = Math.floor((sd - sdH * 3600) / 60);
  const sdS = Math.round(sd - sdH * 3600 - sdM * 60);
  const calc = {
    mmPerKm: `${sigT(M.toScreen(1e3) * 1e3, 2)} mm`,
    karmanMm: `${sigT(M.KARMAN_FACTS.screenHeight * 1e3, 2)} mm`,
    pitchMm: `${sigT(FALLBACK_PITCH * 1e3, 3)} mm`,
    issKm: km(ISS.altitude),
    issMm: `${sigT(iss.screenHeight * 1e3, 2)} mm`,
    gpsCm: `${sigT(M.GPS_FACTS.screenHeight * 100, 2)} cm`,
    geoCm: `${sigT(M.GEO_FACTS.screenHeight * 100, 2)} cm`,
    moonCm: `${fmt(M.toScreen(EARTH_MOON_DISTANCE) * 100, 0)} cm`,
    issV: `${kms(iss.v)} km/s`,
    issT: `${fmt(iss.period / 60, 0)} minutes`,
    climbMJ: `${sigT(M.ISS_ENERGY.climb / 1e6, 2)} MJ`,
    keMJ: `${MJ(M.ISS_ENERGY.kinetic)} MJ`,
    hPct: pct(M.ISS_ENERGY.heightFraction),
    sPct: pct(M.ISS_ENERGY.speedFraction),
    vEsc: `${sigT(M.SURFACE_ESCAPE_SPEED / 1e3, 3)} km/s`,
    issEsc: `${sigT(iss.vEsc / 1e3, 3)} km/s`,
    sidereal: `${sdH} h ${sdM} min ${sdS} s`,
    geoR: km(M.GEO_RADIUS),
    geoAlt: km(M.GEO_ALTITUDE),
    geoV: `${kms(M.GEO_FACTS.v)} km/s`,
    issR: km(iss.r),
    issRm: `${sci(iss.r, 4)}`,
    issVms: `${fmt(iss.v, 0)} m/s`,
    issTs: `${fmt(iss.period, 0)} s`,
    issScreenSpeed: screenSpeedText(issScreen),
    hairS: `${sigT(referenceTypical(HAIR) / issScreen, 2)} s`,
    issSizeNm: `${sigT(M.toScreen(ISS.lengthM) * 1e6, 2)} micrometres`,
    issOct: `${fmt(ISS.octoberPerigee / 1e3, 0)} to ${fmt(ISS.octoberApogee / 1e3, 0)} km`,
  };
  for (const node of document.querySelectorAll('[data-calc]')) {
    const v = calc[node.dataset.calc];
    if (v !== undefined) setText(node, v);
  }
}

function updateRateBadge() {
  const badge = $('rate-badge');
  setText(badge, (sim.paused ? 'PAUSED · ' : '') + rateLabel(rate(), RATES[state.rateId].name));
  badge.classList.toggle('is-slow', rate() !== 1);
}

/** Canvas description for screen readers; updated on input changes, not per frame. */
function describe() {
  const scaleWord = sim.scale.calibrated ? 'calibrated true scale' : 'approximate scale';
  return `Earth drawn 2 centimetres across at ${scaleWord}, seen from above the North Pole. ` +
    `The ISS orbits ${sigT(M.ISS_FACTS.screenHeight * 1e3, 2)} millimetres above the surface, too close to separate without the magnified inset, ` +
    `GPS satellites ${sigT(M.GPS_FACTS.screenHeight * 100, 2)} centimetres out and geostationary satellites ${sigT(M.GEO_FACTS.screenHeight * 100, 2)} centimetres out. ` +
    `The Moon would be ${fmt(M.toScreen(EARTH_MOON_DISTANCE) * 100, 0)} centimetres away, off the canvas. ` +
    `Your satellite at ${km(state.alt)} moves at ${kms(custom.v)} kilometres per second. ` +
    `The chart shows orbital speed falling from ${kms(M.KARMAN_FACTS.v)} kilometres per second at 100 kilometres to ${kms(MOON.v)} at the Moon, with escape speed always 1.41 times higher. ` +
    `Reaching the ISS takes ${pct(M.ISS_ENERGY.heightFraction)} of the energy for height and ${pct(M.ISS_ENERGY.speedFraction)} for speed. ` +
    `Time runs at ${RATES[state.rateId].words}${sim.paused ? ', paused' : ''}.`;
}

/* =========================================================================
 * 4. Step: every orbit turns at its true angular speed
 * ====================================================================== */

function step(simDt) {
  state.simTime += simDt * rate();
}

const angle = (phase, omega) => phase + omega * state.simTime;

/* =========================================================================
 * 5. Drawing (k = CSS px per metre; world lengths shrink by M.SCREEN_PER_WORLD first)
 * ====================================================================== */

function draw(ctx, w, h, k, colors) {
  const L = layout(w, h, k);
  drawEarthPanel(ctx, L.earth, k, colors);
  drawChartPanel(ctx, L.chart, k, colors);
  // Panel divider
  ctx.strokeStyle = colors.track;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (L.wide) {
    ctx.moveTo(L.earth.x1 + 0.5, 16);
    ctx.lineTo(L.earth.x1 + 0.5, h - 16);
  } else {
    ctx.moveTo(16, L.earth.y1 + 0.5);
    ctx.lineTo(w - 16, L.earth.y1 + 0.5);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  updateRateBadge();
}

/** Earth panel on the left (wide canvases) or on top (narrow ones); the chart takes the rest. */
function layout(w, h, k) {
  const rGeo = M.GEO_FACTS.screenRadius * k;
  const wide = w >= 820 && w >= 1.2 * h;
  if (wide) {
    const ew = Math.round(clamp(2 * rGeo + LABEL_W + 80, w * 0.42, w * 0.6));
    return { wide, earth: { x0: 0, y0: 0, x1: ew, y1: h }, chart: { x0: ew, y0: 0, x1: w, y1: h } };
  }
  const eh = Math.round(clamp(2 * rGeo + 120, h * 0.45, h * 0.62));
  return { wide, earth: { x0: 0, y0: 0, x1: w, y1: eh }, chart: { x0: 0, y0: eh, x1: w, y1: h } };
}

function drawEarthPanel(ctx, P, k, colors) {
  const pw = P.x1 - P.x0;
  const ph = P.y1 - P.y0;
  const R = M.toScreen(EARTH_MEAN_RADIUS) * k; // 1 cm
  const rIss = M.ISS_FACTS.screenRadius * k;
  const rGps = M.GPS_FACTS.screenRadius * k;
  const rGeo = M.GEO_FACTS.screenRadius * k;
  const rMine = custom.screenRadius * k;
  const labelW = Math.min(LABEL_W, pw * 0.36);
  const cx = P.x0 + clamp((pw - labelW) / 2, R + 24, pw - labelW - R - 24);
  const cy = P.y0 + ph * 0.56;

  ctx.save();
  ctx.beginPath();
  ctx.rect(P.x0, P.y0, pw, ph);
  ctx.clip();

  // Orbits (static rings)
  ring(ctx, cx, cy, rGeo, colors.geo, 1.5);
  ring(ctx, cx, cy, rGps, colors.gps, 1.5);
  ring(ctx, cx, cy, rIss, colors.fg, 1);
  ring(ctx, cx, cy, rMine, colors.accent, 1.5, [6, 5]);

  // Earth, 2 cm across, and a ground station on the equator turning with it
  drawDot(ctx, cx, cy, R, colors.earth);
  ctx.strokeStyle = colors.earthEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();
  const aStation = angle(PHASE.station, EARTH_SPIN);
  const sx = cx + (R - 3) * Math.cos(aStation);
  const sy = cy - (R - 3) * Math.sin(aStation);
  // GEO satellite stays over the station: same phase, same angular speed
  const aGeo = angle(PHASE.station, M.GEO_FACTS.omega);
  const gx = cx + rGeo * Math.cos(aGeo);
  const gy = cy - rGeo * Math.sin(aGeo);
  ctx.strokeStyle = colors.geo;
  ctx.globalAlpha = 0.45;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(gx, gy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  drawDot(ctx, sx, sy, 2.5, colors.bg);

  // Satellites (dots, not to scale)
  sat(ctx, cx, cy, rGps, angle(PHASE.gps, M.GPS_FACTS.omega), 4, colors.gps);
  sat(ctx, cx, cy, rGeo, aGeo, 4, colors.geo);
  sat(ctx, cx, cy, rMine, angle(PHASE.custom, custom.omega), 3.5, colors.accent);
  sat(ctx, cx, cy, rIss, angle(PHASE.iss, M.ISS_FACTS.omega), 2.5, colors.fg);

  // True-scale ruler under the rings
  const rulerY = cy + rGeo + 24;
  const rulerLen = Math.floor(M.GEO_FACTS.screenRadius * 2 * 100) / 100;
  if (rulerY + 30 < P.y1 && rulerLen > 0) {
    drawRuler(ctx, colors, { x: cx - rGeo, y: rulerY, lengthM: rulerLen, k });
    ctx.fillStyle = colors.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = FONT;
    ctx.fillText('cm, true scale', cx - rGeo + rulerLen * k + 10, rulerY + 12);
  }

  // Static labels with leader lines
  const lx = Math.min(cx + rGeo + 22, P.x1 - labelW + 6);
  const sp = Math.max(rGeo, 150); // label spacing: never closer than the text blocks need
  const labels = [
    { y: cy - sp * 0.78, a: 0.62, r: rGeo, color: colors.geo,
      lines: ['Geostationary orbit', `${km(M.GEO_ALTITUDE)} above the equator`, `${screenLen(M.GEO_FACTS.screenHeight)} up here, a lap a day`] },
    { y: cy - sp * 0.36, a: 0.3, r: rGps, color: colors.gps,
      lines: ['GPS satellites', `about ${km(GPS.altitude)} up`, `${screenLen(M.GPS_FACTS.screenHeight)} up here, ${lapTime(M.GPS_FACTS.period)} a lap`] },
  ];
  for (const l of labels) leaderLabel(ctx, colors, cx + l.r * Math.cos(l.a), cy - l.r * Math.sin(l.a), lx, l.y, l.lines, l.color, P);

  // Your satellite: leader to its ring if the anchor is on the panel, otherwise an edge arrow
  const aMine = -0.42;
  const mineLines = ['Your satellite', `${km(state.alt)} up, ${kms(custom.v)} km/s`, `${screenLen(custom.screenHeight)} up here`, `a lap in ${lapTime(custom.period)}`];
  const ax = cx + rMine * Math.cos(aMine);
  const ay = cy - rMine * Math.sin(aMine);
  const myY = cy + sp * 0.5;
  if (ax < P.x1 - 4 && ay < P.y1 - 4) {
    leaderLabel(ctx, colors, ax, ay, lx, myY, mineLines, colors.accent, P);
  } else {
    edgeArrow(ctx, cx, cy, aMine, P, colors.accent);
    textBlock(ctx, colors, lx, myY, [...mineLines.slice(0, 2), `${screenLen(custom.screenRadius)} from Earth's centre: off the canvas`], colors.accent);
  }

  // The Moon: off the canvas, an arrow to the edge (static direction: straight right)
  const moonPx = M.toScreen(EARTH_MOON_DISTANCE) * k;
  const moonLines = ['The Moon →', `${screenLen(M.toScreen(EARTH_MOON_DISTANCE))} from Earth's centre`];
  if (cx + moonPx < P.x1 - 10) {
    ring(ctx, cx, cy, moonPx, colors.muted, 1, [2, 4]);
    textBlock(ctx, colors, lx, cy + 8, moonLines, colors.fg);
  } else {
    edgeArrow(ctx, cx + rGeo + 6, cy, 0, P, colors.muted, true);
    textBlock(ctx, colors, lx, cy + 8, [...moonLines, `${fmt(moonPx, 0)} px: off the canvas`], colors.fg);
  }

  // Earth label just below the planet
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Earth, 2 cm', cx, cy + R + 8);

  // Magnified inset of the surface, linked to the true-size Earth
  const insetW = clamp(pw * 0.36, 230, 360);
  const insetH = clamp(ph * 0.26, 150, 240);
  const box = { x: P.x0 + 14, y: P.y0 + 44, w: insetW, h: insetH };
  drawInset(ctx, colors, box, cx, cy, R, k);

  if (sim.scale.calibrated) drawTag(ctx, 'TRUE SIZE · Earth = 2 cm', P.x0 + 14, P.y0 + 22, { color: colors.ok, background: colors.okBg });
  else drawTag(ctx, 'APPROXIMATE SIZE · Earth ≈ 2 cm: calibrate for true size', P.x0 + 14, P.y0 + 22, { color: colors.warn, background: colors.warnBg });
  ctx.restore();
}

/** A full circle, optionally dashed. */
function ring(ctx, cx, cy, r, color, width, dash = []) {
  if (!(r > 0)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Satellite dot on a ring at angle a (maths angle: anticlockwise, y up). */
function sat(ctx, cx, cy, r, a, size, color) {
  drawDot(ctx, cx + r * Math.cos(a), cy - r * Math.sin(a), size, color);
}

/** Bold first line, muted others, left-aligned at (x, y) = top of the block. */
function textBlock(ctx, colors, x, y, lines, color) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = i === 0 ? FONT_BOLD : FONT;
    ctx.fillStyle = i === 0 ? color : colors.muted;
    ctx.fillText(t, x, y + i * 15);
  });
}

/** Leader line from a point on a ring to a static label block. */
function leaderLabel(ctx, colors, px, py, lx, ly, lines, color, P) {
  const top = clamp(ly - 8, P.y0 + 44, P.y1 - 50);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(lx - 6, top + 7);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawDot(ctx, px, py, 2, color);
  textBlock(ctx, colors, lx, top, lines, color);
}

/** Dashed line from (x, y) towards angle a, ending in an arrowhead at the panel edge. Returns the tip. */
function edgeArrow(ctx, x, y, a, P, color, fromHere = false) {
  const ux = Math.cos(a);
  const uy = -Math.sin(a);
  const margin = 10;
  const tx = ux > 0 ? (P.x1 - margin - x) / ux : ux < 0 ? (P.x0 + margin - x) / ux : Infinity;
  const ty = uy > 0 ? (P.y1 - margin - y) / uy : uy < 0 ? (P.y0 + margin - y) / uy : Infinity;
  const t = Math.min(tx, ty);
  const ex = x + ux * t;
  const ey = y + uy * t;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(fromHere ? x : ex - ux * 60, fromHere ? y : ey - uy * 60);
  ctx.lineTo(ex - ux * 8, ey - uy * 8);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrowHead(ctx, ex, ey, ux, uy, 10);
  return { x: ex, y: ey };
}

/**
 * Static MAGNIFIED inset: the top of the Earth's surface magnified so the
 * Kármán line and the ISS orbit separate; a small box on the true-size Earth
 * marks the magnified region and leader lines join the two.
 */
function drawInset(ctx, colors, box, cx, cy, R, k) {
  const ground = 30;                             // px of Earth at the bottom of the inset
  const groundY = box.y + box.h - ground;
  const issPx = M.ISS_FACTS.screenHeight * k;    // ISS height at true size, px
  const room = box.h - ground - 40;
  const mag = Math.max(2, niceFloor((room * 0.85) / issPx));
  const bcx = box.x + box.w / 2;
  const top = cy - R;                            // top of the true-size Earth

  // Region shown, on the true-size Earth, and the leader lines to the inset
  const rx0 = cx - box.w / (2 * mag);
  const rx1 = cx + box.w / (2 * mag);
  const ry0 = top - (groundY - box.y) / mag;
  const ry1 = top + ground / mag;
  ctx.strokeStyle = colors.warn;
  ctx.lineWidth = 1;
  ctx.strokeRect(rx0 - 1, ry0 - 1, rx1 - rx0 + 2, ry1 - ry0 + 2);
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(rx0 - 1, ry0 - 1);
  ctx.lineTo(box.x, box.y + box.h);
  ctx.moveTo(rx1 + 1, ry0 - 1);
  ctx.lineTo(box.x + box.w, box.y + box.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = colors.bg;
  ctx.fill();
  ctx.clip();

  // Surface and heights, all × mag, centred on the top of the Earth
  const Rm = R * mag;
  const ecy = groundY + Rm;
  ctx.fillStyle = colors.earth;
  ctx.beginPath();
  ctx.arc(bcx, ecy, Rm, 0, TAU);
  ctx.fill();
  const arcY = (r, x) => ecy - Math.sqrt(Math.max(0, r * r - (x - bcx) * (x - bcx)));
  const heights = [
    { h: KARMAN_LINE, color: colors.muted, dash: [5, 4], text: `Kármán line, 100 km: ${sigT(M.KARMAN_FACTS.screenHeight * 1e3, 2)} mm` },
    { h: ISS.altitude, color: colors.fg, dash: [], text: `ISS, about ${km(ISS.altitude)}: ${sigT(M.ISS_FACTS.screenHeight * 1e3, 2)} mm` },
  ];
  const hPx = (h) => M.toScreen(h) * k * mag; // height above the ground in the inset, px
  const minePx = hPx(state.alt);
  if (minePx < groundY - box.y - 6) {
    // Label it only where it would not sit on another label
    const clear = heights.every((s) => Math.abs(hPx(s.h) - minePx) > 18);
    heights.push({ h: state.alt, color: colors.accent, dash: [6, 5], text: clear ? 'your satellite' : '', mine: true });
  }
  ctx.font = FONT;
  for (const s of heights) {
    const r = R * mag + hPx(s.h);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(s.dash);
    ctx.beginPath();
    ctx.arc(bcx, ecy, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!s.text) continue;
    // Text sits above the arc over its whole width (the arc is highest nearest the centre)
    const tw = ctx.measureText(s.text).width;
    const x0 = box.x + box.w - 8 - tw;
    const yText = arcY(r, clamp(bcx, x0, x0 + tw)) - 4;
    ctx.fillStyle = s.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    if (yText - 12 > box.y + 28) ctx.fillText(s.text, x0, yText); // clear of the MAGNIFIED tag
  }
  ctx.restore();

  ctx.strokeStyle = colors.warn;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  drawTag(ctx, `MAGNIFIED ×${mag}`, box.x + 8, box.y + 16, { color: colors.warn, background: colors.warnBg, height: 20 });
}

/* ---------- Chart panel: speed, not height ---------- */

function drawChartPanel(ctx, P, k, colors) {
  const pw = P.x1 - P.x0;
  const ph = P.y1 - P.y0;
  const top = 66;
  const barsH = ph >= top + 74 + 140 + 196 ? 196 : 0; // energy bars only when there is room (they are in the readouts too)
  const box = { x: P.x0 + 66, y: P.y0 + top, w: Math.max(120, pw - 66 - 30), h: 0 };
  box.h = clamp(ph - top - 74 - barsH, 140, ph * 0.62);
  const toX = (h) => Math.log10(h / 1e3);
  const speedAt = (h, esc) => (esc ? M.escapeSpeed : M.circularSpeed)(GM_EARTH, EARTH_MEAN_RADIUS + h) / 1e3;
  const pts = (esc) => {
    const out = [];
    for (let i = 0; i <= 160; i++) {
      const x = CHART_X[0] + ((CHART_X[1] - CHART_X[0]) * i) / 160;
      out.push([x, speedAt(10 ** x * 1e3, esc)]);
    }
    return out;
  };

  // Heading and legend above the plot, clear of the time badge at the top right
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const heading = 'Speed, not height: what it takes to stay up, and to leave';
  if (ctx.measureText(heading).width < pw - 66 - 270) ctx.fillText(heading, box.x, P.y0 + 20);
  legendLine(ctx, colors, box.x, P.y0 + 47, colors.accent, [], pw > 640 ? 'circular orbit speed √(GM / r)' : 'orbit √(GM / r)');
  legendLine(ctx, colors, box.x + (pw > 640 ? 240 : 140), P.y0 + 47, colors.ref, [7, 5], pw > 640 ? 'escape speed √(2GM / r)' : 'escape √(2GM / r)');

  const { X, Y } = drawChart(ctx, colors, {
    box, xr: CHART_X, yr: CHART_Y, xTicks: 4, yTicks: 7,
    title: '', xLabel: '',
    xFmt: (v) => `${fmt(10 ** v, 0)} km`,
    series: [
      { points: pts(true), color: colors.ref, width: 2, dash: [7, 5] },
      { points: pts(false), color: colors.accent, width: 2.5 },
    ],
    marker: toX(state.alt),
  });

  // Escape from the surface: a dotted guide at its value
  const yEsc = Y(M.SURFACE_ESCAPE_SPEED / 1e3);
  ctx.save();
  ctx.strokeStyle = colors.ref;
  ctx.globalAlpha = 0.6;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(box.x, yEsc);
  ctx.lineTo(box.x + box.w, yEsc);
  ctx.stroke();
  ctx.restore();
  drawDot(ctx, box.x, yEsc, 4, colors.ref);
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.ref;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`Escape from the surface: ${kms(M.SURFACE_ESCAPE_SPEED)} km/s`, box.x + box.w - 6, yEsc - 4);

  // Named orbits on the circular-speed curve
  // The curves fall to the right, so the empty space is below-left of each point (under the curve).
  const marks = [
    { name: 'ISS', h: ISS.altitude, color: colors.fg, dx: 6, dy: 18, align: 'left' },
    { name: 'GPS', h: GPS.altitude, color: colors.gps, dx: -10, dy: 14, align: 'right' },
    { name: 'Geostationary', h: M.GEO_FACTS.altitude, color: colors.geo, dx: -10, dy: 18, align: 'right' },
    { name: 'Moon', h: MOON.altitude, color: colors.fg, dx: -8, dy: 16, align: 'right' },
  ];
  for (const m of marks) {
    const x = X(toX(m.h));
    const v = speedAt(m.h, false);
    const y = Y(v);
    drawDot(ctx, x, y, 4.5, m.color);
    ctx.font = FONT_BOLD;
    ctx.fillStyle = m.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = m.align;
    ctx.fillText(`${m.name} ${sigT(v, 3)} km/s`, x + m.dx, y + m.dy);
  }

  // Your satellite on both curves
  const xm = X(toX(state.alt));
  const vo = speedAt(state.alt, false);
  const ve = speedAt(state.alt, true);
  drawDot(ctx, xm, Y(vo), 5, colors.accent);
  drawDot(ctx, xm, Y(ve), 5, colors.ref);
  // Static tag in the empty band above 11.2 km/s
  drawTag(ctx, `Your satellite (dotted line): ${sigT(vo, 3)} km/s to orbit, ${sigT(ve, 3)} km/s to escape`, box.x + 10,
    box.y + 14, { color: colors.fg, background: colors.bg, border: colors.accent });

  // Axis names
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('km/s', box.x - 6, box.y - 6);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('height above the surface (log scale)', box.x + box.w / 2, box.y + box.h + 22);

  if (barsH) drawEnergyBars(ctx, colors, { x: box.x, y: box.y + box.h + 66, w: box.w, h: barsH });
}

function legendLine(ctx, colors, x, y, color, dash, text) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 26, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = FONT;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 32, y);
}

/** Energy per kg: climb (height) and kinetic (speed), on a common scale up to escape. */
function drawEnergyBars(ctx, colors, A) {
  const mine = M.energySplit(GM_EARTH, EARTH_MEAN_RADIUS, state.alt);
  const bars = [
    { label: `Reach the ISS (about ${km(ISS.altitude)})`, s: M.ISS_ENERGY },
    { label: `Reach your satellite's orbit (${km(state.alt)})`, s: mine },
    { label: 'Escape from Earth (all of it is climbing out)', s: { climb: ESCAPE_ENERGY, kinetic: 0, total: ESCAPE_ENERGY, heightFraction: 1, speedFraction: 0 } },
  ];
  ctx.font = FONT_BOLD;
  ctx.fillStyle = colors.fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Energy per kg to get there: height or speed? (no air, Earth\'s spin ignored)', A.x, A.y - 4);
  // Legend
  const ly = A.y + 12;
  ctx.fillStyle = colors.ref;
  ctx.fillRect(A.x, ly - 6, 12, 12);
  ctx.font = FONT;
  ctx.fillStyle = colors.fg;
  ctx.textBaseline = 'middle';
  ctx.fillText('climb (height)', A.x + 18, ly);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(A.x + 130, ly - 6, 12, 12);
  ctx.fillStyle = colors.fg;
  ctx.fillText('speed (kinetic energy)', A.x + 148, ly);

  const scale = A.w / ESCAPE_ENERGY;
  bars.forEach((b, i) => {
    const y = A.y + 34 + i * 52;
    const wClimb = b.s.climb * scale;
    const wKin = b.s.kinetic * scale;
    ctx.font = FONT;
    ctx.fillStyle = colors.fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const share = b.s.kinetic > 0 ? `: ${pct(b.s.heightFraction)} height, ${pct(b.s.speedFraction)} speed` : '';
    ctx.fillText(`${b.label}${share} · ${MJ(b.s.total)} MJ`, A.x, y + 14);
    ctx.fillStyle = colors.ref;
    ctx.fillRect(A.x, y + 18, Math.max(1, wClimb), 18);
    ctx.fillStyle = colors.accent;
    ctx.fillRect(A.x + wClimb, y + 18, wKin, 18);
    ctx.font = FONT_BOLD;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.bg;
    ctx.textAlign = 'center';
    if (wClimb > 44) ctx.fillText(pct(b.s.heightFraction), A.x + wClimb / 2, y + 27.5);
    if (wKin > 44) ctx.fillText(pct(b.s.speedFraction), A.x + wClimb + wKin / 2, y + 27.5);
  });
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  colorVars: { earth: '--orbit-earth', earthEdge: '--orbit-earth-edge', geo: '--orbit-geo', gps: '--orbit-gps' },
  onScaleChange: () => {
    updateCustomReadouts();
    updateIssReadouts();
    updateEquations();
  },
  debug: { state, M, get custom() { return custom; }, layout, setAltitude, setRate },
});

for (const radio of document.querySelectorAll('input[name="rate"]')) {
  radio.addEventListener('change', () => {
    setRate(radio.value);
    announce(`Time rate: ${RATES[state.rateId].words}.`);
  });
}

initPresets({
  karman: () => setAltitude(KARMAN_LINE),
  iss: () => setAltitude(ISS.altitude),
  gps: () => setAltitude(GPS.altitude),
  geo: () => setAltitude(M.GEO_FACTS.altitude),
  moon: () => setAltitude(MOON.altitude),
});

altParam.sync();
updateCustomReadouts();
updateIssReadouts();
updateEquations();
updateProse();
sim.start();
updateRateBadge();
