/**
 * Custom Data Simulator - Simulate battery optimization with user-uploaded P1 data
 */

class CustomDataSimulator {
    constructor(batteryConfig, priceConfig, fixedPriceConfig, gridFlowData, pricesData) {
        this.batteryConfig = batteryConfig;
        this.priceConfig = priceConfig;
        this.fixedPriceConfig = fixedPriceConfig;
        this.gridFlowData = gridFlowData;  // Hourly net grid flows from P1 data
        this.pricesData = pricesData;       // EPEX prices
    }

    /**
     * Simulate all four scenarios: fixed/dynamic, with/without battery
     */
    async simulateAll(progressCallback) {
        progressCallback(10, 'Scenario 1: Vast contract zonder batterij...');
        const fixedNoBattery = await this.simulateFixedContract();

        progressCallback(30, 'Scenario 2: Vast contract met batterij...');
        const fixedWithBattery = await this.simulateFixedWithBattery();

        progressCallback(50, 'Scenario 3: Dynamisch zonder batterij...');
        const dynamicNoBattery = await this.simulateDynamicNoBattery();

        progressCallback(70, 'Scenario 4: Dynamisch met batterij (MILP)...');
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
                const [dcToBattery, acFromGrid] = battery.charge(availableSurplus, 1.0);
                if (dcToBattery > 0.001) {
                    actualCharge = acFromGrid;
                    totalCharged += dcToBattery;
                }
            } else if (flow.netGridFlow > 0) {
                // Deficit (import): try to discharge battery
                const neededPower = flow.netGridFlow;
                const [dcFromBattery, acToGrid] = battery.discharge(neededPower, 1.0);
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
            // Get 35-hour window for day-ahead optimization (13:00 - 13:00 next day + 11 hours)
            const windowEnd = Math.min(currentHour + 35, this.gridFlowData.length);
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
            const planActions = await optimizer.optimize(windowPrices, battery.socKwh, 'hourly', windowForecast);

            // Convert to Map for fast lookup
            const currentPlan = new Map();
            for (const action of planActions) {
                currentPlan.set(action.timestamp, action);
            }

            // Execute first 24 hours of schedule (or until next 13:00)
            const executeHours = Math.min(24, windowEnd - currentHour);

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
                        const [dcToBattery, acFromGrid] = battery.charge(plannedAction.energyKwh, 1.0);
                        if (dcToBattery > 0.001) {
                            actualCharge = acFromGrid;
                            totalCharged += dcToBattery;
                        }
                    } else if (plannedAction.action === 'discharge') {
                        const [dcFromBattery, acToGrid] = battery.discharge(plannedAction.energyKwh, 1.0);
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
            const progress = 50 + (currentHour / this.gridFlowData.length) * 50;
            progressCallback(progress, `Optimalisatie ${currentHour}/${this.gridFlowData.length} uur...`);
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
     */
    findPrice(timestamp) {
        const ts = new Date(timestamp);

        // Find price entry matching this hour
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
}
