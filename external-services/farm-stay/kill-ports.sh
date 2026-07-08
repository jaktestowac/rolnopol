#!/bin/bash

# Kill processes using farmstay ports
# Ports: 50071 (inventory), 4311 (pricing), 50072 (reservation), 4319 (control)

PORTS=(50071 4311 50072 4319)

for port in "${PORTS[@]}"; do
    echo "Checking port $port..."
    
    # Find process IDs listening on the port
    PIDs=$(lsof -ti:$port 2>/dev/null)
    
    if [ -n "$PIDs" ]; then
        for pid in $PIDs; do
            echo "  Killing PID $pid on port $port..."
            kill -9 $pid 2>/dev/null && echo "  ✓ Port $port freed" || echo "  Failed to kill PID $pid"
        done
    else
        echo "  ✓ Port is free"
    fi
done

echo ""
echo "Done! Farmstay ports freed."
