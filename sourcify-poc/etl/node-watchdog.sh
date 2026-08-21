#!/usr/bin/env bash
# node-watchdog.sh — keep the Cheesecake node on the DGX usable, and tell the two
# failure modes apart, because only one of them is ours to fix.
#
#   OUR NODE IS STUCK   local head behind the public endpoint  -> restart, that helps
#   THE CHAIN IS STOPPED both heads equal and the last block is old -> restarting
#                        changes nothing; the producer is down at Arkiv's end
#
# `docker restart: unless-stopped` does not cover either: the containers stay "Up"
# and healthy-looking while the chain behind them is dead. Learned on 21 Aug 2026,
# when the devnet stopped producing for hours and the containers never noticed.
#
# Install:  crontab -l | { cat; echo "*/5 * * * * $HOME/arkiv/node-watchdog.sh"; } | crontab -
set -uo pipefail

DIR="$HOME/arkiv/cheesecake"
LOG="$HOME/arkiv/watchdog.log"
STATE="$HOME/arkiv/.watchdog-state"
LOCAL="http://localhost:8545"
PUBLIC="https://rpc.cheesecake.db-chain.devnet.gobas.me"
STALE_BLOCKS=30          # how far behind the public head before we call it stuck
COOLDOWN=1800            # seconds between restarts, so a dead chain is not restarted in a loop

log() { printf '%s  %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

head_of() {
  curl -s -m 10 -X POST -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$1" \
    | grep -oE '"0x[0-9a-f]+"' | tr -d '"' | head -1
}

hex2dec() { [ -n "${1:-}" ] && printf '%d' "$1" 2>/dev/null || echo 0; }

local_hex=$(head_of "$LOCAL")
public_hex=$(head_of "$PUBLIC")   # may be empty: the public endpoint meters anonymous callers

local_n=$(hex2dec "$local_hex")
public_n=$(hex2dec "$public_hex")

if [ "$local_n" -eq 0 ]; then
  log "local RPC did not answer — restarting"
  ( cd "$DIR" && bash ./run-node.sh >/dev/null 2>&1 )
  date +%s > "$STATE"
  exit 0
fi

# No public reading (rate limited, or the endpoint is down): fall back to block age.
if [ "$public_n" -eq 0 ]; then
  ts=$(curl -s -m 10 -X POST -H 'content-type: application/json' \
        --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["latest",false]}' "$LOCAL" \
        | grep -oE '"timestamp":"0x[0-9a-f]+"' | grep -oE '0x[0-9a-f]+')
  age=$(( $(date +%s) - $(hex2dec "$ts") ))
  [ "$age" -lt 600 ] && exit 0
  log "no public reading; local head $local_n is ${age}s old — cannot tell node from chain, leaving it alone"
  exit 0
fi

behind=$(( public_n - local_n ))

if [ "$behind" -le "$STALE_BLOCKS" ]; then
  exit 0   # healthy, or the whole chain is stopped and we are correctly level with it
fi

# We are genuinely behind the network: that is ours.
last=$( [ -f "$STATE" ] && cat "$STATE" || echo 0 )
now=$(date +%s)
if [ $(( now - last )) -lt "$COOLDOWN" ]; then
  log "local $local_n is $behind behind public $public_n, but restarted recently — waiting"
  exit 0
fi

log "local $local_n is $behind behind public $public_n — refreshing peers and restarting"
( cd "$DIR" && bash ./run-node.sh >/dev/null 2>&1 )
echo "$now" > "$STATE"
