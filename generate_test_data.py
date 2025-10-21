#!/usr/bin/env python3
"""
Generate realistic consumption and solar generation data for 2024.
Creates hourly data for the entire year (8784 hours - leap year).
"""

import json
import math
from datetime import datetime, timedelta
import random

# Constants
YEAR = 2024
HOURS_IN_YEAR = 8784  # 2024 is a leap year (366 days)
LATITUDE = 52.0  # Netherlands

# Consumption parameters (kW) - tuned for ~3.5 MWh/year baseline
CONSUMPTION_BASELINE = 0.2  # 200W baseline
CONSUMPTION_MORNING_PEAK = 1.0  # Morning peak (e.g., breakfast, shower)
CONSUMPTION_EVENING_PEAK = 1.3  # Evening peak (e.g., cooking, TV)
CONSUMPTION_WINTER_FACTOR = 1.2  # 20% more in winter (heating, lights)

# Solar parameters (for 5 kWp system)
SOLAR_PEAK_POWER = 5.0  # kWp - peak system size
SOLAR_EFFICIENCY = 0.85  # System efficiency
SOLAR_LATITUDE = LATITUDE


def day_of_year(dt):
    """Return day of year (1-366)."""
    return dt.timetuple().tm_yday


def solar_declination(day):
    """Calculate solar declination angle (degrees)."""
    # Cooper equation
    return 23.45 * math.sin(math.radians((360 / 365) * (day + 284)))


def solar_elevation(hour, day, latitude):
    """
    Calculate solar elevation angle (degrees) for given hour, day, and latitude.
    Returns 0 if sun is below horizon.
    """
    # Solar declination
    decl = math.radians(solar_declination(day))

    # Hour angle (15 degrees per hour from solar noon)
    hour_angle = math.radians(15 * (hour - 12))

    # Latitude in radians
    lat = math.radians(latitude)

    # Solar elevation angle (altitude)
    sin_elevation = (
        math.sin(lat) * math.sin(decl) +
        math.cos(lat) * math.cos(decl) * math.cos(hour_angle)
    )

    elevation = math.degrees(math.asin(max(-1, min(1, sin_elevation))))

    return max(0, elevation)


def generate_solar_power(dt, kwp=5.0):
    """
    Generate realistic solar power output (kW) for given datetime.
    Based on solar position and random cloud cover.

    Args:
        dt: datetime object
        kwp: Peak power in kWp (default 5.0)
    """
    hour = dt.hour
    day = day_of_year(dt)

    # Calculate solar elevation angle
    elevation = solar_elevation(hour, day, SOLAR_LATITUDE)

    # No sun below horizon
    if elevation <= 0:
        return 0.0

    # Maximum power based on elevation (simplified model)
    # sin(elevation) gives rough approximation of irradiance
    max_power = kwp * SOLAR_EFFICIENCY * math.sin(math.radians(elevation))

    # Add seasonal effect (slightly higher in summer due to longer days and better angle)
    # Days 150-240 are roughly May-August
    seasonal_factor = 1.0
    if 150 <= day <= 240:
        seasonal_factor = 1.1
    elif day < 90 or day > 300:  # Winter
        seasonal_factor = 0.9

    max_power *= seasonal_factor

    # Random cloud cover (30% to 100% of clear sky)
    # More clouds in winter
    if day < 90 or day > 300:
        cloud_factor = random.uniform(0.2, 0.9)
    else:
        cloud_factor = random.uniform(0.4, 1.0)

    power = max_power * cloud_factor

    return round(max(0, power), 3)


def generate_consumption_power(dt, profile='basis'):
    """
    Generate realistic household consumption (kW) for given datetime.

    Profiles:
    - basis: ~3.5 MWh/year - standard NL household
    - wp: ~6.5 MWh/year - with heat pump (+3 MWh for heating)
    - ev: ~6.5 MWh/year - with EV (+3 MWh, 15000 km/year @ 20 kWh/100km)
    - wp_ev: ~9.5 MWh/year - with heat pump and EV
    """
    hour = dt.hour
    day = day_of_year(dt)
    weekday = dt.weekday()  # 0 = Monday, 6 = Sunday

    # Start with baseline
    power = CONSUMPTION_BASELINE

    # Seasonal variation (more consumption in winter)
    if day < 90 or day > 300:  # Winter months
        power *= CONSUMPTION_WINTER_FACTOR

    # Daily pattern - morning peak (07:00-09:00)
    if 7 <= hour < 9:
        morning_factor = CONSUMPTION_MORNING_PEAK * math.sin(math.radians((hour - 7) * 90))
        power += morning_factor

    # Daily pattern - evening peak (18:00-22:00)
    if 18 <= hour < 22:
        evening_factor = CONSUMPTION_EVENING_PEAK * math.sin(math.radians((hour - 18) * 45))
        power += evening_factor

    # Midday slight increase (12:00-14:00)
    if 12 <= hour < 14:
        power += 0.3 * math.sin(math.radians((hour - 12) * 90))

    # Weekend pattern (slightly different, more spread throughout day)
    if weekday >= 5:  # Saturday or Sunday
        power *= 1.1
        # More even distribution during the day
        if 10 <= hour < 17:
            power += 0.2

    # Late night reduction (00:00-06:00)
    if 0 <= hour < 6:
        power *= 0.5

    # Add heat pump consumption (if profile includes 'wp')
    # Target: +3 MWh/year
    if 'wp' in profile:
        # Heat pump mainly runs in winter and at night/morning
        if day < 90 or day > 300:  # Heating season (Oct-Mar, ~180 days)
            # Higher usage at night and morning (6pm - 10am, 16 hours)
            # Target: 3000 kWh / (180 days * 16 hours) = ~1.04 kW average
            if hour >= 18 or hour < 10:
                wp_power = 1.0  # Average 1.0 kW during heating hours
                # Add some variation based on outside temp (colder = more power)
                if day < 45 or day > 330:  # Coldest months (Dec-Feb)
                    wp_power *= 1.4  # Up to 1.4 kW
                power += wp_power * random.uniform(0.7, 1.2)
            else:
                # Lower during day (still some heating needed)
                power += 0.3 * random.uniform(0.3, 0.7)
        else:
            # Summer: only hot water (much less, ~200 kWh for 6 months)
            # 200 / (186 days * 24 hours) = ~0.045 kW
            power += 0.05 * random.uniform(0.5, 1.5)

    # Add EV charging (if profile includes 'ev')
    # Target: +3 MWh/year (15000 km @ 20 kWh/100km)
    if 'ev' in profile:
        # EV charges mainly in evening/night (after 19:00)
        # Charge every ~3 days = ~122 sessions/year
        # 3000 kWh / 122 sessions = ~24.6 kWh per session
        # Use pseudo-random based on day to get consistent pattern
        random.seed(day * 1000 + hour)  # Deterministic randomness
        charges_today = (day % 3 == 0)  # Charge every ~3 days

        if charges_today and 19 <= hour < 24:
            # Charging session spread over 5 hours (19:00-24:00)
            # Total ~24.6 kWh per session, distributed with sin pattern
            # Peak power ~7 kW, average ~4.9 kW over charging hours
            charge_power = 7.0 * math.sin(math.radians((hour - 19 + 1) * 36))  # Peak in middle
            power += charge_power * random.uniform(0.85, 1.05)

        random.seed()  # Reset random seed

    # Add random variation (±20%)
    power *= random.uniform(0.8, 1.2)

    return round(max(0.05, power), 3)


def generate_consumption_profile(profile_name):
    """Generate consumption data for a specific profile."""
    start_date = datetime(YEAR, 1, 1, 0, 0, 0)
    consumption_data = []

    print(f"  Generating consumption profile: {profile_name}")

    for hour_idx in range(HOURS_IN_YEAR):
        current_time = start_date + timedelta(hours=hour_idx)
        timestamp = current_time.isoformat()

        consumption_kwh = generate_consumption_power(current_time, profile=profile_name)
        consumption_data.append({
            "timestamp": timestamp,
            "kwh": consumption_kwh
        })

    total = sum(d["kwh"] for d in consumption_data)
    print(f"    Total: {total:.0f} kWh/year ({total/365.25:.1f} kWh/day avg)")

    return consumption_data


def generate_solar_profile(kwp):
    """Generate solar data for a specific kWp system."""
    start_date = datetime(YEAR, 1, 1, 0, 0, 0)
    solar_data = []

    print(f"  Generating solar profile: {kwp} kWp")

    for hour_idx in range(HOURS_IN_YEAR):
        current_time = start_date + timedelta(hours=hour_idx)
        timestamp = current_time.isoformat()

        solar_kwh = generate_solar_power(current_time, kwp=kwp)
        solar_data.append({
            "timestamp": timestamp,
            "kwh": solar_kwh
        })

    total = sum(d["kwh"] for d in solar_data)
    print(f"    Total: {total:.0f} kWh/year ({total/365.25:.1f} kWh/day avg)")

    return solar_data


def save_json(data, field_name, filename):
    """Save data to JSON file."""
    output = {
        "year": YEAR,
        "count": len(data),
        field_name: data
    }

    with open(filename, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"Saved {filename} ({len(data)} records)")


def main():
    """Main function."""
    print("=" * 60)
    print("Thuisbatterij Test Data Generator")
    print("=" * 60)
    print(f"Generating data for {YEAR} ({HOURS_IN_YEAR} hours)\n")

    # Define consumption profiles
    consumption_profiles = {
        'basis': 'Basis huishouden',
        'wp': 'Met warmtepomp',
        'ev': 'Met elektrische auto',
        'wp_ev': 'Met warmtepomp en EV'
    }

    # Define solar profiles (kWp) - 0 to 10 kWp
    solar_profiles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    # Generate consumption profiles
    print("Consumption Profiles:")
    print("-" * 60)
    for profile_key, profile_desc in consumption_profiles.items():
        data = generate_consumption_profile(profile_key)
        filename = f"data/consumption_2024_{profile_key}.json"
        save_json(data, "consumption", filename)

    # Generate solar profiles
    print("\nSolar Profiles:")
    print("-" * 60)
    for kwp in solar_profiles:
        data = generate_solar_profile(kwp)
        filename = f"data/solar_2024_{kwp}kwp.json"
        save_json(data, "solar", filename)

    print("\n" + "=" * 60)
    print("✓ All profiles generated successfully!")
    print("=" * 60)


if __name__ == "__main__":
    main()
