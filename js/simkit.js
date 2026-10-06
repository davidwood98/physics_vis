/**
 * simkit.js: the shared runtime every simulator page is built on.
 *
 * A page provides its own state, step() and draw(); createSim() supplies:
 *   - the requestAnimationFrame loop (dt clamped to 0.1 s, stops when hidden)
 *   - play/pause button + Space key, time-scale radios + badge
 *   - screen scale (calibrated or approximate) + badge + calibration dialog
 *   - canvas sizing (DPR aware) and theme colours from CSS variables
 *   - the canvas aria-label (from describe())
 *   - the shared "Pixel size" card, if the page has a #pixel-card section
 *   - a Full screen button: the whole sim card (toolbar, canvas, controls) goes
 *     full screen and the canvas grows to fill the free space
 *
 * Expected element ids (all optional except the canvas):
 *   #sim-canvas, #play-btn, #time-badge, #scale-badge, #calibrate-btn, #sim-hint
 *   and radios named "timescale".
 *
 * Usage:
 *   const sim = createSim({ step, draw, describe, onResize, onScaleChange });
 *   ...wire page controls...
 *   sim.start();
 */

import { clamp, clampFrameDelta, logFractionToValue, valueToLogFraction } from './physics.js';
import {
  getScale,
  scaleBadge,
  setupCanvas,
  readCssVars,
  onColorSchemeChange,
  prefersReducedMotion,
  fmt,
  initPage,
  initPixelCard,
  CALIBRATION_EVENT,
} from './common.js';
import { initCalibration } from './calibration.js';
import { FONT } from './draw.js';

/** Theme colours the canvas uses, read from CSS custom properties. */
export const COLOR_VARS = {
  fg: '--canvas-fg',
  muted: '--canvas-muted',
  track: '--canvas-track',
  bg: '--canvas-bg',
  accent: '--accent',
  accentRgb: '--accent-rgb',
  ref: '--canvas-ref',
  refFill: '--canvas-ref-fill',
  warn: '--canvas-warn',
  warnBg: '--canvas-warn-bg',
  ok: '--canvas-ok',
  okBg: '--canvas-ok-bg',
};

/** Write text only when it changed (cheap to call every frame). */
export function setText(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

export function timeScaleLabel(ts, trueScale = true) {
  if (ts !== 1) return `SLOW MOTION ${ts}×`;
  return trueScale ? 'REAL TIME 1:1' : 'REAL TIME';
}

/**
 * @param {object} opts
 * @param {(simDt: number, realDt: number) => void} opts.step  advance by simDt seconds of sim time
 * @param {(ctx, w, h, k, colors) => void} opts.draw           k = CSS px per metre
 * @param {() => string} [opts.describe]                       canvas aria-label
 * @param {(view) => void} [opts.onResize]
 * @param {(scale) => void} [opts.onScaleChange]
 * @param {boolean} [opts.startPaused]                         wait for Play (run-based sims)
 * @param {boolean} [opts.calibration=true]                    false for scaled (non-1:1) tools:
 *                                                             no calibration dialog or scale badge
 * @param {() => void} [opts.beforePlay]                       e.g. restart a finished run
 * @param {() => string} [opts.playLabel]                      label for the play button when paused
 * @param {object} [opts.debug]                                extra fields for window.__sim (?debug=1)
 * @param {(realDt: number) => boolean} [opts.animate]         called every frame, paused or not (camera
 *                                                             animations); return true to redraw
 * @param {HTMLElement} [opts.colorsFrom]                      element to read the theme colours from
 * @param {(info, ladder) => string} [opts.pixelLine]          extra sentence for the Pixel size card
 */
export function createSim(opts) {
  const $ = (id) => document.getElementById(id);
  const dom = {
    canvas: $('sim-canvas'),
    play: $('play-btn'),
    timeBadge: $('time-badge'),
    scaleBadge: $('scale-badge'),
    calibrate: $('calibrate-btn'),
    hint: $('sim-hint'),
  };

  const useCalibration = opts.calibration !== false;
  let dirty = true;
  let rafId = 0;
  let lastFrameTime = null;
  const recentDts = []; // for estimating the screen refresh rate

  const sim = {
    paused: Boolean(opts.startPaused) || prefersReducedMotion(),
    timeScale: 1,
    scale: getScale(), // { cssPxPerMetre, calibrated }
    colors: {},
    view: null,        // { ctx, width, height, dpr }
    realFrameDt: 0,    // real seconds covered by the current frame

    get width() { return sim.view ? sim.view.width : 0; },
    get height() { return sim.view ? sim.view.height : 0; },
    get k() { return sim.scale.cssPxPerMetre; },

    /** Median frame rate seen recently (Hz); 60 until measured. */
    get refreshHz() {
      if (recentDts.length < 10) return 60;
      const sorted = [...recentDts].sort((a, b) => a - b);
      return 1 / sorted[Math.floor(sorted.length / 2)];
    },

    requestDraw() { dirty = true; },

    setPaused(paused) {
      if (!paused && sim.paused) opts.beforePlay?.();
      sim.paused = paused;
      updatePlayUI();
      sim.updateAria();
      dirty = true;
    },

    setTimeScale(ts) {
      sim.timeScale = ts;
      const radio = document.querySelector(`input[name="timescale"][value="${ts}"]`);
      if (radio) radio.checked = true;
      updatePlayUI();
      sim.updateAria();
    },

    /** Refresh the play button label (e.g. after a run finishes). */
    refreshPlayButton() { updatePlayUI(); },

    updateAria() {
      if (opts.describe && dom.canvas) dom.canvas.setAttribute('aria-label', opts.describe());
    },

    start,
  };

  function updatePlayUI() {
    if (dom.play) {
      dom.play.textContent = sim.paused ? (opts.playLabel?.() ?? 'Play') : 'Pause';
      dom.play.classList.toggle('is-paused', sim.paused);
    }
    setText(dom.timeBadge, (sim.paused ? 'PAUSED · ' : '') + timeScaleLabel(sim.timeScale, useCalibration));
    dom.timeBadge?.classList.toggle('is-slow', sim.timeScale !== 1);
  }

  function updateScaleBadge() {
    const b = dom.scaleBadge;
    if (!b) return;
    const { text, ok } = scaleBadge(sim.scale);
    setText(b, text);
    b.classList.toggle('badge--ok', ok);
    b.classList.toggle('badge--warn', !ok);
  }

  /** Re-read the scale (calibration saved, browser zoom, monitor change). */
  function refreshScale() {
    const next = getScale();
    if (next.cssPxPerMetre === sim.scale.cssPxPerMetre && next.source === sim.scale.source && next.detail === sim.scale.detail) return;
    sim.scale = next;
    updateScaleBadge();
    opts.onScaleChange?.(sim.scale);
    sim.updateAria();
    dirty = true;
  }

  function drawNow() {
    if (!sim.view) return;
    const { ctx, width: w, height: h } = sim.view;
    ctx.clearRect(0, 0, w, h); // background comes from the canvas's CSS
    if (w === 0 || h === 0) return;
    ctx.font = FONT;
    ctx.lineCap = 'butt';
    opts.draw(ctx, w, h, sim.scale.cssPxPerMetre, sim.colors);
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    // Real seconds since the last frame, clamped so a stall can't teleport anything.
    const dt = lastFrameTime === null ? 0 : clampFrameDelta((now - lastFrameTime) / 1000);
    lastFrameTime = now;
    if (dt > 0) {
      recentDts.push(dt);
      if (recentDts.length > 60) recentDts.shift();
    }
    sim.realFrameDt = sim.paused ? 0 : dt;
    if (!sim.paused && dt > 0) {
      opts.step(dt * sim.timeScale, dt);
      dirty = true;
    }
    if (opts.animate?.(dt)) dirty = true;
    if (dirty) {
      dirty = false;
      drawNow();
    }
  }

  function startLoop() {
    if (rafId) return;
    lastFrameTime = null;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function isTypingTarget(el) {
    return el?.closest?.('dialog') || el?.matches?.('button, a, select, textarea, summary, input:not([type="range"])');
  }

  function start() {
    initPage();
    const colorVars = { ...COLOR_VARS, ...opts.colorVars };
    sim.colors = readCssVars(colorVars, opts.colorsFrom);
    onColorSchemeChange(() => {
      sim.colors = readCssVars(colorVars, opts.colorsFrom);
      opts.onColorsChange?.(sim.colors);
      dirty = true;
    });

    const checked = document.querySelector('input[name="timescale"]:checked');
    if (checked) sim.timeScale = Number(checked.value);
    for (const radio of document.querySelectorAll('input[name="timescale"]')) {
      radio.addEventListener('change', () => sim.setTimeScale(Number(radio.value)));
    }

    dom.play?.addEventListener('click', () => sim.setPaused(!sim.paused));
    // Space toggles pause, except where Space already means something (buttons, fields).
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      sim.setPaused(!sim.paused);
    });

    if (useCalibration) {
      window.addEventListener('resize', refreshScale); // browser zoom changes devicePixelRatio
      window.addEventListener(CALIBRATION_EVENT, refreshScale);
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? stopLoop() : startLoop()));

    setupCanvas(dom.canvas, (view) => {
      sim.view = view;
      opts.onResize?.(view);
      sim.updateAria();
      drawNow(); // resizing clears the canvas: redraw now to avoid a blank frame
    });

    if (useCalibration) {
      const card = $('pixel-card');
      // The pixel-size comparison only appears on pages that have the Pixel size card.
      const calibration = initCalibration({ pixelSummary: Boolean(card) });
      sim.openCalibration = calibration.open;
      dom.calibrate?.addEventListener('click', calibration.open);
      if (card) sim.pixelCard = initPixelCard(card, { onCalibrate: calibration.open, extraLine: opts.pixelLine });
    }
    initFullscreen(opts.onFullscreenChange);

    updateScaleBadge();
    updatePlayUI();
    if (prefersReducedMotion() && dom.hint) {
      dom.hint.innerHTML =
        'Paused because your device asks for reduced motion. Press <strong>Play</strong> (or <kbd>Space</kbd>) to start.';
    }
    sim.updateAria();
    startLoop();

    // Console hook for checks: add ?debug=1 to the URL, then use window.__sim.
    if (new URLSearchParams(location.search).has('debug')) {
      window.__sim = Object.assign({ sim }, opts.debug);
    }
  }

  return sim;
}

/**
 * Full screen for the sim card: uses #fullscreen-btn if the page has one,
 * otherwise adds a "Full screen" button to the card's toolbar. Esc exits.
 */
function initFullscreen(onChange) {
  const card = document.querySelector('.sim-card');
  if (!card || !document.fullscreenEnabled) {
    document.getElementById('fullscreen-btn')?.setAttribute('hidden', '');
    return;
  }
  let btn = document.getElementById('fullscreen-btn');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-small';
    btn.id = 'fullscreen-btn';
    btn.textContent = 'Full screen';
    btn.setAttribute('aria-pressed', 'false');
    let host = card.querySelector('.scale-status');
    if (!host) {
      host = document.createElement('div');
      host.className = 'scale-status';
      card.querySelector('.sim-toolbar')?.append(host);
    }
    host.append(btn);
  }
  const hint = document.createElement('p');
  hint.className = 'fs-hint';
  hint.hidden = true;
  hint.innerHTML = 'Full screen: press <kbd>Esc</kbd> to exit.';
  card.querySelector('.canvas-wrap')?.append(hint);
  let timer = 0;
  btn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else card.requestFullscreen?.().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === card;
    btn.textContent = on ? 'Exit full screen' : 'Full screen';
    btn.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('is-fullscreen', on);
    hint.hidden = !on;
    clearTimeout(timer);
    if (on) timer = setTimeout(() => (hint.hidden = true), 3500);
    onChange?.(on);
  });
}

/**
 * Bind a range slider + number input pair to one value.
 *   get(): current value; set(v): apply a new value (clamp/couple there).
 *   log: true makes the slider logarithmic (handy for 0.5–100 Hz etc.).
 * min/max may be numbers or functions (for ranges that depend on other values).
 * Returns { sync } to push the current value back into both inputs.
 */
export function bindParam({ range, num, min, max, step, get, set, decimals = 2, scale = 1, words = '', log = false }) {
  // scale: display multiplier, e.g. 1000 to show metres as millimetres in the inputs
  const lo = () => (typeof min === 'function' ? min() : min);
  const hi = () => (typeof max === 'function' ? max() : max);

  if (log) Object.assign(range, { min: 0, max: 1000, step: 1 });
  else Object.assign(range, { step: step * scale });
  num.step = log ? 'any' : String(step * scale);

  const toSlider = (v) => (log ? 1000 * valueToLogFraction(v, lo(), hi()) : v * scale);
  const fromSlider = (s) => (log ? logFractionToValue(s / 1000, lo(), hi()) : s / scale);

  range.addEventListener('input', () => set(fromSlider(Number(range.value))));
  num.addEventListener('change', () => {
    const v = Number(num.value) / scale;
    if (num.value.trim() === '' || !Number.isFinite(v)) sync(); // revert bad input
    else set(clamp(v, lo(), hi()));
  });

  function sync() {
    const v = get();
    if (!log) Object.assign(range, { min: lo() * scale, max: hi() * scale });
    num.min = String(lo() * scale);
    num.max = String(hi() * scale);
    range.value = String(toSlider(v));
    num.value = (v * scale).toFixed(decimals);
    range.setAttribute('aria-valuetext', `${fmt(v * scale, decimals)} ${words}`.trim());
  }

  return { sync };
}

/**
 * Segmented tabs built from radios named `name`, synced to the URL hash.
 * Sets body[data-view] and shows only matching [data-view-only="..."] content.
 * tallViews: views that use the full screen height (controls above the canvas,
 * body.layout-tall); switching into or out of one scrolls the sim card to the top.
 */
export function initTabs({ name, values, onChange, tallViews = [] }) {
  let current = values[0];

  function set(value, { updateHash = true, fromUser = false } = {}) {
    current = values.includes(value) ? value : values[0];
    document.body.dataset.view = current;
    const wasTall = document.body.classList.contains('layout-tall');
    const tall = tallViews.includes(current);
    document.body.classList.toggle('layout-tall', tall);
    if (fromUser && tall !== wasTall) document.querySelector('.sim-card')?.scrollIntoView({ block: 'start' });
    // Show only the content for this view: data-view-only="track" (space-separated list allowed)
    for (const el of document.querySelectorAll('[data-view-only]')) {
      el.hidden = !el.dataset.viewOnly.split(' ').includes(current);
    }
    const radio = document.querySelector(`input[name="${name}"][value="${current}"]`);
    if (radio) radio.checked = true;
    if (updateHash && location.hash !== `#${current}`) {
      try {
        history.replaceState(null, '', `#${current}`); // linkable, without spamming history
      } catch {
        /* sandboxed/srcdoc contexts can refuse this; the view still switches */
      }
    }
    onChange?.(current);
  }

  for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
    radio.addEventListener('change', () => set(radio.value, { fromUser: true }));
  }
  window.addEventListener('hashchange', () => set(location.hash.slice(1), { updateHash: false }));
  set(location.hash.slice(1), { updateHash: false });

  return { get: () => current, set };
}

/** Wire preset buttons: <button data-preset="name"> → presets[name](). */
export function initPresets(presets) {
  for (const btn of document.querySelectorAll('[data-preset]')) {
    btn.addEventListener('click', () => presets[btn.dataset.preset]?.());
  }
}

/** Debounced polite announcement for screen readers (e.g. after slider changes). */
export function createAnnouncer(node, delay = 500) {
  let timer = 0;
  return (text) => {
    clearTimeout(timer);
    timer = setTimeout(() => setText(node, text), delay);
  };
}
