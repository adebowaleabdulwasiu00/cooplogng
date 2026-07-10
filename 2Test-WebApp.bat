@echo off
setlocal EnableDelayedExpansion
title Test Web App - Cooperative Log App

echo ==========================================
echo  Cooperative Log App - Web Local Testing
echo ==========================================
echo.

:: Ensure we are in the script's directory (root)
cd /d "%~dp0"

echo [Step 1/2] Checking dependencies...
echo ------------------------------------------
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)
echo [OK] Dependencies found.
echo.

echo [Step 2/2] Starting Vite Development Server...
echo ------------------------------------------
echo.
echo The application will be available at: http://localhost:5173
echo Press Ctrl+C to stop the server.
echo.

call npm run dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Vite server stopped unexpectedly.
    pause
    exit /b %ERRORLEVEL%
)

pause
