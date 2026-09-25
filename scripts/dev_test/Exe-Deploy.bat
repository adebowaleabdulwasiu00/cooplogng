@echo off
setlocal EnableDelayedExpansion
title EXE Deploy - CoopLog
echo ==========================================
echo  CoopLog - EXE DEPLOY (clean rebuild + GitHub^)
echo  Usage: Exe-Deploy.bat [patch^|minor^|major]
echo         No arg = same version, fresh EXE.
echo  Installed apps auto-update from GitHub.
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

:: Optional version bump
set BUMP=
if /I "%~1"=="patch" set BUMP=patch
if /I "%~1"=="minor" set BUMP=minor
if /I "%~1"=="major" set BUMP=major
if defined BUMP (
    echo [1/5] Bumping version: %BUMP%...
    call node scripts/bump-version.mjs %BUMP%
    if errorlevel 1 (
        echo [ERROR] Version bump failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
) else (
    echo [1/5] No version bump - fresh EXE, same version.
)

echo [2/5] Checking Node.js + dependencies...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "node_modules\electron-builder" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)
for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v
if "%VER%"=="" (
    echo [ERROR] Could not read version.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo Target version: v%VER%

echo [3/5] Cleaning stale output + stamping build (full rebuild, no leftovers)...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
    echo [ERROR] Could not delete dist\ - close dev server or editor locking it, then retry.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call node scripts/stamp-build.mjs
if errorlevel 1 (
    echo [ERROR] Build stamp failed. Nothing published.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist\ cleared, build stamped. Rebuilding inside publish step...

echo [4/5] Rebuilding + publishing to GitHub...
echo (npm run build runs first inside publish:desktop - always fresh.^)
if not defined GH_TOKEN (
    echo [ERROR] GH_TOKEN is not set.
    echo Create token (classic, 'repo' scope^), then:
    echo   set GH_TOKEN=your_token_here
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call npm run publish:desktop
if errorlevel 1 (
    echo [ERROR] EXE publish failed. Retry on network errors.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "dist\index.html" (
    echo [WARNING] dist\index.html missing after publish - check build output above.
)

echo [5/5] Done.
echo.
echo ==========================================
echo  SUCCESS! EXE v%VER% published to GitHub.
echo  Installed apps update on restart (delta^).
echo.
echo  Link for landing page (Firestore releases/latest exeUrl^):
echo    https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-Setup-%VER%.exe
echo.
echo  The link was also copied to your clipboard and saved to:
echo    exe-link-v%VER%.txt
echo ==========================================
echo https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-Setup-%VER%.exe | clip
echo https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-Setup-%VER%.exe > "exe-link-v%VER%.txt"
echo [OK] Link copied (Ctrl+V to paste into Firestore^). File saved.
echo.
echo  Next: in Firestore set exeUrl = link above, exeVersion=v%VER%
echo  Then run Web-Deploy.bat if web changed too.
echo.
echo  Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
