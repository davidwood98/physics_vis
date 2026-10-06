/**
 * calibration.js: the screen-calibration dialog, shared by every sim page.
 *
 * Two ways to set the scale:
 *  1. Card (most exact): match an on-screen card to a real ID-1 bank card.
 *     devicePxPerMetre = (cardCssPx × devicePixelRatio) / cardLengthM
 *  2. Screen size: enter the diagonal + native resolution.
 *     devicePxPerMetre = √(w² + h²) / diagonal / 0.0254
 *     Either can be "Unknown": we then assume a 24″ 1920 × 1080 monitor.
 *
 * Results are saved via common.saveCalibration (localStorage, memory fallback).
 * Pages call initCalibration() and wire "Calibrate screen" buttons to open().
 */

import {
  ID1_CARD_WIDTH_M,
  ID1_CARD_HEIGHT_M,
  METRES_PER_INCH,
  DEFAULT_SCREEN,
  clamp,
  devicePxPerMetreFromCard,
  devicePxPerMetreFromScreen,
} from './physics.js';
import {
  getScale,
  saveCalibration,
  clearCalibration,
  loadCalibration,
  isCalibrationSkipped,
  setCalibrationSkipped,
  fmt,
  pixelSummary,
} from './common.js';

const MIN_CARD_PX = 80;
const FINE_STEP_PX = 0.5;

const SIZES_IN = [13.3, 14, 15.6, 16, 17.3, 21.5, 23.8, 24, 27, 31.5, 34, 43];
const RESOLUTIONS = [
  [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [1920, 1200], [2560, 1440],
  [2560, 1600], [2880, 1800], [3024, 1964], [3440, 1440], [3840, 2160],
];

/** Native resolution as the browser sees it (CSS screen size × DPR at 100% zoom). */
function detectedResolution() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(screen.width * dpr);
  const h = Math.round(screen.height * dpr);
  return w >= 320 && h >= 240 ? [Math.max(w, h), Math.min(w, h)] : null;
}

function template() {
  const detected = detectedResolution();
  const resOptions = [
    detected ? `<option value="${detected[0]}x${detected[1]}">${detected[0]} × ${detected[1]} (detected)</option>` : '',
    `<option value="unknown">Unknown (assume ${DEFAULT_SCREEN.resW} × ${DEFAULT_SCREEN.resH})</option>`,
    ...RESOLUTIONS.filter(([w, h]) => !detected || w !== detected[0] || h !== detected[1])
      .map(([w, h]) => `<option value="${w}x${h}">${w} × ${h}</option>`),
    '<option value="other">Other…</option>',
  ].join('');
  const sizeOptions = [
    `<option value="unknown">Unknown (assume ${DEFAULT_SCREEN.diagonalIn}″)</option>`,
    ...SIZES_IN.map((d) => `<option value="${d}">${d}″</option>`),
    '<option value="other">Other…</option>',
  ].join('');

  return `
<form method="dialog" class="cal-form">
  <h2 id="cal-title">Calibrate your screen</h2>

  <div class="cal-panel" data-panel="card">
    <p id="cal-desc" class="cal-lead"><strong>Hold a bank card against the screen and match its width.</strong>
      Line the card's left edge up with the left edge of the drawn card, then drag the handle,
      slider or &minus;/+ buttons until the right edges line up exactly.</p>
    <div class="cal-adjust">
      <button type="button" class="btn btn-icon" data-nudge="-1" aria-label="Make card narrower">&minus;</button>
      <input type="range" id="cal-range" step="${FINE_STEP_PX}" autofocus aria-label="On-screen card width">
      <button type="button" class="btn btn-icon" data-nudge="1" aria-label="Make card wider">+</button>
    </div>
    <p class="cal-result"><span id="cal-px"></span><br><span id="cal-pixel"></span></p>
    <div class="cal-stage">
      <div class="cal-card" aria-hidden="true">
        <span class="cal-card-chip"></span>
        <span class="cal-card-label"></span>
        <span class="cal-handle" title="Drag to resize"></span>
      </div>
    </div>
    <label class="cal-check">
      <input type="checkbox" id="cal-short">
      <span>Card wider than your screen? Turn it sideways and match the <strong>short edge (53.98&nbsp;mm)</strong> instead.</span>
    </label>
    <p class="cal-note">Any ID-1 card works (bank card, ID card, most driving licences: 85.60&nbsp;&times;&nbsp;53.98&nbsp;mm).
      The result is stored only in this browser. Browser zoom is handled automatically; recalibrate if you move to another screen.</p>
    <div class="cal-actions">
      <button type="button" class="btn btn-ghost" data-show="screen">No card? Use screen size</button>
      <span class="cal-actions-right">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="cal-save">Save calibration</button>
      </span>
    </div>
  </div>

  <div class="cal-panel" data-panel="screen" hidden>
    <p class="cal-lead">Enter your screen's size and resolution and the page works out how big a pixel is.
      Not sure? Choose <strong>Unknown</strong> and we'll assume the most common desktop monitor,
      ${DEFAULT_SCREEN.diagonalIn}″ at ${DEFAULT_SCREEN.resW} × ${DEFAULT_SCREEN.resH}.</p>
    <div class="cal-fields">
      <div class="cal-field">
        <label for="cal-diag">Screen size (diagonal)</label>
        <select id="cal-diag">${sizeOptions}</select>
        <span class="cal-inline" id="cal-diag-other" hidden>
          <input type="number" id="cal-diag-num" min="5" max="120" step="0.1" inputmode="decimal" aria-label="Diagonal in inches">
          <span class="muted">inches</span>
        </span>
      </div>
      <div class="cal-field">
        <label for="cal-res">Resolution (pixels)</label>
        <select id="cal-res">${resOptions}</select>
        <span class="cal-inline" id="cal-res-other" hidden>
          <input type="number" id="cal-res-w" min="320" max="16000" step="1" inputmode="numeric" aria-label="Horizontal pixels">
          <span aria-hidden="true">×</span>
          <input type="number" id="cal-res-h" min="240" max="16000" step="1" inputmode="numeric" aria-label="Vertical pixels">
        </span>
      </div>
    </div>
    <p class="cal-result" id="cal-screen-result"></p>
    <p class="cal-note">Use the screen's native resolution (its maximum), not a scaled setting.
      A card match is more exact, especially on laptops and phones.</p>
    <div class="cal-actions">
      <span>
        <button type="button" class="btn btn-ghost" data-show="card">&larr; Match a card instead</button>
        <button type="button" class="btn btn-ghost" id="cal-forget">Forget saved scale</button>
      </span>
      <span class="cal-actions-right">
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="cal-screen-save">Use this screen</button>
      </span>
    </div>
  </div>
</form>`;
}

/**
 * @param {{ autoOpen?: boolean }} [options] autoOpen: show on first visit
 * @returns {{ open: () => void }}
 */
export function initCalibration({ autoOpen = true, pixelSummary: showPixel = false } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'cal-dialog';
  dialog.setAttribute('aria-labelledby', 'cal-title');
  dialog.setAttribute('aria-describedby', 'cal-desc');
  dialog.innerHTML = template();
  document.body.append(dialog);

  const $ = (sel) => dialog.querySelector(sel);
  const title = $('#cal-title');
  const stage = $('.cal-stage');
  const card = $('.cal-card');
  const cardLabel = $('.cal-card-label');
  const handle = $('.cal-handle');
  const range = $('#cal-range');
  const pxOut = $('#cal-px');
  const shortEdge = $('#cal-short');
  const diag = $('#cal-diag');
  const diagNum = $('#cal-diag-num');
  const res = $('#cal-res');
  const resW = $('#cal-res-w');
  const resH = $('#cal-res-h');

  /* ---------- Panels ---------- */

  function showPanel(name) {
    for (const panel of dialog.querySelectorAll('.cal-panel')) panel.hidden = panel.dataset.panel !== name;
    title.textContent = name === 'card' ? 'Calibrate your screen' : 'Set the scale from your screen size';
    if (name === 'screen') {
      prefillScreen();
      updateScreenResult();
      diag.focus();
    } else {
      range.focus();
    }
  }

  /* ---------- Card matching ---------- */

  let widthPx = 0; // on-screen width of the drawn card's matched edge, CSS px
  const edgeMetres = () => (shortEdge.checked ? ID1_CARD_HEIGHT_M : ID1_CARD_WIDTH_M);

  function maxWidth() {
    // Before the dialog has been laid out clientWidth is 0: don't clamp then.
    const w = stage.clientWidth;
    return w > 0 ? Math.max(MIN_CARD_PX + 10, Math.floor(w)) : Infinity;
  }

  function setWidth(px) {
    widthPx = clamp(px, MIN_CARD_PX, maxWidth());
    const aspect = shortEdge.checked
      ? ID1_CARD_WIDTH_M / ID1_CARD_HEIGHT_M // portrait: height = long edge
      : ID1_CARD_HEIGHT_M / ID1_CARD_WIDTH_M;
    card.style.width = `${widthPx}px`;
    card.style.height = `${widthPx * aspect}px`;
    if (Number.isFinite(maxWidth())) range.max = String(maxWidth());
    range.value = String(widthPx);
    const mm = shortEdge.checked ? '53.98 mm' : '85.60 mm';
    cardLabel.textContent = mm;
    range.setAttribute('aria-valuetext', `${fmt(widthPx, 1)} pixels wide, should equal ${mm}`);
    const cssPxPerMm = widthPx / (edgeMetres() * 1000);
    const ppi = (widthPx / edgeMetres()) * METRES_PER_INCH;
    pxOut.textContent = `${fmt(widthPx, 1)} px = ${mm}  →  ${fmt(cssPxPerMm, 2)} px/mm (${fmt(ppi, 0)} CSS px per inch)`;
    if (showPixel) $('#cal-pixel').textContent = pixelSummary(devicePxPerMetreFromCard(widthPx, window.devicePixelRatio || 1, edgeMetres()));
  }

  range.addEventListener('input', () => setWidth(Number(range.value)));

  dialog.addEventListener('click', (e) => {
    const nudge = e.target.closest('[data-nudge]');
    if (nudge) setWidth(widthPx + Number(nudge.dataset.nudge) * FINE_STEP_PX);
    const show = e.target.closest('[data-show]');
    if (show) showPanel(show.dataset.show);
    if (e.target.closest('[data-close]')) close();
  });

  shortEdge.addEventListener('change', () => {
    // Same physical scale, different reference edge.
    const scale = widthPx / (shortEdge.checked ? ID1_CARD_WIDTH_M : ID1_CARD_HEIGHT_M);
    setWidth(scale * edgeMetres());
  });

  // Drag the right-hand edge of the drawn card.
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = widthPx;
    const move = (ev) => setWidth(startW + (ev.clientX - startX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  $('#cal-save').addEventListener('click', () => {
    const dpr = window.devicePixelRatio || 1;
    saveCalibration(devicePxPerMetreFromCard(widthPx, dpr, edgeMetres()), { method: 'card', dprAtSave: dpr });
    dialog.close();
  });

  /* ---------- Screen size + resolution ---------- */

  /** Values to use, with "Unknown" replaced by the 24″ 1920 × 1080 default. */
  function screenSpec() {
    let diagonalIn = DEFAULT_SCREEN.diagonalIn;
    let w = DEFAULT_SCREEN.resW;
    let h = DEFAULT_SCREEN.resH;
    let assumed = false;
    let valid = true;

    if (diag.value === 'unknown') assumed = true;
    else if (diag.value === 'other') {
      diagonalIn = Number(diagNum.value);
      valid &&= diagonalIn >= 5 && diagonalIn <= 120;
    } else diagonalIn = Number(diag.value);

    if (res.value === 'unknown') assumed = true;
    else if (res.value === 'other') {
      w = Math.round(Number(resW.value));
      h = Math.round(Number(resH.value));
      valid &&= w >= 320 && h >= 240 && w <= 16000 && h <= 16000;
    } else [w, h] = res.value.split('x').map(Number);

    return { diagonalIn, resW: w, resH: h, assumed, valid };
  }

  function updateScreenResult() {
    $('#cal-diag-other').hidden = diag.value !== 'other';
    $('#cal-res-other').hidden = res.value !== 'other';
    const spec = screenSpec();
    const out = $('#cal-screen-result');
    $('#cal-screen-save').disabled = !spec.valid;
    if (!spec.valid) {
      out.textContent = 'Enter a size between 5″ and 120″ and a resolution of at least 320 × 240.';
      return;
    }
    const pxPerM = devicePxPerMetreFromScreen(spec.diagonalIn, spec.resW, spec.resH);
    out.textContent =
      `${spec.diagonalIn}″ at ${spec.resW} × ${spec.resH} → ${fmt(pxPerM * METRES_PER_INCH, 1)} pixels per inch, ` +
      `so 1 m = ${fmt(pxPerM, 0)} screen pixels.${spec.assumed ? ' (Includes an assumed value.)' : ''}${showPixel ? ` ${pixelSummary(pxPerM)}` : ''}`;
  }

  /** Start from the saved screen settings if there are any. */
  function prefillScreen() {
    const cal = loadCalibration();
    if (cal?.method !== 'screen' || cal.assumed) return;
    const d = String(cal.diagonalIn);
    if ([...diag.options].some((o) => o.value === d)) diag.value = d;
    else {
      diag.value = 'other';
      diagNum.value = d;
    }
    const r = `${cal.resW}x${cal.resH}`;
    if ([...res.options].some((o) => o.value === r)) res.value = r;
    else {
      res.value = 'other';
      resW.value = String(cal.resW);
      resH.value = String(cal.resH);
    }
  }

  for (const el of [diag, diagNum, res, resW, resH]) {
    el.addEventListener('input', updateScreenResult);
    el.addEventListener('change', updateScreenResult);
  }

  $('#cal-screen-save').addEventListener('click', () => {
    const spec = screenSpec();
    if (!spec.valid) return;
    saveCalibration(devicePxPerMetreFromScreen(spec.diagonalIn, spec.resW, spec.resH), {
      method: 'screen',
      diagonalIn: spec.diagonalIn,
      resW: spec.resW,
      resH: spec.resH,
      assumed: spec.assumed,
    });
    dialog.close();
  });

  $('#cal-forget').addEventListener('click', () => {
    clearCalibration();
    setCalibrationSkipped();
    dialog.close();
  });

  /* ---------- Open / close ---------- */

  function open() {
    // Start from the current scale so reopening shows the saved match.
    const { cssPxPerMetre } = getScale();
    if (!dialog.open) dialog.showModal();
    showPanel('card');
    range.min = String(MIN_CARD_PX);
    setWidth(cssPxPerMetre * edgeMetres());
    // Re-apply once layout has settled, so the slider max reflects the real dialog width.
    requestAnimationFrame(() => setWidth(cssPxPerMetre * edgeMetres()));
  }

  function close() {
    // Dismissing without saving counts as "skipped" so we don't nag every visit.
    if (!loadCalibration()) setCalibrationSkipped();
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('cancel', (e) => {
    e.preventDefault(); // Escape key
    close();
  });

  // Keep the slider's max in step with the dialog width.
  window.addEventListener('resize', () => {
    if (dialog.open) setWidth(widthPx);
  });

  if (autoOpen && !loadCalibration() && !isCalibrationSkipped()) open();

  return { open };
}
