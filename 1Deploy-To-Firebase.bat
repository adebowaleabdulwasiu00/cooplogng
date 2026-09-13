@echo off
:: Cooperative Log App - Deploy to Firebase
echo ------------------------------------------
echo   FIREBASE DEPLOYMENT SCRIPT
echo ------------------------------------------

:: 1. Environment Check
echo [1/4] Checking Node.js...
node -v
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed. 
    echo Please install it from https://nodejs.org/
    pause
    exit /b
)

:: 2. Install Dependencies
echo [2/4] Installing dependencies (npm install)...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b
)

:: 3. Build Web App
echo [3/4] Building project (npm run build)...
echo   ^> Vite injects a unique build timestamp into the service worker URL,
echo   ^> so every deploy automatically busts the old SW cache.
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b
)

:: 4. Deploy
echo [4/4] Deploying to Firebase...
echo   - Site "cooplogng" : web app (dist/)
echo   ^(Desktop auto-updates now come from GitHub Releases, not Firebase.^)
echo Checking for Firebase CLI...
echo NOTE: the old "cooplogng-updates" hosting site is retired.

:: Try global firebase first, then npx
firebase --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Using global Firebase CLI...
    call firebase deploy --only hosting,firestore
) else (
    echo Global Firebase not found. Using npx...
    call npx firebase deploy --only hosting,firestore
)

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Deployment failed.
    echo Make sure you are logged in by running: npx firebase login
    pause
    exit /b
)

echo.
echo ==========================================
echo   SUCCESS! Your app is deployed.
echo ==========================================
echo.
echo IMPORTANT: Users who were on the OLD version may need to:
echo   - Close and re-open the browser tab, OR
echo   - Tap the Refresh icon (or pull-to-refresh) once
echo.
echo The app will auto-detect the update on their next visit.
echo ==========================================
pause
