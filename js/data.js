/**
 * data.js – feste Tabellen und Konstanten. Ohne Abhängigkeiten, ohne DOM.
 */

/** Schlüssel im localStorage. Bei Formatänderungen SAVE_VERSION erhöhen und in save.js (MIGRATIONS) umwandeln. */
export const SAVE_KEY = 'asperastra-save';
export const SAVE_VERSION = 2;   // 2: Kern-Prototyp (#7); Stände von 1 sind leer und werden nicht umgewandelt
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

// ---------- Kern-Prototyp (Regeln in Issue #6; alle Zahlen sind Startwerte für den Bot) ----------

/** Galaxie: Anzahl Sterne (mit Sol), Radius der Scheibe in Lj, Mindestabstand zweier Sterne in Lj. */
export const GALAXY = { n: 60, r: 40, minD: 2 };

/** Sternklassen: Häufigkeit (w), Energie eines Kraftwerks am Stern (e), Name, Farbe. */
export const CLASSES = {
  M: { w: 40, e: 2, n: 'Roter Zwerg', c: '#ff8a6a' },
  K: { w: 22, e: 3, n: 'Oranger Zwerg', c: '#ffc27a' },
  G: { w: 12, e: 4, n: 'Gelber Zwerg', c: '#fff1b0' },
  F: { w: 6, e: 5, n: 'Weißgelber Stern', c: '#f4f6ff' },
  A: { w: 3, e: 6, n: 'Weißer Stern', c: '#cfe0ff' },
};

/** Arten von Orten: Bauplätze und Name. Der Stern (Station) ist immer Ort 0. */
export const ORTE = {
  star: { slots: 2, n: 'Station' },
  rock: { slots: 2, n: 'Gesteinsplanet' },
  gas: { slots: 3, n: 'Gasriese' },
  belt: { slots: 2, n: 'Gürtel' },
};

/** Reichtum eines Systems an Materie (Faktor auf Minen) mit Häufigkeit; Teil des Funds. */
export const RICH = [{ w: 1, f: 0.6 }, { w: 2, f: 1 }, { w: 1, f: 1.4 }];
/** Besonderheiten (jedes vierte System): reicher Gürtel, Gasriese mit stärkerem Kraftwerk. */
export const SPECIAL_SHARE = 0.25;

/**
 * Gebäude: Name, Kosten (M), Bauzeit (Bauer-Jahre), Ausbau auf Stufe II (Kosten, null = keiner),
 * Energiebedarf, erlaubte Orte.
 */
export const BUILD = {
  mine: { n: 'Mine', cost: 10, time: 0.5, up: 25, need: 1, at: ['rock', 'belt'] },
  power: { n: 'Kraftwerk', cost: 15, time: 0.5, up: 30, need: 0, at: ['star', 'rock', 'gas'] },
  werft: { n: 'Werft', cost: 25, time: 1, up: 40, need: 2, at: ['star', 'rock', 'gas'] },
  sender: { n: 'Sender', cost: 30, time: 1, up: null, need: 2, at: ['star'] },
};
/** Förderung einer Mine je Stufe (M/Jahr), vor Ort- und Systemfaktor. */
export const MINE_RATE = [0, 2, 5];
/** Faktor der Minen im Gürtel; mit der Besonderheit „reicher Gürtel“. */
export const BELT_MULT = 2, RICH_BELT_MULT = 3;
/** Energie eines Kraftwerks auf einem Planeten; Zuschlag auf einem Gasriesen mit Besonderheit; Faktor Stufe II. */
export const PLANET_POWER = 3, GAS_BONUS = 2, POWER_UP_MULT = 2;
/** Abriss erstattet diesen Anteil der Kosten (Bau + Ausbau). */
export const RAZE_BACK = 0.5;
/** Höchstlänge der Warteschlange eines Bauers. */
export const QUEUE_MAX = 3;

/** Konstruktor: Kosten, Bauzeit, Ausbau auf Stufe II, Bautempo je Stufe. Die Kopie baut mit Tempo 1. */
export const CONS = { cost: 12, time: 0.5, up: 15, speed: [0, 1, 2] };
/** Reisen im System: Monate zwischen nächstem und fernstem Ort, in Jahren. */
export const MOVE_T = [1 / 12, 3 / 12];

/**
 * Sonde: Kosten und Bauzeit in der Werft, Tempo (Anteil von c), mitgebrachte Materie, Verlustrisiko je
 * weiterer gleichzeitig fliegender Sonde, Länge der Bauliste einer Werft.
 */
export const PROBE = { cost: 40, time: 1, v: 0.2, seedM: 15, risk: 0.04, queue: 3 };
/** Ferne Fronten starten Sonden nur bis zu diesem Verlustrisiko (feste Regel, #6). */
export const FRONT_RISK_MAX = 0.08;
/** Startpaket in Sol: Materie im Lager (ein Kraftwerk am Stern steht schon). */
export const START_MATTER = 40;
/** Sol: Ort der Erde (Startpunkt der Kopie). */
export const EARTH = 3;

/** Höchstzahl der Logbuch-Einträge im Spielstand; ältere fallen heraus. */
export const LOG_MAX = 200;
/** Höchstlänge eines Logbuch-Textes (Prüfung fremder Spielstände). */
export const LOG_TEXT_MAX = 500;
/** Klassen der Logbuch-Einträge (landen im class-Attribut). */
export const LOG_CLASSES = ['warn', 'good'];
