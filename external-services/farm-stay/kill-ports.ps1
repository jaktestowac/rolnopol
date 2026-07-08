# Kill processes using farmstay ports
# Ports: 50071 (inventory), 4311 (pricing), 50072 (reservation), 4319 (control)

$ports = @(50071, 4311, 50072, 4319)

foreach ($port in $ports) {
    Write-Host "Checking port $port..." -ForegroundColor Cyan
    
    $netstatOutput = netstat -ano | Select-String ":$port\s+"
    
    if ($netstatOutput) {
        foreach ($line in $netstatOutput) {
            $parts = $line -split '\s+' | Where-Object { $_ -ne '' }
            $pid = [int]$parts[-1]
            
            if ($pid -gt 0) {
                $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
                $procName = if ($process) { $process.ProcessName } else { "unknown" }
                
                Write-Host "  Killing PID $pid ($procName) on port $port..." -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  ✓ Port $port freed" -ForegroundColor Green
            }
        }
    }
    else {
        Write-Host "  ✓ Port is free" -ForegroundColor Green
    }
}

Write-Host "`nDone! Farmstay ports freed." -ForegroundColor Green
