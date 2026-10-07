/**
 * rotation.js: the rotation and homogeneous transform composer (Chain | Gimbal views).
 *
 * Chain view: a list of steps Rx(θ), Ry(θ), Rz(θ), T(x, y, z), composed about
 * the moving axes (intrinsic: post-multiply, R = R1 R2 … Rn) or the fixed axes
 * (extrinsic: pre-multiply, R = Rn … R2 R1). Every frame of the chain is drawn
 * as an axis triad (intermediate ones faded), the final one carries a small
 * solid object, and the live 3×3 R or 4×4 T sits on the canvas with its checks
 * (RᵀR = I, det R = +1). Play sweeps the steps one at a time; "Compare reversed
 * order" draws the same steps in reverse as a ghost, which is also the result
 * under the other convention. A typed 3×3 matrix is validated and decomposed.
 *
 * Gimbal view: yaw ψ, pitch θ, roll φ (ZYX) drive three nested rings. At pitch
 * ±90° the yaw and roll axes line up (gimbal lock); the unit quaternion of the
 * same orientation stays smooth. Play contrasts straight-line Euler-angle
 * interpolation with quaternion slerp through the singularity.
 *
 * The 3D view is the page's own small renderer: an orbiting perspective camera
 * and primitives (faces, line segments) drawn back to front. World units are
 * metres with z up; pixels only appear in section 5. This is a scaled tool
 * (calibration: false): nothing on it is drawn at 1:1.
 *
 * Sections: 1 constants + state, 2 setters, 3 UI sync, 4 step, 5 draw, 6 wiring.
 * All rotation maths lives in rotation-model.js (unit tested).
 */

import * as RM from './rotation-model.js';
import { fmt, prefersReducedMotion } from './common.js';
import { createSim, bindParam, initTabs, initPresets, setText, createAnnouncer } from './simkit.js';
import { drawTag, drawArrowHead, FONT } from './draw.js';
import { sci } from './astro.js';

const { toRad, toDeg } = RM;

/* =========================================================================
 * 1. Constants + state
 * ====================================================================== */

const LIMITS = {
  degMin: -180, degMax: 180, degStep: 1,    // step angles, degrees
  pMin: -1, pMax: 1, pStep: 0.01,           // translations, m
  pitchMin: -90, pitchMax: 90,              // gimbal pitch, degrees
  maxSteps: 8,
};
const STEP_SECONDS = 1.4;      // Play: time per step...
const STEP_SWEEP = 0.75;       // ...of which this fraction moves, the rest pauses
const INTERP_SECONDS = 5;      // gimbal interpolation demo
const NUDGE_SECONDS = 0.6;
const NUDGE_DEG = 10;
const CAM_DIST = 5;            // camera distance in scene radii (mild perspective)
const OBJ_SCALE = 1;
const TRIAD = {                // axis lengths (m) and widths (px)
  world: { len: 0.36, width: 2, alpha: 0.6 },
  mid: { len: 0.24, width: 1.6, alpha: 0.42 },
  final: { len: 0.3, width: 3.4 },
};
const GIMBAL = { r0: 0.5, r1: 0.42, r2: 0.34, axle: 0.06, floor: -0.62, ringM: 0.016, segments: 72, objScale: 1.45 };
const INTERP_A = [-80, 85, 80]; // (ψ, θ, φ) degrees: both ends near gimbal lock
const INTERP_B = [80, 85, -80];
const NOSE = [0.17, 0, 0];
const FIN_TIP = [0, 0, 0.3];  // traced in the interpolation demo: the body z axis sweeps widely near lock
const LABEL_FONT = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';      // the object's nose, body frame (m)
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const AXES = ['x', 'y', 'z'];
const AXIS_OF = { rx: 'x', ry: 'y', rz: 'z' };
const NEXT_AXIS = { x: 1, y: 2, z: 0 }; // index of the axis an arc starts from

const DEFAULT_CAMS = {
  chain: { az: toRad(38), el: toRad(24), zoom: 1, radius: 0.55, fill: 0.62, target: [0, 0, 0], floorZ: -0.32 },
  gimbal: { az: toRad(-32), el: toRad(20), zoom: 1, radius: 0.8, fill: 0.54, target: [0, 0, 0.03], floorZ: GIMBAL.floor },
};

let nextId = 1;
const state = {
  view: 'chain',
  steps: [],                // { id, type: 'rx'|'ry'|'rz'|'t', deg, p: [x, y, z] }
  convention: 'intrinsic',  // 'intrinsic' (moving axes) | 'extrinsic' (fixed axes)
  ghost: true,              // compare reversed order
  matSize: 3,               // 3: R, 4: T
  anim: { u: null },        // chain Play clock in steps (null = whole chain shown)
  typed: { M: RM.identity3(), show: false, result: null },
  gimbal: { yaw: 30, pitch: 0, roll: 0 }, // degrees
  nudge: null,              // { key, from, to, t }
  interp: { t: 0, active: false, shown: false },
  cams: structuredClone(DEFAULT_CAMS),
};

let cache = null;           // composed chains, refreshed by recompute()

const $ = (id) => document.getElementById(id);
const outputs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const equations = Object.fromEntries([...document.querySelectorAll('[data-eq]')].map((n) => [n.dataset.eq, n]));
const announce = createAnnouncer($('sr-summary'));
const stepsList = $('steps');
const canvas = $('sim-canvas');
const hudEl = $('rot-hud');

/* ---------- small helpers ---------- */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const ease = (t) => t * t * (3 - 2 * t);
const sub = (n) => String(n).split('').map((c) => SUB[c]).join('');
const wrapDeg = (v) => (v > 180 ? v - 360 : v < -180 ? v + 360 : v);
/** Fixed decimals, true minus sign, never "−0.000". */
function num(x, d = 3) {
  const v = Math.abs(x) < 0.5 * 10 ** -d ? 0 : x;
  return fmt(v, d).replace('-', '−');
}
const trim = (x, d = 1) => RM.trimNum(x, d);
const vec = (v, d = 3) => `(${v.map((c) => num(c, d)).join(', ')})`;
const degs = (rad, d = 1) => `${num(toDeg(rad), d)}°`;
const errText = (e) => (e === 0 ? '0' : sci(e, 2));
const stepName = (s) => (s.type === 't' ? 'T' : `R${AXIS_OF[s.type]}`);

function stepText(s, f = 1) {
  if (s.type === 't') return `T(${s.p.map((c) => trim(c * f, 2)).join(', ')})`;
  return `R${AXIS_OF[s.type]}(${trim(s.deg * f, 1)}°)`;
}
function stepHTML(s, f = 1) {
  if (s.type === 't') return `T(${s.p.map((c) => trim(c * f, 2)).join(', ')})`;
  return `R<sub>${AXIS_OF[s.type]}</sub>(${trim(s.deg * f, 1)}°)`;
}
/** The product as written: steps in order about moving axes, reversed about fixed axes. */
function productOf(steps, conv, progress, html = true) {
  const parts = [];
  steps.forEach((s, i) => {
    const f = clamp(progress - i, 0, 1);
    if (f > 0) parts.push(html ? stepHTML(s, f) : stepText(s, f));
  });
  if (!parts.length) return 'I';
  return (conv === 'extrinsic' ? parts.reverse() : parts).join(' · ');
}

/* =========================================================================
 * 2. State setters
 * ====================================================================== */

function makeStep(type, deg = 90, p = [0.3, 0, 0]) {
  return { id: nextId++, type, deg: type === 't' ? 0 : deg, p: type === 't' ? [...p] : [0, 0, 0] };
}

function addStep(type) {
  if (state.steps.length >= LIMITS.maxSteps) return;
  state.steps.push(makeStep(type));
  if (type === 't') setMatSize(4, { quiet: true });
  chainChanged({ structure: true });
  announce(`Added ${stepText(state.steps.at(-1))} as step ${state.steps.length}.`);
  stepEls.get(state.steps.at(-1).id)?.num0.focus();
}

function removeStep(id) {
  const i = state.steps.findIndex((s) => s.id === id);
  if (i < 0) return;
  const [s] = state.steps.splice(i, 1);
  chainChanged({ structure: true });
  announce(`Removed ${stepText(s)}.`);
  const next = state.steps[Math.min(i, state.steps.length - 1)];
  (next ? stepEls.get(next.id).handle : document.querySelector('[data-add="rx"]')).focus();
}

/** Move a step to index `to` (clamped). Returns true if it moved. */
function moveStepTo(id, to) {
  const from = state.steps.findIndex((s) => s.id === id);
  const target = clamp(to, 0, state.steps.length - 1);
  if (from < 0 || target === from) return false;
  const [s] = state.steps.splice(from, 1);
  state.steps.splice(target, 0, s);
  chainChanged({ structure: true });
  return true;
}

function announceOrder(id) {
  const i = state.steps.findIndex((s) => s.id === id);
  announce(`${stepText(state.steps[i])} is now step ${i + 1} of ${state.steps.length}. Order: ${state.steps.map((s) => stepText(s)).join(', then ')}.`);
}

function setStepDeg(id, deg) {
  const s = state.steps.find((x) => x.id === id);
  if (!s) return;
  s.deg = clamp(deg, LIMITS.degMin, LIMITS.degMax);
  stepEls.get(id)?.params.forEach((p) => p.sync());
  chainChanged();
}
function setStepP(id, k, v) {
  const s = state.steps.find((x) => x.id === id);
  if (!s) return;
  s.p[k] = clamp(v, LIMITS.pMin, LIMITS.pMax);
  stepEls.get(id)?.params.forEach((p) => p.sync());
  chainChanged();
}

function setChain(steps, { convention, ghost, matSize, camAz } = {}) {
  state.steps = steps.map((s) => makeStep(s.type, s.deg, s.p));
  if (convention) setConvention(convention, { quiet: true });
  if (ghost !== undefined) setGhost(ghost, { quiet: true });
  if (matSize) setMatSize(matSize, { quiet: true });
  state.anim.u = null;
  if (sim.paused === false) sim.setPaused(true);
  chainChanged({ structure: true });
  resetView(camAz);
  announce(`Chain: ${state.steps.map((s) => stepText(s)).join(', then ')}, about the ${state.convention === 'intrinsic' ? 'moving' : 'fixed'} axes.`);
}

function setConvention(c, { quiet = false } = {}) {
  state.convention = c === 'extrinsic' ? 'extrinsic' : 'intrinsic';
  const radio = $(`conv-${state.convention}`);
  if (radio) radio.checked = true;
  if (!quiet) {
    chainChanged();
    announce(state.convention === 'intrinsic'
      ? 'Each step now turns about the moving axes: R = R1 R2 … Rn.'
      : 'Each step now turns about the fixed world axes: R = Rn … R2 R1.');
  }
}

function setGhost(on, { quiet = false } = {}) {
  state.ghost = Boolean(on);
  $('ghost-check').checked = state.ghost;
  if (!quiet) {
    chainChanged();
    if (state.ghost) announce(`Reversed order ghost shown, ${outputs.revAngle.textContent} from the chain's result.`);
  }
}

function setMatSize(n, { quiet = false } = {}) {
  state.matSize = n === 4 ? 4 : 3;
  $(`mat-${state.matSize}`).checked = true;
  if (!quiet) updateHud();
}

/** Typed matrix: parse the 9 inputs, validate, show. */
function setTyped(M, { show } = {}) {
  state.typed.M = M.map((r) => [...r]);
  if (show !== undefined) state.typed.show = show;
  $('typed-show').checked = state.typed.show;
  writeTypedInputs();
  typedChanged();
}

function setGimbal(key, deg, { fromUser = true } = {}) {
  const lim = key === 'pitch' ? [LIMITS.pitchMin, LIMITS.pitchMax] : [LIMITS.degMin, LIMITS.degMax];
  state.gimbal[key] = clamp(deg, lim[0], lim[1]);
  if (fromUser) stopInterp();
  gimbalChanged({ quiet: !fromUser });
}

function setGimbalAll([yaw, pitch, roll]) {
  stopInterp();
  state.nudge = null;
  Object.assign(state.gimbal, { yaw, pitch, roll });
  gimbalChanged();
}

function nudge(key, by) {
  stopInterp();
  const from = state.gimbal[key];
  if (prefersReducedMotion()) {
    state.gimbal[key] = wrapDeg(from + by);
    gimbalChanged();
    return;
  }
  state.nudge = { key, from, to: from + by, t: 0 };
}

function stopInterp() {
  state.interp.active = false;
  state.interp.shown = false;
  if (state.view === 'gimbal' && !sim.paused) sim.setPaused(true);
}

function startInterp() {
  state.nudge = null;
  state.interp = { t: 0, active: true, shown: true };
  [state.gimbal.yaw, state.gimbal.pitch, state.gimbal.roll] = INTERP_A;
  gimbalChanged({ quiet: true });
}

/* =========================================================================
 * 3. UI sync
 * ====================================================================== */

/** Recompose the chain (full, reversed) after any change. */
function recompute() {
  const full = RM.composeChain(state.steps, state.convention);
  const rev = RM.composeChain(RM.reversedSteps(state.steps), state.convention);
  cache = { full, rev, R: RM.rotPart(full.T), p: RM.transPart(full.T), Rrev: RM.rotPart(rev.T), prev: RM.transPart(rev.T) };
}

/** Animation progress in steps (eased sweep, then a short pause), or the whole chain. */
function displayProgress() {
  const n = state.steps.length;
  if (state.anim.u === null) return n;
  const k = Math.floor(state.anim.u);
  if (k >= n) return n;
  return k + ease(clamp((state.anim.u - k) / STEP_SWEEP, 0, 1));
}

function chainChanged({ structure = false } = {}) {
  recompute();
  if (state.anim.u !== null) state.anim.u = Math.min(state.anim.u, state.steps.length);
  if (structure) renderSteps();
  updateChainReadouts();
  updateHud();
  updateEquations();
  sim.updateAria();
  sim.refreshPlayButton();
  sim.requestDraw();
}

function gimbalChanged({ quiet = false } = {}) {
  for (const p of gimbalParams) p.sync();
  updateGimbalReadouts();
  updateHud();
  updateEquations();
  sim.updateAria();
  sim.requestDraw();
  if (!quiet) {
    const { yaw, pitch, roll } = state.gimbal;
    const locked = Math.abs(Math.abs(pitch) - 90) < 0.05;
    announce(`Yaw ${trim(yaw)}°, pitch ${trim(pitch)}°, roll ${trim(roll)}°.` +
      (locked ? ' Gimbal lock: the yaw and roll axes are aligned, one degree of freedom is lost.' : ` Yaw and roll axes ${trim(90 - Math.abs(pitch))}° apart.`));
  }
}

/* ---------- Step cards (one <li> per step, kept across reorders) ---------- */

const stepEls = new Map(); // id → { li, handle, num0, name, earlier, later, remove, params }

function stepRowHTML(id, key, label) {
  return `<div class="rot-step-row">
      <label for="s${id}-${key}">${label}</label>
      <input type="range" id="s${id}-${key}">
      <span class="num-field"><input type="number" id="s${id}-${key}-num" inputmode="decimal"><span class="unit" aria-hidden="true">${key === 'deg' ? '°' : 'm'}</span></span>
    </div>`;
}

function createStepEl(step) {
  const li = document.createElement('li');
  li.className = 'rot-step';
  li.dataset.type = step.type;
  li.dataset.id = String(step.id);
  const rows = step.type === 't'
    ? [0, 1, 2].map((k) => stepRowHTML(step.id, `p${k}`, AXES[k])).join('')
    : stepRowHTML(step.id, 'deg', 'θ');
  li.innerHTML = `
    <div class="rot-step-head">
      <button type="button" class="rot-handle" title="Drag to reorder (or use the arrow keys)"></button>
      <span class="rot-step-name"></span>
      <span class="rot-step-tools">
        <button type="button" class="btn btn-small" data-act="earlier">←</button>
        <button type="button" class="btn btn-small" data-act="later">→</button>
        <button type="button" class="btn btn-small" data-act="remove">×</button>
      </span>
    </div>${rows}`;
  const q = (sel) => li.querySelector(sel);
  const el = {
    li,
    handle: q('.rot-handle'),
    name: q('.rot-step-name'),
    earlier: q('[data-act="earlier"]'),
    later: q('[data-act="later"]'),
    remove: q('[data-act="remove"]'),
    nums: [...li.querySelectorAll('input[type="number"]')],
    params: [],
  };
  el.num0 = el.nums[0];
  const id = step.id;
  const live = () => state.steps.find((s) => s.id === id);
  if (step.type === 't') {
    for (let k = 0; k < 3; k++) {
      el.params.push(bindParam({
        range: q(`#s${id}-p${k}`), num: q(`#s${id}-p${k}-num`), min: LIMITS.pMin, max: LIMITS.pMax, step: LIMITS.pStep,
        decimals: 2, words: 'metres', get: () => live()?.p[k] ?? 0, set: (v) => setStepP(id, k, v),
      }));
    }
  } else {
    el.params.push(bindParam({
      range: q(`#s${id}-deg`), num: q(`#s${id}-deg-num`), min: LIMITS.degMin, max: LIMITS.degMax, step: LIMITS.degStep,
      decimals: 1, words: 'degrees', get: () => live()?.deg ?? 0, set: (v) => setStepDeg(id, v),
    }));
  }
  el.earlier.addEventListener('click', () => { if (moveStepTo(id, indexOf(id) - 1)) { announceOrder(id); refocus(id, 'earlier'); } });
  el.later.addEventListener('click', () => { if (moveStepTo(id, indexOf(id) + 1)) { announceOrder(id); refocus(id, 'later'); } });
  el.remove.addEventListener('click', () => removeStep(id));
  el.handle.addEventListener('keydown', (e) => {
    const i = indexOf(id);
    const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: state.steps.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    if (moveStepTo(id, to)) {
      announceOrder(id);
      refocus(id, 'handle');
    }
  });
  el.handle.addEventListener('pointerdown', (e) => startReorder(e, id));
  return el;
}

const indexOf = (id) => state.steps.findIndex((s) => s.id === id);

/** Moving a node in the DOM drops its focus: put it back (or on the handle if that button is now disabled). */
function refocus(id, which) {
  const el = stepEls.get(id);
  if (!el) return;
  const btn = el[which];
  (btn && !btn.disabled ? btn : el.handle).focus();
}

/** Create/remove/reorder the step cards to match state.steps, then refresh their labels. */
function renderSteps() {
  const ids = new Set(state.steps.map((s) => s.id));
  for (const [id, el] of stepEls) {
    if (!ids.has(id)) {
      el.li.remove();
      stepEls.delete(id);
    }
  }
  state.steps.forEach((s, i) => {
    let el = stepEls.get(s.id);
    if (!el) {
      el = createStepEl(s);
      stepEls.set(s.id, el);
    }
    if (stepsList.children[i] !== el.li) stepsList.insertBefore(el.li, stepsList.children[i] ?? null);
    const n = state.steps.length;
    el.name.innerHTML = `<span class="rot-step-num">${i + 1}</span>${s.type === 't' ? 'T' : `R<sub>${AXIS_OF[s.type]}</sub>`}`;
    const what = s.type === 't' ? 'translation' : `rotation about ${AXIS_OF[s.type]}`;
    el.handle.setAttribute('aria-label', `Step ${i + 1} of ${n}, ${what}: drag, or use the arrow keys, to reorder`);
    el.earlier.disabled = i === 0;
    el.later.disabled = i === n - 1;
    el.earlier.setAttribute('aria-label', `Move step ${i + 1} earlier`);
    el.later.setAttribute('aria-label', `Move step ${i + 1} later`);
    el.remove.setAttribute('aria-label', `Remove step ${i + 1}`);
    el.nums.forEach((inp, k) => inp.setAttribute('aria-label', s.type === 't'
      ? `Step ${i + 1} translation along ${AXES[k]}, metres`
      : `Step ${i + 1} angle about ${AXIS_OF[s.type]}, degrees`));
    el.params.forEach((p) => p.sync());
  });
  const full = state.steps.length >= LIMITS.maxSteps;
  for (const b of document.querySelectorAll('[data-add]')) b.disabled = full;
  $('clear-btn').disabled = state.steps.length === 0;
}

/** Highlight the step being played. */
function markActiveStep() {
  const active = state.anim.u === null ? -1 : Math.floor(state.anim.u);
  state.steps.forEach((s, i) => stepEls.get(s.id)?.li.classList.toggle('is-active', i === active));
}

/* ---------- Drag to reorder (pointer events: mouse, pen and touch) ---------- */

let reorder = null;

function startReorder(e, id) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const el = stepEls.get(id);
  const r = el.li.getBoundingClientRect();
  reorder = { id, el, pointerId: e.pointerId, grabX: e.clientX - r.left, grabY: e.clientY - r.top, tx: 0, ty: 0, startIndex: indexOf(id) };
  try {
    el.handle.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic pointer: capture is only a nicety */
  }
  el.li.classList.add('is-dragging');
  e.preventDefault();
}

function moveReorder(e) {
  if (!reorder || e.pointerId !== reorder.pointerId) return;
  const { el, id } = reorder;
  // Nearest other card to the pointer decides the slot (works across wrapped rows).
  let best = null;
  for (const s of state.steps) {
    if (s.id === id) continue;
    const r = stepEls.get(s.id).li.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot((e.clientX - cx) / r.width, (e.clientY - cy) / r.height);
    if (!best || d < best.d) best = { d, s, after: e.clientX > cx };
  }
  if (best && best.d < 1.2) {
    const others = state.steps.filter((s) => s.id !== id);
    const target = others.indexOf(best.s) + (best.after ? 1 : 0);
    moveStepTo(id, target);
  }
  // Keep the card under the pointer: its untransformed position + the grab offset.
  const r = el.li.getBoundingClientRect();
  const natLeft = r.left - reorder.tx;
  const natTop = r.top - reorder.ty;
  reorder.tx = e.clientX - reorder.grabX - natLeft;
  reorder.ty = e.clientY - reorder.grabY - natTop;
  el.li.style.transform = `translate(${reorder.tx}px, ${reorder.ty}px)`;
}

function endReorder(e) {
  if (!reorder || e.pointerId !== reorder.pointerId) return;
  const { el, id, startIndex } = reorder;
  el.li.style.transform = '';
  el.li.classList.remove('is-dragging');
  reorder = null;
  if (indexOf(id) !== startIndex) announceOrder(id);
}

/* ---------- The panel on the canvas ---------- */

const hud = { eq: $('hud-eq'), note: $('hud-note'), mat: $('hud-mat'), quat: $('hud-quat'), orth: $('chk-orth'), det: $('chk-det'), gimbal: $('chk-gimbal') };
let hudMatKey = '';
let hudCells = [];
let hudQuatRows = null;

function setHudMatrix(M, headers) {
  const rows = M.length;
  const n = M[0].length;
  const key = `${rows}x${n}|${headers.join(',')}`;
  if (key !== hudMatKey) {
    hudMatKey = key;
    hud.mat.style.setProperty('--n', n);
    const cls = ['ax-x', 'ax-y', 'ax-z', 'is-dim'];
    const head = headers.map((h, j) => `<span class="${cls[j]}">${h}</span>`).join('');
    let cells = '';
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < n; j++) cells += `<span class="${[i === 3 ? 'is-dim' : '', j === 3 ? 'is-p' : ''].join(' ').trim()}"></span>`;
    }
    hud.mat.innerHTML = `<div class="rot-mat-head" aria-hidden="true">${head}</div><div class="rot-mat-grid">${cells}</div>`;
    hud.mat.setAttribute('aria-label', rows === 4 ? '4 by 4 homogeneous transform' : '3 by 3 rotation matrix');
    hudCells = [...hud.mat.querySelectorAll('.rot-mat-grid span')];
  }
  M.forEach((row, i) => row.forEach((v, j) => setText(hudCells[i * n + j], i === 3 ? String(v) : num(v))));
}

function setCheck(el, ok, html) {
  el.classList.toggle('is-warn', !ok);
  const wrapped = `<span>${html}</span>`; // one flex item, so the gap doesn't split RᵀR
  if (el.innerHTML !== wrapped) el.innerHTML = wrapped;
}

function setChecks(R) {
  const err = RM.orthonormalityError(R);
  const det = RM.det3(R);
  setCheck(hud.orth, err < 1e-9, `R<sup>T</sup>R = I <span class="muted">(largest error ${errText(err)})</span>`);
  setCheck(hud.det, Math.abs(det - 1) < 1e-9, `det R = ${det >= 0 ? '+' : ''}${num(det)}`);
}

function setHudQuat(q) {
  if (!hudQuatRows) {
    hud.quat.innerHTML = '<p class="rot-hud-sub">Same orientation as a unit quaternion</p>' +
      ['w', 'x', 'y', 'z'].map((c) => `<div class="rot-qrow"><span>${c}</span><span class="rot-qbar"><i></i></span><b></b></div>`).join('');
    hudQuatRows = [...hud.quat.querySelectorAll('.rot-qrow')].map((r) => ({ bar: r.querySelector('i'), val: r.querySelector('b') }));
  }
  q.forEach((v, i) => {
    const row = hudQuatRows[i];
    row.bar.style.left = `${50 + Math.min(0, v) * 50}%`;
    row.bar.style.width = `${Math.abs(v) * 50}%`;
    setText(row.val, num(v));
  });
}

function updateHud() {
  if (state.view === 'gimbal') {
    const { yaw, pitch, roll } = state.gimbal;
    const R = gimbalMatrix();
    hud.eq.innerHTML = `R = R<sub>z</sub>(${trim(yaw)}°) · R<sub>y</sub>(${trim(pitch)}°) · R<sub>x</sub>(${trim(roll)}°)`;
    setText(hud.note, 'ZYX: yaw about z, pitch about the new y, roll about the newest x');
    setHudMatrix(R, ['x′', 'y′', 'z′']);
    setHudQuat(gimbalQuat());
    setChecks(R);
    const det = RM.gimbalDeterminant(toRad(yaw), toRad(pitch));
    const locked = Math.abs(Math.abs(pitch) - 90) < 0.05;
    setCheck(hud.gimbal, Math.abs(pitch) < 75,
      locked ? 'det[axes] = cos θ = 0: gimbal lock' : `det[axes] = cos θ = ${num(det)}`);
    return;
  }
  const progress = displayProgress();
  const { T, frames } = state.anim.u === null ? cache.full : RM.composeChain(state.steps, state.convention, progress);
  const R = RM.rotPart(T);
  const k = frames.length - 1;
  const four = state.matSize === 4;
  const moves = RM.hasTranslation(state.steps);
  hud.eq.innerHTML = `${moves ? 'T' : 'R'} = ${productOf(state.steps, state.convention, progress)}`;
  setText(hud.note, (state.convention === 'intrinsic'
    ? 'Moving axes: post-multiply, so the product reads in step order.'
    : 'Fixed axes: pre-multiply, so the last step is written first.') +
    (moves && !four ? ' Showing the rotation part R of T.' : ''));
  setHudMatrix(four ? T : R, [`x${sub(k)}`, `y${sub(k)}`, `z${sub(k)}`, ...(four ? ['p'] : [])]);
  setChecks(R);
}

/* ---------- Readouts and equations ---------- */

function orientationTexts(R) {
  const e = RM.matrixToEulerZYX(R);
  const q = RM.quatFromMatrix(R);
  const aa = RM.axisAngleFromMatrix(R);
  return {
    euler: `ψ ${degs(e.yaw)}, θ ${degs(e.pitch)}, φ ${degs(e.roll)}`,
    eulerSub: e.singular ? 'pitch ±90°: gimbal lock, only ψ ∓ φ is defined (ψ set to 0)' : 'yaw ψ, pitch θ, roll φ (ZYX)',
    quat: vec(q),
    aa: aa.defined ? `${degs(aa.angle)} about ${vec(aa.axis)}` : '0° (no turn)',
    e, q, aaObj: aa,
  };
}

function updateChainReadouts() {
  const t = orientationTexts(cache.R);
  setText(outputs.euler, t.euler);
  setText(outputs.eulerSub, t.eulerSub);
  setText(outputs.quat, t.quat);
  setText(outputs.aa, t.aa);
  setText(outputs.pos, vec(cache.p));
  const ang = RM.rotationAngleBetween(cache.R, cache.Rrev);
  const gap = RM.norm3(RM.sub3(cache.p, cache.prev));
  setText(outputs.revAngle, `${num(toDeg(ang), 1)}°`);
  setText(outputs.revSub, ang < 1e-9 && gap < 1e-9
    ? 'the same: these steps commute'
    : gap > 5e-4 ? `turned from this result, and ${num(gap)} m away` : 'turned from this result');
}

function gimbalMatrix() {
  const { yaw, pitch, roll } = state.gimbal;
  return RM.eulerZYXToMatrix(toRad(yaw), toRad(pitch), toRad(roll));
}
function gimbalQuat() {
  const { yaw, pitch, roll } = state.gimbal;
  return RM.quatFromEulerZYX(toRad(yaw), toRad(pitch), toRad(roll));
}

/** Angle between "yaw +10°" and the matching roll nudge: 0 at gimbal lock. */
function nudgeGap() {
  const { yaw, pitch, roll } = state.gimbal;
  const s = pitch >= 0 ? -1 : 1; // at +90° yaw +10 ≡ roll −10; at −90° yaw +10 ≡ roll +10
  const a = RM.eulerZYXToMatrix(toRad(yaw + NUDGE_DEG), toRad(pitch), toRad(roll));
  const b = RM.eulerZYXToMatrix(toRad(yaw), toRad(pitch), toRad(roll + s * NUDGE_DEG));
  return { deg: toDeg(RM.rotationAngleBetween(a, b)), rollWord: s < 0 ? '−' : '+' };
}

function updateGimbalReadouts() {
  const { yaw, pitch } = state.gimbal;
  const det = RM.gimbalDeterminant(toRad(yaw), toRad(pitch));
  const axes = RM.gimbalAxes(toRad(yaw), toRad(pitch));
  const locked = Math.abs(Math.abs(pitch) - 90) < 0.05;
  setText(outputs.axisAngle, `${num(toDeg(RM.lineAngle(axes.yaw, axes.roll)), 1)}°`);
  setText(outputs.dof, locked ? '2 (one lost)' : '3');
  setText(outputs.dofSub, `det = cos θ = ${num(det)}`);
  setText(outputs.gQuat, vec(gimbalQuat()));
  const back = RM.matrixToEulerZYX(gimbalMatrix());
  setText(outputs.gBack, `ψ ${degs(back.yaw)}, θ ${degs(back.pitch)}, φ ${degs(back.roll)}`);
  setText(outputs.gBackSub, back.singular
    ? `one of infinitely many answers: only ψ ${pitch > 0 ? '−' : '+'} φ is fixed at the lock`
    : 'the same angles come back: the description is unique here');
  const g = nudgeGap();
  setText($('nudge-result'), `Yaw +${NUDGE_DEG}° and roll ${g.rollWord}${NUDGE_DEG}° end ${num(g.deg, 1)}° apart` +
    (g.deg < 0.05 ? ': the same motion. One degree of freedom is gone.' : ': different motions.'));
  setText(outputs.interp, `Euler angles ${num(interpStats.euler, 0)}°, slerp ${num(interpStats.slerp, 0)}°`);
}

function updateEquations() {
  // Known small cases, computed (not typed)
  const r90 = toRad(90);
  setText(equations.rx, `Rx(90°) sends y = (0, 1, 0) to ${vec(RM.mulVec3(RM.rotX(r90), [0, 1, 0]), 0)}`);
  setText(equations.ry, `Ry(90°) sends z = (0, 0, 1) to ${vec(RM.mulVec3(RM.rotY(r90), [0, 0, 1]), 0)}`);
  setText(equations.rz, `Rz(90°) sends x = (1, 0, 0) to ${vec(RM.mulVec3(RM.rotZ(r90), [1, 0, 0]), 0)}`);
  if (!cache) return;
  const conv = state.convention === 'intrinsic' ? 'moving axes' : 'fixed axes';
  setText(equations.compose, `Your chain about the ${conv}: R = ${productOf(state.steps, state.convention, state.steps.length, false)}`);
  const other = state.convention === 'intrinsic' ? 'extrinsic' : 'intrinsic';
  const swapped = RM.composeChain(RM.reversedSteps(state.steps), other).T;
  setText(equations.reverse, `Reversed order about the other axes matches your chain to ${errText(RM.maxAbsDiff(swapped, cache.full.T))}; reversed about the same axes ends ${num(toDeg(RM.rotationAngleBetween(cache.R, cache.Rrev)), 1)}° away.`);
  const inv = RM.invertRigid(cache.full.T);
  setText(equations.homog, `p = ${vec(cache.p)} m, −Rᵀp = ${vec(RM.transPart(inv))} m, T·T⁻¹ = I to ${errText(RM.maxAbsDiff(RM.mul4(cache.full.T, inv), RM.identity4()))}`);
  setText(equations.checks, `Largest |RᵀR − I| = ${errText(RM.orthonormalityError(cache.R))}, det R = ${num(RM.det3(cache.R))}`);
  const R = cache.R;
  const t = orientationTexts(R);
  setText(equations.euler, `θ = ${degs(t.e.pitch)}, ψ = ${degs(t.e.yaw)}, φ = ${degs(t.e.roll)}` +
    (t.e.singular ? ' (singular: r₁₁ = r₂₁ = 0, so ψ is set to 0)' : ''));
  const tr = RM.trace3(R);
  setText(equations.quat, `1 + trace = ${num(1 + tr)}, q = ${t.quat}`);
  setText(equations.aa, `cos α = (${num(tr)} − 1) / 2 = ${num((tr - 1) / 2)}, α = ${degs(t.aaObj.angle)}` +
    (t.aaObj.defined ? `, n = ${vec(t.aaObj.axis)}` : ''));
  const { yaw, pitch } = state.gimbal;
  setText(equations.gimbal, `Gimbal view: θ = ${trim(pitch)}°, det = ${num(RM.gimbalDeterminant(toRad(yaw), toRad(pitch)))}` +
    (Math.abs(Math.abs(pitch) - 90) < 0.05 ? ': the axes span only a plane (gimbal lock)' : ''));
}

/* ---------- Typed matrix ---------- */

const typedInputs = [];
function buildTypedGrid() {
  const grid = $('typed-grid');
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.inputMode = 'decimal';
      inp.setAttribute('aria-label', `Row ${i + 1}, column ${j + 1}`);
      inp.addEventListener('input', () => {
        state.typed.M[i][j] = inp.value.trim() === '' ? NaN : Number(inp.value);
        if (!state.typed.show) {
          state.typed.show = true;
          $('typed-show').checked = true;
        }
        typedChanged();
      });
      grid.append(inp);
      typedInputs.push(inp);
    }
  }
}
function writeTypedInputs() {
  state.typed.M.forEach((row, i) => row.forEach((v, j) => {
    typedInputs[i * 3 + j].value = Number.isFinite(v) ? String(Number(v.toFixed(4))) : '';
  }));
}

function typedChanged() {
  const res = RM.validateRotation(state.typed.M);
  state.typed.result = res;
  const box = $('typed-result');
  const bad = new Set();
  for (const p of res.problems) {
    if (p.kind === 'length') [0, 1, 2].forEach((i) => bad.add(i * 3 + p.column - 1));
    if (p.kind === 'perpendicular') p.columns.forEach((c) => [0, 1, 2].forEach((i) => bad.add(i * 3 + c - 1)));
  }
  typedInputs.forEach((inp, k) => inp.classList.toggle('is-bad', bad.has(k) || !Number.isFinite(state.typed.M[Math.floor(k / 3)][k % 3])));
  if (res.valid) {
    const t = orientationTexts(state.typed.M);
    box.innerHTML = `<div class="rot-typed-ok">
      <p><span class="badge badge--ok">A rotation</span> <span class="muted">RᵀR = I to ${errText(res.orthoError)}, det = ${num(res.det)}</span></p>
      <p>ZYX Euler: <b>${t.euler}</b>${t.e.singular ? ' <span class="muted">(gimbal lock)</span>' : ''}</p>
      <p>Quaternion (w, x, y, z): <b>${t.quat}</b></p>
      <p>Axis&ndash;angle: <b>${t.aa}</b></p></div>`;
  } else {
    box.innerHTML = `<div class="notice"><p><strong>Not a rotation:</strong></p><ul>${res.problems.map((p) => `<li>${p.text}</li>`).join('')}</ul>` +
      (Number.isFinite(res.det) ? `<p>Largest |RᵀR − I| = ${res.orthoError < 1e-3 ? errText(res.orthoError) : num(res.orthoError)}, det = ${num(res.det)}</p>` : '') + '</div>';
  }
  $('typed-chain').disabled = !res.valid;
  sim.requestDraw();
}

const TYPED_EXAMPLES = {
  // Illustrations for the checker (not data): Rz(30°) to 3 decimals, then broken three ways
  reflect: [[0.866, -0.5, 0], [0.5, 0.866, 0], [0, 0, -1]],
  stretch: [[0.866, -0.5, 0], [0.5, 0.866, 0], [0, 0, 1.2]],
  skew: [[1, 0.259, 0], [0, 0.966, 0], [0, 0, 1]],
};

function typedToChain() {
  if (!state.typed.result?.valid) return;
  const e = RM.matrixToEulerZYX(state.typed.M);
  const r1 = (x) => Math.round(toDeg(x) * 10) / 10;
  setChain([{ type: 'rz', deg: r1(e.yaw) }, { type: 'ry', deg: r1(e.pitch) }, { type: 'rx', deg: r1(e.roll) }],
    { convention: 'intrinsic', matSize: 3 });
}

/* ---------- Description for screen readers ---------- */

function describe() {
  if (state.view === 'gimbal') {
    const { yaw, pitch, roll } = state.gimbal;
    const locked = Math.abs(Math.abs(pitch) - 90) < 0.05;
    return `Gimbal with three nested rings at yaw ${trim(yaw)} degrees, pitch ${trim(pitch)} degrees, roll ${trim(roll)} degrees. ` +
      (locked ? 'Gimbal lock: the yaw and roll axes are aligned, so one degree of freedom is lost. '
        : `The yaw and roll axes are ${trim(90 - Math.abs(pitch))} degrees apart. `) +
      `The same orientation as a unit quaternion is ${vec(gimbalQuat(), 2)}.${sim.paused ? '' : ' Interpolation demo playing.'}`;
  }
  if (!cache) return '3D view of a chain of rotations';
  const n = state.steps.length;
  const axesWords = [0, 1, 2].map((k) => `${AXES[k]} along ${vec(RM.column3(cache.R, k), 2)}`).join(', ');
  return `3D view, not to scale, of a chain of ${n} step${n === 1 ? '' : 's'} about the ${state.convention === 'intrinsic' ? 'moving' : 'fixed'} axes: ` +
    `${state.steps.map((s) => stepText(s)).join(', then ') || 'none'}. The final frame has ${axesWords}` +
    (RM.norm3(cache.p) > 1e-9 ? `, origin at ${vec(cache.p, 2)} metres` : '') + '. ' +
    `Checks: R transpose R equals the identity and the determinant is ${num(RM.det3(cache.R))}.` +
    (state.ghost ? ` The reversed order, drawn as a ghost, ends ${num(toDeg(RM.rotationAngleBetween(cache.R, cache.Rrev)), 0)} degrees away.` : '');
}

/* =========================================================================
 * 4. Step: Play sweeps the chain one step at a time, or runs the
 *    interpolation demo in the gimbal view
 * ====================================================================== */

function step(simDt) {
  if (state.view === 'gimbal') {
    if (!state.interp.active) {
      sim.setPaused(true);
      return;
    }
    state.interp.t = Math.min(1, state.interp.t + simDt / INTERP_SECONDS);
    const f = ease(state.interp.t);
    [state.gimbal.yaw, state.gimbal.pitch, state.gimbal.roll] = INTERP_A.map((a, k) => a + f * (INTERP_B[k] - a));
    if (state.interp.t >= 1) {
      state.interp.active = false;
      sim.setPaused(true);
    }
    gimbalChanged({ quiet: true });
    return;
  }
  if (state.anim.u === null) {
    sim.setPaused(true);
    return;
  }
  state.anim.u += simDt / STEP_SECONDS;
  if (state.anim.u >= state.steps.length) {
    state.anim.u = null;
    sim.setPaused(true);
  }
  markActiveStep();
  updateHud();
}

/** Every frame: nudge tweens in the gimbal view. */
function animate(dt) {
  const n = state.nudge;
  if (!n) return false;
  n.t = Math.min(1, n.t + dt / NUDGE_SECONDS);
  state.gimbal[n.key] = wrapDeg(n.from + (n.to - n.from) * ease(n.t));
  if (n.t >= 1) {
    state.nudge = null;
    gimbalChanged();
  } else {
    gimbalChanged({ quiet: true });
  }
  return true;
}

/* =========================================================================
 * 5. Drawing: a small perspective renderer (metres in, CSS px out)
 * ====================================================================== */

/** Camera looking at cam.target from azimuth az, elevation el; kPx = px per metre at the target. */
function makeCamera(cam, w, h, inset) {
  const ce = Math.cos(cam.el);
  const back = [ce * Math.cos(cam.az), ce * Math.sin(cam.az), Math.sin(cam.el)];
  const dist = cam.radius * CAM_DIST;
  const eye = RM.add3(cam.target, RM.scale3(back, dist));
  const fwd = RM.scale3(back, -1);
  const right = RM.normalize3(RM.cross3(fwd, [0, 0, 1]));
  const up = RM.cross3(right, fwd);
  const availW = Math.max(120, w - inset);
  const cx = inset + availW / 2;
  const cy = h / 2;
  const kPx = (cam.zoom * cam.fill * Math.min(availW, h)) / cam.radius;
  const focal = kPx * dist;
  // Light from the viewer's upper left
  const light = RM.normalize3(RM.add3(RM.add3(RM.scale3(up, 0.75), RM.scale3(right, -0.35)), RM.scale3(fwd, -0.6)));
  return {
    eye, fwd, right, up, light, kPx, cx, cy, focal,
    project(p) {
      const d = RM.sub3(p, eye);
      const zc = Math.max(dot(d, fwd), 1e-3);
      const s = focal / zc;
      return [cx + dot(d, right) * s, cy - dot(d, up) * s, zc];
    },
  };
}
const dot = RM.dot3;

/* Colours: CSS hex → rgb arrays (cached per theme) */
let rgbCache = { src: null };
function rgbOf(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || '').trim());
  if (!m) return [128, 128, 128];
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function palette(colors) {
  if (rgbCache.src !== colors) {
    rgbCache = {
      src: colors,
      x: rgbOf(colors.ax), y: rgbOf(colors.ay), z: rgbOf(colors.az),
      body: rgbOf(colors.body), ghost: rgbOf(colors.ghost), ref: rgbOf(colors.ref), fg: rgbOf(colors.fg), bg: rgbOf(colors.bg),
    };
  }
  return rgbCache;
}
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = (c, a = 1) => `rgba(${c.map((v) => Math.round(clamp(v, 0, 255))).join(', ')}, ${a})`;

/* The object: a box with a pointed nose (+x) and a tail fin (+z), body frame, metres */
const OBJECT = (() => {
  const x0 = -0.13;
  const x1 = 0.07;
  const hy = 0.055;
  const hz = 0.035;
  const v = {
    a: [x0, -hy, -hz], b: [x1, -hy, -hz], c: [x1, hy, -hz], d: [x0, hy, -hz],
    e: [x0, -hy, hz], f: [x1, -hy, hz], g: [x1, hy, hz], h: [x0, hy, hz], n: NOSE,
  };
  const quads = [
    { pts: [v.e, v.f, v.g, v.h] },              // top (+z)
    { pts: [v.a, v.d, v.c, v.b] },              // bottom
    { pts: [v.d, v.h, v.g, v.c], tint: 'y' },   // +y side
    { pts: [v.a, v.b, v.f, v.e] },              // −y side
    { pts: [v.a, v.e, v.h, v.d] },              // back
    { pts: [v.b, v.c, v.n], tint: 'x' },        // nose
    { pts: [v.c, v.g, v.n], tint: 'x' },
    { pts: [v.g, v.f, v.n], tint: 'x' },
    { pts: [v.f, v.b, v.n], tint: 'x' },
  ];
  const centroid = [-0.02, 0, 0];
  for (const f of quads) {
    let nrm = RM.normalize3(RM.cross3(RM.sub3(f.pts[1], f.pts[0]), RM.sub3(f.pts[2], f.pts[0])));
    const fc = f.pts.reduce((acc, p) => RM.add3(acc, RM.scale3(p, 1 / f.pts.length)), [0, 0, 0]);
    if (dot(nrm, RM.sub3(fc, centroid)) < 0) nrm = RM.scale3(nrm, -1);
    f.n = nrm;
  }
  // Tail fin: a flat triangle, visible from both sides
  quads.push({ pts: [[x0, 0, hz], [-0.06, 0, hz], [x0 - 0.01, 0, 0.1]], n: [0, 1, 0], tint: 'z', twoSided: true });
  return { faces: quads, verts: Object.values(v).concat([[x0 - 0.01, 0, 0.1]]) };
})();

/** Draw list: everything 3D is pushed here, sorted far to near, then drawn. */
let prims = [];

function pushLine(cam, a, b, style, segments = 1) {
  for (let i = 0; i < segments; i++) {
    const p0 = RM.add3(a, RM.scale3(RM.sub3(b, a), i / segments));
    const p1 = RM.add3(a, RM.scale3(RM.sub3(b, a), (i + 1) / segments));
    const s0 = cam.project(p0);
    const s1 = cam.project(p1);
    prims.push({ kind: 'line', z: (s0[2] + s1[2]) / 2 + (style.bias || 0), s0, s1, style, head: style.head && i === segments - 1 });
  }
}

/** A text label at a 3D point, depth sorted with everything else (so the object can hide it). */
function pushLabel(cam, p, text, color, bold, bg) {
  const s = cam.project(p);
  prims.push({ kind: 'label', z: s[2] - 0.004, x: s[0], y: s[1], text, color, bold, bg });
}

function pushPolyline(cam, pts, style) {
  for (let i = 0; i + 1 < pts.length; i++) pushLine(cam, pts[i], pts[i + 1], style);
}

function pushObject(cam, T, pal, { mode = 'solid', color = null, scale = OBJ_SCALE } = {}) {
  const R = RM.rotPart(T);
  const o = RM.transPart(T);
  const world = (p) => RM.add3(RM.mulVec3(R, RM.scale3(p, scale)), o);
  for (const f of OBJECT.faces) {
    const pts = f.pts.map(world);
    const n = RM.mulVec3(R, f.n);
    const fc = pts.reduce((acc, p) => RM.add3(acc, RM.scale3(p, 1 / pts.length)), [0, 0, 0]);
    const facing = dot(n, RM.sub3(cam.eye, fc));
    if (!f.twoSided && facing <= 0) continue;
    const sp = pts.map((p) => cam.project(p));
    const z = sp.reduce((acc, s) => acc + s[2], 0) / sp.length;
    if (mode === 'solid') {
      const lit = 0.55 + 0.45 * Math.abs(Math.max(f.twoSided ? -1 : 0, dot(n, cam.light)));
      const base = f.tint ? mixRgb(pal.body, pal[f.tint], 0.55) : pal.body;
      prims.push({ kind: 'poly', z, sp, fill: rgba(base.map((v) => v * lit)), stroke: rgba(base.map((v) => v * 0.55), 0.9) });
    } else {
      prims.push({ kind: 'poly', z, sp, fill: rgba(color, 0.13), stroke: rgba(color, 0.95), dash: [5, 4] });
    }
  }
}

/** Shadow of the object on the floor: the convex hull of its vertices dropped straight down. */
function drawShadow(ctx, cam, T, floorZ, colors, scale = OBJ_SCALE) {
  const R = RM.rotPart(T);
  const o = RM.transPart(T);
  const pts = OBJECT.verts.map((p) => {
    const w = RM.add3(RM.mulVec3(R, RM.scale3(p, scale)), o);
    return cam.project([w[0], w[1], floorZ]);
  });
  const hull = convexHull(pts);
  if (hull.length < 3) return;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = colors.fg;
  ctx.beginPath();
  hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function convexHull(points) {
  const p = points.map(([x, y]) => [x, y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && crossZ(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && crossZ(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Axis triad of transform T. kind: 'world' | 'mid' | 'final' | 'ghost'. */
function pushTriad(cam, T, pal, colors, { kind, index = 0, color = null }) {
  const R = RM.rotPart(T);
  const o = RM.transPart(T);
  const spec = kind === 'world' ? TRIAD.world : kind === 'mid' ? TRIAD.mid : TRIAD.final;
  const alpha = kind === 'mid' || kind === 'world' ? spec.alpha : kind === 'ghost' ? 0.85 : 1;
  for (let k = 0; k < 3; k++) {
    const dir = RM.column3(R, k);
    const end = RM.add3(o, RM.scale3(dir, spec.len));
    const base = color || pal[AXES[k]];
    const col = rgba(mixRgb(pal.bg, base, alpha));
    pushLine(cam, o, end, { color: col, width: spec.width, dash: kind === 'ghost' ? [6, 4] : null, head: kind !== 'mid', bias: -0.001 }, 4);
    const text = kind === 'world' ? AXES[k] : kind === 'ghost' ? `${AXES[k]}′` : `${AXES[k]}${sub(index)}`;
    pushLabel(cam, RM.add3(o, RM.scale3(dir, spec.len + 0.045)), text, rgba(mixRgb(pal.bg, base, kind === 'mid' ? 0.8 : 1)), kind !== 'mid', colors.bg);
  }
}

function drawPrims(ctx) {
  prims.sort((a, b) => b.z - a.z);
  ctx.lineJoin = 'round';
  for (const p of prims) {
    if (p.kind === 'label') {
      ctx.font = p.bold ? LABEL_FONT : FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = p.bg;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.kind === 'poly') {
      ctx.beginPath();
      p.sp.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = p.fill;
      ctx.fill();
      ctx.setLineDash(p.dash || []);
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const st = p.style;
      const width = st.widthM ? Math.max(1.5, (st.widthM * (st.focal || 1)) / p.z) : st.width;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = width;
      ctx.lineCap = st.cap || 'round';
      ctx.setLineDash(st.dash || []);
      ctx.beginPath();
      ctx.moveTo(p.s0[0], p.s0[1]);
      if (p.head) {
        const len = Math.hypot(p.s1[0] - p.s0[0], p.s1[1] - p.s0[1]);
        const ux = (p.s1[0] - p.s0[0]) / (len || 1);
        const uy = (p.s1[1] - p.s0[1]) / (len || 1);
        const hs = 6 + width * 1.6;
        ctx.lineTo(p.s1[0] - ux * hs * 0.6, p.s1[1] - uy * hs * 0.6);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = st.color;
        if (len > hs * 0.8) drawArrowHead(ctx, p.s1[0], p.s1[1], ux, uy, hs);
      } else {
        ctx.lineTo(p.s1[0], p.s1[1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }
  ctx.lineCap = 'butt';
}


function drawFloor(ctx, cam, floorZ, extent, colors) {
  ctx.save();
  ctx.strokeStyle = colors.track;
  ctx.lineWidth = 1;
  const stepM = 0.1;
  const n = Math.round(extent / stepM);
  for (let i = -n; i <= n; i++) {
    const c = i * stepM;
    ctx.globalAlpha = (i % 5 === 0 ? 0.6 : 0.35) * (1 - Math.abs(c) / (extent * 1.15));
    for (const [a, b] of [[[c, -extent, floorZ], [c, extent, floorZ]], [[-extent, c, floorZ], [extent, c, floorZ]]]) {
      const s0 = cam.project(a);
      const s1 = cam.project(b);
      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Width of the panel on the canvas, so the scene is centred in the space beside it. */
function hudInset(w) {
  return w >= 760 ? hudEl.offsetWidth + 20 : 0;
}

function draw(ctx, w, h, k, colors) {
  prims = [];
  const pal = palette(colors);
  if (state.view === 'gimbal') drawGimbal(ctx, w, h, colors, pal);
  else drawChain(ctx, w, h, colors, pal);
  drawTag(ctx, '3D VIEW, NOT TO SCALE', w - 10, 22, { align: 'right', color: colors.warn, background: colors.warnBg });
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Drag to orbit · scroll to zoom', w - 12, h - 10);
}

function drawChain(ctx, w, h, colors, pal) {
  const camState = state.cams.chain;
  const cam = makeCamera(camState, w, h, hudInset(w));
  const progress = displayProgress();
  const playing = state.anim.u !== null;
  const { frames } = playing ? RM.composeChain(state.steps, state.convention, progress) : cache.full;
  const last = frames.at(-1);

  const objScale = RM.hasTranslation(state.steps) ? 0.65 : 1;
  drawFloor(ctx, cam, camState.floorZ, 1, colors);
  drawShadow(ctx, cam, last, camState.floorZ, colors, objScale);

  // World frame, with faint negative half-axes
  const I = RM.identity4();
  pushTriad(cam, I, pal, colors, { kind: 'world' });
  for (let a = 0; a < 3; a++) {
    const dir = RM.UNIT[AXES[a]];
    pushLine(cam, [0, 0, 0], RM.scale3(dir, -TRIAD.world.len), { color: rgba(mixRgb(pal.bg, pal[AXES[a]], 0.35)), width: 1.2, dash: [3, 4] }, 2);
  }

  // Translations are drawn as links (the arm). About the fixed axes a rotation also swings
  // a displaced origin round the world axis: that path is drawn as a dashed arc.
  const origins = frames.map((T) => RM.transPart(T));
  for (let i = 1; i < origins.length; i++) {
    const s = state.steps[i - 1];
    if (RM.norm3(RM.sub3(origins[i], origins[i - 1])) < 1e-6) continue;
    if (s.type === 't') {
      pushLine(cam, origins[i - 1], origins[i], { color: rgba(mixRgb(pal.bg, pal.fg, 0.28)), widthM: 0.022, focal: cam.focal, cap: 'round' }, 6);
    } else {
      const ang = toRad(s.deg) * clamp(progress - (i - 1), 0, 1);
      const n = Math.max(2, Math.ceil(Math.abs(toDeg(ang)) / 5));
      const pts = [];
      for (let j = 0; j <= n; j++) pts.push(RM.mulVec3(RM.rotAxis(RM.UNIT[AXIS_OF[s.type]], (ang * j) / n), origins[i - 1]));
      pushPolyline(cam, pts, { color: rgba(mixRgb(pal.bg, pal.fg, 0.5)), width: 1.5, dash: [4, 4] });
    }
  }
  const lastO = RM.transPart(last);
  if (Math.hypot(lastO[0], lastO[1]) > 0.01 || Math.abs(lastO[2]) > 0.01) {
    pushLine(cam, lastO, [lastO[0], lastO[1], camState.floorZ], { color: rgba(pal.fg, 0.35), width: 1, dash: [3, 4] });
  }

  // Intermediate frames (faded) and the final frame (bold) with the object
  frames.slice(1, -1).forEach((T, i) => pushTriad(cam, T, pal, colors, { kind: 'mid', index: i + 1 }));
  if (frames.length > 1) pushTriad(cam, last, pal, colors, { kind: 'final', index: frames.length - 1 });
  pushObject(cam, last, pal, { scale: objScale });

  // Ghost: the same steps in reverse order (= this order under the other convention)
  if (state.ghost && state.steps.length > 1) {
    pushTriad(cam, cache.rev.T, pal, colors, { kind: 'ghost', color: pal.ghost });
    pushObject(cam, cache.rev.T, pal, { mode: 'ghost', color: pal.ghost, scale: objScale });
  }
  // A valid typed matrix, at the world origin
  const typedOn = state.typed.show && state.typed.result?.valid;
  if (typedOn) {
    const Tt = RM.homog(state.typed.M);
    pushTriad(cam, Tt, pal, colors, { kind: 'ghost', color: pal.ref });
    pushObject(cam, Tt, pal, { mode: 'ghost', color: pal.ref });
  }

  // While playing: the axis of the current step and the angle swept so far
  let caption = '';
  if (playing && state.steps.length) {
    const i = Math.min(Math.floor(progress), state.steps.length - 1);
    const s = state.steps[i];
    const f = clamp(progress - i, 0, 1);
    const before = frames[i];
    const where = state.convention === 'intrinsic' ? 'moving' : 'fixed world';
    if (s.type === 't') {
      caption = `Step ${i + 1} of ${state.steps.length}: ${stepText(s)} along the ${where} axes`;
    } else {
      const ax = AXIS_OF[s.type];
      const k = AXES.indexOf(ax);
      const Rb = state.convention === 'intrinsic' ? RM.rotPart(before) : RM.identity3();
      const o = state.convention === 'intrinsic' ? RM.transPart(before) : [0, 0, 0];
      const dir = RM.column3(Rb, k);
      const ref = RM.column3(Rb, NEXT_AXIS[ax]);
      pushLine(cam, RM.add3(o, RM.scale3(dir, -0.5)), RM.add3(o, RM.scale3(dir, 0.5)),
        { color: rgba(pal[ax], 0.9), width: 1.5, dash: [8, 5], bias: 0.002 }, 6);
      const ang = toRad(s.deg) * f;
      if (Math.abs(ang) > 1e-3) {
        const pts = [];
        const nArc = Math.max(2, Math.ceil(Math.abs(toDeg(ang)) / 4));
        for (let j = 0; j <= nArc; j++) pts.push(RM.add3(o, RM.scale3(RM.mulVec3(RM.rotAxis(dir, (ang * j) / nArc), ref), 0.2)));
        pushPolyline(cam, pts.slice(0, -1), { color: rgba(pal[ax], 1), width: 2.2 });
        pushLine(cam, pts.at(-2), pts.at(-1), { color: rgba(pal[ax], 1), width: 2.2, head: true });
      }
      caption = `Step ${i + 1} of ${state.steps.length}: ${stepText(s)} about the ${where} ${ax} axis`;
    }
  }

  drawPrims(ctx);

  // Legend (static, bottom left) and the step caption (static, bottom centre)
  const legend = [];
  if (state.ghost && state.steps.length > 1) legend.push({ color: colors.ghost, text: 'Ghost: the same steps in reverse order' });
  if (typedOn) legend.push({ color: colors.ref, text: 'Your typed matrix' });
  ctx.font = FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  legend.forEach((l, i) => {
    const y = h - 16 - (legend.length - 1 - i) * 20;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(12, y);
    ctx.lineTo(36, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colors.fg;
    ctx.fillText(l.text, 42, y);
  });
  if (caption) drawTag(ctx, caption, cam.cx, h - 44, { align: 'center', color: colors.fg, background: colors.bg, border: colors.track, height: 26 });
  if (!state.steps.length) {
    drawTag(ctx, 'Empty chain: R = I. Add a step with the + buttons.', cam.cx, h - 44, { align: 'center', color: colors.fg, background: colors.bg, border: colors.track, height: 26 });
  }
}

/* ---------- Gimbal ---------- */

/** The interpolation demo: total turning along the Euler-angle path and the slerp path. */
const interpStats = {
  euler: toDeg(RM.eulerPathTurning(INTERP_A.map(toRad), INTERP_B.map(toRad))),
  slerp: toDeg(RM.rotationAngleBetween(RM.eulerZYXToMatrix(...INTERP_A.map(toRad)), RM.eulerZYXToMatrix(...INTERP_B.map(toRad)))),
};
const QA = RM.quatFromEulerZYX(...INTERP_A.map(toRad));
const QB = RM.quatFromEulerZYX(...INTERP_B.map(toRad));
const slerpMatrix = (f) => RM.matrixFromQuat(RM.quatSlerp(QA, QB, f));
const eulerMatrix = (f) => RM.eulerZYXToMatrix(...INTERP_A.map((a, k) => toRad(a + f * (INTERP_B[k] - a))));

function drawGimbal(ctx, w, h, colors, pal) {
  const camState = state.cams.gimbal;
  const cam = makeCamera(camState, w, h, hudInset(w));
  const { yaw, pitch, roll } = state.gimbal;
  const Ryaw = RM.rotZ(toRad(yaw));
  const Rpitch = RM.mul3(Ryaw, RM.rotY(toRad(pitch)));
  const R = RM.mul3(Rpitch, RM.rotX(toRad(roll)));
  const { r0, r1, r2, axle, floor } = GIMBAL;
  const absP = Math.abs(pitch);
  const locked = Math.abs(absP - 90) < 0.05;

  drawFloor(ctx, cam, floor, 0.8, colors);
  drawShadow(ctx, cam, RM.homog(R), floor, colors, GIMBAL.objScale);

  // Stand: base plate and post up to the yaw bearing
  const plate = [[-0.16, -0.16], [0.16, -0.16], [0.16, 0.16], [-0.16, 0.16]].map(([x, y]) => cam.project([x, y, floor]));
  prims.push({ kind: 'poly', z: Infinity, sp: plate, fill: rgba(pal.fg, 0.1), stroke: rgba(pal.fg, 0.35) });
  const metal = { color: rgba(mixRgb(pal.bg, pal.fg, 0.5)), widthM: 0.014, focal: cam.focal };
  pushLine(cam, [0, 0, floor], [0, 0, -r0 - axle], metal, 4);
  pushLine(cam, [0, 0, -r0 - axle], [0, 0, -r0], metal);
  pushLine(cam, [0, 0, r0], [0, 0, r0 + axle], metal);
  // Bearings between the rings
  for (const s of [1, -1]) {
    pushLine(cam, RM.mulVec3(Ryaw, [0, s * r1, 0]), RM.mulVec3(Ryaw, [0, s * r0, 0]), metal);
    pushLine(cam, RM.mulVec3(Rpitch, [s * r2, 0, 0]), RM.mulVec3(Rpitch, [s * r1, 0, 0]), metal);
  }

  // Rings: outer (yaw) in the yawed y-z plane, middle (pitch) in the pitched x-y plane,
  // inner (roll) in the object's x-z plane. Each is coloured like the axis it turns about.
  const ring = (M, radius, plane, color) => {
    const pts = [];
    for (let i = 0; i <= GIMBAL.segments; i++) {
      const s = (i / GIMBAL.segments) * 2 * Math.PI;
      const local = plane === 'yz' ? [0, Math.cos(s), Math.sin(s)] : plane === 'xy' ? [Math.cos(s), Math.sin(s), 0] : [Math.cos(s), 0, Math.sin(s)];
      pts.push(RM.mulVec3(M, RM.scale3(local, radius)));
    }
    pushPolyline(cam, pts, { color: rgba(color), widthM: GIMBAL.ringM, focal: cam.focal, cap: 'round' });
  };
  ring(Ryaw, r0, 'yz', pal.z);
  ring(Rpitch, r1, 'xy', pal.y);
  ring(R, r2, 'xz', pal.x);

  pushObject(cam, RM.homog(R), pal, { scale: GIMBAL.objScale });

  // The three gimbal axes, dashed, labelled at their positive ends
  const axes = RM.gimbalAxes(toRad(yaw), toRad(pitch));
  const L = 0.66;
  const warn = rgbOf(colors.warn);
  if (absP >= 70) {
    const a = clamp((absP - 70) / 20, 0, 1);
    for (const dir of [axes.yaw, axes.roll]) {
      pushLine(cam, RM.scale3(dir, -L), RM.scale3(dir, L), { color: rgba(mixRgb(pal.bg, warn, 0.2 + 0.25 * a)), width: 8, bias: 0.004 }, 8);
    }
  }
  const axisLine = (dir, color, text) => {
    pushLine(cam, RM.scale3(dir, -L), RM.scale3(dir, L), { color: rgba(color, 0.95), width: 1.8, dash: [7, 5], head: true, bias: -0.002 }, 8);
    pushLabel(cam, RM.scale3(dir, L + 0.06), text, rgba(color), true, colors.bg);
  };
  axisLine(axes.yaw, pal.z, 'yaw ψ');
  axisLine(axes.pitch, pal.y, 'pitch θ');
  axisLine(axes.roll, pal.x, 'roll φ');

  // Interpolation demo: slerp ghost and the path of the z′ axis tip for both
  if (state.interp.shown) {
    const f = ease(state.interp.t);
    pushObject(cam, RM.homog(slerpMatrix(f)), pal, { mode: 'ghost', color: pal.ghost, scale: GIMBAL.objScale });
    const trail = (fn, color, dash) => {
      const pts = [];
      const n = Math.max(2, Math.ceil(f * 120));
      for (let i = 0; i <= n; i++) pts.push(RM.mulVec3(fn((f * i) / n), FIN_TIP));
      pushPolyline(cam, pts, { color, width: 2.4, dash, bias: -0.003 });
    };
    trail(eulerMatrix, rgba(pal.ref), null);
    trail(slerpMatrix, rgba(pal.ghost), [6, 4]);
  }

  drawPrims(ctx);

  // Status (static, bottom centre)
  const status = locked
    ? 'GIMBAL LOCK: yaw and roll axes aligned, one degree of freedom lost'
    : absP >= 60 ? `Yaw and roll axes only ${trim(90 - absP)}° apart` : 'Three independent axes';
  drawTag(ctx, status, 12, h - 22, absP >= 60
    ? { color: colors.warn, background: colors.warnBg, height: 26 }
    : { color: colors.ok, background: colors.okBg, height: 26 });

  if (state.interp.shown) {
    const items = [
      { color: colors.ref, dash: [], text: `z′ tip, Euler angles in a straight line: ${num(interpStats.euler, 0)}° of turning` },
      { color: colors.ghost, dash: [6, 4], text: `z′ tip, quaternion slerp (the ghost): ${num(interpStats.slerp, 0)}°` },
    ];
    ctx.font = FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    items.forEach((it, i) => {
      const y = h - 82 + i * 20;
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2.4;
      ctx.setLineDash(it.dash);
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.lineTo(36, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = colors.fg;
      ctx.fillText(it.text, 42, y);
    });
  }
}

/* =========================================================================
 * 6. Wiring + start
 * ====================================================================== */

/** Default camera for the view, fitted to the chain; az (degrees) overrides the azimuth. */
function resetView(az) {
  const view = state.view;
  const cam = structuredClone(DEFAULT_CAMS[view]);
  if (Number.isFinite(az)) cam.az = toRad(az);
  if (view === 'chain' && cache) {
    // Fit the frame origins (and the ghost's) so arms and translations stay in view
    const pts = [[0, 0, 0], ...cache.full.frames.map(RM.transPart), ...(state.ghost ? cache.rev.frames.map(RM.transPart) : [])];
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    cam.target = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    cam.radius = Math.max(DEFAULT_CAMS.chain.radius, RM.norm3(RM.sub3(hi, lo)) / 2 + 0.4); // + room for the triads
    cam.floorZ = Math.min(DEFAULT_CAMS.chain.floorZ, lo[2] - 0.25);
  }
  state.cams[view] = cam;
  sim.requestDraw();
}

function orbit(dAz, dEl) {
  const cam = state.cams[state.view];
  cam.az += dAz;
  cam.el = clamp(cam.el + dEl, toRad(-85), toRad(85));
  sim.requestDraw();
}
function zoomBy(factor) {
  const cam = state.cams[state.view];
  cam.zoom = clamp(cam.zoom * factor, 0.35, 6);
  sim.requestDraw();
}

const sim = createSim({
  step,
  draw,
  describe,
  animate,
  startPaused: true,
  calibration: false, // a 3D teaching view: nothing is drawn at 1:1
  colorVars: { ax: '--rot-x', ay: '--rot-y', az: '--rot-z', body: '--rot-body', ghost: '--rot-ghost' },
  beforePlay: () => {
    if (state.view === 'gimbal') {
      if (!state.interp.active) startInterp();
    } else if (state.anim.u === null) {
      state.anim.u = 0;
    }
  },
  playLabel: () => {
    if (state.view === 'gimbal') return state.interp.active ? 'Resume' : state.interp.shown ? 'Replay interpolation' : 'Play interpolation';
    return state.anim.u === null ? 'Play steps' : 'Resume';
  },
  debug: {
    state,
    model: RM,
    get cache() { return cache; },
    setChain,
    addStep,
    moveStepTo,
    setGimbalAll,
    nudge,
    resetView,
    interpStats,
  },
});

// Gimbal sliders
const gimbalParams = ['yaw', 'pitch', 'roll'].map((key) => bindParam({
  range: $(`${key}-range`), num: $(`${key}-num`),
  min: key === 'pitch' ? LIMITS.pitchMin : LIMITS.degMin, max: key === 'pitch' ? LIMITS.pitchMax : LIMITS.degMax,
  step: 1, decimals: 1, words: 'degrees',
  get: () => state.gimbal[key], set: (v) => setGimbal(key, v),
}));

// Chain controls
for (const b of document.querySelectorAll('[data-add]')) b.addEventListener('click', () => addStep(b.dataset.add));
$('clear-btn').addEventListener('click', () => {
  state.steps = [];
  state.anim.u = null;
  chainChanged({ structure: true });
  announce('Chain cleared: R is the identity.');
  document.querySelector('[data-add="rx"]').focus();
});
for (const r of document.querySelectorAll('input[name="conv"]')) r.addEventListener('change', () => setConvention(r.value));
for (const r of document.querySelectorAll('input[name="matsize"]')) r.addEventListener('change', () => setMatSize(Number(r.value)));
$('ghost-check').addEventListener('change', (e) => setGhost(e.target.checked));
$('reset-view-btn').addEventListener('click', () => resetView());
document.addEventListener('pointermove', moveReorder);
document.addEventListener('pointerup', endReorder);
document.addEventListener('pointercancel', endReorder);

// Gimbal controls
for (const b of document.querySelectorAll('[data-nudge]')) b.addEventListener('click', () => nudge(b.dataset.nudge, Number(b.dataset.by)));

// Typed matrix
buildTypedGrid();
$('typed-load').addEventListener('click', () => setTyped(cache.R.map((r) => r.map((v) => Number(v.toFixed(4)))), { show: true }));
for (const b of document.querySelectorAll('[data-typed]')) b.addEventListener('click', () => setTyped(TYPED_EXAMPLES[b.dataset.typed], { show: true }));
$('typed-show').addEventListener('change', (e) => {
  state.typed.show = e.target.checked;
  sim.requestDraw();
});
$('typed-chain').addEventListener('click', typedToChain);

// Presets
const r90 = { rx: { type: 'rx', deg: 90 }, ry: { type: 'ry', deg: 90 }, rz: { type: 'rz', deg: 90 } };
initPresets({
  xy: () => setChain([r90.rx, r90.ry], { ghost: true, matSize: 3 }),
  yx: () => setChain([r90.ry, r90.rx], { ghost: true, matSize: 3 }),
  xyz: () => setChain([r90.rx, r90.ry, r90.rz], { ghost: true, matSize: 3 }),
  tr: () => setChain([{ type: 't', p: [0.4, 0, 0] }, r90.rz], { convention: 'intrinsic', ghost: true, matSize: 4 }),
  rt: () => setChain([r90.rz, { type: 't', p: [0.4, 0, 0] }], { convention: 'intrinsic', ghost: true, matSize: 4 }),
  arm: () => setChain([{ type: 'rz', deg: 30 }, { type: 'ry', deg: -40 }, { type: 't', p: [0.45, 0, 0] }, { type: 'ry', deg: 70 }, { type: 't', p: [0.35, 0, 0] }],
    { convention: 'intrinsic', ghost: false, matSize: 4, camAz: -50 }), // side-on to the arm
  level: () => setGimbalAll([0, 0, 0]),
  p45: () => setGimbalAll([30, 45, 0]),
  p80: () => setGimbalAll([30, 80, 0]),
  lock: () => setGimbalAll([30, 90, 0]),
  lockdown: () => setGimbalAll([30, -90, 0]),
});

// Camera: drag to orbit, wheel or pinch to zoom, arrow keys and +/− when the canvas has focus
const pointers = new Map();
let pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic pointer */
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 0) zoomBy(d / pinch);
    pinch = d;
    return;
  }
  orbit(-(e.clientX - prev.x) * 0.008, (e.clientY - prev.y) * 0.008);
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
  zoomBy(Math.exp(-clamp(e.deltaY * unit, -300, 300) * 0.0015));
}, { passive: false });
canvas.addEventListener('dblclick', () => resetView());
canvas.addEventListener('keydown', (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const s = toRad(e.shiftKey ? 30 : 10);
  const keys = {
    ArrowLeft: () => orbit(s, 0), ArrowRight: () => orbit(-s, 0), ArrowUp: () => orbit(0, s), ArrowDown: () => orbit(0, -s),
    '+': () => zoomBy(1.2), '=': () => zoomBy(1.2), '-': () => zoomBy(1 / 1.2), _: () => zoomBy(1 / 1.2), Home: () => resetView(), 0: () => resetView(),
  };
  const fn = keys[e.key];
  if (fn) {
    e.preventDefault();
    fn();
  }
});


/** Explainer figures computed from the model (no hand-typed results). */
function fillExplainer() {
  const set = (k, text) => {
    for (const el of document.querySelectorAll(`[data-calc="${k}"]`)) el.textContent = text;
  };
  const angles = (a) => `(ψ, θ, φ) = (${a.map((v) => `${num(v, 0)}°`).join(', ')})`;
  set('interpA', angles(INTERP_A));
  set('interpB', angles(INTERP_B));
  set('interpEuler', `${num(interpStats.euler, 0)}°`);
  set('interpSlerp', `${num(interpStats.slerp, 0)}°`);
  const r = toRad(90);
  set('xyGap', `${num(toDeg(RM.rotationAngleBetween(RM.mul3(RM.rotX(r), RM.rotY(r)), RM.mul3(RM.rotY(r), RM.rotX(r)))), 0)}°`);
}

// Start: "Rx 90° then Ry 90°" with its reverse as a ghost
state.steps = [makeStep('rx', 90), makeStep('ry', 90)];
recompute();
renderSteps();
setGhost(state.ghost, { quiet: true });
setTyped([[0.866, -0.5, 0], [0.5, 0.866, 0], [0, 0, 1]], { show: false });
fillExplainer();
initTabs({
  name: 'view',
  values: ['chain', 'gimbal'],
  onChange: (view) => {
    if (state.view !== view && !sim.paused) sim.setPaused(true);
    state.view = view;
    updateHud();
    sim.refreshPlayButton();
    sim.updateAria();
    sim.requestDraw();
  },
});
chainChanged();
gimbalChanged({ quiet: true });
sim.start();
updateHud();
