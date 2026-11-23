/**
 * data.js – feste Tabellen und Konstanten. Ohne Abhängigkeiten, ohne DOM.
 */

/** Schlüssel im localStorage. Bei Formatänderungen SAVE_VERSION erhöhen und in save.js (MIGRATIONS) umwandeln. */
export const SAVE_KEY = 'asperastra-save';
export const SAVE_VERSION = 1;
/** Spieljahr beim Start. */
export const START_YEAR = 2133;

/**
 * Tempo beim Laufen: Spieljahre je Echtzeit-Sekunde (y) und Anzeigename (n). Übernommen aus Replikator
 * (Zeitsteuerung mit Pause und Laufen). Gewählt wird es über den Tempo-Knopf.
 */
export const TEMPO = [
  { y: 1 / 365, n: '1 Tag' }, { y: 1 / 52, n: '1 Woche' }, { y: 1 / 24, n: '2 Wochen' }, { y: 1 / 12, n: '1 Monat' }, { y: 1 / 6, n: '2 Monate' },
  { y: 1 / 4, n: '3 Monate' }, { y: 1 / 2, n: '6 Monate' }, { y: 1, n: '1 Jahr' },
];
export const TEMPO_DEFAULT = 3;

/** Höchstzahl der Logbuch-Einträge im Spielstand; ältere fallen heraus. */
export const LOG_MAX = 200;
/** Höchstlänge eines Logbuch-Textes (Prüfung fremder Spielstände). */
export const LOG_TEXT_MAX = 500;
/** Klassen der Logbuch-Einträge (landen im class-Attribut). */
export const LOG_CLASSES = ['warn', 'good'];
