/**
 * compact-objects-model.js: pure maths for the compact-objects page.
 *
 * No DOM access (unit tested in /tests/compact-objects.test.html). SI units.
 * Masses enter as mass parameters GM (m³/s²); the Schwarzschild radius comes
 * straight from GM, and SI masses from M = GM / G (IAU 2015 Resolution B3).
 * Everything here is Newtonian except Rs and the photon-capture shadow, which
 * are the general-relativity results for a non-spinning black hole.
 */

import { C_LIGHT, AU, PARSEC } from './astro.js';
import {
  G, GM_SUN, GM_EARTH, GM_JUPITER, R_SUN, SIRIUS_B, NEUTRON_STARS, SGR_A, EHT_SGR_A, M87, TEASPOON,
} from './data/compact-objects-data.js';

const C2 = C_LIGHT * C_LIGHT;

/* ---------- Black holes ---------- */

/** Schwarzschild radius: Rs = 2GM / c², the radius at which the escape speed reaches c. */
export const schwarzschildRadius = (GM) => (2 * GM) / C2;

/** Mass (kg) from a mass parameter: M = GM / G. */
export const massFromGM = (GM) => GM / G;

/** Mass parameter from a mass (kg). */
export const gmFromMass = (m) => G * m;

/**
 * Diameter of a non-spinning black hole's shadow as seen from far away:
 * photons are captured inside an impact parameter of √27 GM/c², so the
 * shadow is 2√27 GM/c² = √27 × Rs across (about 5.2 Rs).
 */
export const shadowDiameter = (GM) => (2 * Math.sqrt(27) * GM) / C2;

/* ---------- Any sphere of mass M (GM) and radius R ---------- */

/** Mean density: ρ = M / (4/3 π R³). */
export const meanDensity = (mass, R) => mass / ((4 / 3) * Math.PI * R * R * R);

/** Newtonian surface gravity: g = GM / R². */
export const surfaceGravity = (GM, R) => GM / (R * R);

/** Newtonian escape speed from the surface: √(2GM / R). */
export const escapeSpeed = (GM, R) => Math.sqrt((2 * GM) / R);

/** Compactness 2GM / (R c²) = Rs / R = (v_esc / c)²: 1 at the horizon. */
export const compactness = (GM, R) => schwarzschildRadius(GM) / R;

/** Mass of a teaspoon (5 ml) of material at density ρ. */
export const teaspoonMass = (rho) => rho * TEASPOON;

/** Everything the "Squeeze the Sun" readouts show, for mass parameter GM squeezed to radius R. */
export function squeeze(GM, R) {
  const mass = massFromGM(GM);
  const rho = meanDensity(mass, R);
  const vEsc = escapeSpeed(GM, R);
  return {
    R, mass, rho,
    g: surfaceGravity(GM, R),
    vEsc,
    vOverC: vEsc / C_LIGHT,
    compactness: compactness(GM, R),
    teaspoon: teaspoonMass(rho),
  };
}

/* ---------- Angles on the sky ---------- */

/** Micro-arcseconds to radians. */
export const microArcsecToRad = (uas) => (uas * 1e-6 * Math.PI) / (180 * 3600);

/** Linear size (m) of something subtending θ micro-arcseconds at a distance of d parsecs. */
export const sizeFromAngle = (uas, distancePc) => microArcsecToRad(uas) * distancePc * PARSEC;

/** Angle (micro-arcseconds) subtended by a size (m) at a distance of d parsecs. */
export const angleFromSize = (size, distancePc) => (size / (distancePc * PARSEC)) * ((180 * 3600) / Math.PI) * 1e6;

/* ---------- The page's objects (computed from the cited data) ---------- */

export const M_SUN = massFromGM(GM_SUN);
export const M_EARTH = massFromGM(GM_EARTH);
export const RS_SUN = schwarzschildRadius(GM_SUN);
export const RS_EARTH = schwarzschildRadius(GM_EARTH);
export const RS_JUPITER = schwarzschildRadius(GM_JUPITER);

/** The four stages of "Squeeze the Sun" (radius in m), each a real measured object. */
export const SIRIUS_B_RADIUS = SIRIUS_B.radiusSun * R_SUN;
export const NEUTRON_STAR = NEUTRON_STARS[0];
export const STAGES = [
  { id: 'sun', name: 'Sun', R: R_SUN },
  { id: 'wd', name: 'White dwarf', R: SIRIUS_B_RADIUS },
  { id: 'ns', name: 'Neutron star', R: NEUTRON_STAR.radius },
  { id: 'bh', name: 'Black hole', R: RS_SUN },
];

/** Sagittarius A*: mass parameter, horizon and its uncertainty (statistical and systematic, as fractions). */
export const GM_SGR_A = SGR_A.massSun * GM_SUN;
export const RS_SGR_A = schwarzschildRadius(GM_SGR_A);
export const RS_SGR_A_AU = RS_SGR_A / AU;
export const SGR_A_FRACTION_STAT = SGR_A.massStat / SGR_A.massSun;
export const SGR_A_FRACTION_SYS = SGR_A.massSys / SGR_A.massSun;
/** EHT shadow, measured angle → size at the GRAVITY distance, and the GR prediction. */
export const SGR_A_SHADOW_MEASURED = sizeFromAngle(EHT_SGR_A.shadowMicroArcsec, SGR_A.distancePc);
export const SGR_A_RING_MEASURED = sizeFromAngle(EHT_SGR_A.ringMicroArcsec, SGR_A.distancePc);
export const SGR_A_SHADOW_PREDICTED = shadowDiameter(GM_SGR_A);
export const SGR_A_HORIZON_ANGLE = angleFromSize(2 * RS_SGR_A, SGR_A.distancePc);

export const GM_M87 = M87.massSun * GM_SUN;
export const RS_M87 = schwarzschildRadius(GM_M87);
