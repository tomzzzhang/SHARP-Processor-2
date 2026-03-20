@echo off
set CARGO_TARGET_DIR=C:\tauri-build-cache
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"
npx tauri dev
pause
