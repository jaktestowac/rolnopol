#!/bin/zsh

# Navigate to the script's directory
cd "$(dirname "$0")"

echo "Starting Rolnopol App..."
echo

node api/index.js

echo
echo "Application stopped."
# Keep console open on exit
read -k "Press any key to continue..."
