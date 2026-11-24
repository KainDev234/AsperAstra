/**
 * labui.js – Bedienung der Forschung (#24, Regeln #22): Laborleiste in der Kopfzeile der Systemstufe und das
 * Forschungsblatt der aktiven Front.
 *
 * Laborleiste: laufendes Projekt mit Restzeit bzw. „Labor frei“, Knopf zum Blatt. Forschungsblatt: je Projekt die
 * nächste Stufe mit Labor, Wirkung, Kosten, Dauer und Startknopf; gesperrte Stufen bleiben sichtbar und nennen
 * ihren Grund; das laufende Projekt mit Restzeit und Abbruch (fragt nach, nichts wird erstattet).
 * Befehle laufen über sim.research / sim.stopResearch. Liefert HTML und führt Aktionen aus; ui.js ruft beides auf.
 */
import { S } from './state.js';
import { PROJECTS, BUILD } from './data.js';
import { esc } from './util.js';
import { star, sysOf, energy, labPower, techOf, canResearch, research, stopResearch, stageWork, pairPartner } from './sim.js';
import { ico } from './icons.js';

/** Stufen als römische Zahlen. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];
/** Kurze Gründe, warum eine Stufe nicht beginnen kann (aus sim.canResearch; labor und materie entstehen unten). */
const WHY = { fern: 'nur an der Front', 'läuft': 'Labor belegt', unterwegs: 'Ergebnis unterwegs', ziel: 'kein Stern in Reichweite', partner: 'Partner fehlt' };

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

/** Laborleiste der Systemstufe (aktive Front mit Labor). */
export function labBarHtml() {
  const sys = sysOf(S.me);
  if (!hasLab(sys)) return '';
  const r = sys.rj, st = r && PROJECTS[r.p].st[r.n - 1];
  const lab = st ? st.lab : sys.b.some(b => b.k === 'obs') ? 'obs' : 'shop';
  const run = r ? (labPower(sys, st.lab) ? years(sys, st.lab, r.left) : Infinity) : 0;
  return `<div class="werft">${ico(lab)} <span>${r ? `${esc(st.n)} <span class="dim">· noch ${fmtY(run)}</span>` : '<span class="dim">Labor frei</span>'}</span>`
    + '<button data-a="lab">Forschung ›</button></div>';
}

/**
 * Führt eine Aktion des Forschungsblatts aus. @returns {string|null} Meldung (Kurzmeldung) oder null, wenn die
 * Aktion nicht hierher gehört.   res:<p> Stufe beginnen · resstop laufende Forschung abbrechen
 */
export function actLab(a) {
  if (a.startsWith('res:')) {
    const p = a.slice(4), r = research(p);
    return r ? reason(p, r) : `Forschung beginnt: ${PROJECTS[p].n}`;
  }
  if (a === 'resstop') return stopResearch() ? 'Forschung abgebrochen' : '';
  return null;
}

/** Grund als kurzer Text (labor: welches Labor fehlt; materie: Lager zu Kosten). */
function reason(p, why) {
  const st = PROJECTS[p].st[techOf(p)], sys = sysOf(S.me);
  if (why === 'labor') return `${BUILD[st.lab].n} fehlt`;
  if (why === 'materie') return `${Math.floor(sys.m)}/${st.cost} M`;
  if (why === 'partner') return `${WHY.partner} (≥ ${st.minD} Lj)`;
  return WHY[why] || 'geht nicht';
}

/** Forschungsblatt der aktiven Front. @param {string|null} confirm Aktion, die auf Bestätigung wartet */
export function labHtml(confirm) {
  const sys = sysOf(S.me);
  let h = `<div class="hd">Forschung <span class="dim">${Math.floor(sys.m)} M</span><button class="x" data-a="close">×</button></div>`;
  for (const [p, P] of Object.entries(PROJECTS)) {
    const n = techOf(p), done = n >= P.st.length;
    const st = P.st[done ? n - 1 : n];
    h += `<div class="res"><div class="rt">${ico(st.lab)} <b>${esc(P.n)}</b> `;
    if (done) { h += `<span class="good">${ROMAN[n - 1]} fertig</span></div></div>`; continue; }
    h += `<span class="dim">${n ? ROMAN[n - 1] + ' → ' : ''}</span>${ROMAN[n]} ${esc(st.n)}</div><div class="fx dim">${esc(st.fx)}</div>`;
    const r = sys.rj && sys.rj.p === p ? sys.rj : null;
    if (r) {
      // läuft hier: Restzeit, Abbruch mit Nachfrage
      const left = labPower(sys, st.lab) ? years(sys, st.lab, r.left) : Infinity;
      h += `<div class="rrow"><span>noch ${fmtY(left)}</span><button data-a="resstop" class="${confirm === 'resstop' ? 'warn' : ''}">${confirm === 'resstop' ? 'Sicher? Nichts zurück' : 'Abbrechen'}</button></div></div>`;
      continue;
    }
    const why = canResearch(p), work = stageWork(st, sys.s);
    const partner = st.way === 'pair' && pairPartner(sys.s, st.lab, st.minD);
    h += `<div class="rrow"><span>${st.cost ? `<span class="${why === 'materie' ? 'warn' : ''}">${st.cost} M</span> · ` : ''}${work === null ? '–' : fmtY(years(sys, st.lab, work))}`
      + `${partner !== false && partner !== null ? ` <span class="dim">mit ${esc(star(partner).name)}</span>` : ''}</span>`
      + `<button data-a="res:${p}"${why ? ' disabled' : ''}>${why ? `<small class="warn">${esc(reason(p, why))}</small>` : 'Start'}</button></div></div>`;
  }
  return h;
}
