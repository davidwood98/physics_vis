/**
 * common.js: helpers shared by every page/simulator.
 *
 *  - safe storage (works when localStorage is blocked)
 *  - calibration storage + current screen scale
 *  - canvas setup with devicePixelRatio handling
 *  - theme colours from CSS variables
 *  - number formatting
 *  - the shared "Pixel size" card (how big one screen pixel is, with real objects for scale)
 *  - ad-slot / affiliate / donate-link initialisation
 */

import { ADS_ENABLED, DONATE_URL } from './config.js';
import { APPROX_CSS_PX_PER_METRE, cssPxPerMetreFromDevice } from './physics.js';
import { PIXEL_REFERENCES } from './data/references.js';

/* ---------- Safe storage ---------- */

// Fallback so the page still behaves within a session when storage is blocked
// (privacy mode, disabled cookies, sandboxed iframes...).
const memoryStore = new Map();

export function storageGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* blocked: fall through to memory */
  }
  return memoryStore.has(key) ? memoryStore.get(key) : null;
}

export function storageSet(key, value) {
  memoryStore.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* blocked or full: memory copy is enough for this session */
  }
}

export function storageRemove(key) {
  memoryStore.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/* ---------- Calibration ---------- */

const CALIBRATION_KEY = 'rsp.calibration.v1';
const CALIBRATION_SKIPPED_KEY = 'rsp.calibration.skipped';
export const CALIBRATION_EVENT = 'calibrationchange';

/** Returns { devicePxPerMetre, ... } or null if not calibrated / invalid. */
export function loadCalibration() {
  const raw = storageGet(CALIBRATION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (Number.isFinite(data.devicePxPerMetre) && data.devicePxPerMetre > 0) return data;
  } catch {
    /* corrupt value: treat as uncalibrated */
  }
  return null;
}

export function saveCalibration(devicePxPerMetre, extra = {}) {
  storageSet(
    CALIBRATION_KEY,
    JSON.stringify({ devicePxPerMetre, savedAt: new Date().toISOString(), ...extra }),
  );
  window.dispatchEvent(new CustomEvent(CALIBRATION_EVENT));
}

export function clearCalibration() {
  storageRemove(CALIBRATION_KEY);
  window.dispatchEvent(new CustomEvent(CALIBRATION_EVENT));
}

export const isCalibrationSkipped = () => storageGet(CALIBRATION_SKIPPED_KEY) === '1';
export const setCalibrationSkipped = () => storageSet(CALIBRATION_SKIPPED_KEY, '1');

// Another tab changed the calibration: let this tab update too.
window.addEventListener('storage', (e) => {
  if (e.key === CALIBRATION_KEY) window.dispatchEvent(new CustomEvent(CALIBRATION_EVENT));
});

/**
 * Current screen scale. Re-evaluate on resize: browser zoom changes
 * devicePixelRatio, and dividing by it keeps 1 m physically 1 m.
 *
 * source: 'card'    matched a bank card (true 1:1)
 *         'screen'  from the screen's size + resolution (good estimate)
 *         'assumed' screen details unknown: 24" 1920×1080 assumed
 *         'default' never calibrated: CSS's 96 px per inch
 * calibrated is true for 'card' and 'screen'.
 * @returns {{ cssPxPerMetre: number, calibrated: boolean, source: string, detail?: string }}
 */
export function getScale() {
  const cal = loadCalibration();
  if (cal) {
    const dpr = window.devicePixelRatio || 1;
    const source = cal.method === 'screen' ? (cal.assumed ? 'assumed' : 'screen') : 'card';
    return {
      cssPxPerMetre: cssPxPerMetreFromDevice(cal.devicePxPerMetre, dpr),
      calibrated: source !== 'assumed',
      source,
      detail: cal.method === 'screen' ? `${cal.diagonalIn}″ ${cal.resW}×${cal.resH}` : '',
    };
  }
  return { cssPxPerMetre: APPROX_CSS_PX_PER_METRE, calibrated: false, source: 'default' };
}

/** Short phrase saying where the scale came from, for sentences. */
export function scaleSourceText(scale) {
  switch (scale.source) {
    case 'card': return 'calibrated with a card';
    case 'screen': return `from your ${scale.detail} screen`;
    case 'assumed': return `assuming a ${scale.detail} screen`;
    default: return 'approximate, 96 px per inch';
  }
}

/** Badge wording for a scale from getScale(). ok = trustworthy for 1:1. */
export function scaleBadge(scale) {
  switch (scale.source) {
    case 'card': return { text: '1:1 scale (calibrated)', ok: true };
    case 'screen': return { text: `1:1 scale (from ${scale.detail} screen)`, ok: true };
    case 'assumed': return { text: `Assumed ${scale.detail} screen: calibrate for 1:1`, ok: false };
    default: return { text: 'Approximate scale: calibrate for 1:1', ok: false };
  }
}

/* ---------- Canvas ---------- */

/**
 * Keep a canvas's backing store at CSS size × devicePixelRatio so drawing is
 * sharp, and let draw code work in CSS pixels. Calls onResize(view) whenever
 * the size or DPR changes.
 * @returns {{ ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number }}
 */
export function setupCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  const view = { ctx, width: 0, height: 0, dpr: 1 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (rect.width === view.width && rect.height === view.height && dpr === view.dpr) return;
    view.width = rect.width;
    view.height = rect.height;
    view.dpr = dpr;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px from here on
    onResize?.(view);
  }

  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize); // catches DPR-only changes (zoom, monitor move)
  resize();
  return view;
}

/** Read CSS custom properties into an object: { key: '--css-var' } → { key: value }. */
export function readCssVars(map, el = document.documentElement) {
  const styles = getComputedStyle(el);
  const out = {};
  for (const [key, cssVar] of Object.entries(map)) out[key] = styles.getPropertyValue(cssVar).trim();
  return out;
}

/** Run cb when the OS light/dark preference changes. */
export function onColorSchemeChange(cb) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', cb);
}

export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Formatting ---------- */

const formatters = new Map();

/** Fixed-decimal number with thousands separators. Infinity → '∞'. */
export function fmt(x, decimals) {
  if (!Number.isFinite(x)) return '∞';
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, f);
  }
  return f.format(x);
}

/** Roughly 3 significant figures without switching to exponent notation. */
export function fmtAuto(x) {
  if (x === 0) return '0';
  const a = Math.abs(x);
  return fmt(x, a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3);
}

/* ---------- Pixel reference: how big is one pixel on this screen? ---------- */

/** Typical size of a reference object: the cited typical value, else the geometric middle of its range. */
export const referenceTypical = (ref) => ref.typicalM ?? Math.sqrt(ref.rangeM[0] * ref.rangeM[1]);

/**
 * Physical size of one device pixel. Calibrated: from the stored scale.
 * Not calibrated: CSS's 96 px per inch, i.e. 0.0254 / (96 × devicePixelRatio).
 * @returns {{ pitch: number, devicePxPerMetre: number, calibrated: boolean, scale: object }}
 */
export function pixelPitch(scale = getScale(), dpr = window.devicePixelRatio || 1) {
  const devicePxPerMetre = scale.cssPxPerMetre * dpr;
  return { pitch: 1 / devicePxPerMetre, devicePxPerMetre, calibrated: scale.calibrated, scale };
}

/**
 * The reference ladder around a pixel pitch (m): the two objects just smaller,
 * the two just larger, and the closest (in ratio terms) of those four.
 */
export function referenceLadder(pitch, refs = PIXEL_REFERENCES) {
  const sorted = [...refs].sort((a, b) => referenceTypical(a) - referenceTypical(b));
  const smaller = sorted.filter((r) => referenceTypical(r) <= pitch).slice(-2);
  const larger = sorted.filter((r) => referenceTypical(r) > pitch).slice(0, 2);
  const list = [...smaller, ...larger];
  let closest = null;
  for (const r of list) {
    if (!closest || Math.abs(Math.log(referenceTypical(r) / pitch)) < Math.abs(Math.log(referenceTypical(closest) / pitch))) closest = r;
  }
  return { smaller, larger, list, closest };
}

/** Short length for the pixel card: "0.277 mm", "52 micrometres", "1.5 mm". */
export function smallLength(m) {
  if (m < 1e-4) return `${sigDigits(m * 1e6, m < 1e-5 ? 2 : 3)} micrometres`;
  return `${sigDigits(m * 1e3, 3)} mm`;
}
/** x to n significant figures without trailing zeros ("0.25", "92.1"). */
const sigDigits = (x, n) => {
  const p = Math.floor(Math.log10(Math.abs(x)));
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: Math.max(0, n - 1 - p) }).format(Number(x.toPrecision(n)));
};

/** One-line summary used in the calibration dialog: "1 pixel = 0.277 mm (about 92 ppi), about the size of …". */
export function pixelSummary(devicePxPerMetre) {
  const pitch = 1 / devicePxPerMetre;
  const { closest } = referenceLadder(pitch);
  return `1 screen pixel = ${smallLength(pitch)} (about ${fmt(0.0254 / pitch, 0)} pixels per inch)` +
    (closest ? `, about the size of a ${closest.name}.` : '.');
}

/**
 * The shared "Pixel size" card. Renders into `root` (an empty <section>) and
 * keeps itself up to date when the calibration, browser zoom or monitor changes.
 *   onCalibrate: opens the calibration dialog
 *   extraLine:   optional () => string, a page-specific sentence (e.g. "Earth is drawn as one pixel: …")
 * Returns { update } so a page can refresh the extra line.
 */
export function initPixelCard(root, { onCalibrate, extraLine } = {}) {
  root.innerHTML = `
    <h2 class="card-title" id="pixel-card-title">Pixel size</h2>
    <p class="pixel-warn" data-px="warn" hidden></p>
    <p class="pixel-headline"><b data-px="pitch">–</b></p>
    <p class="pixel-extra" data-px="extra" hidden></p>
    <ul class="pixel-facts">
      <li data-px="ppi"></li>
      <li data-px="stripe"></li>
      <li data-px="sanity"></li>
    </ul>
    <div class="pixel-views">
      <figure class="pixel-figure">
        <figcaption><span class="badge badge--ok">True size (1:1)</span> Hold a grain of salt up to the screen.</figcaption>
        <canvas class="pixel-canvas" data-px="true" role="img" aria-label="Pixel and reference objects at true size"></canvas>
      </figure>
      <figure class="pixel-figure">
        <figcaption>
          <span class="badge badge--warn">MAGNIFIED</span>
          <span class="segmented segmented--small pixel-mag" role="radiogroup" aria-label="Magnification">
            <input type="radio" name="pixel-mag" id="pixel-mag-10" value="10"><label for="pixel-mag-10">10&times;</label>
            <input type="radio" name="pixel-mag" id="pixel-mag-20" value="20" checked><label for="pixel-mag-20">20&times;</label>
            <input type="radio" name="pixel-mag" id="pixel-mag-50" value="50"><label for="pixel-mag-50">50&times;</label>
          </span>
        </figcaption>
        <canvas class="pixel-canvas pixel-canvas--mag" data-px="mag" role="img" aria-label="Magnified pixel grid with red, green and blue stripes and reference objects"></canvas>
      </figure>
    </div>
    <ol class="pixel-ladder" data-px="ladder" aria-label="Objects near one pixel in size"></ol>`;
  root.setAttribute('aria-labelledby', 'pixel-card-title');
  const q = (k) => root.querySelector(`[data-px="${k}"]`);
  let magnification = 20;

  for (const radio of root.querySelectorAll('input[name="pixel-mag"]')) {
    radio.addEventListener('change', () => {
      magnification = Number(radio.value);
      draw();
    });
  }

  let info = pixelPitch();
  let ladder = referenceLadder(info.pitch);

  function update() {
    info = pixelPitch();
    ladder = referenceLadder(info.pitch);
    const { pitch } = info;
    const warn = q('warn');
    warn.hidden = info.calibrated;
    if (!info.calibrated) {
      warn.innerHTML = info.scale.source === 'assumed'
        ? `Not calibrated: size assumes a ${info.scale.detail} screen. `
        : 'Not calibrated, size is a 96 px/inch estimate. ';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-small';
      btn.textContent = 'Calibrate';
      btn.addEventListener('click', () => onCalibrate?.());
      warn.append(btn);
    }
    q('pitch').textContent = `1 pixel = ${fmt(pitch * 1e3, 3)} mm = ${fmt(pitch * 1e6, 0)} micrometres`;
    q('ppi').textContent = `About ${fmt(0.0254 / pitch, 0)} pixels per inch (0.0254 m ÷ pixel size).`;
    q('stripe').textContent = `Each pixel is usually three coloured sub-pixel stripes (red, green, blue), each about ${smallLength(pitch / 3)} wide.`;
    const dpr = window.devicePixelRatio || 1;
    const widthM = screen.width * dpr * pitch;
    q('sanity').hidden = !(screen.width > 0);
    q('sanity').textContent = `Approximate check: your screen would be about ${fmt(widthM * 100, 0)} cm wide (screen.width × devicePixelRatio × pixel size). ` +
      'If this is wrong, recalibrate or enter your screen diagonal. Operating-system scaling and multi-monitor setups can mislead it.';
    const extra = extraLine?.(info, ladder) || '';
    q('extra').hidden = !extra;
    q('extra').textContent = extra;

    const list = q('ladder');
    list.textContent = '';
    for (const r of ladder.list) {
      const li = document.createElement('li');
      if (r === ladder.closest) li.className = 'is-closest';
      const t = referenceTypical(r);
      li.innerHTML = `<b></b> <span class="pixel-size"></span><span class="pixel-note muted"></span>`;
      li.querySelector('b').textContent = r.name[0].toUpperCase() + r.name.slice(1) + (r === ladder.closest ? ' (closest to one pixel)' : '');
      li.querySelector('.pixel-size').textContent =
        ` typically ${smallLength(t)} ${r.dimension} (${smallLength(r.rangeM[0])} to ${smallLength(r.rangeM[1])}${r.mid ? ', middle of range' : ''}), ` +
        `${fmt(t / pitch, t / pitch < 10 ? 1 : 0)} pixels. `;
      li.querySelector('.pixel-note').textContent = r.note;
      li.title = `Source: ${r.source}`;
      list.append(li);
    }
    draw();
  }

  /** Size a canvas to its CSS box in device pixels; returns its 2D context drawing in DEVICE px. */
  function prep(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return { ctx, W: canvas.width, H: canvas.height, dpr };
  }

  function colours() {
    return readCssVars({ fg: '--canvas-fg', muted: '--canvas-muted', accent: '--accent', track: '--canvas-track', ref: '--canvas-ref' }, root);
  }

  /** Disc of diameter dPx device px; under 1 px a single pixel with alpha = area fraction. */
  function drawObject(ctx, x, y, dPx, colour) {
    ctx.fillStyle = colour;
    if (dPx >= 1) {
      ctx.beginPath();
      ctx.arc(x, y, dPx / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalAlpha = (Math.PI * dPx * dPx) / 4;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    const c = colours();
    const items = ladder.list;
    const font = (px, dpr) => `${Math.round(px * dpr)}px system-ui, sans-serif`;

    // True size: 1 device pixel, then each reference object at its real size.
    {
      const { ctx, W, H, dpr } = prep(q('true'), 110);
      const slots = items.length + 1;
      const slotW = W / slots;
      const cy = Math.round(H * 0.42);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = font(12, dpr);
      // The pixel itself: one device pixel, ringed so it can be found.
      const px0 = Math.round(slotW / 2);
      ctx.fillStyle = c.accent;
      ctx.fillRect(px0, cy, 1, 1);
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.arc(px0 + 0.5, cy + 0.5, 9 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = c.fg;
      ctx.fillText('1 pixel', px0, cy + 16 * dpr);
      items.forEach((r, i) => {
        const x = Math.round(slotW * (i + 1.5));
        drawObject(ctx, x, cy, referenceTypical(r) / info.pitch, r === ladder.closest ? c.accent : c.ref);
        ctx.fillStyle = c.fg;
        ctx.fillText(r.name, x, cy + 16 * dpr, slotW - 4 * dpr);
      });
    }

    // Magnified: a grid of pixels with RGB stripes, and the objects at the same magnification.
    {
      const { ctx, W, H, dpr } = prep(q('mag'), 230);
      const cell = magnification; // one pixel drawn magnification × wide, in device px
      const gridCols = Math.max(2, Math.min(8, Math.floor((W * 0.3) / cell)));
      const gridRows = Math.max(2, Math.min(8, Math.floor((H * 0.7) / cell)));
      const gx = Math.round(10 * dpr);
      const gy = Math.round((H - gridRows * cell) / 2);
      for (let r = 0; r < gridRows; r++) {
        for (let k = 0; k < gridCols; k++) {
          const x = gx + k * cell;
          const y = gy + r * cell;
          ['#e5484d', '#30a46c', '#3e63dd'].forEach((col, s) => {
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.75;
            ctx.fillRect(x + (s * cell) / 3, y, cell / 3 - Math.max(1, cell / 30), cell);
          });
          ctx.globalAlpha = 1;
        }
      }
      ctx.strokeStyle = c.fg;
      ctx.lineWidth = Math.max(1, dpr);
      ctx.strokeRect(gx + 0.5, gy + 0.5, cell, cell);
      ctx.font = font(12, dpr);
      ctx.fillStyle = c.fg;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`1 pixel = ${smallLength(info.pitch)}`, gx, gy + gridRows * cell + 4 * dpr);

      const x0 = gx + gridCols * cell + 24 * dpr;
      const slotW = (W - x0) / Math.max(1, items.length);
      const cy = Math.round(H * 0.45);
      ctx.textAlign = 'center';
      items.forEach((r, i) => {
        const x = x0 + slotW * (i + 0.5);
        const d = (referenceTypical(r) / info.pitch) * cell;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + slotW * i, 0, slotW, H);
        ctx.clip();
        drawObject(ctx, x, cy, d, r === ladder.closest ? c.accent : c.ref);
        ctx.restore();
        ctx.fillStyle = c.fg;
        ctx.fillText(r.name, x, Math.min(H - 30 * dpr, cy + d / 2 + 6 * dpr), slotW - 4 * dpr);
        ctx.fillStyle = c.muted;
        ctx.fillText(d > H ? '(larger than this box)' : `${fmt(referenceTypical(r) / info.pitch, 1)} px`, x, Math.min(H - 15 * dpr, cy + d / 2 + 21 * dpr));
      });
    }
  }

  window.addEventListener(CALIBRATION_EVENT, update);
  window.addEventListener('resize', update);
  onColorSchemeChange(draw);
  update();
  return { update };
}

/* ---------- Page chrome: ads, affiliates, donate ---------- */

/**
 * Ad slots are hidden by CSS unless <html> has .ads-enabled or .show-slots.
 * The inline <head> snippet sets .show-slots before first paint so the
 * ?showslots=1 placeholders cause no layout shift; this repeats it for safety.
 */
export function initAdSlots() {
  const root = document.documentElement;
  const showSlots = new URLSearchParams(location.search).get('showslots') === '1';
  root.classList.toggle('show-slots', showSlots);
  if (ADS_ENABLED) {
    root.classList.add('ads-enabled');
    // Initialise the ad network here (load its script into each [data-ad-slot]).
  }
}

/**
 * Affiliate sections stay hidden until they contain real links
 * (<a href> inside the list) or ?showslots=1 is set.
 */
export function initAffiliates() {
  for (const section of document.querySelectorAll('[data-affiliate]')) {
    const hasLinks = section.querySelector('li a[href]') !== null;
    section.hidden = !(hasLinks || document.documentElement.classList.contains('show-slots'));
  }
}

export function initDonateLinks() {
  for (const a of document.querySelectorAll('[data-donate]')) a.href = DONATE_URL;
}

/** Everything a page needs for the shared chrome. */
export function initPage() {
  initAdSlots();
  initAffiliates();
  initDonateLinks();
}
