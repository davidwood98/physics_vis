/**
 * beam-model.js: pure maths for the beam deflection page (no DOM).
 *
 * SI units throughout: metres, newtons, pascals, radians. Deflection v is
 * positive DOWNWARDS (the way a loaded beam sags); bending moment M is
 * positive when it sags the beam (tension at the bottom), so a cantilever's
 * moments are negative (hogging).
 *
 * Positions x are measured from the left support of a simply supported beam,
 * or from the wall of a cantilever. The deflection formulas are those of the
 * American Wood Council, "Beam Design Formulas with Shear and Moment
 * Diagrams", Design Aid No. 6 (2005 edition), Figures 1, 7, 8, 12 and 13:
 * https://web-media.awc.org/wp-content/uploads/2021/12/17210710/AWC-DA6-BeamFormulas-0710.pdf
 * (retrieved 2026-10-07). AWC measures a cantilever's x from its FREE end;
 * the cantilever functions below keep the printed formula and convert.
 * End slopes are the derivatives of those printed Δx formulas (checked
 * numerically in tests/beam.test.html).
 *
 * Theory: Euler–Bernoulli bending, small deflections, linear elastic
 * material, no shear deformation, ideal supports.
 */

import { G0 } from './physics.js';

export { G0 };

/** Weight (N) of a mass (kg) at standard gravity g0 = 9.80665 m/s² (exact by definition). */
export const kgToNewtons = (kg) => kg * G0;
export const newtonsToKg = (n) => n / G0;

/* =========================================================================
 * Section properties
 * ====================================================================== */

/**
 * Second moment of area I (m⁴), area A (m²), extreme-fibre distance c (m),
 * elastic section modulus Z = I / c (m³) and overall depth (m), for bending
 * about the horizontal axis (load applied vertically, depth = height).
 *
 * Formulas: rectangle bh³/12, circle πr⁴/4 (= πd⁴/64), annulus π(r₂⁴ − r₁⁴)/4,
 * hollow rectangle (bh³ − b₁h₁³)/12, from "List of second moments of area",
 * Wikipedia (citing eFunda and Roark), retrieved 2026-10-07:
 * https://en.wikipedia.org/wiki/List_of_second_moments_of_area
 * The simplified I-section uses the same subtraction as the hollow rectangle
 * (the two cut-outs beside the web sit symmetrically about the axis):
 * I = (bf h³ − (bf − tw)(h − 2tf)³) / 12. It ignores the root fillets, so it
 * slightly underestimates a rolled section (tested against the IPE 100 table).
 *
 * @param {'rect'|'round'|'tube'|'rhs'|'i'} type
 * @param {object} d dimensions in metres:
 *   rect {b, h}, round {d}, tube {D, t}, rhs {B, H, t}, i {bf, h, tf, tw}
 */
export function sectionProperties(type, d) {
  let A;
  let I;
  let depth;
  switch (type) {
    case 'rect':
      A = d.b * d.h;
      I = (d.b * d.h ** 3) / 12;
      depth = d.h;
      break;
    case 'round':
      A = (Math.PI * d.d ** 2) / 4;
      I = (Math.PI * d.d ** 4) / 64;
      depth = d.d;
      break;
    case 'tube': {
      const t = Math.min(d.t, d.D / 2);
      const Di = d.D - 2 * t;
      A = (Math.PI * (d.D ** 2 - Di ** 2)) / 4;
      I = (Math.PI * (d.D ** 4 - Di ** 4)) / 64;
      depth = d.D;
      break;
    }
    case 'rhs': {
      const t = Math.min(d.t, d.B / 2, d.H / 2);
      const Bi = d.B - 2 * t;
      const Hi = d.H - 2 * t;
      A = d.B * d.H - Bi * Hi;
      I = (d.B * d.H ** 3 - Bi * Hi ** 3) / 12;
      depth = d.H;
      break;
    }
    case 'i': {
      const tf = Math.min(d.tf, d.h / 2);
      const tw = Math.min(d.tw, d.bf);
      const hw = d.h - 2 * tf;
      A = 2 * d.bf * tf + hw * tw;
      I = (d.bf * d.h ** 3 - (d.bf - tw) * hw ** 3) / 12;
      depth = d.h;
      break;
    }
    default:
      throw new Error(`Unknown section type ${type}`);
  }
  const c = depth / 2; // every section here is symmetric about its bending axis
  return { A, I, c, Z: I / c, depth };
}

/**
 * Second moment of area by numerical integration of horizontal strips:
 * I = Σ width(y) · y² · dy over the depth (y from the centroid). Used by the
 * tests to check the closed-form formulas independently.
 *   widthAt(y): total material width at height y (m), y in [−depth/2, depth/2]
 */
export function integrateI(widthAt, depth, n = 20000) {
  const dy = depth / n;
  let I = 0;
  let A = 0;
  for (let i = 0; i < n; i++) {
    const y = -depth / 2 + (i + 0.5) * dy;
    const b = widthAt(y);
    I += b * y * y * dy;
    A += b * dy;
  }
  return { I, A };
}

/* =========================================================================
 * Elementary load cases (AWC DA6). Each returns functions of x:
 *   v(x)     deflection, m (down +)
 *   slope(x) dv/dx (small angles: radians)
 *   M(x)     bending moment, N·m (sagging +)
 * ====================================================================== */

/**
 * Simple beam, concentrated load P at distance a from the left support
 * (AWC Figure 8; Figure 7 is the special case a = L/2). b = L − a.
 *   Δx = Pbx(L² − b² − x²) / 6EIL            (x < a)
 *   Δx = Pa(L − x)(2Lx − x² − a²) / 6EIL     (x > a)
 *   Mx = Pbx / L (x < a), Pa(L − x) / L (x > a); Mmax = Pab / L at the load
 */
export function simplePoint(P, a, L, EI) {
  const b = L - a;
  return {
    v: (x) => (x <= a
      ? (P * b * x * (L * L - b * b - x * x)) / (6 * EI * L)
      : (P * a * (L - x) * (2 * L * x - x * x - a * a)) / (6 * EI * L)),
    slope: (x) => (x <= a
      ? (P * b * (L * L - b * b - 3 * x * x)) / (6 * EI * L)
      : (P * a * (2 * (L - x) ** 2 - 2 * L * x + x * x + a * a)) / (6 * EI * L)),
    M: (x) => (x <= a ? (P * b * x) / L : (P * a * (L - x)) / L),
  };
}

/**
 * Simple beam, uniformly distributed load w (N/m) over the whole span (AWC Figure 1).
 *   Δx = wx(L³ − 2Lx² + x³) / 24EI,  Δmax = 5wL⁴ / 384EI at the centre
 *   Mx = wx(L − x) / 2,              Mmax = wL² / 8
 */
export function simpleUdl(w, L, EI) {
  return {
    v: (x) => (w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI),
    slope: (x) => (w * (L ** 3 - 6 * L * x * x + 4 * x ** 3)) / (24 * EI),
    M: (x) => (w * x * (L - x)) / 2,
  };
}

/**
 * Cantilever, concentrated load P at the free end (AWC Figure 13). AWC's x is
 * measured from the free end; here u = L − x converts from the wall.
 *   Δ = P(2L³ − 3L²u + u³) / 6EI,  Δmax = PL³ / 3EI at the free end
 *   M = −Pu (hogging),             Mmax = PL at the wall
 */
export function cantileverEnd(P, L, EI) {
  return {
    v: (x) => {
      const u = L - x;
      return (P * (2 * L ** 3 - 3 * L * L * u + u ** 3)) / (6 * EI);
    },
    slope: (x) => {
      const u = L - x;
      return (P * (L * L - u * u)) / (2 * EI);
    },
    M: (x) => -P * (L - x),
  };
}

/**
 * Cantilever, uniformly distributed load w (N/m) (AWC Figure 12), u = L − x as above.
 *   Δ = w(u⁴ − 4L³u + 3L⁴) / 24EI,  Δmax = wL⁴ / 8EI at the free end
 *   M = −wu² / 2 (hogging),          Mmax = wL² / 2 at the wall
 */
export function cantileverUdl(w, L, EI) {
  return {
    v: (x) => {
      const u = L - x;
      return (w * (u ** 4 - 4 * L ** 3 * u + 3 * L ** 4)) / (24 * EI);
    },
    slope: (x) => {
      const u = L - x;
      return (w * (L ** 3 - u ** 3)) / (6 * EI);
    },
    M: (x) => (-w * (L - x) ** 2) / 2,
  };
}

/* ---------- Closed-form maxima for single loads (maths card, tests) ---------- */

export const deltaCantileverEnd = (P, L, EI) => (P * L ** 3) / (3 * EI);
export const deltaCantileverUdl = (w, L, EI) => (w * L ** 4) / (8 * EI);
export const deltaSimpleCentre = (P, L, EI) => (P * L ** 3) / (48 * EI);
export const deltaSimpleUdl = (w, L, EI) => (5 * w * L ** 4) / (384 * EI);

/**
 * Simple beam, point load at a (AWC Figure 8):
 *   Δmax = Pab(a + 2b)√(3a(a + 2b)) / 27EIL at x = √(a(a + 2b)/3), when a > b.
 * For a < b the beam is mirrored (swap a and b, x measured from the right).
 * Returns { delta, x } with x from the left support.
 */
export function deltaSimplePoint(P, a, L, EI) {
  const mirrored = a < L / 2;
  const A = mirrored ? L - a : a;
  const B = L - A;
  const delta = (P * A * B * (A + 2 * B) * Math.sqrt(3 * A * (A + 2 * B))) / (27 * EI * L);
  const xm = Math.sqrt((A * (A + 2 * B)) / 3);
  return { delta, x: mirrored ? L - xm : xm };
}

/* =========================================================================
 * The page's five cases, with optional self-weight superposed
 * ====================================================================== */

export const CASES = {
  'cantilever-end': { support: 'cantilever', load: 'point', label: 'Cantilever, point load at the free end' },
  'cantilever-udl': { support: 'cantilever', load: 'udl', label: 'Cantilever, uniformly distributed load' },
  'simple-centre': { support: 'simple', load: 'point', label: 'Simply supported, point load at the centre' },
  'simple-udl': { support: 'simple', load: 'udl', label: 'Simply supported, uniformly distributed load' },
  'simple-point': { support: 'simple', load: 'point', label: 'Simply supported, point load at a' },
};

/** Position of the point load (m from the left support / wall), or null for a UDL. */
export function loadPosition(caseId, L, aFrac) {
  if (caseId === 'cantilever-end') return L;
  if (caseId === 'simple-centre') return L / 2;
  if (caseId === 'simple-point') return aFrac * L;
  return null;
}

/** Components (elementary solutions) for a case: the applied load and, optionally, self-weight. */
function components({ caseId, L, P, aFrac, EI, wSelf }) {
  const { support, load } = CASES[caseId];
  const list = [];
  if (support === 'cantilever') {
    list.push(load === 'point' ? cantileverEnd(P, L, EI) : cantileverUdl(P / L, L, EI));
    if (wSelf > 0) list.push(cantileverUdl(wSelf, L, EI));
  } else {
    list.push(load === 'point' ? simplePoint(P, loadPosition(caseId, L, aFrac), L, EI) : simpleUdl(P / L, L, EI));
    if (wSelf > 0) list.push(simpleUdl(wSelf, L, EI));
  }
  return list;
}

/**
 * Full analysis by superposition (valid because everything is linear elastic).
 *   caseId  key of CASES
 *   L       span (m)
 *   P       applied load (N): the point load, or the TOTAL of a UDL (w = P / L)
 *   aFrac   load position as a fraction of L (simple-point only)
 *   E, I, c modulus (Pa), second moment (m⁴), extreme-fibre distance (m)
 *   wSelf   self-weight per metre (N/m), 0 to leave it out
 * Returns the curve functions and the maxima the page shows.
 */
export function analyseBeam({ caseId, L, P, aFrac = 0.5, E, I, c, wSelf = 0 }) {
  const EI = E * I;
  const parts = components({ caseId, L, P, aFrac, EI, wSelf });
  const v = (x) => parts.reduce((s, p) => s + p.v(x), 0);
  const slope = (x) => parts.reduce((s, p) => s + p.slope(x), 0);
  const M = (x) => parts.reduce((s, p) => s + p.M(x), 0);
  const { support } = CASES[caseId];

  let xDelta;
  let xM;
  let endSlope;
  let slopeEnd; // 'free' | 'left' | 'right'
  if (support === 'cantilever') {
    xDelta = L;            // all loads point down: the free end moves most
    xM = 0;                // and the moment is largest at the wall
    endSlope = slope(L);
    slopeEnd = 'free';
  } else {
    xDelta = slopeRoot(slope, L);
    xM = simpleMaxMomentAt(caseId, L, P, aFrac, wSelf);
    const s0 = Math.abs(slope(0));
    const sL = Math.abs(slope(L));
    endSlope = Math.max(s0, sL);
    slopeEnd = sL > s0 * (1 + 1e-9) ? 'right' : 'left';
  }
  const deltaMax = v(xDelta);
  const Mmax = M(xM);
  return {
    EI, v, slope, M,
    deltaMax, xDelta,
    Mmax, xM,
    endSlope, slopeEnd,
    sigmaMax: (Math.abs(Mmax) * c) / I,
    spanRatio: deltaMax > 0 ? L / deltaMax : Infinity,
  };
}

/**
 * Where a simply supported beam's deflection peaks: the root of its slope.
 * With every load pointing down the slope falls steadily from + at the left
 * support to − at the right (dθ/dx = −M/EI < 0), so bisection always finds it.
 */
export function slopeRoot(slope, L) {
  let lo = 0;
  let hi = L;
  if (!(slope(lo) > 0) || !(slope(hi) < 0)) return L / 2; // no load: anywhere, report the centre
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (slope(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Where the bending moment of a simply supported beam peaks: where the shear
 * force changes sign. Point load P at a plus total UDL w = wLoad + wSelf.
 * Shear V = R1 − wx (x < a) and R1 − P − wx (x > a), R1 = Pb/L + wL/2.
 */
export function simpleMaxMomentAt(caseId, L, P, aFrac, wSelf) {
  const point = CASES[caseId].load === 'point';
  const a = point ? loadPosition(caseId, L, aFrac) : 0;
  const Pp = point ? P : 0;
  const w = (point ? 0 : P / L) + wSelf;
  if (w === 0) return a;                         // point load only: peak under the load
  const R1 = (Pp * (L - a)) / L + (w * L) / 2;
  if (R1 - w * a < 0) return R1 / w;             // shear crosses zero left of the load
  if (R1 - Pp - w * a > 0) return (R1 - Pp) / w; // ...or right of it
  return a;                                      // ...or jumps through zero at the load
}

/* =========================================================================
 * Small helpers for the page
 * ====================================================================== */

/** Self-weight per metre (N/m): w = ρ A g0. */
export const selfWeightPerMetre = (density, A) => density * A * G0;

/**
 * Deflection at the centre of a simply supported beam loaded at mid-span until
 * the bending stress reaches σ: from δ = PL³/48EI and σ = (PL/4)·c/I,
 * δ = σL² / (12 E c). Shows why a beam near yield may still move very little.
 */
export const deltaAtStressCentreLoad = (sigma, L, E, c) => (sigma * L * L) / (12 * E * c);

/** Drawing scale: the smallest whole N (1:N) that fits `needPx` (at 1:1) into `availPx`. */
export function fitScale(needPx, availPx) {
  if (!(availPx > 0)) return 1;
  return Math.max(1, Math.ceil(needPx / availPx - 1e-9));
}

/** Magnification for a callout that shows `px` (a tiny length at true size) about `targetPx` long: 1-2-5 steps. */
export function calloutMagnification(px, targetPx = 48) {
  if (!(px > 0)) return 0;
  const raw = targetPx / px;
  if (raw < 2) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [5, 2, 1]) if (m * p <= raw * (1 + 1e-9)) return m * p;
  return p;
}
