#!/bin/bash
# find-unity.sh - Find Unity installation on your system
# Usage: ./find-unity.sh

set -e

echo "========================================"
echo "Unity Auto-Detection"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

FOUND=()

# 1. Check environment variable
echo "🔍 Checking UNITY environment variable..."
if [ -n "$UNITY" ]; then
    if [ -f "$UNITY" ]; then
        echo -e "  ${GREEN}✅ UNITY=$UNITY${NC}"
        FOUND+=("env:$UNITY")
    else
        echo -e "  ${YELLOW}⚠️  UNITY set but file not found: $UNITY${NC}"
    fi
else
    echo "  (not set)"
fi
echo ""

# 2. Check PATH
echo "🔍 Checking PATH..."
UNITY_IN_PATH=$(which unity 2>/dev/null || true)
if [ -n "$UNITY_IN_PATH" ]; then
    echo -e "  ${GREEN}✅ Found in PATH: $UNITY_IN_PATH${NC}"
    FOUND+=("path:$UNITY_IN_PATH")
else
    echo "  (not in PATH)"
fi
echo ""

# 3. Common Linux locations
echo "🔍 Checking common Linux locations..."
LINUX_PATHS=(
    "/opt/Unity/Editor/Unity"
    "/opt/unity/Editor/Unity"
    "/usr/bin/unity"
    "/usr/local/bin/unity"
    "/opt/UnityHub/Editor/Unity"
)

for path in "${LINUX_PATHS[@]}"; do
    if [ -f "$path" ]; then
        echo -e "  ${GREEN}✅ $path${NC}"
        FOUND+=("linux:$path")
    fi
done
echo ""

# 4. Unity Hub installations
echo "🔍 Checking Unity Hub editor installations..."
HUB_PATHS=(
    "$HOME/Unity/Hub/Editor"
    "$HOME/.config/unity3d/Unity/Hub/Editor"
    "$HOME/.local/share/unity3d/Unity/Hub/Editor"
    "/opt/Unity/Hub/Editor"
    "/Applications/Unity/Hub/Editor"
)

for hub_path in "${HUB_PATHS[@]}"; do
    if [ -d "$hub_path" ]; then
        echo "  📁 Found Hub: $hub_path"
        
        # Find Unity versions
        while IFS= read -r unity_exe; do
            # Extract version from path
            version=$(echo "$unity_exe" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[a-z0-9]*' | head -1 || echo "unknown")
            echo -e "     ${GREEN}✅ Version $version${NC}"
            echo "        $unity_exe"
            FOUND+=("hub:$unity_exe")
        done < <(find "$hub_path" -maxdepth 3 -name "Unity" -type f 2>/dev/null | sort -V)
    fi
done

if [ ${#FOUND[@]} -eq 0 ]; then
    echo "  (no Hub installations found)"
fi
echo ""

# 5. macOS locations
echo "🔍 Checking macOS locations..."
MACOS_GLOBS=(
    "/Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity"
    "/Applications/Unity/Unity.app/Contents/MacOS/Unity"
    "$HOME/Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity"
)

for glob in "${MACOS_GLOBS[@]}"; do
    for path in $glob; do
        if [ -f "$path" ]; then
            echo -e "  ${GREEN}✅ $path${NC}"
            FOUND+=("macos:$path")
        fi
    done
done
echo ""

# 6. Windows locations (WSL)
echo "🔍 Checking Windows locations (WSL)..."
WINDOWS_GLOBS=(
    "/mnt/c/Program Files/Unity/Hub/Editor/*/Editor/Unity.exe"
    "/mnt/c/Program Files (x86)/Unity/Editor/Unity.exe"
    "/mnt/c/Unity/Hub/Editor/*/Editor/Unity.exe"
)

for glob in "${WINDOWS_GLOBS[@]}"; do
    for path in $glob; do
        if [ -f "$path" ]; then
            echo -e "  ${GREEN}✅ $path${NC}"
            FOUND+=("windows:$path")
        fi
    done
done
echo ""

# Summary
if [ ${#FOUND[@]} -eq 0 ]; then
    echo "========================================"
    echo -e "${RED}❌ Unity not found${NC}"
    echo "========================================"
    echo ""
    echo "To fix:"
    echo ""
    echo "1. Install Unity Hub from: https://unity.com/download"
    echo ""
    echo "2. Or download Unity directly and create a symlink:"
    echo "   sudo ln -s /your/unity/path /usr/local/bin/unity"
    echo ""
    echo "3. Or set the UNITY environment variable:"
    echo "   export UNITY=/path/to/Unity"
    echo ""
    exit 1
else
    echo "========================================"
    echo -e "${GREEN}✅ Found ${#FOUND[@]} Unity installation(s)${NC}"
    echo "========================================"
    echo ""
    
    # Show first found as recommended
    first="${FOUND[0]}"
    unity_path="${first#*:}"
    
    echo "Recommended path:"
    echo "  export UNITY=\"$unity_path\""
    echo ""
    echo "Or use directly:"
    echo "  UNITY=\"$unity_path\" ./unity-ci.sh"
    echo ""
    exit 0
fi
