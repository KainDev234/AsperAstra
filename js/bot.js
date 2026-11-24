/**
 * bot.js – Spieler des Bots (Entwicklerwerkzeug, #9). Spielt die aktive Front nach einer einfachen, vernünftigen
 * Strategie und nutzt dabei nur die Befehle, die auch der Spieler hat. Gebraucht von tools/bot.mjs (Messungen)
 * und scenarios.js (Testspielstände). Ohne DOM.
 *
 * Strategie: Bauen nach derselben festen Regel wie ferne Fronten (sim.frontPlan); dazu Labore (#22): nach der Werft
 * eine Sternwarte, nach der Fernerkundung eine Werkstatt. Forschung beginnen, sobald es geht (Fernerkundung vor
 * Saatsonde). Sonden in Auftrag geben, sobald eine Werft steht und Materie reicht; fertige Sonden zum besten freien
 * Stern mit Verlustrisiko höchstens FRONT_RISK_MAX (Abstand ÷ Reichtum, soweit bekannt), sobald der Treibstoff
 * reicht; mit Konstruktor im Saatpaket, wenn erforscht und bezahlbar. Saatpaket: Kraftwerk bei hellen Sternen (ab
 * Klasse G), sonst Mine. Kein Sprung.
 */
import { S } from './state.js';
import { CLASSES, CONS, FRONT_RISK_MAX } from './data.js';
import {
  sysOf, star, stars, frontPlan, order, orderProbe, launchProbe, targetFree, launchRisk, fuelCost, probeCost,
  techOf, research, bestOrt, energy,
} from './sim.js';
import { isScanned } from './view.js';
import { dist } from './util.js';

/** Sternklassen, bei denen der Bot ein Kraftwerk als Saatpaket schickt. */
const BRIGHT = Object.keys(CLASSES).filter(k => CLASSES[k].e >= CLASSES.G.e);
/** Reihenfolge, in der der Bot forscht. */
const PROJECT_ORDER = ['scan', 'seed'];

/** Anzahl Gebäude k im System, mitgezählt Bauaufträge in Arbeit und in Warteschlangen. */
const planned = (sys, k) => sys.b.filter(b => b.k === k).length
  + S.units.filter(u => u.s === sys.s).reduce((a, u) => a + (u.job && u.job.a === 'build' && u.job.k === k ? 1 : 0) + u.q.filter(it => it.a === 'build' && it.k === k).length, 0);

/**
 * Labor, das der Bot als Nächstes bauen will, mit Kraftwerk davor, wenn die Energie nicht reicht (wie frontPlan).
 * @returns {object[]} Aufträge oder [] (kein Labor fällig)
 */
function labPlan(sys, u) {
  const k = !sys.b.some(b => b.k === 'werft') ? null
    : !planned(sys, 'obs') ? 'obs'
      : techOf('scan') >= 1 && !planned(sys, 'shop') ? 'shop' : null;
  if (!k) return [];
  const e = energy(sys);
  const want = e.gen < e.need + 2 && bestOrt(sys, 'power') >= 0 ? 'power' : k;
  const o = bestOrt(sys, want);
  if (o < 0) return [];
  return [...(o !== u.o ? [{ a: 'move', o }] : []), { a: 'build', k: want }];
}

/**
 * Ziel des Bots: freier Stern mit tragbarem Risiko, kleinster Abstand ÷ Reichtum (unbekannter Reichtum zählt 1, das
 * ist der Mittelwert). -1 = keiner.
 */
export function botTarget(s) {
  const here = star(s);
  let best = -1, bv = Infinity;
  for (const t of stars()) {
    if (!targetFree(t.i) || launchRisk(t.i) > FRONT_RISK_MAX + 1e-9) continue;
    const v = dist(here, t) / (isScanned(t.i) ? t.rich : 1);
    if (v < bv) { bv = v; best = t.i; }
  }
  return best;
}

/**
 * Erzeugt einen Bot-Spieler. Aufruf einmal je Monat vor sim.step().
 * @param {(kind: string) => void} [onDecision] wird je Entscheidung aufgerufen ('build', 'probe', 'launch', 'research')
 * @returns {() => void}
 */
export function createBot(onDecision = () => {}) {
  return () => {
    if (S.me === null) return;
    const sys = sysOf(S.me);
    // jeder Bauer ohne Arbeit bekommt den nächsten Schritt (eine Entscheidung): erst fällige Labore, sonst die Regel
    for (const u of S.units.filter(x => x.s === S.me)) {
      if (u.q.length || u.job || u.mv) continue;
      let plan = labPlan(sys, u);
      if (!plan.length) plan = frontPlan(sys, u);
      if (!plan.length) continue;
      for (const it of plan) order(u.id, it);
      onDecision('build');
    }
    for (const p of PROJECT_ORDER) if (research(p) === '') { onDecision('research'); break; }
    if (!sys.pq && sys.pj === null && !sys.ready && sys.b.some(b => b.k === 'werft') && sys.m >= probeCost() && orderProbe() === '') onDecision('probe');
    if (sys.ready) {
      const t = botTarget(S.me);
      if (t >= 0) {
        const c = techOf('seed') >= 1 && sys.m >= fuelCost(S.me, t) + CONS.cost;
        if (launchProbe(t, BRIGHT.includes(star(t).cls) ? 'power' : 'mine', c) === '') onDecision('launch');
      }
    }
  };
}
