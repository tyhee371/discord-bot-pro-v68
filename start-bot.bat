@echo off
title Discord Bot Pro v68
cd /d "%~dp0"
:restart
echo [%date% %time%] Starting bot...
node --dns-result-order=ipv4first --env-file=.env src/index.js
echo [%date% %time%] Bot stopped (exit code %errorlevel%). Restarting in 5s...
timeout /t 5 /nobreak >nul
goto restart
