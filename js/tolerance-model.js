/**
 * tolerance-model.js: ISO 286 hole-basis limits and fits (pure maths, no DOM).
 *
 * Units follow the standard's tables: nominal sizes D in millimetres, deviations,
 * tolerances and clearances in micrometres. Helpers at the end convert to metres
 * and screen pixels for drawing. Unit tested in /tests/tolerance.test.html.
 *
 *   hole (H, hole basis):  EI = 0,  ES = EI + IT(hole grade)
 *   shaft, letters c...h:  es = fundamental deviation (≤ 0),  ei = es − IT
 *   shaft, letters k...u:  ei = fundamental deviation (≥ 0),  es = ei + IT
 *   shaft, js:             es = +IT/2, ei = −IT/2
 *   max clearance = ES − ei,  min clearance = EI − es   (negative = interference)
 *
 * Size ranges are "over A up to and including B", so 30 mm belongs to 18-30, not 30-50.
 */

import {
  IT_RANGE_UPPER,
  IT_TABLE,
  IT_FACTORS,
  IT_FIRST_LOWER_FOR_MEAN,
  DEV_RANGE_UPPER,
  SHAFT_FUNDAMENTAL,
  SHAFT_LETTERS,
  JS_ROUNDING_1988,
  PREFERRED_FITS,
  ISO_PREFERRED_EXTRA,
} from './data/tolerance-data.js';

export { SHAFT_LETTERS, PREFERRED_FITS, ISO_PREFERRED_EXTRA };

/** Nominal sizes this tool covers (mm). */
export const SIZE_MIN = 1;
export const SIZE_MAX = 500;
/** Tolerance grades offered for hole and shaft. */
export const GRADES = [5, 6, 7, 8, 9, 10, 11];

/* ---------- Size ranges ---------- */

/** Index of the range "over A up to and including B" containing D, or −1 outside 0 < D ≤ 500. */
export function rangeIndex(D, uppers) {
  if (!(D > 0)) return -1;
  for (let i = 0; i < uppers.length; i++) if (D <= uppers[i] + 1e-9) return i;
  return -1;
}

/** The IT size range containing D: { index, lo, hi } in mm (lo = 0 for the first range). */
export function itRange(D) {
  const index = rangeIndex(D, IT_RANGE_UPPER);
  if (index < 0) return null;
  return { index, lo: index ? IT_RANGE_UPPER[index - 1] : 0, hi: IT_RANGE_UPPER[index] };
}

/** The deviation sub-range (25 rows) containing D. */
export function devRange(D) {
  const index = rangeIndex(D, DEV_RANGE_UPPER);
  if (index < 0) return null;
  return { index, lo: index ? DEV_RANGE_UPPER[index - 1] : 0, hi: DEV_RANGE_UPPER[index] };
}

/* ---------- Standard tolerance grades ---------- */

/** Geometric mean D of an IT size step (mm); the first step is taken as 1 to 3 mm. */
export function geometricMeanD(index) {
  const lo = index ? IT_RANGE_UPPER[index - 1] : IT_FIRST_LOWER_FOR_MEAN;
  return Math.sqrt(lo * IT_RANGE_UPPER[index]);
}

/** Standard tolerance factor i = 0.45 ∛D + 0.001 D (µm, D in mm). */
export const toleranceFactor = (D) => 0.45 * Math.cbrt(D) + 0.001 * D;

/** IT value from the formula (unrounded, µm) for a grade and IT range index. */
export function itFormula(grade, index) {
  return IT_FACTORS[grade] * toleranceFactor(geometricMeanD(index));
}

/** Tabulated IT value (µm) for a grade at nominal size D (mm). */
export function itValue(grade, D) {
  const r = itRange(D);
  if (!r || !IT_TABLE[grade]) return NaN;
  return IT_TABLE[grade][r.index];
}

/* ---------- Deviations ---------- */

/** Hole H: EI = 0, ES = +IT. */
export function holeDeviations(grade, D) {
  const it = itValue(grade, D);
  return { EI: 0, ES: it, it };
}

/**
 * The size range a letter's fundamental deviation applies to at D: the standard
 * merges sub-ranges with the same value inside an IT range, and splits others
 * (e.g. u over 18 up to 24 and over 24 up to 30).
 */
export function letterRange(letter, D) {
  const r = devRange(D);
  const it = itRange(D);
  if (!r || !it) return null;
  if (letter === 'js') return { lo: it.lo, hi: it.hi };
  const vals = SHAFT_FUNDAMENTAL[letter].values;
  let a = r.index;
  let b = r.index;
  const inIt = (i) => DEV_RANGE_UPPER[i] > it.lo && DEV_RANGE_UPPER[i] <= it.hi;
  while (a > 0 && inIt(a - 1) && vals[a - 1] === vals[r.index]) a--;
  while (b < vals.length - 1 && inIt(b + 1) && vals[b + 1] === vals[r.index]) b++;
  return { lo: a ? DEV_RANGE_UPPER[a - 1] : 0, hi: DEV_RANGE_UPPER[b] };
}

/** js half-width (µm): IT/2, or with the ISO 286-1:1988 rule (grades 7-11, odd IT → even value below). */
export function jsHalfWidth(it, grade, round1988 = false) {
  const odd = Number.isInteger(it) && it % 2 === 1;
  if (round1988 && odd && grade >= JS_ROUNDING_1988.minGrade && grade <= JS_ROUNDING_1988.maxGrade) return (it - 1) / 2;
  return it / 2;
}

/**
 * Shaft limit deviations for letter + grade at D (µm).
 * Returns { es, ei, it, kind: 'es' | 'ei' | 'js', fd (the tabulated fundamental deviation),
 * defined (false where the standard has no value, e.g. t up to 24 mm), range }.
 */
export function shaftDeviations(letter, grade, D, { roundJs1988 = false } = {}) {
  const it = itValue(grade, D);
  const r = devRange(D);
  if (!r || !Number.isFinite(it)) return { defined: false, it };
  if (letter === 'js') {
    const half = jsHalfWidth(it, grade, roundJs1988);
    return { es: half, ei: -half, it, kind: 'js', fd: null, defined: true, range: letterRange('js', D),
      half1988: jsHalfWidth(it, grade, true) };
  }
  const entry = SHAFT_FUNDAMENTAL[letter];
  if (!entry) return { defined: false, it };
  let fd = entry.values[r.index];
  if (fd === null || fd === undefined) return { defined: false, it, kind: entry.kind, range: letterRange(letter, D) };
  if (letter === 'k' && (grade < entry.gradesMin || grade > entry.gradesMax)) fd = entry.otherGrades;
  const range = letterRange(letter, D);
  if (entry.kind === 'es') return { es: fd, ei: fd - it, it, kind: 'es', fd, defined: true, range };
  return { es: fd + it, ei: fd, it, kind: 'ei', fd, defined: true, range };
}

/* ---------- Fits ---------- */

/** 'clearance' (always a gap), 'interference' (always overlap) or 'transition'. */
export function fitType(maxClearance, minClearance) {
  if (minClearance >= 0) return 'clearance';
  if (maxClearance <= 0) return 'interference';
  return 'transition';
}

/** Limit size (mm) from a nominal size (mm) and a deviation (µm), without float noise. */
export const limitSize = (D, devUm) => Math.round((D + devUm / 1000) * 1e6) / 1e6;

/**
 * Everything about a hole-basis fit "D H{holeGrade}/{letter}{shaftGrade}".
 * Deviations, clearances and tolerances in µm; limit sizes in mm.
 */
export function computeFit({ D, holeGrade, letter, shaftGrade, roundJs1988 = false }) {
  const hole = holeDeviations(holeGrade, D);
  const shaft = shaftDeviations(letter, shaftGrade, D, { roundJs1988 });
  const out = {
    D, holeGrade, letter, shaftGrade,
    label: `H${holeGrade}/${letter}${shaftGrade}`,
    hole: { ...hole, grade: holeGrade, min: limitSize(D, hole.EI), max: limitSize(D, hole.ES) },
    shaft: { ...shaft, grade: shaftGrade },
    defined: Boolean(shaft.defined && Number.isFinite(hole.it)),
  };
  if (!out.defined) return out;
  out.shaft.min = limitSize(D, shaft.ei);
  out.shaft.max = limitSize(D, shaft.es);
  out.maxClearance = hole.ES - shaft.ei;
  out.minClearance = hole.EI - shaft.es;
  out.type = fitType(out.maxClearance, out.minClearance);
  return out;
}

/** The preferred fit with these parts, if any (searches both lists). */
export function findPreferred(holeGrade, letter, shaftGrade) {
  return [...PREFERRED_FITS, ...ISO_PREFERRED_EXTRA].find((f) => f.hole === holeGrade && f.letter === letter && f.shaft === shaftGrade) ?? null;
}

/* ---------- Screen helpers ---------- */

/** Physical size of one device pixel (m) from CSS px per metre and devicePixelRatio. */
export const pixelPitchM = (cssPxPerMetre, dpr = 1) => 1 / (cssPxPerMetre * dpr);

/** A length in µm as a fraction of one device pixel. */
export const micrometresInPixels = (um, cssPxPerMetre, dpr = 1) => (um * 1e-6) / pixelPitchM(cssPxPerMetre, dpr);

/** Magnifications offered (and used by Auto). */
export const MAGNIFICATIONS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

/**
 * Largest offered magnification at which spanUm (µm) fits in availPx CSS px,
 * given cssPxPerMetre. Falls back to the smallest offered.
 */
export function autoMagnification(spanUm, availPx, cssPxPerMetre) {
  let best = MAGNIFICATIONS[0];
  for (const m of MAGNIFICATIONS) if (spanUm * 1e-6 * m * cssPxPerMetre <= availPx) best = m;
  return best;
}

/**
 * Plain words for a ratio r = a / b: "about half of", "about a third of", "about the
 * same as", "about 2.5 times", "about 1/12 of". Used in sentences like "... a human hair".
 */
export function ratioWords(r) {
  if (!(r > 0) || !Number.isFinite(r)) return '';
  if (r >= 0.9 && r <= 1.1) return 'about the same as';
  if (r > 1.1) {
    const v = r < 10 ? Math.round(r * 10) / 10 : Math.round(r);
    return `about ${v} times`;
  }
  const words = { 2: 'half', 3: 'a third', 4: 'a quarter', 5: 'a fifth', 6: 'a sixth', 7: 'a seventh', 8: 'an eighth', 9: 'a ninth', 10: 'a tenth' };
  const n = Math.round(1 / r);
  if (n <= 10 && Math.abs(r * n - 1) <= 0.15) return `about ${words[n]} of`;
  if (r >= 0.15) return `about ${Math.round(r * 100)}% of`;
  return `about 1/${n} of`;
}
