/**
 * compact-objects-data.js: cited reference values for the compact-objects page
 * (data only, no code). SI units unless a name says otherwise. Every value
 * quotes its source text, URL and retrieval date; `source` strings are shown
 * on the page. All sources retrieved 2026-10-07.
 *
 * Masses are worked from mass parameters (GM, known far more precisely than G):
 * Schwarzschild radii come straight from GM (Rs = 2GM/c²) and SI masses, where
 * needed, from M = GM / G, as IAU 2015 Resolution B3 recommends.
 * c is exact (SI definition) and comes from astro.js C_LIGHT.
 */

/**
 * Newtonian constant of gravitation, m³ kg⁻¹ s⁻².
 * NIST, CODATA 2022: "Numerical value 6.674 30 x 10-11 m3 kg-1 s-2, Standard uncertainty 0.000 15 x 10-11"
 * https://physics.nist.gov/cgi-bin/cuu/Value?bg (retrieved 2026-10-07)
 */
export const G = 6.6743e-11;
export const G_UNCERTAINTY = 0.00015e-11;

/**
 * IAU 2015 Resolution B3, nominal conversion constants (exact by definition):
 * "1 R☉N = 6.957 × 10^8 m", "1 (GM)☉N = 1.3271244 × 10^20 m^3 s^-2",
 * "1 (GM)⊕N = 3.986004 × 10^14 m^3 s^-2", "1 (GM)JN = 1.2668653 × 10^17 m^3 s^-2",
 * and "if SI masses are explicitly needed, they should be expressed in terms of (GM)object/G".
 * Prša et al., IAU Inter-Division A-G Working Group, arXiv:1510.07674, https://arxiv.org/abs/1510.07674 (retrieved 2026-10-07)
 */
export const R_SUN = 6.957e8;
export const GM_SUN = 1.3271244e20;
export const GM_EARTH = 3.986004e14;
export const GM_JUPITER = 1.2668653e17;

/**
 * Sirius B, the nearest white dwarf. Bond et al. 2017, ApJ, doi:10.3847/1538-4357/aa6af8 (arXiv:1703.10625):
 * abstract: "dynamical masses of 2.063+/-0.023 Msun and 1.018+/-0.011 Msun for Sirius A and B";
 * section 8: "the implied radius of Sirius B is 0.008098 ± 0.000046 R⊙".
 * https://arxiv.org/abs/1703.10625 (retrieved 2026-10-07)
 */
export const SIRIUS_B = {
  massSun: 1.018, massErr: 0.011,
  radiusSun: 0.008098, radiusErr: 0.000046,
  source: 'Bond et al. 2017, The Astrophysical Journal (arXiv:1703.10625)',
  url: 'https://arxiv.org/abs/1703.10625',
};

/**
 * Neutron stars measured by NASA's NICER X-ray telescope (radius from the pulse shape).
 * PSR J0437−4715, Choudhury et al. 2024, ApJL, doi:10.3847/2041-8213/ad5a6f (arXiv:2407.06789): "we infer a mass of
 *   M = 1.418 ± 0.037 M⊙ ... and an equatorial radius of R = 11.36 +0.95 −0.63 km"
 *   https://arxiv.org/abs/2407.06789 (retrieved 2026-10-07)
 * PSR J0030+0451, Riley et al. 2019, ApJL 887, L21 (arXiv:1912.05702): "The inferred mass M and
 *   equatorial radius R_eq are, respectively, 1.34 +0.15 −0.16 M⊙ and 12.71 +1.14 −1.19 km"
 *   https://arxiv.org/abs/1912.05702 (retrieved 2026-10-07)
 * PSR J0030+0451, Miller et al. 2019, ApJL 887, L24 (arXiv:1912.05705): "R_e = 13.02 +1.24 −1.06 km
 *   and M = 1.44 +0.15 −0.14 M⊙ (68%)"  https://arxiv.org/abs/1912.05705 (retrieved 2026-10-07)
 */
export const NEUTRON_STARS = [
  { id: 'j0437', name: 'PSR J0437−4715', radius: 11.36e3, radiusPlus: 0.95e3, radiusMinus: 0.63e3, massSun: 1.418,
    source: 'Choudhury et al. 2024, ApJ Letters (NICER; arXiv:2407.06789)', url: 'https://arxiv.org/abs/2407.06789' },
  { id: 'j0030r', name: 'PSR J0030+0451', radius: 12.71e3, radiusPlus: 1.14e3, radiusMinus: 1.19e3, massSun: 1.34,
    source: 'Riley et al. 2019, ApJL 887, L21 (NICER)', url: 'https://arxiv.org/abs/1912.05702' },
  { id: 'j0030m', name: 'PSR J0030+0451', radius: 13.02e3, radiusPlus: 1.24e3, radiusMinus: 1.06e3, massSun: 1.44,
    source: 'Miller et al. 2019, ApJL 887, L24 (NICER)', url: 'https://arxiv.org/abs/1912.05705' },
];

/**
 * Sagittarius A*, the black hole at the centre of the Milky Way. GRAVITY Collaboration, A&A,
 * doi:10.1051/0004-6361/202142465 (arXiv:2112.07478), from the orbits of the stars S2, S29, S38 and S55:
 * "The best fit further yields R0 = (8277 ± 9) pc and M• = (4.297 ± 0.012) × 10^6 M⊙ (statistical
 *  errors, see Gravity Coll. 2021 for a discussion of the systematics that are ≈ 30 pc for R0 and
 *  ≈ 40,000 M⊙ for M•)". Abstract: "M = 4.30 x 10^6 M_sun with a precision of about +-0.25%".
 * https://arxiv.org/abs/2112.07478 (full text read via https://ar5iv.labs.arxiv.org/html/2112.07478, retrieved 2026-10-07)
 */
export const SGR_A = {
  massSun: 4.297e6, massStat: 0.012e6, massSys: 0.04e6,
  distancePc: 8277, distanceStat: 9, distanceSys: 30,
  source: 'GRAVITY Collaboration, Astronomy & Astrophysics (arXiv:2112.07478)',
  url: 'https://arxiv.org/abs/2112.07478',
};

/**
 * Event Horizon Telescope image of Sgr A*. EHT Collaboration 2022, ApJL 930, L12 (arXiv:2311.08680):
 * abstract: "a bright, thick ring with a diameter of 51.8 ± 2.3 μas (68% credible interval)";
 * section 5: "the angular diameter of the black hole shadow for Sgr A*: d_sh = 48.7 ± 7.0 μas".
 * https://arxiv.org/abs/2311.08680 (full text via https://ar5iv.labs.arxiv.org/html/2311.08680, retrieved 2026-10-07)
 */
export const EHT_SGR_A = {
  ringMicroArcsec: 51.8, ringErr: 2.3,
  shadowMicroArcsec: 48.7, shadowErr: 7.0,
  source: 'Event Horizon Telescope Collaboration 2022, ApJL 930, L12 (arXiv:2311.08680)',
  url: 'https://arxiv.org/abs/2311.08680',
};

/**
 * M87*, the first black hole imaged. EHT Collaboration 2019, ApJL 875, L1 (arXiv:1906.11238):
 * "derive a central mass of M = (6.5+/-0.7) x 10^9 Msun". https://arxiv.org/abs/1906.11238 (retrieved 2026-10-07)
 */
export const M87 = {
  massSun: 6.5e9, massErr: 0.7e9,
  source: 'Event Horizon Telescope Collaboration 2019, ApJL 875, L1 (arXiv:1906.11238)',
  url: 'https://arxiv.org/abs/1906.11238',
};

/**
 * UK five pence coin. The Royal Mint, "5p Coin Designs and Specifications":
 * "Smaller version - June 1990 ... Diameter 18.0mm".
 * https://www.royalmint.com/discover/uk-coins/coin-design-and-specifications/five-pence-coin/ (retrieved 2026-10-07)
 */
export const UK_5P_DIAMETER = 18.0e-3;

/**
 * Proton rms charge radius, m. NIST, CODATA 2022: "Numerical value 8.4075 x 10-16 m".
 * https://physics.nist.gov/cgi-bin/cuu/Value?rp (retrieved 2026-10-07)
 */
export const PROTON_RADIUS = 8.4075e-16;

/** A metric teaspoon: 5 ml = 5 × 10⁻⁶ m³ (a definition, as the owner specified). */
export const TEASPOON = 5e-6;

/** Neutral default for "your mass" (a user input, not a measured value). */
export const DEFAULT_PERSON_MASS = 70;
