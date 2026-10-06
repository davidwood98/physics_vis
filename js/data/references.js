/**
 * references.js: small real objects to compare with one screen pixel
 * (data only). Sizes in metres; every entry cites its source in a comment
 * and in its `source` field. All sources retrieved 2026-10-06.
 *
 * typicalM: the value the source gives as typical/mean where it gives one;
 * otherwise mid = true and the page uses the geometric middle of rangeM
 * (√(min × max), the natural middle of a size class: for the Wentworth sand
 * classes this is exactly the class midpoint on the phi scale).
 * Entries without a fetchable source were dropped (amoeba, printed full stop).
 */

export const PIXEL_REFERENCES = [
  // "A typical RBC measures approximately 6.2 to 8.2 µm in diameter": Bandaru & Killeen,
  // "Poikilocytosis", StatPearls (NCBI Bookshelf NBK562141), https://www.ncbi.nlm.nih.gov/books/NBK562141/
  { id: 'rbc', name: 'red blood cell', rangeM: [6.2e-6, 8.2e-6], mid: true, dimension: 'across',
    note: 'A biconcave disc, the commonest cell in blood.',
    source: 'Bandaru & Killeen, "Poikilocytosis", StatPearls, NCBI Bookshelf NBK562141' },

  // "Pollen grains from anemophilous plants are mainly in the size range from 15 microns to 80 microns":
  // Emberlin 2003, Postępy Dermatologii i Alergologii 20(4):196-199,
  // https://www.termedia.pl/Aerobiology-aerodynamics-and-pollen-sampling,7,2106,1,1.html
  { id: 'pollen', name: 'pollen grain', rangeM: [15e-6, 80e-6], mid: true, dimension: 'across',
    note: 'Wind-carried pollen; insect-carried grains vary more.',
    source: 'Emberlin 2003, "Aerobiology, aerodynamics and pollen sampling", Postępy Dermatologii i Alergologii 20(4):196' },

  // "I have found the diameter of human hair to range from 17 to 181 μm"; the editor's SEM
  // measurements were 60-80 µm: Ley, "Diameter of a Human Hair", The Physics Factbook (ed. G. Elert),
  // https://hypertextbook.com/facts/1999/BrianLey.shtml
  { id: 'hair', name: 'human hair', typicalM: 70e-6, rangeM: [17e-6, 181e-6], dimension: 'thick',
    note: 'Fine blond hair is thinner, coarse black hair thicker.',
    source: 'Ley 1999, "Diameter of a Human Hair", The Physics Factbook (hypertextbook.com)' },

  // Wentworth (1922), J. Geology 30:377-392, as tabulated by the USGS: "very fine sand (63 to 125
  // micron diameter ...)": Ellis et al. 2017, USGS Data Series 1046, Grain-Size Data Dictionary,
  // https://pubs.usgs.gov/ds/1046/data/Grain-Size_Data_Dictionary.pdf (63 is the rounded 62.5).
  { id: 'veryfinesand', name: 'grain of very fine sand', rangeM: [62.5e-6, 125e-6], mid: true, dimension: 'across',
    note: 'Wentworth grain-size class, like silty beach sand.',
    source: 'Wentworth 1922 grain-size scale, via USGS Data Series 1046 (Ellis et al. 2017)' },

  // "oolemmal diameter was 109.4±4.1 μm (range 98.5-122.3 μm)": Weghofer et al. 2019, PLoS One
  // 14(10):e0222390, https://pmc.ncbi.nlm.nih.gov/articles/PMC6812759
  { id: 'egg', name: 'human egg cell', typicalM: 109.4e-6, rangeM: [98.5e-6, 122.3e-6], dimension: 'across',
    note: 'Without its outer jelly coat, the largest human cell.',
    source: 'Weghofer et al. 2019, PLoS One 14(10):e0222390' },

  // "fine sand (125 to 250 micron diameter ...)": USGS Data Series 1046 (Wentworth scale), as above.
  { id: 'finesand', name: 'grain of fine sand', rangeM: [125e-6, 250e-6], mid: true, dimension: 'across',
    note: 'Wentworth grain-size class.',
    source: 'Wentworth 1922 grain-size scale, via USGS Data Series 1046 (Ellis et al. 2017)' },

  // "medium sand (250 to 500 micron diameter ...)": USGS Data Series 1046 (Wentworth scale), as above.
  { id: 'mediumsand', name: 'grain of medium sand', rangeM: [250e-6, 500e-6], mid: true, dimension: 'across',
    note: 'Wentworth grain-size class, typical beach sand.',
    source: 'Wentworth 1922 grain-size scale, via USGS Data Series 1046 (Ellis et al. 2017)' },

  // "The female measures approximately 420 microns in length": Denmark & Cromroy, "House Dust Mites,
  // Dermatophagoides spp.", UF/IFAS EDIS EENY-059, https://ask.ifas.ufl.edu/publication/IN216 .
  // Range 230-470 µm across house dust mite species: Mariana et al. 2007, Tropical Biomedicine 24(2):29.
  { id: 'dustmite', name: 'house dust mite', typicalM: 420e-6, rangeM: [230e-6, 470e-6], dimension: 'long',
    note: 'Adult body length; males are a little smaller.',
    source: 'Denmark & Cromroy, UF/IFAS EDIS EENY-059 (420 µm); Mariana et al. 2007, Tropical Biomedicine 24(2):29' },

  // "The mean particle size of approx. 0.45 mm", with sieve limits 0.212-0.71 mm: Cheetham Salt,
  // "Mermaid Table Salt" product specification (1 Oct 2024),
  // https://www.cheethamsalt.com.au/uploads/media/MERMAIDTABLESALT1554SPECIFICATION-1740450722.pdf
  { id: 'salt', name: 'grain of table salt', typicalM: 0.45e-3, rangeM: [0.212e-3, 0.71e-3], dimension: 'across',
    note: 'A tiny cube; manufacturer sieve specification.',
    source: 'Cheetham Salt, "Mermaid Table Salt" product specification, 2024' },

  // White sugar standard grade, mean aperture 0.40-1.00 mm: Südzucker AG, "White Sugar - EU Grade 2"
  // product specification (April 2026), https://www.suedzucker.com/wp-content/uploads/2026/06/White-Sugar-Grade-2.pdf
  { id: 'sugar', name: 'granulated sugar crystal', rangeM: [0.4e-3, 1.0e-3], mid: true, dimension: 'across',
    note: 'Standard white sugar, manufacturer sieve specification.',
    source: 'Südzucker AG, "White Sugar - EU Grade 2" product specification, 2026' },

  // "coarse sand (500 microns to 1 millimeter diameter ...)": USGS Data Series 1046 (Wentworth scale).
  { id: 'coarsesand', name: 'grain of coarse sand', rangeM: [0.5e-3, 1.0e-3], mid: true, dimension: 'across',
    note: 'Wentworth grain-size class.',
    source: 'Wentworth 1922 grain-size scale, via USGS Data Series 1046 (Ellis et al. 2017)' },

  // Papaver somniferum seeds, "Length 1.2 mm" / "Length 1.3 mm" (two reference specimens):
  // Digital Plant Atlas, Groningen Institute of Archaeology / DAI Berlin, https://p-atlas.app.rug.nl/item/Photo/85033
  { id: 'poppy', name: 'poppy seed', rangeM: [1.2e-3, 1.3e-3], mid: true, dimension: 'long',
    note: 'Measured reference seeds; about 1 mm wide.',
    source: 'Digital Plant Atlas (University of Groningen / DAI), Papaver somniferum specimens 85033, 85150' },

  // "1.5 mm = Diameter of pin head used in Wayne's Word articles": Armstrong, "Pin Head Comparison &
  // Scale of Nature", Wayne's Word, https://waynesword.net/pinhead.htm ; a retail dressmaker pin lists 1.60 mm.
  { id: 'pinhead', name: 'dressmaker pin head', typicalM: 1.5e-3, rangeM: [1.5e-3, 1.6e-3], dimension: 'across',
    note: 'Plain steel pin; glass-headed pins are bigger.',
    source: 'Armstrong, "Pin Head Comparison & Scale of Nature", Wayne\'s Word' },
];
