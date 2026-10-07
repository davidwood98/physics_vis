/**
 * earth-orbit-model.js: pure maths for the Earth-to-orbit page.
 *
 * No DOM access (unit tested in /tests/earth-orbit.test.html). SI units:
 * metres, seconds, kilograms; GM in m³/s². Orbits are circles around a
 * spherical Earth with all its mass at the centre (Newton's shell theorem).
 */

import { TAU } from './physics.js';
import { EARTH_DIAMETER, NEAR_EARTH_SCREEN_SIZE } from './astro.js';
import {
  GM_EARTH, EARTH_MEAN_RADIUS, EARTH_EQUATORIAL_RADIUS, SIDEREAL_DAY, KARMAN_LINE, ISS, GPS,
} from './data/earth-orbit-data.js';

/* ---------- Orbits ---------- */

/** Speed of a circular orbit of radius r: v = √(GM / r). */
export const circularSpeed = (GM, r) => Math.sqrt(GM / r);

/** Escape speed at distance r from the centre: v = √(2GM / r) (= √2 × circular speed). */
export const escapeSpeed = (GM, r) => Math.sqrt((2 * GM) / r);

/** Period of a circular orbit: T = 2π √(r³ / GM). */
export const orbitalPeriod = (GM, r) => TAU * Math.sqrt((r * r * r) / GM);

/** Radius of the circular orbit with period T (Kepler's third law): r = ∛(GM T² / 4π²). */
export const radiusForPeriod = (GM, T) => Math.cbrt((GM * T * T) / (TAU * TAU));

/** Angular speed of a circular orbit (rad/s): ω = v / r = √(GM / r³). */
export const angularSpeed = (GM, r) => Math.sqrt(GM / (r * r * r));

/* ---------- Energy per kilogram ---------- */

/** Energy per kg to lift from radius R to R + h against gravity: GM/R − GM/(R + h). */
export const climbEnergy = (GM, R, h) => GM / R - GM / (R + h);

/** Kinetic energy per kg in a circular orbit of radius r: ½v² = GM / 2r. */
export const orbitKineticEnergy = (GM, r) => GM / (2 * r);

/**
 * Energy per kg to put something into a circular orbit at altitude h above a
 * surface of radius R, ignoring air drag, gravity losses and the Earth's spin:
 * the climb plus the orbital kinetic energy, and the share of each.
 */
export function energySplit(GM, R, h) {
  const climb = climbEnergy(GM, R, h);
  const kinetic = orbitKineticEnergy(GM, R + h);
  const total = climb + kinetic;
  return { climb, kinetic, total, heightFraction: climb / total, speedFraction: kinetic / total };
}

/** Energy per kg to escape from radius R (from rest at R): GM / R. */
export const escapeEnergy = (GM, R) => GM / R;

/* ---------- The 2 cm Earth scale ---------- */

/** Screen metres per real metre when Earth's mean diameter is drawn 2 cm across (the space page's near stop). */
export const SCREEN_PER_WORLD = NEAR_EARTH_SCREEN_SIZE / EARTH_DIAMETER;

/** A real length (m) shrunk to the 2 cm Earth scale (screen metres). */
export const toScreen = (worldM) => worldM * SCREEN_PER_WORLD;

/** Scale ratio "1 : N" of the 2 cm Earth (N real metres per screen metre). */
export const SCALE_RATIO = 1 / SCREEN_PER_WORLD;

/* ---------- The orbits on the page (all computed from the cited data) ---------- */

/** Orbit radius from an altitude above the mean sphere. */
export const radiusFromAltitude = (h) => EARTH_MEAN_RADIUS + h;

/** Geostationary orbit radius: one turn per sidereal day. */
export const GEO_RADIUS = radiusForPeriod(GM_EARTH, SIDEREAL_DAY);
/** Geostationary altitude above the equator (the usual quoted figure). */
export const GEO_ALTITUDE = GEO_RADIUS - EARTH_EQUATORIAL_RADIUS;

/** One orbit's summary: radius, speeds, period, and its height above the 2 cm marble. */
export function orbitFacts(h, GM = GM_EARTH, R = EARTH_MEAN_RADIUS) {
  const r = R + h;
  return {
    altitude: h,
    r,
    v: circularSpeed(GM, r),
    vEsc: escapeSpeed(GM, r),
    period: orbitalPeriod(GM, r),
    omega: angularSpeed(GM, r),
    screenHeight: toScreen(h), // above the surface of the 2 cm Earth, screen metres
    screenRadius: toScreen(r), // from the centre of the 2 cm Earth, screen metres
  };
}

export const ISS_FACTS = orbitFacts(ISS.altitude);
export const GPS_FACTS = orbitFacts(GPS.altitude);
export const KARMAN_FACTS = orbitFacts(KARMAN_LINE);
/** GEO uses its true radius; its "altitude" here is above the mean sphere (drawn surface). */
export const GEO_FACTS = orbitFacts(GEO_RADIUS - EARTH_MEAN_RADIUS);

/** Surface values (mean radius). */
export const SURFACE_ESCAPE_SPEED = escapeSpeed(GM_EARTH, EARTH_MEAN_RADIUS);
export const SURFACE_CIRCULAR_SPEED = circularSpeed(GM_EARTH, EARTH_MEAN_RADIUS);

/** The ISS energy split (the page's "about 11% height, 89% speed"). */
export const ISS_ENERGY = energySplit(GM_EARTH, EARTH_MEAN_RADIUS, ISS.altitude);

/** Speed on screen (m/s) of something moving at v m/s in the 2 cm Earth model, at a time rate. */
export const screenSpeed = (v, rate = 1) => toScreen(v) * rate;
