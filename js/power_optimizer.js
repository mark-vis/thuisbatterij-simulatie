/**
 * Power Optimizer - Nelder-Mead optimization for battery configuration
 */

class PowerOptimizer {
    /**
     * @param {number} capacityKwh - Battery capacity in kWh
     * @param {Object} priceConfig - Price configuration {buyFormula, sellFormula}
     * @param {Array} pricesData - Historical price data
     * @param {Object} efficiencyCurve - Efficiency curve preset
     */
    constructor(capacityKwh, priceConfig, pricesData, efficiencyCurve) {
        this.capacityKwh = capacityKwh;
        this.priceConfig = priceConfig;
        this.pricesData = pricesData;
        this.efficiencyCurve = efficiencyCurve;
    }

    /**
     * Run Nelder-Mead optimization to find optimal charge/discharge powers
     * @param {number} initialChargePower - Starting charge power (kW)
     * @param {number} initialDischargePower - Starting discharge power (kW)
     * @param {number} tolerance - Convergence tolerance (kW)
     * @param {Object} options - Simulation options {minSocPct, maxSocPct, initialSocPct}
     * @param {Function} progressCallback - Progress callback (iteration, evaluations, bestProfit)
     * @returns {Object} Optimization result
     */
    async optimize(initialChargePower, initialDischargePower, tolerance, options, progressCallback) {
        const bounds = {
            chargeMin: 0.1,
            chargeMax: this.efficiencyCurve.maxChargePowerKw,
            dischargeMin: 0.1,
            dischargeMax: this.efficiencyCurve.maxDischargePowerKw
        };

        // Initial simplex: 3 points for 2D optimization
        // Point 0: initial guess
        // Point 1: perturb charge power
        // Point 2: perturb discharge power
        const simplexSize = Math.max(initialChargePower, initialDischargePower) * 0.2; // 20% perturbation

        let simplex = [
            [initialChargePower, initialDischargePower],
            [initialChargePower + simplexSize, initialDischargePower],
            [initialChargePower, initialDischargePower + simplexSize]
        ];

        // Evaluate initial simplex
        let values = [];
        for (const point of simplex) {
            const [chargePower, dischargePower] = this.clipToBounds(point, bounds);
            const result = await this.evaluateConfiguration(chargePower, dischargePower, options);
            values.push(-result.profit); // Minimize negative profit = maximize profit
        }

        let iteration = 0;
        let evaluations = 3;
        const maxIterations = 100;
        const maxEvaluations = 500;

        // Nelder-Mead parameters
        const alpha = 1.0;   // Reflection coefficient
        const gamma = 2.0;   // Expansion coefficient
        const rho = 0.5;     // Contraction coefficient
        const sigma = 0.5;   // Shrink coefficient

        while (iteration < maxIterations && evaluations < maxEvaluations) {
            // Sort simplex by values (ascending, since we're minimizing)
            const indices = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
            simplex = indices.map(i => simplex[i]);
            values = indices.map(i => values[i]);

            // Check convergence: diameter of simplex < tolerance
            const diameter = this.simplexDiameter(simplex);
            if (diameter < tolerance) {
                break;
            }

            // Report progress
            const bestProfit = -values[0];
            if (progressCallback) {
                progressCallback(iteration, evaluations, bestProfit);
            }

            // Nelder-Mead iteration
            const best = simplex[0];
            const secondWorst = simplex[1];
            const worst = simplex[2];

            // Compute centroid of best and second-worst points
            const centroid = [
                (best[0] + secondWorst[0]) / 2,
                (best[1] + secondWorst[1]) / 2
            ];

            // Reflection
            const reflected = [
                centroid[0] + alpha * (centroid[0] - worst[0]),
                centroid[1] + alpha * (centroid[1] - worst[1])
            ];
            const reflectedClipped = this.clipToBounds(reflected, bounds);
            const reflectedResult = await this.evaluateConfiguration(
                reflectedClipped[0], reflectedClipped[1], options
            );
            const reflectedValue = -reflectedResult.profit;
            evaluations++;

            if (reflectedValue < values[0] && reflectedValue >= values[1]) {
                // Reflected point is better than second-worst, but not better than best
                // Accept reflection
                simplex[2] = reflected;
                values[2] = reflectedValue;
            } else if (reflectedValue < values[0]) {
                // Reflected point is best so far, try expansion
                const expanded = [
                    centroid[0] + gamma * (reflected[0] - centroid[0]),
                    centroid[1] + gamma * (reflected[1] - centroid[1])
                ];
                const expandedClipped = this.clipToBounds(expanded, bounds);
                const expandedResult = await this.evaluateConfiguration(
                    expandedClipped[0], expandedClipped[1], options
                );
                const expandedValue = -expandedResult.profit;
                evaluations++;

                if (expandedValue < reflectedValue) {
                    // Expansion is even better
                    simplex[2] = expanded;
                    values[2] = expandedValue;
                } else {
                    // Reflection is better
                    simplex[2] = reflected;
                    values[2] = reflectedValue;
                }
            } else {
                // Reflected point is worst, try contraction
                const contracted = [
                    centroid[0] + rho * (worst[0] - centroid[0]),
                    centroid[1] + rho * (worst[1] - centroid[1])
                ];
                const contractedClipped = this.clipToBounds(contracted, bounds);
                const contractedResult = await this.evaluateConfiguration(
                    contractedClipped[0], contractedClipped[1], options
                );
                const contractedValue = -contractedResult.profit;
                evaluations++;

                if (contractedValue < values[2]) {
                    // Contraction is better than worst
                    simplex[2] = contracted;
                    values[2] = contractedValue;
                } else {
                    // Shrink simplex toward best point
                    for (let i = 1; i < simplex.length; i++) {
                        simplex[i] = [
                            best[0] + sigma * (simplex[i][0] - best[0]),
                            best[1] + sigma * (simplex[i][1] - best[1])
                        ];
                        const shrunkClipped = this.clipToBounds(simplex[i], bounds);
                        const shrunkResult = await this.evaluateConfiguration(
                            shrunkClipped[0], shrunkClipped[1], options
                        );
                        values[i] = -shrunkResult.profit;
                        evaluations++;
                    }
                }
            }

            iteration++;
        }

        // Final evaluation at best point
        const bestPoint = simplex[0];
        const [finalChargePower, finalDischargePower] = this.clipToBounds(bestPoint, bounds);
        const finalResult = await this.evaluateConfiguration(finalChargePower, finalDischargePower, options);

        return {
            bestConfig: finalResult,
            iterations: iteration,
            evaluations: evaluations,
            converged: this.simplexDiameter(simplex) < tolerance
        };
    }

    /**
     * Evaluate a single configuration (charge/discharge power combination)
     * @param {number} chargePower - Charge power (kW)
     * @param {number} dischargePower - Discharge power (kW)
     * @param {Object} options - Simulation options {minSocPct, maxSocPct, initialSocPct}
     * @returns {Object} Configuration result with profit, cycles, etc.
     */
    async evaluateConfiguration(chargePower, dischargePower, options) {
        // Get efficiency for this power level
        const chargeEff = this.efficiencyCurve.getCombinedEfficiency(chargePower, this.capacityKwh);
        const dischargeEff = this.efficiencyCurve.getCombinedEfficiency(dischargePower, this.capacityKwh);

        // Create battery model
        const battery = new BatteryModel(
            this.capacityKwh,
            chargePower,
            dischargePower,
            chargeEff.chargeTotal,
            dischargeEff.dischargeTotal,
            options.minSocPct,
            options.maxSocPct
        );

        // Run optimizer (MILP)
        const optimizer = new BatteryOptimizer(battery);
        const result = await optimizer.optimize(this.pricesData, this.priceConfig, options.initialSocPct);

        // Calculate monthly summary
        const monthlySummary = calculateMonthlySummary(result.schedule);

        // Calculate total profit and cycles
        const totalProfit = monthlySummary.reduce((sum, m) => sum + m.profitEur, 0);
        const totalCycles = monthlySummary.reduce((sum, m) => sum + m.cycles, 0);

        return {
            chargePower: chargePower,
            dischargePower: dischargePower,
            profit: totalProfit,
            cycles: totalCycles,
            profitPerCycle: totalCycles > 0 ? totalProfit / totalCycles : 0,
            chargeEfficiency: chargeEff.chargeTotal,
            dischargeEfficiency: dischargeEff.dischargeTotal,
            chargeInverterEff: chargeEff.chargeInverter,
            dischargeInverterEff: dischargeEff.dischargeInverter,
            chargeBatteryRTE: chargeEff.batteryRTE,
            dischargeBatteryRTE: dischargeEff.batteryRTE,
            chargeCRate: chargeEff.cRate,
            dischargeCRate: dischargeEff.cRate,
            monthlySummary: monthlySummary,
            schedule: result.schedule
        };
    }

    /**
     * Clip point to bounds
     * @param {Array<number>} point - [chargePower, dischargePower]
     * @param {Object} bounds - {chargeMin, chargeMax, dischargeMin, dischargeMax}
     * @returns {Array<number>} Clipped point
     */
    clipToBounds(point, bounds) {
        return [
            Math.max(bounds.chargeMin, Math.min(bounds.chargeMax, point[0])),
            Math.max(bounds.dischargeMin, Math.min(bounds.dischargeMax, point[1]))
        ];
    }

    /**
     * Calculate diameter of simplex (max distance between any two points)
     * @param {Array<Array<number>>} simplex - Array of points
     * @returns {number} Diameter
     */
    simplexDiameter(simplex) {
        let maxDist = 0;
        for (let i = 0; i < simplex.length; i++) {
            for (let j = i + 1; j < simplex.length; j++) {
                const dist = Math.sqrt(
                    Math.pow(simplex[i][0] - simplex[j][0], 2) +
                    Math.pow(simplex[i][1] - simplex[j][1], 2)
                );
                maxDist = Math.max(maxDist, dist);
            }
        }
        return maxDist;
    }
}
