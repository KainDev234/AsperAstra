/**
 * labui.js – Bedienung der Forschung (#24, Regeln #22, Antrieb #26): Laborleiste in der Kopfzeile der Systemstufe
 * und das Forschungsblatt der aktiven Front.
 *
 * Laborleiste: laufendes Projekt mit Restzeit bzw. „Labor frei“, Knopf zum Blatt. Forschungsblatt: oben der Stand
 * der Sonden (Tempo, Treibstoff), dann je Projekt die nächste Stufe mit Labor, Wirkung, Kosten, Dauer und
 * Startknopf; gesperrte Stufen bleiben sichtbar und nennen ihren Grund; das laufende Projekt mit Restzeit bzw. dem
 * Warten auf die Instrumentensonde und Abbruch (fragt nach, nichts wird erstattet). Feinschliff zeigt Schritte
 * statt Stufen.
 * Befehle laufen über sim.research / sim.stopResearch. Liefert HTML und führt Aktionen aus; ui.js ruft beides auf.
 */
import { S } from './state.js';
import { PROJECTS, BUILD, stageOf, NOZZLE_F } from './data.js';
import { esc } from './util.js';
import {
  star, sysOf, energy, labPower, techOf, canResearch, research, stopResearch, stageWork, pairPartner, stageCap,
  siteOk, siteSys, siteTarget, fuelCost, probeSpeed,
} from './sim.js';
import { ico } from './icons.js';

/** Stufen als römische Zahlen. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** Kurze Gründe, warum eine Stufe nicht beginnen kann (aus sim.canResearch; labor, need, materie entstehen unten). */
const WHY = {
  fern: 'nur an der Front', 'läuft': 'Labor belegt', unterwegs: 'Ergebnis unterwegs', ziel: 'kein Ziel',
  partner: 'Partner fehlt', werft: 'Werft fehlt', fertig: 'gedeckelt',
};
/** Was eine Messung vor Ort braucht (#26). */
const SITE = { M: 'Roter Zwerg', gasPower: 'Gasriese +Energie', FA: 'F- oder A-Stern' };

/** Hat System sys ein Labor oder eine laufende Forschung (dann zeigt die Kopfzeile die Laborleiste)? */
export const hasLab = sys => !!sys && (!!sys.rj || sys.b.some(b => b.k === 'obs' || b.k === 'shop'));

/**
 * Jahre für work Labor-Jahre bei der jetzigen Leistung des Labors lab in sys (Laborstufen mal Energieanteil).
 * Ohne Labor wird mit einem Labor der Stufe I gerechnet (Vorschau vor dem Bau). Infinity = steht (keine Energie).
 */
function years(sys, lab, work) {
  const p = Math.max(1, labPower(sys, lab)) * energy(sys).f;
  return p > 0 ? work / p : Infinity;
}
/** Jahre kurz: eine Nachkommastelle unter zehn Jahren, „steht“ ohne Fortschritt. */
const fmtY = y => Number.isFinite(y) ? `${y.toFixed(y < 10 ? 1 : 0)} J` : 'steht';
/** Stufe n von Projekt p kurz: „II Name“, beim Feinschliff „Schritt n“. */
const label = (p, n) => PROJECTS[p].rep ? `Schritt ${n}` : `${ROMAN[n - 1]} ${stageOf(p, n).n}`;

/**
 * Zustand einer laufenden Forschung r in sys als kurzer Text: Restzeit, oder bei fertigen Instrumenten, worauf
 * die Instrumentensonde wartet.
 */
function runText(sys, r) {
  const st = stageOf(r.p, r.n);
  if (r.left > 1e-9) return `noch ${fmtY(labPower(sys, st.lab) ? years(sys, st.lab, r.left) : Infinity)}`;
  if (st.way !== 'site') return 'wartet auf Partner';
  const t = siteTarget(sys.s, st.site);
  if (t === null) return 'kein Ziel für die Sonde';
  if (sys.ready < 1) return 'Instrumente fertig · wartet auf Sonde aus der Werft';
  return `wartet auf Treibstoff (${Math.floor(sys.m)}/${fuelCost(sys.s, t)} M)`;
}

/** Laborleiste der Systemstufe (aktive Front mit Labor). */
export function labBarHtml() {
  const sys = sysOf(S.me);
  if (!hasLab(sys)) return '';
  const r = sys.rj, st = r && stageOf(r.p, r.n);
  const lab = st ? st.lab : sys.b.some(b => b.k === 'obs') ? 'obs' : 'shop';
  return `<div class="werft">${ico(lab)} <span>${r ? `${esc(st.n)} <span class="dim">· ${esc(runText(sys, r))}</span>` : '<span class="dim">Labor frei</span>'}</span>`
    + '<button data-a="lab">Forschung ›</button></div>';
}

/**
 * Führt eine Aktion des Forschungsblatts aus. @returns {string|null} Meldung (Kurzmeldung) oder null, wenn die
 * Aktion nicht hierher gehört.   res:<p> Stufe beginnen · resstop laufende Forschung abbrechen
 */
export function actLab(a) {
  if (a.startsWith('res:')) {
    const p = a.slice(4);
    if (!Object.prototype.hasOwnProperty.call(PROJECTS, p)) return 'geht nicht';
    const r = research(p);
    return r ? reason(p, r) : `Forschung beginnt: ${PROJECTS[p].n}`;
  }
  if (a === 'resstop') return stopResearch() ? 'Forschung abgebrochen' : '';
  return null;
}

/** Grund als kurzer Text (labor / need: welches Gebäude fehlt; materie: Lager zu Kosten). */
function reason(p, why) {
  const st = stageOf(p, techOf(p) + 1), sys = sysOf(S.me);
  if (why === 'labor') return `${BUILD[st.lab].n} fehlt`;
  if (why === 'need') return `${BUILD[st.need].n} fehlt`;
  if (why === 'materie') return `${Math.floor(sys.m)}/${st.cost} M`;
  if (why === 'partner') return `${WHY.partner} (≥ ${st.minD} Lj)`;
  if (why === 'ziel' && st.way === 'site') return `${SITE[st.site]} fehlt`;
  return WHY[why] || 'geht nicht';
}

/** Stand der Sonden nach Antrieb und Feinschliff: Tempo und Treibstoff. */
function driveHtml() {
  const d = techOf('drive'), v = probeSpeed().toFixed(2).replace('.', ',');
  const fuel = d >= 4 ? 'kein Treibstoff'
    : `Treibstoff ${Math.round(100 * NOZZLE_F ** techOf('nozzle'))} %${d >= 2 ? ', gebremst ½' : d >= 1 ? ', zu G/F/A ½' : ''}`;
  return `<div class="facts dim"><span>${ico('probe')} ${v} c</span><span>${fuel}</span></div>`;
}

/** Forschungsblatt der aktiven Front. @param {string|null} confirm Aktion, die auf Bestätigung wartet */
export function labHtml(confirm) {
  const sys = sysOf(S.me);
  let h = `<div class="hd">Forschung <span class="dim">${Math.floor(sys.m)} M</span><button class="x" data-a="close">×</button></div>` + driveHtml();
  for (const [p, P] of Object.entries(PROJECTS)) {
    const n = techOf(p), cap = stageCap(p), rep = !!P.rep;
    const st = stageOf(p, n < cap ? n + 1 : Math.max(1, n)) || stageOf(p, 1);
    h += `<div class="res"><div class="rt">${ico(st.lab)} <b>${esc(P.n)}</b> `;
    if (n >= cap) {
      // fertig bzw. gedeckelt (Feinschliff: bis zur nächsten Antriebsstufe oder nicht mehr nötig)
      h += rep ? `<span class="dim">${n} Schritte · ${cap ? 'mehr nach der nächsten Antriebsstufe' : 'nicht mehr nötig'}</span></div></div>`
        : `<span class="good">${ROMAN[n - 1]} fertig</span></div></div>`;
      continue;
    }
    h += `<span class="dim">${!rep && n ? ROMAN[n - 1] + ' → ' : ''}</span>${esc(label(p, n + 1))}${rep ? ` <span class="dim">von ${cap}</span>` : ''}</div>`
      + `<div class="fx dim">${esc(st.fx)}</div>`;
    const r = sys.rj && sys.rj.p === p ? sys.rj : null;
    if (r) {
      // läuft hier: Restzeit bzw. Warten auf die Instrumentensonde, Abbruch mit Nachfrage
      h += `<div class="rrow"><span>${esc(runText(sys, r))}</span><button data-a="resstop" class="${confirm === 'resstop' ? 'warn' : ''}">${confirm === 'resstop' ? 'Sicher? Nichts zurück' : 'Abbrechen'}</button></div></div>`;
      continue;
    }
    const why = canResearch(p), work = stageWork(st, sys.s);
    // Wohin die Messung geht: Partner der Paarmessung, Ziel der Instrumentensonde oder hier vor Ort
    let where = '';
    if (st.way === 'pair') { const q = pairPartner(sys.s, st.lab, st.minD); if (q !== null) where = `mit ${star(q).name}`; }
    if (st.way === 'site') {
      const q = siteSys(sys.s, st.site), t = siteTarget(sys.s, st.site);
      where = siteOk(st.site, sys.s) ? 'hier vor Ort' : q !== null ? `Daten aus ${star(q).name}` : t !== null ? `+ Sonde nach ${star(t).name}` : '';
    }
    h += `<div class="rrow"><span>${st.cost ? `<span class="${why === 'materie' ? 'warn' : ''}">${st.cost} M</span> · ` : ''}${work === null ? '–' : fmtY(years(sys, st.lab, work))}`
      + `${where ? ` <span class="dim">${esc(where)}</span>` : ''}</span>`
      + `<button data-a="res:${p}"${why ? ' disabled' : ''}>${why ? `<small class="warn">${esc(reason(p, why))}</small>` : 'Start'}</button></div></div>`;
  }
  return h;
}
