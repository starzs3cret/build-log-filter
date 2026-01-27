@echo off
REM Last Courier: Build Log Filter GUI
REM Web interface for filtering build logs before sharing with AI

cd /d "%~dp0"
echo Starting Build Log Filter GUI...
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║  Build Log Filter GUI                                    ║
echo ╠════════════════════════════════════════════════════════════╣
echo ║  Opening browser to http://localhost:3456                 ║
echo ║                                                            ║
echo ║  1. Paste build.log content                               ║
echo ║  2. Click Filter                                          ║
echo ║  3. Copy filtered result                                  ║
echo ║  4. Share with AI                                         ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

REM Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

REM Start server and open browser
start http://localhost:3456
node server.js

pause
