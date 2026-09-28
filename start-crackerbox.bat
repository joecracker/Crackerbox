@echo off
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process powershell -ArgumentList '-NoProfile','-Command','cd C:\Users\user\Documents\dyad; npm run dev *> C:\Users\user\Documents\dyad\dev-latest.log' -WindowStyle Hidden"
