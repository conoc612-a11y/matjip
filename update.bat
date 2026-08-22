@echo off
REM matjip 갱신 실행기 — 더블클릭하면 실행기가 켜지고 브라우저가 열린다.
REM 이 창을 닫으면 실행기가 꺼진다(진행 중인 수집도 함께 종료되므로 작업 중엔 닫지 말 것).
cd /d "%~dp0"
start "" http://localhost:8787
node tools\update_server.js
pause
