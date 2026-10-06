/**
 * solar.js: the space simulator page, three views on one canvas.
 *
 *   system    "Solar system": Neptune's orbit fitted to the canvas (so the scale is set by
 *             your screen size: largest in full screen), ecliptic from above. Zoom in
 *             towards a focus body (the Sun unless you click another body).
 *   earth     "Earth = 1 pixel": metresPerPx = Earth's diameter, camera locked to Earth,
 *             fly to the Sun or Mars, follow a light pulse.
 *   milkyway  "Galactic scale": an on-rails log zoom through a list of places, from Earth
 *             2 cm across (t = 0) to the Milky Way as 1 pixel (t = 1), then on to the
 *             nearby clusters at that scale. Opens at the Milky Way = 1 pixel stop.
 *
 * Page pattern (as the other sims):
 *   1. data, constants, state
 *   2. scene: positions at the sim time, the camera frame of each view
 *   3. drawing helpers (safe for circles millions of pixels across), backgrounds
 *   4. the three views and their layers
 *   5. overlays: labels, edge pointers, hit targets, tooltip, info card
 *   6. camera: solar-system zoom + focus, Earth-view travel + follow, galactic rail
 *   7. readouts, scale equivalents, pixel-card line, aria
 *   8. wiring + start
 * The scale model, orbits, coordinate frames and formatting live in astro.js
 * (unit tested); pictures in space-art.js; info cards in space-info.js.
 * Positions are doubles in metres, made camera-relative before scaling to
 * pixels; pixel positions are never rounded.
 */

import * as A from './astro.js';
import { PLANETS, MOON, ASTEROID_BELT_AU } from './data/bodies.js';
import { MARKERS, HELIOPAUSE, OORT_CLOUD, OBSERVABLE_EDGE } from './data/markers.js';
import { ARMS, BAR } from './data/milkyway.js';
import { fmt, scaleBadge, referenceLadder, smallLength } from './common.js';
import { createSim, initTabs, setText, createAnnouncer } from './simkit.js';
import { FONT, FONT_BOLD } from './draw.js';
import { starfieldTile, buildMilkyWay, galaxyKind, galaxySprite, galaxyPose } from './space-art.js';
import { infoFor, renderInfoCard } from './space-info.js';

const {
  AU, LIGHT_YEAR, PARSEC, KILOPARSEC, MEGAPARSEC, DAY, JULIAN_YEAR, C_LIGHT, TAU, clamp,
  SUN_DIAMETER, EARTH_DIAMETER, EARTH_MOON_DISTANCE, MOON_SIDEREAL_DAYS, NEPTUNE_A_AU,
  SUN_TO_GALACTIC_CENTRE, MILKY_WAY_DIAMETER, OBSERVABLE_UNIVERSE_RADIUS, OBSERVABLE_UNIVERSE_DIAMETER,
  formatDistance, formatWorldLength, travelHint, lightTime, sig, sigWords,
} = A;

/* =========================================================================
 * 1. Data, constants, state
 * ====================================================================== */

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const announce = createAnnouncer($('sr-summary'));
const wrapEl = $('space-wrap');
const canvas = $('sim-canvas');

async function loadJson(path) {
  const res = await fetch(new URL(path, import.meta.url));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

let starsJson = { rows: [] };
let galJson = { rows: [], limitMpc: 11 };
let moonsJson = { rows: [] };
try {
  [starsJson, galJson, moonsJson] = await Promise.all([
    loadJson('./data/stars.json'), loadJson('./data/galaxies.json'), loadJson('./data/moons.json'),
  ]);
} catch (err) {
  // Only happens when the page isn't served over http(s) (e.g. opened from disk).
  $('sim-hint').textContent = `Couldn't load the star, galaxy and moon data (${err.message}). Serve the site with a local web server.`;
}

/** Time rates, simulated seconds per real second. */
const RATES = {
  real: { s: 1, name: '1 second' },
  min: { s: 60, name: '1 minute' },
  hour: { s: 3600, name: '1 hour' },
  day: { s: DAY, name: '1 day' },
  week: { s: 7 * DAY, name: '1 week' },
  month: { s: JULIAN_YEAR / 12, name: '1 month' },
  year: { s: JULIAN_YEAR, name: '1 year' },
  '10y': { s: 10 * JULIAN_YEAR, name: '10 years' },
  '1ky': { s: 1e3 * JULIAN_YEAR, name: '1,000 years' },
  '10ky': { s: 1e4 * JULIAN_YEAR, name: '10,000 years' },
  '100ky': { s: 1e5 * JULIAN_YEAR, name: '100,000 years' },
  '1my': { s: 1e6 * JULIAN_YEAR, name: '1,000,000 years' },
};
const VIEW_RATES = {
  system: ['real', 'hour', 'day', 'week', 'month', 'year', '10y'],
  earth: ['real', 'min', 'hour', 'day', 'week', 'month', 'year', '10y'],
  milkyway: Object.keys(RATES),
};

const ZERO = [0, 0, 0];
const scaleV = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const addV = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subV = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lenV = (v) => Math.hypot(v[0], v[1], v[2]);
const ECL_TO_EQ = A.transpose(A.EQ_TO_ECL);
const eclToEq = (p) => A.mulMV(ECL_TO_EQ, [p.x, p.y, 0]);

/* ---------- Sun, planets, Earth's Moon ---------- */

const PLANET_COLOURS = {
  mercury: '#b9b4ab', venus: '#e8cf96', earth: '#4ba3ff', mars: '#e0714f',
  jupiter: '#d9b38c', saturn: '#e6d29a', uranus: '#9fe3e8', neptune: '#6b8cff',
};
const MOON_COLOUR = '#cfd2d6';
const NEPTUNE = PLANETS.find((p) => p.id === 'neptune');
const EARTH_EL = PLANETS.find((p) => p.id === 'earth');
const PERIOD = Object.fromEntries(PLANETS.map((p) => [p.id, A.periodFromLdot(p.Ldot)]));
const MOON_PERIOD = MOON_SIDEREAL_DAYS * DAY;
const MOON_DIAMETER = MOON.diameterKm * 1e3;
const planetDiameter = (p) => (p.id === 'earth' ? EARTH_DIAMETER : p.diameterKm * 1e3);
const PLANET_BY_ID = Object.fromEntries(PLANETS.map((p) => [p.id, p]));

let bodyCache = { t: NaN };
/** Heliocentric ecliptic positions (m) of the planets and Earth's Moon at sim time t. */
function bodiesAt(t) {
  if (bodyCache.t === t) return bodyCache;
  const pos = {};
  for (const p of PLANETS) pos[p.id] = A.planetPosition(p, t);
  bodyCache = { t, pos, moon: A.moonPosition(t, pos.earth) };
  return bodyCache;
}

/* ---------- Moons of the other planets (JPL) ---------- */

const MOONS = moonsJson.rows.map(([planet, name, code, , epoch, aKm, e, wDeg, mDeg, iDeg, nodeDeg, periodDays, radiusKm, density]) => {
  const el = A.satelliteElements({ aKm, e, wDeg, mDeg, iDeg, nodeDeg, periodDays, epoch });
  return {
    id: `moon-${code}`, name, planet, el, ell: A.satelliteEllipse(el), radiusM: radiusKm ? radiusKm * 1e3 : null,
    major: Boolean(radiusKm), info: { planetName: PLANET_BY_ID[planet].name, aKm, periodDays, radiusKm, density, retro: el.retro },
  };
});
const MOON_BY_ID = new Map(MOONS.map((m) => [m.id, m]));
const MOONS_BY_PLANET = {};
for (const m of MOONS) (MOONS_BY_PLANET[m.planet] ||= []).push(m);
for (const list of Object.values(MOONS_BY_PLANET)) list.maxA = Math.max(...list.map((m) => m.el.a));

/** Ecliptic position (m) of any solar-system body id at time t. */
function bodyEcl(id, t = state.simTime) {
  if (id === 'sun') return { x: 0, y: 0 };
  const B = bodiesAt(t);
  if (B.pos[id]) return B.pos[id];
  if (id === 'moon') return B.moon;
  const m = MOON_BY_ID.get(id);
  if (m) {
    const p = B.pos[m.planet];
    const o = A.satelliteOffset(m.el, t);
    return { x: p.x + o.x, y: p.y + o.y };
  }
  return { x: 0, y: 0 };
}
function bodySize(id) {
  if (id === 'sun') return SUN_DIAMETER;
  if (id === 'moon') return MOON_DIAMETER;
  if (PLANET_BY_ID[id]) return planetDiameter(PLANET_BY_ID[id]);
  return MOON_BY_ID.get(id)?.radiusM * 2 || null;
}

/* ---------- Stars, galaxies, markers ---------- */

const GC_EQ = scaleV(A.unitFromCoord({ sys: 'gal', lon: 0, lat: 0 }), SUN_TO_GALACTIC_CENTRE);

/** Short info-card keys for the best-known nearby stars, by Gliese id. */
const STAR_KEYS = {
  'Gl 551': 'proxima', 'Gl 559A': 'rigil', 'Gl 559B': 'toliman', 'Gl 699': 'barnard', 'Gl 244A': 'sirius',
  'Gl 244B': 'siriusb', 'Gl 406': 'wolf359', 'Gl 280A': 'procyon', 'Gl 144': 'epseri', 'Gl 71': 'taucet',
};
const STARS = starsJson.rows.map((row) => {
  const [name, gl, ra, dec, pc] = row;
  return { id: `star-${gl.replace(/\s+/g, '')}`, name, kind: 'star', eq: A.equatorialVector(ra, dec, pc * PARSEC), sizeM: null, row, infoKey: STAR_KEYS[gl] };
});
const STAR_EXTENT = Math.max(PARSEC, ...STARS.map((s) => lenV(s.eq)));
const PROXIMA = STARS.find((s) => s.name.startsWith('Proxima'));
const SIRIUS = STARS.find((s) => s.name.startsWith('Sirius'));

/** Catalogue names made readable: MESSIER081 → M81, NGC0055 → NGC 55. */
const prettyName = (n) => n
  .replace(/^MESSIER0*(\d+)$/, 'M$1')
  .replace(/^(NGC|IC|UGCA|UGC|PGC|DDO|KKH|KKR|KKS|KK|ESO|AGC|HIPASS|LSBC|UA|BTS|CGCG|MCG)0*(\d)/, '$1 $2');

const CAT_LIMIT = (galJson.limitMpc ?? 11) * MEGAPARSEC;
const catalogueRow = new Map(galJson.rows.map((r) => [r[0], r]));
const markerCatalogue = new Set(MARKERS.filter((m) => m.catalogue).map((m) => m.catalogue));
// Galaxies drawn by the batch loop: every catalogue row except those a marker stands in for.
const galRows = galJson.rows.filter((r) => !markerCatalogue.has(r[0]));
const GAL_N = galRows.length;
const galPos = new Float64Array(GAL_N * 3);
const galDiam = new Float64Array(GAL_N); // metres, 0 = not catalogued
const galKind = [];
const galPose = [];
galRows.forEach((r, i) => {
  galPos.set(A.equatorialVector(r[1], r[2], r[3] * MEGAPARSEC), i * 3);
  galDiam[i] = r[4] ? r[4] * KILOPARSEC : 0;
  galKind[i] = galaxyKind(r[6], r[7]);
  galPose[i] = galaxyPose(r[0], galKind[i]);
});

const MARKER = {};
for (const m of MARKERS) {
  const o = {
    id: m.id, name: m.name, label: m.label ?? m.name, kind: m.kind, sizeM: null,
    ringM: m.radius ? A.distanceFromSpec(m.radius) : null, flyTo: Boolean(m.flyTo), fromRedshift: Boolean(m.fromRedshift),
  };
  if (m.catalogue) {
    const r = catalogueRow.get(m.catalogue);
    if (!r) continue; // data failed to load
    o.eq = A.equatorialVector(r[1], r[2], r[3] * MEGAPARSEC);
    o.sizeM = r[4] ? r[4] * KILOPARSEC : null;
    o.row = r;
    o.galKind = galaxyKind(r[6], r[7]);
    o.pose = galaxyPose(r[0], o.galKind);
  } else if (m.sgxyzKms) {
    o.eq = A.sgVelocityToEquatorial(m.sgxyzKms, m.H0);
  } else if (m.centre === 'mw-m31-midpoint') {
    if (!MARKER.andromeda) continue;
    o.eq = scaleV(addV(GC_EQ, MARKER.andromeda.eq), 0.5);
  } else {
    const u = m.coord ? A.unitFromCoord(m.coord) : A.lonLatToUnit(A.parseRA(m.ra), A.parseDec(m.dec));
    o.eq = scaleV(u, A.distanceFromSpec(m.dist));
  }
  MARKER[m.id] = o;
}
const MARKER_LIST = Object.values(MARKER);

/* ---------- Everything that can be picked, pinned, hovered or clicked ---------- */

/** Objects with eq(t) → equatorial position (m, from the Sun). */
const OBJECTS = new Map();
function addObject(o) {
  OBJECTS.set(o.id, o);
  return o;
}
addObject({ id: 'sun', name: 'Sun', kind: 'body', group: 'Solar system', sizeM: SUN_DIAMETER, eq: () => ZERO });
for (const p of PLANETS) {
  addObject({ id: p.id, name: p.name, kind: 'body', group: 'Solar system', sizeM: planetDiameter(p), eq: (t) => eclToEq(bodiesAt(t).pos[p.id]), planet: p, periodS: PERIOD[p.id] });
}
addObject({ id: 'moon', name: 'Moon', kind: 'body', group: 'Solar system', sizeM: MOON_DIAMETER, eq: (t) => eclToEq(bodiesAt(t).moon) });
addObject({ id: 'belt', name: 'Asteroid belt', kind: 'region', group: 'Solar system', distM: 2.7 * AU });
addObject({ id: 'heliopause', name: 'Heliopause', kind: 'region', group: 'Solar system', ringM: HELIOPAUSE.radiusAu * AU, distM: HELIOPAUSE.radiusAu * AU });
addObject({ id: 'oort', name: 'Oort cloud (outer edge)', kind: 'region', group: 'Solar system', distM: OORT_CLOUD.outerAu * AU });
for (const p of PLANETS) {
  for (const m of MOONS_BY_PLANET[p.id] || []) {
    addObject({ id: m.id, name: m.name, kind: 'body', group: `Moons of ${p.name}`, sizeM: m.radiusM ? 2 * m.radiusM : null, eq: (t) => eclToEq(bodyEcl(m.id, t)), moon: m.info, infoKey: m.name.toLowerCase() });
  }
}
for (const s of STARS) addObject({ ...s, group: 'Nearest stars', eq: () => s.eq });
addObject({ id: 'gc', name: 'Galactic centre', kind: 'marker', group: 'Milky Way', eq: () => GC_EQ });
/** A point on a Milky Way arm at azimuth β (deg), as an equatorial position: GC + R·(−cos β, sin β) in galactic X, Y. */
const GAL_TO_EQ = A.transpose(A.EQ_TO_GAL);
function armPointEq(arm, betaDeg) {
  const R = A.armRadiusKpc(arm, betaDeg) * KILOPARSEC;
  const b = A.degToRad(betaDeg);
  return A.mulMV(GAL_TO_EQ, [SUN_TO_GALACTIC_CENTRE - R * Math.cos(b), R * Math.sin(b), 0]);
}
ARMS.forEach((arm, i) => {
  const eq = armPointEq(arm, (arm.betaRange[0] + arm.betaRange[1]) / 2);
  addObject({ id: `arm-${i}`, name: arm.name, kind: 'region', group: 'Milky Way', eq: () => eq, arm });
});
addObject({ id: 'catlimit', name: 'Catalogue limit', kind: 'region', group: 'Galaxies and structures', distM: (galJson.limitMpc ?? 11) * MEGAPARSEC });
addObject({ id: 'mw', name: 'Milky Way (diameter)', kind: 'size', group: 'Milky Way', distM: MILKY_WAY_DIAMETER, sizeM: MILKY_WAY_DIAMETER });
for (const m of MARKER_LIST) addObject({ ...m, group: 'Galaxies and structures', eq: () => m.eq, galaxy: m.row });
addObject({ id: 'edge', name: OBSERVABLE_EDGE.name, kind: 'edge', group: 'Galaxies and structures', distM: OBSERVABLE_UNIVERSE_RADIUS, sizeM: OBSERVABLE_UNIVERSE_DIAMETER });
for (let i = 0; i < GAL_N; i++) {
  const eq = [galPos[i * 3], galPos[i * 3 + 1], galPos[i * 3 + 2]];
  addObject({ id: `gal-${i}`, name: prettyName(galRows[i][0]), kind: 'galaxy', group: 'Catalogued galaxies', sizeM: galDiam[i] || null, eq: () => eq, galaxy: galRows[i], galKind: galKind[i] });
}

/** Rows that are always shown in the Scale equivalents panel, per view. */
const FIXED_ROWS = {
  system: ['sun', 'neptune-orbit', 'proxima', 'sirius', 'gc', 'andromeda'],
  earth: ['sun', 'neptune-orbit', 'proxima', 'sirius', 'gc', 'andromeda'],
  milkyway: ['moon-orbit', 'sun', 'neptune-orbit', 'proxima', 'sirius', 'gc', 'mw', 'andromeda', 'virgo', 'laniakea', 'edge'],
};

/* ---------- State ---------- */

const PIN_KEY = 'rsp.space.pins';
function loadPins() {
  try {
    return JSON.parse(sessionStorage.getItem(PIN_KEY) || '[]').filter((id) => OBJECTS.has(id)).slice(0, 4);
  } catch {
    return [];
  }
}
function savePins() {
  try {
    sessionStorage.setItem(PIN_KEY, JSON.stringify(state.pinned));
  } catch {
    /* storage blocked: pins last until the page closes */
  }
}

const state = {
  view: 'system',
  simTime: A.unixMsToSimSeconds(Date.now()), // seconds since J2000, starts now
  rateId: 'real',
  drawMode: 'markers',
  offset: { earth: { x: 0, y: 0 }, milkyway: { x: 0, y: 0 } }, // camera offset from the anchor, m (screen-aligned, y up)
  zoomT: 1,          // zoom fraction of the galactic view (0 = Earth 2 cm, 1 = Milky Way 1 px), set by the rail
  sys: { log: null, focus: 'sun', trans: null, goal: null }, // solar-system zoom (log10 m/px, null = fit) and focus
  rail: { s: 0, anim: null, goal: null },                       // galactic view: position along the list of stops
  follow: null,      // Earth view: { kind: 'body', id } or { kind: 'pulse' }
  travel: null,      // Earth-view camera animation
  pulse: { earth: null, milkyway: null },
  trail: [],         // recent Earth positions (ecliptic m) for the Earth-view trail
  trailClock: 0,
  freeze: { pos: null, glide: null }, // Earth anchor held still while Earth is "too fast"
  hover: null,       // pointer position for the tooltip { x, y } (CSS px)
  infoId: null,      // object shown in the info card
  pinned: loadPins(),
  lastFrame: null,
  layers: {},
};

const rateS = () => RATES[state.rateId].s;
/** Rate that motion actually advances at (0 while paused, so paused bodies are shown). */
const effectiveRate = () => (sim.paused ? 0 : rateS());

/* =========================================================================
 * 2. Scene and camera frames
 * ====================================================================== */

const dprNow = () => sim.view?.dpr || window.devicePixelRatio || 1;
/** Device pixels per real metre on this screen (calibrated, or the 96 px/inch fallback). */
const devicePxPerMetre = () => sim.scale.cssPxPerMetre * dprNow();
const zoomLimits = () => A.zoomLimits(1 / devicePxPerMetre());
const shortSide = () => Math.max(1, Math.min(sim.view.width, sim.view.height) * sim.view.dpr);

/** Solar-system view scale: Neptune's full orbit (aphelion) fits 94% of the canvas's shorter side. */
function fitMpp(wCss, hCss, dpr) {
  const aphelion = NEPTUNE.a * (1 + NEPTUNE.e) * AU;
  return (2 * aphelion) / (0.94 * Math.max(1, Math.min(wCss, hCss)) * dpr);
}

/** Zoom range of the solar-system view (log10 m/px): from the focus filling half the screen to the whole system. */
function sysRange(focus = state.sys.focus) {
  const { width, height, dpr } = sim.view;
  const fit = fitMpp(width, height, dpr);
  const size = bodySize(focus) || 2e4; // moons without a measured size: stop at 20 km
  return { lo: Math.log10(Math.min(fit, size / (0.5 * shortSide()))), hi: Math.log10(fit), fit };
}

/** Current solar-system zoom, including the zoom-out "hop" while changing focus. */
function sysLog(now = performance.now()) {
  const r = sysRange();
  let L = clamp(state.sys.log ?? r.hi, r.lo, r.hi);
  const tr = state.sys.trans;
  if (tr) L = Math.min(r.hi, L + tr.bump * Math.sin(Math.PI * clamp((now - tr.start) / (tr.dur * 1000), 0, 1)));
  return L;
}

/** Centre of the solar-system view (ecliptic m): the Sun when zoomed out, the focus body when zoomed in. */
function sysCentre(mpp, now = performance.now()) {
  const { fit } = sysRange();
  const w = A.logBlendDown(mpp, fit / 4, fit);
  const tr = state.sys.trans;
  let p = bodyEcl(state.sys.focus);
  if (tr) {
    const e = A.easeInOutCubic((now - tr.start) / (tr.dur * 1000));
    const q = bodyEcl(tr.from);
    p = { x: q.x + (p.x - q.x) * e, y: q.y + (p.y - q.y) * e };
  }
  return { x: p.x * w, y: p.y * w };
}

function viewMpp(view = state.view) {
  if (view === 'system') return 10 ** sysLog();
  if (view === 'earth') return EARTH_DIAMETER;
  return A.metresPerPx(state.zoomT, zoomLimits());
}

/**
 * Earth's position for the camera anchor (ecliptic m). While Earth would turn
 * more than 0.5 rad per frame the anchor holds still where Earth was last
 * shown (and Earth is hidden); when motion is slow again the anchor glides
 * back to Earth over 0.8 s. Either way the camera never jumps.
 */
function earthAnchorEcl(now = performance.now()) {
  const fz = state.freeze;
  if (fz.pos) return fz.pos;
  const live = bodiesAt(state.simTime).pos.earth;
  if (fz.glide) {
    const e = A.easeInOutCubic((now - fz.glide.start) / 800);
    if (e >= 1) fz.glide = null;
    else return { x: fz.glide.from.x + (live.x - fz.glide.from.x) * e, y: fz.glide.from.y + (live.y - fz.glide.from.y) * e };
  }
  return live;
}

/** Hold or release the Earth anchor when Earth starts / stops being "too fast". Call before time advances. */
function syncFreeze(now = performance.now()) {
  const fz = state.freeze;
  const fast = A.tooFast(PERIOD.earth, effectiveRate());
  if (fast && !fz.pos) {
    fz.pos = earthAnchorEcl(now); // where Earth is shown right now
    fz.glide = null;
  } else if (!fast && fz.pos) {
    fz.glide = { from: fz.pos, start: now };
    fz.pos = null;
  }
}

/**
 * The frame for the current view: metres per device px (mpp), view rotation V
 * (equatorial → screen axes), camera position cam (m, screen-aligned, y up),
 * k = CSS px per metre, pixel pitch and scaleRatio.
 */
function makeFrame(view = state.view) {
  const { width: w, height: h, dpr } = sim.view;
  const t = state.simTime;
  const B = bodiesAt(t);
  if (view === 'milkyway') applyRail();
  const mpp = viewMpp(view);
  const anchorEcl = view === 'system' ? sysCentre(mpp) : earthAnchorEcl();
  const anchorEqv = eclToEq(anchorEcl);
  let fr;
  if (view === 'milkyway') {
    fr = A.zoomFrame(mpp, anchorEqv, state.offset.milkyway);
    // Clamp the camera to the observable universe (no NaN, no jitter at the rim).
    const c = A.clampToRadius(fr.cam, OBSERVABLE_UNIVERSE_RADIUS);
    if (c !== fr.cam) fr.cam = c;
  } else {
    const pa = A.mulMV(A.VIEW_ECLIPTIC, anchorEqv);
    const off = view === 'earth' ? state.offset.earth : { x: 0, y: 0 };
    fr = { mpp, V: A.VIEW_ECLIPTIC, wEG: 0, wGS: 0, wAnchor: view === 'earth' ? 0 : 1, anchorEq: anchorEqv, cam: { x: pa[0] + off.x, y: pa[1] + off.y } };
    if (view === 'earth') {
      const c = A.clampToRadius(fr.cam, OBSERVABLE_UNIVERSE_RADIUS);
      if (c !== fr.cam) {
        state.offset.earth = { x: off.x + (c.x - fr.cam.x), y: off.y + (c.y - fr.cam.y) };
        fr.cam = c;
      }
    }
  }
  const ppm = devicePxPerMetre();
  return Object.assign(fr, {
    view, w, h, dpr, t, B, anchorEcl,
    k: 1 / (mpp * dpr),       // CSS px per world metre
    pitch: 1 / ppm,           // real metres per device px
    ratio: mpp * ppm,         // scaleRatio: world metres per real screen metre
    VE: A.mulMM(fr.V, ECL_TO_EQ), // ecliptic → screen axes
    earthEq: eclToEq(B.pos.earth),
    earthDraw: view === 'system' ? B.pos.earth : anchorEcl, // where Earth is drawn (anchor held while "too fast")
  });
}

/** Screen position (CSS px) of an equatorial position. */
function scr(f, v) {
  const V = f.V;
  const px = V[0][0] * v[0] + V[0][1] * v[1] + V[0][2] * v[2];
  const py = V[1][0] * v[0] + V[1][1] * v[1] + V[1][2] * v[2];
  return [f.w / 2 + (px - f.cam.x) * f.k, f.h / 2 - (py - f.cam.y) * f.k];
}
/** Screen position (CSS px) of an ecliptic-plane position. */
function scrEcl(f, x, y) {
  const E = f.VE;
  const px = E[0][0] * x + E[0][1] * y;
  const py = E[1][0] * x + E[1][1] * y;
  return [f.w / 2 + (px - f.cam.x) * f.k, f.h / 2 - (py - f.cam.y) * f.k];
}
/** Ecliptic vector → screen vector (CSS px, y down), for ellipse axes. */
function vecEcl(f, x, y) {
  const E = f.VE;
  return [(E[0][0] * x + E[0][1] * y) * f.k, -(E[1][0] * x + E[1][1] * y) * f.k];
}
/** Device-px distance of a screen point from the canvas centre. */
const devDist = (f, x, y) => Math.hypot(x - f.w / 2, y - f.h / 2) * f.dpr;
const onCanvas = (f, x, y, m = 0) => x >= -m && x <= f.w + m && y >= -m && y <= f.h + m;
/** Screen position → screen-aligned world metres (inverse of scr's projection). */
const screenToWorld = (f, x, y) => ({ x: f.cam.x + (x - f.w / 2) / f.k, y: f.cam.y - (y - f.h / 2) / f.k });

/* =========================================================================
 * 3. Drawing helpers: huge circles and ellipses never go through arc()
 * ====================================================================== */

let C = {}; // colours, refreshed by simkit (dark "space" palette from the canvas wrapper)
let ctx = null;
const hits = [];
const labels = [];
const pointers = [];
const captions = [];

const viewRect = (f, m = 6) => ({ x0: -m, y0: -m, x1: f.w + m, y1: f.h + m });
const isBig = (f, rCss) => rCss * f.dpr > A.MAX_ARC_RADIUS_PX;

/**
 * Add the ellipse p(φ) = c + u·cos φ + v·sin φ (CSS px) to the current path:
 * small ones as a closed polyline, big ones only where they cross the canvas.
 */
function pathEllipse(f, cx, cy, ux, uy, vx, vy) {
  const r = Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy));
  if (!(r > 0) || !Number.isFinite(r) || !Number.isFinite(cx) || !Number.isFinite(cy)) return false;
  if (!isBig(f, r)) {
    if (cx + r < -8 || cx - r > f.w + 8 || cy + r < -8 || cy - r > f.h + 8) return false;
    const n = clamp(Math.ceil(r * 0.6), 24, 240);
    for (let i = 0; i <= n; i++) {
      const a = (TAU * i) / n;
      const x = cx + ux * Math.cos(a) + vx * Math.sin(a);
      const y = cy + uy * Math.cos(a) + vy * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    return true;
  }
  const iv = A.clipEllipseToRect(cx, cy, ux, uy, vx, vy, viewRect(f));
  for (const [a0, a1] of iv) {
    const n = clamp(Math.ceil(((a1 - a0) * r) / 4), 4, 400);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const x = cx + ux * Math.cos(a) + vx * Math.sin(a);
      const y = cy + uy * Math.cos(a) + vy * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  return iv.length > 0;
}
const pathCircle = (f, cx, cy, r) => pathEllipse(f, cx, cy, r, 0, 0, r);

/** Add a filled disc (any size) to the current path. */
function pathDisc(f, cx, cy, r) {
  if (!(r > 0)) return;
  if (!isBig(f, r)) {
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, TAU);
    return;
  }
  const poly = A.discRectPolygon(cx, cy, r, viewRect(f, 4));
  if (poly.length < 3) return;
  ctx.moveTo(poly[0][0], poly[0][1]);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
  ctx.closePath();
}

/** Filled annulus (r1 < r2, CSS px): fills the screen or draws nothing when the canvas is entirely inside / outside. */
function fillAnnulus(f, cx, cy, r1, r2, style) {
  const cov = A.annulusCoverage(cx, cy, r1, r2, viewRect(f, 2));
  if (cov === 'none') return;
  ctx.fillStyle = style;
  if (cov === 'full') {
    ctx.fillRect(0, 0, f.w, f.h);
    return;
  }
  ctx.beginPath();
  pathDisc(f, cx, cy, r2);
  pathDisc(f, cx, cy, r1);
  ctx.fill('evenodd');
}

function strokeCircle(f, cx, cy, r, style, { width = 1, dash = null, alpha = 1 } = {}) {
  ctx.beginPath();
  if (!pathCircle(f, cx, cy, r)) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** A point on a circle that is on screen, for its label (tries towards the canvas centre, then the top). */
function ringLabelPoint(f, cx, cy, r) {
  // Ring centred on screen: label its top. Otherwise the part nearest the canvas centre.
  const centred = onCanvas(f, cx, cy);
  const toCentre = Math.atan2(f.h / 2 - cy, f.w / 2 - cx);
  const order = centred ? [-Math.PI / 2, Math.PI / 2, -Math.PI / 4, -3 * Math.PI / 4] : [toCentre, toCentre - 0.4, toCentre + 0.4, -Math.PI / 2];
  for (const a of order) {
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (onCanvas(f, x, y, -30)) return [x, y];
  }
  return null;
}

function devicePixelDot(f, x, y, colour, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colour;
  ctx.fillRect(x - 0.5 / f.dpr, y - 0.5 / f.dpr, 1 / f.dpr, 1 / f.dpr);
  ctx.globalAlpha = 1;
}

/**
 * Draw an object diamM across at (x, y). True size: real size, under one
 * pixel a single pixel with alpha = its area fraction. Markers: objects under
 * 3 px get a ring so they can be found. Returns the drawn radius (CSS px).
 */
function drawObject(f, x, y, diamM, colour, opts = {}) {
  const dDev = diamM ? diamM / f.mpp : 0;
  const rCss = dDev / 2 / f.dpr;
  if (!onCanvas(f, x, y, rCss + 12)) return -1;
  const markers = state.drawMode === 'markers';
  let r = rCss;
  if (diamM && dDev >= 1 && dDev < 2) {
    // One to two pixels: a solid square of exactly that many device pixels ("Earth = 1 pixel").
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.fillStyle = colour;
    ctx.fillRect(x - rCss, y - rCss, 2 * rCss, 2 * rCss);
    ctx.globalAlpha = 1;
    if (markers) {
      ringAt(x, y, colour, opts.alpha);
      r = 7;
    }
  } else if (diamM && dDev >= 1 && (dDev >= 3 || !markers)) {
    ctx.beginPath();
    pathDisc(f, x, y, rCss);
    if (opts.shade && !isBig(f, rCss)) {
      // Stylised day/night shading (not a real map): lit towards the Sun.
      const [lx, ly] = opts.shade;
      const g = ctx.createRadialGradient(x + lx * rCss * 0.45, y + ly * rCss * 0.45, rCss * 0.05, x, y, rCss * 1.05);
      g.addColorStop(0, opts.light || '#d9f0ff');
      g.addColorStop(0.45, colour);
      g.addColorStop(1, opts.dark || '#0a1830');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = colour;
    }
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (!markers || !diamM) {
    // Sub-pixel in True size mode (or size unknown): one device pixel.
    const a = diamM ? A.trueSizeAlpha(dDev) : opts.unknownAlpha ?? 0.5;
    devicePixelDot(f, x, y, colour, Math.max(a, opts.minAlpha ?? 0));
    if (markers && !diamM) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, TAU);
      ctx.fillStyle = colour;
      ctx.globalAlpha = opts.alpha ?? 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    r = 2;
  } else {
    // Markers mode, under 3 px: labelled ring plus the true-size pixel inside.
    devicePixelDot(f, x, y, colour, Math.max(0.6, A.trueSizeAlpha(dDev)));
    ringAt(x, y, colour, opts.alpha);
    r = 7;
  }
  return r;
}
function ringAt(x, y, colour, alpha = 1) {
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, TAU);
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.85 * alpha;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/* ---------- Backgrounds ---------- */

let starTiles = null;
const patternCache = new WeakMap();
/** Decorative star field (random, not real positions): two repeating tiles, sparse and dense. */
function drawStarfield(f, base, dense) {
  if (base + dense < 0.01) return;
  if (!starTiles) starTiles = { base: starfieldTile(11, 260), dense: starfieldTile(29, 1500) };
  let pats = patternCache.get(ctx);
  if (!pats) {
    pats = { base: ctx.createPattern(starTiles.base, 'repeat'), dense: ctx.createPattern(starTiles.dense, 'repeat') };
    patternCache.set(ctx, pats);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // tiles are in device pixels
  for (const [key, a] of [['base', base], ['dense', dense]]) {
    if (a < 0.01) continue;
    ctx.globalAlpha = Math.min(1, a);
    ctx.fillStyle = pats[key];
    ctx.fillRect(0, 0, f.w * f.dpr, f.h * f.dpr);
  }
  ctx.restore();
}

/* =========================================================================
 * 4. The three views
 * ====================================================================== */

function draw(context, w, h, k, colors) {
  ctx = context;
  C = colors;
  if (!sim.view || w === 0 || h === 0) return;
  const f = makeFrame();
  state.lastFrame = f;
  hits.length = 0;
  labels.length = 0;
  pointers.length = 0;
  captions.length = 0;
  ctx.font = FONT;

  if (f.view === 'system') drawSystemView(f);
  else if (f.view === 'earth') drawEarthView(f);
  else drawZoomView(f);

  placeLabels(f);
  drawScaleBar(f);
  drawCaptions(f);
  drawPointers(f);
  updateTooltip();
  updateHuds(f);
  throttledPanels(f);
}

/* ---------- Shared pieces ---------- */

function sunDir(f, x, y, sunX, sunY) {
  const d = Math.hypot(sunX - x, sunY - y) || 1;
  return [(sunX - x) / d, (sunY - y) / d];
}

const pointersAllowed = (f) => f.view !== 'system' || 10 ** sysRange().hi / f.mpp > 2.5;

function drawSun(f, label = true) {
  const [x, y] = scr(f, ZERO);
  const dDev = SUN_DIAMETER / f.mpp;
  if (onCanvas(f, x, y, dDev / f.dpr / 2 + 40) && dDev >= 3 && !isBig(f, dDev / f.dpr / 2)) {
    // Soft glow (decoration only) around a real-size disc.
    const r = dDev / f.dpr / 2;
    const g = ctx.createRadialGradient(x, y, r * 0.8, x, y, r * 1.6 + 6);
    g.addColorStop(0, 'rgba(255, 200, 80, 0.35)');
    g.addColorStop(1, 'rgba(255, 200, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6 + 6, 0, TAU);
    ctx.fill();
  }
  const r = drawObject(f, x, y, SUN_DIAMETER, C.sSun);
  if (r >= 0) {
    hits.push({ x, y, r: Math.max(r, 9), id: 'sun' });
    if (label) labels.push({ text: `Sun${dDev < 3 ? ` (${pxText(dDev)} px)` : ''}`, x, y, r, priority: 9, colour: C.sSun, id: 'sun' });
  } else if (pointersAllowed(f)) {
    addPointer(f, 'sun', 'Sun', x, y, 10);
  }
  return [x, y];
}

const pxText = (dDev) => (dDev >= 100 ? fmt(dDev, 0) : dDev >= 10 ? fmt(dDev, 1) : dDev >= 1 ? fmt(dDev, 2) : dDev >= 1e-4 ? sig(dDev, 2) : 'under 0.0001');

/** Planet orbits (planar, approximate) as ellipses. */
function drawOrbits(f, alpha, { onlyIds = null } = {}) {
  ctx.lineWidth = 1;
  for (const p of PLANETS) {
    if (onlyIds && !onlyIds.includes(p.id)) continue;
    const el = A.orbitEllipse(p);
    const [cx, cy] = scrEcl(f, el.cx, el.cy);
    const [ux, uy] = vecEcl(f, el.ux, el.uy);
    const [vx, vy] = vecEcl(f, el.vx, el.vy);
    ctx.beginPath();
    if (!pathEllipse(f, cx, cy, ux, uy, vx, vy)) continue;
    ctx.strokeStyle = PLANET_COLOURS[p.id];
    ctx.globalAlpha = 0.45 * alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Asteroid belt, 2.2 to 3.2 AU, as a shaded band. */
function drawBelt(f, alpha) {
  const [cx, cy] = scrEcl(f, 0, 0);
  const style = `rgba(190, 170, 130, ${0.07 * alpha})`;
  if (f.wEG === 0) {
    fillAnnulus(f, cx, cy, ASTEROID_BELT_AU[0] * AU * f.k, ASTEROID_BELT_AU[1] * AU * f.k, style);
  } else {
    // Tilted view (small on screen): elliptical band.
    ctx.beginPath();
    for (const rAu of ASTEROID_BELT_AU) {
      const [ux, uy] = vecEcl(f, rAu * AU, 0);
      const [vx, vy] = vecEcl(f, 0, rAu * AU);
      pathEllipse(f, cx, cy, ux, uy, vx, vy);
    }
    ctx.fillStyle = style;
    ctx.fill('evenodd');
  }
  const r = ASTEROID_BELT_AU[1] * AU * f.k;
  if (r > 40 && r < 4000) labels.push({ text: 'Asteroid belt', x: cx + r * 0.71, y: cy - r * 0.71, r: 2, priority: 2, colour: C.sMuted, id: 'belt' });
}

/** Planets for the solar-system layers. */
function drawPlanets(f, alpha) {
  const rate = effectiveRate();
  const [sunX, sunY] = scr(f, ZERO);
  const fast = [];
  for (const p of PLANETS) {
    if (A.tooFast(PERIOD[p.id], rate)) {
      fast.push(p.name);
      continue;
    }
    const pos = p.id === 'earth' ? f.earthDraw : f.B.pos[p.id];
    const [x, y] = scrEcl(f, pos.x, pos.y);
    const opts = { alpha };
    if (p.id === 'earth') Object.assign(opts, { shade: sunDir(f, x, y, sunX, sunY), light: '#bfe6ff', dark: '#081a33' });
    else Object.assign(opts, { shade: sunDir(f, x, y, sunX, sunY), light: '#ffffff', dark: '#1a1612' });
    const r = drawObject(f, x, y, planetDiameter(p), PLANET_COLOURS[p.id], opts);
    const dDev = planetDiameter(p) / f.mpp;
    if (r >= 0) {
      hits.push({ x, y, r: Math.max(r, 9), id: p.id });
      const extra = dDev >= 3 ? ' (shading stylised)' : ` (${pxText(dDev)} px)`;
      labels.push({ text: p.name + (p.id === 'earth' || dDev < 3 ? extra : ''), x, y, r, priority: p.id === 'earth' ? 9 : 6, colour: PLANET_COLOURS[p.id], id: p.id });
    } else if ((f.view === 'milkyway' && alpha > 0.5) || (f.view === 'earth' && (p.id === 'earth' || p.id === 'mars')) || (f.view === 'system' && pointersAllowed(f))) {
      addPointer(f, p.id, p.name, x, y, p.id === 'earth' ? 8 : 5);
    }
  }
  if (fast.length) captions.push(`Too fast to show motion (orbit rings only): ${fast.join(', ')}`);
}

/** Earth's Moon: orbit ring and the Moon. */
function drawMoon(f, alpha) {
  const earth = f.earthDraw;
  const [ex, ey] = scrEcl(f, earth.x, earth.y);
  const [ux, uy] = vecEcl(f, EARTH_MOON_DISTANCE, 0);
  const [vx, vy] = vecEcl(f, 0, EARTH_MOON_DISTANCE);
  ctx.beginPath();
  if (pathEllipse(f, ex, ey, ux, uy, vx, vy)) {
    ctx.strokeStyle = MOON_COLOUR;
    ctx.globalAlpha = 0.35 * alpha;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (A.tooFast(MOON_PERIOD, effectiveRate())) {
    if (Math.hypot(ux, uy) > 20) captions.push('Moon: too fast to show motion (orbit ring only)');
    return;
  }
  // The Moon keeps its true offset from Earth even while the anchor is held still.
  const m = f.B.moon;
  const e = f.B.pos.earth;
  const [x, y] = scrEcl(f, earth.x + (m.x - e.x), earth.y + (m.y - e.y));
  const [sx, sy] = scr(f, ZERO);
  const r = drawObject(f, x, y, MOON_DIAMETER, MOON_COLOUR, { alpha, shade: sunDir(f, x, y, sx, sy), light: '#ffffff', dark: '#2a2c30' });
  const dDev = MOON_DIAMETER / f.mpp;
  if (r >= 0) {
    hits.push({ x, y, r: Math.max(r, 9), id: 'moon' });
    labels.push({ text: `Moon${dDev < 3 ? ` (${pxText(dDev)} px)` : ''}`, x, y, r, priority: 7, colour: MOON_COLOUR, id: 'moon' });
  } else if (alpha > 0.5 && pointersAllowed(f)) {
    addPointer(f, 'moon', 'Moon', x, y, 7);
  }
}

/**
 * Moons of the other planets (JPL mean elements, drawn flat and approximate).
 * A planet's moons appear once their orbits are a few pixels across; moons with
 * a measured size get rings and labels, the many small ones are dots.
 */
function drawMoonSystems(f, alpha) {
  const rate = effectiveRate();
  let fast = 0;
  for (const p of PLANETS) {
    const list = MOONS_BY_PLANET[p.id];
    if (!list) continue;
    const P = f.B.pos[p.id];
    const [px, py] = scrEcl(f, P.x, P.y);
    const extent = list.maxA * f.k;
    if (extent < 3) continue;
    if (px + extent < -10 || px - extent > f.w + 10 || py + extent < -10 || py - extent > f.h + 10) continue;
    const [sx, sy] = scr(f, ZERO);
    for (const m of list) {
      const rPx = m.el.a * f.k;
      if (rPx < 3) continue;
      const fade = alpha * clamp((rPx - 3) / 6, 0, 1);
      const [cx, cy] = scrEcl(f, P.x + m.ell.cx, P.y + m.ell.cy);
      const [ux, uy] = vecEcl(f, m.ell.ux, m.ell.uy);
      const [vx, vy] = vecEcl(f, m.ell.vx, m.ell.vy);
      ctx.beginPath();
      if (pathEllipse(f, cx, cy, ux, uy, vx, vy)) {
        ctx.strokeStyle = MOON_COLOUR;
        ctx.globalAlpha = (m.major ? 0.32 : 0.09) * fade;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (A.tooFast(m.el.period, rate)) {
        fast++;
        continue;
      }
      const o = A.satelliteOffset(m.el, f.t);
      const [x, y] = scrEcl(f, P.x + o.x, P.y + o.y);
      const r = drawObject(f, x, y, m.radiusM ? 2 * m.radiusM : null, MOON_COLOUR, {
        alpha: fade, unknownAlpha: 0.7 * fade, shade: sunDir(f, x, y, sx, sy), light: '#ffffff', dark: '#2a2c30',
      });
      if (r < 0) continue;
      hits.push({ x, y, r: Math.max(r, 7), id: m.id });
      if (m.major || rPx > 120) labels.push({ text: m.name, x, y, r, priority: m.major ? 4.5 : 1, colour: MOON_COLOUR, id: m.id });
    }
  }
  if (fast) captions.push(`${fast} moon${fast === 1 ? '' : 's'} too fast to show motion (orbit rings only)`);
}

/**
 * Heliocentric reference dot grid (fixed to the Sun) that scrolls past while
 * the camera rides with Earth. spacingM = grid spacing in metres.
 */
function drawHelioGrid(f, spacingM, alpha) {
  if (alpha <= 0.01) return;
  const step = spacingM * f.k; // CSS px
  if (step < 6) return;
  const [sx, sy] = scr(f, ZERO);
  // Grid points sit at the Sun + whole multiples of the step. Beyond ~1e12 px the
  // multiples can't be represented exactly in doubles, so the grid is skipped there.
  if (!(Math.abs(sx) < 1e12 && Math.abs(sy) < 1e12)) return;
  const nx = Math.ceil(f.w / step) + 2;
  const ny = Math.ceil(f.h / step) + 2;
  if (nx * ny > 20000) return;
  const x0 = sx + (Math.floor((0 - sx) / step) - 1) * step;
  const y0 = sy + (Math.floor((0 - sy) / step) - 1) * step;
  ctx.fillStyle = C.sGrid;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step;
    for (let j = 0; j <= ny; j++) {
      const y = y0 + j * step;
      ctx.rect(x - 1, y - 1, 2, 2);
    }
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/* ---------- View 1: Solar system ---------- */

function drawSystemView(f) {
  drawStarfield(f, 0.9, 0.25);
  drawBelt(f, 1);
  drawOrbits(f, 1);
  drawSun(f);
  drawPlanets(f, 1);
  const moonAlpha = A.layerAlpha((2 * EARTH_MOON_DISTANCE) / f.mpp, 6);
  if (moonAlpha > 0.01) drawMoon(f, moonAlpha);
  drawMoonSystems(f, 1);
  drawFocusRing(f);
  captions.push('Ecliptic seen from above · orbits flat and approximate · background stars decorative');
  if (state.drawMode === 'markers') captions.push('Markers mode: only the orbits are to scale');
}

/** Dashed ring round the zoom focus (when it isn't the Sun). */
function drawFocusRing(f) {
  const id = state.sys.focus;
  if (id === 'sun') return;
  const p = bodyEcl(id);
  const [x, y] = scrEcl(f, p.x, p.y);
  if (!onCanvas(f, x, y, 20)) return;
  const r = Math.max(12, ((bodySize(id) || 0) / f.mpp / f.dpr) / 2 + 6);
  if (isBig(f, r)) return;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = C.sAccent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
}

/* ---------- View 2: Earth = 1 pixel ---------- */

// Arc-length table of Earth's orbit, for ticks every 1,000 px along it.
const EARTH_ARC = (() => {
  const el = A.orbitEllipse(EARTH_EL);
  const n = 8192;
  const s = new Float64Array(n + 1);
  let px = el.cx + el.ux;
  let py = el.cy + el.uy;
  for (let i = 1; i <= n; i++) {
    const a = (TAU * i) / n;
    const x = el.cx + el.ux * Math.cos(a) + el.vx * Math.sin(a);
    const y = el.cy + el.uy * Math.cos(a) + el.vy * Math.sin(a);
    s[i] = s[i - 1] + Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return { el, n, s, total: s[n] };
})();

function arcParamAt(len) {
  const { s, n } = EARTH_ARC;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < len) lo = mid;
    else hi = mid;
  }
  const frac = (len - s[lo]) / (s[hi] - s[lo] || 1);
  return (TAU * (lo + frac)) / n;
}
function arcLengthAt(a) {
  const { s, n } = EARTH_ARC;
  const turns = Math.floor(a / TAU);
  const x = ((a / TAU) - turns) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return turns * EARTH_ARC.total + s[i] + (s[i + 1] - s[i]) * (x - i);
}

function drawEarthOrbitTicks(f) {
  const { el, total } = EARTH_ARC;
  const spacing = 1000 * f.mpp; // 1,000 device px along the orbit
  const perLap = Math.round(total / spacing);
  const [cx, cy] = scrEcl(f, el.cx, el.cy);
  const [ux, uy] = vecEcl(f, el.ux, el.uy);
  const [vx, vy] = vecEcl(f, el.vx, el.vy);
  const iv = A.clipEllipseToRect(cx, cy, ux, uy, vx, vy, viewRect(f, 20));
  ctx.strokeStyle = C.sMuted;
  ctx.fillStyle = C.sMuted;
  ctx.lineWidth = 1;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const [a0, a1] of iv) {
    const s0 = arcLengthAt(a0);
    const s1 = arcLengthAt(a1);
    for (let kTick = Math.ceil(s0 / spacing); kTick * spacing <= s1; kTick++) {
      const a = arcParamAt((((kTick * spacing) % total) + total) % total);
      const x = cx + ux * Math.cos(a) + vx * Math.sin(a);
      const y = cy + uy * Math.cos(a) + vy * Math.sin(a);
      const tx = -ux * Math.sin(a) + vx * Math.cos(a);
      const ty = -uy * Math.sin(a) + vy * Math.cos(a);
      const tl = Math.hypot(tx, ty) || 1;
      const nx = -ty / tl;
      const ny = tx / tl;
      ctx.beginPath();
      ctx.moveTo(x - nx * 6, y - ny * 6);
      ctx.lineTo(x + nx * 6, y + ny * 6);
      ctx.stroke();
      ctx.fillText(`${fmt((((kTick % perLap) + perLap) % perLap) * 1000, 0)} px`, x + nx * 16, y + ny * 16 - 6);
    }
  }
}

function drawEarthTrail(f) {
  if (A.tooFast(PERIOD.earth, effectiveRate()) || state.trail.length < 2) return;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const n = state.trail.length;
  for (let i = 1; i < n; i++) {
    const a = state.trail[i - 1];
    const b = state.trail[i];
    const [x0, y0] = scrEcl(f, a.x, a.y);
    const [x1, y1] = scrEcl(f, b.x, b.y);
    if (Math.hypot(x1 - x0, y1 - y0) > 4000) continue;
    ctx.strokeStyle = PLANET_COLOURS.earth;
    ctx.globalAlpha = 0.6 * (i / n);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'butt';
}

function drawEarthView(f) {
  drawStarfield(f, 0.9, 0.25);
  drawHelioGrid(f, 500 * f.mpp, 0.6);
  drawOrbits(f, 1, { onlyIds: ['earth', 'mars'] });
  drawEarthOrbitTicks(f);
  drawEarthTrail(f);
  drawSun(f);
  drawMoon(f, 1);
  drawMoonSystems(f, 1);
  drawPlanets(f, 1);
  drawPulse(f);
  captions.push('Earth\'s orbit drawn through Earth, ticks every 1,000 px · faint dots: grid fixed to the Sun (500 px apart) · background stars decorative');
}

/* ---------- View 3: Galactic scale ---------- */

let mwImage = null;
const MW_HALF_KPC = MILKY_WAY_DIAMETER / 2 / KILOPARSEC;

/** Milky Way picture from the published arm and bar model (see data/milkyway.js). */
function drawMilkyWay(f, alpha) {
  if (!mwImage) mwImage = buildMilkyWay({ arms: ARMS, bar: BAR, halfSizeKpc: MW_HALF_KPC });
  const [gx, gy] = scr(f, GC_EQ);
  const R = (MILKY_WAY_DIAMETER / 2) * f.k; // CSS px
  // Only the visible part of the image is drawn (the disc can be ~12,000 px across here).
  const x0 = Math.max(0, gx - R);
  const y0 = Math.max(0, gy - R);
  const x1 = Math.min(f.w, gx + R);
  const y1 = Math.min(f.h, gy + R);
  if (x1 <= x0 || y1 <= y0) return;
  const S = mwImage.width / (2 * R);
  ctx.globalAlpha = alpha;
  ctx.drawImage(mwImage, (x0 - (gx - R)) * S, (y0 - (gy - R)) * S, (x1 - x0) * S, (y1 - y0) * S, x0, y0, x1 - x0, y1 - y0);
  ctx.globalAlpha = 1;
  if (alpha > 0.3) {
    if (R * f.dpr >= 12) labels.push({ text: 'Milky Way (picture based on measured spiral arms)', x: gx, y: gy, r: Math.min(R * 0.3, 70), priority: 8, colour: C.sFg, id: 'mw' });
    captions.push('Milky Way: arms from Reid et al. 2019, bar from Wegg et al. 2015; colours and glow are artistic · static: it turns once in about 200 million years');
    if (R > 250) {
      // Arm names at the middle of the stretch covered by measurements.
      for (const arm of ARMS) {
        const b = (arm.betaRange[0] + arm.betaRange[1]) / 2;
        const rr = A.armRadiusKpc(arm, b) * KILOPARSEC * f.k;
        const th = Math.PI / 2 + A.degToRad(b);
        labels.push({ text: arm.name, x: gx + rr * Math.cos(th), y: gy + rr * Math.sin(th), r: 2, priority: 3, colour: '#aebde6', id: `arm-${ARMS.indexOf(arm)}` });
      }
    }
  }
}

/** Galaxies from the catalogue, batched; returns { count, nearest }. */
function drawGalaxies(f, alpha) {
  const V = f.V;
  const w2 = f.w / 2;
  const h2 = f.h / 2;
  const trueMode = state.drawMode === 'true';
  const buckets = Array.from({ length: 9 }, () => []); // sub-pixel dots by alpha
  const pictures = [];
  let count = 0;
  let nearest = null;
  for (let i = 0; i < GAL_N; i++) {
    const X = galPos[i * 3];
    const Y = galPos[i * 3 + 1];
    const Z = galPos[i * 3 + 2];
    const x = w2 + (V[0][0] * X + V[0][1] * Y + V[0][2] * Z - f.cam.x) * f.k;
    const y = h2 - (V[1][0] * X + V[1][1] * Y + V[1][2] * Z - f.cam.y) * f.k;
    const dCentre = Math.hypot(x - w2, y - h2);
    if (!nearest || dCentre < nearest.d) nearest = { d: dCentre, i };
    if (x < -50 || x > f.w + 50 || y < -50 || y > f.h + 50) continue;
    count++;
    const dDev = galDiam[i] / f.mpp;
    const rCss = dDev / 2 / f.dpr;
    if (galDiam[i] && rCss >= 2) {
      pictures.push([x, y, rCss, i]);
    } else if (trueMode) {
      const a = galDiam[i] ? A.trueSizeAlpha(dDev) : 0.35; // unknown size: faint dot
      buckets[Math.min(8, Math.round(a * 8))].push(x, y);
    } else {
      buckets[galDiam[i] ? 7 : 4].push(x, y);
    }
    hits.push({ x, y, r: Math.max(5, rCss), id: `gal-${i}` });
  }
  ctx.fillStyle = C.sGalaxy;
  const s = trueMode ? 1 / f.dpr : 2.2;
  buckets.forEach((pts, b) => {
    if (!pts.length || b === 0) return;
    ctx.globalAlpha = alpha * (b / 8);
    ctx.beginPath();
    for (let j = 0; j < pts.length; j += 2) ctx.rect(pts[j] - s / 2, pts[j + 1] - s / 2, s, s);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  for (const [x, y, r, i] of pictures) {
    drawGalaxyPicture(x, y, r, galKind[i], galPose[i], alpha);
    if (r * 2 * f.dpr >= 8) labels.push({ text: prettyName(galRows[i][0]), x, y, r, priority: 2 + Math.min(3, r / 20), colour: C.sGalaxy, id: `gal-${i}` });
  }
  if (pictures.length) captions.push('Galaxy pictures are artist\'s impressions from each galaxy\'s catalogued type and size (orientation illustrative)');
  return { count, nearest };
}

/** Artist's impression of a galaxy rCss in radius (true size from its catalogued diameter). */
function drawGalaxyPicture(x, y, rCss, kind, pose, alpha) {
  if (rCss > 8000) return;
  const img = galaxySprite(kind, pose.variant);
  const d = (2 * rCss) / 0.92; // the sprite's galaxy fills 92% of the image
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(pose.angle);
  ctx.scale(1, pose.squash);
  ctx.drawImage(img, -d / 2, -d / 2, d, d);
  ctx.restore();
}

function drawMarkers(f, alpha) {
  for (const m of MARKER_LIST) {
    const [x, y] = scr(f, m.eq);
    if (m.ringM) {
      const r = m.ringM * f.k;
      if (r > 3) {
        strokeCircle(f, x, y, r, C.sMarker, { dash: m.id === 'laniakea' ? [6, 6] : [3, 4], alpha: 0.6 * alpha });
        const lp = r > 30 ? ringLabelPoint(f, x, y, r) : null;
        if (lp) labels.push({ text: m.label, x: lp[0], y: lp[1], r: 2, priority: 7, colour: C.sMarker, id: m.id });
      }
    }
    let r;
    if (m.kind === 'galaxy') {
      const rCss = (m.sizeM || 0) / f.mpp / f.dpr / 2;
      if (rCss >= 2 && onCanvas(f, x, y, rCss + 12)) {
        drawGalaxyPicture(x, y, rCss, m.galKind, m.pose, alpha);
        r = rCss;
      } else {
        r = drawObject(f, x, y, m.sizeM, C.sGalaxy, { alpha });
      }
    } else if (onCanvas(f, x, y, 10)) {
      // Clusters, groups and regions: a small cross at the centre.
      ctx.strokeStyle = C.sMarker;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      r = 6;
    } else {
      r = -1;
    }
    if (r >= 0) {
      hits.push({ x, y, r: Math.max(9, r), id: m.id });
      const ringLabelled = m.ringM && m.ringM * f.k > 30;
      if (!ringLabelled) labels.push({ text: m.label, x, y, r, priority: m.flyTo ? 9.7 : 8, colour: m.kind === 'galaxy' ? C.sGalaxy : C.sMarker, id: m.id });
    } else {
      addPointer(f, m.id, m.name, x, y, 6);
    }
  }
}

function drawStars(f, alpha) {
  for (const s of STARS) {
    const [x, y] = scr(f, s.eq);
    if (!onCanvas(f, x, y, 10)) {
      if (alpha > 0.3) addPointer(f, s.id, s.name, x, y, 4);
      continue;
    }
    ctx.globalAlpha = alpha;
    if (state.drawMode === 'true') devicePixelDot(f, x, y, C.sStar, 0.6); // size not catalogued: faint dot
    else {
      ctx.fillStyle = C.sStar;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    hits.push({ x, y, r: 8, id: s.id });
    labels.push({ text: s.name, x, y, r: 3, priority: 5 - lenV(s.eq) / STAR_EXTENT, colour: C.sStar, id: s.id });
  }
}

function drawHelio(f, alpha) {
  const [sx, sy] = scr(f, ZERO);
  const rIn = OORT_CLOUD.innerAu * AU * f.k;
  const rOut = OORT_CLOUD.outerAu * AU * f.k;
  fillAnnulus(f, sx, sy, rIn, rOut, `rgba(140, 170, 255, ${0.07 * alpha})`);
  strokeCircle(f, sx, sy, rIn, C.sMuted, { dash: [2, 6], alpha: 0.5 * alpha });
  strokeCircle(f, sx, sy, rOut, C.sMuted, { dash: [2, 6], alpha: 0.5 * alpha });
  const lpO = rOut > 40 ? ringLabelPoint(f, sx, sy, (rIn + rOut) / 2) || ringLabelPoint(f, sx, sy, rIn) : null;
  if (lpO) labels.push({ text: OORT_CLOUD.label, x: lpO[0], y: lpO[1], r: 2, priority: 6, colour: C.sMuted, id: 'oort' });
  const rH = HELIOPAUSE.radiusAu * AU * f.k;
  strokeCircle(f, sx, sy, rH, C.sAccent, { dash: [5, 5], alpha: 0.7 * alpha });
  const lpH = rH > 30 ? ringLabelPoint(f, sx, sy, rH) : null;
  if (lpH) labels.push({ text: HELIOPAUSE.label, x: lpH[0], y: lpH[1], r: 2, priority: 6, colour: C.sAccent, id: 'heliopause' });
}

function drawCatalogueLimit(f, alpha) {
  const [sx, sy] = scr(f, ZERO);
  const r = CAT_LIMIT * f.k;
  strokeCircle(f, sx, sy, r, C.sWarn, { dash: [8, 6], alpha: 0.55 * alpha, width: 1.25 });
  const lp = r > 40 ? ringLabelPoint(f, sx, sy, r) : null;
  if (lp) labels.push({ text: 'Catalogue limit: beyond this, space is NOT empty, galaxies just aren\'t drawn here', x: lp[0], y: lp[1], r: 2, priority: 10, colour: C.sWarn, id: 'catlimit' });
}

let lastGalaxyStats = { count: 0, nearest: null };

function drawZoomView(f) {
  const size = (m) => m / f.mpp; // apparent size, device px
  const mwPx = size(MILKY_WAY_DIAMETER);
  const L = {
    earthmoon: A.layerAlpha(size(2 * EARTH_MOON_DISTANCE), 6),
    planets: A.layerAlpha(size(2 * NEPTUNE_A_AU * AU), 6),
    helio: A.layerAlpha(size(2 * OORT_CLOUD.outerAu * AU), 20),
    stars: f.wEG >= 1 ? A.layerAlpha(size(2 * STAR_EXTENT), 12) : 0,
    milkyway: A.layerAlpha(mwPx, 24, 4096),
    galaxies: f.wEG >= 1 ? A.layerAlpha(size(2 * CAT_LIMIT), 0, 50000) : 0,
  };
  state.layers = L;

  // Background stars (decorative): denser while we are inside the Milky Way, none between galaxies.
  const inside = A.smoothstep((Math.log10(mwPx) - Math.log10(3000)) / 1.2);
  const base = 0.9 * A.smoothstep((Math.log10(mwPx) - 1.7) / 1.0);
  drawStarfield(f, base, inside * (1 - 0.6 * L.planets));

  // Heliocentric reference grid while the camera rides with Earth (fades with the anchor blend).
  const gridAlpha = (1 - f.wAnchor) * 0.6;
  if (gridAlpha > 0.01) {
    const level = Math.log10(400 * f.mpp); // fine grid 40-400 px apart, coarse 400-4,000 px
    const fine = 10 ** Math.floor(level);
    drawHelioGrid(f, fine * 10, gridAlpha);
    drawHelioGrid(f, fine, gridAlpha * (1 - (level - Math.floor(level))));
  }

  lastGalaxyStats = { count: 0, nearest: null };
  if (L.galaxies > 0.01) {
    drawCatalogueLimit(f, L.galaxies);
    lastGalaxyStats = drawGalaxies(f, L.galaxies);
    captions.push('Galaxies: top view of the supergalactic plane · 2D projection, galaxies at different depths can overlap');
  }
  if (f.wEG >= 1) drawMarkers(f, 1);
  if (L.milkyway > 0.01) drawMilkyWay(f, L.milkyway);
  drawMilkyWayMarker(f);
  if (L.stars > 0.01) {
    drawStars(f, L.stars);
    if (L.planets < 0.5 && L.milkyway < 0.5) captions.push('Between stars space really is mostly empty. Only the nearest star systems are drawn; background stars are decorative.');
  }
  if (f.wEG >= 1) addPointerEq(f, 'gc', 'Galactic centre', GC_EQ, 6);
  if (L.helio > 0.01) drawHelio(f, L.helio);
  if (L.planets > 0.01) {
    drawBelt(f, L.planets);
    drawOrbits(f, L.planets);
  }
  drawSun(f, L.planets > 0.2);
  if (L.planets > 0.01) {
    drawPlanets(f, L.planets);
    drawMoonSystems(f, L.planets);
  }
  if (L.earthmoon > 0.01) drawMoon(f, L.earthmoon);
  drawPulse(f);
  if (f.wEG > 0 && f.wEG < 1) captions.push('Turning from the ecliptic (solar system) view to the galactic view');
  if (f.wGS > 0 && f.wGS < 1) captions.push('Turning from the galactic view to the supergalactic view');
  addEdgePointer(f);
}

/** "You are here" and the Milky Way marker when the disc is small, or when we are deep inside it. */
function drawMilkyWayMarker(f) {
  const mwDev = MILKY_WAY_DIAMETER / f.mpp;
  const [gx, gy] = scr(f, GC_EQ);
  const [sx, sy] = scr(f, ZERO);
  if (mwDev < 24) {
    const r = drawObject(f, gx, gy, MILKY_WAY_DIAMETER, C.sStar, {});
    if (r >= 0) {
      hits.push({ x: gx, y: gy, r: Math.max(9, r), id: 'mw' });
      labels.push({ text: `Milky Way (${pxText(mwDev)} px)`, x: gx, y: gy, r, priority: 10, colour: C.sStar, id: 'mw' });
      if (mwDev < 8) {
        const off = SUN_TO_GALACTIC_CENTRE / f.mpp;
        labels.push({ text: `You are here: the Sun is inside this pixel, about ${sig(off, 2)} px from its centre`, x: gx, y: gy + 16, r: 2, priority: 9.5, colour: C.sFg });
      }
    }
  } else if (f.wEG >= 1 && state.layers.planets < 0.5 && onCanvas(f, sx, sy)) {
    // Inside or near the Milky Way picture: mark the Sun's place in it.
    if (mwDev <= 4096) ringAt(sx, sy, C.sSun, 0.9);
    labels.push({ text: 'You are here, 26,700 ly from the galactic centre', x: sx, y: sy, r: 8, priority: 9.6, colour: C.sSun, id: 'sun' });
  }
}

/* ---------- Light pulse ---------- */

/** Earth view: ecliptic position of the light pulse (from the Sun towards where Earth was at emission). */
function pulseEcl() {
  const p = state.pulse.earth;
  if (!p) return null;
  const d = clamp((state.simTime - p.tEmit) * C_LIGHT, 0, p.distance);
  return { x: p.dir.x * d, y: p.dir.y * d };
}

function drawPulse(f) {
  const p = state.pulse[f.view];
  if (!p) return;
  const travelled = (state.simTime - p.tEmit) * C_LIGHT; // m
  if (travelled < 0) {
    state.pulse[f.view] = null;
    return;
  }
  const [sx, sy] = scr(f, ZERO);
  if (f.view === 'earth') {
    const pos = pulseEcl();
    const [x, y] = scrEcl(f, pos.x, pos.y);
    if (onCanvas(f, x, y, 6)) {
      ctx.fillStyle = C.sWarn;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, TAU);
      ctx.fill();
      labels.push({ text: 'Light pulse', x, y, r: 4, priority: 9, colour: C.sWarn });
    } else {
      addPointer(f, 'pulse', 'Light pulse', x, y, 20);
    }
    return;
  }
  // Galactic view: an expanding light sphere (ring) with a dot heading into view.
  const r = travelled * f.k;
  if (travelled > OBSERVABLE_UNIVERSE_RADIUS) {
    state.pulse.milkyway = null;
    updatePulseButtons();
    return;
  }
  strokeCircle(f, sx, sy, r, C.sWarn, { alpha: 0.7, width: 1.5 });
  const x = sx + p.dir.x * r;
  const y = sy - p.dir.y * r;
  if (onCanvas(f, x, y, 6)) {
    ctx.fillStyle = C.sWarn;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, TAU);
    ctx.fill();
  }
}

/* =========================================================================
 * 5. Overlays: labels, edge pointers, captions, scale bar, tooltip, info card
 * ====================================================================== */

/** Greedy label placement: higher priority first, skip a label if it would overlap. Labels with an id are clickable. */
function placeLabels(f) {
  labels.sort((a, b) => b.priority - a.priority);
  const placed = [];
  ctx.font = FONT_BOLD;
  ctx.textBaseline = 'middle';
  let n = 0;
  for (const l of labels) {
    if (n > 70) break;
    const tw = ctx.measureText(l.text).width;
    const gap = Math.max(4, l.r + 5);
    const options = [
      [l.x + gap, l.y, 'left'], [l.x - gap, l.y, 'right'],
      [l.x, l.y - gap - 8, 'center'], [l.x, l.y + gap + 8, 'center'],
      [l.x + gap, l.y + 20, 'left'], [l.x + gap, l.y - 20, 'left'],
      [l.x, l.y + gap + 28, 'center'], [l.x, l.y - gap - 28, 'center'],
    ];
    for (const [x, y, align] of options) {
      const x0 = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
      const rect = { x0: x0 - 3, y0: y - 9, x1: x0 + tw + 3, y1: y + 9 };
      if (rect.x0 < 2 || rect.x1 > f.w - 2 || rect.y0 < 2 || rect.y1 > f.h - 2) continue;
      if (placed.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0)) continue;
      placed.push(rect);
      ctx.fillStyle = C.sLabelBg;
      ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.fillStyle = l.colour || C.sFg;
      ctx.textAlign = 'left';
      ctx.fillText(l.text, x0, y + 0.5);
      if (l.id) hits.push({ x: x0 + tw / 2, y, r: 0, rect, id: l.id });
      n++;
      break;
    }
  }
  state.placedLabels = placed;
}

/** Queue an edge pointer for an object at screen (x, y) if it is off the canvas (or culled). */
function addPointer(f, id, name, x, y, priority = 1) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  if (onCanvas(f, x, y, -4) && devDist(f, x, y) < 1e5) return;
  pointers.push({ id, name, dx: x - f.w / 2, dy: y - f.h / 2, distDev: devDist(f, x, y), priority });
}
function addPointerEq(f, id, name, eq, priority) {
  const [x, y] = scr(f, eq);
  if (onCanvas(f, x, y, 8)) {
    if (id === 'gc' && MILKY_WAY_DIAMETER / f.mpp > 30) {
      hits.push({ x, y, r: 9, id });
      labels.push({ text: name, x, y, r: 4, priority: 7, colour: C.sFg, id });
      ctx.strokeStyle = C.sFg;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  addPointer(f, id, name, x, y, priority);
}

/** The observable universe edge: always shown as an extra pointer in the galactic view. */
function addEdgePointer(f) {
  const r = Math.hypot(f.cam.x, f.cam.y);
  const dir = r * f.k > 1 ? { x: f.cam.x / r, y: -f.cam.y / r } : { x: 0.7071, y: 0.7071 };
  const devPx = (OBSERVABLE_UNIVERSE_RADIUS - r) / f.mpp;
  if (devPx < Math.max(f.w, f.h) * f.dpr * 0.5) return; // edge on screen: nothing to point at
  state.edgePointer = { id: 'edge', name: OBSERVABLE_EDGE.name, dx: dir.x * 1e6, dy: dir.y * 1e6, distDev: devPx, priority: 0 };
}

function drawPointers(f) {
  const list = pointers.sort((a, b) => a.distDev - b.distDev).slice(0, 6);
  if (f.view === 'milkyway' && state.edgePointer) list.push(state.edgePointer);
  state.edgePointer = null;
  const placed = state.placedLabels || [];
  // Keep clear of the HTML overlays: time badge (top right), HUD (top centre), info card (top left).
  placed.push({ x0: f.w - 230, y0: 0, x1: f.w, y1: 44 });
  if (!$('travel-hud').hidden) placed.push({ x0: f.w / 2 - 260, y0: 0, x1: f.w / 2 + 260, y1: 44 });
  if (!infoEl.hidden) placed.push({ x0: 0, y0: 0, x1: infoEl.offsetWidth + 16, y1: infoEl.offsetHeight + 16 });
  ctx.font = FONT_BOLD;
  ctx.textBaseline = 'middle';
  for (const p of list) {
    const len = Math.hypot(p.dx, p.dy) || 1;
    const ux = p.dx / len;
    const uy = p.dy / len;
    const e = A.edgePoint(f.w, f.h, ux, uy, 14);
    // Arrow pointing outwards.
    ctx.fillStyle = p.id === 'pulse' ? C.sWarn : C.sAccent;
    ctx.beginPath();
    ctx.moveTo(e.x + ux * 8, e.y + uy * 8);
    ctx.lineTo(e.x - ux * 6 - uy * 6, e.y - uy * 6 + ux * 6);
    ctx.lineTo(e.x - ux * 6 + uy * 6, e.y - uy * 6 - ux * 6);
    ctx.closePath();
    ctx.fill();
    const screenM = p.distDev * f.pitch;
    const text = `${p.name}: ${pointerPx(p.distDev)} px = ${formatDistance(screenM)} from your screen at this scale`;
    const tw = Math.min(ctx.measureText(text).width, f.w - 40);
    // Label inside the canvas next to the arrow, nudged until it doesn't overlap.
    let lx = clamp(e.x - ux * 16 - tw / 2 - (ux > 0.5 ? tw / 2 : ux < -0.5 ? -tw / 2 : 0), 8, f.w - tw - 8);
    let ly = clamp(e.y - uy * 22, 14, f.h - 14);
    for (let tries = 0; tries < 12; tries++) {
      const rect = { x0: lx - 4, y0: ly - 10, x1: lx + tw + 4, y1: ly + 10 };
      if (!placed.some((q) => rect.x0 < q.x1 && rect.x1 > q.x0 && rect.y0 < q.y1 && rect.y1 > q.y0)) {
        placed.push(rect);
        break;
      }
      ly = clamp(ly + (uy > 0 ? -22 : 22), 14, f.h - 14);
    }
    ctx.fillStyle = C.sLabelBg;
    ctx.fillRect(lx - 4, ly - 10, tw + 8, 20);
    ctx.fillStyle = p.id === 'pulse' ? C.sWarn : C.sFg;
    ctx.textAlign = 'left';
    ctx.fillText(text, lx, ly + 0.5, tw);
    hits.push({ x: lx + tw / 2, y: ly, r: 0, rect: { x0: lx - 4, y0: ly - 10, x1: lx + tw + 4, y1: ly + 10 }, id: p.id, pointer: p });
  }
}
const pointerPx = (d) => (d >= 1e7 ? `${sigWords(d, 3)}` : fmt(d, 0));

function drawScaleBar(f) {
  const maxPx = Math.min(180, f.w * 0.3);
  const bar = A.niceWorldBar(maxPx / f.k);
  const px = bar.metres * f.k;
  const x = 14;
  const y = f.h - 14;
  ctx.strokeStyle = C.sFg;
  ctx.fillStyle = C.sFg;
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
  (state.placedLabels ||= []).push({ x0: 6, y0: y - 24, x1: x + Math.max(px, ctx.measureText(bar.label).width) + 6, y1: f.h });
  state.captionTop = y - 26;
}

function drawCaptions(f) {
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  let y = state.captionTop ?? f.h - 40;
  for (const c of captions.slice(-4).reverse()) {
    const tw = ctx.measureText(c).width;
    (state.placedLabels ||= []).push({ x0: 6, y0: y - 19, x1: 14 + Math.min(tw, f.w - 28) + 8, y1: y + 1 });
    ctx.fillStyle = C.sLabelBg;
    ctx.fillRect(10, y - 17, Math.min(tw, f.w - 28) + 8, 18);
    ctx.fillStyle = C.sMuted;
    ctx.fillText(c, 14, y - 2, f.w - 28);
    y -= 20;
  }
}

/* ---------- Tooltip ---------- */

const tipEl = $('space-tip');

/** Real distance from Earth (m) of an object at the current time. */
function distanceFromEarth(o, f = state.lastFrame) {
  if (o.distM !== undefined) return o.distM;
  const earthEq = f ? f.earthEq : eclToEq(bodiesAt(state.simTime).pos.earth);
  if (o.id === 'earth') return 0;
  return lenV(subV(o.eq(state.simTime), earthEq));
}

function objectText(id, f) {
  if (id.startsWith('orbit-')) {
    const p = PLANET_BY_ID[id.slice(6)];
    const a = p.a * AU;
    return {
      title: `${p.name}'s orbit is ${formatDistance(a / f.ratio)} from the Sun at this scale`,
      lines: [`Average radius ${formatWorldLength(a)}; one lap takes ${A.formatDuration(PERIOD[p.id])}. Drawn flat and approximate.`],
    };
  }
  const o = OBJECTS.get(id);
  if (!o) return null;
  const d = distanceFromEarth(o, f);
  const sd = d / f.ratio;
  const lines = [];
  if (id === 'earth') {
    lines.push(`Drawn ${formatDistance(EARTH_DIAMETER / f.ratio)} across (${pxText(EARTH_DIAMETER / f.mpp)} px). You are here.`);
    return { title: 'Earth', lines };
  }
  if (id === 'mw') {
    return { title: `The Milky Way is ${formatDistance(MILKY_WAY_DIAMETER / f.ratio)} across at this scale`, lines: [`About 100,000 light-years across (approximate); ${pxText(MILKY_WAY_DIAMETER / f.mpp)} px on your screen.`] };
  }
  lines.push(`Real distance from Earth: ${formatWorldLength(d)}; light takes ${lightTime(d)}.`);
  if (o.sizeM) lines.push(`Drawn ${formatDistance(o.sizeM / f.ratio)} across (${pxText(o.sizeM / f.mpp)} px).`);
  const hint = travelHint(sd);
  if (hint) lines.push(`Getting there at this scale: ${hint}.`);
  if (o.fromRedshift) lines.push('Distance from redshift: approximate.');
  return { title: `${o.name} is ${formatDistance(sd)} from your screen at this scale`, lines };
}

function hitAt(x, y) {
  let best = null;
  for (const h of hits) {
    if (h.rect) {
      if (x >= h.rect.x0 && x <= h.rect.x1 && y >= h.rect.y0 && y <= h.rect.y1) return h;
      continue;
    }
    const d = Math.hypot(x - h.x, y - h.y);
    if (d <= h.r && (!best || d < best.d)) best = { ...h, d };
  }
  if (best) return best;
  // Orbits (when the view is the flat ecliptic): distance to the ellipse along the radius.
  const f = state.lastFrame;
  if (f && f.wEG === 0 && (f.view !== 'milkyway' || (state.layers?.planets ?? 0) > 0.5)) {
    const wpt = screenToWorld(f, x, y); // ecliptic coordinates in this view
    const r = Math.hypot(wpt.x, wpt.y);
    const th = Math.atan2(wpt.y, wpt.x);
    for (const p of PLANETS) {
      const rOrbit = (p.a * AU * (1 - p.e * p.e)) / (1 + p.e * Math.cos(th - A.degToRad(p.varpi)));
      if (Math.abs(r - rOrbit) * f.k < 5) return { id: `orbit-${p.id}` };
    }
  }
  return null;
}

function updateTooltip() {
  const hv = state.hover;
  const f = state.lastFrame;
  const h = hv && f ? hitAt(hv.x, hv.y) : null;
  const info = h ? objectText(h.id, f) : null;
  if (!info) {
    tipEl.hidden = true;
    return;
  }
  tipEl.innerHTML = '<strong></strong>';
  tipEl.firstChild.textContent = info.title;
  for (const line of info.lines) {
    const span = document.createElement('span');
    span.textContent = line;
    tipEl.append(span);
  }
  if (OBJECTS.has(h.id)) {
    const span = document.createElement('span');
    span.className = 'space-tip-more';
    span.textContent = 'Click for facts';
    tipEl.append(span);
  }
  tipEl.hidden = false;
  const tw = tipEl.offsetWidth;
  const th = tipEl.offsetHeight;
  tipEl.style.left = `${clamp(hv.x + 14, 4, f.w - tw - 4)}px`;
  tipEl.style.top = `${clamp(hv.y + 14, 4, f.h - th - 4)}px`;
}

/* ---------- Info card ---------- */

const infoEl = $('info-card');

/** Descriptor for space-info.js. */
function infoDescriptor(id) {
  const o = OBJECTS.get(id);
  if (!o) return null;
  return {
    id, name: o.name, infoKey: o.infoKey || id, kind: o.galKind, star: o.row && o.kind === 'star' ? o.row : null,
    galaxy: o.galaxy || null, moon: o.moon || null, planet: o.planet || null, sizeM: o.sizeM, periodS: o.periodS, arm: o.arm || null,
  };
}

function openInfo(id) {
  if (id?.startsWith('orbit-')) id = id.slice(6);
  const d = infoDescriptor(id);
  if (!d) return;
  state.infoId = id;
  refreshInfo();
  infoEl.hidden = false;
  $('info-focus').hidden = !(state.view === 'system' && isSolarBody(id));
  $('info-pin').disabled = state.pinned.includes(id) || state.pinned.length >= 4;
  sim.requestDraw();
}
function refreshInfo() {
  const id = state.infoId;
  const f = state.lastFrame;
  if (!id || !f) return;
  const o = OBJECTS.get(id);
  const lines = [];
  if (id === 'earth') lines.push(`At this scale Earth is drawn ${formatDistance(EARTH_DIAMETER / f.ratio)} across.`);
  else if (o) {
    const d = distanceFromEarth(o, f);
    lines.push(`At this scale it is ${formatDistance(d / f.ratio)} from your screen${o.sizeM ? ` and drawn ${formatDistance(o.sizeM / f.ratio)} across` : ''}.`);
  }
  renderInfoCard(infoEl, infoFor(infoDescriptor(id)), lines);
}
function closeInfo() {
  state.infoId = null;
  infoEl.hidden = true;
  sim.requestDraw();
}
const isSolarBody = (id) => id === 'sun' || id === 'moon' || Boolean(PLANET_BY_ID[id]) || MOON_BY_ID.has(id);

/* =========================================================================
 * 6. Camera
 * ====================================================================== */

/* ---------- Solar-system view: zoom about the focus ---------- */

function setSysLog(log) {
  const r = sysRange();
  const L = clamp(log, r.lo, r.hi);
  state.sys.log = L >= r.hi - 1e-9 ? null : L; // null = "fit", which follows canvas resizes
  sim.requestDraw();
  schedulePanels();
}

/** Ease the solar-system zoom towards a target (decades relative to now). */
function sysZoomBy(decades) {
  const r = sysRange();
  const cur = state.sys.goal ?? sysLog();
  state.sys.goal = clamp(cur + decades, r.lo, r.hi);
}

/** Change the zoom focus with a short zoom-out "hop" so both bodies stay in view. */
function setFocus(id) {
  if (!isSolarBody(id) || id === state.sys.focus) return;
  const from = state.sys.focus;
  const mpp = viewMpp('system');
  const a = bodyEcl(from);
  const b = bodyEcl(id);
  const need = Math.hypot(b.x - a.x, b.y - a.y) / (0.6 * shortSide());
  const bump = Math.max(0, Math.log10(need) - Math.log10(mpp));
  state.sys.focus = id;
  state.sys.trans = { from, start: performance.now(), dur: clamp(2 + 1.2 * bump, 2, 12), bump };
  const sel = $('focus-select');
  if ([...sel.options].some((o) => o.value === id)) sel.value = id;
  else sel.value = '';
  announce(`Zoom focus: ${OBJECTS.get(id)?.name ?? id}.`);
  schedulePanels();
}

/* ---------- Earth view: travel, follow ---------- */

const isPannable = () => state.view === 'earth';

/** Pan by a screen delta in CSS px (drag right → the scene moves right). */
function panBy(dxCss, dyCss) {
  if (!isPannable()) return;
  const mpp = viewMpp();
  const dpr = dprNow();
  const off = state.offset.earth;
  state.offset.earth = { x: off.x - dxCss * dpr * mpp, y: off.y + dyCss * dpr * mpp };
  state.follow = null;
  state.travel = null;
  sim.requestDraw();
  schedulePanels();
}

/**
 * Earth-view travel: offset interpolated in SCREEN PIXELS towards a (possibly
 * moving) target, eased. target() returns the offset in metres from the anchor.
 */
function startTravel({ label, target, duration, followAfter = null }) {
  const mpp = viewMpp();
  const off = state.offset.earth;
  state.travel = { label, target, duration, followAfter, fromPx: { x: off.x / mpp, y: off.y / mpp }, start: performance.now() };
  state.follow = null;
  sim.requestDraw();
}

function stepTravel(now) {
  const tr = state.travel;
  if (!tr || state.view !== 'earth') return false;
  const tau = clamp((now - tr.start) / (tr.duration * 1000), 0, 1);
  const e = A.easeInOutCubic(tau);
  const tgt = tr.target();
  if (!tgt) {
    state.travel = null;
    return true;
  }
  const mpp = viewMpp();
  state.offset.earth = tau >= 1 ? { ...tgt } : {
    x: (tr.fromPx.x + (tgt.x / mpp - tr.fromPx.x) * e) * mpp,
    y: (tr.fromPx.y + (tgt.y / mpp - tr.fromPx.y) * e) * mpp,
  };
  if (tau >= 1) {
    state.travel = null;
    state.follow = tr.followAfter;
    schedulePanels();
  }
  return true;
}

/** Offset (m) from the Earth anchor to a body or the light pulse, in the Earth view. */
function offsetTo(kind, id) {
  const a = earthAnchorEcl();
  const p = kind === 'pulse' ? pulseEcl() : bodyEcl(id);
  return p ? { x: p.x - a.x, y: p.y - a.y } : null;
}

function flyToBody(id, label) {
  startTravel({ label, target: () => offsetTo('body', id), duration: 10, followAfter: { kind: 'body', id } });
  announce(`Flying to ${label}.`);
}
function backToEarth() {
  state.follow = null;
  startTravel({ label: 'Earth', target: () => ({ x: 0, y: 0 }), duration: 10 });
}
function recentre() {
  state.follow = null;
  startTravel({ label: 'Earth', target: () => ({ x: 0, y: 0 }), duration: 1 });
}
function followPulse() {
  if (!state.pulse.earth) togglePulse();
  startTravel({ label: 'the light pulse', target: () => offsetTo('pulse'), duration: 2, followAfter: { kind: 'pulse' } });
}

/* ---------- Galactic view: on rails ---------- */

/** Projected (screen-plane) vector from the anchor to a target, at zoom mpp. */
function anchorToTarget(mpp, targetEq) {
  const fr = A.zoomFrame(mpp, eclToEq(earthAnchorEcl()));
  const p = A.mulMV(fr.V, targetEq);
  const a = A.mulMV(fr.V, fr.anchorEq);
  return { x: p[0] - a[0], y: p[1] - a[1] };
}

/** Zoom so the anchor-to-target distance is 60% of the shorter canvas side; camera at their midpoint. */
function framedTarget(targetEqFn) {
  return () => {
    const lim = zoomLimits();
    let mpp = Math.max(lim.near, lenV(targetEqFn()) / (0.6 * shortSide()));
    for (let i = 0; i < 4; i++) {
      const v = anchorToTarget(mpp, targetEqFn());
      mpp = clamp(Math.hypot(v.x, v.y) / (0.6 * shortSide()), lim.near, lim.far);
    }
    const v = anchorToTarget(mpp, targetEqFn());
    return { log: Math.log10(mpp), off: { x: v.x / 2, y: v.y / 2 } };
  };
}
/** Ring/region target: the point `radius` to the right of its centre, framed as above. */
function framedRing(centreEqFn, radius) {
  return () => {
    const lim = zoomLimits();
    let mpp = clamp(radius / (0.6 * shortSide()), lim.near, lim.far);
    for (let i = 0; i < 3; i++) {
      const c = anchorToTarget(mpp, centreEqFn());
      mpp = clamp(Math.hypot(c.x + radius, c.y) / (0.6 * shortSide()), lim.near, lim.far);
    }
    const c = anchorToTarget(mpp, centreEqFn());
    return { log: Math.log10(mpp), off: { x: (c.x + radius) / 2, y: c.y / 2 } };
  };
}
/** At the far end (Milky Way = 1 px): pan to centre a marker. */
function farPan(id) {
  return () => {
    const log = Math.log10(MILKY_WAY_DIAMETER);
    return { log, off: MARKER[id] ? anchorToTarget(10 ** log, MARKER[id].eq) : { x: 0, y: 0 }, t: 1 };
  };
}

const moonEq = () => eclToEq(bodiesAt(state.simTime).moon);
/** The rail: places to visit, from Earth up to the Milky Way as one pixel, then the clusters. */
const STOPS = [
  { id: 'earth', label: 'Earth', target: () => ({ log: Math.log10(zoomLimits().near), off: { x: 0, y: 0 }, t: 0 }) },
  { id: 'moon', label: 'Moon', target: framedTarget(moonEq) },
  { id: 'earth1px', label: 'Earth = 1 pixel', target: () => ({ log: Math.log10(EARTH_DIAMETER), off: { x: 0, y: 0 } }) },
  { id: 'sun', label: 'Sun', target: framedTarget(() => ZERO) },
  { id: 'system', label: 'Solar system', target: () => ({ log: Math.log10(fitMpp(sim.view.width, sim.view.height, sim.view.dpr)), off: { x: 0, y: 0 } }) },
  { id: 'heliopause', label: 'Heliopause', target: framedRing(() => ZERO, HELIOPAUSE.radiusAu * AU) },
  { id: 'oort', label: 'Oort cloud', target: framedRing(() => ZERO, OORT_CLOUD.outerAu * AU) },
  ...(PROXIMA ? [{ id: 'proxima', label: 'Proxima Centauri', target: framedTarget(() => PROXIMA.eq) }] : []),
  { id: 'nearest', label: 'Nearest stars', target: framedRing(() => ZERO, 10 * LIGHT_YEAR) },
  { id: 'gc', label: 'Galactic centre', target: framedTarget(() => GC_EQ) },
  {
    id: 'milkyway', label: 'Milky Way',
    target: () => {
      const mpp = MILKY_WAY_DIAMETER / (0.6 * shortSide());
      return { log: Math.log10(mpp), off: anchorToTarget(mpp, GC_EQ) };
    },
  },
  ...(MARKER.andromeda ? [{ id: 'andromeda', label: 'Andromeda', target: framedTarget(() => MARKER.andromeda.eq) }] : []),
  ...(MARKER.localgroup ? [{ id: 'localgroup', label: 'Local Group', target: framedRing(() => MARKER.localgroup.eq, MARKER.localgroup.ringM) }] : []),
  { id: 'mw1px', label: 'Milky Way = 1 pixel', target: () => ({ log: Math.log10(MILKY_WAY_DIAMETER), off: { x: 0, y: 0 }, t: 1 }) },
  ...['virgo', 'greatattractor', 'laniakea', 'coma'].filter((id) => MARKER[id]).map((id) => ({
    id, label: { virgo: 'Virgo Cluster', greatattractor: 'Great Attractor', laniakea: 'Laniakea', coma: 'Coma Cluster' }[id], target: farPan(id),
  })),
];
const START_STOP = STOPS.findIndex((s) => s.id === 'mw1px');
state.rail.s = START_STOP;

let railCache = { key: '', at: 0, L: [0] };
/** Cumulative rail lengths (cached: they only change with the canvas, calibration and, slowly, time). */
function railLengths() {
  const key = `${sim.view.width}x${sim.view.height}@${sim.view.dpr}/${devicePxPerMetre()}`;
  const now = performance.now();
  if (railCache.key !== key || now - railCache.at > 2000) {
    railCache = { key, at: now, L: A.railLengths(STOPS.map((s) => s.target().log), { panLen: 5 }) };
  }
  return railCache.L;
}

/** Set the galactic camera (zoom t and offset) from the rail position: interpolate between neighbouring stops. */
function applyRail() {
  const last = STOPS.length - 1;
  const s = clamp(state.rail.s, 0, last);
  const i = Math.min(last - 1, Math.floor(s));
  const fr = s - i;
  const a = STOPS[i].target();
  const b = STOPS[i + 1].target();
  const lim = zoomLimits();
  const log = a.log + (b.log - a.log) * fr;
  let t = clamp(A.tFromMetresPerPx(10 ** log, lim), 0, 1);
  if (fr === 0 && a.t !== undefined) t = a.t;
  if (s === last && b.t !== undefined) t = b.t;
  state.zoomT = t;
  const mpp = A.metresPerPx(t, lim);
  const pa = { x: a.off.x / 10 ** a.log, y: a.off.y / 10 ** a.log };
  const pb = { x: b.off.x / 10 ** b.log, y: b.off.y / 10 ** b.log };
  state.offset.milkyway = { x: (pa.x + (pb.x - pa.x) * fr) * mpp, y: (pa.y + (pb.y - pa.y) * fr) * mpp };
}

const nearestStop = () => Math.round(clamp(state.rail.s, 0, STOPS.length - 1));

/** Animate along the rail to stop index j (slow, eased; passes through the stops in between). */
function railGo(j) {
  const L = railLengths();
  const to = clamp(j, 0, STOPS.length - 1);
  const fromLen = A.railLengthFromS(L, state.rail.s);
  const toLen = L[to];
  if (Math.abs(toLen - fromLen) < 1e-6) return;
  state.rail.goal = null;
  state.rail.anim = { fromLen, toLen, to, start: performance.now(), dur: A.railDuration(Math.abs(toLen - fromLen)), label: STOPS[to].label };
  announce(`Going to ${STOPS[to].label}.`);
  sim.requestDraw();
}
function railStep(dir) {
  const s = state.rail.anim ? state.rail.anim.to : state.rail.s;
  railGo(dir > 0 ? Math.floor(s + 1e-6) + 1 : Math.ceil(s - 1e-6) - 1);
}

/** Distance (m, screen plane) between the camera now and the end of the current animation. */
function remainingDistance() {
  const f = state.lastFrame;
  if (!f) return 0;
  if (state.view === 'milkyway' && state.rail.anim) {
    const tgt = STOPS[state.rail.anim.to].target();
    const lim = zoomLimits();
    const t = tgt.t ?? clamp(A.tFromMetresPerPx(10 ** tgt.log, lim), 0, 1);
    const fr = A.zoomFrame(A.metresPerPx(t, lim), eclToEq(earthAnchorEcl()), tgt.off);
    return Math.hypot(fr.cam.x - f.cam.x, fr.cam.y - f.cam.y);
  }
  const tr = state.travel;
  if (!tr) return 0;
  const tgt = tr.target();
  return tgt ? Math.hypot(tgt.x - state.offset.earth.x, tgt.y - state.offset.earth.y) : 0;
}

/* ---------- Light pulse ---------- */

function togglePulse() {
  const v = state.view;
  if (state.pulse[v]) {
    state.pulse[v] = null;
    if (state.follow?.kind === 'pulse') state.follow = null;
  } else if (v === 'earth') {
    const e = bodiesAt(state.simTime).pos.earth;
    const d = Math.hypot(e.x, e.y);
    state.pulse.earth = { tEmit: state.simTime, dir: { x: e.x / d, y: e.y / d }, distance: d };
  } else if (v === 'milkyway') {
    const f = state.lastFrame;
    const r = f ? Math.hypot(f.cam.x, f.cam.y) : 0;
    const dir = f && r * f.k > 20 ? { x: f.cam.x / r, y: f.cam.y / r } : { x: 1, y: 0 };
    state.pulse.milkyway = { tEmit: state.simTime, dir };
  }
  updatePulseButtons();
  sim.requestDraw();
}
function updatePulseButtons() {
  const on = Boolean(state.pulse[state.view]);
  const b = $('pulse-btn');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? 'Stop light pulse' : 'Light pulse';
  const fb = $('follow-pulse-btn');
  const following = state.follow?.kind === 'pulse';
  fb.setAttribute('aria-pressed', String(following));
  fb.textContent = following ? 'Following the pulse' : 'Follow the pulse';
}

/* ---------- Per-frame animation (runs paused or not) ---------- */

function animate(dt) {
  const now = performance.now();
  syncFreeze(now); // pause / play can change "too fast"
  let changed = stepTravel(now);

  // Solar-system view: focus hop and eased zoom.
  const sys = state.sys;
  if (sys.trans) {
    if (now - sys.trans.start >= sys.trans.dur * 1000) sys.trans = null;
    changed = true;
  }
  if (sys.goal !== null && state.view === 'system') {
    const cur = sysLog();
    const next = cur + (sys.goal - cur) * (1 - Math.exp(-dt / 0.18));
    setSysLog(Math.abs(sys.goal - next) < 1e-4 ? sys.goal : next);
    if (Math.abs(sys.goal - next) < 1e-4) sys.goal = null;
    changed = true;
  }

  // Galactic view: rail animation or eased wheel movement.
  const rail = state.rail;
  if (rail.anim) {
    const L = railLengths();
    const tau = clamp((now - rail.anim.start) / (rail.anim.dur * 1000), 0, 1);
    const len = rail.anim.fromLen + (rail.anim.toLen - rail.anim.fromLen) * A.easeInOutCubic(tau);
    rail.s = tau >= 1 ? rail.anim.to : A.railSFromLength(L, len);
    if (tau >= 1) {
      rail.anim = null;
      schedulePanels();
    }
    changed = true;
  } else if (rail.goal !== null) {
    const L = railLengths();
    const cur = A.railLengthFromS(L, rail.s);
    const next = cur + (rail.goal - cur) * (1 - Math.exp(-dt / 0.18));
    rail.s = A.railSFromLength(L, Math.abs(rail.goal - next) < 1e-4 ? rail.goal : next);
    if (Math.abs(rail.goal - next) < 1e-4) rail.goal = null;
    schedulePanels();
    changed = true;
  }

  // Earth view: keep following a body or the light pulse.
  if (state.follow && state.view === 'earth' && !state.travel) {
    const off = offsetTo(state.follow.kind, state.follow.id);
    if (off) state.offset.earth = off;
    else state.follow = null;
    changed = true;
  }
  if (state.freeze.glide) changed = true;
  if (state.pulse[state.view] && !sim.paused) changed = true;
  return changed;
}

/** Sim step: advance the clock (frame dt already clamped to 0.1 s by simkit). */
function step(dt) {
  syncFreeze(); // before time moves on, so a switch to a fast rate can't jump the camera
  state.simTime = A.advanceSimTime(state.simTime, dt, rateS());
  // Earth trail: sample every 50 ms of real time, keep the last 2 s.
  state.trailClock += dt;
  if (state.trailClock >= 0.05) {
    state.trailClock = 0;
    const e = bodiesAt(state.simTime).pos.earth;
    state.trail.push({ x: e.x, y: e.y });
    if (state.trail.length > 40) state.trail.shift();
  }
  // Light pulse in the Earth view: shows "reached Earth" for 3 real seconds, then stops.
  const p = state.pulse.earth;
  if (p && state.simTime - p.tEmit > p.distance / C_LIGHT + 3 * rateS()) {
    state.pulse.earth = null;
    if (state.follow?.kind === 'pulse') state.follow = null;
    updatePulseButtons();
  }
}

/* =========================================================================
 * 7. Readouts, scale equivalents, pixel card line, HUDs, aria
 * ====================================================================== */

let panelTimer = 0;
let panelsDue = true;
function schedulePanels() {
  panelsDue = true;
}
function throttledPanels(f) {
  const now = performance.now();
  if (!panelsDue && now - panelTimer < 250) return;
  panelTimer = now;
  panelsDue = false;
  updateReadouts(f);
  updateEquivalents(f);
  updatePixelLine(f);
  updateSliders(f);
  if (state.infoId) refreshInfo();
}

function updateReadouts(f) {
  const pxW = formatWorldLength(f.mpp);
  setText(outputs.pxIs, `1 px = ${pxW}`);
  setText(outputs.scaleSub, `1 cm of your screen = ${formatWorldLength(f.ratio * 0.01)} (scale 1 : ${sigWords(f.ratio, 3)})`);
  setText(outputs.screenSpan, formatWorldLength(screen.width * f.dpr * f.mpp));
  setText(outputs.pxWorld, pxW);

  if (f.view === 'system') {
    setText(outputs.sunPx, pxText(SUN_DIAMETER / f.mpp));
    setText(outputs.earthPx, pxText(EARTH_DIAMETER / f.mpp));
    setText(outputs.canvasAu, sig((f.w * f.dpr * f.mpp) / AU, 3));
    setText(outputs.sysFocus, OBJECTS.get(state.sys.focus)?.name ?? 'Sun');
    const fs = fitMpp(screen.width || f.w, screen.height || f.h, f.dpr);
    setText(outputs.fsScale, `1 px = ${formatWorldLength(fs)}`);
    if (PROXIMA) {
      const d = lenV(PROXIMA.eq);
      setText(outputs.proximaLine, `Proxima Centauri would be ${formatDistance(d / f.ratio)} from your screen (${sigWords(d / f.mpp / (f.w * f.dpr), 3)} canvas widths away).`);
    }
  } else if (f.view === 'earth') {
    // Speed from the Kepler orbit (finite difference over one minute of sim time).
    const e0 = A.planetPosition(EARTH_EL, f.t - 30);
    const e1 = A.planetPosition(EARTH_EL, f.t + 30);
    const v = Math.hypot(e1.x - e0.x, e1.y - e0.y) / 60;
    const pxPerS = (v / f.mpp) * rateS();
    setText(outputs.earthPxS, pxPerS >= 100 ? fmt(pxPerS, 0) : sig(pxPerS, 3));
    setText(outputs.earthPxSSub, pxPerS < 0.1 ? 'so it looks frozen in real time' : `at ${RATES[state.rateId].name} per second`);
    setText(outputs.earthKms, fmt(v / 1000, 2));
    const d = Math.hypot(f.B.pos.earth.x, f.B.pos.earth.y);
    setText(outputs.sunDistPx, fmt(d / f.mpp, 0));
    setText(outputs.sunDistSub, `${fmt(d / AU, 4)} AU · ${fmt(d / C_LIGHT / 60, 2)} light-minutes · ${formatDistance(d / f.ratio)} from your screen`);
    const m = bodiesAt(f.t).pos.mars;
    const dm = Math.hypot(m.x - f.B.pos.earth.x, m.y - f.B.pos.earth.y);
    setText(outputs.marsDist, `${fmt(dm / f.mpp, 0)} px`);
    setText(outputs.marsSub, `${fmt(dm / AU, 3)} AU · light takes ${lightTime(dm)} · ${formatDistance(dm / f.ratio)} from your screen`);
  } else {
    const lim = zoomLimits();
    const D = A.zoomDecades(lim);
    setText(outputs.zoomPow, `1 px = 10^${fmt(Math.log10(f.mpp), 1)} m`);
    setText(outputs.zoomSub, `${fmt(state.zoomT * D, 1)} of ${fmt(D, 1)} powers of ten from the Earth end · near: ${STOPS[nearestStop()].label}`);
    setText(outputs.spanW, `${formatWorldLength(f.w * f.dpr * f.mpp)} wide`);
    setText(outputs.spanH, `${formatWorldLength(f.h * f.dpr * f.mpp)} high`);
    setText(outputs.appEarth, `Earth appears ${formatDistance(EARTH_DIAMETER / f.ratio)} wide`);
    setText(outputs.appSun, `Sun appears ${formatDistance(SUN_DIAMETER / f.ratio)} wide`);
    setText(outputs.appMw, `Milky Way appears ${formatDistance(MILKY_WAY_DIAMETER / f.ratio)} wide`);
    setText(outputs.galCount, `${fmt(lastGalaxyStats.count, 0)} of ${fmt(GAL_N + MARKER_LIST.filter((m) => m.kind === 'galaxy').length, 0)}`);
    const frameName = f.wGS >= 1 ? 'Supergalactic' : f.wGS > 0 ? 'Galactic → supergalactic' : f.wEG >= 1 ? 'Galactic' : f.wEG > 0 ? 'Ecliptic → galactic' : 'Ecliptic';
    setText(outputs.frame, frameName);
    setText(outputs.frameSub, f.wGS >= 1 ? 'Local Supercluster plane from above' : f.wEG >= 1 ? 'Milky Way plane from above, galactic north towards you' : 'Solar system from above');
    updateNearest(f);
  }
  if (f.view !== 'system') {
    const off = state.offset[f.view];
    const r = Math.hypot(off.x, off.y);
    setText(outputs.camOff, r === 0 ? 'Centred' : `${fmt(r / f.mpp, 0)} px = ${formatWorldLength(r)} = ${formatDistance(r / f.ratio)} from your screen`);
  }
}

/** Nearest catalogued object to the screen centre, and the emptiness caption. */
function updateNearest(f) {
  let best = null;
  const consider = (id, name, eq) => {
    const [x, y] = scr(f, eq);
    const d = devDist(f, x, y);
    if (!best || d < best.d) best = { id, name, d };
  };
  if (f.wEG >= 1) {
    if ((state.layers?.stars ?? 0) > 0.5) for (const s of STARS) consider(s.id, s.name, s.eq);
    for (const m of MARKER_LIST) consider(m.id, m.name, m.eq);
    if (lastGalaxyStats.nearest) {
      const i = lastGalaxyStats.nearest.i;
      consider(`gal-${i}`, prettyName(galRows[i][0]), [galPos[i * 3], galPos[i * 3 + 1], galPos[i * 3 + 2]]);
    }
  }
  // Bodies only count while the solar system is drawn (otherwise the Sun is trivially at the centre).
  if ((state.layers?.planets ?? 1) > 0.5) {
    consider('sun', 'Sun', ZERO);
    for (const p of PLANETS) consider(p.id, p.name, eclToEq(f.B.pos[p.id]));
  }
  if (!best) return;
  setText(outputs.nearest, `${best.name}: ${pointerPx(best.d)} px from the centre = ${formatDistance(best.d * f.pitch)} from it on your screen`);
  const L = state.layers || {};
  let note = 'Planets are tiny dots separated by huge gaps.';
  if (L.galaxies > 0.3) note = 'Beyond the catalogue limit space is NOT empty, objects just aren\'t drawn here.';
  else if (L.planets < 0.5) note = 'Between stars space really is mostly empty. Only the nearest star systems are drawn.';
  setText(outputs.emptiness, note);
}

/* ---------- Scale equivalents ---------- */

const pickSelect = $('pick-select');
const pinBtn = $('pin-btn');

/** A row: { label, value } for an object id (or one of the fixed special rows). */
function equivRow(id, f) {
  const sd = (m) => formatDistance(m / f.ratio);
  const world = (m) => formatWorldLength(m);
  const hint = (m) => {
    const h = travelHint(m / f.ratio);
    return h ? ` · ${h}` : '';
  };
  switch (id) {
    case 'neptune-orbit': {
      const m = NEPTUNE_A_AU * AU;
      return { label: 'Neptune\'s orbit (radius)', value: `${sd(m)} (${world(m)})${hint(m)}` };
    }
    case 'moon-orbit':
      return { label: 'Moon (orbit radius)', value: `${sd(EARTH_MOON_DISTANCE)} (${world(EARTH_MOON_DISTANCE)})${hint(EARTH_MOON_DISTANCE)}` };
    case 'sun':
      return { label: 'Sun', value: `${sd(AU)} away, ${sd(SUN_DIAMETER)} across${hint(AU)}` };
    case 'proxima':
      return PROXIMA ? equivRow(PROXIMA.id, f) : null;
    case 'sirius':
      return SIRIUS ? equivRow(SIRIUS.id, f) : null;
    case 'mw':
      return { label: 'Milky Way (diameter, approximate)', value: `${sd(MILKY_WAY_DIAMETER)} across${hint(MILKY_WAY_DIAMETER)}` };
    case 'laniakea': {
      const m = MARKER.laniakea;
      if (!m) return null;
      return { label: 'Laniakea (diameter)', value: `${sd(2 * m.ringM)} across (${world(2 * m.ringM)})${hint(2 * m.ringM)}` };
    }
    case 'edge':
      return { label: 'Observable universe edge', value: `${sd(OBSERVABLE_UNIVERSE_RADIUS)} away, ${sd(OBSERVABLE_UNIVERSE_DIAMETER)} across${hint(OBSERVABLE_UNIVERSE_RADIUS)}` };
    default: {
      const o = OBJECTS.get(id);
      if (!o) return null;
      const d = distanceFromEarth(o, f);
      return { label: o.name, value: `${sd(d)} from your screen (${world(d)})${hint(d)}` };
    }
  }
}

function renderRows(list, ids, f, pinned = false) {
  const rows = ids.map((id) => [id, equivRow(id, f)]).filter(([, r]) => r);
  // Rebuild only when the set of rows changes; otherwise update text in place.
  const key = rows.map(([id]) => id).join('|');
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.textContent = '';
    for (const [id] of rows) {
      const li = document.createElement('li');
      li.dataset.id = id;
      li.innerHTML = '<span class="equiv-label"></span><span class="equiv-value"></span>';
      if (pinned) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-small btn-ghost';
        b.textContent = 'Unpin';
        b.addEventListener('click', () => {
          state.pinned = state.pinned.filter((p) => p !== id);
          savePins();
          schedulePanels();
          sim.requestDraw();
        });
        li.append(b);
      }
      list.append(li);
    }
  }
  [...list.children].forEach((li, i) => {
    const r = rows[i][1];
    setText(li.querySelector('.equiv-label'), r.label);
    setText(li.querySelector('.equiv-value'), r.value);
  });
}

function updateEquivalents(f) {
  renderRows($('equiv-fixed'), FIXED_ROWS[f.view], f);
  renderRows($('equiv-pinned'), state.pinned, f, true);
  const id = pickSelect.value;
  const r = id ? equivRow(id, f) : null;
  setText($('pick-out'), r ? `${r.label}: ${r.value}` : '');
  pinBtn.disabled = !id || state.pinned.includes(id) || state.pinned.length >= 4;
  pinBtn.textContent = state.pinned.length >= 4 ? 'Pin (4 max)' : 'Pin';
}

function pin(id) {
  if (!id || state.pinned.includes(id) || state.pinned.length >= 4) return;
  state.pinned.push(id);
  savePins();
  schedulePanels();
  sim.requestDraw();
}

function buildPickList() {
  const groups = new Map();
  for (const o of OBJECTS.values()) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group).push(o);
  }
  pickSelect.textContent = '';
  for (const [name, list] of groups) {
    const og = document.createElement('optgroup');
    og.label = name;
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      og.append(opt);
    }
    pickSelect.append(og);
  }
  pickSelect.value = PROXIMA ? PROXIMA.id : 'sun';
}

/** Focus choices: the Sun, planets, Earth's Moon and the moons with a measured size. */
function buildFocusList() {
  const sel = $('focus-select');
  const add = (parent, id, name) => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = name;
    parent.append(o);
  };
  add(sel, 'sun', 'Sun');
  const g1 = document.createElement('optgroup');
  g1.label = 'Planets';
  for (const p of PLANETS) add(g1, p.id, p.name);
  sel.append(g1);
  const g2 = document.createElement('optgroup');
  g2.label = 'Moons';
  add(g2, 'moon', 'Moon (Earth)');
  for (const m of MOONS.filter((q) => q.major)) add(g2, m.id, `${m.name} (${PLANET_BY_ID[m.planet].name})`);
  sel.append(g2);
  add(sel, '', 'Other (clicked on the map)');
  sel.lastChild.disabled = true;
  sel.value = 'sun';
}

/* ---------- Pixel card line ---------- */

let pixelLineText = '';
function pixelLineFor(f) {
  if (!f) return '';
  const { closest } = referenceLadder(f.pitch);
  const about = closest ? `, about the size of a ${closest.name}` : '';
  const pitch = smallLength(f.pitch);
  if (f.view === 'earth') return `Earth is drawn as one pixel: about ${pitch} across on your screen${about}.`;
  if (f.view === 'milkyway') {
    if (state.zoomT >= 0.9999) return `The entire Milky Way is drawn as one pixel: about ${pitch} across on your screen${about}.`;
    if (state.zoomT <= 0.0001) return 'Earth is drawn about 2 cm across, about the size of a large marble.';
    return `At this zoom 1 pixel (${pitch}) covers ${formatWorldLength(f.mpp)}; Earth is drawn ${formatDistance(EARTH_DIAMETER / f.ratio)} across.`;
  }
  return `At this zoom 1 pixel (${pitch}) covers ${formatWorldLength(f.mpp)}.`;
}
function updatePixelLine(f) {
  const text = pixelLineFor(f);
  if (text !== pixelLineText) {
    pixelLineText = text;
    sim.pixelCard?.update();
  }
}

/* ---------- HUDs ---------- */

function updateHuds(f) {
  const hud = $('travel-hud');
  const label = state.view === 'milkyway' ? state.rail.anim?.label : state.travel && state.travel.duration > 1 ? state.travel.label : null;
  if (label) {
    const d = remainingDistance();
    hud.hidden = false;
    setText(hud, `Travelling to ${label}: ${pointerPx(d / f.mpp)} px to go = ${formatDistance(d / f.ratio)} from your screen · light would take ${lightTime(d)}`);
  } else {
    hud.hidden = true;
  }
  const ph = $('pulse-hud');
  const p = state.pulse[f.view];
  if (p) {
    const dt = state.simTime - p.tEmit;
    const dist = dt * C_LIGHT;
    ph.hidden = false;
    if (f.view === 'earth') {
      const total = p.distance / C_LIGHT;
      setText(ph, dt < total
        ? `Light pulse: ${fmt(dt, 0)} s since leaving the Sun, reaches Earth after ${fmt(total, 0)} s (${fmt(dist / f.mpp, 0)} of ${fmt(p.distance / f.mpp, 0)} px)`
        : `Light pulse reached Earth after ${fmt(total, 0)} s`);
    } else {
      setText(ph, `Light pulse: ${A.formatDuration(dt)} since leaving the Sun, ${formatWorldLength(dist)} travelled (${pointerPx(dist / f.mpp)} px)`);
    }
  } else {
    ph.hidden = true;
  }
  const badge = $('rate-badge');
  setText(badge, (sim.paused ? 'PAUSED · ' : '') + A.rateLabel(rateS(), RATES[state.rateId].name));
  badge.classList.toggle('is-slow', rateS() !== 1);
  updatePulseButtons();
}

/* ---------- Sliders, stop buttons, scale badge ---------- */

const railRange = $('rail-range');
const sysRangeEl = $('sys-range');
function updateSliders(f) {
  if (f.view === 'milkyway') {
    const L = railLengths();
    const total = L[L.length - 1] || 1;
    if (document.activeElement !== railRange) railRange.value = String(Math.round((A.railLengthFromS(L, state.rail.s) / total) * 1000));
    railRange.setAttribute('aria-valuetext', `Near ${STOPS[nearestStop()].label}; 1 pixel = ${formatWorldLength(f.mpp)}`);
    const k = nearestStop();
    const at = Math.abs(state.rail.s - k) < 0.02;
    for (const b of document.querySelectorAll('[data-stop]')) b.classList.toggle('is-current', at && Number(b.dataset.stop) === k);
  } else if (f.view === 'system') {
    const r = sysRange();
    const frac = (sysLog() - r.lo) / (r.hi - r.lo || 1);
    if (document.activeElement !== sysRangeEl) sysRangeEl.value = String(Math.round(frac * 1000));
    sysRangeEl.setAttribute('aria-valuetext', `1 pixel = ${formatWorldLength(f.mpp)}, focus ${OBJECTS.get(state.sys.focus)?.name ?? 'Sun'}`);
  }
}

function updateScaleBadge() {
  const b = $('scale-badge');
  const { text, ok } = scaleBadge(sim.scale);
  setText(b, state.view === 'milkyway' && !ok ? `${text} (Earth's 2 cm is approximate)` : text);
}

function describe() {
  const f = state.lastFrame;
  const mpp = sim.view ? viewMpp() : MILKY_WAY_DIAMETER;
  if (state.view === 'system') {
    return `Solar system seen from above, scaled to your screen: 1 pixel is ${formatWorldLength(mpp)}. The Sun is ${pxText(SUN_DIAMETER / mpp)} pixels across. Zoom focus: ${OBJECTS.get(state.sys.focus)?.name ?? 'Sun'}. ${state.drawMode === 'true' ? 'True size mode.' : 'Markers mode: only the orbits are to scale.'}`;
  }
  if (state.view === 'earth') {
    return `Earth drawn as one pixel. The Sun is ${fmt(SUN_DIAMETER / EARTH_DIAMETER, 1)} pixels wide and about ${fmt(AU / EARTH_DIAMETER, 0)} pixels away, off screen; an arrow at the edge points to it. The Moon circles ${fmt(EARTH_MOON_DISTANCE / EARTH_DIAMETER, 1)} pixels from Earth.`;
  }
  return `Galactic scale, near ${STOPS[nearestStop()].label}: 1 pixel is ${formatWorldLength(mpp)}.${f ? ` ${lastGalaxyStats.count} catalogued galaxies on screen.` : ''}`;
}

/* =========================================================================
 * 8. Wiring + start
 * ====================================================================== */

const sim = createSim({
  step,
  draw,
  describe,
  animate,
  colorsFrom: wrapEl,
  colorVars: {
    sFg: '--space-fg', sMuted: '--space-muted', sGrid: '--space-grid', sAccent: '--space-accent',
    sSun: '--space-sun', sStar: '--space-star', sGalaxy: '--space-galaxy', sMarker: '--space-marker',
    sWarn: '--space-warn', sLabelBg: '--space-label-bg',
  },
  onResize: () => schedulePanels(),
  onScaleChange: () => {
    // The galactic zoom limits depend on the pixel size; the rail recomputes them every frame.
    updateScaleBadge();
    schedulePanels();
  },
  onFullscreenChange: () => schedulePanels(),
  pixelLine: () => pixelLineText,
  debug: {
    state, makeFrame, STOPS, railGo, setFocus, openInfo, A, OBJECTS, viewMpp, MOONS,
    /** Run one frame synchronously (for scripted checks), in simkit's order: step, animate, draw. */
    renderFrame(dt = 1 / 60) {
      if (!sim.paused) step(dt);
      animate(dt);
      const v = sim.view;
      v.ctx.clearRect(0, 0, v.width, v.height);
      draw(v.ctx, v.width, v.height, 0, sim.colors);
      return state.lastFrame;
    },
  },
});

/* Views */
initTabs({
  name: 'view',
  values: ['system', 'earth', 'milkyway'],
  onChange(view) {
    const changed = state.view !== view;
    state.view = view;
    state.travel = null;
    state.rail.anim = null;
    state.rail.goal = null;
    state.sys.goal = null;
    state.hover = null;
    // Keep the time rate if this view offers it, otherwise the nearest slower one.
    if (!VIEW_RATES[view].includes(state.rateId)) {
      const allowed = VIEW_RATES[view];
      let id = allowed[0];
      for (const r of Object.keys(RATES)) if (allowed.includes(r) && RATES[r].s <= RATES[state.rateId].s) id = r;
      setRate(id);
    }
    if (state.infoId) $('info-focus').hidden = !(view === 'system' && isSolarBody(state.infoId));
    updatePulseButtons();
    updateScaleBadge();
    schedulePanels();
    sim.updateAria();
    sim.requestDraw();
    if (changed) announce(describe());
  },
});

function setRate(id) {
  state.rateId = id;
  const radio = document.querySelector(`input[name="rate"][value="${id}"]`);
  if (radio) radio.checked = true;
  schedulePanels();
  sim.requestDraw();
}
for (const radio of document.querySelectorAll('input[name="rate"]')) {
  radio.addEventListener('change', () => {
    setRate(radio.value);
    announce(`Time rate: ${A.rateLabel(rateS(), RATES[state.rateId].name).toLowerCase()}.`);
  });
}

const MODE_CAPTION = {
  markers: 'Markers: objects smaller than a few pixels get a labelled ring so you can find them (sizes not to scale, positions are).',
  true: 'True size: everything at its real size; anything under one pixel is a single pixel as bright as the fraction of the pixel it would cover, so the Sun can be a faint dot.',
};
for (const radio of document.querySelectorAll('input[name="drawmode"]')) {
  radio.addEventListener('change', () => {
    state.drawMode = radio.value;
    setText($('mode-caption'), MODE_CAPTION[state.drawMode]);
    sim.updateAria();
    sim.requestDraw();
    announce(MODE_CAPTION[state.drawMode]);
  });
}
setText($('mode-caption'), MODE_CAPTION.markers);

/* Earth view buttons */
$('recentre-btn').addEventListener('click', recentre);
$('fly-sun-btn').addEventListener('click', () => flyToBody('sun', 'the Sun'));
$('fly-mars-btn').addEventListener('click', () => flyToBody('mars', 'Mars'));
$('back-earth-btn').addEventListener('click', backToEarth);
$('pulse-btn').addEventListener('click', togglePulse);
$('follow-pulse-btn').addEventListener('click', () => {
  if (state.follow?.kind === 'pulse') state.follow = null;
  else followPulse();
  updatePulseButtons();
});

/* Solar-system zoom controls */
buildFocusList();
$('focus-select').addEventListener('change', (e) => {
  if (e.target.value) setFocus(e.target.value);
});
$('sys-zoom-in').addEventListener('click', () => sysZoomBy(-1));
$('sys-zoom-out').addEventListener('click', () => sysZoomBy(1));
sysRangeEl.addEventListener('input', () => {
  state.sys.goal = null;
  const r = sysRange();
  setSysLog(r.lo + (Number(sysRangeEl.value) / 1000) * (r.hi - r.lo));
});
$('sys-reset').addEventListener('click', () => {
  setFocus('sun');
  state.sys.goal = sysRange().hi;
});

/* Galactic rail controls: places to visit, zoom in / out between them, slider */
const stopsEl = $('rail-stops');
STOPS.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-small stop-btn';
  b.dataset.stop = String(i);
  b.textContent = s.label;
  b.addEventListener('click', () => railGo(i));
  stopsEl.append(b);
});
$('rail-in').addEventListener('click', () => railStep(-1));
$('rail-out').addEventListener('click', () => railStep(1));
railRange.addEventListener('input', () => {
  state.rail.anim = null;
  state.rail.goal = null;
  const L = railLengths();
  state.rail.s = A.railSFromLength(L, (Number(railRange.value) / 1000) * L[L.length - 1]);
  sim.requestDraw();
  schedulePanels();
});

/* Info card */
$('info-close').addEventListener('click', closeInfo);
$('info-pin').addEventListener('click', () => {
  pin(state.infoId);
  $('info-pin').disabled = true;
});
$('info-focus').addEventListener('click', () => {
  if (state.infoId) setFocus(state.infoId);
  sysZoomBy(-2);
});

/* Pick + pin */
buildPickList();
pickSelect.addEventListener('change', schedulePanels);
pinBtn.addEventListener('click', () => pin(pickSelect.value));
$('pick-info').addEventListener('click', () => openInfo(pickSelect.value));
// Collapsed by default on small screens.
if (window.matchMedia('(max-width: 700px)').matches) $('equiv').open = false;

/* Pointer: drag to pan (Earth view), pinch to zoom, hover for the tooltip, click/tap for the info card */
const pointersDown = new Map();
let dragMoved = 0;
let pinchStart = null;

function localPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer: capture is only a nicety */
  }
  pointersDown.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragMoved = 0;
  if (pointersDown.size === 2) {
    const [a, b] = [...pointersDown.values()];
    pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointersDown.get(e.pointerId);
  if (!prev) {
    if (e.pointerType === 'mouse') {
      state.hover = localPoint(e);
      updateTooltip();
    }
    return;
  }
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  pointersDown.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointersDown.size === 2 && pinchStart) {
    const [a, b] = [...pointersDown.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist > 0 && pinchStart.dist > 0) {
      const decades = -Math.log10(dist / pinchStart.dist);
      if (state.view === 'system') setSysLog(sysLog() + decades);
      else if (state.view === 'milkyway') {
        const L = railLengths();
        state.rail.anim = null;
        state.rail.goal = null;
        state.rail.s = A.railSFromLength(L, A.railLengthFromS(L, state.rail.s) + decades);
        sim.requestDraw();
      }
    }
    pinchStart = { dist };
    dragMoved += 10;
    return;
  }
  dragMoved += Math.abs(dx) + Math.abs(dy);
  if (dragMoved > 4 && isPannable()) {
    panBy(dx, dy);
    tipEl.hidden = true;
  }
});
function endPointer(e) {
  const wasTap = pointersDown.size === 1 && dragMoved <= 4;
  pointersDown.delete(e.pointerId);
  if (pointersDown.size < 2) pinchStart = null;
  if (wasTap && e.type === 'pointerup') {
    const p = localPoint(e);
    const h = hitAt(p.x, p.y);
    if (h && (OBJECTS.has(h.id) || h.id.startsWith('orbit-'))) {
      const id = h.id.startsWith('orbit-') ? h.id.slice(6) : h.id;
      openInfo(id);
      if (state.view === 'system' && isSolarBody(id)) setFocus(id);
      tipEl.hidden = true;
    } else if (e.pointerType !== 'mouse') {
      state.hover = p;
      updateTooltip();
    }
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse' && !pointersDown.size) {
    state.hover = null;
    tipEl.hidden = true;
  }
});
canvas.addEventListener('wheel', (e) => {
  if (state.view === 'earth') return; // fixed scale: let the page scroll
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
  const decades = clamp(e.deltaY * unit, -400, 400) * 0.0025;
  if (state.view === 'system') sysZoomBy(decades);
  else {
    const L = railLengths();
    state.rail.anim = null;
    state.rail.goal = clamp((state.rail.goal ?? A.railLengthFromS(L, state.rail.s)) + decades, 0, L[L.length - 1]);
  }
}, { passive: false });
canvas.addEventListener('dblclick', (e) => {
  e.preventDefault();
  if (state.view === 'system') sysZoomBy(-1);
  else if (state.view === 'milkyway') railStep(-1);
});

/* Keyboard: arrows pan (Earth view) or step between places (galactic), +/- zoom, Esc closes the card */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target;
  if (t?.closest?.('dialog') || t?.matches?.('input, select, textarea, [contenteditable]')) return;
  if (e.key === 'Escape' && state.infoId) {
    closeInfo();
    return;
  }
  const zoomIn = e.key === '+' || e.key === '=';
  const zoomOut = e.key === '-' || e.key === '_';
  if (state.view === 'earth') {
    const stepPx = (e.shiftKey ? 0.5 : 0.12) * Math.min(sim.width, sim.height);
    const keys = { ArrowLeft: [stepPx, 0], ArrowRight: [-stepPx, 0], ArrowUp: [0, stepPx], ArrowDown: [0, -stepPx] };
    if (keys[e.key]) {
      e.preventDefault();
      panBy(...keys[e.key]);
    }
  } else if (state.view === 'milkyway') {
    if (zoomIn || e.key === 'ArrowLeft') {
      e.preventDefault();
      railStep(-1);
    } else if (zoomOut || e.key === 'ArrowRight') {
      e.preventDefault();
      railStep(1);
    }
  } else if (zoomIn || zoomOut) {
    e.preventDefault();
    sysZoomBy(zoomIn ? -1 : 1);
  }
});

/* Explainer numbers, computed from the constants and data (no hand-typed figures). */
function fillExplainer() {
  const set = (k, text) => {
    for (const el of document.querySelectorAll(`[data-calc="${k}"]`)) el.textContent = text;
  };
  const w = sim.width || 1200;
  const h = sim.height || 600;
  const mppFit = fitMpp(w, h, dprNow());
  const mppScreen = fitMpp(screen.width || w, screen.height || h, dprNow());
  set('fitPx', `about ${formatWorldLength(mppFit)}`);
  set('fsPx', formatWorldLength(mppScreen));
  set('sunMkm', `${sigWords(SUN_DIAMETER / 1e3, 3)} km`);
  set('sunFitPx', `${sig(SUN_DIAMETER / mppFit, 2)} of a pixel`);
  set('earthFitPx', `${sig(EARTH_DIAMETER / mppFit, 1)} of a pixel`);
  set('sunEarthPx', fmt(SUN_DIAMETER / EARTH_DIAMETER, 0));
  set('sunDistEarthPx', fmt(AU / EARTH_DIAMETER, 0));
  set('screenWidths', fmt(Math.floor((AU / EARTH_DIAMETER / 1920) * 10) / 10, 1));
  set('moonPx', fmt(EARTH_MOON_DISTANCE / EARTH_DIAMETER, 0));
  set('lightSec', fmt(AU / C_LIGHT, 0));
  set('earthCreep', sig(A.EARTH_ORBITAL_SPEED / EARTH_DIAMETER, 2));
  set('sunMwPx', sig(SUN_TO_GALACTIC_CENTRE / MILKY_WAY_DIAMETER, 2));
  const and = MARKER.andromeda ? lenV(MARKER.andromeda.eq) : A.ANDROMEDA_DISTANCE;
  set('andPx', fmt(and / MILKY_WAY_DIAMETER, 0));
  // 24-inch 1920 x 1080 monitor (the site's default screen): device px per metre.
  const ppm24 = Math.hypot(1920, 1080) / 24 / A.METRES_PER_INCH;
  set('andMm', formatDistance(and / MILKY_WAY_DIAMETER / ppm24, { about: false }));
  set('limitPx', fmt(CAT_LIMIT / MILKY_WAY_DIAMETER, 0));
  set('moonCount', fmt(MOONS.length, 0));
}

sim.start();
updateScaleBadge();
fillExplainer();
updatePulseButtons();
sim.pixelCard?.update();
