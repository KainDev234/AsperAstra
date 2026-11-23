/**
 * bot.js – Spieler des Bots (Entwicklerwerkzeug, #9). Spielt die aktive Front nach einer einfachen, vernünftigen
 * Strategie und nutzt dabei nur die Befehle, die auch der Spieler hat. Gebraucht von tools/bot.mjs (Messungen)
 * und scenarios.js (Testspielstände). Ohne DOM.
 *
 * Strategie: Bauen nach derselben festen Regel wie ferne Fronten (sim.frontPlan); Sonden in Auftrag geben, sobald
 * eine Werft steht und Materie reicht; fertige Sonden zum nächsten freien Stern, solange das Verlustrisiko höchstens
 * FRONT_RISK_MAX ist. Saatpaket: Kraftwerk bei hellen Sternen (ab Klasse G), sonst Mine. Kein Sprung.
 */
import { S } from './state.js';
import { CLASSES, PROBE, FRONT_RISK_MAX } from './data.js';
import { dist } from './util.js';
import { sysOf, star, stars, frontPlan, order, orderProbe, launchProbe, launchRisk, targetFree } from './sim.js';

/** Sternklassen, bei denen der Bot ein Kraftwerk als Saatpaket schickt. */
const BRIGHT = Object.keys(CLASSES).filter(k => CLASSES[k].e >= CLASSES.G.e);

/**
 * Erzeugt einen Bot-Spieler. Aufruf einmal je Monat vor sim.step().
 * @param {(kind: string) => void} [onDecision] wird je Entscheidung aufgerufen ('build', 'probe', 'launch')
 * @returns {() => void}
 */
export function createBot(onDecision = () => {}) {
  return () => {
    if (S.me === null) return;
    const sys = sysOf(S.me);
    // jeder Bauer ohne Arbeit bekommt den nächsten Schritt der Regel (eine Entscheidung)
    for (const u of S.units.filter(x => x.s === S.me)) {
      if (u.q.length || u.job || u.mv) continue;
      const plan = frontPlan(sys, u);
      if (!plan.length) continue;
      for (const it of plan) order(u.id, it);
      onDecision('build');
    }
    if (!sys.pq && sys.pj === null && !sys.ready && sys.b.some(b => b.k === 'werft') && sys.m >= PROBE.cost && orderProbe() === '') onDecision('probe');
    if (sys.ready && launchRisk() <= FRONT_RISK_MAX + 1e-9) {
      const here = star(S.me);
      const t = stars().filter(x => targetFree(x.i)).sort((a, b) => dist(a, here) - dist(b, here))[0];
      if (t && launchProbe(t.i, BRIGHT.includes(t.cls) ? 'power' : 'mine') === '') onDecision('launch');
    }
  };
}
