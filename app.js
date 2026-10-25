import { countryInfo, geocode, reverseGeocode, fetchStations, fetchOfficialPrices } from './providers.js?v=7';
import { latestReports, addReport, detectMode } from './store.js?v=7';
import { readImageText, extractPrices } from './ocr.js?v=7';

const $ = id => document.getElementById(id);
const MAX_AGE_DAYS = 14; // oudere meldingen tellen niet mee

const state = {
  lat: null, lon: null, label: '', country: '',
  stations: [],
  reportFor: null,
  settings: loadSettings(),
};

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('diesel-settings')) || {}; } catch { return {}; }
}

function setStatus(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatPrice(p, country) {
  const c = countryInfo(country);
  const decimals = p < 5 ? 3 : 2;
  const num = p.toLocaleString('nl-NL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return c.unit === '€' || c.unit === '£' ? `${c.unit} ${num}` : `${num} ${c.unit}`.trim();
}

function timeAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'zojuist';
  if (min < 60) return `${min} min geleden`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} uur geleden`;
  const d = Math.round(h / 24);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
}

// ---- Locatie ----

function locate() {
  if (!navigator.geolocation) {
    setStatus('Je browser ondersteunt geen locatie. Zoek een plaats.', true);
    return;
  }
  setStatus('Locatie bepalen…');
  navigator.geolocation.getCurrentPosition(
    async pos => {
      const { latitude: lat, longitude: lon } = pos.coords;
      let place = { label: '', country: '' };
      try { place = await reverseGeocode(lat, lon); } catch {}
      setPlace(lat, lon, place.label || 'Je locatie', place.country);
    },
    err => setStatus(err.code === 1
      ? 'Locatie geweigerd. Zoek een plaats of sta locatie toe in je browser.'
      : 'Locatie niet gevonden. Zoek een plaats.', true),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
  );
}

async function search(e) {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (!q) return;
  setStatus('Zoeken…');
  try {
    const hit = await geocode(q);
    if (!hit) return setStatus(`"${q}" niet gevonden.`, true);
    setPlace(hit.lat, hit.lon, hit.label, hit.country);
  } catch (err) {
    setStatus(err.message, true);
  }
}

function setCountry(country) {
  state.country = country;
  const c = countryInfo(country);
  $('place').textContent = `📍 ${state.label}${c.name ? ' · ' + c.name : ''}`;
  if (c.note) { $('source-note').hidden = false; $('source-note').textContent = c.note; }
  try { localStorage.setItem('diesel-last-place', JSON.stringify({ lat: state.lat, lon: state.lon, label: state.label, country })); } catch {}
}

function setPlace(lat, lon, label, country) {
  Object.assign(state, { lat, lon, label, country });
  try { localStorage.setItem('diesel-last-place', JSON.stringify({ lat, lon, label, country })); } catch {}
  const c = countryInfo(country);
  $('place').textContent = `📍 ${label}${c.name ? ' · ' + c.name : ''}`;
  load();
}

// ---- Laden en samenvoegen ----

async function load() {
  const { lat, lon, country } = state;
  const radius = +$('radius').value;
  setStatus('Tankstations zoeken…');
  $('list').innerHTML = '';
  $('best').hidden = true;

  const c = countryInfo(country);
  $('source-note').hidden = !c.note;
  $('source-note').textContent = c.note || '';

  try {
    const [osm, official, reports, listPrices] = await Promise.all([
      fetchStations(lat, lon, radius),
      fetchOfficialPrices(country, lat, lon, radius, state.settings).catch(err => {
        console.warn(err); return [];
      }),
      latestReports(lat, lon, radius),
      fetchListPrices(),
    ]);
    // Land onbekend (bijv. omdat de adreszoeker faalde)? Neem dan het land dat de
    // meeste stations in OpenStreetMap hebben.
    if (!state.country) {
      const counts = {};
      for (const s of osm) if (s.country) counts[s.country] = (counts[s.country] || 0) + 1;
      const guess = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (guess) setCountry(guess);
    }
    const chainPrices = Object.values(listPrices).filter(p => !state.country || p.country === state.country);
    showListPriceNote(countryInfo(state.country), chainPrices);

    // Officiële stations hebben voorrang; OSM-stations op dezelfde plek vallen weg.
    const merged = [...official];
    for (const s of osm) {
      if (!official.some(o => distanceKm(o.lat, o.lon, s.lat, s.lon) < 0.08)) merged.push(s);
    }

    const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;
    for (const s of merged) {
      s.dist = distanceKm(lat, lon, s.lat, s.lon);
      const r = reports.get(s.id);
      if (r && r.ts > cutoff && (!s.price || r.ts > s.ts)) {
        s.price = r.price; s.ts = r.ts; s.source = 'melding';
      }
      if (s.price == null) s.listPrice = chainPrices.find(p => matchesBrand(s, p.brand));
    }
    // Eerst echte pompprijzen, dan richtprijzen van de keten, dan stations zonder prijs.
    const rank = s => s.price != null ? 0 : s.listPrice ? 1 : 2;
    const value = s => s.price ?? s.listPrice?.price ?? 0;
    merged.sort((a, b) => rank(a) - rank(b) || value(a) - value(b) || a.dist - b.dist);

    state.stations = merged;
    render();
    const priced = merged.filter(s => s.price != null).length;
    setStatus(merged.length
      ? `${merged.length} stations gevonden, ${priced} met dieselprijs.`
      : 'Geen tankstations gevonden binnen deze straal.');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Er ging iets mis bij het laden.', true);
  }
}

// ---- Richtprijzen van ketens (listprices.json, dagelijks bijgewerkt) ----

async function fetchListPrices() {
  try {
    const res = await fetch('listprices.json', { cache: 'no-store' });
    return res.ok ? (await res.json()).prices || {} : {};
  } catch { return {}; }
}

function matchesBrand(station, brand) {
  const re = new RegExp(`(^|[^a-z0-9])${brand.toLowerCase()}([^a-z0-9]|$)`);
  return re.test((station.brand || '').toLowerCase()) || re.test((station.name || '').toLowerCase());
}

function shortDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
}

function showListPriceNote(c, chainPrices) {
  if (!chainPrices.length) return;
  const parts = chainPrices.map(p => `${p.brand} ${formatPrice(p.price, state.country)}${p.date ? ' (' + shortDate(p.date) + ')' : ''}`);
  $('source-note').hidden = false;
  $('source-note').textContent = [c.note,
    `Landelijke listpris diesel: ${parts.join(', ')}. Aan de pomp is het meestal 0,5 tot 1,5 kr goedkoper.`]
    .filter(Boolean).join(' ');
}

// ---- Weergave ----

function navUrl(s) {
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
}

function render() {
  const list = $('list');
  list.innerHTML = '';
  const { country } = state;
  const cheapest = state.stations.find(s => s.price != null);

  if (cheapest) {
    $('best').hidden = false;
    $('best').innerHTML = '';
    const h = document.createElement('h2'); h.textContent = 'Goedkoopste diesel in de buurt';
    const big = document.createElement('div'); big.className = 'big'; big.textContent = formatPrice(cheapest.price, country);
    const who = document.createElement('div');
    who.textContent = `${cheapest.name} · ${cheapest.dist.toFixed(1)} km · ${timeAgo(cheapest.ts)}`;
    $('best').append(h, big, who);
  }

  for (const s of state.stations) {
    const li = document.createElement('li');
    li.className = 'station';
    li.innerHTML = `
      <div><div class="name"></div><div class="meta"></div></div>
      <div><div class="price"></div><div class="age"></div></div>
      <div class="actions">
        <button type="button" class="report">✏️ Prijs melden</button>
        <a class="nav" target="_blank" rel="noopener">🧭 Route</a>
      </div>`;
    li.querySelector('.name').textContent = s.name;
    li.querySelector('.meta').textContent =
      [s.brand && s.brand !== s.name ? s.brand : '', s.address, `${s.dist.toFixed(1)} km`].filter(Boolean).join(' · ');
    const price = li.querySelector('.price');
    if (s.price != null) {
      price.textContent = formatPrice(s.price, country);
      price.classList.toggle('cheapest', s === cheapest);
      li.querySelector('.age').textContent = `${timeAgo(s.ts)} · ${s.source}`;
    } else if (s.listPrice) {
      price.textContent = '≈ ' + formatPrice(s.listPrice.price, country);
      price.classList.add('list');
      li.querySelector('.age').textContent = `listpris ${s.listPrice.brand}${s.listPrice.date ? ' · ' + shortDate(s.listPrice.date) : ''}`;
    } else {
      price.textContent = 'geen prijs';
      price.classList.add('none');
    }
    li.querySelector('.nav').href = navUrl(s);
    li.querySelector('.report').addEventListener('click', () => openReport(s));
    list.append(li);
  }
}

// ---- Prijs melden / scannen ----

function openReport(station) {
  state.reportFor = station;
  const c = countryInfo(state.country);
  $('report-station').textContent = `${station.name}${station.address ? ' · ' + station.address : ''}`;
  $('report-currency').textContent = c.unit || 'lokale munt';
  $('report-price').value = '';
  $('scan-status').textContent = '';
  $('scan-candidates').innerHTML = '';
  $('report-dialog').showModal();
}

async function onScan(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const c = countryInfo(state.country);
  $('scan-candidates').innerHTML = '';
  $('scan-status').textContent = 'Foto lezen…';
  try {
    const text = await readImageText(file, p => { $('scan-status').textContent = `Foto lezen… ${p}%`; });
    const prices = extractPrices(text, c.min, c.max);
    if (!prices.length) {
      $('scan-status').textContent = 'Geen prijs herkend. Probeer dichterbij of typ de prijs.';
      return;
    }
    $('scan-status').textContent = 'Herkend. Tik op de dieselprijs:';
    for (const p of prices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = formatPrice(p, state.country);
      b.addEventListener('click', () => { $('report-price').value = String(p).replace('.', ','); });
      $('scan-candidates').append(b);
    }
    $('report-price').value = String(prices[0]).replace('.', ',');
  } catch (err) {
    $('scan-status').textContent = err.message;
  }
}

async function onSave(e) {
  e.preventDefault();
  const s = state.reportFor;
  const c = countryInfo(state.country);
  const price = parseFloat($('report-price').value.replace(',', '.'));
  if (!(price >= c.min && price <= c.max)) {
    $('scan-status').textContent = `Die prijs lijkt niet te kloppen (verwacht tussen ${c.min} en ${c.max}).`;
    return;
  }
  $('report-save').disabled = true;
  try {
    const { shareError } = await addReport({
      stationId: s.id, name: s.name, lat: s.lat, lon: s.lon,
      country: state.country, currency: c.currency, fuel: 'diesel', price,
    });
    $('report-dialog').close();
    await load();
    setStatus(shareError || `Bedankt! Prijs voor ${s.name} opgeslagen.`, !!shareError);
  } catch (err) {
    $('scan-status').textContent = err.message;
  } finally {
    $('report-save').disabled = false;
  }
}

// ---- Start ----

$('btn-locate').addEventListener('click', locate);
$('search-form').addEventListener('submit', search);
$('radius').addEventListener('change', () => state.lat != null && load());
$('scan-input').addEventListener('change', onScan);
$('report-form').addEventListener('submit', onSave);
$('report-cancel').addEventListener('click', () => $('report-dialog').close());

detectMode().then(m => {
  $('store-mode').textContent = m !== 'local'
    ? 'Meldingen worden gedeeld met alle gebruikers.'
    : 'Meldingen worden alleen op dit apparaat bewaard.';
});

try {
  const last = JSON.parse(localStorage.getItem('diesel-last-place'));
  if (last) {
    setPlace(last.lat, last.lon, last.label, last.country);
    // Eerder opgeslagen zonder land: probeer het land alsnog te bepalen.
    if (!last.country) reverseGeocode(last.lat, last.lon).then(p => { if (p.country) { setCountry(p.country); load(); } }).catch(() => {});
  }
  else setStatus('Tik op "Mijn locatie" of zoek een plaats.');
} catch {
  setStatus('Tik op "Mijn locatie" of zoek een plaats.');
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
