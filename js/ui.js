/**
 * UI Logic - handles form submission, data loading, and result display
 */

// Global state
let currentResults = null;
let currentMonthlySummary = null;
let currentSimulationHistory = null;  // Full timestep-by-timestep history
let currentSimulator = null;  // Reference to simulator for aggregation functions

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('simulationForm');
    form.addEventListener('submit', handleFormSubmit);

    const exportButton = document.getElementById('exportCsvButton');
    exportButton.addEventListener('click', exportToCsv);

    const shareButton = document.getElementById('shareUrlButton');
    shareButton.addEventListener('click', copyShareUrl);

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

    // Load parameters from URL if present
    const hasParams = loadParametersFromUrl();

    // Auto-run simulation if URL has parameters
    if (hasParams) {
        // Small delay to ensure form is fully populated
        setTimeout(() => {
            form.requestSubmit();
        }, 100);
    }
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
            if (priceMode === 'standard-saldering') {
                // Met salderen: zelfde prijs voor inkoop en teruglevering
                priceConfig = {
                    buyFormula: (epex) => ((epex + 101.54) * 1.21 + 24.8) / 1000,
                    sellFormula: (epex) => ((epex + 101.54) * 1.21 + 24.8) / 1000
                };
            } else if (priceMode === 'standard-no-saldering') {
                // Zonder salderen: teruglevering alleen EPEX + inkoopvergoeding (zonder BTW)
                priceConfig = {
                    buyFormula: (epex) => ((epex + 101.54) * 1.21 + 24.8) / 1000,
                    sellFormula: (epex) => (epex + 24.8 / 1.21) / 1000
                };
            } else {
                // Bare mode
                priceConfig = {
                    buyFormula: (epex) => epex / 1000,
                    sellFormula: (epex) => epex / 1000
                };
            }
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
        currentSimulationHistory = results;  // Full history for drill-down
        currentSimulator = simulator;  // Keep reference for aggregation

        // Display results
        updateProgress(100, 'Gereed!');
        await new Promise(resolve => setTimeout(resolve, 500));
        hideProgress();
        displayResults(totals, monthlySummary);

        // Update URL with parameters for sharing
        updateUrlWithParameters();

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
        row.className = 'clickable-row';
        row.dataset.month = month.monthName;
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
        row.onclick = () => showMonthDetail(month.monthName);
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
    const headers = ['Maand', 'Winst (EUR)', 'Cycli', 'Winst per cyclus (EUR)', 'Laad Periodes', 'Ontlaad Periodes'];
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

/**
 * Show month detail (daily view)
 */
function showMonthDetail(monthKey) {
    if (!currentSimulator) {
        return;
    }

    // Get daily summary for this month
    const dailySummary = currentSimulator.getDailySummary(monthKey);

    // Show detail view
    document.getElementById('results').style.display = 'none';
    document.getElementById('detailView').style.display = 'block';
    document.getElementById('detailTitle').textContent = `Details voor ${monthKey}`;
    document.getElementById('dailyView').style.display = 'block';
    document.getElementById('timestepView').style.display = 'none';
    document.getElementById('dayNavigation').style.display = 'none';
    document.getElementById('monthNavigation').style.display = 'flex';

    // Populate daily table
    const tableBody = document.getElementById('dailyTableBody');
    tableBody.innerHTML = '';

    for (const day of dailySummary) {
        const row = document.createElement('tr');
        row.className = 'clickable-row';
        row.innerHTML = `
            <td>${day.date}</td>
            <td class="${day.profitEur >= 0 ? 'profit-positive' : 'profit-negative'}">
                €${day.profitEur.toFixed(2)}
            </td>
            <td>${day.cycles.toFixed(2)}</td>
            <td>€${day.avgPrice.toFixed(4)}</td>
            <td>${day.minSoc.toFixed(0)}% - ${day.maxSoc.toFixed(0)}%</td>
        `;
        row.addEventListener('click', () => showDayDetail(day.date));
        tableBody.appendChild(row);
    }

    // Setup month navigation buttons
    const currentIndex = currentMonthlySummary.findIndex(m => m.monthName === monthKey);
    const prevMonthBtn = document.getElementById('prevMonth');
    const nextMonthBtn = document.getElementById('nextMonth');

    if (currentIndex > 0) {
        prevMonthBtn.disabled = false;
        prevMonthBtn.onclick = () => showMonthDetail(currentMonthlySummary[currentIndex - 1].monthName);
    } else {
        prevMonthBtn.disabled = true;
    }

    if (currentIndex < currentMonthlySummary.length - 1) {
        nextMonthBtn.disabled = false;
        nextMonthBtn.onclick = () => showMonthDetail(currentMonthlySummary[currentIndex + 1].monthName);
    } else {
        nextMonthBtn.disabled = true;
    }

    // Setup back button
    document.getElementById('closeDetail').onclick = closeDetailView;
}

/**
 * Show day detail (timestep view)
 */
function showDayDetail(dateKey) {
    if (!currentSimulator) {
        return;
    }

    // Get timestep summary for this day
    const timestepData = currentSimulator.getTimestepSummary(dateKey);

    // Show timestep view
    document.getElementById('detailTitle').textContent = `Details voor ${dateKey}`;
    document.getElementById('dailyView').style.display = 'none';
    document.getElementById('timestepView').style.display = 'block';

    // Show day navigation, hide month navigation
    document.getElementById('dayNavigation').style.display = 'flex';
    document.getElementById('monthNavigation').style.display = 'none';

    // Create chart
    createTimestepChart(timestepData);

    // Setup navigation buttons - use ALL days from entire simulation
    const monthKey = dateKey.substring(0, 7);  // Extract "2024-10" from "2024-10-15"

    // Get all days from all months
    const allDays = [];
    for (const month of currentMonthlySummary) {
        const monthDays = currentSimulator.getDailySummary(month.monthName);
        allDays.push(...monthDays);
    }

    const currentIndex = allDays.findIndex(d => d.date === dateKey);

    const prevDayBtn = document.getElementById('prevDay');
    const nextDayBtn = document.getElementById('nextDay');
    const prevWeekBtn = document.getElementById('prevWeek');
    const nextWeekBtn = document.getElementById('nextWeek');
    const prevMonthDayBtn = document.getElementById('prevMonthDay');
    const nextMonthDayBtn = document.getElementById('nextMonthDay');

    // Previous day
    if (currentIndex > 0) {
        prevDayBtn.disabled = false;
        prevDayBtn.onclick = () => showDayDetail(allDays[currentIndex - 1].date);
    } else {
        prevDayBtn.disabled = true;
    }

    // Next day
    if (currentIndex < allDays.length - 1) {
        nextDayBtn.disabled = false;
        nextDayBtn.onclick = () => showDayDetail(allDays[currentIndex + 1].date);
    } else {
        nextDayBtn.disabled = true;
    }

    // Previous week (7 days)
    if (currentIndex >= 7) {
        prevWeekBtn.disabled = false;
        prevWeekBtn.onclick = () => showDayDetail(allDays[currentIndex - 7].date);
    } else {
        prevWeekBtn.disabled = true;
    }

    // Next week (7 days)
    if (currentIndex + 7 < allDays.length) {
        nextWeekBtn.disabled = false;
        nextWeekBtn.onclick = () => showDayDetail(allDays[currentIndex + 7].date);
    } else {
        nextWeekBtn.disabled = true;
    }

    // Previous month (~30 days)
    if (currentIndex >= 30) {
        prevMonthDayBtn.disabled = false;
        prevMonthDayBtn.onclick = () => showDayDetail(allDays[currentIndex - 30].date);
    } else {
        prevMonthDayBtn.disabled = true;
    }

    // Next month (~30 days)
    if (currentIndex + 30 < allDays.length) {
        nextMonthDayBtn.disabled = false;
        nextMonthDayBtn.onclick = () => showDayDetail(allDays[currentIndex + 30].date);
    } else {
        nextMonthDayBtn.disabled = true;
    }

    // Update back button to go back to daily view
    document.getElementById('closeDetail').onclick = () => showMonthDetail(monthKey);
}

/**
 * Close detail view and return to main results
 */
function closeDetailView() {
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('results').style.display = 'block';
}

/**
 * Load parameters from URL query string
 * @returns {boolean} True if parameters were loaded
 */
function loadParametersFromUrl() {
    const params = new URLSearchParams(window.location.search);

    if (params.size === 0) return false;

    // Load all form fields from URL
    const fields = [
        'year', 'capacity', 'chargePower', 'dischargePower',
        'chargeEff', 'dischargeEff', 'minSoc', 'maxSoc', 'initialSoc'
    ];

    fields.forEach(field => {
        if (params.has(field)) {
            const element = document.getElementById(field);
            if (element) {
                element.value = params.get(field);
            }
        }
    });

    // Load price mode
    if (params.has('priceMode')) {
        const priceMode = params.get('priceMode');
        const radio = document.querySelector(`input[name="priceMode"][value="${priceMode}"]`);
        if (radio) {
            radio.checked = true;

            // Show custom inputs if custom mode
            if (priceMode === 'custom') {
                document.getElementById('customFormulaInputs').style.display = 'block';
            }
        }
    }

    // Load custom formulas if present
    if (params.has('customBuy')) {
        document.getElementById('customBuyFormula').value = decodeURIComponent(params.get('customBuy'));
    }
    if (params.has('customSell')) {
        document.getElementById('customSellFormula').value = decodeURIComponent(params.get('customSell'));
    }

    return true;
}

/**
 * Update URL with current parameters (called after form submission)
 */
function updateUrlWithParameters() {
    const params = new URLSearchParams();

    // Add all form fields
    params.set('year', document.getElementById('year').value);
    params.set('capacity', document.getElementById('capacity').value);
    params.set('chargePower', document.getElementById('chargePower').value);
    params.set('dischargePower', document.getElementById('dischargePower').value);
    params.set('chargeEff', document.getElementById('chargeEff').value);
    params.set('dischargeEff', document.getElementById('dischargeEff').value);
    params.set('minSoc', document.getElementById('minSoc').value);
    params.set('maxSoc', document.getElementById('maxSoc').value);
    params.set('initialSoc', document.getElementById('initialSoc').value);

    // Add price mode
    const priceMode = document.querySelector('input[name="priceMode"]:checked').value;
    params.set('priceMode', priceMode);

    // Add custom formulas if custom mode
    if (priceMode === 'custom') {
        const customBuy = document.getElementById('customBuyFormula').value;
        const customSell = document.getElementById('customSellFormula').value;
        if (customBuy) params.set('customBuy', encodeURIComponent(customBuy));
        if (customSell) params.set('customSell', encodeURIComponent(customSell));
    }

    // Update URL without reloading page
    const newUrl = window.location.pathname + '?' + params.toString();
    window.history.replaceState({}, '', newUrl);
}

/**
 * Copy share URL to clipboard
 */
function copyShareUrl() {
    const url = window.location.href;

    navigator.clipboard.writeText(url).then(() => {
        // Visual feedback
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
