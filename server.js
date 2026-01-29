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
 * Check if content is a Unity NUnit test result XML
 */
function isUnityTestXml(content) {
    const trimmed = content.trim();
    return trimmed.startsWith('<?xml') && trimmed.includes('<test-run') && trimmed.includes('testcasecount');
}

/**
 * Parse CDATA content from XML
 */
function parseCData(xmlContent, tagName) {
    const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([^\\]]*(?:\\](?!\\])[^\\]]*)*)\\]\\]>\\s*</${tagName}>`, 'gis');
    const matches = [];
    let match;
    while ((match = cdataRegex.exec(xmlContent)) !== null) {
        matches.push(match[1].trim());
    }
    return matches;
}

/**
 * Extract test case name from XML element
 */
function extractTestName(xmlLine) {
    const nameMatch = xmlLine.match(/name="([^"]+)"/);
    return nameMatch ? nameMatch[1] : null;
}

/**
 * Extract fullname from XML element
 */
function extractFullname(xmlLine) {
    const fullnameMatch = xmlLine.match(/fullname="([^"]+)"/);
    return fullnameMatch ? fullnameMatch[1] : null;
}

/**
 * Filter Unity NUnit test result XML to extract failed tests
 * @param {string} xmlContent - Unity test result XML content
 * @param {object} options - Filter options
 * @returns {object} Filtered result with stats and content
 */
function filterUnityTestResults(xmlContent, options = {}) {
    const {
        showStackTraces = true,
        showOutput = true,
        maxErrors = 9999
    } = options;

    const lines = xmlContent.split('\n');
    const failedTests = [];
    const filesSet = new Set();
    let totalTests = 0;
    let passedTests = 0;
    let failedTestsCount = 0;
    let skippedTests = 0;

    // Extract summary from test-run element
    const summaryMatch = xmlContent.match(/<test-run[^>]*total="(\d+)"[^>]*passed="(\d+)"[^>]*failed="(\d+)"[^>]*skipped="(\d+)"/);
    if (summaryMatch) {
        totalTests = parseInt(summaryMatch[1]) || 0;
        passedTests = parseInt(summaryMatch[2]) || 0;
        failedTestsCount = parseInt(summaryMatch[3]) || 0;
        skippedTests = parseInt(summaryMatch[4]) || 0;
    }

    // Find all failed test-case elements
    let inFailedTestCase = false;
    let currentTest = null;
    let captureStack = false;
    let captureOutput = false;
    let currentIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Detect start of a failed test case
        if (trimmed.includes('<test-case') && trimmed.includes('result="Failed"')) {
            inFailedTestCase = true;
            currentIndent = line.search(/\S/);
            currentTest = {
                name: extractTestName(trimmed),
                fullname: extractFullname(trimmed),
                message: '',
                stackTrace: '',
                output: ''
            };
            captureStack = false;
            captureOutput = false;
            continue;
        }

        if (inFailedTestCase && currentTest) {
            // Check for failure message
            if (trimmed.includes('<message>')) {
                // Extract content after <message><![CDATA[ on the same line
                const cdataStart = line.indexOf('<![CDATA[');
                if (cdataStart !== -1) {
                    const afterCdataStart = line.substring(cdataStart + 9);
                    if (afterCdataStart.includes(']]>')) {
                        // CDATA ends on same line
                        currentTest.message = afterCdataStart.substring(0, afterCdataStart.indexOf(']]>')).trim();
                    } else {
                        // Multi-line CDATA - start with content after <![CDATA[
                        let content = [];
                        if (afterCdataStart.trim()) {
                            content.push(afterCdataStart.trim());
                        }
                        // Collect remaining lines until ]]> is found
                        let j = i + 1;
                        while (j < lines.length && !lines[j].includes(']]>')) {
                            content.push(lines[j].trim());
                            j++;
                        }
                        if (j < lines.length && lines[j].includes(']]>')) {
                            const endContent = lines[j].split(']]>')[0].trim();
                            if (endContent) {
                                content.push(endContent);
                            }
                        }
                        currentTest.message = content.join('\n');
                    }
                }
            }

            // Check for stack-trace
            if (trimmed.includes('<stack-trace>')) {
                const cdataStart = line.indexOf('<![CDATA[');
                if (cdataStart !== -1) {
                    const afterCdataStart = line.substring(cdataStart + 9);
                    if (afterCdataStart.includes(']]>')) {
                        currentTest.stackTrace = afterCdataStart.substring(0, afterCdataStart.indexOf(']]>')).trim();
                    } else {
                        captureStack = true;
                        // Start with any content after <![CDATA[ on the same line
                        if (afterCdataStart.trim()) {
                            currentTest.stackTrace = afterCdataStart.trim() + '\n';
                        }
                    }
                } else {
                    captureStack = true;
                }
            }

            // Capture stack trace content
            if (captureStack) {
                if (trimmed.includes(']]>')) {
                    const endContent = trimmed.split(']]>')[0].trim();
                    if (endContent && !endContent.includes('<stack-trace>')) {
                        currentTest.stackTrace += endContent;
                    }
                    captureStack = false;
                } else if (trimmed.length > 0 && !trimmed.includes('<stack-trace>') && !trimmed.includes('<![CDATA[')) {
                    currentTest.stackTrace += trimmed + '\n';
                }
            }

            // Check for output
            if (trimmed.includes('<output>')) {
                const cdataStart = line.indexOf('<![CDATA[');
                if (cdataStart !== -1) {
                    const afterCdataStart = line.substring(cdataStart + 9);
                    if (afterCdataStart.includes(']]>')) {
                        currentTest.output = afterCdataStart.substring(0, afterCdataStart.indexOf(']]>')).trim();
                    } else {
                        captureOutput = true;
                        if (afterCdataStart.trim()) {
                            currentTest.output = afterCdataStart.trim() + '\n';
                        }
                    }
                } else {
                    captureOutput = true;
                }
            }

            // Capture output content
            if (captureOutput) {
                if (trimmed.includes(']]>')) {
                    const endContent = trimmed.split(']]>')[0].trim();
                    if (endContent && !endContent.includes('<output>')) {
                        currentTest.output += endContent;
                    }
                    captureOutput = false;
                } else if (trimmed.length > 0 && !trimmed.includes('<output>') && !trimmed.includes('<![CDATA[')) {
                    currentTest.output += trimmed + '\n';
                }
            }

            // Extract file from stack trace (e.g., "MeleeCombatTests.cs:292")
            if (currentTest.stackTrace) {
                const fileMatch = currentTest.stackTrace.match(/([A-Za-z0-9_]+\.cs):(\d+)/);
                if (fileMatch) {
                    filesSet.add(fileMatch[1]);
                }
            }

            // End of test case (closing tag at same or lower indent)
            if (trimmed.includes('</test-case>') || (trimmed.startsWith('</') && line.search(/\S/) <= currentIndent)) {
                if (currentTest.message || currentTest.stackTrace) {
                    failedTests.push(currentTest);
                    if (failedTests.length >= maxErrors) {
                        break;
                    }
                }
                inFailedTestCase = false;
                currentTest = null;
            }
        }
    }

    // Build filtered content
    let output = [];
    output.push(`# Unity Test Results - Filtered Output`);
    output.push(`# Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests.length} | Skipped: ${skippedTests}`);
    output.push(`# Generated: ${new Date().toISOString()}`);
    output.push('');

    if (failedTests.length > 0) {
        output.push(`## FAILED TESTS (${failedTests.length})`);
        output.push('');

        failedTests.forEach((test, index) => {
            output.push(`### ${index + 1}. ${test.name || 'Unknown Test'}`);
            if (test.fullname && test.fullname !== test.name) {
                output.push(`**Full Name:** \`${test.fullname}\``);
            }
            output.push('');

            if (test.message) {
                output.push('**Error Message:**');
                output.push('```');
                output.push(test.message);
                output.push('```');
                output.push('');
            }

            if (showStackTraces && test.stackTrace) {
                output.push('**Stack Trace:**');
                output.push('```');
                output.push(test.stackTrace.trim());
                output.push('```');
                output.push('');
            }

            if (showOutput && test.output) {
                output.push('**Console Output:**');
                output.push('```');
                output.push(test.output.trim());
                output.push('```');
                output.push('');
            }

            output.push('---');
            output.push('');
        });
    } else {
        output.push('## All tests passed! No failures found.');
    }

    return {
        summary: {
            totalTests,
            passed: passedTests,
            failed: failedTests.length,
            skipped: skippedTests,
            filteredLines: output.length
        },
        errors: failedTests,
        filteredContent: output.join('\n'),
        files: Array.from(filesSet).sort()
    };
}

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
    const { logContent, format, showWarnings, contextLines, maxErrors, maxWarnings, fileFilter, fileFilters, showStackTraces, showOutput } = req.body;

    if (!logContent) {
        return res.status(400).json({ error: 'logContent is required' });
    }

    try {
        // Auto-detect Unity test result XML
        if (isUnityTestXml(logContent)) {
            const unityResult = filterUnityTestResults(logContent, {
                showStackTraces: showStackTraces !== false,
                showOutput: showOutput !== false,
                maxErrors: parseInt(maxErrors) || 9999
            });

            return res.json({
                ...unityResult,
                format: 'unity-test-results'
            });
        }

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
