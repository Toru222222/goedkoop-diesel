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
| Frankrijk | prix-carburants, open data van de overheid (live) | Gebouwd, niet live getest |

**Zweden** heeft geen openbare prijsdata per station. Bensinpriser.nu werkt ook met meldingen van gebruikers, en ketens als Circle K en Preem publiceren alleen een landelijke "listpris", die meestal hoger ligt dan de prijs aan de pomp. Daarom vertrouwt de app in Zweden op meldingen. Betaalde bronnen met echte pompprijzen bestaan wel (TomTom Fuel Prices, HERE Fuel Prices), die kun je later als provider toevoegen.

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

## Bestanden

- `index.html`, `styles.css`: de pagina
- `app.js`: locatie, laden, sorteren, weergave, melden
- `providers.js`: landen, OpenStreetMap, officiële prijsbronnen
- `store.js`: meldingen opslaan (server of op het apparaat)
- `ocr.js`: prijsbord scannen en prijzen uit tekst halen
- `server.js`: kleine server die de app serveert en meldingen bewaart

## Wat getest is

In een headless browser op telefoonformaat, met nagebootste OpenStreetMap-antwoorden rond Charlottenberg: locatie, stations ophalen, prijzen melden via de server, sorteren op prijs, foutmelding bij een onwaarschijnlijke prijs, licht en donker thema. Het herkennen van prijzen uit tekst is apart getest. Niet getest: echte verbindingen met OpenStreetMap, Tankerkönig en de Franse open data, en tekstherkenning op een echte foto (die bronnen waren vanuit de testomgeving niet bereikbaar).
