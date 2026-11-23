/**
 * sim.js – Spiellogik (ohne DOM). Im Grundgerüst nur: neues Spiel, Zufall, Logbuch und der leere
 * Simulationsschritt. Die Mechaniken kommen ab Phase 3 (KONZEPT.md).
 */
import { S, setState } from './state.js';
import { rngStep, rngSeed, SEED_RANGE } from './util.js';
import { SAVE_VERSION, START_YEAR, TEMPO_DEFAULT, LOG_MAX } from './data.js';

/** Rückrufe in die Oberfläche bzw. Zeitsteuerung; ohne Browser (Tests) bleiben sie wirkungslos. */
export const hooks = {
  /** Wichtige Meldung als Kurzmeldung anzeigen. */
  notify: () => {},
  /** Ereignis, bei dem die Zeit anhält (belegt clock.js). */
  event: () => {},
};

/**
 * Zufallszahl in [0, 1) für die Simulation. Der Zustand liegt im Spielstand (S.rng, aus dem Seed
 * abgeleitet), damit gleicher Seed + gleiche Aktionen denselben Verlauf ergeben – auch nach Speichern
 * und Laden. Die Simulation nutzt deshalb nie Math.random(). (Übernommen aus Replikator.)
 */
export function rand() {
  const [v, a] = rngStep(S.rng);
  S.rng = a;
  return v;
}

/**
 * Schreibt einen Eintrag ins Logbuch; die ältesten fallen über LOG_MAX hinaus heraus.
 * @param {string} t Text   @param {''|'warn'|'good'} [c] Klasse
 */
export function log(t, c = '') {
  S.log.push(c ? { y: S.year, t, c } : { y: S.year, t });
  if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
}

/** Meldet ein Ereignis, bei dem die Zeit anhält (Grund als kurzer Text). */
export function event(reason) { hooks.event(reason); }

/**
 * Beginnt ein neues Spiel.
 * @param {number|null} [seed] Seed der Partie; null = zufällig (nur hier Math.random: die Wahl des Seeds
 *   gehört nicht zur Simulation)
 */
export function newGame(seed = null) {
  if (seed === null) seed = Math.floor(Math.random() * SEED_RANGE);
  setState({ v: SAVE_VERSION, seed, rng: rngSeed(seed), year: START_YEAR, speed: 0, tempo: { n: TEMPO_DEFAULT }, log: [] });
  log('Neues Spiel.');
}

/**
 * Ein Simulationsschritt über dt Spieljahre (clock.js ruft ihn mit höchstens einem Monat auf).
 * Im Grundgerüst vergeht nur die Zeit.
 */
export function step(dt) {
  S.year += dt;
}
