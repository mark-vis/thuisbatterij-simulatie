/**
 * Battery Optimizer - MILP optimization using HiGHS solver
 * Optimizes battery charging/discharging based on price predictions
 *
 * This implementation follows the exact MILP formulation from the Python version:
 * - Decision variables: p_charge[t], p_discharge[t], soc[t] for each period t
 * - Objective: Maximize profit = SUM(sell_price * discharge * eta_discharge - buy_price * charge / eta_charge)
 * - Constraints: SoC dynamics, power limits, SoC limits
 */

// Global HiGHS instance (loaded asynchronously)
let highsInstance = null;
let highsLoading = null;

/**
 * Load HiGHS solver (call once at startup)
 * Uses the global Module function provided by highs.js script tag
 */
async function loadHighsSolver() {
    if (highsInstance) return highsInstance;
    if (highsLoading) return highsLoading;

    // Module is loaded via script tag and available globally
    if (typeof Module === 'undefined') {
        throw new Error('HiGHS Module not loaded. Make sure highs.js is included before optimizer.js');
    }

    highsLoading = Module({
        locateFile: (file) => 'js/lib/' + file
    });

    highsInstance = await highsLoading;
    highsLoading = null;

    return highsInstance;
}

class BatteryOptimizer {
    /**
     * @param {Object} batteryConfig - Battery configuration
     * @param {Object} priceConfig - Price configuration with buy/sell formulas
     */
    constructor(batteryConfig, priceConfig) {
        this.batteryConfig = batteryConfig;
        this.priceConfig = priceConfig;
    }

    /**
     * Optimize battery actions for given price window using MILP
     * Follows exact formulation from Python PuLP implementation
     *
     * @param {Array<Object>} prices - Array of {timestamp, price (EUR/MWh)}
     * @param {number} currentSocKwh - Current battery SoC in kWh
     * @param {string} resolution - 'hourly' or 'quarterly'
     * @returns {Array<Object>} Array of {timestamp, action, energyKwh, buyPrice, sellPrice}
     */
    async optimize(prices, currentSocKwh, resolution = 'hourly') {
        // Ensure HiGHS is loaded
        if (!highsInstance) {
            await loadHighsSolver();
        }

        const durationHours = resolution === 'hourly' ? 1.0 : 0.25;
        const nPeriods = prices.length;

        // Calculate buy and sell prices for each period
        const periods = prices.map(p => ({
            timestamp: p.timestamp,
            priceEurMwh: p.price,
            buyPrice: this.priceConfig.buyFormula(p.price),
            sellPrice: this.priceConfig.sellFormula(p.price)
        }));

        // Battery constraints
        const capacity = this.batteryConfig.capacityKwh;
        const minSoc = capacity * this.batteryConfig.minSocPct;
        const maxSoc = capacity * this.batteryConfig.maxSocPct;
        const maxPower = Math.min(
            this.batteryConfig.chargePowerKw,
            this.batteryConfig.dischargePowerKw
        ) * durationHours;
        const etaCharge = this.batteryConfig.chargeEfficiency;
        const etaDischarge = this.batteryConfig.dischargeEfficiency;
        const initialSoc = currentSocKwh;

        // Build LP problem in CPLEX format
        // Variables: charge_t, discharge_t, soc_t for each period t
        let lpProblem = 'Maximize\n obj: ';

        // Objective function: maximize profit
        // profit = SUM[ sell_price[t] * (discharge[t] * eta_discharge) - buy_price[t] * (charge[t] / eta_charge) ]
        const objectiveTerms = [];
        for (let t = 0; t < nPeriods; t++) {
            const sellCoeff = periods[t].sellPrice * etaDischarge;
            const buyCoeff = periods[t].buyPrice / etaCharge;

            // Add discharge term (positive profit)
            if (sellCoeff !== 0) {
                objectiveTerms.push(`${sellCoeff.toFixed(6)} discharge_${t}`);
            }
            // Add charge term (negative profit = cost)
            if (buyCoeff !== 0) {
                objectiveTerms.push(`- ${buyCoeff.toFixed(6)} charge_${t}`);
            }
        }
        lpProblem += objectiveTerms.join(' ') + '\n';

        // Constraints
        lpProblem += 'Subject To\n';

        // SoC dynamics constraints
        for (let t = 0; t < nPeriods; t++) {
            if (t === 0) {
                // soc_0 = initial_soc + charge_0 - discharge_0
                lpProblem += ` soc_dyn_${t}: soc_${t} - charge_${t} + discharge_${t} = ${initialSoc.toFixed(6)}\n`;
            } else {
                // soc_t = soc_{t-1} + charge_t - discharge_t
                lpProblem += ` soc_dyn_${t}: soc_${t} - soc_${t-1} - charge_${t} + discharge_${t} = 0\n`;
            }
        }

        // Bounds
        lpProblem += 'Bounds\n';
        for (let t = 0; t < nPeriods; t++) {
            // Charge and discharge power limits (DC energy)
            lpProblem += ` 0 <= charge_${t} <= ${maxPower.toFixed(6)}\n`;
            lpProblem += ` 0 <= discharge_${t} <= ${maxPower.toFixed(6)}\n`;

            // SoC limits
            lpProblem += ` ${minSoc.toFixed(6)} <= soc_${t} <= ${maxSoc.toFixed(6)}\n`;
        }

        lpProblem += 'End\n';

        // Solve with HiGHS
        let solution;
        try {
            solution = highsInstance.solve(lpProblem);
        } catch (error) {
            console.error('HiGHS solver error:', error);
            console.error('LP problem:', lpProblem);
            throw new Error('MILP solver failed: ' + error.message);
        }

        // Check solution status
        if (solution.Status !== 'Optimal') {
            console.warn('MILP solution not optimal:', solution.Status);
            console.warn('LP problem:', lpProblem);
        }

        // Parse solution
        const actions = periods.map((p, t) => ({
            timestamp: p.timestamp,
            action: 'idle',
            energyKwh: 0.0,
            buyPrice: p.buyPrice,
            sellPrice: p.sellPrice,
            priceEurMwh: p.priceEurMwh
        }));

        // Extract variable values from solution
        // solution.Columns is an object with variable names as keys
        const variables = {};
        if (solution.Columns) {
            for (const [varName, varData] of Object.entries(solution.Columns)) {
                variables[varName] = varData.Primal || 0;
            }
        }

        // Assign actions based on solution
        for (let t = 0; t < nPeriods; t++) {
            const chargeVal = variables[`charge_${t}`] || 0.0;
            const dischargeVal = variables[`discharge_${t}`] || 0.0;

            if (chargeVal > 0.01) {
                actions[t].action = 'charge';
                actions[t].energyKwh = chargeVal;
            } else if (dischargeVal > 0.01) {
                actions[t].action = 'discharge';
                actions[t].energyKwh = dischargeVal;
            }
        }

        return actions;
    }

    /**
     * Calculate profit from actions
     * @param {Array<Object>} actions - Array of actions with energyKwh, buyPrice, sellPrice
     * @param {number} chargeEfficiency - Charge efficiency (0-1)
     * @param {number} dischargeEfficiency - Discharge efficiency (0-1)
     * @returns {number} Total profit in EUR
     */
    calculateProfit(actions, chargeEfficiency, dischargeEfficiency) {
        let profit = 0;

        for (const action of actions) {
            if (action.action === 'charge') {
                // DC to battery, AC from grid = DC / efficiency
                const acFromGrid = action.energyKwh / chargeEfficiency;
                profit -= acFromGrid * action.buyPrice;
            } else if (action.action === 'discharge') {
                // DC from battery, AC to grid = DC × efficiency
                const acToGrid = action.energyKwh * dischargeEfficiency;
                profit += acToGrid * action.sellPrice;
            }
        }

        return profit;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BatteryOptimizer;
}
