@echo off
REM Kill processes using farmstay ports
REM Ports: 50071 (inventory), 4311 (pricing), 50072 (reservation), 4319 (control)

echo Freeing farmstay ports...
echo.

for %%p in (50071 4311 50072 4319) do (
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
