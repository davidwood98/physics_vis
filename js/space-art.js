/**
 * space-art.js: procedural pictures for the space simulator (no page state).
 *
 *  - starfieldTile(): a repeating tile of background stars. DECORATIVE: the
 *    stars are random, not real positions, and the page says so.
 *  - buildMilkyWay(): a top-down picture of the Galaxy drawn from published
 *    measurements: the spiral-arm model of Reid et al. (2019) and the long bar
 *    of Wegg et al. (2015) (numbers in data/milkyway.js). Colours, glow and the
 *    star-forming knots are artistic.
 *  - galaxyKind() + galaxySprite(): small artist's impressions of other galaxies
 *    chosen from each galaxy's catalogued morphological type.
 *
 * All images are made once and cached by the caller; nothing here runs per frame
 * except the cheap lookups.
 */

import { armRadiusKpc } from './astro.js';

const TAU = Math.PI * 2;

/** Small seeded random generator (mulberry32), so pictures are the same on every visit. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of a string (for per-galaxy orientation and variant). */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function glow(g, x, y, r, rgb, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(${rgb}, ${a})`);
  gr.addColorStop(1, `rgba(${rgb}, 0)`);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
}

/* ---------- Background stars (decorative) ---------- */

const STAR_TINTS = ['255, 255, 255', '255, 244, 225', '214, 228, 255', '255, 226, 196', '200, 216, 255'];

/**
 * A size × size (device px) tile of random stars. count controls density.
 * Most stars are faint single pixels; a few are brighter with a soft halo.
 */
export function starfieldTile(seed, count, size = 512) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * size;
    const y = r() * size;
    const m = r() ** 3; // mostly faint
    const tint = STAR_TINTS[Math.floor(r() * STAR_TINTS.length)];
    if (m > 0.55) glow(g, x, y, 2.5 + 3 * m, tint, 0.25 * m);
    g.fillStyle = `rgba(${tint}, ${0.25 + 0.75 * m})`;
    const s = 0.7 + 1.3 * m;
    g.fillRect(x - s / 2, y - s / 2, s, s);
  }
  return c;
}

/* ---------- The Milky Way (model-based picture) ---------- */

/**
 * Picture of the Galaxy seen from the north Galactic pole, size × size px,
 * covering a disc halfSizeKpc in radius around the Galactic centre at the
 * middle. Orientation: "down" points to the Sun (β = 0) and β increases
 * clockwise on the canvas (the direction of Galactic rotation in this view).
 */
export function buildMilkyWay({ arms, bar, halfSizeKpc, size = 2048 }) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const R = size / 2;
  const s = R / halfSizeKpc; // px per kpc
  const r = rng(20191009);
  g.translate(R, R);
  const pos = (rKpc, betaDeg) => {
    const th = Math.PI / 2 + (betaDeg * Math.PI) / 180;
    return [rKpc * s * Math.cos(th), rKpc * s * Math.sin(th)];
  };

  // Old-star disc: an exponential-looking glow (artistic).
  let gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  gr.addColorStop(0, 'rgba(255, 232, 196, 0.55)');
  gr.addColorStop(0.1, 'rgba(255, 222, 180, 0.32)');
  gr.addColorStop(0.35, 'rgba(190, 200, 240, 0.12)');
  gr.addColorStop(0.75, 'rgba(150, 170, 230, 0.04)');
  gr.addColorStop(1, 'rgba(150, 170, 230, 0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, R, 0, TAU);
  g.fill();

  // Spiral arms from the published model; the parts covered by the parallax data
  // are brighter, the extrapolations beyond them fade out.
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const gauss = () => (r() + r() + r() - 1.5) / 1.5;
  for (const arm of arms) {
    const [b0, b1] = arm.betaRange;
    const w = Math.max(arm.width * 2, 0.4) * s; // about 2 sigma wide
    // Sample the arm; parts beyond the parallax data fade out (extrapolation).
    // Beyond the measured stretch the same model is continued round the far side of the Galaxy,
    // fainter (extrapolation, as in Reid et al.'s own sketch of the full Galaxy).
    const pts = [];
    for (let b = b0 - 140; b <= b1 + 220; b += 0.5) {
      const rk = armRadiusKpc(arm, b);
      if (rk < 2.4 || rk > halfSizeKpc * 0.97) continue;
      const fade = b < b0 ? 0.55 * (1 - (b0 - b) / 140) : b > b1 ? 0.55 * (1 - (b - b1) / 220) : 1;
      pts.push([...pos(rk, b), Math.max(0, fade), b >= b0 && b <= b1]);
    }
    // Smooth glowing ribbon: three passes (wide halo, body, bright core), in short segments so alpha can fade.
    for (const [lw, a, rgb] of [[2.4, 0.03, '150, 175, 255'], [1, 0.055, '175, 200, 255'], [0.3, 0.08, '225, 232, 255']]) {
      g.lineWidth = w * lw;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0, f0] = pts[i - 1];
        const [x1, y1, f1] = pts[i];
        if (Math.hypot(x1 - x0, y1 - y0) > w * 4) continue;
        g.strokeStyle = `rgba(${rgb}, ${a * (f0 + f1) / 2})`;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    }
    // Stars and star-forming knots scattered along the arm (artistic texture).
    for (const [x, y, fade, inData] of pts) {
      for (let k = 0; k < 3; k++) {
        if (r() > 0.8 * fade) continue;
        g.fillStyle = `rgba(240, 244, 255, ${0.35 + 0.4 * r()})`;
        const sz = 0.8 + r() * 1.4;
        g.fillRect(x + gauss() * w, y + gauss() * w, sz, sz);
      }
      if (inData && r() < 0.05) glow(g, x + gauss() * w * 0.6, y + gauss() * w * 0.6, w * 0.3, '255, 140, 190', 0.3);
    }
  }

  // The long bar: half-length and angle from the published fit; near end at positive β.
  g.globalCompositeOperation = 'source-over';
  g.save();
  const a = Math.PI / 2 + (bar.angleDeg * Math.PI) / 180;
  g.rotate(a);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, bar.halfLengthKpc * s);
  gr.addColorStop(0, 'rgba(255, 238, 205, 0.85)');
  gr.addColorStop(0.5, 'rgba(255, 222, 175, 0.35)');
  gr.addColorStop(1, 'rgba(255, 215, 165, 0)');
  g.fillStyle = gr;
  g.scale(1, 0.3);
  g.beginPath();
  g.arc(0, 0, bar.halfLengthKpc * s, 0, TAU);
  g.fill();
  g.restore();
  glow(g, 0, 0, 1.4 * s, '255, 242, 215', 0.9); // central bulge
  return c;
}

/* ---------- Other galaxies (artist's impressions by type) ---------- */

/**
 * Picture type from catalogue morphology. tType is the numerical (de
 * Vaucouleurs) type; morph is McConnachie's MType or Karachentsev's dwarf class.
 */
export function galaxyKind(tType, morph = '') {
  const m = morph.toLowerCase();
  if (/sph|\bde\b|^de|^tr|dsph|de\/|des/.test(m)) return 'dwarf';
  if (/^ce|^e[0-9]?$|^e\b/.test(m)) return 'elliptical';
  if (/irr|^im|^ir|bcd|dirr|hicld/.test(m)) return 'irregular';
  if (/S\(B\)|SB/.test(morph)) return 'barred'; // case matters: "Sb" is an ordinary spiral
  if (/^s[abcd]|^sm/.test(m)) return 'spiral';
  if (tType === null || tType === undefined) return 'blob';
  if (tType <= -4) return 'elliptical';
  if (tType <= 0) return 'lenticular';
  if (tType <= 8) return 'spiral';
  return 'irregular';
}

/** Short description of a kind, for info cards and captions. */
export const KIND_WORDS = {
  spiral: 'spiral galaxy', barred: 'barred spiral galaxy', elliptical: 'elliptical galaxy', lenticular: 'lenticular galaxy',
  irregular: 'irregular galaxy', dwarf: 'dwarf spheroidal or dwarf elliptical galaxy', blob: 'galaxy (type not catalogued)',
};

const spriteCache = new Map();

/** 256 px sprite for a galaxy kind and variant (0-2); the galaxy fills the inner ~92%. */
export function galaxySprite(kind, variant = 0) {
  const key = `${kind}-${variant}`;
  let c = spriteCache.get(key);
  if (c) return c;
  const S = 256;
  c = canvas(S);
  const g = c.getContext('2d');
  const r = rng(hashString(key));
  const R = S * 0.46;
  g.translate(S / 2, S / 2);
  switch (kind) {
    case 'spiral':
    case 'barred': {
      glow(g, 0, 0, R, '170, 190, 255', 0.25);
      g.globalCompositeOperation = 'lighter';
      const armsN = kind === 'barred' ? 2 : 2 + (variant % 2) * 2;
      const pitch = (14 + variant * 5) * (Math.PI / 180);
      const r0 = kind === 'barred' ? R * 0.28 : R * 0.12;
      for (let k = 0; k < armsN; k++) {
        const th0 = (k * TAU) / armsN;
        for (let rr = r0; rr < R * 0.98; rr *= 1.012) {
          const th = th0 + Math.log(rr / r0) / Math.tan(pitch);
          const x = rr * Math.cos(th);
          const y = rr * Math.sin(th);
          const fade = 1 - rr / R;
          glow(g, x, y, R * (0.05 + 0.07 * fade), '175, 200, 255', 0.13 * fade + 0.03);
          if (r() < 0.12) glow(g, x + (r() - 0.5) * 8, y + (r() - 0.5) * 8, 3 + r() * 3, '255, 150, 200', 0.5);
        }
      }
      g.globalCompositeOperation = 'source-over';
      if (kind === 'barred') {
        g.save();
        g.scale(1, 0.32);
        glow(g, 0, 0, r0 * 1.1, '255, 232, 195', 0.75);
        g.restore();
      }
      glow(g, 0, 0, R * 0.22, '255, 236, 200', 0.9);
      break;
    }
    case 'elliptical':
      glow(g, 0, 0, R, '255, 226, 185', 0.35);
      glow(g, 0, 0, R * 0.5, '255, 232, 200', 0.6);
      glow(g, 0, 0, R * 0.15, '255, 244, 225', 0.9);
      break;
    case 'lenticular':
      glow(g, 0, 0, R, '255, 228, 190', 0.25);
      g.save();
      g.scale(1, 0.55);
      glow(g, 0, 0, R * 0.9, '235, 225, 210', 0.35);
      g.restore();
      glow(g, 0, 0, R * 0.25, '255, 240, 215', 0.9);
      break;
    case 'irregular':
      glow(g, 0, 0, R * 0.9, '170, 195, 255', 0.18);
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 26; k++) {
        const rr = R * 0.75 * Math.sqrt(r());
        const th = r() * TAU;
        glow(g, rr * Math.cos(th), rr * Math.sin(th) * 0.7, R * (0.12 + 0.2 * r()), '180, 205, 255', 0.16);
        if (r() < 0.35) glow(g, rr * Math.cos(th), rr * Math.sin(th) * 0.7, 3 + 4 * r(), '255, 150, 200', 0.45);
      }
      g.globalCompositeOperation = 'source-over';
      break;
    case 'dwarf':
      glow(g, 0, 0, R, '230, 225, 215', 0.22);
      glow(g, 0, 0, R * 0.45, '240, 235, 225', 0.25);
      break;
    default:
      glow(g, 0, 0, R, '200, 200, 230', 0.35);
  }
  spriteCache.set(key, c);
  return c;
}

/** Orientation for a galaxy picture: angle (rad), and flattening for discs (top views of tilted discs). */
export function galaxyPose(name, kind) {
  const r = rng(hashString(name));
  const angle = r() * TAU;
  const disc = kind === 'spiral' || kind === 'barred' || kind === 'lenticular';
  const squash = disc ? 0.4 + 0.6 * r() : kind === 'elliptical' ? 0.65 + 0.35 * r() : 0.75 + 0.25 * r();
  return { angle, squash, variant: Math.floor(r() * 3) };
}
