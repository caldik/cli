@echo off
setlocal
cd /d "%~dp0"

call bun install
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

if not "%BUILD_EXIT_CODE%"=="0" (
    echo bun install failed with exit code %BUILD_EXIT_CODE%.
    exit /b %BUILD_EXIT_CODE%
)

if not exist "dist" mkdir "dist"

call bun run build
set "BUILD_EXIT_CODE=%ERRORLEVEL%"

if not "%BUILD_EXIT_CODE%"=="0" (
    echo Build failed with exit code %BUILD_EXIT_CODE%.
    exit /b %BUILD_EXIT_CODE%
)

echo Build succeeded: dist\caldik.exe and dist\caldik.js ^(npm package^).
exit /b 0
