// Haalt landelijke listprijzen voor diesel op bij Zweedse ketens en schrijft ze
// naar listprices.json. Draait drie keer per dag via GitHub Actions.
// Circle K en Preem publiceren geen prijzen meer voor particulieren, wel hun
// listprijs voor zakelijke tankkaarten; die gebruiken we als richtprijs.

import fs from 'node:fs/promises';

// label: de productnaam op de pagina; de eerste prijs erna is de dieselprijs.
export const SOURCES = [
  { country: 'SE', brand: 'St1', currency: 'SEK', url: 'https://st1.se/foretag/listpris',
    label: /(?<![A-Za-z0-9+])Diesel(?!\s*(?:HVO|Bio))/i, min: 10, max: 40 },
  { country: 'SE', brand: 'Circle K', currency: 'SEK', url: 'https://www.circlek.se/foretag/drivmedel/priser',
    label: /(?<![+\w])miles diesel/i, min: 10, max: 40 },
  { country: 'SE', brand: 'Preem', currency: 'SEK', url: 'https://www.preem.se/foretag/listpriser/',
    label: /Evolution Diesel/i, min: 10, max: 40 },
  { country: 'SE', brand: 'OKQ8', currency: 'SEK', url: 'https://www.okq8.se/foretag/priser/',
    label: /GoEasy Diesel(?!\s*(?:Extra|\())/i, min: 10, max: 40 },
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

function plainText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
}

// De pagina noemt ook andere data (bijv. een belastingwijziging); de prijsdatum
// is de nieuwste die niet in de toekomst ligt.
function newestDate(text) {
  const today = new Date().toISOString().slice(0, 10);
  const swedish = [...text.matchAll(/(\d{1,2})\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s+(20\d{2})/gi)]
    .map(d => `${d[3]}-${String(MONTHS[d[2].toLowerCase()]).padStart(2, '0')}-${d[1].padStart(2, '0')}`);
  const iso = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(d => d[1]);
  return [...swedish, ...iso].filter(d => d <= today).sort().at(-1) || null;
}

export function parseDieselPrice(html, min, max, label = /(?<![A-Za-z0-9+])Diesel(?!\s*(?:HVO|Bio))/i) {
  const text = plainText(html);
  const g = new RegExp(label.source, label.flags.includes('g') ? label.flags : label.flags + 'g');
  // Eerst in de zichtbare tekst, dan in de ruwe pagina (bijv. JSON-data).
  for (const source of [text, html]) {
    for (const m of source.matchAll(g)) {
      const after = source.slice(m.index + m[0].length, m.index + m[0].length + 160);
      const p = after.match(/^[^0-9]{0,80}?(\d{2}[,.]\d{2,3})(?!\d)/);
      if (!p) continue;
      const v = parseFloat(p[1].replace(',', '.'));
      if (v >= min && v <= max) return { price: v, date: newestDate(source) };
    }
  }
  return null;
}

async function main() {
  const file = new URL('../listprices.json', import.meta.url);
  let current = {};
  try { current = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
  const prices = { ...(current.prices || {}) };
  let failures = 0;

  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { headers: { 'User-Agent': 'goedkoop-diesel (github.com/Toru222222/goedkoop-diesel)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      if (process.env.DEBUG) {
        const plain = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ');
        for (const m of [...plain.matchAll(/diesel/gi)].slice(0, 8)) console.log('TEXT>', plain.slice(Math.max(0, m.index - 150), m.index + 200));
        for (const m of [...html.matchAll(/diesel/gi)].slice(0, 8)) console.log('RAW>', html.slice(Math.max(0, m.index - 100), m.index + 160).replace(/\s+/g, ' '));
      }
      const found = parseDieselPrice(html, s.min, s.max, s.label);
      if (!found) throw new Error('geen dieselprijs gevonden op de pagina');
      prices[`${s.country}:${s.brand}`] = {
        country: s.country, brand: s.brand, currency: s.currency, fuel: 'diesel',
        price: found.price, date: found.date, source: s.url, fetchedAt: new Date().toISOString(),
      };
      console.log(`${s.brand}: ${found.price} ${s.currency} (${found.date || 'geen datum'})`);
    } catch (err) {
      failures++;
      console.error(`${s.brand}: ${err.message}`);
    }
  }

  await fs.writeFile(file, JSON.stringify({ updatedAt: new Date().toISOString(), prices }, null, 2) + '\n');
  if (failures === SOURCES.length) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
