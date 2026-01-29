# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a web-based GUI tool for filtering UE5/Visual Studio build logs and Unity NUnit test results. Build logs can be 3000+ lines (45,000+ tokens), which exceeds AI context windows. This tool filters to only errors and warnings, reducing to ~100 lines (~1,500 tokens).

## Running the Application

```bash
npm install        # Install dependencies (express, cors)
npm start          # Start server on http://localhost:3456
```

The server runs on port 3456 by default. Change the `PORT` constant in `server.js` if needed.

For development with auto-reload:
```bash
npm install -g nodemon
nodemon server.js
```

To run the standalone test (no web server):
```bash
node test-filter.js
```

## Architecture

The application follows a simple client-server architecture:

- **`server.js`**: Express server with three core functions for log filtering:
  - `isUnityTestXml()`: Detects if content is a Unity NUnit test result XML
  - `filterUnityTestResults()`: Parses Unity test XML and extracts failed tests with error messages, stack traces, and console output
  - `filterBuildLog()`: Main filtering logic, returns markdown-formatted output with context lines
  - `formatMinimal()`: Simplified filtering, returns plain text output

- **`public/app.js`**: Frontend that calls `/api/filter` endpoint and handles UI interactions. Auto-detects Unity test results format and displays test summary instead of error/warning counts.

- **`test-filter.js`**: Standalone test version with sample UE5 build log and Unity test XML

## Error Pattern Matching

The core filtering logic matches error/warning patterns using regex. These are defined in both `filterBuildLog()` and `formatMinimal()`:

**Error patterns:**
- `/\berror [A-Z]+\d+:/i` - MSVC errors (e.g., `error C2065:`)
- `/\berror MSB\d+:/i` - MSBuild errors (e.g., `error MSB3073:`)
- `/\berror LNK\d+:/i` - Linker errors (e.g., `error LNK2019:`)
- `/\bfatal error\b/i` - Fatal errors
- `/\bERROR:/i` - UBT errors
- `/\): error :/i` - UHT errors
- `/\bSetEnv task failed/i` - SetEnv errors
- `/\bCannot open include file/i` - Include errors
- `/\bunresolved external symbol/i` - Linker errors

**Warning pattern:**
- `/\bwarning [A-Z]+\d+:/i` - MSVC warnings (e.g., `warning C4101:`)

**File extraction pattern:**
- `/([a-zA-Z0-9_]+\.(cpp|h|hpp|cs))\(?(\d+)?\)?/` - Extracts filenames for the file filter dropdown

## API Endpoints

### POST /api/filter

Filter a build log. Request body:
```json
{
  "logContent": "string",
  "format": "full | minimal",
  "showWarnings": true,
  "contextLines": 10,
  "maxErrors": 100,
  "maxWarnings": 20,
  "fileFilter": "optional_single_file",
  "fileFilters": ["array", "of", "files"],
  "showStackTraces": true,
  "showOutput": true
}
```

**Standard build log response:**
- `filteredContent`: Markdown or plain text output
- `summary`: Stats (totalLines, errorCount, warningCount, filteredLines)
- `files`: Array of unique filenames found in errors/warnings

**Unity test results response** (auto-detected when `format: "unity-test-results"`):
- `filteredContent`: Markdown with failed test details
- `summary`: Stats (totalTests, passed, failed, skipped)
- `errors`: Array of failed test objects (name, fullname, message, stackTrace, output)
- `files`: Array of unique source files from stack traces

### POST /api/load-file

Load log from a file path on the server.

## Adding New Error Patterns

When adding support for new error types, update the regex patterns in BOTH `filterBuildLog()` and `formatMinimal()` in `server.js`. Both functions maintain their own pattern arrays for their specific use cases.

For Unity test results, the filtering uses XML parsing rather than regex patterns. The `filterUnityTestResults()` function:
1. Detects `<test-case>` elements with `result="Failed"`
2. Extracts CDATA content from `<message>`, `<stack-trace>`, and `<output>` elements
3. Parses test summary from the `<test-run>` element attributes
4. Extracts source files from stack traces for the file filter dropdown
