@echo off
title D-TECH

if "%~1"=="" (
echo Use:
echo drag a .dtech or .dteche file here
echo.
pause
exit /b 1
)

if not exist "%~1" (
echo DTECH ERROR: File not found
echo.
pause
exit /b 1
)

node "C:\Users\DanielValentinoRamos\Desktop\D-TECH-programing-language-b002\DTECH_interpreter.js" "%~1"

pause
