#!/bin/sh
# Local macOS/Linux entry point. No downloads, installations, or secret output.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PATH_NODE=$(command -v node 2>/dev/null || true)
for NODE in "$PATH_NODE" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$NODE" ] && [ -x "$NODE" ] && "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
    exec "$NODE" "$ROOT/scripts/launch.mjs"
  fi
done
printf '%s\n' 'Screeps MCP requires Node.js 22+ (24 recommended). Install an official Node runtime; ChatGPT internal binaries are not supported.' >&2
exit 1
