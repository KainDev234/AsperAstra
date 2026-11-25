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
import { SAVE_KEY, SAVE_VERSION, START_YEAR, TEMPO, LOG_MAX, LOG_TEXT_MAX, LOG_CLASSES, BUILD, ORTE, PROBE, QUEUE_MAX, PROJECTS, stageMax } from './data.js';
import { hooks, itemValid, WAITS } from './sim.js';
import { galaxy } from './galaxy.js';
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
const MIGRATIONS = {
  // 2 → 3 (#22): Forschung – noch nichts erforscht, kein Projekt läuft, keine Sonde trägt einen Konstruktor
  2: d => ({
    ...d, v: 3, tech: {}, scan: [],
    sys: d.sys.map(y => ({ ...y, rj: null })),
    probes: d.probes.map(p => ({ ...p, c: false })),
  }),
  // 3 → 4 (#26): Antrieb – fliegende Sonden mit dem alten Tempo, keine Instrumentensonden
  3: d => ({ ...d, v: 4, probes: d.probes.map(p => ({ ...p, v: PROBE.v, r: null })) }),
};

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

/** Obergrenze für Materie (weit über allem, was im Spiel vorkommt). */
const BIG = 1e12;
/** Obergrenzen für Listen, damit ein manipulierter Stand keine riesigen Schleifen auslöst. */
const MAX_UNITS = 2000, MAX_MAIL = 50000;
/** Schlüssel in BUILD (eigener Eintrag, nicht z. B. "__proto__"). */
const buildKey = k => str(k) && Object.prototype.hasOwnProperty.call(BUILD, k);

/** Gebäude { k, o, lv } an Stern st. */
const validBuilding = (b, st) => obj(b) && only(b, ['k', 'o', 'lv']) && buildKey(b.k) && int(b.o, 0, st.orte.length - 1)
  && BUILD[b.k].at.includes(st.orte[b.o].k) && int(b.lv, 1, BUILD[b.k].up === null ? 1 : 2);

/** Schlüssel in PROJECTS. */
const projKey = p => str(p) && Object.prototype.hasOwnProperty.call(PROJECTS, p);
/** Stufe n von Projekt p existiert. */
const stageOk = (p, n) => projKey(p) && int(n, 1, stageMax(p));
/** Laufende Forschung { p, n, left } (left großzügig: Fernmessung wächst mit dem Abstand). */
const validRj = r => r === null || (obj(r) && only(r, ['p', 'n', 'left']) && stageOk(r.p, r.n) && within(r.left, -1, 1000));

/** System { s, m, b, pq, pj, ready, rj }; Plätze je Ort werden im Ganzen geprüft (validate). */
function validSys(y, stars) {
  if (!obj(y) || !only(y, ['s', 'm', 'b', 'pq', 'pj', 'ready', 'rj']) || !int(y.s, 0, stars.length - 1)) return false;
  const st = stars[y.s];
  return within(y.m, 0, BIG) && Array.isArray(y.b) && y.b.every(b => validBuilding(b, st))
    && int(y.pq, 0, PROBE.queue) && (y.pj === null || within(y.pj, -1, PROBE.time)) && int(y.ready, 0, 1000) && validRj(y.rj);
}

/** Laufender Auftrag eines Bauers an Stern st. */
function validJob(j, st) {
  if (!obj(j) || !int(j.o, 0, st.orte.length - 1) || !within(j.left, -1, 10)) return false;
  if (j.a === 'build' || j.a === 'up') return only(j, ['a', 'k', 'o', 'left']) && buildKey(j.k) && BUILD[j.k].at.includes(st.orte[j.o].k) && (j.a === 'build' || BUILD[j.k].up !== null);
  if (j.a === 'cons') return only(j, ['a', 'o', 'left']);
  return j.a === 'consup' && only(j, ['a', 'id', 'o', 'left']) && int(j.id, 1, 1e9);
}

/** Bauer { id, k, s, o, lv, q, job, mv, wait? }; s muss ein System sein. */
function validUnit(u, stars) {
  if (!obj(u) || !only(u, ['id', 'k', 's', 'o', 'lv', 'q', 'job', 'mv', 'wait'])) return false;
  if (!int(u.id, 1, 1e9) || !['copy', 'cons'].includes(u.k) || !int(u.s, 0, stars.length - 1)) return false;
  const st = stars[u.s];
  if (!int(u.o, 0, st.orte.length - 1) || !int(u.lv, 1, u.k === 'copy' ? 1 : 2)) return false;
  if (!Array.isArray(u.q) || u.q.length > QUEUE_MAX || !u.q.every(it => itemValid(it, st))) return false;
  if (u.job !== null && (!validJob(u.job, st) || u.job.o !== u.o)) return false;
  if (u.mv !== null && !(obj(u.mv) && only(u.mv, ['o', 't']) && int(u.mv.o, 0, st.orte.length - 1) && within(u.mv.t, -1, 1))) return false;
  if (u.mv !== null && u.job !== null) return false;
  return u.wait === undefined || WAITS.includes(u.wait);
}

/** Sonde im Flug { id, from, to, at, seed, two, c, risk, v, r }; r = { p, n } genau bei einer Instrumentensonde. */
const validProbe = (p, stars, yr) => obj(p) && only(p, ['id', 'from', 'to', 'at', 'seed', 'two', 'c', 'risk', 'v', 'r'])
  && int(p.id, 1, 1e9) && int(p.from, 0, stars.length - 1) && int(p.to, 0, stars.length - 1) && p.from !== p.to
  && within(p.at, yr - 1, YEAR_MAX) && ['mine', 'power', 'inst'].includes(p.seed) && typeof p.two === 'boolean'
  && typeof p.c === 'boolean' && within(p.risk, 0, 1) && within(p.v, 0.05, 1)
  && (p.seed === 'inst' ? obj(p.r) && only(p.r, ['p', 'n']) && stageOk(p.r.p, p.r.n) : p.r === null);

/** Liste verschiedener Sterne (Fernerkundung). */
const starList = (a, stars) => Array.isArray(a) && a.length <= stars.length && a.every(s => int(s, 0, stars.length - 1)) && new Set(a).size === a.length;

/** Bericht eines Systems { y, m, b: { Art: Anzahl }, cons, ready } (ohne s). */
const validReport = (r, yr) => obj(r) && year(r.y) && r.y <= yr + 1 && int(r.m, 0, BIG) && obj(r.b)
  && Object.entries(r.b).every(([k, n]) => buildKey(k) && int(n, 1, 1000)) && int(r.cons, 0, MAX_UNITS) && int(r.ready, 0, 1000);

/** Nachricht unterwegs { at, k, s, d? }. */
function validMail(x, stars, yr) {
  if (!obj(x) || !within(x.at, yr - 1, YEAR_MAX) || !int(x.s, 0, stars.length - 1)) return false;
  if (x.k === 'rep') return only(x, ['at', 'k', 's', 'd']) && validReport(x.d, yr);
  if (x.k === 'tech') return only(x, ['at', 'k', 's', 'd']) && obj(x.d) && only(x.d, ['p', 'n']) && stageOk(x.d.p, x.d.n);
  if (x.k === 'scan') return only(x, ['at', 'k', 's', 'd']) && x.d.length > 0 && starList(x.d, stars);
  return ['arrive', 'lost'].includes(x.k) && only(x, ['at', 'k', 's']);
}

/**
 * Prüft einen (migrierten) Spielstand vollständig: Felder und Typen, Verweise auf Sterne, Orte und Bauer,
 * Plätze je Ort, genau eine Kopie je System, aktive Front oder Sprung.
 * @returns {boolean} true, wenn er gefahrlos als laufendes Spiel übernommen werden kann
 */
export function validate(d) {
  const KEYS = ['v', 'seed', 'rng', 'year', 'speed', 'tempo', 'log', 'me', 'jump', 'sys', 'units', 'nextId', 'probes', 'known', 'mail', 'rep', 'nextRep', 'tech', 'scan'];
  if (!obj(d) || d.v !== SAVE_VERSION || !only(d, KEYS) || KEYS.some(k => d[k] === undefined)) return false;
  // seed: 0 … 2^32−1; rng: 32-Bit-Zustand des Simulations-Zufalls
  if (!int(d.seed, 0, SEED_RANGE - 1) || !int(d.rng, -(2 ** 31), 2 ** 31 - 1)) return false;
  // speed nur 0 (Pause) oder 1 (Laufen) – ein riesiger Wert ließe advance() minutenlang rechnen
  if (!year(d.year) || ![0, 1].includes(d.speed)) return false;
  if (!obj(d.tempo) || !only(d.tempo, ['n']) || !int(d.tempo.n, 0, TEMPO.length - 1)) return false;
  if (!Array.isArray(d.log) || d.log.length > LOG_MAX || !d.log.every(validLog)) return false;
  const stars = galaxy(d.seed), yr = d.year;
  // Systeme: verschiedene Sterne, Plätze je Ort eingehalten (laufende Bauaufträge zählen mit)
  if (!Array.isArray(d.sys) || d.sys.length < 1 || d.sys.length > stars.length || !d.sys.every(y => validSys(y, stars))) return false;
  const sysAt = new Map(d.sys.map(y => [y.s, y]));
  if (sysAt.size !== d.sys.length) return false;
  // Bauer: eindeutige ids, nur in Systemen, genau eine Kopie je System
  if (!Array.isArray(d.units) || d.units.length > MAX_UNITS || !d.units.every(u => validUnit(u, stars) && sysAt.has(u.s))) return false;
  const ids = new Set(d.units.map(u => u.id));
  if (ids.size !== d.units.length) return false;
  for (const y of d.sys) if (d.units.filter(u => u.s === y.s && u.k === 'copy').length !== 1) return false;
  for (const y of d.sys) {
    const st = stars[y.s];
    for (let o = 0; o < st.orte.length; o++) {
      const n = y.b.filter(b => b.o === o).length + d.units.filter(u => u.s === y.s && u.job && u.job.a === 'build' && u.job.o === o).length;
      if (n > ORTE[st.orte[o].k].slots) return false;
    }
  }
  // aktive Front oder Sprung, genau eins
  if ((d.me === null) === (d.jump === null)) return false;
  if (d.me !== null && !sysAt.has(d.me)) return false;
  if (d.jump !== null && !(obj(d.jump) && only(d.jump, ['to', 'at']) && sysAt.has(d.jump.to) && within(d.jump.at, yr - 1, YEAR_MAX))) return false;
  // Sonden: Ziel frei und nur einmal; ids verschieden von denen der Bauer
  if (!Array.isArray(d.probes) || d.probes.length > MAX_UNITS || !d.probes.every(p => validProbe(p, stars, yr) && !sysAt.has(p.to))) return false;
  if (new Set(d.probes.map(p => p.to)).size !== d.probes.length) return false;
  const allIds = [...ids, ...d.probes.map(p => p.id)];
  if (new Set(allIds).size !== allIds.length || !int(d.nextId, 1, 1e9) || allIds.some(i => i >= d.nextId)) return false;
  // Wissen, Nachrichten, Berichte
  if (!Array.isArray(d.known) || !d.known.every(s => int(s, 0, stars.length - 1)) || new Set(d.known).size !== d.known.length) return false;
  if (!Array.isArray(d.mail) || d.mail.length > MAX_MAIL || !d.mail.every(x => validMail(x, stars, yr))) return false;
  if (!Array.isArray(d.rep) || !d.rep.every(r => obj(r) && only(r, ['s', 'y', 'm', 'b', 'cons', 'ready']) && int(r.s, 0, stars.length - 1) && validReport(r, yr))) return false;
  if (new Set(d.rep.map(r => r.s)).size !== d.rep.length) return false;
  // Forschung: erreichte Stufen je Projekt, Fernerkundung; je Projekt läuft höchstens ein System
  if (!obj(d.tech) || !Object.entries(d.tech).every(([p, n]) => stageOk(p, n)) || !starList(d.scan, stars)) return false;
  const running = d.sys.filter(y => y.rj).map(y => y.rj.p);
  if (new Set(running).size !== running.length) return false;
  return int(d.nextRep, START_YEAR + 1, YEAR_MAX) && d.nextRep > yr - 1 && d.nextRep <= yr + 1;
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
