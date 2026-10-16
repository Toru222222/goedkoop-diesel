// Databronnen. Stations komen wereldwijd uit OpenStreetMap; prijzen komen uit
// een landspecifieke bron als die bestaat, en anders uit meldingen van gebruikers.
// Een nieuw land toevoegen = een regel in COUNTRIES, en eventueel een provider.

export const COUNTRIES = {
  SE: { name: 'Zweden', currency: 'SEK', unit: 'kr', min: 10, max: 40,
        note: 'Zweden heeft geen open prijsdata per station. Prijzen hier zijn gemeld door gebruikers: scan of typ de prijs als je langs een station rijdt.' },
  NO: { name: 'Noorwegen', currency: 'NOK', unit: 'kr', min: 10, max: 40,
        note: 'Noorwegen heeft geen open prijsdata per station. Prijzen hier zijn gemeld door gebruikers.' },
  DK: { name: 'Denemarken', currency: 'DKK', unit: 'kr', min: 8, max: 30 },
  FI: { name: 'Finland', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  NL: { name: 'Nederland', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  BE: { name: 'België', currency: 'EUR', unit: '€', min: 1, max: 3.5 },
  DE: { name: 'Duitsland', currency: 'EUR', unit: '€', min: 1, max: 3.5, provider: 'tankerkoenig',
        note: 'Duitsland: live prijzen via Tankerkönig (gratis API-sleutel nodig, zie README).' },
  FR: { name: 'Frankrijk', currency: 'EUR', unit: '€', min: 1, max: 3.5, provider: 'france',
        note: 'Frankrijk: live prijzen uit de open data van de Franse overheid.' },
  GB: { name: 'Verenigd Koninkrijk', currency: 'GBP', unit: '£', min: 1, max: 3 },
};
export const DEFAULT_COUNTRY = { name: '', currency: '', unit: '', min: 0.3, max: 400 };

export function countryInfo(code) {
  return COUNTRIES[code] || { ...DEFAULT_COUNTRY, name: code || 'onbekend' };
}

// ---- Geocoding (OpenStreetMap Nominatim) ----

export async function geocode(query) {
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
  if (!res.ok) throw new Error('Zoeken mislukt (' + res.status + ')');
  const [hit] = await res.json();
  if (!hit) return null;
  return {
    lat: +hit.lat, lon: +hit.lon,
    label: hit.display_name.split(',').slice(0, 2).join(','),
    country: (hit.address?.country_code || '').toUpperCase(),
  };
}

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'nl' } });
  if (!res.ok) return { label: '', country: '' };
  const j = await res.json();
  const a = j.address || {};
  return {
    label: a.city || a.town || a.village || a.municipality || '',
    country: (a.country_code || '').toUpperCase(),
  };
}

// ---- Stations (OpenStreetMap Overpass) ----

const OVERPASS = 'https://overpass-api.de/api/interpreter';

export async function fetchStations(lat, lon, radius) {
  const q = `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radius},${lat},${lon});out center tags;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error('Stations ophalen mislukt (' + res.status + ')');
  const j = await res.json();
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
        lat: sLat, lon: sLon,
      };
    })
    .filter(Boolean);
}

// ---- Officiële prijsbronnen per land ----
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
  async france(lat, lon, radius) {
    const km = Math.round(radius / 1000);
    const where = `within_distance(geom, geom'POINT(${lon} ${lat})', ${km}km) and gazole_prix is not null`;
    const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?limit=100&where=' + encodeURIComponent(where);
    const j = await (await fetch(url)).json();
    return (j.results || []).map(r => ({
      id: 'fr:' + r.id,
      name: r.adresse ? `Station ${r.ville || ''}`.trim() : 'Station',
      brand: '',
      address: [r.adresse, r.ville].filter(Boolean).join(', '),
      lat: r.geom?.lat, lon: r.geom?.lon,
      price: +r.gazole_prix, ts: r.gazole_maj ? Date.parse(r.gazole_maj) : Date.now(),
      source: 'prix-carburants.gouv.fr',
    })).filter(s => s.lat != null);
  },
};

export async function fetchOfficialPrices(country, lat, lon, radius, settings) {
  const name = COUNTRIES[country]?.provider;
  if (!name) return [];
  return providers[name](lat, lon, radius, settings);
}
