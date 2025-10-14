#!/usr/bin/env python3
"""
Fetch electricity price data from EnergyZero API and convert to JSON format
for the battery simulation website.

Usage:
    python fetch_energyzero_data.py 2023
    python fetch_energyzero_data.py 2023 2024
    python fetch_energyzero_data.py 2019 2020 2021 2022 2023 2024

Output:
    Creates JSON files in ../site/data/prices_{year}.json

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
    - Timestamps are in local Dutch time (CET/CEST)
    - Prices are in EUR/MWh
    - EnergyZero has data from 2019 onwards

Note - DST Handling:
    - EnergyZero API handles DST correctly UNLESS the DST day is the last day of the requested range
    - This script works around this by fetching 8-day periods with 1-day overlap
    - Summer time (clock forward): 23 hours ✓
    - Winter time (clock backward): 25 hours ✓
    - DST transitions are now handled correctly
"""

import asyncio
import json
import sys
from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo
from energyzero import EnergyZero, PriceType


async def fetch_year(year: int) -> dict:
    """
    Fetch electricity prices for entire year from EnergyZero API

    Args:
        year: Year to fetch (2019 or later)

    Returns:
        Dictionary with year, count, and prices array
    """
    print(f"📥 Ophalen data voor {year}...")

    # Fetch data week by week, with 1 day overlap to ensure DST days are never
    # at the end of a range (API bug: incomplete data when DST day is last day)
    prices = []

    async with EnergyZero() as client:
        # Start from Jan 1st
        current_date = date(year, 1, 1)
        end_of_year = date(year, 12, 31)
        week_num = 1

        while current_date <= end_of_year:
            # Fetch 8 days at a time (7 days + 1 overlap) to avoid DST edge case
            # where DST transition day at END of range returns incomplete data
            end_date = date.fromordinal(min(
                current_date.toordinal() + 7,  # 8 days total (0-7 = 8 days)
                end_of_year.toordinal()
            ))

            try:
                print(f"  Week {week_num:2d} ({current_date} t/m {end_date})... ", end='', flush=True)
                energy = await client.get_electricity_prices(
                    start_date=current_date,
                    end_date=end_date,
                    price_type=PriceType.MARKET  # Raw market prices, excl. taxes (same as Jeroen.nl)
                )

                week_count = len(energy.timestamp_prices)
                print(f"{week_count} timestamps")

                # Convert to our format
                last_utc = None  # Track last UTC time to avoid real duplicates

                for price_point in energy.timestamp_prices:
                    timerange = price_point['timerange']
                    price = price_point['price']

                    # Convert UTC to Europe/Amsterdam time (CET/CEST)
                    utc_ts = timerange.start_including
                    local_ts = utc_ts.astimezone(ZoneInfo('Europe/Amsterdam'))

                    # Only include timestamps that are in the requested year (local time)
                    # API returns timestamps in UTC which may fall outside year boundaries
                    if local_ts.year != year:
                        continue

                    # Avoid TRUE duplicates (same UTC time) when overlapping ranges
                    # NOTE: During DST transition, local time can repeat (e.g. 02:00 twice)
                    # but UTC times are different, so these are NOT duplicates!
                    if last_utc and utc_ts == last_utc:
                        continue
                    last_utc = utc_ts

                    # Format as ISO string without timezone (matches existing format)
                    timestamp_str = local_ts.strftime('%Y-%m-%dT%H:%M:%S')

                    # Price from EnergyZero is in EUR/kWh, convert to EUR/MWh
                    price_eur_mwh = price * 1000

                    prices.append({
                        'timestamp': timestamp_str,
                        'price': round(price_eur_mwh, 1)  # Round to 1 decimal like original data
                    })

            except Exception as e:
                print(f"❌ Fout: {e}")
                return None

            # Move to next week
            current_date = date.fromordinal(end_date.toordinal() + 1)
            week_num += 1

    count = len(prices)
    print(f"✓ Totaal {count} timestamps opgehaald")

    # Check DST transitions
    days_by_date = {}
    for p in prices:
        day = p['timestamp'][:10]  # Extract YYYY-MM-DD
        if day not in days_by_date:
            days_by_date[day] = 0
        days_by_date[day] += 1

    # Check for 23h and 25h days (DST transitions)
    days_23h = [d for d, c in days_by_date.items() if c == 23]
    days_25h = [d for d, c in days_by_date.items() if c == 25]

    if days_23h:
        print(f"  ⏰ Zomertijd: {', '.join(days_23h)} (23 uren)")
    if days_25h:
        print(f"  ⏰ Wintertijd: {', '.join(days_25h)} (25 uren)")

    # Verify expected count (accounting for DST)
    # Leap year check
    is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
    expected_days = 366 if is_leap else 365

    # Expected hours: days * 24 - 1 (zomertijd) + 1 (wintertijd) = days * 24
    expected_count = expected_days * 24

    if count == expected_count:
        print(f"  ✓ Verwacht aantal timestamps klopt ({expected_count})")
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
        print("Gebruik: python fetch_energyzero_data.py <jaar> [jaar2] [jaar3] ...")
        print("Voorbeeld: python fetch_energyzero_data.py 2023 2024")
        print()
        print("Let op: EnergyZero heeft alleen data vanaf 2019")
        sys.exit(1)

    years = []
    for arg in sys.argv[1:]:
        try:
            year = int(arg)
            if year < 2019:
                print(f"⚠️  Waarschuwing: EnergyZero heeft geen data voor {year} (alleen vanaf 2019)")
            years.append(year)
        except ValueError:
            print(f"❌ Ongeldig jaar: {arg}")
            sys.exit(1)

    if not years:
        print("❌ Geen jaren opgegeven")
        sys.exit(1)

    print("=" * 80)
    print("ENERGYZERO DATA OPHALEN")
    print("=" * 80)
    print()
    print(f"Jaren: {', '.join(map(str, years))}")
    print()

    # Determine output directory
    script_dir = Path(__file__).parent
    output_dir = script_dir.parent / 'site' / 'data'

    if not output_dir.exists():
        print(f"❌ Output directory bestaat niet: {output_dir}")
        sys.exit(1)

    print(f"Output directory: {output_dir}")
    print()

    # Fetch data for each year
    for year in sorted(years):
        print("-" * 80)
        data = await fetch_year(year)

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
