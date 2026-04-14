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

# Rebuild DMG with the properly signed .app + Applications symlink
for app in "$BUNDLE_DIR"/macos/*.app; do
    APP_NAME="$(basename "$app" .app)"
    DMG_NAME="$(echo "$APP_NAME" | tr ' ' '.')_0.1.4_aarch64.dmg"

    # Create staging directory with .app and Applications symlink
    DMG_STAGE="/tmp/dmg-stage-$$"
    rm -rf "$DMG_STAGE"
    mkdir -p "$DMG_STAGE"
    ditto "$app" "$DMG_STAGE/$APP_NAME.app"
    ln -s /Applications "$DMG_STAGE/Applications"

    # Create DMG from staging directory
    hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_STAGE" -ov -format UDZO "$BUNDLE_DIR/dmg/$DMG_NAME"
    rm -rf "$DMG_STAGE"
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
