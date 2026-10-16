// Haalt landelijke listprijzen voor diesel op bij ketens die ze nog publiceren
// en schrijft ze naar listprices.json. Draait dagelijks via GitHub Actions.
// Circle K en Preem publiceren sinds 2026 geen prijzen meer voor particulieren.

import fs from 'node:fs/promises';

const SOURCES = [
  { country: 'SE', brand: 'St1', currency: 'SEK', url: 'https://st1.se/foretag/listpris', min: 10, max: 40 },
];

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12 };

export function parseDieselPrice(html, min, max) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
  // "Diesel 22,940 kr" in de zichtbare tekst, anders in ruwe data (bijv. JSON in de pagina).
  const candidates = [
    ...text.matchAll(/(?<![A-Za-z0-9])Diesel(?!\s*(?:HVO|Bio))\s*[|:]?\s*(\d{2}[,.]\d{2,3})\s*kr/gi),
    ...html.matchAll(/"?Diesel"?[^0-9<>]{0,80}?(\d{2}[,.]\d{2,3})/gi),
  ];
  for (const m of candidates) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (v >= min && v <= max) {
      const d = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|maj|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s+(20\d{2})/i);
      const date = d ? `${d[3]}-${String(MONTHS[d[2].toLowerCase()]).padStart(2, '0')}-${d[1].padStart(2, '0')}` : null;
      return { price: v, date };
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
      const found = parseDieselPrice(await res.text(), s.min, s.max);
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
