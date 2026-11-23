/**
 * clock.js – Zeitsteuerung: Pause und Laufen mit einstellbarem Tempo; Ereignisse halten an.
 * Übernommen aus Replikator (js/clock.js), ohne Termine und abschaltbare Haltepunkte – die kommen,
 * wenn es Ereignisse gibt.
 *
 * Ohne DOM-Zugriff, damit in Node testbar. main.js ruft advance() einmal pro Frame auf.
 */
import { S } from './state.js';
import { TEMPO } from './data.js';
import { step, hooks, log } from './sim.js';

/** Simulationsschritt: höchstens 1 Monat, damit Ereignisse genau erkannt werden. */
export const STEP = 1 / 12;

/** Gründe der Ereignisse im laufenden Aufruf; gleichzeitige werden gesammelt, Doppelte zählen einmal. */
let stopReasons = [];
hooks.event = reason => { if (!stopReasons.includes(reason)) stopReasons.push(reason); };

/**
 * Lässt die Spielzeit für dtReal Echtzeit-Sekunden laufen: dtReal × TEMPO[S.tempo.n].y Spieljahre, in
 * Monatsschritten. Ein Ereignis hält an (Pause) und kommt ins Logbuch.
 * @returns {string|null} Grund, falls gerade angehalten wurde, sonst null
 */
export function advance(dtReal) {
  stopReasons = [];
  let yrs = dtReal * S.speed * TEMPO[S.tempo.n].y;
  while (yrs > 1e-12 && !stopReasons.length) { const d = Math.min(STEP, yrs); step(d); yrs -= d; }
  return halt();
}

/**
 * Wertet die gesammelten Haltegründe aus: ins Logbuch, Pause, Liste leeren. Eigene Funktion, damit
 * sie ohne echte Ereignisse testbar ist (die gibt es erst ab Phase 3).
 * @returns {string|null} Gründe, mit „ · “ verbunden, oder null
 */
export function halt() {
  if (!stopReasons.length) return null;
  for (const r of stopReasons) log(`Angehalten: ${r}.`);
  S.speed = 0;
  const text = stopReasons.join(' · ');
  stopReasons = [];
  return text;
}

/** Pause (0) oder Laufen (1). */
export function setSpeed(v) { S.speed = v ? 1 : 0; }

/** Nächste Tempostufe, nach der schnellsten wieder die langsamste. */
export function cycleTempo() { S.tempo.n = (S.tempo.n + 1) % TEMPO.length; }
