# EnergyZero Data Ophalen

Er zijn twee scripts beschikbaar voor het ophalen van prijsdata:

## 1. GraphQL API (aanbevolen voor 2020+)

**Script:** `fetch_energyzero_data.py`

```bash
cd scripts
source venv/bin/activate
python fetch_energyzero_data.py 2023 2024 2025
```

**Voordelen:**
- Gebruikt python-energyzero library
- Correct handelt DST (zomer/wintertijd) overgangen af
- Bevat workaround voor year-end timezone bug

**Nadelen:**
- ⚠️ API bug: 2019-10-27 en 2022-10-30 retourneren "bad_request" error
- Voor deze jaren: gebruik Jeroen.nl CSV data

## 2. REST API (alternatief)

**Script:** `fetch_energyzero_rest.py`

```bash
cd scripts
source venv/bin/activate
python fetch_energyzero_rest.py 2023 2024 2025
```

**Voordelen:**
- Directe REST API call (geen extra library)
- Werkt voor alle jaren (geen "bad_request" errors)

**Nadelen:**
- ⚠️ Incomplete DST data voor sommige jaren:
  - 2019: mist dubbel 02:00 uur op 2019-10-27 (24 uren i.p.v. 25)
  - 2022: mist 02:00 dubbel + 22:00 op 2022-10-30 (23 uren i.p.v. 25)
- Voor deze jaren: gebruik Jeroen.nl CSV data

## Aanbeveling

- **2020, 2021, 2023, 2024, 2025**: Gebruik `fetch_energyzero_data.py` (GraphQL)
- **2019, 2022**: Gebruik Jeroen.nl CSV data (incomplete DST in EnergyZero database)

## Data Beschikbaarheid

EnergyZero API heeft data vanaf **2015-2019** tot heden (afhankelijk van jaar).

## DST Handling

Beide scripts handelen DST (zomer/wintertijd) overgangen af:

- ✅ **Zomertijd** (klok vooruit): 23 uren
- ✅ **Wintertijd** (klok achteruit): 25 uren (inclusief het dubbele 02:00 uur)

**GraphQL script:**
- Haalt data op in 8-dagen periodes (met 1-dag overlap)
- Vermijdt API edge case waar DST dag aan einde van range incomplete data geeft
- Duplicate detectie op UTC tijd (niet lokale tijd) zodat dubbele lokale timestamps behouden blijven

**REST script:**
- Haalt volledige jaar op in één request
- Converteert UTC timestamps naar lokale NL tijd (CET/CEST)
- Rapporteert data quality issues (incomplete dagen)

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
