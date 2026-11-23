/**
 * state.js – gemeinsamer veränderlicher Zustand. Übernommen aus Replikator (js/state.js).
 *
 * S ist ein "live binding": Andere Module importieren S und sehen nach setState() automatisch das
 * neue Objekt. Neu zuweisen darf S nur dieses Modul (über setState), Felder von S dürfen alle Module ändern.
 */

/**
 * Gesamter speicherbarer Spielstand (wird 1:1 als JSON gespeichert, siehe save.js):
 *   v = Version des Formats, seed = Seed der Partie, rng = Zustand des Simulations-Zufalls,
 *   year = Spieljahr, speed = 0 (Pause) oder 1 (Laufen), tempo = { n: Stufe in TEMPO },
 *   log = Logbuch [{ y: Jahr, t: Text, c?: Klasse }].
 * Aufbau siehe sim.newGame().
 */
export let S = null;

/** Ersetzt den Spielstand (neues Spiel oder geladener Stand). */
export function setState(s) { S = s; }

/** Reiner Oberflächenzustand, wird nicht gespeichert. Noch leer; Ansichten kommen mit Phase 3. */
export const UI = {};
