/**
 * rotation-model.js: pure maths for the rotation and homogeneous transform composer.
 *
 * No DOM access, so everything here is unit tested (/tests/rotation.test.html).
 *
 * Conventions (checked against Diebel 2006 and Lynch & Park 2017; see the
 * comments next to each formula and the page's Sources card):
 *   - right-handed frames; the 3D view has z up
 *   - ACTIVE rotations acting on COLUMN vectors: v' = R v turns the vector v.
 *     R's columns are the turned frame's x, y and z axes written in the fixed
 *     frame. Diebel defines the passive (world to body) matrix instead; ours is
 *     its transpose, e.g. our Rx(θ) is his R1(θ)ᵀ.
 *   - a chain about the moving axes (intrinsic) post-multiplies: R = R1 R2 … Rn;
 *     a chain about the fixed axes (extrinsic) pre-multiplies: R = Rn … R2 R1
 *   - homogeneous transform T = [R p; 0 1], inverse [Rᵀ −Rᵀp; 0 1]
 *   - ZYX Euler angles: yaw ψ, pitch θ, roll φ with R = Rz(ψ) Ry(θ) Rx(φ)
 *   - unit quaternions q = (w, x, y, z), scalar first, Hamilton product, and
 *     q = (cos α/2, n sin α/2) for a turn α about the unit axis n
 * Matrices are arrays of rows: M[i][j] is row i, column j (0-based). Angles are
 * radians unless a name says degrees. Lengths are metres.
 *
 * Sources (both retrieved 2026-10-07):
 *   [D] J. Diebel (2006), "Representing Attitude: Euler Angles, Unit Quaternions, and
 *       Rotation Vectors", Stanford University,
 *       https://www.astro.rug.nl/software/kapteyn-beta/_downloads/attitude.pdf
 *       §2.1: "We define the rotation matrix that encodes the attitude of a rigid body to be
 *       the matrix that when pre-multiplied by a vector expressed in the world coordinates
 *       yields the same vector expressed in the body-fixed coordinates" (passive).
 *       §5.8: "When the pitch angle is 90 degrees, the vehicle is pointing straight up, and
 *       roll and yaw are indistinguishable."
 *   [LP] K. M. Lynch and F. C. Park (2017), Modern Robotics, Cambridge University Press,
 *       preprint http://hades.mech.northwestern.edu/images/7/7f/MR.pdf (page numbers below
 *       are the preprint's).
 * There are no physical constants here: only definitions and exact maths.
 */

export const DEG = Math.PI / 180;
export const toRad = (deg) => deg * DEG;
export const toDeg = (rad) => rad / DEG;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/* =========================================================================
 * 1. Vectors and 3×3 matrices
 * ====================================================================== */

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export function normalize3(a) {
  const n = norm3(a);
  return n > 0 ? scale3(a, 1 / n) : [0, 0, 0];
}

export const identity3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/*
 * Rotations about the coordinate axes (active, column vectors).
 * Lynch & Park 2017, Modern Robotics, §3.2.1 p. 74: "Rot(x̂, θ) = [1 0 0; 0 cos θ −sin θ;
 * 0 sin θ cos θ], Rot(ŷ, θ) = [cos θ 0 sin θ; 0 1 0; −sin θ 0 cos θ], Rot(ẑ, θ) =
 * [cos θ −sin θ 0; sin θ cos θ 0; 0 0 1]",
 * http://hades.mech.northwestern.edu/images/7/7f/MR.pdf, retrieved 2026-10-07.
 * Diebel 2006 eqs. (14)-(16) give the passive R1, R2, R3: these are their transposes.
 */
export function rotX(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
export function rotY(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
export function rotZ(t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
export const AXIS_ROT = { x: rotX, y: rotY, z: rotZ };
export const UNIT = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * Rotation by t about a unit axis n (Rodrigues' formula), as written out in
 * Lynch & Park §3.2.1 p. 74 ("Rot(ω̂, θ) = [c + ω1²(1 − c), ω1ω2(1 − c) − ω3 s, ...]").
 */
export function rotAxis(axis, t) {
  const [x, y, z] = normalize3(axis);
  const c = Math.cos(t);
  const s = Math.sin(t);
  const v = 1 - c;
  return [
    [c + x * x * v, x * y * v - z * s, x * z * v + y * s],
    [x * y * v + z * s, c + y * y * v, y * z * v - x * s],
    [x * z * v - y * s, y * z * v + x * s, c + z * z * v],
  ];
}

export const mul3 = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));
export const mulVec3 = (m, v) => [dot3(m[0], v), dot3(m[1], v), dot3(m[2], v)];
export const transpose3 = (m) => [0, 1, 2].map((i) => [m[0][i], m[1][i], m[2][i]]);
export const trace3 = (m) => m[0][0] + m[1][1] + m[2][2];
export const column3 = (m, j) => [m[0][j], m[1][j], m[2][j]];
/** det M = c1 · (c2 × c3) for columns c1, c2, c3. */
export const det3 = (m) => dot3(column3(m, 0), cross3(column3(m, 1), column3(m, 2)));

/**
 * Largest entry of |RᵀR − I|: zero for an exact rotation (Lynch & Park Definition 3.1,
 * p. 70: SO(3) is "the set of all 3 × 3 real matrices R that satisfy (i) RᵀR = I and
 * (ii) det R = 1").
 */
export function orthonormalityError(R) {
  const P = mul3(transpose3(R), R);
  let err = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) err = Math.max(err, Math.abs(P[i][j] - (i === j ? 1 : 0)));
  return err;
}

/** Angle (rad) of the single turn that takes orientation A to orientation B: angle of AᵀB. */
export function rotationAngleBetween(A, B) {
  return Math.acos(clamp((trace3(mul3(transpose3(A), B)) - 1) / 2, -1, 1));
}

/* =========================================================================
 * 2. Homogeneous transforms (4×4)
 * ====================================================================== */

export const identity4 = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

/** T = [R p; 0 1] (Lynch & Park Definition 3.13, eq. 3.62, p. 89). */
export function homog(R, p = [0, 0, 0]) {
  return [
    [R[0][0], R[0][1], R[0][2], p[0]],
    [R[1][0], R[1][1], R[1][2], p[1]],
    [R[2][0], R[2][1], R[2][2], p[2]],
    [0, 0, 0, 1],
  ];
}
export const rotPart = (T) => [T[0].slice(0, 3), T[1].slice(0, 3), T[2].slice(0, 3)];
export const transPart = (T) => [T[0][3], T[1][3], T[2][3]];

export function mul4(a, b) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    out.push([]);
    for (let j = 0; j < 4; j++) out[i].push(a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] + a[i][3] * b[3][j]);
  }
  return out;
}

/**
 * Inverse of a rigid transform without a general matrix inverse. Lynch & Park
 * Proposition 3.15 (eq. 3.64, p. 90): "T⁻¹ = [R p; 0 1]⁻¹ = [Rᵀ −Rᵀp; 0 1]".
 */
export function invertRigid(T) {
  const Rt = transpose3(rotPart(T));
  return homog(Rt, scale3(mulVec3(Rt, transPart(T)), -1));
}

/** A point p moved by T: R p + t. */
export const applyPoint = (T, p) => add3(mulVec3(rotPart(T), p), transPart(T));

/** Largest entry of |A − B| (any matching shapes). */
export function maxAbsDiff(A, B) {
  let d = 0;
  A.forEach((row, i) => row.forEach((v, j) => (d = Math.max(d, Math.abs(v - B[i][j])))));
  return d;
}

/* =========================================================================
 * 3. Chains of steps
 * A step is { type: 'rx' | 'ry' | 'rz' | 't', deg, p: [x, y, z] (metres) }.
 * ====================================================================== */

export const STEP_TYPES = ['rx', 'ry', 'rz', 't'];

/** The 4×4 transform of one step, swept a fraction f (0..1) of the way. */
export function stepTransform(step, f = 1) {
  if (step.type === 't') return homog(identity3(), scale3(step.p, f));
  return homog(AXIS_ROT[step.type[1]](toRad(step.deg) * f));
}

/**
 * Compose a chain. Intrinsic (about the moving axes) post-multiplies each step,
 * extrinsic (about the fixed axes) pre-multiplies. Lynch & Park §3.2.1 p. 75: "premultiplying
 * by R = Rot(ω̂, θ) yields a rotation about an axis ω̂ considered to be in the fixed frame,
 * and postmultiplying by R yields a rotation about ω̂ considered as being in the body frame."
 *
 * progress (0..n) animates the chain: steps before floor(progress) are complete,
 * the next one is swept the remaining fraction, later ones are not applied.
 * Returns { T, frames }: frames[0] = I, frames[k] = the transform after k steps.
 */
export function composeChain(steps, convention = 'intrinsic', progress = steps.length) {
  const t = clamp(progress, 0, steps.length);
  let T = identity4();
  const frames = [T];
  for (let i = 0; i < steps.length; i++) {
    const f = clamp(t - i, 0, 1);
    if (f <= 0) break;
    const S = stepTransform(steps[i], f);
    T = convention === 'extrinsic' ? mul4(S, T) : mul4(T, S);
    frames.push(T);
  }
  return { T, frames };
}

export const reversedSteps = (steps) => [...steps].reverse();
export const hasTranslation = (steps) => steps.some((s) => s.type === 't' && norm3(s.p) > 0);

/* =========================================================================
 * 4. Checking a typed matrix
 * ====================================================================== */

/** Short number for messages: up to d decimals, no trailing zeros, true minus sign, no "−0". */
export function trimNum(x, d = 3) {
  const v = Number(x.toFixed(d));
  return (Object.is(v, -0) || v === 0 ? '0' : String(v)).replace('-', '−');
}

/**
 * Is M a rotation matrix? Columns must have unit length, be mutually perpendicular
 * and form a right-handed set (det = +1), all within tol. Returns
 * { valid, problems: [{ kind, text }], lengths, det, orthoError }; kind is
 * 'nan' | 'length' | 'perpendicular' | 'reflection' | 'singular'.
 */
export function validateRotation(M, tol = 1e-3) {
  const problems = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (!Number.isFinite(M[i]?.[j])) problems.push({ kind: 'nan', text: `row ${i + 1}, column ${j + 1} is not a number` });
    }
  }
  if (problems.length) return { valid: false, problems, lengths: null, det: NaN, orthoError: NaN };

  const cols = [0, 1, 2].map((j) => column3(M, j));
  const lengths = cols.map(norm3);
  lengths.forEach((L, j) => {
    if (Math.abs(L - 1) > tol) problems.push({ kind: 'length', column: j + 1, value: L, text: `column ${j + 1} has length ${trimNum(L)}` });
  });
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const d = dot3(cols[a], cols[b]);
    if (Math.abs(d) > tol && lengths[a] > 0 && lengths[b] > 0) {
      const angle = toDeg(Math.acos(clamp(d / (lengths[a] * lengths[b]), -1, 1)));
      problems.push({ kind: 'perpendicular', columns: [a + 1, b + 1], value: angle,
        text: `columns ${a + 1} and ${b + 1} are not perpendicular (${trimNum(angle, 1)}° apart)` });
    }
  }
  const det = det3(M);
  if (Math.abs(det) <= tol) {
    problems.push({ kind: 'singular', value: det, text: `det = ${trimNum(det)}: it flattens space, not a rotation` });
  } else if (det < 0) {
    problems.push({ kind: 'reflection', value: det, text: `det = ${trimNum(det)}: a reflection, not a rotation` });
  }
  return { valid: problems.length === 0, problems, lengths, det, orthoError: orthonormalityError(M) };
}

/* =========================================================================
 * 5. Euler angles (ZYX: yaw ψ about z, pitch θ about the new y, roll φ about the newest x)
 * ====================================================================== */

/**
 * R = Rz(ψ) Ry(θ) Rx(φ). Lynch & Park Appendix B.1 p. 575: rotating "by α about the body
 * ẑb-axis, then by β about the body ŷb-axis, and finally by γ about the body x̂b-axis ...
 * corresponds to the final rotation matrix R(α, β, γ) = I Rot(ẑ, α) Rot(ŷ, β) Rot(x̂, γ)".
 * Diebel's sequence (1,2,3), eq. (67), is the transpose (his matrix is passive).
 */
export function eulerZYXToMatrix(yaw, pitch, roll) {
  return mul3(rotZ(yaw), mul3(rotY(pitch), rotX(roll)));
}

/**
 * Euler ZYX angles from a rotation matrix, by Lynch & Park's algorithm (Appendix B.1.1,
 * p. 577): θ = atan2(−r31, √(r11² + r21²)), ψ = atan2(r21, r11), φ = atan2(r32, r33).
 * "If r31 = −1 then β = π/2, and a one-parameter family of solutions for α and γ exists.
 * One possible solution is α = 0 and γ = atan2(r12, r22)"; for r31 = 1, θ = −π/2 and
 * γ = −atan2(r12, r22). singular is true there (gimbal lock): yaw and roll can't be separated.
 */
export function matrixToEulerZYX(R, eps = 1e-9) {
  const cosPitch = Math.hypot(R[0][0], R[1][0]);
  if (cosPitch < eps) {
    const up = R[2][0] < 0;
    return {
      yaw: 0,
      pitch: up ? Math.PI / 2 : -Math.PI / 2,
      roll: up ? Math.atan2(R[0][1], R[1][1]) : -Math.atan2(R[0][1], R[1][1]),
      singular: true,
    };
  }
  return {
    yaw: Math.atan2(R[1][0], R[0][0]),
    pitch: Math.atan2(-R[2][0], cosPitch),
    roll: Math.atan2(R[2][1], R[2][2]),
    singular: false,
  };
}

/* =========================================================================
 * 6. Unit quaternions (w, x, y, z), Hamilton product
 * ====================================================================== */

/**
 * Rotation matrix of a unit quaternion. Lynch & Park eq. (B.12), p. 581:
 * R = [q0² + q1² − q2² − q3², 2(q1q2 − q0q3), 2(q0q2 + q1q3); 2(q0q3 + q1q2),
 * q0² − q1² + q2² − q3², 2(q2q3 − q0q1); 2(q1q3 − q0q2), 2(q0q1 + q2q3), q0² − q1² − q2² + q3²].
 * (Diebel's eq. 125 is its transpose, again because his matrix is passive.)
 */
export function matrixFromQuat([w, x, y, z]) {
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (w * y + x * z)],
    [2 * (w * z + x * y), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (w * x + y * z), w * w - x * x - y * y + z * z],
  ];
}

export function quatNormalize(q) {
  const n = Math.hypot(...q);
  return q.map((c) => c / n);
}

/** q and −q are the same rotation: pick the one with w ≥ 0 (and a stable sign at w = 0). */
export function quatCanonical(q) {
  const firstNonZero = q.find((c) => Math.abs(c) > 1e-12) ?? 1;
  return q[0] < -1e-12 || (Math.abs(q[0]) <= 1e-12 && firstNonZero < 0) ? q.map((c) => (c === 0 ? 0 : -c)) : q;
}

/**
 * Unit quaternion from a rotation matrix. Lynch & Park eqs. (B.10)-(B.11): q0 = ½√(1 + r11 +
 * r22 + r33), (q1, q2, q3) = (r32 − r23, r13 − r31, r21 − r12) / (4 q0). That divides by q0,
 * so near half-turns we use the largest of the four (Diebel eqs. 131-134: 4q1² = 1 + r11 − r22 − r33 ...).
 */
export function quatFromMatrix(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = 2 * Math.sqrt(1 + tr);
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return quatCanonical(quatNormalize(q));
}

/** Diebel eq. (175): q = (cos(α/2), n sin(α/2)) for a turn α about the unit axis n. */
export function quatFromAxisAngle(axis, angle) {
  const n = normalize3(axis);
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), n[0] * s, n[1] * s, n[2] * s];
}

/**
 * Quaternion of the ZYX Euler angles, Diebel eq. (84) (sequence (1,2,3), φ roll, θ pitch,
 * ψ yaw; c and s of the half angles). Smooth in all three angles: no singularity at θ = ±90°.
 */
export function quatFromEulerZYX(yaw, pitch, roll) {
  const [cy, sy] = [Math.cos(yaw / 2), Math.sin(yaw / 2)];
  const [cp, sp] = [Math.cos(pitch / 2), Math.sin(pitch / 2)];
  const [cr, sr] = [Math.cos(roll / 2), Math.sin(roll / 2)];
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

/** Hamilton product a ⊗ b: matrixFromQuat(a ⊗ b) = matrixFromQuat(a) · matrixFromQuat(b). */
export function quatMul([aw, ax, ay, az], [bw, bx, by, bz]) {
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

/** Spherical linear interpolation along the shorter great arc (t = 0 → a, t = 1 → b). */
export function quatSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (d < 0) {
    d = -d;
    bb = b.map((c) => -c);
  }
  if (d > 0.9995) return quatNormalize(a.map((c, i) => c + t * (bb[i] - c)));
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((c, i) => wa * c + wb * bb[i]);
}

/* =========================================================================
 * 7. Axis-angle
 * ====================================================================== */

/**
 * Axis and angle (0..π) of a rotation matrix. Lynch & Park §3.2.3.3, p. 87 ("Algorithm:
 * Given R ∈ SO(3), find a θ ∈ [0, π] and a unit rotation axis ω̂"): θ = cos⁻¹((tr R − 1)/2),
 * ω̂ = (r32 − r23, r13 − r31, r21 − r12) / (2 sin θ); at θ = π use their eqs. (3.58)-(3.60).
 * Here the half-turn case goes through the quaternion, which is equivalent and stable.
 */
export function axisAngleFromMatrix(R) {
  const q = quatFromMatrix(R);
  const s = Math.hypot(q[1], q[2], q[3]);
  if (s < 1e-12) return { axis: [0, 0, 1], angle: 0, defined: false };
  return { axis: [q[1] / s, q[2] / s, q[3] / s], angle: 2 * Math.atan2(s, q[0]), defined: true };
}

/* =========================================================================
 * 8. Gimbal (ZYX) geometry
 * ====================================================================== */

/**
 * World directions of the three gimbal axes: yaw turns about the fixed z axis, pitch
 * about the yawed y axis, roll about the fully turned x axis.
 */
export function gimbalAxes(yaw, pitch) {
  return {
    yaw: [0, 0, 1],
    pitch: mulVec3(rotZ(yaw), [0, 1, 0]),
    roll: mulVec3(mul3(rotZ(yaw), rotY(pitch)), [1, 0, 0]),
  };
}

/**
 * det [roll axis, pitch axis, yaw axis] = cos θ: 1 when the three axes are mutually
 * perpendicular, 0 at gimbal lock (θ = ±90°), when they only span a plane.
 */
export function gimbalDeterminant(yaw, pitch) {
  const a = gimbalAxes(yaw, pitch);
  return dot3(a.roll, cross3(a.pitch, a.yaw));
}

/** Angle (0..π/2) between two lines with directions u and v. */
export const lineAngle = (u, v) => Math.acos(clamp(Math.abs(dot3(u, v)) / (norm3(u) * norm3(v)), 0, 1));

/**
 * Total turning (rad) when the three Euler angles are interpolated in a straight
 * line from a to b ([yaw, pitch, roll] radians): the sum of the small turns
 * between n + 1 samples. Compare with the slerp angle rotationAngleBetween(A, B).
 */
export function eulerPathTurning(a, b, n = 2000) {
  let prev = eulerZYXToMatrix(...a);
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const R = eulerZYXToMatrix(...a.map((v, k) => v + t * (b[k] - v)));
    total += rotationAngleBetween(prev, R);
    prev = R;
  }
  return total;
}
