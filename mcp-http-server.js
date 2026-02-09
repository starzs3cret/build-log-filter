#!/usr/bin/env node
/**
 * Build Log Filter MCP HTTP Server
 * 
 * Provides HTTP transport for MCP integration, allowing AI assistants
 * to connect via HTTP/SSE instead of stdio.
 * 
 * Usage:
 *   node mcp-http-server.js           # Start on default port 3000
 *   node mcp-http-server.js --port 8080  # Start on custom port
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const express = require('express');
const cors = require('cors');
const fs = require('fs');

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find((arg, i) => arg === '--port' && args[i + 1]);
const PORT = portArg ? parseInt(args[args.indexOf('--port') + 1]) : (process.env.MCP_HTTP_PORT || 3000);
const HOST = process.env.MCP_HTTP_HOST || '127.0.0.1';

// ==================== Filter Logic (shared with mcp-server.js) ====================

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

    const messageMatch = testCase.match(/<message><!\[CDATA\[([\s\S]*?)\]\]><\/message>/);
    if (messageMatch) {
      test.message = messageMatch[1].trim();
    }

    const stackMatch = testCase.match(/<stack-trace><!\[CDATA\[([\s\S]*?)\]\]><\/stack-trace>/);
    if (stackMatch) {
      test.stackTrace = stackMatch[1].trim();
      const fileMatches = test.stackTrace.matchAll(/in\s+([a-zA-Z]:)?[\\/][^:]+/g);
      for (const fm of fileMatches) {
        const file = fm[0].replace(/^in\s+/, '');
        filesSet.add(file);
      }
    }

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

// ==================== MCP Server Setup ====================

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

// ==================== HTTP Server Setup ====================

async function main() {
  // Create Express app with MCP configuration
  const app = createMcpExpressApp({ host: HOST });
  
  // Enable CORS for all origins (configure as needed)
  app.use(cors());
  
  // Parse JSON body
  app.use(express.json({ limit: '50mb' }));
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      server: 'build-log-filter-mcp',
      version: '1.0.0',
      transport: 'http'
    });
  });
  
  // Create HTTP transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => generateSessionId(),
  });
  
  // Connect MCP server to HTTP transport
  await server.connect(transport);
  
  // Handle MCP requests on /mcp endpoint
  app.all('/mcp', async (req, res) => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal server error',
          message: error.message
        });
      }
    }
  });
  
  // Start server
  app.listen(PORT, HOST, () => {
    console.log(`Build Log Filter MCP HTTP Server running on http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
    console.log('');
    console.log('Available tools:');
    console.log('  - filter_build_log');
    console.log('  - filter_unity_test_results');
    console.log('  - detect_log_type');
    console.log('  - filter_file');
  });
}

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
