/**
 * Solar Simulator - Simulates battery with PV generation and consumption
 * Compares scenarios: no battery, with battery, and fixed contract
 */

class SolarSimulator {
    /**
     * @param {Object} batteryConfig - Battery configuration
     * @param {Object} priceConfig - Dynamic price configuration (buy/sell formulas)
     * @param {Object} fixedPriceConfig - Fixed contract prices {buy, sell} in EUR/kWh
     * @param {Object} simulationConfig - Simulation configuration {initialSocPct}
     * @param {Array} pricesData - Dynamic price data [{timestamp, price}, ...]
     * @param {Array} consumptionData - Consumption data [{timestamp, kwh}, ...]
     * @param {Array} solarData - Solar generation data [{timestamp, kwh}, ...]
     */
    constructor(batteryConfig, priceConfig, fixedPriceConfig, simulationConfig, pricesData, consumptionData, solarData) {
        this.batteryConfig = batteryConfig;
        this.priceConfig = priceConfig;
        this.fixedPriceConfig = fixedPriceConfig;
        this.simulationConfig = simulationConfig;
        this.pricesData = pricesData;
        this.consumptionData = consumptionData;
        this.solarData = solarData;
    }

    /**
     * Run all four scenarios
     * @param {Function} progressCallback - Progress callback
     * @returns {Promise<Object>} Results for all scenarios
     */
    async simulateAll(progressCallback = null) {
        if (progressCallback) progressCallback(10, 'Scenario 1: Zonder batterij');
        const noBatteryResult = await this.simulateNoBattery();

        if (progressCallback) progressCallback(30, 'Scenario 2: Met batterij (dynamisch)');
        const withBatteryResult = await this.simulateWithBattery(progressCallback);

        if (progressCallback) progressCallback(60, 'Scenario 3: Vast contract');
        const fixedContractResult = await this.simulateFixedContract();

        if (progressCallback) progressCallback(80, 'Scenario 4: Vast + batterij');
        const fixedWithBatteryResult = await this.simulateFixedWithBattery();

        if (progressCallback) progressCallback(100, 'Simulatie voltooid');

        return {
            noBattery: noBatteryResult,
            withBattery: withBatteryResult,
            fixedContract: fixedContractResult,
            fixedWithBattery: fixedWithBatteryResult
        };
    }

    /**
     * Scenario 1: No battery, dynamic prices
     * Direct consumption from solar, buy shortage, sell surplus
     */
    async simulateNoBattery() {
        const history = [];
        let totalCost = 0;
        let totalConsumption = 0;
        let totalSolarGeneration = 0;
        let totalSolarSelfUsed = 0;  // Solar energy used directly
        let totalGridImport = 0;
        let totalGridExport = 0;

        // Merge data by timestamp
        const mergedData = this.mergeData();

        for (const entry of mergedData) {
            const consumption = entry.consumption;
            const solar = entry.solar;
            const dynamicBuyPrice = this.priceConfig.buyFormula(entry.priceEurMwh);
            const dynamicSellPrice = this.priceConfig.sellFormula(entry.priceEurMwh);

            // Net demand: positive = shortage, negative = surplus
            const netDemand = consumption - solar;

            let gridImport = 0;
            let gridExport = 0;
            let solarSelfUsed = 0;
            let cost = 0;

            if (netDemand > 0) {
                // Shortage: buy from grid
                gridImport = netDemand;
                cost = gridImport * dynamicBuyPrice;
                solarSelfUsed = solar;  // All solar is used
            } else {
                // Surplus: sell to grid
                gridExport = -netDemand;
                cost = -gridExport * dynamicSellPrice;  // Negative cost = revenue
                solarSelfUsed = consumption;  // Only part of solar is used
            }

            totalCost += cost;
            totalConsumption += consumption;
            totalSolarGeneration += solar;
            totalSolarSelfUsed += solarSelfUsed;
            totalGridImport += gridImport;
            totalGridExport += gridExport;

            history.push({
                timestamp: entry.timestamp,
                consumption: consumption,
                solar: solar,
                solarSelfUsed: solarSelfUsed,
                gridImport: gridImport,
                gridExport: gridExport,
                buyPrice: dynamicBuyPrice,
                sellPrice: dynamicSellPrice,
                cost: cost
            });
        }

        // Calculate self-consumption and self-sufficiency
        const selfConsumptionPct = totalSolarGeneration > 0
            ? (totalSolarSelfUsed / totalSolarGeneration) * 100
            : 0;
        // Self-sufficiency = how much of consumption did NOT come from grid
        const selfSufficiencyPct = totalConsumption > 0
            ? ((totalConsumption - totalGridImport) / totalConsumption) * 100
            : 0;

        return {
            history: history,
            totalCost: totalCost,
            totalConsumption: totalConsumption,
            totalSolarGeneration: totalSolarGeneration,
            totalSolarSelfUsed: totalSolarSelfUsed,
            totalGridImport: totalGridImport,
            totalGridExport: totalGridExport,
            selfConsumptionPct: selfConsumptionPct,
            selfSufficiencyPct: selfSufficiencyPct
        };
    }

    /**
     * Scenario 2: With battery, dynamic prices
     * Battery optimizes based on prices, consumption, and solar
     */
    async simulateWithBattery(progressCallback = null) {
        // Create battery and optimizer
        const battery = new Battery(this.batteryConfig, this.simulationConfig.initialSocPct);
        const optimizer = new BatteryOptimizer(this.batteryConfig, this.priceConfig);

        const history = [];
        let totalCost = 0;
        let totalConsumption = 0;
        let totalSolarGeneration = 0;
        let totalSolarSelfUsed = 0;  // PV direct to consumption
        let totalSolarToBattery = 0;
        let totalBatteryToConsumption = 0;  // Battery to consumption
        let totalGridImport = 0;
        let totalGridExport = 0;
        let totalBatteryCharge = 0;
        let totalBatteryDischarge = 0;

        const mergedData = this.mergeData();
        let currentPlan = null;
        let needsInitialPlan = true;

        for (let i = 0; i < mergedData.length; i++) {
            const entry = mergedData[i];
            const currentTime = entry.timestamp;
            const consumption = entry.consumption;
            const solar = entry.solar;
            const dynamicBuyPrice = this.priceConfig.buyFormula(entry.priceEurMwh);
            const dynamicSellPrice = this.priceConfig.sellFormula(entry.priceEurMwh);

            // Check if we need to make a new plan
            const hour = currentTime.getHours();
            const shouldMakePlan = needsInitialPlan || hour === 13;

            if (shouldMakePlan) {
                needsInitialPlan = false;

                // Plan for next ~35 hours
                const planStart = new Date(currentTime);
                const planEnd = new Date(currentTime);
                planEnd.setDate(planEnd.getDate() + 2);
                planEnd.setHours(0, 0, 0, 0);

                // Gather prices and forecast for planning window
                const planPrices = [];
                const planForecast = [];
                for (let j = i; j < mergedData.length; j++) {
                    const planEntry = mergedData[j];
                    if (planEntry.timestamp >= planEnd) break;
                    if (planEntry.timestamp >= planStart) {
                        planPrices.push({
                            timestamp: planEntry.timestamp.getTime(),
                            price: planEntry.priceEurMwh
                        });
                        planForecast.push({
                            timestamp: planEntry.timestamp.getTime(),
                            consumption: planEntry.consumption,
                            solar: planEntry.solar
                        });
                    }
                }

                // Optimize with forecast (perfect foresight)
                if (planPrices.length > 0) {
                    const newPlan = await optimizer.optimize(
                        planPrices,
                        battery.socKwh,
                        'hourly',
                        planForecast  // Pass forecast data
                    );

                    // Convert to Map
                    currentPlan = new Map();
                    for (const action of newPlan) {
                        currentPlan.set(action.timestamp, action);
                    }
                }

                // Progress update
                if (progressCallback) {
                    const progress = 40 + (i / mergedData.length) * 30;
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            // Net demand from grid's perspective (after solar)
            const netDemand = consumption - solar;

            // Execute battery plan if we have one
            let batteryAction = 'idle';
            let batteryEnergyKwh = 0;
            const currentTs = currentTime.getTime();

            if (currentPlan && currentPlan.has(currentTs)) {
                const plannedAction = currentPlan.get(currentTs);

                if (plannedAction.action === 'charge') {
                    const [dcToBattery, acFromGrid] = battery.charge(plannedAction.energyKwh, 1.0);
                    if (dcToBattery > 0.001) {
                        batteryAction = 'charge';
                        batteryEnergyKwh = acFromGrid;
                        totalBatteryCharge += dcToBattery;
                    }
                } else if (plannedAction.action === 'discharge') {
                    const [dcFromBattery, acToGrid] = battery.discharge(plannedAction.energyKwh, 1.0);
                    if (dcFromBattery > 0.001) {
                        batteryAction = 'discharge';
                        batteryEnergyKwh = acToGrid;
                        totalBatteryDischarge += dcFromBattery;
                    }
                }
            }

            // Energy flow accounting with correct prioritization
            // Available sources
            let availableSolar = solar;
            let availableBattery = (batteryAction === 'discharge' ? batteryEnergyKwh : 0);

            // Energy sinks
            let sinkConsumption = consumption;
            let sinkBattery = (batteryAction === 'charge' ? batteryEnergyKwh : 0);

            // Priority 1: Solar → Consumption (direct use)
            const solarToConsumption = Math.min(availableSolar, sinkConsumption);
            availableSolar -= solarToConsumption;
            sinkConsumption -= solarToConsumption;

            // Priority 2: Solar → Battery (store PV surplus)
            const solarToBattery = Math.min(availableSolar, sinkBattery);
            availableSolar -= solarToBattery;
            sinkBattery -= solarToBattery;

            // Priority 3: Battery → Consumption (use stored energy)
            const batteryToConsumption = Math.min(availableBattery, sinkConsumption);
            availableBattery -= batteryToConsumption;
            sinkConsumption -= batteryToConsumption;

            // Remaining sinks need grid import
            const gridImport = sinkConsumption + sinkBattery;

            // Remaining sources go to grid export
            const gridExport = availableSolar + availableBattery;

            // Calculate cost
            let cost = 0;
            if (gridImport > 0) {
                cost += gridImport * dynamicBuyPrice;
            }
            if (gridExport > 0) {
                cost -= gridExport * dynamicSellPrice;
            }

            // For metrics
            const solarSelfUsed = solarToConsumption;

            totalCost += cost;
            totalConsumption += consumption;
            totalSolarGeneration += solar;
            totalSolarSelfUsed += solarSelfUsed;
            totalSolarToBattery += solarToBattery;
            totalBatteryToConsumption += batteryToConsumption;
            totalGridImport += gridImport;
            totalGridExport += gridExport;

            history.push({
                timestamp: currentTime,
                consumption: consumption,
                solar: solar,
                solarSelfUsed: solarSelfUsed,
                solarToBattery: solarToBattery,
                batteryToConsumption: batteryToConsumption,
                batteryAction: batteryAction,
                batteryEnergyKwh: batteryEnergyKwh,
                batterySocPct: battery.socPct,
                gridImport: gridImport,
                gridExport: gridExport,
                buyPrice: dynamicBuyPrice,
                sellPrice: dynamicSellPrice,
                cost: cost
            });
        }

        // Calculate metrics
        const totalSolarUsed = totalSolarSelfUsed + totalSolarToBattery;
        const selfConsumptionPct = totalSolarGeneration > 0
            ? (totalSolarUsed / totalSolarGeneration) * 100
            : 0;
        // Self-sufficiency = consumption covered by PV + battery
        const totalSelfSupplied = totalSolarSelfUsed + totalBatteryToConsumption;
        const selfSufficiencyPct = totalConsumption > 0
            ? (totalSelfSupplied / totalConsumption) * 100
            : 0;

        // Calculate battery cycles
        const avgThroughput = (totalBatteryCharge + totalBatteryDischarge) / 2;
        const cycles = avgThroughput / this.batteryConfig.capacityKwh;

        return {
            history: history,
            totalCost: totalCost,
            totalConsumption: totalConsumption,
            totalSolarGeneration: totalSolarGeneration,
            totalSolarSelfUsed: totalSolarSelfUsed,
            totalSolarToBattery: totalSolarToBattery,
            totalSolarUsed: totalSolarUsed,
            totalGridImport: totalGridImport,
            totalGridExport: totalGridExport,
            totalBatteryCharge: totalBatteryCharge,
            totalBatteryDischarge: totalBatteryDischarge,
            cycles: cycles,
            selfConsumptionPct: selfConsumptionPct,
            selfSufficiencyPct: selfSufficiencyPct
        };
    }

    /**
     * Scenario 3: Fixed contract prices (no battery)
     */
    async simulateFixedContract() {
        const history = [];
        let totalCost = 0;
        let totalConsumption = 0;
        let totalSolarGeneration = 0;
        let totalSolarSelfUsed = 0;
        let totalGridImport = 0;
        let totalGridExport = 0;

        const mergedData = this.mergeData();

        for (const entry of mergedData) {
            const consumption = entry.consumption;
            const solar = entry.solar;
            const fixedBuyPrice = this.fixedPriceConfig.buy;
            const fixedSellPrice = this.fixedPriceConfig.sell;

            const netDemand = consumption - solar;

            let gridImport = 0;
            let gridExport = 0;
            let solarSelfUsed = 0;
            let cost = 0;

            if (netDemand > 0) {
                gridImport = netDemand;
                cost = gridImport * fixedBuyPrice;
                solarSelfUsed = solar;
            } else {
                gridExport = -netDemand;
                cost = -gridExport * fixedSellPrice;
                solarSelfUsed = consumption;
            }

            totalCost += cost;
            totalConsumption += consumption;
            totalSolarGeneration += solar;
            totalSolarSelfUsed += solarSelfUsed;
            totalGridImport += gridImport;
            totalGridExport += gridExport;

            history.push({
                timestamp: entry.timestamp,
                consumption: consumption,
                solar: solar,
                solarSelfUsed: solarSelfUsed,
                gridImport: gridImport,
                gridExport: gridExport,
                cost: cost
            });
        }

        const selfConsumptionPct = totalSolarGeneration > 0
            ? (totalSolarSelfUsed / totalSolarGeneration) * 100
            : 0;
        // Self-sufficiency = how much of consumption did NOT come from grid
        const selfSufficiencyPct = totalConsumption > 0
            ? ((totalConsumption - totalGridImport) / totalConsumption) * 100
            : 0;

        return {
            history: history,
            totalCost: totalCost,
            totalConsumption: totalConsumption,
            totalSolarGeneration: totalSolarGeneration,
            totalSolarSelfUsed: totalSolarSelfUsed,
            totalGridImport: totalGridImport,
            totalGridExport: totalGridExport,
            selfConsumptionPct: selfConsumptionPct,
            selfSufficiencyPct: selfSufficiencyPct
        };
    }

    /**
     * Scenario 4: Fixed contract with battery (self-sufficiency maximization)
     * Simple strategy: charge from PV surplus, discharge to cover demand
     */
    async simulateFixedWithBattery() {
        const battery = new Battery(this.batteryConfig, this.simulationConfig.initialSocPct);

        const history = [];
        let totalCost = 0;
        let totalConsumption = 0;
        let totalSolarGeneration = 0;
        let totalSolarSelfUsed = 0;
        let totalSolarToBattery = 0;
        let totalBatteryToConsumption = 0;
        let totalGridImport = 0;
        let totalGridExport = 0;
        let totalBatteryCharge = 0;
        let totalBatteryDischarge = 0;

        const mergedData = this.mergeData();

        for (const entry of mergedData) {
            const consumption = entry.consumption;
            const solar = entry.solar;
            const fixedBuyPrice = this.fixedPriceConfig.buy;
            const fixedSellPrice = this.fixedPriceConfig.sell;

            // Simple strategy: maximize self-sufficiency
            // 1. Use solar directly for consumption
            // 2. Excess solar → charge battery
            // 3. Deficit → discharge battery
            // 4. Grid only as last resort

            let solarToConsumption = Math.min(solar, consumption);
            let remainingSolar = solar - solarToConsumption;
            let remainingConsumption = consumption - solarToConsumption;

            // Try to charge battery from excess solar
            let solarToBattery = 0;
            let batteryAction = 'idle';
            if (remainingSolar > 0) {
                const [dcCharged, acUsed] = battery.charge(remainingSolar, 1.0);
                if (dcCharged > 0.001) {
                    solarToBattery = acUsed;
                    remainingSolar -= acUsed;
                    batteryAction = 'charge';
                    totalBatteryCharge += dcCharged;
                }
            }

            // Try to discharge battery to cover remaining consumption
            let batteryToConsumption = 0;
            if (remainingConsumption > 0) {
                const [dcDischarged, acProvided] = battery.discharge(remainingConsumption, 1.0);
                if (dcDischarged > 0.001) {
                    batteryToConsumption = acProvided;
                    remainingConsumption -= acProvided;
                    batteryAction = 'discharge';
                    totalBatteryDischarge += dcDischarged;
                }
            }

            // Grid import/export for what remains
            const gridImport = remainingConsumption;
            const gridExport = remainingSolar;

            // Calculate cost
            let cost = 0;
            if (gridImport > 0) {
                cost += gridImport * fixedBuyPrice;
            }
            if (gridExport > 0) {
                cost -= gridExport * fixedSellPrice;
            }

            totalCost += cost;
            totalConsumption += consumption;
            totalSolarGeneration += solar;
            totalSolarSelfUsed += solarToConsumption;
            totalSolarToBattery += solarToBattery;
            totalBatteryToConsumption += batteryToConsumption;
            totalGridImport += gridImport;
            totalGridExport += gridExport;

            history.push({
                timestamp: entry.timestamp,
                consumption: consumption,
                solar: solar,
                solarSelfUsed: solarToConsumption,
                solarToBattery: solarToBattery,
                batteryToConsumption: batteryToConsumption,
                batteryAction: batteryAction,
                batterySocPct: battery.socPct,
                gridImport: gridImport,
                gridExport: gridExport,
                cost: cost
            });
        }

        // Calculate metrics
        const totalSolarUsed = totalSolarSelfUsed + totalSolarToBattery;
        const selfConsumptionPct = totalSolarGeneration > 0
            ? (totalSolarUsed / totalSolarGeneration) * 100
            : 0;
        const totalSelfSupplied = totalSolarSelfUsed + totalBatteryToConsumption;
        const selfSufficiencyPct = totalConsumption > 0
            ? (totalSelfSupplied / totalConsumption) * 100
            : 0;

        const avgThroughput = (totalBatteryCharge + totalBatteryDischarge) / 2;
        const cycles = avgThroughput / this.batteryConfig.capacityKwh;

        return {
            history: history,
            totalCost: totalCost,
            totalConsumption: totalConsumption,
            totalSolarGeneration: totalSolarGeneration,
            totalSolarSelfUsed: totalSolarSelfUsed,
            totalSolarToBattery: totalSolarToBattery,
            totalSolarUsed: totalSolarUsed,
            totalGridImport: totalGridImport,
            totalGridExport: totalGridExport,
            totalBatteryCharge: totalBatteryCharge,
            totalBatteryDischarge: totalBatteryDischarge,
            cycles: cycles,
            selfConsumptionPct: selfConsumptionPct,
            selfSufficiencyPct: selfSufficiencyPct
        };
    }

    /**
     * Merge prices, consumption, and solar data by timestamp
     * @returns {Array} Merged data [{timestamp, priceEurMwh, consumption, solar}, ...]
     */
    mergeData() {
        const merged = [];

        // Create maps for fast lookup
        const consumptionMap = new Map();
        for (const entry of this.consumptionData) {
            const ts = new Date(entry.timestamp).getTime();
            consumptionMap.set(ts, entry.kwh);
        }

        const solarMap = new Map();
        for (const entry of this.solarData) {
            const ts = new Date(entry.timestamp).getTime();
            solarMap.set(ts, entry.kwh);
        }

        // Iterate through prices (master timeline)
        for (const priceEntry of this.pricesData) {
            const ts = new Date(priceEntry.timestamp).getTime();
            const consumption = consumptionMap.get(ts) || 0;
            const solar = solarMap.get(ts) || 0;

            merged.push({
                timestamp: new Date(ts),
                priceEurMwh: priceEntry.price,
                consumption: consumption,
                solar: solar
            });
        }

        return merged;
    }

    /**
     * Generate monthly summary
     * @param {Object} scenarioResult - Result from one scenario
     * @returns {Array} Monthly summary
     */
    getMonthlySummary(scenarioResult) {
        const monthlyData = {};

        for (const row of scenarioResult.history) {
            const year = row.timestamp.getFullYear();
            const month = row.timestamp.getMonth() + 1;
            const key = `${year}-${String(month).padStart(2, '0')}`;

            if (!monthlyData[key]) {
                monthlyData[key] = {
                    monthName: key,
                    cost: 0,
                    consumption: 0,
                    solar: 0,
                    solarSelfUsed: 0,
                    solarToBattery: 0,
                    batteryToConsumption: 0,
                    gridImport: 0,
                    gridExport: 0
                };
            }

            monthlyData[key].cost += row.cost;
            monthlyData[key].consumption += row.consumption;
            monthlyData[key].solar += row.solar;
            monthlyData[key].solarSelfUsed += row.solarSelfUsed;
            monthlyData[key].solarToBattery += (row.solarToBattery || 0);  // Only exists in "with battery" scenario
            monthlyData[key].batteryToConsumption += (row.batteryToConsumption || 0);  // Only exists in "with battery" scenario
            monthlyData[key].gridImport += row.gridImport;
            monthlyData[key].gridExport += row.gridExport;
        }

        const summary = [];
        for (const [key, data] of Object.entries(monthlyData)) {
            // Self-consumption: PV used (direct + to battery) / total PV
            const totalSolarUsed = data.solarSelfUsed + data.solarToBattery;
            const selfConsumptionPct = data.solar > 0
                ? (totalSolarUsed / data.solar) * 100
                : 0;

            // Self-sufficiency: consumption covered by PV + battery
            const totalSelfSupplied = data.solarSelfUsed + data.batteryToConsumption;
            const selfSufficiencyPct = data.consumption > 0
                ? (totalSelfSupplied / data.consumption) * 100
                : 0;

            summary.push({
                monthName: data.monthName,
                cost: data.cost,
                consumption: data.consumption,
                solar: data.solar,
                solarSelfUsed: data.solarSelfUsed,
                gridImport: data.gridImport,
                gridExport: data.gridExport,
                selfConsumptionPct: selfConsumptionPct,
                selfSufficiencyPct: selfSufficiencyPct
            });
        }

        return summary.sort((a, b) => a.monthName.localeCompare(b.monthName));
    }

    /**
     * Get daily summary for a specific month (for drill-down view)
     * @param {string} monthKey - Month key (YYYY-MM)
     * @param {Object} withBatteryResult - Result from withBattery scenario
     * @param {Object} fixedContractResult - Result from fixedContract scenario
     * @returns {Array} Daily summary
     */
    getDailySummary(monthKey, withBatteryResult, fixedContractResult) {
        const dailyMap = new Map();

        // Process with battery results
        for (const hour of withBatteryResult.history) {
            const date = hour.timestamp;
            const dateKey = date.toISOString().split('T')[0];  // YYYY-MM-DD
            const hourMonthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            // Only include this month
            if (hourMonthKey !== monthKey) continue;

            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, {
                    date: dateKey,
                    dateFormatted: date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }),
                    cost: 0,
                    gridImport: 0,
                    gridExport: 0,
                    batteryCharge: 0,
                    batteryDischarge: 0,
                    minSoc: 100,
                    maxSoc: 0,
                    costNoBattery: 0
                });
            }

            const dayData = dailyMap.get(dateKey);
            dayData.cost += hour.cost;
            dayData.gridImport += hour.gridImport;
            dayData.gridExport += hour.gridExport;
            dayData.batteryCharge += (hour.batteryEnergyKwh && hour.batteryAction === 'charge') ? hour.batteryEnergyKwh : 0;
            dayData.batteryDischarge += (hour.batteryEnergyKwh && hour.batteryAction === 'discharge') ? hour.batteryEnergyKwh : 0;

            // Track SoC range
            const socPct = hour.batterySocPct;
            dayData.minSoc = Math.min(dayData.minSoc, socPct);
            dayData.maxSoc = Math.max(dayData.maxSoc, socPct);
        }

        // Add fixed contract costs for comparison
        for (const hour of fixedContractResult.history) {
            const date = hour.timestamp;
            const dateKey = date.toISOString().split('T')[0];
            const hourMonthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (hourMonthKey !== monthKey) continue;
            if (!dailyMap.has(dateKey)) continue;

            const dayData = dailyMap.get(dateKey);
            dayData.costNoBattery += hour.cost;
        }

        // Calculate cycles and savings
        const dailyArray = Array.from(dailyMap.values()).map(day => {
            const avgThroughput = (day.batteryCharge + day.batteryDischarge) / 2;
            const cycles = avgThroughput / this.batteryConfig.capacityKwh;
            const savings = day.costNoBattery - day.cost;

            return {
                ...day,
                cycles,
                savings
            };
        });

        return dailyArray.sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * Get timestep (hourly) data for a specific day (for drill-down view)
     * @param {string} dateKey - Date key (YYYY-MM-DD)
     * @param {Object} withBatteryResult - Result from withBattery scenario
     * @returns {Array} Timestep data
     */
    getTimestepSummary(dateKey, withBatteryResult) {
        const timesteps = [];

        for (const hour of withBatteryResult.history) {
            const date = hour.timestamp;
            const hourDateKey = date.toISOString().split('T')[0];

            // Only include this day
            if (hourDateKey !== dateKey) continue;

            const socPct = hour.batterySocPct;
            const socKwh = (socPct / 100) * this.batteryConfig.capacityKwh;

            // Calculate net grid flow (positive = import, negative = export)
            const netGridFlow = hour.gridImport - hour.gridExport;
            const netGridFlowAfterBattery = netGridFlow;  // Already includes battery effects

            timesteps.push({
                timestamp: hour.timestamp,
                consumption: hour.consumption,
                solar: hour.solar,
                netGridFlow: hour.consumption - hour.solar,  // Before battery
                netGridFlowAfterBattery: netGridFlowAfterBattery,
                gridImport: hour.gridImport,
                gridExport: hour.gridExport,
                batteryCharge: (hour.batteryAction === 'charge') ? hour.batteryEnergyKwh : 0,
                batteryDischarge: (hour.batteryAction === 'discharge') ? hour.batteryEnergyKwh : 0,
                batterySocKwh: socKwh,
                batterySocPct: socPct,
                cost: hour.cost,
                buyPrice: hour.buyPrice,
                sellPrice: hour.sellPrice
            });
        }

        return timesteps.sort((a, b) => a.timestamp - b.timestamp);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SolarSimulator;
}
