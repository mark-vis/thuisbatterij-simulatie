/**
 * Advanced UI - Form handling and results display for power scan analysis
 */

// Global state
let currentSweepData = null;
let currentPricesData = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Load HiGHS solver
    await loadHighsSolver();

    // Attach form handler
    const form = document.getElementById('sweepForm');
    form.addEventListener('submit', handleFormSubmit);

    // Analysis mode switching
    const analysisModeRadios = document.querySelectorAll('input[name="analysisMode"]');
    analysisModeRadios.forEach(radio => {
        radio.addEventListener('change', handleAnalysisModeChange);
    });

    // Update efficiency preview when power inputs change
    const powerInputs = ['chargePowerMin', 'chargePowerMax', 'dischargePowerMin', 'dischargePowerMax', 'capacity', 'inverterPreset'];
    powerInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updateEfficiencyPreview);
            if (id === 'inverterPreset') {
                input.addEventListener('change', () => {
                    updatePowerLimits();
                    updateOptimizeInitials();
                    updateEfficiencyCurveChart();
                });
            }
            if (id === 'capacity') {
                input.addEventListener('input', updateEfficiencyCurveChart);
            }
        }
    });

    // Optimize initial values
    const optimizeInputs = ['initialChargePower', 'initialDischargePower'];
    optimizeInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updateEfficiencyPreview);
        }
    });

    // Initial updates
    updatePowerLimits();
    updateOptimizeInitials();
    updateEfficiencyPreview();
    updateEfficiencyCurveChart();
});

/**
 * Handle analysis mode change (sweep vs optimize)
 */
function handleAnalysisModeChange() {
    const mode = document.querySelector('input[name="analysisMode"]:checked').value;
    const sweepInputs = document.getElementById('sweepInputs');
    const optimizeInputs = document.getElementById('optimizeInputs');
    const submitButton = document.getElementById('submitButton');

    if (mode === 'sweep') {
        sweepInputs.style.display = 'block';
        optimizeInputs.style.display = 'none';
        submitButton.textContent = '🚀 Start vermogensscan';
    } else {
        sweepInputs.style.display = 'none';
        optimizeInputs.style.display = 'block';
        submitButton.textContent = '🎯 Start optimalisatie';
    }

    updateEfficiencyPreview();
}

/**
 * Handle form submission (route to sweep or optimize)
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    const mode = document.querySelector('input[name="analysisMode"]:checked').value;

    if (mode === 'sweep') {
        await handleSweepSubmit(e);
    } else {
        await handleOptimizeSubmit(e);
    }
}

/**
 * Handle sweep form submission
 */
async function handleSweepSubmit(e) {
    const form = e.target;
    const formData = new FormData(form);

    // Get form values
    const year = parseInt(formData.get('year'));
    const capacity = parseFloat(formData.get('capacity'));
    const minSoc = parseFloat(formData.get('minSoc'));
    const maxSoc = parseFloat(formData.get('maxSoc'));
    const initialSoc = parseFloat(formData.get('initialSoc'));

    const chargeMin = parseFloat(formData.get('chargePowerMin'));
    const chargeMax = parseFloat(formData.get('chargePowerMax'));
    const chargeStep = parseFloat(formData.get('chargePowerStep'));

    const dischargeMin = parseFloat(formData.get('dischargePowerMin'));
    const dischargeMax = parseFloat(formData.get('dischargePowerMax'));
    const dischargeStep = parseFloat(formData.get('dischargePowerStep'));

    const priceMode = formData.get('priceMode');

    // Validate
    if (chargeMin >= chargeMax) {
        alert('Laadvermogen min moet kleiner zijn dan max');
        return;
    }
    if (dischargeMin >= dischargeMax) {
        alert('Ontlaadvermogen min moet kleiner zijn dan max');
        return;
    }
    if (chargeStep <= 0 || dischargeStep <= 0) {
        alert('Step grootte moet groter dan 0 zijn');
        return;
    }

    // Calculate grid size
    const chargePoints = Math.floor((chargeMax - chargeMin) / chargeStep) + 1;
    const dischargePoints = Math.floor((dischargeMax - dischargeMin) / dischargeStep) + 1;
    const totalPoints = chargePoints * dischargePoints;

    // Warn if grid is large
    if (totalPoints > 150) {
        const minutes = Math.ceil(totalPoints * 2 / 60);
        if (!confirm(`Grote scan: ${totalPoints} configuraties (±${minutes} minuten). Doorgaan?`)) {
            return;
        }
    }

    // Disable form
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    // Show progress
    const progressContainer = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressContainer.style.display = 'block';

    try {
        // Load price data
        const pricesData = await loadPriceData(year);
        currentPricesData = pricesData;

        // Build price config
        const priceConfig = buildPriceConfig(priceMode, formData);

        // Get efficiency curve from selected preset
        const inverterPreset = formData.get('inverterPreset') || 'VICTRON_MP5000_3P';
        const efficiencyCurve = EfficiencyCurve[inverterPreset];

        // Create sweep analysis
        const sweep = new PowerSweepAnalysis(
            capacity,
            priceConfig,
            pricesData,
            efficiencyCurve
        );

        // Run sweep
        const sweepOptions = {
            chargePowerRange: [chargeMin, chargeMax, chargeStep],
            dischargePowerRange: [dischargeMin, dischargeMax, dischargeStep],
            minSocPct: minSoc,
            maxSocPct: maxSoc,
            initialSocPct: initialSoc
        };

        const sweepData = await sweep.runSweep(sweepOptions, (current, total, chargePower, dischargePower) => {
            const percent = (current / total) * 100;
            progressBar.style.width = percent + '%';
            progressText.textContent = `${current} / ${total} - ${chargePower} kW laden, ${dischargePower} kW ontladen`;
        });

        currentSweepData = sweepData;

        // Hide progress
        progressContainer.style.display = 'none';

        // Display results
        displaySweepResults(sweepData, year, capacity);

    } catch (error) {
        console.error('Scan error:', error);
        alert('Fout bij uitvoeren scan: ' + error.message);
        progressContainer.style.display = 'none';
    } finally {
        // Re-enable form
        submitButton.disabled = false;
    }
}

/**
 * Load price data for given year
 */
async function loadPriceData(year) {
    const response = await fetch(`data/prices_${year}.json`);
    if (!response.ok) {
        throw new Error(`Kon prijsdata voor ${year} niet laden`);
    }
    const data = await response.json();
    return data.prices;
}

/**
 * Build price configuration from form
 */
function buildPriceConfig(priceMode, formData) {
    if (priceMode === 'custom') {
        const customBuy = formData.get('customBuyFormula');
        const customSell = formData.get('customSellFormula');

        return {
            buyFormula: eval(`(epex) => ${customBuy}`),
            sellFormula: eval(`(epex) => ${customSell}`)
        };
    } else if (priceMode === 'standard-saldering') {
        return {
            buyFormula: (epex) => (epex / 1000 + 0.10154) * 1.21 + 0.0248,
            sellFormula: (epex) => (epex / 1000 + 0.10154) * 1.21 + 0.0248
        };
    } else if (priceMode === 'standard-no-saldering') {
        return {
            buyFormula: (epex) => (epex / 1000 + 0.10154) * 1.21 + 0.0248,
            sellFormula: (epex) => epex / 1000 + 0.0248 / 1.21
        };
    } else if (priceMode === 'bare') {
        return {
            buyFormula: (epex) => epex / 1000,
            sellFormula: (epex) => epex / 1000
        };
    }

    throw new Error('Onbekende price mode: ' + priceMode);
}

/**
 * Display sweep results
 */
function displaySweepResults(sweepData, year, capacity) {
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    const {bestConfig, diagonalData} = sweepData;

    // Summary cards
    document.getElementById('bestConfigText').innerHTML =
        `${bestConfig.chargePower} kW laden<br>${bestConfig.dischargePower} kW ontladen`;
    document.getElementById('totalProfit').textContent = '€' + bestConfig.profit.toFixed(2);
    document.getElementById('totalCycles').textContent = bestConfig.cycles.toFixed(1);
    document.getElementById('avgProfitPerCycle').textContent = '€' + bestConfig.profitPerCycle.toFixed(2);
    const bestRTE = bestConfig.chargeEfficiency * bestConfig.dischargeEfficiency;
    document.getElementById('bestEfficiency').innerHTML =
        `RTE: ${(bestRTE * 100).toFixed(1)}%<br><small>${(bestConfig.chargeEfficiency * 100).toFixed(1)}% / ${(bestConfig.dischargeEfficiency * 100).toFixed(1)}%</small>`;

    // Diagonal chart
    if (diagonalData.length > 0) {
        document.getElementById('diagonalChartContainer').style.display = 'block';
        createDiagonalChart(diagonalData);
    } else {
        document.getElementById('diagonalChartContainer').style.display = 'none';
    }

    // Update table heading for sweep mode
    const tableHeading = document.querySelector('.table-container h3');
    if (tableHeading) {
        tableHeading.textContent = 'Top 10 configuraties';
    }

    // Show and populate heatmap
    const heatmapContainer = document.getElementById('heatmapContainer');
    heatmapContainer.style.display = 'block';
    heatmapContainer.innerHTML = createHeatmapGrid(sweepData, (chargePower, dischargePower) => {
        // Find and show configuration details
        const config = sweepData.results.find(r =>
            Math.abs(r.chargePower - chargePower) < 0.01 &&
            Math.abs(r.dischargePower - dischargePower) < 0.01
        );
        if (config) {
            showConfigDetails(config, year, capacity);
        }
    });
    attachHeatmapHandlers((chargePower, dischargePower) => {
        const config = sweepData.results.find(r =>
            Math.abs(r.chargePower - chargePower) < 0.01 &&
            Math.abs(r.dischargePower - dischargePower) < 0.01
        );
        if (config) {
            showConfigDetails(config, year, capacity);
        }
    });

    // Top 10 table
    const top10 = sweepData.results
        .slice()
        .sort((a, b) => b.profit - a.profit)
        .slice(0, 10);

    const tbody = document.getElementById('top10TableBody');
    tbody.innerHTML = '';

    for (const config of top10) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.innerHTML = `
            <td>${config.chargePower.toFixed(1)}</td>
            <td>${config.dischargePower.toFixed(1)}</td>
            <td class="profit-positive">€${config.profit.toFixed(2)}</td>
            <td>${config.cycles.toFixed(1)}</td>
            <td>€${config.profitPerCycle.toFixed(2)}</td>
            <td>${(config.chargeEfficiency * 100).toFixed(1)}%</td>
            <td>${(config.dischargeEfficiency * 100).toFixed(1)}%</td>
        `;
        row.addEventListener('click', () => showConfigDetails(config, year, capacity));
        tbody.appendChild(row);
    }

    // Scroll to results
    resultsSection.scrollIntoView({behavior: 'smooth'});
}

/**
 * Handle optimize form submission
 */
async function handleOptimizeSubmit(e) {
    const form = e.target;
    const formData = new FormData(form);

    // Get form values
    const year = parseInt(formData.get('year'));
    const capacity = parseFloat(formData.get('capacity'));
    const minSoc = parseFloat(formData.get('minSoc'));
    const maxSoc = parseFloat(formData.get('maxSoc'));
    const initialSoc = parseFloat(formData.get('initialSoc'));

    const initialChargePower = parseFloat(formData.get('initialChargePower'));
    const initialDischargePower = parseFloat(formData.get('initialDischargePower'));
    const tolerance = parseFloat(formData.get('tolerance'));

    const priceMode = formData.get('priceMode');

    // Disable form
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    // Show progress
    const progressContainer = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressContainer.style.display = 'block';

    try {
        // Load price data
        const pricesData = await loadPriceData(year);
        currentPricesData = pricesData;

        // Build price config
        const priceConfig = buildPriceConfig(priceMode, formData);

        // Get efficiency curve from selected preset
        const inverterPreset = formData.get('inverterPreset') || 'VICTRON_MP5000_3P';
        const efficiencyCurve = EfficiencyCurve[inverterPreset];

        // Create optimizer
        const optimizer = new PowerOptimizer(
            capacity,
            priceConfig,
            pricesData,
            efficiencyCurve
        );

        // Run optimization
        const optimizeOptions = {
            minSocPct: minSoc,
            maxSocPct: maxSoc,
            initialSocPct: initialSoc
        };

        const maxIterations = 100; // Same as in PowerOptimizer
        const optimizeResult = await optimizer.optimize(
            initialChargePower,
            initialDischargePower,
            tolerance,
            optimizeOptions,
            (iteration, evaluations, bestProfit) => {
                // Show progress based on iterations
                const percent = Math.min(100, (iteration / maxIterations) * 100);
                progressBar.style.width = percent + '%';
                progressText.textContent = `Iteratie ${iteration}/${maxIterations}, ${evaluations} evaluaties - beste winst: €${bestProfit.toFixed(2)}`;
            }
        );

        // Hide progress
        progressContainer.style.display = 'none';

        // Display results
        displayOptimizeResults(optimizeResult, year, capacity);

    } catch (error) {
        console.error('Optimalisatie error:', error);
        alert('Fout bij uitvoeren optimalisatie: ' + error.message);
        progressContainer.style.display = 'none';
    } finally {
        // Re-enable form
        submitButton.disabled = false;
    }
}

/**
 * Display optimize results
 */
function displayOptimizeResults(optimizeResult, year, capacity) {
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    const bestConfig = optimizeResult.bestConfig;

    // Summary cards
    document.getElementById('bestConfigText').innerHTML =
        `${bestConfig.chargePower.toFixed(1)} kW laden<br>${bestConfig.dischargePower.toFixed(1)} kW ontladen`;
    document.getElementById('totalProfit').textContent = '€' + bestConfig.profit.toFixed(2);
    document.getElementById('totalCycles').textContent = bestConfig.cycles.toFixed(1);
    document.getElementById('avgProfitPerCycle').textContent = '€' + bestConfig.profitPerCycle.toFixed(2);
    const bestRTE = bestConfig.chargeEfficiency * bestConfig.dischargeEfficiency;
    document.getElementById('bestEfficiency').innerHTML =
        `RTE: ${(bestRTE * 100).toFixed(1)}%<br><small>${(bestConfig.chargeEfficiency * 100).toFixed(1)}% / ${(bestConfig.dischargeEfficiency * 100).toFixed(1)}%</small>`;

    // Hide heatmap and diagonal charts (not applicable for optimize mode)
    document.getElementById('diagonalChartContainer').style.display = 'none';
    document.getElementById('heatmapContainer').style.display = 'none';

    // Update table heading for optimize mode
    const tableHeading = document.querySelector('.table-container h3');
    if (tableHeading) {
        tableHeading.textContent = 'Optimaal resultaat';
    }

    // Best config table - show only best config with convergence info
    const tbody = document.getElementById('top10TableBody');
    tbody.innerHTML = '';

    // Create clickable row for best config
    const row = document.createElement('tr');
    row.className = 'clickable-row';
    row.innerHTML = `
        <td>${bestConfig.chargePower.toFixed(1)}</td>
        <td>${bestConfig.dischargePower.toFixed(1)}</td>
        <td class="profit-positive">€${bestConfig.profit.toFixed(2)}</td>
        <td>${bestConfig.cycles.toFixed(1)}</td>
        <td>€${bestConfig.profitPerCycle.toFixed(2)}</td>
        <td>${(bestConfig.chargeEfficiency * 100).toFixed(1)}%</td>
        <td>${(bestConfig.dischargeEfficiency * 100).toFixed(1)}%</td>
    `;
    row.addEventListener('click', () => showConfigDetails(bestConfig, year, capacity));
    tbody.appendChild(row);

    // Add convergence info row
    const infoRow = document.createElement('tr');
    infoRow.innerHTML = `
        <td colspan="7" style="text-align: center; padding: 1rem; color: var(--text-secondary); cursor: default;">
            <small>
                <strong>Optimalisatie:</strong>
                ${optimizeResult.iterations} iteraties, ${optimizeResult.evaluations} evaluaties
                ${optimizeResult.converged ? '✓ Geconvergeerd' : '⚠️ Max iteraties bereikt'}
            </small>
        </td>
    `;
    tbody.appendChild(infoRow);

    // Scroll to results
    resultsSection.scrollIntoView({behavior: 'smooth'});
}

/**
 * Show detailed configuration modal
 */
function showConfigDetails(config, year, capacity) {
    const modal = document.getElementById('configModal');
    const title = document.getElementById('modalTitle');
    const content = document.getElementById('modalContent');

    title.textContent = `${config.chargePower} kW laden / ${config.dischargePower} kW ontladen`;

    content.innerHTML = `
        <div class="config-details">
            <div class="detail-card">
                <h4>Vermogen</h4>
                <p>Laadvermogen: ${config.chargePower} kW DC</p>
                <p>Ontlaadvermogen: ${config.dischargePower} kW DC</p>
                <p>C-rate laden: ${config.chargeCRate.toFixed(2)}</p>
                <p>C-rate ontladen: ${config.dischargeCRate.toFixed(2)}</p>
            </div>

            <div class="detail-card">
                <h4>Efficiency</h4>
                <p><strong>RTE totaal: ${(config.chargeEfficiency * config.dischargeEfficiency * 100).toFixed(1)}%</strong></p>
                <p>Laden totaal: ${(config.chargeEfficiency * 100).toFixed(1)}%</p>
                <p>&nbsp;&nbsp;↳ Omvormer: ${(config.chargeInverterEff * 100).toFixed(1)}%</p>
                <p>&nbsp;&nbsp;↳ Batterij: ${(Math.sqrt(config.chargeBatteryRTE) * 100).toFixed(1)}%</p>
                <p>Ontladen totaal: ${(config.dischargeEfficiency * 100).toFixed(1)}%</p>
                <p>&nbsp;&nbsp;↳ Omvormer: ${(config.dischargeInverterEff * 100).toFixed(1)}%</p>
                <p>&nbsp;&nbsp;↳ Batterij: ${(Math.sqrt(config.dischargeBatteryRTE) * 100).toFixed(1)}%</p>
            </div>

            <div class="detail-card">
                <h4>Resultaten</h4>
                <p>Totale winst: €${config.profit.toFixed(2)}</p>
                <p>Cycli: ${config.cycles.toFixed(1)}</p>
                <p>Winst per cyclus: €${config.profitPerCycle.toFixed(2)}</p>
            </div>
        </div>

        <h4>Maandelijks Overzicht</h4>
        <table>
            <thead>
                <tr>
                    <th>Maand</th>
                    <th>Winst (€)</th>
                    <th>Cycli</th>
                    <th>€/cyclus</th>
                </tr>
            </thead>
            <tbody>
                ${config.monthlySummary.map(m => `
                    <tr>
                        <td>${m.monthName}</td>
                        <td class="${m.profitEur >= 0 ? 'profit-positive' : 'profit-negative'}">
                            €${m.profitEur.toFixed(2)}
                        </td>
                        <td>${m.cycles.toFixed(1)}</td>
                        <td>€${m.profitPerCycle.toFixed(2)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    modal.style.display = 'flex';
}

// Close modal
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('configModal');
    const closeBtn = document.getElementById('closeModal');

    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
});

/**
 * Update power limits based on selected inverter
 */
function updatePowerLimits() {
    const inverterPreset = document.getElementById('inverterPreset').value || 'VICTRON_MP5000_3P';
    const effCurve = EfficiencyCurve[inverterPreset];

    // Define defaults per inverter type
    let chargeDefaults, dischargeDefaults;

    if (inverterPreset === 'VICTRON_MP5000_1P') {
        // 1-phase: lower power, finer steps
        chargeDefaults = { min: 0.5, max: effCurve.maxChargePowerKw, step: 0.5 };
        dischargeDefaults = { min: 0.5, max: effCurve.maxDischargePowerKw, step: 0.5 };
    } else {
        // 3-phase: higher power, coarser steps
        chargeDefaults = { min: 2.0, max: effCurve.maxChargePowerKw, step: 2.0 };
        dischargeDefaults = { min: 2.0, max: effCurve.maxDischargePowerKw, step: 2.0 };
    }

    // Update charge power inputs
    const chargeMinInput = document.getElementById('chargePowerMin');
    const chargeMaxInput = document.getElementById('chargePowerMax');
    const chargeStepInput = document.getElementById('chargePowerStep');

    chargeMinInput.max = effCurve.maxChargePowerKw;
    chargeMaxInput.max = effCurve.maxChargePowerKw;

    // Set new defaults (only if current values exceed limits or are at old defaults)
    chargeMinInput.value = chargeDefaults.min.toFixed(1);
    chargeMaxInput.value = chargeDefaults.max.toFixed(1);
    chargeStepInput.value = chargeDefaults.step.toFixed(1);

    // Update discharge power inputs
    const dischargeMinInput = document.getElementById('dischargePowerMin');
    const dischargeMaxInput = document.getElementById('dischargePowerMax');
    const dischargeStepInput = document.getElementById('dischargePowerStep');

    dischargeMinInput.max = effCurve.maxDischargePowerKw;
    dischargeMaxInput.max = effCurve.maxDischargePowerKw;

    // Set new defaults
    dischargeMinInput.value = dischargeDefaults.min.toFixed(1);
    dischargeMaxInput.value = dischargeDefaults.max.toFixed(1);
    dischargeStepInput.value = dischargeDefaults.step.toFixed(1);

    // Update limit labels
    const chargeLimitLabel = document.querySelector('#sweepForm .form-section:nth-of-type(4) small');
    if (chargeLimitLabel) {
        chargeLimitLabel.textContent = `Max: ${effCurve.maxChargePowerKw.toFixed(1)} kW DC (omvormer limiet)`;
    }

    const dischargeLimitLabel = document.querySelector('#sweepForm .form-section:nth-of-type(5) small');
    if (dischargeLimitLabel) {
        dischargeLimitLabel.textContent = `Max: ${effCurve.maxDischargePowerKw.toFixed(1)} kW DC (omvormer limiet)`;
    }
}

/**
 * Update efficiency preview
 */
function updateEfficiencyPreview() {
    const capacity = parseFloat(document.getElementById('capacity').value) || 32;

    // Determine current mode
    const mode = document.querySelector('input[name="analysisMode"]:checked')?.value || 'sweep';

    let chargePower, dischargePower;

    if (mode === 'optimize') {
        // Use initial values for optimize mode
        chargePower = parseFloat(document.getElementById('initialChargePower').value) || 5.5;
        dischargePower = parseFloat(document.getElementById('initialDischargePower').value) || 7.5;
    } else {
        // Use midpoint for sweep mode
        const chargeMin = parseFloat(document.getElementById('chargePowerMin').value) || 2;
        const chargeMax = parseFloat(document.getElementById('chargePowerMax').value) || 11;
        const dischargeMin = parseFloat(document.getElementById('dischargePowerMin').value) || 2;
        const dischargeMax = parseFloat(document.getElementById('dischargePowerMax').value) || 17;

        chargePower = (chargeMin + chargeMax) / 2;
        dischargePower = (dischargeMin + dischargeMax) / 2;
    }

    // Get selected inverter preset
    const inverterPreset = document.getElementById('inverterPreset').value || 'VICTRON_MP5000_3P';
    const effCurve = EfficiencyCurve[inverterPreset];

    const chargeEff = effCurve.getCombinedEfficiency(chargePower, capacity);
    const dischargeEff = effCurve.getCombinedEfficiency(dischargePower, capacity);

    const preview = document.getElementById('efficiencyPreview');
    preview.innerHTML = `
        <p><strong>${effCurve.name}</strong></p>
        <strong>@ ${chargePower.toFixed(1)} kW laden (C=${chargeEff.cRate.toFixed(2)}):</strong><br>
        &nbsp;&nbsp;Omvormer: ${(chargeEff.chargeInverter * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;Batterij: ${(chargeEff.batterySingle * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;<strong>Totaal: ${(chargeEff.chargeTotal * 100).toFixed(1)}%</strong><br>
        <br>
        <strong>@ ${dischargePower.toFixed(1)} kW ontladen (C=${dischargeEff.cRate.toFixed(2)}):</strong><br>
        &nbsp;&nbsp;Omvormer: ${(dischargeEff.dischargeInverter * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;Batterij: ${(dischargeEff.batterySingle * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;<strong>Totaal: ${(dischargeEff.dischargeTotal * 100).toFixed(1)}%</strong>
    `;

    // Warning for high C-rate
    if (chargeEff.cRate > 2.0 || dischargeEff.cRate > 2.0) {
        preview.innerHTML += '<br><br><span style="color: var(--danger-color);">⚠️ Let op: hoge C-rate, belastend voor batterij!</span>';
    }
}

/**
 * Update initial optimize values based on selected inverter
 */
function updateOptimizeInitials() {
    const inverterPreset = document.getElementById('inverterPreset').value || 'VICTRON_MP5000_3P';
    const effCurve = EfficiencyCurve[inverterPreset];

    const initialChargeInput = document.getElementById('initialChargePower');
    const initialDischargeInput = document.getElementById('initialDischargePower');

    if (initialChargeInput && initialDischargeInput) {
        // Set to midpoint of available range
        const initialCharge = effCurve.maxChargePowerKw / 2;
        const initialDischarge = effCurve.maxDischargePowerKw / 2;

        initialChargeInput.value = initialCharge.toFixed(1);
        initialChargeInput.max = effCurve.maxChargePowerKw;

        initialDischargeInput.value = initialDischarge.toFixed(1);
        initialDischargeInput.max = effCurve.maxDischargePowerKw;
    }
}

/**
 * Update efficiency curve chart
 */
function updateEfficiencyCurveChart() {
    const capacity = parseFloat(document.getElementById('capacity').value) || 32;
    const inverterPreset = document.getElementById('inverterPreset').value || 'VICTRON_MP5000_3P';
    const effCurve = EfficiencyCurve[inverterPreset];

    createEfficiencyCurveChart(effCurve, capacity);
}

// Show/hide custom formula inputs
document.addEventListener('DOMContentLoaded', () => {
    const priceRadios = document.querySelectorAll('input[name="priceMode"]');
    const customInputs = document.getElementById('customFormulaInputs');

    priceRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.value === 'custom') {
                customInputs.style.display = 'block';
            } else {
                customInputs.style.display = 'none';
            }
        });
    });
});
