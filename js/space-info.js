/**
 * space-info.js: the small info cards on the space page.
 *
 * Two kinds of content, both traceable:
 *  - curated entries from data/info.js (short description + facts, each with
 *    its source), for the Sun, planets, major moons, nearby stars, galaxies
 *    and large structures;
 *  - facts generated from the catalogue fields already on the page (HYG for
 *    stars, Karachentsev/McConnachie for galaxies, JPL for moons), so every
 *    object with a label gets a card.
 * No numbers are invented here: everything is either copied from a cited data
 * file or computed from one.
 */

import { INFO } from './data/info.js';
import * as A from './astro.js';
import { KIND_WORDS } from './space-art.js';

const { LIGHT_YEAR, MEGAPARSEC, KILOPARSEC, DAY, formatWorldLength, sigT } = A;

/** Spectral class letter → plain words (standard Morgan-Keenan classes). */
function starClass(spect) {
  const s = (spect || '').trim();
  if (/^D/.test(s)) return 'white dwarf (the hot, dense core left by a dead star)';
  if (/^sd/.test(s)) return 'subdwarf (an old star poor in heavy elements)';
  const letter = s.replace(/^d/, '')[0];
  const dwarf = /^d|V/.test(s);
  return {
    O: 'blue, very hot star', B: 'blue-white hot star', A: 'white star', F: 'yellow-white star',
    G: 'yellow star like the Sun', K: 'orange star', M: dwarf ? 'red dwarf (a small, cool star)' : 'red star',
  }[letter] || 'star';
}

const fmtNum = (x, n = 3) => A.sigWords(x, n);

/** Distance-method codes of Karachentsev et al. (2013), note G1 of their ReadMe. */
const METHODS = {
  TRGB: 'tip of the red giant branch', Cep: 'Cepheid stars', geom: 'geometry', SN: 'a supernova',
  SBF: 'surface brightness fluctuations', mem: 'membership of a group', TF: 'the Tully-Fisher relation',
  FP: 'the fundamental plane', BS: 'its brightest stars', CMD: 'its colour-magnitude diagram', HB: 'horizontal-branch stars',
  RR: 'RR Lyrae stars', PNLF: 'planetary nebulae', h: 'its redshift (Hubble law)', "h'": 'its redshift (Hubble law)',
  txt: 'an estimate', M12: 'the McConnachie (2012) compilation',
};

/**
 * Card content for an object descriptor from solar.js:
 *   { id, name, kind, infoKey, star?, galaxy?, moon?, planet? }
 * Returns { title, subtitle, desc, facts: [[label, value]], source, url }.
 */
export function infoFor(o) {
  const cur = INFO[o.infoKey || o.id];
  const card = { title: o.name, subtitle: '', desc: '', facts: [], source: '', url: '' };
  if (cur) Object.assign(card, { subtitle: cur.type || '', desc: cur.desc || '', facts: [...(cur.facts || [])], source: cur.source || '', url: cur.url || '' });

  if (o.star) {
    const [, gl, , , pc, spect, lum, mag] = o.star;
    if (!card.subtitle) card.subtitle = spect ? `${starClass(spect)}, spectral type ${spect}` : 'star';
    const extra = [['Distance', `${sigT((pc * A.PARSEC) / LIGHT_YEAR, 3)} light-years`]];
    if (lum) extra.push(['Brightness', `${lum >= 1 ? sigT(lum, 3) : A.sig(lum, 2)} × the Sun's (HYG luminosity)`]);
    if (mag !== null && mag !== undefined) extra.push(['Seen from Earth', `magnitude ${sigT(mag, 3)}${mag <= 6 ? ' (visible to the naked eye)' : ' (too faint for the naked eye)'}`]);
    extra.push(['Catalogue', gl]);
    card.facts = mergeFacts(card.facts, extra);
    if (!card.source) card.source = 'HYG database v4.1 (astronexus.com), CC BY-SA 4.0';
  }

  if (o.galaxy) {
    const [, , , distMpc, diamKpc, , tType, morph, absMagB, logLumK, method] = o.galaxy;
    const kind = o.kind || 'blob';
    if (!card.subtitle) card.subtitle = KIND_WORDS[kind] || 'galaxy';
    const extra = [];
    if (morph || tType !== null) extra.push(['Catalogued type', [morph, tType !== null && tType !== undefined ? `T = ${tType}` : ''].filter(Boolean).join(', ')]);
    if (diamKpc) extra.push(['Diameter', `about ${formatWorldLength(diamKpc * KILOPARSEC)} (Holmberg)`]);
    extra.push(['Distance', `${formatWorldLength(distMpc * MEGAPARSEC)}${method ? ` (from ${METHODS[method] || method})` : ''}`]);
    if (logLumK !== null && logLumK !== undefined) extra.push(['Starlight (infrared K band)', `about ${fmtNum(10 ** logLumK, 2)} Suns`]);
    if (absMagB !== null && absMagB !== undefined) extra.push(['Absolute magnitude (blue)', sigT(absMagB, 3)]);
    card.facts = mergeFacts(card.facts, extra);
    if (!card.source) card.source = 'Karachentsev, Makarov & Kaisina 2013, AJ 145, 101; McConnachie 2012, AJ 144, 4 (via VizieR)';
  }

  if (o.moon && !cur) {
    const m = o.moon;
    if (!card.subtitle) card.subtitle = `moon of ${m.planetName}${m.retro ? ', orbiting backwards (retrograde)' : ''}`;
    const extra = [
      ['Orbit radius', `${A.sigWords(m.aKm, 3)} km from ${m.planetName}`],
      ['One orbit', m.periodDays < 2 ? `${sigT(m.periodDays * 24, 3)} hours` : `${sigT(m.periodDays, 3)} days`],
    ];
    if (m.radiusKm) extra.push(['Diameter', `${A.sigWords(2 * m.radiusKm, 3)} km`]);
    else extra.push(['Size', 'not measured (too small and faint)']);
    if (m.density) extra.push(['Mean density', `${sigT(m.density, 3)} g/cm³`]);
    card.facts = mergeFacts(card.facts, extra);
    if (!card.source) card.source = 'JPL Solar System Dynamics: planetary satellite mean elements and physical parameters';
  }

  if (o.arm) {
    const a = o.arm;
    const ly = (kpc) => formatWorldLength(kpc * KILOPARSEC);
    card.subtitle = 'spiral arm of the Milky Way';
    card.desc = 'A band of gas, dust and young stars winding out from the centre. Its shape here is the measured fit to radio parallaxes of star-forming regions; beyond the measured stretch it is continued, fainter.';
    card.facts = [
      ['Distance from the galactic centre', `${ly(a.rKink)} at its kink (azimuth ${a.betaKink}°)`],
      ['Measured over', `azimuths ${a.betaRange[0]}° to ${a.betaRange[1]}°`],
      ['Pitch angle', a.psiIn === a.psiOut ? `${a.psiIn}°` : `${a.psiIn}° inside the kink, ${a.psiOut}° beyond`],
      ['Width (1 sigma)', ly(a.width)],
    ];
    card.source = 'Reid et al. 2019, ApJ 885, 131 (Table 2)';
    card.url = 'https://arxiv.org/abs/1910.03357';
  }

  if (o.planet && !cur) {
    card.subtitle = 'planet';
    card.facts = [['Diameter', `${A.sigWords(o.sizeM / 1e3, 3)} km`], ['Year', `${sigT(o.periodS / DAY, 3)} days`]];
    card.source = 'NASA Planetary Fact Sheet; JPL approximate planetary elements';
  }
  if (!card.desc && !card.facts.length) card.desc = 'No further catalogue details on this page.';
  return card;
}

/** Labels that say the same thing, so a generated fact doesn't repeat a curated one. */
const SAME = [['distance'], ['diameter', 'radius', 'mean radius', 'mean diameter', 'size'], ['brightness', 'luminosity'], ['catalogued type', 'type', 'spectral type']];
const topic = (label) => {
  const k = label.toLowerCase();
  const i = SAME.findIndex((g) => g.some((w) => k === w || k.startsWith(`${w} `)));
  return i >= 0 ? `#${i}` : k;
};

/** Curated facts first, then generated ones on topics the curated facts don't cover. */
function mergeFacts(a, b) {
  const have = new Set(a.map(([k]) => topic(k)));
  return [...a, ...b.filter(([k]) => !have.has(topic(k)))];
}

/** Fill the card element. extra: lines about the current scale (strings). */
export function renderInfoCard(el, card, extra = []) {
  el.querySelector('[data-info="title"]').textContent = card.title;
  el.querySelector('[data-info="subtitle"]').textContent = card.subtitle ? card.subtitle[0].toUpperCase() + card.subtitle.slice(1) : '';
  el.querySelector('[data-info="desc"]').textContent = card.desc;
  const dl = el.querySelector('[data-info="facts"]');
  dl.textContent = '';
  for (const [k, v] of card.facts) {
    const div = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    dl.append(div);
  }
  const sc = el.querySelector('[data-info="scale"]');
  sc.textContent = extra.join(' ');
  sc.hidden = !extra.length;
  const src = el.querySelector('[data-info="source"]');
  src.textContent = '';
  if (card.source) {
    src.append('Source: ');
    if (card.url) {
      const a = document.createElement('a');
      a.href = card.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = card.source;
      src.append(a);
    } else {
      src.append(card.source);
    }
  }
}
