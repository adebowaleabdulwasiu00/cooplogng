@echo off
setlocal EnableDelayedExpansion
title Test Electron App - Cooperative Log App

echo ==========================================
echo  Cooperative Log App - Electron Local Test
echo  (runs dist/ inside a desktop window,
echo   same code the Setup.exe will ship)
echo ==========================================
echo.

:: Ensure we are in the script directory (root)
cd /d "%~dp0"

echo [Step 1/3] Checking dependencies...
echo ------------------------------------------
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo [INFO] Electron binary missing. Installing project dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

if not exist "node_modules\electron\dist\electron.exe" (
    echo [ERROR] Electron did not install correctly. Check npm output above.
    pause
    exit /b 1
)

if not exist "electron\main.js" (
    echo [ERROR] electron\main.js not found.
    pause
    exit /b 1
)

echo [OK] Dependencies found.
echo.

echo [Step 2/3] Building web app (dist/)...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Fix the errors above and try again.
    pause
    exit /b 1
)
echo [OK] Web build complete.
echo.

echo [Step 3/3] Launching Electron...
echo ------------------------------------------
echo.
echo The app will open in a desktop window.
echo Close the window to return here.
echo (Auto-update is skipped locally - it only runs in the installed exe.)
echo.

call npx electron .

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Electron exited with an error. See output above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [OK] Electron closed cleanly.
pause
