/**
 * Custom Data UI - Handle file upload, parsing, and results display
 */

// Global state
let parsedData = null;
let currentResults = null;
let currentSimulator = null;  // For drill-down navigation
let currentMonthlySummaries = null;  // For drill-down navigation
let costsChart = null;
let gridFlowsChart = null;
let timestepChart = null;  // For drill-down timestep chart

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

        // Parse CSV and calculate deltas, but don't aggregate yet
        // We'll aggregate after loading price data to match its interval
        const parser = new P1Parser();
        const rawData = parser.parseCSV(csvString);
        const interval = parser.detectInterval(rawData);
        const deltaData = parser.calculateDeltas(rawData);

        // Store raw data for later aggregation
        parsedData = {
            parser: parser,
            deltaData: deltaData,
            rawData: rawData,
            detectedInterval: interval,
            detectedFormat: parser.detectedFormat,  // 'p1' or 'simple'
            year: rawData[0].timestamp.getFullYear(),
            firstTimestamp: rawData[0].timestamp,
            lastTimestamp: rawData[rawData.length - 1].timestamp
        };

        // Show preview (using hourly aggregation for preview only)
        const previewAggregated = parser.aggregateToInterval(deltaData, 60);
        parser.calculateStats();
        displayDataPreview({
            hourlyData: previewAggregated,
            stats: parser.stats,
            formatted: parser.formatForSimulator(previewAggregated),
            detectedFormat: parser.detectedFormat
        });
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
    const formatType = data.detectedFormat === 'simple' ? 'Simpel (Import/Export/Opwek)' : 'P1 (cumulatieve meterstanden)';

    // Show statistics
    const statsHtml = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            <div class="stat-item">
                <strong>Format:</strong> ${formatType}
            </div>
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

        const year = parsedData.year;
        const pricesData = await loadPriceData(year);

        // Detect the finest interval in price data
        const priceInterval = detectFinestPriceInterval(pricesData);
        console.log(`Fijnste prijsdata interval: ${priceInterval} minuten`);

        // Aggregate P1 data to match the finest price interval
        progressText.textContent = `P1 data aggregeren naar ${priceInterval} min intervallen...`;
        progressBar.style.width = '8%';
        const aggregatedData = parsedData.parser.aggregateToInterval(parsedData.deltaData, priceInterval);
        parsedData.parser.calculateStats();
        const formattedData = parsedData.parser.formatForSimulator(aggregatedData);

        console.log(`P1 data geaggregeerd (${formattedData.length} intervals)`);

        // Trim P1 data to available price data range
        const trimmedData = trimToAvailablePrices(formattedData, pricesData);

        if (trimmedData.trimmed) {
            const originalEnd = new Date(parsedData.lastTimestamp).toLocaleDateString('nl-NL');
            const newEnd = new Date(trimmedData.lastDate).toLocaleDateString('nl-NL');
            console.warn(`P1 data afgekapt: ${originalEnd} → ${newEnd} (prijsdata niet beschikbaar)`);

            // Show warning to user
            const warning = `Let op: P1 data loopt tot ${originalEnd}, maar prijsdata is alleen beschikbaar tot ${newEnd}. Simulatie uitgevoerd tot ${newEnd}.`;
            alert(warning);
        }

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

        // Create simulator with detected interval
        const simulator = new CustomDataSimulator(
            batteryConfig,
            priceConfig,
            fixedPriceConfig,
            trimmedData.data,
            pricesData,
            priceInterval  // Use detected interval (15 or 60)
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

        // Store for drill-down navigation
        currentSimulator = simulator;
        currentMonthlySummaries = {
            fixedNoBattery: fixedNoBatteryMonthly,
            fixedWithBattery: fixedWithBatteryMonthly,
            dynamicNoBattery: dynamicNoBatteryMonthly,
            dynamicWithBattery: dynamicWithBatteryMonthly
        };

        // Display results
        displayResults(results, currentMonthlySummaries);

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
 * Detect the finest interval in price data by checking time differences
 * Returns 15 if any quarterly data is found, otherwise 60
 */
function detectFinestPriceInterval(pricesData) {
    if (!pricesData || pricesData.length < 2) {
        return 60; // Default to hourly
    }

    // Check intervals - if ANY are ≤ 15 minutes, we have quarterly data
    for (let i = 1; i < Math.min(pricesData.length, 100); i++) {
        const prev = new Date(pricesData[i - 1].timestamp);
        const curr = new Date(pricesData[i].timestamp);
        const diffMs = curr - prev;

        // If we find a 15-minute interval, use quarterly for everything
        if (diffMs <= 15 * 60 * 1000) {
            return 15;
        }
    }

    return 60; // All hourly
}

/**
 * Trim P1 data to match available price data
 * Returns only P1 data points that have corresponding prices
 */
function trimToAvailablePrices(p1Data, pricesData) {
    if (!pricesData || pricesData.length === 0) {
        throw new Error('Geen prijsdata beschikbaar');
    }

    // Get last available price timestamp
    const lastPriceDate = new Date(pricesData[pricesData.length - 1].timestamp);
    const firstPriceDate = new Date(pricesData[0].timestamp);

    // Filter P1 data to only include timestamps within price data range
    const trimmedData = p1Data.filter(row => {
        const rowDate = new Date(row.timestamp);
        return rowDate >= firstPriceDate && rowDate <= lastPriceDate;
    });

    if (trimmedData.length === 0) {
        throw new Error('Geen overlap tussen P1 data en prijsdata');
    }

    // Check if we actually removed significant data
    // More than 5% removed = meaningful trimming
    const removalRatio = (p1Data.length - trimmedData.length) / p1Data.length;
    const wasTrimmed = removalRatio > 0.05;
    const lastDate = trimmedData[trimmedData.length - 1].timestamp;

    return {
        data: trimmedData,
        trimmed: wasTrimmed,
        lastDate: lastDate,
        removedRows: p1Data.length - trimmedData.length
    };
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
 * Calculate price statistics (average prices and export at negative prices)
 * Compares scenarios without battery vs with battery
 */
function calculatePriceStatistics(dynNoBat, dynWithBat) {
    // Calculate weighted average buy price WITHOUT battery
    let totalImportEnergyNoBat = 0;
    let weightedBuyPriceNoBat = 0;

    for (const hour of dynNoBat.hourlyResults) {
        if (hour.gridImport > 0) {
            totalImportEnergyNoBat += hour.gridImport;
            weightedBuyPriceNoBat += hour.gridImport * hour.buyPrice;
        }
    }

    const avgBuyPriceNoBat = totalImportEnergyNoBat > 0 ? weightedBuyPriceNoBat / totalImportEnergyNoBat : 0;

    // Calculate weighted average buy price WITH battery
    let totalImportEnergyWithBat = 0;
    let weightedBuyPriceWithBat = 0;

    for (const hour of dynWithBat.hourlyResults) {
        if (hour.gridImport > 0) {
            totalImportEnergyWithBat += hour.gridImport;
            weightedBuyPriceWithBat += hour.gridImport * hour.buyPrice;
        }
    }

    const avgBuyPriceWithBat = totalImportEnergyWithBat > 0 ? weightedBuyPriceWithBat / totalImportEnergyWithBat : 0;

    // Calculate weighted average sell price WITHOUT battery
    let totalExportEnergyNoBat = 0;
    let weightedSellPriceNoBat = 0;

    for (const hour of dynNoBat.hourlyResults) {
        if (hour.gridExport > 0) {
            totalExportEnergyNoBat += hour.gridExport;
            weightedSellPriceNoBat += hour.gridExport * hour.sellPrice;
        }
    }

    const avgSellPriceNoBat = totalExportEnergyNoBat > 0 ? weightedSellPriceNoBat / totalExportEnergyNoBat : 0;

    // Calculate weighted average sell price WITH battery
    let totalExportEnergyWithBat = 0;
    let weightedSellPriceWithBat = 0;

    for (const hour of dynWithBat.hourlyResults) {
        if (hour.gridExport > 0) {
            totalExportEnergyWithBat += hour.gridExport;
            weightedSellPriceWithBat += hour.gridExport * hour.sellPrice;
        }
    }

    const avgSellPriceWithBat = totalExportEnergyWithBat > 0 ? weightedSellPriceWithBat / totalExportEnergyWithBat : 0;

    // Calculate export at negative sell prices (without battery)
    let exportAtNegPriceNoBat = 0;
    let exportCostAtNegPriceNoBat = 0;  // Cost = negative revenue
    for (const hour of dynNoBat.hourlyResults) {
        if (hour.sellPrice < 0 && hour.gridExport > 0) {
            exportAtNegPriceNoBat += hour.gridExport;
            exportCostAtNegPriceNoBat += hour.gridExport * hour.sellPrice;  // Negative price × positive export = negative value (cost)
        }
    }

    // Calculate export at negative sell prices (with battery)
    let exportAtNegPriceWithBat = 0;
    let exportCostAtNegPriceWithBat = 0;
    for (const hour of dynWithBat.hourlyResults) {
        if (hour.sellPrice < 0 && hour.gridExport > 0) {
            exportAtNegPriceWithBat += hour.gridExport;
            exportCostAtNegPriceWithBat += hour.gridExport * hour.sellPrice;
        }
    }

    return {
        avgBuyPriceNoBat,
        avgBuyPriceWithBat,
        avgSellPriceNoBat,
        avgSellPriceWithBat,
        exportAtNegPriceNoBat,
        exportAtNegPriceWithBat,
        exportCostAtNegPriceNoBat,
        exportCostAtNegPriceWithBat
    };
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

    // Grid import/export with comparison (with battery as main value, without battery for comparison)
    document.getElementById('gridImport').textContent = dynWithBat.totalImport.toFixed(0) + ' kWh';
    document.getElementById('gridImportComparison').textContent = `zonder bat: ${dynNoBat.totalImport.toFixed(0)} kWh`;

    document.getElementById('gridExport').textContent = dynWithBat.totalExport.toFixed(0) + ' kWh';
    document.getElementById('gridExportComparison').textContent = `zonder bat: ${dynNoBat.totalExport.toFixed(0)} kWh`;

    // Calculate price statistics for dynamic scenarios
    const priceStats = calculatePriceStatistics(dynNoBat, dynWithBat);

    // Display average buy price (with battery as main value, without battery for comparison)
    document.getElementById('avgBuyPrice').textContent = '€' + priceStats.avgBuyPriceWithBat.toFixed(3) + '/kWh';
    document.getElementById('avgBuyPriceComparison').textContent = `zonder bat: €${priceStats.avgBuyPriceNoBat.toFixed(3)}`;

    // Display average sell price (with battery as main value, without battery for comparison)
    document.getElementById('avgSellPrice').textContent = '€' + priceStats.avgSellPriceWithBat.toFixed(3) + '/kWh';
    document.getElementById('avgSellPriceComparison').textContent = `zonder bat: €${priceStats.avgSellPriceNoBat.toFixed(3)}`;

    // Display export at negative prices (with battery as main value, without battery for comparison)
    // Show both kWh and EUR cost (negative sell price means paying to export)
    const costWithBat = Math.abs(priceStats.exportCostAtNegPriceWithBat);
    const costNoBat = Math.abs(priceStats.exportCostAtNegPriceNoBat);

    document.getElementById('exportAtNegPrice').textContent =
        `${priceStats.exportAtNegPriceWithBat.toFixed(0)} kWh / €${costWithBat.toFixed(2)}`;
    document.getElementById('exportAtNegPriceComparison').textContent =
        `zonder bat: ${priceStats.exportAtNegPriceNoBat.toFixed(0)} kWh / €${costNoBat.toFixed(2)}`;

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
        row.className = 'clickable-row';
        row.innerHTML = `
            <td>${fixedNoBat.monthName}</td>
            <td class="${fixedNoBat.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${fixedNoBat.cost.toFixed(2)}</td>
            <td class="${dynWithBat.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${dynWithBat.cost.toFixed(2)}</td>
            <td class="${totalSavings >= 0 ? 'profit-positive' : 'profit-negative'}">€${totalSavings.toFixed(2)}</td>
            <td>${dynWithBat.gridImport.toFixed(0)}</td>
            <td>${dynWithBat.gridExport.toFixed(0)}</td>
        `;

        // Make row clickable to drill down to daily view
        const monthKey = `${fixedNoBat.year}-${String(fixedNoBat.month).padStart(2, '0')}`;
        row.addEventListener('click', () => showMonthDetail(monthKey));

        tbody.appendChild(row);
    }
}

/**
 * ====================
 * Drill-down Navigation
 * ====================
 */

/**
 * Show daily detail for a specific month
 */
function showMonthDetail(monthKey) {
    if (!currentSimulator || !currentResults) return;

    // Get daily summary for this month
    const dailySummary = currentSimulator.getDailySummary(
        monthKey,
        currentResults.dynamicWithBattery,
        currentResults.fixedNoBattery
    );

    if (!dailySummary || dailySummary.length === 0) {
        alert('Geen data beschikbaar voor deze maand');
        return;
    }

    // Hide results, show detail view
    document.getElementById('results').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';
    document.getElementById('detailTitle').textContent = `Details voor ${monthKey}`;

    // Show daily view, hide timestep view
    document.getElementById('dailyView').style.display = 'block';
    document.getElementById('timestepView').style.display = 'none';

    // Show month navigation, hide day navigation
    document.getElementById('monthNavigation').style.display = 'flex';
    document.getElementById('dayNavigation').style.display = 'none';

    // Fill daily table
    const tbody = document.getElementById('dailyTableBody');
    tbody.innerHTML = '';

    for (const day of dailySummary) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.innerHTML = `
            <td>${day.dateFormatted}</td>
            <td class="${day.savings >= 0 ? 'profit-positive' : 'profit-negative'}">€${day.savings.toFixed(2)}</td>
            <td>${day.cycles.toFixed(2)}</td>
            <td>${day.gridImport.toFixed(0)}</td>
            <td>${day.gridExport.toFixed(0)}</td>
            <td>${day.minSoc.toFixed(0)}% - ${day.maxSoc.toFixed(0)}%</td>
        `;

        row.addEventListener('click', () => showDayDetail(day.date));
        tbody.appendChild(row);
    }

    // Setup month navigation
    const allMonths = currentMonthlySummaries.fixedNoBattery.map(m =>
        `${m.year}-${String(m.month).padStart(2, '0')}`
    );
    const currentIndex = allMonths.indexOf(monthKey);

    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');

    prevMonthBtn.disabled = currentIndex <= 0;
    nextMonthBtn.disabled = currentIndex >= allMonths.length - 1;

    prevMonthBtn.onclick = () => {
        if (currentIndex > 0) {
            showMonthDetail(allMonths[currentIndex - 1]);
        }
    };

    nextMonthBtn.onclick = () => {
        if (currentIndex < allMonths.length - 1) {
            showMonthDetail(allMonths[currentIndex + 1]);
        }
    };

    // Scroll to top
    document.getElementById('detailView').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Show timestep (hourly/quarterly) detail for a specific day
 */
function showDayDetail(dateKey) {
    if (!currentSimulator || !currentResults) return;

    // Get timestep data for this day
    const timestepData = currentSimulator.getTimestepSummary(
        dateKey,
        currentResults.dynamicWithBattery
    );

    if (!timestepData || timestepData.length === 0) {
        alert('Geen data beschikbaar voor deze dag');
        return;
    }

    // Update title
    const date = new Date(dateKey);
    const dateFormatted = date.toLocaleDateString('nl-NL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    document.getElementById('detailTitle').textContent = dateFormatted;

    // Hide daily view, show timestep view
    document.getElementById('dailyView').style.display = 'none';
    document.getElementById('timestepView').style.display = 'block';

    // Show day navigation, hide month navigation
    document.getElementById('dayNavigation').style.display = 'flex';
    document.getElementById('monthNavigation').style.display = 'none';

    // Create timestep chart
    createTimestepChart(timestepData);

    // Setup day navigation (all days across all months)
    const allDays = [];
    for (const month of currentMonthlySummaries.fixedNoBattery) {
        const monthKey = `${month.year}-${String(month.month).padStart(2, '0')}`;
        const monthDays = currentSimulator.getDailySummary(
            monthKey,
            currentResults.dynamicWithBattery,
            currentResults.fixedNoBattery
        );
        allDays.push(...monthDays.map(d => d.date));
    }

    const currentIndex = allDays.indexOf(dateKey);

    const prevDayBtn = document.getElementById('prevDay');
    const nextDayBtn = document.getElementById('nextDay');
    const prevWeekBtn = document.getElementById('prevWeek');
    const nextWeekBtn = document.getElementById('nextWeek');
    const prevMonthDayBtn = document.getElementById('prevMonthDay');
    const nextMonthDayBtn = document.getElementById('nextMonthDay');

    // Disable buttons at boundaries
    prevDayBtn.disabled = currentIndex <= 0;
    nextDayBtn.disabled = currentIndex >= allDays.length - 1;
    prevWeekBtn.disabled = currentIndex < 7;
    nextWeekBtn.disabled = currentIndex >= allDays.length - 7;
    prevMonthDayBtn.disabled = currentIndex < 30;
    nextMonthDayBtn.disabled = currentIndex >= allDays.length - 30;

    // Button handlers
    prevDayBtn.onclick = () => {
        if (currentIndex > 0) showDayDetail(allDays[currentIndex - 1]);
    };
    nextDayBtn.onclick = () => {
        if (currentIndex < allDays.length - 1) showDayDetail(allDays[currentIndex + 1]);
    };
    prevWeekBtn.onclick = () => {
        if (currentIndex >= 7) showDayDetail(allDays[currentIndex - 7]);
    };
    nextWeekBtn.onclick = () => {
        if (currentIndex < allDays.length - 7) showDayDetail(allDays[currentIndex + 7]);
    };
    prevMonthDayBtn.onclick = () => {
        if (currentIndex >= 30) showDayDetail(allDays[currentIndex - 30]);
    };
    nextMonthDayBtn.onclick = () => {
        if (currentIndex < allDays.length - 30) showDayDetail(allDays[currentIndex + 30]);
    };

    // Scroll to top
    document.getElementById('detailView').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Close detail view and return to main results
 */
function closeDetailView() {
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('results').style.display = 'block';

    // Clean up chart
    if (timestepChart) {
        timestepChart.destroy();
        timestepChart = null;
    }

    // Scroll to results
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Create timestep chart for a specific day
 */
function createTimestepChart(timestepData) {
    // Destroy existing chart
    if (timestepChart) {
        timestepChart.destroy();
    }

    const ctx = document.getElementById('timestepChart').getContext('2d');

    // Format labels with time
    const labels = timestepData.map((d, i) => {
        const date = new Date(d.timestamp);
        const timeStr = date.toLocaleTimeString('nl-NL', {
            hour: '2-digit',
            minute: '2-digit'
        });
        return timeStr;
    });

    // Detect quarterly vs hourly data
    const isQuarterly = timestepData.length >= 96;

    // Extract data series
    const socData = timestepData.map(d => d.batterySocPct);
    const gridImportData = timestepData.map(d => d.gridImport);
    const gridExportData = timestepData.map(d => -d.gridExport);  // Negative for visualization
    const batteryChargeData = timestepData.map(d => -d.batteryCharge);  // Negative = charging
    const batteryDischargeData = timestepData.map(d => d.batteryDischarge);
    const buyPriceData = timestepData.map(d => d.buyPrice * 100);  // Convert to €ct/kWh
    const sellPriceData = timestepData.map(d => d.sellPrice * 100);

    // Check if prices differ (saldering vs non-saldering)
    const pricesAreDifferent = timestepData.some(d =>
        Math.abs(d.buyPrice - d.sellPrice) > 0.0001
    );

    // Create chart
    timestepChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'SoC (%)',
                    data: socData,
                    borderColor: 'rgba(59, 130, 246, 1)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    yAxisID: 'ySoc',
                    tension: 0.1,
                    fill: true
                },
                {
                    label: 'Grid Import (kWh)',
                    data: gridImportData,
                    borderColor: 'rgba(220, 38, 38, 1)',
                    backgroundColor: 'rgba(220, 38, 38, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 3
                },
                {
                    label: 'Grid Export (kWh)',
                    data: gridExportData,
                    borderColor: 'rgba(16, 185, 129, 1)',
                    backgroundColor: 'rgba(16, 185, 129, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 3
                },
                {
                    label: 'Bat. Charge (kWh)',
                    data: batteryChargeData,
                    borderColor: 'rgba(139, 92, 246, 1)',
                    backgroundColor: 'rgba(139, 92, 246, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 2
                },
                {
                    label: 'Bat. Discharge (kWh)',
                    data: batteryDischargeData,
                    borderColor: 'rgba(245, 158, 11, 1)',
                    backgroundColor: 'rgba(245, 158, 11, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 2
                },
                {
                    label: pricesAreDifferent ? 'Inkoop (€ct/kWh)' : 'Prijs (€ct/kWh)',
                    data: buyPriceData,
                    borderColor: 'rgba(107, 114, 128, 1)',
                    backgroundColor: 'rgba(107, 114, 128, 0.05)',
                    borderWidth: 2,
                    yAxisID: 'yPrice',
                    tension: 0.1,
                    fill: pricesAreDifferent,
                    order: 1
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
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';

                            const value = Math.abs(context.parsed.y);
                            if (context.dataset.yAxisID === 'ySoc') {
                                label += value.toFixed(1) + '%';
                            } else if (context.dataset.yAxisID === 'yEnergy') {
                                label += value.toFixed(2) + ' kWh';
                            } else if (context.dataset.yAxisID === 'yPrice') {
                                label += value.toFixed(2) + ' €ct/kWh';
                            }

                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: isQuarterly ? 'Tijd (kwartier)' : 'Tijd (uur)'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: isQuarterly ? 24 : 24
                    }
                },
                ySoc: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'SoC (%)'
                    },
                    min: 0,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                },
                yEnergy: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Energie (kWh)'
                    },
                    ticks: {
                        callback: function(value) {
                            return Math.abs(value).toFixed(1) + ' kWh';
                        }
                    }
                },
                yPrice: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Prijs (€ct/kWh)'
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(1) + ' ct';
                        }
                    }
                }
            }
        }
    });

    // Add sell price line if different from buy price
    if (pricesAreDifferent) {
        timestepChart.data.datasets.push({
            label: 'Teruglevering (€ct/kWh)',
            data: sellPriceData,
            borderColor: 'rgba(156, 163, 175, 1)',
            backgroundColor: 'rgba(156, 163, 175, 0.05)',
            borderWidth: 2,
            borderDash: [5, 5],
            yAxisID: 'yPrice',
            tension: 0.1,
            fill: '-1',
            order: 1
        });
        timestepChart.update();
    }
}

// Setup close button event listener
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('closeDetail');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeDetailView);
    }
});
