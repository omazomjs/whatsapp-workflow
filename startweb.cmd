@echo off
cd /d C:\Instaladores\whatsapp-workflow
if not exist logs mkdir logs
node web\server.js >> logs\web.log 2>&1
