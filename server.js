#!/usr/bin/env node
/**
 * Build Log Filter GUI Server
 * Web-based tool for filtering build logs before sharing with AI
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3456;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

/**
 * Filter build log to extract errors and warnings
 * @param {string} logContent - Raw build log content
 * @param {object} options - Filter options
 * @returns {object} Filtered result with stats and content
 */
function filterBuildLog(logContent, options = {}) {
    const {
        showWarnings = true,
        contextLines = 0,
        maxErrors = 9999,
        maxWarnings = 9999,
        fileFilter = null,
        fileFilters = []
    } = options;

    const lines = logContent.split('\n');
    const results = {
        summary: {
            totalLines: lines.length,
            errorCount: 0,
            warningCount: 0,
            filteredLines: 0
        },
        errors: [],
        warnings: [],
        filteredContent: '',
        files: []  // List of unique files with errors
    };

    // Flat references for easier access
    let errorCount = 0;
    let warningCount = 0;
    const filesSet = new Set();

    // Patterns for different error types
    const errorPatterns = [
        /\berror [A-Z]+\d+:/i,           // MSVC: error C2065:
        /\berror MSB\d+:/i,               // MSBuild: error MSB3073:
        /\berror LNK\d+:/i,               // Linker: error LNK2019:
        /\bfatal error\b/i,               // Fatal error
        /\bERROR:/i,                      // UBT ERROR:
        /\): error :/i,                   // UHT: filename.h(line): error : message
        /\): error \w/i,                  // UHT alternative: filename.h(line): error keyword
        /\bSetEnv task failed/i,          // SetEnv error
        /\bfailed unexpectedly/i,         // Failed unexpectedly
        /\bCannot open include file/i,    // Include error
        /\bunresolved external symbol/i   // Linker error
    ];

    const warningPattern = /\bwarning [A-Z]+\d+:/i;

    // File pattern to match file references like "LCCharacterBase.cpp(123):"
    const filePattern = /([a-zA-Z0-9_]+\.(cpp|h|hpp|cs))\(?(\d+)?\)?/;

    // First pass: collect all files with errors (without filter)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isError = errorPatterns.some(p => p.test(line));
        const isWarning = !isError && warningPattern.test(line);

        if (isError || isWarning) {
            const fileMatch = line.match(filePattern);
            if (fileMatch) {
                filesSet.add(fileMatch[1]);
            }
        }
    }

    results.files = Array.from(filesSet).sort();

    // Find errors with line numbers
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isError = errorPatterns.some(p => p.test(line));
        const isWarning = !isError && warningPattern.test(line);

        // Check if line matches file filter
        let matchesFile = true;
        const activeFilters = Array.isArray(fileFilters) && fileFilters.length > 0 ? fileFilters : (fileFilter ? [fileFilter] : []);
        if (activeFilters.length > 0) {
            const fileMatch = line.match(filePattern);
            if (fileMatch) {
                const fileName = fileMatch[1];
                matchesFile = activeFilters.some(filter =>
                    fileName.includes(filter) || filter.includes(fileName)
                );
            } else {
                // If no file reference in line, skip it when filtering
                matchesFile = false;
            }
        }

        if (isError && errorCount < maxErrors && matchesFile) {
            errorCount++;
            results.summary.errorCount = errorCount;
            const errorBlock = {
                line: i + 1,
                message: line.trim()
            };

            // Add context if requested
            if (contextLines > 0) {
                const start = Math.max(0, i - contextLines);
                errorBlock.context = lines.slice(start, i).map(l => l.trim());
            }

            results.errors.push(errorBlock);
        }

        if (isWarning && showWarnings && warningCount < maxWarnings && matchesFile) {
            warningCount++;
            results.summary.warningCount = warningCount;
            results.warnings.push({
                line: i + 1,
                message: line.trim()
            });
        }
    }

    // Build filtered content
    let output = [];
    output.push(`# Build Log Filtered Output`);
    output.push(`# Original: ${results.summary.totalLines} lines`);
    output.push(`# Found: ${results.summary.errorCount} errors, ${results.summary.warningCount} warnings`);
    if (fileFilter) {
        output.push(`# Filter: ${fileFilter}`);
    }
    output.push(`# Generated: ${new Date().toISOString()}`);
    output.push('');

    if (results.errors.length > 0) {
        output.push(`## ERRORS (${results.errors.length})`);
        output.push('');

        results.errors.forEach(err => {
            if (err.context && err.context.length > 0) {
                output.push(`### Error at line ${err.line}`);
                output.push('```');
                err.context.forEach(ctx => output.push(ctx));
                output.push(err.message);
                output.push('```');
            } else {
                output.push(`[Line ${err.line}] ${err.message}`);
            }
            output.push('');
        });
    } else {
        output.push('## No errors found!');
    }

    if (results.warnings.length > 0) {
        output.push('');
        output.push(`## WARNINGS (${results.warnings.length})`);
        output.push('');
        results.warnings.forEach(warn => {
            output.push(`[Line ${warn.line}] ${warn.message}`);
        });
    }

    results.summary.filteredLines = output.length;
    results.filteredContent = output.join('\n');

    return results;
}

/**
 * Format log as plain text (minimal format)
 */
function formatMinimal(logContent, options = {}) {
    const { maxErrors = 9999, maxWarnings = 9999, fileFilter = null, fileFilters = [], showWarnings = true } = options;
    const lines = logContent.split('\n');
    const errors = [];
    const warnings = [];
    const filesSet = new Set();

    const errorPatterns = [
        /\berror [A-Z]+\d+:/i,
        /\berror MSB\d+:/i,
        /\berror LNK\d+:/i,
        /\bfatal error\b/i,
        /\bERROR:/i,
        /\): error :/i,       // UHT: filename.h(line): error : message
        /\): error \w/i        // UHT alternative: filename.h(line): error keyword
    ];
    const warningPattern = /\bwarning [A-Z]+\d+:/i;

    // File pattern to match file references like "LCCharacterBase.cpp(123):"
    const filePattern = /([a-zA-Z0-9_]+\.(cpp|h|hpp|cs))\(?(\d+)?\)?/;

    // First pass: collect all files with errors
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isError = errorPatterns.some(p => p.test(line));
        const isWarning = !isError && warningPattern.test(line);

        if (isError || isWarning) {
            const fileMatch = line.match(filePattern);
            if (fileMatch) {
                filesSet.add(fileMatch[1]);
            }
        }
    }

    const files = Array.from(filesSet).sort();

    // Second pass: collect errors and warnings
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isError = errorPatterns.some(p => p.test(line));
        const isWarning = !isError && warningPattern.test(line);

        // Check if line matches file filter
        let matchesFile = true;
        const activeFilters = Array.isArray(fileFilters) && fileFilters.length > 0 ? fileFilters : (fileFilter ? [fileFilter] : []);
        if (activeFilters.length > 0) {
            const fileMatch = line.match(filePattern);
            if (fileMatch) {
                const fileName = fileMatch[1];
                matchesFile = activeFilters.some(filter =>
                    fileName.includes(filter) || filter.includes(fileName)
                );
            } else {
                // If no file reference in line, skip it when filtering
                matchesFile = false;
            }
        }

        if (isError && errors.length < maxErrors && matchesFile) {
            errors.push({ line: i + 1, message: line.trim() });
        } else if (isWarning && showWarnings && warnings.length < maxWarnings && matchesFile) {
            warnings.push({ line: i + 1, message: line.trim() });
        }
    }

    let output = [];
    output.push('=== ERRORS ===\n');
    errors.forEach(e => output.push(`[Line ${e.line}] ${e.message}`));
    if (errors.length === 0) output.push('(no errors found)');

    // Only show warnings if showWarnings is true
    if (showWarnings) {
        output.push('\n=== WARNINGS ===\n');
        warnings.forEach(w => output.push(`[Line ${w.line}] ${w.message}`));
        if (warnings.length === 0) output.push('(no warnings found)');
    }

    return {
        content: output.join('\n'),
        errorCount: errors.length,
        warningCount: showWarnings ? warnings.length : 0,
        totalLines: lines.length,
        files: files
    };
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Filter log
app.post('/api/filter', (req, res) => {
    const { logContent, format, showWarnings, contextLines, maxErrors, maxWarnings, fileFilter, fileFilters } = req.body;

    if (!logContent) {
        return res.status(400).json({ error: 'logContent is required' });
    }

    try {
        const options = {
            showWarnings: showWarnings !== false,
            contextLines: parseInt(contextLines) || 0,
            maxErrors: parseInt(maxErrors) || 9999,
            maxWarnings: parseInt(maxWarnings) || 9999,
            fileFilter: fileFilter || null,
            fileFilters: fileFilters || []
        };

        let result;

        if (format === 'minimal') {
            const minimalResult = formatMinimal(logContent, options);
            result = {
                filteredContent: minimalResult.content,
                summary: {
                    errorCount: minimalResult.errorCount,
                    warningCount: minimalResult.warningCount,
                    totalLines: minimalResult.totalLines,
                    filteredLines: minimalResult.content.split('\n').length,
                    format: 'minimal'
                },
                files: minimalResult.files
            };
        } else {
            result = filterBuildLog(logContent, options);
        }

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// API: Load log from file
app.post('/api/load-file', (req, res) => {
    const { filePath } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'filePath is required' });
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ content, size: content.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(PORT, 'localhost', () => {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  Build Log Filter GUI                                    ║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║  Open: http://localhost:${PORT}                             ║`);
    console.log(`║                                                            ║`);
    console.log(`║  Paste your build log, click Filter, then copy result!    ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
});
