#!/usr/bin/env bash
# Orion Linux launcher — one command to run the quest completer.
#
#   ./run.sh            start Canary + relay, then auto-inject the userscript
#   ./run.sh --manual   start Canary + relay, print paste instructions instead
#
# Requirements: Discord Canary, Node >= 22 (auto-inject), python3 (relay, optional).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PORT=9222
MANUAL=0
[[ "${1:-}" == "--manual" ]] && MANUAL=1

info() { printf '\033[1;34m[orion]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[orion]\033[0m %s\n' "$*" >&2; }

# --- 1. Discord Canary -------------------------------------------------------
if ! command -v discord-canary >/dev/null 2>&1; then
    err "Discord Canary is not installed."
    err "  Arch Linux:   yay -S discord-canary"
    err "  Other distro: install the 'Discord Canary' build from https://discord.com/download"
    err "The userscript needs Canary (or PTB): Discord Stable's webpack no longer exposes the module cache."
    exit 1
fi

# --- 2. Node (for auto-inject) ----------------------------------------------
if [[ "$MANUAL" -eq 0 ]] && ! command -v node >/dev/null 2>&1; then
    err "node (>= 22) is required for auto-inject. Install it, or run with --manual."
    exit 1
fi

# --- 3. Achievement relay (optional, for ACHIEVEMENT_IN_ACTIVITY quests) -----
RELAY="$ROOT_DIR/tools/orion-relay/orion-relay.py"
if command -v python3 >/dev/null 2>&1 && [[ -f "$RELAY" ]]; then
    if curl -sf --max-time 2 http://127.0.0.1:43210/health >/dev/null 2>&1; then
        info "relay already running on 127.0.0.1:43210"
    else
        nohup python3 "$RELAY" >/tmp/orion-relay.log 2>&1 &
        info "relay started on 127.0.0.1:43210"
    fi
else
    info "python3 not found — achievement quests won't auto-complete (video/game/activity still work)."
fi

# --- 4. Relaunch Canary with remote debugging --------------------------------
pkill -f "Discord[C]anary" 2>/dev/null || true
sleep 1
nohup discord-canary --remote-debugging-port="$PORT" >/tmp/orion-canary.log 2>&1 &
info "Discord Canary launched (CDP on 127.0.0.1:$PORT). Log into it if prompted."

if [[ "$MANUAL" -eq 1 ]]; then
    echo
    info "Manual mode. When Discord is loaded:"
    info "  1. Press Ctrl+Shift+I and open the Console tab."
    info "  2. Paste the whole contents of this file, then Enter:"
    info "       $ROOT_DIR/index.js"
    info "  3. A quest picker appears — choose and hit START."
    exit 0
fi

# --- 5. Auto-inject the userscript ------------------------------------------
node "$SCRIPT_DIR/inject.mjs" "$ROOT_DIR/index.js"
