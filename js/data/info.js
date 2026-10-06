/**
 * info.js: short descriptions and basic facts for the info cards (data only).
 * Every entry lists the page its facts came from; all retrieved 2026-10-06.
 * Keys: planet ids, 'sun', 'moon' (Earth's Moon), lower-case names of the
 * moons of other planets, short ids for stars and marker ids for galaxies and
 * structures (see solar.js). Objects without an entry get a card generated
 * from their catalogue fields (space-info.js).
 * Moon counts differ between NASA pages; the newest pages (2026) are used.
 */

const NASA = (path) => `https://science.nasa.gov/${path}`;

export const INFO = {
  /* ---------- The Sun and planets ---------- */
  sun: {
    type: 'star (G2 V yellow dwarf)',
    desc: 'A yellow dwarf star: a huge ball of hydrogen and helium held together by its own gravity. Its hottest region is its core.',
    facts: [['Age', 'about 4.5 billion years'], ['Surface composition (by number)', '90.97% hydrogen, 8.89% helium'], ['Surface temperature', 'about 5,500 °C'], ['Core temperature', 'about 15 million °C']],
    source: 'NASA Sun Facts; NSSDC Sun Fact Sheet', url: NASA('sun/facts/'),
  },
  mercury: {
    type: 'rocky planet',
    desc: 'The small rocky planet nearest the Sun, with a large metallic core and only a thin exosphere of atoms blasted off its surface. It has no moons.',
    facts: [['Age', 'about 4.5 billion years'], ['Core radius', 'about 2,074 km (about 85% of the planet\'s radius)'], ['Surface temperature', 'up to 430 °C by day, down to −180 °C at night'], ['Solar day', '176 Earth days'], ['Year', '88 Earth days']],
    source: 'NASA Mercury Facts', url: NASA('mercury/facts/'),
  },
  venus: {
    type: 'rocky planet',
    desc: 'A rocky planet (iron core, hot-rock mantle, thin crust) under a dense atmosphere of mostly carbon dioxide with sulfuric-acid clouds. Its surface is hot enough to melt lead, and it spins backwards compared with Earth.',
    facts: [['Age', 'about 4.6 billion years'], ['Surface temperature', 'about 467 °C'], ['Surface pressure', '93 times Earth\'s at sea level'], ['Solar day', 'about 117 Earth days'], ['Year', 'about 225 Earth days']],
    source: 'NASA Venus Facts', url: NASA('venus/venus-facts/'),
  },
  earth: {
    type: 'rocky planet, our home',
    desc: 'Our rocky home planet, layered into an inner core, outer core, mantle and crust, with a nitrogen-oxygen atmosphere and a global ocean.',
    facts: [['Age', 'about 4.5 billion years'], ['Atmosphere', '78% nitrogen, 21% oxygen, 1% other gases'], ['Ocean coverage', 'about 71% of the surface'], ['Rotation', '23.9 hours'], ['Year', '365.25 days']],
    source: 'NASA Earth Facts', url: NASA('earth/facts/'),
  },
  mars: {
    type: 'rocky planet',
    desc: 'A rocky planet with a dense core, rocky mantle and a crust of iron, magnesium, aluminium, calcium and potassium. Its thin atmosphere is mostly carbon dioxide, nitrogen and argon.',
    facts: [['Age', 'about 4.5 billion years'], ['Temperature', 'about 20 °C to −153 °C'], ['Day', '24.6 hours'], ['Year', '687 Earth days (669.6 sols)'], ['Moons', '2 (Phobos and Deimos)']],
    source: 'NASA Mars Facts', url: NASA('mars/facts/'),
  },
  jupiter: {
    type: 'gas giant',
    desc: 'A gas giant made mostly of hydrogen and helium, similar in composition to the Sun. Its Great Red Spot is a swirling oval of clouds wider than Earth.',
    facts: [['Composition', 'mostly hydrogen and helium'], ['Age', 'about 4.6 billion years'], ['Day', '9.9 hours'], ['Year', 'about 12 Earth years'], ['Moons', '115 recognised by the IAU (NASA, Sep 2026)']],
    source: 'NASA Jupiter Facts', url: NASA('jupiter/jupiter-facts/'),
  },
  saturn: {
    type: 'gas giant',
    desc: 'A gas giant made mostly of hydrogen and helium, and the only planet less dense on average than water. Its rings are billions of chunks of ice and rock coated with dust.',
    facts: [['Age', 'about 4.5 billion years'], ['Day', '10.7 hours'], ['Year', 'about 29.4 Earth years'], ['Rings', 'up to 282,000 km from the planet, typically about 10 m thick'], ['Moons', '293 confirmed (NASA, Aug 2026)']],
    source: 'NASA Saturn Facts; NASA Saturn Moons', url: NASA('saturn/facts/'),
  },
  uranus: {
    type: 'ice giant',
    desc: 'An ice giant whose interior is mostly a hot, dense fluid of "icy" materials, under a hydrogen-helium atmosphere with some methane. It is tipped over, its equator nearly at right angles to its orbit.',
    facts: [['Composition', '80% or more of its mass is water, methane and ammonia fluid'], ['Age', 'about 4.5 billion years'], ['Axial tilt', '97.77°'], ['Day', 'about 17 hours'], ['Moons', '29 officially recognised (NASA, Aug 2026)']],
    source: 'NASA Uranus Facts; NASA Uranus Moons', url: NASA('uranus/facts/'),
  },
  neptune: {
    type: 'ice giant',
    desc: 'An ice giant whose interior is mostly a hot, dense fluid of water, methane and ammonia. Its winds are far stronger than Jupiter\'s and whip clouds of frozen methane across the planet.',
    facts: [['Composition', '80% or more of its mass is "icy" fluid'], ['Age', 'about 4.5 billion years'], ['Distance from the Sun', 'about 30 AU (4.5 billion km)'], ['Winds', 'over 2,000 km/h'], ['Moons', '16 officially recognised (NASA, Sep 2026)']],
    source: 'NASA Neptune Facts; NASA Neptune Moons', url: NASA('neptune/neptune-facts/'),
  },

  /* ---------- Moons ---------- */
  moon: {
    type: 'Earth\'s natural satellite',
    desc: 'A rocky body with a core, mantle and crust that likely formed from debris thrown out when a Mars-sized body hit the young Earth. It has only a thin, unbreathable exosphere.',
    facts: [['Age', 'about 4.5 billion years'], ['Radius', 'about 1,740 km'], ['Average distance from Earth', '384,400 km'], ['Temperature', 'about 127 °C in sunlight to −173 °C in darkness'], ['Orbit', '27 days, spinning at the same rate']],
    source: 'NASA Moon Facts; NASA Moon Formation', url: NASA('moon/facts/'),
  },
  io: {
    type: 'moon of Jupiter',
    desc: 'The innermost of Jupiter\'s four large moons and the most volcanically active world in the solar system, with hundreds of volcanoes. Galileo spacecraft data suggest an iron core.',
    facts: [['Volcanoes', 'hundreds, some with lava fountains dozens of km high'], ['Tidal bulge', 'surface rises and falls up to 100 m'], ['Radius', '1,821.5 km'], ['Distance from Jupiter', 'about 422,000 km'], ['Orbital period', '1.77 days']],
    source: 'NASA Io Facts; NSSDC Jovian Satellite Fact Sheet', url: NASA('jupiter/jupiter-moons/io/facts/'),
  },
  europa: {
    type: 'moon of Jupiter',
    desc: 'An icy moon thought to have an iron core, a rocky mantle and a salty ocean under its ice shell. The ocean may hold more water than all of Earth\'s oceans, and the surface has few craters.',
    facts: [['Ice shell', '15–25 km thick'], ['Ocean depth', '60–150 km'], ['Diameter', 'about 3,100 km (about 90% of Earth\'s Moon)'], ['Orbital period', '3.5 days'], ['Surface age', 'about 40–90 million years']],
    source: 'NASA Europa Facts', url: NASA('jupiter/jupiter-moons/europa/europa-facts/'),
  },
  ganymede: {
    type: 'moon of Jupiter',
    desc: 'The largest moon in the solar system, bigger than Mercury. Rock and ice around a metallic iron core; the only moon known to have its own magnetic field, with an underground saltwater ocean.',
    facts: [['Diameter', 'about 5,260 km'], ['Ocean', 'estimated about 100 km thick'], ['Distance from Jupiter', 'about 1.07 million km'], ['Orbital period', '7.155 days'], ['Daytime surface temperature', '90–160 K']],
    source: 'NASA Ganymede Facts', url: NASA('jupiter/jupiter-moons/ganymede/facts/'),
  },
  callisto: {
    type: 'moon of Jupiter',
    desc: 'Jupiter\'s second-largest moon, possibly layers of ice mixed with rock and metal. The most heavily cratered object in the solar system; it may hide a salty ocean.',
    facts: [['Surface age', 'about 4 billion years'], ['Radius', '2,410.3 km'], ['Distance from Jupiter', 'about 1,883,000 km'], ['Orbital period', '16.689 days'], ['Possible ocean', 'about 250 km below the surface']],
    source: 'NASA Callisto Facts; NSSDC Jovian Satellite Fact Sheet', url: NASA('jupiter/jupiter-moons/callisto/facts/'),
  },
  titan: {
    type: 'moon of Saturn',
    desc: 'Saturn\'s giant moon, larger than Mercury, and the only moon known to have a substantial atmosphere. It has rivers, lakes and seas of liquid methane and ethane, and likely an underground water ocean.',
    facts: [['Atmosphere', 'about 95% nitrogen, 5% methane'], ['Surface pressure', 'about 60% higher than Earth\'s'], ['Surface temperature', '−179 °C'], ['Radius', 'about 2,575 km'], ['Orbital period', '15 days 22 hours']],
    source: 'NASA Titan Facts', url: NASA('saturn/moons/titan/facts/'),
  },
  enceladus: {
    type: 'moon of Saturn',
    desc: 'A small icy moon and the most reflective body in the solar system. Jets of icy particles and gas, fed by a global ocean inside it, erupt into Saturn\'s E ring.',
    facts: [['Diameter', 'about 500 km'], ['Surface temperature', 'about −201 °C'], ['Jet speed', 'about 400 m/s'], ['Orbital period', '32.9 hours']],
    source: 'NASA Enceladus', url: NASA('saturn/moons/enceladus/'),
  },
  mimas: {
    type: 'moon of Saturn',
    desc: 'A small moon made almost entirely of water ice, dominated by the enormous Herschel impact crater.',
    facts: [['Mean diameter', 'about 394 km'], ['Herschel Crater', '130 km across (a third of the moon\'s diameter)'], ['Distance from Saturn', 'about 186,000 km'], ['Orbital period', '22 h 36 min']],
    source: 'NASA Mimas', url: NASA('saturn/moons/mimas/'),
  },
  rhea: {
    type: 'moon of Saturn',
    desc: 'Saturn\'s second-largest moon, an even mix of ice and rock (a "dirty snowball"), with a very thin exosphere containing oxygen and carbon dioxide.',
    facts: [['Mean radius', 'about 764 km'], ['Makeup', 'about 3/4 ice, 1/4 rock'], ['Temperature', 'about −174 °C in sunlight to −220 °C in shade'], ['Distance from Saturn', 'about 527,000 km'], ['Orbital period', 'about 4.5 days']],
    source: 'NASA Rhea', url: NASA('saturn/moons/rhea/'),
  },
  iapetus: {
    type: 'moon of Saturn',
    desc: 'An ice-and-rock moon with a striking two-tone surface: a coal-dark leading hemisphere and a much brighter trailing one. A chain of mountains circles its equator.',
    facts: [['Makeup', 'about 3/4 ice, 1/4 rock'], ['Mean radius', 'about 736 km'], ['Reflectivity', '0.03–0.05 (dark side) vs 0.5–0.6 (bright side)'], ['Equatorial ridge', 'mountains about 10 km high'], ['Orbital period', '79.33 days']],
    source: 'NASA Iapetus; NSSDC Saturnian Satellite Fact Sheet', url: NASA('saturn/moons/iapetus/'),
  },
  dione: {
    type: 'moon of Saturn',
    desc: 'A small icy moon with a dense, probably rocky core. The bright "wisps" seen by Cassini are icy canyon walls.',
    facts: [['Interior', 'about 1/3 dense rocky core, the rest ice'], ['Mean radius', 'about 562 km'], ['Average temperature', '−186 °C (87 K)'], ['Distance from Saturn', 'about 377,400 km'], ['Orbital period', 'about 2.7 days']],
    source: 'NASA Dione', url: NASA('saturn/moons/dione/'),
  },
  tethys: {
    type: 'moon of Saturn',
    desc: 'A moon made almost entirely of water ice with a little rock, marked by the huge Odysseus impact crater and the long Ithaca Chasma canyon.',
    facts: [['Mean radius', 'about 533 km'], ['Density', '0.97 times liquid water\'s'], ['Odysseus Crater', '400 km wide'], ['Ithaca Chasma', 'about 2,000 km long, 3–5 km deep'], ['Orbital period', '45.3 hours']],
    source: 'NASA Tethys', url: NASA('saturn/moons/tethys/'),
  },
  miranda: {
    type: 'moon of Uranus',
    desc: 'The smallest and innermost of Uranus\'s five major moons, roughly equal parts water ice and silicate rock, with giant fault canyons.',
    facts: [['Diameter', 'about 500 km'], ['Canyons', 'up to 12 times deeper than the Grand Canyon'], ['Distance from Uranus', 'about 129,900 km'], ['Orbital period', '1.41 days'], ['Discovered', '16 Feb 1948 (Gerard Kuiper)']],
    source: 'NASA Miranda; NSSDC Uranian Satellite Fact Sheet', url: NASA('uranus/moons/miranda/'),
  },
  ariel: {
    type: 'moon of Uranus',
    desc: 'Roughly equal parts water ice and silicate rock. The brightest and apparently youngest surface of Uranus\'s five largest moons, crossed by fault-bounded valleys.',
    facts: [['Radius', 'about 578–581 km'], ['Density', '1,590 kg/m³'], ['Distance from Uranus', 'about 190,900 km'], ['Orbital period', '2.52 days'], ['Discovered', '24 Oct 1851 (William Lassell)']],
    source: 'NASA Ariel; NSSDC Uranian Satellite Fact Sheet', url: NASA('uranus/moons/ariel/'),
  },
  umbriel: {
    type: 'moon of Uranus',
    desc: 'The darkest of Uranus\'s largest moons, an ancient, cratered world of ice and rock. A puzzling bright ring stands out on its dark surface.',
    facts: [['Diameter', 'about 1,200 km'], ['Reflectivity', 'only 16% of incoming light'], ['Bright ring', 'about 140 km across'], ['Composition', 'roughly half ice, half rock'], ['Discovered', '24 Oct 1851']],
    source: 'NASA Umbriel; NASA Oberon', url: NASA('uranus/moons/umbriel/'),
  },
  titania: {
    type: 'moon of Uranus',
    desc: 'Uranus\'s largest moon, a neutral-grey world of ice and rock. Long fault valleys split its crust, a sign of past tectonic stretching.',
    facts: [['Diameter', 'about 1,600 km'], ['Fault valleys', 'some nearly 1,609 km long'], ['Composition', 'roughly half ice, half rock'], ['Discovered', '11 Jan 1787 (William Herschel)']],
    source: 'NASA Titania; NASA Oberon', url: NASA('uranus/moons/titania/'),
  },
  oberon: {
    type: 'moon of Uranus',
    desc: 'Uranus\'s second-largest moon, roughly half ice and half rock, with a heavily cratered surface and at least one large mountain.',
    facts: [['Radius', '761.4 km'], ['Mountain', 'rises about 6 km'], ['Distance from Uranus', 'about 583,500 km'], ['Orbital period', '13.46 days'], ['Discovered', '11 Jan 1787 (William Herschel)']],
    source: 'NASA Oberon; NSSDC Uranian Satellite Fact Sheet', url: NASA('uranus/moons/oberon/'),
  },
  triton: {
    type: 'moon of Neptune',
    desc: 'Neptune\'s big moon and the only large moon that orbits backwards, probably a captured Kuiper Belt object. A frozen-nitrogen crust covers an icy mantle over a rock-and-metal core; Voyager 2 saw active geysers.',
    facts: [['Diameter', 'about 2,700 km'], ['Surface temperature', '−235 °C'], ['Orbital period', '5.88 days (retrograde)'], ['Density', '2,050 kg/m³'], ['Discovered', '10 Oct 1846 (William Lassell)']],
    source: 'NASA Triton; NSSDC Neptunian Satellite Fact Sheet', url: NASA('neptune/moons/triton/'),
  },
  phobos: {
    type: 'moon of Mars',
    desc: 'The larger of Mars\'s two moons, dark rock like carbonaceous asteroids; it may be a captured asteroid, and it is slowly drifting closer to Mars.',
    facts: [['Size', '27 × 22 × 18 km'], ['Orbit', 'about three times a day'], ['Stickney crater', 'about 9.7 km wide'], ['Inward drift', '1.8 m per century (crash or ring in about 50 million years)'], ['Discovered', '17 Aug 1877 (Asaph Hall)']],
    source: 'NASA Phobos', url: NASA('mars/moons/phobos/'),
  },
  deimos: {
    type: 'moon of Mars',
    desc: 'The smaller of Mars\'s two moons, a dark body like the asteroids of the outer belt. Its craters are partly filled in, so it looks smoother than Phobos.',
    facts: [['Size', '15 × 12 × 11 km'], ['Orbital period', 'about 30 hours'], ['Loose surface layer', 'possibly up to 100 m deep'], ['Discovered', '11 Aug 1877 (Asaph Hall)']],
    source: 'NASA Deimos', url: NASA('mars/moons/deimos/'),
  },

  /* ---------- Solar-system structures ---------- */
  belt: {
    type: 'main asteroid belt',
    desc: 'The region between Mars and Jupiter where most asteroids orbit: rocky leftovers from the solar system\'s formation. Most are carbon-rich C-types; others are stony S-types and metallic M-types.',
    facts: [['Age', 'leftovers from about 4.6 billion years ago'], ['Population', '1.1–1.9 million asteroids over 1 km wide, plus millions smaller'], ['Total mass', 'less than Earth\'s Moon'], ['Drawn here', '2.2 to 3.2 AU from the Sun']],
    source: 'NASA Asteroid Facts', url: NASA('solar-system/asteroids/facts/'),
  },
  heliopause: {
    type: 'edge of the Sun\'s bubble (heliosphere)',
    desc: 'The heliosphere is a bubble of particles and magnetic fields blown by the solar wind. Its edge, the heliopause, is where the solar wind meets the cold, dense interstellar medium.',
    facts: [['Termination shock', 'Voyager 1 at 94 AU (Dec 2004), Voyager 2 at 84 AU (Aug 2007)'], ['Heliopause, Voyager 1', 'crossed 25 Aug 2012 at about 122 AU'], ['Heliopause, Voyager 2', 'crossed 5 Nov 2018, just over 18 billion km from Earth']],
    source: 'NASA Voyager Interstellar Mission', url: NASA('mission/voyager/interstellar-mission/'),
  },
  oort: {
    type: 'theorised cloud of comets',
    desc: 'A theorised, never directly imaged shell of icy, comet-like bodies around the Sun, planets and Kuiper Belt. Jan Oort proposed it to explain where long-period comets come from.',
    facts: [['Inner edge', 'about 2,000–5,000 AU from the Sun'], ['Outer edge', 'about 10,000–100,000 AU'], ['Objects', 'possibly hundreds of billions to trillions'], ['Origin', 'leftover bodies scattered (mainly by Jupiter) after the planets formed 4.6 billion years ago'], ['Voyager 1 arrives', 'in about 300 years']],
    source: 'NASA Oort Cloud Facts', url: NASA('solar-system/oort-cloud/facts/'),
  },

  /* ---------- Nearby stars ---------- */
  proxima: {
    type: 'red dwarf (M5.5), the closest star to the Sun',
    desc: 'A small, cool, dim red dwarf whose turbulent surface erupts in flares almost continually.',
    facts: [['Distance', 'about 4.24 light-years'], ['Mass', '0.122 Suns (radius 0.154 Suns)'], ['Surface temperature', 'about 3,042 K'], ['Age', 'about 4.85 billion years']],
    source: 'Chandra X-ray Center; arXiv:2009.07266', url: 'https://chandra.harvard.edu/photo/2004/proxima/',
  },
  rigil: {
    type: 'Sun-like star, the brighter of Alpha Centauri A and B',
    desc: 'A Sun-like star, a little larger and brighter than the Sun. In 2025 Webb found evidence of a possible giant planet orbiting it, not yet confirmed.',
    facts: [['Mass', '1.079 Suns (radius 1.22 Suns)'], ['Brightness', '1.51 Suns'], ['Age', 'about 5.3 billion years']],
    source: 'Akeson et al. 2021 (arXiv:2104.10086); ESA/Webb weic2515', url: 'https://arxiv.org/abs/2104.10086',
  },
  toliman: {
    type: 'Sun-like star, Alpha Centauri B',
    desc: 'The smaller, dimmer partner of Rigil Kentaurus. The faint red dwarf Proxima is the system\'s distant third member.',
    facts: [['Mass', '0.909 Suns (radius 0.859 Suns)'], ['Brightness', '0.498 Suns'], ['Orbit around A', '79.76 years (eccentricity 0.52)'], ['Age', 'about 5.3 billion years (same system)']],
    source: 'Akeson et al. 2021 (arXiv:2104.10086)', url: 'https://arxiv.org/abs/2104.10086',
  },
  barnard: {
    type: 'red dwarf, the closest single star to the Sun',
    desc: 'An ancient, quiet red dwarf that moves across our sky faster than any other star. It hosts at least one small, hot planet, Barnard b.',
    facts: [['Spectral type', 'M3.5V–M4V'], ['Mass', '0.162 Suns (radius 0.185 Suns)'], ['Temperature', 'about 3,195 K'], ['Age', 'probably about twice the Sun\'s']],
    source: 'ESO eso1837; González Hernández et al. 2024 (arXiv:2410.00569)', url: 'https://www.eso.org/public/news/eso1837/',
  },
  sirius: {
    type: 'white main-sequence star (A1 V), the brightest star in the night sky',
    desc: 'A hot, white, metal-rich star orbited by a white dwarf companion, Sirius B.',
    facts: [['Mass', '2.06 Suns'], ['Orbit with Sirius B', '50.13 years'], ['Age', 'about 237–247 million years']],
    source: 'Bond et al. 2017 (arXiv:1703.10625); ESA/Hubble heic0516', url: 'https://arxiv.org/abs/1703.10625',
  },
  siriusb: {
    type: 'white dwarf',
    desc: 'The brightest and nearest white dwarf: the burned-out core of a former star, with about the Sun\'s mass packed into a ball smaller than Earth.',
    facts: [['Mass', '1.02 Suns'], ['Diameter', 'about 12,000 km'], ['Surface temperature', 'about 25,000 °C'], ['Age', 'about 228 million years (a white dwarf for about 126 million of them)']],
    source: 'Bond et al. 2017 (arXiv:1703.10625); ESA/Hubble heic0516', url: 'https://arxiv.org/abs/1703.10625',
  },
  wolf359: {
    type: 'red dwarf (M6.5)',
    desc: 'A faint, cool red dwarf and one of the Sun\'s nearest neighbours. It spins quickly and flares often.',
    facts: [['Temperature', 'about 2,900 K'], ['Rotation', '2.72 days'], ['Flares', '13 optical flares in 27 hours of monitoring']],
    source: 'arXiv:2202.03006', url: 'https://arxiv.org/abs/2202.03006',
  },
  procyon: {
    type: 'binary star: an F5 subgiant and a white dwarf',
    desc: 'Procyon A is a slightly evolved yellow-white star; it is orbited by a faint white dwarf, Procyon B.',
    facts: [['Mass', '1.478 Suns (A), 0.592 Suns (B)'], ['Orbit', '40.84 years'], ['Age', 'about 2.7 billion years']],
    source: 'Bond et al. 2015 (arXiv:1510.00485)', url: 'https://arxiv.org/abs/1510.00485',
  },
  epseri: {
    type: 'young Sun-like star (Epsilon Eridani)',
    desc: 'A little less massive, cooler and fainter than the Sun, with a Jupiter-mass planet and rings of rocky and icy debris arranged much like our solar system\'s.',
    facts: [['Age', 'about 800 million years'], ['Planet', 'about Jupiter\'s mass, at about Jupiter\'s distance'], ['Debris', 'two asteroid belts (about 3 and 20 AU) and an outer comet ring']],
    source: 'NASA/SOFIA; NASA JPL', url: NASA('universe/exoplanets/sofia-confirms-nearby-planetary-system-is-similar-to-our-own/'),
  },
  taucet: {
    type: 'Sun-like star (Tau Ceti), poor in heavy elements',
    desc: 'A nearby Sun-like star surrounded by a broad dusty debris disc; several small planets have been proposed around it.',
    facts: [['Mass', 'about 0.78 Suns'], ['Age', 'about 8–10 billion years (models; another estimate is 5.8 billion)'], ['Debris disc', 'from about 2–3 AU out to about 55 AU']],
    source: 'arXiv:1010.3154; Lawler et al. 2014 (arXiv:1408.2791)', url: 'https://arxiv.org/abs/1010.3154',
  },

  /* ---------- The Milky Way and beyond ---------- */
  mw: {
    type: 'spiral galaxy, our home',
    desc: 'A spiral disc of stars with a central bulge and bar, wrapped in a halo of stars and globular clusters. A much larger cloud of dark matter holds most of its mass.',
    facts: [['Stars', 'about 200 billion'], ['Mass', 'about 1.5 trillion Suns (mostly dark matter)'], ['Central black hole', 'about 4 million Suns'], ['Oldest stars', 'the thick disc began forming about 13 billion years ago']],
    source: 'NASA Hubble/Gaia (2019); ESA Gaia', url: NASA('missions/hubble/what-does-the-milky-way-weigh-hubble-and-gaia-investigate/'),
  },
  gc: {
    type: 'supermassive black hole (Sagittarius A*)',
    desc: 'The black hole at the Milky Way\'s centre. The Event Horizon Telescope imaged it as a dark "shadow" ringed by glowing gas.',
    facts: [['Mass', 'about 4 million Suns'], ['Distance', 'about 27,000 light-years'], ['First image', 'May 2022 (Event Horizon Telescope)'], ['Compared with M87*', 'more than 1,000 times smaller and less massive']],
    source: 'ESO eso2208', url: 'https://www.eso.org/public/news/eso2208-eht-mw/',
  },
  lmc: {
    type: 'dwarf irregular satellite galaxy',
    desc: 'A small galaxy orbiting the Milky Way, full of star-forming regions, including the Tarantula Nebula, the most productive stellar nursery nearby.',
    facts: [['Mass', 'about 10–20% of the Milky Way\'s'], ['Biggest stars', 'about 200 Suns (Tarantula core)']],
    source: 'ESA/Hubble potw2503a; NASA', url: 'https://esahubble.org/videos/potw2503a/',
  },
  smc: {
    type: 'dwarf galaxy',
    desc: 'One of the Milky Way\'s nearest neighbours, poor in heavy elements; young stars are being born in its star-forming region NGC 346.',
    facts: [['Stars', 'hundreds of millions'], ['Composition', 'metal-poor: NGC 346 has about one fifth of the Sun\'s metallicity']],
    source: 'NASA Hubble; arXiv:2301.03932', url: NASA('missions/hubble/hubble-captures-a-glittering-neighbor/'),
  },
  andromeda: {
    type: 'spiral galaxy (M31)',
    desc: 'The nearest large galaxy, a spiral visible to the naked eye. Hubble\'s mosaic shows a turbulent past of collisions and bursts of star formation.',
    facts: [['Stars', 'about 1 trillion'], ['Resolved by Hubble', 'about 200 million stars'], ['Size in our sky', 'six times the full Moon\'s width']],
    source: 'NASA Hubble (2025); NASA Messier 31', url: NASA('missions/hubble/nasas-hubble-traces-hidden-history-of-andromeda-galaxy/'),
  },
  triangulum: {
    type: 'spiral galaxy (M33), no bulge or bar',
    desc: 'A spiral in our Local Group, rich in gas and dust and forming new stars quickly, with far fewer stars than the Milky Way.',
    facts: [['Local Group rank', 'third-largest'], ['Star formation', 'about 1 Sun\'s worth every 2 years']],
    source: 'ESA/Hubble heic1901', url: 'https://esahubble.org/news/heic1901/',
  },
  localgroup: {
    type: 'group of galaxies',
    desc: 'Our galactic neighbourhood, dominated by the Milky Way and Andromeda with Triangulum and many dwarf galaxies, inside the Laniakea Supercluster.',
    facts: [['Members', 'the Milky Way plus over 50 other galaxies'], ['Most massive', 'Andromeda and the Milky Way'], ['Drawn here', 'zero-velocity radius 1,060 kpc (McConnachie 2012)']],
    source: 'NASA Large-scale structures; McConnachie 2012', url: NASA('universe/galaxies/large-scale-structures/'),
  },
  m81: {
    type: 'group of galaxies around the spiral M81',
    desc: 'M81 is a bright spiral with a big central bulge. In its group the large galaxies M81, M82 and NGC 3077 have tugged on one another gravitationally.',
    facts: [['M81 central black hole', 'about 70 million Suns'], ['Group members', '36 known'], ['M81 discovered', '1774 (J. E. Bode)']],
    source: 'NASA Messier 81; Chiboucas et al. 2013 (arXiv:1309.4130)', url: NASA('mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-81/'),
  },
  cena: {
    type: 'group of galaxies around Centaurus A (NGC 5128)',
    desc: 'Centaurus A is a massive elliptical crossed by a dark dust lane, possibly left by a collision; its feeding black hole launches jets.',
    facts: [['Black hole', 'about 55 million Suns (±30 million)'], ['Jet', 'about 13,000 light-years long']],
    source: 'Chandra (2023); Cappellari et al. 2009 (arXiv:0812.1000)', url: 'https://chandra.harvard.edu/photo/2023/cena/',
  },
  virgo: {
    type: 'cluster of galaxies, the nearest one',
    desc: 'Its mass is mostly dark matter, the giant elliptical M87 sits at its heart, and its gravity pulls surrounding galaxies towards it. M87 holds the first black hole ever imaged.',
    facts: [['Galaxies', 'more than 2,000'], ['Mass', 'about 6 × 10¹⁴ Suns'], ['Make-up', 'about 3% stars, 12% hot gas, 85% dark matter'], ['M87\'s black hole', 'about 6.5 billion Suns (Event Horizon Telescope, 2019)']],
    source: 'Chandra; arXiv:2002.12820; ESO eso1907', url: 'https://chandra.harvard.edu/blog/node/82',
  },
  greatattractor: {
    type: 'concentration of mass (region, location uncertain)',
    desc: 'A vast, spread-out concentration of mass whose gravity pulls on the Local Group and many other galaxies. Much of it is hidden behind the Milky Way\'s dust; the Norma Cluster marks its core.',
    facts: [['Core', 'Norma Cluster (Abell 3627)'], ['Core cluster mass', 'about 10¹⁵ Suns'], ['Found by', 'tracking galaxies\' streaming motions (1987–88)']],
    source: 'ESA/Hubble potw1302a; Woudt et al. 2008', url: 'https://esahubble.org/images/potw1302a/',
  },
  coma: {
    type: 'rich cluster of galaxies',
    desc: 'A massive cluster and one of the first places where astronomers saw signs of unseen mass, later called dark matter.',
    facts: [['Galaxies', 'over 1,000'], ['Mass', 'about 10¹⁵ Suns'], ['Globular star clusters', '22,426 found by Hubble']],
    source: 'NASA Hubble; Ho et al. 2022 (arXiv:2206.14834)', url: NASA('missions/hubble/hubble-uncovers-thousands-of-globular-star-clusters-scattered-among-galaxies/'),
  },
  laniakea: {
    type: 'supercluster that contains the Milky Way',
    desc: 'Defined by mapping where galaxies\' motions flow inwards, towards the Great Attractor region. The Milky Way lies near its edge. "Laniakea" means "immense heaven" in Hawaiian.',
    facts: [['Galaxies', 'about 100,000'], ['Mass', 'about 10¹⁷ Suns'], ['Defined', '2014 (Tully et al., Nature)']],
    source: 'NRAO; Tully et al. 2014', url: 'https://public.nrao.edu/news/supercluster-gbt/',
  },
  catlimit: {
    type: 'edge of the galaxy catalogue used on this page',
    desc: 'Galaxies farther away than this are not drawn because the catalogue stops here, not because space is empty: beyond it there are countless more galaxies.',
    facts: [['Catalogue', 'Karachentsev, Makarov & Kaisina (2013): galaxies with distance estimates within 11 Mpc'], ['Plus', 'McConnachie (2012): galaxies within about 3 Mpc']],
    source: 'Karachentsev et al. 2013, AJ 145, 101; McConnachie 2012, AJ 144, 4 (via VizieR)', url: 'https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=J/AJ/145/101',
  },
  edge: {
    type: 'the edge of what we can see',
    desc: 'The observable universe is everything whose light has had time to reach us since the Big Bang. Planck\'s maps of the cosmic microwave background pin down its age and contents.',
    facts: [['Age', '13.787 ± 0.020 billion years'], ['Matter', 'about 31.5%'], ['Dark energy', 'about 68.5%']],
    source: 'Planck Collaboration 2018 (arXiv:1807.06209)', url: 'https://arxiv.org/abs/1807.06209',
  },
};
