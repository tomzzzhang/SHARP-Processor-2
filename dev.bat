@echo off
set CARGO_TARGET_DIR=%~dp0build-cache
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"
npx tauri dev
pause
