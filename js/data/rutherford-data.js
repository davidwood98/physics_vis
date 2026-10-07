/**
 * rutherford-data.js: cited reference data for the Rutherford scattering page
 * (data only, no maths). Every value quotes its source in a comment; all
 * sources retrieved 2026-10-07. Values are stored in the units the source
 * gives them; js/rutherford-model.js converts to SI.
 *
 * Not used, and why:
 *  - The IAEA charge-radii page (www-nds.iaea.org/radii, Angeli & Marinova 2013)
 *    sits behind a bot-check page and could not be fetched, so the radii come
 *    from the previous edition of the same evaluation, Angeli 2004.
 */

/* ---------- Fundamental constants: CODATA 2022 (NIST) ---------- */

// NIST, "Fundamental Physical Constants, Complete Listing, 2022 CODATA adjustment",
// https://physics.nist.gov/cuu/Constants/Table/allascii.txt (retrieved 2026-10-07)
const CODATA_URL = 'https://physics.nist.gov/cuu/Constants/Table/allascii.txt';
const CODATA_SOURCE = 'CODATA 2022 recommended values (NIST)';

export const CONSTANTS = {
  // "fine-structure constant   7.297 352 5643 e-3   0.000 000 0011 e-3"
  fineStructure: 7.2973525643e-3,
  // "reduced Planck constant times c in MeV fm   197.326 980 4...   (exact)"
  hbarcMeVfm: 197.3269804,
  // "alpha particle mass in u   4.001 506 179 129   0.000 000 000 062   u"
  alphaMassU: 4.001506179129,
  // "alpha particle mass energy equivalent in MeV   3727.379 4118   0.000 0012   MeV"
  alphaMassMeV: 3727.3794118,
  // "alpha particle rms charge radius   1.6785 e-15   0.0021 e-15   m"
  alphaRmsRadiusFm: 1.6785,
  // "Avogadro constant   6.022 140 76 e23   (exact)   mol^-1"
  avogadro: 6.02214076e23,
  // "electron mass in u   5.485 799 090 441 e-4   0.000 000 000 097 e-4   u"
  electronMassU: 5.485799090441e-4,
  // The alpha particle is the helium-4 nucleus: charge +2e (helium's atomic number,
  // "Atomic number 2", PDG helium page https://pdg.lbl.gov/2024/AtomicNuclearProperties/HTML/helium_gas_He.html).
  alphaChargeZ: 2,
  source: CODATA_SOURCE,
  url: CODATA_URL,
};

/* ---------- Target metals ---------- */

// Z, atomic mass and density: Particle Data Group, "Atomic and Nuclear Properties of Materials" (2024),
//   https://pdg.lbl.gov/2024/AtomicNuclearProperties/HTML/<metal>.html (retrieved 2026-10-07).
// Lattice constant (cube edge at 25 °C, angstroms) and crystal structure: Swanson & Tatge, "Standard X-ray
//   Diffraction Powder Patterns", NBS Circular 539 Vol. I (1953),
//   https://nvlpubs.nist.gov/nistpubs/Legacy/circ/nbscircular539v1.pdf (retrieved 2026-10-07).
// rms nuclear charge radius: I. Angeli, "A consistent set of nuclear rms charge radii", Atomic Data and
//   Nuclear Data Tables 87 (2004) 185-206, Table 1, via
//   https://galileo.phys.virginia.edu/research/groups/ncd/dldata/rms_pdf.pdf (retrieved 2026-10-07).
// Alpha CSDA ranges [kinetic energy MeV, range g/cm²]: NIST ASTAR (Berger, Coursey, Zucker & Chang),
//   https://physics.nist.gov/PhysRefData/Star/Text/ASTAR.html (retrieved 2026-10-07), default energy grid.

const PDG = 'Particle Data Group, Atomic and Nuclear Properties of Materials (2024)';
const NBS = 'Swanson & Tatge 1953, NBS Circular 539 Vol. I (lattice constant at 25 °C)';
const ANGELI = 'Angeli 2004, Atomic Data and Nuclear Data Tables 87, 185 (Table 1)';
const ASTAR = 'NIST ASTAR stopping-power and range tables for alpha particles';
const pdgUrl = (page) => `https://pdg.lbl.gov/2024/AtomicNuclearProperties/HTML/${page}.html`;
const NBS_URL = 'https://nvlpubs.nist.gov/nistpubs/Legacy/circ/nbscircular539v1.pdf';
const ANGELI_URL = 'https://galileo.phys.virginia.edu/research/groups/ncd/dldata/rms_pdf.pdf';
const ASTAR_URL = 'https://physics.nist.gov/PhysRefData/Star/Text/ASTAR.html';

export const TARGETS = {
  gold: {
    id: 'gold', name: 'gold', Name: 'Gold', symbol: 'Au',
    // PDG gold_Au: "Atomic number 79", "Atomic mass 196.966569(5) g mol-1", "Density 19.32 g cm-3"
    Z: 79, molarMassG: 196.966569, densityGcm3: 19.32,
    // NBS Circ. 539: "The gold lattice is face-centered cubic ... There are four atoms per unit cell."
    //   "Unit cell at 25°C, angstroms ... 1953 Swanson and Tatge 4.0786"
    latticeA: 4.0786, structure: 'fcc',
    // Angeli 2004 Table 1: "79 Au ... 197 5.4358 .0037" (gold has one stable isotope, gold-197)
    isotope: 'gold-197', rmsRadiusFm: 5.4358,
    // ASTAR material 79 (GOLD): CSDA range
    range: [[0.1, 0.001193], [0.2, 0.00168], [0.3, 0.002053], [0.4, 0.002373], [0.5, 0.002664], [0.6, 0.002938],
      [0.7, 0.003203], [0.8, 0.003461], [0.9, 0.003718], [1, 0.003974], [1.25, 0.004619], [1.5, 0.005275],
      [1.75, 0.005951], [2, 0.006655], [2.25, 0.007392], [2.5, 0.008165], [2.75, 0.00897], [3, 0.009807],
      [3.5, 0.01157], [4, 0.01345], [4.5, 0.01543], [5, 0.01752], [5.5, 0.01971], [6, 0.022], [6.5, 0.02438],
      [7, 0.02685], [7.5, 0.02942], [8, 0.03207], [8.5, 0.0348], [9, 0.03762], [9.5, 0.04053], [10, 0.04352],
      [12.5, 0.05965]],
    urls: { pdg: pdgUrl('gold_Au') },
  },
  silver: {
    id: 'silver', name: 'silver', Name: 'Silver', symbol: 'Ag',
    // PDG silver_Ag: "Atomic number 47", "Atomic mass 107.8682(2) g mol-1", "Density 10.50 g cm-3"
    Z: 47, molarMassG: 107.8682, densityGcm3: 10.5,
    // NBS Circ. 539: "The atoms in silver are arranged in a face-centered lattice ... four atoms in the unit cell."
    //   "Unit cell in angstroms at 25°C ... 1953 Swanson and Tatge 4.0862"
    latticeA: 4.0862, structure: 'fcc',
    // Angeli 2004 Table 1: "47 Ag ... 107 4.5442 .0035" (silver-109: "109 4.5647 .0029")
    isotope: 'silver-107', rmsRadiusFm: 4.5442,
    // ASTAR material 47 (SILVER): CSDA range
    range: [[0.1, 0.0005797], [0.2, 0.0008594], [0.3, 0.001082], [0.4, 0.001277], [0.5, 0.001456], [0.6, 0.001626],
      [0.7, 0.00179], [0.8, 0.001952], [0.9, 0.002112], [1, 0.002272], [1.25, 0.002678], [1.5, 0.0031],
      [1.75, 0.003542], [2, 0.004007], [2.25, 0.004497], [2.5, 0.005011], [2.75, 0.00555], [3, 0.006112],
      [3.5, 0.007307], [4, 0.008591], [4.5, 0.009963], [5, 0.01142], [5.5, 0.01296], [6, 0.01457], [6.5, 0.01626],
      [7, 0.01803], [7.5, 0.01987], [8, 0.02178], [8.5, 0.02377], [9, 0.02582], [9.5, 0.02794], [10, 0.03012],
      [12.5, 0.04203]],
    urls: { pdg: pdgUrl('silver_Ag') },
  },
  copper: {
    id: 'copper', name: 'copper', Name: 'Copper', symbol: 'Cu',
    // PDG copper_Cu: "Atomic number 29", "Atomic mass 63.546(3) g mol-1", "Density 8.960 g cm-3"
    Z: 29, molarMassG: 63.546, densityGcm3: 8.96,
    // NBS Circ. 539: "The lattice was first determined by Bragg [31] in 1914 as face-centered cubic ...
    //   there are four atoms in the unit cell." "1953 Swanson and Tatge 3.6150"
    latticeA: 3.615, structure: 'fcc',
    // Angeli 2004 Table 1: "29 Cu 63 3.8823 .0017" (copper-65: "65 3.9022 .0017")
    isotope: 'copper-63', rmsRadiusFm: 3.8823,
    // ASTAR material 29 (COPPER): CSDA range
    range: [[0.1, 0.0005186], [0.2, 0.0007696], [0.3, 0.000967], [0.4, 0.001139], [0.5, 0.001297], [0.6, 0.001448],
      [0.7, 0.001593], [0.8, 0.001736], [0.9, 0.001877], [1, 0.002019], [1.25, 0.002376], [1.5, 0.002741],
      [1.75, 0.003118], [2, 0.003509], [2.25, 0.003914], [2.5, 0.004334], [2.75, 0.004767], [3, 0.005216],
      [3.5, 0.006157], [4, 0.00716], [4.5, 0.008224], [5, 0.009352], [5.5, 0.01054], [6, 0.0118], [6.5, 0.01312],
      [7, 0.0145], [7.5, 0.01594], [8, 0.01745], [8.5, 0.01901], [9, 0.02064], [9.5, 0.02232], [10, 0.02406],
      [12.5, 0.03361]],
    urls: { pdg: pdgUrl('copper_Cu') },
  },
  aluminium: {
    id: 'aluminium', name: 'aluminium', Name: 'Aluminium', symbol: 'Al',
    // PDG aluminum_Al: "Atomic number 13", "Atomic mass 26.9815385(7) g mol-1", "Density 2.699 g cm-3"
    Z: 13, molarMassG: 26.9815385, densityGcm3: 2.699,
    // NBS Circ. 539: "Aluminum has a face-centered cubic lattice [102], four atoms to the unit cell"
    //   "1953 Swanson and Tatge 4.0494" (unit cell at 25 °C, angstroms)
    latticeA: 4.0494, structure: 'fcc',
    // Angeli 2004 Table 1: "13 Al 27 3.0605 .0040" (aluminium has one stable isotope, aluminium-27)
    isotope: 'aluminium-27', rmsRadiusFm: 3.0605,
    // ASTAR material 13 (ALUMINUM): CSDA range
    range: [[0.1, 0.0002059], [0.2, 0.0003021], [0.3, 0.0003857], [0.4, 0.0004648], [0.5, 0.0005421],
      [0.6, 0.0006189], [0.7, 0.0006962], [0.8, 0.0007743], [0.9, 0.0008536], [1, 0.0009343], [1.25, 0.001144],
      [1.5, 0.001365], [1.75, 0.001598], [2, 0.001845], [2.25, 0.002105], [2.5, 0.002378], [2.75, 0.002663],
      [3, 0.002961], [3.5, 0.003596], [4, 0.004283], [4.5, 0.005027], [5, 0.005825], [5.5, 0.006678],
      [6, 0.007585], [6.5, 0.008544], [7, 0.009554], [7.5, 0.01061], [8, 0.01173], [8.5, 0.01289], [9, 0.0141],
      [9.5, 0.01535], [10, 0.01666], [12.5, 0.02388]],
    urls: { pdg: pdgUrl('aluminum_Al') },
  },
  platinum: {
    id: 'platinum', name: 'platinum', Name: 'Platinum', symbol: 'Pt',
    // PDG platinum_Pt: "Atomic number 78", "Atomic mass 195.084(9) g mol-1", "Density 21.45 g cm-3"
    Z: 78, molarMassG: 195.084, densityGcm3: 21.45,
    // NBS Circ. 539: "The platinum lattice is face-centered cubic [106] ... with four atoms in the unit cell."
    //   "1953 Swanson and Tatge 3.9231"
    latticeA: 3.9231, structure: 'fcc',
    // Angeli 2004 Table 1: "78 Pt ... 195 5.4278 .0026"
    isotope: 'platinum-195', rmsRadiusFm: 5.4278,
    // ASTAR material 78 (PLATINUM): CSDA range
    range: [[0.1, 0.001132], [0.2, 0.001638], [0.3, 0.002032], [0.4, 0.002371], [0.5, 0.002681], [0.6, 0.002971],
      [0.7, 0.003251], [0.8, 0.003524], [0.9, 0.003795], [1, 0.004064], [1.25, 0.004744], [1.5, 0.005435],
      [1.75, 0.006143], [2, 0.006873], [2.25, 0.007627], [2.5, 0.008408], [2.75, 0.009216], [3, 0.01005],
      [3.5, 0.01181], [4, 0.01369], [4.5, 0.01568], [5, 0.01777], [5.5, 0.01996], [6, 0.02224], [6.5, 0.02462],
      [7, 0.0271], [7.5, 0.02966], [8, 0.03231], [8.5, 0.03505], [9, 0.03787], [9.5, 0.04078], [10, 0.04377],
      [12.5, 0.0599]],
    urls: { pdg: pdgUrl('platinum_Pt') },
  },
};

for (const t of Object.values(TARGETS)) {
  t.sources = { pdg: PDG, lattice: NBS, radius: ANGELI, range: ASTAR };
  Object.assign(t.urls, { lattice: NBS_URL, radius: ANGELI_URL, range: ASTAR_URL });
}

/* ---------- Dry air (for the alphas' path to the 1909 reflector) ---------- */

// ASTAR material 104, "Composition of AIR, DRY (NEAR SEA LEVEL): Density (g/cm3) = 1.20479E-03",
// https://physics.nist.gov/cgi-bin/Star/compos.pl?ap104 ; CSDA range [MeV, g/cm²] from the ASTAR table.
export const AIR = {
  densityGcm3: 1.20479e-3,
  range: [[0.1, 0.0001665], [0.2, 0.0002472], [0.3, 0.0003108], [0.4, 0.0003667], [0.5, 0.0004188],
    [0.6, 0.000469], [0.7, 0.0005186], [0.8, 0.0005682], [0.9, 0.0006185], [1, 0.0006698], [1.25, 0.0008049],
    [1.5, 0.000952], [1.75, 0.001112], [2, 0.001287], [2.25, 0.001474], [2.5, 0.001675], [2.75, 0.001889],
    [3, 0.002116], [3.5, 0.002607], [4, 0.003147], [4.5, 0.003734], [5, 0.004368], [5.5, 0.005048],
    [6, 0.005772], [6.5, 0.00654], [7, 0.007351], [7.5, 0.008205], [8, 0.0091], [8.5, 0.01004], [9, 0.01102],
    [9.5, 0.01203], [10, 0.01309], [12.5, 0.01897]],
  source: ASTAR,
  url: ASTAR_URL,
};

/* ---------- Alpha sources (preset energies) ---------- */

// Main alpha line of each emitter: NNDC NuDat 3 decay radiation (ENSDF evaluations),
// https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=<nuclide>&unc=NDS (retrieved 2026-10-07).
// Historical names: van der Krogt, "Elementymology & Elements Multidict", polonium,
// https://vanderkrogt.net/elements/element.php?sym=Po : "Radium-A Ra A 218 Po", "Radium-C' Ra C' 214 Po",
// "Radium-F ... 210 Po".
export const ALPHA_SOURCES = {
  // Po-210 (NDS 201, 346 (2025)): "5304.33 7  100 %"
  po210: { id: 'po210', label: 'Polonium-210', energyMeV: 5.30433, oldName: 'radium F',
    source: 'NNDC NuDat 3, polonium-210 decay (Nuclear Data Sheets 201, 346)',
    url: 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=210PO&unc=NDS' },
  // Rn-222 (NDS 160, 405 (2019)): "5489.48 30  99.920 %"
  rn222: { id: 'rn222', label: 'Radon-222', energyMeV: 5.48948, oldName: 'radium emanation',
    source: 'NNDC NuDat 3, radon-222 decay (Nuclear Data Sheets 160, 405)',
    url: 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=222RN&unc=NDS' },
  // Po-218 (NDS 175, 1 (2021)): "6002.55 10  99.9789 %"
  po218: { id: 'po218', label: 'Polonium-218', energyMeV: 6.00255, oldName: 'radium A',
    source: 'NNDC NuDat 3, polonium-218 decay (Nuclear Data Sheets 175, 1)',
    url: 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=218PO&unc=NDS' },
  // Po-214 (NDS 121, 561 (2014)): "7686.82 7  99.9895 %"
  po214: { id: 'po214', label: 'Polonium-214', energyMeV: 7.68682, oldName: "radium C'",
    source: 'NNDC NuDat 3, polonium-214 decay (Nuclear Data Sheets 121, 561)',
    url: 'https://www.nndc.bnl.gov/nudat3/decaysearchdirect.jsp?nuc=214PO&unc=NDS' },
};

export const NAMES_SOURCE = {
  source: 'van der Krogt, Elementymology & Elements Multidict: polonium (historical isotope names)',
  url: 'https://vanderkrogt.net/elements/element.php?sym=Po',
};

/* ---------- The historical experiments ---------- */

export const HISTORY = {
  // Geiger & Marsden, "On a Diffuse Reflection of the α-Particles", Proc. R. Soc. Lond. A 82, 495-500 (1909),
  // transcription at https://www.chemteam.info/Chem-History/GM-1909.html (retrieved 2026-10-07).
  gm1909: {
    // Part III: "as radiating source, radium C, deposited on a plate of small dimensions, was used"
    //   ... "the α-particles from the plate A fell upon the platinum reflector R"
    //   ... "Three different determinations showed that of the incident α-particles about 1 in 8000 was reflected"
    reportedOneIn: 8000,
    metal: 'platinum',
    // "the particles from the radium C had to travel through a little over a centimetre of air before reaching
    //   the reflector"
    airCm: 1,
    // Part II: "about half of the reflected particles were reflected from a layer equivalent to about 2 mm. of air"
    //   ... "can be turned within a layer of 6 x 10^-5 cm. of gold through an angle of 90°"
    halfLayerCm: 6e-5,
    // "it was assumed that they were distributed uniformly round a half sphere"
    citation: 'Geiger & Marsden 1909, Proc. R. Soc. Lond. A 82, 495',
    url: 'https://www.chemteam.info/Chem-History/GM-1909.html',
  },
  // Rutherford, "The Scattering of α and β Particles by Matter and the Structure of the Atom",
  // Phil. Mag. 21, 669 (1911), transcription at
  // https://www.chemteam.info/Chem-History/Rutherford-1911/Rutherford-1911.html (retrieved 2026-10-07):
  // "about 1/8000 of the α particles from radium C falling on a thick plate of platinum are scattered back"
  // "The form of experiment is not very suited for accurate calculation" ... "a central charge of about 100 e"
  rutherford1911: {
    citation: 'Rutherford 1911, Phil. Mag. 21, 669',
    url: 'https://www.chemteam.info/Chem-History/Rutherford-1911/Rutherford-1911.html',
    platinumChargeEstimate: 100,
  },
  // Geiger & Marsden, "The Laws of Deflexion of α Particles through Large Angles", Phil. Mag. 25, 604 (1913),
  // transcription at https://www.desy.de/~hoffmann/Physik/GeigerMarsden-1913 (retrieved 2026-10-07):
  // "Observations were taken in various experiments for angles of deflexion from 5° to 150°"
  // "during the course of the experiments over 100,000 scintillations have been counted"
  gm1913: {
    citation: 'Geiger & Marsden 1913, Phil. Mag. 25, 604',
    url: 'https://www.desy.de/~hoffmann/Physik/GeigerMarsden-1913',
    minAngleDeg: 5,
    maxAngleDeg: 150,
  },
};
