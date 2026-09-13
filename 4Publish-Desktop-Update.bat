@echo off
:: CoopLog - UNIFIED PUBLISH (web + Android + exe, one version id)
:: Usage: 4Publish-Desktop-Update.bat [patch^|minor^|major]
::        With no argument it asks you to pick 1/2/3.
echo ------------------------------------------
echo   UNIFIED PUBLISH SCRIPT
echo   One version id stamped everywhere, then:
echo   web build -^> Android sync -^> exe build+publish -^> deploy
echo ------------------------------------------

:: 0. Stay in script directory
cd /d "%~dp0"

:: 1. Environment Check
echo [1/7] Checking Node.js...
node -v
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please install it from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Install Dependencies
echo [2/7] Installing dependencies (npm install)...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

:: 3. Stamp ONE semver version (MAJOR.MINOR.PATCH) into package.json (exe),
::    android/app/build.gradle (Android) and src/buildInfo.js (About screen).
::    Level: 1 = patch (fixes), 2 = minor (new features), 3 = major (breaking).
echo [3/7] Selecting version bump...
set BUMPLEVEL=
if /I "%~1"=="patch" set BUMPLEVEL=patch
if /I "%~1"=="minor" set BUMPLEVEL=minor
if /I "%~1"=="major" set BUMPLEVEL=major
if not defined BUMPLEVEL (
    echo.
    echo   What kind of release is this?
    echo   [1] Patch - bug fixes only        (1.0.1 -^> 1.0.2)
    echo   [2] Minor - new features          (1.0.1 -^> 1.1.0)
    echo   [3] Major - breaking changes      (1.0.1 -^> 2.0.0)
    echo.
    choice /C 123 /N /M "Press 1, 2 or 3: "
    if errorlevel 3 (
        set BUMPLEVEL=major
    ) else if errorlevel 2 (
        set BUMPLEVEL=minor
    ) else (
        set BUMPLEVEL=patch
    )
)
echo Stamping version id (%BUMPLEVEL% bump)...
call node scripts/bump-version.mjs %BUMPLEVEL%
if %ERRORLEVEL% neq 0 (
    echo ERROR: version stamp failed.
    pause
    exit /b 1
)

:: 4. Build Web App (bakes the new version id into dist/ for About screen)
echo [4/7] Building web app (npm run build)...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

:: 5. Sync to Android (copies new dist/ into android/, version already stamped)
echo [5/7] Syncing build to Android...
if not exist "android" (
    echo ERROR: android\ folder not found. Run: npx cap add android
    pause
    exit /b 1
)
call npx cap sync android
if %ERRORLEVEL% neq 0 (
    echo ERROR: Capacitor sync failed.
    pause
    exit /b 1
)

:: 6. Build Windows installer + publish to GitHub Releases
::     (installed EXEs auto-update from there - no Firebase exe hosting needed)
echo [6/7] Building Windows installer and publishing to GitHub...
if not defined GH_TOKEN (
    echo ERROR: GH_TOKEN is not set.
    echo Create a token at https://github.com/settings/tokens ^(classic, 'repo' scope^),
    echo then run:  set GH_TOKEN=your_token_here
    echo and run this script again.
    pause
    exit /b 1
)
call npx electron-builder --win --publish always
if %ERRORLEVEL% neq 0 (
    echo ERROR: electron-builder failed.
    pause
    exit /b 1
)

:: 7. Deploy web app + firestore (desktop feed lives on GitHub now)
echo [7/7] Deploying web app + firestore to Firebase...
call npx firebase deploy --only hosting:cooplogng,firestore

if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Deployment failed.
    echo Make sure you ran: npx firebase login
    pause
    exit /b 1
)

echo.
echo ==========================================
echo   SUCCESS! One version published everywhere.
echo ==========================================
echo.
echo   Web + About screen : deployed, same version id.
echo   EXE update feed    : GitHub Release published, installed apps update on restart.
echo   Landing page       : update the releases/latest Firestore doc
echo     ^(exeUrl = GitHub asset URL, exeVersion, exeSize^) - no redeploy needed.
echo   Android            : synced + version-stamped. STILL NEEDED:
echo     1. Open android\ in Android Studio
echo     2. Build -^> Generate Signed App Bundle (.aab, same keystore)
echo     3. Upload the .aab to Play Console -^> Rollout
echo     Play then shows the Update button (same version id).
echo ==========================================
pause
