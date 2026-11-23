/**
 * scenarios.js – Testspielstände (#9, Regeln #6 Abschnitt 8): fertige Lagen, damit ein Test Minuten statt Wochen
 * dauert. Sie werden nicht als Dateien gepflegt, sondern aus einem festen Seed erzeugt: neues Spiel, dann spielt
 * der Bot (bot.js), bis die Lage erreicht ist. Weil die Simulation deterministisch ist, entsteht jedes Mal derselbe
 * Stand. Ohne DOM.
 */
import { S } from './state.js';
import { newGame, step, log, sysOf } from './sim.js';
import { createBot } from './bot.js';

/** Seed aller Testspielstände. */
export const SCENARIO_SEED = 4242;

/**
 * Die Testspielstände: Name und Bedingung, bis zu der der Bot spielt (höchstens max Jahre).
 *   start    = wie ein neues Spiel
 *   probe    = die erste Sonde ist höchstens noch ein Jahr unterwegs
 *   fronts   = eine ferne Front und Sol haben einen Sender, ihr Bericht ist da: Sprung möglich
 *   overflow = Sol nach 150 Jahren (prüft die Senken)
 */
export const SCENARIOS = {
  start: { n: 'Start', max: 0, done: () => true },
  probe: { n: 'Erste Sonde', max: 150, done: () => S.probes.length > 0 && S.probes[0].at - S.year <= 1 },
  fronts: {
    n: 'Zwei Fronten', max: 300,
    done: () => sysOf(0).b.some(b => b.k === 'sender') && S.rep.some(r => r.s !== 0 && sysOf(r.s).b.some(b => b.k === 'sender')),
  },
  overflow: { n: 'Überfluss', max: 150, done: () => false },
};

/**
 * Ersetzt das laufende Spiel durch Testspielstand k. Die Zeit steht danach auf Pause.
 * @returns {boolean} false, wenn es k nicht gibt
 */
export function loadScenario(k) {
  const sc = Object.prototype.hasOwnProperty.call(SCENARIOS, k) && SCENARIOS[k];
  if (!sc) return false;
  newGame(SCENARIO_SEED);
  const bot = createBot();
  for (let i = 0; i < sc.max * 12 && !sc.done(); i++) { bot(); step(1 / 12); }
  S.speed = 0;
  log(`Testspielstand „${sc.n}“.`, 'good');
  return true;
}
