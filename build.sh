#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "==================================="
echo " Building SHARP Processor 2 (macOS)"
echo "==================================="

# Build to /tmp to avoid OneDrive sync corrupting .app signatures
export CARGO_TARGET_DIR="/tmp/tauri-build-cache"
npx tauri build

# Re-sign the .app bundle (Tauri only linker-signs the binary, not the bundle)
BUNDLE_DIR="$CARGO_TARGET_DIR/release/bundle"
for app in "$BUNDLE_DIR"/macos/*.app; do
    xattr -cr "$app"
    codesign --force --deep -s - "$app"
    echo "Signed: $(basename "$app")"
done

# Rebuild DMG with the properly signed .app
for app in "$BUNDLE_DIR"/macos/*.app; do
    DMG_NAME="$(basename "$app" .app | tr ' ' '.')_0.1.2_aarch64.dmg"
    hdiutil create -volname "$(basename "$app" .app)" -srcfolder "$app" -ov -format UDZO "$BUNDLE_DIR/dmg/$DMG_NAME"
done

# Copy final DMG/app into project folder
OUT="$(pwd)/dist-release/macos"
mkdir -p "$OUT"

if ls "$BUNDLE_DIR"/dmg/*.dmg 1>/dev/null 2>&1; then
    cp -f "$BUNDLE_DIR"/dmg/*.dmg "$OUT/"
    echo "Copied DMG to dist-release/macos/"
fi
if [ -d "$BUNDLE_DIR/macos" ]; then
    for app in "$BUNDLE_DIR"/macos/*.app; do
        rm -rf "$OUT/$(basename "$app")"
        ditto "$app" "$OUT/$(basename "$app")"
    done
    echo "Copied .app to dist-release/macos/"
fi

echo ""
echo "==================================="
echo " Build complete!"
echo " Output: dist-release/macos/"
echo "==================================="
open "$OUT"
