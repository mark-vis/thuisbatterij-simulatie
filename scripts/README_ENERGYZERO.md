# EnergyZero Data Ophalen

## Gebruik

```bash
cd simulatie
source venv/bin/activate
python fetch_energyzero_data.py 2023 2024
```

Dit haalt prijsdata op voor de opgegeven jaren en slaat deze op in `../site/data/prices_{year}.json`.

## Data Beschikbaarheid

EnergyZero API heeft data vanaf **2019** tot heden.

## DST Waarschuwing ⚠️

De EnergyZero API heeft **incomplete data** voor wintertijd overgangen:

- ✅ **Zomertijd** (klok vooruit): correct - 23 uren
- ❌ **Wintertijd** (klok achteruit): **INCOMPLEET** - 24 uren in plaats van 25 uren
  - Het extra uur (02:00-03:00) ontbreekt gedeeltelijk
  - API bug, niet een script bug

Voor **complete DST handling**, gebruik de originele CSV bestanden van Jeroen.nl (2013-2024).

## Voorbeeld Output

```
================================================================================
ENERGYZERO DATA OPHALEN
================================================================================

Jaren: 2024

Output directory: /Users/mark/.../site/data

--------------------------------------------------------------------------------
📥 Ophalen data voor 2024...
  Week  1 (2024-01-01 t/m 2024-01-07)... 168 timestamps
  Week  2 (2024-01-08 t/m 2024-01-14)... 168 timestamps
  ...
  Week 53 (2024-12-30 t/m 2024-12-31)... 48 timestamps
✓ Totaal 8784 timestamps opgehaald
  ⏰ Zomertijd: 2024-03-31 (23 uren)
  ⏰ Wintertijd: 2024-10-27 (25 uren) ← LET OP: dit is feitelijk 24 uren (API bug)
  ✓ Verwacht aantal timestamps klopt (8784)
💾 Opgeslagen: .../prices_2024.json (439,109 bytes)
```

## JSON Formaat

```json
{
  "year": 2024,
  "count": 8784,
  "prices": [
    {"timestamp": "2024-01-01T00:00:00", "price": 201.0},
    {"timestamp": "2024-01-01T01:00:00", "price": 180.1},
    ...
  ]
}
```

- `timestamp`: Lokale NL tijd (CET/CEST) zonder timezone indicator
- `price`: Prijs in EUR/MWh

## Dependencies

```bash
pip install python-energyzero
```

Zie `requirements.txt` voor volledige lijst.
