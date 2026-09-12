@echo off
cd /d C:\Instaladores\whatsapp-workflow
if not exist logs mkdir logs
node src\index.js >> logs\worker.log 2>&1