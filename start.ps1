# Rolnopol App PowerShell starter
# Usage: Right-click and 'Run with PowerShell', or run in PowerShell: .\start.ps1
# If you need to allow execution, run: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force

# Move to script directory
Set-Location -Path $PSScriptRoot

Write-Host "Starting Rolnopol App..."
Write-Host ""

try {
    # Run npm start and exit with the same code; if you want to keep PS open, we always prompt below.
    & npm run start
}
catch {
    Write-Host "Error while running application: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Application stopped."

# Keep console open and wait for enter
if ($Host.Name -eq 'ConsoleHost') {
    Read-Host -Prompt "Press Enter to close..."
} else {
    # If run from another host (VSCode integrated), just wait for a second
    Start-Sleep -Seconds 1
}
