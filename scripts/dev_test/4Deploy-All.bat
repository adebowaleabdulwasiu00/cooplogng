@echo off
setlocal EnableDelayedExpansion
title Deploy All - CoopLog
echo ==========================================
echo  CoopLog - Full Deploy (Web + EXE + APK)
echo ==========================================
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
    echo         Run this script from the project folder.
    pause
    exit /b 1
)

echo [Step 0/5] Preflight: checking required tools...
echo ------------------------------------------
call :ENSURE_BIN node "Node.js" OpenJS.NodeJS.LTS "https://nodejs.org/"
if errorlevel 1 exit /b 1
call :ENSURE_BIN java "Java 17 (for Gradle)" Microsoft.OpenJDK.17 "https://learn.microsoft.com/java/openjdk/download"
if errorlevel 1 exit /b 1
call :CHECK_ANDROID_SDK
if errorlevel 1 goto :APK_UNAVAILABLE
goto :APK_AVAILABLE
:APK_UNAVAILABLE
echo [WARNING] Continuing without Android SDK - APK step will be skipped if Gradle fails.
set SKIP_APK=1
goto :PREFLIGHT_DEPS
:APK_AVAILABLE
set SKIP_APK=
:PREFLIGHT_DEPS
call :ENSURE_DEPS
if errorlevel 1 exit /b 1
call :CHECK_FIREBASE_LOGIN
if errorlevel 1 exit /b 1
echo [OK] All required tools ready.
echo.

for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v
if "%VER%"=="" (
    echo [ERROR] Could not read version from package.json.
    pause
    exit /b 1
)
echo Deploying version: v%VER%
echo.

echo [Step 1/5] Building web app (for web, android AND electron)...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Aborting deploy - nothing was published.
    pause
    exit /b 1
)
echo.

echo [Step 2/5] Syncing Android + building APK...
echo ------------------------------------------
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed. Aborting deploy - nothing was published.
    pause
    exit /b 1
)
if defined SKIP_APK goto :APK_SKIPPED
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :APK_FAILED
cd /d "%~dp0..\.."
if not exist "android\app\build\outputs\apk\debug\app-debug.apk" goto :APK_FAILED
if not exist "apk" mkdir "apk"
for %%f in ("apk\CoopLog-v*.apk") do (
    for %%g in (%%f) do (
        echo %%~nxg | findstr /C:"v%VER%" >nul
        if errorlevel 1 (
            echo Deleting old: %%~nxg
            del "%%g" 2>nul
        )
    )
)
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "apk\CoopLog-v%VER%.apk" >nul
echo [OK] Fresh APK stored: %CD%\apk\CoopLog-v%VER%.apk
goto :APK_DONE
:APK_SKIPPED
echo [SKIP] No Android SDK - APK step skipped by preflight choice.
goto :APK_DONE
:APK_FAILED
cd /d "%~dp0..\.."
echo [WARNING] Gradle APK failed or output missing - continuing deploy without fresh APK.
echo           Open android\ in Android Studio for release builds.
:APK_DONE
echo.

echo [Step 3/5] Building Windows installer...
echo ------------------------------------------
call npx electron-builder --win --publish never
if errorlevel 1 (
    echo [ERROR] EXE build failed. Aborting deploy - nothing was published.
    echo         First builds download ~50MB of signing tools - retry on network errors.
    pause
    exit /b 1
)
if not exist "release\CoopLog Setup %VER%.exe" goto :EXE_MISSING
goto :EXE_OK
:EXE_MISSING
echo [ERROR] Expected installer missing: release\CoopLog Setup %VER%.exe
echo         Aborting deploy - nothing was published.
pause
exit /b 1
:EXE_OK
echo.

echo [Step 4/5] Staging update files (cleaning old EXEs)...
echo ------------------------------------------
for %%f in ("updates\CoopLog Setup *.exe" "updates\CoopLog Setup *.exe.blockmap") do (
    for %%g in (%%f) do (
        echo %%~nxg | findstr /C:"%VER%" >nul
        if errorlevel 1 (
            echo Deleting old: %%~nxg
            del "%%g" 2>nul
        )
    )
)
call node scripts/stage-electron-update.mjs
if errorlevel 1 (
    echo [ERROR] Staging failed. Aborting deploy - nothing was published.
    pause
    exit /b 1
)
echo.

echo [Step 5/5] Deploying BOTH Firebase sites (app + updates)...
echo ------------------------------------------
call npx firebase deploy --only hosting
if errorlevel 1 goto :DEPLOY_FAIL
echo.
echo ==========================================
echo  DONE: v%VER% deployed everywhere.
echo   Web app    : cooplogng site (from %CD%\dist)
echo   EXE update : cooplogng-updates site (from %CD%\updates)
echo   Fresh APK  : %CD%\apk\CoopLog-v%VER%.apk (+ android\ synced)
echo  Remember: update the releases/latest Firestore
echo  doc with the new version + download links.
echo ==========================================
pause
exit /b 0
:DEPLOY_FAIL
echo.
echo [ERROR] Deploy failed. Local files are built and staged, but nothing
echo         was published. If it says 'not logged in', run: npx firebase login
echo         then re-run this script (build steps are safe to repeat).
pause
exit /b 1

:: ================= Subroutines (flat style: no EXIT/GOTO inside blocks) =================

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

:CHECK_ANDROID_SDK
if defined ANDROID_HOME goto :SDK_HAS_HOME
goto :SDK_CHECK_FILE
:SDK_HAS_HOME
if exist "%ANDROID_HOME%\platform-tools" goto :SDK_OK
:SDK_CHECK_FILE
findstr /C:"sdk.dir" "android\local.properties" >nul 2>nul
if not errorlevel 1 goto :SDK_OK
echo [WARNING] Android SDK not found - APK step will be skipped.
exit /b 1
:SDK_OK
echo [OK] Android SDK configured.
exit /b 0

:ENSURE_DEPS
if exist "node_modules\.bin\vite.cmd" goto :ED_DEPS_OK
echo [FIX] Project dependencies missing. Installing (npm install)...
call npm install
if errorlevel 1 goto :ED_INSTALL_FAIL
if exist "node_modules\.bin\vite.cmd" goto :ED_DEPS_OK
echo [ERROR] vite is still missing after install. Delete node_modules and run: npm install
pause
exit /b 1
:ED_INSTALL_FAIL
echo [ERROR] npm install failed. Check your connection and re-run.
pause
exit /b 1
:ED_DEPS_OK
if exist "node_modules\electron-builder" exit /b 0
echo [ERROR] electron-builder is missing. Run: npm install
pause
exit /b 1

:CHECK_FIREBASE_LOGIN
call npx firebase projects:list >nul 2>&1
if not errorlevel 1 goto :FB_OK
echo [ERROR] Firebase CLI is not logged in (or unreachable).
echo         Run: npx firebase login
echo         then re-run this script.
pause
exit /b 1
:FB_OK
echo [OK] Firebase login verified.
exit /b 0
