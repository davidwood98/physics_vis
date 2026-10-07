/**
 * motion-profile-model.js: rest-to-rest point-to-point motion profiles
 * (pure maths, SI units, no DOM; tested in /tests/motion-profile.test.html).
 *
 * Two profiles move a load a distance d from rest to rest:
 *
 *  - Trapezoidal ("linear trajectory with parabolic blends"): constant
 *    acceleration a_max, cruise at v_max, constant deceleration. Jerk is
 *    infinite at the corners. When d < v_max² / a_max there is no room to
 *    reach v_max and the velocity graph becomes a triangle.
 *    Biagiotti & Melchiorri (2008), section 3.2 (3.2.2, preassigned
 *    acceleration and velocity).
 *
 *  - Double S (seven-segment S-curve): jerk-limited, with phases
 *    +j, 0, −j (accelerate), cruise, −j, 0, +j (decelerate). With null initial
 *    and final velocities (Biagiotti & Melchiorri 2008, section 3.4.3) the
 *    durations are closed form, including the degenerate cases where a_max,
 *    v_max or both are not reached:
 *      Tj  jerk phase, Ta acceleration phase (= deceleration phase Td),
 *      Tv  constant-velocity phase, total T = 2·Ta + Tv.
 *    The section numbers were checked against the book's table of contents
 *    (Springer front matter, https://link.springer.com/content/pdf/bfm:978-3-540-85629-0/1,
 *    retrieved 2026-10-07: "3.4 Trajectory with Double S Velocity Profile ...
 *    3.4.3 Double S with null initial and final velocities").
 *
 * Every profile is stored as a list of constant-jerk segments and evaluated
 * with the segment equations quoted in PMD's application note (Lewin,
 * "Mathematics of Motion Control Profiles", Performance Motion Devices,
 * https://www.pmdcorp.com/resources/type/articles/get/mathematics-of-motion-control-profiles-article,
 * retrieved 2026-10-07):
 *   "P_T = P_0 + V_0·T + ½·A_0·T² + ⅙·J·T³,  V_T = V_0 + A_0·T + ½·J·T²,  A_T = A_0 + J·T"
 * and, for the trapezoid, "P_decel = V² / 2A".
 */

/* =========================================================================
 * Segments
 * ====================================================================== */

/**
 * Build a profile from phases [{ T, j, a }]: each phase lasts T seconds at
 * constant jerk j. If a phase gives `a`, the acceleration jumps to it at the
 * phase start (the trapezoid's infinite-jerk corners); otherwise acceleration
 * carries on continuously. Zero-length phases are dropped.
 */
function buildSegments(phases) {
  const segments = [];
  let t = 0;
  let p = 0;
  let v = 0;
  let a = 0;
  for (const ph of phases) {
    if (!(ph.T > 0)) continue;
    if (ph.a !== undefined) a = ph.a;
    const seg = { t0: t, T: ph.T, p0: p, v0: v, a0: a, j: ph.j };
    segments.push(seg);
    const s = segmentState(seg, ph.T);
    t += ph.T;
    ({ p, v, a } = s);
  }
  return { segments, T: t };
}

/** State τ seconds into a constant-jerk segment (PMD's continuous-form equations). */
function segmentState(seg, tau) {
  const { p0, v0, a0, j } = seg;
  return {
    p: p0 + v0 * tau + 0.5 * a0 * tau * tau + (j * tau * tau * tau) / 6,
    v: v0 + a0 * tau + 0.5 * j * tau * tau,
    a: a0 + j * tau,
    j,
  };
}

/**
 * Position, velocity, acceleration and jerk of a profile at time t (s).
 * Before the start the load is at rest at 0; after the end it rests at d.
 * The last instant is snapped exactly to (d, 0, 0, 0).
 */
export function evalProfile(profile, t) {
  if (!(t > 0)) return { p: 0, v: 0, a: 0, j: 0 };
  if (t >= profile.T) return { p: profile.d, v: 0, a: 0, j: 0 };
  const segs = profile.segments;
  let i = segs.length - 1;
  while (i > 0 && segs[i].t0 > t) i--;
  return segmentState(segs[i], t - segs[i].t0);
}

/* =========================================================================
 * Trapezoidal profile (accel-limited, infinite jerk)
 * ====================================================================== */

/** Distance at which a trapezoid just reaches v_max: d = v² / a (accelerate v²/2a, brake v²/2a). */
export const breakEvenTrapezoid = (vMax, aMax) => (vMax * vMax) / aMax;

/**
 * Trapezoidal rest-to-rest profile over distance d (m) with limits vMax (m/s)
 * and aMax (m/s²).
 *   v_max reached (d ≥ v²/a): Ta = v/a,       Tv = d/v − v/a, T = d/v + v/a
 *   triangular    (d < v²/a): Ta = √(d/a),    Tv = 0,         T = 2√(d/a), v_peak = √(a·d)
 */
export function trapezoid(d, vMax, aMax) {
  const reached = d >= breakEvenTrapezoid(vMax, aMax);
  const Ta = reached ? vMax / aMax : Math.sqrt(d / aMax);
  const Tv = reached ? d / vMax - vMax / aMax : 0;
  const vPeak = reached ? vMax : Math.sqrt(aMax * d);
  const { segments, T } = buildSegments([
    { T: Ta, j: 0, a: aMax },
    { T: Tv, j: 0, a: 0 },
    { T: Ta, j: 0, a: -aMax },
  ]);
  return {
    kind: 'trapezoid', d, vMax, aMax, jMax: Infinity,
    Tj: 0, Ta, Tv, T, vPeak, aPeak: aMax,
    vReached: reached, aReached: true,
    segments,
  };
}

/* =========================================================================
 * Double S (7-segment S-curve) profile, null initial and final velocities
 * ====================================================================== */

/**
 * Shortest acceleration phase from rest to speed V with limits aMax, jMax:
 *   V·j ≥ a²: a_max is reached: Tj = a/j, Ta = Tj + V/a
 *   V·j < a²: it is not:        Tj = √(V/j), Ta = 2·Tj
 */
function accelPhase(V, aMax, jMax) {
  if (V * jMax >= aMax * aMax) {
    const Tj = aMax / jMax;
    return { Tj, Ta: Tj + V / aMax };
  }
  const Tj = Math.sqrt(V / jMax);
  return { Tj, Ta: 2 * Tj };
}

/**
 * Distance at which an S-curve just reaches v_max (then Tv = 0):
 * d = v·Ta = v²/a + v·a/j when a_max is reached on the way, else 2·v·√(v/j).
 */
export function breakEvenSCurve(vMax, aMax, jMax) {
  return vMax * accelPhase(vMax, aMax, jMax).Ta;
}

/**
 * Time-optimal double S rest-to-rest profile (Biagiotti & Melchiorri 2008, 3.4.3).
 *  1. Assume v_max is reached: Ta from accelPhase(v_max), Tv = d/v_max − Ta.
 *  2. If Tv < 0, v_max is not reached (Tv = 0):
 *     d ≥ 2·a³/j²: a_max still reached: Tj = a/j, Ta = Tj/2 + √((Tj/2)² + d/a)
 *     otherwise neither limit is reached: Tj = (d / 2j)^(1/3), Ta = 2·Tj.
 * Peak acceleration a_lim = j·Tj; peak speed v_lim = (Ta − Tj)·a_lim.
 */
export function sCurve(d, vMax, aMax, jMax) {
  let { Tj, Ta } = accelPhase(vMax, aMax, jMax);
  let Tv = d / vMax - Ta;
  let vReached = true;
  if (Tv < 0) {
    vReached = false;
    Tv = 0;
    if (d >= (2 * aMax ** 3) / (jMax * jMax)) {
      Tj = aMax / jMax;
      Ta = Tj / 2 + Math.sqrt((Tj / 2) ** 2 + d / aMax);
    } else {
      Tj = Math.cbrt(d / (2 * jMax));
      Ta = 2 * Tj;
    }
  }
  const aPeak = jMax * Tj;
  const vPeak = vReached ? vMax : (Ta - Tj) * aPeak;
  const Tc = Math.max(0, Ta - 2 * Tj); // constant-acceleration part of each phase
  const { segments, T } = buildSegments([
    { T: Tj, j: jMax }, { T: Tc, j: 0 }, { T: Tj, j: -jMax },
    { T: Tv, j: 0 },
    { T: Tj, j: -jMax }, { T: Tc, j: 0 }, { T: Tj, j: jMax },
  ]);
  return {
    kind: 'scurve', d, vMax, aMax, jMax,
    Tj, Ta, Tv, T, vPeak, aPeak,
    vReached, aReached: aPeak >= aMax * (1 - 1e-12),
    segments,
  };
}

/** Which limits a profile reaches, as words: 'both limits', 'acceleration only', ... */
export function limitCase(profile) {
  if (profile.vReached && profile.aReached) return 'both';
  if (profile.vReached) return 'speed';
  if (profile.aReached) return 'acceleration';
  return 'neither';
}

/* =========================================================================
 * Pick-and-place cycle
 * ====================================================================== */

/** Time spent accelerating or decelerating in one move (s): the two ramps. */
export const rampTime = (profile) => 2 * profile.Ta;

/** Cycle = move out + place dwell + move back + pick dwell (s). */
export const cycleTime = (profile, dwellPick, dwellPlace) => 2 * profile.T + dwellPick + dwellPlace;

/** Picks per minute for a cycle time in seconds. */
export const picksPerMinute = (cycle) => 60 / cycle;

/**
 * State within a repeating pick-and-place cycle at time t (s) since the cycle
 * started at the pick point: out (0 → d), place dwell, back (d → 0), pick
 * dwell, then 'wait' until tEnd (when a slower profile sets the common pace).
 */
export function cycleState(profile, t, dwellPick, dwellPlace) {
  const T = profile.T;
  if (t < T) return { ...evalProfile(profile, t), phase: 'out' };
  if (t < T + dwellPlace) return { p: profile.d, v: 0, a: 0, j: 0, phase: 'place' };
  const tb = t - T - dwellPlace;
  if (tb < T) {
    const s = evalProfile(profile, tb);
    return { p: profile.d - s.p, v: -s.v, a: -s.a, j: -s.j, phase: 'back' };
  }
  if (tb < T + dwellPick) return { p: 0, v: 0, a: 0, j: 0, phase: 'pick' };
  return { p: 0, v: 0, a: 0, j: 0, phase: 'wait' };
}

/**
 * Chart points [t, value] for one cycle out to tEnd (s), for key 'p' | 'v' | 'a' | 'j'.
 * Each segment is sampled (steps on its boundaries stay vertical, so the
 * trapezoid's acceleration jumps are drawn as jumps).
 */
export function cycleSeries(profile, key, dwellPick, dwellPlace, tEnd, perSegment = 24) {
  const pts = [];
  const sign = { p: 1, v: -1, a: -1, j: -1 }[key];
  const pushMove = (offset, back) => {
    for (const seg of profile.segments) {
      const n = key === 'p' || key === 'v' ? perSegment : 1;
      for (let i = 0; i <= n; i++) {
        const tau = (seg.T * i) / n;
        const s = segmentState(seg, tau);
        const val = back ? (key === 'p' ? profile.d - s.p : sign * s[key]) : s[key];
        pts.push([offset + seg.t0 + tau, val]);
      }
    }
  };
  const T = profile.T;
  pushMove(0, false);
  pts.push([T, key === 'p' ? profile.d : 0]);
  pts.push([T + dwellPlace, key === 'p' ? profile.d : 0]);
  pushMove(T + dwellPlace, true);
  pts.push([2 * T + dwellPlace, 0]);
  pts.push([Math.max(tEnd, 2 * T + dwellPlace), 0]);
  return pts;
}

/* =========================================================================
 * "What helps?" sensitivities
 * ====================================================================== */

/** Move-time saving (s) from multiplying one limit by `factor` (2 = doubling). */
export function savingFrom(kind, d, vMax, aMax, jMax, which, factor = 2) {
  const make = (v, a, j) => (kind === 'trapezoid' ? trapezoid(d, v, a) : sCurve(d, v, a, j));
  const base = make(vMax, aMax, jMax).T;
  const v = which === 'v' ? vMax * factor : vMax;
  const a = which === 'a' ? aMax * factor : aMax;
  const j = which === 'j' ? jMax * factor : jMax;
  return base - make(v, a, j).T;
}

/* =========================================================================
 * Numerical check (used by the tests): integrate the jerk/acceleration with
 * small steps and compare with the closed form.
 * ====================================================================== */

/**
 * Integrate a(t), sampled from evalProfile, twice with small steps: midpoint
 * rule for v, trapezium rule for p. Steps are aligned with the segment
 * boundaries so the trapezoid's acceleration jumps fall between steps.
 * Returns the end { p, v } and the largest |v| and |a| seen.
 */
export function integrateProfile(profile, steps = 200000) {
  let p = 0;
  let v = 0;
  let vMaxSeen = 0;
  let aMaxSeen = 0;
  for (const seg of profile.segments) {
    const n = Math.max(1, Math.ceil((steps * seg.T) / profile.T));
    const h = seg.T / n;
    for (let i = 0; i < n; i++) {
      const aMid = evalProfile(profile, seg.t0 + (i + 0.5) * h).a;
      const vNew = v + aMid * h;
      p += 0.5 * (v + vNew) * h;
      v = vNew;
      vMaxSeen = Math.max(vMaxSeen, Math.abs(v));
      aMaxSeen = Math.max(aMaxSeen, Math.abs(aMid));
    }
  }
  return { p, v, vMaxSeen, aMaxSeen };
}
