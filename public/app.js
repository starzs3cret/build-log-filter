/**
 * Build Log Filter - Frontend Application
 */

// DOM Elements
const inputLog = document.getElementById('inputLog');
const outputLog = document.getElementById('outputLog');
const inputStats = document.getElementById('inputStats');
const outputStats = document.getElementById('outputStats');
const filterStats = document.getElementById('filterStats');
const status = document.getElementById('status');

// Buttons
const filterBtn = document.getElementById('filterBtn');
const clearBtn = document.getElementById('clearBtn');
const pasteBtn = document.getElementById('pasteBtn');
const copyBtn = document.getElementById('copyBtn');
const saveBtn = document.getElementById('saveBtn');
const fileInput = document.getElementById('fileInput');

// Options
const showWarnings = document.getElementById('showWarnings');
const useContext = document.getElementById('useContext');
const contextLines = document.getElementById('contextLines');
const formatSelect = document.getElementById('formatSelect');
const fileFilterList = document.getElementById('fileFilterList');
const selectAllFilesBtn = document.getElementById('selectAllFiles');
const clearFileFilterBtn = document.getElementById('clearFileFilter');

// API Base URL
const API_BASE = '';

// Store files list and selected files for the current log
let currentFiles = [];
let selectedFiles = new Set();

// Debounce timer for auto-filter
let autoFilterTimer = null;

/**
 * Populate file filter checkboxes with files from errors
 */
function populateFileDropdown(files) {
    // Save current selections
    const previousSelections = new Set(selectedFiles);

    // Store files for reference
    currentFiles = files;

    // Clear existing checkboxes
    fileFilterList.innerHTML = '';

    if (files.length === 0) {
        fileFilterList.innerHTML = '<span class="no-files-hint">No files detected yet</span>';
        selectedFiles.clear();
        return;
    }

    // Add checkboxes for each file
    files.forEach(f => {
        const label = document.createElement('label');
        label.className = 'file-checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = f;
        checkbox.checked = previousSelections.has(f);

        // Update selectedFiles and styling when checkbox changes
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                selectedFiles.add(f);
                label.classList.add('checked');
            } else {
                selectedFiles.delete(f);
                label.classList.remove('checked');
            }
            // Auto-filter when file selection changes (if we have a log loaded)
            if (inputLog.value.trim()) {
                debouncedFilter();
            }
        });

        // Initialize styling based on checked state
        if (checkbox.checked) {
            selectedFiles.add(f);
            label.classList.add('checked');
        }

        const text = document.createElement('span');
        text.textContent = f;

        label.appendChild(checkbox);
        label.appendChild(text);
        fileFilterList.appendChild(label);
    });

    // If no previous selections, start with all unselected (show all)
    if (previousSelections.size === 0) {
        selectedFiles.clear();
    }
}

/**
 * Get selected files as array
 */
function getSelectedFiles() {
    return Array.from(selectedFiles);
}

/**
 * Select all files
 */
function selectAllFiles() {
    const checkboxes = fileFilterList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = true;
        selectedFiles.add(cb.value);
        cb.parentElement.classList.add('checked');
    });
    // Auto-filter after selecting all
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
}

/**
 * Clear file filter
 */
function clearFileFilter() {
    const checkboxes = fileFilterList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = false;
        selectedFiles.delete(cb.value);
        cb.parentElement.classList.remove('checked');
    });
    // Auto-filter after clearing
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
}

/**
 * Debounced auto-filter to avoid too many requests
 */
function debouncedFilter() {
    clearTimeout(autoFilterTimer);
    autoFilterTimer = setTimeout(() => {
        filterLog();
    }, 800); // Wait 800ms after user stops typing/changing
}

/**
 * Update input statistics
 */
function updateInputStats() {
    const content = inputLog.value;
    const lines = content.split('\n').length;
    const chars = content.length;
    inputStats.textContent = `${lines} lines | ${chars.toLocaleString()} characters`;
}

/**
 * Update output statistics
 */
function updateOutputStats() {
    const content = outputLog.value;
    const lines = content.split('\n').length;
    const chars = content.length;
    outputStats.textContent = `${lines} lines | ${chars.toLocaleString()} characters`;
}

/**
 * Show toast notification
 */
function showToast(message, isError = false) {
    // Remove existing toast
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${isError ? 'error' : ''}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Filter the build log
 */
async function filterLog() {
    const logContent = inputLog.value.trim();

    if (!logContent) {
        showToast('Please paste a build log first!', true);
        return;
    }

    // Show loading state
    filterBtn.disabled = true;
    filterBtn.classList.add('filtering');
    status.textContent = 'Filtering...';

    const options = {
        content: logContent,
        format: formatSelect.value,
        showWarnings: showWarnings.checked,
        contextLines: useContext.checked ? contextLines.value : 0,
        maxErrors: 9999,
        maxWarnings: 9999,
        fileFilters: getSelectedFiles()
    };

    try {
        const response = await fetch(`${API_BASE}/api/filter`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(options)
        });

        const result = await response.json();

        if (response.ok) {
            outputLog.value = result.filteredContent || result.summary.filteredContent;
            updateOutputStats();

            // Populate file dropdown if we have files
            if (result.files && result.files.length > 0) {
                populateFileDropdown(result.files);
            }

            // Show filter stats
            if (result.summary) {
                // Handle Unity test results format
                if (result.format === 'unity-test-results' || result.summary.totalTests !== undefined) {
                    const { totalTests, passed, failed, skipped } = result.summary;
                    filterStats.textContent = `Tests: ${totalTests} total | ${passed} passed | ${failed} failed | ${skipped} skipped`;
                    if (failed > 0) {
                        status.textContent = `Found ${failed} failed test(s) - review and fix!`;
                    } else {
                        status.textContent = 'All tests passed!';
                    }
                } else {
                    // Standard build log format
                    const { errorCount, warningCount, totalLines } = result.summary;
                    filterStats.textContent = `Found: ${errorCount} errors, ${warningCount} warnings (from ${totalLines} lines)`;
                    status.textContent = `Filtered successfully! Removed ${totalLines - (errorCount + warningCount)} irrelevant lines.`;
                }
            } else {
                filterStats.textContent = 'Filtered successfully!';
                status.textContent = 'Ready to copy';
            }

            // Show specific toast for Unity tests
            if (result.format === 'unity-test-results') {
                showToast(`Unity test results: ${result.summary.failed} failures found`);
            } else {
                showToast('Log filtered successfully!');
            }
        } else {
            throw new Error(result.error || 'Filter failed');
        }
    } catch (error) {
        showToast(`Error: ${error.message}`, true);
        status.textContent = 'Filter failed - try again';
    } finally {
        filterBtn.disabled = false;
        filterBtn.classList.remove('filtering');
    }
}

/**
 * Clear input
 */
function clearInput() {
    inputLog.value = '';
    updateInputStats();
    status.textContent = 'Input cleared';
}

/**
 * Load file and auto-filter
 */
function loadFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        inputLog.value = content;
        updateInputStats();
        status.textContent = `Loaded ${file.name} (${content.split('\n').length} lines)`;
        showToast(`Loaded: ${file.name}`);
        // Auto-filter after loading
        await filterLog();
    };
    reader.onerror = () => {
        showToast('Error reading file!', true);
    };
    reader.readAsText(file);
}

/**
 * Paste from clipboard and auto-filter
 */
async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        inputLog.value = text;
        updateInputStats();
        status.textContent = `Pasted ${text.split('\n').length} lines`;
        showToast('Pasted from clipboard!');
        // Auto-filter after paste
        await filterLog();
    } catch (error) {
        showToast('Clipboard access denied - use Ctrl+V instead', true);
        inputLog.focus();
    }
}

/**
 * Copy output to clipboard
 */
async function copyToClipboard() {
    const content = outputLog.value;
    if (!content) {
        showToast('No filtered content to copy!', true);
        return;
    }

    try {
        await navigator.clipboard.writeText(content);
        showToast('Copied to clipboard!');
        status.textContent = 'Ready to paste into AI assistant';
    } catch (error) {
        // Fallback for older browsers
        outputLog.select();
        document.execCommand('copy');
        showToast('Copied! (Ctrl+C now works)');
    }
}

/**
 * Save output to file
 */
function saveToFile() {
    const content = outputLog.value;
    if (!content) {
        showToast('No filtered content to save!', true);
        return;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `build-log-filtered-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('File saved!');
    status.textContent = 'Filtered log saved to file';
}

/**
 * Toggle context input state
 */
function updateContextState() {
    contextLines.disabled = !useContext.checked;
    if (!useContext.checked) {
        contextLines.style.opacity = '0.5';
    } else {
        contextLines.style.opacity = '1';
    }
}

// Event Listeners
filterBtn.addEventListener('click', filterLog);
clearBtn.addEventListener('click', clearInput);
pasteBtn.addEventListener('click', pasteFromClipboard);
copyBtn.addEventListener('click', copyToClipboard);
saveBtn.addEventListener('click', saveToFile);

// File input - load selected file
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        loadFile(e.target.files[0]);
    }
});

inputLog.addEventListener('input', () => {
    updateInputStats();
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
});

// Extra boost for paste events to ensure stats and filter update immediately after content lands
inputLog.addEventListener('paste', () => {
    setTimeout(() => {
        updateInputStats();
        if (inputLog.value.trim()) {
            debouncedFilter();
        }
    }, 100); // 100ms delay for large logs
});

// Update context state and auto-filter
useContext.addEventListener('change', () => {
    updateContextState();
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
});

// Auto-filter when options change
contextLines.addEventListener('change', () => {
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
});
showWarnings.addEventListener('change', () => {
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
});
formatSelect.addEventListener('change', () => {
    if (inputLog.value.trim()) {
        debouncedFilter();
    }
});

// File filter buttons
selectAllFilesBtn.addEventListener('click', selectAllFiles);
clearFileFilterBtn.addEventListener('click', clearFileFilter);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+Enter to filter
    if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        filterLog();
    }

    // Ctrl+Shift+C to copy output
    if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        copyToClipboard();
    }

    // Ctrl+Shift+V to paste input
    if (e.ctrlKey && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        pasteFromClipboard();
    }
});

// Initialize
updateContextState();
updateInputStats();
updateOutputStats();

// Welcome message
status.textContent = 'Paste your build log - auto-filters instantly!';
