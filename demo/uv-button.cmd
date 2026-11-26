@echo off
setlocal
set "BLENDER=%ProgramFiles%\Blender Foundation\Blender 5.0\blender.exe"
if not exist "%BLENDER%" set "BLENDER=blender.exe"
start "u&i" "%BLENDER%" --factory-startup -noaudio --python "%~dp0uv_button.py"
