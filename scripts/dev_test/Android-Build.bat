@echo off
setlocal EnableDelayedExpansion
title Android Build - CoopLog
echo ==========================================
echo  CoopLog - Android BUILD (clean rebuild + APK^)
echo  Usage: Android-Build.bat [patch^|minor^|major]
echo         No arg = same version, fresh APK.
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
    echo [1/6] Bumping version: %BUMP%...
    call node scripts/bump-version.mjs %BUMP%
    if errorlevel 1 (
        echo [ERROR] Version bump failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
) else (
    echo [1/6] No version bump - fresh APK, same version.
)

echo [2/6] Checking tools (Node + Java + SDK^)...
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java 17 not found. Install Microsoft OpenJDK 17.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not defined ANDROID_HOME (
    findstr /C:"sdk.dir" "android\local.properties" >nul 2>nul
    if errorlevel 1 (
        echo [ERROR] Android SDK not found. Open android\ once in Android Studio.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)
if not exist "node_modules\.bin\vite.cmd" (
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
        exit /b 1
    )
)
for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v

echo [3/6] Cleaning stale output + stamping build (full rebuild, no leftovers)...
if exist "dist" rmdir /s /q "dist"
if exist "dist" (
    echo [ERROR] Could not delete dist\ - close dev server or editor locking it, then retry.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
call node scripts/stamp-build.mjs
if errorlevel 1 (
    echo [ERROR] Build stamp failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist\ cleared, build stamped.

echo [4/6] Rebuilding web app from current source...
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
if not exist "dist\index.html" (
    echo [ERROR] Build produced no dist\index.html.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
echo [OK] dist/ freshly rebuilt - verified dist\index.html exists.

echo [5/6] Syncing + building APK...
call npx cap sync android
if errorlevel 1 (
    echo [ERROR] Capacitor sync failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    cd /d "%~dp0..\.."
    echo [ERROR] Gradle build failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)
cd /d "%~dp0..\.."

echo [6/6] Publishing versioned APK...
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
if errorlevel 1 (
    echo [ERROR] Copy to apk\ failed.
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
    exit /b 1
)

echo.
echo [7/7] Uploading APK to GitHub Release (for landing-page link^)...
where gh >nul 2>nul
if errorlevel 1 (
    echo [INFO] gh CLI not found. Trying automatic install via winget...
    where winget >nul 2>nul
    if not errorlevel 1 (
        call winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements
    )
)
where gh >nul 2>nul
if errorlevel 1 (
    echo [SKIP] gh still missing. Upload manually:
    echo   1. Open github.com/adebowaleabdulwasiu00/cooplogng/releases
    echo   2. Edit release v%VER% (or create it^), attach apk\CoopLog-v%VER%.apk
    echo   3. Copy its link into Firestore releases/latest apkUrl.
    goto :APK_DONE_MSG
)
gh release view v%VER% >nul 2>nul
if errorlevel 1 (
    echo [INFO] Release v%VER% not found. Creating it...
    call gh release create v%VER% --title "v%VER%" --notes "CoopLog v%VER%"
)
call gh release upload v%VER% "apk\CoopLog-v%VER%.apk" --clobber
if errorlevel 1 (
    echo [WARNING] Upload failed. If it says 'not logged in', run: gh auth login
    echo   then re-run: gh release upload v%VER% "apk\CoopLog-v%VER%.apk" --clobber
    goto :APK_DONE_MSG
)
echo [OK] Uploaded to GitHub Release v%VER%.
echo Link for landing page (Firestore releases/latest apkUrl^):
echo   https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-v%VER%.apk
echo https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-v%VER%.apk | clip
echo https://github.com/adebowaleabdulwasiu00/cooplogng/releases/download/v%VER%/CoopLog-v%VER%.apk > "apk-link-v%VER%.txt"
echo [OK] Link copied (Ctrl+V to paste^). Also saved to apk-link-v%VER%.txt
:APK_DONE_MSG

echo.
echo ==========================================
echo  DONE: fresh APK v%VER% at apk\CoopLog-v%VER%.apk
echo  Paste the link above into Firestore
echo  releases/latest: apkUrl + apkVersion=v%VER%
echo  For Play Store: open android\ in Android
echo  Studio -^> Generate Signed Bundle (.aab^).
echo ==========================================
echo Window stays open so you can copy. Press Enter when done...
set /p DONE=Press Enter to close...
