@echo off
setlocal EnableDelayedExpansion
title Test All - CoopLog
echo ==========================================
echo  CoopLog - Test Menu (Web, Android, EXE)
echo ==========================================
echo.
echo   1 = Web only      (Test-Web.bat)
echo   2 = Android only  (Test-Android.bat)
echo   3 = Desktop only  (Test-Desktop.bat)
echo   4 = All three, one after another
echo   0 = Exit
echo.

:ASK
set "CHOICE="
set /p CHOICE="Pick 1-4 (0 to exit): "
if "%CHOICE%"=="1" goto :RUN_WEB
if "%CHOICE%"=="2" goto :RUN_ANDROID
if "%CHOICE%"=="3" goto :RUN_DESKTOP
if "%CHOICE%"=="4" goto :RUN_ALL
if "%CHOICE%"=="0" exit /b 0
echo [INFO] Enter 1, 2, 3, 4 or 0.
goto :ASK

:RUN_WEB
call "%~dp0Test-Web.bat"
goto :END

:RUN_ANDROID
call "%~dp0Test-Android.bat"
goto :END

:RUN_DESKTOP
call "%~dp0Test-Desktop.bat"
goto :END

:RUN_ALL
call "%~dp0Test-Web.bat"
if errorlevel 1 goto :FAILED
call "%~dp0Test-Android.bat"
if errorlevel 1 goto :FAILED
call "%~dp0Test-Desktop.bat"
if errorlevel 1 goto :FAILED
echo.
echo ==========================================
echo  DONE: all three test sessions finished.
echo ==========================================
goto :END

:FAILED
echo.
echo [STOPPED] A step failed - remaining steps skipped.
goto :END

:END
pause
exit /b 0
