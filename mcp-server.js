#!/usr/bin/env node
/**
 * Build Log Filter MCP Server
 * 
 * Provides tools for filtering build logs and Unity test results
 * for integration with AI assistants via Model Context Protocol.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Import filtering logic from server.js
const path = require('path');
const fs = require('fs');

// Read and evaluate server.js to get filter functions
// This ensures we use the same logic as the web server
const serverJsPath = path.join(__dirname, 'server.js');
let filterBuildLog, filterUnityTestResults, isUnityTestXml;

// Inline implementations to avoid server.js side effects
function localIsUnityTestXml(content) {
  return content.trim().startsWith('<?xml') && 
         content.includes('<test-run') && 
         content.includes('<test-case');
}

function localFilterBuildLog(logContent, options = {}) {
  const {
    format = 'full',
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
    /\): error :/i,
    /\bSetEnv task failed/i,
    /\bfailed unexpectedly/i,
    /\bCannot open include file/i,
    /\bunresolved external symbol/i
  ];

  const warningPattern = /\bwarning [A-Z]+\d+:/i;

  // Find errors with context
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (errorPatterns.some(pattern => pattern.test(line))) {
      if (results.errors.length < maxErrors) {
        const context = [];
        const startIdx = Math.max(0, i - contextLines);
        for (let j = startIdx; j < i; j++) {
          context.push(lines[j]);
        }
        results.errors.push({
          line: i + 1,
          content: line,
          context: context
        });
      }
      results.summary.errorCount++;
    }
    
    if (showWarnings && warningPattern.test(line)) {
      if (results.warnings.length < maxWarnings) {
        results.warnings.push({
          line: i + 1,
          content: line
        });
      }
      results.summary.warningCount++;
    }
  }

  // Format output
  const output = [];
  output.push('# Build Log Filtered Output');
  output.push(`# Original: ${results.summary.totalLines} lines`);
  output.push(`# Found: ${results.summary.errorCount} errors, ${results.summary.warningCount} warnings`);
  output.push('');

  if (format === 'minimal') {
    results.errors.forEach(e => output.push(e.content));
    if (showWarnings) {
      results.warnings.forEach(w => output.push(w.content));
    }
  } else {
    // Full format with context
    if (results.errors.length > 0) {
      output.push(`## ERRORS (${results.errors.length})`);
      output.push('');
      results.errors.forEach((err, idx) => {
        output.push(`### Error ${idx + 1} at line ${err.line}`);
        if (err.context.length > 0) {
          err.context.forEach(ctx => output.push(`> ${ctx}`));
        }
        output.push(`**${err.content}**`);
        output.push('');
      });
    }

    if (showWarnings && results.warnings.length > 0) {
      output.push(`## WARNINGS (${results.warnings.length})`);
      output.push('');
      results.warnings.forEach(warn => {
        output.push(`- Line ${warn.line}: ${warn.content}`);
      });
      output.push('');
    }
  }

  results.summary.filteredLines = output.length;
  results.filteredContent = output.join('\n');
  return results;
}

function localFilterUnityTestResults(content, options = {}) {
  const {
    showStackTraces = true,
    showOutput = true,
    maxErrors = 100
  } = options;

  const output = [];
  const filesSet = new Set();
  
  // Parse XML
  const testRunMatch = content.match(/<test-run[^>]*>/);
  let totalTests = 0, passedTests = 0, failedTests = 0, skippedTests = 0;
  
  if (testRunMatch) {
    const attrs = testRunMatch[0];
    totalTests = parseInt(attrs.match(/total="(\d+)"/)?.[1] || 0);
    passedTests = parseInt(attrs.match(/passed="(\d+)"/)?.[1] || 0);
    failedTests = parseInt(attrs.match(/failed="(\d+)"/)?.[1] || 0);
    skippedTests = parseInt(attrs.match(/skipped="(\d+)"/)?.[1] || 0);
  }

  output.push('# Unity Test Results - Filtered Output');
  output.push(`# Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests} | Skipped: ${skippedTests}`);
  output.push(`# Generated: ${new Date().toISOString()}`);
  output.push('');

  // Extract failed test cases
  const failedTestsList = [];
  const testCaseRegex = /<test-case[^>]*result="Failed"[^>]*>([\s\S]*?)<\/test-case>/g;
  let match;
  
  while ((match = testCaseRegex.exec(content)) !== null && failedTestsList.length < maxErrors) {
    const testCase = match[0];
    const nameMatch = testCase.match(/name="([^"]+)"/);
    const fullnameMatch = testCase.match(/fullname="([^"]+)"/);
    
    const test = {
      name: nameMatch?.[1] || 'Unknown',
      fullname: fullnameMatch?.[1],
      message: '',
      stackTrace: '',
      output: ''
    };

    // Extract message
    const messageMatch = testCase.match(/<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>/);
    if (messageMatch) {
      test.message = messageMatch[1].trim();
    }

    // Extract stack trace
    const stackMatch = testCase.match(/<stack-trace><!\[CDATA\[([\s\S]*?)\]\]><\/stack-trace>/);
    if (stackMatch) {
      test.stackTrace = stackMatch[1].trim();
      // Extract files from stack trace
      const fileMatches = test.stackTrace.matchAll(/in\s+([a-zA-Z]:)?[\\/][^:]+/g);
      for (const fm of fileMatches) {
        const file = fm[0].replace(/^in\s+/, '');
        filesSet.add(file);
      }
    }

    // Extract output
    const outputMatch = testCase.match(/<output><!\[CDATA\[([\s\S]*?)\]\]><\/output>/);
    if (outputMatch) {
      test.output = outputMatch[1].trim();
    }

    failedTestsList.push(test);
  }

  if (failedTestsList.length > 0) {
    output.push(`## FAILED TESTS (${failedTestsList.length})`);
    output.push('');

    failedTestsList.forEach((test, index) => {
      output.push(`### ${index + 1}. ${test.name}`);
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
        output.push(test.stackTrace);
        output.push('```');
        output.push('');
      }

      if (showOutput && test.output) {
        output.push('**Console Output:**');
        output.push('```');
        output.push(test.output);
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
      failed: failedTests,
      skipped: skippedTests,
      filteredLines: output.length
    },
    errors: failedTestsList,
    filteredContent: output.join('\n'),
    files: Array.from(filesSet).sort()
  };
}

// Create MCP Server
const server = new Server(
  {
    name: 'build-log-filter',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'filter_build_log',
        description: 'Filter a build log to extract errors and warnings. Reduces large logs (3000+ lines) to ~100 lines showing only errors with optional context.',
        inputSchema: {
          type: 'object',
          properties: {
            logContent: {
              type: 'string',
              description: 'The full build log content to filter'
            },
            format: {
              type: 'string',
              enum: ['full', 'minimal'],
              description: 'Output format: full (with context) or minimal (errors only)',
              default: 'full'
            },
            showWarnings: {
              type: 'boolean',
              description: 'Include warnings in output',
              default: true
            },
            contextLines: {
              type: 'number',
              description: 'Number of lines of context before each error (0-50)',
              default: 10
            },
            maxErrors: {
              type: 'number',
              description: 'Maximum number of errors to include',
              default: 100
            },
            maxWarnings: {
              type: 'number',
              description: 'Maximum number of warnings to include',
              default: 20
            }
          },
          required: ['logContent']
        }
      },
      {
        name: 'filter_unity_test_results',
        description: 'Filter Unity NUnit test result XML to extract failed tests with error messages, stack traces, and console output.',
        inputSchema: {
          type: 'object',
          properties: {
            xmlContent: {
              type: 'string',
              description: 'The Unity TestResults.xml content'
            },
            showStackTraces: {
              type: 'boolean',
              description: 'Include stack traces in output',
              default: true
            },
            showOutput: {
              type: 'boolean',
              description: 'Include console output in output',
              default: true
            },
            maxErrors: {
              type: 'number',
              description: 'Maximum number of failed tests to include',
              default: 100
            }
          },
          required: ['xmlContent']
        }
      },
      {
        name: 'detect_log_type',
        description: 'Detect whether content is a Unity test result XML or a build log.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The content to analyze'
            }
          },
          required: ['content']
        }
      },
      {
        name: 'filter_file',
        description: 'Filter a build log or Unity test results file from disk.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Absolute path to the log file'
            },
            format: {
              type: 'string',
              enum: ['full', 'minimal'],
              description: 'Output format',
              default: 'full'
            },
            showWarnings: {
              type: 'boolean',
              description: 'Include warnings',
              default: true
            },
            contextLines: {
              type: 'number',
              description: 'Context lines before errors',
              default: 10
            }
          },
          required: ['filePath']
        }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'filter_build_log': {
        const result = localFilterBuildLog(args.logContent, {
          format: args.format || 'full',
          showWarnings: args.showWarnings !== false,
          contextLines: args.contextLines ?? 10,
          maxErrors: args.maxErrors ?? 100,
          maxWarnings: args.maxWarnings ?? 20
        });

        return {
          content: [
            {
              type: 'text',
              text: result.filteredContent
            },
            {
              type: 'text',
              text: `\n\n---\n**Summary:** ${result.summary.errorCount} errors, ${result.summary.warningCount} warnings (filtered from ${result.summary.totalLines} lines to ${result.summary.filteredLines} lines)`
            }
          ]
        };
      }

      case 'filter_unity_test_results': {
        const result = localFilterUnityTestResults(args.xmlContent, {
          showStackTraces: args.showStackTraces !== false,
          showOutput: args.showOutput !== false,
          maxErrors: args.maxErrors ?? 100
        });

        return {
          content: [
            {
              type: 'text',
              text: result.filteredContent
            },
            {
              type: 'text',
              text: `\n\n---\n**Summary:** ${result.summary.totalTests} total | ${result.summary.passed} passed | ${result.summary.failed} failed | ${result.summary.skipped} skipped`
            }
          ]
        };
      }

      case 'detect_log_type': {
        const isUnity = localIsUnityTestXml(args.content);
        const lineCount = args.content.split('\n').length;
        
        return {
          content: [
            {
              type: 'text',
              text: isUnity 
                ? `Detected: **Unity Test Results XML** (${lineCount} lines)\n\nUse \`filter_unity_test_results\` tool to process this content.`
                : `Detected: **Build Log** (${lineCount} lines)\n\nUse \`filter_build_log\` tool to process this content.`
            }
          ]
        };
      }

      case 'filter_file': {
        const filePath = args.filePath;
        
        if (!fs.existsSync(filePath)) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: File not found: ${filePath}`
              }
            ],
            isError: true
          };
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const isUnity = localIsUnityTestXml(content);

        if (isUnity) {
          const result = localFilterUnityTestResults(content, {
            showStackTraces: true,
            showOutput: true
          });
          return {
            content: [
              {
                type: 'text',
                text: result.filteredContent
              },
              {
                type: 'text',
                text: `\n\n---\n**Summary:** ${result.summary.totalTests} total | ${result.summary.passed} passed | ${result.summary.failed} failed | ${result.summary.skipped} skipped`
              }
            ]
          };
        } else {
          const result = localFilterBuildLog(content, {
            format: args.format || 'full',
            showWarnings: args.showWarnings !== false,
            contextLines: args.contextLines ?? 10
          });
          return {
            content: [
              {
                type: 'text',
                text: result.filteredContent
              },
              {
                type: 'text',
                text: `\n\n---\n**Summary:** ${result.summary.errorCount} errors, ${result.summary.warningCount} warnings (filtered from ${result.summary.totalLines} lines to ${result.summary.filteredLines} lines)`
              }
            ]
          };
        }
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}`
            }
          ],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}\n\n${error.stack}`
        }
      ],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Build Log Filter MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
