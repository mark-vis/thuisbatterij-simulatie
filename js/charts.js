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
