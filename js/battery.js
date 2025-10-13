/**
 * Battery class - simulates battery charge/discharge with efficiency
 * Direct port from Python implementation
 */
class Battery {
    /**
     * @param {Object} config - Battery configuration
     * @param {number} config.capacityKwh - Battery capacity in kWh
     * @param {number} config.chargePowerKw - Max charge power in kW (DC)
     * @param {number} config.dischargePowerKw - Max discharge power in kW (DC)
     * @param {number} config.chargeEfficiency - Charge efficiency (0-1)
     * @param {number} config.dischargeEfficiency - Discharge efficiency (0-1)
     * @param {number} config.minSocPct - Minimum SoC percentage (0-1)
     * @param {number} config.maxSocPct - Maximum SoC percentage (0-1)
     * @param {number} initialSocPct - Initial State of Charge (0-1)
     */
    constructor(config, initialSocPct = 0.5) {
        this.config = config;
        this.socKwh = config.capacityKwh * initialSocPct;
    }

    /**
     * Get State of Charge as percentage
     * @returns {number} SoC percentage (0-100)
     */
    get socPct() {
        return (this.socKwh / this.config.capacityKwh) * 100;
    }

    /**
     * Charge battery with given energy
     * @param {number} energyKwh - DC energy to charge (kWh)
     * @param {number} durationHours - Duration in hours (default 1.0)
     * @returns {Array<number>} [dcToBattery, acFromGrid] - DC energy stored and AC energy taken from grid
     */
    charge(energyKwh, durationHours = 1.0) {
        // Maximum power limit (DC)
        const maxDcPowerKwh = this.config.chargePowerKw * durationHours;

        // Maximum SoC limit
        const maxSocKwh = this.config.capacityKwh * this.config.maxSocPct;
        const availableCapacity = maxSocKwh - this.socKwh;

        // Actual DC energy to battery (limited by power, capacity, and requested energy)
        const dcToBattery = Math.min(energyKwh, maxDcPowerKwh, availableCapacity);

        // AC energy from grid = DC to battery / efficiency
        const acFromGrid = dcToBattery / this.config.chargeEfficiency;

        // Update SoC
        this.socKwh += dcToBattery;

        return [dcToBattery, acFromGrid];
    }

    /**
     * Discharge battery for given energy
     * @param {number} energyKwh - DC energy to discharge (kWh)
     * @param {number} durationHours - Duration in hours (default 1.0)
     * @returns {Array<number>} [dcFromBattery, acToGrid] - DC energy taken from battery and AC energy to grid
     */
    discharge(energyKwh, durationHours = 1.0) {
        // Maximum power limit (DC)
        const maxDcPowerKwh = this.config.dischargePowerKw * durationHours;

        // Minimum SoC limit
        const minSocKwh = this.config.capacityKwh * this.config.minSocPct;
        const availableEnergy = this.socKwh - minSocKwh;

        // Actual DC energy from battery (limited by power, available energy, and requested energy)
        const dcFromBattery = Math.min(energyKwh, maxDcPowerKwh, availableEnergy);

        // AC energy to grid = DC from battery × efficiency
        const acToGrid = dcFromBattery * this.config.dischargeEfficiency;

        // Update SoC
        this.socKwh -= dcFromBattery;

        return [dcFromBattery, acToGrid];
    }

    /**
     * Reset battery to initial state
     * @param {number} initialSocPct - Initial SoC percentage (0-1)
     */
    reset(initialSocPct = 0.5) {
        this.socKwh = this.config.capacityKwh * initialSocPct;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Battery;
}
