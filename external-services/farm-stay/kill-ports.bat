@echo off
REM Kill processes using farmstay ports
REM Ports: 4310 (gateway), 50071 (inventory), 4311 (pricing), 50072 (reservation), 4312 (review-desk), 4319 (control)
REM
REM Kills only the process LISTENING on each port (the ".*LISTENING" filter keeps
REM us from matching the gateway's client sockets to the leaves). This .bat does
REM NOT verify the listener is actually a FarmStay service. For that identity
REM check use the Node scripts instead:  node kill-all.js  /  node kill-service.js <name>
REM (wired as npm run farmstay:kill and farmstay:kill:<name>).

echo Freeing farmstay ports...
echo.

for %%p in (4310 50071 4311 50072 4312 4319) do (
    echo Checking port %%p...
    
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%%p.*LISTENING"') do (
        if not "%%a"=="" (
            echo   Killing PID %%a...
            taskkill /PID %%a /F >nul 2>&1
            if !errorlevel! equ 0 (
                echo   ^✓ Port %%p freed
            ) else (
                echo   Failed to kill PID %%a
            )
        )
    )
)

echo.
echo Done! Farmstay ports should now be free.
pause
