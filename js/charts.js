/**
 * Charts - Chart.js visualizations for simulation results
 */

// Global chart instances
let profitChart = null;
let cyclesChart = null;
let profitPerCycleChart = null;

/**
 * Update all charts with new data
 */
function updateCharts(monthlySummary) {
    // Destroy existing charts
    if (profitChart) profitChart.destroy();
    if (cyclesChart) cyclesChart.destroy();
    if (profitPerCycleChart) profitPerCycleChart.destroy();

    // Extract data
    const labels = monthlySummary.map(m => m.monthName);
    const profits = monthlySummary.map(m => m.profitEur);
    const cycles = monthlySummary.map(m => m.cycles);
    const profitPerCycle = monthlySummary.map(m => m.profitPerCycle);

    // Create charts
    profitChart = createProfitChart(labels, profits);
    cyclesChart = createCyclesChart(labels, cycles);
    profitPerCycleChart = createProfitPerCycleChart(labels, profitPerCycle);
}

/**
 * Create profit bar chart
 */
function createProfitChart(labels, data) {
    const ctx = document.getElementById('profitChart').getContext('2d');

    // Color bars green for positive, red for negative
    const backgroundColors = data.map(v => v >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)');
    const borderColors = data.map(v => v >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)');

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Winst (€)',
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return '€' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
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
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

/**
 * Create cycles bar chart
 */
function createCyclesChart(labels, data) {
    const ctx = document.getElementById('cyclesChart').getContext('2d');

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Cycles',
                data: data,
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.parsed.y.toFixed(2) + ' cycles';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

/**
 * Create profit per cycle line chart
 */
function createProfitPerCycleChart(labels, data) {
    const ctx = document.getElementById('profitPerCycleChart').getContext('2d');

    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Winst per Cycle (€)',
                data: data,
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 2,
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return '€' + context.parsed.y.toFixed(2) + ' per cycle';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    },
                    ticks: {
                        callback: function(value) {
                            return '€' + value.toFixed(2);
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Global timestep chart instance
let timestepChart = null;

/**
 * Create timestep detail chart (combined SoC + profit + price)
 */
function createTimestepChart(timestepData) {
    // Destroy existing chart
    if (timestepChart) {
        timestepChart.destroy();
    }

    const ctx = document.getElementById('timestepChart').getContext('2d');

    // Prepare data - handle DST duplicates
    const labels = timestepData.map((d, i) => {
        const date = new Date(d.timestamp);
        const timeStr = date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

        // Check if this is a duplicate time (DST transition)
        // Look ahead to see if next entry has same time string
        if (i < timestepData.length - 1) {
            const nextDate = new Date(timestepData[i + 1].timestamp);
            const nextTimeStr = nextDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

            if (timeStr === nextTimeStr) {
                // First occurrence - add CEST indicator
                return `${timeStr} (zomertijd)`;
            }
        }

        // Check if this is second occurrence of duplicate
        if (i > 0) {
            const prevDate = new Date(timestepData[i - 1].timestamp);
            const prevTimeStr = prevDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

            if (timeStr === prevTimeStr) {
                // Second occurrence - add CET indicator
                return `${timeStr} (wintertijd)`;
            }
        }

        return timeStr;
    });

    // Detect resolution (quarterly if we have 96+ datapoints for one day)
    const isQuarterly = timestepData.length >= 96;
    const socData = timestepData.map(d => d.socPct);
    const profitData = timestepData.map(d => d.profitEur);
    const buyPriceData = timestepData.map(d => d.buyPriceEurKwh * 100);  // Convert to cents (EUR/kWh * 100)
    const sellPriceData = timestepData.map(d => d.sellPriceEurKwh * 100);  // Convert to cents (EUR/kWh * 100)

    // Check if buy and sell prices are different
    const pricesAreDifferent = timestepData.some((d, i) =>
        Math.abs(d.buyPriceEurKwh - d.sellPriceEurKwh) > 0.0001
    );

    // Background colors based on action (reversed: charge=red, discharge=green)
    const actionColors = timestepData.map(d => {
        if (d.action === 'charge') return 'rgba(255, 99, 132, 0.6)';  // Red for buying
        if (d.action === 'discharge') return 'rgba(75, 192, 192, 0.6)';  // Green for selling
        return 'rgba(200, 200, 200, 0.3)';
    });

    // Build datasets
    const datasets = [
        {
            label: 'SoC (%)',
            data: socData,
            type: 'line',
            borderColor: 'rgba(54, 162, 235, 1)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.1,
            yAxisID: 'y',
            order: 1
        },
        {
            label: 'Inkoopprijs (ct/kWh)',
            data: buyPriceData,
            type: 'line',
            borderColor: 'rgba(255, 99, 132, 1)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            borderWidth: 2,
            borderDash: pricesAreDifferent ? [] : [5, 5],
            fill: false,
            tension: 0.1,
            yAxisID: 'y1',
            order: 2
        }
    ];

    // Add sell price line if different from buy price
    if (pricesAreDifferent) {
        datasets.push({
            label: 'Verkoopprijs (ct/kWh)',
            data: sellPriceData,
            type: 'line',
            borderColor: 'rgba(75, 192, 192, 1)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            yAxisID: 'y1',
            order: 2
        });
    }

    datasets.push({
        label: 'Winst (€)',
        data: profitData,
        backgroundColor: actionColors,
        borderColor: actionColors.map(c => c.replace('0.6', '1')),
        borderWidth: 1,
        yAxisID: 'y2',
        order: 3
    });

    timestepChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
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
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (label === 'SoC (%)') {
                                return `${label}: ${value.toFixed(1)}%`;
                            } else if (label.includes('prijs')) {
                                return `${label}: ${value.toFixed(2)}ct`;
                            } else if (label === 'Winst (€)') {
                                return `${label}: €${value.toFixed(3)}`;
                            }
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'SoC (%)'
                    },
                    min: 0,
                    max: 100,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Prijs (ct/kWh)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Winst (€)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: isQuarterly ? 24 : 24
                    }
                }
            }
        }
    });
}
