/**
 * suction-cup-model.js: vacuum gripper sizing (pure maths, SI units, no DOM;
 * tested in /tests/suction-cup.test.html).
 *
 * Holding force (theoretical, static, no safety factor): F = Δp × A × n, where
 * Δp is the vacuum below atmospheric pressure, A the suction area of one cup
 * and n the number of cups. The page takes A = π d² / 4 from the diameter the
 * user enters: SMC's tables use the nominal pad diameter this way, while
 * Schmalz specifies the "effective suction area" under vacuum (about the
 * inner diameter of the sealing lip), so a catalogue cup gives somewhat less.
 *
 * Required force, two published conventions (see js/data/suction-cup-data.js):
 *   Schmalz, with safety factor S and friction coefficient μ:
 *     I   cup horizontal, vertical lift:   F = m (g + a) S
 *     II  cup horizontal, sideways move:   F = m (g + a/μ) S
 *     III cup vertical (on a vertical face): F = (m/μ)(g + a) S
 *   SMC, with safety factor t (4 for horizontal lifting, 8 for vertical lifting):
 *     the lifting force F/t must exceed the weight: F = t m g.
 *     There is no acceleration or friction term: t covers them.
 */

import { G0 } from './physics.js';
import { STANDARD_ATMOSPHERE_KPA, CONVENTIONS } from './data/suction-cup-data.js';

export const LOAD_CASES = ['I', 'II', 'III'];

/* ---------- Pressure ---------- */

/** Vacuum as a percentage of the standard atmosphere (gauge kPa, negative below atmosphere). */
export const vacuumPercent = (gaugeKPa) => (100 * -gaugeKPa) / STANDARD_ATMOSPHERE_KPA;

/** Absolute pressure in the cup, kPa, assuming standard atmospheric pressure outside. */
export const absolutePressureKPa = (gaugeKPa) => STANDARD_ATMOSPHERE_KPA + gaugeKPa;

/* ---------- Holding force ---------- */

/** Area of a round cup of diameter d (m), m². */
export const cupArea = (d) => (Math.PI * d * d) / 4;

/** Theoretical holding force, N: Δp × A × n (Δp from the gauge vacuum in kPa). */
export const holdingForce = (gaugeKPa, d, n = 1) => -gaugeKPa * 1000 * cupArea(d) * n;

/** SMC's form, in its units: W = P × S × 0.1 / t (P in kPa, S in cm², W in N). */
export const smcLiftingForce = (pKPa, areaCm2, t = 1) => (Math.abs(pKPa) * areaCm2 * 0.1) / t;

/** Diameter (m) at which one cup gives a theoretical force F at this vacuum: d = √(4F / πΔp). */
export const diameterForForce = (F, gaugeKPa) => Math.sqrt((4 * F) / (Math.PI * -gaugeKPa * 1000));

/** Vacuum (kPa below atmosphere, positive) needed for n cups of diameter d to give F. */
export const vacuumForForce = (F, d, n = 1) => F / (cupArea(d) * n) / 1000;

/**
 * Schmalz's sizing shortcut, d in cm (m in kg, vacuum in bar):
 * d = 1.12 √(m S / (P_U n μ)), with μ = 1 for horizontal pick-up. It is
 * F = Δp·A rearranged with g ≈ 9.81: 1.12 ≈ 100 √(4 × 9.81 / (π × 10⁵)).
 */
export const schmalzDiameterCm = (m, S, bar, n, mu = 1) => 1.12 * Math.sqrt((m * S) / (bar * n * mu));

/* ---------- Required force ---------- */

/** SMC's safety factor t for a load case: 8 when the pad is vertical (case III), else 4. */
export const smcFactor = (loadCase) => (loadCase === 'III' ? CONVENTIONS.smc.tVertical : CONVENTIONS.smc.tHorizontal);

/**
 * What the cups must hold, by convention.
 * params: { convention: 'schmalz' | 'smc', loadCase: 'I' | 'II' | 'III',
 *           m (kg), a (m/s²), mu, S (Schmalz safety factor), g (m/s²) }
 * Returns { demand (N, no safety factor), factor (S or t), required (N),
 *           parts: [{ key, N }] making up the demand }.
 */
export function requirement({ convention, loadCase, m, a, mu, S, g }) {
  let parts;
  let factor;
  if (convention === 'smc') {
    factor = smcFactor(loadCase);
    parts = [{ key: 'weight', N: m * g }];
  } else {
    factor = S;
    if (loadCase === 'I') parts = [{ key: 'weight', N: m * g }, { key: 'lift', N: m * a }];
    else if (loadCase === 'II') parts = [{ key: 'weight', N: m * g }, { key: 'friction', N: (m * a) / mu }];
    else parts = [{ key: 'weightFriction', N: (m * g) / mu }, { key: 'accelFriction', N: (m * a) / mu }];
  }
  const demand = parts.reduce((s, p) => s + p.N, 0);
  return { demand, factor, required: demand * factor, parts };
}

/** Largest mass (kg) these cups can carry under the convention (required = holding). */
export function maxMass(holdingN, params) {
  const perKg = requirement({ ...params, m: 1 }).required;
  return holdingN / perKg;
}

/**
 * Largest acceleration (m/s²) for this mass under Schmalz's formulas
 * (required = holding), or null for SMC, whose formula has no acceleration term.
 * Negative means the cups cannot hold the load even at rest.
 */
export function maxAcceleration(holdingN, { convention, loadCase, m, mu, S, g }) {
  if (convention === 'smc') return null;
  const perMass = holdingN / (m * S); // = g + a (I), g + a/μ (II), (g + a)/μ (III)
  if (loadCase === 'I') return perMass - g;
  if (loadCase === 'II') return mu * (perMass - g);
  return mu * perMass - g;
}

/** Smallest diameter (m) from `sizesMm` whose n cups hold `requiredN` at this vacuum, or null. */
export function smallestPassingSize(requiredN, gaugeKPa, n, sizesMm, maxMm = Infinity) {
  for (const mm of sizesMm) {
    if (mm > maxMm) break;
    if (holdingForce(gaugeKPa, mm / 1000, n) >= requiredN) return mm / 1000;
  }
  return null;
}

/** Newtons → kilogram-force (1 kgf = standard gravity × 1 kg = 9.80665 N, exact). */
export const toKgf = (N) => N / G0;
