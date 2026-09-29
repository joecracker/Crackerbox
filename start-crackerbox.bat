@echo off
start "Crackerbox Startup" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-crackerbox.ps1"
