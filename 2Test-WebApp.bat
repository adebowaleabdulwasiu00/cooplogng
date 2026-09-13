@echo off
setlocal EnableDelayedExpansion
title Test Web App - Cooperative Log App

echo ==========================================
echo  Cooperative Log App - Web Local Testing
echo ==========================================
echo.

:: Ensure we are in the script's directory (root)
cd /d "%~dp0"

echo [Step 1/4] Checking dependencies...
echo ------------------------------------------
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
    echo [INFO] Vite is missing. Installing project dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

if not exist "node_modules\.bin\vite.cmd" (
    echo [ERROR] Vite was not installed. Check package.json and npm output above.
    pause
    exit /b 1
)

echo [OK] Dependencies found.
echo.

echo [Step 2/4] Building web app (dist/)...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Fix the errors above and try again.
    pause
    exit /b 1
)
echo [OK] Web build complete.
echo.

echo [Step 3/4] Syncing build to Android...
echo ------------------------------------------
if not exist "android" (
    echo [ERROR] android\ folder not found. Run: npx cap add android
    pause
    exit /b 1
)
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed. Check output above.
    pause
    exit /b 1
)
echo [OK] Android synced. Open android\ in Android Studio and Build APK.
echo.

echo [Step 4/4] Starting Vite Development Server...
echo ------------------------------------------
echo.
echo The application will be available at: http://localhost:5173
echo Your browser will open automatically once the server is up.
echo Press Ctrl+C to stop the server.
echo.

:: Open default browser after short delay (runs in background while server starts)
start /b cmd /c "timeout /t 6 /nobreak >nul & start http://localhost:5173"

call npm run dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Vite server stopped unexpectedly.
    pause
    exit /b %ERRORLEVEL%
)

pause
