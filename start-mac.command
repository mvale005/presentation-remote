#!/bin/bash
set -e

PROJECT_DIR="$HOME/Documents/presentation-remote"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "Project folder not found: $PROJECT_DIR"
  exit 1
fi

osascript <<EOF
tell application "Terminal"
    activate
    do script "cd '$PROJECT_DIR' && node server.js"
    do script "cd '$PROJECT_DIR' && ngrok http 3000"
end tell
EOF

echo "Started server and ngrok in Terminal."
