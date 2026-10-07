/**
 * beam-data.js: cited reference data for the beam deflection page (data only).
 *
 * Every value quotes its source in a comment and carries a `source` string the
 * page shows. All sources retrieved 2026-10-07. SI units: E and strength in Pa,
 * density in kg/m³, sizes in metres.
 */

/** Where the formulas come from (shown in the Sources card and the maths card). */
export const FORMULA_SOURCES = {
  deflection: {
    // Title page: "BEAM DESIGN FORMULAS WITH SHEAR AND MOMENT DIAGRAMS", "2005 EDITION",
    // "DESIGN AID No. 6", "Copyright © 2007 American Forest & Paper Association, Inc."
    // Figures used: 1 (simple beam, UDL), 7 (simple beam, load at centre), 8 (simple beam,
    // load at any point), 12 (cantilever, UDL), 13 (cantilever, load at free end).
    source: 'American Wood Council, "Beam Design Formulas with Shear and Moment Diagrams", Design Aid No. 6 (2005 ed.)',
    url: 'https://web-media.awc.org/wp-content/uploads/2021/12/17210710/AWC-DA6-BeamFormulas-0710.pdf',
  },
  sections: {
    // "A filled rectangular area with a base width of b and height h: Ix = bh³/12";
    // "A filled circular area of radius r: Ix = π/4 r⁴"; "An annulus of inner radius r1 and
    // outer radius r2: Ix = π/4 (r2⁴ − r1⁴)"; "A hollow rectangle with an inner rectangle whose
    // width is b1 and whose height is h1: Ix = (bh³ − b1h1³)/12".
    source: 'Wikipedia, "List of second moments of area" (citing eFunda and Roark\'s Formulas for Stress and Strain)',
    url: 'https://en.wikipedia.org/wiki/List_of_second_moments_of_area',
  },
};

/**
 * Materials. strength = the stress the "% of strength" readout compares with,
 * and strengthName says which kind it is (yield, 0.2% proof, timber bending
 * strength, or break). None of these are design values.
 */
export const MATERIALS = [
  {
    id: 's355',
    name: 'Structural steel S355',
    // "Modulus of elasticity, E = 210,000 N/mm²": SteelConstruction.info, "Steel material properties",
    // https://www.steelconstruction.info/Steel_material_properties
    E: 210e9,
    // "The masses per metre have been calculated assuming that the density of steel is 7850 kg/m3":
    // ArcelorMittal Orange Book, Explanatory notes, long products, 2. Dimensions of sections,
    // https://orangebook.arcelormittal.com/explanatory-notes/long-products/dimensions-of-sections
    density: 7850,
    // "Minimum yield and tensile strength for common steel grades" (BS EN 10025-2): S355, t ≤ 16 mm: 355 N/mm²
    // (345 for 16 < t ≤ 40): SteelConstruction.info, "Steel material properties", URL above.
    strength: 355e6,
    strengthName: 'yield strength (min., t ≤ 16 mm)',
    strengthShort: 'yield',
    note: 'Hot-rolled structural steel to BS EN 10025-2. Thicker parts have a slightly lower yield strength.',
    source: 'E and yield: SteelConstruction.info, "Steel material properties" (BS EN 10025-2); density: ArcelorMittal Orange Book explanatory notes',
    url: 'https://www.steelconstruction.info/Steel_material_properties',
  },
  {
    id: 's275',
    name: 'Structural steel S275',
    E: 210e9,          // as S355, SteelConstruction.info (above)
    density: 7850,     // as S355, ArcelorMittal Orange Book (above)
    // Same table: S275, t ≤ 16 mm: 275 N/mm² (265 for 16 < t ≤ 40).
    strength: 275e6,
    strengthName: 'yield strength (min., t ≤ 16 mm)',
    strengthShort: 'yield',
    note: 'Hot-rolled structural steel to BS EN 10025-2.',
    source: 'E and yield: SteelConstruction.info, "Steel material properties" (BS EN 10025-2); density: ArcelorMittal Orange Book explanatory notes',
    url: 'https://www.steelconstruction.info/Steel_material_properties',
  },
  {
    id: 'ss304',
    name: 'Stainless steel 304 (1.4301)',
    // Aalco datasheet "Stainless Steel 1.4301 (304) Sheet and Plate": "Density 8.00 g/cm³",
    // "Modulus of Elasticity 193 GPa", "Spec: EN 10088-2:2005 Sheet - Up to 8mm thick ... Proof Stress 230 Min MPa",
    // https://www.aalco.co.uk/datasheets/Stainless-Steel-14301-304-Sheet-and-Plate-Quarto-Plate--CPP-Plate_343.ashx
    E: 193e9,
    density: 8000,
    strength: 230e6,
    strengthName: '0.2% proof stress (min., sheet up to 8 mm)',
    strengthShort: 'proof stress',
    note: 'Annealed sheet. Hardened or cold-worked stainless (spring-tempered rules, for example) is much stronger.',
    source: 'Aalco datasheet, Stainless Steel 1.4301 (304) Sheet and Plate (EN 10088-2)',
    url: 'https://www.aalco.co.uk/datasheets/Stainless-Steel-14301-304-Sheet-and-Plate-Quarto-Plate--CPP-Plate_343.ashx',
  },
  {
    id: 'al6082',
    name: 'Aluminium 6082-T6 (extruded)',
    // Aalco datasheet "Aluminium Alloy 6082 T6 Extrusions": "Density 2.70 g/cm³", "Modulus of Elasticity 70 GPa",
    // "Spec: BS EN 755-2:2008 Tube - Up to 5mm Wall Thickness ... Proof Stress 250 Min MPa",
    // https://www.aalco.co.uk/datasheets/Aluminium-Alloy-6082-T6-Extrusions_338.ashx
    E: 70e9,
    density: 2700,
    strength: 250e6,
    strengthName: '0.2% proof stress (min., tube up to 5 mm wall)',
    strengthShort: 'proof stress',
    note: 'The common structural extrusion alloy in the UK and Europe.',
    source: 'Aalco datasheet, Aluminium Alloy 6082 T6 Extrusions (BS EN 755-2)',
    url: 'https://www.aalco.co.uk/datasheets/Aluminium-Alloy-6082-T6-Extrusions_338.ashx',
  },
  {
    id: 'al6061',
    name: 'Aluminium 6061-T6 (extruded)',
    // Aalco datasheet "Aluminium Alloy 6061 T6 Extrusions": "Density 2.70 g/cm³", "Modulus of Elasticity 70 GPa",
    // "Spec: BS EN 755-2:2008 Extrusions - Up to 200mm Dia. & A/F, 5mm WT for Tube and Prof ... Proof Stress 240 Min MPa",
    // https://www.aalco.co.uk/datasheets/Aluminium-Alloy-6061-T6-Extrusions_145.ashx
    E: 70e9,
    density: 2700,
    strength: 240e6,
    strengthName: '0.2% proof stress (min., extrusions)',
    strengthShort: 'proof stress',
    note: 'The common structural extrusion alloy in North America.',
    source: 'Aalco datasheet, Aluminium Alloy 6061 T6 Extrusions (BS EN 755-2)',
    url: 'https://www.aalco.co.uk/datasheets/Aluminium-Alloy-6061-T6-Extrusions_145.ashx',
  },
  {
    id: 'c24',
    name: 'Softwood timber C24 (along the grain)',
    // EN 338:2016 Table 1 (softwood strength classes, edgewise bending tests), C24 row:
    // "(24, 14.5, 0.4, 21, 2.5, 4.0, 11.0, 7.4, 0.37, 0.69, 350, 420)" = f_m_k 24 N/mm², ..., E_m_0_mean 11.0 kN/mm²,
    // ..., rho_k 350, rho_mean 420 kg/m³, as transcribed in the open-source Blueprints library:
    // https://github.com/Blueprints-org/blueprints/blob/main/blueprints/codes/eurocode/en_338_2016/chapter_5_classification_of_structural_timber/table_1.py
    // documented at https://blueprints.readthedocs.io/en/stable/API%20reference/codes/eurocode/en_338_2016/chapter_5_classification_of_structural_timber/table_1/
    // ("table.f_m_k 24", "table.e_m_0_mean 11.0", "table.rho_mean 420").
    E: 11e9,
    E90: 0.37e9,       // E_m_90_mean 0.37 kN/mm² (across the grain), same row: used only for the note's "about 30 times"
    density: 420,
    strength: 24e6,
    strengthName: 'characteristic bending strength fm,k (5th percentile)',
    strengthShort: 'bending strength',
    note: 'Timber is graded and anisotropic: E is the mean bending stiffness along the grain (11 GPa); across the grain it is about 30 times lower. Strength is a 5th-percentile bending strength, not a yield point.',
    source: 'EN 338:2016 Table 1, C24 (mean E along the grain, mean density, characteristic bending strength), as transcribed by the Blueprints project',
    url: 'https://blueprints.readthedocs.io/en/stable/API%20reference/codes/eurocode/en_338_2016/chapter_5_classification_of_structural_timber/table_1/',
  },
  {
    id: 'pmma',
    name: 'Acrylic (PMMA, cast)',
    // POLYVANTIS / Röhm, PLEXIGLAS technical information Ref. No. 211-1 (04/25), "Typical property values
    // (at 23°C and 50% relative humidity)", PLEXIGLAS GS 0F00: "Density ρ 1.19 g/cm³ (ISO 1183)",
    // "Tensile strength σM ... 23 °C 80 MPa (ISO 527-2/1B/5)", "Modulus of elasticity Et (short-term value) 3300 MPa",
    // "Max. safety stress σmax. (up to 40 °C) 5–10 MPa",
    // https://www.voskunststoffen.nl/files/166151/datasheet%20plexiglas%20XT%20GS.pdf
    E: 3.3e9,
    density: 1190,
    strength: 80e6,
    strengthName: 'tensile strength at 23 °C (it breaks; there is no yield)',
    strengthShort: 'tensile strength',
    note: 'E is a short-term value. Acrylic creeps under a steady load: the maker gives a maximum long-term "safety stress" of only 5 to 10 MPa.',
    longTermStressMPa: [5, 10],
    source: 'PLEXIGLAS GS technical information 211-1 (POLYVANTIS / Röhm, 04/25)',
    url: 'https://www.voskunststoffen.nl/files/166151/datasheet%20plexiglas%20XT%20GS.pdf',
  },
];

/** Sizes used by the presets, each from a fetched product page or section table. */
export const PRESET_SIZES = {
  // Axminster Tools, "Shinwa Stainless Steel Rule": 300 mm model "Overall length 335mm x Width 25mm x
  // Thickness 1mm", "hardened stainless steel", https://www.axminstertools.com/shinwa-stainless-steel-rule-ax1054062
  rule: { width: 0.025, thickness: 0.001, length: 0.335,
    source: 'Shinwa 300 mm stainless steel rule, 335 × 25 × 1 mm (Axminster Tools product page)',
    url: 'https://www.axminstertools.com/shinwa-stainless-steel-rule-ax1054062' },
  // J T Dove, "Internal Softwood Pine Furniture Board (2350 x 250 x 18mm)", "Made of quality pine softwood",
  // https://jtdove.co.uk/products/internal-softwood-pine-furniture-board-2350-x-250-x-18mm
  shelfBoard: { width: 0.25, thickness: 0.018,
    source: 'Pine furniture board 250 × 18 mm (J T Dove product page)',
    url: 'https://jtdove.co.uk/products/internal-softwood-pine-furniture-board-2350-x-250-x-18mm' },
  // B&Q, "Laminated Pine Board - 18mm - 1150x500 shelves cupboards general purpose PB10": Length 1.15m,
  // Width 500mm, Thickness 18mm, Material Pine,
  // https://diy.com/departments/laminated-pine-board-18mm-1150x500-shelves-cupboards-general-purpose-pb10/5055170305191_BQ.prd
  deskBoard: { length: 1.15, width: 0.5, thickness: 0.018,
    source: 'Laminated pine board 1150 × 500 × 18 mm (B&Q product page)',
    url: 'https://diy.com/departments/laminated-pine-board-18mm-1150x500-shelves-cupboards-general-purpose-pb10/5055170305191_BQ.prd' },
  // The Metal Store, "Aluminium Box Section 2mm Thick": "supplied in Grade 6082", size option
  // "40mm x 40mm x 2mm - 1m long", https://www.themetalstore.co.uk/products/aluminium-box-section-2mm-thick
  aluBox: { B: 0.04, H: 0.04, t: 0.002, length: 1,
    source: 'Aluminium box section 40 × 40 × 2 mm, grade 6082, 1 m long (The Metal Store product page)',
    url: 'https://www.themetalstore.co.uk/products/aluminium-box-section-2mm-thick' },
  // ArcelorMittal Orange Book, "Parallel flange I sections - IPE, S355, 1. Section properties", row
  // "IPE 100 8.1 100.0 55.0 4.1 5.7 7.0 74.6 ... 171 15.9 ... 10.3": mass 8.1 kg/m, h 100.0 mm, b 55.0 mm,
  // tw 4.1 mm, tf 5.7 mm, r 7.0 mm, Iy 171 cm⁴, A 10.3 cm², https://orangebook.arcelormittal.com/node/6
  ipe100: { h: 0.1, b: 0.055, tw: 0.0041, tf: 0.0057, r: 0.007, Iy: 171e-8, A: 10.3e-4, massPerMetre: 8.1,
    source: 'IPE 100 dimensions and tabulated Iy = 171 cm⁴ (ArcelorMittal Orange Book, IPE section properties)',
    url: 'https://orangebook.arcelormittal.com/node/6' },
  // PLEXIGLAS technical information 211-1 (above): PLEXIGLAS GS "2 mm to 160 mm solid sheet/block thickness".
  // A 10 mm sheet is inside that range; the 200 mm width is a cut size chosen for the example.
  acrylicSheet: { thickness: 0.01,
    source: 'Cast acrylic sheet is made from 2 mm to 160 mm thick (PLEXIGLAS technical information 211-1)',
    url: 'https://www.voskunststoffen.nl/files/166151/datasheet%20plexiglas%20XT%20GS.pdf' },
};
