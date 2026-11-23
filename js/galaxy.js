/**
 * galaxy.js – Erzeugung der Galaxie aus dem Seed (#6, Abschnitt 1). Ohne DOM, ohne Spielstand.
 *
 * Die Galaxie ist fest durch den Seed bestimmt und wird deshalb nicht gespeichert, sondern bei Bedarf neu
 * erzeugt (galaxy(seed), zwischengespeichert). Der Spielstand enthält nur, was sich ändert. Der Zufall hier
 * ist unabhängig von sim.rand(), damit Änderungen an der Simulation die Galaxie nicht verschieben.
 *
 * Stern: { i, name, x, y (Lj, Sol bei 0/0), cls (Sternklasse), rich (Materie-Faktor), spec (null |
 *   'richBelt' | 'gasPower'), orte: [{ k: Art (ORTE), n: Name }] } – Ort 0 ist immer die Station am Stern.
 * Klasse und Lage sind von überall sichtbar; Orte, Reichtum und Besonderheit sind der Fund.
 */
import { GALAXY, CLASSES, RICH, SPECIAL_SHARE } from './data.js';
import { rng, dist } from './util.js';

/** Silben für erfundene Sternnamen (übernommen aus Replikator, js/galaxy.js). */
const SYL = ['ka', 'ri', 'on', 'vel', 'ta', 'mi', 'ra', 'zo', 'el', 'thu', 'an', 'sy', 'dar', 'ne', 'lo', 'qua', 'is', 'ty', 'ro', 'ae', 'gen', 'ul', 'mor', 'esh', 'ki', 'va', 'tor', 'lin', 'ox', 'bra', 'sel', 'nu'];

/** Erzeugt einen noch nicht vergebenen Sternnamen aus 2–3 Silben. */
function genName(r, used) {
  for (;;) {
    let n = '';
    const k = 2 + (r() < .35 ? 1 : 0);
    for (let i = 0; i < k; i++) n += SYL[r() * SYL.length | 0];
    n = n[0].toUpperCase() + n.slice(1);
    if (!used.has(n)) { used.add(n); return n; }
  }
}

/** Zieht einen Eintrag nach Gewicht w aus einer Liste oder einem Objekt (liefert Schlüssel bzw. Eintrag). */
function pick(r, table) {
  const entries = Array.isArray(table) ? table.map(t => [t, t]) : Object.entries(table);
  let x = r() * entries.reduce((a, [, t]) => a + t.w, 0);
  for (const [k, t] of entries) { x -= t.w; if (x < 0) return k; }
  return entries[entries.length - 1][0];
}

/** Sol mit echten Planeten: vier Gesteinsplaneten, Gürtel, vier Gasriesen. Keine Besonderheit, mittlerer Reichtum. */
function sol() {
  const orte = [{ k: 'star', n: 'Sol' }];
  for (const n of ['Merkur', 'Venus', 'Erde', 'Mars']) orte.push({ k: 'rock', n });
  orte.push({ k: 'belt', n: 'Gürtel' });
  for (const n of ['Jupiter', 'Saturn', 'Uranus', 'Neptun']) orte.push({ k: 'gas', n });
  return { i: 0, name: 'Sol', x: 0, y: 0, cls: 'G', rich: 1, spec: null, orte };
}

/**
 * Orte eines Sterns: 1–6 Planeten (innen eher Gestein, außen eher Gas), mit 45 % ein Gürtel zwischen
 * Gesteins- und Gasplaneten. Besonderheit nur, wenn der passende Ort existiert.
 */
function genOrte(r, name) {
  const n = 1 + (r() * 6 | 0), belt = r() < .45;
  const planets = [];
  for (let j = 0; j < n; j++) planets.push(r() < .7 - j * .12 ? 'rock' : 'gas');
  planets.sort((a, b) => (a === 'gas') - (b === 'gas'));   // Gestein innen, Gas außen
  const orte = [{ k: 'star', n: name }];
  let letter = 0;
  for (const k of planets) {
    if (belt && k === 'gas' && !orte.some(o => o.k === 'belt')) orte.push({ k: 'belt', n: 'Gürtel' });
    orte.push({ k, n: `${name} ${'bcdefg'[letter++]}` });
  }
  if (belt && !orte.some(o => o.k === 'belt')) orte.push({ k: 'belt', n: 'Gürtel' });
  return orte;
}

/** Erzeugt die Galaxie zum Seed. */
function generate(seed) {
  const r = rng((seed ^ 0x9E3779B9) | 0);
  const stars = [sol()], used = new Set(['Sol']);
  for (let tries = 0; stars.length < GALAXY.n && tries < GALAXY.n * 200; tries++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * GALAXY.r;
    const p = { x: +(Math.cos(a) * d).toFixed(2), y: +(Math.sin(a) * d).toFixed(2) };
    if (stars.some(s => dist(s, p) < GALAXY.minD)) continue;
    const name = genName(r, used), cls = pick(r, CLASSES), rich = pick(r, RICH).f;
    const orte = genOrte(r, name);
    let spec = null;
    if (r() < SPECIAL_SHARE) {
      const can = [orte.some(o => o.k === 'belt') && 'richBelt', orte.some(o => o.k === 'gas') && 'gasPower'].filter(Boolean);
      if (can.length) spec = can[r() * can.length | 0];
    }
    stars.push({ i: stars.length, name, ...p, cls, rich, spec, orte });
  }
  return stars;
}

/** Zwischenspeicher: Seed → Sterne (die Erzeugung ist rein, das Ergebnis darf geteilt werden). */
const cache = new Map();
/** Sterne der Galaxie zum Seed (nicht verändern). */
export function galaxy(seed) {
  if (!cache.has(seed)) { if (cache.size > 8) cache.clear(); cache.set(seed, generate(seed)); }
  return cache.get(seed);
}
