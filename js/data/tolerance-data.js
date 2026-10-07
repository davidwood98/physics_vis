/**
 * tolerance-data.js: ISO 286 tables for the tolerance and fit visualiser (data only).
 *
 * ISO 286-1 and ISO 286-2 are paywalled, so every value below was copied from
 * reproductions fetched on 2026-10-07 and cross-checked against at least two of
 * them (tests/tolerance.test.html repeats every check, value by value):
 *
 *   [WIKI]  Wikipedia, "IT Grade", table "ISO 286 - Table 1", citing ISO 286-1:2010 p. 20.
 *           https://en.wikipedia.org/wiki/IT_Grade
 *   [EE]    Engineers Edge, "International Tolerance (IT) Grades ISO 286-1 - 2010(E) Table Chart".
 *           https://www.engineersedge.com/international_tol.htm
 *   [EEF]   Engineers Edge, "Formulas for Standard International Tolerance (IT) Grades per ISO 286-1".
 *           https://www.engineersedge.com/mechanical,045tolerances/formulas_international_tolerance_it_grades__15523.htm
 *   [RM-IT] RoyMech, "ISO Tolerance Band T" (1-315 mm and 315-3150 mm pages).
 *           https://www.roymech.co.uk/Useful_Tables/ISO_Tolerances/ISO_Tol_T.htm
 *           https://www.roymech.co.uk/Useful_Tables/ISO_Tolerances/ISO_Tol_T_2.html
 *   [RM-FD] RoyMech, "ISO Shaft Lim 1": shaft fundamental deviations a to zc up to 500 mm.
 *           https://www.roymech.co.uk/Useful_Tables/ISO_Tolerances/ISO_SHAFT_LIM_1.html
 *   [KSU]   S. Darwish, "Fits and Tolerances" course notes, King Saud University: scanned
 *           reproduction of ISO 286-1:1988 Tables 2 and 3 (shaft fundamental deviations, pp. 6-7).
 *           https://faculty.ksu.edu.sa/sites/default/files/iso_fit_tables_ams_feb13_16.pdf
 *   [MMC]   Mitsubishi Materials, "Fit tolerance table (shaft)", JIS B 0401 limit deviations
 *           for c9 ... x6 (JIS B 0401 is the Japanese adoption of ISO 286).
 *           https://www.mitsubishicarbide.net/contents/mhg/enuk/html/product/technical_information/information/pdf/fit_tolerance_table_shaft.pdf
 *   [MIKI]  Miki Pulley, "List of Fit Tolerances (Excerpt from JIS B 0401)", shafts d8 ... r6, 3-500 mm.
 *           https://www.mikipulley.co.jp/en/resources/standards-fitting-tolerances
 *   [MH]    Machinery's Handbook 26th ed. (PDF metadata), "Allowances and tolerances", Tables 11-13:
 *           ANSI B4.2-1978 (R1994) preferred hole-basis metric fits, as posted by King Saud University.
 *           https://faculty.ksu.edu.sa/sites/default/files/2_-_n7h6_ansi_b4_2_fit.pdf
 *   [SDP]   SDP/SI D815 Reference Section, "Preferred fits for shafts and holes" (reprinted from
 *           Kverneland, Machine Design, 1998). https://sdp-si.com/D815/D815-Reference-Section.pdf
 *   [EEP]   Engineers Edge, "Preferred Mechanical Tolerances Metric ISO 286".
 *           https://www.engineersedge.com/manufacturing/preferred_mechanical_tolerances_metric_iso_286_13166.htm
 *   [GPP]   Govt. Polytechnic Panchkula, "E-Contents of Mechanical Engg Drawing" (diameter steps).
 *           https://gppanchkula.ac.in/wp-content/uploads/2021/02/E-Contents-of-MECHANICAL-ENGG-DRAWING.pdf
 *   [NIST]  Phillips et al. 2016, "The 2016 Revision of ISO 1", J. Res. NIST 121:498.
 *           https://pmc.ncbi.nlm.nih.gov/articles/PMC7339725/
 *
 * Units: nominal sizes in millimetres, deviations and tolerances in micrometres,
 * exactly as the standard tabulates them. Size ranges are "over A up to and including B".
 */

export const RETRIEVED = '2026-10-07';

/* =========================================================================
 * Standard tolerance grades IT5 ... IT11 (ISO 286-1 Table 1), µm
 * ====================================================================== */

/**
 * Upper limits of the IT size ranges (mm). The first range is "up to and including 3 mm";
 * for the formula its geometric mean uses 1 and 3 mm: [GPP] "The various steps specified
 * for the diameter steps are as follows: 1-3, 3-6, 6-10, ..."; [RM-IT] heads its first
 * column "Over 1, Up to and including 3".
 */
export const IT_RANGE_UPPER = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
export const IT_FIRST_LOWER_FOR_MEAN = 1;

/**
 * IT values, one per range in IT_RANGE_UPPER. Copied from [WIKI] Table 1 and checked
 * value by value against [EE] and [RM-IT]: all 91 values agree in all three sources.
 * Discrepancy noted, not used: the textbook IT table on p. 3 of [KSU] gives 60 and 110 for
 * IT9 and IT10 at 30-50 mm; [WIKI], [EE] and [RM-IT] give 62 and 100, as do the JIS H9 and
 * H10 limits in [MIKI] (+62, +100) and the formula (62.4, 99.9 µm). Resolved: 62 and 100.
 */
export const IT_TABLE = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};

/**
 * Multipliers of the standard tolerance factor i for IT5 ... IT11.
 * [EEF] (ISO 286-1:1988): grades IT5 to IT18 are "a function of the standard tolerance
 * factor, i": IT5 7i, IT6 10i, IT7 16i, IT8 25i, IT9 40i, IT10 64i, IT11 100i, with
 * "i = 0,45 D1/3 + 0.001D" and D "the geometric mean of the basic size step in mm".
 * [EEF] adds "Current ISO standard has removed formulas": the table is what counts.
 */
export const IT_FACTORS = { 5: 7, 6: 10, 7: 16, 8: 25, 9: 40, 10: 64, 11: 100 };

/* =========================================================================
 * Shaft fundamental deviations (ISO 286-1 Tables 2 and 3), µm
 * ====================================================================== */

/**
 * The standard subdivides some IT ranges for some letters ("intermediate" ranges).
 * Values are stored per sub-range, so every letter uses the same 25 rows; where the
 * standard merges rows (e.g. d over 30 up to 50) the value simply repeats.
 */
export const DEV_RANGE_UPPER = [3, 6, 10, 14, 18, 24, 30, 40, 50, 65, 80, 100, 120, 140, 160, 180, 200, 225, 250, 280, 315, 355, 400, 450, 500];

/**
 * Upper-deviation letters c ... h: the fundamental deviation is es (≤ 0).
 * Lower-deviation letters k ... u: the fundamental deviation is ei (≥ 0).
 * Values copied from [RM-FD] and checked against [KSU] (scan of ISO 286-1:1988 Tables 2-3,
 * every row), [MMC] (c9, d8, e7, f6, g5, h5, k5, m5, n6, p6, r6, s6 to 250 mm, t6 to 180 mm,
 * u6 to 120 mm) and [MIKI] (d8, e7, f6, g5, h5, k5, m5, n6, p6, r6, 3-500 mm).
 * Discrepancies found and resolved:
 *  - r over 355 up to 400: the [KSU] scan reads +144; [RM-FD] +114, [MMC] r6 +150/+114 and
 *    [MIKI] r6 +150/+114 agree on 114. Resolved: 114 (144 happens to be the r6 upper
 *    limit of the 315-355 row).
 *  - n over 80 up to 120: the [KSU] scan prints "-23"; every other source gives +23 and
 *    n is a lower-deviation (positive) letter. Resolved: +23.
 * t is not defined up to 24 mm (the standard prints "-"): null.
 */
export const SHAFT_FUNDAMENTAL = {
  // es. [KSU] Table 2 column c; [MMC] c9 upper limits (-60 ... -480).
  c: { kind: 'es', values: [-60, -70, -80, -95, -95, -110, -110, -120, -130, -140, -150, -170, -180, -200, -210, -230, -240, -260, -280, -300, -330, -360, -400, -440, -480] },
  // es. [KSU] Table 2 column d; [MMC] d8/d9 and [MIKI] d8 upper limits.
  d: { kind: 'es', values: [-20, -30, -40, -50, -50, -65, -65, -80, -80, -100, -100, -120, -120, -145, -145, -145, -170, -170, -170, -190, -190, -210, -210, -230, -230] },
  // es. [KSU] Table 2 column e; [MMC] e7-e9 and [MIKI] e7 upper limits.
  e: { kind: 'es', values: [-14, -20, -25, -32, -32, -40, -40, -50, -50, -60, -60, -72, -72, -85, -85, -85, -100, -100, -100, -110, -110, -125, -125, -135, -135] },
  // es. [KSU] Table 2 column f; [MMC] f6-f8 and [MIKI] f6 upper limits.
  f: { kind: 'es', values: [-6, -10, -13, -16, -16, -20, -20, -25, -25, -30, -30, -36, -36, -43, -43, -43, -50, -50, -50, -56, -56, -62, -62, -68, -68] },
  // es. [KSU] Table 2 column g; [MMC] g5/g6 and [MIKI] g5 upper limits.
  g: { kind: 'es', values: [-2, -4, -5, -6, -6, -7, -7, -9, -9, -10, -10, -12, -12, -14, -14, -14, -15, -15, -15, -17, -17, -18, -18, -20, -20] },
  // es = 0 for h at every size: [KSU], [RM-FD], [MMC] h5-h9, [MIKI] h5-h9.
  h: { kind: 'es', values: Array(25).fill(0) },
  // ei for grades IT4 to IT7 only. [KSU] Table 2 column k, "4-7"; [RM-FD] "k4-k7 (inc)";
  // [MMC] and [MIKI] k5/k6 lower limits. For IT3 and below and above IT7, ei = 0
  // ([KSU] column "≤3, >7": 0 in every row; [RM-FD] "other k": 0).
  k: { kind: 'ei', values: [0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5], otherGrades: 0, gradesMin: 4, gradesMax: 7 },
  // ei. [KSU] Table 3 column m; [MMC] m5/m6 and [MIKI] m5 lower limits.
  m: { kind: 'ei', values: [2, 4, 6, 7, 7, 8, 8, 9, 9, 11, 11, 13, 13, 15, 15, 15, 17, 17, 17, 20, 20, 21, 21, 23, 23] },
  // ei. [KSU] Table 3 column n (80-120 printed "-23", see above); [MMC] and [MIKI] n6 lower limits.
  n: { kind: 'ei', values: [4, 8, 10, 12, 12, 15, 15, 17, 17, 20, 20, 23, 23, 27, 27, 27, 31, 31, 31, 34, 34, 37, 37, 40, 40] },
  // ei. [KSU] Table 3 column p; [MMC] and [MIKI] p6 lower limits.
  p: { kind: 'ei', values: [6, 12, 15, 18, 18, 22, 22, 26, 26, 32, 32, 37, 37, 43, 43, 43, 50, 50, 50, 56, 56, 62, 62, 68, 68] },
  // ei, subdivided above 50 mm. [KSU] Table 3 column r (355-400 misread, see above); [MMC], [MIKI] r6.
  r: { kind: 'ei', values: [10, 15, 19, 23, 23, 28, 28, 34, 34, 41, 43, 51, 54, 63, 65, 68, 77, 80, 84, 94, 98, 108, 114, 126, 132] },
  // ei, subdivided above 50 mm. [KSU] Table 3 column s; [MMC] s6 lower limits up to 250 mm.
  s: { kind: 'ei', values: [14, 19, 23, 28, 28, 35, 35, 43, 43, 53, 59, 71, 79, 92, 100, 108, 122, 130, 140, 158, 170, 190, 208, 232, 252] },
  // ei, defined over 24 mm only. [KSU] Table 3 column t; [MMC] t6 lower limits 24-180 mm.
  t: { kind: 'ei', values: [null, null, null, null, null, null, 41, 48, 54, 66, 75, 91, 104, 122, 134, 146, 166, 180, 196, 218, 240, 268, 294, 330, 360] },
  // ei, subdivided above 18 mm. [KSU] Table 3 column u; [MMC] u6 lower limits up to 120 mm.
  u: { kind: 'ei', values: [18, 23, 28, 33, 33, 41, 48, 60, 70, 87, 102, 124, 144, 170, 190, 210, 236, 258, 284, 315, 350, 390, 435, 490, 540] },
};

/** The letters this tool offers, in the standard's order (js sits between h and k). */
export const SHAFT_LETTERS = ['c', 'd', 'e', 'f', 'g', 'h', 'js', 'k', 'm', 'n', 'p', 'r', 's', 't', 'u'];

/**
 * js: symmetric, ±IT/2 ([KSU] Table 2 column js: "±IT/2"; [RM-FD] "ITn/2").
 * ISO 286-1:1988 Table 2 footnote b ([KSU]): in grades 7 to 11, an odd IT value is rounded
 * "by replacing it by the even value immediately below". [MMC] (JIS) follows it (js7 over
 * 18 up to 30: ±10),
 * while the ISO 286-2 based table in RoyMech and the JIS B 0401 excerpt in [MIKI] give
 * ±10.5 µm. This tool uses ±IT/2 exactly and shows the 1988 rounded value alongside.
 */
export const JS_ROUNDING_1988 = { minGrade: 7, maxGrade: 11 };

/* =========================================================================
 * Preferred hole-basis fits
 * ====================================================================== */

/**
 * The ten preferred hole-basis fits of ANSI B4.2 (the US standard built on ISO 286
 * first-choice classes), with their names: [MH] Table 11 "Description of Preferred Fits",
 * confirmed by [SDP] and [EEP]. "use" is our paraphrase of the descriptions, not a quote.
 * [MH] Table 11 footnote on H7/p6: "Transition fit for basic sizes in range from 0 through 3 mm."
 */
export const PREFERRED_FITS = [
  { id: 'H11/c11', hole: 11, letter: 'c', shaft: 11, name: 'Loose running',
    use: 'Generous clearance and wide tolerances: cheap parts and outer members.' },
  { id: 'H9/d9', hole: 9, letter: 'd', shaft: 9, name: 'Free running',
    use: 'Copes with large temperature changes, high speeds or heavy journal pressure; not for accurate location.' },
  { id: 'H8/f7', hole: 8, letter: 'f', shaft: 7, name: 'Close running',
    use: 'Running fit for accurate machines at moderate speeds and journal pressures.' },
  { id: 'H7/g6', hole: 7, letter: 'g', shaft: 6, name: 'Sliding',
    use: 'Turns and slides freely and locates accurately, but is not meant to run continuously.' },
  { id: 'H7/h6', hole: 7, letter: 'h', shaft: 6, name: 'Locational clearance',
    use: 'Snug fit for locating stationary parts that still assemble and come apart freely.' },
  { id: 'H7/k6', hole: 7, letter: 'k', shaft: 6, name: 'Locational transition',
    use: 'Accurate location: a compromise between clearance and interference.' },
  { id: 'H7/n6', hole: 7, letter: 'n', shaft: 6, name: 'Locational transition',
    use: 'More accurate location where more interference is acceptable.' },
  { id: 'H7/p6', hole: 7, letter: 'p', shaft: 6, name: 'Locational interference',
    use: 'Rigid, accurately located parts without special demands on bore pressure.' },
  { id: 'H7/s6', hole: 7, letter: 's', shaft: 6, name: 'Medium drive',
    use: 'Press or shrink fit for ordinary steel parts; the tightest fit usable with cast iron.' },
  { id: 'H7/u6', hole: 7, letter: 'u', shaft: 6, name: 'Force',
    use: 'Heavy press or shrink fit for highly stressed parts.' },
];

/**
 * Further hole-basis fits that ISO 286-1:2010 lists as preferred ([WIKI] table "Basic hole":
 * H7/ g6 h6 js6 k6 m6 n6 p6 r6 s6; H8/ f7 h7 e8; H9/ e8; H11/ b11 c11), not already above.
 * b is outside this tool's letters.
 */
export const ISO_PREFERRED_EXTRA = [
  { id: 'H7/js6', hole: 7, letter: 'js', shaft: 6 },
  { id: 'H7/m6', hole: 7, letter: 'm', shaft: 6 },
  { id: 'H7/r6', hole: 7, letter: 'r', shaft: 6 },
  { id: 'H8/h7', hole: 8, letter: 'h', shaft: 7 },
  { id: 'H8/e8', hole: 8, letter: 'e', shaft: 8 },
  { id: 'H9/e8', hole: 9, letter: 'e', shaft: 8 },
];

/** Standard reference temperature: [NIST] "it remains fixed at 20 °C" (ISO 1). */
export const REFERENCE_TEMPERATURE_C = 20;

/* =========================================================================
 * Sources, for the page's Sources card
 * ====================================================================== */

export const TOLERANCE_SOURCES = [
  { id: 'WIKI', text: 'Wikipedia, "IT Grade", ISO 286 Table 1 (citing ISO 286-1:2010)', url: 'https://en.wikipedia.org/wiki/IT_Grade',
    supports: 'IT5 to IT11 values for every size range; ISO 286-1:2010 preferred fits' },
  { id: 'EE', text: 'Engineers Edge, International Tolerance (IT) Grades, ISO 286-1:2010', url: 'https://www.engineersedge.com/international_tol.htm',
    supports: 'IT values (second source)' },
  { id: 'RM-IT', text: 'RoyMech, ISO Tolerance Band T tables', url: 'https://www.roymech.co.uk/Useful_Tables/ISO_Tolerances/ISO_Tol_T.htm',
    supports: 'IT values (third source); first size range taken as 1 to 3 mm; why hole basis is convenient ("standard hole-producing tools and processes can be retained", how-to-use page)' },
  { id: 'EEF', text: 'Engineers Edge, Formulas for International Tolerance Grades (ISO 286-1:1988)', url: 'https://www.engineersedge.com/mechanical,045tolerances/formulas_international_tolerance_it_grades__15523.htm',
    supports: 'i = 0.45∛D + 0.001D, D as the geometric mean of the size step, IT5 = 7i ... IT11 = 100i' },
  { id: 'RM-FD', text: 'RoyMech, ISO shaft fundamental deviations a to zc, 0 to 500 mm', url: 'https://www.roymech.co.uk/Useful_Tables/ISO_Tolerances/ISO_SHAFT_LIM_1.html',
    supports: 'Shaft fundamental deviations c to u, including the intermediate size ranges' },
  { id: 'KSU', text: 'S. Darwish, Fits and Tolerances notes, King Saud University (scan of ISO 286-1:1988 Tables 2 and 3)', url: 'https://faculty.ksu.edu.sa/sites/default/files/iso_fit_tables_ams_feb13_16.pdf',
    supports: 'Shaft fundamental deviations (second full source); the js and k rules' },
  { id: 'MMC', text: 'Mitsubishi Materials, Fit tolerance table (shaft), JIS B 0401', url: 'https://www.mitsubishicarbide.net/contents/mhg/enuk/html/product/technical_information/information/pdf/fit_tolerance_table_shaft.pdf',
    supports: 'Shaft limit deviations c9 to u6, confirming the fundamental deviations; js rounding' },
  { id: 'MIKI', text: 'Miki Pulley, List of Fit Tolerances (excerpt from JIS B 0401)', url: 'https://www.mikipulley.co.jp/en/resources/standards-fitting-tolerances',
    supports: 'Shaft limit deviations d8 to r6, 3 to 500 mm, confirming d to r' },
  { id: 'MH', text: "Machinery's Handbook 26th ed., ANSI B4.2-1978 (R1994) preferred metric fits, Tables 11 to 13 (posted by King Saud University)", url: 'https://faculty.ksu.edu.sa/sites/default/files/2_-_n7h6_ansi_b4_2_fit.pdf',
    supports: 'Names of the ten preferred fits; 280 worked fits (28 sizes × 10 fits) used as exact unit tests; shaft basis "when a common shaft mates with several holes"' },
  { id: 'SDP', text: 'SDP/SI D815 Reference Section, Preferred fits for shafts and holes', url: 'https://sdp-si.com/D815/D815-Reference-Section.pdf',
    supports: 'Preferred fit names (second source)' },
  { id: 'EEP', text: 'Engineers Edge, Preferred Mechanical Tolerances Metric ISO 286', url: 'https://www.engineersedge.com/manufacturing/preferred_mechanical_tolerances_metric_iso_286_13166.htm',
    supports: 'Preferred fit names (third source)' },
  { id: 'GPP', text: 'Govt. Polytechnic Panchkula, Mechanical Engineering Drawing e-content', url: 'https://gppanchkula.ac.in/wp-content/uploads/2021/02/E-Contents-of-MECHANICAL-ENGG-DRAWING.pdf',
    supports: 'Diameter steps 1-3, 3-6, 6-10 ... for the geometric mean D' },
  { id: 'NIST', text: 'Phillips et al. 2016, "The 2016 Revision of ISO 1", J. Res. NIST 121:498', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7339725/',
    supports: 'Sizes are specified at the standard reference temperature of 20 °C' },
];
