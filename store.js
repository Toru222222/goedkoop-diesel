// Opslag van prijsmeldingen. Draait de app via server.js, dan worden meldingen
// gedeeld met iedereen die de app gebruikt. Anders blijven ze op dit apparaat.

const LS_KEY = 'diesel-reports-v1';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}
function writeLocal(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list.slice(-2000))); } catch {}
}

let mode = null; // 'server' | 'local'

export async function detectMode() {
  if (mode) return mode;
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    mode = res.ok ? 'server' : 'local';
  } catch { mode = 'local'; }
  return mode;
}

// Geeft de nieuwste melding per station terug: Map<stationId, report>
export async function latestReports(lat, lon, radius) {
  let list;
  if (await detectMode() === 'server') {
    const res = await fetch(`api/reports?lat=${lat}&lon=${lon}&radius=${radius}`, { cache: 'no-store' });
    list = res.ok ? await res.json() : [];
  } else {
    list = readLocal();
  }
  const latest = new Map();
  for (const r of list) {
    const cur = latest.get(r.stationId);
    if (!cur || r.ts > cur.ts) latest.set(r.stationId, r);
  }
  return latest;
}

export async function addReport(report) {
  if (await detectMode() === 'server') {
    const res = await fetch('api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    if (!res.ok) throw new Error('Opslaan mislukt: ' + (await res.text()));
    return res.json();
  }
  const list = readLocal();
  const saved = { ...report, ts: Date.now() };
  list.push(saved);
  writeLocal(list);
  return saved;
}
