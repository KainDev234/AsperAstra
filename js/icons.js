/**
 * icons.js – eigene Piktogramme und Ziffern als Linienzüge (#13), ohne DOM-Zugriff. Keine externen Dateien.
 *
 * Piktogramme: dünne Linien im 24er-Raster in `currentColor` (Farbe vom Umfeld). Konstruktor, Mine und Sonde
 * übernommen aus Replikator (js/icons.js), Kraftwerk, Werft und Sender neu.
 * Ziffern: In der zoombaren Karte steht keine Schrift, sondern Pfade (Lehre aus Replikator #209: mobile Browser
 * vergrößern Schrift dort eigenmächtig). Glyphen übernommen aus Replikator (ui.markPath).
 */

/** Linienpfade der Piktogramme im 24er-Raster. */
export const ICONS = {
  cons: 'M6 21V5M10 21V5M6 5h14M6 9l4-4M6 13l4-4M6 17l4-4M18 5v7M15.5 12h5l-1 3h-3z',
  mine: 'M3 16h6M15 16h6M9 3h6v6l-3 9-3-9zM9 9h6M5 20h2M11 21h2M17 20h2',
  power: 'M13 2L5 13h6l-1.5 9L18 10h-6.5z',
  werft: 'M3 21h18M5 21V11l7-5 7 5v10M9 21v-6h6v6M12 6V2',
  sender: 'M5 21h14M12 21v-8M6 8a6 6 0 0 0 12 0zM12 8V3M9 5l3-3 3 3',
  probe: 'M12 2.5l7 18-7-4-7 4z',
};

/**
 * Piktogramm k als eigenständiges SVG für HTML (Höhe wie die Schrift, Farbe vom Text).
 * @param {string} k Schlüssel in ICONS   @param {string} [cls] zusätzliche CSS-Klasse
 */
export const ico = (k, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`;

/**
 * Piktogramm k innerhalb einer SVG-Karte: Mittelpunkt (x, y), Kantenlänge size (px).
 */
export const icoAt = (k, x, y, size) =>
  `<path class="pic" d="${ICONS[k]}" transform="translate(${(x - size / 2).toFixed(1)} ${(y - size / 2).toFixed(1)}) scale(${(size / 24).toFixed(3)})"/>`;

/** Ziffern und „?“ als Linienzüge, 3,4 × 5,6 Einheiten über der Grundlinie (aus Replikator). */
const GLYPH = {
  0: 'M1.7-5.6C-.1-5.6-.1 0 1.7 0S3.5-5.6 1.7-5.6Z',
  1: 'M.5-4.5L1.8-5.6V0M.6 0H3',
  2: 'M.2-4.4C.3-6 3.2-6 3.2-4.1C3.2-2.8 .9-1.4 .2 0H3.3',
  3: 'M.2-5.6H3.1L1.4-3.4C3.8-3.6 3.8 0 1.6 0C.8 0 .3-.3 0-.8',
  4: 'M2.6 0V-5.6L0-1.6H3.4',
  5: 'M3.1-5.6H.4L.2-3.2C3.9-4.2 4.2 0 1.6 0C.8 0 .3-.3 0-.8',
  6: 'M2.8-5.4C.7-6.2-.3-3.4.2-1.2C.7.5 3.4.4 3.4-1.7C3.4-3.8.6-3.8.2-1.8',
  7: 'M.1-5.6H3.3L1.2 0',
  8: 'M1.7-3C-.3-3-.3-5.6 1.7-5.6S3.7-3 1.7-3C-.6-3-.6 0 1.7 0S4-3 1.7-3Z',
  9: 'M.6-.2C2.7.6 3.7-2.2 3.2-4.4C2.7-6.1 0-6 0-3.9C0-1.8 2.8-1.8 3.2-3.8',
  '?': 'M.3-4.4C.3-6 3.2-6 3.2-4.3C3.2-3 1.7-3.1 1.7-1.6M1.7-.1v.05',
};

/**
 * Zahl bzw. „?“ bei (x, y = Grundlinie) als Pfade, je Zeichen 4,8 Einheiten breit, mit Faktor k vergrößert.
 * Andere Zeichen werden ausgelassen.
 */
export function markPath(x, y, v, k = 1.6) {
  return [...String(v)].map((c, n) => GLYPH[c]
    ? `<path class="digit" transform="translate(${(x + (.7 + n * 4.8) * k).toFixed(1)} ${(+y).toFixed(1)}) scale(${k})" d="${GLYPH[c]}"/>`
    : '').join('');
}
