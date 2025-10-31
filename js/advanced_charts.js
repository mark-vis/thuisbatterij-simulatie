/**
 * Advanced Charts - Heatmap and diagonal chart for power sweep results
 */

// Global chart instances
let diagonalChart = null;
let efficiencyCurveChart = null;

/**
 * Create diagonal chart (profit vs symmetric power)
 * Shows profit for configurations where charge power = discharge power
 * @param {Array<Object>} diagonalData - Array of {power, profit, cycles, chargeEff, dischargeEff}
 */
function createDiagonalChart(diagonalData) {
    // Destroy existing chart
    if (diagonalChart) {
        diagonalChart.destroy();
    }

    const ctx = document.getElementById('diagonalChart').getContext('2d');

    const powers = diagonalData.map(d => d.power);
    const profits = diagonalData.map(d => d.profit);

    // Find optimal point
    const maxProfit = Math.max(...profits);
    const optimalIndex = profits.indexOf(maxProfit);
    const optimalPower = powers[optimalIndex];

    // Point colors: highlight optimal point
    const pointColors = profits.map((p, i) =>
        i === optimalIndex ? 'rgba(16, 185, 129, 1)' : 'rgba(37, 99, 235, 0.6)'
    );
    const pointRadii = profits.map((p, i) => i === optimalIndex ? 8 : 4);

    diagonalChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: powers.map(p => `${p} kW`),
            datasets: [{
                label: 'Winst (€)',
                data: profits,
                borderColor: 'rgba(37, 99, 235, 1)',
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.3,
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: pointRadii,
                pointHoverRadius: pointRadii.map(r => r + 2)
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const idx = context.dataIndex;
                            const data = diagonalData[idx];
                            return [
                                `Winst: €${data.profit.toFixed(2)}`,
                                `Cycles: ${data.cycles.toFixed(1)}`,
                                `€/cycle: €${data.profitPerCycle.toFixed(2)}`,
                                `Laden eff: ${(data.chargeEff * 100).toFixed(1)}%`,
                                `Ontladen eff: ${(data.dischargeEff * 100).toFixed(1)}%`,
                                `C-rate: ${data.cRate.toFixed(2)}`
                            ];
                        },
                        title: function(context) {
                            return `Symmetrisch: ${context[0].label}`;
                        }
                    }
                },
                annotation: optimalIndex >= 0 ? {
                    annotations: {
                        optimalLine: {
                            type: 'line',
                            xMin: optimalIndex,
                            xMax: optimalIndex,
                            borderColor: 'rgba(16, 185, 129, 0.5)',
                            borderWidth: 2,
                            borderDash: [5, 5],
                            label: {
                                content: `Optimaal: ${optimalPower} kW`,
                                enabled: true,
                                position: 'start'
                            }
                        }
                    }
                } : undefined
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Winst (€)'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '€' + value.toFixed(0);
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Vermogen (kW DC, symmetrisch laden/ontladen)'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

/**
 * Create heatmap grid HTML
 * @param {Object} sweepData - Sweep results with results, chargePowers, dischargePowers
 * @param {Function} onCellClick - Callback when cell is clicked
 * @returns {string} HTML for heatmap
 */
function createHeatmapGrid(sweepData, onCellClick) {
    const {results, chargePowers, dischargePowers, bestConfig} = sweepData;

    // Find min/max profit for color scaling
    const profits = results.map(r => r.profit);
    const minProfit = Math.min(...profits);
    const maxProfit = Math.max(...profits);

    // Create grid HTML
    let html = '<div class="heatmap-container">';

    // Header row (charge powers)
    html += '<div class="heatmap-grid" style="grid-template-columns: 80px repeat(' + chargePowers.length + ', 1fr);">';

    // Top-left corner (label)
    html += '<div class="heatmap-header-corner">Laden →<br>Ontladen ↓</div>';

    // Column headers (charge powers)
    for (const chargePower of chargePowers) {
        html += `<div class="heatmap-header">${chargePower}</div>`;
    }

    // Data rows
    for (let rowIdx = 0; rowIdx < dischargePowers.length; rowIdx++) {
        const dischargePower = dischargePowers[rowIdx];

        // Row header (discharge power)
        html += `<div class="heatmap-row-header">${dischargePower}</div>`;

        // Cells
        for (let colIdx = 0; colIdx < chargePowers.length; colIdx++) {
            const chargePower = chargePowers[colIdx];

            // Find result for this configuration
            const result = results.find(r =>
                Math.abs(r.chargePower - chargePower) < 0.01 &&
                Math.abs(r.dischargePower - dischargePower) < 0.01
            );

            if (result) {
                const profit = result.profit;

                // Calculate color (blue → green → yellow → orange)
                const normalized = (profit - minProfit) / (maxProfit - minProfit);
                const color = getHeatmapColor(normalized);

                // Check if this is the best configuration
                const isBest = Math.abs(result.chargePower - bestConfig.chargePower) < 0.01 &&
                               Math.abs(result.dischargePower - bestConfig.dischargePower) < 0.01;

                const bestClass = isBest ? ' best' : '';

                html += `<div class="heatmap-cell${bestClass}"
                    style="background-color: ${color};"
                    data-charge="${chargePower}"
                    data-discharge="${dischargePower}"
                    data-profit="${profit.toFixed(2)}"
                    data-cycles="${result.cycles.toFixed(1)}"
                    data-charge-eff="${(result.chargeEfficiency * 100).toFixed(1)}"
                    data-discharge-eff="${(result.dischargeEfficiency * 100).toFixed(1)}">
                    ${profit.toFixed(0)}
                </div>`;
            } else {
                html += '<div class="heatmap-cell empty">-</div>';
            }
        }
    }

    html += '</div>'; // .heatmap-grid

    // Color scale legend
    html += '<div class="color-scale">';
    html += '<span class="color-scale-label">Laag</span>';
    html += '<div class="color-scale-bar"></div>';
    html += '<span class="color-scale-label">Hoog</span>';
    html += '<div class="color-scale-range">';
    html += `€${minProfit.toFixed(0)} - €${maxProfit.toFixed(0)}`;
    html += '</div>';
    html += '</div>';

    html += '</div>'; // .heatmap-container

    return html;
}

/**
 * Get color for heatmap based on normalized value (0-1)
 * @param {number} value - Normalized value (0 = min, 1 = max)
 * @returns {string} RGB color string
 */
function getHeatmapColor(value) {
    // Color gradient: blue → green → yellow → orange
    // 0.0 = blue (#3b82f6)
    // 0.33 = green (#10b981)
    // 0.66 = yellow (#fbbf24)
    // 1.0 = orange (#f59e0b)

    let r, g, b;

    if (value < 0.33) {
        // Blue to green
        const t = value / 0.33;
        r = Math.round(59 + (16 - 59) * t);
        g = Math.round(130 + (185 - 130) * t);
        b = Math.round(246 + (129 - 246) * t);
    } else if (value < 0.66) {
        // Green to yellow
        const t = (value - 0.33) / 0.33;
        r = Math.round(16 + (251 - 16) * t);
        g = Math.round(185 + (191 - 185) * t);
        b = Math.round(129 + (36 - 129) * t);
    } else {
        // Yellow to orange
        const t = (value - 0.66) / 0.34;
        r = Math.round(251 + (245 - 251) * t);
        g = Math.round(191 + (158 - 191) * t);
        b = Math.round(36 + (11 - 36) * t);
    }

    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Attach click handlers to heatmap cells
 * @param {Function} onCellClick - Callback (chargePower, dischargePower)
 */
function attachHeatmapHandlers(onCellClick) {
    const cells = document.querySelectorAll('.heatmap-cell:not(.empty)');

    cells.forEach(cell => {
        cell.addEventListener('click', () => {
            const chargePower = parseFloat(cell.dataset.charge);
            const dischargePower = parseFloat(cell.dataset.discharge);
            onCellClick(chargePower, dischargePower);
        });
    });
}

/**
 * Create efficiency curve chart showing inverter and battery efficiency vs power
 * @param {Object} effCurve - Efficiency curve preset (e.g., EfficiencyCurve.VICTRON_MP5000_3P)
 * @param {number} capacityKwh - Battery capacity in kWh
 */
function createEfficiencyCurveChart(effCurve, capacityKwh) {
    // Destroy existing chart
    if (efficiencyCurveChart) {
        efficiencyCurveChart.destroy();
    }

    const ctx = document.getElementById('efficiencyCurveChart').getContext('2d');

    // Generate power range (0 to max, 100 points)
    const maxPower = Math.max(effCurve.maxChargePowerKw, effCurve.maxDischargePowerKw);
    const numPoints = 100;
    const powers = [];
    for (let i = 0; i <= numPoints; i++) {
        powers.push((i / numPoints) * maxPower);
    }

    // Calculate efficiencies for each power level
    const chargeInverterEffs = [];
    const dischargeInverterEffs = [];
    const batteryChargeEffs = [];
    const batteryDischargeEffs = [];
    const totalChargeEffs = [];
    const totalDischargeEffs = [];

    for (const power of powers) {
        // Assume charge power = discharge power for the curve
        const eff = effCurve.getCombinedEfficiency(power, power, capacityKwh);

        chargeInverterEffs.push((eff.chargeInverter * 100).toFixed(2));
        dischargeInverterEffs.push((eff.dischargeInverter * 100).toFixed(2));
        batteryChargeEffs.push((eff.batterySingle * 100).toFixed(2));
        batteryDischargeEffs.push((eff.batterySingle * 100).toFixed(2)); // Same for both directions
        totalChargeEffs.push((eff.chargeTotal * 100).toFixed(2));
        totalDischargeEffs.push((eff.dischargeTotal * 100).toFixed(2));
    }

    efficiencyCurveChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: powers.map(p => p.toFixed(1)),
            datasets: [
                {
                    label: 'Omvormer laden',
                    data: chargeInverterEffs,
                    borderColor: 'rgba(239, 68, 68, 1)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Omvormer ontladen',
                    data: dischargeInverterEffs,
                    borderColor: 'rgba(34, 197, 94, 1)',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Batterij (single-direction)',
                    data: batteryChargeEffs,
                    borderColor: 'rgba(249, 115, 22, 1)',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Totaal laden',
                    data: totalChargeEffs,
                    borderColor: 'rgba(239, 68, 68, 0.6)',
                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                },
                {
                    label: 'Totaal ontladen',
                    data: totalDischargeEffs,
                    borderColor: 'rgba(34, 197, 94, 0.6)',
                    backgroundColor: 'rgba(34, 197, 94, 0.05)',
                    borderWidth: 3,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.3,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 10,
                        font: {
                            size: 11
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const power = parseFloat(context[0].label);
                            const cRate = power / capacityKwh;
                            return `${power.toFixed(1)} kW (C=${cRate.toFixed(2)})`;
                        },
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    min: 50,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Efficiency (%)'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Vermogen (kW DC)'
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxTicksLimit: 12,
                        callback: function(value, index) {
                            // Show every nth tick
                            if (index % Math.ceil(powers.length / 12) === 0) {
                                return powers[index].toFixed(1);
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });
}
