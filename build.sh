#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "==================================="
echo " Building SHARP Processor 2 (macOS)"
echo "==================================="

# Build into a local folder inside the project
export CARGO_TARGET_DIR="$(pwd)/build-cache"
npx tauri build

# Copy final DMG/app into project folder
OUT="$(pwd)/dist-release/macos"
mkdir -p "$OUT"

BUNDLE_DIR="$CARGO_TARGET_DIR/release/bundle"
if ls "$BUNDLE_DIR"/dmg/*.dmg 1>/dev/null 2>&1; then
    cp -f "$BUNDLE_DIR"/dmg/*.dmg "$OUT/"
    echo "Copied DMG to dist-release/macos/"
fi
if [ -d "$BUNDLE_DIR/macos" ]; then
    # Use ditto to preserve .app symlinks and signatures
    for app in "$BUNDLE_DIR"/macos/*.app; do
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
