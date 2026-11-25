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
 *   log = Logbuch [{ y: Jahr, t: Text, c?: Klasse }],
 *   me = Stern der aktiven Front (null während eines Sprungs), jump = { to, at } oder null,
 *   sys = Systeme mit Kopie [{ s: Stern, m: Materie, b: Gebäude [{ k, o: Ort, lv }], pq: Sonden in Auftrag,
 *     pj: Restbauzeit der laufenden Sonde oder null, ready: fertige Sonden,
 *     rj: laufende Forschung { p: Projekt, n: Stufe, left: Rest in Labor-Jahren } oder null }],
 *   units = Bauer [{ id, k: 'copy' | 'cons', s, o, lv, q: Warteschlange, job: laufender Auftrag oder null,
 *     mv: Reise im System { o, t } oder null, wait?: Grund, warum der erste Auftrag wartet }],
 *   nextId = nächste freie id (Bauer und Sonden),
 *   probes = Sonden im Flug [{ id, from, to, at, seed: 'mine' | 'power' | 'inst', two, c: Konstruktor an Bord, risk,
 *     v: Tempo (c), r: Forschungsstufe { p, n } einer Instrumentensonde oder null }],
 *   known = Sterne mit bekanntem Fund, mail = Nachrichten unterwegs zum Spieler [{ at, k, s, d? }],
 *   rep = zuletzt angekommener Bericht je System, nextRep = Jahr des nächsten Berichts,
 *   tech = erreichte Stufe je Forschungsprojekt { scan: 1, … } (Feinschliff: Anzahl Schritte), scan = Sterne mit bekanntem Reichtum und Orten
 *   (Fernerkundung, ohne Besonderheit).
 * Die Galaxie selbst steht nicht im Spielstand (galaxy.js, aus dem Seed). Aufbau siehe sim.newGame().
 */
export let S = null;

/** Ersetzt den Spielstand (neues Spiel oder geladener Stand). */
export function setState(s) { S = s; }

/**
 * Reiner Oberflächenzustand, wird nicht gespeichert:
 *   confirm = Aktion, die nach dem ersten Tipp auf Bestätigung wartet ('new' oder 'scen:<k>'), sonst null,
 *   level = Zoomstufe der Karte ('galaxy' | 'system' | 'ort'), sys = Stern der System- und Ortsstufe, ort = Ort der
 *   Ortsstufe, sel = gewählter Stern, sheet = offenes Blatt ('star' | 'fronts' | 'game' | 'ort' | 'lab' | null),
 *   cam = Kamera der Galaxie { x, y in Lj, z in px/Lj },
 *   dirty = Karte im nächsten Bild neu zeichnen (nach Gesten), cons = nächste Sonde nimmt einen Konstruktor mit
 *   (Schalter im Sternblatt, #24).
 */
export const UI = { confirm: null, level: 'galaxy', sys: 0, ort: 0, sel: null, sheet: null, cam: { x: 0, y: 0, z: 12 }, dirty: true, cons: false };
