/**
 * ui.js – Oberfläche des Grundgerüsts: Statusleiste mit Zeitsteuerung, ein Panel „Spiel“ (Seed, neues
 * Spiel, Datei speichern/laden, Logbuch) und Kurzmeldungen. Die Spielansichten kommen ab Phase 3.
 *
 * Aktionen stehen als data-a="…" an den Knöpfen und laufen über act() – so sind sie auch ohne Browser
 * (Tests) auslösbar.
 */
import { S, UI } from './state.js';
import { TEMPO } from './data.js';
import { $, esc, fmtDate, seedFromText } from './util.js';
import { newGame, log } from './sim.js';
import { setSpeed, cycleTempo } from './clock.js';
import { save, exportFile, importText, hasBackup, exportBackup, deleteBackup } from './save.js';

/** Wie viele Logbuch-Einträge das Panel zeigt (neueste zuerst). */
const LOG_SHOWN = 20;
/** Texte zu den Ergebnissen beim Laden einer Datei. */
const LOAD_TEXT = {
  ok: 'Spielstand geladen.', outdated: 'Spielstand ist zu alt für diese Version.',
  newer: 'Spielstand stammt aus einer neueren Version.', invalid: 'Datei ist kein gültiger Spielstand.',
};

/** Zeigt eine Kurzmeldung für ein paar Sekunden. */
let toastTimer = 0;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = 0; }, 2800);
}

/**
 * Führt eine Aktion aus (aus data-a eines Knopfs).
 *   speed:0 / speed:1 = Pause / Laufen, tempo = nächste Tempostufe,
 *   new = neues Spiel (zweimal tippen: der erste Tipp fragt nach), export / import = Datei speichern / laden,
 *   backup:export / backup:delete = gesicherten alten Autosave herunterladen / verwerfen.
 */
export function act(a) {
  if (a !== 'new') UI.confirmNew = false;
  if (a === 'speed:0' || a === 'speed:1') setSpeed(+a.slice(6));
  else if (a === 'tempo') cycleTempo();
  else if (a === 'new') {
    if (!UI.confirmNew) { UI.confirmNew = true; }
    else {
      UI.confirmNew = false;
      const field = $('#seed');
      newGame(seedFromText(field.value || ''));
      field.value = '';
      save();
    }
  }
  else if (a === 'export') exportFile();
  else if (a === 'import') $('#importFile').click();
  else if (a === 'backup:export') exportBackup();
  else if (a === 'backup:delete') deleteBackup();
  renderUI(true);
}

/** Übernimmt eine gewählte Datei als Spielstand und meldet das Ergebnis. */
export function importFile(text) {
  const r = importText(text);
  toast(LOAD_TEXT[r]);
  if (r === 'ok') log('Spielstand aus Datei geladen.');
  renderUI(true);
}

/** Merkt sich, was das Panel zuletzt gezeigt hat, damit es nur bei Änderungen neu entsteht. */
let panelKey = '';

/**
 * Aktualisiert die Oberfläche. Die Statusleiste jedes Mal (billig), das Panel nur bei Änderungen oder
 * mit force (nach Aktionen).
 */
export function renderUI(force) {
  $('#tYear').textContent = fmtDate(S.year);
  $('#tTempo').textContent = TEMPO[S.tempo.n].n;
  $('#pause').classList.toggle('on', S.speed === 0);
  $('#play').classList.toggle('on', S.speed === 1);

  const last = S.log[S.log.length - 1];
  const key = [S.seed, S.log.length, last && last.t, last && last.y, UI.confirmNew, hasBackup()].join('|');
  if (!force && key === panelKey) return;
  panelKey = key;
  $('#panel').innerHTML = panelHtml();
}

/** HTML des Panels „Spiel“. */
function panelHtml() {
  let h = `<div class="hd">Spiel <span class="dim">Seed ${S.seed}</span></div>`;
  h += `<div class="row"><input id="seed" placeholder="Seed (leer = zufällig)" autocomplete="off">`
    + `<button data-a="new" class="${UI.confirmNew ? 'warn' : ''}">${UI.confirmNew ? 'Sicher? Nochmal' : 'Neues Spiel'}</button></div>`;
  h += `<div class="row"><button data-a="export">Datei speichern</button><button data-a="import">Datei laden</button></div>`;
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

// Klicks auf Knöpfe mit data-a; die Dateiauswahl liest die Datei und übernimmt sie (nur im Browser).
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-a]');
  if (b) act(b.dataset.a);
});
document.addEventListener('change', e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  e.target.files[0].text().then(importFile);
  e.target.value = '';
});
