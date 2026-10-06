/**
 * bodies.js: the Sun's planets and the Moon (data only, no code).
 *
 * Orbital elements: JPL Solar System Dynamics, "Approximate Positions of the
 * Planets", Table 1 (Keplerian elements with respect to the mean ecliptic and
 * equinox of J2000, valid 1800 AD - 2050 AD), E.M. Standish.
 *   https://ssd.jpl.nasa.gov/planets/approx_pos.html   (retrieved 2026-10-06)
 *   a      semi-major axis, au                       (J2000 value)
 *   e      eccentricity                              (J2000 value)
 *   L0     mean longitude at J2000, degrees
 *   varpi  longitude of perihelion at J2000, degrees
 *   Ldot   rate of the mean longitude, degrees per Julian century
 *          (the orbital period is computed from it in astro.js: 360 / Ldot centuries)
 * "Earth" uses JPL's Earth-Moon barycentre row. Only the J2000 values and the
 * mean-longitude rate are used; inclination and node are ignored because the
 * page draws the orbits flat (planar), so positions are approximate (a few degrees).
 *
 * Diameters: NASA Goddard Space Flight Center, Planetary Fact Sheet - Metric,
 * "Diameter (km)" row (equatorial), D.R. Williams.
 *   https://nssdc.gsfc.nasa.gov/planetary/factsheet/   (retrieved 2026-10-06)
 * Earth's diameter is not taken from here: the page uses its mean-diameter
 * constant (astro.js EARTH_DIAMETER) everywhere.
 * Moon diameter: NASA Planetary Fact Sheet "Diameter (km)" 3475 (same page).
 * NASA material is not subject to copyright in the United States.
 */

export const PLANETS = [
  { id: 'mercury', name: 'Mercury', a: 0.38709927, e: 0.20563593, L0: 252.2503235, varpi: 77.45779628, Ldot: 149472.67411175, diameterKm: 4879 },
  { id: 'venus', name: 'Venus', a: 0.72333566, e: 0.00677672, L0: 181.9790995, varpi: 131.60246718, Ldot: 58517.81538729, diameterKm: 12104 },
  { id: 'earth', name: 'Earth', a: 1.00000261, e: 0.01671123, L0: 100.46457166, varpi: 102.93768193, Ldot: 35999.37244981, diameterKm: null },
  { id: 'mars', name: 'Mars', a: 1.52371034, e: 0.0933941, L0: -4.55343205, varpi: -23.94362959, Ldot: 19140.30268499, diameterKm: 6792 },
  { id: 'jupiter', name: 'Jupiter', a: 5.202887, e: 0.04838624, L0: 34.39644051, varpi: 14.72847983, Ldot: 3034.74612775, diameterKm: 142984 },
  { id: 'saturn', name: 'Saturn', a: 9.53667594, e: 0.05386179, L0: 49.95424423, varpi: 92.59887831, Ldot: 1222.49362201, diameterKm: 120536 },
  { id: 'uranus', name: 'Uranus', a: 19.18916464, e: 0.04725744, L0: 313.23810451, varpi: 170.9542763, Ldot: 428.48202785, diameterKm: 51118 },
  { id: 'neptune', name: 'Neptune', a: 30.06992276, e: 0.00859048, L0: -55.12002969, varpi: 44.96476227, Ldot: 218.45945325, diameterKm: 49528 },
];

/** The Moon. Orbit radius and periods are site constants in astro.js. */
export const MOON = { id: 'moon', name: 'Moon', diameterKm: 3475 };

/** Inner and outer edge of the asteroid belt band drawn on the page (au), as specified for this site. */
export const ASTEROID_BELT_AU = [2.2, 3.2];
