@echo off
title Rolnopol App
cd /d "%~dp0"
echo Starting Rolnopol App...
echo.
node api/index.js
echo.
echo Application stopped.
pause
