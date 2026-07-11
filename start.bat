@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   商家券收藏 · 本地服务启动器
echo   启动后浏览器访问: http://localhost:8123
echo   关闭此窗口即停止服务
echo ============================================
start "" node server.js
timeout /t 2 >nul
start http://localhost:8123/
echo 服务已启动，请勿关闭此窗口。
pause
