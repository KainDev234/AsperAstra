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
globalThis.document = { querySelector: s => els.get(s) || els.set(s, fakeEl()).get(s), addEventListener() {}, createElement: () => fakeEl(), body: fakeEl() };
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
  clock.cycleTempo(); assert.equal(S.tempo.n, 0, 'nach der schnellsten Stufe die langsamste');
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

// ---------- Oberfläche ----------
test('Oberfläche: Statusleiste, Aktionen, neues Spiel erst nach Nachfrage', () => {
  store.clear(); sim.newGame(12);
  ui.renderUI(true);
  const q = s => document.querySelector(s);
  assert.equal(q('#tYear').textContent, 'Jan ' + D.START_YEAR);
  assert.ok(q('#pause').classList.contains('on'));
  ui.act('speed:1');
  assert.equal(st.S.speed, 1); assert.ok(q('#play').classList.contains('on'));
  ui.act('tempo'); assert.equal(q('#tTempo').textContent, D.TEMPO[D.TEMPO_DEFAULT + 1].n);
  sim.log('<b>fett</b>'); ui.renderUI(false);
  assert.ok(q('#panel').innerHTML.includes('&lt;b&gt;fett'), 'Logbuch wird maskiert');
  q('#seed').value = '777';
  ui.act('new');
  assert.equal(st.S.seed, 12, 'erster Tipp fragt nur nach');
  assert.ok(q('#panel').innerHTML.includes('Sicher?'));
  ui.act('new');
  assert.equal(st.S.seed, 777);
  assert.ok(store.get(D.SAVE_KEY), 'sofort gespeichert');
  ui.importFile('{kaputt');
  assert.equal(st.S.seed, 777);
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
