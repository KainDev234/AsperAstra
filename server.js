/*
 * Minimaler statischer Webserver für AsperAstra – ohne npm-Abhängigkeiten.
 * Übernommen aus Replikator (server.js), unverändert bis auf die Namen.
 *
 * Start:   node server.js            (Standard-Port 8080)
 *          PORT=9000 node server.js  (anderer Port; unter PowerShell: $env:PORT=9000; node server.js)
 *
 * Der Server lauscht auf allen Netzwerkschnittstellen (0.0.0.0), damit ein Handy im selben
 * Heimnetz das Spiel öffnen kann. Er speichert nichts – der Spielstand liegt ausschließlich im
 * Browser des jeweiligen Geräts.
 *
 * Sicherheit (Replikator #32): Weil jedes Gerät im Netz Anfragen schicken kann, liefert der Server nur die
 * Dateien des Spiels aus (Positivliste: Startseite, css/, js/) – nicht .git/, .claude/, Doku oder
 * Werkzeuge. Fehlerhafte Anfragen werden mit einem Fehlercode beantwortet und dürfen den Prozess
 * nie beenden.
 *
 * Hinweis: Unter Windows muss das Netzwerkprofil "Privat" sein (bzw. Node.js in der Firewall
 * für das aktive Profil erlaubt), sonst kommen Zugriffe aus dem LAN nicht an.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.resolve(__dirname);

/**
 * Content-Types der Dateiendungen, die ausgeliefert werden. Dateien mit anderer Endung werden
 * gar nicht ausgeliefert (404), damit z. B. Notizen oder Spielstände im Ordner nie hinausgehen.
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Ordner unterhalb von ROOT, deren Inhalt ausgeliefert werden darf (Positivliste). */
const PUBLIC_DIRS = ['css', 'js'];
/** Einzeldateien direkt in ROOT, die ausgeliefert werden dürfen. */
const PUBLIC_FILES = ['index.html'];

/** Erlaubter Pfadteil: nur Buchstaben, Ziffern, Punkt, Binde- und Unterstrich, nicht mit Punkt beginnend. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/** Reservierte Windows-Gerätenamen (auch mit Endung, z. B. "con.js"), die nie als Datei gelten. */
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * Prüft den Anfragepfad und bildet daraus den Dateipfad.
 * @param {string} url  req.url, z. B. "/js/main.js?v=2"
 * @returns {{file: string}|{status: number}} Dateipfad oder HTTP-Fehlercode
 */
function resolveRequest(url) {
  // Query-String und Fragment abschneiden; Anfrageziele müssen mit "/" beginnen.
  const raw = url.split(/[?#]/)[0];
  if (!raw.startsWith('/')) return { status: 400 };

  // Prozent-Kodierung auflösen; ungültige Kodierung (z. B. "/%") wirft → 400 statt Absturz.
  let p;
  try { p = decodeURIComponent(raw); } catch (e) { return { status: 400 }; }
  // Nullbyte und Backslash haben in Spiel-Pfaden nichts zu suchen (Backslash wäre unter
  // Windows ein Pfadtrenner, an der Positivliste vorbei).
  if (p.includes('\0') || p.includes('\\')) return { status: 400 };

  if (p === '/') p = '/index.html';
  const parts = p.slice(1).split('/');
  // Jeder Pfadteil muss harmlos sein: keine leeren Teile ("//"), kein "." oder "..",
  // keine versteckten Dateien/Ordner, keine Windows-Gerätenamen.
  if (!parts.every(s => SEGMENT.test(s) && !DEVICE.test(s))) return { status: 404 };
  // Positivliste: entweder eine erlaubte Einzeldatei oder etwas unterhalb eines öffentlichen Ordners.
  const allowed = parts.length === 1 ? PUBLIC_FILES.includes(parts[0]) : PUBLIC_DIRS.includes(parts[0]);
  if (!allowed || !MIME[path.extname(p)]) return { status: 404 };

  // Zweite Sicherung unabhängig von den Prüfungen oben: Der Pfad muss innerhalb von ROOT liegen.
  const file = path.resolve(ROOT, ...parts);
  const rel = path.relative(ROOT, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { status: 403 };
  return { file };
}

/** Beantwortet eine Anfrage mit einem Fehlercode und kurzem Text. */
function fail(res, status) {
  const text = { 400: 'Ungültige Anfrage', 403: 'Verboten', 404: 'Nicht gefunden', 405: 'Methode nicht erlaubt', 500: 'Serverfehler' }[status] || 'Fehler';
  if (res.headersSent) return res.destroy();
  const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
  if (status === 405) headers.Allow = 'GET, HEAD';
  res.writeHead(status, headers);
  res.end(text);
}

/** Request-Handler: nur GET/HEAD, nur Dateien der Positivliste, jede Ausnahme wird abgefangen. */
function handle(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405);
    const r = resolveRequest(req.url || '');
    if (r.status) return fail(res, r.status);

    // Nur echte Dateien ausliefern (keine Ordner, Geräte o. Ä.). realpath löst Verknüpfungen
    // (Symlinks, Junctions) auf; der aufgelöste Pfad muss dieselbe Positivliste erfüllen wie der
    // Anfragepfad – sonst könnte eine Verknüpfung unter js/ auf andere Dateien zeigen.
    fs.realpath(r.file, guard(res, (err, real) => {
      if (err) return fail(res, 404);
      const rel = path.relative(ROOT, real);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return fail(res, 403);
      if (resolveRequest('/' + rel.split(path.sep).join('/')).status) return fail(res, 404);
      fs.stat(real, guard(res, (err2, st) => {
        if (err2 || !st.isFile()) return fail(res, 404);
        fs.readFile(real, guard(res, (err3, data) => {
          if (err3) return fail(res, 404);
          res.writeHead(200, {
            // Endung ist durch die Positivliste geprüft, der Typ also immer bekannt.
            'Content-Type': MIME[path.extname(real)],
            // no-cache: Das Handy fragt bei jedem Laden nach, ob es eine neue Version gibt.
            'Cache-Control': 'no-cache',
            // Browser sollen den Content-Type nicht erraten.
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(req.method === 'HEAD' ? undefined : data);
        }));
      }));
    }));
  } catch (e) {
    fail(res, 500);
  }
}

/**
 * Hüllt einen asynchronen Rückruf in try/catch: Das try/catch in handle() greift nur für den
 * synchronen Teil, eine Ausnahme in einem fs-Rückruf würde sonst den Prozess beenden.
 */
function guard(res, fn) {
  return (...args) => { try { fn(...args); } catch (e) { fail(res, 500); } };
}

// Export für Tests (require('./server.js') startet den Server nicht).
module.exports = { resolveRequest, handle };

if (require.main === module) {
  const server = http.createServer(handle);
  // Kaputte Verbindungen (z. B. abgebrochene oder fehlerhafte Anfragen) nur schließen, nie abstürzen.
  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); else socket.destroy(); });
  server.listen(PORT, '0.0.0.0', () => {
    // Beim Start alle Adressen ausgeben, unter denen das Spiel erreichbar ist.
    // (Nur auf der Konsole – die Adressen werden nirgends gespeichert.)
    console.log(`AsperAstra läuft auf Port ${PORT}`);
    console.log(`  Lokal:    http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  Netzwerk: http://${a.address}:${PORT}`);
      }
    }
  });
}
