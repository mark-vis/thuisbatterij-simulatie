/**
 * Power Sweep Analysis - Find optimal charge/discharge power configuration
 * Runs multiple simulations with different power settings and compares results
 */

class PowerSweepAnalysis {
    /**
     * @param {number} capacityKwh - Battery capacity
     * @param {Object} priceConfig - Price configuration with buy/sell formulas
     * @param {Array<Object>} pricesData - Price data array
     * @param {Object} efficiencyCurve - Efficiency curve preset
     */
    constructor(capacityKwh, priceConfig, pricesData, efficiencyCurve) {
        this.capacityKwh = capacityKwh;
        this.priceConfig = priceConfig;
        this.pricesData = pricesData;
        this.efficiencyCurve = efficiencyCurve;
    }

    /**
     * Run power sweep analysis
     * @param {Object} options - Sweep options
     * @param {Function} progressCallback - Progress callback (current, total, chargePower, dischargePower)
     * @returns {Promise<Object>} Sweep results
     */
    async runSweep(options, progressCallback = null) {
        const {
            chargePowerRange,    // [min, max, step] in kW
            dischargePowerRange, // [min, max, step] in kW
            minSocPct,
            maxSocPct,
            initialSocPct
        } = options;

        // Generate power arrays (capped by inverter limits)
        const chargePowers = this.generateRange(
            chargePowerRange[0],
            chargePowerRange[1],
            chargePowerRange[2],
            this.efficiencyCurve.maxChargePowerKw
        );

        const dischargePowers = this.generateRange(
            dischargePowerRange[0],
            dischargePowerRange[1],
            dischargePowerRange[2],
            this.efficiencyCurve.maxDischargePowerKw
        );

        const total = chargePowers.length * dischargePowers.length;
        const results = [];
        let current = 0;

        // Sweep through all combinations
        for (const chargePower of chargePowers) {
            for (const dischargePower of dischargePowers) {
                current++;

                // Calculate efficiencies for this power configuration
                const chargeEff = this.efficiencyCurve.getCombinedEfficiency(
                    chargePower,
                    this.capacityKwh
                );
                const dischargeEff = this.efficiencyCurve.getCombinedEfficiency(
                    dischargePower,
                    this.capacityKwh
                );

                // Create battery configuration
                const batteryConfig = {
                    capacityKwh: this.capacityKwh,
                    chargePowerKw: chargePower,
                    dischargePowerKw: dischargePower,
                    chargeEfficiency: chargeEff.chargeTotal,
                    dischargeEfficiency: dischargeEff.dischargeTotal,
                    minSocPct: minSocPct / 100,
                    maxSocPct: maxSocPct / 100
                };

                // Run full year simulation
                const simulator = new BatterySimulator(
                    batteryConfig,
                    this.priceConfig,
                    {initialSocPct: initialSocPct / 100},
                    this.pricesData
                );

                const history = await simulator.simulate();
                const monthly = simulator.getMonthlySummary(history);
                const totals = simulator.getTotals(monthly);

                // Store result
                results.push({
                    chargePower,
                    dischargePower,
                    chargeEfficiency: chargeEff.chargeTotal,
                    dischargeEfficiency: dischargeEff.dischargeTotal,
                    chargeInverterEff: chargeEff.chargeInverter,
                    dischargeInverterEff: dischargeEff.dischargeInverter,
                    chargeBatteryRTE: chargeEff.batteryRTE,
                    dischargeBatteryRTE: dischargeEff.batteryRTE,
                    chargeCRate: chargeEff.cRate,
                    dischargeCRate: dischargeEff.cRate,
                    profit: totals.totalProfit,
                    cycles: totals.totalCycles,
                    profitPerCycle: totals.avgProfitPerCycle,
                    monthlySummary: monthly,
                    history: history
                });

                // Progress callback
                if (progressCallback) {
                    progressCallback(current, total, chargePower, dischargePower);
                }

                // Allow UI to update
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Find best configuration
        const bestConfig = this.findBest(results);

        // Extract diagonal (symmetric power configurations)
        const diagonalData = this.extractDiagonal(results, chargePowers, dischargePowers);

        return {
            results,
            chargePowers,
            dischargePowers,
            bestConfig,
            diagonalData,
            gridSize: {
                rows: dischargePowers.length,
                cols: chargePowers.length
            }
        };
    }

    /**
     * Generate array of power values
     * @param {number} min - Minimum power (kW)
     * @param {number} max - Maximum power (kW)
     * @param {number} step - Step size (kW)
     * @param {number} hardMax - Hard maximum from inverter limit
     * @returns {Array<number>} Array of power values
     */
    generateRange(min, max, step, hardMax = Infinity) {
        const values = [];
        const effectiveMax = Math.min(max, hardMax);

        for (let v = min; v <= effectiveMax + 0.001; v += step) {
            values.push(Math.round(v * 100) / 100);
        }

        return values;
    }

    /**
     * Find configuration with highest profit
     * @param {Array<Object>} results - Sweep results
     * @returns {Object} Best configuration
     */
    findBest(results) {
        return results.reduce((best, current) =>
            current.profit > best.profit ? current : best
        );
    }

    /**
     * Extract symmetric configurations (charge power = discharge power)
     * Used for diagonal chart
     * @param {Array<Object>} results - Sweep results
     * @param {Array<number>} chargePowers - Charge power array
     * @param {Array<number>} dischargePowers - Discharge power array
     * @returns {Array<Object>} Diagonal data
     */
    extractDiagonal(results, chargePowers, dischargePowers) {
        const diagonal = [];

        // Find all powers that appear in both arrays
        for (const power of chargePowers) {
            if (dischargePowers.includes(power)) {
                const result = results.find(r =>
                    Math.abs(r.chargePower - power) < 0.01 &&
                    Math.abs(r.dischargePower - power) < 0.01
                );

                if (result) {
                    diagonal.push({
                        power: power,
                        profit: result.profit,
                        cycles: result.cycles,
                        profitPerCycle: result.profitPerCycle,
                        chargeEff: result.chargeEfficiency,
                        dischargeEff: result.dischargeEfficiency,
                        cRate: result.chargeCRate
                    });
                }
            }
        }

        // Sort by power
        return diagonal.sort((a, b) => a.power - b.power);
    }

    /**
     * Get top N configurations by profit
     * @param {Array<Object>} results - Sweep results
     * @param {number} n - Number of top results to return
     * @returns {Array<Object>} Top N configurations
     */
    getTopN(results, n = 10) {
        return [...results]
            .sort((a, b) => b.profit - a.profit)
            .slice(0, n);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PowerSweepAnalysis;
}
