#!/bin/bash
# unity-test-and-filter.sh - Run Unity tests (EditMode + PlayMode) and filter results for AI
# Usage: ./unity-test-and-filter.sh [project_path]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Configuration
UNITY="${UNITY:-/opt/Unity/Editor/Unity}"
PROJECT="${1:-${PROJECT:-$(pwd)}}"

# Output files
EDIT_MODE_RESULTS="$PROJECT/TestResults_EditMode.xml"
PLAY_MODE_RESULTS="$PROJECT/TestResults_PlayMode.xml"
EDIT_MODE_LOG="$PROJECT/unity_editmode.log"
PLAY_MODE_LOG="$PROJECT/unity_playmode.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
EDIT_EXIT=0
PLAY_EXIT=0

echo "========================================"
echo "Unity Test Runner + AI Filter"
echo "========================================"
echo ""
echo "🎮 Unity:    $UNITY"
echo "📁 Project:  $PROJECT"
echo ""

# Check Unity exists
if [ ! -f "$UNITY" ]; then
    echo -e "${RED}❌ Unity not found at: $UNITY${NC}"
    echo "Set UNITY environment variable or edit this script"
    exit 1
fi

echo -e "${GREEN}✅ Unity found${NC}"
echo ""

# ============================================================================
# RUN EDIT MODE TESTS
# ============================================================================
echo -e "${BLUE}▶ Running EditMode Tests...${NC}"
echo "----------------------------------------"

set +e
"$UNITY" -batchmode -nographics -quit \
    -projectPath "$PROJECT" \
    -runTests -testPlatform editmode \
    -testResults "$EDIT_MODE_RESULTS" \
    -logFile "$EDIT_MODE_LOG"
EDIT_EXIT=$?
set -e

echo ""
if [ $EDIT_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ EditMode tests completed${NC}"
else
    echo -e "${YELLOW}⚠️  EditMode tests failed (exit code: $EDIT_EXIT)${NC}"
fi
echo ""

# ============================================================================
# RUN PLAY MODE TESTS
# ============================================================================
echo -e "${BLUE}▶ Running PlayMode Tests...${NC}"
echo "----------------------------------------"

set +e
"$UNITY" -batchmode -nographics -quit \
    -projectPath "$PROJECT" \
    -runTests -testPlatform playmode \
    -testResults "$PLAY_MODE_RESULTS" \
    -logFile "$PLAY_MODE_LOG"
PLAY_EXIT=$?
set -e

echo ""
if [ $PLAY_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ PlayMode tests completed${NC}"
else
    echo -e "${YELLOW}⚠️  PlayMode tests failed (exit code: $PLAY_EXIT)${NC}"
fi
echo ""

# ============================================================================
# FILTER RESULTS
# ============================================================================
echo "========================================"
echo "Filtering Results for AI"
echo "========================================"
echo ""

# Function to filter Unity test results using MCP server
filter_results() {
    local xml_file="$1"
    local test_type="$2"
    
    if [ ! -f "$xml_file" ]; then
        echo -e "${RED}❌ Results file not found: $xml_file${NC}"
        return 1
    fi
    
    echo -e "${BLUE}▶ Filtering $test_type results...${NC}"
    
    # Read and filter using the filter-unity-results.sh script
    "$SCRIPT_DIR/filter-unity-results.sh" "$xml_file" 2>/dev/null || {
        # Fallback: simple grep extraction
        echo -e "${YELLOW}⚠️  Filter script failed, using fallback${NC}"
        echo ""
        echo "## $test_mode Test Results (Raw)"
        echo ""
        grep -o 'failed="[0-9]*"' "$xml_file" | head -1
        grep 'result="Failed"' "$xml_file" | head -20
    }
}

# Filter EditMode results
echo ""
if [ -f "$EDIT_MODE_RESULTS" ]; then
    filter_results "$EDIT_MODE_RESULTS" "EditMode"
else
    echo -e "${YELLOW}⚠️  EditMode results not found${NC}"
fi

# Filter PlayMode results
echo ""
if [ -f "$PLAY_MODE_RESULTS" ]; then
    filter_results "$PLAY_MODE_RESULTS" "PlayMode"
else
    echo -e "${YELLOW}⚠️  PlayMode results not found${NC}"
fi

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "========================================"
echo "SUMMARY"
echo "========================================"
echo ""

# Count failures from XML files
EDIT_FAILED=0
PLAY_FAILED=0

if [ -f "$EDIT_MODE_RESULTS" ]; then
    EDIT_FAILED=$(grep -o 'failed="[0-9]*"' "$EDIT_MODE_RESULTS" | head -1 | grep -o '[0-9]*' || echo "0")
    EDIT_TOTAL=$(grep -o 'total="[0-9]*"' "$EDIT_MODE_RESULTS" | head -1 | grep -o '[0-9]*' || echo "0")
    echo "📊 EditMode: $EDIT_FAILED failed / $EDIT_TOTAL total"
fi

if [ -f "$PLAY_MODE_RESULTS" ]; then
    PLAY_FAILED=$(grep -o 'failed="[0-9]*"' "$PLAY_MODE_RESULTS" | head -1 | grep -o '[0-9]*' || echo "0")
    PLAY_TOTAL=$(grep -o 'total="[0-9]*"' "$PLAY_MODE_RESULTS" | head -1 | grep -o '[0-9]*' || echo "0")
    echo "📊 PlayMode: $PLAY_FAILED failed / $PLAY_TOTAL total"
fi

echo ""
echo "📁 Output Files:"
echo "   EditMode: $EDIT_MODE_RESULTS"
echo "   PlayMode: $PLAY_MODE_RESULTS"
echo "   Logs:     $EDIT_MODE_LOG, $PLAY_MODE_LOG"
echo ""

# Return error if any tests failed
TOTAL_FAILED=$((EDIT_FAILED + PLAY_FAILED))
if [ $TOTAL_FAILED -gt 0 ] || [ $EDIT_EXIT -ne 0 ] || [ $PLAY_EXIT -ne 0 ]; then
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
fi
