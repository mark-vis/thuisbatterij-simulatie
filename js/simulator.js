/**
 * Battery Simulator - main simulation engine
 * Simulates battery trading on EPEX market with day-ahead optimization
 */
class BatterySimulator {
    /**
     * @param {Object} batteryConfig - Battery configuration
     * @param {Object} priceConfig - Price configuration
     * @param {Object} simulationConfig - Simulation configuration
     * @param {Array<Object>} pricesData - Array of {timestamp, price} for the year
     */
    constructor(batteryConfig, priceConfig, simulationConfig, pricesData) {
        this.battery = new Battery(batteryConfig, simulationConfig.initialSocPct);
        this.optimizer = new BatteryOptimizer(batteryConfig, priceConfig);
        this.config = simulationConfig;
        this.batteryConfig = batteryConfig;
        this.pricesData = pricesData;
        this.history = [];
        this.currentPlan = null;
    }

    /**
     * Run simulation for entire year
     * @param {Function} progressCallback - Optional callback for progress updates (progress, message)
     * @returns {Promise<Array>} Array of simulation results
     */
    async simulate(progressCallback = null) {
        this.history = [];
        this.currentPlan = null;

        // Convert prices to Map for fast lookup
        const pricesMap = new Map();
        for (const p of this.pricesData) {
            const ts = new Date(p.timestamp).getTime();
            pricesMap.set(ts, p.price);
        }

        // Get start and end dates
        const timestamps = this.pricesData.map(p => new Date(p.timestamp));
        const startDate = new Date(Math.min(...timestamps.map(d => d.getTime())));
        const endDate = new Date(Math.max(...timestamps.map(d => d.getTime())));

        let currentTime = new Date(startDate);

        let lastProgressUpdate = Date.now();
        const totalDuration = endDate - startDate;

        while (currentTime <= endDate) {
            // Get current price and determine time step
            const currentTs = currentTime.getTime();
            const priceEurMwh = pricesMap.get(currentTs);

            // If no price at current time, we've reached the end or hit a gap
            if (priceEurMwh === undefined) {
                break;
            }

            // Auto-detect time step by looking ahead
            let timeStepMs = 60 * 60 * 1000;  // Default: 1 hour
            let resolution = 'hourly';
            let durationHours = 1.0;

            // Check next available timestamp to determine step size
            const nextTs15min = currentTs + 15 * 60 * 1000;
            const nextTs1hour = currentTs + 60 * 60 * 1000;

            if (pricesMap.has(nextTs15min) && !pricesMap.has(nextTs1hour)) {
                // Quarterly data
                timeStepMs = 15 * 60 * 1000;
                resolution = 'quarterly';
                durationHours = 0.25;
            }

            // Check if we need to make a new plan (at 13:00 each day)
            if (currentTime.getHours() === 13 && currentTime.getMinutes() === 0) {
                // Planning window: from now until midnight of next day (35 hours)
                const planStart = new Date(currentTime);
                const planEnd = new Date(currentTime);
                planEnd.setDate(planEnd.getDate() + 2);
                planEnd.setHours(0, 0, 0, 0);

                // Gather prices for planning window (use current resolution)
                const planPrices = [];
                let checkTime = new Date(planStart);
                while (checkTime < planEnd) {
                    const ts = checkTime.getTime();
                    if (pricesMap.has(ts)) {
                        planPrices.push({
                            timestamp: ts,
                            price: pricesMap.get(ts)
                        });
                    }
                    checkTime = new Date(checkTime.getTime() + timeStepMs);
                }

                // Optimize (MILP - async operation)
                if (planPrices.length > 0) {
                    const newPlan = await this.optimizer.optimize(
                        planPrices,
                        this.battery.socKwh,
                        resolution
                    );

                    // Convert to Map for fast lookup
                    this.currentPlan = new Map();
                    for (const action of newPlan) {
                        this.currentPlan.set(action.timestamp, action);
                    }
                }

                // Update progress
                if (progressCallback && (Date.now() - lastProgressUpdate > 100)) {
                    const elapsed = currentTime - startDate;
                    const progress = (elapsed / totalDuration) * 100;
                    progressCallback(progress, `Simuleren ${currentTime.toISOString().split('T')[0]}`);
                    lastProgressUpdate = Date.now();
                    // Allow UI to update
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Calculate buy/sell prices (using same formulas as optimizer)
            const buyPrice = this.optimizer.priceConfig.buyFormula(priceEurMwh);
            const sellPrice = this.optimizer.priceConfig.sellFormula(priceEurMwh);

            // Execute action if we have a plan
            let action = 'idle';
            let energyKwh = 0;
            let profit = 0;

            if (this.currentPlan && this.currentPlan.has(currentTs)) {
                const plannedAction = this.currentPlan.get(currentTs);

                if (plannedAction.action === 'charge') {
                    const [dcToBattery, acFromGrid] = this.battery.charge(
                        plannedAction.energyKwh,
                        durationHours
                    );
                    energyKwh = acFromGrid;
                    profit = -acFromGrid * buyPrice;
                    if (dcToBattery > 0.001) {
                        action = 'charge';
                    }
                } else if (plannedAction.action === 'discharge') {
                    const [dcFromBattery, acToGrid] = this.battery.discharge(
                        plannedAction.energyKwh,
                        durationHours
                    );
                    energyKwh = acToGrid;
                    profit = acToGrid * sellPrice;
                    if (dcFromBattery > 0.001) {
                        action = 'discharge';
                    }
                }
            }

            // Record state
            this.history.push({
                timestamp: new Date(currentTime),
                action: action,
                energyKwh: energyKwh,
                socKwh: this.battery.socKwh,
                socPct: this.battery.socPct,
                priceEurMwh: priceEurMwh,
                buyPrice: buyPrice,
                sellPrice: sellPrice,
                profitEur: profit
            });

            // Next timestep
            currentTime = new Date(currentTime.getTime() + timeStepMs);
        }

        if (progressCallback) {
            progressCallback(100, 'Simulatie voltooid');
        }

        return this.history;
    }

    /**
     * Generate monthly summary from simulation results
     * @param {Array} results - Simulation results
     * @returns {Array<Object>} Monthly summary with profit, cycles, etc.
     */
    getMonthlySummary(results) {
        // Group by year-month
        const monthlyData = {};

        for (const row of results) {
            const year = row.timestamp.getFullYear();
            const month = row.timestamp.getMonth() + 1;  // 1-12
            const key = `${year}-${String(month).padStart(2, '0')}`;

            if (!monthlyData[key]) {
                monthlyData[key] = {
                    monthName: key,
                    year: year,
                    month: month,
                    profitEur: 0,
                    chargeActions: [],
                    dischargeActions: []
                };
            }

            monthlyData[key].profitEur += row.profitEur;

            if (row.action === 'charge') {
                monthlyData[key].chargeActions.push(row);
            } else if (row.action === 'discharge') {
                monthlyData[key].dischargeActions.push(row);
            }
        }

        // Calculate cycles and other metrics
        const summary = [];
        for (const [key, data] of Object.entries(monthlyData)) {
            // Calculate total energy throughput
            let totalChargedToBattery = 0;
            for (const action of data.chargeActions) {
                // energy_kwh is AC from grid, battery gets AC * efficiency
                totalChargedToBattery += action.energyKwh * this.batteryConfig.chargeEfficiency;
            }

            let totalDischargedFromBattery = 0;
            for (const action of data.dischargeActions) {
                // energy_kwh is AC to grid, battery gave AC / efficiency
                totalDischargedFromBattery += action.energyKwh / this.batteryConfig.dischargeEfficiency;
            }

            // Cycles = average throughput / capacity
            const avgThroughput = (totalChargedToBattery + totalDischargedFromBattery) / 2;
            const cycles = avgThroughput / this.batteryConfig.capacityKwh;

            const profitPerCycle = cycles > 0 ? data.profitEur / cycles : 0;

            summary.push({
                monthName: data.monthName,
                profitEur: data.profitEur,
                cycles: cycles,
                profitPerCycle: profitPerCycle,
                chargePeriods: data.chargeActions.length,
                dischargePeriods: data.dischargeActions.length
            });
        }

        return summary.sort((a, b) => a.monthName.localeCompare(b.monthName));
    }

    /**
     * Calculate total metrics
     * @param {Array} monthlySummary - Monthly summary
     * @returns {Object} Total profit, cycles, etc.
     */
    getTotals(monthlySummary) {
        const totalProfit = monthlySummary.reduce((sum, m) => sum + m.profitEur, 0);
        const totalCycles = monthlySummary.reduce((sum, m) => sum + m.cycles, 0);
        const avgProfitPerCycle = totalCycles > 0 ? totalProfit / totalCycles : 0;

        return {
            totalProfit,
            totalCycles,
            avgProfitPerCycle
        };
    }

    /**
     * Reset simulator
     */
    reset() {
        this.battery.reset(this.config.initialSocPct);
        this.history = [];
        this.currentPlan = null;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BatterySimulator;
}
