#!/bin/bash
# Installs (or reinstalls) the launchd agent that keeps `opencode serve`
# running on 127.0.0.1:20131 for the Raycast extension.
#
#   ./install-service.sh            install + start
#   ./install-service.sh --uninstall  stop + remove
set -euo pipefail

LABEL="pl.netfly.opencode-raycast"
PORT="${OPENCODE_RAYCAST_PORT:-20131}"
SUPPORT_DIR="$HOME/Library/Application Support/omniroute-raycast"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# launchd cannot exec scripts inside ~/Documents (macOS TCC: "Operation not
# permitted"), so the runtime copy lives in Application Support.
SERVICE_SRC="$SCRIPT_DIR/opencode-service.sh"
SERVICE_SCRIPT="$SUPPORT_DIR/opencode-service.sh"
OPENCODE_BIN="${OPENCODE_RAYCAST_BIN:-$HOME/.opencode/bin/opencode}"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

chmod +x "$SERVICE_SRC"
mkdir -p "$(dirname "$PLIST")" "$SUPPORT_DIR"
install -m 700 "$SERVICE_SRC" "$SERVICE_SCRIPT"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SERVICE_SCRIPT</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCODE_RAYCAST_PORT</key>
    <string>$PORT</string>
    <key>OPENCODE_RAYCAST_BIN</key>
    <string>$OPENCODE_BIN</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.opencode/bin:$HOME/.local/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>$SUPPORT_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$SUPPORT_DIR/launchd.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo "installed $LABEL (port $PORT)"
echo "state: $SUPPORT_DIR/server.json"
