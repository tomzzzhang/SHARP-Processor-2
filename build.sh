#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "==================================="
echo " Building SHARP Processor 2 (macOS)"
echo "==================================="

npx tauri build

BUNDLE_DIR="src-tauri/target/release/bundle"
if [ -d "$BUNDLE_DIR/dmg" ]; then
    echo ""
    echo "Build complete!"
    echo "DMG: $BUNDLE_DIR/dmg/"
    echo "App: $BUNDLE_DIR/macos/"
    open "$BUNDLE_DIR/dmg"
else
    echo ""
    echo "*** No DMG bundle found at $BUNDLE_DIR/dmg ***"
fi
