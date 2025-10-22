/**
 * P1 Parser - Parse and aggregate P1 meter data with intelligent interval detection
 */

class P1Parser {
    constructor() {
        this.rawData = null;
        this.detectedInterval = null;
        this.hourlyData = null;
        this.stats = null;
    }

    /**
     * Parse CSV string
     */
    parseCSV(csvString) {
        const lines = csvString.trim().split('\n');

        if (lines.length < 2) {
            throw new Error('CSV bestand is te kort (minimaal header + 1 data rij nodig)');
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim());

        // Validate header
        this.validateHeader(header);

        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');

            if (values.length !== header.length) {
                console.warn(`Regel ${i + 1} heeft verkeerd aantal kolommen, wordt geskipt`);
                continue;
            }

            try {
                const row = this.parseRow(values);
                data.push(row);
            } catch (err) {
                console.warn(`Fout bij parsen regel ${i + 1}: ${err.message}`);
            }
        }

        if (data.length === 0) {
            throw new Error('Geen geldige data gevonden in CSV');
        }

        this.rawData = data;
        return data;
    }

    /**
     * Validate CSV header
     */
    validateHeader(header) {
        const required = ['time', 'import t1', 'import t2', 'export t1', 'export t2'];
        const headerLower = header.map(h => h.toLowerCase());

        for (const req of required) {
            if (!headerLower.some(h => h.includes(req))) {
                throw new Error(`Vereiste kolom niet gevonden: "${req}"`);
            }
        }
    }

    /**
     * Parse a single data row
     */
    parseRow(values) {
        // Parse timestamp
        const timestamp = new Date(values[0].trim());
        if (isNaN(timestamp.getTime())) {
            throw new Error(`Ongeldige timestamp: ${values[0]}`);
        }

        // Parse meter readings (cumulatief)
        const importT1 = parseFloat(values[1]);
        const importT2 = parseFloat(values[2]);
        const exportT1 = parseFloat(values[3]);
        const exportT2 = parseFloat(values[4]);

        if ([importT1, importT2, exportT1, exportT2].some(v => isNaN(v))) {
            throw new Error('Ongeldige meterstand waarden');
        }

        return {
            timestamp,
            importT1,
            importT2,
            exportT1,
            exportT2,
            totalImport: importT1 + importT2,
            totalExport: exportT1 + exportT2
        };
    }

    /**
     * Detect interval between measurements (in minutes)
     * Returns median interval to be robust against outliers
     */
    detectInterval(data) {
        if (data.length < 2) {
            throw new Error('Niet genoeg datapunten om interval te detecteren (minimaal 2 nodig)');
        }

        // Calculate intervals between consecutive timestamps
        const intervals = [];
        for (let i = 1; i < Math.min(data.length, 100); i++) {  // Sample first 100 for speed
            const diffMs = data[i].timestamp - data[i - 1].timestamp;
            const diffMin = diffMs / (1000 * 60);
            intervals.push(diffMin);
        }

        // Get median interval (robust against outliers)
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];

        // Round to nearest common interval
        const commonIntervals = [1, 5, 10, 15, 20, 30, 60];
        let closestInterval = commonIntervals[0];
        let minDiff = Math.abs(median - closestInterval);

        for (const interval of commonIntervals) {
            const diff = Math.abs(median - interval);
            if (diff < minDiff) {
                minDiff = diff;
                closestInterval = interval;
            }
        }

        this.detectedInterval = closestInterval;
        return closestInterval;
    }

    /**
     * Calculate deltas from cumulative meter readings
     */
    calculateDeltas(data) {
        const result = [];

        for (let i = 1; i < data.length; i++) {
            const prev = data[i - 1];
            const curr = data[i];

            // Time difference in hours
            const timeDiffHours = (curr.timestamp - prev.timestamp) / (1000 * 60 * 60);

            // Energy deltas (kWh)
            const importDelta = curr.totalImport - prev.totalImport;
            const exportDelta = curr.totalExport - prev.totalExport;

            // Netto grid flow: positive = import, negative = export
            const netGridFlow = importDelta - exportDelta;

            result.push({
                timestamp: curr.timestamp,
                timeDiffHours,
                importDelta,
                exportDelta,
                netGridFlow
            });
        }

        return result;
    }

    /**
     * Aggregate data to specified interval (15 or 60 minutes)
     * Returns array with one entry per interval
     *
     * Note: Vanaf oktober 2025 hebben we kwartier-prijsdata beschikbaar,
     * dus moeten we flexibel kunnen aggregeren.
     */
    aggregateToInterval(deltaData, targetIntervalMinutes = 60) {
        if (deltaData.length === 0) {
            throw new Error('Geen delta data om te aggregeren');
        }

        if (targetIntervalMinutes !== 15 && targetIntervalMinutes !== 60) {
            throw new Error('Alleen 15 of 60 minuten intervallen ondersteund');
        }

        // Group by target interval
        const intervalMap = new Map();

        for (const delta of deltaData) {
            // Round down to target interval
            const intervalKey = new Date(delta.timestamp);

            if (targetIntervalMinutes === 60) {
                // Round to hour
                intervalKey.setMinutes(0, 0, 0);
            } else {
                // Round to nearest quarter (0, 15, 30, 45)
                const minutes = intervalKey.getMinutes();
                const roundedMinutes = Math.floor(minutes / 15) * 15;
                intervalKey.setMinutes(roundedMinutes, 0, 0);
            }

            const intervalKeyStr = intervalKey.toISOString();

            if (!intervalMap.has(intervalKeyStr)) {
                intervalMap.set(intervalKeyStr, {
                    timestamp: intervalKey,
                    importDelta: 0,
                    exportDelta: 0,
                    netGridFlow: 0,
                    sampleCount: 0
                });
            }

            const intervalData = intervalMap.get(intervalKeyStr);
            intervalData.importDelta += delta.importDelta;
            intervalData.exportDelta += delta.exportDelta;
            intervalData.netGridFlow += delta.netGridFlow;
            intervalData.sampleCount++;
        }

        // Convert to sorted array
        const intervalArray = Array.from(intervalMap.values())
            .sort((a, b) => a.timestamp - b.timestamp);

        this.hourlyData = intervalArray;  // Keep name for compatibility
        return intervalArray;
    }

    /**
     * Legacy wrapper for backward compatibility
     */
    aggregateToHourly(deltaData) {
        return this.aggregateToInterval(deltaData, 60);
    }

    /**
     * Get data statistics
     */
    calculateStats() {
        if (!this.rawData || !this.hourlyData) {
            throw new Error('Parse data eerst met parseAndAggregate()');
        }

        const firstTimestamp = this.rawData[0].timestamp;
        const lastTimestamp = this.rawData[this.rawData.length - 1].timestamp;

        const totalImport = this.hourlyData.reduce((sum, h) => sum + h.importDelta, 0);
        const totalExport = this.hourlyData.reduce((sum, h) => sum + h.exportDelta, 0);
        const netFlow = totalImport - totalExport;

        // Determine year from data
        const year = firstTimestamp.getFullYear();

        this.stats = {
            year,
            firstTimestamp,
            lastTimestamp,
            durationDays: (lastTimestamp - firstTimestamp) / (1000 * 60 * 60 * 24),
            rawSamples: this.rawData.length,
            hourlySamples: this.hourlyData.length,
            detectedInterval: this.detectedInterval,
            totalImport,
            totalExport,
            netFlow
        };

        return this.stats;
    }

    /**
     * Main entry point: parse CSV and aggregate to hourly
     */
    async parseAndAggregate(csvString) {
        // Parse CSV
        const rawData = this.parseCSV(csvString);

        // Detect interval
        const interval = this.detectInterval(rawData);

        // Calculate deltas
        const deltaData = this.calculateDeltas(rawData);

        // Aggregate to hourly
        const hourlyData = this.aggregateToHourly(deltaData);

        // Calculate stats
        const stats = this.calculateStats();

        return {
            hourlyData,
            stats
        };
    }

    /**
     * Format data for simulator (convert to arrays with timestamps)
     */
    formatForSimulator(hourlyData) {
        return hourlyData.map(h => ({
            timestamp: h.timestamp.toISOString(),
            netGridFlow: h.netGridFlow,  // kWh, positive = import, negative = export
            gridImport: h.importDelta,
            gridExport: h.exportDelta
        }));
    }
}
