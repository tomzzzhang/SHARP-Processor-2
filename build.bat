@echo off
echo ===================================
echo  Building SHARP Processor 2
echo ===================================
set CARGO_TARGET_DIR=C:\tauri-build-cache
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"
npx tauri build 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo *** BUILD FAILED with error code %ERRORLEVEL% ***
    echo.
    pause
    exit /b %ERRORLEVEL%
)
echo.
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis" (
    echo Build complete!
    echo Output: %CARGO_TARGET_DIR%\release\bundle\
    explorer "%CARGO_TARGET_DIR%\release\bundle\nsis"
) else (
    echo Build may have failed — no bundle found.
    echo Expected output: %CARGO_TARGET_DIR%\release\bundle\
)
pause
