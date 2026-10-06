/**
 * markers.js: labelled structures for the space simulator (data only).
 * Every entry cites its source in a comment and in its `source` field.
 * All sources retrieved 2026-10-06.
 *
 * Position forms (converted in astro.js markerVector()):
 *   coord: { sys: 'eq' | 'gal' | 'sg', lon, lat }   lon/lat in degrees, or
 *   ra / dec: sexagesimal J2000 strings exactly as the source gives them
 *   dist:  { kpc } | { mpc } | { au } | { kms, H0 }  (velocity / H0 → Mpc)
 *   sgxyzKms + H0: supergalactic Cartesian position given as velocities
 * Distances beyond ~100 million light-years come from redshifts (velocity
 * divided by a Hubble constant), so they are approximate.
 * `catalogue` names a galaxies.json row that the marker stands in for
 * (that row is then drawn once, as the marker).
 */

/**
 * Hubble constant used to turn the velocities below into distances:
 * Tully, Courtois, Hoffman & Pomarède 2014, Nature 513, 71 (arXiv:1409.0880),
 * Cosmicflows-2: "We found H0 = 75.2 ± 3.0 km s-1 Mpc-1."
 */
export const H0_TULLY_2014 = 75.2;

/* ---------- Solar neighbourhood (approximate, flagged on the page) ---------- */

/**
 * Heliopause, about 120 au. Voyager 1 crossed at 121.6 au (25 Aug 2012) and
 * Voyager 2 at about 119.0 au (5 Nov 2018): Burlaga et al. 2019, Nature
 * Astronomy 3, 1007, doi:10.1038/s41550-019-0920-y; also Stone et al. 2013,
 * Science 341, 150 and Stone et al. 2019, Nature Astronomy 3, 1013.
 */
export const HELIOPAUSE = {
  id: 'heliopause', name: 'Heliopause', radiusAu: 120, approximate: true,
  label: 'Heliopause (about 120 AU, approximate)',
  source: 'Burlaga et al. 2019, Nature Astronomy 3, 1007 (Voyager 1 at 121.6 au, Voyager 2 at ~119.0 au); Stone et al. 2013, Science 341, 150',
};

/**
 * Oort cloud, about 2,000 to 100,000 au: NASA Science, "Oort Cloud: Facts"
 * (https://science.nasa.gov/solar-system/oort-cloud/facts/): inner edge
 * "between 2,000 and 5,000 AU", outer edge "between 10,000 and 100,000 AU";
 * a theorized cloud with no direct images. Comets only sample the outer cloud
 * (Vokrouhlický, Nesvorný & Dones 2019, AJ 157, 181).
 */
export const OORT_CLOUD = {
  id: 'oort', name: 'Oort cloud', innerAu: 2000, outerAu: 100000, approximate: true,
  label: 'Oort cloud (inferred, never directly observed)',
  source: 'NASA Science, "Oort Cloud: Facts" (inner edge 2,000-5,000 AU, outer edge 10,000-100,000 AU)',
};

/* ---------- Galaxies, groups and large-scale structure ---------- */

export const MARKERS = [
  // McConnachie 2012, AJ 144, 4 (VizieR J/AJ/144/4): LMC at 05 23 34.5 −69 45 22, D = 51 kpc.
  { id: 'lmc', name: 'Large Magellanic Cloud', catalogue: 'LMC', kind: 'galaxy',
    source: 'McConnachie 2012, AJ 144, 4 (position, 51 kpc); diameter Karachentsev et al. 2013, AJ 145, 101' },
  // McConnachie 2012: SMC at 00 52 44.8 −72 49 43, D = 64 kpc.
  { id: 'smc', name: 'Small Magellanic Cloud', catalogue: 'SMC', kind: 'galaxy',
    source: 'McConnachie 2012, AJ 144, 4 (position, 64 kpc); diameter Karachentsev et al. 2013, AJ 145, 101' },
  // McConnachie 2012: Andromeda (M31) at 00 42 44.3 +41 16 09, D = 783 kpc (about 2.55 million ly).
  // The page text quotes the rounded site constant "about 2.5 million light-years".
  { id: 'andromeda', name: 'Andromeda (M31)', catalogue: 'Andromeda', kind: 'galaxy', flyTo: true,
    source: 'McConnachie 2012, AJ 144, 4 (position, 783 kpc); diameter Karachentsev et al. 2013, AJ 145, 101' },
  // McConnachie 2012: Triangulum (M33) at 01 33 50.9 +30 39 37, D = 809 kpc.
  { id: 'triangulum', name: 'Triangulum (M33)', catalogue: 'Triangulum', kind: 'galaxy',
    source: 'McConnachie 2012, AJ 144, 4 (position, 809 kpc); diameter Karachentsev et al. 2013, AJ 145, 101' },

  // Local Group: McConnachie 2012 sec. 3.3, zero-velocity surface "RLG = 1060 ± 70 kpc",
  // barycentre "at the mid-point of the vector connecting the MW and M31".
  { id: 'localgroup', name: 'Local Group', kind: 'region', centre: 'mw-m31-midpoint', radius: { kpc: 1060 },
    label: 'Local Group (zero-velocity surface)',
    source: 'McConnachie 2012, AJ 144, 4, sec. 3.3: R_LG = 1060 ± 70 kpc about the MW-M31 mid-point' },

  // M81 group: distance 3.63 Mpc and projected radius Rp = 211 kpc, Karachentsev 2005, AJ 129, 178
  // (arXiv:astro-ph/0410065, Tables 10-11). M81 position from SIMBAD (ICRS J2000).
  { id: 'm81', name: 'M81 group', kind: 'group', ra: '09 55 33.17', dec: '+69 03 55.06', dist: { mpc: 3.63 }, radius: { kpc: 211 },
    source: 'Karachentsev 2005, AJ 129, 178 (3.63 Mpc, Rp = 211 kpc); M81 position: SIMBAD' },

  // Centaurus A group: "mean distance of 3.76 ± 0.05 Mpc ... a mean harmonic radius of 192 kpc",
  // Karachentsev et al. 2007, AJ 133, 504 (arXiv:astro-ph/0603091). NGC 5128 position from SIMBAD.
  { id: 'cena', name: 'Centaurus A group', kind: 'group', ra: '13 25 27.615', dec: '-43 01 08.81', dist: { mpc: 3.76 }, radius: { kpc: 192 },
    source: 'Karachentsev et al. 2007, AJ 133, 504 (3.76 Mpc, harmonic radius 192 kpc); NGC 5128 position: SIMBAD' },

  // Virgo Cluster: "adopted mean distance of 16.5 ± 0.1 (random) ± 1.1 Mpc (systematic)",
  // Mei et al. 2007, ApJ 655, 144 (arXiv:astro-ph/0702510). Centre marked at M87 (SIMBAD).
  { id: 'virgo', name: 'Virgo Cluster', kind: 'cluster', ra: '12 30 49.423', dec: '+12 23 28.04', dist: { mpc: 16.5 }, flyTo: true,
    source: 'Mei et al. 2007, ApJ 655, 144 (16.5 Mpc); centre at M87, position: SIMBAD' },

  // Great Attractor: "centered on l = 307, b = 9 at a distance of Rm = 4350 ± 350 km s-1",
  // Lynden-Bell et al. 1988, ApJ 326, 19. The paper gives distances only in km/s; converted
  // here with H0 from Tully et al. 2014. Later work puts the Norma cluster at l = 325.3°,
  // b = −7.2° (Woudt et al. 2008, MNRAS 383, 445), so the location is uncertain.
  { id: 'greatattractor', name: 'Great Attractor', kind: 'region', coord: { sys: 'gal', lon: 307, lat: 9 }, dist: { kms: 4350, H0: H0_TULLY_2014 },
    label: 'Great Attractor (region, location uncertain)', flyTo: true, fromRedshift: true,
    source: 'Lynden-Bell et al. 1988, ApJ 326, 19 (l = 307, b = 9, 4350 km/s); distance via H0 = 75.2 (Tully et al. 2014)' },

  // Coma Cluster: "In this paper we assume a distance of 100 Mpc", Carter et al. 2008, ApJS 176, 424
  // (arXiv:0801.3745). Centre: ACO 1656 position from SIMBAD.
  { id: 'coma', name: 'Coma Cluster', kind: 'cluster', ra: '12 59 44.40', dec: '+27 54 44.9', dist: { mpc: 100 }, flyTo: true, fromRedshift: true,
    source: 'Carter et al. 2008, ApJS 176, 424 (100 Mpc); ACO 1656 position: SIMBAD' },

  // Laniakea: "if approximated as round, has a diameter 12,000 km s-1 or 160 Mpc", attractor
  // centroid "[-4700, 1300, -500] km s-1" (supergalactic SGX, SGY, SGZ, the axes of the paper's
  // maps), Tully, Courtois, Hoffman & Pomarède 2014, Nature 513, 71 (arXiv:1409.0880).
  // Drawn as a SCHEMATIC round outline: the real basin is irregular.
  { id: 'laniakea', name: 'Laniakea Supercluster', kind: 'region', sgxyzKms: [-4700, 1300, -500], H0: H0_TULLY_2014, radius: { mpc: 80 },
    label: 'Laniakea (schematic outline)', flyTo: true, fromRedshift: true,
    source: 'Tully et al. 2014, Nature 513, 71 (diameter 160 Mpc; centroid [-4700, 1300, -500] km/s, H0 = 75.2)' },
];

/**
 * The edge of the observable universe: radius = half the site constant
 * (about 93 billion ly across). Shown only as an edge pointer.
 */
export const OBSERVABLE_EDGE = {
  id: 'edge', name: 'Observable universe edge', kind: 'edge',
  source: 'Site constant: observable universe about 93 billion light-years across (astro.js)',
};
