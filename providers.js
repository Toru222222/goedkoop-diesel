// Databronnen. Stations komen wereldwijd uit OpenStreetMap; prijzen komen uit
// een landspecifieke bron als die bestaat, en anders uit meldingen van gebruikers.
// Een nieuw land toevoegen = een regel in COUNTRIES, en eventueel een provider.

export const COUNTRIES = {
  SE: { name: 'Zweden', currency: 'SEK', unit: 'kr', min: 10, max: 40,
        note: 'Zweden heeft geen open prijsdata per station. Prijzen hier zijn gemeld door gebruikers: scan of typ de prijs als je langs een station rijdt.' },
  NO: { name: 'Noorwegen', currency: 'NOK', unit: 'kr', min: 10, max: 40,
        note: 'Noorwegen heeft geen open prijsdata per station, en de prijzen wisselen er meerdere keren per dag. Prijzen hier zijn gemeld door gebruikers.',
        externalSite: { name: 'Drivstoffapp', url: city => city
          ? 'https://www.drivstoffapp.no/search/' + encodeURIComponent(city)
          : 'https://www.drivstoffapp.no/' } },
  DK: { name: 'Denemarken', currency: 'DKK', unit: 'kr', min: 8, max: 30 },
  FI: { name: 'Finland', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  NL: { name: 'Nederland', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  BE: { name: 'België', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  DE: { name: 'Duitsland', currency: 'EUR', unit: '€', min: 1, max: 3.5, provider: 'tankerkoenig',
        note: 'Duitsland: live prijzen via Tankerkönig (gratis API-sleutel nodig, zie README).' },
  FR: { name: 'Frankrijk', currency: 'EUR', unit: '€', min: 1, max: 3.5, provider: 'opendata',
        note: 'Frankrijk: echte pompprijzen uit de open data van de Franse overheid.' },
  ES: { name: 'Spanje', currency: 'EUR', unit: '€', min: 0.8, max: 3, provider: 'opendata',
        note: 'Spanje: echte pompprijzen uit de open data van het Spaanse ministerie.' },
  IT: { name: 'Italië', currency: 'EUR', unit: '€', min: 1, max: 3.5, provider: 'opendata',
        note: 'Italië: echte pompprijzen uit de open data van de Italiaanse overheid (dagelijks om 8 uur).' },
  GB: { name: 'Verenigd Koninkrijk', currency: 'GBP', unit: '£', min: 1, max: 3, provider: 'opendata',
        note: 'Verenigd Koninkrijk: echte pompprijzen uit de open prijsfeeds van de grote ketens.' },
};
export const DEFAULT_COUNTRY = { name: '', currency: '', unit: '', min: 0.3, max: 400 };

export function countryInfo(code) {
  return COUNTRIES[code] || { ...DEFAULT_COUNTRY, name: code || 'onbekend' };
}

// ---- Geocoding (OpenStreetMap Nominatim) ----

export async function geocode(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=' + encodeURIComponent(query);
  let res;
  try { res = await fetch(url, { headers: { 'Accept-Language': 'nl' } }); }
  catch { throw new Error('Plaats zoeken mislukt: geen verbinding met de zoekdienst.'); }
  if (!res.ok) throw new Error('Plaats zoeken mislukt (' + res.status + ')');
  const [hit] = await res.json();
  if (!hit) return null;
  return {
    lat: +hit.lat, lon: +hit.lon,
    label: hit.display_name.split(',').slice(0, 2).join(','),
    country: (hit.address?.country_code || '').toUpperCase(),
  };
}

export async function reverseGeocode(lat, lon) {
  // Eerst Nominatim; lukt dat niet, dan BigDataCloud (gratis, zonder sleutel).
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
    if (res.ok) {
      const a = (await res.json()).address || {};
      const country = (a.country_code || '').toUpperCase();
      if (country) return { label: a.city || a.town || a.village || a.municipality || '', country };
    }
  } catch (err) { console.warn('Nominatim', err); }
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=nl`;
    const res = await fetch(url);
    if (res.ok) {
      const j = await res.json();
      return { label: j.city || j.locality || '', country: (j.countryCode || '').toUpperCase() };
    }
  } catch (err) { console.warn('BigDataCloud', err); }
  return { label: '', country: '' };
}

// ---- Stations (OpenStreetMap Overpass) ----

// De openbare Overpass-servers zijn soms overbelast of weigeren verzoeken,
// dus we proberen ze om de beurt en onthouden welke het laatst werkte.
const OVERPASS_SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const STATION_CACHE_KEY = 'diesel-stations-cache-v1';

async function queryOverpass(q) {
  let preferred = 0;
  try { preferred = +localStorage.getItem('diesel-overpass') || 0; } catch {}
  const order = [...OVERPASS_SERVERS.keys()].sort((a, b) => (b === preferred) - (a === preferred));
  const errors = [];
  for (const i of order) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(OVERPASS_SERVERS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!Array.isArray(j.elements)) throw new Error('onverwacht antwoord');
      try { localStorage.setItem('diesel-overpass', String(i)); } catch {}
      return j;
    } catch (err) {
      errors.push(`${new URL(OVERPASS_SERVERS[i]).host}: ${err.name === 'AbortError' ? 'time-out' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Kaartservers niet bereikbaar (' + errors.join('; ') + ')');
}

export async function fetchStations(lat, lon, radius) {
  const q = `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radius},${lat},${lon});out center tags;`;
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
  let j;
  try {
    j = await queryOverpass(q);
    try { localStorage.setItem(STATION_CACHE_KEY, JSON.stringify({ key: cacheKey, data: j })); } catch {}
  } catch (err) {
    // Lukt geen enkele Overpass-server: probeer Nominatim, en anders de laatst
    // opgehaalde stations voor deze plek.
    try {
      const viaSearch = await stationsViaNominatim(lat, lon, radius);
      if (viaSearch.length) return viaSearch;
    } catch (e2) { console.warn(e2); }
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(STATION_CACHE_KEY)); } catch {}
    if (cached?.key !== cacheKey) throw err;
    j = cached.data;
  }
  return j.elements
    .map(el => {
      const t = el.tags || {};
      const sLat = el.lat ?? el.center?.lat;
      const sLon = el.lon ?? el.center?.lon;
      if (sLat == null || t['fuel:diesel'] === 'no') return null;
      const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
      return {
        id: `osm:${el.type}/${el.id}`,
        name: t.name || t.brand || t.operator || 'Tankstation',
        brand: t.brand || '',
        address: [street, t['addr:city']].filter(Boolean).join(', '),
        country: (t['addr:country'] || '').toUpperCase(),
        lat: sLat, lon: sLon,
      };
    })
    .filter(Boolean);
}

// Reservebron: Nominatim kan ook op voorzieningstype zoeken binnen een kader.
async function stationsViaNominatim(lat, lon, radius) {
  const dLat = radius / 111320, dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
  const box = [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map(v => v.toFixed(5)).join(',');
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&amenity=fuel&bounded=1&limit=50&addressdetails=1&viewbox=${box}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  const hits = await res.json();
  return hits.map(h => {
    const a = h.address || {};
    const street = [a.road, a.house_number].filter(Boolean).join(' ');
    return {
      id: `osm:${h.osm_type}/${h.osm_id}`,
      name: h.name || 'Tankstation',
      brand: '',
      address: [street, a.city || a.town || a.village].filter(Boolean).join(', '),
      lat: +h.lat, lon: +h.lon,
    };
  });
}

// ---- Officiële prijsbronnen per land ----

const OPENDATA_URL = 'https://raw.githubusercontent.com/Toru222222/goedkoop-diesel/prices/';
const openDataCache = new Map();

function loadOpenData(country) {
  if (!openDataCache.has(country)) {
    const p = fetch(OPENDATA_URL + country + '.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error('Prijsbestand ' + country + ': HTTP ' + r.status); return r.json(); });
    p.catch(() => openDataCache.delete(country));
    openDataCache.set(country, p);
  }
  return openDataCache.get(country);
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Elke provider geeft stations mét prijs terug: {id, name, brand, address, lat, lon, price, ts, source}

const providers = {
  // Duitsland: https://creativecommons.tankerkoenig.de (CC BY 4.0), max straal 25 km
  async tankerkoenig(lat, lon, radius, settings) {
    const key = settings.tankerkoenigKey;
    if (!key) return [];
    const rad = Math.min(25, Math.round(radius / 1000));
    const url = `https://creativecommons.tankerkoenig.de/json/list.php?lat=${lat}&lng=${lon}&rad=${rad}&sort=dist&type=diesel&apikey=${encodeURIComponent(key)}`;
    const j = await (await fetch(url)).json();
    if (!j.ok) throw new Error('Tankerkönig: ' + (j.message || 'fout'));
    return j.stations.filter(s => s.price).map(s => ({
      id: 'tk:' + s.id,
      name: s.name, brand: s.brand || '',
      address: [s.street, s.houseNumber].filter(Boolean).join(' ') + (s.place ? ', ' + s.place : ''),
      lat: s.lat, lon: s.lng,
      price: s.price, ts: Date.now(), source: 'Tankerkönig',
    }));
  },

  // Frankrijk: prix-carburants (open data, data.economie.gouv.fr)
  // Landen met open data: een GitHub-taak zet elk uur een bestand per land klaar.
  async opendata(lat, lon, radius, settings, country) {
    const data = await loadOpenData(country);
    const km = radius / 1000;
    return data.stations
      .filter(s => distanceKm(lat, lon, s[4], s[5]) <= km)
      .map(([id, name, brand, address, sLat, sLon, price, ts]) => ({
        id, brand,
        name: name || brand || ('Station ' + (address.split(', ').at(-1) || '')).trim(),
        address, lat: sLat, lon: sLon, price, ts: ts || Date.parse(data.updatedAt), source: data.source,
      }));
  },

};

export async function fetchOfficialPrices(country, lat, lon, radius, settings) {
  const name = COUNTRIES[country]?.provider;
  if (!name) return [];
  return providers[name](lat, lon, radius, settings, country);
}
