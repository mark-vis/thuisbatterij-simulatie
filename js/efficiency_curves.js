/**
 * Efficiency Curves - Power-dependent efficiency models for inverters and batteries
 */

class EfficiencyCurve {
    /**
     * Victron MultiPlus 5000 (3-phase) preset
     *
     * Formulas:
     * - Discharge efficiency: η = 1 - 6.56275e-6 × P_watt
     * - Charge efficiency: η = 0.94347 - 7.73e-7×P - 6.32e-11×P² - 3.98e-14×P³
     * - Battery RTE: η = 1 - 0.15 × C (C = C-rate = kW/kWh)
     *
     * Combined efficiency:
     * - Total = Inverter × √(Battery_RTE)
     *
     * Limits:
     * - Max charge power: 11 kW DC
     * - Max discharge power: 17 kW DC
     */
    static VICTRON_MP5000_3P = {
        name: "Victron MultiPlus 5000 (3-phase)",
        maxChargePowerKw: 11.0,
        maxDischargePowerKw: 17.0,

        /**
         * Inverter charge efficiency
         * @param {number} powerWatt - DC power in Watt
         * @returns {number} Efficiency (0-1)
         */
        chargeEffInv: (powerWatt) => {
            const p = powerWatt;
            const eff = 0.94347 - 7.73e-7*p - 6.32e-11*p*p - 3.98e-14*p*p*p;
            // Cap efficiency between 50% and 99.9%
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Inverter discharge efficiency
         * @param {number} powerWatt - DC power in Watt
         * @returns {number} Efficiency (0-1)
         */
        dischargeEffInv: (powerWatt) => {
            const eff = 1 - 6.56275e-6 * powerWatt;
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Battery round-trip efficiency
         * @param {number} cRate - C-rate (kW / kWh)
         * @returns {number} Round-trip efficiency (0-1)
         */
        batteryRTE: (cRate) => {
            const rte = 1 - 0.15 * cRate;
            return Math.max(0.5, rte); // Minimum 50%
        },

        /**
         * Calculate combined efficiency for charge and discharge
         * @param {number} powerKw - Power in kW
         * @param {number} capacityKwh - Battery capacity in kWh
         * @returns {Object} Efficiency breakdown
         */
        getCombinedEfficiency: function(powerKw, capacityKwh) {
            // Calculate C-rate
            const cRate = powerKw / capacityKwh;

            // Battery efficiency (split RTE into single direction)
            const battRTE = this.batteryRTE(cRate);
            const battSingle = Math.sqrt(battRTE);

            // Inverter efficiency (input must be in Watt!)
            const powerWatt = powerKw * 1000;
            const chInv = this.chargeEffInv(powerWatt);
            const disInv = this.dischargeEffInv(powerWatt);

            return {
                chargeTotal: chInv * battSingle,
                dischargeTotal: disInv * battSingle,
                chargeInverter: chInv,
                dischargeInverter: disInv,
                batteryRTE: battRTE,
                batterySingle: battSingle,
                cRate: cRate
            };
        }
    };

    /**
     * Get all available presets
     * @returns {Array<Object>} Array of efficiency curve presets
     */
    static getPresets() {
        return [this.VICTRON_MP5000_3P];
    }

    /**
     * Get preset by name
     * @param {string} name - Preset name
     * @returns {Object|null} Preset or null if not found
     */
    static getPreset(name) {
        const presets = this.getPresets();
        return presets.find(p => p.name === name) || null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EfficiencyCurve;
}
