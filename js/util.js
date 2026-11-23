/**
 * util.js – kleine, zustandslose Hilfsfunktionen.
 * Ohne Abhängigkeiten zu anderen Modulen; außer $ auch ohne Browser (DOM) nutzbar.
 * Übernommen aus Replikator (js/util.js): Zufallsgenerator, Seeds, Datum, Escaping.
 */

/** Kurzform für document.querySelector (nur im Browser aufrufen). */
export const $ = s => document.querySelector(s);

/** Monatsnamen; fmtDate(y) = Spieljahr als "Mär 2154". */
export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export function fmtDate(y) { return `${MONTHS[Math.min(11, Math.floor((y % 1) * 12 + 1e-6))]} ${Math.floor(y + 1e-9)}`; }

/**
 * Ein Schritt des Zufallsgenerators Mulberry32 mit außen gespeichertem Zustand (im Spielstand, damit
 * der Zufall beim Speichern/Laden erhalten bleibt).
 * @param {number} a bisheriger Zustand (32-Bit-Ganzzahl)
 * @returns {[number, number]} [Zufallszahl in [0, 1), neuer Zustand]
 */
export function rngStep(a) {
  a = (a | 0) + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return [((t ^ t >>> 14) >>> 0) / 4294967296, a];
}

/** Höchster Seed + 1: Seeds sind ganze Zahlen von 0 bis 2^32 − 1. */
export const SEED_RANGE = 2 ** 32;

/** Startzustand des Simulations-Zufalls (S.rng) aus dem Seed. */
export const rngSeed = seed => (seed ^ 0x5BD1E995) | 0;

/**
 * Wandelt die Eingabe des Spielers in einen Seed um: leer → null (zufällig), eine Zahl im gültigen
 * Bereich → genau diese Zahl, jeder andere Text → Prüfsumme des Textes (FNV-1a), damit auch Wörter
 * als Seed funktionieren.
 */
export function seedFromText(text) {
  const t = String(text).trim();
  if (!t) return null;
  if (/^\d{1,10}$/.test(t) && +t < SEED_RANGE) return +t;
  let h = 0x811c9dc5;
  for (const ch of t) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h;
}

/** HTML-Escaping für Texte, die per innerHTML eingefügt werden. */
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Begrenzt v auf den Bereich [a, b]. */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
