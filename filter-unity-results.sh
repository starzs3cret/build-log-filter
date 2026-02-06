#!/bin/bash
# filter-unity-results.sh - Filter Unity test results XML file for AI
# Usage: ./filter-unity-results.sh [path_to_test_results.xml]
#
# Examples:
#   ./filter-unity-results.sh                           # Find and filter latest TestResults.xml
#   ./filter-unity-results.sh TestResults.xml           # Filter specific file
#   ./filter-unity-results.sh /path/to/results.xml      # Filter file at path

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Find test results file
find_test_results() {
    local search_path="${1:-$(cd .. && pwd)}"
    
    # Check if argument is a direct file path
    if [ -f "$1" ]; then
        echo "$1"
        return 0
    fi
    
    # Search for TestResults.xml in common locations
    local locations=(
        "$search_path/TestResults.xml"
        "$search_path/TestResults/TestResults.xml"
        "./TestResults.xml"
        "./TestResults/TestResults.xml"
        "../TestResults.xml"
        "../TestResults/TestResults.xml"
    )
    
    for loc in "${locations[@]}"; do
        if [ -f "$loc" ]; then
            echo "$loc"
            return 0
        fi
    done
    
    # Find most recent TestResults.xml
    local recent=$(find "$search_path" -name "TestResults.xml" -type f -mtime -1 2>/dev/null | head -1)
    if [ -n "$recent" ]; then
        echo "$recent"
        return 0
    fi
    
    return 1
}

# Get test results file
TEST_FILE="${1:-}"
if [ -z "$TEST_FILE" ]; then
    TEST_FILE=$(find_test_results) || {
        echo -e "${RED}ERROR: Could not find TestResults.xml${NC}"
        echo ""
        echo "Usage: ./filter-unity-results.sh [path/to/TestResults.xml]"
        echo ""
        echo "Searched locations:"
        echo "  ./TestResults.xml"
        echo "  ./TestResults/TestResults.xml"
        echo "  ../TestResults.xml"
        echo "  ../TestResults/TestResults.xml"
        echo "  <project_root>/TestResults.xml"
        echo ""
        echo "Or provide the full path to the XML file."
        exit 1
    }
fi

if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}ERROR: File not found: $TEST_FILE${NC}"
    exit 1
fi

echo "========================================"
echo "Unity Test Results Filter"
echo "========================================"
echo ""
echo "📄 Input File: $(realpath "$TEST_FILE" 2>/dev/null || echo "$TEST_FILE")"
echo "📊 File Size:  $(du -h "$TEST_FILE" | cut -f1)"
echo ""

# Check if it's valid Unity test XML
if ! grep -q '<test-run' "$TEST_FILE" 2>/dev/null; then
    echo -e "${YELLOW}⚠️  Warning: File doesn't appear to be a Unity test results XML${NC}"
    echo "Expected format: NUnit XML with <test-run> root element"
    echo ""
fi

# Start filter server if not running
PORT=$(grep -oP 'const PORT = \K\d+' server.js 2>/dev/null || echo "3456")
SERVER_STARTED=false
SERVER_PID=""

check_server() {
    curl -s http://localhost:${PORT}/api/filter -X POST \
        -H "Content-Type: application/json" \
        -d '{"logContent":"test"}' > /dev/null 2>&1
}

cleanup() {
    if [ "$SERVER_STARTED" = true ] && [ -n "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        echo ""
        echo "🖥️  Server stopped"
    fi
}
trap cleanup EXIT

if ! check_server; then
    echo "🖥️  Starting filter server..."
    node server.js > /dev/null 2>&1 &
    SERVER_PID=$!
    SERVER_STARTED=true
    
    # Wait for server
    for i in {1..15}; do
        sleep 0.3
        if check_server; then
            break
        fi
        if [ $i -eq 15 ]; then
            echo -e "${YELLOW}⚠️  Server failed to start, trying fallback...${NC}"
            SERVER_STARTED=false
        fi
    done
fi

# Read file content
TEST_CONTENT=$(cat "$TEST_FILE")

# Create JSON payload
JSON_PAYLOAD=$(printf '{"logContent":%s,"format":"full","showWarnings":true,"contextLines":5}' "$(echo "$TEST_CONTENT" | jq -s -R .)")

echo "🔍 Filtering..."
echo ""

# Call API
FILTERED_RESULT=$(curl -s http://localhost:${PORT}/api/filter \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$JSON_PAYLOAD" 2>/dev/null || echo "")

# Output result
if [ -n "$FILTERED_RESULT" ] && echo "$FILTERED_RESULT" | jq -e '.filteredContent' > /dev/null 2>&1; then
    FILTERED_CONTENT=$(echo "$FILTERED_RESULT" | jq -r '.filteredContent')
    
    # Print summary stats
    TOTAL_TESTS=$(echo "$FILTERED_RESULT" | jq -r '.summary.totalTests // "N/A"')
    PASSED=$(echo "$FILTERED_RESULT" | jq -r '.summary.passed // "N/A"')
    FAILED=$(echo "$FILTERED_RESULT" | jq -r '.summary.failed // "N/A"')
    SKIPPED=$(echo "$FILTERED_RESULT" | jq -r '.summary.skipped // "N/A"')
    
    echo "📊 Test Summary:"
    echo "  Total:   $TOTAL_TESTS"
    echo "  Passed:  $PASSED"
    echo "  Failed:  $FAILED"
    echo "  Skipped: $SKIPPED"
    echo ""
    echo "========================================"
    echo "FILTERED TEST RESULTS FOR AI"
    echo "========================================"
    echo ""
    echo "$FILTERED_CONTENT"
    echo ""
    echo "========================================"
    echo "END OF FILTERED RESULTS"
    echo "========================================"
    
    # Return non-zero if tests failed
    if [ "$FAILED" != "0" ] && [ "$FAILED" != "N/A" ]; then
        exit 1
    fi
    exit 0
else
    # Fallback parsing
    echo -e "${YELLOW}⚠️  API filter failed, using fallback parsing${NC}"
    echo ""
    
    # Extract basic info from XML
    TOTAL=$(grep -o 'total="[0-9]*"' "$TEST_FILE" | head -1 | grep -o '[0-9]*' || echo "N/A")
    PASSED=$(grep -o 'passed="[0-9]*"' "$TEST_FILE" | head -1 | grep -o '[0-9]*' || echo "N/A")
    FAILED=$(grep -o 'failed="[0-9]*"' "$TEST_FILE" | head -1 | grep -o '[0-9]*' || echo "N/A")
    SKIPPED=$(grep -o 'skipped="[0-9]*"' "$TEST_FILE" | head -1 | grep -o '[0-9]*' || echo "N/A")
    
    echo "📊 Test Summary:"
    echo "  Total:   $TOTAL"
    echo "  Passed:  $PASSED"
    echo "  Failed:  $FAILED"
    echo "  Skipped: $SKIPPED"
    echo ""
    
    if [ "$FAILED" != "0" ] && [ -n "$FAILED" ]; then
        echo "❌ FAILED TESTS:"
        echo ""
        # Extract failed test names
        grep -E '<test-case.*fullname="[^"]+".*result="Failed"' "$TEST_FILE" | \
            sed 's/.*fullname="\([^"]*\)".*/  - \1/' | head -30
        echo ""
    fi
    
    echo "Full XML: $TEST_FILE"
    
    if [ "$FAILED" != "0" ] && [ "$FAILED" != "N/A" ] && [ -n "$FAILED" ]; then
        exit 1
    fi
    exit 0
fi
