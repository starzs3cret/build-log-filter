#!/bin/bash
# unity-test-ai.sh - Run Unity tests via CLI, filter results, output for AI
# Usage: ./unity-test-ai.sh [unity_path] [project_path] [test_filter]
#
# Examples:
#   ./unity-test-ai.sh                                    # Use defaults
#   ./unity-test-ai.sh /Applications/Unity/Unity.app      # Custom Unity path
#   ./unity-test-ai.sh "" "" "MyTestNamespace"            # Filter by namespace

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default paths (override with arguments)
UNITY_PATH="${1:-${UNITY_PATH:-"/Applications/Unity/Hub/Editor/2022.3.20f1/Unity.app/Contents/MacOS/Unity"}}"
PROJECT_PATH="${2:-${PROJECT_PATH:-"$(cd .. && pwd)"}}"
TEST_FILTER="${3:-${TEST_FILTER:-""}}"

# Test results output path
TEST_RESULTS_DIR="$PROJECT_PATH/TestResults"
TEST_RESULTS_FILE="$TEST_RESULTS_DIR/TestResults.xml"
LOG_FILE="$TEST_RESULTS_DIR/unity_test_log.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "Unity Test Runner + AI Filter"
echo "========================================"
echo ""

# Check Unity exists
if [ ! -f "$UNITY_PATH" ]; then
    # Try Windows path
    UNITY_PATH="${UNITY_PATH//\//\\}"
    if [ ! -f "$UNITY_PATH" ] && [ ! -f "${UNITY_PATH}.exe" ]; then
        echo -e "${RED}ERROR: Unity not found at: $UNITY_PATH${NC}"
        echo ""
        echo "Usage: ./unity-test-ai.sh [unity_path] [project_path] [test_filter]"
        echo ""
        echo "Examples:"
        echo "  # macOS:"
        echo "  ./unity-test-ai.sh /Applications/Unity/Hub/Editor/2022.3.20f1/Unity.app/Contents/MacOS/Unity"
        echo ""
        echo "  # Windows:"
        echo "  ./unity-test-ai.sh 'C:/Program Files/Unity/Hub/Editor/2022.3.20f1/Editor/Unity.exe'"
        echo ""
        echo "  # Or set environment variable:"
        echo "  export UNITY_PATH=/path/to/Unity"
        echo "  ./unity-test-ai.sh"
        exit 1
    fi
fi

# Create test results directory
mkdir -p "$TEST_RESULTS_DIR"

echo "🎮 Unity Path:    $UNITY_PATH"
echo "📁 Project Path:  $PROJECT_PATH"
echo "🔍 Test Filter:   ${TEST_FILTER:-"(all tests)"}"
echo "📄 Results File:  $TEST_RESULTS_FILE"
echo ""

# Build Unity test arguments
UNITY_ARGS=(
    -batchmode
    -nographics
    -silent-crashes
    -projectPath "$PROJECT_PATH"
    -runTests
    -testResults "$TEST_RESULTS_FILE"
    -logFile "$LOG_FILE"
)

# Add test filter if provided
if [ -n "$TEST_FILTER" ]; then
    UNITY_ARGS+=(-testFilter "$TEST_FILTER")
fi

# Add test platform (default to EditMode)
UNITY_ARGS+=(-testPlatform EditMode)

echo "🚀 Running Unity Tests..."
echo "Command: $UNITY_PATH ${UNITY_ARGS[*]}"
echo ""

# Run Unity tests
set +e
"$UNITY_PATH" "${UNITY_ARGS[@]}"
UNITY_EXIT_CODE=$?
set -e

echo ""
echo "========================================"
echo "Unity Exit Code: $UNITY_EXIT_CODE"
echo "========================================"
echo ""

# Check if test results file was created
if [ ! -f "$TEST_RESULTS_FILE" ]; then
    echo -e "${RED}ERROR: Test results file not found!${NC}"
    echo "Expected: $TEST_RESULTS_FILE"
    echo ""
    echo "Unity Log ($LOG_FILE):"
    if [ -f "$LOG_FILE" ]; then
        tail -50 "$LOG_FILE"
    else
        echo "(No log file found)"
    fi
    exit 1
fi

echo "✅ Test results file created"
echo ""

# Start the filter server if not running
PORT=$(grep -oP 'const PORT = \K\d+' server.js 2>/dev/null || echo "3456")
SERVER_STARTED=false

check_server() {
    curl -s http://localhost:${PORT}/api/filter -X POST \
        -H "Content-Type: application/json" \
        -d '{"logContent":"test"}' > /dev/null 2>&1
}

if ! check_server; then
    echo "🖥️  Starting filter server on port $PORT..."
    node server.js &
    SERVER_PID=$!
    SERVER_STARTED=true
    
    # Wait for server to start
    for i in {1..10}; do
        sleep 0.5
        if check_server; then
            echo "✅ Server started (PID: $SERVER_PID)"
            break
        fi
        if [ $i -eq 10 ]; then
            echo -e "${YELLOW}⚠️  Server failed to start, using fallback filtering${NC}"
            SERVER_STARTED=false
        fi
    done
    echo ""
fi

# Read and filter test results
echo "🔍 Filtering test results..."
echo ""

# Read the XML file
TEST_CONTENT=$(cat "$TEST_RESULTS_FILE")

# Create JSON payload
JSON_PAYLOAD=$(printf '{"logContent":%s,"format":"full","showWarnings":true,"contextLines":5}' "$(echo "$TEST_CONTENT" | jq -s -R .)")

# Call the filter API
FILTERED_RESULT=$(curl -s http://localhost:${PORT}/api/filter \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" 2>/dev/null || echo "")

# Extract filtered content
if [ -n "$FILTERED_RESULT" ] && echo "$FILTERED_RESULT" | jq -e '.filteredContent' > /dev/null 2>&1; then
    FILTERED_CONTENT=$(echo "$FILTERED_RESULT" | jq -r '.filteredContent')
    SUMMARY=$(echo "$FILTERED_RESULT" | jq -r '.summary // empty')
    
    # Stop server if we started it
    if [ "$SERVER_STARTED" = true ]; then
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        echo "🖥️  Server stopped"
        echo ""
    fi
    
    # Output the filtered result for AI
    echo "========================================"
    echo "FILTERED TEST RESULTS FOR AI"
    echo "========================================"
    echo ""
    echo "$FILTERED_CONTENT"
    echo ""
    echo "========================================"
    echo "END OF FILTERED RESULTS"
    echo "========================================"
    echo ""
    
    # Show summary
    if [ -n "$SUMMARY" ]; then
        echo "📊 Summary:"
        echo "$SUMMARY" | jq -r 'to_entries[] | "  \(.key): \(.value)"' 2>/dev/null || echo "$SUMMARY"
    fi
    
else
    # Fallback: Output raw XML if filtering fails
    echo -e "${YELLOW}⚠️  API filtering failed, outputting raw results...${NC}"
    echo ""
    
    # Stop server if we started it
    if [ "$SERVER_STARTED" = true ]; then
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
    fi
    
    echo "========================================"
    echo "RAW TEST RESULTS (XML)"
    echo "========================================"
    echo ""
    
    # Extract failed tests from XML using grep/sed as fallback
    echo "Failed Tests:"
    grep -o 'result="Failed"[^>]*' "$TEST_RESULTS_FILE" | wc -l | xargs echo "  Count:"
    
    # Try to extract test names
    grep -E '<test-case.*name="[^"]+"' "$TEST_RESULTS_FILE" | grep 'result="Failed"' | sed 's/.*name="\([^"]*\)".*/  - \1/' | head -20
    
    echo ""
    echo "Full XML saved to: $TEST_RESULTS_FILE"
fi

# Cleanup
if [ "$UNITY_EXIT_CODE" -ne 0 ] && [ "$UNITY_EXIT_CODE" -ne 2 ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Unity exited with code $UNITY_EXIT_CODE (may indicate test failures)${NC}"
fi

echo ""
echo "========================================"
echo "Test Results File: $TEST_RESULTS_FILE"
echo "Unity Log File:    $LOG_FILE"
echo "========================================"

exit 0
