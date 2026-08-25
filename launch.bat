@echo off
rem Claude 세션 매니저 실행기 — 서버가 없으면 띄우고 브라우저를 연다
netstat -ano | findstr ":7777" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 goto open
start "csm-server" /min cmd /c "cd /d %~dp0 && node server.js"
timeout /t 2 /nobreak >nul
:open
start "" http://localhost:7777
