/**
 * Custom Data UI - Handle file upload, parsing, and results display
 */

// Global state
let parsedData = null;
let currentResults = null;
let costsChart = null;
let gridFlowsChart = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Load HiGHS solver
    await loadHighsSolver();

    // Attach file upload handler
    const fileInput = document.getElementById('p1File');
    fileInput.addEventListener('change', handleFileUpload);

    // Attach form handler
    const form = document.getElementById('customDataForm');
    form.addEventListener('submit', handleFormSubmit);

    // Show/hide custom formula inputs
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

/**
 * Handle file upload
 */
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    const runButton = document.getElementById('runButton');
    const preview = document.getElementById('dataPreview');

    try {
        // Read file
        const csvString = await file.text();

        // Parse and aggregate
        const parser = new P1Parser();
        const result = await parser.parseAndAggregate(csvString);

        parsedData = {
            hourlyData: result.hourlyData,
            stats: result.stats,
            formatted: parser.formatForSimulator(result.hourlyData)
        };

        // Show preview
        displayDataPreview(parsedData);
        preview.style.display = 'block';

        // Enable submit button
        runButton.disabled = false;

    } catch (error) {
        console.error('Fout bij parsen P1 data:', error);
        alert('Fout bij verwerken bestand: ' + error.message);
        runButton.disabled = true;
        preview.style.display = 'none';
        parsedData = null;
    }
}

/**
 * Display data preview and statistics
 */
function displayDataPreview(data) {
    const stats = data.stats;

    // Show statistics
    const statsHtml = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            <div class="stat-item">
                <strong>Jaar:</strong> ${stats.year}
            </div>
            <div class="stat-item">
                <strong>Periode:</strong> ${stats.firstTimestamp.toLocaleDateString('nl-NL')} - ${stats.lastTimestamp.toLocaleDateString('nl-NL')}
            </div>
            <div class="stat-item">
                <strong>Duur:</strong> ${stats.durationDays.toFixed(0)} dagen
            </div>
            <div class="stat-item">
                <strong>Interval:</strong> ${stats.detectedInterval} minuten
            </div>
            <div class="stat-item">
                <strong>Metingen:</strong> ${stats.rawSamples} (${stats.hourlySamples} uur)
            </div>
            <div class="stat-item">
                <strong>Totaal Import:</strong> ${stats.totalImport.toFixed(1)} kWh
            </div>
            <div class="stat-item">
                <strong>Totaal Export:</strong> ${stats.totalExport.toFixed(1)} kWh
            </div>
            <div class="stat-item">
                <strong>Netto:</strong> ${stats.netFlow.toFixed(1)} kWh
            </div>
        </div>
    `;
    document.getElementById('dataStats').innerHTML = statsHtml;

    // Show first 10 samples
    const samples = data.formatted.slice(0, 10);
    let csvHtml = '<table style="width: 100%; font-size: 0.85rem;"><thead><tr><th>Timestamp</th><th>Import (kWh)</th><th>Export (kWh)</th><th>Netto (kWh)</th></tr></thead><tbody>';

    for (const sample of samples) {
        const timestamp = new Date(sample.timestamp).toLocaleString('nl-NL');
        csvHtml += `
            <tr>
                <td>${timestamp}</td>
                <td>${sample.gridImport.toFixed(3)}</td>
                <td>${sample.gridExport.toFixed(3)}</td>
                <td style="${sample.netGridFlow >= 0 ? 'color: var(--danger-color)' : 'color: var(--success-color)'}">${sample.netGridFlow.toFixed(3)}</td>
            </tr>
        `;
    }

    csvHtml += '</tbody></table>';
    csvHtml += '<p style="margin-top: 0.5rem; color: var(--text-secondary); font-size: 0.85rem;">Eerste 10 uur van de data</p>';
    document.getElementById('csvPreview').innerHTML = csvHtml;
}

/**
 * Handle form submission
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    if (!parsedData) {
        alert('Upload eerst een P1 bestand');
        return;
    }

    const form = e.target;
    const formData = new FormData(form);

    // Get form values
    const capacity = parseFloat(formData.get('capacity'));
    const initialSoc = parseFloat(formData.get('initialSoc'));
    const chargePower = parseFloat(formData.get('chargePower'));
    const dischargePower = parseFloat(formData.get('dischargePower'));
    const chargeEff = parseFloat(formData.get('chargeEff')) / 100;
    const dischargeEff = parseFloat(formData.get('dischargeEff')) / 100;
    const minSoc = parseFloat(formData.get('minSoc'));
    const maxSoc = parseFloat(formData.get('maxSoc'));
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
        // Load EPEX prices for the year
        progressText.textContent = 'Prijsdata laden...';
        progressBar.style.width = '5%';

        const year = parsedData.stats.year;
        const pricesData = await loadPriceData(year);

        // Build configurations
        const batteryConfig = {
            capacityKwh: capacity,
            chargePowerKw: chargePower,
            dischargePowerKw: dischargePower,
            chargeEfficiency: chargeEff,
            dischargeEfficiency: dischargeEff,
            minSocPct: minSoc / 100,
            maxSocPct: maxSoc / 100,
            initialSocPct: initialSoc / 100
        };

        const priceConfig = buildPriceConfig(priceMode, formData);

        const fixedBuyPrice = parseFloat(formData.get('fixedBuyPrice'));
        const fixedSellPrice = parseFloat(formData.get('fixedSellPrice'));
        const fixedPriceConfig = {
            buy: fixedBuyPrice,
            sell: fixedSellPrice
        };

        // Create simulator
        const simulator = new CustomDataSimulator(
            batteryConfig,
            priceConfig,
            fixedPriceConfig,
            parsedData.formatted,
            pricesData
        );

        // Run simulation
        const results = await simulator.simulateAll((progress, message) => {
            progressBar.style.width = progress + '%';
            progressText.textContent = message;
        });

        currentResults = results;

        // Generate monthly summaries for all scenarios
        const fixedNoBatteryMonthly = simulator.getMonthlySummary(results.fixedNoBattery);
        const fixedWithBatteryMonthly = simulator.getMonthlySummary(results.fixedWithBattery);
        const dynamicNoBatteryMonthly = simulator.getMonthlySummary(results.dynamicNoBattery);
        const dynamicWithBatteryMonthly = simulator.getMonthlySummary(results.dynamicWithBattery);

        // Hide progress
        progressContainer.style.display = 'none';

        // Display results
        displayResults(results, {
            fixedNoBattery: fixedNoBatteryMonthly,
            fixedWithBattery: fixedWithBatteryMonthly,
            dynamicNoBattery: dynamicNoBatteryMonthly,
            dynamicWithBattery: dynamicWithBatteryMonthly
        });

    } catch (error) {
        console.error('Simulatie fout:', error);
        alert('Fout bij uitvoeren simulatie: ' + error.message);
        progressContainer.style.display = 'none';
    } finally {
        // Re-enable form
        submitButton.disabled = false;
    }
}

/**
 * Load price data for a given year
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
 * Display simulation results
 */
function displayResults(results, monthlySummaries) {
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    const fixedNoBat = results.fixedNoBattery;
    const fixedWithBat = results.fixedWithBattery;
    const dynNoBat = results.dynamicNoBattery;
    const dynWithBat = results.dynamicWithBattery;

    // Summary cards - use best case (dynamisch met batterij)
    document.getElementById('costsNoBattery').textContent = '€' + fixedNoBat.totalCost.toFixed(2);
    document.getElementById('costsWithBattery').textContent = '€' + dynWithBat.totalCost.toFixed(2);

    // Total savings: vast zonder → dynamisch met batterij
    const totalSavings = fixedNoBat.totalCost - dynWithBat.totalCost;
    document.getElementById('totalSavings').textContent = '€' + totalSavings.toFixed(2);

    document.getElementById('totalCycles').textContent = dynWithBat.cycles.toFixed(1);
    document.getElementById('savingsPerCycle').textContent = '€' + (totalSavings / dynWithBat.cycles).toFixed(2);
    document.getElementById('gridImport').textContent = dynWithBat.totalImport.toFixed(0) + ' kWh';
    document.getElementById('gridExport').textContent = dynWithBat.totalExport.toFixed(0) + ' kWh';

    // Fill savings detail table
    fillSavingsDetailTable(results);

    // Create charts with all 4 scenarios
    createCostsComparisonChart(monthlySummaries);
    createGridFlowsChart(monthlySummaries.dynamicWithBattery);

    // Fill monthly table
    fillMonthlyTable(monthlySummaries);

    // Scroll to results
    resultsSection.scrollIntoView({behavior: 'smooth'});
}

/**
 * Create costs comparison chart
 */
function createCostsComparisonChart(monthlySummaries) {
    if (costsChart) {
        costsChart.destroy();
    }

    const canvas = document.getElementById('costsComparisonChart');
    const ctx = canvas.getContext('2d');

    const labels = monthlySummaries.fixedNoBattery.map(m => m.monthName);
    const fixedNoBatteryCosts = monthlySummaries.fixedNoBattery.map(m => m.cost);
    const fixedWithBatteryCosts = monthlySummaries.fixedWithBattery.map(m => m.cost);
    const dynamicNoBatteryCosts = monthlySummaries.dynamicNoBattery.map(m => m.cost);
    const dynamicWithBatteryCosts = monthlySummaries.dynamicWithBattery.map(m => m.cost);

    costsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Vast zonder batterij',
                    data: fixedNoBatteryCosts,
                    borderColor: 'rgba(107, 114, 128, 1)',
                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3
                },
                {
                    label: 'Vast met batterij',
                    data: fixedWithBatteryCosts,
                    borderColor: 'rgba(59, 130, 246, 1)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    borderDash: [3, 3],
                    tension: 0.3
                },
                {
                    label: 'Dynamisch zonder batterij',
                    data: dynamicNoBatteryCosts,
                    borderColor: 'rgba(220, 38, 38, 1)',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 2,
                    tension: 0.3
                },
                {
                    label: 'Dynamisch met batterij',
                    data: dynamicWithBatteryCosts,
                    borderColor: 'rgba(16, 185, 129, 1)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': €' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Kosten (€)'
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
                        text: 'Maand'
                    }
                }
            }
        }
    });
}

/**
 * Fill savings detail table
 */
function fillSavingsDetailTable(results) {
    const tbody = document.getElementById('savingsTableBody');
    tbody.innerHTML = '';

    const fixedNoBat = results.fixedNoBattery;
    const fixedWithBat = results.fixedWithBattery;
    const dynNoBat = results.dynamicNoBattery;
    const dynWithBat = results.dynamicWithBattery;

    const savings = [
        {
            name: 'Effect batterij (vast)',
            amount: fixedNoBat.totalCost - fixedWithBat.totalCost,
            description: 'Vast zonder → Vast met batterij'
        },
        {
            name: 'Effect dynamisch contract',
            amount: fixedNoBat.totalCost - dynNoBat.totalCost,
            description: 'Vast → Dynamisch zonder batterij'
        },
        {
            name: 'Effect batterij (dynamisch)',
            amount: dynNoBat.totalCost - dynWithBat.totalCost,
            description: 'Dyn. zonder → Dyn. met batterij'
        },
        {
            name: 'Totale besparing',
            amount: fixedNoBat.totalCost - dynWithBat.totalCost,
            description: 'Vast → Dynamisch + batterij',
            highlight: true
        }
    ];

    for (const saving of savings) {
        const row = document.createElement('tr');
        const rowClass = saving.highlight ? ' style="font-weight: 600;"' : '';
        const amountClass = saving.amount >= 0 ? 'profit-positive' : 'profit-negative';

        row.innerHTML = `
            <td${rowClass}>${saving.name}</td>
            <td class="${amountClass}"${rowClass}>€${saving.amount.toFixed(2)}</td>
            <td${rowClass}>${saving.description}</td>
        `;
        tbody.appendChild(row);
    }
}

/**
 * Create grid flows chart
 */
function createGridFlowsChart(dynamicWithBatteryMonthly) {
    if (gridFlowsChart) {
        gridFlowsChart.destroy();
    }

    const canvas = document.getElementById('gridFlowsChart');
    const ctx = canvas.getContext('2d');

    const labels = dynamicWithBatteryMonthly.map(m => m.monthName);
    const gridImport = dynamicWithBatteryMonthly.map(m => m.gridImport);
    const gridExport = dynamicWithBatteryMonthly.map(m => -m.gridExport);  // Negative for visualization

    gridFlowsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Import',
                    data: gridImport,
                    backgroundColor: 'rgba(220, 38, 38, 0.6)',
                    borderColor: 'rgba(220, 38, 38, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Export',
                    data: gridExport,
                    backgroundColor: 'rgba(16, 185, 129, 0.6)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = Math.abs(context.parsed.y);
                            return context.dataset.label + ': ' + value.toFixed(0) + ' kWh';
                        }
                    }
                }
            },
            scales: {
                y: {
                    title: {
                        display: true,
                        text: 'Energie (kWh)'
                    },
                    ticks: {
                        callback: function(value) {
                            return Math.abs(value).toFixed(0) + ' kWh';
                        }
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Maand'
                    }
                }
            }
        }
    });
}

/**
 * Fill monthly table
 */
function fillMonthlyTable(monthlySummaries) {
    const tbody = document.getElementById('monthlyTableBody');
    tbody.innerHTML = '';

    for (let i = 0; i < monthlySummaries.fixedNoBattery.length; i++) {
        const fixedNoBat = monthlySummaries.fixedNoBattery[i];
        const fixedWithBat = monthlySummaries.fixedWithBattery[i];
        const dynNoBat = monthlySummaries.dynamicNoBattery[i];
        const dynWithBat = monthlySummaries.dynamicWithBattery[i];

        const batteryEffectFixed = fixedNoBat.cost - fixedWithBat.cost;
        const dynamicEffect = fixedNoBat.cost - dynNoBat.cost;
        const totalSavings = fixedNoBat.cost - dynWithBat.cost;

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${fixedNoBat.monthName}</td>
            <td class="${fixedNoBat.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${fixedNoBat.cost.toFixed(2)}</td>
            <td class="${dynWithBat.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${dynWithBat.cost.toFixed(2)}</td>
            <td class="${totalSavings >= 0 ? 'profit-positive' : 'profit-negative'}">€${totalSavings.toFixed(2)}</td>
            <td>${dynWithBat.gridImport.toFixed(0)}</td>
            <td>${dynWithBat.gridExport.toFixed(0)}</td>
        `;
        tbody.appendChild(row);
    }
}
