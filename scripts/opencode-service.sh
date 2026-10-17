#!/bin/bash
# OmniRoute Raycast <-> opencode bridge
# Runs `opencode serve` with a stable password so the Raycast extension can
# connect instantly. Started by launchd (pl.netfly.opencode-raycast).
set -uo pipefail

PORT="${OPENCODE_RAYCAST_PORT:-20131}"
HOST="127.0.0.1"
SUPPORT_DIR="$HOME/Library/Application Support/omniroute-raycast"
STATE_FILE="$SUPPORT_DIR/server.json"
LOG_FILE="$SUPPORT_DIR/opencode.log"
OPENCODE_BIN="${OPENCODE_RAYCAST_BIN:-$HOME/.opencode/bin/opencode}"

mkdir -p "$SUPPORT_DIR"
chmod 700 "$SUPPORT_DIR"

# --- password: generate once, reuse forever -------------------------------
if [ ! -s "$STATE_FILE" ]; then
  PW="$(/usr/bin/openssl rand -hex 32)"
  umask 077
  cat > "$STATE_FILE" <<JSON
{
  "port": $PORT,
  "host": "$HOST",
  "password": "$PW",
  "opencodeBin": "$OPENCODE_BIN",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
  chmod 600 "$STATE_FILE"
fi

PW="$(/usr/bin/python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["password"])' "$STATE_FILE")"

# keep the port in sync with the state file
/usr/bin/python3 - "$STATE_FILE" "$PORT" <<'PY'
import json, sys
path, port = sys.argv[1], int(sys.argv[2])
data = json.load(open(path))
if data.get("port") != port:
    data["port"] = port
    json.dump(data, open(path, "w"), indent=2)
PY

if [ ! -x "$OPENCODE_BIN" ]; then
  echo "opencode binary not found at $OPENCODE_BIN" >&2
  exit 78
fi

export OPENCODE_SERVER_PASSWORD="$PW"
export OPENCODE_RAYCAST_PORT="$PORT"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting opencode serve on $HOST:$PORT" >> "$LOG_FILE"

exec "$OPENCODE_BIN" serve --port "$PORT" --hostname "$HOST" >> "$LOG_FILE" 2>&1
