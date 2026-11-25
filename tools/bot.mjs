/**
 * tools/bot.mjs – Messläufe des Bots (#9): spielt viele Seeds und misst den Spielfluss (Messgrößen aus #6,
 * Abschnitt 7). Ohne Abhängigkeiten, nur Node.
 *
 * Aufruf:  node tools/bot.mjs [Seeds = 20] [Jahre = 300]
 *
 * Gemessen je Zeitabschnitt (Mittel über alle Seeds):
 *   Entsch./J    Entscheidungen des Spielers je Spieljahr (Bauschritt, Sonde in Auftrag, Sonde starten)
 *   Leerlauf     Anteil der Monate, in denen an der aktiven Front nichts geschieht: kein Bauer arbeitet oder reist
 *                (alle frei oder warten auf Materie), keine Sonde im Bau, nichts zu entscheiden
 *   Lager/Eink.  Median über alle Systeme: Lager geteilt durch Jahreseinkommen (in Jahren); am Ende des Abschnitts
 *   Front        dasselbe nur für die aktive Front (dort wirken die Senken des Spielers, z. B. Feinschliff #26)
 *   Auslastung   belegte Plätze ÷ alle Plätze der Systeme; am Ende des Abschnitts
 *   Systeme      Anzahl Systeme am Ende des Abschnitts
 * Einmalig je Lauf: Zeit bis zur ersten Entscheidung, Ertragslatenz der ersten Sonde (Baubeginn in der Werft bis
 * die Ankunftsnachricht da ist), verlorene Sonden, Jahr jeder erreichten Forschungsstufe (#22).
 * Eine laufende Forschung an der aktiven Front zählt nicht als Leerlauf (wie eine Sonde im Bau).
 */
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const js = new URL('../js/', import.meta.url);
const st = await import(new URL('state.js', js));
const sim = await import(new URL('sim.js', js));
const { createBot } = await import(new URL('bot.js', js));
const { ORTE, PROJECTS, stageOf, stageMax } = await import(new URL('data.js', js));
/** Alle Forschungsstufen als „Projekt:Stufe“ (Feinschliff: nur der erste Schritt, dazu die Höchstzahl je Lauf). */
const STAGES = Object.keys(PROJECTS).flatMap(p => Array.from({ length: PROJECTS[p].rep ? 1 : stageMax(p) }, (_, i) => [`${p}:${i + 1}`, stageOf(p, i + 1).n]));

const SEEDS = +(process.argv[2] || 20), YEARS = +(process.argv[3] || 300);
/** Grenzen der Zeitabschnitte in Spieljahren ab Start. */
const CUTS = [0, 10, 25, 50, 100, 200, 300, 500, 1000].filter(y => y <= YEARS);
if (CUTS[CUTS.length - 1] < YEARS) CUTS.push(YEARS);

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

/** Ein Lauf: liefert je Abschnitt die Messwerte und die einmaligen Werte. */
function run(seed) {
  sim.newGame(seed);
  const S = st.S, y0 = S.year;
  let decisions = 0, firstDecision = null, probeStart = null, latency = null;
  const techAt = {};
  const bot = createBot(() => { decisions++; if (firstDecision === null) firstDecision = S.year - y0; });
  const periods = [];
  let idle = 0, monthsIn = 0, decAt = 0;
  for (let p = 1; p < CUTS.length; p++) {
    for (let m = 0; m < (CUTS[p] - CUTS[p - 1]) * 12; m++) {
      bot();
      const sol = sim.sysOf(0);
      if (probeStart === null && sol.pj !== null) probeStart = S.year;
      if (S.me !== null) {
        const sys = sim.sysOf(S.me);
        const busy = S.units.some(u => u.s === S.me && (u.job || u.mv || (u.q.length && u.wait !== 'matter'))) || sys.pj !== null || sys.rj !== null;
        if (!busy) idle++;
      }
      monthsIn++;
      sim.step(1 / 12);
      if (latency === null && probeStart !== null && S.log.some(e => e.t.startsWith('Sonde angekommen'))) latency = S.year - probeStart;
      for (const [p, n] of Object.entries(S.tech)) for (let i = 1; i <= n; i++) if (!(`${p}:${i}` in techAt)) techAt[`${p}:${i}`] = S.year - y0;
    }
    const ratio = S.sys.map(y => y.m / Math.max(sim.income(y), 1e-6));
    const fs = S.me !== null ? sim.sysOf(S.me) : null, front = fs ? fs.m / Math.max(sim.income(fs), 1e-6) : NaN;
    let used = 0, slots = 0;
    for (const y of S.sys) sim.star(y.s).orte.forEach((o, i) => { used += sim.used(y, i); slots += ORTE[o.k].slots; });
    periods.push({ dec: (decisions - decAt) / (CUTS[p] - CUTS[p - 1]), idle: idle / monthsIn, ratio: median(ratio), front, util: used / slots, sys: S.sys.length });
    decAt = decisions; idle = 0; monthsIn = 0;
  }
  const lost = S.log.filter(e => e.t.includes('verloren')).length;
  return { periods, firstDecision, latency, lost, techAt };
}

const t0 = Date.now();
const runs = [];
for (let s = 1; s <= SEEDS; s++) runs.push(run(s));

const fmt = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '–';
console.log(`Bot: ${SEEDS} Seeds × ${YEARS} Jahre (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
console.log('Abschnitt (J)   Entsch./J  Leerlauf  Lager/Eink.(J)  Front  Auslastung  Systeme');
for (let p = 1; p < CUTS.length; p++) {
  const P = runs.map(r => r.periods[p - 1]);
  console.log(`${(CUTS[p - 1] + '–' + CUTS[p]).padEnd(15)} ${fmt(mean(P.map(x => x.dec)), 2).padStart(9)}  ${(fmt(mean(P.map(x => x.idle)) * 100, 0) + ' %').padStart(8)}  ${fmt(mean(P.map(x => x.ratio))).padStart(14)}  ${fmt(mean(P.map(x => x.front))).padStart(5)}  ${(fmt(mean(P.map(x => x.util)) * 100, 0) + ' %').padStart(10)}  ${fmt(mean(P.map(x => x.sys))).padStart(7)}`);
}
const lat = runs.map(r => r.latency).filter(x => x !== null);
console.log(`\nErste Entscheidung nach ${fmt(mean(runs.map(r => r.firstDecision)), 2)} Jahren`);
console.log(`Ertragslatenz erste Sonde: Mittel ${fmt(mean(lat))} J, ${fmt(Math.min(...lat))}–${fmt(Math.max(...lat))} J (${lat.length}/${SEEDS} Läufe mit Ankunft)`);
console.log(`Verlorene Sonden je Lauf: ${fmt(mean(runs.map(r => r.lost)))}`);
console.log('\nForschung (Jahr ab Start; Median der Läufe, die die Stufe erreichen):');
for (const [k, n] of STAGES) {
  const ys = runs.map(r => r.techAt[k]).filter(x => x !== undefined);
  console.log(`  ${(k + ' ' + n).padEnd(36)} ${ys.length ? fmt(median(ys), 0).padStart(4) + ' J' : '   –  '}  (${ys.length}/${SEEDS})`);
}
