# Build Log Filter MCP Server

MCP (Model Context Protocol) integration for filtering build logs and Unity test results directly in AI assistants.

## What is MCP?

MCP (Model Context Protocol) allows AI assistants like Claude Desktop to use external tools. This MCP server exposes the build log filtering functionality as tools that AI can call automatically.

## Installation

### 1. Quick Install

```bash
cd /root/build-log-filter
chmod +x install-mcp.sh
./install-mcp.sh
```

### 2. Manual Configuration

#### Option A: Stdio Transport (Default)

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json` or `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "build-log-filter": {
      "command": "node",
      "args": ["/root/build-log-filter/mcp-server.js"],
      "description": "Filter build logs and Unity test results"
    }
  }
}
```

#### Option B: HTTP Transport

For remote connections or when running as a service:

```bash
# Start the HTTP server
npm run mcp:http
# or
node mcp-http-server.js --port 3000
```

Then configure your MCP client to use HTTP:

```json
{
  "mcpServers": {
    "build-log-filter": {
      "url": "http://localhost:3000/mcp",
      "description": "Filter build logs and Unity test results (HTTP)"
    }
  }
}
```

Environment variables for HTTP server:
- `MCP_HTTP_PORT` - Server port (default: 3000)
- `MCP_HTTP_HOST` - Server host (default: 127.0.0.1)

### 3. Restart Claude Desktop

The tools will appear in Claude's tool palette automatically.

## Available Tools

### 🔧 `filter_build_log`

Filter a build log to extract errors and warnings.

**Parameters:**
- `logContent` (required): The full build log content
- `format`: `"full"` or `"minimal"` (default: `"full"`)
- `showWarnings`: Include warnings (default: `true`)
- `contextLines`: Lines of context before errors (default: `10`)
- `maxErrors`: Max errors to include (default: `100`)
- `maxWarnings`: Max warnings to include (default: `20`)

**Example Usage:**
```
"Filter this build log for errors: [paste 3000 lines]"
```

Claude will automatically call the tool and show you:
```
# Build Log Filtered Output
# Original: 3000 lines
# Found: 5 errors, 12 warnings

## ERRORS (5)
### Error 1 at line 1534
> #include "LCCharacterBase.h"
> #include "LCStaminaComponent.h"
**error C2065: 'ULCStaminaComponent': undeclared identifier**
...
```

### 🎮 `filter_unity_test_results`

Filter Unity NUnit test result XML to extract failed tests.

**Parameters:**
- `xmlContent` (required): The Unity TestResults.xml content
- `showStackTraces`: Include stack traces (default: `true`)
- `showOutput`: Include console output (default: `true`)
- `maxErrors`: Max failed tests to include (default: `100`)

**Example Usage:**
```
"Analyze these Unity test results: [paste XML]"
```

Output:
```
# Unity Test Results - Filtered Output
# Total: 10 | Passed: 8 | Failed: 2 | Skipped: 0

## FAILED TESTS (2)

### 1. OnWeaponHitEnemy_AppliesHeadMultiplier
**Full Name:** `ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesHeadMultiplier`

**Error Message:**
```
Head shot should deal 2.5x damage
Expected: 250
But was:  0
```

**Stack Trace:**
```
at ActionWeather.Player.Tests.MeleeCombatTests.OnWeaponHitEnemy_AppliesHeadMultiplier () 
  in C:\Projects\ActionWeather\Assets\Scripts\Player\Tests\MeleeCombatTests.cs:292
```
```

### 🔍 `detect_log_type`

Auto-detect whether content is a Unity test result XML or build log.

**Parameters:**
- `content` (required): Content to analyze

**Returns:** Detection result with recommended tool to use.

### 📁 `filter_file`

Filter a build log or Unity test results file from disk.

**Parameters:**
- `filePath` (required): Absolute path to the log file
- `format`: `"full"` or `"minimal"` (default: `"full"`)
- `showWarnings`: Include warnings (default: `true`)
- `contextLines`: Context lines before errors (default: `10`)

**Example Usage:**
```
"Filter the build log at /path/to/build.log"
```

## Usage Examples

### With Claude Desktop

1. **Paste a build log directly:**
   ```
   User: "Here's my build log, find the errors: [3000 lines]"
   
   Claude: [Automatically calls filter_build_log]
   
   "Found 3 errors and 12 warnings in your build log..."
   ```

2. **Analyze Unity test failures:**
   ```
   User: "My Unity tests failed, here's the XML: [paste XML]"
   
   Claude: [Automatically calls filter_unity_test_results]
   
   "I found 2 failed tests. Let me analyze the errors..."
   ```

3. **Filter a file on disk:**
   ```
   User: "Check my build log at /home/user/project/build.log"
   
   Claude: [Calls filter_file]
   ```

### Supported Error Patterns

The MCP server detects:
- MSVC errors (`error C2065:`)
- MSBuild errors (`error MSB3073:`)
- Linker errors (`error LNK2019:`)
- UBT errors (`ERROR:`)
- SetEnv errors
- Include errors (`Cannot open include file`)
- Warnings (`warning C4101:`)

## Troubleshooting

### "Tool not found"

1. Check that `mcp-server.js` exists and is executable:
   ```bash
   ls -la /root/build-log-filter/mcp-server.js
   ```

2. Verify Node.js is installed:
   ```bash
   node --version
   ```

3. Check the config path is correct for your OS:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Linux**: `~/.config/claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

### "Permission denied"

Make the script executable:
```bash
chmod +x /root/build-log-filter/mcp-server.js
```

### MCP Server not starting

Run manually to see errors:
```bash
node /root/build-log-filter/mcp-server.js
```

## Other MCP Clients

The MCP server supports both **stdio** and **HTTP** transports:

### Stdio Transport
Works with any MCP-compatible client:
- Claude Desktop
- Claude Code CLI
- Cursor (with MCP support)
- Any custom MCP client

### HTTP Transport
For remote connections or web-based clients:

```bash
# Start HTTP server
node mcp-http-server.js

# Custom port
node mcp-http-server.js --port 8080
```

**HTTP Endpoints:**
- `POST /mcp` - MCP protocol endpoint
- `GET /health` - Health check

**Connecting via HTTP:**
```javascript
// Example: Using with an HTTP-capable MCP client
const client = new MCPClient();
await client.connect("http://localhost:3000/mcp");
```

## License

MIT
