/**
 * Advanced UI - Form handling and results display for power sweep analysis
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
    form.addEventListener('submit', handleSweepSubmit);

    // Update efficiency preview when power inputs change
    const powerInputs = ['chargePowerMin', 'chargePowerMax', 'dischargePowerMin', 'dischargePowerMax', 'capacity', 'inverterPreset'];
    powerInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updateEfficiencyPreview);
            if (id === 'inverterPreset') {
                input.addEventListener('change', updatePowerLimits);
            }
        }
    });

    // Initial efficiency preview and power limits
    updatePowerLimits();
    updateEfficiencyPreview();
});

/**
 * Handle sweep form submission
 */
async function handleSweepSubmit(e) {
    e.preventDefault();

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
        if (!confirm(`Grote sweep: ${totalPoints} configuraties (±${minutes} minuten). Doorgaan?`)) {
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
        console.error('Sweep error:', error);
        alert('Fout bij uitvoeren sweep: ' + error.message);
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

    // Heatmap
    const heatmapContainer = document.getElementById('heatmapContainer');
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
                <p>Cycles: ${config.cycles.toFixed(1)}</p>
                <p>Winst per cycle: €${config.profitPerCycle.toFixed(2)}</p>
            </div>
        </div>

        <h4>Maandelijks Overzicht</h4>
        <table>
            <thead>
                <tr>
                    <th>Maand</th>
                    <th>Winst (€)</th>
                    <th>Cycles</th>
                    <th>€/Cycle</th>
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

    // Update charge power inputs
    const chargeMinInput = document.getElementById('chargePowerMin');
    const chargeMaxInput = document.getElementById('chargePowerMax');
    chargeMinInput.max = effCurve.maxChargePowerKw;
    chargeMaxInput.max = effCurve.maxChargePowerKw;

    // Adjust values if they exceed new limits
    if (parseFloat(chargeMaxInput.value) > effCurve.maxChargePowerKw) {
        chargeMaxInput.value = effCurve.maxChargePowerKw.toFixed(1);
    }
    if (parseFloat(chargeMinInput.value) > effCurve.maxChargePowerKw) {
        chargeMinInput.value = Math.min(2.0, effCurve.maxChargePowerKw).toFixed(1);
    }

    // Update discharge power inputs
    const dischargeMinInput = document.getElementById('dischargePowerMin');
    const dischargeMaxInput = document.getElementById('dischargePowerMax');
    dischargeMinInput.max = effCurve.maxDischargePowerKw;
    dischargeMaxInput.max = effCurve.maxDischargePowerKw;

    // Adjust values if they exceed new limits
    if (parseFloat(dischargeMaxInput.value) > effCurve.maxDischargePowerKw) {
        dischargeMaxInput.value = effCurve.maxDischargePowerKw.toFixed(1);
    }
    if (parseFloat(dischargeMinInput.value) > effCurve.maxDischargePowerKw) {
        dischargeMinInput.value = Math.min(2.0, effCurve.maxDischargePowerKw).toFixed(1);
    }

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
    const chargeMin = parseFloat(document.getElementById('chargePowerMin').value) || 2;
    const chargeMax = parseFloat(document.getElementById('chargePowerMax').value) || 11;
    const dischargeMin = parseFloat(document.getElementById('dischargePowerMin').value) || 2;
    const dischargeMax = parseFloat(document.getElementById('dischargePowerMax').value) || 17;

    const chargeMid = (chargeMin + chargeMax) / 2;
    const dischargeMid = (dischargeMin + dischargeMax) / 2;

    // Get selected inverter preset
    const inverterPreset = document.getElementById('inverterPreset').value || 'VICTRON_MP5000_3P';
    const effCurve = EfficiencyCurve[inverterPreset];

    const chargeEff = effCurve.getCombinedEfficiency(chargeMid, capacity);
    const dischargeEff = effCurve.getCombinedEfficiency(dischargeMid, capacity);

    const preview = document.getElementById('efficiencyPreview');
    preview.innerHTML = `
        <p><strong>${effCurve.name}</strong></p>
        <strong>@ ${chargeMid.toFixed(1)} kW laden (C=${chargeEff.cRate.toFixed(2)}):</strong><br>
        &nbsp;&nbsp;Omvormer: ${(chargeEff.chargeInverter * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;Batterij: ${(chargeEff.batterySingle * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;<strong>Totaal: ${(chargeEff.chargeTotal * 100).toFixed(1)}%</strong><br>
        <br>
        <strong>@ ${dischargeMid.toFixed(1)} kW ontladen (C=${dischargeEff.cRate.toFixed(2)}):</strong><br>
        &nbsp;&nbsp;Omvormer: ${(dischargeEff.dischargeInverter * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;Batterij: ${(dischargeEff.batterySingle * 100).toFixed(1)}%<br>
        &nbsp;&nbsp;<strong>Totaal: ${(dischargeEff.dischargeTotal * 100).toFixed(1)}%</strong>
    `;

    // Warning for high C-rate
    if (chargeEff.cRate > 2.0 || dischargeEff.cRate > 2.0) {
        preview.innerHTML += '<br><br><span style="color: var(--danger-color);">⚠️ Let op: hoge C-rate, belastend voor batterij!</span>';
    }
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
