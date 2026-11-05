@echo off
chcp 65001 >nul
rem Drag screenshots onto this file, or put them in the screenshot folder and double-click.
wsl.exe --cd "%~dp0." -e bash tools/make.sh %*
pause
