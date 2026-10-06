/**
 * physics.js: pure maths for the simulators.
 *
 * No DOM access in this file, so every function can be tested in isolation
 * (see /tests/physics.test.html). All quantities are SI unless a name says
 * otherwise: metres, seconds, radians.
 */

/** One full turn in radians (2π). */
export const TAU = 2 * Math.PI;

/* ---------- Screen-scale constants ---------- */

/** CSS defines 1 inch = 96 CSS px. Real screens rarely match, hence calibration. */
export const CSS_PX_PER_INCH = 96;
export const METRES_PER_INCH = 0.0254;
/** Fallback scale used until the user calibrates (~3779.5 CSS px per metre). */
export const APPROX_CSS_PX_PER_METRE = CSS_PX_PER_INCH / METRES_PER_INCH;

/** ISO/IEC 7810 ID-1 card (bank card, driving licence) dimensions. */
export const ID1_CARD_WIDTH_M = 0.0856;
export const ID1_CARD_HEIGHT_M = 0.05398;

/* ---------- Unit conversions ---------- */

/** 1 mph is exactly 0.44704 m/s (international mile / hour). */
export const MS_PER_MPH = 0.44704;

export const msToKmh = (v) => v * 3.6;
export const kmhToMs = (kmh) => kmh / 3.6;
export const msToMph = (v) => v / MS_PER_MPH;
export const mphToMs = (mph) => mph * MS_PER_MPH;

/** rad/s → revolutions per minute: rpm = ω × 60 / 2π */
export const radPerSecToRpm = (omega) => (omega * 60) / TAU;
export const rpmToRadPerSec = (rpm) => (rpm * TAU) / 60;

/** Frequency of circular motion in Hz: f = ω / 2π */
export const frequencyFromOmega = (omega) => Math.abs(omega) / TAU;

/** Period of circular motion in s: T = 2π / ω (Infinity when stationary). */
export const periodFromOmega = (omega) => (omega === 0 ? Infinity : TAU / Math.abs(omega));

/* ---------- v, ω, r coupling (invariant: v = ω·r) ---------- */

export const omegaFromSpeed = (v, r) => v / r;
export const speedFromOmega = (omega, r) => omega * r;

/** Centripetal acceleration a = v² / r (equivalently ω²·r). */
export const centripetalAcceleration = (v, r) => (v * v) / r;

/** v or r changed: keep v and r, derive ω. */
export function coupleFromSpeed({ v, r }) {
  return { v, r, omega: omegaFromSpeed(v, r) };
}

/** ω changed: keep ω and r, derive v. */
export function coupleFromOmega({ omega, r }) {
  return { v: speedFromOmega(omega, r), r, omega };
}

/**
 * The ω range that keeps v inside [vMin, vMax] at radius r.
 * This is why the ω slider's range is "derived": it moves when r changes.
 */
export function omegaRange(r, vMin, vMax) {
  return { min: vMin / r, max: vMax / r };
}

/* ---------- Generic helpers ---------- */

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Wrap x into [0, length). Works for negative x (motion to the left).
 * The final guard handles float rounding where e.g. -1e-17 + L rounds to L.
 */
export function wrap(x, length) {
  const m = x % length;
  const w = m < 0 ? m + length : m;
  return w >= length ? 0 : w;
}

/** Wrap an angle into [0, 2π). */
export const wrapAngle = (theta) => wrap(theta, TAU);

/** Round down to a multiple of step, tolerant of float noise (0.15/0.005 etc.). */
export function snapDown(x, step) {
  const n = Math.floor(x / step + 1e-9);
  return Number((n * step).toFixed(10));
}

/* ---------- Time stepping ---------- */

/** Largest frame delta we accept; stops a jump after a backgrounded tab returns. */
export const MAX_FRAME_DT = 0.1;

/** Clamp a raw frame delta (s) into [0, max]. Negative or NaN deltas become 0. */
export function clampFrameDelta(dt, max = MAX_FRAME_DT) {
  if (!(dt > 0)) return 0;
  return Math.min(dt, max);
}

/**
 * Advance a position (or phase) by rate·direction·dt.
 * Velocity is constant between frames, so this is exact: no integration error,
 * and the result depends only on total time, never on how many frames it took.
 */
export const advance = (position, rate, direction, dt) => position + rate * direction * dt;

/* ---------- Calibration maths ---------- */

/**
 * Device pixels per metre from an on-screen card that matched a real card.
 * Stored in device pixels so browser zoom (which changes devicePixelRatio)
 * is handled automatically at runtime.
 */
export function devicePxPerMetreFromCard(cardCssPx, dpr, cardLengthM = ID1_CARD_WIDTH_M) {
  return (cardCssPx * dpr) / cardLengthM;
}

/**
 * Device pixels per metre from a screen's diagonal (inches) and native
 * resolution: ppi = √(w² + h²) / diagonal. Assumes square pixels.
 */
export function devicePxPerMetreFromScreen(diagonalIn, resW, resH) {
  return Math.hypot(resW, resH) / diagonalIn / METRES_PER_INCH;
}

/** The fallback when the user doesn't know their screen: the most common desktop monitor. */
export const DEFAULT_SCREEN = { diagonalIn: 24, resW: 1920, resH: 1080 };

/** Runtime conversion back to CSS px per metre at the current devicePixelRatio. */
export const cssPxPerMetreFromDevice = (devicePxPerMetre, dpr) => devicePxPerMetre / dpr;

/* ---------- Geometry helpers ---------- */

/** Largest circle radius (m) that fits a w×h CSS px box with a margin. */
export function maxRadiusToFit(widthPx, heightPx, cssPxPerMetre, marginPx = 0) {
  const halfPx = Math.min(widthPx, heightPx) / 2 - marginPx;
  return Math.max(0, halfPx) / cssPxPerMetre;
}

/** Pick the longest "nice" scale-bar length (m) that is <= maxMetres. */
export function niceScaleBarLength(maxMetres) {
  const options = [1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
  return options.find((len) => len <= maxMetres) ?? options[options.length - 1];
}

/**
 * Ruler ticks for a track of the given length, generated from integer
 * centimetres so positions never accumulate float error.
 * kind: 'm' (every 1 m), 'half' (50 cm), 'dm' (10 cm), 'cm' (1 cm).
 */
export function rulerTicks(lengthM) {
  const ticks = [];
  const maxCm = Math.floor(lengthM * 100 + 1e-9);
  for (let cm = 0; cm <= maxCm; cm++) {
    const kind = cm % 100 === 0 ? 'm' : cm % 50 === 0 ? 'half' : cm % 10 === 0 ? 'dm' : 'cm';
    ticks.push({ cm, x: cm / 100, kind });
  }
  return ticks;
}

/** "Nice" 1-2-5 steps: the smallest 1, 2 or 5 × 10^n that is >= x. */
export function niceStep(x) {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 5, 10]) if (m * p >= x * (1 - 1e-9)) return Number((m * p).toPrecision(12));
  return 10 * p;
}

/** Largest 1, 2 or 5 × 10^n that is <= x (for scale bars). */
export function niceFloor(x) {
  if (!(x > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [5, 2, 1]) if (m * p <= x * (1 + 1e-9)) return Number((m * p).toPrecision(12));
  return p;
}

export const degToRad = (deg) => (deg * Math.PI) / 180;
export const radToDeg = (rad) => (rad * 180) / Math.PI;

/** Map a 0..1 slider fraction onto a logarithmic min..max range, and back. */
export const logFractionToValue = (f, min, max) => min * (max / min) ** f;
export const valueToLogFraction = (v, min, max) => Math.log(v / min) / Math.log(max / min);

/* =========================================================================
 * Constant acceleration (acceleration sim)
 * ====================================================================== */

/** Standard gravity, m/s² (the definition of 1 g). */
export const G0 = 9.80665;

/** x = u·t + ½·a·t² */
export const constAccelPosition = (u, a, t) => u * t + 0.5 * a * t * t;

/** v = u + a·t */
export const constAccelVelocity = (u, a, t) => u + a * t;

/** Time to stop from speed u at deceleration magnitude a: t = u / a */
export const stoppingTime = (u, a) => u / a;

/** Distance to stop from speed u at deceleration magnitude a: d = u² / 2a */
export const stoppingDistance = (u, a) => (u * u) / (2 * a);

/** v² = u² + 2·a·d  (a signed; 0 if the object stops before covering d) */
export const speedAfterDistance = (u, a, d) => Math.sqrt(Math.max(0, u * u + 2 * a * d));

/**
 * First time at which distance d is covered, from ½·a·t² + u·t − d = 0.
 * a is signed (negative = braking). Infinity if the object stops first.
 */
export function timeToCoverDistance(u, a, d) {
  if (d <= 0) return 0;
  if (Math.abs(a) < 1e-12) return u > 0 ? d / u : Infinity;
  const disc = u * u + 2 * a * d;
  if (disc < 0) return Infinity; // braking: stops before reaching d
  return (-u + Math.sqrt(disc)) / a;
}

/**
 * Position and speed after time t from speed u with signed acceleration a.
 * When braking, motion stops (and stays stopped) at v = 0.
 */
export function constAccelState(u, a, t) {
  if (a < 0) {
    const tStop = stoppingTime(u, -a);
    if (t >= tStop) return { x: stoppingDistance(u, -a), v: 0, stopped: true };
  }
  return { x: constAccelPosition(u, a, t), v: constAccelVelocity(u, a, t), stopped: false };
}

/** Free fall from rest through height h: t = √(2h/g), v = √(2gh) */
export const freeFallTime = (h, g) => Math.sqrt((2 * h) / g);
export const freeFallSpeed = (h, g) => Math.sqrt(2 * g * h);

/* =========================================================================
 * Pendulum
 * ====================================================================== */

/** Arithmetic-geometric mean (converges in a handful of iterations). */
export function agm(a, b) {
  for (let i = 0; i < 30 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return (a + b) / 2;
}

/** Small-angle period T₀ = 2π √(L/g) */
export const pendulumSmallAnglePeriod = (L, g) => TAU * Math.sqrt(L / g);

/**
 * Exact period for release angle θ₀ (rad), undamped:
 * T = T₀ / AGM(1, cos(θ₀/2)), equivalent to the elliptic-integral formula.
 */
export const pendulumPeriod = (L, g, theta0) =>
  pendulumSmallAnglePeriod(L, g) / agm(1, Math.cos(theta0 / 2));

/** Length that gives period T (small angles): L = g (T / 2π)² */
export const pendulumLengthForPeriod = (T, g) => g * (T / TAU) ** 2;

/** Bob speed at the bottom of the swing: v = √(2gL(1 − cos θ₀)) */
export const pendulumMaxSpeed = (L, g, theta0) => Math.sqrt(2 * g * L * (1 - Math.cos(theta0)));

/**
 * One RK4 step of θ" = −(g/L)·sin θ − γ·θ'  (γ = b/m, linear air damping).
 * Fixed small steps keep this accurate and frame-rate independent.
 */
export function pendulumStep(theta, omega, dt, L, g, gamma) {
  const acc = (th, om) => -(g / L) * Math.sin(th) - gamma * om;
  const k1t = omega;
  const k1o = acc(theta, omega);
  const k2t = omega + 0.5 * dt * k1o;
  const k2o = acc(theta + 0.5 * dt * k1t, k2t);
  const k3t = omega + 0.5 * dt * k2o;
  const k3o = acc(theta + 0.5 * dt * k2t, k3t);
  const k4t = omega + dt * k3o;
  const k4o = acc(theta + dt * k3t, k4t);
  return {
    theta: theta + (dt / 6) * (k1t + 2 * k2t + 2 * k3t + k4t),
    omega: omega + (dt / 6) * (k1o + 2 * k2o + 2 * k3o + k4o),
  };
}

/** Radius of a solid steel ball of the given mass (ρ = 7850 kg/m³). */
export const STEEL_DENSITY = 7850;
export const steelBallRadius = (massKg) => Math.cbrt((3 * massKg) / (4 * Math.PI * STEEL_DENSITY));

/* =========================================================================
 * Vibration / frequency
 * ====================================================================== */

/** Simple harmonic motion x = A sin(2πft): peak velocity and acceleration. */
export const shmPeakVelocity = (f, A) => TAU * f * A;
export const shmPeakAcceleration = (f, A) => (TAU * f) ** 2 * A;

/** RMS of a sinusoid from its peak value. */
export const sineRms = (peak) => peak / Math.SQRT2;

/**
 * Is a square wave with on-fraction `duty` (0..1) on at phase φ? It is on for
 * the first duty·2π of every cycle; duty 0.5 is on exactly while sin φ >= 0.
 */
export const squareWaveIsOn = (phi, duty = 0.5) => wrap(phi, TAU) < duty * TAU;

/**
 * Fraction of the phase interval [φ0, φ1] during which that square wave is on.
 * Used to show a flicker honestly: when the flicker is faster than the screen,
 * a frame shows its average brightness.
 */
export function squareWaveOnFraction(phi0, phi1, duty = 0.5) {
  if (phi1 === phi0) return squareWaveIsOn(phi0, duty) ? 1 : 0;
  if (phi1 < phi0) [phi0, phi1] = [phi1, phi0];
  const onPerCycle = duty * TAU;
  const onUpTo = (phi) => Math.floor(phi / TAU) * onPerCycle + Math.min(wrap(phi, TAU), onPerCycle);
  return (onUpTo(phi1) - onUpTo(phi0)) / (phi1 - phi0);
}

/* =========================================================================
 * Projectile motion (no air resistance)
 * ====================================================================== */

/** Position and velocity at time t for launch speed v, angle θ (rad), height h0. */
export function projectileState(v, theta, h0, g, t) {
  const vx = v * Math.cos(theta);
  const vy0 = v * Math.sin(theta);
  return { x: vx * t, y: h0 + vy0 * t - 0.5 * g * t * t, vx, vy: vy0 - g * t };
}

/** Time until the ball returns to ground level (y = 0). */
export function projectileFlightTime(v, theta, h0, g) {
  const vy = v * Math.sin(theta);
  return (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
}

export const projectileRange = (v, theta, h0, g) => v * Math.cos(theta) * projectileFlightTime(v, theta, h0, g);
export const projectileApexTime = (v, theta, g) => Math.max(0, (v * Math.sin(theta)) / g);
export const projectileMaxHeight = (v, theta, h0, g) => h0 + Math.max(0, v * Math.sin(theta)) ** 2 / (2 * g);

/* =========================================================================
 * Conveyor: fixed rate, variable belt speed
 * ====================================================================== */


/** Time between products (s) at a fixed rate: T = 60 / rate. */
export const productInterval = (ppm) => 60 / ppm;

/** Pitch (m) when products arrive at a fixed rate on a belt at speed v: p = v·T. */
export const pitchForRate = (v, ppm) => v * productInterval(ppm);

/** Slowest belt speed for a rate without products overlapping (touching): v = l / T. */
export const minBeltSpeed = (ppm, length) => length / productInterval(ppm);

/** How long each product covers a fixed point (s): l / v. */
export const occupiedTime = (length, v) => length / v;

/** How long a fixed point is empty between products (s): gap / v = T − l/v. */
export const freeTime = (pitch, length, v) => Math.max(0, pitch - length) / v;

/**
 * Is a fixed point at position R covered by a product? Products have trailing
 * edges at s + n·pitch (belt travel s, moving towards +x) and length l.
 */
export const pointOccupied = (R, s, pitch, length) => wrap(R - s, pitch) <= length;
