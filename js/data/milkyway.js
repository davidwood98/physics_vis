/**
 * milkyway.js: the published model behind the Milky Way picture (data only).
 * All sources retrieved 2026-10-06.
 *
 * Spiral arms: Reid, Menten, Brunthaler et al. 2019, ApJ 885, 131,
 * "Trigonometric Parallaxes of High-mass Star-forming Regions: Our View of the
 * Milky Way" (arXiv:1910.03357; https://ar5iv.labs.arxiv.org/html/1910.03357),
 * Table 2 "Spiral Arm Characteristics". Arm model (their sec. 3):
 *   ln(R / R_kink) = −(β − β_kink) tan ψ
 * with ψ = ψ< for β <= β_kink and ψ> beyond. β is the Galactocentric azimuth,
 * "defined as 0 toward the Sun and increasing in the direction of Galactic
 * rotation"; rotation is clockwise seen from the north Galactic pole (their Fig. 1).
 * betaRange is the azimuth range covered by their parallax data; the page draws
 * those parts brighter and extrapolates the arms fainter beyond them.
 * width = intrinsic Gaussian 1-sigma arm width at R_kink (kpc). The models assume R0 = 8.15 kpc.
 */
export const REID_2019_R0_KPC = 8.15;

export const ARMS = [
  { name: '3-kpc arm', betaRange: [15, 18], betaKink: 15, rKink: 3.52, psiIn: -4.2, psiOut: -4.2, width: 0.18 },
  { name: 'Norma arm', betaRange: [5, 54], betaKink: 18, rKink: 4.46, psiIn: -1.0, psiOut: 19.5, width: 0.14 },
  { name: 'Scutum-Centaurus arm', betaRange: [0, 104], betaKink: 23, rKink: 4.91, psiIn: 14.1, psiOut: 12.1, width: 0.23 },
  { name: 'Sagittarius-Carina arm', betaRange: [2, 97], betaKink: 24, rKink: 6.04, psiIn: 17.1, psiOut: 1.0, width: 0.27 },
  { name: 'Local arm', betaRange: [-8, 34], betaKink: 9, rKink: 8.26, psiIn: 11.4, psiOut: 11.4, width: 0.31 },
  { name: 'Perseus arm', betaRange: [-23, 115], betaKink: 40, rKink: 8.87, psiIn: 10.3, psiOut: 8.7, width: 0.35 },
  { name: 'Outer arm', betaRange: [-16, 71], betaKink: 18, rKink: 12.24, psiIn: 3.0, psiOut: 9.4, width: 0.65 },
];

/**
 * The long bar: half-length 5.0 ± 0.2 kpc and an angle of (28-33)° between its
 * major axis and the Sun-Galactic centre line, near end in the first Galactic
 * quadrant (positive longitudes, i.e. positive β). Wegg, Gerhard & Portail 2015,
 * MNRAS 450, 4050 (arXiv:1504.01401): "we find a bar half length of 5.0±0.2 kpc"
 * and "The long bar has an angle to the line-of-sight in the range (28−33)°";
 * near side in the first quadrant: Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529.
 * angleDeg is the middle of the quoted range.
 */
export const BAR = { halfLengthKpc: 5.0, angleDeg: 30.5, source: 'Wegg, Gerhard & Portail 2015, MNRAS 450, 4050; Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529' };

export const SOURCE = 'Spiral arms: Reid et al. 2019, ApJ 885, 131 (Table 2). Bar: Wegg et al. 2015, MNRAS 450, 4050.';
