@echo off
setlocal EnableDelayedExpansion
title Build Desktop EXE - Cooperative Log App

echo ==========================================
echo  Cooperative Log App - Desktop EXE Build
echo ==========================================
echo.

:: Ensure we are in the script's directory (root)
cd /d "%~dp0"

echo [Step 1/2] Building web app + Windows installer...
echo ------------------------------------------
call npm run dist:win
if errorlevel 1 (
    echo [ERROR] EXE build failed. Check output above.
    pause
    exit /b 1
)
echo [OK] Installer built in release\ folder.
echo      (Desktop auto-updates publish from here to GitHub Releases
echo       via 4Publish-Desktop-Update.bat - no staging step needed.)
echo.

echo [Step 2/2] Next steps (manual)...
echo ------------------------------------------
echo  1. Test the exe from release\ on this machine.
echo  2. To ship an update: set GH_TOKEN, then run 4Publish-Desktop-Update.bat
echo     Installed v1.x apps will update from GitHub on next launch.
echo.
pause
