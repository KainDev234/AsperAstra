/**
 * view.js – Was der Spieler weiß (#13): nur die aktive Front sieht er live, alles andere über Nachrichten und
 * Berichte, die mit c ankommen (sim.js: S.known, S.rep). Karte und Oberfläche lesen ausschließlich hier und
 * nie den echten Stand ferner Systeme. Ohne DOM, damit in Node testbar.
 */
import { S } from './state.js';
import { dist } from './util.js';
import { star, sysOf } from './sim.js';

/** Stern, von dem aus der Spieler sieht: die aktive Front oder, während eines Sprungs, das Ziel. */
export const viewer = () => star(S.me !== null ? S.me : S.jump.to);
/** Ist Stern s die aktive Front (live sichtbar)? */
export const isLive = s => s === S.me;
/** Kennt der Spieler den Fund von Stern s (Orte, Reichtum, Besonderheit)? In Phase 3 heißt das: eigenes System. */
export const isKnown = s => S.known.includes(s);
/** Kennt der Spieler Reichtum und Orte von Stern s (eigenes System oder Fernerkundung, #22)? Die Besonderheit nicht. */
export const isScanned = s => isKnown(s) || S.scan.includes(s);
/** Letzter angekommener Bericht von System s oder null. */
export const reportOf = s => S.rep.find(r => r.s === s) || null;

/**
 * Gebäude je Art, wie der Spieler sie kennt: live an der aktiven Front, sonst aus dem letzten Bericht ({} = nichts
 * bekannt).
 */
export function buildingCounts(s) {
  if (isLive(s)) {
    const c = {};
    for (const b of sysOf(s).b) c[b.k] = (c[b.k] || 0) + 1;
    return c;
  }
  const r = reportOf(s);
  return r ? { ...r.b } : {};
}

/**
 * Eigene Systeme für die Schnellsuche „Fronten“: aktive Front zuerst, Sol fest an zweiter Stelle, dann nach
 * Entfernung. Je Eintrag: Stern, Entfernung (Lj) vom Spieler, Alter des Berichts (Jahre; 0 = live, null = noch
 * keiner), Gebäude je Art.
 */
export function frontList() {
  const v = viewer();
  const list = S.known.map(s => {
    const r = reportOf(s);
    return { s, name: star(s).name, d: dist(star(s), v), age: isLive(s) ? 0 : r ? S.year - r.y : null, b: buildingCounts(s) };
  });
  const rank = e => isLive(e.s) ? 0 : e.s === 0 ? 1 : 2;
  return list.sort((a, b) => rank(a) - rank(b) || a.d - b.d);
}

/** Startjahr einer Sonde (aus Ankunft und Flugzeit). */
const launchYear = p => p.at - dist(star(p.from), star(p.to)) / p.v;

/**
 * Sonden im Flug, deren Start der Spieler schon sehen kann: Das Licht vom Startsystem ist bei ihm angekommen.
 * Die Position zeigt der Einfachheit halber den echten Stand (Prototyp; die Lichtlaufzeit vom Ort der Sonde
 * selbst bleibt unberücksichtigt).
 */
export function probesSeen() {
  const v = viewer();
  return S.probes.filter(p => S.year - launchYear(p) >= dist(star(p.from), v) - 1e-9);
}

/** Position einer fliegenden Sonde in Lj (linear zwischen Start und Ziel). */
export function probePos(p) {
  const a = star(p.from), b = star(p.to), t0 = launchYear(p);
  const f = Math.min(1, Math.max(0, (S.year - t0) / (p.at - t0)));
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}
