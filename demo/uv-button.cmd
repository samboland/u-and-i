@echo off
setlocal
set "BLENDER=%ProgramFiles%\Blender Foundation\Blender 5.3\blender.exe"
if not exist "%BLENDER%" set "BLENDER=blender.exe"
set "UAI_BLENDER_CONFIG=%APPDATA%\u-and-i\Blender\5.3\config"
if not defined BLENDER_USER_CONFIG set "BLENDER_USER_CONFIG=%APPDATA%\Blender Foundation\Blender\5.3\config"
if not exist "%UAI_BLENDER_CONFIG%\" mkdir "%UAI_BLENDER_CONFIG%" || exit /b 1
if not exist "%UAI_BLENDER_CONFIG%\userpref.blend" if exist "%BLENDER_USER_CONFIG%\userpref.blend" (
    copy /y "%BLENDER_USER_CONFIG%\userpref.blend" "%UAI_BLENDER_CONFIG%\userpref.blend" >nul || exit /b 1
)
set "BLENDER_USER_CONFIG=%UAI_BLENDER_CONFIG%"
start "u&i" "%BLENDER%" -noaudio --python-expr "import bpy; bpy.ops.wm.read_homefile(use_factory_startup=True)" --python "%~dp0uv_button.py"
