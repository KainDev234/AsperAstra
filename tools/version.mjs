/**
 * tools/version.mjs – Versionsangaben gegen veraltete Dateien im Zwischenspeicher (#15). Ohne Abhängigkeiten.
 *
 * Aufruf:  node tools/version.mjs          schreibt die Versionen in index.html
 *          (tools/test.mjs prüft, dass sie stimmen – nach jeder Änderung an js/ oder css/ hier einmal aufrufen)
 *
 * GitHub Pages lässt jede Datei 10 Minuten im Zwischenspeicher. Ohne Versionsangabe mischt ein Browser nach einem
 * Merge alte und neue Dateien. Deshalb hängt an jeder Adresse ?v=<Prüfsumme des Inhalts>:
 *   - Stylesheet und Hauptskript direkt im <link> bzw. <script>,
 *   - alle Module über eine Import-Map: Auch relative Importe wie './sim.js' laufen über sie.
 * Die Prüfsumme wird über den Inhalt mit Unix-Zeilenenden gebildet, damit sie unter Windows (CRLF im Arbeitsordner)
 * und im Repository (LF) gleich ist.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);

/** Prüfsumme (8 Hex-Zeichen) einer Datei relativ zum Projektordner, Zeilenenden vereinheitlicht. */
export function fileHash(rel) {
  const text = readFileSync(new URL(rel, ROOT), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** Alle Module in js/ (ohne package.json), sortiert. */
export const modules = () => readdirSync(new URL('js/', ROOT)).filter(f => f.endsWith('.js')).sort().map(f => 'js/' + f);

/** Die Import-Map als JSON-Text: "./js/x.js" → "./js/x.js?v=…". */
export function importMap() {
  const imports = {};
  for (const m of modules()) imports['./' + m] = `./${m}?v=${fileHash(m)}`;
  return JSON.stringify({ imports }, null, 1).replace(/\n\s*/g, ' ');
}

/** index.html mit aktuellen Versionen (Import-Map, Stylesheet, Hauptskript). */
export function versionedHtml(html) {
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  return html
    .replace(/<script type="importmap">[^<]*<\/script>/, `<script type="importmap">${importMap()}</script>`)
    .replace(/href="css\/style\.css(\?v=[0-9a-f]*)?"/, `href="css/style.css?v=${fileHash('css/style.css')}"`)
    .replace(/src="js\/main\.js(\?v=[0-9a-f]*)?"/, `src="js/main.js?v=${fileHash('js/main.js')}"`)
    .replace(/\r?\n/g, nl);
}

// Als Skript aufgerufen: index.html neu schreiben
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = new URL('index.html', ROOT), old = readFileSync(file, 'utf8'), neu = versionedHtml(old);
  if (neu === old) console.log('index.html ist aktuell.');
  else { writeFileSync(file, neu); console.log('index.html aktualisiert.'); }
}
