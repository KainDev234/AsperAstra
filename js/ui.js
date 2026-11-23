/**
 * ui.js – Oberfläche (#13): Statusleiste mit Zeitsteuerung (Pause, Laufen, Tempo-Schieberegler), die zoombare
 * Karte (map.js), eine feste Bedienleiste unten (Herauszoomen, Zur Front, Fronten), die Kopfzeile der Systemstufe
 * und Blätter von unten (Stern, Fronten, Spiel). Kurzmeldungen bei Halten.
 *
 * Aktionen stehen als data-a="…" an den Knöpfen und laufen über act() – so sind sie auch ohne Browser (Tests)
 * auslösbar. Angezeigt wird nur, was der Spieler weiß (view.js).
 */
import { S, UI } from './state.js';
import { TEMPO, CLASSES, ORTE, PROBE, BUILD } from './data.js';
import { $, esc, fmtDate, seedFromText, dist } from './util.js';
import { newGame, log, star, sysOf, energy, income, launchRisk, fuelCost, targetFree, launchProbe, jump } from './sim.js';
import { setSpeed, setTempo } from './clock.js';
import { save, exportFile, importText, hasBackup, exportBackup, deleteBackup } from './save.js';
import { SCENARIOS, loadScenario } from './scenarios.js';
import { renderMap, centerOn, zoomAt, mapSize, ortGraphic } from './map.js';
import { viewer, isKnown, isLive, reportOf, frontList } from './view.js';
import { ico } from './icons.js';
import { ortHtml, werftHtml, actOrt } from './ortui.js';

/** Wie viele Logbuch-Einträge das Blatt „Spiel“ zeigt (neueste zuerst). */
const LOG_SHOWN = 30;
/** Texte zu den Ergebnissen beim Laden einer Datei. */
const LOAD_TEXT = {
  ok: 'Spielstand geladen.', outdated: 'Spielstand ist zu alt für diese Version.',
  newer: 'Spielstand stammt aus einer neueren Version.', invalid: 'Datei ist kein gültiger Spielstand.',
};
/** Gründe, warum ein Sondenstart bzw. Sprung nicht geht (aus sim.launchProbe / sim.jump). */
const LAUNCH_FAIL = { fern: 'Nur von der aktiven Front', keine: 'Keine Sonde bereit', ziel: 'Ziel schon vergeben', materie: 'Zu wenig Materie für den Treibstoff' };
const JUMP_FAIL = { unterwegs: 'Schon unterwegs', ziel: 'Kein eigenes System', sender: 'An beiden Enden braucht es einen Sender' };
/** Besonderheiten eines Systems (Fund) in Kurzform. */
const SPECIAL = { richBelt: 'reicher Gürtel', gasPower: 'Gasriese +Energie' };
/** Gebäudearten in fester Anzeigereihenfolge. */
const KINDS = Object.keys(BUILD);

/** Zeigt eine Kurzmeldung für ein paar Sekunden. */
let toastTimer = 0;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = 0; }, 2800);
}

// ---------- Navigation auf der Karte ----------

/** Tipp auf einen Stern der Galaxie (null = ins Leere): wählt ihn und zeigt das Sternblatt bzw. schließt es. */
export function tapStar(s) {
  UI.sel = s;
  UI.sheet = s === null ? null : 'star';
  renderUI(true);
}

/** Öffnet die Systemstufe von Stern s. */
export function openSystem(s) {
  UI.level = 'system'; UI.sys = s; UI.sel = s; UI.sheet = null;
  centerOn(s);
  renderUI(true);
}

/** Stern, an dem der Spieler gerade ist (aktive Front bzw. Sprungziel). */
const home = () => S.me !== null ? S.me : S.jump.to;

/**
 * Führt eine Aktion aus (aus data-a eines Knopfs).
 *   speed:0 / speed:1 = Pause / Laufen; out = eine Stufe heraus bzw. weiter herauszoomen; front = Systemstufe der
 *   aktiven Front; fronts = Schnellsuche; game = Blatt „Spiel“; close = Blatt schließen; sys:<s> = Systemstufe
 *   von Stern s; new = neues Spiel, scen:<k> = Testspielstand (beide fragen erst nach: zweimal tippen);
 *   export / import = Datei speichern / laden; backup:export / backup:delete = alten Autosave sichern / verwerfen;
 *   ort:<o> = Stufe Ort der aktiven Front; Bauaktionen des Ortsblatts und der Werftleiste siehe ortui.actOrt.
 *   start = fertige Sonde starten (zur Galaxie, Ziel antippen); launch:<s>:<mine|power> = Sonde zu Stern s mit
 *   Saatpaket; jump:<s> = Sprung zu System s.
 *   Was etwas zerstört, ersetzt oder dich fortbringt (neues Spiel, Testspielstand, Abriss, Sprung), fragt erst nach.
 */
export function act(a) {
  const asks = a === 'new' || /^(scen|raze|consraze|jump):/.test(a);
  if (asks && UI.confirm !== a) { UI.confirm = a; renderUI(true); return; }   // erster Tipp: nachfragen
  UI.confirm = null;
  if (a === 'speed:0' || a === 'speed:1') setSpeed(+a.slice(6));
  else if (a === 'out') {
    if (UI.level === 'ort') { UI.level = 'system'; UI.sheet = null; }
    else if (UI.level === 'system') { UI.level = 'galaxy'; centerOn(UI.sys); }
    else { const { W, H } = mapSize(); zoomAt(.5, W / 2, H / 2); }
  }
  else if (a === 'start') { UI.level = 'galaxy'; UI.sheet = null; UI.sel = null; centerOn(home()); toast('Ziel antippen'); }
  else if (a.startsWith('launch:')) {
    const [, s, seed] = a.split(':'), r = launchProbe(+s, seed);
    toast(r ? LAUNCH_FAIL[r] || 'Geht nicht' : 'Sonde gestartet');
    if (!r) { UI.sheet = null; UI.sel = null; }
  }
  else if (a.startsWith('jump:')) {
    const r = jump(+a.slice(5));
    toast(r ? JUMP_FAIL[r] || 'Geht nicht' : 'Sprung gestartet');
    if (!r) { UI.level = 'galaxy'; UI.sheet = null; }
  }
  else if (a.startsWith('ort:')) { if (UI.sys === S.me) { UI.level = 'ort'; UI.ort = +a.slice(4); UI.sheet = 'ort'; } }
  else if (a === 'front') { openSystem(home()); return; }
  else if (a === 'fronts' || a === 'game') UI.sheet = UI.sheet === a ? null : a;
  else if (a === 'close') { UI.sheet = null; if (UI.level === 'galaxy') UI.sel = null; }
  else if (a.startsWith('sys:')) { openSystem(+a.slice(4)); return; }
  else if (a === 'new') {
    const field = $('#seed');
    newGame(seedFromText(field.value || ''));
    field.value = '';
    restart();
  }
  else if (a.startsWith('scen:')) { if (loadScenario(a.slice(5))) restart(); }
  else if (a === 'export') exportFile();
  else if (a === 'import') $('#importFile').click();
  else if (a === 'backup:export') exportBackup();
  else if (a === 'backup:delete') deleteBackup();
  else { const msg = actOrt(a); if (msg) toast(msg); }
  renderUI(true);
}

/** Nach neuem oder geladenem Spiel: speichern, Karte auf die Front, Blätter zu. */
export function restart() {
  save();
  UI.level = 'galaxy'; UI.sel = null; UI.sheet = null;
  const { W, H } = mapSize();
  centerOn(home(), Math.min(W, H) / 30);
}

/** Übernimmt eine gewählte Datei als Spielstand und meldet das Ergebnis. */
export function importFile(text) {
  const r = importText(text);
  toast(LOAD_TEXT[r]);
  if (r === 'ok') { log('Spielstand aus Datei geladen.'); restart(); }
  renderUI(true);
}

// ---------- Darstellung ----------

/** Merker, damit Karte und Blätter nur bei Änderungen neu entstehen. */
let mapKey = '', sheetKey = '';

/**
 * Aktualisiert die Oberfläche: Statusleiste jedes Mal (billig); Karte, Kopfzeile und Blatt nur bei Änderungen
 * (Monatswechsel, Kamera, Auswahl) oder mit force (nach Aktionen).
 */
export function renderUI(force) {
  $('#tYear').textContent = fmtDate(S.year);
  $('#tTempo').textContent = TEMPO[S.tempo.n].n;
  const sl = $('#tempo');
  sl.max = String(TEMPO.length - 1);
  if (document.activeElement !== sl) sl.value = String(S.tempo.n);
  $('#pause').classList.toggle('on', S.speed === 0);
  $('#play').classList.toggle('on', S.speed === 1);

  // Ortsstufe gibt es nur an der aktiven Front (nach einem Sprung zurück zur Systemstufe)
  if (UI.level === 'ort' && UI.sys !== S.me) { UI.level = 'system'; if (UI.sheet === 'ort') UI.sheet = null; }
  const month = Math.floor(S.year * 12 + 1e-6);
  const mk = [month, UI.level, UI.sys, UI.ort, UI.sel, UI.cam.x, UI.cam.y, UI.cam.z, S.me].join('|');
  if (force || UI.dirty || mk !== mapKey) { mapKey = mk; UI.dirty = false; renderMap(); }

  const last = S.log[S.log.length - 1];
  const sk = [month, UI.level, UI.sys, UI.ort, UI.sel, UI.sheet, UI.confirm, S.seed, S.log.length, last && last.t, hasBackup()].join('|');
  if (!force && sk === sheetKey) return;
  sheetKey = sk;
  const head = $('#head');
  const inSys = UI.level === 'system' || UI.level === 'ort';
  head.innerHTML = inSys ? headHtml(UI.sys) + (isLive(UI.sys) ? werftHtml() : '') : '';
  head.classList.toggle('show', inSys);
  const sheet = $('#sheet');
  sheet.innerHTML = UI.sheet === 'star' && UI.sel !== null ? starHtml(UI.sel) : UI.sheet === 'fronts' ? frontsHtml() : UI.sheet === 'game' ? gameHtml()
    : UI.sheet === 'ort' && UI.level === 'ort' ? ortGraphic(UI.sys, UI.ort, mapSize().W - 28) + ortHtml(UI.confirm) : '';
  sheet.classList.toggle('show', !!UI.sheet);
  sheet.classList.toggle('ort', UI.sheet === 'ort');
  // Ortsblatt füllt den Raum zwischen Kopfzeile und Bedienleiste (Kopfzeile ist ein- oder zweizeilig)
  const hb = head.getBoundingClientRect && head.getBoundingClientRect();
  sheet.style.top = UI.sheet === 'ort' && hb ? hb.bottom + 'px' : '';
  $('#btnFronts').classList.toggle('on', UI.sheet === 'fronts');
  $('#btnGame').classList.toggle('on', UI.sheet === 'game');
}

/** Gebäude je Art als Piktogramm mit Zahl. */
const countsHtml = c => KINDS.filter(k => c[k]).map(k => `<span class="cnt">${ico(k)}${c[k]}</span>`).join('') || '<span class="dim">–</span>';

/** Kopfzeile der Systemstufe: live Lager, Einkommen, Energie; fern der letzte Bericht mit Alter. */
function headHtml(s) {
  const st = star(s);
  let h = `<b>${esc(st.name)}</b>`;
  if (isLive(s)) {
    const sys = sysOf(s), e = energy(sys);
    h += ` <span>${Math.floor(sys.m)} M</span> <span class="dim">+${income(sys, e.f).toFixed(1)}/J</span>`
      + ` <span class="${e.f < 1 ? 'warn' : ''}">${ico('power')}${e.gen}/${e.need}</span>`;
  } else {
    const r = reportOf(s);
    h += r ? ` <span class="dim">vor ${Math.round(S.year - r.y)} J</span> <span>${r.m} M</span> ${countsHtml(r.b)}` : ' <span class="dim">kein Bericht</span>';
  }
  return h;
}

/**
 * Sternblatt: Klasse, Entfernung, Flugzeit, Treibstoff, Verlustrisiko; bei bekanntem Fund Orte, Reichtum,
 * Besonderheit. Knopf zur Systemstufe (Sonde schicken und Springen folgen mit dem dritten PR zu #13).
 */
function starHtml(s) {
  const st = star(s), v = viewer(), d = dist(st, v);
  let h = `<div class="hd"><span style="color:${CLASSES[st.cls].c}">●</span> ${esc(st.name)} <span class="dim">${CLASSES[st.cls].n}</span><button class="x" data-a="close">×</button></div>`;
  // Entfernung; für mögliche Sondenziele dazu Flugzeit, Treibstoff und Verlustrisiko („unterwegs“: eine Sonde fliegt hin)
  if (s !== v.i && isKnown(s)) h += `<div class="facts"><span>${d.toFixed(1)} Lj</span></div>`;
  else if (s !== v.i) {
    // Treibstoff neben dem eigenen Lager („8/13 M“, rot wenn zu wenig); während eines Sprungs nur die Kosten
    const fuel = fuelCost(v.i, s), me = S.me !== null && sysOf(S.me);
    h += `<div class="facts"><span>${d.toFixed(1)} Lj</span><span>${(d / PROBE.v).toFixed(0)} J Flug</span>`
      + (me ? `<span class="${me.m < fuel ? 'warn' : ''}">${Math.floor(me.m)}/${fuel} M</span>` : `<span>${fuel} M</span>`) + `<span>${targetFree(s) ? Math.round(launchRisk(s) * 100) + ' % Verlust' : 'Sonde unterwegs'}</span></div>`;
  }
  if (isKnown(s)) {
    const n = k => st.orte.filter(o => o.k === k).length;
    h += `<div class="facts"><span>${n('rock')} ${ORTE.rock.n}</span><span>${n('gas')} ${ORTE.gas.n}</span>${n('belt') ? `<span>${ORTE.belt.n}</span>` : ''}`
      + `<span>Reichtum ×${st.rich}</span>${st.spec ? `<span class="good">${SPECIAL[st.spec]}</span>` : ''}</div>`;
    h += `<div class="row"><button data-a="sys:${s}">System ›</button></div>`;
  } else h += '<div class="facts dim"><span>Fund unbekannt</span></div>';
  return h + travelHtml(s);
}

/**
 * Reiseknöpfe im Sternblatt (#13, Teil 3). Unbekannter freier Stern: Sonde mit Saatpaket Mine oder Kraftwerk
 * (gesperrt mit Grund: keine Sonde bereit, Materie für den Treibstoff fehlt). Eigenes System: Springen, wenn an
 * beiden Enden ein Sender steht – dort laut letztem Bericht (gesperrt mit Grund). Während eines Sprungs nichts.
 */
function travelHtml(s) {
  if (S.me === null || s === S.me) return '';
  const me = sysOf(S.me), st = star(s);
  // Beschriftung einzeilig, Grund darunter gut lesbar (gesperrte Reiseknöpfe sind weniger blass als andere)
  const btn = (a, label, why) => `<button data-a="${a}"${why ? ' disabled' : ''}><span>${label}</span>${why ? `<small class="warn">${why}</small>` : ''}</button>`;
  if (!isKnown(s)) {
    if (!targetFree(s)) return '';
    const fuel = fuelCost(S.me, s);
    const why = me.ready < 1 ? 'keine Sonde bereit' : me.m < fuel ? `${Math.floor(me.m)}/${fuel} M` : '';
    return `<div class="row go">${btn(`launch:${s}:mine`, `${ico('probe')} Sonde + ${ico('mine')}`, why)}${btn(`launch:${s}:power`, `${ico('probe')} Sonde + ${ico('power')}`, why)}</div>`;
  }
  const r = reportOf(s), here = me.b.some(b => b.k === 'sender'), there = r && r.b.sender > 0;
  const why = !here ? 'Sender fehlt hier' : !there ? 'Sender dort nicht gemeldet' : '';
  const a = `jump:${s}`, d = dist(st, star(S.me));
  return `<div class="row go one">${UI.confirm === a ? `<button data-a="${a}" class="warn">Sicher? ${d.toFixed(1)} J unterwegs</button>` : btn(a, `Springen · ${d.toFixed(1)} J`, why)}</div>`;
}

/** Schnellsuche „Fronten“: aktive Front, Sol, dann nach Entfernung; je Zeile „Zeigen“. */
function frontsHtml() {
  let h = '<div class="hd">Fronten<button class="x" data-a="close">×</button></div>';
  for (const f of frontList()) {
    const age = f.age === 0 ? '<span class="me">hier</span>' : f.age === null ? '<span class="dim">kein Bericht</span>' : `<span class="dim">vor ${Math.round(f.age)} J</span>`;
    h += `<div class="front"><div><b>${esc(f.name)}</b> <span class="dim">${f.d.toFixed(1)} Lj</span> ${age}<br>${countsHtml(f.b)}</div>`
      + `<button data-a="sys:${f.s}">Zeigen</button></div>`;
  }
  return h;
}

/** Knopf für eine Aktion, die das laufende Spiel ersetzt: nach dem ersten Tipp fragt er nach. */
const replaceButton = (a, text) => `<button data-a="${a}" class="${UI.confirm === a ? 'warn' : ''}">${UI.confirm === a ? 'Sicher? Nochmal' : esc(text)}</button>`;

/** Blatt „Spiel“: Seed, neues Spiel, Datei, Testspielstände, gesicherter alter Stand, Logbuch. */
function gameHtml() {
  let h = `<div class="hd">Spiel <span class="dim">Seed ${S.seed}</span><button class="x" data-a="close">×</button></div>`;
  h += `<div class="row"><input id="seed" placeholder="Seed (leer = zufällig)" autocomplete="off">${replaceButton('new', 'Neues Spiel')}</div>`;
  h += `<div class="row"><button data-a="export">Datei speichern</button><button data-a="import">Datei laden</button></div>`;
  h += '<div class="row"><span class="dim">Testspielstand</span></div><div class="row">'
    + Object.entries(SCENARIOS).map(([k, sc]) => replaceButton('scen:' + k, sc.n)).join('') + '</div>';
  if (hasBackup()) {
    h += `<div class="row"><span class="dim">Alter Spielstand gesichert</span>`
      + `<button data-a="backup:export">Herunterladen</button><button data-a="backup:delete">Verwerfen</button></div>`;
  }
  h += '<div class="hd log">Logbuch</div><div class="loglist">';
  for (const e of S.log.slice(-LOG_SHOWN).reverse()) {
    h += `<div${e.c ? ` class="${e.c}"` : ''}><span class="dim">${fmtDate(e.y)}</span> ${esc(e.t)}</div>`;
  }
  return h + '</div>';
}

// Klicks auf Knöpfe mit data-a; Schieberegler für das Tempo; Dateiauswahl (nur im Browser).
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-a]');
  if (b) act(b.dataset.a);
});
document.addEventListener('input', e => {
  if (e.target.id === 'tempo') { setTempo(+e.target.value); renderUI(false); }
});
document.addEventListener('change', e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  e.target.files[0].text().then(importFile);
  e.target.value = '';
});
