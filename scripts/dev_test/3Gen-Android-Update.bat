@echo off
setlocal EnableDelayedExpansion
title Generate Android APK Update
echo ==========================================
echo  CoopLog - Generate Android APK Update
echo ==========================================
echo.
echo TIP: bump version first if needed:
echo   node scripts/bump-version.mjs [patch^|minor^|major]
echo  (this also stamps android versionCode/versionName)
echo.

:: Project root = two levels up from scripts\dev_test
cd /d "%~dp0..\.."
if not exist "package.json" (
    echo [ERROR] Could not find project root.
    echo         Run this script from the project folder.
    pause
    exit /b 1
)

echo [Step 0/4] Preflight: checking required tools...
echo ------------------------------------------
call :ENSURE_BIN node "Node.js" OpenJS.NodeJS.LTS "https://nodejs.org/"
if errorlevel 1 exit /b 1
call :ENSURE_BIN java "Java 17 (for Gradle)" Microsoft.OpenJDK.17 "https://learn.microsoft.com/java/openjdk/download"
if errorlevel 1 exit /b 1
call :CHECK_ANDROID_SDK
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

echo [Step 1/4] Building web app...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Fix the errors above and re-run.
    pause
    exit /b 1
)
echo.

echo [Step 2/4] Syncing Android folder...
echo ------------------------------------------
if not exist "android" (
    echo [ERROR] android\ folder not found.
    echo         Create it with: npx cap add android
    pause
    exit /b 1
)
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed. Is @capacitor/cli installed? Run: npm install
    pause
    exit /b 1
)
echo.

echo [Step 3/4] Building debug APK with Gradle (no Android Studio needed)...
echo ------------------------------------------
echo NOTE: this builds a DEBUG apk. For Play Store use Android Studio
echo       menu Build, then Generate Signed Bundle/APK with your release keystore.
echo       First Gradle run downloads its distribution - allow a few minutes.
echo.
cd android
call gradlew.bat assembleDebug
if errorlevel 1 goto :GRADLE_FAIL
cd /d "%~dp0..\.."
if not exist "android\app\build\outputs\apk\debug\app-debug.apk" goto :APK_MISSING
echo.
goto :APK_OK
:GRADLE_FAIL
cd /d "%~dp0..\.."
echo [ERROR] Gradle build failed.
echo         - No Java? Install Microsoft OpenJDK 17.
echo         - No SDK? Open android\ once in Android Studio to install it.
pause
exit /b 1
:APK_MISSING
cd /d "%~dp0..\.."
echo [ERROR] APK not found at android\app\build\outputs\apk\debug\app-debug.apk
echo         even though Gradle succeeded. Try: Build APK in Android Studio.
pause
exit /b 1
:APK_OK

echo [Step 4/4] Publishing versioned APK (cleaning old ones)...
echo ------------------------------------------
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
if errorlevel 1 goto :COPY_FAIL
if not exist "apk\CoopLog-v%VER%.apk" goto :COPY_FAIL
echo.
echo ==========================================
echo  DONE: APK v%VER% generated.
echo   File: %CD%\apk\CoopLog-v%VER%.apk
echo  Install on device, or open android\ in Android
echo  Studio for a signed release build.
echo ==========================================
pause
exit /b 0
:COPY_FAIL
echo [ERROR] Could not copy APK to apk\ folder. Check disk space, permissions,
echo         or antivirus quarantine, then re-run.
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
echo [ERROR] Android SDK not found.
echo         - Easiest: open android\ once in Android Studio (it installs the SDK), then re-run.
echo         - Or set ANDROID_HOME to your SDK folder.
pause
exit /b 1
:SDK_OK
echo [OK] Android SDK configured.
exit /b 0

:ENSURE_DEPS
if exist "node_modules\.bin\vite.cmd" exit /b 0
echo [FIX] Project dependencies missing. Installing (npm install)...
call npm install
if errorlevel 1 goto :ED_INSTALL_FAIL
if exist "node_modules\.bin\vite.cmd" exit /b 0
echo [ERROR] vite is still missing after install. Delete node_modules and run: npm install
pause
exit /b 1
:ED_INSTALL_FAIL
echo [ERROR] npm install failed. Check your connection and re-run.
pause
exit /b 1
