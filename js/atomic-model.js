/**
 * atomic-model.js: pure maths for the atomic-scale pages (atom.html and
 * atomic-ladder.html). No DOM access, SI units (metres, kilograms) unless a
 * name says otherwise; unit tested in /tests/atom.test.html and
 * /tests/atomic-ladder.test.html.
 *
 * Definitions used throughout (atoms and nuclei have no hard edge):
 *   atom diameter     2 × the free-atom radius of Rahm, Hoffmann & Ashcroft (2016): the
 *                     distance where the electron density falls to 0.001 electrons per bohr³
 *   nucleus diameter  2 × the rms charge radius (Angeli & Marinova 2013; CODATA for the proton)
 *   quark, electron   no measured size: only experimental upper limits on their radius
 *
 * Contents
 *   1. Elements: the joined data table
 *   2. Atom = 1 cm: magnification, nucleus at that scale, volume and mass shares
 *   3. Hydrogen 1s electron density (exact) and the cloud brightness used for drawing
 *   4. Solids: nearest-neighbour spacing and atoms along a line
 *   5. Proton = 1 cm: atoms at that scale, the quark limit, the mass budget
 *   6. Screen pixels and the atomic-scale ladder (positions, stops, readouts)
 *   7. Formatting for very small lengths and very large ratios
 */

import {
  CODATA, PDG_QUARKS, LIMITS, LATTICES, LIFE,
  ATOM_RADII_ANGSTROM, SYMBOLS, NAMES, NUCLEI,
} from './data/atomic-data.js';
import { PIXEL_REFERENCES } from './data/references.js';
import { sig, sigT, sci, sigWords, metresPerPx, tFromMetresPerPx, clamp } from './astro.js';
import { niceFloor } from './physics.js';

/* =========================================================================
 * 1. Elements
 * ====================================================================== */

export const ANGSTROM = 1e-10;
export const FEMTOMETRE = 1e-15;
/** Iso-density that defines the free-atom radius (electrons per bohr³). */
export const EDGE_DENSITY_PER_BOHR3 = 0.001;
export const BOHR_RADIUS = CODATA.bohrRadius;

/** Free-atom radius (m) for atomic number z = 1..96. */
export const atomRadiusOfZ = (z) => ATOM_RADII_ANGSTROM[z - 1] * ANGSTROM;

/**
 * Every element with a radius, a measured nuclear charge radius and an atomic mass:
 * { z, symbol, name, A, N, atomRadius, nucleusRadius (rms), massU, abundance, lattice }.
 */
export const ELEMENTS = NUCLEI.map(([z, A, rmsFm, massU, abundance]) => ({
  z,
  symbol: SYMBOLS[z - 1],
  name: NAMES[z - 1],
  A,
  N: A - z,
  atomRadius: atomRadiusOfZ(z),
  nucleusRadius: rmsFm * FEMTOMETRE,
  massU,
  abundance,
  lattice: LATTICES[SYMBOLS[z - 1]] || null,
}));
const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));
export const elementBySymbol = (s) => BY_SYMBOL.get(s) || null;

export const atomDiameter = (el) => 2 * el.atomRadius;
export const nucleusDiameter = (el) => 2 * el.nucleusRadius;

/** Smallest and largest free-atom radius in the whole Z = 1-96 table, and their ratio. */
export function atomRadiusRange() {
  let min = { r: Infinity, z: 0 };
  let max = { r: 0, z: 0 };
  ATOM_RADII_ANGSTROM.forEach((a, i) => {
    const r = a * ANGSTROM;
    if (r < min.r) min = { r, z: i + 1 };
    if (r > max.r) max = { r, z: i + 1 };
  });
  return { min, max, ratio: max.r / min.r };
}

/* =========================================================================
 * 2. Atom = 1 cm
 * ====================================================================== */

/** How many times bigger than life an object of size `sizeM` is when drawn `screenM` across. */
export const magnification = (sizeM, screenM = 0.01) => screenM / sizeM;

/** Size on screen (m) of a world length when the atom is drawn 1 cm across. */
export const atAtomScale = (el, lengthM, atomScreenM = 0.01) => lengthM * magnification(atomDiameter(el), atomScreenM);

/** The nucleus at the scale where the atom is 1 cm: metres on screen. */
export const nucleusAtAtomScale = (el, atomScreenM = 0.01) => atAtomScale(el, nucleusDiameter(el), atomScreenM);

/** Fraction of the atom's volume taken by the nucleus: (r_nucleus / r_atom)³. */
export const nuclearVolumeFraction = (el) => (el.nucleusRadius / el.atomRadius) ** 3;

/**
 * Fraction of the atom's mass in its nucleus: 1 − Z·mₑ / m(atom), both in u.
 * The electrons' binding energy (a few parts per million for heavy atoms) is ignored.
 */
export const nucleusMassShare = (el) => 1 - (el.z * CODATA.electronMassU) / el.massU;

/**
 * Magnifications of a zoom cascade (relative to the true-size drawing): insets
 * each `step` (100) times the one before while the nucleus would still fit
 * (under 60% of a boxPx-wide inset), then one last 1-2-5 step chosen so the
 * nucleus spans about half of the final inset. nucleusPx = nucleus size in px
 * in the true-size drawing.
 */
export function cascadeMagnifications(nucleusPx, boxPx, { step = 100, fill = 0.5, maxInsets = 6 } = {}) {
  const out = [];
  let m = 1;
  while (out.length < maxInsets - 1 && nucleusPx * m * step <= 0.6 * boxPx) {
    m *= step;
    out.push(m);
  }
  if (nucleusPx * m < 0.12 * boxPx) {
    m *= Math.max(2, niceFloor((fill * boxPx) / (nucleusPx * m)));
    out.push(m);
  }
  return out;
}

/** Least-squares r₀ in r = r₀ A^(1/3) (fit in log space) for a list of { A, nucleusRadius }. */
export function fitR0(list) {
  const mean = list.reduce((s, e) => s + Math.log(e.nucleusRadius) - Math.log(e.A) / 3, 0) / list.length;
  return Math.exp(mean);
}

/* =========================================================================
 * 3. Hydrogen 1s density and cloud brightness
 * ====================================================================== */

/** Exact hydrogen 1s electron density (electrons per m³) at radius r: e^(−2r/a₀) / (π a₀³). */
export const hydrogen1sDensity = (r) => Math.exp((-2 * r) / BOHR_RADIUS) / (Math.PI * BOHR_RADIUS ** 3);

/** Same density in electrons per bohr³. */
export const hydrogen1sDensityPerBohr3 = (r) => hydrogen1sDensity(r) * BOHR_RADIUS ** 3;

/** Radius (m) where the exact 1s density equals rho (electrons per bohr³): r = −(a₀/2) ln(π ρ). */
export const hydrogenRadiusAtDensity = (rhoPerBohr3) => (-BOHR_RADIUS / 2) * Math.log(Math.PI * rhoPerBohr3);

/** Fraction of the 1s electron found inside radius r: 1 − e^(−2x)(1 + 2x + 2x²), x = r/a₀. */
export function hydrogenFractionInside(r) {
  const x = r / BOHR_RADIUS;
  return 1 - Math.exp(-2 * x) * (1 + 2 * x + 2 * x * x);
}

/** Density relative to the centre for hydrogen 1s: e^(−2r/a₀). */
export const hydrogenRelativeDensity = (r) => Math.exp((-2 * r) / BOHR_RADIUS);

/** The 1s decay length expressed as a fraction of hydrogen's free-atom radius (a₀ / r_H ≈ 0.34). */
export const HYDROGEN_SHAPE = BOHR_RADIUS / atomRadiusOfZ(1);

/**
 * Relative density of the drawn cloud at radius r for an atom of radius R:
 * hydrogen's exact 1s shape stretched to that atom's edge, e^(−2 (r/R) / 0.34).
 * Exact for hydrogen (R = r_H); an illustration for other atoms (no inner shells).
 */
export const cloudRelativeDensity = (r, R) => Math.exp((-2 * (r / R)) / HYDROGEN_SHAPE);

/** Brightness used to draw a cloud: density compressed with a power (γ) so faint outer parts show. */
export const CLOUD_GAMMA = 0.35;
export const cloudBrightness = (relDensity) => Math.max(0, relDensity) ** CLOUD_GAMMA;

/* =========================================================================
 * 4. Solids
 * ====================================================================== */

const ATOMS_PER_CELL = { fcc: 4, diamond: 8 };

/** Nearest-neighbour distance: fcc a/√2, diamond a√3/4. */
export function nearestNeighbour(lat) {
  if (lat.structure === 'fcc') return lat.a / Math.SQRT2;
  if (lat.structure === 'diamond') return (lat.a * Math.sqrt(3)) / 4;
  throw new Error(`unknown structure ${lat.structure}`);
}

/** Average atoms per metre along a line through the crystal: (atoms per volume)^(1/3). */
export const atomsPerMetre = (lat) => Math.cbrt(ATOMS_PER_CELL[lat.structure] / lat.a ** 3);

/** Average atom-to-atom spacing along a line: 1 / atomsPerMetre (silicon: a/2). */
export const meanSpacing = (lat) => 1 / atomsPerMetre(lat);

/** How many atoms of the crystal fit across a length L (on average). */
export const atomsAcross = (L, lat) => L * atomsPerMetre(lat);

/**
 * In-plane positions (m) of n neighbouring atoms in a straight chain of nearest neighbours:
 *  fcc: along [110], a straight row at a/√2;
 *  diamond: the zig-zag bond chain along [110] in a (1−10) plane: steps of a/(2√2)
 *  along the chain, alternating a/4 across it (bond length a√3/4).
 * Returns [{ x, y }] centred on the middle atom.
 */
export function neighbourChain(lat, n = 7) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    if (lat.structure === 'fcc') pts.push({ x: i * nearestNeighbour(lat), y: 0 });
    else pts.push({ x: (i * lat.a) / (2 * Math.SQRT2), y: i % 2 ? lat.a / 4 : 0 });
  }
  const mx = (pts[0].x + pts[n - 1].x) / 2;
  const my = lat.structure === 'fcc' ? 0 : lat.a / 8;
  return pts.map((p) => ({ x: p.x - mx, y: p.y - my }));
}

/* =========================================================================
 * 5. Proton = 1 cm
 * ====================================================================== */

export const PROTON_DIAMETER = 2 * CODATA.protonRadius;
/** Upper limits on size (diameter = 2 × the radius limit). */
export const QUARK_LIMIT_DIAMETER = 2 * LIMITS.quarkRadius;
export const ELECTRON_LIMIT_DIAMETER = 2 * LIMITS.electronRadius;

/** Size on screen (m) of a world length when the proton is drawn 1 cm across. */
export const atProtonScale = (lengthM, protonScreenM = 0.01) => lengthM * magnification(PROTON_DIAMETER, protonScreenM);

/** The three valence quarks (uud) of a proton: summed MS-bar masses, MeV. */
export const valenceQuarkMassMeV = () => 2 * PDG_QUARKS.upMeV + PDG_QUARKS.downMeV;

/** Fraction of the proton's mass that the valence quark masses account for. */
export const valenceMassFraction = () => valenceQuarkMassMeV() / CODATA.protonMassMeV;

/* =========================================================================
 * 6. Pixels and the ladder
 * ====================================================================== */

/** Physical pixel pitch (m) of a screen: diagonal (inches) × 0.0254 / diagonal in pixels. */
export const pixelPitchForScreen = (diagIn, resW, resH) => (diagIn * 0.0254) / Math.hypot(resW, resH);
/** The site's default screen: 24″ 1920 × 1080 (1 px ≈ 0.277 mm). */
export const DEFAULT_PITCH = pixelPitchForScreen(24, 1920, 1080);

/** Typical size of a pixel-card reference (its cited typical value, else the middle of its range). */
const refSize = (id) => {
  const r = PIXEL_REFERENCES.find((x) => x.id === id);
  return r.typicalM ?? Math.sqrt(r.rangeM[0] * r.rangeM[1]);
};
const refSource = (id) => PIXEL_REFERENCES.find((x) => x.id === id).source;

const GOLD = elementBySymbol('Au');
const VIRUS_D = Math.sqrt(LIFE.virus.rangeM[0] * LIFE.virus.rangeM[1]);
const SPIKE_L = Math.sqrt(LIFE.virus.spikeM[0] * LIFE.virus.spikeM[1]);

/**
 * The objects on the ladder, largest first. size = the framing length (m);
 * w = extent along the line-up; noSize = no measured size (drawn as a marker).
 * Positions come from ladderLayout().
 */
export function ladderObjects(pitch) {
  const L = (m) => formatLength(m, 3);
  const hairRef = PIXEL_REFERENCES.find((x) => x.id === 'hair');
  const rbcRef = PIXEL_REFERENCES.find((x) => x.id === 'rbc');
  const { ecoli, virus, dna } = LIFE;
  return [
    { id: 'pixel', kind: 'pixel', name: 'One screen pixel', size: pitch, w: pitch,
      fact: `One pixel of your screen at true size, ${L(pitch)} across. Everything on this journey, down to a quark, is smaller than it.`,
      source: 'Your screen calibration' },
    { id: 'hair', kind: 'hair', name: 'Human hair', size: refSize('hair'), w: refSize('hair'),
      fact: `A typical hair is ${L(hairRef.typicalM)} thick (measured hairs range from ${L(hairRef.rangeM[0])} to ${L(hairRef.rangeM[1])}).`,
      source: refSource('hair') },
    { id: 'rbc', kind: 'rbc', name: 'Red blood cell', size: refSize('rbc'), w: refSize('rbc'),
      fact: `A biconcave disc ${L(rbcRef.rangeM[0])} to ${L(rbcRef.rangeM[1])} across, drawn at ${L(refSize('rbc'))}: the commonest cell in blood.`,
      source: refSource('rbc') },
    { id: 'ecoli', kind: 'rod', name: 'Bacterium (E. coli)', size: ecoli.lengthM, w: ecoli.lengthM, h: ecoli.diameterM,
      fact: `A rod about ${L(ecoli.lengthM)} long and ${L(ecoli.diameterM)} wide.`,
      source: ecoli.source },
    { id: 'virus', kind: 'virus', name: 'Virus (SARS-CoV-2)', size: VIRUS_D, w: VIRUS_D + 2 * SPIKE_L, spike: SPIKE_L,
      fact: `Particles ${L(virus.rangeM[0])} to ${L(virus.rangeM[1])} across with spikes ${L(virus.spikeM[0])} to ${L(virus.spikeM[1])} long, drawn at the middle of each range (${L(VIRUS_D)}, ${L(SPIKE_L)}).`,
      source: virus.source },
    // A short stretch of 40 turns is drawn (real DNA molecules are far longer).
    { id: 'dna', kind: 'dna', name: 'DNA double helix', size: dna.diameterM, w: dna.diameterM, h: 40 * dna.turnM, turn: dna.turnM, rise: dna.riseM,
      fact: `B-form DNA is about ${L(dna.diameterM)} wide; the helix turns once every ${L(dna.turnM)}, ${sigT(dna.riseM * 1e9, 2)} nm per base pair. A short stretch is drawn: real DNA molecules are far longer.`,
      source: dna.source },
    { id: 'atom', kind: 'cloud', name: 'Gold atom', size: atomDiameter(GOLD), w: atomDiameter(GOLD),
      fact: `The electron cloud of a free gold atom, ${L(atomDiameter(GOLD))} across, edged where its density falls to ${EDGE_DENSITY_PER_BOHR3} electrons per bohr³. The electrons are spread through the cloud and have no measured size.`,
      source: 'Rahm, Hoffmann & Ashcroft 2016, Chem. Eur. J. 22, 14625 (with the 2017 corrigendum)' },
    { id: 'nucleus', kind: 'nucleus', name: 'Gold-197 nucleus', size: nucleusDiameter(GOLD), w: nucleusDiameter(GOLD),
      fact: `${GOLD.z} protons and ${GOLD.N} neutrons, ${L(nucleusDiameter(GOLD))} across (twice its rms charge radius), at the centre of the atom.`,
      source: 'Angeli & Marinova 2013, At. Data Nucl. Data Tables 99, 69 (IAEA)' },
    { id: 'proton', kind: 'proton', name: 'Proton', size: PROTON_DIAMETER, w: PROTON_DIAMETER,
      fact: `A hydrogen nucleus: a fuzzy region of quarks and gluons, ${L(PROTON_DIAMETER)} across (twice its rms charge radius).`,
      source: CODATA.source },
    { id: 'quark', kind: 'limit', name: 'Quark-size limit', size: QUARK_LIMIT_DIAMETER, w: QUARK_LIMIT_DIAMETER, noSize: true,
      fact: `Quarks have no measured size. If they have one, it is smaller than this circle: radius under ${sci(LIMITS.quarkRadius, 2)} m (95% confidence).`,
      source: LIMITS.quarkSource },
  ];
}

/**
 * Positions (m) of the ladder objects. The big objects stand in a line along +x,
 * each roughly one of its own sizes from the origin and never overlapping the
 * next smaller one; the gold nucleus sits at the centre of the gold atom, the
 * proton just beside the nucleus, and the quark-limit circle on one of the
 * proton's quark markers. Returns the objects with { x, y } added.
 */
export const QUARK_MARK = { x: -0.22, y: 0.1 }; // a quark marker, in proton diameters from its centre
export function ladderLayout(pitch) {
  const objs = ladderObjects(pitch);
  const by = Object.fromEntries(objs.map((o) => [o.id, o]));
  const line = ['atom', 'dna', 'virus', 'ecoli', 'rbc', 'hair', 'pixel'];
  let prev = null;
  for (const id of line) {
    const o = by[id];
    o.y = 0;
    o.x = prev ? Math.max(o.size, prev.x + prev.w / 2 + 0.3 * o.size + o.w / 2) : o.size;
    prev = o;
  }
  by.nucleus.x = by.atom.x;
  by.nucleus.y = 0;
  by.proton.x = by.nucleus.x + by.nucleus.w / 2 + 1.2 * by.proton.w;
  by.proton.y = 0;
  by.quark.x = by.proton.x + QUARK_MARK.x * by.proton.w;
  by.quark.y = by.proton.y + QUARK_MARK.y * by.proton.w;
  return objs;
}

/** How much of the canvas's shorter side each stop's object fills. */
const FRAME_FRACTION = { hair: 0.3, rbc: 0.55, ecoli: 0.55, virus: 0.5, dna: 0.18, atom: 0.6, nucleus: 0.4, proton: 0.45, quark: 0.25 };
const STOP_LABEL = {
  pixel: '1 pixel (1:1)', hair: 'Human hair', rbc: 'Red blood cell', ecoli: 'Bacterium', virus: 'Virus',
  dna: 'DNA', atom: 'Gold atom', nucleus: 'Gold nucleus', proton: 'Proton', quark: 'Quark limit',
};

/**
 * Rail stops for a screen: { id, label, log (log10 metres per device px), cam: { x, y } }.
 * The first stop is the true-size screen pixel (metres per px = pitch); the others
 * frame their object on the canvas's shorter side (device px).
 */
export function ladderStops(objs, pitch, shortDevPx) {
  return objs.map((o) => ({
    id: o.id,
    label: STOP_LABEL[o.id],
    log: Math.log10(o.id === 'pixel' ? pitch : o.size / (FRAME_FRACTION[o.id] * Math.max(1, shortDevPx))),
    cam: { x: o.x, y: o.y },
  }));
}

/**
 * The view at rail position s (fractional stop index), for stops from ladderStops().
 * Between stops a and b the scale (metres per device px) is log-linear, through
 * astro.js's metresPerPx / tFromMetresPerPx with far = the true pixel and near =
 * the last stop (so t = 1 is exactly true size). The camera zooms about the one
 * world point F that stays put on screen and ends on b's centre:
 *   cam = F + (cam_a − F)·(mpp / mpp_a),  F = (cam_b − ρ·cam_a) / (1 − ρ),  ρ = mpp_b / mpp_a.
 * Returns { mpp, t, cam, i, fr } (i = segment, fr = fraction along it).
 */
export function ladderView(stops, s, pitch) {
  const last = stops.length - 1;
  const ss = clamp(s, 0, last);
  const i = Math.min(last - 1, Math.floor(ss));
  const fr = ss - i;
  const a = stops[i];
  const b = stops[i + 1];
  const lim = { near: 10 ** stops[last].log, far: pitch };
  let t = clamp(tFromMetresPerPx(10 ** (a.log + (b.log - a.log) * fr), lim), 0, 1);
  if (ss <= 1e-9) t = 1;
  const mpp = metresPerPx(t, lim);
  let cam;
  if (fr <= 1e-12) cam = { ...a.cam };
  else if (fr >= 1 - 1e-12) cam = { ...b.cam };
  else {
    const rho = 10 ** (b.log - a.log);
    const f = mpp / 10 ** a.log;
    const F = (p, q) => (q - rho * p) / (1 - rho);
    const fx = F(a.cam.x, b.cam.x);
    const fy = F(a.cam.y, b.cam.y);
    cam = { x: fx + (a.cam.x - fx) * f, y: fy + (a.cam.y - fy) * f };
  }
  return { mpp, t, cam, i, fr };
}

/** Magnification relative to true size (1:1) at a given scale. */
export const ladderMagnification = (mpp, pitch) => pitch / mpp;

/** Silicon atoms spanned by one screen pixel at this scale (average spacing a/2). */
export const siliconAtomsPerPixel = (mpp) => atomsAcross(mpp, LATTICES.Si);

/* =========================================================================
 * 7. Formatting
 * ====================================================================== */

const UNITS = [
  { u: 'km', s: 1e3 }, { u: 'm', s: 1 }, { u: 'cm', s: 1e-2 }, { u: 'mm', s: 1e-3 },
  { u: 'µm', s: 1e-6 }, { u: 'nm', s: 1e-9 }, { u: 'pm', s: 1e-12 }, { u: 'fm', s: 1e-15 }, { u: 'am', s: 1e-18 },
];

/** Unit for a length: the largest of km … am whose size is <= the length (am below that). */
export function lengthUnit(m) {
  const a = Math.abs(m);
  return UNITS.find((x) => a >= x.s * (1 - 1e-12)) || UNITS[UNITS.length - 1];
}

/** "452 pm", "0.241 µm", "1.83 km", "0.86 am" (n significant figures, trailing zeros dropped). */
export function formatLength(m, n = 3) {
  if (!Number.isFinite(m)) return '∞';
  if (m === 0) return '0 m';
  const { u, s } = lengthUnit(m);
  return `${sigT(m / s, n)} ${u}`;
}

/** Pixels: "36.1 px", "0.25 px", "0.00087 px" (n significant figures). */
export const formatPx = (px, n = 2) => `${px >= 100 ? sig(px, 3) : sigT(px, n)} px`;

/** "about 1/1,150 of a pixel" for px < 1, else "2.4 pixels". */
export function pixelFraction(px) {
  if (px >= 1) return `${sigT(px, 2)} ${px < 1.5 ? 'pixel' : 'pixels'}`;
  return `about 1/${sigT(1 / px, 3)} of a pixel`;
}

/** Magnification for a badge: "×2,600" below a million, else "×2.6 × 10⁹". */
export function magnificationText(M) {
  if (M < 1e6) return `×${sig(M, 2)}`;
  return `×${sci(M, 2)}`;
}

/** Big ratio in words: "32 million", "5.9 trillion", "7.2 × 10¹³" beyond trillions. */
export const ratioWords = (x, n = 2) => sigWords(x, n);

/** Scale-bar length (m) and label: the longest 1-2-5 length that fits maxM. */
export function scaleBar(maxM) {
  const { u, s } = lengthUnit(maxM);
  const v = niceFloor(maxM / s);
  return { metres: v * s, label: `${sigT(v, 3)} ${u}` };
}
