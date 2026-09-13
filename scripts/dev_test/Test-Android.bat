@echo off
setlocal EnableDelayedExpansion
title Test Android - CoopLog
echo ==========================================
echo  CoopLog - Android Test (build + sync)
echo ==========================================
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
    echo         Run this script from the project folder.
    pause
    exit /b 1
)

echo [Step 0/2] Preflight: checking required tools...
echo ------------------------------------------
call :ENSURE_BIN node "Node.js" OpenJS.NodeJS.LTS "https://nodejs.org/"
if errorlevel 1 exit /b 1
call :ENSURE_DEPS
if errorlevel 1 exit /b 1
echo [OK] All required tools ready.
echo.

echo [Step 1/2] Building web app...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Fix the errors above and re-run.
    pause
    exit /b 1
)
echo [OK] dist/ rebuilt at %CD%\dist
echo.

echo [Step 2/2] Syncing Android folder...
echo ------------------------------------------
if not exist "android" (
    echo [ERROR] android\ folder not found.
    echo         Create it with: npx cap add android
    pause
    exit /b 1
)
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed. Is @capacitor/cli installed? Run: npm install
    pause
    exit /b 1
)
echo [OK] android\ synced. Open it in Android Studio to run/install the APK.
echo.
echo ==========================================
echo  DONE: android test ready.
echo  - Web build : %CD%\dist
echo  - Android   : %CD%\android (synced)
echo ==========================================
pause
exit /b 0

:: ================= Subroutines (flat style: no EXIT/GOTO inside blocks) =================

:ENSURE_BIN
:: %1=binary  %2=friendly name  %3=winget id  %4=manual URL
where %~1 >nul 2>nul
if not errorlevel 1 exit /b 0
echo [FIX] %~2 not found. Trying automatic install via winget...
where winget >nul 2>nul
if errorlevel 1 goto :EB_NOWINGET
call winget install -e --id %~3 --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where %~1 >nul 2>nul
if not errorlevel 1 goto :EB_OK
echo [ERROR] %~2 still not found after install.
echo         Close this window, open a new terminal, and re-run the script.
echo         Or install manually from: %~4
pause
exit /b 1
:EB_NOWINGET
echo [ERROR] Cannot auto-install: 'winget' is not available on this PC.
echo         Install manually from: %~4
pause
exit /b 1
:EB_OK
echo [OK] %~2 installed.
exit /b 0

:ENSURE_DEPS
if exist "node_modules\.bin\vite.cmd" exit /b 0
echo [FIX] Project dependencies missing. Installing (npm install)...
call npm install
if errorlevel 1 goto :ED_INSTALL_FAIL
if exist "node_modules\.bin\vite.cmd" exit /b 0
echo [ERROR] vite is still missing after install. Delete node_modules and run: npm install
pause
exit /b 1
:ED_INSTALL_FAIL
echo [ERROR] npm install failed. Check your connection and re-run.
pause
exit /b 1
