@echo off
chcp 65001 > nul
title Threads Automation Dashboard
echo ========================================================
echo  Threads Affiliate Studio Web Dashboard Starting...
echo ========================================================
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3500"
node server.mjs
pause
