@echo off
setlocal EnableDelayedExpansion
title Test Web - CoopLog
echo ==========================================
echo  CoopLog - Web Test (build + dev server)
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

echo [Step 0/2] Preflight: checking required tools...
echo ------------------------------------------
call :ENSURE_BIN node "Node.js" OpenJS.NodeJS.LTS "https://nodejs.org/"
if errorlevel 1 exit /b 1
call :ENSURE_DEPS
if errorlevel 1 exit /b 1
echo [OK] All required tools ready.
echo.

echo [Step 1/2] Building web app...
echo ------------------------------------------
call npm run build
if errorlevel 1 (
    echo [ERROR] Web build failed. Fix the errors above and re-run.
    pause
    exit /b 1
)
echo [OK] dist/ rebuilt at %CD%\dist
echo.

echo [Step 2/2] Starting dev server + opening browser...
echo ------------------------------------------
call :FIND_ANY_BROWSER
if not errorlevel 1 goto :BROWSER_OK
echo [INFO] No browser detected on this PC. Trying automatic Chrome install...
call :TRY_INSTALL_CHROME
call :FIND_ANY_BROWSER
if not errorlevel 1 goto :BROWSER_OK
echo [WARNING] No browser found. Starting dev server anyway - open http://localhost:5173 manually once you install a browser.
start "CoopLog Dev Server" cmd /c "npm run dev"
goto :BROWSER_DONE
:BROWSER_OK
start "CoopLog Dev Server" cmd /c "npm run dev"
echo Waiting for dev server at http://localhost:5173 ...
timeout /t 10 /nobreak >nul
call :OPEN_BROWSER "http://localhost:5173"
:BROWSER_DONE
echo.
echo ==========================================
echo  DONE: web test running.
echo  - Web build : %CD%\dist
echo  - Dev server: http://localhost:5173 (close its window to stop)
echo ==========================================
pause
exit /b 0

:: ================= Subroutines (flat style: no EXIT/GOTO inside blocks) =================

:ENSURE_BIN
:: %1=binary  %2=friendly name  %3=winget id  %4=manual URL
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

:TRY_INSTALL_CHROME
:: Only runs when FIND_ANY_BROWSER already failed (no browser on PC).
:: Double-check once more so we never download Chrome when a browser exists.
call :FIND_ANY_BROWSER
if not errorlevel 1 exit /b 0
where winget >nul 2>nul
if errorlevel 1 goto :TC_NOWINGET
call winget install -e --id Google.Chrome --accept-source-agreements --accept-package-agreements
exit /b 0
:TC_NOWINGET
echo [INFO] winget unavailable - cannot auto-install Chrome.
exit /b 1

:FIND_ANY_BROWSER
:: Returns 0 if ANY browser is found, 1 if no browser on PC.
where chrome >nul 2>nul
if not errorlevel 1 exit /b 0
where msedge >nul 2>nul
if not errorlevel 1 exit /b 0
where firefox >nul 2>nul
if not errorlevel 1 exit /b 0
where brave >nul 2>nul
if not errorlevel 1 exit /b 0
where opera >nul 2>nul
if not errorlevel 1 exit /b 0
where chromium >nul 2>nul
if not errorlevel 1 exit /b 0
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" exit /b 0
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" exit /b 0
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" exit /b 0
if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" exit /b 0
if exist "%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe" exit /b 0
if exist "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe" exit /b 0
if exist "%LocalAppData%\Opera\opera.exe" exit /b 0
if exist "%ProgramFiles%\Opera\opera.exe" exit /b 0
:: 32-bit Program Files variants (uses short env expansion to avoid parens issues)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" exit /b 0
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" exit /b 0
if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" exit /b 0
exit /b 1

:FIND_CHROME
:: Returns 0 if Chrome specifically is found (PATH or standard install folder).
where chrome >nul 2>nul
if not errorlevel 1 exit /b 0
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" exit /b 0
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" exit /b 0
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" exit /b 0
exit /b 1

:OPEN_BROWSER
:: %1 = URL. Prefers Chrome when present, else uses Windows default browser.
call :FIND_CHROME
if not errorlevel 1 (
    start chrome "%~1"
    exit /b 0
)
start "" "%~1"
exit /b 0
