/**
 * main.js – Einstiegspunkt: verbindet die Module, startet das Spiel und die Hauptschleife.
 * Übernommen aus Replikator (js/main.js), ohne Karte.
 *
 * Modulübersicht (Abhängigkeiten zeigen nur "nach unten", keine Zyklen):
 *   main.js  → ui.js, save.js, clock.js, sim.js
 *   ui.js    → Oberfläche und Aktionen   save.js  → localStorage, Prüfung fremder Stände
 *   clock.js → Zeitsteuerung (ohne DOM)  sim.js   → Spiellogik (ohne DOM)
 *   data.js  → Tabellen und Konstanten   state.js → gemeinsamer Zustand   util.js → Hilfsfunktionen
 *   galaxy.js → Galaxie aus dem Seed     scenarios.js → Testspielstände (über bot.js, den Spieler des Bots)
 */
import { S } from './state.js';
import { newGame, hooks, log } from './sim.js';
import { advance } from './clock.js';
import { renderUI, toast } from './ui.js';
import { load, initAutosave, hasBackup } from './save.js';

hooks.notify = toast;

let last = performance.now();
/**
 * Läuft einmal pro Bildschirm-Frame: Spielzeit voranbringen, Oberfläche aktualisieren. Echtzeit wird auf
 * 0,25 s pro Frame begrenzt, damit nach längerer Inaktivität (Tab im Hintergrund) kein großer Zeitsprung
 * entsteht. Die Schleife läuft auf jeden Fall weiter; Simulation und Anzeige sind getrennt abgesichert
 * (Simulation hält bei einem Fehler an, damit der Autosave keinen halben Schritt überschreibt).
 */
function frame(now) {
  try {
    const dtReal = Math.min(.25, (now - last) / 1000);
    last = now;
    try {
      const stopped = advance(dtReal);
      if (stopped) toast(stopped);
    } catch (e) { S.speed = 0; report(e, 'Fehler in der Simulation – angehalten'); }
    try { renderUI(false); } catch (e) { report(e, 'Fehler in der Anzeige'); }
  } finally { requestAnimationFrame(frame); }
}

/** Fehler melden: Konsole und Kurzmeldung, je Fehlertext höchstens alle 10 s. */
const lastReport = new Map();
function report(e, text) {
  const key = String(e), t = performance.now();
  if (t - (lastReport.get(key) ?? -Infinity) < 10000) return;
  lastReport.set(key, t);
  console.error(e);
  try { toast(text); } catch (x) { /* Kurzmeldung selbst kaputt: Konsole reicht */ }
}

// Start: Spielstand laden oder neues Spiel
const loaded = load();
if (loaded !== 'ok') {
  newGame();
  // Ein vorhandener, aber nicht ladbarer Autosave wurde von load() gesichert.
  const why = { outdated: 'passt nicht mehr zur neuen Spielversion', newer: 'stammt aus einer neueren Spielversion', invalid: 'ist beschädigt' }[loaded];
  if (why) log(`Der letzte Spielstand ${why} – es beginnt ein neues Spiel.` + (hasBackup() ? ' Der alte Stand ist gesichert.' : ' Er konnte nicht gesichert werden.'), 'warn');
}
initAutosave();
renderUI(true);
requestAnimationFrame(frame);
