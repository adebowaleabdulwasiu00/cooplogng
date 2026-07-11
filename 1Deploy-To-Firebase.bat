@echo off
:: Cooperative Log App - Deploy to Firebase
echo ------------------------------------------
echo   FIREBASE DEPLOYMENT SCRIPT
echo ------------------------------------------

:: 1. Pull latest code from git
echo [1/5] Pulling latest code from git...
call git pull
if %ERRORLEVEL% neq 0 (
    echo WARNING: git pull failed. Continuing with local files...
)

:: 2. Environment Check
echo [2/5] Checking Node.js...
node -v
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed. 
    echo Please install it from https://nodejs.org/
    pause
    exit /b
)

:: 3. Install Dependencies
echo [3/5] Installing dependencies (npm install)...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b
)

:: 4. Build Web App
echo [4/5] Building project (npm run build)...
echo   ^> Vite injects a unique build timestamp into the service worker URL,
echo   ^> so every deploy automatically busts the old SW cache.
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b
)

:: 5. Deploy
echo [5/5] Deploying to Firebase...
echo Checking for Firebase CLI...

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
