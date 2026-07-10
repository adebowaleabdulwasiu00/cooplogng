@echo off
:: Cooperative Log App - Simple Deploy
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
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b
)

:: 4. Deploy
echo [4/4] Deploying to Firebase...
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
pause
