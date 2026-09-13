@echo off
setlocal EnableDelayedExpansion
title Generate EXE Update
echo ==========================================
echo  CoopLog - Generate EXE Update
echo ==========================================
echo.
echo TIP: bump version first if needed:
echo   node scripts/bump-version.mjs [patch^|minor^|major]
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
    echo         Run this script from the project folder.
    pause
    exit /b 1
)

echo [Step 0/3] Preflight: checking required tools...
echo ------------------------------------------
call :ENSURE_BIN node "Node.js" OpenJS.NodeJS.LTS "https://nodejs.org/"
if errorlevel 1 exit /b 1
call :ENSURE_DEPS
if errorlevel 1 exit /b 1
echo [OK] All required tools ready.
echo.

for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v
if "%VER%"=="" (
    echo [ERROR] Could not read version from package.json.
    pause
    exit /b 1
)
echo Target version: v%VER%
echo.

echo [Step 1/3] Building installer (web build + electron-builder)...
echo ------------------------------------------
call npm run dist:win
if errorlevel 1 (
    echo [ERROR] EXE build failed. Check output above and re-run.
    echo         First builds download ~50MB of signing tools - retry on network errors.
    pause
    exit /b 1
)
if not exist "release\CoopLog Setup %VER%.exe" (
    echo [ERROR] Expected installer not found: release\CoopLog Setup %VER%.exe
    echo         Did package.json version change mid-build? Re-run bump + this script.
    pause
    exit /b 1
)
echo.

echo [Step 2/3] Cleaning old updates (keeping only v%VER%)...
echo ------------------------------------------
if not exist "updates" mkdir "updates"
for %%f in ("updates\CoopLog Setup *.exe" "updates\CoopLog Setup *.exe.blockmap") do (
    for %%g in (%%f) do (
        echo %%~nxg | findstr /C:"%VER%" >nul
        if errorlevel 1 (
            echo Deleting old: %%~nxg
            del "%%g" 2>nul
        )
    )
)
echo [OK] Old versioned installers removed.
echo.

echo [Step 3/3] Staging new update files...
echo ------------------------------------------
call node scripts/stage-electron-update.mjs
if errorlevel 1 (
    echo [ERROR] Staging failed. Is release\ present? Re-run Step 1.
    pause
    exit /b 1
)
echo.
echo ==========================================
echo  DONE: EXE v%VER% generated.
echo   Installer : %CD%\updates\CoopLog Setup %VER%.exe
echo   Update feed: %CD%\updates\latest.yml
echo  Next: deploy with 4Deploy-All.bat
echo   (or: npx firebase deploy --only hosting:cooplogng-updates)
echo   then update the releases/latest Firestore doc.
echo ==========================================
pause
exit /b 0

:: ================= Subroutines =================

:ENSURE_BIN
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
if exist "node_modules\electron-builder" goto :ED_DEPS_OK
echo [FIX] electron-builder missing. Installing project dependencies...
call npm install
if errorlevel 1 goto :ED_INSTALL_FAIL
if exist "node_modules\electron-builder" goto :ED_DEPS_OK
echo [ERROR] electron-builder is still missing. Delete node_modules and run: npm install
pause
exit /b 1
:ED_INSTALL_FAIL
echo [ERROR] npm install failed. Check your connection and re-run.
pause
exit /b 1
:ED_DEPS_OK
if exist "node_modules\.bin\vite.cmd" exit /b 0
echo [ERROR] vite is missing. Delete node_modules and run: npm install
pause
exit /b 1
