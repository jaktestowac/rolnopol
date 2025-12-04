@echo off
title Rolnopol App
cd /d "%~dp0"
echo Starting Rolnopol App...
echo.
call npm run start
echo.
echo Application stopped.
pause
