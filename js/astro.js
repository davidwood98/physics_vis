/**
 * astro.js: pure astronomy and screen-scale maths for the space simulator.
 *
 * No DOM access, so everything here is unit tested (/tests/astro.test.html)
 * and reusable by later pages. All quantities are SI (metres, seconds,
 * radians) unless a name says otherwise.
 *
 * Contents
 *   1. Constants (the site's fixed list) and exact definitions
 *   2. Time
 *   3. Orbits: Kepler solver, planet and Moon positions
 *   4. Coordinate frames: equatorial / ecliptic / galactic / supergalactic,
 *      screen view rotations and their smooth blending
 *   5. The scale model: metres per device pixel, physical pixel pitch,
 *      scale ratio, screen distance, zoom limits, zoomAbout
 *   6. Geometry for huge circles: clipArcToViewport and friends
 *   7. Formatting: distance ladder, world lengths, durations, travel hints
 */

import { TAU, clamp, niceFloor } from './physics.js';

export { TAU, clamp };

/* =========================================================================
 * 1. Constants
 * Only these physical values may appear on the page; anything else is either
 * computed from them or comes from a cited data file in /js/data/.
 * ====================================================================== */

/** Astronomical unit, m (IAU 2012, exact). */
export const AU = 1.495978707e11;
/** Speed of light, m/s (exact). */
export const C_LIGHT = 299792458;
/** Light-year, m (Julian year × c). */
export const LIGHT_YEAR = 9.4607304725808e15;
/** Sun diameter, m. */
export const SUN_DIAMETER = 1.3927e9;
/** Earth mean diameter, m. */
export const EARTH_DIAMETER = 1.2742e7;
/** Earth's circumference, m (40,075 km). */
export const EARTH_CIRCUMFERENCE = 4.0075e7;
/** Earth-Moon mean distance = the Moon's mean orbital radius, m (384,400 km). */
export const EARTH_MOON_DISTANCE = 3.844e8;
/** Moon sidereal period, days. */
export const MOON_SIDEREAL_DAYS = 27.32;
/** Synodic month (new moon to new moon), days. */
export const SYNODIC_MONTH_DAYS = 29.530588;
/** Earth's mean orbital speed, m/s (about 29.78 km/s). */
export const EARTH_ORBITAL_SPEED = 29.78e3;
/** Neptune's semi-major axis, au (about 30.07). */
export const NEPTUNE_A_AU = 30.07;
/** Sun to galactic centre, m (about 26,700 ly). */
export const SUN_TO_GALACTIC_CENTRE = 26700 * LIGHT_YEAR;
/** Milky Way disc diameter, m (about 100,000 ly: APPROXIMATE, the disc has no sharp edge). */
export const MILKY_WAY_DIAMETER = 100000 * LIGHT_YEAR;
/** Distance to the Andromeda galaxy, m (about 2.5 million ly). */
export const ANDROMEDA_DISTANCE = 2.5e6 * LIGHT_YEAR;
/** Observable universe diameter, m (about 93 billion ly, about 8.8e26 m). */
export const OBSERVABLE_UNIVERSE_DIAMETER = 93e9 * LIGHT_YEAR;
export const OBSERVABLE_UNIVERSE_RADIUS = OBSERVABLE_UNIVERSE_DIAMETER / 2;

/* Exact definitions (units, not measurements). */
export const DAY = 86400;
export const JULIAN_YEAR = 365.25 * DAY;
export const JULIAN_CENTURY = 36525 * DAY;
/** Parsec, m: IAU 2015 Resolution B2 defines 1 pc = (648000 / π) au. */
export const PARSEC = (AU * 648000) / Math.PI;
export const KILOPARSEC = 1e3 * PARSEC;
export const MEGAPARSEC = 1e6 * PARSEC;
export const METRES_PER_INCH = 0.0254;

/** At zoom t = 0 Earth's mean diameter is drawn exactly 2.00 cm across on the real screen. */
export const NEAR_EARTH_SCREEN_SIZE = 0.02;

/* =========================================================================
 * 2. Time: the simulation clock is seconds since the J2000.0 epoch
 * ====================================================================== */

/**
 * J2000.0 = 2000-01-01 12:00 TT. We treat it as UTC: the ~64 s TT-UTC
 * difference is far below what an approximate planar orbit can show.
 */
export const J2000_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** Mean new moon of 2000-01-06 18:14 UTC (start of lunation counting). */
export const NEW_MOON_2000_UNIX_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

export const unixMsToSimSeconds = (ms) => (ms - J2000_UNIX_MS) / 1000;
export const simSecondsToUnixMs = (s) => J2000_UNIX_MS + s * 1000;

/** Accumulate sim time: simTime += frameDt × rate, frameDt clamped to 0.1 s. */
export function advanceSimTime(simTime, frameDt, rate, maxDt = 0.1) {
  const dt = frameDt > 0 ? Math.min(frameDt, maxDt) : 0;
  return simTime + dt * rate;
}

/* =========================================================================
 * 3. Orbits
 * ====================================================================== */

export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;

/** Fractional part in [0, 1), safe for negative input. */
export function frac(x) {
  const f = x - Math.floor(x);
  return f >= 1 ? 0 : f;
}

/** Reduce an angle to [-π, π) in double precision. */
export function reduceAngle(a) {
  return TAU * (frac(a / TAU + 0.5) - 0.5);
}

/**
 * Solve Kepler's equation E − e·sin E = M for the eccentric anomaly E
 * (Newton's method). M is reduced modulo 2π first, so huge mean anomalies
 * (fast time, long runs) don't lose precision. Returns E in [-π, π].
 */
export function solveKepler(M, e) {
  const m = reduceAngle(M);
  let E = e < 0.8 ? m + e * Math.sin(m) : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < 50; i++) {
    const f = E - e * Math.sin(E) - m;
    const dE = f / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-15) break;
  }
  return E;
}

/** Residual of Kepler's equation for E against the reduced mean anomaly (used by the tests). */
export const keplerResidual = (E, e, M) => Math.abs(reduceAngle(E - e * Math.sin(E) - reduceAngle(M)));

/** Orbital period from the JPL mean-longitude rate (deg per Julian century), in seconds. */
export const periodFromLdot = (Ldot) => (360 / Ldot) * JULIAN_CENTURY;

/** Mean anomaly (rad) at sim time t for elements { L0, varpi, Ldot }. Computed in revolutions to keep precision. */
export function meanAnomaly(el, t) {
  const revs = (el.L0 - el.varpi) / 360 + (el.Ldot / 360) * (t / JULIAN_CENTURY);
  return TAU * frac(revs);
}

/**
 * Heliocentric position (m) in the ecliptic plane at sim time t (seconds
 * since J2000). Planar: inclination ignored, orbit rotated by the longitude
 * of perihelion. Returns { x, y } (x towards the J2000 equinox).
 */
export function planetPosition(el, t) {
  const E = solveKepler(meanAnomaly(el, t), el.e);
  const a = el.a * AU;
  const xp = a * (Math.cos(E) - el.e);
  const yp = a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const w = degToRad(el.varpi);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  return { x: xp * cw - yp * sw, y: xp * sw + yp * cw };
}

/**
 * Orbit ellipse for drawing: centre (m, heliocentric ecliptic) and the two
 * semi-axis vectors, so point(E) = centre + u·cos E + v·sin E.
 */
export function orbitEllipse(el) {
  const a = el.a * AU;
  const b = a * Math.sqrt(1 - el.e * el.e);
  const w = degToRad(el.varpi);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  return { cx: -a * el.e * cw, cy: -a * el.e * sw, ux: a * cw, uy: a * sw, vx: -b * sw, vy: b * cw };
}

/**
 * The Moon on a circular orbit of radius EARTH_MOON_DISTANCE round Earth.
 * Phase from the mean new moon of 2000-01-06 18:14 UTC plus whole synodic
 * months: at new moon the Moon lies between Earth and the Sun.
 * earth = Earth's heliocentric { x, y }. Approximate (no lunar theory).
 */
export function moonPosition(t, earth) {
  const tNew = unixMsToSimSeconds(NEW_MOON_2000_UNIX_MS);
  const phase = frac((t - tNew) / (SYNODIC_MONTH_DAYS * DAY)); // 0 = new moon
  const sunDir = Math.atan2(-earth.y, -earth.x); // direction from Earth to the Sun
  const a = sunDir + TAU * phase;
  return { x: earth.x + EARTH_MOON_DISTANCE * Math.cos(a), y: earth.y + EARTH_MOON_DISTANCE * Math.sin(a), phase };
}

/* ---------- Moons of the other planets (JPL mean elements, planar) ---------- */

/** "2000-01-01.5" (date with fractional day, TDB taken as UTC) → sim seconds since J2000. */
export function parseEpoch(s) {
  const [y, mo, dFrac] = s.split('-');
  const d = Number(dFrac);
  const day = Math.floor(d);
  return unixMsToSimSeconds(Date.UTC(Number(y), Number(mo) - 1, day) + (d - day) * DAY * 1000);
}

/**
 * Satellite from a JPL mean-elements row: a (km), e, ω, M at epoch, i, node
 * (deg), period (days). Drawn flat: longitude of periapsis ϖ = node + ω, and
 * orbits with i > 90° run backwards (retrograde).
 */
export function satelliteElements({ aKm, e, wDeg, mDeg, iDeg, nodeDeg, periodDays, epoch }) {
  return {
    a: aKm * 1e3,
    e,
    varpi: degToRad(nodeDeg + wDeg),
    M0: degToRad(mDeg),
    n: TAU / (periodDays * DAY),
    epoch: parseEpoch(epoch),
    retro: iDeg > 90,
    period: periodDays * DAY,
  };
}

/** Satellite position (m) relative to its planet at sim time t, in the ecliptic plane (approximate). */
export function satelliteOffset(m, t) {
  const E = solveKepler(m.M0 + m.n * (t - m.epoch), m.e);
  const xp = m.a * (Math.cos(E) - m.e);
  const yp = m.a * Math.sqrt(1 - m.e * m.e) * Math.sin(E) * (m.retro ? -1 : 1);
  const c = Math.cos(m.varpi);
  const s = Math.sin(m.varpi);
  return { x: xp * c - yp * s, y: xp * s + yp * c };
}

/** Satellite orbit ellipse relative to its planet: point(φ) = c + u·cos φ + v·sin φ (m). */
export function satelliteEllipse(m) {
  const b = m.a * Math.sqrt(1 - m.e * m.e);
  const c = Math.cos(m.varpi);
  const s = Math.sin(m.varpi);
  return { cx: -m.a * m.e * c, cy: -m.a * m.e * s, ux: m.a * c, uy: m.a * s, vx: -b * s, vy: b * c };
}

/* ---------- Milky Way spiral arms (Reid et al. 2019 model) ---------- */

/**
 * Galactocentric radius (kpc) of a spiral arm at azimuth β (deg):
 * ln(R / R_kink) = −(β − β_kink) tan ψ, with ψ< up to the kink and ψ> beyond.
 * β = 0 towards the Sun, increasing in the direction of Galactic rotation.
 */
export function armRadiusKpc(arm, betaDeg) {
  const psi = degToRad(betaDeg <= arm.betaKink ? arm.psiIn : arm.psiOut);
  return arm.rKink * Math.exp(-degToRad(betaDeg - arm.betaKink) * Math.tan(psi));
}

/* =========================================================================
 * 4. Coordinate frames
 * Vectors are plain [x, y, z] arrays. Matrices are row-major 3×3 arrays
 * (array of rows); M·v converts from the "from" frame to the "to" frame.
 * ====================================================================== */

export const mulMV = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export const transpose = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
export const mulMM = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Unit vector from longitude / latitude in degrees (RA/Dec, l/b, SGL/SGB alike). */
export function lonLatToUnit(lonDeg, latDeg) {
  const lon = degToRad(lonDeg);
  const lat = degToRad(latDeg);
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Longitude [0, 360) and latitude in degrees of a vector. */
export function unitToLonLat(v) {
  const lon = radToDeg(Math.atan2(v[1], v[0]));
  const lat = radToDeg(Math.atan2(v[2], Math.hypot(v[0], v[1])));
  return { lon: lon < 0 ? lon + 360 : lon, lat };
}

/** Mean obliquity of the ecliptic at J2000: 84381.406″ (IAU 2006 precession, Capitaine et al. 2003). */
export const OBLIQUITY_J2000 = degToRad(84381.406 / 3600);

/** Equatorial (ICRS/J2000) → ecliptic (J2000): rotation about x by the obliquity. */
export const EQ_TO_ECL = (() => {
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);
  return [[1, 0, 0], [0, c, s], [0, -s, c]];
})();

/**
 * Equatorial (J2000) → galactic, from the defining angles of the galactic
 * system in the Hipparcos catalogue (ESA 1997, vol. 1, sec. 1.5.3): north
 * galactic pole at RA 192.85948°, Dec +27.12825°, and the north celestial pole
 * at galactic longitude 122.93192°. Built from the standard spherical formulae.
 */
export const GALACTIC_POLE = { raDeg: 192.85948, decDeg: 27.12825, lNcpDeg: 122.93192 };
export function equatorialToGalacticDeg(raDeg, decDeg) {
  const a = degToRad(raDeg - GALACTIC_POLE.raDeg);
  const d = degToRad(decDeg);
  const dG = degToRad(GALACTIC_POLE.decDeg);
  const sinB = Math.sin(d) * Math.sin(dG) + Math.cos(d) * Math.cos(dG) * Math.cos(a);
  const y = Math.cos(d) * Math.sin(a); // cos b · sin(lNCP − l)
  const x = Math.sin(d) * Math.cos(dG) - Math.cos(d) * Math.sin(dG) * Math.cos(a); // cos b · cos(lNCP − l)
  let l = GALACTIC_POLE.lNcpDeg - radToDeg(Math.atan2(y, x));
  l = ((l % 360) + 360) % 360;
  return { l, b: radToDeg(Math.asin(clamp(sinB, -1, 1))) };
}
export const EQ_TO_GAL = (() => {
  // Columns = galactic coordinates of the equatorial basis vectors.
  const cols = [[0, 0], [90, 0], [0, 90]].map(([ra, dec]) => {
    const { l, b } = equatorialToGalacticDeg(ra, dec);
    return lonLatToUnit(l, b);
  });
  return [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);
})();

/**
 * Galactic → supergalactic (de Vaucouleurs et al. 1976; Lahav et al. 2000,
 * MNRAS 312, 166): the supergalactic north pole is at l = 47.37°, b = +6.32°
 * and SGL = 0 lies at l = 137.37°, b = 0°.
 */
export const SG_POLE = { l: 47.37, b: 6.32, zeroL: 137.37 };
export const GAL_TO_SG = (() => {
  const x = lonLatToUnit(SG_POLE.zeroL, 0);
  const z = lonLatToUnit(SG_POLE.l, SG_POLE.b);
  return [x, cross(z, x), z];
})();
export const EQ_TO_SG = mulMM(GAL_TO_SG, EQ_TO_GAL);

export function galacticToSupergalacticDeg(l, b) {
  const { lon, lat } = unitToLonLat(mulMV(GAL_TO_SG, lonLatToUnit(l, b)));
  return { sgl: lon, sgb: lat };
}

/** Equatorial position (m) of an object at RA/Dec (degrees) and distance d (m). */
export function equatorialVector(raDeg, decDeg, d) {
  const u = lonLatToUnit(raDeg, decDeg);
  return [u[0] * d, u[1] * d, u[2] * d];
}

/** Equatorial unit vector for a position given in any supported system. */
export function unitFromCoord({ sys, lon, lat }) {
  const u = lonLatToUnit(lon, lat);
  if (sys === 'eq') return u;
  if (sys === 'gal') return mulMV(transpose(EQ_TO_GAL), u);
  if (sys === 'sg') return mulMV(transpose(EQ_TO_SG), u);
  throw new Error(`unknown coordinate system ${sys}`);
}

/**
 * Screen views. A view matrix maps an EQUATORIAL vector to screen axes
 * [right, up, towards the viewer]; only right/up are drawn (a top view).
 *  - ecliptic:      seen from the north ecliptic pole, x (equinox) right.
 *  - galactic:      seen from the north galactic pole ("galactic north up"
 *                   out of the screen), galactic centre (l = 0) up, l = 90° left,
 *                   so the Galaxy turns clockwise.
 *  - supergalactic: seen from the supergalactic north pole, SGX right, SGY up.
 */
export const VIEW_ECLIPTIC = EQ_TO_ECL;
export const VIEW_GALACTIC = mulMM([[0, -1, 0], [1, 0, 0], [0, 0, 1]], EQ_TO_GAL);
export const VIEW_SUPERGALACTIC = EQ_TO_SG;

/** Rotation matrix → unit quaternion [w, x, y, z] (Shepperd's method). */
export function matToQuat(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s];
  }
  const n = Math.hypot(...q);
  return q.map((c) => c / n);
}

export function quatToMat([w, x, y, z]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
  ];
}

/** Spherical linear interpolation between unit quaternions (shortest path). */
export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = b.map((c) => -c);
  }
  if (d > 0.9995) {
    const q = a.map((c, i) => c + t * (bb[i] - c));
    const n = Math.hypot(...q);
    return q.map((c) => c / n);
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((c, i) => wa * c + wb * bb[i]);
}

const Q_ECL = matToQuat(VIEW_ECLIPTIC);
const Q_GAL = matToQuat(VIEW_GALACTIC);
const Q_SG = matToQuat(VIEW_SUPERGALACTIC);

/**
 * The view rotation for frame weights: wEG blends ecliptic → galactic,
 * wGS blends galactic → supergalactic (each 0..1). Continuous in both, so
 * positions on screen never jump when the frame changes with zoom.
 */
export function blendedView(wEG, wGS) {
  if (wGS > 0) return quatToMat(slerp(Q_GAL, Q_SG, clamp(wGS, 0, 1)));
  if (wEG >= 1) return VIEW_GALACTIC;
  if (wEG <= 0) return VIEW_ECLIPTIC;
  return quatToMat(slerp(Q_ECL, Q_GAL, wEG));
}

/** Ecliptic-plane (x, y) → equatorial vector (z = 0 in the ecliptic). */
export function eclipticToEquatorial(x, y, z = 0) {
  return mulMV(transpose(EQ_TO_ECL), [x, y, z]);
}

/** Smoothstep on [0, 1]. */
export const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Smootherstep (6x⁵ − 15x⁴ + 10x³): like smoothstep but with continuous acceleration too. */
export const smootherstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
};

/**
 * Weight that is 0 when value >= hi and 1 when value <= lo, blended by a
 * smootherstep in log space between them (for zoom-dependent hand-offs, so
 * positions change with continuous speed and acceleration).
 */
export function logBlendDown(value, lo, hi) {
  if (!(value > 0)) return 1;
  return smootherstep((Math.log(hi) - Math.log(value)) / (Math.log(hi) - Math.log(lo)));
}

/** Fade-in/out factor for a layer whose apparent size is sizePx: in over [lo/3, lo], out over [hi, 3·hi]. */
export function layerAlpha(sizePx, lo, hi = Infinity) {
  if (!(sizePx > 0)) return 0;
  const fadeIn = lo > 0 ? smoothstep(Math.log(sizePx / (lo / 3)) / Math.log(3)) : 1;
  const fadeOut = Number.isFinite(hi) ? 1 - smoothstep(Math.log(sizePx / hi) / Math.log(3)) : 1;
  return fadeIn * fadeOut;
}

/* =========================================================================
 * 5. The scale model (single source of truth)
 *  metresPerPx      world metres per DEVICE pixel (the view's state)
 *  physicalPxPitch  real metres per device pixel on this screen = 1 / devicePixelsPerMetre
 *  scaleRatio       world metres per real screen metre = metresPerPx / physicalPxPitch
 *  screenDistance   how far a world distance would reach on/off your screen
 * ====================================================================== */

export const physicalPxPitch = (devicePixelsPerMetre) => 1 / devicePixelsPerMetre;
export const scaleRatio = (metresPerPx, pxPitch) => metresPerPx / pxPitch;
export const screenDistance = (dWorld, ratio) => dWorld / ratio;
/** Uncalibrated fallback: CSS's 96 px per inch, i.e. 96·dpr device px per inch. */
export const approxDevicePixelsPerMetre = (dpr = 1) => (96 * dpr) / METRES_PER_INCH;

/**
 * Zoom limits for the log zoom view. Near: Earth's mean diameter appears
 * exactly NEAR_EARTH_SCREEN_SIZE (2 cm) across on the real screen. Far: the
 * Milky Way disc (100,000 ly, approximate) is exactly one device pixel.
 */
export function zoomLimits(pxPitch) {
  return { near: (EARTH_DIAMETER / NEAR_EARTH_SCREEN_SIZE) * pxPitch, far: MILKY_WAY_DIAMETER };
}

/** Number of powers of ten between the two zoom limits. */
export const zoomDecades = (lim) => Math.log10(lim.far / lim.near);

/** metresPerPx at zoom fraction t in [0, 1] (t = 0 near, 1 far), log-linear. */
export function metresPerPx(t, lim) {
  const tt = clamp(t, 0, 1);
  if (tt === 0) return lim.near;
  if (tt === 1) return lim.far;
  return 10 ** (Math.log10(lim.near) + tt * (Math.log10(lim.far) - Math.log10(lim.near)));
}

/** Inverse of metresPerPx(): zoom fraction (unclamped) for a scale. */
export const tFromMetresPerPx = (m, lim) => Math.log10(m / lim.near) / Math.log10(lim.far / lim.near);

/**
 * Zoom about a screen point. cam = camera position (m, screen-aligned, y up);
 * d = the point's offset from the screen centre in DEVICE px (x right, y up).
 * Keeps the world point under d fixed while metresPerPx changes old → new.
 */
export function zoomAbout(cam, d, mppOld, mppNew) {
  const k = mppOld - mppNew;
  return { x: cam.x + d.x * k, y: cam.y + d.y * k };
}

/** Clamp a 2D position (m) to within radius R of the origin; finite in, finite out. */
export function clampToRadius(p, R) {
  const r = Math.hypot(p.x, p.y);
  if (!Number.isFinite(r)) return { x: 0, y: 0 };
  if (r <= R) return p;
  return { x: (p.x / r) * R, y: (p.y / r) * R };
}

/* ---------- Zoom-dependent hand-offs (used by the Earth to Milky Way view) ---------- */

/**
 * Camera anchor weight from Earth's orbit radius on screen (device px):
 * 0 = anchored on Earth (R >= 300 px), 1 = on the Sun (R <= 30 px), log-space
 * smoothstep between. anchor = Sun + (1 − w)·(Earth − Sun).
 */
export const anchorWeight = (earthOrbitRadiusPx) => logBlendDown(earthOrbitRadiusPx, 30, 300);

/**
 * View-frame weights for a scale (metres per device px):
 *  wEG: ecliptic → galactic top view, done by the time Neptune's orbit is under 3 px across;
 *  wGS: galactic → supergalactic top view as the Milky Way shrinks from 8 px to 2 px across
 *       (galaxies are spread along the supergalactic plane, so its top view shows them best).
 */
export function frameWeights(mpp) {
  return {
    wEG: logBlendDown((2 * NEPTUNE_A_AU * AU) / mpp, 3, 30),
    wGS: logBlendDown(MILKY_WAY_DIAMETER / mpp, 2, 8),
  };
}

/**
 * "True size" drawing of an object d px across: at or above 1 px draw it at
 * size; below 1 px draw a single pixel whose alpha is the fraction of the
 * pixel the object would cover (π d² / 4).
 */
export const trueSizeAlpha = (dPx) => (dPx >= 1 ? 1 : Math.max(0, (Math.PI * dPx * dPx) / 4));

/**
 * Camera frame of the Earth to Milky Way zoom view (pure, shared with the tests):
 * view rotation from the frame weights, anchor = Sun + (1 − w)·(Earth − Sun)
 * with the Sun at the origin, and camera = projected anchor + offset (metres,
 * screen-aligned, y up).
 */
export function zoomFrame(mpp, earthEq, offset = { x: 0, y: 0 }) {
  const { wEG, wGS } = frameWeights(mpp);
  const V = blendedView(wEG, wGS);
  const wAnchor = anchorWeight(AU / mpp);
  const anchorEq = [earthEq[0] * (1 - wAnchor), earthEq[1] * (1 - wAnchor), earthEq[2] * (1 - wAnchor)];
  const pa = mulMV(V, anchorEq);
  return { mpp, V, wEG, wGS, wAnchor, anchorEq, cam: { x: pa[0] + offset.x, y: pa[1] + offset.y } };
}

/** Device-pixel offset from the screen centre (x right, y up) of an equatorial position in a frame. */
export function frameToPx(frame, eq) {
  const V = frame.V;
  const x = V[0][0] * eq[0] + V[0][1] * eq[1] + V[0][2] * eq[2];
  const y = V[1][0] * eq[0] + V[1][1] * eq[1] + V[1][2] * eq[2];
  return { x: (x - frame.cam.x) / frame.mpp, y: (y - frame.cam.y) / frame.mpp };
}

/** Reference frame time for the "too fast" rule (fixed so 60 Hz and 144 Hz behave the same). */
export const REFERENCE_FRAME_DT = 1 / 60;

/** True when an orbit of this period would turn more than 0.5 rad per frame at this rate. */
export const tooFast = (periodS, rate) => (TAU / periodS) * rate * REFERENCE_FRAME_DT > 0.5;

/* ---------- Catalogue helpers ---------- */

/** "05 23 34.5" (hours) → degrees. */
export function parseRA(s) {
  const [h, m = 0, sec = 0] = s.trim().split(/\s+/).map(Number);
  return 15 * (h + m / 60 + sec / 3600);
}

/** "-69 45 22" (degrees) → degrees; the sign applies to the whole value. */
export function parseDec(s) {
  const t = s.trim();
  const sign = t.startsWith('-') ? -1 : 1;
  const [d, m = 0, sec = 0] = t.replace(/^[+-]/, '').split(/\s+/).map(Number);
  return sign * (d + m / 60 + sec / 3600);
}

/** Distance spec from markers.js ({ kpc } | { mpc } | { au } | { kms, H0 }) → metres. */
export function distanceFromSpec(d) {
  if (d.kpc !== undefined) return d.kpc * KILOPARSEC;
  if (d.mpc !== undefined) return d.mpc * MEGAPARSEC;
  if (d.au !== undefined) return d.au * AU;
  if (d.kms !== undefined) return (d.kms / d.H0) * MEGAPARSEC; // Hubble law: approximate
  throw new Error('bad distance spec');
}

/** Equatorial position (m) from supergalactic Cartesian velocities (km/s) and H0. */
export function sgVelocityToEquatorial(sgxyzKms, H0) {
  const v = sgxyzKms.map((c) => (c / H0) * MEGAPARSEC);
  return mulMV(transpose(EQ_TO_SG), v);
}

/* Easing for animations. */
export const easeInOutCubic = (x) => {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** Go-to animation duration (s): 1.5 s + 0.6 s per decade travelled, clamped to [3, 14]. */
export const travelDuration = (decades) => clamp(1.5 + 0.6 * Math.abs(decades), 3, 14);

/* ---------- On-rails navigation ---------- */

/**
 * Cumulative "rail length" at each stop of a route through zoom levels:
 * a segment counts its powers of ten travelled (at least minSeg), and a
 * same-zoom pan between stops counts panLen. logs = log10(metres per px) per stop.
 */
export function railLengths(logs, { panLen = 5, minSeg = 0.6 } = {}) {
  const L = [0];
  for (let i = 1; i < logs.length; i++) {
    const d = Math.abs(logs[i] - logs[i - 1]);
    L.push(L[i - 1] + (d < 1e-9 ? panLen : Math.max(d, minSeg)));
  }
  return L;
}

/** Rail position s (stop index, fractional) at length len along the rail, and back. */
export function railSFromLength(L, len) {
  if (!(len > 0)) return 0;
  const last = L.length - 1;
  if (len >= L[last]) return last;
  let i = 0;
  while (i < last - 1 && L[i + 1] <= len) i++;
  return i + (len - L[i]) / (L[i + 1] - L[i]);
}
export function railLengthFromS(L, s) {
  const last = L.length - 1;
  const ss = clamp(s, 0, last);
  const i = Math.min(last - 1, Math.floor(ss));
  return L[i] + (L[i + 1] - L[i]) * (ss - i);
}

/** Rail animation duration: twice the go-to formula (slower, easier to follow). */
export const railDuration = (len) => 2 * travelDuration(len);

/* =========================================================================
 * 6. Geometry for huge circles and ellipses
 * arc()/ellipse() misbehave for radii far beyond the screen (Neptune's orbit
 * is ~25 million px at the near zoom limit), so we find the parameter
 * intervals that cross the viewport and draw short polylines instead.
 * ====================================================================== */

/** Below this radius (px) plain arc()/ellipse() calls are fine. */
export const MAX_ARC_RADIUS_PX = 5000;

/**
 * Parameter intervals [φ0, φ1] (radians, φ0 < φ1, possibly beyond 2π) where
 * the ellipse  p(φ) = c + u·cos φ + v·sin φ  lies inside rect {x0, y0, x1, y1}.
 * Works by mapping the rectangle into the frame where the ellipse is the unit
 * circle and intersecting with the (now parallelogram) edges.
 * Returns [] when nothing is visible and [[0, 2π]] when all of it is.
 */
export function clipEllipseToRect(cx, cy, ux, uy, vx, vy, rect) {
  const det = ux * vy - uy * vx;
  if (!Number.isFinite(det) || det === 0) return [];
  // Inverse of [[ux, vx], [uy, vy]] applied to (p − c).
  const toUnit = (px, py) => {
    const dx = px - cx;
    const dy = py - cy;
    return [(vy * dx - vx * dy) / det, (-uy * dx + ux * dy) / det];
  };
  const quad = [toUnit(rect.x0, rect.y0), toUnit(rect.x1, rect.y0), toUnit(rect.x1, rect.y1), toUnit(rect.x0, rect.y1)];

  // Quick rejects: is the unit circle far from the quad, or the quad deep inside the circle?
  let minR = Infinity;
  let maxR = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    maxR = Math.max(maxR, Math.hypot(ax, ay));
    minR = Math.min(minR, segmentDistanceToOrigin(ax, ay, bx, by));
  }
  const originInside = pointInQuad(0, 0, quad);
  if (originInside) minR = 0;
  if (minR > 1 || maxR < 1) return []; // circle entirely outside / quad entirely inside the circle

  const angles = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const dx = bx - ax;
    const dy = by - ay;
    const A = dx * dx + dy * dy;
    const B = ax * dx + ay * dy;
    const Cq = ax * ax + ay * ay - 1;
    const disc = B * B - A * Cq;
    if (A === 0 || disc < 0) continue;
    const sq = Math.sqrt(disc);
    // Numerically stable roots of A s² + 2B s + C = 0.
    const qv = -B - Math.sign(B || 1) * sq;
    const roots = [qv / A, qv !== 0 ? Cq / qv : NaN];
    for (const s of roots) {
      if (s >= 0 && s <= 1) angles.push(Math.atan2(ay + s * dy, ax + s * dx));
    }
  }
  if (angles.length === 0) {
    const [px, py] = [1, 0];
    return pointInQuad(px, py, quad) ? [[0, TAU]] : [];
  }
  const norm = angles.map((a) => (a < 0 ? a + TAU : a)).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < norm.length; i++) {
    const a0 = norm[i];
    const a1 = i + 1 < norm.length ? norm[i + 1] : norm[0] + TAU;
    if (a1 - a0 <= 0) continue;
    const mid = (a0 + a1) / 2;
    if (pointInQuad(Math.cos(mid), Math.sin(mid), quad)) {
      // Merge with the previous interval if they touch (corner hits produce duplicates).
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - a0) < 1e-15) last[1] = a1;
      else out.push([a0, a1]);
    }
  }
  return out;
}

/**
 * Angular intervals where a circle (centre cx, cy, radius r, all in px) is
 * inside the viewport rect. Point at angle a = (cx + r·cos a, cy + r·sin a).
 */
export function clipArcToViewport(cx, cy, r, rect) {
  return clipEllipseToRect(cx, cy, r, 0, 0, r, rect);
}

function segmentDistanceToOrigin(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const s = L > 0 ? clamp(-(ax * dx + ay * dy) / L, 0, 1) : 0;
  return Math.hypot(ax + s * dx, ay + s * dy);
}

function pointInQuad(px, py, q) {
  // Convex polygon test: the point is on the same side of every edge.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i];
    const [bx, by] = q[(i + 1) % 4];
    const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
  }
  return true;
}

/**
 * Coverage of the viewport by a filled annulus (r1 < r2) centred at (cx, cy):
 * 'none' (draw nothing), 'full' (fill the screen) or 'partial'.
 */
export function annulusCoverage(cx, cy, r1, r2, rect) {
  const nx = clamp(cx, rect.x0, rect.x1);
  const ny = clamp(cy, rect.y0, rect.y1);
  const dMin = Math.hypot(nx - cx, ny - cy);
  const dMax = Math.max(
    Math.hypot(rect.x0 - cx, rect.y0 - cy), Math.hypot(rect.x1 - cx, rect.y0 - cy),
    Math.hypot(rect.x0 - cx, rect.y1 - cy), Math.hypot(rect.x1 - cx, rect.y1 - cy),
  );
  if (dMin > r2 || dMax < r1) return 'none';
  if (dMin >= r1 && dMax <= r2) return 'full';
  return 'partial';
}

/**
 * Polygon (array of [x, y]) for the intersection of a disc with the rect,
 * for filling huge discs without arc(). Both shapes are convex, so the
 * corners inside the disc plus the visible arc points, sorted by angle about
 * their centroid, trace the boundary.
 */
export function discRectPolygon(cx, cy, r, rect, stepPx = 6) {
  const pts = [];
  for (const [x, y] of [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]]) {
    if (Math.hypot(x - cx, y - cy) <= r) pts.push([x, y]);
  }
  for (const [a0, a1] of clipArcToViewport(cx, cy, r, rect)) {
    const n = clamp(Math.ceil(((a1 - a0) * r) / stepPx), 8, 720);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  if (pts.length < 3) return pts;
  let mx = 0;
  let my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  return pts.sort((p, q) => Math.atan2(p[1] - my, p[0] - mx) - Math.atan2(q[1] - my, q[0] - mx));
}

/**
 * Where a ray from the rect centre towards (dx, dy) leaves the rect inset by
 * margin: returns { x, y } on the inset border (for edge pointers).
 */
export function edgePoint(w, h, dx, dy, margin) {
  const hx = w / 2 - margin;
  const hy = h / 2 - margin;
  const s = Math.min(dx !== 0 ? hx / Math.abs(dx) : Infinity, dy !== 0 ? hy / Math.abs(dy) : Infinity);
  return { x: w / 2 + dx * s, y: h / 2 + dy * s };
}

/* =========================================================================
 * 7. Formatting (all values rounded to 2-3 significant figures)
 * ====================================================================== */

const nf = new Map();
function group(x, decimals) {
  let f = nf.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    nf.set(decimals, f);
  }
  return f.format(x);
}

/**
 * x to n significant figures, with thousands separators and no exponent:
 * sig(11741, 3) → "11,700", sig(0.0277, 2) → "0.028". Large values use
 * "million"/"billion"/"trillion" words via sigWords().
 */
export function sig(x, n = 3) {
  if (!Number.isFinite(x)) return '∞';
  if (x === 0) return '0';
  const p = Math.floor(Math.log10(Math.abs(x)));
  const decimals = Math.max(0, n - 1 - p);
  const rounded = Number(x.toPrecision(n));
  // toPrecision can round up a decade (9.99 → 10.0): recompute decimals for the rounded value.
  const p2 = Math.floor(Math.log10(Math.abs(rounded)));
  return group(rounded, Math.min(decimals, Math.max(0, n - 1 - p2)));
}

/** sig() without trailing zeros: sigT(2.6500, 3) → "2.65", sigT(15.0, 3) → "15". */
export function sigT(x, n = 3) {
  if (!Number.isFinite(x)) return '∞';
  if (x === 0) return '0';
  const rounded = Number(x.toPrecision(n));
  const p = Math.floor(Math.log10(Math.abs(rounded)));
  const decimals = Math.max(0, n - 1 - p);
  let f = nf.get(`t${decimals}`);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
    nf.set(`t${decimals}`, f);
  }
  return f.format(rounded);
}

const SUPERSCRIPT = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Powers-of-ten form for very large or small numbers: sci(3.43e24) → "3.43 × 10²⁴". */
export function sci(x, n = 3) {
  if (!Number.isFinite(x) || x === 0) return sigT(x, n);
  let p = Math.floor(Math.log10(Math.abs(x)));
  let m = Number((x / 10 ** p).toPrecision(n));
  if (Math.abs(m) >= 10) {
    m /= 10;
    p += 1;
  }
  return `${sigT(m, n)} × 10${String(p).split('').map((c) => SUPERSCRIPT[c]).join('')}`;
}

/** sig() with word multipliers for big numbers: 2,400,000 → "2.4 million"; beyond trillions, powers of ten. */
export function sigWords(x, n = 3, fn = sigT) {
  const a = Math.abs(x);
  if (a >= 1e15) return sci(x, n);
  if (a >= 1e12) return `${fn(x / 1e12, n)} trillion`;
  if (a >= 1e9) return `${fn(x / 1e9, n)} billion`;
  if (a >= 1e6) return `${fn(x / 1e6, n)} million`;
  return fn(x, n);
}

/** Significant figures for the ladder: 3, trailing zeros dropped (2.65 AU, 15 cm, 7.06 km). */
const sf = () => 3;

/**
 * The distance ladder for real-world (screen) distances:
 * < 1 mm → micrometres; < 1 cm → mm; < 1 m → cm; < 1 km → m; up to Earth's
 * circumference → km; then multiples of Earth's circumference; above the
 * Earth-Moon distance multiples of it; above 1 AU in AU; from 0.1 ly in ly.
 * Returns e.g. "about 7.0 mm". Pass about=false to drop the prefix.
 */
export function formatDistance(m, { about = true } = {}) {
  const pre = about ? 'about ' : '';
  const a = Math.abs(m);
  if (!Number.isFinite(a)) return 'infinitely far';
  if (a === 0) return '0 mm';
  if (a < 1e-8) return `${pre}${sci(a, sf())} m`; // far below anything visible: powers of ten
  if (a < 1e-3) {
    const v = sigT(a * 1e6, sf());
    return `${pre}${v} ${v === '1' ? 'micrometre' : 'micrometres'}`;
  }
  if (a < 1e-2) return `${pre}${sigT(a * 1e3, sf())} mm`;
  if (a < 1) return `${pre}${sigT(a * 100, sf())} cm`;
  if (a < 1e3) return `${pre}${sigT(a, sf())} m`;
  if (a <= EARTH_CIRCUMFERENCE) return `${pre}${sigWords(a / 1e3, 3)} km`;
  if (a <= EARTH_MOON_DISTANCE) return `${pre}${sigT(a / EARTH_CIRCUMFERENCE, 2)} times round the Earth`;
  if (a <= AU) return `${pre}${sigT(a / EARTH_MOON_DISTANCE, 2)} times the Earth–Moon distance`;
  if (a < 0.1 * LIGHT_YEAR) return `${pre}${sigWords(a / AU, sf())} AU`;
  const ly = a / LIGHT_YEAR;
  return `${pre}${sigWords(ly, sf())} ${ly === 1 ? 'light-year' : 'light-years'}`;
}

/** Unit choice for world lengths: m, km, AU, ly, Mly, Gly. */
export function worldUnit(m) {
  const a = Math.abs(m);
  if (a < 1e3) return { unit: 'm', size: 1 };
  if (a < 0.1 * AU) return { unit: 'km', size: 1e3 };
  if (a < 0.1 * LIGHT_YEAR) return { unit: 'AU', size: AU };
  if (a < 1e6 * LIGHT_YEAR) return { unit: 'ly', size: LIGHT_YEAR };
  if (a < 1e9 * LIGHT_YEAR) return { unit: 'Mly', size: 1e6 * LIGHT_YEAR };
  return { unit: 'Gly', size: 1e9 * LIGHT_YEAR };
}

const UNIT_WORDS = { m: 'm', km: 'km', AU: 'AU', ly: 'light-years', Mly: 'million light-years', Gly: 'billion light-years' };

/**
 * World length with auto units (m, km, AU, ly, Mly, Gly), 3 significant
 * figures: 1.76e5 → "176 km", 1.38e10 → "13.8 million km", 9.46e20 → "100,000 light-years".
 * short=true uses the symbols (ly, Mly, Gly).
 */
export function formatWorldLength(m, { short = false } = {}) {
  if (!Number.isFinite(m)) return '∞';
  const { unit, size } = worldUnit(m);
  const v = m / size;
  const words = short ? unit : UNIT_WORDS[unit];
  if (unit === 'km' || unit === 'ly' || unit === 'AU') return `${sigWords(v, 3)} ${words}`;
  return `${sigT(v, 3)} ${words}`;
}

/** Round scale-bar length (m) in the unit of maxM: the largest 1-2-5 step <= maxM. */
export function niceWorldBar(maxM) {
  const { unit, size } = worldUnit(maxM);
  const v = niceFloor(maxM / size);
  return { metres: v * size, label: `${group(v, v < 1 ? 1 : 0)} ${unit}` };
}

/** Human duration: "45 seconds", "3.2 hours", "4.5 days", "120 years", "1.2 million years". */
export function formatDuration(s) {
  const a = Math.abs(s);
  if (!Number.isFinite(a)) return 'forever';
  if (a < 60) return `${sigT(a, 3)} seconds`;
  if (a < 3600) return `${sigT(a / 60, 3)} minutes`;
  if (a < 2 * DAY) return `${sigT(a / 3600, 3)} hours`;
  if (a < JULIAN_YEAR) return `${sigT(a / DAY, 3)} days`;
  return `${sigWords(a / JULIAN_YEAR, 3)} years`;
}

/** Light-travel time for a world distance, e.g. "8.3 minutes". */
export const lightTime = (m) => formatDuration(m / C_LIGHT);

/** Travel speeds for hints (m/s). */
export const WALK_SPEED = 1.4;
export const DRIVE_SPEED = 31.3; // about 70 mph
export const AIRLINER_SPEED = 250;

/**
 * Travel-time hint for a real-world distance (m), or '' if under 100 m or
 * the airliner would take 1,000 years or more. Walking until 10 hours, then
 * driving until 10 hours, then airliner.
 */
export function travelHint(m) {
  const a = Math.abs(m);
  if (!(a > 100)) return '';
  const tWalk = a / WALK_SPEED;
  if (tWalk <= 10 * 3600) return `about ${formatDuration(tWalk)} on foot`;
  const tDrive = a / DRIVE_SPEED;
  if (tDrive <= 10 * 3600) return `about ${formatDuration(tDrive)} by car at 70 mph`;
  const tAir = a / AIRLINER_SPEED;
  if (tAir < 1000 * JULIAN_YEAR) return `about ${formatDuration(tAir)} by airliner`;
  return '';
}

/** Time-rate badge text: 1 → "REAL TIME 1:1"; 86400 → "TIME ×86,400 (1 day per second)". */
export function rateLabel(rate, name) {
  if (rate === 1) return 'REAL TIME 1:1';
  if (rate >= 1000 * JULIAN_YEAR) return `TIME ${group(rate / JULIAN_YEAR, 0)} years per second`;
  return `TIME ×${group(rate, 0)} (${name} per second)`;
}
