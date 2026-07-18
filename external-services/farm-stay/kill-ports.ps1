# Kill processes using farmstay ports
# Ports: 4310 (gateway), 50071 (inventory), 4311 (pricing), 50072 (reservation), 4312 (review-desk), 4319 (control)
#
# Two guards (see kill-port.js for the full rationale):
#  1. Only the process LISTENING on a port is killed. Matching every netstat line
#     that mentions the port would also match the gateway's CLIENT sockets to the
#     leaves (remote port = leaf port) and kill the gateway too.
#  2. Before killing, the listener's command line is confirmed to be the expected
#     FarmStay service, so a stranger squatting on the port is left alone.
#
# Usage:  .\kill-ports.ps1            # verify identity, then kill
#         .\kill-ports.ps1 -Force     # kill whatever listens, no identity check

param([switch]$Force)

# port -> marker expected in the listener's command line
$expected = @{
    4310  = "stay-gateway-service"
    50071 = "inventory-service"
    4311  = "pricing-service"
    50072 = "reservation-service"
    4312  = "review-desk-service"
    4319  = "start-all.js"
}

foreach ($port in $expected.Keys) {
    Write-Host "Checking port $port..." -ForegroundColor Cyan

    $procIds = @()
    foreach ($line in (netstat -ano -p TCP)) {
        $cols = ($line -split '\s+') | Where-Object { $_ -ne '' }
        # Columns: Proto  LocalAddress  ForeignAddress  State  PID
        if ($cols.Length -ge 5 -and $cols[3] -eq 'LISTENING' -and $cols[1].EndsWith(":$port")) {
            $procIds += [int]$cols[4]
        }
    }
    $procIds = $procIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique

    if (-not $procIds) {
        Write-Host "  ✓ Port is free" -ForegroundColor Green
        continue
    }

    $killedAny = $false
    foreach ($procId in $procIds) {
        $marker = $expected[$port]
        if (-not $Force) {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
            if ($cmd -and ($cmd -notlike "*$marker*")) {
                Write-Host "  ⚠ PID $procId is NOT a FarmStay service ($marker) — skipping (use -Force to override)." -ForegroundColor Yellow
                Write-Host "     $cmd" -ForegroundColor DarkGray
                continue
            }
        }
        $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
        $procName = if ($process) { $process.ProcessName } else { "unknown" }
        Write-Host "  Killing PID $procId ($procName) on port $port..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        $killedAny = $true
    }

    if ($killedAny) {
        Write-Host "  ✓ Port $port freed" -ForegroundColor Green
    }
    else {
        Write-Host "  ⚠ Port $port left alone (no FarmStay listener)." -ForegroundColor Yellow
    }
}

Write-Host "`nDone! Farmstay ports freed." -ForegroundColor Green
