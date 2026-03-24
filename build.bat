@echo off
echo ===================================
echo  Building SHARP Processor 2
echo ===================================
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"

REM Build into a local folder — outside OneDrive sync
set CARGO_TARGET_DIR=%~dp0build-cache

REM Output root
set OUT=%~dp0dist-release

REM ---- x64 build ----
echo.
echo [1/2] Building x64 (64-bit)...
npx tauri build --target x86_64-pc-windows-msvc 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo *** x64 BUILD FAILED with error code %ERRORLEVEL% ***
    echo.
    pause
    exit /b %ERRORLEVEL%
)

set OUT64=%OUT%\windows-x64
if not exist "%OUT64%" mkdir "%OUT64%"
if exist "%CARGO_TARGET_DIR%\x86_64-pc-windows-msvc\release\bundle\nsis\*.exe" (
    copy /Y "%CARGO_TARGET_DIR%\x86_64-pc-windows-msvc\release\bundle\nsis\*.exe" "%OUT64%\" >nul
    echo Copied x64 NSIS installer
)
if exist "%CARGO_TARGET_DIR%\x86_64-pc-windows-msvc\release\bundle\msi\*.msi" (
    copy /Y "%CARGO_TARGET_DIR%\x86_64-pc-windows-msvc\release\bundle\msi\*.msi" "%OUT64%\" >nul
    echo Copied x64 MSI installer
)

REM ---- x86 build ----
echo.
echo [2/2] Building x86 (32-bit)...
npx tauri build --target i686-pc-windows-msvc 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo *** x86 BUILD FAILED with error code %ERRORLEVEL% ***
    echo.
    pause
    exit /b %ERRORLEVEL%
)

set OUT32=%OUT%\windows-x86
if not exist "%OUT32%" mkdir "%OUT32%"
if exist "%CARGO_TARGET_DIR%\i686-pc-windows-msvc\release\bundle\nsis\*.exe" (
    copy /Y "%CARGO_TARGET_DIR%\i686-pc-windows-msvc\release\bundle\nsis\*.exe" "%OUT32%\" >nul
    echo Copied x86 NSIS installer
)
if exist "%CARGO_TARGET_DIR%\i686-pc-windows-msvc\release\bundle\msi\*.msi" (
    copy /Y "%CARGO_TARGET_DIR%\i686-pc-windows-msvc\release\bundle\msi\*.msi" "%OUT32%\" >nul
    echo Copied x86 MSI installer
)

echo.
echo ===================================
echo  Build complete!
echo  Output: dist-release\
echo    windows-x64\  (64-bit)
echo    windows-x86\  (32-bit)
echo ===================================
explorer "%OUT%"
pause
