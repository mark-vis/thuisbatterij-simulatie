/**
 * Custom Data Simulator - Simulate battery optimization with user-uploaded P1 data
 */

class CustomDataSimulator {
    constructor(batteryConfig, priceConfig, fixedPriceConfig, gridFlowData, pricesData, dataInterval = 60) {
        this.batteryConfig = batteryConfig;
        this.priceConfig = priceConfig;
        this.fixedPriceConfig = fixedPriceConfig;
        this.gridFlowData = gridFlowData;  // Net grid flows from P1 data (matched to price interval)
        this.pricesData = pricesData;       // EPEX prices
        this.dataInterval = dataInterval;   // Data interval in minutes (15 or 60, matches prices)
        this.durationHours = dataInterval / 60;  // 0.25 for quarterly, 1.0 for hourly
    }

    /**
     * Simulate all four scenarios: fixed/dynamic, with/without battery
     */
    async simulateAll(progressCallback) {
        progressCallback(10, 'Scenario 1: Vast contract zonder batterij...');
        await new Promise(resolve => setTimeout(resolve, 0));
        const fixedNoBattery = await this.simulateFixedContract();

        progressCallback(30, 'Scenario 2: Vast contract met batterij...');
        await new Promise(resolve => setTimeout(resolve, 0));
        const fixedWithBattery = await this.simulateFixedWithBattery();

        progressCallback(50, 'Scenario 3: Dynamisch zonder batterij...');
        await new Promise(resolve => setTimeout(resolve, 0));
        const dynamicNoBattery = await this.simulateDynamicNoBattery();

        progressCallback(70, 'Scenario 4: Dynamisch met batterij (MILP)...');
        await new Promise(resolve => setTimeout(resolve, 0));
        const dynamicWithBattery = await this.simulateDynamicWithBattery(progressCallback);

        progressCallback(100, 'Simulatie voltooid');

        return {
            fixedNoBattery,
            fixedWithBattery,
            dynamicNoBattery,
            dynamicWithBattery
        };
    }

    /**
     * Scenario 1: Fixed contract, no battery
     */
    async simulateFixedContract() {
        let totalCost = 0;
        let totalImport = 0;
        let totalExport = 0;

        const hourlyResults = [];

        for (let i = 0; i < this.gridFlowData.length; i++) {
            const flow = this.gridFlowData[i];

            const buyPrice = this.fixedPriceConfig.buy;
            const sellPrice = this.fixedPriceConfig.sell;

            // Net grid flow: positive = import (buy), negative = export (sell)
            let hourlyCost = 0;
            let hourlyImport = 0;
            let hourlyExport = 0;

            if (flow.netGridFlow > 0) {
                // Import from grid
                hourlyCost = flow.netGridFlow * buyPrice;
                hourlyImport = flow.netGridFlow;
            } else {
                // Export to grid
                hourlyCost = flow.netGridFlow * sellPrice;  // negative * positive = negative cost
                hourlyExport = -flow.netGridFlow;
            }

            totalCost += hourlyCost;
            totalImport += hourlyImport;
            totalExport += hourlyExport;

            hourlyResults.push({
                timestamp: flow.timestamp,
                netGridFlow: flow.netGridFlow,
                gridImport: hourlyImport,
                gridExport: hourlyExport,
                cost: hourlyCost,
                buyPrice,
                sellPrice
            });

            // Yield to event loop every 500 iterations
            if (i % 500 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return {
            totalCost,
            totalImport,
            totalExport,
            hourlyResults
        };
    }

    /**
     * Scenario 2: Fixed contract, with battery (greedy strategy)
     */
    async simulateFixedWithBattery() {
        const battery = new Battery(this.batteryConfig, this.batteryConfig.initialSocPct);

        let totalCost = 0;
        let totalImport = 0;
        let totalExport = 0;
        let totalCharged = 0;
        let totalDischarged = 0;

        const hourlyResults = [];

        for (let i = 0; i < this.gridFlowData.length; i++) {
            const flow = this.gridFlowData[i];

            const buyPrice = this.fixedPriceConfig.buy;
            const sellPrice = this.fixedPriceConfig.sell;

            // Greedy strategy: maximize self-sufficiency
            // - When exporting (negative netGridFlow): charge battery
            // - When importing (positive netGridFlow): discharge battery
            let actualCharge = 0;
            let actualDischarge = 0;

            if (flow.netGridFlow < 0) {
                // Surplus (export): try to charge battery
                const availableSurplus = -flow.netGridFlow;
                const [dcToBattery, acFromGrid] = battery.charge(availableSurplus, this.durationHours);
                if (dcToBattery > 0.001) {
                    actualCharge = acFromGrid;
                    totalCharged += dcToBattery;
                }
            } else if (flow.netGridFlow > 0) {
                // Deficit (import): try to discharge battery
                const neededPower = flow.netGridFlow;
                const [dcFromBattery, acToGrid] = battery.discharge(neededPower, this.durationHours);
                if (dcFromBattery > 0.001) {
                    actualDischarge = acToGrid;
                    totalDischarged += dcFromBattery;
                }
            }

            // Calculate net grid flow after battery
            const batteryContribution = actualDischarge - actualCharge;
            const netFlowAfterBattery = flow.netGridFlow - batteryContribution;

            // Calculate grid import/export and costs
            let hourlyCost = 0;
            let hourlyImport = 0;
            let hourlyExport = 0;

            if (netFlowAfterBattery > 0) {
                hourlyCost = netFlowAfterBattery * buyPrice;
                hourlyImport = netFlowAfterBattery;
            } else if (netFlowAfterBattery < 0) {
                hourlyCost = netFlowAfterBattery * sellPrice;
                hourlyExport = -netFlowAfterBattery;
            }

            totalCost += hourlyCost;
            totalImport += hourlyImport;
            totalExport += hourlyExport;

            hourlyResults.push({
                timestamp: flow.timestamp,
                netGridFlow: flow.netGridFlow,
                netGridFlowAfterBattery: netFlowAfterBattery,
                gridImport: hourlyImport,
                gridExport: hourlyExport,
                batteryCharge: actualCharge,
                batteryDischarge: actualDischarge,
                batterySoc: battery.socKwh,
                cost: hourlyCost,
                buyPrice,
                sellPrice
            });

            // Yield to event loop every 500 iterations
            if (i % 500 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Calculate cycles
        const avgThroughput = (totalCharged + totalDischarged) / 2;
        const cycles = avgThroughput / this.batteryConfig.capacityKwh;

        return {
            totalCost,
            totalImport,
            totalExport,
            totalCharged,
            totalDischarged,
            cycles,
            hourlyResults
        };
    }

    /**
     * Scenario 3: Dynamic prices, no battery
     */
    async simulateDynamicNoBattery() {
        let totalCost = 0;
        let totalImport = 0;
        let totalExport = 0;

        const hourlyResults = [];

        for (let i = 0; i < this.gridFlowData.length; i++) {
            const flow = this.gridFlowData[i];
            const price = this.findPrice(flow.timestamp);

            if (!price) {
                console.warn(`Geen prijs gevonden voor ${flow.timestamp}, wordt geskipt`);
                continue;
            }

            // Calculate buy and sell prices
            const buyPrice = this.priceConfig.buyFormula(price.price);  // price.price is in EUR/MWh
            const sellPrice = this.priceConfig.sellFormula(price.price);

            // Net grid flow: positive = import (buy), negative = export (sell)
            let hourlyCost = 0;
            let hourlyImport = 0;
            let hourlyExport = 0;

            if (flow.netGridFlow > 0) {
                // Import from grid
                hourlyCost = flow.netGridFlow * buyPrice;
                hourlyImport = flow.netGridFlow;
            } else {
                // Export to grid
                hourlyCost = flow.netGridFlow * sellPrice;  // negative * positive = negative cost
                hourlyExport = -flow.netGridFlow;
            }

            totalCost += hourlyCost;
            totalImport += hourlyImport;
            totalExport += hourlyExport;

            hourlyResults.push({
                timestamp: flow.timestamp,
                netGridFlow: flow.netGridFlow,
                gridImport: hourlyImport,
                gridExport: hourlyExport,
                cost: hourlyCost,
                buyPrice,
                sellPrice
            });

            // Yield to event loop every 500 iterations
            if (i % 500 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        return {
            totalCost,
            totalImport,
            totalExport,
            hourlyResults
        };
    }

    /**
     * Scenario 4: Dynamic prices, with battery (MILP optimization)
     */
    async simulateDynamicWithBattery(progressCallback) {
        const battery = new Battery(this.batteryConfig, this.batteryConfig.initialSocPct);
        const optimizer = new BatteryOptimizer(this.batteryConfig, this.priceConfig);

        let totalCost = 0;
        let totalImport = 0;
        let totalExport = 0;
        let totalCharged = 0;
        let totalDischarged = 0;

        const hourlyResults = [];
        let currentHour = 0;

        while (currentHour < this.gridFlowData.length) {
            // Get window for day-ahead optimization
            // 35 hours for hourly (35 intervals), 35 hours for quarterly (140 intervals)
            const windowSize = this.dataInterval === 15 ? 140 : 35;
            const windowEnd = Math.min(currentHour + windowSize, this.gridFlowData.length);
            const window = this.gridFlowData.slice(currentHour, windowEnd);

            // Get prices for this window
            const windowPrices = window.map(flow => {
                const price = this.findPrice(flow.timestamp);
                if (!price) {
                    return { timestamp: new Date(flow.timestamp).getTime(), price: 0 };
                }
                return {
                    timestamp: new Date(flow.timestamp).getTime(),
                    price: price.price  // In EUR/MWh
                };
            });

            // Build forecast from grid flows
            // Positive netGridFlow = import needed (consumption > PV)
            // Negative netGridFlow = export (PV > consumption)
            const windowForecast = window.map(flow => {
                const ts = new Date(flow.timestamp).getTime();
                // Model as consumption and solar based on net flow
                let consumption = 0;
                let solar = 0;

                if (flow.netGridFlow > 0) {
                    // Net import: set as consumption, no solar
                    consumption = flow.netGridFlow;
                    solar = 0;
                } else {
                    // Net export: set as solar, no consumption
                    consumption = 0;
                    solar = -flow.netGridFlow;
                }

                return {
                    timestamp: ts,
                    consumption: consumption,
                    solar: solar
                };
            });

            // Optimize battery schedule for this window with forecast
            const intervalType = this.dataInterval === 15 ? 'quarterly' : 'hourly';
            const planActions = await optimizer.optimize(windowPrices, battery.socKwh, intervalType, windowForecast);

            // Convert to Map for fast lookup
            const currentPlan = new Map();
            for (const action of planActions) {
                currentPlan.set(action.timestamp, action);
            }

            // Execute first 24 hours of schedule
            // 24 hours for hourly (24 intervals), 24 hours for quarterly (96 intervals)
            const executeSize = this.dataInterval === 15 ? 96 : 24;
            const executeHours = Math.min(executeSize, windowEnd - currentHour);

            for (let h = 0; h < executeHours; h++) {
                const flow = this.gridFlowData[currentHour + h];
                const price = this.findPrice(flow.timestamp);

                if (!price) {
                    console.warn(`Geen prijs gevonden voor ${flow.timestamp}, wordt geskipt`);
                    currentHour++;
                    continue;
                }

                const buyPrice = this.priceConfig.buyFormula(price.price);  // price.price is in EUR/MWh
                const sellPrice = this.priceConfig.sellFormula(price.price);

                // Execute battery plan if we have one
                let actualCharge = 0;
                let actualDischarge = 0;
                const currentTs = new Date(flow.timestamp).getTime();

                if (currentPlan && currentPlan.has(currentTs)) {
                    const plannedAction = currentPlan.get(currentTs);

                    if (plannedAction.action === 'charge') {
                        const [dcToBattery, acFromGrid] = battery.charge(plannedAction.energyKwh, this.durationHours);
                        if (dcToBattery > 0.001) {
                            actualCharge = acFromGrid;
                            totalCharged += dcToBattery;
                        }
                    } else if (plannedAction.action === 'discharge') {
                        const [dcFromBattery, acToGrid] = battery.discharge(plannedAction.energyKwh, this.durationHours);
                        if (dcFromBattery > 0.001) {
                            actualDischarge = acToGrid;
                            totalDischarged += dcFromBattery;
                        }
                    }
                }

                // Calculate net grid flow after battery
                // Positive net flow = import needed
                // Negative net flow = export
                const batteryContribution = actualDischarge - actualCharge;
                const netFlowAfterBattery = flow.netGridFlow - batteryContribution;

                // Calculate grid import/export and costs
                let hourlyCost = 0;
                let hourlyImport = 0;
                let hourlyExport = 0;

                if (netFlowAfterBattery > 0) {
                    // Still need to import from grid
                    hourlyCost = netFlowAfterBattery * buyPrice;
                    hourlyImport = netFlowAfterBattery;
                } else if (netFlowAfterBattery < 0) {
                    // Export to grid
                    hourlyCost = netFlowAfterBattery * sellPrice;  // negative * positive = negative
                    hourlyExport = -netFlowAfterBattery;
                }

                totalCost += hourlyCost;
                totalImport += hourlyImport;
                totalExport += hourlyExport;

                hourlyResults.push({
                    timestamp: flow.timestamp,
                    netGridFlow: flow.netGridFlow,
                    netGridFlowAfterBattery: netFlowAfterBattery,
                    gridImport: hourlyImport,
                    gridExport: hourlyExport,
                    batteryCharge: actualCharge,
                    batteryDischarge: actualDischarge,
                    batterySoc: battery.socKwh,
                    cost: hourlyCost,
                    buyPrice,
                    sellPrice
                });
            }

            currentHour += executeHours;

            // Update progress
            const progress = 70 + (currentHour / this.gridFlowData.length) * 30;
            progressCallback(progress, `Optimalisatie ${currentHour}/${this.gridFlowData.length} uur...`);

            // Yield to event loop to update UI
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Calculate cycles
        const avgThroughput = (totalCharged + totalDischarged) / 2;
        const cycles = avgThroughput / this.batteryConfig.capacityKwh;

        return {
            totalCost,
            totalImport,
            totalExport,
            totalCharged,
            totalDischarged,
            cycles,
            hourlyResults
        };
    }

    /**
     * Find EPEX price for given timestamp
     * P1 data and price data are already on the same interval, so exact match
     */
    findPrice(timestamp) {
        const ts = new Date(timestamp);

        return this.pricesData.find(p => {
            const priceTime = new Date(p.timestamp);
            return priceTime.getTime() === ts.getTime();
        });
    }

    /**
     * Generate monthly summary from hourly results
     */
    getMonthlySummary(results) {
        const monthlyMap = new Map();

        for (const hour of results.hourlyResults) {
            const date = new Date(hour.timestamp);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!monthlyMap.has(monthKey)) {
                monthlyMap.set(monthKey, {
                    month: date.getMonth() + 1,
                    year: date.getFullYear(),
                    monthName: date.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' }),
                    cost: 0,
                    gridImport: 0,
                    gridExport: 0,
                    batteryCharge: 0,
                    batteryDischarge: 0
                });
            }

            const monthData = monthlyMap.get(monthKey);
            monthData.cost += hour.cost;
            monthData.gridImport += hour.gridImport;
            monthData.gridExport += hour.gridExport;

            if (hour.batteryCharge !== undefined) {
                monthData.batteryCharge += hour.batteryCharge;
                monthData.batteryDischarge += hour.batteryDischarge;
            }
        }

        return Array.from(monthlyMap.values())
            .sort((a, b) => {
                if (a.year !== b.year) return a.year - b.year;
                return a.month - b.month;
            });
    }

    /**
     * Get daily summary for a specific month (for drill-down view)
     * Returns daily aggregations for the "dynamic with battery" scenario
     */
    getDailySummary(monthKey, dynamicWithBatteryResults, fixedNoBatteryResults) {
        const dailyMap = new Map();

        // Process dynamic with battery results
        for (const hour of dynamicWithBatteryResults.hourlyResults) {
            const date = new Date(hour.timestamp);
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
            dayData.batteryCharge += hour.batteryCharge || 0;
            dayData.batteryDischarge += hour.batteryDischarge || 0;

            // Track SoC range
            const socPct = (hour.batterySoc / this.batteryConfig.capacityKwh) * 100;
            dayData.minSoc = Math.min(dayData.minSoc, socPct);
            dayData.maxSoc = Math.max(dayData.maxSoc, socPct);
        }

        // Add fixed no battery costs for comparison
        for (const hour of fixedNoBatteryResults.hourlyResults) {
            const date = new Date(hour.timestamp);
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
     * Get timestep (hourly/quarterly) data for a specific day (for drill-down view)
     * Returns timestep data for the "dynamic with battery" scenario
     */
    getTimestepSummary(dateKey, dynamicWithBatteryResults) {
        const timesteps = [];

        for (const hour of dynamicWithBatteryResults.hourlyResults) {
            const date = new Date(hour.timestamp);
            const hourDateKey = date.toISOString().split('T')[0];

            // Only include this day
            if (hourDateKey !== dateKey) continue;

            const socPct = (hour.batterySoc / this.batteryConfig.capacityKwh) * 100;

            timesteps.push({
                timestamp: hour.timestamp,
                netGridFlow: hour.netGridFlow,
                netGridFlowAfterBattery: hour.netGridFlowAfterBattery,
                gridImport: hour.gridImport,
                gridExport: hour.gridExport,
                batteryCharge: hour.batteryCharge || 0,
                batteryDischarge: hour.batteryDischarge || 0,
                batterySocKwh: hour.batterySoc,
                batterySocPct: socPct,
                cost: hour.cost,
                buyPrice: hour.buyPrice,
                sellPrice: hour.sellPrice
            });
        }

        return timesteps.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }
}
