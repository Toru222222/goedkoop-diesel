// Haalt open overheidsdata met dieselprijzen per station op en schrijft per land
// een bestand naar out/<LAND>.json. Draait elk uur via GitHub Actions; de bestanden
// komen op de branch "prices" en de app leest ze via raw.githubusercontent.com.
//
// Formaat: { country, currency, source, updatedAt, stations: [[id, naam, merk, adres, lat, lon, prijs, tijd]] }

import fs from 'node:fs/promises';

const UA = { 'User-Agent': 'goedkoop-diesel (github.com/Toru222222/goedkoop-diesel)' };
const DEBUG = !!process.env.DEBUG;
const round = (v, d = 5) => Math.round(v * 10 ** d) / 10 ** d;
const num = v => (v == null || v === '' ? NaN : parseFloat(String(v).replace(',', '.')));

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} voor ${url}`);
  return as === 'json' ? res.json() : res.text();
}

const SOURCES = {
  // Frankrijk: prix-carburants (data.economie.gouv.fr), elke 10 minuten bijgewerkt
  async FR() {
    const url = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json?select=' +
      encodeURIComponent('id,adresse,ville,geom,gazole_prix,gazole_maj') + '&where=' + encodeURIComponent('gazole_prix is not null');
    const rows = await get(url);
    if (DEBUG) console.log('FR voorbeeld', JSON.stringify(rows[0]));
    return {
      currency: 'EUR', source: 'prix-carburants.gouv.fr',
      stations: rows.map(r => [`fr:${r.id}`, '', '', [r.adresse, r.ville].filter(Boolean).join(', '),
        r.geom?.lat, r.geom?.lon, num(r.gazole_prix), r.gazole_maj ? Date.parse(r.gazole_maj) : null]),
    };
  },

  // Spanje: Geoportal Gasolineras (Ministerie), elke 30 minuten bijgewerkt
  async ES() {
    const j = await get('https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/');
    const rows = j.ListaEESSPrecio || [];
    if (DEBUG) console.log('ES voorbeeld', JSON.stringify(rows[0]), j.Fecha);
    const m = (j.Fecha || '').match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2})/);
    const ts = m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:00+01:00`) : Date.now();
    return {
      currency: 'EUR', source: 'geoportalgasolineras.es',
      stations: rows.map(r => [`es:${r.IDEESS}`, r['Rótulo'] || '', r['Rótulo'] || '',
        [r['Dirección'], r.Localidad || r.Municipio].filter(Boolean).join(', '),
        num(r.Latitud), num(r['Longitud (WGS84)']), num(r['Precio Gasoleo A']), ts]),
    };
  },

  // Italië: Osservaprezzi carburanti (MIMIT), dagelijks om 8 uur
  async IT() {
    const [prices, stations] = await Promise.all([
      get('https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv', 'text'),
      get('https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv', 'text'),
    ]);
    const rows = t => t.split(/\r?\n/).filter(Boolean).map(l => l.split(l.includes('|') ? '|' : ';'));
    const p = rows(prices), a = rows(stations);
    if (DEBUG) console.log('IT voorbeeld', p.slice(0, 3), a.slice(0, 3));
    const best = new Map(); // goedkoopste "Gasolio" per station, self-service bij voorkeur
    for (const r of p) {
      if (!/^gasolio$/i.test((r[1] || '').trim())) continue;
      const v = num(r[2]);
      if (!(v > 0)) continue;
      const self = r[3] === '1';
      const cur = best.get(r[0]);
      if (!cur || (self && !cur.self) || (self === cur.self && v < cur.v)) best.set(r[0], { v, self, d: r[4] });
    }
    const parseDate = d => {
      const m = (d || '').match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
      return m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+01:00`) : null;
    };
    const out = [];
    for (const r of a) {
      const b = best.get(r[0]);
      if (!b) continue;
      out.push([`it:${r[0]}`, r[4] || '', r[2] || '', [r[5], r[6]].filter(Boolean).join(', '), num(r[8]), num(r[9]), b.v, parseDate(b.d)]);
    }
    return { currency: 'EUR', source: 'mimit.gov.it (Osservaprezzi)', stations: out };
  },

  // Oostenrijk: Spritpreisrechner van E-Control (api.e-control.at/sprit/1.0/doc).
  // Per district; volgens de wet krijgen alleen de goedkoopste stations een prijs.
  async AT() {
    const base = 'https://api.e-control.at/sprit/1.0';
    const regions = await get(`${base}/regions`);
    const districts = regions.flatMap(r => r.subRegions || []).filter(d => d.type === 'PB');
    if (DEBUG) console.log('AT districten', districts.length, JSON.stringify(districts[0]));
    const seen = new Map();
    for (const d of districts) {
      try {
        const list = await get(`${base}/search/gas-stations/by-region?code=${d.code}&type=PB&fuelType=DIE&includeClosed=false`);
        if (DEBUG && !seen.size) console.log('AT voorbeeld', JSON.stringify(list[0]));
        for (const s of list) {
          const p = (s.prices || []).find(x => x.fuelType === 'DIE');
          if (!p || seen.has(s.id)) continue;
          const l = s.location || {};
          seen.set(s.id, [`at:${s.id}`, s.name || '', '', [l.address, [l.postalCode, l.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
            num(l.latitude), num(l.longitude), num(p.amount), Date.now()]);
        }
      } catch (err) {
        console.log(`  AT district ${d.code}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    return { currency: 'EUR', source: 'E-Control Spritpreisrechner', stations: [...seen.values()] };
  },

  // Verenigd Koninkrijk: open prijsfeeds van de ketens (CMA-regeling), prijzen in pence
  async GB() {
    const feeds = [
      'https://storelocator.asda.com/fuel_prices_data.json',
      'https://www.bp.com/en_gb/united-kingdom/home/fuelprices/fuel_prices_data.json',
      'https://fuelprices.esso.co.uk/latestdata.json',
      'https://jetlocal.co.uk/fuel_prices_data.json',
      'https://www.morrisons.com/fuel-prices/fuel.json',
      'https://moto-way.com/fuel-price/fuel_prices.json',
      'https://fuel.motorfuelgroup.com/fuel_prices_data.json',
      'https://www.rontec-servicestations.co.uk/fuel-prices/data/fuel_prices_data.json',
      'https://api.sainsburys.co.uk/v1/exports/latest/fuel_prices_data.json',
      'https://www.tesco.com/fuel_prices/fuel_prices_data.json',
      'https://applegreenstores.com/fuel-prices/data.json',
      'https://www.sgnretail.uk/files/data/SGN_daily_fuel_prices.json',
    ];
    const out = [];
    for (const url of feeds) {
      try {
        const j = await get(url);
        const m = (j.last_updated || '').match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
        const ts = m ? Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00Z`) : Date.now();
        let n = 0;
        for (const s of j.stations || []) {
          const pence = num(s.prices?.B7);
          if (!(pence > 0)) continue;
          out.push([`gb:${s.brand}:${s.site_id}`, '', s.brand || '', [s.address, s.postcode].filter(Boolean).join(', '),
            num(s.location?.latitude), num(s.location?.longitude), pence > 20 ? pence / 100 : pence, ts]);
          n++;
        }
        console.log(`  GB ${new URL(url).host}: ${n}`);
      } catch (err) {
        console.log(`  GB ${new URL(url).host}: ${err.message}`);
      }
    }
    return { currency: 'GBP', source: 'open prijsfeeds van de ketens (CMA)', stations: out };
  },
};

const LIMITS = { EUR: [0.5, 4], GBP: [0.5, 3.5] };

await fs.mkdir(new URL('../out/', import.meta.url), { recursive: true });
const only = process.argv.slice(2);
let ok = 0;
for (const [cc, fn] of Object.entries(SOURCES)) {
  if (only.length && !only.includes(cc)) continue;
  try {
    const r = await fn();
    const [lo, hi] = LIMITS[r.currency];
    const stations = r.stations
      // Prijzen ouder dan 14 dagen zijn niet meer actueel (bijv. gesloten stations).
      .filter(s => Number.isFinite(s[4]) && Number.isFinite(s[5]) && s[6] >= lo && s[6] <= hi && !(s[7] < Date.now() - 14 * 864e5))
      .map(s => [s[0], s[1], s[2], s[3], round(s[4]), round(s[5]), round(s[6], 3), s[7]]);
    if (!stations.length) throw new Error('geen stations met dieselprijs');
    await fs.writeFile(new URL(`../out/${cc}.json`, import.meta.url),
      JSON.stringify({ country: cc, currency: r.currency, source: r.source, updatedAt: new Date().toISOString(), stations }));
    console.log(`${cc}: ${stations.length} stations`);
    ok++;
  } catch (err) {
    console.error(`${cc}: ${err.message}`);
  }
}
if (!ok) process.exit(1);
