@echo off
rem Builds the Crackerbox installer (npm run make) from this repo and logs to
rem %USERPROFILE%\Documents\cb-install\make.log. Ends the log with MAKE-EXIT-<code>.
rem Start it hidden and poll the log in short steps (a build takes 8-10 minutes):
rem   Start-Process cmd.exe -ArgumentList '/c','<repo>\housemaster\make.cmd' -WindowStyle Hidden
setlocal
set "REPO=%~dp0.."
set "LOGDIR=%USERPROFILE%\Documents\cb-install"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if exist "%LOGDIR%\make.log" del "%LOGDIR%\make.log"
cd /d "%REPO%"
call npm run make > "%LOGDIR%\make.log" 2>&1
echo MAKE-EXIT-%ERRORLEVEL% >> "%LOGDIR%\make.log"
endlocal
