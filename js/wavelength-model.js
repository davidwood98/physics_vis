/**
 * wavelength-model.js: pure maths for the wavelength ruler (wavelength.html).
 *
 * No DOM access, so everything here is unit tested (/tests/wavelength.test.html).
 * SI units throughout (metres, seconds, hertz, m/s); temperatures in °C where
 * the cited formulas use °C. Reference values live in js/data/wavelength-data.js.
 *
 * Contents
 *   1. λ = v / f and friends
 *   2. Wave speeds: sound in air (Cramer 1993, as NPL codes it), sound in pure
 *      water (Marczak 1997), light (exact)
 *   3. Screen pixels
 *   4. Holes as waveguides: TE₁₁ cut-off and the fade below cut-off
 *   5. Standing waves between two walls
 *   6. Words: what kind of wave, and a familiar object of similar size
 *   7. Formatting with automatic units
 */

import { sigT } from './astro.js';
import {
  C_LIGHT,
  AIR_CRAMER,
  WATER_MARCZAK,
  STANDARD_PRESSURE_KPA,
  BANDS,
  VISIBLE_RANGE,
  HEARING_RANGE,
  COMPARISONS,
} from './data/wavelength-data.js';

export { C_LIGHT };

/* =========================================================================
 * 1. λ = v / f
 * ====================================================================== */

/** Wavelength (m) of a wave of frequency f (Hz) travelling at v (m/s). */
export const wavelength = (v, f) => v / f;
/** Frequency (Hz) of a wave of wavelength λ (m) travelling at v (m/s). */
export const frequency = (v, lambda) => v / lambda;
/** Period (s): T = 1 / f. */
export const period = (f) => 1 / f;

/* =========================================================================
 * 2. Wave speeds
 * ====================================================================== */

/**
 * Zero-frequency speed of sound in humid air (m/s), Cramer (1993), written
 * exactly as NPL's calculator codes it (CO₂ mole fraction 0.0004).
 *   tC: air temperature, °C (valid 0 to 30 °C)
 *   rhPercent: relative humidity, % (0 = dry air)
 *   pKPa: pressure, kPa (valid 75 to 102 kPa; default the standard atmosphere)
 */
export function soundSpeedAir(tC, rhPercent = 0, pKPa = STANDARD_PRESSURE_KPA, k = AIR_CRAMER) {
  const T = tC;
  const P = pKPa * 1000;
  const Tk = T + 273.15;
  const T2 = T * T;
  // Mole fraction of water vapour from relative humidity (enhancement factor × saturation pressure).
  const enh = k.enh[0] + k.enh[1] * P + k.enh[2] * T2;
  const psv = Math.exp(k.psv[0] * Tk * Tk + k.psv[1] * Tk) * Math.exp(k.psv[2] + k.psv[3] / Tk);
  const xw = (rhPercent * enh * psv) / P / 100;
  const xc = k.co2;
  const c1 = k.c1[0] + k.c1[1] * T + k.c1[2] * T2 + (k.c1w[0] + k.c1w[1] * T + k.c1w[2] * T2) * xw;
  const c2 = (k.c2p[0] + k.c2p[1] * T + k.c2p[2] * T2) * P + (k.c2c[0] + k.c2c[1] * T + k.c2c[2] * T2) * xc;
  const c3 = k.c3.ww * xw * xw + k.c3.pp * P * P + k.c3.cc * xc * xc + k.c3.wpc * xw * P * xc;
  return c1 + c2 - c3;
}

/** Speed of sound in pure water at atmospheric pressure (m/s), Marczak (1997); tC in °C (valid 0 to 95 °C). */
export function soundSpeedWater(tC, k = WATER_MARCZAK) {
  let sum = 0;
  for (let i = k.coeffs.length - 1; i >= 0; i--) sum = sum * tC + k.coeffs[i]; // Horner
  return sum;
}

/** Valid temperature range (°C) of the speed formula for a medium. */
export const temperatureRange = (medium) => (medium === 'water' ? WATER_MARCZAK.tRangeC : AIR_CRAMER.tRangeC);

/**
 * Wave speed (m/s) for medium 'air' | 'water' | 'em'. Light uses c in vacuum:
 * air slows it by under 0.03 % (refractive index 1.00027), far below anything drawable.
 */
export function waveSpeed(medium, tC = 20, rhPercent = 0) {
  if (medium === 'em') return C_LIGHT;
  if (medium === 'water') return soundSpeedWater(tC);
  return soundSpeedAir(tC, rhPercent);
}

/* =========================================================================
 * 3. Screen pixels
 * ====================================================================== */

/** Pixel pitch (m) of a screen from its diagonal (inches) and resolution, square pixels. */
export const screenPixelPitch = (diagonalIn, resW, resH) => (0.0254 * diagonalIn) / Math.hypot(resW, resH);

/** How many wavelengths fit across one pixel (pitch in m). */
export const wavelengthsPerPixel = (pitch, lambda) => pitch / lambda;

/* =========================================================================
 * 4. A round hole as a waveguide
 * ====================================================================== */

const factorial = (n) => {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
};

/** Bessel function of the first kind Jₙ(x), integer n ≥ 0, by its power series (fine for |x| < ~10). */
export function besselJ(n, x) {
  let sum = 0;
  for (let m = 0; m < 30; m++) {
    const term = ((m % 2 ? -1 : 1) / (factorial(m) * factorial(m + n))) * (x / 2) ** (2 * m + n);
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  return sum;
}

/** Derivative Jₙ′(x) = (Jₙ₋₁ − Jₙ₊₁) / 2, with J₀′ = −J₁. */
export const besselJPrime = (n, x) => (n === 0 ? -besselJ(1, x) : (besselJ(n - 1, x) - besselJ(n + 1, x)) / 2);

/** First zero of J₁′ (p′₁₁ ≈ 1.8412), by bisection between 1.5 and 2.2. */
export function firstZeroJ1Prime() {
  let a = 1.5;
  let b = 2.2;
  const fa = besselJPrime(1, a);
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (fa * besselJPrime(1, m) <= 0) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** p′₁₁: the TE₁₁ mode's root (a mathematical constant). */
export const P11 = firstZeroJ1Prime();

/** λc / d for the TE₁₁ mode: λc = 2πa / p′₁₁ = π d / p′₁₁ ≈ 1.706 d. */
export const TE11_CUTOFF_FACTOR = Math.PI / P11;

/** Longest wavelength (m) that can travel through a round metal hole of diameter d (m): TE₁₁ cut-off. */
export const te11Cutoff = (d) => TE11_CUTOFF_FACTOR * d;

/** Hole diameter (m) whose TE₁₁ cut-off equals λ: holes wider than this let λ through. */
export const holeForCutoff = (lambda) => lambda / TE11_CUTOFF_FACTOR;

/**
 * Field decay rate α (nepers per metre) of a wave of wavelength λ inside a guide
 * with cut-off λc. Below cut-off (λ > λc) kz = √(k² − kc²) is imaginary, so the
 * field falls as e^(−αz) with α = (2π/λc)·√(1 − (λc/λ)²). At or above cut-off: 0.
 */
export function belowCutoffAttenuation(lambda, lambdaC) {
  if (!(lambda > lambdaC)) return 0;
  return ((2 * Math.PI) / lambdaC) * Math.sqrt(1 - (lambdaC / lambda) ** 2);
}

/** dB per neper (20 log₁₀ e ≈ 8.686): the field's (and the power's) loss in dB is 8.686 α z. */
export const DB_PER_NEPER = 20 / Math.LN10;

/** Power loss (dB) over depth z (m) at decay rate α (Np/m). */
export const lossDb = (alpha, z) => DB_PER_NEPER * alpha * z;

/** Fraction of the power left after depth z: e^(−2αz). */
export const powerFraction = (alpha, z) => Math.exp(-2 * alpha * z);

/* =========================================================================
 * 5. Standing waves between two walls
 * ====================================================================== */

/** Mode n frequency (Hz) between two walls L apart: fₙ = n v / (2L). */
export const modeFrequency = (n, v, L) => (n * v) / (2 * L);

/** Mode n wavelength (m): λₙ = 2L / n (n half-wavelengths fit in L). */
export const modeWavelength = (n, L) => (2 * L) / n;

/** The mode number whose frequency is closest to f (at least 1). */
export const nearestMode = (f, v, L) => Math.max(1, Math.round((2 * L * f) / v));

/**
 * Mode shape at position x in [0, L]. Sound between hard walls: pressure is
 * largest at the walls, cos(nπx/L). The electric field along one axis of a metal
 * cavity is zero at the walls, sin(nπx/L).
 */
export const modeShape = (kind, n, x, L) => (kind === 'pressure' ? Math.cos : Math.sin)((n * Math.PI * x) / L);

/** Node positions (m from the left wall) of mode n, for 'pressure' or 'field'. */
export function nodePositions(kind, n, L) {
  const out = [];
  if (kind === 'pressure') for (let i = 0; i < n; i++) out.push(((i + 0.5) * L) / n);
  else for (let i = 0; i <= n; i++) out.push((i * L) / n);
  return out;
}

/* =========================================================================
 * 6. Words
 * ====================================================================== */

/** Named bands (from the data file) that contain f. */
export const bandsAt = (f) => BANDS.filter((b) => (b.parts ? b.parts.some(([lo, hi]) => f >= lo && f <= hi) : f >= b.lo && f <= b.hi));

/** Short description of the wave: "audible sound", "visible light", "2.4 GHz Wi-Fi band"… */
export function describeWave(medium, f, lambda) {
  if (medium !== 'em') {
    if (f < HEARING_RANGE.minHz) return 'infrasound: below human hearing';
    if (f <= HEARING_RANGE.maxHz) return 'audible sound';
    return 'ultrasound: above human hearing';
  }
  if (lambda >= VISIBLE_RANGE.minM && lambda <= VISIBLE_RANGE.maxM) return 'visible light';
  const bands = bandsAt(f);
  if (bands.length) return `in the ${bands.map((b) => b.name).join(' and the ')}`;
  return lambda < VISIBLE_RANGE.minM ? 'invisible: shorter than violet light' : 'invisible: longer than red light';
}

/** The familiar object closest in size (by ratio) to a length, and the ratio length / size. */
export function closestComparison(m, refs = COMPARISONS) {
  let best = null;
  for (const r of refs) {
    if (!best || Math.abs(Math.log(m / r.sizeM)) < Math.abs(Math.log(m / best.sizeM))) best = r;
  }
  return { ref: best, ratio: m / best.sizeM };
}

/**
 * "about 9.1 × the width of a bank card (8.56 cm)", "about 0.72 × the length of a
 * tennis court (23.77 m)", "about 1/13 of the width of a red blood cell (7.13 µm)".
 */
export function comparisonText(m, refs = COMPARISONS) {
  const { ref, ratio } = closestComparison(m, refs);
  const size = ` (${formatLength(ref.sizeM, 4)})`;
  if (ratio >= 0.95 && ratio <= 1.05) return `about ${ref.what}${size}`;
  if (ratio >= 0.5) return `about ${sigT(ratio, 2)} × ${ref.what}${size}`;
  return `about 1/${sigT(1 / ratio, 2)} of ${ref.what}${size}`;
}

/* =========================================================================
 * 7. Formatting
 * ====================================================================== */

export const LENGTH_UNITS = [
  { unit: 'nm', size: 1e-9 },
  { unit: 'µm', size: 1e-6 },
  { unit: 'mm', size: 1e-3 },
  { unit: 'cm', size: 1e-2 },
  { unit: 'm', size: 1 },
  { unit: 'km', size: 1e3 },
];

export const FREQUENCY_UNITS = [
  { unit: 'Hz', size: 1 },
  { unit: 'kHz', size: 1e3 },
  { unit: 'MHz', size: 1e6 },
  { unit: 'GHz', size: 1e9 },
  { unit: 'THz', size: 1e12 },
  { unit: 'PHz', size: 1e15 },
];

const TIME_UNITS = [
  { unit: 'fs', size: 1e-15 },
  { unit: 'ps', size: 1e-12 },
  { unit: 'ns', size: 1e-9 },
  { unit: 'µs', size: 1e-6 },
  { unit: 'ms', size: 1e-3 },
  { unit: 's', size: 1 },
];

/** The largest unit in which |x| is at least 1 (the smallest unit for tiny values). */
export function pickUnit(x, units) {
  let pick = units[0];
  for (const u of units) if (Math.abs(x) >= u.size * (1 - 1e-12)) pick = u;
  return pick;
}

/** Value with auto units at n significant figures, trailing zeros dropped: "78 cm", "532 nm", "17.2 m". */
function withUnit(x, units, n) {
  if (!Number.isFinite(x)) return '∞';
  if (x === 0) return `0 ${units[0].unit}`;
  let u = pickUnit(x, units);
  // Rounding can carry into the next unit (999.96 mm → 1,000 mm): move up if so.
  const i = units.indexOf(u);
  if (i < units.length - 1 && Math.abs(Number((x / u.size).toPrecision(n))) >= units[i + 1].size / u.size) u = units[i + 1];
  return `${sigT(x / u.size, n)} ${u.unit}`;
}

/** Length with auto units (nm to km), 3 significant figures. Beyond 1,000 km stays in km with separators. */
export const formatLength = (m, n = 3) => withUnit(m, LENGTH_UNITS, n);
/** Frequency with auto units (Hz to PHz), 4 significant figures: "440 Hz", "2.442 GHz". */
export const formatFrequency = (f, n = 4) => withUnit(f, FREQUENCY_UNITS, n);
/** Period with auto units (fs to s), 3 significant figures. */
export const formatPeriod = (s, n = 3) => withUnit(s, TIME_UNITS, n);

/** A number for an input box: up to `digits` significant figures, no float noise, no grouping. */
export const inputNumber = (x, digits = 6) => String(Number(x.toPrecision(digits)));
