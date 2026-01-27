# Build Log Filter GUI

A web-based GUI tool for filtering UE5/Visual Studio build logs before sharing with AI assistants.

**Problem:** Build logs can be 3000+ lines (45,000+ tokens) - too large for AI context windows.
**Solution:** Filter to only errors + warnings, reducing to ~100 lines (1,500 tokens).

---

## Features

- 📋 **Paste & Filter:** Paste raw build log, get filtered output instantly
- 🎛️ **Configurable:** Toggle warnings, adjust context lines, choose format
- 💾 **Save to File:** Export filtered log as `.txt`
- 🌐 **Web Interface:** Clean dark-themed UI
- ⌨️ **Keyboard Shortcuts:** Ctrl+Enter to filter, Ctrl+Shift+C to copy
- 🎯 **Smart Patterns:** Detects UE5, MSVC, MSBuild, and linker errors

---

## Quick Start

### 1. Install Dependencies

```bash
cd tools/build-log-filter
npm install
```

### 2. Start the Server

```bash
npm start
```

### 3. Open in Browser

Navigate to: **http://localhost:3456**

---

## Usage

1. **Copy** your build log from Visual Studio Output window
2. **Paste** into the Input panel (or click "📋 Paste" button)
3. **Click** "🚀 Filter Log" (or press Ctrl+Enter)
4. **Copy** the filtered output (or click "📋 Copy")
5. **Paste** into Claude Code or any AI assistant

---

## Options

| Option | Description |
|--------|-------------|
| **Include warnings** | Show warnings along with errors |
| **Add context lines** | Include N lines before each error |
| **Context lines** | Number of lines (0-50) to include before errors |
| **Format** | Full (with context) or Minimal (errors only) |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Enter` | Filter the log |
| `Ctrl+Shift+C` | Copy output to clipboard |
| `Ctrl+Shift+V` | Paste from clipboard to input |

---

## Error Patterns Detected

| Pattern | Example |
|---------|---------|
| MSVC errors | `error C2065: 'MyFunction': undeclared identifier` |
| MSBuild errors | `error MSB3073: exited with code 5` |
| Linker errors | `error LNK2019: unresolved external symbol` |
| UBT errors | `ERROR: Unknown compilation error` |
| SetEnv error | `SetEnv task failed unexpectedly` |
| Include errors | `Cannot open include file: 'LCCharacterBase.h'` |
| Warnings | `warning C4101: 'unusedVar': unreferenced local variable` |

---

## Project Structure

```
tools/build-log-filter/
├── package.json          # NPM dependencies
├── server.js             # Express server + filtering logic
├── README.md             # This file
└── public/
    ├── index.html        # Main HTML
    ├── style.css         # Dark theme styles
    └── app.js            # Frontend logic
```

---

## API Endpoints

### POST /api/filter

Filter a build log.

**Request:**
```json
{
  "logContent": "string (raw build log)",
  "format": "full | minimal",
  "showWarnings": true,
  "contextLines": 10,
  "maxErrors": 100,
  "maxWarnings": 20
}
```

**Response:**
```json
{
  "summary": {
    "totalLines": 3000,
    "errorCount": 3,
    "warningCount": 47,
    "filteredLines": 150
  },
  "errors": [...],
  "warnings": [...],
  "filteredContent": "string (markdown formatted)"
}
```

---

## Example: Before & After

### Before (Raw Log - 3000 lines)
```
Build started...
1>------ Build started: Project: LastCurierS, Configuration: Development AA64 ------
1>LCCharacterBase.cpp
1>Creating D:\...\Binaries\Win64\LastCurierS.target.mk...
1>Building LastCurierS...
1>[3000 more lines of output...]
1>LCCharacterBase.cpp(42): error C2065: 'ULCStaminaComponent': undeclared identifier
1>[1000 more lines...]
Build FAILED.
```

### After (Filtered - 50 lines)
```
# Build Log Filtered Output
# Original: 3000 lines
# Found: 1 errors, 0 warnings

## ERRORS (1)
### Error at line 1534
Building LastCurierS...
Including: #include "LCCharacterBase.h"
Including: #include "LCStaminaComponent.h"
[Line 1534] LCCharacterBase.cpp(42): error C2065: 'ULCStaminaComponent': undeclared identifier
```

**Result:** 3000 lines → 50 lines (98% reduction)

---

## Troubleshooting

### Port already in use
If port 3456 is busy, edit `server.js` and change the `PORT` variable.

### Nothing happens when clicking Filter
Check browser console (F12) for errors. Ensure server is running.

### Clipboard not working
Some browsers require HTTPS or user permission. Use Ctrl+V/C instead.

---

## Development

```bash
# Watch for changes (using nodemon)
npm install -g nodemon
nodemon server.js
```

---

## License

MIT
