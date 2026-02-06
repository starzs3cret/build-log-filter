#!/bin/bash
# unity-ci.sh - Run Unity tests (EditMode + PlayMode) and output filtered results for AI
# Usage: ./unity-ci.sh [project_path]
#
# Environment Variables:
#   UNITY - Path to Unity executable (auto-detected if not set)
#   PROJECT - Unity project path (default: current directory)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ============================================================================
# UNITY AUTO-DETECTION
# ============================================================================

detect_unity() {
    local unity_path=""
    
    # 1. Check environment variable first
    if [ -n "$UNITY" ] && [ -f "$UNITY" ]; then
        echo "$UNITY"
        return 0
    fi
    
    # 2. Try 'which unity' command
    unity_path=$(which unity 2>/dev/null || true)
    if [ -n "$unity_path" ] && [ -f "$unity_path" ]; then
        echo "$unity_path"
        return 0
    fi
    
    # 3. Check common Linux locations
    local linux_paths=(
        "/opt/Unity/Editor/Unity"
        "/opt/unity/Editor/Unity"
        "/usr/bin/unity"
        "/usr/local/bin/unity"
        "/opt/UnityHub/Editor/Unity"
        "$HOME/Unity/Hub/Editor/*/Editor/Unity"
        "$HOME/Applications/Unity/Hub/Editor/*/Editor/Unity"
        "/Applications/Unity/Hub/Editor/*/Editor/Unity"
    )
    
    for path in "${linux_paths[@]}"; do
        # Handle wildcards
        if [[ "$path" == *"*"* ]]; then
            # Find the most recent version
            unity_path=$(ls -1 $path 2>/dev/null | sort -V | tail -1 || true)
            if [ -n "$unity_path" ] && [ -f "$unity_path" ]; then
                echo "$unity_path"
                return 0
            fi
        elif [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    # 4. Check Unity Hub editor installations
    local hub_paths=(
        "$HOME/Unity/Hub/Editor"
        "$HOME/.config/unity3d/Unity/Hub/Editor"
        "$HOME/.local/share/unity3d/Unity/Hub/Editor"
        "/opt/Unity/Hub/Editor"
        "/Applications/Unity/Hub/Editor"
    )
    
    for hub_path in "${hub_paths[@]}"; do
        if [ -d "$hub_path" ]; then
            # Find the most recent Unity version
            unity_path=$(find "$hub_path" -name "Unity" -type f -executable 2>/dev/null | \
                while read f; do
                    # Extract version from path
                    version=$(echo "$f" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+[a-z0-9]*' | head -1)
                    echo "$version|$f"
                done | sort -V | tail -1 | cut -d'|' -f2)
            
            if [ -n "$unity_path" ] && [ -f "$unity_path" ]; then
                echo "$unity_path"
                return 0
            fi
        fi
    done
    
    # 5. Check Windows paths (via Wine or WSL)
    local windows_paths=(
        "/mnt/c/Program Files/Unity/Hub/Editor/*/Editor/Unity.exe"
        "/mnt/c/Program Files (x86)/Unity/Editor/Unity.exe"
        "$HOME/.wine/drive_c/Program Files/Unity/Editor/Unity.exe"
    )
    
    for path in "${windows_paths[@]}"; do
        if [[ "$path" == *"*"* ]]; then
            unity_path=$(ls -1 $path 2>/dev/null | sort -V | tail -1 || true)
            if [ -n "$unity_path" ] && [ -f "$unity_path" ]; then
                echo "$unity_path"
                return 0
            fi
        elif [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    # 6. macOS locations
    local macos_paths=(
        "/Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity"
        "/Applications/Unity/Unity.app/Contents/MacOS/Unity"
        "$HOME/Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity"
    )
    
    for path in "${macos_paths[@]}"; do
        if [[ "$path" == *"*"* ]]; then
            unity_path=$(ls -1 $path 2>/dev/null | sort -V | tail -1 || true)
            if [ -n "$unity_path" ] && [ -f "$unity_path" ]; then
                echo "$unity_path"
                return 0
            fi
        elif [ -f "$path" ]; then
            echo "$path"
            return 0
        fi
    done
    
    # Not found
    return 1
}

# Get Unity path
UNITY=$(detect_unity) || UNITY=""

# ============================================================================
# CONFIGURATION
# ============================================================================

PROJECT="${1:-${PROJECT:-$(pwd)}}"
RESULTS_DIR="$PROJECT"
EDIT_XML="$RESULTS_DIR/TestResults_EditMode.xml"
PLAY_XML="$RESULTS_DIR/TestResults_PlayMode.xml"
EDIT_LOG="$RESULTS_DIR/unity_editmode.log"
PLAY_LOG="$RESULTS_DIR/unity_playmode.log"

EDIT_EXIT=0
PLAY_EXIT=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

print_header() {
    echo ""
    echo "========================================"
    echo "$1"
    echo "========================================"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
    echo "----------------------------------------"
}

filter_unity_xml() {
    local xml_file="$1"
    local title="$2"
    
    if [ ! -f "$xml_file" ]; then
        echo -e "${RED}❌ Results file not found: $xml_file${NC}"
        return 1
    fi
    
    local content
    content=$(cat "$xml_file")
    
    local total passed failed skipped
    total=$(echo "$content" | grep -o 'total="[0-9]*"' | head -1 | grep -o '[0-9]*' || echo "0")
    passed=$(echo "$content" | grep -o 'passed="[0-9]*"' | head -1 | grep -o '[0-9]*' || echo "0")
    failed=$(echo "$content" | grep -o 'failed="[0-9]*"' | head -1 | grep -o '[0-9]*' || echo "0")
    skipped=$(echo "$content" | grep -o 'skipped="[0-9]*"' | head -1 | grep -o '[0-9]*' || echo "0")
    
    echo "# Unity Test Results - $title"
    echo "# Total: $total | Passed: $passed | Failed: $failed | Skipped: $skipped"
    echo ""
    
    if [ "$failed" = "0" ] || [ -z "$failed" ]; then
        echo "## ✅ All tests passed!"
        echo ""
        return 0
    fi
    
    echo "## ❌ FAILED TESTS ($failed)"
    echo ""
    
    # Parse XML to extract failed tests
    local in_test_case=false
    local in_failure=false
    local in_message=false
    local in_stacktrace=false
    local in_output=false
    
    local test_name=""
    local test_fullname=""
    local test_message=""
    local test_stack=""
    local test_output=""
    local cdata_content=""
    
    local test_count=0
    
    while IFS= read -r line; do
        # Detect test case start
        if [[ "$line" =~ '<test-case' ]] && [[ "$line" =~ result=\"Failed\" ]]; then
            in_test_case=true
            test_name=$(echo "$line" | grep -o 'name="[^"]*"' | head -1 | sed 's/name="//;s/"$//')
            test_fullname=$(echo "$line" | grep -o 'fullname="[^"]*"' | head -1 | sed 's/fullname="//;s/"$//')
            test_count=$((test_count + 1))
            
            test_message=""
            test_stack=""
            test_output=""
            
            echo "### $test_count. $test_name"
            if [ -n "$test_fullname" ] && [ "$test_fullname" != "$test_name" ]; then
                echo "**Full Name:** \`$test_fullname\`"
            fi
            echo ""
        fi
        
        # Detect CDATA sections
        if [[ "$line" =~ '<!\[CDATA\[' ]]; then
            cdata_content=$(echo "$line" | sed 's/.*<!\[CDATA\[//;s/\]\]>.*//')
            # Handle multi-line CDATA
            if [[ "$line" =~ \]\]>$ ]]; then
                # Single line CDATA
                if $in_message; then
                    test_message="$cdata_content"
                elif $in_stacktrace; then
                    test_stack="$cdata_content"
                elif $in_output; then
                    test_output="$cdata_content"
                fi
            fi
        fi
        
        # Section detection
        if [[ "$line" =~ '<message>' ]] || [[ "$line" =~ '<message><!\[CDATA\[' ]]; then
            in_message=true
            in_stacktrace=false
            in_output=false
            # Extract inline CDATA
            if [[ "$line" =~ <!\[CDATA\[.*\]\]> ]]; then
                test_message=$(echo "$line" | sed 's/.*<!\[CDATA\[//;s/\]\]>.*//')
            fi
        elif [[ "$line" =~ '</message>' ]]; then
            in_message=false
            if [ -n "$test_message" ]; then
                echo "**Error Message:**"
                echo '```'
                echo "$test_message"
                echo '```'
                echo ""
            fi
        fi
        
        if [[ "$line" =~ '<stack-trace>' ]] || [[ "$line" =~ '<stack-trace><!\[CDATA\[' ]]; then
            in_message=false
            in_stacktrace=true
            in_output=false
            if [[ "$line" =~ <!\[CDATA\[.*\]\]> ]]; then
                test_stack=$(echo "$line" | sed 's/.*<!\[CDATA\[//;s/\]\]>.*//')
            fi
        elif [[ "$line" =~ '</stack-trace>' ]]; then
            in_stacktrace=false
            if [ -n "$test_stack" ]; then
                echo "**Stack Trace:**"
                echo '```'
                echo "$test_stack"
                echo '```'
                echo ""
            fi
        fi
        
        if [[ "$line" =~ '<output>' ]] || [[ "$line" =~ '<output><!\[CDATA\[' ]]; then
            in_message=false
            in_stacktrace=false
            in_output=true
            if [[ "$line" =~ <!\[CDATA\[.*\]\]> ]]; then
                test_output=$(echo "$line" | sed 's/.*<!\[CDATA\[//;s/\]\]>.*//')
            fi
        elif [[ "$line" =~ '</output>' ]]; then
            in_output=false
            if [ -n "$test_output" ]; then
                echo "**Console Output:**"
                echo '```'
                echo "$test_output"
                echo '```'
                echo ""
            fi
        fi
        
        # End of test case
        if [[ "$line" =~ '</test-case>' ]]; then
            in_test_case=false
            in_message=false
            in_stacktrace=false
            in_output=false
            echo "---"
            echo ""
        fi
        
    done < "$xml_file"
    
    return 0
}

# ============================================================================
# MAIN
# ============================================================================

print_header "Unity CI - Test & Filter"

echo "🔍 Unity Detection:"
if [ -n "$UNITY" ]; then
    echo -e "  ${GREEN}✅ Found:${NC} $UNITY"
else
    echo -e "  ${RED}❌ Unity not found${NC}"
    echo ""
    echo "Searched locations:"
    echo "  - /opt/Unity/Editor/Unity"
    echo "  - /usr/bin/unity"
    echo "  - ~/Unity/Hub/Editor/*/Editor/Unity"
    echo "  - ~/Applications/Unity/Hub/Editor/*/Editor/Unity"
    echo "  - /Applications/Unity/Hub/Editor/*/Unity.app/Contents/MacOS/Unity"
    echo ""
    echo "To fix, either:"
    echo "  1. Set UNITY environment variable:"
    echo "     export UNITY=/path/to/Unity"
    echo "  2. Install Unity Hub and add an editor"
    echo "  3. Create a symlink: ln -s /your/unity/path /usr/bin/unity"
    exit 1
fi

echo ""
echo "📁 Project: $PROJECT"
echo ""

# ============================================================================
# EDIT MODE TESTS
# ============================================================================
print_section "Running EditMode Tests"

set +e
"$UNITY" -batchmode -nographics -quit \
    -projectPath "$PROJECT" \
    -runTests -testPlatform editmode \
    -testResults "$EDIT_XML" \
    -logFile "$EDIT_LOG"
EDIT_EXIT=$?
set -e

if [ -f "$EDIT_XML" ]; then
    echo -e "${GREEN}✅ EditMode results generated${NC}"
else
    echo -e "${YELLOW}⚠️  EditMode results not found${NC}"
fi

# ============================================================================
# PLAY MODE TESTS
# ============================================================================
print_section "Running PlayMode Tests"

set +e
"$UNITY" -batchmode -nographics -quit \
    -projectPath "$PROJECT" \
    -runTests -testPlatform playmode \
    -testResults "$PLAY_XML" \
    -logFile "$PLAY_LOG"
PLAY_EXIT=$?
set -e

if [ -f "$PLAY_XML" ]; then
    echo -e "${GREEN}✅ PlayMode results generated${NC}"
else
    echo -e "${YELLOW}⚠️  PlayMode results not found${NC}"
fi

# ============================================================================
# FILTER RESULTS FOR AI
# ============================================================================
print_header "FILTERED TEST RESULTS FOR AI"

# EditMode Results
if [ -f "$EDIT_XML" ]; then
    echo -e "${CYAN}▶ EditMode Results${NC}"
    echo ""
    filter_unity_xml "$EDIT_XML" "EditMode"
fi

# PlayMode Results
if [ -f "$PLAY_XML" ]; then
    echo -e "${CYAN}▶ PlayMode Results${NC}"
    echo ""
    filter_unity_xml "$PLAY_XML" "PlayMode"
fi

# ============================================================================
# SUMMARY
# ============================================================================
print_header "SUMMARY"

EDIT_FAILED=0
PLAY_FAILED=0
EDIT_TOTAL=0
PLAY_TOTAL=0

if [ -f "$EDIT_XML" ]; then
    EDIT_FAILED=$(grep -o 'failed="[0-9]*"' "$EDIT_XML" | head -1 | grep -o '[0-9]*' || echo "0")
    EDIT_TOTAL=$(grep -o 'total="[0-9]*"' "$EDIT_XML" | head -1 | grep -o '[0-9]*' || echo "0")
    echo "📊 EditMode: $EDIT_FAILED failed / $EDIT_TOTAL total"
fi

if [ -f "$PLAY_XML" ]; then
    PLAY_FAILED=$(grep -o 'failed="[0-9]*"' "$PLAY_XML" | head -1 | grep -o '[0-9]*' || echo "0")
    PLAY_TOTAL=$(grep -o 'total="[0-9]*"' "$PLAY_XML" | head -1 | grep -o '[0-9]*' || echo "0")
    echo "📊 PlayMode: $PLAY_FAILED failed / $PLAY_TOTAL total"
fi

echo ""
echo "📁 Output Files:"
[ -f "$EDIT_XML" ] && echo "   EditMode XML: $EDIT_XML"
[ -f "$PLAY_XML" ] && echo "   PlayMode XML: $PLAY_XML"
[ -f "$EDIT_LOG" ] && echo "   EditMode Log: $EDIT_LOG"
[ -f "$PLAY_LOG" ] && echo "   PlayMode Log: $PLAY_LOG"
echo ""

TOTAL_FAILED=$((EDIT_FAILED + PLAY_FAILED))

if [ $TOTAL_FAILED -eq 0 ] && [ $EDIT_EXIT -eq 0 ] && [ $PLAY_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    print_header "END OF REPORT"
    exit 0
else
    echo -e "${RED}❌ TESTS FAILED${NC}"
    print_header "END OF REPORT"
    exit 1
fi
