#!/usr/bin/env node
/**
 * Combined Build Log Filter Server
 * Web GUI + MCP HTTP Server for Vercel deployment
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// MCP SDK imports
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createMcpExpressApp } = require('@modelcontextprotocol/sdk/server/express.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const app = express();
const PORT = process.env.PORT || 3456;

// Enable CORS
app.use(cors());

// Parse JSON body for API routes
app.use('/api', express.json({ limit: '50mb' }));

// ==================== Filter Functions ====================

function isUnityTestXml(content) {
  const trimmed = content.trim();
  return trimmed.startsWith('<?xml') && trimmed.includes('<test-run') && (trimmed.includes('testcasecount') || trimmed.includes('<test-case'));
}

function parseCData(xmlContent, tagName) {
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([^\\]]*(?:\\](?!\\])[^\\]]*)*)\\]\\]>\\s*</${tagName}>`, 'gis');
  const matches = [];
  let match;
  while ((match = cdataRegex.exec(xmlContent)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}

function extractTestName(xmlLine) {
  const nameMatch = xmlLine.match(/name="([^"]+)"/);
  return nameMatch ? nameMatch[1] : null;
}

function extractFullname(xmlLine) {
  const fullnameMatch = xmlLine.match(/fullname="([^"]+)"/);
  return fullnameMatch ? fullnameMatch[1] : null;
}

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

  const summaryMatch = xmlContent.match(/<test-run[^>]*total="(\d+)"[^>]*passed="(\d+)"[^>]*failed="(\d+)"[^>]*skipped="(\d+)"/);
  if (summaryMatch) {
    totalTests = parseInt(summaryMatch[1]) || 0;
    passedTests = parseInt(summaryMatch[2]) || 0;
    failedTestsCount = parseInt(summaryMatch[3]) || 0;
    skippedTests = parseInt(summaryMatch[4]) || 0;
  }

  let inFailedTestCase = false;
  let currentTest = null;
  let captureStack = false;
  let captureOutput = false;
  let currentIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

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
    }

    if (inFailedTestCase && currentTest) {
      if (trimmed.includes('<message>') && trimmed.includes('<![CDATA[')) {
        const cdataContent = trimmed.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
        if (cdataContent) {
          currentTest.message = cdataContent[1].trim();
        }
      } else if (trimmed.includes('<stack-trace>')) {
        captureStack = true;
        const cdataStart = trimmed.match(/<stack-trace>\s*<!\[CDATA\[([\s\S]*)/);
        if (cdataStart && cdataStart[1]) {
          currentTest.stackTrace = cdataStart[1];
        }
      } else if (captureStack) {
        if (trimmed.includes(']]>') && trimmed.includes('</stack-trace>')) {
          const endContent = trimmed.match(/([\s\S]*?)\]\]>\s*<\/stack-trace>/);
          if (endContent) {
            currentTest.stackTrace += endContent[1];
          }
          captureStack = false;
        } else {
          currentTest.stackTrace += '\n' + trimmed;
        }
      }

      if (trimmed.includes('<output>')) {
        captureOutput = true;
        const cdataStart = trimmed.match(/<output>\s*<!\[CDATA\[([\s\S]*)/);
        if (cdataStart && cdataStart[1]) {
          currentTest.output = cdataStart[1];
        }
      } else if (captureOutput) {
        if (trimmed.includes(']]>') && trimmed.includes('</output>')) {
          const endContent = trimmed.match(/([\s\S]*?)\]\]>\s*<\/output>/);
          if (endContent) {
            currentTest.output += endContent[1];
          }
          captureOutput = false;
        } else if (trimmed.length > 0 && !trimmed.includes('<output>') && !trimmed.includes('<![CDATA[')) {
          currentTest.output += trimmed + '\n';
        }
      }

      if (currentTest.stackTrace) {
        const fileMatch = currentTest.stackTrace.match(/([A-Za-z0-9_]+\.cs):(\d+)/);
        if (fileMatch) {
          filesSet.add(fileMatch[1]);
        }
      }

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
    files: []
  };

  let errorCount = 0;
  let warningCount = 0;
  const filesSet = new Set();

  const errorPatterns = [
    /\berror [A-Z]+\d+:/i,
    /\berror MSB\d+:/i,
    /\berror LNK\d+:/i,
    /\bfatal error\b/i,
    /\bERROR:/i,
    /\): error :/i,
    /\): error \w/i,
    /\bSetEnv task failed/i,
    /\bfailed unexpectedly/i,
    /\bCannot open include file/i,
    /\bunresolved external symbol/i
  ];

  const warningPattern = /\bwarning [A-Z]+\d+:/i;
  const filePattern = /([a-zA-Z0-9_]+\.(cpp|h|hpp|cs))\(?(\d+)?\)?/;

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isError = errorPatterns.some(p => p.test(line));
    const isWarning = !isError && warningPattern.test(line);

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

      if (contextLines > 0) {
        const start = Math.max(0, i - contextLines);
        errorBlock.context = lines.slice(start, i).map(l => l.trim());
      }

      const fileMatch = line.match(filePattern);
      if (fileMatch) {
        errorBlock.file = fileMatch[1];
        errorBlock.lineNumber = fileMatch[3] ? parseInt(fileMatch[3]) : null;
      }

      results.errors.push(errorBlock);
    }

    if (showWarnings && isWarning && warningCount < maxWarnings && matchesFile) {
      warningCount++;
      results.summary.warningCount = warningCount;
      const warningBlock = {
        line: i + 1,
        message: line.trim()
      };

      const fileMatch = line.match(filePattern);
      if (fileMatch) {
        warningBlock.file = fileMatch[1];
        warningBlock.lineNumber = fileMatch[3] ? parseInt(fileMatch[3]) : null;
      }

      results.warnings.push(warningBlock);
    }
  }

  let output = [];
  output.push(`# Build Log Filtered Output`);
  output.push(`# Original: ${results.summary.totalLines} lines`);
  output.push(`# Found: ${results.summary.errorCount} errors, ${results.summary.warningCount} warnings`);
  output.push('');

  if (results.errors.length > 0) {
    output.push(`## ERRORS (${results.errors.length})`);
    output.push('');
    results.errors.forEach((err, index) => {
      output.push(`### Error ${index + 1} at line ${err.line}`);
      if (err.file) {
        output.push(`**File:** ${err.file}${err.lineNumber ? `:${err.lineNumber}` : ''}`);
      }
      if (err.context && err.context.length > 0) {
        output.push('**Context:**');
        err.context.forEach(ctx => output.push(`> ${ctx}`));
      }
      output.push(`**${err.message}**`);
      output.push('');
    });
  }

  if (showWarnings && results.warnings.length > 0) {
    output.push(`## WARNINGS (${results.warnings.length})`);
    output.push('');
    results.warnings.forEach(warn => {
      const fileInfo = warn.file ? ` (${warn.file}${warn.lineNumber ? `:${warn.lineNumber}` : ''})` : '';
      output.push(`- Line ${warn.line}${fileInfo}: ${warn.message}`);
    });
    output.push('');
  }

  results.summary.filteredLines = output.length;
  results.filteredContent = output.join('\n');
  return results;
}

// ==================== Web API Routes ====================

// Determine public path based on environment
// On Vercel, included files are relative to the function
const publicPath = process.env.VERCEL 
  ? path.join(__dirname, '..', 'public')
  : path.join(__dirname, '../public');

// Explicitly serve static files (needed for Vercel serverless)
app.get('/style.css', (req, res) => {
  const filePath = path.join(publicPath, 'style.css');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found', path: filePath, cwd: process.cwd() });
  }
  res.setHeader('Content-Type', 'text/css');
  res.sendFile(filePath);
});

app.get('/app.js', (req, res) => {
  const filePath = path.join(publicPath, 'app.js');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found', path: filePath, cwd: process.cwd() });
  }
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(filePath);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'build-log-filter',
    version: '1.0.0',
    features: ['web-gui', 'mcp-http'],
    publicPath: publicPath,
    cwd: process.cwd(),
    vercel: process.env.VERCEL || false
  });
});

app.post('/api/filter', (req, res) => {
  try {
    const { content, logContent, options = {} } = req.body;
    const finalContent = content || logContent;
    
    if (!finalContent) {
      return res.status(400).json({ error: 'No content provided' });
    }

    const isUnity = isUnityTestXml(finalContent);
    let result;

    if (isUnity) {
      result = filterUnityTestResults(finalContent, {
        showStackTraces: options.showStackTraces !== false,
        showOutput: options.showOutput !== false,
        maxErrors: options.maxErrors || 9999
      });
    } else {
      result = filterBuildLog(finalContent, {
        showWarnings: options.showWarnings !== false,
        contextLines: options.contextLines || 0,
        maxErrors: options.maxErrors || 9999,
        maxWarnings: options.maxWarnings || 9999,
        fileFilter: options.fileFilter || null,
        fileFilters: options.fileFilters || []
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Filter error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/load-file', (req, res) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'No file path provided' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, size: content.length });
  } catch (error) {
    console.error('Load file error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== MCP Server Setup ====================

const mcpServer = new Server(
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

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
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

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'filter_build_log': {
        const result = filterBuildLog(args.logContent, {
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
        const result = filterUnityTestResults(args.xmlContent, {
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
        const isUnity = isUnityTestXml(args.content);
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
        const isUnity = isUnityTestXml(content);

        if (isUnity) {
          const result = filterUnityTestResults(content, {
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
          const result = filterBuildLog(content, {
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

// ==================== MCP HTTP Transport ====================

// Handle MCP requests on /mcp endpoint
// In stateless mode, create a new transport for each request
app.post('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for serverless
    });
    
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
    
    res.on('close', () => {
      transport.close();
    });
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error'
        },
        id: null
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed. Use POST for MCP requests.'
    },
    id: null
  });
});

// ==================== Start Server ====================

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n╔════════════════════════════════════════════════════════════╗`);
    console.log(`║  Build Log Filter Server                                   ║`);
    console.log(`╠════════════════════════════════════════════════════════════╣`);
    console.log(`║  Web GUI:   http://localhost:${PORT}/                          ║`);
    console.log(`║  MCP HTTP:  http://localhost:${PORT}/mcp                       ║`);
    console.log(`║  Health:    http://localhost:${PORT}/api/health                ║`);
    console.log(`╚════════════════════════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
