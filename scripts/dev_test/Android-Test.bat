@echo off
setlocal EnableDelayedExpansion
title Android Test - CoopLog
echo ==========================================
echo  CoopLog - Android TEST (clean rebuild + sync^)
echo ==========================================
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)

echo [1/4] Checking Node.js + dependencies...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "node_modules\.bin\vite.cmd" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)

echo [2/4] Cleaning stale output (full rebuild, no leftovers)...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
    echo [ERROR] Could not delete dist\ - close anything locking it, then retry.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist\ cleared.

echo [3/4] Stamping build time + rebuilding web app from current source...
call node scripts/stamp-build.mjs
if errorlevel 1 (
    echo [ERROR] Build stamp failed.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "dist\index.html" (
    echo [ERROR] Build produced no dist\index.html.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist/ freshly rebuilt.

echo [4/4] Syncing to Android...
if not exist "android" (
    echo [ERROR] android\ folder not found. Run: npx cap add android
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)

echo.
echo ==========================================
echo  DONE: Android test ready (clean rebuild^).
echo  Open android\ in Android Studio -^> Run.
echo ==========================================
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
