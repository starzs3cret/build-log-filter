#!/usr/bin/env node
/**
 * Standalone Build Log Filter - Test Version
 * No dependencies required - pure Node.js
 */

const fs = require('fs');

/**
 * Filter build log to extract errors and warnings
 */
function filterBuildLog(logContent, options = {}) {
    const {
        showWarnings = true,
        contextLines = 10,
        maxErrors = 100,
        maxWarnings = 20
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
        filteredContent: ''
    };

    // Error patterns
    const errorPatterns = [
        /\berror [A-Z]+\d+:/i,
        /\berror MSB\d+:/i,
        /\berror LNK\d+:/i,
        /\bfatal error\b/i,
        /\bERROR:/i,
        /\bSetEnv task failed/i,
        /\bfailed unexpectedly/i
    ];

    const warningPattern = /\bwarning [A-Z]+\d+:/i;

    // Find errors with line numbers
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isError = errorPatterns.some(p => p.test(line));
        const isWarning = !isError && warningPattern.test(line);

        if (isError && results.summary.errorCount < maxErrors) {
            results.summary.errorCount++;
            const errorBlock = {
                line: i + 1,
                message: line.trim()
            };

            if (contextLines > 0) {
                const start = Math.max(0, i - contextLines);
                errorBlock.context = lines.slice(start, i).map(l => l.trim());
            }

            results.errors.push(errorBlock);
        }

        if (isWarning && showWarnings && results.summary.warningCount < maxWarnings) {
            results.summary.warningCount++;
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
    output.push(`# Found: ${results.errors.length} errors, ${results.warnings.length} warnings`);
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

// Create sample UE5 build log for testing
const sampleLog = `
Build started 1/21/2026 8:00:00 PM.
     1>------ Build started: Project: LastCurierS, Configuration: Development AA64 ------
     1>BuildUtils.ExecuteMake: LastCurierS.target
     1>Deleting intermediate and output files...
     1>Creating D:\\Projects\\LastCourier\\Binaries\\Win64\\LastCurierS.target.mk...
     1>Building LastCurierS...
     1>ClangCompile
     1>LCCharacterBase.cpp
     1>Generating code for file: D:\\Projects\\LastCourier\\Source\\LastCurierS\\Player\\LCCharacterBase.cpp
     1>LCStaminaComponent.cpp
     1>Generating code for file: D:\\Projects\\LastCourier\\Source\\LastCurierS\\Player\\LCStaminaComponent.cpp
     1>LCPlayerController.cpp
     1>Generating code for file: D:\\Projects\\LastCourier\\Source\\LastCurierS\\Core\\LCPlayerController.cpp
     1>D:\\Projects\\LastCourier\\Source\\LastCurierS\\Player\\LCCharacterBase.cpp(42): error C2065: 'ULCStaminaComponent': undeclared identifier
     1>D:\\Projects\\LastCourier\\Source\\LastCurierS\\Player\\LCCharacterBase.cpp(42): error C2027: use of undefined type 'ULCStaminaComponent'
     1>D:\\Projects\\LastCourier\\Source\\LastCurierS\\Player\\LCCharacterBase.cpp(85): warning C4101: 'unusedVar': unreferenced local variable
     1>D:\\Projects\\LastCourier\\Source\\LastCurierS\\Core\\LCPlayerController.cpp(120): error C1083: Cannot open include file: 'LCGameEvents.h': No such file or directory
     1>LCTimeManager.cpp
     1>Generating code for file: D:\\Projects\\LastCourier\\Source\\LastCurierS\\Systems\\LCTimeManager.cpp
     1>LCDeathManager.cpp
     1>Generating code for file: D:\\Projects\\LastCourier\\Source\\LastCurierS\\Systems\\LCDeathManager.cpp
     1>Linking...
     1>Creating library D:\\Projects\\LastCourier\\Binaries\\Win64\\...
     1>LINK : fatal error LNK1181: cannot open input file 'LCGameEvents.obj'
     1>Done building project "LastCurierS.vcxproj" -- FAILED.
Build FAILED.
`;

// Run test
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       Build Log Filter - Test Run                        ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📥 Sample Input (' + sampleLog.split('\n').length + ' lines):\n');
console.log('─'.repeat(60));
console.log(sampleLog.trim());
console.log('─'.repeat(60));
console.log('\n');

console.log('🚀 Filtering...\n');

const result = filterBuildLog(sampleLog, {
    showWarnings: true,
    contextLines: 5,
    maxErrors: 100,
    maxWarnings: 20
});

console.log('📤 Filtered Output:\n');
console.log('═'.repeat(60));
console.log(result.filteredContent);
console.log('═'.repeat(60));
console.log('\n');

console.log('📊 Statistics:');
console.log('   Original lines:   ' + result.summary.totalLines);
console.log('   Errors found:     ' + result.errors.length);
console.log('   Warnings found:   ' + result.warnings.length);
console.log('   Filtered lines:   ' + result.summary.filteredLines);
console.log('   Reduction:        ' + Math.round((1 - result.summary.filteredLines / result.summary.totalLines) * 100) + '%');
console.log('\n✅ Test completed!');
