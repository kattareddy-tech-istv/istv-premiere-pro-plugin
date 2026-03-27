#!/bin/bash
# install.sh — macOS installer for the Inside Success TV Cut Sheet plugin
# Run with: bash install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.insidesuccesstv.cutsheet"

echo ""
echo "Inside Success TV — Cut Sheet Plugin Installer (macOS)"
echo "======================================================="

# ── Enable unsigned extensions ──
echo "[1/3] Enabling unsigned CEP extensions..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.9  PlayerDebugMode 1 2>/dev/null || true
echo "     Done."

# ── Copy plugin ──
echo "[2/3] Copying plugin to: $DEST"
mkdir -p "$DEST"
rsync -a --delete "$SCRIPT_DIR/" "$DEST/"
echo "     Done."

# ── Fetch CSInterface.js ──
echo "[3/3] Fetching CSInterface.js..."
if [ ! -f "$DEST/CSInterface.js" ]; then
  curl -fsSL "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js" \
       -o "$DEST/CSInterface.js" && echo "     Downloaded." || echo "     WARNING: download failed — place CSInterface.js manually."
else
  echo "     Already present."
fi

echo ""
echo "✓ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Restart Adobe Premiere Pro"
echo "  2. Go to: Window > Extensions > Inside Success TV — Cut Sheet"
echo "  3. Make sure your backend is running"
echo ""
