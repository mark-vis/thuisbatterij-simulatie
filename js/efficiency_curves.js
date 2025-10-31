/**
 * Efficiency Curves - Power-dependent efficiency models for inverters and batteries
 */

class EfficiencyCurve {
    /**
     * Victron MultiPlus 5000 (3-phase) preset
     *
     * Formulas:
     * - Discharge efficiency: η = 96.3731 - 0.000182296×P (P in DC Watt)
     * - Charge efficiency: η = 96.3516 - 0.000808006×P (P in DC Watt)
     * - Battery RTE: η = 100 + k·(C_ch + C_dis) met k = -10.7834
     *   waarbij C_ch en C_dis de C-rates zijn van het laden resp het ontladen
     *
     * Combined efficiency:
     * - Total = Inverter × √(Battery_RTE)
     *
     * Limits:
     * - Max charge power: 11 kW DC
     * - Max discharge power: 15 kW DC
     */
    static VICTRON_MP5000_3P = {
        name: "Victron MultiPlus 5000 (3-phase)",
        maxChargePowerKw: 11.0,
        maxDischargePowerKw: 15.0,

        /**
         * Inverter charge efficiency
         * η = 96.3516 - 0.000808006×P
         * @param {number} powerWatt - DC power in Watt (positive)
         * @returns {number} Efficiency (0-1)
         */
        chargeEffInv: (powerWatt) => {
            const effPct = 96.3516 - 0.000808006 * powerWatt;
            const eff = effPct / 100;
            // Cap efficiency between 50% and 99.9%
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Inverter discharge efficiency
         * η = 96.3731 - 0.000182296×P
         * @param {number} powerWatt - DC power in Watt (positive)
         * @returns {number} Efficiency (0-1)
         */
        dischargeEffInv: (powerWatt) => {
            const effPct = 96.3731 - 0.000182296 * powerWatt;
            const eff = effPct / 100;
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Battery round-trip efficiency
         * Formula: η = 100 + k·(C_ch + C_dis) met k = -10.7834
         * @param {number} capacityKwh - Battery capacity in kWh
         * @returns {number} Round-trip efficiency (0-1)
         */
        batteryRTE: function(capacityKwh) {
            const cRateCharge = this.maxChargePowerKw / capacityKwh;
            const cRateDischarge = this.maxDischargePowerKw / capacityKwh;
            const k = -10.7834;
            const rte = (100 + k * (cRateCharge + cRateDischarge)) / 100;
            return Math.max(0.5, Math.min(0.999, rte)); // Between 50% and 99.9%
        },

        /**
         * Calculate combined efficiency for charge and discharge
         * @param {number} powerKw - Power in kW
         * @param {number} capacityKwh - Battery capacity in kWh
         * @returns {Object} Efficiency breakdown
         */
        getCombinedEfficiency: function(powerKw, capacityKwh) {
            // Calculate C-rate for display purposes
            const cRate = powerKw / capacityKwh;

            // Battery efficiency (based on max charge/discharge C-rates)
            const battRTE = this.batteryRTE(capacityKwh);
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
     * Victron MultiPlus 5000 (1-phase) preset
     *
     * Formulas (coëfficiënten 3× die van 3-fase):
     * - Discharge efficiency: η = 96.3731 - 0.000546888×P (P in DC Watt)
     * - Charge efficiency: η = 96.3516 - 0.002424018×P (P in DC Watt)
     * - Battery RTE: η = 100 + k·(C_ch + C_dis) met k = -10.7834
     *   waarbij C_ch en C_dis de C-rates zijn van het laden resp het ontladen
     *
     * Combined efficiency:
     * - Total = Inverter × √(Battery_RTE)
     *
     * Limits:
     * - Max charge power: 3.7 kW DC (single phase)
     * - Max discharge power: 5.0 kW DC (single phase)
     */
    static VICTRON_MP5000_1P = {
        name: "Victron MultiPlus 5000 (1-phase)",
        maxChargePowerKw: 3.7,
        maxDischargePowerKw: 5.0,

        /**
         * Inverter charge efficiency
         * η = 96.3516 - 0.002424018×P (coëfficiënt 3× die van 3-fase)
         * @param {number} powerWatt - DC power in Watt (positive)
         * @returns {number} Efficiency (0-1)
         */
        chargeEffInv: (powerWatt) => {
            const effPct = 96.3516 - 0.002424018 * powerWatt;
            const eff = effPct / 100;
            // Cap efficiency between 50% and 99.9%
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Inverter discharge efficiency
         * η = 96.3731 - 0.000546888×P (coëfficiënt 3× die van 3-fase)
         * @param {number} powerWatt - DC power in Watt (positive)
         * @returns {number} Efficiency (0-1)
         */
        dischargeEffInv: (powerWatt) => {
            const effPct = 96.3731 - 0.000546888 * powerWatt;
            const eff = effPct / 100;
            return Math.min(0.999, Math.max(0.5, eff));
        },

        /**
         * Battery round-trip efficiency
         * Formula: η = 100 + k·(C_ch + C_dis) met k = -10.7834
         * @param {number} capacityKwh - Battery capacity in kWh
         * @returns {number} Round-trip efficiency (0-1)
         */
        batteryRTE: function(capacityKwh) {
            const cRateCharge = this.maxChargePowerKw / capacityKwh;
            const cRateDischarge = this.maxDischargePowerKw / capacityKwh;
            const k = -10.7834;
            const rte = (100 + k * (cRateCharge + cRateDischarge)) / 100;
            return Math.max(0.5, Math.min(0.999, rte)); // Between 50% and 99.9%
        },

        /**
         * Calculate combined efficiency for charge and discharge
         * @param {number} powerKw - Power in kW
         * @param {number} capacityKwh - Battery capacity in kWh
         * @returns {Object} Efficiency breakdown
         */
        getCombinedEfficiency: function(powerKw, capacityKwh) {
            // Calculate C-rate for display purposes
            const cRate = powerKw / capacityKwh;

            // Battery efficiency (based on max charge/discharge C-rates)
            const battRTE = this.batteryRTE(capacityKwh);
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
        return [this.VICTRON_MP5000_3P, this.VICTRON_MP5000_1P];
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
