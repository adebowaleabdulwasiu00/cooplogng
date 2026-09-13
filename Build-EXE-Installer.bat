@echo off
setlocal
title Build CoopLog EXE Installer
cd /d "%~dp0"

echo ==========================================
echo  CoopLog - Build Installable EXE
echo ==========================================
echo.
echo This will create a .exe you can share and
echo install on other Windows PCs.
echo Output folder: release\
echo.

:: 1. Check Node.js
echo [1/4] Checking Node.js...
node -v
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo Get it from https://nodejs.org/
    pause
    exit /b 1
)
echo.

:: 2. Install dependencies (skipped if already installed)
echo [2/4] Checking dependencies...
if not exist "node_modules" (
    echo Installing dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
) else (
    echo Dependencies already installed, skipping.
)
echo.

:: 3. Build web app
echo [3/4] Building web app...
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. See errors above.
    pause
    exit /b 1
)
echo.

:: 4. Build Windows installer (.exe)
echo [4/4] Building Windows installer, please wait...
echo   NOTE: The "packaging..." line can sit with no output
echo   for 5-15 minutes. That is NORMAL. Do NOT close this window.
echo   NSIS installer building is slow on first run.
echo.
call npx electron-builder --win --publish never
if errorlevel 1 (
    echo [ERROR] EXE build failed. See errors above.
    pause
    exit /b 1
)
echo.
echo ==========================================
echo  SUCCESS! Your installer is ready.
echo ==========================================
echo.
echo Look in the release\ folder for:
echo   CoopLog-Setup-*.exe
echo.
echo Share that single .exe file - anyone can
echo double-click it to install CoopLog on
echo their own Windows PC. No Node.js needed.
echo.
dir /b "release\*.exe"
echo.
explorer "release"
pause
