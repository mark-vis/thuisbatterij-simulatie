#!/usr/bin/env python3
"""
Fetch electricity price data from EnergyZero REST API and convert to JSON format
for the battery simulation website.

This script uses the REST API endpoint instead of the GraphQL API.
The REST API returns timestamps in UTC (ending with Z).

Usage:
    python fetch_energyzero_rest.py 2023
    python fetch_energyzero_rest.py 2023 2024
    python fetch_energyzero_rest.py 2019 2020 2021 2022 2023 2024

Output:
    Creates JSON files in ../data/prices_{year}.json

Format:
    {
        "year": 2023,
        "count": 8760,
        "prices": [
            {"timestamp": "2023-01-01T00:00:00", "price": 123.45},
            ...
        ]
    }

Note:
    - Input timestamps to API are in UTC (must end with Z)
    - Output timestamps from API are in UTC (end with Z)
    - We convert to local Dutch time (CET/CEST) for output
    - Prices are in EUR/kWh from API, converted to EUR/MWh for output
    - EnergyZero has data from 2015 onwards

API Parameters:
    - interval=4: Hourly data
    - usageType=1: Electricity
    - inclBtw=false: Exclude VAT (get market prices)
"""

import asyncio
import json
import sys
from datetime import datetime, UTC
from pathlib import Path
from zoneinfo import ZoneInfo
import aiohttp


async def fetch_year_rest(year: int) -> dict:
    """
    Fetch electricity prices for entire year from EnergyZero REST API

    Args:
        year: Year to fetch (2015 or later)

    Returns:
        Dictionary with year, count, and prices array
    """
    print(f"📥 Ophalen data voor {year} via REST API...")

    # Build UTC query range for the year
    # In winter (CET = UTC+1):
    #   Jan 1 00:00 CET = Dec 31 23:00 UTC (previous year)
    #   Dec 31 23:59 CET = Dec 31 22:59 UTC
    from_utc = f"{year - 1}-12-31T23:00:00.000Z"
    till_utc = f"{year}-12-31T22:59:59.999Z"

    # API endpoint
    url = "https://api.energyzero.nl/v1/energyprices"
    params = {
        "fromDate": from_utc,
        "tillDate": till_utc,
        "interval": "4",        # Hourly
        "usageType": "1",       # Electricity
        "inclBtw": "false"      # Exclude VAT
    }

    print(f"  Query: {from_utc} t/m {till_utc}")
    print(f"  Requesting... ", end='', flush=True)

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as response:
            if response.status != 200:
                print(f"❌ HTTP {response.status}")
                text = await response.text()
                print(f"  Error: {text[:200]}")
                return None

            data = await response.json()
            print(f"✓ {len(data['Prices'])} timestamps")

    # Process prices
    prices = []
    tz_amsterdam = ZoneInfo('Europe/Amsterdam')

    for entry in data['Prices']:
        # Parse UTC timestamp (e.g., "2023-01-01T00:00:00Z")
        utc_str = entry['readingDate']
        utc_dt = datetime.fromisoformat(utc_str.replace('Z', '+00:00'))

        # Convert to Amsterdam time
        local_dt = utc_dt.astimezone(tz_amsterdam)

        # Only include timestamps in the target year (local time)
        if local_dt.year != year:
            continue

        # Format as ISO string without timezone (matches existing format)
        timestamp_str = local_dt.strftime('%Y-%m-%dT%H:%M:%S')

        # Price from API is in EUR/kWh, convert to EUR/MWh
        price_eur_kwh = entry['price']
        price_eur_mwh = price_eur_kwh * 1000

        prices.append({
            'timestamp': timestamp_str,
            'price': round(price_eur_mwh, 1)  # Round to 1 decimal
        })

    # Sort by timestamp (should already be sorted, but make sure)
    prices.sort(key=lambda p: p['timestamp'])

    count = len(prices)
    print(f"✓ Totaal {count} timestamps na filtering")

    # Analyze data quality
    days_by_date = {}
    for p in prices:
        day = p['timestamp'][:10]  # Extract YYYY-MM-DD
        if day not in days_by_date:
            days_by_date[day] = []
        days_by_date[day].append(p['timestamp'])

    # Check for 23h and 25h days (DST transitions)
    days_23h = [d for d, times in days_by_date.items() if len(times) == 23]
    days_25h = [d for d, times in days_by_date.items() if len(times) == 25]
    days_incomplete = [d for d, times in days_by_date.items() if len(times) < 23]

    if days_23h:
        print(f"  ⏰ Zomertijd: {', '.join(days_23h)} (23 uren)")
    if days_25h:
        print(f"  ⏰ Wintertijd: {', '.join(days_25h)} (25 uren)")
    if days_incomplete:
        print(f"  ⚠️  Incomplete dagen:")
        for day in days_incomplete:
            hours = len(days_by_date[day])
            missing_hours = set(range(24)) - {int(t[11:13]) for t in days_by_date[day]}
            print(f"      {day}: {hours} uren (ontbreekt: {sorted(missing_hours)})")

    # Verify expected count (accounting for DST)
    is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
    expected_days = 366 if is_leap else 365
    expected_count = expected_days * 24  # Assumes DST transitions cancel out

    if count == expected_count:
        print(f"  ✓ Verwacht aantal timestamps klopt ({expected_count})")
    elif count == expected_count - 1:
        print(f"  ⚠️  Aantal timestamps ({count}) is 1 minder dan verwacht ({expected_count})")
        print(f"      Dit kan gebeuren als DST data incomplete is")
    else:
        print(f"  ⚠️  Aantal timestamps ({count}) wijkt af van verwacht ({expected_count})")

    return {
        'year': year,
        'count': count,
        'prices': prices
    }


async def main():
    """Main function"""

    # Parse command line arguments
    if len(sys.argv) < 2:
        print("Gebruik: python fetch_energyzero_rest.py <jaar> [jaar2] [jaar3] ...")
        print("Voorbeeld: python fetch_energyzero_rest.py 2023 2024")
        print()
        print("Let op: EnergyZero heeft alleen data vanaf 2015")
        sys.exit(1)

    years = []
    for arg in sys.argv[1:]:
        try:
            year = int(arg)
            if year < 2015:
                print(f"⚠️  Waarschuwing: EnergyZero heeft mogelijk geen data voor {year} (meestal vanaf 2015)")
            years.append(year)
        except ValueError:
            print(f"❌ Ongeldig jaar: {arg}")
            sys.exit(1)

    if not years:
        print("❌ Geen jaren opgegeven")
        sys.exit(1)

    print("=" * 80)
    print("ENERGYZERO DATA OPHALEN (REST API)")
    print("=" * 80)
    print()
    print(f"Jaren: {', '.join(map(str, years))}")
    print()

    # Determine output directory
    script_dir = Path(__file__).parent
    output_dir = script_dir.parent / 'data'

    if not output_dir.exists():
        print(f"❌ Output directory bestaat niet: {output_dir}")
        sys.exit(1)

    print(f"Output directory: {output_dir}")
    print()

    # Fetch data for each year
    for year in sorted(years):
        print("-" * 80)
        data = await fetch_year_rest(year)

        if data is None:
            print(f"❌ Overslaan {year}")
            print()
            continue

        # Write to JSON file
        output_file = output_dir / f"prices_{year}.json"

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

        file_size = output_file.stat().st_size
        print(f"💾 Opgeslagen: {output_file} ({file_size:,} bytes)")
        print()

    print("=" * 80)
    print("✓ KLAAR")
    print("=" * 80)


if __name__ == '__main__':
    asyncio.run(main())
