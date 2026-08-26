@echo off
title MedRemind - ระบบแจ้งเตือนนัดพบแพทย์
echo ========================================================
echo   MedRemind: Doctor Appointment Reminder System
echo   ระบบแจ้งเตือนนัดแพทย์ & จัดการสุขภาพครอบครัว
echo ========================================================
echo.

set RUNTIME_NODE="C:\Users\winner\AppData\Roaming\Antigravity\bin\agy-node.cmd"

if exist %RUNTIME_NODE% (
    echo [1/2] กำลังเริ่มทำงานระบบ Backend & Scheduler...
    start "" http://localhost:3000
    call %RUNTIME_NODE% server.js
) else (
    echo [1/2] กำลังตรวจสอบ Node.js ในระบบ...
    where node >nul 2>nul
    if %errorlevel% equ 0 (
        start "" http://localhost:3000
        node server.js
    ) else (
        echo [!] ไม่พบ Node.js ในระบบ กรุณาติดตั้ง Node.js หรือเรียกผ่าน Antigravity
        pause
    )
)