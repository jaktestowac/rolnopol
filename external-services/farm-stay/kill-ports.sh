#!/bin/bash

# Kill processes using farmstay ports
# Ports: 4310 (gateway), 50071 (inventory), 4311 (pricing), 50072 (reservation), 4312 (review-desk), 4319 (control)
#
# Two guards (see kill-port.js for the full rationale):
#  1. Only the process LISTENING on a port is killed (-sTCP:LISTEN), so a client
#     socket whose remote port is the leaf port — e.g. the gateway's keep-alive
#     socket — is never matched, and we don't kill the gateway with the leaf.
#  2. Before killing, the listener's command line is confirmed to be the expected
#     FarmStay service, so a stranger squatting on the port is left alone.
#
# Usage:  ./kill-ports.sh            # verify identity, then kill
#         ./kill-ports.sh --force    # kill whatever listens, no identity check

FORCE=0
[ "$1" = "--force" ] && FORCE=1

# port:marker pairs (marker expected in the listener's command line)
TARGETS=(
    "4310:stay-gateway-service"
    "50071:inventory-service"
    "4311:pricing-service"
    "50072:reservation-service"
    "4312:review-desk-service"
    "4319:start-all.js"
)

for entry in "${TARGETS[@]}"; do
    port="${entry%%:*}"
    marker="${entry#*:}"
    echo "Checking port $port..."

    # PIDs LISTENING on the port only.
    PIDs=$(lsof -ti:"$port" -sTCP:LISTEN 2>/dev/null)

    if [ -z "$PIDs" ]; then
        echo "  ✓ Port is free"
        continue
    fi

    killed=0
    for pid in $PIDs; do
        if [ "$FORCE" -ne 1 ]; then
            cmd=$(ps -p "$pid" -o args= 2>/dev/null)
            case "$cmd" in
                *"$marker"*) ;; # ours — proceed
                *)
                    echo "  ⚠ PID $pid is NOT a FarmStay service ($marker) — skipping (use --force to override)."
                    echo "     $cmd"
                    continue
                    ;;
            esac
        fi
        if kill -9 "$pid" 2>/dev/null; then
            echo "  Killed PID $pid on port $port"
            killed=1
        fi
    done

    if [ "$killed" -eq 1 ]; then
        echo "  ✓ Port $port freed"
    else
        echo "  ⚠ Port $port left alone (no FarmStay listener)."
    fi
done

echo ""
echo "Done! Farmstay ports freed."
