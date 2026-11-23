/**
 * sim.js – Spiellogik (ohne DOM): Kern-Prototyp aus Bauen und Reisen (Regeln in Issue #6, Umsetzung #7).
 *
 * Überblick:
 *   - Systeme mit einer Kopie (S.sys) haben ein Materielager, Gebäude an Orten und rechnen Monat für Monat:
 *     Minen fördern, Kraftwerke liefern Energie, reicht sie nicht, laufen alle Verbraucher anteilig langsamer.
 *   - Gebaut wird nur, wo ein Bauer ist (S.units): die Kopie (eine je System) oder Konstruktoren. Jeder Bauer
 *     arbeitet seine Warteschlange ab, einen Auftrag zur Zeit, an seinem Ort; Reisen zwischen Orten dauern.
 *   - Werften bauen Sonden; eine Sonde fliegt mit PROBE.v c zu einem Stern, kann unterwegs verloren gehen und
 *     wird bei Ankunft eine neue Kopie (Saatpaket: Gebäude + Materie).
 *   - Der Spieler steuert genau ein System (S.me). Alle anderen sind ferne Fronten und bauen nach einer festen
 *     Regel (planFront). Ihre Berichte und Nachrichten erreichen den Spieler mit Lichtgeschwindigkeit (S.mail).
 *   - Sprung: Haben Start und Ziel einen Sender, wechselt der Spieler als Signal in die Kopie am Ziel.
 * Die Galaxie selbst ist fest durch den Seed bestimmt (galaxy.js) und nicht im Spielstand.
 */
import { S, setState } from './state.js';
import { rngStep, rngSeed, SEED_RANGE, dist } from './util.js';
import {
  SAVE_VERSION, START_YEAR, TEMPO_DEFAULT, LOG_MAX, CLASSES, BUILD, MINE_RATE, BELT_MULT, RICH_BELT_MULT,
  PLANET_POWER, GAS_BONUS, POWER_UP_MULT, RAZE_BACK, QUEUE_MAX, CONS, MOVE_T, PROBE, FRONT_RISK_MAX,
  START_MATTER, EARTH, ORTE,
} from './data.js';
import { galaxy } from './galaxy.js';

/** Rückrufe in die Oberfläche bzw. Zeitsteuerung; ohne Browser (Tests) bleiben sie wirkungslos. */
export const hooks = {
  /** Wichtige Meldung als Kurzmeldung anzeigen. */
  notify: () => {},
  /** Ereignis, bei dem die Zeit anhält (belegt clock.js). */
  event: () => {},
};

/** Toleranz für Rundungsreste (Jahre, Materie); spielerisch bedeutungslos. */
const EPS = 1e-9;

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

// ---------- Zugriff ----------

/** Sterne der laufenden Partie (aus dem Seed). */
export const stars = () => galaxy(S.seed);
/** Stern i. */
export const star = i => stars()[i];
/** System (Eintrag in S.sys) am Stern s oder null. */
export const sysOf = s => S.sys.find(y => y.s === s) || null;
/** Die Kopie im System s. */
export const copyOf = s => S.units.find(u => u.s === s && u.k === 'copy');
/** Name eines Orts: „Erde“, „Gürtel“ … */
export const ortName = (s, o) => star(s).orte[o].n;
/** Ort, von dem aus der Spieler sieht: sein System oder, während eines Sprungs, das Ziel. */
const viewer = () => star(S.me !== null ? S.me : S.jump.to);

// ---------- Neues Spiel ----------

/**
 * Beginnt ein neues Spiel: Sol mit Startpaket (Kraftwerk am Stern, START_MATTER), die Kopie auf der Erde.
 * @param {number|null} [seed] Seed der Partie; null = zufällig (nur hier Math.random: die Wahl des Seeds
 *   gehört nicht zur Simulation)
 */
export function newGame(seed = null) {
  if (seed === null) seed = Math.floor(Math.random() * SEED_RANGE);
  setState({
    v: SAVE_VERSION, seed, rng: rngSeed(seed), year: START_YEAR, speed: 0, tempo: { n: TEMPO_DEFAULT }, log: [],
    me: 0, jump: null,
    sys: [{ s: 0, m: START_MATTER, b: [{ k: 'power', o: 0, lv: 1 }], pq: 0, pj: null, ready: 0 }],
    units: [{ id: 1, k: 'copy', s: 0, o: EARTH, lv: 1, q: [], job: null, mv: null }],
    nextId: 2, probes: [], known: [0], mail: [], rep: [], nextRep: START_YEAR + 1,
  });
  log('Neues Spiel.');
}

// ---------- Wirtschaft ----------

/** Energie eines Kraftwerks b im System von Stern st. */
export function powerOf(st, b) {
  const k = st.orte[b.o].k;
  const e = k === 'star' ? CLASSES[st.cls].e : PLANET_POWER + (k === 'gas' && st.spec === 'gasPower' ? GAS_BONUS : 0);
  return b.lv > 1 ? e * POWER_UP_MULT : e;
}

/** Energie eines Systems: Erzeugung, Bedarf und Auslastung f (Anteil, mit dem alle Verbraucher laufen). */
export function energy(sys) {
  const st = star(sys.s);
  let gen = 0, need = 0;
  for (const b of sys.b) if (b.k === 'power') gen += powerOf(st, b); else need += BUILD[b.k].need;
  return { gen, need, f: need ? Math.min(1, gen / need) : 1 };
}

/** Förderung einer Mine der Stufe lv an Ort o (M/Jahr) bei voller Energie. */
export function mineRate(st, o, lv) {
  const k = st.orte[o].k;
  const m = k === 'belt' ? (st.spec === 'richBelt' ? RICH_BELT_MULT : BELT_MULT) : 1;
  return MINE_RATE[lv] * m * st.rich;
}

/** Förderung des Systems in M/Jahr bei Auslastung f. */
export function income(sys, f = energy(sys).f) {
  const st = star(sys.s);
  return sys.b.reduce((a, b) => a + (b.k === 'mine' ? mineRate(st, b.o, b.lv) : 0), 0) * f;
}

/** Belegte Plätze an Ort o: stehende Gebäude + laufende Bauaufträge dorthin. */
export function used(sys, o) {
  return sys.b.filter(b => b.o === o).length
    + S.units.filter(u => u.s === sys.s && u.job && u.job.a === 'build' && u.job.o === o).length;
}

/** Freie Plätze an Ort o. */
export const free = (sys, o) => ORTE[star(sys.s).orte[o].k].slots - used(sys, o);

/**
 * Kann Gebäude k an Ort o gebaut werden?
 * @returns {''|'ort'|'slots'} '' = ja, 'ort' = dort nicht erlaubt, 'slots' = kein Platz frei
 */
export function canBuildAt(sys, k, o) {
  if (!BUILD[k].at.includes(star(sys.s).orte[o].k)) return 'ort';
  return free(sys, o) > 0 ? '' : 'slots';
}

/** Reisezeit im System zwischen Ort a und b (Jahre): vom nächsten zum fernsten Ort MOVE_T[0] … MOVE_T[1]. */
export function moveTime(st, a, b) {
  return MOVE_T[0] + (MOVE_T[1] - MOVE_T[0]) * Math.abs(a - b) / Math.max(1, st.orte.length - 1);
}

/** Bautempo eines Bauers (Bauer-Jahre je Jahr). */
export const speedOf = u => u.k === 'copy' ? 1 : CONS.speed[u.lv];

/**
 * Bester Ort für Gebäude k mit freiem Platz (für Saatpaket und feste Regel), -1 = keiner.
 * Mine: höchste Förderung. Kraftwerk: höchste Leistung. Werft: lieber ein Planet (die Station am Stern
 * bleibt für Sender und Kraftwerk). Sender: nur die Station.
 */
export function bestOrt(sys, k) {
  const st = star(sys.s);
  let best = -1, val = -Infinity;
  st.orte.forEach((ort, o) => {
    if (canBuildAt(sys, k, o)) return;
    const v = k === 'mine' ? mineRate(st, o, 1) : k === 'power' ? powerOf(st, { o, lv: 1 }) : k === 'werft' ? (ort.k === 'star' ? 0 : 1) : 0;
    if (v > val) { val = v; best = o; }
  });
  return best;
}

// ---------- Aufträge der Bauer ----------

/** Auftragsarten in der Warteschlange eines Bauers. */
export const ITEMS = ['move', 'build', 'up', 'raze', 'cons', 'consup', 'consraze'];
/** Gründe, warum ein Auftrag wartet (u.wait). */
export const WAITS = ['matter', 'ort', 'slots', 'none', 'busy'];

/**
 * Ist ein Auftrag für einen Bauer am Stern st gültig aufgebaut? (Nur die Form; ob er gerade ausführbar ist,
 * entscheidet startItem.)
 *   { a: 'move', o } · { a: 'build' | 'up' | 'raze', k } · { a: 'cons' } · { a: 'consup' | 'consraze', id }
 */
export function itemValid(it, st) {
  if (!it || typeof it !== 'object' || !ITEMS.includes(it.a)) return false;
  const keys = Object.keys(it).sort().join();
  if (it.a === 'move') return keys === 'a,o' && Number.isInteger(it.o) && it.o >= 0 && it.o < st.orte.length;
  if (it.a === 'build' || it.a === 'raze') return keys === 'a,k' && Object.prototype.hasOwnProperty.call(BUILD, it.k);
  if (it.a === 'up') return keys === 'a,k' && Object.prototype.hasOwnProperty.call(BUILD, it.k) && BUILD[it.k].up !== null;
  if (it.a === 'cons') return keys === 'a';
  return keys === 'a,id' && Number.isInteger(it.id) && it.id > 0;
}

/** Laufende Ausbauten von Gebäude k an Ort o (damit zwei Bauer nicht dasselbe Gebäude ausbauen). */
const upsAt = (s, k, o) => S.units.filter(u => u.s === s && u.job && u.job.a === 'up' && u.job.k === k && u.job.o === o).length;

/**
 * Beginnt den ersten Auftrag der Warteschlange von u, wenn möglich. Kosten werden beim Beginn bezahlt.
 * Geht es nicht (Materie, Platz …), bleibt er stehen und u.wait nennt den Grund.
 */
function startItem(u, sys) {
  const st = star(sys.s), it = u.q[0];
  const pay = c => { if (sys.m + EPS < c) { u.wait = 'matter'; return false; } sys.m = Math.max(0, sys.m - c); return true; };
  const done = () => { u.q.shift(); delete u.wait; };
  if (it.a === 'move') {
    if (it.o !== u.o) u.mv = { o: it.o, t: moveTime(st, u.o, it.o) };
    return done();
  }
  if (it.a === 'build') {
    const r = canBuildAt(sys, it.k, u.o);
    if (r) { u.wait = r; return; }
    if (!pay(BUILD[it.k].cost)) return;
    u.job = { a: 'build', k: it.k, o: u.o, left: BUILD[it.k].time };
    return done();
  }
  if (it.a === 'up') {
    const n = sys.b.filter(b => b.k === it.k && b.o === u.o && b.lv === 1).length;
    if (n <= upsAt(sys.s, it.k, u.o)) { u.wait = 'none'; return; }
    if (!pay(BUILD[it.k].up)) return;
    u.job = { a: 'up', k: it.k, o: u.o, left: BUILD[it.k].time };
    return done();
  }
  if (it.a === 'raze') {
    // Abriss sofort; zuerst ein Gebäude, das gerade nicht ausgebaut wird (das mit der niedrigsten Stufe)
    const list = sys.b.filter(b => b.k === it.k && b.o === u.o).sort((a, b) => a.lv - b.lv);
    const b = list.find(x => x.lv > 1 || list.filter(y => y.lv === 1).length > upsAt(sys.s, it.k, u.o)) || null;
    if (!b) { u.wait = 'none'; return; }
    sys.m += RAZE_BACK * (BUILD[it.k].cost + (b.lv > 1 ? BUILD[it.k].up : 0));
    sys.b.splice(sys.b.indexOf(b), 1);
    if (S.me === sys.s) log(`${BUILD[it.k].n} abgerissen (${ortName(sys.s, u.o)}).`);
    return done();
  }
  if (it.a === 'cons') {
    if (!pay(CONS.cost)) return;
    u.job = { a: 'cons', o: u.o, left: CONS.time };
    return done();
  }
  // consup / consraze: ein Konstruktor am selben Ort
  const t = S.units.find(x => x.id === it.id && x.k === 'cons' && x.s === sys.s && x.o === u.o && x !== u);
  if (!t || (it.a === 'consup' && t.lv > 1)) { u.wait = 'none'; return; }
  if (it.a === 'consup') {
    if (!pay(CONS.up)) return;
    u.job = { a: 'consup', id: t.id, o: u.o, left: CONS.time };
    return done();
  }
  if (t.job || t.mv) { u.wait = 'busy'; return; }
  sys.m += RAZE_BACK * (CONS.cost + (t.lv > 1 ? CONS.up : 0));
  S.units.splice(S.units.indexOf(t), 1);
  return done();
}

/** Schließt den Auftrag von u ab. */
function finishJob(u, sys) {
  const j = u.job, here = S.me === sys.s;
  if (j.a === 'build') sys.b.push({ k: j.k, o: j.o, lv: 1 });
  else if (j.a === 'up') { const b = sys.b.find(x => x.k === j.k && x.o === j.o && x.lv === 1); if (b) b.lv = 2; }
  else if (j.a === 'cons') S.units.push({ id: S.nextId++, k: 'cons', s: sys.s, o: j.o, lv: 1, q: [], job: null, mv: null });
  else if (j.a === 'consup') { const t = S.units.find(x => x.id === j.id); if (t) t.lv = 2; }
  if (here) log(`Fertig: ${j.a === 'cons' ? 'Konstruktor' : j.a === 'consup' ? 'Konstruktor Stufe II' : BUILD[j.k].n + (j.a === 'up' ? ' Stufe II' : '')} (${ortName(sys.s, j.o)}).`);
  u.job = null;
}

/** Ein Bauer über dt Jahre: reisen, sonst Auftrag beginnen bzw. fortsetzen. */
function stepUnit(u, sys, dt) {
  if (u.mv) {
    u.mv.t -= dt;
    if (u.mv.t <= EPS) { u.o = u.mv.o; u.mv = null; idleCheck(u); }
    return;
  }
  if (!u.job && u.q.length) startItem(u, sys);
  if (!u.job) return;
  u.job.left -= speedOf(u) * dt;
  if (u.job.left <= EPS) { finishJob(u, sys); idleCheck(u); }
}

/** An der aktiven Front hält ein Bauer, der nichts mehr zu tun hat, die Zeit an: Er wartet auf eine Entscheidung. */
function idleCheck(u) {
  if (S.me === u.s && !u.q.length && !u.job && !u.mv) event(`${u.k === 'copy' ? 'Sonde' : 'Konstruktor'} frei (${ortName(u.s, u.o)})`);
}

// ---------- Befehle des Spielers (nur an der aktiven Front) ----------

/**
 * Hängt einen Auftrag an die Warteschlange eines Bauers der aktiven Front.
 * @returns {''|'fern'|'voll'|'ungültig'} '' = angenommen
 */
export function order(uid, item) {
  const u = S.units.find(x => x.id === uid);
  if (!u || S.me === null || u.s !== S.me) return 'fern';
  if (u.q.length >= QUEUE_MAX) return 'voll';
  if (!itemValid(item, star(u.s))) return 'ungültig';
  u.q.push({ ...item });
  return '';
}

/** Entfernt Auftrag i aus der Warteschlange eines Bauers der aktiven Front. */
export function unorder(uid, i) {
  const u = S.units.find(x => x.id === uid);
  if (!u || u.s !== S.me || !u.q[i]) return false;
  u.q.splice(i, 1); if (!i) delete u.wait;
  return true;
}

/**
 * Gibt in der aktiven Front eine Sonde bei der Werft in Auftrag.
 * @returns {''|'fern'|'werft'|'voll'}
 */
export function orderProbe() {
  const sys = S.me !== null && sysOf(S.me);
  if (!sys) return 'fern';
  if (!sys.b.some(b => b.k === 'werft')) return 'werft';
  if (sys.pq >= PROBE.queue) return 'voll';
  sys.pq++;
  return '';
}

/** Verlustrisiko einer jetzt startenden Sonde: PROBE.risk je anderer Sonde, die gerade fliegt. */
export const launchRisk = () => Math.min(1, PROBE.risk * S.probes.length);

/** Ist Stern t ein mögliches Sondenziel (kein System, keine Sonde dorthin unterwegs)? */
export const targetFree = t => !sysOf(t) && !S.probes.some(p => p.to === t);

/** Startet eine fertige Sonde aus System sys zu Stern to mit Saatpaket seed ('mine' | 'power'). */
function launch(sys, to, seed) {
  const risk = launchRisk();
  const from = star(sys.s), dest = star(to);
  sys.ready--;
  S.probes.push({ id: S.nextId++, from: sys.s, to, at: S.year + dist(from, dest) / PROBE.v, seed, two: sys.b.some(b => b.k === 'werft' && b.lv > 1), risk });
  if (S.me === sys.s) log(`Sonde startet nach ${dest.name} (${(dist(from, dest) / PROBE.v).toFixed(0)} Jahre, Verlustrisiko ${Math.round(risk * 100)} %).`);
}

/**
 * Startet eine fertige Sonde der aktiven Front.
 * @returns {''|'fern'|'keine'|'ziel'|'saat'}
 */
export function launchProbe(to, seed) {
  const sys = S.me !== null && sysOf(S.me);
  if (!sys) return 'fern';
  if (sys.ready < 1) return 'keine';
  if (!Number.isInteger(to) || !star(to) || !targetFree(to)) return 'ziel';
  if (seed !== 'mine' && seed !== 'power') return 'saat';
  launch(sys, to, seed);
  return '';
}

/**
 * Sprung als Signal: von der aktiven Front zu System to; beide brauchen einen Sender. Dauert die Entfernung
 * in Jahren; währenddessen gibt es keine aktive Front.
 * @returns {''|'unterwegs'|'ziel'|'sender'}
 */
export function jump(to) {
  if (S.me === null) return 'unterwegs';
  const a = sysOf(S.me), b = sysOf(to);
  if (!b || to === S.me) return 'ziel';
  if (!a.b.some(x => x.k === 'sender') || !b.b.some(x => x.k === 'sender')) return 'sender';
  const d = dist(star(S.me), star(to));
  log(`Sprung nach ${star(to).name}: ${d.toFixed(1)} Jahre unterwegs.`);
  S.jump = { to, at: S.year + d };
  S.me = null;
  return '';
}

// ---------- Ferne Fronten: feste Regel (#6) ----------

/** Anzahl Gebäude k im System, mitgezählt laufende Bauaufträge. */
const countK = (sys, k) => sys.b.filter(b => b.k === k).length
  + S.units.filter(u => u.s === sys.s && u.job && u.job.a === 'build' && u.job.k === k).length;

/**
 * Feste Regel einer fernen Front (#6): 1. Mine am besten Ort, 2. Sender, 3. Wirtschaft bis zur Reproduktion
 * (Kraftwerke nach Bedarf, Minen, Werft), 4. Minen ausbauen. Vor jedem Verbraucher sorgt sie für genug
 * Energie. Liefert die nächsten Aufträge für Bauer u (leer = nichts mehr zu tun), ohne etwas zu ändern: Ferne
 * Fronten hängen sie an die Warteschlange der Kopie, der Bot gibt sie als Befehle (tools/bot.mjs).
 * @returns {object[]} Aufträge, z. B. [{ a: 'move', o: 5 }, { a: 'build', k: 'mine' }]
 */
export function frontPlan(sys, u) {
  const want = k => {
    const e = energy(sys);
    if (BUILD[k].need && e.gen < e.need + BUILD[k].need && k !== 'power' && bestOrt(sys, 'power') >= 0) k = 'power';
    const o = bestOrt(sys, k);
    if (o < 0) return null;
    return [...(o !== u.o ? [{ a: 'move', o }] : []), { a: 'build', k }];
  };
  let p;
  if (!countK(sys, 'mine') && (p = want('mine'))) return p;
  if (!countK(sys, 'sender') && (p = want('sender'))) return p;
  if (countK(sys, 'mine') < 3 && (p = want('mine'))) return p;
  if (!countK(sys, 'werft') && (p = want('werft'))) return p;
  if (countK(sys, 'mine') < 5 && (p = want('mine'))) return p;
  const b = sys.b.find(x => x.k === 'mine' && x.lv === 1);
  return b ? [...(b.o !== u.o ? [{ a: 'move', o: b.o }] : []), { a: 'up', k: 'mine' }] : [];
}

/** Ferne Front: Sonde in Auftrag geben, sobald Werft und Materie da sind; fertige Sonden zum nächsten freien Stern. */
function frontProbes(sys) {
  if (!sys.pq && sys.pj === null && !sys.ready && sys.b.some(b => b.k === 'werft') && sys.m >= PROBE.cost) sys.pq = 1;
  if (sys.ready < 1 || launchRisk() > FRONT_RISK_MAX + EPS) return;
  const here = star(sys.s);
  let best = -1, bd = Infinity;
  for (const t of stars()) if (targetFree(t.i)) { const d = dist(here, t); if (d < bd) { bd = d; best = t.i; } }
  if (best >= 0) launch(sys, best, 'mine');
}

// ---------- Ankunft, Nachrichten, Berichte ----------

/** Schickt eine Nachricht aus System s mit Lichtgeschwindigkeit zum Spieler. */
function mail(k, s, d) {
  S.mail.push({ at: S.year + dist(star(s), viewer()), k, s, ...(d ? { d } : {}) });
}

/**
 * Eine Sonde kommt an: mit ihrem Verlustrisiko verloren, sonst neues System mit Saatpaket (Gebäude am besten
 * Ort, PROBE.seedM Materie) und der Sonde als Kopie. Die Nachricht reist mit c zum Spieler.
 */
function arrive(p) {
  if (rand() < p.risk) { mail('lost', p.to); return; }
  const sys = { s: p.to, m: PROBE.seedM, b: [], pq: 0, pj: null, ready: 0 };
  S.sys.push(sys);
  let at = 0;
  for (const k of p.two ? [p.seed, p.seed === 'mine' ? 'power' : 'mine'] : [p.seed]) {
    const o = bestOrt(sys, k);
    if (o >= 0) { sys.b.push({ k, o, lv: 1 }); if (k === p.seed) at = o; }
  }
  S.units.push({ id: S.nextId++, k: 'copy', s: p.to, o: at, lv: 1, q: [], job: null, mv: null });
  mail('arrive', p.to);
}

/** Bericht eines Systems: Jahr, Lager, Gebäude je Art, Konstruktoren, fertige Sonden. */
function report(sys) {
  const b = {};
  for (const x of sys.b) b[x.k] = (b[x.k] || 0) + 1;
  return { y: S.year, m: Math.round(sys.m), b, cons: S.units.filter(u => u.s === sys.s && u.k === 'cons').length, ready: sys.ready };
}

/** Stellt angekommene Nachrichten zu: Funde, Verluste (beide halten an) und Berichte. */
function deliver() {
  const due = S.mail.filter(x => x.at <= S.year + EPS).sort((a, b) => a.at - b.at);
  if (!due.length) return;
  S.mail = S.mail.filter(x => x.at > S.year + EPS);
  for (const x of due) {
    const name = star(x.s).name;
    if (x.k === 'arrive') {
      if (!S.known.includes(x.s)) S.known.push(x.s);
      log(`Sonde angekommen: ${name}.`, 'good'); event(`Sonde angekommen: ${name}`);
    } else if (x.k === 'lost') {
      log(`Sonde nach ${name} verloren.`, 'warn'); event(`Sonde verloren: ${name}`);
    } else {
      const i = S.rep.findIndex(r => r.s === x.s);
      if (i < 0) S.rep.push({ s: x.s, ...x.d }); else if (S.rep[i].y < x.d.y) S.rep[i] = { s: x.s, ...x.d };
    }
  }
}

// ---------- Simulationsschritt ----------

/**
 * Ein Simulationsschritt über dt Spieljahre (clock.js ruft ihn mit höchstens einem Monat auf):
 * Wirtschaft und Werften, Bauer (ferne Fronten planen vorher), Sonden, Sprung, Berichte, Nachrichten.
 */
export function step(dt) {
  S.year += dt;
  for (const sys of S.sys) {
    const e = energy(sys);
    sys.m += income(sys, e.f) * dt;
    const w = sys.b.filter(b => b.k === 'werft').length;
    if (w && sys.pq > 0) {
      if (sys.pj === null && sys.m + EPS >= PROBE.cost) { sys.m = Math.max(0, sys.m - PROBE.cost); sys.pj = PROBE.time; }
      if (sys.pj !== null) {
        sys.pj -= w * e.f * dt;
        if (sys.pj <= EPS) { sys.pj = null; sys.pq--; sys.ready++; if (S.me === sys.s) { log('Sonde bereit.', 'good'); event('Sonde bereit'); } }
      }
    }
  }
  for (const u of [...S.units]) {
    if (!S.units.includes(u)) continue;   // im selben Schritt abgerissen
    const sys = sysOf(u.s);
    if (u.k === 'copy' && u.s !== S.me && !u.q.length && !u.job && !u.mv) u.q.push(...frontPlan(sys, u));
    stepUnit(u, sys, dt);
  }
  for (const sys of S.sys) if (sys.s !== S.me) frontProbes(sys);
  for (const p of S.probes.filter(x => x.at <= S.year + EPS).sort((a, b) => a.at - b.at)) {
    S.probes.splice(S.probes.indexOf(p), 1);
    arrive(p);
  }
  if (S.jump && S.jump.at <= S.year + EPS) {
    S.me = S.jump.to; S.jump = null;
    if (!S.known.includes(S.me)) S.known.push(S.me);
    log(`Angekommen in ${star(S.me).name}.`, 'good'); event(`Angekommen in ${star(S.me).name}`);
  }
  while (S.year + EPS >= S.nextRep) {
    for (const sys of S.sys) if (sys.s !== S.me) mail('rep', sys.s, report(sys));
    S.nextRep++;
  }
  deliver();
}
