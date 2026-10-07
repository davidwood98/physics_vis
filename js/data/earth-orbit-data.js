/**
 * earth-orbit-data.js: cited reference values for the Earth-to-orbit page
 * (data only, no code). SI units. Every value quotes its source text, URL and
 * retrieval date; `source` strings are shown on the page.
 *
 * Which Earth radius is used where:
 *  - the drawn Earth, altitudes of the ISS, GPS and the custom satellite, the
 *    surface escape speed and the "climb" energy use the volumetric MEAN
 *    radius (6,371.000 km). It matches astro.js EARTH_DIAMETER (12,742 km),
 *    the diameter the space page draws 2 cm across;
 *  - the geostationary altitude is quoted above the EQUATOR, so it uses the
 *    EQUATORIAL radius (6,378.137 km).
 * Moon distance: astro.js EARTH_MOON_DISTANCE (384,400 km), the site constant.
 */

const RETRIEVED = 'retrieved 2026-10-07';

/**
 * Geocentric gravitational constant GM⊕, m³/s².
 * "Geocentric constant of gravitation GM 3.986 004 418(8) 10^14 m3s-2 ... IERS numerical standard (IAG1999)"
 * IERS Earth Orientation Centre, "Useful constants", https://hpiers.obspm.fr/eop-pc/models/constants.html (retrieved 2026-10-07)
 */
export const GM_EARTH = 3.986004418e14;

/**
 * Earth radii, m. NASA Earth Fact Sheet (D.R. Williams, NSSDC):
 * "Equatorial radius (km) 6378.137", "Volumetric mean radius (km) 6371.000"
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html (retrieved 2026-10-07)
 * The same sheet gives "Escape velocity (km/s) 11.186" (used only as a check in the tests).
 */
export const EARTH_EQUATORIAL_RADIUS = 6378.137e3;
export const EARTH_MEAN_RADIUS = 6371.0e3;
export const NASA_ESCAPE_VELOCITY_CHECK = 11.186e3;

/**
 * Sidereal day (one turn of the Earth), s.
 * "Conventional duration of the sidereal day DS=D/k 86164.090 530 832 88 s exact
 *  (from k given in Aoki et al, 1982)". Same IERS page as GM⊕ (retrieved 2026-10-07).
 */
export const SIDEREAL_DAY = 86164.09053083288;

/**
 * Kármán line, m. FAI (Fédération Aéronautique Internationale), "100km Altitude
 * Boundary for Astronautics" (S. Sanz Fernández de Córdoba, last update 2004):
 * "The 100-Km altitude, ever since named the 'Karman Line', came thus into existence
 *  as the boundary separating Aeronautics and Astronautics."
 * https://www.fai.org/page/icare-boundary (the live page is behind a bot check; read via
 * https://web.archive.org/web/20210109154031/https://www.fai.org/page/icare-boundary, retrieved 2026-10-07)
 */
export const KARMAN_LINE = 100e3;

/** One international (statute) mile in metres: an exact definition. */
export const METRES_PER_MILE = 1609.344;

/**
 * International Space Station. NASA, "What Is the International Space Station? (Grades 5-8)":
 * "It orbits Earth at an average altitude of approximately 250 miles. It travels at
 *  17,500 mph. This means it orbits Earth every 90 minutes."
 * https://www.nasa.gov/learning-resources/for-kids-and-students/what-is-the-international-space-station-grades-5-8/ (retrieved 2026-10-07)
 * It varies: NASA JSC's public ISS trajectory file (CCSDS OEM, created 2026-10-05) lists
 * apogee / perigee heights "423.5 416.8" km for its 2026-10-07 event row ("Crew12 NET Undock").
 * https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt (retrieved 2026-10-07)
 */
export const ISS = {
  altitude: 250 * METRES_PER_MILE, // "approximately 250 miles" = 402.3 km
  altitudeMiles: 250,
  periodMinutesQuoted: 90, // NASA's round figure ("every 90 minutes")
  octoberApogee: 423.5e3,
  octoberPerigee: 416.8e3,
  // "The space station is 356 feet (109 meters) end-to-end": NASA, "Space Station Facts and Figures",
  // https://www.nasa.gov/international-space-station/space-station-facts-and-figures/ (retrieved 2026-10-07)
  lengthM: 109,
  source: 'NASA, "What Is the International Space Station?" (250 miles, every 90 minutes); NASA JSC ISS trajectory data, October 2026',
};

/**
 * GPS satellites. GPS.gov (U.S. National Coordination Office for Space-Based PNT), "Space Segment":
 * "GPS satellites fly in medium Earth orbit (MEO) at an altitude of approximately 20,200 km
 *  (12,550 miles). Each satellite circles the Earth twice a day."
 * https://www.gps.gov/space-segment (retrieved 2026-10-07)
 */
export const GPS = {
  altitude: 20200e3,
  source: 'GPS.gov, "Space Segment": about 20,200 km, twice a day',
};

/**
 * The Moon's distance is the site constant astro.js EARTH_MOON_DISTANCE (384,400 km). Check:
 * NASA Moon Fact Sheet, "Semimajor axis (10^6 km) 0.3844", "Perigee 0.3633", "Apogee 0.4055"
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html (retrieved 2026-10-07)
 */
export const MOON_SEMIMAJOR_AXIS_CHECK = 0.3844e9;

/** Sources for the page's Sources card (in order of use). */
export const SOURCES = [
  { what: 'Earth\'s mass parameter GM⊕ = 3.986004418 × 10¹⁴ m³/s² and the sidereal day, 86,164.09 s', name: 'IERS Earth Orientation Centre, "Useful constants" (IERS numerical standards)', url: 'https://hpiers.obspm.fr/eop-pc/models/constants.html' },
  { what: 'Earth\'s equatorial radius (6,378.137 km) and volumetric mean radius (6,371.000 km)', name: 'NASA Earth Fact Sheet (NSSDC)', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html' },
  { what: 'Kármán line at 100 km', name: 'FAI, "100km Altitude Boundary for Astronautics" (archived copy)', url: 'https://web.archive.org/web/20210109154031/https://www.fai.org/page/icare-boundary' },
  { what: 'ISS altitude (about 250 miles) and lap time (about 90 minutes)', name: 'NASA, "What Is the International Space Station?"', url: 'https://www.nasa.gov/learning-resources/for-kids-and-students/what-is-the-international-space-station-grades-5-8/' },
  { what: 'ISS height in October 2026 (417 to 424 km)', name: 'NASA JSC public ISS trajectory data (OEM ephemeris)', url: 'https://nasa-public-data.s3.amazonaws.com/iss-coords/current/ISS_OEM/ISS.OEM_J2K_EPH.txt' },
  { what: 'GPS orbit, about 20,200 km up, twice a day', name: 'GPS.gov, "Space Segment"', url: 'https://www.gps.gov/space-segment' },
  { what: 'The Moon\'s mean distance, 384,400 km (the site constant used on the space page)', name: 'NASA Moon Fact Sheet (NSSDC)', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html' },
];

export { RETRIEVED };
