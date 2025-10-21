/**
 * Solar UI - Form handling and results display for solar simulation
 */

// Global state
let currentResults = null;
let costsComparisonChart = null;
let selfConsumptionChart = null;
let selfSufficiencyChart = null;
let energyFlowsChart = null;

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
 * Display simulation results
 */
function displayResults(results, year) {
    const resultsSection = document.getElementById('results');
    resultsSection.style.display = 'block';

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

    // Generate monthly summaries
    const simulator = new SolarSimulator(null, null, null, null, [], [], []);
    const noBatteryMonthly = simulator.getMonthlySummary(noBattery);
    const withBatteryMonthly = simulator.getMonthlySummary(withBattery);
    const fixedContractMonthly = simulator.getMonthlySummary(fixedContract);
    const fixedWithBatteryMonthly = simulator.getMonthlySummary(fixedWithBattery);

    // Fill tables
    fillScenariosComparisonTable(fixedContract, fixedWithBattery, noBattery, withBattery);
    fillSavingsDetailTable(fixedContract, fixedWithBattery, noBattery, withBattery);

    // Create charts
    createCostsComparisonChart(noBatteryMonthly, withBatteryMonthly, fixedContractMonthly, fixedWithBatteryMonthly);
    createSelfConsumptionChart(noBatteryMonthly, withBatteryMonthly);
    createSelfSufficiencyChart(noBatteryMonthly, withBatteryMonthly);
    createEnergyFlowsChart(withBatteryMonthly);

    // Fill monthly table
    fillMonthlyTable(withBatteryMonthly);

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
 * Fill monthly table
 */
function fillMonthlyTable(withBatteryMonthly) {
    const tbody = document.getElementById('monthlyTableBody');
    tbody.innerHTML = '';

    for (const month of withBatteryMonthly) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${month.monthName}</td>
            <td class="${month.cost >= 0 ? 'profit-negative' : 'profit-positive'}">€${month.cost.toFixed(2)}</td>
            <td>${month.consumption.toFixed(1)}</td>
            <td>${month.solar.toFixed(1)}</td>
            <td>${month.selfConsumptionPct.toFixed(1)}%</td>
            <td>${month.selfSufficiencyPct.toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    }
}
