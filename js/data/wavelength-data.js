/**
 * wavelength-data.js: cited reference data for the wavelength ruler (data only).
 *
 * Every value quotes its source in a comment and carries a `source` string shown
 * on the page. All sources retrieved 2026-10-07. Round figures on the page are
 * computed from these values (see js/wavelength-model.js and its unit tests).
 *
 * Exact definitions need no source: c = 299,792,458 m/s (SI), the ID-1 bank card
 * (85.60 mm, ISO/IEC 7810, kept in physics.js), 101.325 kPa standard atmosphere.
 */

import { PIXEL_REFERENCES } from './references.js';

/* ---------- Wave speeds ---------- */

// "speed of light in vacuum ... Numerical value 299 792 458 m s-1 ... Standard uncertainty (exact)":
// NIST CODATA, https://physics.nist.gov/cgi-bin/cuu/Value?c (retrieved 2026-10-07)
export const C_LIGHT = 299792458;
export const C_LIGHT_SOURCE = 'Speed of light, exact by definition (SI; NIST CODATA)';

/**
 * Speed of sound in humid air, Cramer (1993), J. Acoust. Soc. Am. 93, 2510, exactly as coded in
 * NPL's calculator: "computes the zero-frequency speed of sound in humid air according to Cramer
 * (J. Acoust. Soc. Am., 93, p2510, 1993), with saturation vapour pressure taken from Davis,
 * Metrologia, 29, p67, 1992, and a mole fraction of carbon dioxide of 0.0004. Range of validity:
 * ... temperature range 0 to 30 °C (273.15 - 303.15 K) and for the pressure range 75 - 102 kPa".
 * The coefficients below are copied from the page's script (C1, C2, C3, ENH, PSV1, PSV2).
 * NPL Technical Guide "Speed of sound in air", https://resource.npl.co.uk/acoustics/techguides/speedair/
 * (live site's TLS chain failed; read from the Internet Archive copy of 2024-12-13,
 * https://web.archive.org/web/20241213093739/http://resource.npl.co.uk/acoustics/techguides/speedair/ ,
 * retrieved 2026-10-07).
 */
export const AIR_CRAMER = {
  // C1 = 0.603055*T + 331.5024 - T²*5.28e-4 + (0.1495874*T + 51.471935 - T²*7.82e-4)*Xw
  c1: [331.5024, 0.603055, -5.28e-4],
  c1w: [51.471935, 0.1495874, -7.82e-4],
  // C2 = (-1.82e-7 + 3.73e-8*T - T²*2.93e-10)*P + (-85.20931 - 0.228525*T + T²*5.91e-5)*Xc
  c2p: [-1.82e-7, 3.73e-8, -2.93e-10],
  c2c: [-85.20931, -0.228525, 5.91e-5],
  // C3 = Xw²*2.835149 + P²*2.15e-13 - Xc²*29.179762 - 4.86e-4*Xw*P*Xc
  c3: { ww: 2.835149, pp: 2.15e-13, cc: -29.179762, wpc: -4.86e-4 },
  // ENH = 3.14e-8*P + 1.00062 + T²*5.6e-7 (enhancement factor, Davis 1992)
  enh: [1.00062, 3.14e-8, 5.6e-7],
  // PSV = exp(Tk²*1.2378847e-5 - 1.9121316e-2*Tk) * exp(33.93711047 - 6.3431645e3/Tk)
  psv: [1.2378847e-5, -1.9121316e-2, 33.93711047, -6.3431645e3],
  co2: 0.0004,          // "Xc = 400.0*Math.pow(10,-6)"
  tRangeC: [0, 30],     // "only valid over the temperature range 0 to 30 °C"
  pRangeKPa: [75, 102], // "and for the pressure range 75 - 102 kPa"
  source: 'Cramer (1993), J. Acoust. Soc. Am. 93, 2510, as implemented in NPL\'s "Speed of sound in air" calculator',
};

/** Standard atmosphere pressure, kPa (a definition). */
export const STANDARD_PRESSURE_KPA = 101.325;

/**
 * Speed of sound in pure water, Marczak (1997), J. Acoust. Soc. Am. 102, 2776, as coded on NPL's
 * "Speed of sound in pure water" page: "C = 1.402385 * Math.pow(10,3) + 5.038813 * T - 5.799136 *
 * Math.pow(10,-2) * sqr(T); C += 3.287156 * Math.pow(10,-4) * Math.pow(T,3) - 1.398845 *
 * Math.pow(10,-6) * Math.pow(T,4); C += 2.787860 * Math.pow(10,-9) * Math.pow(T,5)", and its
 * "Range of Validity ... Marczak 0 - 95 [°C] Atmospheric Only".
 * https://resource.npl.co.uk/acoustics/techguides/soundpurewater/ (read from the Internet Archive copy
 * of 2024-11-13, https://web.archive.org/web/20241113210619/http://resource.npl.co.uk/acoustics/techguides/soundpurewater/ ,
 * retrieved 2026-10-07).
 */
export const WATER_MARCZAK = {
  coeffs: [1.402385e3, 5.038813, -5.799136e-2, 3.287156e-4, -1.398845e-6, 2.787860e-9], // × T⁰…T⁵ (°C)
  tRangeC: [0, 95],
  source: 'Marczak (1997), J. Acoust. Soc. Am. 102, 2776, as given in NPL\'s "Speed of sound in pure water" guide',
};

/**
 * Independent check of the water formula (used by the unit tests): NIST Chemistry WebBook, water
 * along the 0.101325 MPa isobar, row "20.000 ... Sound Spd. (m/s) 1482.3" (IAPWS-95 formulation),
 * https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID=C7732185&Type=IsoBar&Digits=5&P=0.101325&THigh=99&TLow=1&TInc=1&RefState=DEF&TUnit=C&PUnit=MPa&DUnit=kg%2Fm3&HUnit=kJ%2Fmol&WUnit=m%2Fs&VisUnit=uPa*s&STUnit=N%2Fm
 * (retrieved 2026-10-07).
 */
export const NIST_WATER_CHECK = { tC: 20, speed: 1482.3, source: 'NIST Chemistry WebBook, Thermophysical Properties of Fluid Systems (water, IAPWS-95)' };

/**
 * Refractive index of air, NIST Engineering Metrology Toolbox, Table 1 row "20 0 101.325 633
 * 1.000271800" (20 °C, 0 % RH, 101.325 kPa, 633 nm, Ciddor equation),
 * https://emtoolbox.nist.gov/Wavelength/Documentation.asp (retrieved 2026-10-07).
 */
export const AIR_REFRACTIVE_INDEX = {
  n: 1.0002718,
  source: 'NIST Engineering Metrology Toolbox, "Refractive Index of Air Calculator" documentation, Table 1 (Ciddor equation)',
};

/* ---------- Ranges and bands ---------- */

// "Typically, the human eye can detect wavelengths from 380 to 700 nanometers.": NASA Science,
// "Visible Light", https://science.nasa.gov/ems/09_visiblelight/ (retrieved 2026-10-07).
// NIST's air-index guide agrees: "approximately 400 nm to 700 nm (0.4 µm to 0.7 µm)".
export const VISIBLE_RANGE = {
  minM: 380e-9,
  maxM: 700e-9,
  source: 'NASA Science, "Visible Light" (Tour of the Electromagnetic Spectrum)',
};

// "Normal human hearing encompasses frequencies from 20 to 20,000 Hz ... Sounds below 20 Hz are
// called infrasound, whereas those above 20,000 Hz are ultrasound.": OpenStax College Physics 2e,
// section 17.6 "Hearing", https://openstax.org/books/college-physics-2e/pages/17-6-hearing (retrieved 2026-10-07).
export const HEARING_RANGE = {
  minHz: 20,
  maxHz: 20000,
  source: 'OpenStax, College Physics 2e, section 17.6 "Hearing"',
};

/**
 * Named radio bands, edges in Hz.
 *  FM: "The FM broadcast band consists of that portion of the radio frequency spectrum between
 *      88 MHz and 108 MHz.": 47 CFR 73.201, https://www.ecfr.gov/current/title-47/part-73/section-73.201
 *  2.4 GHz Wi-Fi: "frequency hopping systems operating in the 2400-2483.5 MHz band": 47 CFR 15.247,
 *      https://www.ecfr.gov/current/title-47/part-15/section-15.247
 *  Microwave ovens (ISM): Table 1 to § 18.301 "ISM frequency ... 2450 MHz, Tolerance ± 50.0 MHz":
 *      47 CFR 18.301, https://www.ecfr.gov/current/title-47/part-18/section-18.301
 *  5 GHz Wi-Fi (U-NII): "in the band 5.15-5.25 GHz", "the 5.25-5.35 GHz band and the 5.47-5.725 GHz
 *      band", "For the band 5.725-5.850 GHz": 47 CFR 15.407,
 *      https://www.ecfr.gov/current/title-47/part-15/section-15.407
 * (all retrieved 2026-10-07 from the eCFR).
 */
export const BANDS = [
  { id: 'fm', name: 'FM radio band', lo: 88e6, hi: 108e6, source: '47 CFR 73.201 (US FCC rules, eCFR)' },
  { id: 'wifi24', name: '2.4 GHz Wi-Fi band', lo: 2400e6, hi: 2483.5e6, source: '47 CFR 15.247 (US FCC rules, eCFR)' },
  { id: 'ism', name: 'microwave-oven (ISM) band', lo: 2400e6, hi: 2500e6, centre: 2450e6, source: '47 CFR 18.301 (US FCC rules, eCFR)' },
  // U-NII-1 to U-NII-3: 5.15-5.25, 5.25-5.35, 5.47-5.725 and 5.725-5.850 GHz (5.35-5.47 GHz is not included).
  { id: 'wifi5', name: '5 GHz Wi-Fi bands', lo: 5150e6, hi: 5850e6,
    parts: [[5150e6, 5250e6], [5250e6, 5350e6], [5470e6, 5725e6], [5725e6, 5850e6]],
    source: '47 CFR 15.407 (US FCC rules, eCFR)' },
];

/* ---------- Devices and objects ---------- */

/**
 * 40 kHz ultrasonic transducer: Same Sky (formerly CUI Devices) CUSA-T75-18-2400-TH datasheet,
 * "frequency 40 kHz", "directivity 75 degree", "dimensions ø12.5 x 9.5 mm",
 * https://sameskydevices.com/product/resource/cusa-t75-18-2400-th.pdf (retrieved 2026-10-07).
 * The popular HC-SR04 module uses the same frequency: "the module will send out an 8 cycle burst of
 * ultrasound at 40 kHz"; module "Dimension 45*20*15mm": Elecfreaks HC-SR04 datasheet,
 * https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf (retrieved 2026-10-07).
 */
export const ULTRASONIC_SENSOR = {
  fHz: 40e3,
  canDiameterM: 12.5e-3,
  directivityDeg: 75,
  source: 'Same Sky CUSA-T75-18-2400-TH ultrasonic transmitter datasheet (2024); Elecfreaks HC-SR04 datasheet',
};

/**
 * Microwave-oven door mesh: "Metal lattices mostly used in household microwave appliances have round
 * holes arranged in a triangular pattern, which have a diameter of approx. 1.5 mm and are arranged
 * with a pitch of approx. 2.5 mm.": BSH Hausgeräte GmbH, US patent 11,528,784 B2, "Door for a
 * household microwave appliance" (2022), https://patents.google.com/patent/US11528784B2/en (retrieved 2026-10-07).
 */
export const DOOR_MESH = {
  holeM: 1.5e-3,
  pitchM: 2.5e-3,
  source: 'BSH Hausgeräte, US patent 11,528,784 B2, "Door for a household microwave appliance" (2022)',
};

/**
 * Circular waveguide cut-off. TE₁₁ is the lowest mode ("It turns out that the lowest mode in a
 * circular waveguide is the TE11 mode") with cut-off wavelength λc = 2πa / p′ₙₘ, p′ₙₘ the zeros of
 * Jₙ′; below cut-off "the corresponding mode cannot propagate in the waveguide as kz becomes pure
 * imaginary": W. C. Chew, ECE 604 Lecture 19, Purdue University (2019),
 * https://engineering.purdue.edu/wcchew/ece604s19/Lecture%20Notes/Lect19.pdf .
 * Table of zeros, "J1′(x) = 0 ... 1.841": R. Hudson, EE 518 Lecture 4c "Cylindrical waveguide",
 * Washington State University, https://users.tricity.wsu.edu/~hudson/Teaching/EE518/4c%20Cylindrical%20waveguide.pdf
 * (both retrieved 2026-10-07). The page computes p′₁₁ itself (a mathematical constant); the tabulated
 * value is kept here for the unit test.
 */
export const TE11 = {
  p11Tabulated: 1.841,
  source: 'Chew, ECE 604 Lecture 19 (Purdue, 2019); Hudson, EE 518 Lecture 4c (Washington State University)',
};

/**
 * Microwave oven cavity, Sharp R-654M operation manual, specifications: "Microwave frequency 2450 MHz",
 * "Cavity Dimensions 290(W) x 194(H) x 313(D) mm", "Oven capacity 18 litres", "Cooking uniformity
 * Turntable diameter (272mm)", https://manualsdump.com/en/manuals/sharp-r-654m/87884/47 (retrieved 2026-10-07).
 */
export const OVEN_CAVITY = {
  widthM: 0.290,
  heightM: 0.194,
  depthM: 0.313,
  fHz: 2450e6,
  source: 'Sharp R-654M microwave oven operation manual, specifications page',
};

/**
 * Guitar body: Martin D-28 (1941), National Music Museum NMM 10738, "Back length: 508 mm (20″)",
 * "Lower bout width: 381 mm (15″)", https://emuseum.nmmusd.org/objects/16689/guitar (retrieved 2026-10-07).
 */
export const GUITAR_BODY = {
  lengthM: 0.508,
  widthM: 0.381,
  source: 'National Music Museum (Vermillion, SD), Martin D-28 guitar NMM 10738, catalogue dimensions',
};

/**
 * Green laser pointer: "a crystal of potassium titanyl phosphate, which emits light of half the
 * wavelength: 532 nm": Galang, Restelli, Hagley & Clark, "A Green Laser Pointer Hazard", NIST
 * Technical Note 1668 (2010), https://nvlpubs.nist.gov/nistpubs/Legacy/TN/nbstechnicalnote1668.pdf
 * (retrieved 2026-10-07).
 */
export const GREEN_LASER_M = 532e-9;
export const GREEN_LASER_SOURCE = 'Galang et al., "A Green Laser Pointer Hazard", NIST Technical Note 1668 (2010)';

// "A typical television remote control uses infrared energy at a wavelength around 940 nanometers.":
// NASA Science, "Infrared Waves", https://science.nasa.gov/ems/07_infraredwaves/ (retrieved 2026-10-07).
export const TV_REMOTE_M = 940e-9;

// "Specifies the frequency for the note A in the treble stave and shall be 440 Hz.": ISO 16:1975
// abstract, https://committee.iso.org/standard/3601.html?browse=ics (retrieved 2026-10-07).
export const A4_HZ = 440;

// "Microwave ovens work by using microwave about 12 centimeters in length": NASA Science, "Microwaves",
// https://science.nasa.gov/ems/06_microwaves/ (retrieved 2026-10-07). Used as a cross-check in the tests.
export const NASA_OVEN_WAVELENGTH_M = 0.12;

/* ---------- Familiar objects for "compared with" ---------- */

const ref = (id) => PIXEL_REFERENCES.find((r) => r.id === id);
const typical = (r) => r.typicalM ?? Math.sqrt(r.rangeM[0] * r.rangeM[1]);

/**
 * Sizes to compare a wavelength with, smallest first. `what` completes "about 3 × …".
 * The first four come from js/data/references.js (cited there).
 */
export const COMPARISONS = [
  { id: 'rbc', what: 'the width of a red blood cell', sizeM: typical(ref('rbc')), source: ref('rbc').source },
  { id: 'hair', what: 'the thickness of a human hair', sizeM: typical(ref('hair')), source: ref('hair').source },
  { id: 'salt', what: 'a grain of table salt', sizeM: typical(ref('salt')), source: ref('salt').source },
  { id: 'pinhead', what: 'a dressmaker pin head', sizeM: typical(ref('pinhead')), source: ref('pinhead').source },
  // ISO/IEC 7810 ID-1, 85.60 mm: a standard dimension (also physics.js ID1_CARD_WIDTH_M).
  { id: 'card', what: 'the width of a bank card', sizeM: 0.0856, source: 'ISO/IEC 7810 ID-1 card size' },
  // "The court shall be a rectangle, 78 feet (23.77 m) long": ITF Rules of Tennis 2026, Rule 1,
  // https://www.itftennis.com/media/7221/2026-rules-of-tennis-english.pdf (retrieved 2026-10-07).
  { id: 'tennis', what: 'the length of a tennis court', sizeM: 23.77, source: 'ITF Rules of Tennis 2026, Rule 1' },
  // "Volumetric mean radius (km) 6371.000": NASA Earth Fact Sheet,
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html (retrieved 2026-10-07).
  { id: 'earth', what: 'Earth\'s diameter', sizeM: 2 * 6371.0e3, source: 'NASA Earth Fact Sheet (mean radius 6,371 km)' },
  // "Semimajor axis (10⁶ km) 0.3844": NASA Moon Fact Sheet,
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html (retrieved 2026-10-07).
  { id: 'moon', what: 'the distance to the Moon', sizeM: 0.3844e9, source: 'NASA Moon Fact Sheet (semimajor axis 384,400 km)' },
];

/* ---------- Presets ---------- */

/**
 * Wavelength-view presets. medium: 'air' (sound) or 'em'. Give f (Hz) or lambda (m, in vacuum).
 * Band presets sit at the middle of the cited band.
 */
export const PRESETS = {
  hz20: { medium: 'air', f: HEARING_RANGE.minHz, name: '20 Hz, the lowest note most people hear', short: 'A 20 Hz rumble (lowest audible)', source: HEARING_RANGE.source },
  a4: { medium: 'air', f: A4_HZ, name: '440 Hz, the note A (concert pitch)', short: 'The note A at 440 Hz', source: 'ISO 16:1975, standard tuning frequency' },
  khz1: { medium: 'air', f: 1000, name: '1 kHz test tone', short: 'A 1 kHz tone' },
  khz20: { medium: 'air', f: HEARING_RANGE.maxHz, name: '20 kHz, the highest pitch most people hear', short: 'A 20 kHz whistle (highest audible)', source: HEARING_RANGE.source },
  khz40: { medium: 'air', f: ULTRASONIC_SENSOR.fHz, name: '40 kHz ultrasonic distance sensor', short: '40 kHz ultrasound from a distance sensor', source: ULTRASONIC_SENSOR.source },
  fm: { medium: 'em', f: 100e6, name: '100 MHz FM radio', short: '100 MHz FM radio', source: BANDS[0].source },
  wifi24: { medium: 'em', f: (BANDS[1].lo + BANDS[1].hi) / 2, name: '2.4 GHz Wi-Fi (middle of the band)', short: '2.4 GHz Wi-Fi (middle of the band)', source: BANDS[1].source },
  oven: { medium: 'em', f: BANDS[2].centre, name: '2.45 GHz microwave oven', short: 'Microwave-oven radiation at 2.45 GHz', source: BANDS[2].source },
  wifi5: { medium: 'em', f: (BANDS[3].lo + BANDS[3].hi) / 2, name: '5 GHz Wi-Fi (middle of the bands)', short: '5 GHz Wi-Fi (middle of the bands)', source: BANDS[3].source },
  remote: { medium: 'em', lambda: TV_REMOTE_M, name: 'TV remote (infrared, 940 nm)', short: 'Infrared from a TV remote (940 nm)', source: 'NASA Science, "Infrared Waves"' },
  red: { medium: 'em', lambda: VISIBLE_RANGE.maxM, name: 'red light (700 nm)', short: 'Red light (700 nm)', source: VISIBLE_RANGE.source },
  green: { medium: 'em', lambda: GREEN_LASER_M, name: 'green laser (532 nm)', short: 'Green laser light (532 nm)', source: GREEN_LASER_SOURCE },
  violet: { medium: 'em', lambda: 400e-9, name: 'violet light (400 nm)', short: 'Violet light (400 nm)', source: VISIBLE_RANGE.source },
};

/** Standing-wave presets: box length (m), medium and mode. */
export const STANDING_PRESETS = {
  room: { medium: 'air', L: 4, n: 1, name: 'a 4 m room' },
  guitar: { medium: 'air', L: GUITAR_BODY.lengthM, n: 1, name: 'a guitar-body-length box (508 mm)', source: GUITAR_BODY.source },
  // n is chosen on the page as the mode nearest the oven's 2.45 GHz.
  oven: { medium: 'em', L: OVEN_CAVITY.widthM, n: null, name: 'a microwave oven cavity, 290 mm wide', source: OVEN_CAVITY.source },
};
