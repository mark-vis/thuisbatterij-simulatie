# Thuisbatterij Simulatie

Web-based simulatietool voor het berekenen van potentiële winsten door batterijarbitage op de EPEX Day-Ahead markt.

🔗 **Live demo:** https://mark-vis.github.io/thuisbatterij-simulatie/

## Features

- ✅ 100% client-side (privacy vriendelijk - geen data naar server)
- ✅ Simulatie voor jaren 2013-2025
- ✅ Configureerbare batterijparameters (capaciteit, vermogen, efficiëntie, SoC limieten)
- ✅ Drie prijs modes: Standaard (Tibber 2025), Kaal (EPEX zonder BTW), Geavanceerd (eigen formules)
- ✅ Interactieve grafieken met Chart.js
- ✅ Maandelijks overzicht met tabel en totalen
- ✅ CSV export van resultaten
- ✅ Responsive design (werkt op mobiel en desktop)
- ✅ Multiple pagina's (simulatie, technisch, over, disclaimer)

## Technologie

- **Frontend**: Vanilla JavaScript (geen frameworks)
- **Charts**: Chart.js 4.4.0
- **Optimizer**: MILP met HiGHS solver (WebAssembly)
- **Data**: Historische EPEX prijsdata (2013-2025)

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
│   ├── optimizer.js        # MILP optimizer (HiGHS solver)
│   ├── simulator.js        # Main simulator logica
│   ├── ui.js               # UI interactions & form handling
│   ├── charts.js           # Chart.js visualisaties
│   └── lib/                # HiGHS solver (WebAssembly)
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

De simulator is gebaseerd op een niet-publieke Python implementatie en volledig herschreven in JavaScript.

**Python versie (niet publiek):**
- Gebruikt PuLP voor MILP optimization
- Day-ahead planning
- Detailed efficiency curves (Victron MultiPlus 5000)

**JavaScript versie (deze repository):**
- HiGHS solver voor MILP optimization (exact dezelfde formulering als Python)
- Zelfde planning logica (day-ahead om 13:00)
- Vaste efficiency percentages (geen curves)

### Toekomstige Verbeteringen

- [x] MILP solver (HiGHS via WebAssembly)
- [ ] PV productie integratie
- [ ] Eigen verbruik profiel
- [ ] Efficiency curves (variabel per vermogen)

## Contact

Ontwikkeld door **prof. Mark Vis**, universitair docent aan de TU/e.

- **Live demo:** https://mark-vis.github.io/thuisbatterij-simulatie/
- Email: m.vis@tue.nl
- TU/e profiel: https://www.tue.nl/en/research/researchers/mark-vis

## Credits

- EPEX prijsdata: Met dank aan [jeroen.nl](https://jeroen.nl/) voor historische prijzen
- Chart.js: https://www.chartjs.org/
- HiGHS solver: [highs-js](https://github.com/lovasoa/highs-js)

## Licentie

© Mark Vis - Deze software wordt aangeboden "as is", zonder enige garantie.
