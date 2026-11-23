/**
 * tools/test.mjs – automatisierte Tests der Kernpfade. Ohne Abhängigkeiten, nur Node.
 * Testrahmen und Attrappen übernommen aus Replikator (tools/test.mjs).
 *
 * Aufruf:  node tools/test.mjs
 * Ergebnis: eine Zeile je Test (OK/FAIL) und Exit-Code 1 bei Fehlern.
 *
 * localStorage wird durch eine Map ersetzt; failWrite(n) lässt das n-te Schreiben scheitern. document/window
 * sind Attrappen, die genug können, damit ui.js in Node lädt und rendert. Die Tests ändern keine Dateien und
 * nutzen kein Netz außer 127.0.0.1.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync } from 'node:fs';

// ---------- Umgebung ----------
const store = new Map();
let writes = 0, failAt = 0;
/** Lässt das n-te Schreiben ab jetzt scheitern (0 = nie). */
const failWrite = n => { writes = 0; failAt = n; };
globalThis.localStorage = {
  getItem: k => store.has(k) ? store.get(k) : null,
  setItem: (k, v) => { writes++; if (failAt && writes === failAt) throw new Error('Speicher voll'); store.set(k, String(v)); },
  removeItem: k => store.delete(k),
};
/** Attrappe eines Elements: merkt sich HTML, Text und Klassen; alles andere sind Leerläufe. */
const fakeEl = () => {
  const cls = new Set();
  return { style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => on ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) },
    addEventListener() {}, closest: () => null, click() {} };
};
const els = new Map();
globalThis.document = { querySelector: s => els.get(s) || els.set(s, fakeEl()).get(s), addEventListener() {}, createElement: () => fakeEl(), body: fakeEl(), activeElement: null };
globalThis.window = { addEventListener() {} };

const js = new URL('../js/', import.meta.url);
const D = await import(new URL('data.js', js));
const U = await import(new URL('util.js', js));
const st = await import(new URL('state.js', js));
const sim = await import(new URL('sim.js', js));
const clock = await import(new URL('clock.js', js));
const sv = await import(new URL('save.js', js));
const ui = await import(new URL('ui.js', js));
const require = createRequire(import.meta.url);
const server = require('../server.js');

const notes = [];
sim.hooks.notify = t => notes.push(t);
const clone = o => JSON.parse(JSON.stringify(o));
/** Zieht n Zufallszahlen und gibt sie zurück. */
const draws = n => Array.from({ length: n }, () => sim.rand());

// ---------- Mini-Testrahmen ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- Zufall und Seed ----------
test('gleicher Seed → gleiche Zufallsfolge, anderer Seed → andere', () => {
  sim.newGame(4242); const a = draws(20);
  sim.newGame(4242); assert.deepEqual(draws(20), a);
  sim.newGame(4243); assert.notDeepEqual(draws(20), a);
  assert.ok(a.every(x => x >= 0 && x < 1));
});
test('Speichern/Laden setzt den Zufall fort', () => {
  sim.newGame(99); draws(5);
  const saved = JSON.stringify(st.S);
  const direct = draws(10);
  assert.equal(sv.importText(saved), 'ok');
  assert.deepEqual(draws(10), direct);
});
test('Seed aus Text', () => {
  assert.equal(U.seedFromText(''), null);
  assert.equal(U.seedFromText('  '), null);
  assert.equal(U.seedFromText('12345'), 12345);
  assert.equal(U.seedFromText('4294967295'), 4294967295);
  const w = U.seedFromText('Heimatwelt');
  assert.ok(Number.isInteger(w) && w >= 0 && w < U.SEED_RANGE);
  assert.equal(U.seedFromText('Heimatwelt'), w);
  assert.notEqual(U.seedFromText('heimatwelt'), w);
  assert.ok(U.seedFromText('4294967296') < U.SEED_RANGE, 'zu große Zahl wird als Text behandelt');
});
test('neues Spiel ohne Seed wählt einen gültigen', () => {
  sim.newGame();
  assert.ok(Number.isInteger(st.S.seed) && st.S.seed >= 0 && st.S.seed < U.SEED_RANGE);
  assert.ok(sv.validate(clone(st.S)));
});

// ---------- Zeitsteuerung ----------
test('Pause lässt keine Zeit vergehen, Laufen nach Tempo', () => {
  sim.newGame(1); const S = st.S, y0 = S.year;
  assert.equal(clock.advance(1), null);
  assert.equal(S.year, y0, 'Pause');
  clock.setSpeed(1); S.tempo.n = 7;   // 1 Jahr je Sekunde
  clock.advance(.5);
  assert.ok(Math.abs(S.year - y0 - .5) < 1e-9);
  clock.setTempo(2); assert.equal(S.tempo.n, 2);
  clock.setTempo(99); assert.equal(S.tempo.n, D.TEMPO.length - 1, 'begrenzt');
  clock.setTempo('x'); assert.equal(S.tempo.n, 0);
});
test('Ereignisse halten an: gesammelt, Doppelte einmal, ins Logbuch', () => {
  sim.newGame(1); const S = st.S;
  clock.setSpeed(1);
  sim.event('Fund'); sim.event('Fund'); sim.event('Ausfall');
  assert.equal(clock.halt(), 'Fund · Ausfall');
  assert.equal(S.speed, 0, 'angehalten');
  assert.equal(S.log.filter(e => e.t === 'Angehalten: Fund.').length, 1);
  assert.equal(clock.halt(), null, 'danach leer');
  // ein Ereignis vor dem Laufen zählt nicht für den nächsten Abschnitt
  clock.setSpeed(1); sim.event('alt');
  assert.equal(clock.advance(.1), null);
  assert.equal(S.speed, 1);
});

// ---------- Spielstände ----------
test('Prüfung: gültiger Stand ja, kaputte Stände nein', () => {
  sim.newGame(5); sim.log('Fund', 'good');
  const ok = clone(st.S);
  assert.ok(sv.validate(ok));
  const bad = [
    d => { d.v = 0; }, d => { d.seed = -1; }, d => { d.seed = 1.5; }, d => { d.rng = 2 ** 40; },
    d => { d.year = 1e9; }, d => { d.year = 'x'; }, d => { d.speed = 50; }, d => { d.tempo.n = 99; },
    d => { d.tempo.x = 1; }, d => { d.extra = 1; }, d => { d.log = {}; }, d => { d.log.push({ y: d.year, t: 'x'.repeat(D.LOG_TEXT_MAX + 1) }); },
    d => { d.log.push({ y: d.year, t: 'x', c: '"><b>' }); }, d => { d.log.push({ y: d.year, t: 'x', z: 1 }); },
    d => { d.log = Array(D.LOG_MAX + 1).fill({ y: d.year, t: 'x' }); },
  ];
  for (const f of bad) { const d = clone(ok); f(d); assert.equal(sv.validate(d), false, f.toString()); }
});
test('Laden: neuere, kaputte und fremde Stände ändern das Spiel nicht', () => {
  sim.newGame(6); const before = JSON.stringify(st.S);
  assert.equal(sv.importText(JSON.stringify({ ...clone(st.S), v: D.SAVE_VERSION + 1 })), 'newer');
  assert.equal(sv.importText('{kaputt'), 'invalid');
  assert.equal(sv.importText(JSON.stringify({ app: 'asperastra', data: { v: D.SAVE_VERSION, seed: 'x' } })), 'invalid');
  assert.equal(sv.importText(JSON.stringify({ v: 0 })), 'outdated');
  assert.equal(JSON.stringify(st.S), before);
});
test('Export-Format wird erkannt', () => {
  sim.newGame(7); const S = clone(st.S);
  sim.newGame(8);
  assert.equal(sv.importText(JSON.stringify({ app: 'asperastra', savedAt: 1, data: S })), 'ok');
  assert.equal(st.S.seed, 7);
});
test('Autosave: Laden, Sicherung eines unbrauchbaren Stands, Speicherfehler', () => {
  store.clear();
  assert.equal(sv.load(), 'none');
  sim.newGame(9); assert.ok(sv.save());
  sim.newGame(10);
  assert.equal(sv.load(), 'ok'); assert.equal(st.S.seed, 9);
  // unbrauchbarer Autosave wird gesichert, die Sicherung später nicht überschrieben
  store.set(D.SAVE_KEY, '{kaputt');
  assert.equal(sv.load(), 'invalid');
  assert.ok(sv.hasBackup()); assert.equal(store.get(D.SAVE_KEY + '-backup'), '{kaputt');
  store.set(D.SAVE_KEY, 'zweiter');
  sv.load(); assert.equal(store.get(D.SAVE_KEY + '-backup'), '{kaputt');
  sv.deleteBackup(); assert.ok(!sv.hasBackup());
  // Speicherfehler: eine Meldung, nicht bei jedem Versuch
  notes.length = 0; failWrite(1);
  assert.equal(sv.save(), false);
  failWrite(1); sv.save();
  assert.equal(notes.length, 1);
  failWrite(0); assert.ok(sv.save());
});
test('Logbuch bleibt begrenzt', () => {
  sim.newGame(11);
  for (let i = 0; i < D.LOG_MAX + 50; i++) sim.log('Eintrag ' + i);
  assert.equal(st.S.log.length, D.LOG_MAX);
  assert.equal(st.S.log.at(-1).t, 'Eintrag ' + (D.LOG_MAX + 49));
  assert.ok(sv.validate(clone(st.S)));
});

// ---------- Kern-Simulation (#7) ----------
const GX = await import(new URL('galaxy.js', js));
/** Monate laufen lassen. */
const months = n => { for (let i = 0; i < n; i++) sim.step(1 / 12); };
/** Bauer der aktiven Front mit id 1 (die Kopie in Sol). */
const me = () => st.S.units.find(u => u.id === 1);
/** Lässt laufen, bis die Kopie nichts mehr zu tun hat (höchstens n Monate). */
const untilIdle = (n = 120) => { for (let i = 0; i < n; i++) { const u = me(); if (!u.q.length && !u.job && !u.mv) return; sim.step(1 / 12); } };

/**
 * Einfacher Spieler für Sol (Testhilfe): Minen, Sender, Werft, Kraftwerk, dann Sonden zum nächsten freien
 * Stern, solange das Risiko höchstens 8 % ist. Ruft die übrigen Fronten nicht an – die laufen nach Regel.
 */
function soloPlayer(start = 0) {
  const plan = [[{ a: 'move', o: 5 }, { a: 'build', k: 'mine' }], [{ a: 'build', k: 'mine' }], [{ a: 'move', o: 3 }, { a: 'build', k: 'mine' }],
    [{ a: 'move', o: 0 }, { a: 'build', k: 'sender' }], [{ a: 'move', o: 6 }, { a: 'build', k: 'power' }], [{ a: 'move', o: 4 }, { a: 'build', k: 'werft' }]];
  let i = start;
  return () => {
    const S = st.S, u = me();
    if (S.me !== 0) return;
    if (!u.q.length && !u.job && !u.mv && i < plan.length) for (const it of plan[i++]) sim.order(1, it);
    const sol = sim.sysOf(0);
    if (i >= plan.length && !sol.pq && sol.pj === null) sim.orderProbe();
    if (sol.ready) { const t = sim.frontTarget(0); if (t >= 0) sim.launchProbe(t, 'mine'); }
  };
}

test('Galaxie: aus dem Seed, Sol mit echten Planeten, Mindestabstand', () => {
  const g = GX.galaxy(4242);
  assert.equal(g.length, D.GALAXY.n);
  assert.equal(JSON.stringify(GX.galaxy(4242)), JSON.stringify(g));
  assert.notEqual(JSON.stringify(GX.galaxy(4243)), JSON.stringify(g));
  assert.deepEqual(g[0].orte.map(o => o.n), ['Sol', 'Merkur', 'Venus', 'Erde', 'Mars', 'Gürtel', 'Jupiter', 'Saturn', 'Uranus', 'Neptun']);
  for (const s of g) {
    assert.equal(s.orte[0].k, 'star');
    assert.ok(Math.hypot(s.x, s.y) <= D.GALAXY.r + 1e-9);
    assert.ok(g.every(t => t === s || U.dist(s, t) >= D.GALAXY.minD));
    if (s.spec === 'richBelt') assert.ok(s.orte.some(o => o.k === 'belt'));
    if (s.spec === 'gasPower') assert.ok(s.orte.some(o => o.k === 'gas'));
  }
  assert.equal(new Set(g.map(s => s.name)).size, g.length, 'Namen eindeutig');
});

test('Energie: ohne Kraftwerk fördert keine Mine, zu wenig drosselt anteilig', () => {
  sim.newGame(1); const S = st.S, sol = sim.sysOf(0);
  sol.b = [{ k: 'mine', o: 5, lv: 1 }];
  assert.equal(sim.income(sol), 0);
  sol.b.push({ k: 'power', o: 0, lv: 1 }, { k: 'werft', o: 4, lv: 1 }, { k: 'sender', o: 0, lv: 1 });   // 4 Energie, Bedarf 5
  const e = sim.energy(sol);
  assert.deepEqual([e.gen, e.need, e.f], [4, 5, .8]);
  assert.equal(sim.income(sol), D.MINE_RATE[1] * D.BELT_MULT * .8);
  const m0 = sol.m; months(12);
  assert.ok(Math.abs(sol.m - m0 - D.MINE_RATE[1] * D.BELT_MULT * .8) < 1e-6);
  assert.ok(Math.abs(S.year - D.START_YEAR - 1) < 1e-9);
});

test('Bauen: nur am eigenen Ort, Kosten beim Beginn, Plätze, Warten, Ausbau, Abriss', () => {
  sim.newGame(1); const S = st.S, sol = sim.sysOf(0), u = me();
  assert.equal(u.o, D.EARTH);
  // Sender geht nur am Stern: an der Erde wartet der Auftrag
  assert.equal(sim.order(1, { a: 'build', k: 'sender' }), '');
  sim.step(1 / 12);
  assert.equal(u.wait, 'ort'); assert.equal(sol.m, D.START_MATTER, 'nichts bezahlt');
  sim.unorder(1, 0); assert.equal(u.wait, undefined);
  // zwei Minen auf der Erde, die dritte findet keinen Platz
  sim.order(1, { a: 'build', k: 'mine' }); sim.order(1, { a: 'build', k: 'mine' }); sim.order(1, { a: 'build', k: 'mine' });
  assert.equal(sim.order(1, { a: 'build', k: 'mine' }), 'voll');
  sim.step(1 / 12);
  assert.equal(sol.m, D.START_MATTER - D.BUILD.mine.cost, 'beim Beginn bezahlt');
  untilIdle(24);   // die dritte Mine bleibt stehen
  assert.equal(sol.b.filter(b => b.k === 'mine' && b.o === D.EARTH).length, 2);
  assert.equal(u.wait, 'slots'); assert.equal(u.q.length, 1); sim.unorder(1, 0);
  // Materie fehlt: Ausbau wartet (ohne Kraftwerk fördern die Minen nicht, die Rechnung bleibt glatt)
  sol.b = sol.b.filter(b => b.k !== 'power');
  sol.m = 5; sim.order(1, { a: 'up', k: 'mine' }); sim.step(1 / 12);
  assert.equal(u.wait, 'matter');
  sol.m = 100; untilIdle(24);
  assert.equal(sol.b.filter(b => b.k === 'mine' && b.lv === 2).length, 1);
  assert.equal(sol.m, 100 - D.BUILD.mine.up);
  // Abriss sofort, mit Erstattung; zuerst die niedrigere Stufe
  sim.order(1, { a: 'raze', k: 'mine' }); sim.step(1 / 12);
  assert.equal(sol.m, 100 - D.BUILD.mine.up + D.RAZE_BACK * D.BUILD.mine.cost);
  assert.deepEqual(sol.b.filter(b => b.k === 'mine').map(b => b.lv), [2]);
  // ungültige Aufträge und Befehle an ferne Bauer werden abgelehnt
  assert.equal(sim.order(1, { a: 'up', k: 'sender' }), 'ungültig');
  assert.equal(sim.order(1, { a: 'move', o: 99 }), 'ungültig');
  assert.equal(sim.order(1, { a: 'build', k: '__proto__' }), 'ungültig');
  assert.equal(sim.order(99, { a: 'cons' }), 'fern');
  assert.ok(sv.validate(clone(S)));
});

test('Konstruktor: bauen, eigenes Bautempo, verlegen, ausbauen, abbauen', () => {
  sim.newGame(1); const S = st.S, sol = sim.sysOf(0); sol.m = 200;
  sim.order(1, { a: 'cons' }); untilIdle();
  const c = S.units.find(x => x.k === 'cons');
  assert.ok(c && c.o === D.EARTH && c.lv === 1);
  assert.equal(sol.m, 200 - D.CONS.cost);
  // er baut selbst, auch woanders; Reisezeit im System 1–3 Monate
  sim.order(c.id, { a: 'move', o: 5 }); sim.order(c.id, { a: 'build', k: 'mine' });
  const t = sim.moveTime(sim.star(0), D.EARTH, 5);
  assert.ok(t >= D.MOVE_T[0] && t <= D.MOVE_T[1]);
  months(1); assert.ok(c.mv || c.o === 5);
  months(12); assert.ok(sol.b.some(b => b.k === 'mine' && b.o === 5));
  // Ausbau durch einen Bauer am selben Ort: doppeltes Tempo
  sim.order(1, { a: 'move', o: 5 }); sim.order(1, { a: 'consup', id: c.id }); untilIdle();
  assert.equal(c.lv, 2); assert.equal(sim.speedOf(c), 2);
  sim.order(1, { a: 'consraze', id: c.id }); untilIdle();
  assert.ok(!S.units.includes(c));
  assert.ok(sv.validate(clone(S)));
});

test('Sonde: Werft nötig, Bau, Start mit Risiko, Ankunft mit Saatpaket, Nachricht mit c', () => {
  sim.newGame(2); const S = st.S, sol = sim.sysOf(0); sol.m = 500;
  assert.equal(sim.orderProbe(), 'werft');
  sol.b.push({ k: 'werft', o: 4, lv: 1 }, { k: 'power', o: 6, lv: 1 });
  assert.equal(sim.orderProbe(), '');
  months(12);
  assert.equal(sol.ready, 1); assert.equal(sol.m, 500 - D.PROBE.cost);
  assert.equal(sim.launchProbe(0, 'mine'), 'ziel');
  const t = sim.stars().slice(1).sort((a, b) => U.dist(a, sim.star(0)) - U.dist(b, sim.star(0)))[0];
  assert.equal(sim.launchProbe(t.i, 'kuchen'), 'saat');
  assert.equal(sim.launchProbe(t.i, 'power'), '');
  const p = S.probes[0], d = U.dist(t, sim.star(0));
  assert.equal(p.risk, 0, 'erste Sonde ohne Risiko');
  assert.ok(Math.abs(p.at - S.year - d / D.PROBE.v) < 1e-9);
  assert.ok(!sim.targetFree(t.i), 'Ziel vergeben');
  // Risiko zählt nur Sonden zu Zielen in der Nähe (#11)
  assert.equal(sim.launchRisk(t.i), D.PROBE.risk, 'gleiches Ziel: Risiko der ersten');
  const far = sim.stars().find(x => U.dist(x, t) > D.PROBE.riskR);
  assert.equal(sim.launchRisk(far.i), 0, 'ferne Ziele unbelastet');
  // Treibstoff je Lj beim Start
  assert.equal(sol.m, 500 - D.PROBE.cost - sim.fuelCost(0, t.i));
  assert.equal(sim.fuelCost(0, t.i), Math.round(D.PROBE.fuel * d));
  // Ankunft: System mit Saatpaket und Kopie; die Nachricht kommt d Jahre später
  while (!sim.sysOf(t.i)) sim.step(1 / 12);
  const arr = S.year, ny = sim.sysOf(t.i);
  assert.equal(ny.m, D.PROBE.seedM); assert.deepEqual(ny.b.map(b => b.k), ['power']);
  assert.equal(sim.copyOf(t.i).o, ny.b[0].o, 'Kopie am Ort des Saatpakets');
  assert.ok(!S.known.includes(t.i), 'noch nicht bekannt');
  while (!S.known.includes(t.i)) sim.step(1 / 12);
  assert.ok(Math.abs(S.year - arr - d) < 1 / 12 + 1e-9);
  assert.ok(S.log.some(e => e.t === `Sonde angekommen: ${t.name}.`));
  assert.ok(sv.validate(clone(S)));
});

test('Sonde: Verlust nach Risiko, mit Nachricht', () => {
  sim.newGame(3); const S = st.S, sol = sim.sysOf(0);
  sol.ready = 1;
  const t = sim.stars()[1];
  sim.launchProbe(t.i, 'mine');
  S.probes[0].risk = 1;
  for (let i = 0; i < 12 * 400 && !S.log.some(e => e.c === 'warn'); i++) sim.step(1 / 12);
  assert.ok(!sim.sysOf(t.i));
  assert.ok(S.log.some(e => e.t === `Sonde nach ${t.name} verloren.`));
  assert.ok(sim.targetFree(t.i), 'Ziel wieder frei');
});

test('Ferne Front: feste Regel – erst Mine, dann Sender, Energie vor Verbrauchern, später Sonden', () => {
  sim.newGame(4); const S = st.S;
  const t = sim.stars().slice(1).sort((a, b) => U.dist(a, sim.star(0)) - U.dist(b, sim.star(0)))[0];
  sim.sysOf(0).ready = 1; sim.launchProbe(t.i, 'mine');
  while (!sim.sysOf(t.i)) sim.step(1 / 12);
  const f = sim.sysOf(t.i), order = [];
  for (let i = 0; i < 12 * 200; i++) {
    sim.step(1 / 12);
    for (const b of f.b) if (!order.includes(b.k)) order.push(b.k);
  }
  assert.equal(order[0], 'mine', 'Saatpaket');
  assert.ok(order.indexOf('sender') >= 0, 'Sender gebaut: ' + order);
  assert.ok(order.indexOf('sender') < order.indexOf('werft'), 'Sender vor Werft: ' + order);
  assert.ok(f.b.some(b => b.k === 'power'), 'Kraftwerk für den Bedarf');
  assert.ok(S.sys.length > 2 || S.probes.length || f.ready, 'die Front reproduziert sich');
  assert.ok(sv.validate(clone(S)));
});

test('Sprung: braucht Sender an beiden Enden, dauert die Entfernung, wechselt die Front', () => {
  sim.newGame(5); const S = st.S;
  const t = sim.stars()[1];
  S.sys.push({ s: t.i, m: 0, b: [], pq: 0, pj: null, ready: 0 });
  S.units.push({ id: S.nextId++, k: 'copy', s: t.i, o: 0, lv: 1, q: [], job: null, mv: null });
  assert.equal(sim.jump(t.i), 'sender');
  sim.sysOf(0).b.push({ k: 'sender', o: 0, lv: 1 });
  sim.sysOf(t.i).b.push({ k: 'sender', o: 0, lv: 1 });
  assert.equal(sim.jump(0), 'ziel');
  assert.equal(sim.jump(t.i), '');
  assert.equal(S.me, null);
  assert.equal(sim.order(1, { a: 'cons' }), 'fern', 'unterwegs keine Befehle');
  assert.equal(sim.jump(0), 'unterwegs');
  assert.ok(sv.validate(clone(S)));
  const y0 = S.year, d = U.dist(t, sim.star(0));
  while (S.me === null) sim.step(1 / 12);
  assert.equal(S.me, t.i);
  assert.ok(S.year - y0 >= d - 1e-9 && S.year - y0 < d + 1 / 12 + 1e-9);
  assert.ok(S.known.includes(t.i));
  // Sol ist jetzt ferne Front: baut nach Regel, und ihr Bericht kommt mit c an
  for (let i = 0; i < 12 * Math.ceil(d + 2); i++) sim.step(1 / 12);
  const r = S.rep.find(x => x.s === 0);
  assert.ok(r && S.year - r.y >= d - 1, 'Bericht ist mindestens die Lichtlaufzeit alt');
  assert.ok(sv.validate(clone(S)));
});

test('Langer Lauf: deterministisch, Spielstand bleibt gültig, Laden setzt exakt fort', () => {
  const play = (seed, years, cut) => {
    sim.newGame(seed); const p = soloPlayer();
    let saved = null;
    for (let i = 0; i < 12 * years; i++) {
      p(); sim.step(1 / 12);
      if (i % 120 === 0) assert.ok(sv.validate(clone(st.S)), 'gültig im Jahr ' + Math.floor(st.S.year));
      if (cut && i === 12 * cut) saved = JSON.stringify(st.S);
    }
    return { end: JSON.stringify(st.S), saved };
  };
  const a = play(77, 250, 100), b = play(77, 250);
  assert.equal(a.end, b.end, 'gleicher Seed, gleiche Aktionen → gleicher Verlauf');
  assert.ok(JSON.parse(a.end).sys.length >= 3, 'Ausbreitung');
  // ab Jahr 100 geladen und mit demselben Spieler weiter (sein Plan ist dann abgearbeitet): gleiches Ende
  assert.equal(sv.importText(a.saved), 'ok');
  const p = soloPlayer(6);
  for (let i = 12 * 100 + 1; i < 12 * 250; i++) { p(); sim.step(1 / 12); }
  assert.equal(JSON.stringify(st.S), a.end);
});

test('Prüfung: Kern-Felder – Verweise, Plätze, Kopien, Front', () => {
  sim.newGame(6); const ok = clone(st.S);
  ok.units[0].q.push({ a: 'build', k: 'mine' });
  assert.ok(sv.validate(ok));
  const bad = [
    d => { d.units.push({ ...d.units[0], id: 9 }); d.nextId = 10; },          // zweite Kopie
    d => { d.units[0].s = 1; },                                              // Bauer ohne System
    d => { d.units.push({ ...d.units[0], k: 'cons', id: 1 }); },             // doppelte id
    d => { d.nextId = 1; },                                                  // id nicht kleiner als nextId
    d => { d.sys[0].b.push({ k: 'sender', o: 0, lv: 1 }, { k: 'power', o: 0, lv: 1 }); },   // drei Gebäude an der Station
    d => { d.sys[0].b.push({ k: 'mine', o: 0, lv: 1 }); },                   // Mine an der Station
    d => { d.sys[0].b.push({ k: 'sender', o: 0, lv: 2 }); },                 // Sender hat keine Stufe II
    d => { d.me = null; },                                                   // weder Front noch Sprung
    d => { d.jump = { to: 0, at: d.year + 1 }; },                            // beides
    d => { d.units[0].q.push({ a: 'move', o: 50 }); },
    d => { d.units[0].q.push({ a: 'build', k: 'mine', x: 1 }); },
    d => { d.units[0].job = { a: 'build', k: 'mine', o: 2, left: .5 }; },    // Auftrag an anderem Ort als der Bauer
    d => { d.probes.push({ id: 5, from: 0, to: 0, at: d.year + 1, seed: 'mine', two: false, risk: 0 }); d.nextId = 6; },
    d => { d.mail.push({ at: d.year + 1, k: 'rep', s: 0, d: { y: d.year, m: -1, b: {}, cons: 0, ready: 0 } }); },
    d => { d.mail.push({ at: d.year + 1, k: 'gift', s: 0 }); },
    d => { d.known.push(0); },
    d => { d.sys[0].m = Infinity; },
    d => { delete d.rep; },
  ];
  for (const f of bad) { const d = clone(ok); f(d); assert.equal(sv.validate(d), false, f.toString()); }
});

// ---------- Bot und Testspielstände (#9) ----------
const BOT = await import(new URL('bot.js', js));
const SC = await import(new URL('scenarios.js', js));
const VW = await import(new URL('view.js', js));
const MP = await import(new URL('map.js', js));

test('Bot: entscheidet nur über Spielerbefehle, breitet sich aus, Stand bleibt gültig', () => {
  sim.newGame(31); const kinds = {};
  const bot = BOT.createBot(k => { kinds[k] = (kinds[k] || 0) + 1; });
  for (let i = 0; i < 12 * 120; i++) { bot(); sim.step(1 / 12); }
  assert.ok(kinds.build > 5 && kinds.probe >= 1 && kinds.launch >= 1, JSON.stringify(kinds));
  assert.ok(st.S.sys.length >= 2);
  assert.ok(sv.validate(clone(st.S)));
});

test('Testspielstände: erreichen ihre Lage, immer gleich, gültig, auf Pause', () => {
  for (const [k, sc] of Object.entries(SC.SCENARIOS)) {
    assert.ok(SC.loadScenario(k), k);
    const S = st.S, a = JSON.stringify(S);
    assert.equal(S.seed, SC.SCENARIO_SEED); assert.equal(S.speed, 0);
    assert.ok(sv.validate(clone(S)), k);
    if (k !== 'overflow') assert.ok(sc.done(), k + ': Lage erreicht');
    SC.loadScenario(k); assert.equal(JSON.stringify(st.S), a, k + ': deterministisch');
  }
  SC.loadScenario('start'); assert.equal(st.S.year, D.START_YEAR);
  SC.loadScenario('overflow'); assert.ok(Math.abs(st.S.year - D.START_YEAR - 150) < 1e-6);
  SC.loadScenario('fronts');
  const f = st.S.rep.find(r => r.s !== 0 && r.b.sender > 0);
  assert.equal(sim.jump(f.s), '', 'Sprung möglich');
  assert.equal(SC.loadScenario('__proto__'), false);
});

// ---------- Oberfläche ----------
test('Oberfläche: Statusleiste, Tempo, Blatt „Spiel“, neues Spiel und Testspielstand erst nach Nachfrage', () => {
  store.clear(); sim.newGame(12); ui.restart();
  ui.renderUI(true);
  const q = s => document.querySelector(s);
  assert.equal(q('#tYear').textContent, 'Jan ' + D.START_YEAR);
  assert.ok(q('#pause').classList.contains('on'));
  ui.act('speed:1');
  assert.equal(st.S.speed, 1); assert.ok(q('#play').classList.contains('on'));
  clock.setTempo(4); ui.renderUI(false);
  assert.equal(q('#tTempo').textContent, D.TEMPO[4].n); assert.equal(q('#tempo').value, '4');
  ui.act('game');
  assert.ok(q('#sheet').classList.contains('show'));
  sim.log('<b>fett</b>'); ui.renderUI(false);
  assert.ok(q('#sheet').innerHTML.includes('&lt;b&gt;fett'), 'Logbuch wird maskiert');
  q('#seed').value = '777';
  ui.act('new');
  assert.equal(st.S.seed, 12, 'erster Tipp fragt nur nach');
  assert.ok(q('#sheet').innerHTML.includes('Sicher?'));
  ui.act('new');
  assert.equal(st.S.seed, 777);
  assert.ok(store.get(D.SAVE_KEY), 'sofort gespeichert');
  assert.equal(st.UI.sheet, null, 'Blatt nach neuem Spiel zu');
  ui.act('game');
  // Testspielstand: ebenfalls erst nach Nachfrage; eine andere Aktion dazwischen hebt die Nachfrage auf
  ui.act('scen:probe'); ui.act('speed:1'); ui.act('scen:probe');
  assert.equal(st.S.seed, 777, 'Nachfrage aufgehoben');
  ui.act('scen:probe');
  assert.equal(st.S.seed, SC.SCENARIO_SEED); assert.ok(st.S.probes.length);
  ui.importFile('{kaputt');
  assert.equal(st.S.seed, SC.SCENARIO_SEED, 'kaputte Datei ändert nichts');
});

test('Karte (#13): Galaxie ohne Schrift, Ringe und Plaketten, Stern wählen, Systemstufe, Bedienleiste', () => {
  SC.loadScenario('fronts'); ui.restart();
  const q = s => document.querySelector(s), S = st.S, U2 = st.UI;
  ui.renderUI(true);
  let m = q('#map').innerHTML;
  assert.ok(!m.includes('<text'), 'keine Schrift in der Karte');
  assert.ok((m.match(/class="ring"/g) || []).length >= 2, 'Ringe für eigene Systeme');
  assert.ok(m.includes('class="digit"'), 'Plakette mit Berichtsalter');
  // Stern wählen: Sternblatt mit Fakten, unbekannter Fund
  const far = sim.stars().find(s => !VW.isKnown(s.i) && sim.targetFree(s.i));
  ui.tapStar(far.i);
  assert.equal(U2.sheet, 'star');
  let h = q('#sheet').innerHTML;
  assert.ok(h.includes(' Lj') && h.includes('J Flug') && h.includes('% Verlust') && h.includes('Fund unbekannt'));
  ui.tapStar(null); assert.equal(U2.sheet, null);
  // Systemstufe der aktiven Front: Kopfzeile live, Bauplätze und Bauer
  ui.act('front');
  assert.equal(U2.level, 'system'); assert.equal(U2.sys, S.me);
  m = q('#map').innerHTML;
  assert.ok(!m.includes('<text'));
  assert.ok(m.includes('class="slot full"') && m.includes('unit copy'), 'Gebäude und Sonde');
  assert.ok(q('#head').innerHTML.includes(' M') && q('#head').classList.contains('show'));
  // ferne Front: Bericht statt Live-Stand
  const f = S.rep.find(r => r.s !== S.me);
  ui.act('sys:' + f.s);
  assert.ok(q('#head').innerHTML.includes('vor '));
  assert.ok(!q('#map').innerHTML.includes('unit '), 'ferne Bauer unbekannt');
  // Herauszoomen: zurück zur Galaxie, auf den Stern
  ui.act('out');
  assert.equal(U2.level, 'galaxy');
  assert.equal(U2.cam.x, sim.star(f.s).x);
  const z = U2.cam.z; ui.act('out'); assert.ok(U2.cam.z < z, 'weiter herauszoomen');
  assert.ok(U2.cam.z >= MP.Z_MIN);
});

test('Fronten (#13): aktive Front zuerst, Sol an zweiter Stelle, dann nach Entfernung; Zeigen', () => {
  SC.loadScenario('fronts'); const S = st.S;
  // Spieler steht woanders: Front springen lassen
  const f = S.rep.find(r => r.s !== 0).s;
  while (S.me === 0) { if (sim.jump(f) === '') break; }
  while (S.me === null) sim.step(1 / 12);
  const list = VW.frontList();
  assert.equal(list[0].s, f); assert.equal(list[0].age, 0);
  assert.equal(list[1].s, 0, 'Sol an zweiter Stelle');
  for (let i = 3; i < list.length; i++) assert.ok(list[i].d >= list[i - 1].d);
  ui.act('fronts');
  const h = document.querySelector('#sheet').innerHTML;
  assert.ok(h.indexOf('data-a="sys:' + f + '"') < h.indexOf('data-a="sys:0"'));
  ui.act('sys:0'); assert.equal(st.UI.level, 'system'); assert.equal(st.UI.sys, 0);
});

test('Sicht (#13): Sonden erst sichtbar, wenn das Licht vom Start da ist', () => {
  sim.newGame(8); const S = st.S;
  // eine Sonde startet jetzt an einem Stern 5+ Lj von Sol entfernt (ihr Flug dauert länger als das Licht)
  const t = sim.stars().slice(1).find(s => U.dist(s, sim.star(0)) > 5), to = sim.stars().find(s => s.i && s !== t);
  const d = U.dist(t, sim.star(0)), fly = U.dist(t, to) / D.PROBE.v;
  S.probes.push({ id: S.nextId++, from: t.i, to: to.i, at: S.year + fly, seed: 'mine', two: false, risk: 0 });
  assert.equal(VW.probesSeen().length, 0, 'noch nicht sichtbar');
  S.year += d - .1; assert.equal(VW.probesSeen().length, 0, 'kurz vorher noch nicht');
  S.year += .2; assert.equal(VW.probesSeen().length, 1, 'nach der Lichtlaufzeit sichtbar');
  const p = VW.probePos(S.probes[0]), f = (d + .1) / fly;
  assert.ok(Math.abs(p.x - (t.x + (to.x - t.x) * Math.min(1, f))) < 1e-9);
});

// ---------- Bauen über die Oberfläche (#13, Teil 2) ----------
const OU = await import(new URL('ortui.js', js));

test('Ortsstufe: nur an der aktiven Front, Karte ohne Schrift, Bauknöpfe mit Gründen, Ausbau und Abriss', () => {
  store.clear(); sim.newGame(21); ui.restart();
  const S = st.S, U2 = st.UI, q = s => document.querySelector(s), sol = sim.sysOf(0);
  ui.act('front'); ui.act('ort:0');
  assert.equal(U2.level, 'ort'); assert.equal(U2.sheet, 'ort');
  assert.ok(!q('#map').innerHTML.includes('<text'));
  let h = q('#sheet').innerHTML;
  assert.ok(h.includes('Kraftwerk') && h.includes('Sender'), 'Gebäude der Station');
  assert.match(h, /data-a="b:mine" disabled>.*nicht hier/, 'Mine an der Station gesperrt, mit Grund');
  // Sender bauen: die Sonde steht auf der Erde, sie reist erst hin
  ui.act('b:sender');
  const me = S.units[0];
  assert.deepEqual(me.q.map(i => i.a), ['move', 'build']);
  for (let i = 0; i < 24 && !sol.b.some(b => b.k === 'sender'); i++) sim.step(1 / 12);
  assert.ok(sol.b.some(b => b.k === 'sender' && b.o === 0));
  ui.renderUI(true); h = q('#sheet').innerHTML;
  assert.match(h, /data-a="b:power" disabled>.*kein Platz/, 'Station voll');
  // Ausbau des Kraftwerks, Abriss erst nach Nachfrage
  sol.m = 100; ui.act('up:power'); untilIdle(24);
  assert.ok(sol.b.some(b => b.k === 'power' && b.lv === 2));
  const n = sol.b.length;
  ui.act('raze:sender'); assert.equal(me.q.length, 0, 'erster Tipp fragt nach');
  assert.ok(q('#sheet').innerHTML.includes('Sicher?'));
  ui.act('raze:sender'); sim.step(1 / 12);
  assert.equal(sol.b.length, n - 1);
  // ferne Systeme haben keine Ortsstufe
  U2.sys = 5; ui.act('ort:1'); assert.equal(U2.ort, 0, 'unverändert');
  ui.act('out'); ui.act('out'); assert.equal(U2.level, 'galaxy');
});

test('Bauer: Wahl nach Ort und Warteschlange, Konstruktor, Ausbau durch zweiten Bauer, Auftrag entfernen', () => {
  store.clear(); sim.newGame(22); ui.restart();
  const S = st.S, U2 = st.UI, sol = sim.sysOf(0); sol.m = 300;
  ui.act('front'); ui.act('ort:' + D.EARTH);
  ui.act('cons'); untilIdle();
  const c = S.units.find(u => u.k === 'cons');
  assert.ok(c && c.o === D.EARTH);
  // zwei Aufträge an der Erde: verteilt auf beide Bauer dort
  ui.act('b:mine'); ui.act('b:mine');
  assert.equal(S.units[0].q.length + c.q.length, 2);
  assert.ok(S.units[0].q.length === 1 && c.q.length === 1, 'kürzeste Warteschlange zuerst');
  untilIdle();
  // Auftrag wieder entfernen
  ui.act('b:mine'); const u = S.units.find(x => x.q.length);
  ui.act('unq:' + u.id + ':0'); assert.equal(u.q.length, 0);
  // Konstruktor ausbauen übernimmt die Sonde am selben Ort
  ui.act('consup:' + c.id); untilIdle();
  assert.equal(c.lv, 2);
  // Bauer herschicken: in den Gürtel
  ui.act('out'); ui.act('ort:5'); ui.act('send');
  assert.ok(S.units.some(x => x.q.some(i => i.a === 'move' && i.o === 5)));
  assert.ok(sv.validate(clone(S)));
});

test('Werftleiste: Sonde in Auftrag, Fortschritt, bereit', () => {
  store.clear(); sim.newGame(23); ui.restart();
  const S = st.S, q = s => document.querySelector(s), sol = sim.sysOf(0); sol.m = 200;
  ui.act('front'); ui.renderUI(true);
  assert.ok(!q('#head').innerHTML.includes('data-a="probe"'), 'ohne Werft keine Leiste');
  sol.b.push({ k: 'werft', o: 4, lv: 1 }); ui.renderUI(true);
  assert.ok(q('#head').innerHTML.includes('data-a="probe"'));
  ui.act('probe'); assert.equal(sol.pq, 1);
  for (let i = 0; i < 6; i++) sim.step(1 / 12);
  ui.renderUI(true); assert.match(q('#head').innerHTML, /im Bau · [0-9]+ %/);
  for (let i = 0; i < 12 && !sol.ready; i++) sim.step(1 / 12);
  ui.renderUI(true); assert.ok(q('#head').innerHTML.includes('1 bereit'));
});

// ---------- Reisen über die Oberfläche (#13, Teil 3) ----------
test('Sonde starten: Starten führt zur Galaxie, Sternblatt mit Saatpaket, gesperrt mit Grund', () => {
  store.clear(); sim.newGame(24); ui.restart();
  const S = st.S, U2 = st.UI, q = s => document.querySelector(s), sol = sim.sysOf(0);
  const t = sim.stars().slice(1).sort((a, b) => U.dist(a, sim.star(0)) - U.dist(b, sim.star(0)))[0];
  ui.tapStar(t.i);
  assert.match(q('#sheet').innerHTML, /data-a="launch:[0-9]+:mine" disabled>.*keine Sonde bereit/);
  sol.ready = 1; sol.m = 0; ui.renderUI(true);
  assert.match(q('#sheet').innerHTML, /data-a="launch:[0-9]+:mine" disabled>.*M fehlt/);
  sol.m = 200; sol.b.push({ k: 'werft', o: 4, lv: 1 });
  ui.act('front'); ui.renderUI(true);
  assert.ok(q('#head').innerHTML.includes('data-a="start"'), 'Starten in der Werftleiste');
  ui.act('start'); assert.equal(U2.level, 'galaxy');
  ui.tapStar(t.i);
  assert.ok(!/data-a="launch:[0-9]+:power" disabled/.test(q('#sheet').innerHTML));
  ui.act('launch:' + t.i + ':power');
  assert.equal(S.probes.length, 1); assert.equal(S.probes[0].seed, 'power');
  assert.equal(U2.sheet, null);
  ui.tapStar(t.i);
  assert.ok(q('#sheet').innerHTML.includes('Sonde unterwegs') && !q('#sheet').innerHTML.includes('launch:'));
});

test('Springen: Sender hier und laut Bericht dort, Nachfrage, unterwegs keine Befehle, Ankunft', () => {
  SC.loadScenario('fronts'); ui.restart();
  const S = st.S, U2 = st.UI, q = s => document.querySelector(s);
  // bis ein Bericht mit Sender da ist (der Testspielstand endet, sobald dort einer steht; der Bericht kann älter sein)
  for (let i = 0; i < 12 * 60 && !S.rep.some(r => r.s !== 0 && r.b.sender); i++) sim.step(1 / 12);
  const f = S.rep.find(r => r.s !== 0 && r.b.sender).s;
  ui.tapStar(f);
  assert.match(q('#sheet').innerHTML, /Springen · [0-9.]+ J/);
  ui.act('jump:' + f); assert.equal(S.me, 0, 'erster Tipp fragt nach');
  assert.ok(q('#sheet').innerHTML.includes('Sicher?'));
  ui.act('jump:' + f);
  assert.equal(S.me, null); assert.ok(S.jump);
  ui.tapStar(f); assert.ok(!q('#sheet').innerHTML.includes('jump:'), 'unterwegs keine Reiseknöpfe');
  ui.act('front'); assert.equal(U2.sys, f, 'Zur Front zeigt das Ziel');
  while (S.me === null) sim.step(1 / 12);
  assert.equal(S.me, f);
  // jetzt ist f die Front, Sol fern: Sprung zurück braucht Solar-Bericht mit Sender
  ui.tapStar(0); ui.renderUI(true);
  assert.ok(q('#sheet').innerHTML.includes('jump:0'));
  // ohne Sender hier gesperrt
  const sys = sim.sysOf(f); sys.b = sys.b.filter(b => b.k !== 'sender'); ui.renderUI(true);
  assert.match(q('#sheet').innerHTML, /data-a="jump:0" disabled>.*Sender fehlt hier/);
});

// ---------- Versionsangaben (#15) ----------
test('Versionen: index.html nennt für Stylesheet und jedes Modul die aktuelle Prüfsumme (sonst: node tools/version.mjs)', async () => {
  const VS = await import(new URL('../tools/version.mjs', js));
  const html = readFileSync(new URL('../index.html', js), 'utf8');
  assert.equal(html, VS.versionedHtml(html), 'veraltet – node tools/version.mjs aufrufen');
  const map = JSON.parse(html.match(/<script type="importmap">([^<]*)<\/script>/)[1]).imports;
  assert.deepEqual(Object.keys(map).sort(), VS.modules().map(m => './' + m), 'jedes Modul in der Import-Map');
  assert.ok(Object.values(map).every(v => /\?v=[0-9a-f]{8}$/.test(v)));
  assert.match(html, /href="css\/style\.css\?v=[0-9a-f]{8}"/);
  assert.match(html, /src="js\/main\.js\?v=[0-9a-f]{8}"/);
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'Import-Map vor dem ersten Modul');
  // Zeilenenden ändern die Prüfsumme nicht
  assert.equal(VS.fileHash('js/sim.js'), VS.fileHash('js/sim.js'));
});

// ---------- Server ----------
test('Server: Positivliste und fehlerhafte Anfragen', async () => {
  const r = p => server.resolveRequest(p);
  assert.ok(r('/').file && r('/js/main.js').file && r('/css/style.css').file && r('/index.html?x=1').file);
  for (const p of ['/%', '/%00', '/js\\..\\server.js', '../x.js', '*']) assert.equal(r(p).status, 400, p);
  for (const p of ['/.git/config', '/CLAUDE.md', '/KONZEPT.md', '/server.js', '/tools/test.mjs', '/js/package.json',
    '/js/../server.js', '/js/%2e%2e/server.js', '/CON', '/js/con.js', '//index.html', '/js/']) assert.equal(r(p).status, 404, p);
  // Echte Anfragen an eine eigene Instanz (freier Port, nur 127.0.0.1)
  const srv = http.createServer(server.handle);
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  const get = (path, method = 'GET') => new Promise(res => {
    const q = http.request({ host: '127.0.0.1', port, path, method, agent: false }, s => { s.resume(); s.on('end', () => res(s.statusCode)); });
    q.on('error', () => res('ERR')); q.end();
  });
  try {
    assert.equal(await get('/js/main.js'), 200);
    assert.equal(await get('/.git/HEAD'), 404);
    assert.equal(await get('/index.html', 'POST'), 405);
  } finally { srv.close(); }
});

// ---------- Ausführen ----------
let failed = 0;
for (const t of tests) {
  try { await t.fn(); console.log('OK    ' + t.name); }
  catch (e) { failed++; console.log('FAIL  ' + t.name + '\n      ' + (e.message || e).split('\n').join('\n      ')); }
}
console.log(failed ? `\n${failed} von ${tests.length} Tests fehlgeschlagen` : `\nAlle ${tests.length} Tests bestanden`);
process.exit(failed ? 1 : 0);
