@echo off
echo ===================================
echo  Building SHARP Processor 2
echo ===================================
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"

REM Build into a local folder (not C: drive) — but outside OneDrive sync
set CARGO_TARGET_DIR=%~dp0build-cache
npx tauri build 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo *** BUILD FAILED with error code %ERRORLEVEL% ***
    echo.
    pause
    exit /b %ERRORLEVEL%
)

REM Copy final installers into project folder
echo.
set OUT=%~dp0dist-release
if not exist "%OUT%" mkdir "%OUT%"
if exist "%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe" (
    copy /Y "%CARGO_TARGET_DIR%\release\bundle\nsis\*.exe" "%OUT%\" >nul
    echo Copied NSIS installer to dist-release\
)
if exist "%CARGO_TARGET_DIR%\release\bundle\msi\*.msi" (
    copy /Y "%CARGO_TARGET_DIR%\release\bundle\msi\*.msi" "%OUT%\" >nul
    echo Copied MSI installer to dist-release\
)
echo.
echo Build complete!  Output: dist-release\
explorer "%OUT%"
pause
