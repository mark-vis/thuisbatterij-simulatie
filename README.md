# Thuisbatterij Simulatie Website

Web-based simulatie tool voor het berekenen van potentiële winsten door arbitrage handel met een thuisbatterij op de EPEX Day-Ahead markt.

## Features

- ✅ 100% client-side (privacy vriendelijk - geen data naar server)
- ✅ Simulatie voor jaren 2013-2025
- ✅ Configureerbare batterij parameters (capaciteit, vermogen, efficiëntie)
- ✅ Twee prijs modes (standaard met opslag, of simpel met alleen BTW)
- ✅ Interactieve grafieken (Chart.js)
- ✅ Maandelijks overzicht met tabel
- ✅ CSV export van resultaten
- ✅ Responsive design (werkt op mobile)
- ✅ Multiple pagina's (simulatie, technisch, over, disclaimer)

## Technologie

- **Frontend**: Vanilla JavaScript (geen frameworks)
- **Charts**: Chart.js 4.4.0
- **Optimizer**: MILP met HiGHS solver (WebAssembly)
- **Data**: EPEX prijsdata van [jeroen.punt.nl](https://jeroen.punt.nl/)

## Structuur

```
site/
├── index.html              # Hoofdpagina met simulatie
├── about.html              # Over pagina
├── technical.html          # Technische details
├── legal.html              # Disclaimer en kleine lettertjes
├── css/
│   └── style.css           # Styling
├── js/
│   ├── battery.js          # Battery class (charge/discharge)
│   ├── optimizer.js        # Optimizer (greedy algorithm)
│   ├── simulator.js        # Main simulator logica
│   ├── ui.js               # UI interactions & form handling
│   └── charts.js           # Chart.js visualisaties
├── data/
│   ├── prices_2013.json    # EPEX prijzen per jaar
│   ├── prices_2014.json
│   └── ...
└── README.md
```

## Gebruik

### Lokaal testen

1. Open `index.html` in een moderne browser (Chrome, Firefox, Safari, Edge)
2. Of draai een lokale webserver:

```bash
# Python 3
python -m http.server 8000

# Of Node.js
npx serve
```

3. Open http://localhost:8000 in je browser

### Deployment

**GitHub Pages:**
1. Push naar GitHub repository
2. Enable GitHub Pages in repository settings
3. Select branch (main) en root directory

**Netlify/Vercel:**
1. Connect repository
2. Deploy (geen build stappen nodig)

## Data Update

Om nieuwe prijsdata toe te voegen:

1. Plaats nieuwe CSV in `../simulatie/data/`
2. Run conversie script:

```bash
cd ../simulatie
python convert_prices_to_json.py
```

3. Nieuwe JSON files worden aangemaakt in `site/data/`

## Ontwikkeling

De simulator is gebaseerd op een Python implementatie en volledig herschreven in JavaScript.

**Python versie:**
- Gebruikt PuLP voor MILP optimization
- Day-ahead planning met perfecte foresight
- Detailed efficiency curves (Victron MultiPlus 5000)

**JavaScript versie:**
- HiGHS solver voor MILP optimization (exact dezelfde formulering als Python)
- Zelfde planning logica (day-ahead om 13:00)
- Vaste efficiency percentages (geen curves)

### Toekomstige Verbeteringen

- [x] MILP solver (HiGHS via WebAssembly)
- [ ] Efficiency curves (variabel per vermogen)
- [ ] Intraday markt support
- [ ] Batterij degradatie model
- [ ] PV productie integratie
- [ ] Eigen verbruik profiel

## Licentie

MIT License (of naar wens)

## Contact

[Voeg contact informatie toe]

## Credits

- EPEX prijsdata: [jeroen.punt.nl](https://jeroen.punt.nl/)
- Chart.js: https://www.chartjs.org/
- HiGHS solver: [highs-js](https://github.com/lovasoa/highs-js)
- Originele Python simulator: [link]
