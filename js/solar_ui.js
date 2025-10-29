/**
 * Solar UI - Form handling and results display for solar simulation
 */

// Global state
let currentResults = null;
let currentSimulator = null;  // For drill-down navigation
let currentMonthlySummaries = null;  // For drill-down navigation
let costsComparisonChart = null;
let selfConsumptionChart = null;
let selfSufficiencyChart = null;
let energyFlowsChart = null;
let gridFlowsChart = null;
let timestepChart = null;  // For drill-down timestep chart

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
    // Load HiGHS solver
    await loadHighsSolver();

    // Attach form handler
    const form = document.getElementById('solarSimulationForm');
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

    // Share URL functionality
    const shareButton = document.getElementById('shareUrlButton');
    if (shareButton) {
        shareButton.addEventListener('click', copyShareUrl);
    }

    // Negative price warning
    const fixedSellPriceInput = document.getElementById('fixedSellPrice');
    const negativePriceWarning = document.getElementById('negativePriceWarning');
    if (fixedSellPriceInput && negativePriceWarning) {
        fixedSellPriceInput.addEventListener('input', () => {
            const value = parseFloat(fixedSellPriceInput.value);
            if (value < 0) {
                negativePriceWarning.style.display = 'block';
            } else {
                negativePriceWarning.style.display = 'none';
            }
        });
    }

    // Close detail view button
    const closeDetailBtn = document.getElementById('closeDetail');
    if (closeDetailBtn) {
        closeDetailBtn.addEventListener('click', closeDetailView);
    }

    // Load parameters from URL and auto-run if present
    const hasParams = loadParametersFromUrl();
    if (hasParams) {
        setTimeout(() => {
            form.requestSubmit();
        }, 100);
    }
});

/**
 * Handle form submission
 */
async function handleFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);

    // Get form values
    const year = parseInt(formData.get('year'));
    const consumptionProfile = formData.get('consumptionProfile');
    const solarProfile = formData.get('solarProfile');
    const capacity = parseFloat(formData.get('capacity'));
    const initialSoc = parseFloat(formData.get('initialSoc'));
    const chargePower = parseFloat(formData.get('chargePower'));
    const dischargePower = parseFloat(formData.get('dischargePower'));
    const chargeEff = parseFloat(formData.get('chargeEff')) / 100;
    const dischargeEff = parseFloat(formData.get('dischargeEff')) / 100;
    const minSoc = parseFloat(formData.get('minSoc'));
    const maxSoc = parseFloat(formData.get('maxSoc'));
    const priceMode = formData.get('priceMode');
    const fixedBuyPrice = parseFloat(formData.get('fixedBuyPrice'));
    const fixedSellPrice = parseFloat(formData.get('fixedSellPrice'));

    // Disable form
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;

    // Show progress
    const progressContainer = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    progressContainer.style.display = 'block';

    try {
        // Load data
        progressText.textContent = 'Data laden...';
        progressBar.style.width = '10%';

        const [pricesData, consumptionData, solarData] = await Promise.all([
            loadPriceData(year),
            loadConsumptionData(year, consumptionProfile),
            loadSolarData(year, solarProfile)
        ]);

        // Build configurations
        const batteryConfig = {
            capacityKwh: capacity,
            chargePowerKw: chargePower,
            dischargePowerKw: dischargePower,
            chargeEfficiency: chargeEff,
            dischargeEfficiency: dischargeEff,
            minSocPct: minSoc / 100,
            maxSocPct: maxSoc / 100
        };

        const priceConfig = buildPriceConfig(priceMode, formData);

        const fixedPriceConfig = {
            buy: fixedBuyPrice,
            sell: fixedSellPrice
        };

        const simulationConfig = {
            initialSocPct: initialSoc / 100
        };

        // Create simulator
        const simulator = new SolarSimulator(
            batteryConfig,
            priceConfig,
            fixedPriceConfig,
            simulationConfig,
            pricesData,
            consumptionData,
            solarData
        );

        // Run simulation
        const results = await simulator.simulateAll((progress, message) => {
            progressBar.style.width = progress + '%';
            progressText.textContent = message;
        });

        currentResults = results;

        // Hide progress
        progressContainer.style.display = 'none';

        // Display results
        displayResults(results, year);

    } catch (error) {
        console.error('Simulation error:', error);
        alert('Fout bij uitvoeren simulatie: ' + error.message);
        progressContainer.style.display = 'none';
    } finally {
        // Re-enable form
        submitButton.disabled = false;
    }
}

/**
 * Load price data
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
 * Load consumption data
 */
async function loadConsumptionData(year, profile) {
    const response = await fetch(`data/consumption_${year}_${profile}.json`);
    if (!response.ok) {
        throw new Error(`Kon verbruiksdata voor ${year} (${profile}) niet laden`);
    }
    const data = await response.json();
    return data.consumption;
}

/**
 * Load solar data
 */
async function loadSolarData(year, profile) {
    const response = await fetch(`data/solar_${year}_${profile}.json`);
    if (!response.ok) {
        throw new Error(`Kon PV-data voor ${year} (${profile}) niet laden`);
    }
    const data = await response.json();
    return data.solar;
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
function calculatePriceStatistics(noBat, withBat) {
    // Calculate weighted average buy price WITHOUT battery
    let totalImportEnergyNoBat = 0;
    let weightedBuyPriceNoBat = 0;

    for (const hour of noBat.history) {
        if (hour.gridImport > 0) {
            totalImportEnergyNoBat += hour.gridImport;
            weightedBuyPriceNoBat += hour.gridImport * hour.buyPrice;
        }
    }

    const avgBuyPriceNoBat = totalImportEnergyNoBat > 0 ? weightedBuyPriceNoBat / totalImportEnergyNoBat : 0;

    // Calculate weighted average buy price WITH battery
    let totalImportEnergyWithBat = 0;
    let weightedBuyPriceWithBat = 0;

    for (const hour of withBat.history) {
        if (hour.gridImport > 0) {
            totalImportEnergyWithBat += hour.gridImport;
            weightedBuyPriceWithBat += hour.gridImport * hour.buyPrice;
        }
    }

    const avgBuyPriceWithBat = totalImportEnergyWithBat > 0 ? weightedBuyPriceWithBat / totalImportEnergyWithBat : 0;

    // Calculate weighted average sell price WITHOUT battery
    let totalExportEnergyNoBat = 0;
    let weightedSellPriceNoBat = 0;

    for (const hour of noBat.history) {
        if (hour.gridExport > 0) {
            totalExportEnergyNoBat += hour.gridExport;
            weightedSellPriceNoBat += hour.gridExport * hour.sellPrice;
        }
    }

    const avgSellPriceNoBat = totalExportEnergyNoBat > 0 ? weightedSellPriceNoBat / totalExportEnergyNoBat : 0;

    // Calculate weighted average sell price WITH battery
    let totalExportEnergyWithBat = 0;
    let weightedSellPriceWithBat = 0;

    for (const hour of withBat.history) {
        if (hour.gridExport > 0) {
            totalExportEnergyWithBat += hour.gridExport;
            weightedSellPriceWithBat += hour.gridExport * hour.sellPrice;
        }
    }

    const avgSellPriceWithBat = totalExportEnergyWithBat > 0 ? weightedSellPriceWithBat / totalExportEnergyWithBat : 0;

    // Calculate export at negative sell prices (without battery)
    let exportAtNegPriceNoBat = 0;
    let exportCostAtNegPriceNoBat = 0;  // Cost = negative revenue
    for (const hour of noBat.history) {
        if (hour.sellPrice < 0 && hour.gridExport > 0) {
            exportAtNegPriceNoBat += hour.gridExport;
            exportCostAtNegPriceNoBat += hour.gridExport * hour.sellPrice;  // Negative price × positive export = negative value (cost)
        }
    }

    // Calculate export at negative sell prices (with battery)
    let exportAtNegPriceWithBat = 0;
    let exportCostAtNegPriceWithBat = 0;
    for (const hour of withBat.history) {
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
function displayResults(results, year) {
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

    // Store results for drill-down navigation
    currentResults = results;

    const noBattery = results.noBattery;
    const withBattery = results.withBattery;
    const fixedContract = results.fixedContract;
    const fixedWithBattery = results.fixedWithBattery;

    // Summary cards (3 grote tegels)
    document.getElementById('selfConsumption').textContent = withBattery.selfConsumptionPct.toFixed(1) + '%';
    document.getElementById('selfSufficiency').textContent = withBattery.selfSufficiencyPct.toFixed(1) + '%';

    // Besparing Totaal = vast zonder batterij → dynamisch met batterij
    const totalSavings = fixedContract.totalCost - withBattery.totalCost;
    document.getElementById('totalSavings').textContent = '€' + totalSavings.toFixed(2);

    // Populate battery cycle statistics
    document.getElementById('totalCycles').textContent = withBattery.cycles.toFixed(1);
    document.getElementById('savingsPerCycle').textContent = '€' + (totalSavings / withBattery.cycles).toFixed(2);

    // Populate grid import/export statistics (with battery as main value, without battery for comparison)
    document.getElementById('gridImport').textContent = withBattery.totalGridImport.toFixed(0) + ' kWh';
    document.getElementById('gridImportComparison').textContent = `zonder bat: ${noBattery.totalGridImport.toFixed(0)} kWh`;

    document.getElementById('gridExport').textContent = withBattery.totalGridExport.toFixed(0) + ' kWh';
    document.getElementById('gridExportComparison').textContent = `zonder bat: ${noBattery.totalGridExport.toFixed(0)} kWh`;

    // Calculate and populate price statistics
    const priceStats = calculatePriceStatistics(noBattery, withBattery);

    document.getElementById('avgBuyPrice').textContent = '€' + priceStats.avgBuyPriceWithBat.toFixed(3) + '/kWh';
    document.getElementById('avgBuyPriceComparison').textContent = `zonder bat: €${priceStats.avgBuyPriceNoBat.toFixed(3)}`;

    document.getElementById('avgSellPrice').textContent = '€' + priceStats.avgSellPriceWithBat.toFixed(3) + '/kWh';
    document.getElementById('avgSellPriceComparison').textContent = `zonder bat: €${priceStats.avgSellPriceNoBat.toFixed(3)}`;

    // Display export at negative prices (show both kWh and EUR cost)
    const costWithBat = Math.abs(priceStats.exportCostAtNegPriceWithBat);
    const costNoBat = Math.abs(priceStats.exportCostAtNegPriceNoBat);

    document.getElementById('exportAtNegPrice').textContent =
        `${priceStats.exportAtNegPriceWithBat.toFixed(0)} kWh / €${costWithBat.toFixed(2)}`;
    document.getElementById('exportAtNegPriceComparison').textContent =
        `zonder bat: ${priceStats.exportAtNegPriceNoBat.toFixed(0)} kWh / €${costNoBat.toFixed(2)}`;

    // Generate monthly summaries
    const simulator = new SolarSimulator(null, null, null, null, [], [], []);
    const noBatteryMonthly = simulator.getMonthlySummary(noBattery);
    const withBatteryMonthly = simulator.getMonthlySummary(withBattery);
    const fixedContractMonthly = simulator.getMonthlySummary(fixedContract);
    const fixedWithBatteryMonthly = simulator.getMonthlySummary(fixedWithBattery);

    // Store for drill-down navigation
    currentSimulator = simulator;
    currentMonthlySummaries = {
        noBattery: noBatteryMonthly,
        withBattery: withBatteryMonthly,
        fixedContract: fixedContractMonthly,
        fixedWithBattery: fixedWithBatteryMonthly
    };

    // Fill tables
    fillScenariosComparisonTable(fixedContract, fixedWithBattery, noBattery, withBattery);
    fillSavingsDetailTable(fixedContract, fixedWithBattery, noBattery, withBattery);

    // Create charts
    createCostsComparisonChart(noBatteryMonthly, withBatteryMonthly, fixedContractMonthly, fixedWithBatteryMonthly);
    createSelfConsumptionChart(noBatteryMonthly, withBatteryMonthly);
    createSelfSufficiencyChart(noBatteryMonthly, withBatteryMonthly);
    createEnergyFlowsChart(withBatteryMonthly);
    createGridFlowsChart(withBatteryMonthly);

    // Fill monthly table (now with drill-down functionality)
    fillMonthlyTable(withBatteryMonthly);

    // Update URL with parameters
    updateUrlWithParameters();

    // Scroll to results
    resultsSection.scrollIntoView({behavior: 'smooth'});
}

/**
 * Create costs comparison chart
 */
function createCostsComparisonChart(noBatteryMonthly, withBatteryMonthly, fixedContractMonthly, fixedWithBatteryMonthly) {
    // Destroy existing chart
    if (costsComparisonChart) {
        costsComparisonChart.destroy();
        costsComparisonChart = null;
    }

    const canvas = document.getElementById('costsComparisonChart');
    const ctx = canvas.getContext('2d');

    const labels = noBatteryMonthly.map(m => m.monthName);
    const noBatteryCosts = noBatteryMonthly.map(m => m.cost);
    const withBatteryCosts = withBatteryMonthly.map(m => m.cost);
    const fixedCosts = fixedContractMonthly.map(m => m.cost);
    const fixedWithBatteryCosts = fixedWithBatteryMonthly.map(m => m.cost);

    costsComparisonChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Dynamisch zonder batterij',
                    data: noBatteryCosts,
                    borderColor: 'rgba(220, 38, 38, 1)',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 2,
                    tension: 0.3
                },
                {
                    label: 'Dynamisch met batterij',
                    data: withBatteryCosts,
                    borderColor: 'rgba(16, 185, 129, 1)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.3
                },
                {
                    label: 'Vast contract',
                    data: fixedCosts,
                    borderColor: 'rgba(107, 114, 128, 1)',
                    backgroundColor: 'rgba(107, 114, 128, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    tension: 0.3
                },
                {
                    label: 'Vast + batterij',
                    data: fixedWithBatteryCosts,
                    borderColor: 'rgba(59, 130, 246, 1)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    borderDash: [3, 3],
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
 * Create self-consumption chart
 */
function createSelfConsumptionChart(noBatteryMonthly, withBatteryMonthly) {
    // Destroy existing chart
    if (selfConsumptionChart) {
        selfConsumptionChart.destroy();
        selfConsumptionChart = null;
    }

    const canvas = document.getElementById('selfConsumptionChart');
    const ctx = canvas.getContext('2d');

    const labels = noBatteryMonthly.map(m => m.monthName);
    const noBatteryData = noBatteryMonthly.map(m => m.selfConsumptionPct);
    const withBatteryData = withBatteryMonthly.map(m => m.selfConsumptionPct);

    selfConsumptionChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Zonder batterij',
                    data: noBatteryData,
                    backgroundColor: 'rgba(220, 38, 38, 0.6)',
                    borderColor: 'rgba(220, 38, 38, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Met batterij',
                    data: withBatteryData,
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
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Zelfverbruik (%)'
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
                        text: 'Maand'
                    }
                }
            }
        }
    });
}

/**
 * Create self-sufficiency chart
 */
function createSelfSufficiencyChart(noBatteryMonthly, withBatteryMonthly) {
    // Destroy existing chart
    if (selfSufficiencyChart) {
        selfSufficiencyChart.destroy();
        selfSufficiencyChart = null;
    }

    const canvas = document.getElementById('selfSufficiencyChart');
    const ctx = canvas.getContext('2d');

    const labels = noBatteryMonthly.map(m => m.monthName);
    const noBatteryData = noBatteryMonthly.map(m => m.selfSufficiencyPct);
    const withBatteryData = withBatteryMonthly.map(m => m.selfSufficiencyPct);

    selfSufficiencyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Zonder batterij',
                    data: noBatteryData,
                    backgroundColor: 'rgba(220, 38, 38, 0.6)',
                    borderColor: 'rgba(220, 38, 38, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Met batterij',
                    data: withBatteryData,
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
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Zelfvoorziening (%)'
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
                        text: 'Maand'
                    }
                }
            }
        }
    });
}

/**
 * Create energy flows chart (stacked bar)
 */
function createEnergyFlowsChart(withBatteryMonthly) {
    // Destroy existing chart
    if (energyFlowsChart) {
        energyFlowsChart.destroy();
        energyFlowsChart = null;
    }

    const canvas = document.getElementById('energyFlowsChart');
    const ctx = canvas.getContext('2d');

    const labels = withBatteryMonthly.map(m => m.monthName);
    const consumption = withBatteryMonthly.map(m => m.consumption);
    const solar = withBatteryMonthly.map(m => m.solar);
    const gridImport = withBatteryMonthly.map(m => m.gridImport);
    const gridExport = withBatteryMonthly.map(m => m.gridExport);

    energyFlowsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Verbruik',
                    data: consumption,
                    backgroundColor: 'rgba(239, 68, 68, 0.6)',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    borderWidth: 1
                },
                {
                    label: 'PV Opwek',
                    data: solar,
                    backgroundColor: 'rgba(251, 191, 36, 0.6)',
                    borderColor: 'rgba(251, 191, 36, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Inkoop Net',
                    data: gridImport,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Teruglevering',
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
                            return context.dataset.label + ': ' + context.parsed.y.toFixed(1) + ' kWh';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Energie (kWh)'
                    },
                    ticks: {
                        callback: function(value) {
                            return value.toFixed(0) + ' kWh';
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
 * Create grid flows chart (import/export per month)
 */
function createGridFlowsChart(withBatteryMonthly) {
    // Destroy existing chart
    if (gridFlowsChart) {
        gridFlowsChart.destroy();
        gridFlowsChart = null;
    }

    const canvas = document.getElementById('gridFlowsChart');
    const ctx = canvas.getContext('2d');

    const labels = withBatteryMonthly.map(m => m.monthName);
    const gridImport = withBatteryMonthly.map(m => m.gridImport);
    const gridExport = withBatteryMonthly.map(m => -m.gridExport);  // Negative for visualization

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
 * Fill scenarios comparison table
 */
function fillScenariosComparisonTable(fixedContract, fixedWithBattery, noBattery, withBattery) {
    const tbody = document.getElementById('scenariosTableBody');
    tbody.innerHTML = '';

    // Volgorde: vast zonder, vast met, dyn zonder, dyn met
    const scenarios = [
        {
            name: 'Vast zonder batterij',
            cost: fixedContract.totalCost,
            selfConsumption: fixedContract.selfConsumptionPct,
            selfSufficiency: fixedContract.selfSufficiencyPct
        },
        {
            name: 'Vast met batterij',
            cost: fixedWithBattery.totalCost,
            selfConsumption: fixedWithBattery.selfConsumptionPct,
            selfSufficiency: fixedWithBattery.selfSufficiencyPct
        },
        {
            name: 'Dynamisch zonder batterij',
            cost: noBattery.totalCost,
            selfConsumption: noBattery.selfConsumptionPct,
            selfSufficiency: noBattery.selfSufficiencyPct
        },
        {
            name: 'Dynamisch met batterij',
            cost: withBattery.totalCost,
            selfConsumption: withBattery.selfConsumptionPct,
            selfSufficiency: withBattery.selfSufficiencyPct
        }
    ];

    for (const scenario of scenarios) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${scenario.name}</td>
            <td class="${scenario.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${scenario.cost.toFixed(2)}</td>
            <td>${scenario.selfConsumption.toFixed(1)}%</td>
            <td>${scenario.selfSufficiency.toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    }
}

/**
 * Fill savings detail table
 */
function fillSavingsDetailTable(fixedContract, fixedWithBattery, noBattery, withBattery) {
    const tbody = document.getElementById('savingsTableBody');
    tbody.innerHTML = '';

    const savings = [
        {
            name: 'Effect batterij (vast)',
            amount: fixedContract.totalCost - fixedWithBattery.totalCost,
            description: 'Vast zonder → Vast met batterij'
        },
        {
            name: 'Effect dynamisch contract',
            amount: fixedContract.totalCost - noBattery.totalCost,
            description: 'Vast → Dynamisch zonder batterij'
        },
        {
            name: 'Effect batterij (dynamisch)',
            amount: noBattery.totalCost - withBattery.totalCost,
            description: 'Dyn. zonder → Dyn. met batterij'
        },
        {
            name: 'Totale besparing',
            amount: fixedContract.totalCost - withBattery.totalCost,
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
 * Fill monthly table (with drill-down functionality)
 */
function fillMonthlyTable(withBatteryMonthly) {
    const tbody = document.getElementById('monthlyTableBody');
    tbody.innerHTML = '';

    // Get fixedContract monthly for comparison
    const fixedContractMonthly = currentMonthlySummaries.fixedContract;

    for (let i = 0; i < withBatteryMonthly.length; i++) {
        const withBat = withBatteryMonthly[i];
        const fixedNoBat = fixedContractMonthly[i];

        // Calculate savings: vast zonder → dyn met batterij
        const savings = fixedNoBat.cost - withBat.cost;

        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.innerHTML = `
            <td>${withBat.monthName}</td>
            <td class="${withBat.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${withBat.cost.toFixed(2)}</td>
            <td class="${savings >= 0 ? 'profit-positive' : 'profit-negative'}">€${savings.toFixed(2)}</td>
            <td>${withBat.consumption.toFixed(1)}</td>
            <td>${withBat.solar.toFixed(1)}</td>
            <td>${withBat.gridImport.toFixed(0)}</td>
            <td>${withBat.gridExport.toFixed(0)}</td>
            <td>${withBat.selfConsumptionPct.toFixed(1)}%</td>
            <td>${withBat.selfSufficiencyPct.toFixed(1)}%</td>
        `;

        // Make row clickable to drill down to daily view
        const monthKey = `${withBat.year}-${String(withBat.month).padStart(2, '0')}`;
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
        currentResults.withBattery,
        currentResults.fixedContract
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
    const allMonths = currentMonthlySummaries.withBattery.map(m =>
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
        currentResults.withBattery
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
    for (const month of currentMonthlySummaries.withBattery) {
        const monthKey = `${month.year}-${String(month.month).padStart(2, '0')}`;
        const monthDays = currentSimulator.getDailySummary(
            monthKey,
            currentResults.withBattery,
            currentResults.fixedContract
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
    const consumptionData = timestepData.map(d => d.consumption);
    const solarData = timestepData.map(d => d.solar);
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
                    label: 'Verbruik (kWh)',
                    data: consumptionData,
                    borderColor: 'rgba(239, 68, 68, 1)',
                    backgroundColor: 'rgba(239, 68, 68, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 4
                },
                {
                    label: 'PV Opwek (kWh)',
                    data: solarData,
                    borderColor: 'rgba(251, 191, 36, 1)',
                    backgroundColor: 'rgba(251, 191, 36, 0.3)',
                    borderWidth: 1,
                    yAxisID: 'yEnergy',
                    type: 'bar',
                    order: 4
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

/**
 * Load simulation parameters from URL query string
 * Returns true if parameters were found and loaded
 */
function loadParametersFromUrl() {
    const params = new URLSearchParams(window.location.search);

    // If no parameters, return false
    if (params.size === 0) {
        return false;
    }

    // Load simple fields
    const fields = [
        'year', 'consumptionProfile', 'solarProfile',
        'capacity', 'initialSoc', 'chargePower', 'dischargePower',
        'chargeEff', 'dischargeEff', 'minSoc', 'maxSoc',
        'fixedBuyPrice', 'fixedSellPrice'
    ];

    fields.forEach(field => {
        if (params.has(field)) {
            const element = document.getElementById(field);
            if (element) {
                element.value = params.get(field);
            }
        }
    });

    // Load price mode (radio buttons)
    if (params.has('priceMode')) {
        const priceMode = params.get('priceMode');
        const radio = document.querySelector(`input[name="priceMode"][value="${priceMode}"]`);
        if (radio) {
            radio.checked = true;
            // Show custom formula inputs if custom mode
            if (priceMode === 'custom') {
                document.getElementById('customFormulaInputs').style.display = 'block';
            }
        }
    }

    // Load custom formulas (URL encoded)
    if (params.has('customBuy')) {
        document.getElementById('customBuyFormula').value = decodeURIComponent(params.get('customBuy'));
    }
    if (params.has('customSell')) {
        document.getElementById('customSellFormula').value = decodeURIComponent(params.get('customSell'));
    }

    return true;
}

/**
 * Update URL with current form parameters (without page reload)
 */
function updateUrlWithParameters() {
    const params = new URLSearchParams();

    // Add all simple fields
    params.set('year', document.getElementById('year').value);
    params.set('consumptionProfile', document.getElementById('consumptionProfile').value);
    params.set('solarProfile', document.getElementById('solarProfile').value);
    params.set('capacity', document.getElementById('capacity').value);
    params.set('initialSoc', document.getElementById('initialSoc').value);
    params.set('chargePower', document.getElementById('chargePower').value);
    params.set('dischargePower', document.getElementById('dischargePower').value);
    params.set('chargeEff', document.getElementById('chargeEff').value);
    params.set('dischargeEff', document.getElementById('dischargeEff').value);
    params.set('minSoc', document.getElementById('minSoc').value);
    params.set('maxSoc', document.getElementById('maxSoc').value);
    params.set('fixedBuyPrice', document.getElementById('fixedBuyPrice').value);
    params.set('fixedSellPrice', document.getElementById('fixedSellPrice').value);

    // Add price mode
    const priceMode = document.querySelector('input[name="priceMode"]:checked').value;
    params.set('priceMode', priceMode);

    // Add custom formulas if in custom mode
    if (priceMode === 'custom') {
        const customBuy = document.getElementById('customBuyFormula').value;
        const customSell = document.getElementById('customSellFormula').value;
        if (customBuy) {
            params.set('customBuy', encodeURIComponent(customBuy));
        }
        if (customSell) {
            params.set('customSell', encodeURIComponent(customSell));
        }
    }

    // Update URL without reloading the page
    const newUrl = window.location.pathname + '?' + params.toString();
    window.history.replaceState({}, '', newUrl);
}

/**
 * Copy current URL to clipboard
 */
function copyShareUrl() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
        const button = document.getElementById('shareUrlButton');
        const originalText = button.textContent;
        button.textContent = '✓ Gekopieerd!';
        button.style.backgroundColor = 'var(--secondary-color)';
        setTimeout(() => {
            button.textContent = originalText;
            button.style.backgroundColor = '';
        }, 2000);
    }).catch(err => {
        alert('Kon URL niet kopiëren: ' + err.message);
    });
}
