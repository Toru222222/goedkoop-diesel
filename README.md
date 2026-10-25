# Goedkoop Diesel (prototype)

Web-app voor telefoon en computer die tankstations rond je locatie toont, gesorteerd op dieselprijs, met de goedkoopste bovenaan.

## Wat de app doet

- **Locatie**: knop "Mijn locatie" (GPS) of zoeken op plaatsnaam. Straal 5 tot 50 km.
- **Stations**: wereldwijd uit OpenStreetMap, dus de app werkt in elk land.
- **Prijzen**: per land uit de beste bron die er is (zie tabel). Waar geen open data bestaat, melden gebruikers de prijs.
- **Prijsbord scannen**: bij "Prijs melden" maak je een foto van het prijsbord; de app leest de cijfers (tekstherkenning in de browser, de foto verlaat je telefoon niet) en stelt de dieselprijs voor. Je bevestigt zelf.
- **Route**: opent Google Maps naar het station.
- Meldingen ouder dan 14 dagen tellen niet mee.

## Databronnen per land

| Land | Bron | Status |
|---|---|---|
| Zweden, Noorwegen, en alle andere landen | Meldingen van gebruikers | Werkt |
| Duitsland | Tankerkönig (live, gratis API-sleutel) | Gebouwd, niet live getest |
| Frankrijk | prix-carburants, open data van de overheid | Werkt, elk uur bijgewerkt |
| Spanje | Geoportal Gasolineras (ministerie) | Werkt, elk uur bijgewerkt |
| Verenigd Koninkrijk | open prijsfeeds van de ketens (Asda, Esso, Tesco, MFG, ...) | Werkt, elk uur bijgewerkt |
| Italië | Osservaprezzi (MIMIT) | Gebouwd, bron nog niet bereikbaar vanaf GitHub |
| Noorwegen | link naar Drivstoffapp (geen open data) | Werkt |

**Richtprijs in Zweden**: een GitHub Actions-taak (`.github/workflows/listprices.yml`) haalt drie keer per dag de landelijke listpris voor diesel op van St1, Circle K, Preem en OKQ8 (Circle K, Preem en OKQ8 alleen als prijs voor zakelijke tankkaarten) en schrijft die naar `listprices.json`. Stations van die ketens zonder melding tonen die als richtprijs (≈). Ingo, Tanka en onafhankelijke stations publiceren geen prijs.

**Zweden** heeft geen openbare prijsdata per station. Bensinpriser.nu werkt ook met meldingen van gebruikers, en ketens als Circle K en Preem publiceren alleen een landelijke "listpris", die meestal hoger ligt dan de prijs aan de pomp. Daarom vertrouwt de app in Zweden op meldingen. Betaalde bronnen met echte pompprijzen bestaan wel (TomTom Fuel Prices, HERE Fuel Prices), die kun je later als provider toevoegen.

**Open data per land**: `.github/workflows/opendata.yml` draait elk uur `scripts/update-opendata.mjs`, dat per land een bestand met alle stations en dieselprijzen op de branch `prices` zet. De app leest dat bestand via raw.githubusercontent.com. Een land toevoegen: een functie in `SOURCES` in dat script en `provider: 'opendata'` in `COUNTRIES`.

Een land of bron toevoegen: één regel in `COUNTRIES` in `providers.js`, plus eventueel een functie in `providers`.

## Starten

Nodig: Node.js 18 of nieuwer. Geen extra pakketten.

```
node server.js
```

Open daarna http://localhost:8080. Meldingen worden bewaard in `data/reports.json` en gedeeld met iedereen die dezelfde server gebruikt.

Zonder server (bijvoorbeeld de bestanden op een gewone webhost zetten) werkt de app ook, maar dan blijven meldingen alleen op je eigen telefoon.

**Op je telefoon**: locatie (GPS) werkt alleen via `https://` of `localhost`. Zet de app daarvoor op een host met HTTPS, bijvoorbeeld Render, Railway of Fly.io (draait `node server.js`). Daarna kun je hem via "Zet op startscherm" als app gebruiken.

**Duitsland**: vraag een gratis sleutel aan op https://creativecommons.tankerkoenig.de en zet hem in de browserconsole met
`localStorage.setItem('diesel-settings', JSON.stringify({tankerkoenigKey: 'JOUW-SLEUTEL'}))`.

## Prijzen delen via Supabase (gratis)

1. Maak een account op https://supabase.com (inloggen met GitHub kan) en klik **New project**. Kies regio Stockholm (eu-north-1) als die er is.
2. Open **SQL Editor**, plak de inhoud van `supabase.sql` en klik **Run**.
3. Ga naar **Project Settings > API** (of de knop **Connect**) en kopieer de **Project URL** en de **publishable key** (of de **anon public** key).
4. Zet die twee in `config.js`. Die sleutel mag openbaar zijn: de database staat alleen lezen en toevoegen toe, niet wijzigen of verwijderen.

Een gratis Supabase-project wordt gepauzeerd na een week zonder gebruik; dan zet je hem in het dashboard weer aan. Meldingen blijven altijd ook op je eigen telefoon bewaard.

## Bestanden

- `index.html`, `styles.css`: de pagina
- `app.js`: locatie, laden, sorteren, weergave, melden
- `providers.js`: landen, OpenStreetMap, officiële prijsbronnen
- `store.js`: meldingen opslaan (Supabase, server of op het apparaat)
- `config.js`: gegevens van de gedeelde database
- `supabase.sql`: tabel en toegangsregels voor Supabase
- `ocr.js`: prijsbord scannen en prijzen uit tekst halen
- `server.js`: kleine server die de app serveert en meldingen bewaart

## Wat getest is

In een headless browser op telefoonformaat, met nagebootste OpenStreetMap-antwoorden rond Charlottenberg: locatie, stations ophalen, prijzen melden via de server, sorteren op prijs, foutmelding bij een onwaarschijnlijke prijs, licht en donker thema. Het herkennen van prijzen uit tekst is apart getest. Niet getest: echte verbindingen met OpenStreetMap, Tankerkönig en de Franse open data, en tekstherkenning op een echte foto (die bronnen waren vanuit de testomgeving niet bereikbaar).
