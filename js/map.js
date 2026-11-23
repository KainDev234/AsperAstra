/**
 * map.js – die zoombare Karte (#13) mit den Stufen Galaxie, System und Ort (Ort nur an der aktiven Front).
 *
 * Gezeichnet wird als SVG in Bildschirmkoordinaten: Die Kamera (UI.cam: Mittelpunkt in Lj, Zoom in px/Lj)
 * rechnet Lj in Pixel um, Punkte und Marken behalten so ihre Größe auf dem Bildschirm. In der Karte steht keine
 * Schrift (Zahlen als Pfade, icons.markPath); Namen und Werte zeigen die Blätter unten (ui.js).
 * Gezeichnet wird nur, was der Spieler weiß (view.js). Die Gesten stehen in input.js.
 */
import { S, UI } from './state.js';
import { CLASSES, ORTE, BUILD, CONS } from './data.js';
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
  const body = UI.level === 'galaxy' ? galaxySvg(W, H) : systemSvg(UI.sys, W, H);   // Ortsstufe: System dahinter, Ort im Blatt
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
/** Lage der Orte in der Systemstufe: x je Ort (px) und die Höhe der Bahn. Gemeinsam für Zeichnen und Antippen. */
export function systemLayout(s, W, H) {
  const n = isKnown(s) ? star(s).orte.length : 1;
  const x0 = 30, step = n > 1 ? (W - x0 - 24) / (n - 1) : 0;
  return { xs: Array.from({ length: n }, (_, i) => x0 + i * step), cy: Math.round(H * .3), step };
}

/** Ort unter dem Bildschirmpunkt der Systemstufe (nächster in x, im oberen Teil der Karte), sonst null. */
export function ortNear(s, sx, sy) {
  const { W, H } = mapSize(), L = systemLayout(s, W, H);
  if (sy > L.cy + 22 + 3 * 22 + 20) return null;
  let best = null, bd = Math.max(16, L.step / 2);
  L.xs.forEach((x, i) => { const d = Math.abs(x - sx); if (d < bd) { bd = d; best = i; } });
  return best;
}

function systemSvg(s, W, H) {
  const st = star(s), L = systemLayout(s, W, H), cy = L.cy, x0 = L.xs[0];
  const orte = st.orte.slice(0, L.xs.length);
  const live = isLive(s), sys = live ? sysOf(s) : null;
  let h = `<line x1="${x0}" y1="${cy}" x2="${W - 16}" y2="${cy}" class="orbit"/>`;
  orte.forEach((o, i) => {
    const x = L.xs[i];
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

/** Fortschritt eines Auftrags (0 … 1) aus seiner Restzeit. */
const progress = j => 1 - Math.max(0, j.left) / (j.a === 'cons' || j.a === 'consup' ? CONS.time : BUILD[j.k].time);

/** Höhe der Ortsgrafik in px (oben im Ortsblatt). */
export const ORT_H = 136;

/**
 * Ort (nur aktive Front) als eigenständiges SVG für den Kopf des Ortsblatts: links der Körper groß, darunter die
 * Bauer, die hier stehen oder hierher reisen (halb durchsichtig); rechts die Bauplätze als große Felder mit
 * Gebäude, Stufe und Baufortschritt. Sie steht im Blatt und nicht auf der Karte, damit sich Grafik und Bedienung
 * bei keiner Bildschirmhöhe überdecken (Handytest zu #17). Bedienung: ortui.js.
 */
export function ortGraphic(s, o, W) {
  return `<svg width="${W}" height="${ORT_H}" class="mapsvg ortsvg">${ortSvg(s, o)}</svg>`;
}

function ortSvg(s, o) {
  const st = star(s), ort = st.orte[o], sys = sysOf(s), cx = 50, cy = 52;
  let h = '';
  if (ort.k === 'star') h += `<circle cx="${cx}" cy="${cy}" r="34" fill="${CLASSES[st.cls].c}"/>`;
  else if (ort.k === 'belt') for (let j = 0; j < 22; j++) h += `<circle cx="${(cx + Math.cos(j * 2.4) * (14 + j * 1.3)).toFixed(1)}" cy="${(cy + Math.sin(j * 2.4) * (8 + j * .6)).toFixed(1)}" r="${(1.5 + (j % 3) * .7).toFixed(1)}" class="rock"/>`;
  else h += `<circle cx="${cx}" cy="${cy}" r="${ort.k === 'gas' ? 32 : 22}" class="${ort.k}"/>`;
  // Bauplätze: Gebäude (Stufe II mit Strich, Ausbau mit Fortschrittsbalken), Bau mit Fortschritt, frei
  const n = ORTE[ort.k].slots, built = sys.b.filter(b => b.o === o), here = S.units.filter(u => u.s === s);
  const jobs = here.filter(u => u.job && u.job.o === o).map(u => u.job);
  const builds = jobs.filter(j => j.a === 'build'), ups = jobs.filter(j => j.a === 'up');
  const size = 48, gap = 12, left = 116, by = cy - size / 2;
  for (let k = 0; k < n; k++) {
    const x = left + k * (size + gap), b = built[k], job = !b && builds[k - built.length];
    h += `<rect x="${x}" y="${by}" width="${size}" height="${size}" rx="6" class="slot${b ? ' full' : job ? ' wip' : ''}"/>`;
    if (b) {
      h += icoAt(b.k, x + size / 2, by + size / 2, 32) + (b.lv > 1 ? `<line x1="${x + 12}" y1="${by + size - 6}" x2="${x + size - 12}" y2="${by + size - 6}" class="lv"/>` : '');
      const up = b.lv === 1 && ups.find(j => j.k === b.k);
      if (up) { ups.splice(ups.indexOf(up), 1); h += `<rect x="${x}" y="${by + size + 4}" width="${(size * progress(up)).toFixed(1)}" height="3" class="bar"/>`; }
    } else if (job) {
      h += `<g opacity=".55">${icoAt(job.k, x + size / 2, by + size / 2, 32)}</g><rect x="${x}" y="${by + size + 4}" width="${(size * progress(job)).toFixed(1)}" height="3" class="bar"/>`;
    }
  }
  // Bauer: hier oder auf dem Weg hierher (halb durchsichtig)
  here.filter(u => (u.mv ? u.mv.o : u.o) === o).forEach((u, k) => {
    h += `<g class="unit ${u.k}${u.mv ? ' moving' : ''}">${icoAt(u.k === 'copy' ? 'probe' : 'cons', cx - 26 + k * 26, cy + 64, 20)}</g>`;
  });
  return h;
}
