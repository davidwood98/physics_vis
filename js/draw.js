/**
 * draw.js: small canvas drawing helpers shared by the sims.
 *
 * Everything works in CSS pixels (setupCanvas has already applied the DPR
 * transform). World → pixel conversion happens in the sim's own draw code;
 * these helpers only take pixel positions plus k (CSS px per metre) where a
 * real length is involved. Positions are never rounded (sub-pixel is fine).
 */

import { TAU, rulerTicks, niceFloor, niceStep } from './physics.js';

export const FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_BOLD = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** rgba() string from an "r, g, b" CSS variable value. */
export const withAlpha = (rgbTriplet, a) => `rgba(${rgbTriplet}, ${a})`;

export function drawDot(ctx, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** Filled arrowhead with its tip at (x, y), pointing along unit vector (ux, uy). */
export function drawArrowHead(ctx, x, y, ux, uy, size) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * size - uy * size * 0.55, y - uy * size + ux * size * 0.55);
  ctx.lineTo(x - ux * size + uy * size * 0.55, y - uy * size - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

/** Straight arrow from (x0, y0) to (x1, y1). */
export function drawArrow(ctx, x0, y0, x1, y1, color, { width = 2, head = 9 } = {}) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return;
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6);
  ctx.stroke();
  drawArrowHead(ctx, x1, y1, ux, uy, head);
}

/** "5 cm", "250 mm", "1.5 m" for a length in metres. */
export function lengthLabel(m) {
  if (m >= 1) return `${Number(m.toPrecision(3))} m`;
  if (m >= 0.01) return `${Number((m * 100).toPrecision(3))} cm`;
  return `${Number((m * 1000).toPrecision(3))} mm`;
}

/**
 * Text on a rounded "pill" background so it stays readable over drawings.
 * align: 'left' | 'right' | 'center' relative to x; y is the vertical centre.
 */
export function drawTag(ctx, text, x, y, { color, background, border, align = 'left', font = FONT_BOLD, padX = 8, height = 22 } = {}) {
  ctx.save();
  ctx.font = font;
  const w = ctx.measureText(text).width + padX * 2;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.beginPath();
  ctx.roundRect(left, y - height / 2, w, height, height / 2);
  if (background) {
    ctx.fillStyle = background;
    ctx.fill();
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + 0.5);
  ctx.restore();
  return w;
}

/* ---------- True-scale ruler ---------- */

const tickCache = new Map();
function cachedTicks(lengthM) {
  let ticks = tickCache.get(lengthM);
  if (!ticks) {
    if (tickCache.size > 16) tickCache.clear();
    ticks = rulerTicks(lengthM);
    tickCache.set(lengthM, ticks);
  }
  return ticks;
}

function rulerLabel(cm) {
  if (cm === 0) return '0';
  if (cm < 100) return `${cm} cm`;
  return cm % 100 === 0 ? `${cm / 100} m` : `${(cm / 100).toFixed(1)} m`;
}

/**
 * Ruler with 1 cm / 10 cm / 50 cm / 1 m ticks, starting at (x, y).
 * Horizontal rulers grow rightwards; vertical rulers grow downwards.
 * side: +1 puts ticks below (horizontal) / right (vertical), −1 above / left.
 * Labels appear only where there's room, so it adapts to any screen scale.
 */
export function drawRuler(ctx, colors, { x, y, lengthM, k, vertical = false, side = 1, offset = 4 }) {
  if (lengthM <= 0) return;
  const ticks = cachedTicks(lengthM);
  const visible = { cm: 0.01 * k >= 4, dm: 0.1 * k >= 4, half: 0.5 * k >= 4, m: true };
  const labelled = { cm: 0.01 * k >= 34, dm: 0.1 * k >= 36, half: 0.1 * k >= 36, m: true };
  const lengths = { m: 26, half: 18, dm: 12, cm: 6 };

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of ticks) {
    if (!visible[t.kind]) continue;
    const along = t.x * k;
    const a = offset * side;
    const b = (offset + lengths[t.kind]) * side;
    if (vertical) {
      ctx.moveTo(x + a, y + along);
      ctx.lineTo(x + b, y + along);
    } else {
      ctx.moveTo(x + along, y + a);
      ctx.lineTo(x + along, y + b);
    }
  }
  ctx.stroke();

  for (const t of ticks) {
    if (!labelled[t.kind]) continue;
    const label = t.kind === 'cm' ? String(t.cm) : rulerLabel(t.cm); // bare numbers keep 1 cm labels light
    ctx.fillStyle = t.kind === 'cm' ? colors.muted : colors.fg;
    const along = t.x * k;
    const across = (offset + lengths[t.kind] + 4) * side;
    if (vertical) {
      ctx.textAlign = side > 0 ? 'left' : 'right';
      ctx.textBaseline = t.cm === 0 ? 'top' : 'middle';
      ctx.fillText(label, x + across, y + along);
    } else {
      ctx.textAlign = t.cm === 0 ? 'left' : 'center';
      ctx.textBaseline = side > 0 ? 'top' : 'bottom';
      ctx.fillText(label, x + along + (t.cm === 0 ? 2 : 0), y + across);
    }
  }
}

/**
 * Scale bar of the longest 1-2-5 length that fits in maxPx, at (x, y) = left end.
 * Works at true scale and when zoomed out.
 */
export function drawScaleBar(ctx, colors, { x, y, k, maxPx }) {
  const len = niceFloor(maxPx / k);
  if (!len) return;
  const px = len * k;
  ctx.strokeStyle = colors.fg;
  ctx.fillStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 6);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 6);
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(lengthLabel(len), x, y - 8);
}

/* ---------- Small line charts (graphs drawn on a sim canvas) ---------- */

/** Tick label without float noise: 0.30000000000000004 → "0.3", −0 → "0". */
export const tickLabel = (v) => (Math.abs(v) < 1e-12 ? '0' : String(Number(v.toPrecision(6))));

/**
 * Line chart inside the plot box `box` = { x, y, w, h } (CSS px). Labels are
 * drawn outside the box, so leave about 44 px to its left, 22 px above (title)
 * and 20 px below (x tick labels).
 *   xr, yr         [min, max] axis ranges; a zero line is drawn when yr spans 0
 *   series         [{ points: [[x, y], ...], color, width = 2, dash = null, alpha = 1 }]
 *   title          text above the box, e.g. 'Velocity (m/s)'
 *   xLabel         text under the x axis on the right, e.g. 'time (s)'
 *   marker         optional x for a vertical "now" line
 *   xFmt, yFmt     tick label formatters
 * Ticks use the 1-2-5 step that gives about yTicks / xTicks divisions.
 * Returns the mapping { X, Y } (data → CSS px) for extra annotations.
 */
export function drawChart(ctx, colors, {
  box, xr, yr, series = [], title = '', xLabel = '', marker = null,
  xTicks = 6, yTicks = 4, xFmt = tickLabel, yFmt = tickLabel,
}) {
  const { x, y, w, h } = box;
  const X = (v) => x + ((v - xr[0]) / (xr[1] - xr[0])) * w;
  const Y = (v) => y + h - ((v - yr[0]) / (yr[1] - yr[0])) * h;
  ctx.save();
  ctx.font = FONT;
  ctx.lineWidth = 1;

  // Grid + tick labels (1-2-5 steps)
  const ys = niceStep((yr[1] - yr[0]) / yTicks);
  const xs = niceStep((xr[1] - xr[0]) / xTicks);
  ctx.strokeStyle = colors.track;
  ctx.fillStyle = colors.muted;
  ctx.globalAlpha = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = Math.ceil(yr[0] / ys - 1e-9); i * ys <= yr[1] + ys * 1e-9; i++) {
    const v = i * ys;
    const py = Y(v);
    ctx.globalAlpha = i === 0 ? 0.9 : 0.35;
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x + w, py);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(yFmt(v), x - 6, py);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = Math.ceil(xr[0] / xs - 1e-9); i * xs <= xr[1] + xs * 1e-9; i++) {
    const v = i * xs;
    const px = X(v);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + h);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(xFmt(v), px, y + h + 4);
  }

  // Axes
  ctx.strokeStyle = colors.muted;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w, y + h);
  ctx.stroke();

  // Title and x label
  ctx.fillStyle = colors.fg;
  ctx.font = FONT_BOLD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  if (title) ctx.fillText(title, x, y - 6);
  ctx.font = FONT;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  if (xLabel) ctx.fillText(xLabel, x + w, y - 6);

  // Series, clipped to the box
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - 2, w, h + 4);
  ctx.clip();
  for (const s of series) {
    if (!s.points?.length) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 2;
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    s.points.forEach(([px, py], i) => (i ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
    ctx.stroke();
  }
  ctx.restore();

  // "Now" marker
  if (marker !== null && marker >= xr[0] && marker <= xr[1]) {
    ctx.strokeStyle = colors.fg;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(X(marker), y);
    ctx.lineTo(X(marker), y + h);
    ctx.stroke();
  }
  ctx.restore();
  return { X, Y };
}
