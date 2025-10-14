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

## DST Handling ✅

Het script handelt DST (zomer/wintertijd) overgangen **correct** af:

- ✅ **Zomertijd** (klok vooruit): 23 uren
- ✅ **Wintertijd** (klok achteruit): 25 uren (inclusief het dubbele 02:00 uur)

**Hoe het werkt:**
- Haalt data op in 8-dagen periodes (met 1-dag overlap)
- Vermijdt API edge case waar DST dag aan einde van range incomplete data geeft
- Duplicate detectie op UTC tijd (niet lokale tijd) zodat dubbele lokale timestamps behouden blijven

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
