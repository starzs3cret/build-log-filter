#!/bin/bash
# ai-info.sh - Output project info for AI consumption
# Usage: ./ai-info.sh [build-log-file]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "PROJECT: Build Log Filter GUI"
echo "========================================"
echo ""

# Project info from package.json
echo "📦 PACKAGE INFO"
echo "----------------"
if [ -f package.json ]; then
    node -e "
        const pkg = require('./package.json');
        console.log('Name:        ' + pkg.name);
        console.log('Version:     ' + pkg.version);
        console.log('Description: ' + pkg.description);
        console.log('Main:        ' + pkg.main);
        console.log('Scripts:');
        Object.entries(pkg.scripts).forEach(([k, v]) => {
            console.log('  ' + k + ': ' + v);
        });
    " 2>/dev/null || echo "Node not available or package.json error"
else
    echo "package.json not found"
fi
echo ""

# Server status
echo "🖥️  SERVER STATUS"
echo "-----------------"
PORT=$(grep -oP 'const PORT = \K\d+' server.js 2>/dev/null || echo "3456")
if netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
    echo "Server: RUNNING on port $PORT"
elif ss -tuln 2>/dev/null | grep -q ":$PORT "; then
    echo "Server: RUNNING on port $PORT"
else
    echo "Server: NOT RUNNING (port $PORT)"
    echo "Start with: npm start"
fi
echo ""

# File structure
echo "📁 PROJECT STRUCTURE"
echo "--------------------"
if command -v tree &>/dev/null; then
    tree -L 2 -I 'node_modules|.git' 2>/dev/null || ls -la
else
    find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*' | head -30
fi
echo ""

# Key files info
echo "📄 KEY FILES"
echo "------------"
for file in server.js public/app.js public/index.html; do
    if [ -f "$file" ]; then
        lines=$(wc -l < "$file")
        modified=$(stat -c "%y" "$file" 2>/dev/null | cut -d' ' -f1 || stat -f "%Sm" "$file" 2>/dev/null)
        echo "$file: $lines lines (modified: $modified)"
    fi
done
echo ""

# Git info
echo "🔀 GIT STATUS"
echo "-------------"
if [ -d .git ]; then
    echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
    echo "Last commit:"
    git log -1 --format="  %h - %s (%cr) <%an>" 2>/dev/null || echo "  No commits"
    
    # Check for uncommitted changes
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        echo "⚠️  Uncommitted changes:"
        git status --short 2>/dev/null | head -10
    else
        echo "✅ Working directory clean"
    fi
else
    echo "Not a git repository"
fi
echo ""

# Node/npm info
echo "📋 NODE ENVIRONMENT"
echo "-------------------"
if command -v node &>/dev/null; then
    echo "Node: $(node --version)"
    echo "NPM:  $(npm --version)"
    
    if [ -d node_modules ]; then
        deps=$(ls node_modules | wc -l)
        echo "Dependencies installed: $deps packages"
    else
        echo "⚠️  node_modules not found - run: npm install"
    fi
else
    echo "⚠️  Node.js not installed"
fi
echo ""

# If a build log file is provided, filter it
if [ -n "$1" ] && [ -f "$1" ]; then
    echo "🔍 FILTERED BUILD LOG: $1"
    echo "========================================"
    echo ""
    
    # Check if server is running and use API, otherwise use basic grep
    if curl -s http://localhost:${PORT}/api/filter -X POST \
        -H "Content-Type: application/json" \
        -d "{\"logContent\":$(cat "$1" | jq -s -R .),\"format\":\"full\",\"showWarnings\":true,\"contextLines\":5}" \
        2>/dev/null | jq -r '.filteredContent' 2>/dev/null; then
        :
    else
        # Fallback: basic filtering with grep
        echo "(Server not running, using basic grep filter)"
        echo ""
        grep -n -E "(error|warning|fatal|ERROR|FAILED|Cannot open)" "$1" | head -50 || true
    fi
    echo ""
fi

echo "========================================"
echo "END OF REPORT"
echo "========================================"
