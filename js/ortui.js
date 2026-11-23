/**
 * ortui.js – Bauen an der aktiven Front (#13, Teil 2): Ortsblatt der Stufe Ort und Werftleiste der Systemstufe.
 *
 * Ortsblatt: Gebäude am Ort mit Ausbau und Abriss, Bauknöpfe für alle Gebäudearten (gesperrte bleiben sichtbar
 * und nennen ihren Grund), Konstruktor bauen, Bauer herschicken, und die Bauer am Ort mit ihren Warteschlangen.
 * Gebaut wird mit dem Bauer am Ort; steht keiner dort, bekommt der Bauer mit der kürzesten Warteschlange
 * „hinreisen + bauen“ (chooseBuilder). Alle Befehle laufen über sim.order / sim.unorder / sim.orderProbe.
 * Liefert HTML und führt Aktionen aus; die Oberfläche (ui.js) ruft beides auf.
 */
import { S, UI } from './state.js';
import { BUILD, CONS, ORTE, PROBE, RAZE_BACK, QUEUE_MAX } from './data.js';
import { esc } from './util.js';
import { star, sysOf, ortName, order, unorder, orderProbe, canBuildAt, used } from './sim.js';
import { ico } from './icons.js';

/** Grund-Zeichen, warum ein Auftrag wartet bzw. etwas gesperrt ist (kurz, ohne Sätze). */
const WHY = { matter: 'M fehlt', slots: 'kein Platz', ort: 'nicht hier', none: 'nichts da', busy: 'beschäftigt' };

/** Ort, an dem Bauer u nach seiner Warteschlange steht (letzte Reise darin, sonst Reiseziel bzw. Ort). */
const endOrt = u => { const mv = [...u.q].reverse().find(it => it.a === 'move'); return mv ? mv.o : u.mv ? u.mv.o : u.o; };

/**
 * Bauer für einen Auftrag am Ort o: zuerst einer, der dort (nach seiner Warteschlange) steht, mit der kürzesten
 * Warteschlange; sonst der mit der kürzesten Warteschlange überhaupt (dann mit Reise). Volle Warteschlangen zählen
 * nicht. null = keiner frei.
 */
export function chooseBuilder(o) {
  const free = S.units.filter(u => u.s === S.me && u.q.length < QUEUE_MAX);
  const load = u => u.q.length + (u.job || u.mv ? 1 : 0);
  const at = free.filter(u => endOrt(u) === o).sort((a, b) => load(a) - load(b));
  if (at.length) return at[0];
  const any = free.filter(u => u.q.length < QUEUE_MAX - 1).sort((a, b) => load(a) - load(b));
  return any[0] || null;
}

/** Gibt Bauer u am Ort o den Auftrag it (mit vorheriger Reise, falls nötig). @returns {string} Grund oder '' */
function orderAt(u, o, it) {
  if (endOrt(u) !== o) { const r = order(u.id, { a: 'move', o }); if (r) return r; }
  return order(u.id, it);
}

/** Text zu den Ablehnungsgründen von sim.order. */
const REFUSED = { fern: 'Nur an der aktiven Front', voll: 'Warteschlange voll', 'ungültig': 'Geht nicht' };

/**
 * Führt eine Aktion des Ortsblatts bzw. der Werftleiste aus. @returns {string|null} Meldung (Kurzmeldung) oder
 * null, wenn die Aktion nicht hierher gehört.
 *   b:<k> bauen · up:<k> ausbauen · raze:<k> abreißen · cons Konstruktor bauen · send Bauer herschicken ·
 *   unq:<id>:<i> Auftrag entfernen · consup:<id> / consraze:<id> Konstruktor ausbauen / abbauen · probe Sonde
 */
export function actOrt(a) {
  const o = UI.ort, [cmd, x, y] = a.split(':');
  const give = it => { const u = chooseBuilder(o); if (!u) return 'Alle Bauer ausgelastet'; const r = orderAt(u, o, it); return r ? REFUSED[r] || r : ''; };
  if (cmd === 'b' && BUILD[x]) return give({ a: 'build', k: x });
  if (cmd === 'up' && BUILD[x]) return give({ a: 'up', k: x });
  if (cmd === 'raze' && BUILD[x]) return give({ a: 'raze', k: x });
  if (cmd === 'cons') return give({ a: 'cons' });
  if (cmd === 'send') { const u = chooseBuilder(o); if (!u) return 'Alle Bauer ausgelastet'; const r = order(u.id, { a: 'move', o }); return r ? REFUSED[r] || r : ''; }
  if (cmd === 'unq') { unorder(+x, +y); return ''; }
  if (cmd === 'consup' || cmd === 'consraze') {
    // Ausbau bzw. Abbau übernimmt ein anderer Bauer am selben Ort
    const t = S.units.find(u => u.id === +x), helper = S.units.find(u => u.s === S.me && u !== t && endOrt(u) === o && u.q.length < QUEUE_MAX)
      || S.units.find(u => u.s === S.me && u !== t && u.q.length < QUEUE_MAX - 1);
    if (!t || !helper) return 'Dafür braucht es einen zweiten Bauer';
    const r = orderAt(helper, t.o, { a: cmd, id: t.id });
    return r ? REFUSED[r] || r : '';
  }
  if (cmd === 'probe') { const r = orderProbe(); return r === 'voll' ? 'Bauliste der Werft voll' : r ? 'Geht nicht' : ''; }
  return null;
}

/** Ein Auftrag der Warteschlange kurz: Piktogramm bzw. Pfeil mit Ort. */
function itemHtml(it, s) {
  if (it.a === 'move') return `→ ${esc(ortName(s, it.o))}`;
  if (it.a === 'cons') return `${ico('cons')}`;
  if (it.a === 'consup') return `${ico('cons')}↑`;
  if (it.a === 'consraze') return `${ico('cons')}✕`;
  return `${ico(it.k)}${it.a === 'up' ? '↑' : it.a === 'raze' ? '✕' : ''}`;
}

/** Ortsblatt (Stufe Ort, aktive Front). */
export function ortHtml(confirm) {
  const s = S.me, o = UI.ort, st = star(s), ort = st.orte[o], sys = sysOf(s);
  let h = `<div class="hd">${esc(ort.n)} <span class="dim">${ORTE[ort.k].n} · ${used(sys, o)}/${ORTE[ort.k].slots}</span><span class="dim" style="margin-left:auto">${Math.floor(sys.m)} M</span></div>`;
  // Gebäude am Ort
  for (const b of sys.b.filter(x => x.o === o)) {
    const d = BUILD[b.k], back = Math.round(RAZE_BACK * (d.cost + (b.lv > 1 ? d.up : 0)));
    const raze = `raze:${b.k}`;
    h += `<div class="brow">${ico(b.k)} ${d.n}${b.lv > 1 ? ' II' : ''}`
      + (d.up !== null && b.lv === 1 ? `<button data-a="up:${b.k}">↑ ${d.up} M</button>` : '')
      + `<button data-a="${raze}" class="${confirm === raze ? 'warn' : ''}">${confirm === raze ? 'Sicher?' : `✕ +${back} M`}</button></div>`;
  }
  // Bauen: alle Arten sichtbar, gesperrte mit Grund
  h += '<div class="row build">';
  for (const [k, d] of Object.entries(BUILD)) {
    const why = canBuildAt(sys, k, o);
    h += `<button data-a="b:${k}"${why ? ' disabled' : ''}>${ico(k)} ${d.n}<small class="${!why && sys.m < d.cost ? 'warn' : 'dim'}">${why ? WHY[why] : d.cost + ' M'}</small></button>`;
  }
  h += `<button data-a="cons">${ico('cons')} Konstruktor<small class="${sys.m < CONS.cost ? 'warn' : 'dim'}">${CONS.cost} M</small></button>`;
  h += '</div><div class="row"><button data-a="send">Bauer herschicken</button></div>';
  // Bauer am Ort (oder auf dem Weg hierher) mit Warteschlange
  for (const u of S.units.filter(x => x.s === s && endOrt(x) === o)) {
    const cur = u.job ? `${itemHtml(u.job, s)} ${Math.round(100 * (1 - u.job.left / (u.job.a === 'cons' || u.job.a === 'consup' ? CONS.time : BUILD[u.job.k].time)))} %` : u.mv ? `→ ${esc(ortName(s, u.mv.o))}` : '<span class="dim">frei</span>';
    h += `<div class="urow"><span class="${u.k === 'copy' ? 'me' : 'acc'}">${ico(u.k === 'copy' ? 'probe' : 'cons')}${u.k === 'cons' && u.lv > 1 ? 'II' : ''}</span> ${cur}`;
    u.q.forEach((it, i) => { h += `<button class="q" data-a="unq:${u.id}:${i}">${itemHtml(it, s)}${!i && u.wait ? ` <small class="warn">${WHY[u.wait]}</small>` : ''} ×</button>`; });
    if (u.k === 'cons') {
      const cr = `consraze:${u.id}`;
      h += (u.lv === 1 ? `<button class="q" data-a="consup:${u.id}">↑ ${CONS.up} M</button>` : '')
        + `<button class="q${confirm === cr ? ' warn' : ''}" data-a="${cr}">${confirm === cr ? 'Sicher?' : '✕'}</button>`;
    }
    h += '</div>';
  }
  return h;
}

/** Werftleiste der Systemstufe (aktive Front mit Werft): Sonden in Auftrag mit Fortschritt, fertige, „+ Sonde“. */
export function werftHtml() {
  const sys = sysOf(S.me);
  if (!sys || !sys.b.some(b => b.k === 'werft')) return '';
  const pct = sys.pj === null ? 0 : Math.round(100 * (1 - sys.pj / PROBE.time));
  return `<div class="werft">${ico('werft')} <span>${sys.pq ? `${sys.pq} im Bau${sys.pj !== null ? ` · ${pct} %` : ` · ${PROBE.cost} M fehlt`}` : '<span class="dim">leer</span>'}</span>`
    + `${sys.ready ? ` <span class="good">${ico('probe')} ${sys.ready} bereit</span>` : ''}`
    + `<button data-a="probe"${sys.pq >= PROBE.queue ? ' disabled' : ''}>+ ${ico('probe')} ${PROBE.cost} M</button></div>`;
}
