@echo off
echo ===================================
echo  Building SHARP Processor 2
echo ===================================
set CARGO_TARGET_DIR=C:\tauri-build-cache
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
cd /d "%~dp0"
npx tauri build
echo.
echo Build complete! Check src-tauri/target/release/bundle/
pause
