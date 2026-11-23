/**
 * map.js – die zoombare Karte (#13) mit den Stufen Galaxie und System (die Stufe Ort folgt mit dem Bauen).
 *
 * Gezeichnet wird als SVG in Bildschirmkoordinaten: Die Kamera (UI.cam: Mittelpunkt in Lj, Zoom in px/Lj)
 * rechnet Lj in Pixel um, Punkte und Marken behalten so ihre Größe auf dem Bildschirm. In der Karte steht keine
 * Schrift (Zahlen als Pfade, icons.markPath); Namen und Werte zeigen die Blätter unten (ui.js).
 * Gezeichnet wird nur, was der Spieler weiß (view.js). Die Gesten stehen in input.js.
 */
import { S, UI } from './state.js';
import { CLASSES, ORTE } from './data.js';
import { $, clamp } from './util.js';
import { star, stars, sysOf } from './sim.js';
import { isKnown, isLive, reportOf, probesSeen, probePos } from './view.js';
import { icoAt, markPath } from './icons.js';

/** Zoom der Galaxie in px/Lj: weitester und nächster. */
export const Z_MIN = 3, Z_MAX = 40;
/** Farben: eigene Systeme, aktive Front, Auswahl. */
const OWN = '#5ec8ff', ME = '#ffd75e', SEL = '#cdd6e4';

/** Größe der Kartenfläche in px (im Browser aus dem Element, in Tests feste Werte). */
export function mapSize() {
  const r = $('#map').getBoundingClientRect ? $('#map').getBoundingClientRect() : null;
  return r && r.width ? { W: r.width, H: r.height } : { W: 375, H: 600 };
}

/** Lj → Bildschirm (px in der Kartenfläche). */
export function toScreen(x, y) {
  const { W, H } = mapSize(), c = UI.cam;
  return [(x - c.x) * c.z + W / 2, (y - c.y) * c.z + H / 2];
}
/** Bildschirm → Lj. */
export function toWorld(sx, sy) {
  const { W, H } = mapSize(), c = UI.cam;
  return [(sx - W / 2) / c.z + c.x, (sy - H / 2) / c.z + c.y];
}

/** Zoomt um Faktor f so, dass der Punkt unter (sx, sy) an seiner Stelle bleibt; begrenzt auf Z_MIN … Z_MAX. */
export function zoomAt(f, sx, sy) {
  const [wx, wy] = toWorld(sx, sy);
  UI.cam.z = clamp(UI.cam.z * f, Z_MIN, Z_MAX);
  const [nx, ny] = toWorld(sx, sy);
  UI.cam.x += wx - nx; UI.cam.y += wy - ny;
}

/** Stellt die Kamera auf Stern s (Zoom bleibt, außer z ist angegeben). */
export function centerOn(s, z) {
  UI.cam.x = star(s).x; UI.cam.y = star(s).y;
  if (z) UI.cam.z = clamp(z, Z_MIN, Z_MAX);
}

/** Nächster Stern zum Bildschirmpunkt (sx, sy) im Umkreis von r px, sonst null. */
export function starNear(sx, sy, r = 26) {
  let best = null, bd = r;
  for (const s of stars()) { const [x, y] = toScreen(s.x, s.y); const d = Math.hypot(x - sx, y - sy); if (d < bd) { bd = d; best = s.i; } }
  return best;
}

/** Zeichnet die Karte in der aktuellen Stufe neu. */
export function renderMap() {
  const { W, H } = mapSize();
  const body = UI.level === 'system' ? systemSvg(UI.sys, W, H) : galaxySvg(W, H);
  $('#map').innerHTML = `<svg width="${W}" height="${H}" class="mapsvg">${body}</svg>`;
}

/** Galaxie: Sonden im Flug, Sterne (unbekannte gedämpft), Ringe für eigene Systeme und die Front, Berichtsalter. */
function galaxySvg(W, H) {
  let h = '';
  const on = (x, y, m = 40) => x > -m && y > -m && x < W + m && y < H + m;
  for (const p of probesSeen()) {
    const [ax, ay] = toScreen(star(p.from).x, star(p.from).y), [bx, by] = toScreen(star(p.to).x, star(p.to).y);
    const q = probePos(p), [px, py] = toScreen(q.x, q.y);
    h += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="route"/>`
      + `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.5" class="probe"/>`;
  }
  const target = S.jump ? S.jump.to : null;
  for (const s of stars()) {
    const [x, y] = toScreen(s.x, s.y);
    if (!on(x, y)) continue;
    const r = 2 + CLASSES[s.cls].e * .35, known = isKnown(s.i);
    h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${CLASSES[s.cls].c}"${known ? '' : ' opacity=".45"'}/>`;
    if (known) h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}" class="ring" stroke="${isLive(s.i) ? ME : OWN}"/>`;
    if (s.i === target) h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 4).toFixed(1)}" class="ring dash" stroke="${ME}"/>`;
    if (UI.sel === s.i) h += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r + 9).toFixed(1)}" class="ring dash" stroke="${SEL}"/>`;
    // Plakette an fernen Fronten: Alter des letzten Berichts in Jahren („?“ = noch keiner)
    if (known && !isLive(s.i)) {
      const rep = reportOf(s.i), v = rep ? Math.round(S.year - rep.y) : '?';
      h += `<g class="badge">${markPath(x + r + 5, y - r - 2, v, 1.3)}</g>`;
    }
  }
  return h;
}

/**
 * System: der Stern links, die Orte nach außen in einer Reihe. Bekannte Orte mit ihren Bauplätzen; an der aktiven
 * Front live mit Gebäuden, Bauaufträgen und Bauern. Ferne Systeme zeigen nur die Orte (den Stand gibt das Blatt
 * aus dem Bericht).
 */
function systemSvg(s, W, H) {
  const st = star(s), cy = Math.round(H * .3);
  const orte = isKnown(s) ? st.orte : st.orte.slice(0, 1);
  const x0 = 30, step = orte.length > 1 ? (W - x0 - 24) / (orte.length - 1) : 0;
  const live = isLive(s), sys = live ? sysOf(s) : null;
  let h = `<line x1="${x0}" y1="${cy}" x2="${W - 16}" y2="${cy}" class="orbit"/>`;
  orte.forEach((o, i) => {
    const x = i ? x0 + i * step : x0;
    if (o.k === 'star') h += `<circle cx="${x}" cy="${cy}" r="14" fill="${CLASSES[st.cls].c}"/>`;
    else if (o.k === 'belt') for (let j = 0; j < 7; j++) h += `<circle cx="${(x + Math.cos(j * .9) * 8).toFixed(1)}" cy="${(cy + Math.sin(j * 1.7) * 7).toFixed(1)}" r="1.4" class="rock"/>`;
    else h += `<circle cx="${x}" cy="${cy}" r="${o.k === 'gas' ? 9 : 5.5}" class="${o.k}"/>`;
    // Bauplätze als Kästchen unter dem Ort: Gebäude, im Bau (halb gefüllt) oder frei
    const n = ORTE[o.k].slots, built = sys ? sys.b.filter(b => b.o === i) : [];
    const building = sys ? S.units.filter(u => u.s === s && u.job && u.job.a === 'build' && u.job.o === i) : [];
    for (let k = 0; k < n; k++) {
      const by = cy + 22 + k * 22, b = built[k], job = !b && building[k - built.length];
      h += `<rect x="${x - 9}" y="${by}" width="18" height="18" rx="3" class="slot${b ? ' full' : job ? ' wip' : ''}"/>`;
      if (b) h += icoAt(b.k, x, by + 9, 14) + (b.lv > 1 ? `<line x1="${x - 6}" y1="${by + 16}" x2="${x + 6}" y2="${by + 16}" class="lv"/>` : '');
      else if (job) h += `<g opacity=".55">${icoAt(job.k, x, by + 9, 14)}</g>`;
    }
    // Bauer über dem Ort: Sonde gold, Konstruktoren blau; auf Reisen am Ziel mit Pfeil
    if (sys) {
      const here = S.units.filter(u => u.s === s && (u.mv ? u.mv.o : u.o) === i);
      here.forEach((u, k) => {
        const uy = cy - 22 - k * 16;
        h += `<g class="unit ${u.k}${u.mv ? ' moving' : ''}">${icoAt(u.k === 'copy' ? 'probe' : 'cons', x, uy, 13)}</g>`;
      });
    }
  });
  return h;
}
