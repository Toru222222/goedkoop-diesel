// Kleine server zonder dependencies: serveert de app en bewaart prijsmeldingen
// in data/reports.json, zodat alle gebruikers elkaars meldingen zien.
// Starten: node server.js   (poort via PORT, standaard 8080)

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data', 'reports.json');
const PORT = +process.env.PORT || 8080;
const MAX_REPORTS = 50000;
const STATIC = new Set(['index.html', 'styles.css', 'app.js', 'providers.js', 'store.js', 'config.js', 'ocr.js', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'listprices.json']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.json': 'application/json' };

let reports = [];
try { reports = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); } catch {}

let saving = Promise.resolve();
function persist() {
  saving = saving.then(async () => {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(reports));
    await fs.rename(DATA_FILE + '.tmp', DATA_FILE);
  }).catch(err => console.error('Opslaan mislukt', err));
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limit) { reject(new Error('te groot')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function validReport(b) {
  const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  const str = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!str(b.stationId, 100) || !num(b.lat, -90, 90) || !num(b.lon, -180, 180) || !num(b.price, 0.1, 1000)) return null;
  return {
    stationId: b.stationId,
    name: str(b.name, 120) ? b.name : '',
    lat: b.lat, lon: b.lon,
    country: str(b.country, 2) ? b.country : '',
    currency: str(b.currency, 3) ? b.currency : '',
    fuel: 'diesel',
    price: Math.round(b.price * 1000) / 1000,
    ts: Date.now(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true });

    if (url.pathname === '/api/reports' && req.method === 'GET') {
      const lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon');
      const radiusKm = Math.min(+url.searchParams.get('radius') || 25000, 100000) / 1000;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return send(res, 400, { error: 'lat/lon nodig' });
      const near = reports.filter(r => distanceKm(lat, lon, r.lat, r.lon) <= radiusKm + 1);
      return send(res, 200, near);
    }

    if (url.pathname === '/api/reports' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, 'Ongeldige invoer', 'text/plain'); }
      const r = validReport(body || {});
      if (!r) return send(res, 400, 'Ongeldige melding', 'text/plain');
      reports.push(r);
      if (reports.length > MAX_REPORTS) reports = reports.slice(-MAX_REPORTS);
      persist();
      return send(res, 201, r);
    }

    if (req.method === 'GET') {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (STATIC.has(name)) {
        const file = await fs.readFile(path.join(ROOT, name));
        return send(res, 200, file, TYPES[path.extname(name)] || 'application/octet-stream');
      }
    }
    send(res, 404, 'Niet gevonden', 'text/plain');
  } catch (err) {
    console.error(err);
    send(res, 500, 'Serverfout', 'text/plain');
  }
});

server.listen(PORT, () => console.log(`Goedkoop Diesel draait op http://localhost:${PORT}`));
