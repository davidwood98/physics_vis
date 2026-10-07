/**
 * suction-cup-data.js: cited reference data for the vacuum gripper page
 * (data only). Each value quotes its source; all sources retrieved 2026-10-07.
 *
 * Two manufacturers' sizing conventions are recorded, because they differ:
 *  - Schmalz: required holding force per load case, with the acceleration and
 *    the friction coefficient in the formula and a safety factor S of 1.5 to 2.5.
 *  - SMC: theoretical lifting force divided by a fixed safety factor t
 *    (4 for horizontal lifting, 8 for vertical lifting) must exceed the load.
 */

/** Standard atmosphere, kPa: an exact definition (1 atm = 101 325 Pa), no source needed. */
export const STANDARD_ATMOSPHERE_KPA = 101.325;

const SCHMALZ_HOLDING_URL =
  'https://www.schmalz.com/en/vacuum-knowledge/the-vacuum-system-and-its-components/system-design-calculation-example/theoretical-holding-force-of-a-suction-cup';
const SCHMALZ_DESIGN_URL =
  'https://www.schmalz.com/en/support/know-how/vacuum-knowledge/the-vacuum-system-and-its-components/vacuum-suction-cups/design-of-the-suction-cup';
const SCHMALZ_SELECTION_URL =
  'https://www.schmalz.com/en/support/know-how/vacuum-knowledge/the-vacuum-system-and-its-components/system-design-calculation-example/suction-cup-selection';
const SCHMALZ_WEIGHT_URL =
  'https://www.schmalz.com/en/support/know-how/vacuum-knowledge/the-vacuum-system-and-its-components/system-design-calculation-example/weight-calculation-of-a-workpiece';
const SCHMALZ_SUF90_URL =
  'https://www.schmalz.com/en/products/vacuum-technology-for-automation-301607/vacuum-components-301608/vacuum-suction-cups-301609/flat-suction-cups-round-301610/flat-suction-cups-suf-301611/10.01.01.13956';
const SMC_SELECTION_URL =
  'https://www.smcworld.com/assets/products/pickup/en-jp/vacuum_device/select/4-P0878-883_en.pdf';

export const SOURCES = {
  schmalzHolding: { url: SCHMALZ_HOLDING_URL, text: 'J. Schmalz GmbH, Vacuum Knowledge: "Theoretical Holding Force of a Suction Cup"' },
  schmalzDesign: { url: SCHMALZ_DESIGN_URL, text: 'J. Schmalz GmbH, Vacuum Knowledge: "Design of the Suction Cup"' },
  schmalzSelection: { url: SCHMALZ_SELECTION_URL, text: 'J. Schmalz GmbH, Vacuum Knowledge: "Suction Cup Selection"' },
  schmalzWeight: { url: SCHMALZ_WEIGHT_URL, text: 'J. Schmalz GmbH, Vacuum Knowledge: "Weight Calculation of a Workpiece"' },
  schmalzSuf90: { url: SCHMALZ_SUF90_URL, text: 'J. Schmalz GmbH, product page "Flat Suction Cup SUF 90 NBR-55" (10.01.01.13956)' },
  smcSelection: { url: SMC_SELECTION_URL, text: 'SMC Corporation, Vacuum Equipment "Model Selection", catalogue pages 878 to 883' },
};

/**
 * The two safety conventions.
 *
 * Schmalz (holding force page): "F_TH = m × (g + a) × S" (load case I, suction cup
 * horizontal, force vertical), "F_TH = m × (g + a ⁄ μ) × S" (II, suction cup horizontal,
 * force horizontal), "F_TH = (m ⁄ μ) × (g + a) × S" (III, suction cup vertical,
 * force vertical), with "g = Gravity [9.81 m/s²]". "The safety factor has a minimum
 * value of 1.5 for smooth and dense workpieces. A safety factor of 2.0 or greater
 * must be used for critical, heterogeneous, porous, rough or oiled workpieces."
 * Design page: "When swiveling workpieces during the handling task, a safety factor
 * of 2.5 or higher has to be used"; "F = Δp x A ... A = Effective suction area (the
 * effective area of a suction cup under vacuum)".
 *
 * SMC (Model Selection, p. 880): "W = P x S x 0.1 x 1/t   W : Lifting force (N)
 * P : Vacuum pressure (kPa)  S : Pad area (cm2)  t : Safety factor Horizontal lifting:
 * 4 or more  Vertical lifting: 8 or more". p. 878: "Determine a pad diameter (or pad
 * area) that is sufficient to ensure the lifting force is greater than the workpiece
 * mass." p. 878: "Since the theoretical lifting force is the value measured at the
 * static state, the safety factor responding to the actual operating conditions must
 * be estimated". p. 879: "the acceleration rate of the lateral movement must be
 * minimized".
 */
export const CONVENTIONS = {
  schmalz: {
    id: 'schmalz',
    name: 'Schmalz',
    gWritten: 9.81, // Schmalz's formulas use g = 9.81 m/s²; the page uses standard gravity 9.80665
    safetyFactors: [
      { S: 1.5, label: '1.5: smooth, dense workpieces (minimum)' },
      { S: 2, label: '2.0: porous, rough, oiled or critical workpieces' },
      { S: 2.5, label: '2.5: workpiece swivelled during handling' },
    ],
    source: [SOURCES.schmalzHolding, SOURCES.schmalzDesign],
  },
  smc: {
    id: 'smc',
    name: 'SMC',
    tHorizontal: 4, // "Horizontal lifting: 4 or more"
    tVertical: 8,   // "Vertical lifting: 8 or more"
    ejectorVacuumKPa: -60, // "The vacuum pressure when using an ejector is approximately -60 kPa as a guide."
    source: [SOURCES.smcSelection],
  },
};

/**
 * Friction coefficient μ between cup and workpiece, Schmalz reference values
 * (holding force page): "0.2 ... 0.3 for wet surfaces, 0.5 for wood, metal, glass,
 * stone, etc., 0.6 for rough surfaces"; oiled: "For standard suction cups without
 * specified lateral force, the recommended reference value is μ = 0.1 to 0.3."
 * Where Schmalz gives a range, the page uses its lower (cautious) end.
 * Schmalz adds: "The friction coefficient μ therefore has to be determined correctly
 * through tests."
 */
export const FRICTION = [
  { id: 'oiled', label: 'Oiled (0.1 to 0.3)', mu: 0.1, range: [0.1, 0.3] },
  { id: 'wet', label: 'Wet (0.2 to 0.3)', mu: 0.2, range: [0.2, 0.3] },
  { id: 'dry', label: 'Dry wood, metal, glass, stone (0.5)', mu: 0.5 },
  { id: 'rough', label: 'Rough (0.6)', mu: 0.6 },
];

/**
 * SMC standard round pad diameters, mm, from the "Theoretical Lifting Force" table
 * (p. 880): "Pad diameter (mm) ø1.5 ø2 ø3.5 ø4 ø6 ø8 ø10 ø13 ø16 ø20 ø25 ø32 ø40 ø50"
 * and "ø63 ø80 ø100 ø125 ø150 ø200 ø250 ø300 ø340". Used for "smallest standard
 * size that passes"; other makers' size steps differ.
 */
export const SMC_PAD_DIAMETERS_MM = [1.5, 2, 3.5, 4, 6, 8, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 150, 200, 250, 300, 340];

/**
 * Rows of SMC's theoretical lifting force table (p. 880), N, "Theoretical lifting
 * force = P x S x 0.1", for pads ø13 to ø50 (whole-newton entries):
 *   -80 kPa: ø13 10, ø16 16, ø20 25, ø25 39, ø32 64, ø40 100, ø50 157
 *   -60 kPa: ø16 12, ø20 18, ø25 29, ø32 48, ø40 75, ø50 117
 * and the worked example on p. 878: "ø20 3.14 [cm²] ... 12 N [at -40 kPa] ... 25 N
 * [at -80 kPa]; ø40 12.56 ... 50 N ... 100 N". (Used by the tests.)
 */
export const SMC_TABLE = [
  { kPa: -80, d: 13, N: 10 }, { kPa: -80, d: 16, N: 16 }, { kPa: -80, d: 20, N: 25 }, { kPa: -80, d: 25, N: 39 },
  { kPa: -80, d: 32, N: 64 }, { kPa: -80, d: 40, N: 100 }, { kPa: -80, d: 50, N: 157 },
  { kPa: -60, d: 16, N: 12 }, { kPa: -60, d: 20, N: 18 }, { kPa: -60, d: 25, N: 29 }, { kPa: -60, d: 32, N: 48 },
  { kPa: -60, d: 40, N: 75 }, { kPa: -60, d: 50, N: 117 },
  { kPa: -40, d: 20, N: 12 }, { kPa: -40, d: 40, N: 50 },
];

/**
 * Schmalz's worked example (system design pages). Workpiece: "m = 2.5 m × 1.25 m ×
 * 0.0025 m × 7,850 kg/m3, m = 61.33 kg"; "Max. acceleration: X, Y axis: 5 m/s2 Z axis:
 * 5 m/s2"; μ = 0.5 (load cases II and III).
 *   I:   "F_TH = 61.33 kg × (9.81 m/s² + 5 m/s²) × 1.5, F_TH = 1,363 N"
 *   II:  "F_TH = 61.33 kg × (9.81 m/s2 + 5 m/s2 ⁄ 0.5) x 1.5, F_TH = 1,822 N"
 *   III: "F_TH = (61.33 kg ⁄ 0.5) x (9.81 m/s2 + 5 m/s2) x 2, F_TH = 3,633 N"
 * Suction cup selection: "F_S = 1,822 N/6, F_S = 304 N ... 6 x SUF 90 NBR with a
 * diameter of 90 mm and a suction force of 328 N each"; "F_S = 1,822 N/8, F_S = 228 N
 * ... 8 x SUF 80 NBR ... 254 N each".
 */
export const SCHMALZ_EXAMPLE = {
  lengthM: 2.5, widthM: 1.25, thicknessM: 0.0025, densityKgM3: 7850, massKg: 61.33,
  a: 5, mu: 0.5,
  caseI: { S: 1.5, N: 1363 },
  caseII: { S: 1.5, N: 1822 },
  caseIII: { S: 2, N: 3633 },
  perCup: [{ n: 6, N: 304, cup: 'SUF 90', cupN: 328 }, { n: 8, N: 228, cup: 'SUF 80', cupN: 254 }],
};

/**
 * Schmalz's diameter shortcut (design page): "For horizontal pick-up: d = 1.12 ×
 * √(m × S) ⁄ (P_U × n)"; "For vertical pick-up: d = 1.12 × √(m × S) ⁄ (P_U × n x µ)",
 * d in cm, m in kg, P_U "Vacuum in bar". Examples: "d=1.12 × √(50kgx2)÷(0.4barx4),
 * d= 8.85 cm" and "d=1.12 × √(50kgx2)÷(0.4barx4x0.5), d= 12.5 cm".
 */
export const SCHMALZ_DIAMETER_EXAMPLE = { m: 50, S: 2, bar: 0.4, n: 4, mu: 0.5, horizontalCm: 8.85, verticalCm: 12.5 };

/**
 * A real cup's catalogue force is below Δp × nominal area. Schmalz SUF 90 NBR-55
 * product page: "Ds 90 mm", "Suction force (-600mbar) 328 N", "The suction force
 * values are theoretical values at -0.6 bar vacuum and a dry, smooth and even
 * workpiece surface – they are specified without safety factors."
 */
export const SUF90 = { diameterMm: 90, vacuumKPa: -60, suctionForceN: 328 };

/**
 * Densities from Schmalz's table (weight calculation page), kg/dm³ → kg/m³:
 * "Glass 2.50". Used for the glass pane preset's mass.
 */
export const DENSITY_KG_M3 = { glass: 2500 };
