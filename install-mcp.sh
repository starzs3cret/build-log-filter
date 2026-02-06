#!/bin/bash
# install-mcp.sh - Install Build Log Filter MCP Server
# Usage: ./install-mcp.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "Build Log Filter MCP - Installation"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Install MCP SDK if not already installed
echo "📦 Installing MCP SDK..."
if npm list @modelcontextprotocol/sdk &>/dev/null; then
    echo "✅ MCP SDK already installed"
else
    npm install @modelcontextprotocol/sdk
    echo "✅ MCP SDK installed"
fi
echo ""

# Detect OS and determine config path
OS="$(uname -s)"
case "$OS" in
    Linux*)     CONFIG_DIR="$HOME/.config/claude";;
    Darwin*)    CONFIG_DIR="$HOME/Library/Application Support/Claude";;
    CYGWIN*|MINGW*|MSYS*) CONFIG_DIR="$HOME/AppData/Roaming/Claude";;
    *)          CONFIG_DIR="$HOME/.config/claude";;
esac

CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

echo "🔧 Configuration Directory: $CONFIG_DIR"
echo "📄 Config File: $CONFIG_FILE"
echo ""

# Create config directory if needed
mkdir -p "$CONFIG_DIR"

# MCP Server entry
MCP_ENTRY=$(cat <<EOF
    "build-log-filter": {
      "command": "node",
      "args": ["$SCRIPT_DIR/mcp-server.js"],
      "description": "Filter build logs and Unity test results"
    }
EOF
)

# Check if config exists
if [ -f "$CONFIG_FILE" ]; then
    echo "⚠️  Existing Claude Desktop config found"
    
    # Check if our MCP is already in config
    if grep -q "build-log-filter" "$CONFIG_FILE"; then
        echo "✅ Build Log Filter MCP already configured"
    else
        echo "➕ Adding Build Log Filter MCP to config..."
        
        # Backup original
        cp "$CONFIG_FILE" "$CONFIG_FILE.backup.$(date +%Y%m%d%H%M%S)"
        
        # Read current config
        CONFIG_CONTENT=$(cat "$CONFIG_FILE")
        
        # Check if mcpServers exists
        if echo "$CONFIG_CONTENT" | grep -q '"mcpServers"'; then
            # Add to existing mcpServers
            # This is a simple approach - for complex configs, manual edit may be needed
            echo ""
            echo "${YELLOW}Please manually add this to your $CONFIG_FILE:${NC}"
            echo ""
            echo "\"mcpServers\": {"
            echo "  ... existing servers ..."
            echo "  $MCP_ENTRY"
            echo "}"
            echo ""
        else
            # Add mcpServers section
            echo "$CONFIG_CONTENT" | jq --arg entry "$MCP_ENTRY" '. + {"mcpServers": {($entry): {}}}' > "$CONFIG_FILE.tmp" 2>/dev/null || {
                echo "${YELLOW}Could not auto-merge config. Please manually add:${NC}"
                echo ""
                cat <<EOF
{
  "mcpServers": {
$MCP_ENTRY
  }
}
EOF
                echo ""
                exit 0
            }
            mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
            echo "✅ Config updated"
        fi
    fi
else
    # Create new config
    echo "📝 Creating new Claude Desktop config..."
    cat > "$CONFIG_FILE" <<EOF
{
  "mcpServers": {
$MCP_ENTRY
  }
}
EOF
    echo "✅ Config created at: $CONFIG_FILE"
fi

echo ""
echo "========================================"
echo "${GREEN}✅ Installation Complete!${NC}"
echo "========================================"
echo ""
echo "📖 Available Tools:"
echo "   • filter_build_log - Filter build logs for errors/warnings"
echo "   • filter_unity_test_results - Filter Unity test XML"
echo "   • detect_log_type - Auto-detect log type"
echo "   • filter_file - Filter a file from disk"
echo ""
echo "🚀 Next Steps:"
echo "   1. Restart Claude Desktop (if using)"
echo "   2. The tools will appear in Claude's tool palette"
echo ""
echo "📁 Config Location: $CONFIG_FILE"
echo ""
