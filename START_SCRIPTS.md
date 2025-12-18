# Start Scripts for Rolnopol App

This project includes several convenience scripts to start the app from different shells/environments. They all navigate to the repository root directory before running the app directly and keep the console open after the app stops or crashes.

Files:

- `start.bat` — Windows CMD. Double-click or run from a command prompt. Uses `call` and `pause` so the console remains open.

- `start.ps1` — PowerShell. Run with `.\start.ps1` or right-click file and select "Run with PowerShell". If execution policy prevents running, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force`.

- `start.zsh` — Zsh (macOS/Linux). Run with `./start.zsh` (make executable with `chmod +x start.zsh`). Will wait for any key before closing.

- `start.sh` — Bash (Linux/macOS/WSL). Run with `./start.sh` (make executable with `chmod +x start.sh`). Will wait for Enter to close.

# Notes:

- For PowerShell, if `npm` is not recognized, ensure Node is installed and available in `$env:PATH`.
- The scripts assume Node and npm are in PATH.
- They keep the terminal open when the app exits so you can read error messages.
- They make starting the app easier for non-technical users.
