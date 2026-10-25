// Opslag van prijsmeldingen. Op volgorde van voorkeur:
//  1. Supabase (config.js ingevuld): gedeeld met iedereen, ook op GitHub Pages
//  2. server.js: gedeeld met iedereen die dezelfde server gebruikt
//  3. alleen op dit apparaat
// Een eigen melding wordt altijd ook lokaal bewaard, zodat hij zichtbaar blijft
// als de gedeelde opslag even niet bereikbaar is.

import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=11';

const LS_KEY = 'diesel-reports-v1';
const MAX_AGE_MS = 14 * 864e5;

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-2000))); } catch {}
}

let mode = null; // 'supabase' | 'server' | 'local'

export async function detectMode() {
  if (mode) return mode;
  if (SUPABASE_URL && SUPABASE_KEY) return (mode = 'supabase');
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    mode = res.ok ? 'server' : 'local';
  } catch { mode = 'local'; }
  return mode;
}

const sbHeaders = () => ({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json' });

async function readSupabase(lat, lon, radius) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const params = new URLSearchParams([
    ['select', 'station_id,name,lat,lon,country,currency,price,created_at'],
    ['lat', `gte.${lat - dLat}`], ['lat', `lte.${lat + dLat}`],
    ['lon', `gte.${lon - dLon}`], ['lon', `lte.${lon + dLon}`],
    ['created_at', `gte.${since}`],
    ['order', 'created_at.desc'], ['limit', '2000'],
  ]);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?${params}`, { headers: sbHeaders(), cache: 'no-store' });
  if (!res.ok) throw new Error('Gedeelde prijzen ophalen mislukt (' + res.status + ')');
  return (await res.json()).map(r => ({
    stationId: r.station_id, name: r.name, lat: r.lat, lon: r.lon,
    country: r.country, currency: r.currency, price: +r.price, ts: Date.parse(r.created_at),
  }));
}

async function writeSupabase(r) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({
      station_id: r.stationId, name: r.name, lat: r.lat, lon: r.lon,
      country: r.country, currency: r.currency, fuel: r.fuel, price: r.price,
    }),
  });
  if (!res.ok) throw new Error('Delen mislukt (' + res.status + '), prijs alleen op dit apparaat bewaard.');
}

// Geeft de nieuwste melding per station terug: Map<stationId, report>
export async function latestReports(lat, lon, radius) {
  let list = readLocal();
  const m = await detectMode();
  try {
    if (m === 'supabase') list = list.concat(await readSupabase(lat, lon, radius));
    if (m === 'server') {
      const res = await fetch(`api/reports?lat=${lat}&lon=${lon}&radius=${radius}`, { cache: 'no-store' });
      if (res.ok) list = list.concat(await res.json());
    }
  } catch (err) {
    console.warn(err);
  }
  const latest = new Map();
  for (const r of list) {
    const cur = latest.get(r.stationId);
    if (!cur || r.ts > cur.ts) latest.set(r.stationId, r);
  }
  return latest;
}

export async function addReport(report) {
  const saved = { ...report, ts: Date.now() };
  const list = readLocal();
  list.push(saved);
  writeLocal(list);

  // Lokaal is hij al bewaard; lukt delen niet, dan melden we dat zonder te falen.
  let shareError = null;
  try {
    const m = await detectMode();
    if (m === 'supabase') await writeSupabase(report);
    if (m === 'server') {
      const res = await fetch('api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (!res.ok) throw new Error('Delen mislukt (' + res.status + '), prijs alleen op dit apparaat bewaard.');
    }
  } catch (err) {
    shareError = err.message.startsWith('Delen') ? err.message : 'Delen mislukt, prijs alleen op dit apparaat bewaard.';
  }
  return { saved, shareError };
}
