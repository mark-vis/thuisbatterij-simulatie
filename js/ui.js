/**
 * UI Logic - handles form submission, data loading, and result display
 */

// Global state
let currentResults = null;
let currentMonthlySummary = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('simulationForm');
    form.addEventListener('submit', handleFormSubmit);

    const exportButton = document.getElementById('exportCsvButton');
    exportButton.addEventListener('click', exportToCsv);

    // Handle custom formula toggle
    const priceModeRadios = document.querySelectorAll('input[name="priceMode"]');
    priceModeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const customInputs = document.getElementById('customFormulaInputs');
            if (radio.value === 'custom') {
                customInputs.style.display = 'block';
            } else {
                customInputs.style.display = 'none';
            }
        });
    });

    // Auto-calculate power based on capacity (0.25C)
    const capacityInput = document.getElementById('capacity');
    const chargePowerInput = document.getElementById('chargePower');
    const dischargePowerInput = document.getElementById('dischargePower');

    capacityInput.addEventListener('input', () => {
        const capacity = parseFloat(capacityInput.value);
        if (!isNaN(capacity) && capacity > 0) {
            const power = Math.round(capacity * 0.25 * 10) / 10; // 0.25C, round to 1 decimal
            chargePowerInput.value = power;
            dischargePowerInput.value = power;
        }
    });
});

/**
 * Handle form submission
 */
async function handleFormSubmit(event) {
    event.preventDefault();

    // Get form values (replace comma with dot for Dutch locale)
    const year = parseInt(document.getElementById('year').value);
    const capacity = parseFloat(document.getElementById('capacity').value.replace(',', '.'));
    const chargePower = parseFloat(document.getElementById('chargePower').value.replace(',', '.'));
    const dischargePower = parseFloat(document.getElementById('dischargePower').value.replace(',', '.'));
    const chargeEff = parseFloat(document.getElementById('chargeEff').value.replace(',', '.')) / 100;
    const dischargeEff = parseFloat(document.getElementById('dischargeEff').value.replace(',', '.')) / 100;
    const minSoc = parseFloat(document.getElementById('minSoc').value.replace(',', '.')) / 100;
    const maxSoc = parseFloat(document.getElementById('maxSoc').value.replace(',', '.')) / 100;
    const initialSoc = parseFloat(document.getElementById('initialSoc').value.replace(',', '.')) / 100;

    const priceMode = document.querySelector('input[name="priceMode"]:checked').value;

    // Validate
    if (minSoc >= maxSoc) {
        alert('Min SoC moet kleiner zijn dan Max SoC');
        return;
    }

    // Show progress
    showProgress();

    try {
        // Load price data
        updateProgress(10, `Laden prijsdata ${year}...`);
        const pricesData = await loadPriceData(year);

        // Create configurations
        const batteryConfig = {
            capacityKwh: capacity,
            chargePowerKw: chargePower,
            dischargePowerKw: dischargePower,
            chargeEfficiency: chargeEff,
            dischargeEfficiency: dischargeEff,
            minSocPct: minSoc,
            maxSocPct: maxSoc
        };

        let priceConfig;
        if (priceMode === 'custom') {
            // Custom formulas
            const customBuyStr = document.getElementById('customBuyFormula').value.trim();
            const customSellStr = document.getElementById('customSellFormula').value.trim();

            if (!customBuyStr || !customSellStr) {
                alert('Vul beide formules in voor geavanceerde modus');
                return;
            }

            try {
                // Parse custom formulas (should be in format: epex => expression)
                // User formula expects EUR/kWh input and returns EUR/kWh
                // We need to convert: EPEX data is in EUR/MWh
                const buyFormulaRaw = eval(`(${customBuyStr})`);
                const sellFormulaRaw = eval(`(${customSellStr})`);

                // Test formulas with EUR/kWh input
                if (typeof buyFormulaRaw(0.1) !== 'number' || typeof sellFormulaRaw(0.1) !== 'number') {
                    throw new Error('Formule moet een getal teruggeven');
                }

                // Wrap: convert EPEX (EUR/MWh) to EUR/kWh for user formula, result is already EUR/kWh
                priceConfig = {
                    buyFormula: (epex) => buyFormulaRaw(epex / 1000),
                    sellFormula: (epex) => sellFormulaRaw(epex / 1000)
                };
            } catch (error) {
                alert(`Fout in formule: ${error.message}\nVoorbeeld: epex => (epex + 0.10154) * 1.21 + 0.0248`);
                return;
            }
        } else {
            // Standard or bare mode
            // Formulas work in EUR/MWh internally, convert to EUR/kWh
            priceConfig = {
                buyFormula: priceMode === 'standard'
                    ? (epex) => ((epex + 101.54) * 1.21 + 24.8) / 1000
                    : (epex) => epex / 1000,  // bare mode
                sellFormula: priceMode === 'standard'
                    ? (epex) => ((epex + 101.54) * 1.21 + 24.8) / 1000  // SALDERING: zelfde als buy
                    : (epex) => epex / 1000  // bare mode
            };
        }

        const simulationConfig = {
            initialSocPct: initialSoc
        };

        // Create simulator
        updateProgress(20, 'Initialiseren simulator...');
        const simulator = new BatterySimulator(
            batteryConfig,
            priceConfig,
            simulationConfig,
            pricesData
        );

        // Run simulation with progress callback
        const results = await simulator.simulate((progress, message) => {
            updateProgress(20 + (progress * 0.7), message);
        });

        // Calculate monthly summary
        updateProgress(95, 'Berekenen maandelijks overzicht...');
        const monthlySummary = simulator.getMonthlySummary(results);
        const totals = simulator.getTotals(monthlySummary);

        // Store results
        currentResults = results;
        currentMonthlySummary = monthlySummary;

        // Display results
        updateProgress(100, 'Gereed!');
        await new Promise(resolve => setTimeout(resolve, 500));
        hideProgress();
        displayResults(totals, monthlySummary);

    } catch (error) {
        hideProgress();
        alert(`Fout tijdens simulatie: ${error.message}`);
        console.error(error);
    }
}

/**
 * Load price data from JSON file
 */
async function loadPriceData(year) {
    const response = await fetch(`data/prices_${year}.json`);
    if (!response.ok) {
        throw new Error(`Kan prijsdata voor ${year} niet laden`);
    }
    const data = await response.json();
    return data.prices;
}

/**
 * Show progress bar
 */
function showProgress() {
    document.getElementById('progress').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    document.getElementById('runButton').disabled = true;
}

/**
 * Hide progress bar
 */
function hideProgress() {
    document.getElementById('progress').style.display = 'none';
    document.getElementById('runButton').disabled = false;
}

/**
 * Update progress bar
 */
function updateProgress(percent, message) {
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = message;
}

/**
 * Display simulation results
 */
function displayResults(totals, monthlySummary) {
    // Show results section
    document.getElementById('results').style.display = 'block';

    // Update totals
    document.getElementById('totalProfit').textContent = `€${totals.totalProfit.toFixed(2)}`;
    document.getElementById('totalCycles').textContent = totals.totalCycles.toFixed(1);
    document.getElementById('avgProfitPerCycle').textContent = `€${totals.avgProfitPerCycle.toFixed(2)}`;

    // Update table
    const tableBody = document.getElementById('monthlyTableBody');
    tableBody.innerHTML = '';

    for (const month of monthlySummary) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${month.monthName}</td>
            <td class="${month.profitEur >= 0 ? 'profit-positive' : 'profit-negative'}">
                €${month.profitEur.toFixed(2)}
            </td>
            <td>${month.cycles.toFixed(2)}</td>
            <td>€${month.profitPerCycle.toFixed(2)}</td>
            <td>${month.chargePeriods}</td>
            <td>${month.dischargePeriods}</td>
        `;
        tableBody.appendChild(row);
    }

    // Update charts
    updateCharts(monthlySummary);

    // Scroll to results
    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
}

/**
 * Export results to CSV
 */
function exportToCsv() {
    if (!currentMonthlySummary) {
        alert('Geen resultaten om te exporteren');
        return;
    }

    // Create CSV content
    const headers = ['Maand', 'Winst (EUR)', 'Cycles', 'Winst per Cycle (EUR)', 'Laad Periodes', 'Ontlaad Periodes'];
    const rows = currentMonthlySummary.map(m => [
        m.monthName,
        m.profitEur.toFixed(2),
        m.cycles.toFixed(2),
        m.profitPerCycle.toFixed(2),
        m.chargePeriods,
        m.dischargePeriods
    ]);

    let csvContent = headers.join(',') + '\n';
    for (const row of rows) {
        csvContent += row.join(',') + '\n';
    }

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    const year = document.getElementById('year').value;
    link.setAttribute('href', url);
    link.setAttribute('download', `batterij_simulatie_${year}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
