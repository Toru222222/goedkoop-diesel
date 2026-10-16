// Prijsbord scannen: tekstherkenning in de browser met Tesseract.js.
// De foto verlaat het toestel niet; alleen de gekozen prijs wordt opgeslagen.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let loading = null;

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { loading = null; reject(new Error('Tekstherkenning kon niet laden')); };
    document.head.appendChild(s);
  });
  return loading;
}

export async function readImageText(file, onProgress) {
  const Tesseract = await loadTesseract();
  const { data } = await Tesseract.recognize(file, 'eng', {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100)),
  });
  return data.text || '';
}

// Zoekt getallen die op een literprijs lijken (binnen de grenzen van het land).
// Prijsborden tonen vaak de decimalen klein of zonder komma ("2249" voor 22,49),
// dus proberen we ook die varianten.
export function extractPrices(text, min, max) {
  const found = new Map();
  const add = (v, lineHasDiesel) => {
    if (!(v >= min && v <= max)) return;
    const key = String(+v.toFixed(3));
    const score = (found.get(key) || 0) + (lineHasDiesel ? 10 : 1);
    found.set(key, score);
  };
  for (const line of text.split(/\n/)) {
    const diesel = /diesel|gazole|gasoil|hvo|\bd\b/i.test(line);
    const cleaned = line.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0').replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, '1');
    for (const m of cleaned.matchAll(/\d{1,4}(?:[.,:]\s?\d{1,3})?/g)) {
      const raw = m[0].replace(/\s/g, '');
      if (/[.,:]/.test(raw)) {
        add(parseFloat(raw.replace(/[,:]/, '.')), diesel);
      } else {
        // "2249" -> 22.49 / 2.249 ; "1879" -> 18.79 / 1.879
        for (const d of [2, 3]) {
          if (raw.length > d) add(parseFloat(raw.slice(0, -d) + '.' + raw.slice(-d)), diesel);
        }
      }
    }
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => parseFloat(k)).slice(0, 6);
}
