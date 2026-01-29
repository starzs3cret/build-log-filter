#!/usr/bin/env node
/**
 * Standalone Build Log Filter - Test Version
 * No dependencies required - pure Node.js
 */

const fs = require('fs');

/**
 * Check if content is a Unity NUnit test result XML
 */
function isUnityTestXml(content) {
    const trimmed = content.trim();
    return trimmed.startsWith('<?xml') && trimmed.includes('<test-run') && trimmed.includes('testcasecount');
}

/**
 * Filter Unity NUnit test result XML to extract failed tests
 */
function filterUnityTestResults(xmlContent, options = {}) {
    const { showStackTraces = true, showOutput = true, maxErrors = 9999 } = options;

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
            const nameMatch = trimmed.match(/name="([^"]+)"/);
            const fullnameMatch = trimmed.match(/fullname="([^"]+)"/);
            currentTest = {
                name: nameMatch ? nameMatch[1] : null,
                fullname: fullnameMatch ? fullnameMatch[1] : null,
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

            // Extract file from stack trace
            if (currentTest.stackTrace) {
                const fileMatch = currentTest.stackTrace.match(/([A-Za-z0-9_]+\.cs):(\d+)/);
                if (fileMatch) {
                    filesSet.add(fileMatch[1]);
                }
            }

            // End of test case
            if (trimmed.includes('</test-case>') || (trimmed.startsWith('</') && line.search(/\S/) <= currentIndent)) {
                if (currentTest.message || currentTest.stackTrace) {
                    failedTests.push(currentTest);
                    if (failedTests.length >= maxErrors) break;
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
console.log('\n✅ Build log test completed!');
console.log('\n');

// Unity Test Results XML Test
const unityTestXml = `<?xml version="1.0" encoding="utf-8"?>
<test-run id="2" testcasecount="10" result="Failed" total="10" passed="8" failed="2" inconclusive="0" skipped="0">
  <test-suite type="TestFixture" name="MeleeCombatTests">
    <test-case id="1103" name="OnWeaponHitEnemy_AppliesHeadMultiplier" fullname="ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesHeadMultiplier" result="Failed">
      <failure>
        <message><![CDATA[  Head shot should deal 2.5x damage
  Expected: 250
  But was:  0
]]></message>
        <stack-trace><![CDATA[at ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesHeadMultiplier () [0x00059] in C:\\Projects\\ActionWeather\\Assets\\Scripts\\Player\\Tests\\MeleeCombatTests.cs:292
]]></stack-trace>
      </failure>
      <output><![CDATA[[MeleeAttack] Hit TestEnemy: Base=100, Swing=1x, Purity=1x, HitZone=2,5x = 250
Player Die!
]]></output>
    </test-case>
    <test-case id="1104" name="OnWeaponHitEnemy_AppliesWeakSpotMultiplier" fullname="ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesWeakSpotMultiplier" result="Failed">
      <failure>
        <message><![CDATA[  Weak spot should deal 3x damage
  Expected: 200
  But was:  0
]]></message>
        <stack-trace><![CDATA[at ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesWeakSpotMultiplier () [0x00059] in C:\\Projects\\ActionWeather\\Assets\\Scripts\\Player\\Tests\\MeleeCombatTests.cs:307
]]></stack-trace>
      </failure>
    </test-case>
    <test-case id="1105" name="OnWeaponHitEnemy_BasicDamage" result="Passed"/>
  </test-suite>
</test-run>`;

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       Unity Test Results Filter - Test Run                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📥 Unity Test XML Input (' + unityTestXml.split('\n').length + ' lines):\n');
console.log('─'.repeat(60));
console.log(unityTestXml.trim().substring(0, 500) + '...');
console.log('─'.repeat(60));
console.log('\n');

console.log('🚀 Filtering Unity test results...\n');

const unityResult = filterUnityTestResults(unityTestXml, {
    showStackTraces: true,
    showOutput: true,
    maxErrors: 100
});

console.log('📤 Filtered Unity Test Output:\n');
console.log('═'.repeat(60));
console.log(unityResult.filteredContent);
console.log('═'.repeat(60));
console.log('\n');

console.log('📊 Unity Test Statistics:');
console.log('   Total tests:      ' + unityResult.summary.totalTests);
console.log('   Passed:           ' + unityResult.summary.passed);
console.log('   Failed:           ' + unityResult.summary.failed);
console.log('   Skipped:          ' + unityResult.summary.skipped);
console.log('   Files with errors: ' + unityResult.files.length);
if (unityResult.files.length > 0) {
    console.log('   Affected files:   ' + unityResult.files.join(', '));
}
console.log('\n✅ Unity test filter completed!');
