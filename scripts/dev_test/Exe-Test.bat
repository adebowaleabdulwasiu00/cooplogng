@echo off
setlocal EnableDelayedExpansion
title EXE Test - CoopLog
echo ==========================================
echo  CoopLog - EXE TEST (clean rebuild in window^)
echo  Tests exactly what Setup.exe will ship.
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
if not exist "electron\main.js" (
    echo [ERROR] electron\main.js not found.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)

echo [1/3] Checking dependencies...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)

echo [2/3] Cleaning stale output + rebuilding dist/ from current source...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
    echo [ERROR] Could not delete dist\ - close anything locking it, then retry.
    echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
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
echo [OK] dist/ freshly rebuilt - EXE test has latest code.
echo.
echo [3/3] Launching desktop window (close it to return^)...
echo (Auto-update is skipped locally.^)
call npx electron .
echo.
echo [OK] EXE test closed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
