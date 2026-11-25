/**
 * scenarios.js – Testspielstände (#9, Regeln #6 Abschnitt 8): fertige Lagen, damit ein Test Minuten statt Wochen
 * dauert. Sie werden nicht als Dateien gepflegt, sondern aus einem festen Seed erzeugt: neues Spiel, dann spielt
 * der Bot (bot.js), bis die Lage erreicht ist. Weil die Simulation deterministisch ist, entsteht jedes Mal derselbe
 * Stand. Ohne DOM.
 */
import { S } from './state.js';
import { newGame, step, log, sysOf, techOf } from './sim.js';
import { createBot } from './bot.js';

/** Seed der Testspielstände (einzelne können einen eigenen haben: seed). */
export const SCENARIO_SEED = 4242;

/**
 * Die Testspielstände: Name und Bedingung, bis zu der der Bot spielt (höchstens max Jahre), optional ein eigener Seed.
 *   start    = wie ein neues Spiel
 *   probe    = die erste Sonde ist höchstens noch ein Jahr unterwegs
 *   fronts   = Sol hat einen Sender, und der Bericht einer fernen Front meldet ihren: Sprung möglich
 *   research = Fernerkundung und Konstruktor im Saatpaket erforscht (#22)
 *   drive    = Magnetbremse erforscht (#26): als Nächstes eine Messung vor Ort mit Instrumentensonde (eigener Seed:
 *              bei SCENARIO_SEED steht kein heller Stern in Reichweite von Sol)
 *   overflow = Sol nach 150 Jahren (prüft die Senken)
 */
export const SCENARIOS = {
  start: { n: 'Start', max: 0, done: () => true },
  probe: { n: 'Erste Sonde', max: 150, done: () => S.probes.length > 0 && S.probes[0].at - S.year <= 1 },
  fronts: {
    n: 'Zwei Fronten', max: 300,
    // Sprung möglich nach Wissen des Spielers: Sender in Sol und ein Bericht, der dort einen Sender meldet (#13)
    done: () => sysOf(0).b.some(b => b.k === 'sender') && S.rep.some(r => r.s !== 0 && r.b.sender > 0),
  },
  research: { n: 'Forschung', max: 100, done: () => techOf('scan') >= 1 && techOf('seed') >= 1 },
  drive: { n: 'Antrieb', seed: 4245, max: 200, done: () => techOf('drive') >= 1 },
  overflow: { n: 'Überfluss', max: 150, done: () => false },
};

/**
 * Ersetzt das laufende Spiel durch Testspielstand k. Die Zeit steht danach auf Pause.
 * @returns {boolean} false, wenn es k nicht gibt
 */
export function loadScenario(k) {
  const sc = Object.prototype.hasOwnProperty.call(SCENARIOS, k) && SCENARIOS[k];
  if (!sc) return false;
  newGame(sc.seed ?? SCENARIO_SEED);
  const bot = createBot();
  for (let i = 0; i < sc.max * 12 && !sc.done(); i++) { bot(); step(1 / 12); }
  S.speed = 0;
  log(`Testspielstand „${sc.n}“.`, 'good');
  return true;
}
