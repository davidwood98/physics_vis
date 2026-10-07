/**
 * rutherford-model.js: pure maths for the Rutherford scattering page.
 *
 * No DOM access, so everything is unit tested (/tests/rutherford.test.html).
 * Lengths are in metres. Energies are in MeV (the natural unit here), so the
 * Coulomb constant is used in the form e²/(4πε₀) = α·ħc in MeV·m.
 *
 * The model (Rutherford 1911):
 *  - point charges, a single encounter per alpha, non-relativistic motion;
 *  - recoil included: the encounter is worked out in the centre-of-mass frame
 *    (reduced mass), then the angle is converted to the lab;
 *  - a thin foil: the chance of turning beyond θ is P = n·t·σ(>θ).
 *
 * Contents
 *   1. Constants and target properties
 *   2. One encounter: closest approach, deflection, hyperbolic path
 *   3. Cross-sections and the foil
 *   4. Monte Carlo sampling and the histogram
 *   5. Energy loss (ASTAR ranges), alpha speed, the plum-pudding estimate
 */

/* =========================================================================
 * 1. Constants and target properties
 * ====================================================================== */

export const FM = 1e-15;
export const DEG = Math.PI / 180;

/** e²/(4πε₀) in MeV·m from the fine-structure constant: α·ħc (ħc in MeV·fm). */
export const coulombMeVm = (alpha, hbarcMeVfm) => alpha * hbarcMeVfm * FM;

/** Nearest-neighbour distance in a face-centred cubic crystal of cube edge a: a/√2. */
export const fccNearestNeighbour = (a) => a / Math.SQRT2;

/** Atoms per m³ from density (kg/m³) and molar mass (kg/mol): n = ρ·N_A / M. */
export const numberDensity = (densityKgM3, molarMassKgMol, avogadro) => (densityKgM3 * avogadro) / molarMassKgMol;

/** Radius of the uniform sphere with the same rms radius: R = √(5/3)·r_rms (⟨r²⟩ = 3R²/5). */
export const uniformSphereRadius = (rms) => Math.sqrt(5 / 3) * rms;

/**
 * Everything the page needs about one target, in SI, from a cited data entry
 * (js/data/rutherford-data.js) and the constants.
 */
export function targetProperties(t, c) {
  const a = t.latticeA * 1e-10;
  const dnn = fccNearestNeighbour(a);
  const n = numberDensity(t.densityGcm3 * 1000, t.molarMassG / 1000, c.avogadro);
  const rms = t.rmsRadiusFm * FM;
  return {
    Z: t.Z,
    a,
    dnn,                                // atom spacing (nearest neighbours), m
    atomRadius: dnn / 2,                // touching-spheres (metallic) radius, m
    n,                                  // atoms per m³
    rmsRadius: rms,                     // rms charge radius, m
    radius: uniformSphereRadius(rms),   // edge of the equivalent uniform sphere, m
    massRatio: c.alphaMassU / t.molarMassG, // m/M (the atom's electrons are under 0.03% of its mass)
  };
}

/* =========================================================================
 * 2. One encounter
 * ====================================================================== */

/** Kinetic energy in the centre-of-mass frame for a projectile of lab energy E on a target at rest. */
export const centreOfMassEnergy = (E, massRatio) => E / (1 + massRatio);

/**
 * Head-on distance of closest approach d = zZ·e²/(4πε₀·E): all the kinetic
 * energy has turned into electrical potential energy. Pass the centre-of-mass
 * energy to include recoil, the lab energy for a fixed nucleus.
 */
export const headOnDistance = (z, Z, kMeVm, E) => (z * Z * kMeVm) / E;

/** Deflection (centre-of-mass frame) for impact parameter b: θ = 2·arctan(d / 2b). */
export const deflection = (b, d) => 2 * Math.atan2(d, 2 * b);

/** Impact parameter that gives deflection θ: b = (d/2)·cot(θ/2). */
export const impactForAngle = (theta, d) => (d / 2) / Math.tan(theta / 2);

/**
 * Closest approach for impact parameter b: r_min = (d/2)(1 + 1/sin(θ/2)),
 * written as d/2 + √((d/2)² + b²), which is the same thing and safe at b = 0.
 */
export const closestApproach = (b, d) => d / 2 + Math.hypot(d / 2, b);

/** Lab angle from the centre-of-mass angle: tan θ_lab = sin θ / (cos θ + m/M). */
export const labAngle = (thetaCm, massRatio) => Math.atan2(Math.sin(thetaCm), Math.cos(thetaCm) + massRatio);

/** Centre-of-mass angle from the lab angle (m < M): θ = θ_lab + arcsin((m/M)·sin θ_lab). */
export const cmAngle = (thetaLab, massRatio) => thetaLab + Math.asin(massRatio * Math.sin(thetaLab));

/** Lab energy at which a head-on alpha just reaches separation r (e.g. the touching distance). */
export const energyToReach = (z, Z, kMeVm, r, massRatio) => ((z * Z * kMeVm) / r) * (1 + massRatio);

/**
 * Points along the hyperbolic path of the relative motion (nucleus at the
 * origin, alpha arriving from x = −∞ at height b, y up), in metres:
 * 1/r = sin φ / b + (d / 2b²)(cos φ − 1), φ measured from the incoming
 * direction. Clipped to r <= rMax. b may be negative (mirror image).
 */
export function hyperbolaPoints(b, d, rMax, n = 160) {
  const s = Math.sign(b) || 1;
  const B = Math.abs(b);
  if (B === 0) return d <= rMax ? [[-rMax, 0], [-d, 0]] : [];
  const u = (phi) => Math.sin(phi) / B + (d / (2 * B * B)) * (Math.cos(phi) - 1);
  const phiOut = Math.PI - deflection(B, d);
  const phiPeak = phiOut / 2; // closest approach: the path is symmetric about it
  const uMin = 1 / rMax;
  if (u(phiPeak) < uMin) return []; // never comes within rMax
  // Where the path crosses r = rMax on the way in (φa) and out (φb), by bisection.
  const cross = (lo, hi, rising) => {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if ((u(mid) < uMin) === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const phiA = cross(0, phiPeak, true);
  const phiB = cross(phiPeak, phiOut, false);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const phi = phiA + ((phiB - phiA) * i) / n;
    const r = 1 / Math.max(u(phi), uMin);
    pts.push([-r * Math.cos(phi), s * r * Math.sin(phi)]);
  }
  return pts;
}

/* =========================================================================
 * 3. Cross-sections and the foil
 * ====================================================================== */

/** Rutherford: dσ/dΩ = (d/4)² / sin⁴(θ/2), centre-of-mass frame (m² per steradian). */
export const diffCrossSection = (thetaCm, d) => (d / 4) ** 2 / Math.sin(thetaCm / 2) ** 4;

/**
 * dσ/dΩ in the lab, from the centre-of-mass value and the solid-angle Jacobian
 * dΩ_cm/dΩ_lab = (1 + 2ρ cos θ + ρ²)^(3/2) / |1 + ρ cos θ|, ρ = m/M.
 */
export function diffCrossSectionLab(thetaLab, d, massRatio) {
  const th = cmAngle(thetaLab, massRatio);
  const c = Math.cos(th);
  const jac = (1 + 2 * massRatio * c + massRatio * massRatio) ** 1.5 / Math.abs(1 + massRatio * c);
  return diffCrossSection(th, d) * jac;
}

/** Cross-section for turning beyond θ (centre-of-mass): σ(>θ) = π·(d/2)²·cot²(θ/2) = π·b(θ)². */
export const crossSectionBeyond = (thetaCm, d) => Math.PI * impactForAngle(thetaCm, d) ** 2;

/** Thin foil: probability of turning beyond the LAB angle θ, P = n·t·σ(>θ), capped at 1. */
export function probabilityBeyond(thetaLab, setup) {
  if (thetaLab <= 0) return 1;
  return Math.min(1, setup.nt * crossSectionBeyond(cmAngle(thetaLab, setup.massRatio), setup.d));
}

/**
 * The scattering setup for alpha energy E (MeV) on target properties p and foil
 * thickness t (m): d with recoil, the fixed-nucleus d for comparison, n·t, and
 * the largest impact parameter b_max (one nucleus per π·b_max² of foil area).
 */
export function scatteringSetup({ E, t, p, z, kMeVm }) {
  const Ecm = centreOfMassEnergy(E, p.massRatio);
  const d = headOnDistance(z, p.Z, kMeVm, Ecm);
  const nt = p.n * t;
  const bMax = 1 / Math.sqrt(Math.PI * nt);
  return {
    E, Ecm, t, d, nt, bMax,
    dFixed: headOnDistance(z, p.Z, kMeVm, E),
    massRatio: p.massRatio,
    minAngle: labAngle(deflection(bMax, d), p.massRatio), // the smallest turn any alpha gets here
  };
}

/* =========================================================================
 * 4. Monte Carlo
 * ====================================================================== */

/**
 * One alpha: the impact parameter to the nucleus it passes closest to is
 * uniform over the patch of foil holding one atom through its whole thickness
 * (area 1/(n·t) = π·b_max²), so P(b) ∝ b: b = b_max·√u for u uniform in (0, 1].
 * Then P(θ > Θ) = (b(Θ)/b_max)² = n·t·σ(>Θ), exactly the thin-foil formula.
 */
export function scatterOne(u, setup) {
  const b = setup.bMax * Math.sqrt(u);
  const thetaCm = deflection(b, setup.d);
  return { b, thetaCm, theta: labAngle(thetaCm, setup.massRatio), rMin: closestApproach(b, setup.d) };
}

/** Histogram bin for a lab angle (radians) with bins binDeg wide from 0 to 180°. */
export function binIndex(theta, binDeg, nBins) {
  return Math.min(nBins - 1, Math.max(0, Math.floor(theta / DEG / binDeg)));
}

/**
 * Expected count in each bin for N alphas: N·[P(>θ₁) − P(>θ₂)], the Rutherford
 * dσ/dΩ integrated over each ring of angles.
 */
export function expectedBins(N, setup, binDeg, nBins) {
  const out = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++) {
    out[i] = N * (probabilityBeyond(i * binDeg * DEG, setup) - probabilityBeyond((i + 1) * binDeg * DEG, setup));
  }
  return out;
}

/** Fire `count` alphas into the tallies (no animation). rng() returns uniform numbers in [0, 1). */
export function fireMany(count, setup, tally, rng = Math.random) {
  const { bins, binDeg } = tally;
  const n = bins.length;
  const t90 = Math.PI / 2;
  const t10 = 10 * DEG;
  let last = null;
  for (let i = 0; i < count; i++) {
    const u = 1 - rng(); // (0, 1]
    const b = setup.bMax * Math.sqrt(u);
    const th = labAngle(deflection(b, setup.d), setup.massRatio);
    bins[Math.min(n - 1, Math.floor(th / DEG / binDeg))]++;
    if (th > t90) {
      tally.beyond90++;
      tally.lastBack = b;
    }
    if (th > t10) tally.beyond10++;
    if (i === count - 1) last = b;
  }
  tally.total += count;
  if (last !== null) {
    const thetaCm = deflection(last, setup.d);
    tally.latest = { b: last, thetaCm, theta: labAngle(thetaCm, setup.massRatio), rMin: closestApproach(last, setup.d) };
  }
  return tally;
}

export function newTally(binDeg = 5) {
  return { binDeg, bins: new Float64Array(Math.round(180 / binDeg)), total: 0, beyond90: 0, beyond10: 0, latest: null, lastBack: null };
}

/** Add one alpha (from scatterOne) to the tallies. */
export function record(tally, alpha) {
  const n = tally.bins.length;
  tally.bins[Math.min(n - 1, Math.floor(alpha.theta / DEG / tally.binDeg))]++;
  tally.total++;
  if (alpha.theta > Math.PI / 2) {
    tally.beyond90++;
    tally.lastBack = alpha.b;
  }
  if (alpha.theta > 10 * DEG) tally.beyond10++;
  tally.latest = alpha;
  return tally;
}

/** Small seeded generator for the tests (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =========================================================================
 * 5. Energy loss, speed, plum pudding
 * ====================================================================== */

/**
 * CSDA range (kg/m²) at energy E (MeV) from an ASTAR table of [MeV, g/cm²]
 * rows, interpolated log-log; below the first row, range ∝ E (straight to 0).
 */
export function csdaRange(table, E) {
  if (!(E > 0)) return 0;
  const toKgM2 = 10; // 1 g/cm² = 10 kg/m²
  if (E <= table[0][0]) return (table[0][1] * toKgM2 * E) / table[0][0];
  for (let i = 1; i < table.length; i++) {
    if (E <= table[i][0]) {
      const [e0, r0] = table[i - 1];
      const [e1, r1] = table[i];
      const f = Math.log(E / e0) / Math.log(e1 / e0);
      return Math.exp(Math.log(r0) + f * Math.log(r1 / r0)) * toKgM2;
    }
  }
  const [eA, rA] = table[table.length - 2];
  const [eB, rB] = table[table.length - 1];
  return Math.exp(Math.log(rB) + (Math.log(E / eB) / Math.log(eB / eA)) * Math.log(rB / rA)) * toKgM2;
}

/** Energy (MeV) at which the CSDA range equals R (kg/m²): the inverse of csdaRange, by bisection. */
export function energyForRange(table, R) {
  if (!(R > 0)) return 0;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (csdaRange(table, mid) < R) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Energy left (MeV) after crossing an areal density (kg/m², thickness × density)
 * of the material, in the continuous-slowing-down approximation. 0 = stopped.
 */
export function energyAfter(table, E0, arealDensity) {
  const R = csdaRange(table, E0) - arealDensity;
  return R > 0 ? energyForRange(table, R) : 0;
}

/** Speed as a fraction of light speed for kinetic energy E and rest energy mc² (relativistic). */
export function speedFraction(E, restEnergy) {
  const gamma = 1 + E / restEnergy;
  return Math.sqrt(1 - 1 / (gamma * gamma));
}

/**
 * Thomson's "plum pudding": the atom's positive charge spread evenly through a
 * sphere of radius R. Small-angle deflection of a straight path at impact
 * parameter b = sR (s <= 1): θ = (d/R)·[(1 − √(1−s²))/s + s·√(1−s²)], with d the
 * head-on distance for a point nucleus. Outside the sphere (s >= 1) it is the
 * point-charge value θ = d/b.
 */
export function thomsonDeflection(s, dOverR) {
  if (s >= 1) return dOverR / s;
  const c = Math.sqrt(1 - s * s);
  return dOverR * ((1 - c) / s + s * c);
}

/** Largest single-atom deflection in the plum-pudding atom (golden-section search over s). */
export function thomsonMaxDeflection(dOverR) {
  let a = 0.01;
  let b = 1;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 80; i++) {
    const x1 = b - g * (b - a);
    const x2 = a + g * (b - a);
    if (thomsonDeflection(x1, dOverR) < thomsonDeflection(x2, dOverR)) a = x1;
    else b = x2;
  }
  return thomsonDeflection((a + b) / 2, dOverR);
}
