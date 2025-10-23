/**
 * P1 Parser - Parse and aggregate P1 meter data with intelligent interval detection
 */

class P1Parser {
    constructor() {
        this.rawData = null;
        this.detectedInterval = null;
        this.hourlyData = null;
        this.stats = null;
        this.detectedFormat = null;  // 'p1' or 'simple'
    }

    /**
     * Detect CSV format and separator
     * Returns: { format: 'p1' | 'simple', separator: ',' | ';' }
     */
    detectFormat(csvString) {
        const lines = csvString.trim().split('\n');
        if (lines.length < 1) {
            throw new Error('CSV bestand is leeg');
        }

        const firstLine = lines[0].toLowerCase();

        // Check for semicolon separator (simple format)
        if (firstLine.includes(';')) {
            // Simple format: "DatumTijd;Import;Export;Opwek"
            if (firstLine.includes('datumtijd') && firstLine.includes('import') && firstLine.includes('export')) {
                return { format: 'simple', separator: ';' };
            }
        }

        // Check for comma separator (P1 format)
        if (firstLine.includes(',')) {
            // P1 format: "time, Import T1 kWh, Import T2 kWh, Export T1 kWh, Export T2 kWh"
            if (firstLine.includes('time') && (firstLine.includes('import t1') || firstLine.includes('import'))) {
                return { format: 'p1', separator: ',' };
            }
        }

        throw new Error('Onbekend CSV format. Verwacht P1 format (time, Import T1, ...) of simpel format (DatumTijd;Import;Export;Opwek)');
    }

    /**
     * Parse CSV string - auto-detects format
     */
    parseCSV(csvString) {
        const lines = csvString.trim().split('\n');

        if (lines.length < 2) {
            throw new Error('CSV bestand is te kort (minimaal header + 1 data rij nodig)');
        }

        // Detect format
        const { format, separator } = this.detectFormat(csvString);
        this.detectedFormat = format;

        console.log(`Gedetecteerd CSV format: ${format} (separator: '${separator}')`);

        if (format === 'simple') {
            return this.parseSimpleFormat(lines, separator);
        } else {
            return this.parseP1Format(lines, separator);
        }
    }

    /**
     * Parse P1 format (cumulative meter readings)
     */
    parseP1Format(lines, separator) {
        // Parse header
        const header = lines[0].split(separator).map(h => h.trim());

        // Validate header
        this.validateP1Header(header);

        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(separator);

            if (values.length !== header.length) {
                console.warn(`Regel ${i + 1} heeft verkeerd aantal kolommen, wordt geskipt`);
                continue;
            }

            try {
                const row = this.parseP1Row(values);
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
     * Parse simple format (direct kWh per hour with PV generation)
     */
    parseSimpleFormat(lines, separator) {
        // Parse header
        const header = lines[0].split(separator).map(h => h.trim());

        // Validate header
        this.validateSimpleHeader(header);

        // Parse data rows
        const data = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(separator);

            if (values.length < 3) {
                console.warn(`Regel ${i + 1} heeft te weinig kolommen, wordt geskipt`);
                continue;
            }

            try {
                const row = this.parseSimpleRow(values);
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
     * Validate P1 CSV header
     */
    validateP1Header(header) {
        const required = ['time', 'import t1', 'import t2', 'export t1', 'export t2'];
        const headerLower = header.map(h => h.toLowerCase());

        for (const req of required) {
            if (!headerLower.some(h => h.includes(req))) {
                throw new Error(`Vereiste kolom niet gevonden: "${req}"`);
            }
        }
    }

    /**
     * Validate simple CSV header
     */
    validateSimpleHeader(header) {
        const required = ['datumtijd', 'import', 'export'];
        const headerLower = header.map(h => h.toLowerCase());

        for (const req of required) {
            if (!headerLower.some(h => h.includes(req))) {
                throw new Error(`Vereiste kolom niet gevonden: "${req}"`);
            }
        }
    }

    /**
     * Parse a single P1 data row (cumulative meter readings)
     */
    parseP1Row(values) {
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
     * Parse a single simple format row (direct kWh per hour)
     * Format: DatumTijd;Import;Export;Opwek
     * Uses Dutch decimal separator (,) and date format (dd-MM-yyyy HH:mm:ss)
     */
    parseSimpleRow(values) {
        // Parse timestamp - Dutch format: "06-10-2024 00:00:00"
        const timestampStr = values[0].trim();
        const timestamp = this.parseDutchDate(timestampStr);

        if (isNaN(timestamp.getTime())) {
            throw new Error(`Ongeldige timestamp: ${timestampStr}`);
        }

        // Parse energy values - Dutch decimal separator (,)
        const importKwh = this.parseDutchDecimal(values[1]);
        const exportKwh = this.parseDutchDecimal(values[2]);
        const pvGenKwh = values.length > 3 ? this.parseDutchDecimal(values[3]) : 0;

        if ([importKwh, exportKwh, pvGenKwh].some(v => isNaN(v))) {
            throw new Error('Ongeldige energie waarden');
        }

        // For simple format, these are already delta values (kWh per hour)
        // Store as "cumulative" by summing (for compatibility with delta calculation)
        return {
            timestamp,
            importDelta: importKwh,
            exportDelta: exportKwh,
            pvGeneration: pvGenKwh,
            isSimpleFormat: true  // Flag to skip delta calculation
        };
    }

    /**
     * Parse Dutch date format: dd-MM-yyyy HH:mm:ss
     */
    parseDutchDate(dateStr) {
        // Format: "06-10-2024 00:00:00"
        const parts = dateStr.split(' ');
        if (parts.length !== 2) {
            throw new Error(`Ongeldige datum format: ${dateStr}`);
        }

        const dateParts = parts[0].split('-');
        const timeParts = parts[1].split(':');

        if (dateParts.length !== 3 || timeParts.length !== 3) {
            throw new Error(`Ongeldige datum format: ${dateStr}`);
        }

        const day = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1;  // JS months are 0-indexed
        const year = parseInt(dateParts[2]);
        const hour = parseInt(timeParts[0]);
        const minute = parseInt(timeParts[1]);
        const second = parseInt(timeParts[2]);

        return new Date(year, month, day, hour, minute, second);
    }

    /**
     * Parse Dutch decimal format (comma separator)
     */
    parseDutchDecimal(value) {
        if (typeof value === 'number') return value;
        const normalized = value.trim().replace(',', '.');
        return parseFloat(normalized);
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
     * For simple format, data is already in delta form
     */
    calculateDeltas(data) {
        const result = [];

        // Check if this is simple format (already has deltas)
        if (data.length > 0 && data[0].isSimpleFormat) {
            // Data is already in delta form, just reformat
            for (const row of data) {
                const timeDiffHours = 1.0;  // Simple format is hourly

                // Netto grid flow: positive = import, negative = export
                const netGridFlow = row.importDelta - row.exportDelta;

                result.push({
                    timestamp: row.timestamp,
                    timeDiffHours,
                    importDelta: row.importDelta,
                    exportDelta: row.exportDelta,
                    pvGeneration: row.pvGeneration || 0,
                    netGridFlow
                });
            }

            return result;
        }

        // P1 format: calculate deltas from cumulative readings
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
