@echo off
cd /d C:\Instaladores\whatsapp-workflow
if not exist logs mkdir logs
:bucle
node web\server.js >> logs\web.log 2>&1
timeout /t 10 /nobreak >nul
goto bucle