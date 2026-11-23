/**
 * input.js – Gesten auf der Karte (#13). Übernommen aus Replikator (js/input.js), angepasst an die Stufen.
 *
 * Pointer Events decken Maus und Touch gemeinsam ab:
 *   Galaxie: 1 Finger ziehen = verschieben, 2 Finger = zoomen; ganz hineinzoomen nahe einem bekannten Stern
 *            öffnet seine Systemstufe; Mausrad = zoomen (am PC); kurzer Tipp = Stern wählen.
 *   System:  2 Finger zusammen bzw. Mausrad heraus = zurück zur Galaxie; Tipp auf einen Ort der aktiven Front =
 *            Stufe Ort. Ort: 2 Finger zusammen = zurück zum System.
 * Die Listener werden beim Import dieses Moduls registriert (nur im Browser).
 */
import { UI } from './state.js';
import { $ } from './util.js';
import { zoomAt, starNear, Z_MAX, ortNear } from './map.js';
import { isKnown, isLive } from './view.js';
import { tapStar, openSystem, act } from './ui.js';

const el = $('#map');
const ptrs = new Map();     // aktive Pointer: id → letzte Position
let downAt = null, moved = false, pinch = 1;

/** Position relativ zur Kartenfläche. */
const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

/**
 * Zoom in der Galaxie um Faktor f am Punkt p. Am nächsten Zoom angekommen und weiter hinein: Liegt ein bekannter
 * Stern unter dem Punkt, öffnet sich seine Systemstufe.
 */
function zoom(f, p) {
  if (UI.level !== 'galaxy') {
    pinch *= f;
    if (pinch < .75) { pinch = 1; act('out'); }   // eine Stufe heraus
    return;
  }
  if (f > 1 && UI.cam.z >= Z_MAX - 1e-9) {
    const s = starNear(p.x, p.y, 60);
    if (s !== null && isKnown(s)) { openSystem(s); return; }
  }
  zoomAt(f, p.x, p.y);
  UI.dirty = true;
}

el.addEventListener('pointerdown', e => {
  el.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, local(e));
  if (ptrs.size === 1) { downAt = local(e); moved = false; pinch = 1; }
  else moved = true;  // zweiter Finger: kein Tipp mehr möglich
});

el.addEventListener('pointermove', e => {
  const prev = ptrs.get(e.pointerId);
  if (!prev) return;
  const p = local(e);
  if (ptrs.size === 1) {
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 8) moved = true;   // ab 8 px Ziehen statt Tipp
    if (UI.level === 'galaxy') { UI.cam.x -= (p.x - prev.x) / UI.cam.z; UI.cam.y -= (p.y - prev.y) / UI.cam.z; UI.dirty = true; }
    ptrs.set(e.pointerId, p);
  } else if (ptrs.size === 2) {
    // Pinch: Abstand und Mittelpunkt der zwei Finger vorher/nachher vergleichen
    const [a, b] = [...ptrs.values()];
    const oldD = Math.hypot(a.x - b.x, a.y - b.y), oldM = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    ptrs.set(e.pointerId, p);
    const [c, d] = [...ptrs.values()];
    const newD = Math.hypot(c.x - d.x, c.y - d.y), newM = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    if (UI.level === 'galaxy') { UI.cam.x -= (newM.x - oldM.x) / UI.cam.z; UI.cam.y -= (newM.y - oldM.y) / UI.cam.z; }
    if (oldD > 0) zoom(newD / oldD, newM);
  }
});

/** Ende einer Berührung; ein kurzer Tipp wählt in der Galaxie einen Stern, im System der aktiven Front einen Ort. */
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  if (ptrs.size === 1 && !moved && e.type === 'pointerup') {
    const p = local(e);
    if (UI.level === 'galaxy') tapStar(starNear(p.x, p.y));
    else if (UI.level === 'system' && isLive(UI.sys)) { const o = ortNear(UI.sys, p.x, p.y); if (o !== null) act('ort:' + o); }
  }
  ptrs.delete(e.pointerId);
}
el.addEventListener('pointerup', endPtr);
el.addEventListener('pointercancel', endPtr);

// Mausrad am PC
el.addEventListener('wheel', e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), local(e)); }, { passive: false });
