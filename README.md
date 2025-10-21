# Thuisbatterij Simulatie

Web-based simulatietool voor het berekenen van potentiële besparingen en winsten met een thuisbatterij. Simuleer arbitrage op de EPEX markt, of realistische scenario's met zonnepanelen en huishoudelijk verbruik.

🔗 **Live demo:** https://mark-vis.github.io/thuisbatterij-simulatie/

## Features

### Algemeen
- ✅ 100% client-side (privacy vriendelijk - geen data naar server)
- ✅ Simulatie voor jaren 2013-2025
- ✅ Configureerbare batterijparameters (capaciteit, vermogen, efficiëntie, SoC limieten)
- ✅ Vier prijs modes: Standaard met/zonder salderen (Tibber 2025), Kaal (EPEX), Geavanceerd (eigen formules)
- ✅ Interactieve grafieken met Chart.js
- ✅ CSV export en URL sharing
- ✅ Responsive design (werkt op mobiel en desktop)

### Arbitrage Simulatie (index.html)
- ✅ EPEX Day-Ahead arbitrage (koop laag, verkoop hoog)
- ✅ Maandelijks en dagelijks overzicht
- ✅ Detail view per uur met SoC grafiek

### Simulatie met PV (with_solar.html)
- ✅ **Realistische scenario's** met zonnepanelen en huishoudelijk verbruik
- ✅ **4 scenario's vergelijking**: Vast/Dynamisch contract, met/zonder batterij
- ✅ **Verbruiksprofielen**: Basis (~3,5 MWh/jaar), +Warmtepomp (+3 MWh), +EV (+3 MWh), +WP+EV
- ✅ **PV-profielen**: 0-10 kWp met realistische zonnehoek en wolkendekking voor Nederland
- ✅ **Zelfverbruik en zelfvoorziening** metrics
- ✅ **Besparingen analyse**: Batterij effect, dynamisch contract effect, totale besparing

### Geavanceerde Analyse (advanced.html)
- ✅ **Vermogensscan**: Grid search over laad/ontlaadvermogen
- ✅ **Efficiëntiecurves**: Victron MultiPlus 5000 (vermogensafhankelijke efficiëntie)
- ✅ **Optimale configuratie**: Vind beste vermogen voor jouw situatie
- ✅ **Heatmap visualisatie**: 2D grid van alle combinaties

## Technologie

- **Frontend**: Vanilla JavaScript (geen frameworks)
- **Charts**: Chart.js 4.4.0
- **Optimizer**: MILP met HiGHS solver (WebAssembly)
- **Data**: Historische EPEX prijsdata (2013-2025)

## Structuur

```
site/
├── index.html                      # Arbitrage simulatie
├── with_solar.html                 # Simulatie met PV en verbruik
├── advanced.html                   # Geavanceerde analyse (vermogensscan)
├── technical.html                  # Technische details
├── about.html                      # Over pagina
├── legal.html                      # Disclaimer
├── css/
│   └── style.css                   # Styling
├── js/
│   ├── battery.js                  # Battery class (charge/discharge)
│   ├── optimizer.js                # MILP optimizer (HiGHS solver)
│   ├── simulator.js                # Arbitrage simulator
│   ├── solar_simulator.js          # PV + verbruik simulator
│   ├── ui.js                       # UI arbitrage
│   ├── solar_ui.js                 # UI met PV
│   ├── charts.js                   # Chart.js visualisaties
│   ├── efficiency_curves.js        # Victron efficiency curves
│   ├── power_sweep.js              # Vermogensscan logica
│   ├── advanced_ui.js              # UI geavanceerde analyse
│   └── lib/                        # HiGHS solver (WebAssembly)
├── data/
│   ├── prices_2024.json            # EPEX prijzen per jaar
│   ├── consumption_2024_basis.json # Verbruiksprofielen
│   ├── consumption_2024_wp.json
│   ├── consumption_2024_ev.json
│   ├── consumption_2024_wp_ev.json
│   ├── solar_2024_0kwp.json        # PV-profielen (0-10 kWp)
│   ├── solar_2024_5kwp.json
│   └── ...
├── generate_test_data.py           # Python script voor genereren test data
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

## Data

### EPEX Prijsdata
De EPEX prijsdata is opgeslagen in JSON formaat in de `data/` directory. Elk bestand bevat de uurlijkse prijzen voor een specifiek jaar:

```json
{
  "year": 2024,
  "count": 8784,
  "prices": [
    {"timestamp": "2024-01-01T00:00:00", "price": 45.23},
    {"timestamp": "2024-01-01T01:00:00", "price": 42.18},
    ...
  ]
}
```

Prijzen zijn in EUR/MWh. De simulator converteert deze intern naar EUR/kWh voor de berekeningen.

### Verbruiks- en PV-data (2024)
Realistische profielen gegenereerd met `generate_test_data.py`:

**Verbruiksprofielen** (8784 uur voor 2024):
- `consumption_2024_basis.json`: ~3,5 MWh/jaar (standaard NL huishouden)
- `consumption_2024_wp.json`: ~6,8 MWh/jaar (+ warmtepomp, 3 MWh extra)
- `consumption_2024_ev.json`: ~6,0 MWh/jaar (+ EV, 15000 km @ 20 kWh/100km)
- `consumption_2024_wp_ev.json`: ~9,3 MWh/jaar (+ warmtepomp + EV)

**PV-profielen** (8784 uur voor 2024):
- `solar_2024_0kwp.json` t/m `solar_2024_10kwp.json`: 0-10 kWp systemen
- Realistische zonnehoek berekening voor Nederlandse breedtegraad (52°N)
- Willekeurige wolkendekking (seizoensafhankelijk)

## Ontwikkeling

De simulator is gebaseerd op een niet-publieke Python implementatie en volledig herschreven in JavaScript.

**Python versie (niet publiek):**
- Gebruikt PuLP voor MILP optimization
- Day-ahead planning
- Detailed efficiency curves (Victron MultiPlus 5000)

**JavaScript versie (deze repository):**
- HiGHS solver voor MILP optimization (exact dezelfde formulering als Python)
- Zelfde planning logica (day-ahead om 13:00)
- Basis simulaties (index.html, with_solar.html): constante efficiency (instelbaar, standaard 89%, niet vermogensafhankelijk)
- Geavanceerde analyse (advanced.html): vermogensafhankelijke efficiency curves (Victron MultiPlus 5000)

### Implementatie Status

- [x] MILP solver (HiGHS via WebAssembly)
- [x] PV productie integratie (0-10 kWp profielen)
- [x] Eigen verbruik profielen (basis, WP, EV, WP+EV)
- [x] Efficiency curves (Victron MultiPlus 5000, vermogensafhankelijk)
- [x] 4 scenario's vergelijking (vast/dynamisch, met/zonder batterij)
- [x] Greedy strategie voor vaste prijzen (zelfverbruik maximalisatie)

### Toekomstige Verbeteringen

- [ ] Meer jaren voor verbruik/PV data (nu alleen 2024)
- [ ] Meer verbruiksprofielen (airco, zwembad, etc.)
- [ ] Custom verbruik upload
- [ ] Optimalisatie algoritme voor vermogensscan (gradient descent)

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

© Mark Vis - Licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)

Deze software mag gebruikt worden voor niet-commerciële doeleinden. Voor commercieel gebruik, neem contact op met m.vis@tue.nl
