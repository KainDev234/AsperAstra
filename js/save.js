/**
 * save.js – Spielstände: Autosave, Export/Import als Datei, Migration und Prüfung.
 * Übernommen aus Replikator (js/save.js), ohne die drei Speicherplätze; die Prüfung ist auf den neuen,
 * noch kleinen Spielstand zugeschnitten.
 *
 * Alle Spielstände liegen nur im localStorage des jeweiligen Browsers/Geräts bzw. in einer exportierten
 * Datei. Es werden keine Daten an den Server oder Dritte übertragen.
 *
 * Ablage im localStorage:
 *   SAVE_KEY         Autosave: der Spielzustand S direkt als JSON
 *   SAVE_KEY-backup  unveränderter Text eines Autosaves, der sich beim Start nicht laden ließ
 * Exportdatei: { app: 'asperastra', savedAt, data: S }.
 *
 * Jeder geladene Stand (Autosave, Datei) wird erst migriert, dann mit validate() vollständig geprüft
 * und nur bei Erfolg übernommen. Sonst bleibt das laufende Spiel unverändert.
 */
import { S, setState } from './state.js';
import { SAVE_KEY, SAVE_VERSION, START_YEAR, TEMPO, LOG_MAX, LOG_TEXT_MAX, LOG_CLASSES } from './data.js';
import { hooks } from './sim.js';
import { SEED_RANGE } from './util.js';

/** Sicherung eines Autosaves, der sich beim Start nicht laden ließ; das neue Spiel überschreibt ihn sonst. */
const BACKUP_KEY = `${SAVE_KEY}-backup`;
/** Kennung in Exportdateien. */
const APP = 'asperastra';

/**
 * Migrationen alter Spielstände: MIGRATIONS[v] wandelt einen Stand der Version v in Version v+1 um und
 * setzt d.v = v+1. Gibt es für eine Version keinen Eintrag, ist der Stand zu alt und wird verworfen.
 * Bei jeder Erhöhung von SAVE_VERSION (data.js) hier nach Möglichkeit eine Migration ergänzen.
 */
const MIGRATIONS = {};

/**
 * Bringt einen Spielstand auf die aktuelle Version.
 * @returns {object|'outdated'|'newer'|'invalid'} der umgewandelte Stand oder der Grund, warum er
 *   unbrauchbar ist (newer = aus einer neueren Spielversion)
 */
export function migrate(d) {
  if (!d || typeof d !== 'object' || !Number.isInteger(d.v)) return 'invalid';
  if (d.v > SAVE_VERSION) return 'newer';
  try { while (d.v < SAVE_VERSION && MIGRATIONS[d.v]) d = MIGRATIONS[d.v](d); } catch (e) { return 'invalid'; }
  return d.v === SAVE_VERSION ? d : 'outdated';
}

// ---------- Prüfung eines Spielstands ----------
// Ein Spielstand kann aus einer fremden oder veränderten Datei kommen. Bevor er das laufende Spiel
// ersetzt, wird er vollständig geprüft: Pflichtfelder, Typen, endliche Zahlen in großzügigen Grenzen
// und keine unbekannten Felder. So kann ein kaputter Stand weder das Spiel lahmlegen noch Markup in
// die Oberfläche schmuggeln.

const num = x => typeof x === 'number' && Number.isFinite(x);
/** Endliche Zahl im Bereich [lo, hi]. */
const within = (x, lo, hi) => num(x) && x >= lo && x <= hi;
/** Ganze Zahl im Bereich [min, max]. */
const int = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
const str = x => typeof x === 'string';
const obj = x => !!x && typeof x === 'object' && !Array.isArray(x);
/** Objekt hat nur die erlaubten Schlüssel (fehlende Pflichtfelder prüfen die Einzeltests). */
const only = (o, keys) => Object.keys(o).every(k => keys.includes(k));
/** Spieljahre: vom Start bis weit über jedes realistische Spielende hinaus. */
const YEAR_MAX = START_YEAR + 1e5;
const year = x => within(x, START_YEAR, YEAR_MAX);

/** Ein Logbuch-Eintrag { y, t, c? }. */
const validLog = e => obj(e) && only(e, ['y', 't', 'c']) && year(e.y) && str(e.t) && e.t.length <= LOG_TEXT_MAX
  && (e.c === undefined || LOG_CLASSES.includes(e.c));

/**
 * Prüft einen (migrierten) Spielstand vollständig.
 * @returns {boolean} true, wenn er gefahrlos als laufendes Spiel übernommen werden kann
 */
export function validate(d) {
  if (!obj(d) || d.v !== SAVE_VERSION || !only(d, ['v', 'seed', 'rng', 'year', 'speed', 'tempo', 'log'])) return false;
  // seed: 0 … 2^32−1; rng: 32-Bit-Zustand des Simulations-Zufalls
  if (!int(d.seed, 0, SEED_RANGE - 1) || !int(d.rng, -(2 ** 31), 2 ** 31 - 1)) return false;
  // speed nur 0 (Pause) oder 1 (Laufen) – ein riesiger Wert ließe advance() minutenlang rechnen
  if (!year(d.year) || ![0, 1].includes(d.speed)) return false;
  if (!obj(d.tempo) || !only(d.tempo, ['n']) || !int(d.tempo.n, 0, TEMPO.length - 1)) return false;
  return Array.isArray(d.log) && d.log.length <= LOG_MAX && d.log.every(validLog);
}

/**
 * Übernimmt einen Stand (migrieren, prüfen, setzen, sofort sichern). Bei jedem Fehler bleibt das
 * laufende Spiel unverändert.
 * @returns {'ok'|'outdated'|'newer'|'invalid'}
 */
function apply(d) {
  const m = migrate(d);
  if (typeof m === 'string') return m;
  if (!validate(m)) return 'invalid';
  setState(m);
  save();
  return 'ok';
}

/** true, solange das letzte Speichern fehlgeschlagen ist (damit die Meldung nur einmal kommt). */
let saveFailed = false;

/**
 * Speichert den aktuellen Spielstand als Autosave. Scheitert das (privater Modus, Speicher voll),
 * erscheint einmalig eine Kurzmeldung; nach dem nächsten Erfolg wieder scharf.
 * @returns {boolean} true bei Erfolg
 */
export function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    saveFailed = false;
    return true;
  } catch (e) {
    if (!saveFailed) hooks.notify('Speichern nicht möglich – Speicher voll oder privater Modus?');
    saveFailed = true;
    return false;
  }
}

/** Merker, ob eine Sicherung existiert (null = noch nicht nachgesehen). */
let backupExists = null;

/**
 * Lädt den Autosave beim Start. Lässt er sich nicht übernehmen, wird er vorher unter BACKUP_KEY
 * gesichert, weil das neue Spiel ihn gleich überschreibt. Eine schon vorhandene Sicherung wird nicht
 * überschrieben (die ältere ist die wertvollere).
 * @returns {'ok'|'none'|'outdated'|'newer'|'invalid'} none = kein Autosave vorhanden
 */
export function load() {
  let raw;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return 'none'; }
  if (!raw) return 'none';
  let r;
  try { r = apply(JSON.parse(raw)); } catch (e) { r = 'invalid'; }   // kein gültiges JSON
  if (r !== 'ok' && !hasBackup()) {
    try { localStorage.setItem(BACKUP_KEY, raw); backupExists = true; } catch (e) { /* kein Platz */ }
  }
  return r;
}

/** true, wenn ein nicht ladbarer alter Autosave gesichert ist. */
export function hasBackup() {
  if (backupExists === null) {
    try { backupExists = !!localStorage.getItem(BACKUP_KEY); } catch (e) { backupExists = false; }
  }
  return backupExists;
}

/** Lädt den gesicherten alten Autosave unverändert als Datei herunter. */
export function exportBackup() {
  try { download(localStorage.getItem(BACKUP_KEY) || '', 'asperastra-sicherung.json'); } catch (e) { /* nichts zu sichern */ }
}

/** Verwirft den gesicherten alten Autosave. */
export function deleteBackup() {
  try { localStorage.removeItem(BACKUP_KEY); backupExists = false; } catch (e) { backupExists = null; }
}

/** Bietet einen Text als JSON-Datei zum Herunterladen an (nur im Browser). */
function download(text, name) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Lädt das laufende Spiel als Datei herunter (Name z. B. asperastra-2187.json). */
export function exportFile() {
  download(JSON.stringify({ app: APP, savedAt: Date.now(), data: S }), `${APP}-${Math.floor(S.year)}.json`);
}

/**
 * Übernimmt den Inhalt einer exportierten Datei als laufendes Spiel. Akzeptiert auch einen reinen
 * Spielzustand (z. B. den Autosave-Inhalt aus den Entwicklerwerkzeugen).
 * @returns {'ok'|'outdated'|'newer'|'invalid'}
 */
export function importText(text) {
  try {
    const w = JSON.parse(text);
    return apply(w && w.app === APP ? w.data : w);
  } catch (e) { return 'invalid'; }
}

/** Automatisch speichern: alle 5 Sekunden und beim Verlassen/Verstecken der Seite (wichtig auf dem Handy). */
export function initAutosave() {
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
}
