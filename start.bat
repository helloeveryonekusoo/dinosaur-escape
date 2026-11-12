@echo off
rem Starts the local server (needed for external .glb models) and opens the game.
start "Dinosaur Escape server" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
timeout /t 2 /nobreak >nul
start "" http://localhost:8765/
