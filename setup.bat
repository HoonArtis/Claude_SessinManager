@echo off
rem Claude Session Manager setup - creates a desktop shortcut
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
