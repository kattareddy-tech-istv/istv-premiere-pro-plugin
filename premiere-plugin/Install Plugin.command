#!/bin/bash
# Install Plugin.command
# Double-click this file on Mac to install the plugin automatically.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.insidesuccesstv.cutsheet"

# ── Enable unsigned CEP extensions for ALL known Premiere versions ──
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.9  PlayerDebugMode 1 2>/dev/null || true
defaults write com.adobe.CSXS.8  PlayerDebugMode 1 2>/dev/null || true

# ── Copy plugin files ──
mkdir -p "$DEST"
rsync -a --delete --exclude="Install Plugin.command" --exclude="install.sh" --exclude="install.bat" --exclude="HOW TO INSTALL.txt" --exclude="README.md" "$SCRIPT_DIR/" "$DEST/"

# ── Download CSInterface.js if missing ──
if [ ! -f "$DEST/CSInterface.js" ]; then
  curl -fsSL "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js" \
       -o "$DEST/CSInterface.js" 2>/dev/null || true
fi

# ── Done — show popup ──
osascript -e 'display dialog "Plugin installed successfully!\n\n1. Quit Premiere Pro completely\n2. Reopen Premiere Pro\n3. Open your project\n4. Go to: Window → Extensions → Inside Success TV — Cut Sheet" buttons {"OK"} default button "OK" with title "Inside Success TV Plugin"'
