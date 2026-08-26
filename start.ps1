# MedRemind PowerShell Launcher
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  MedRemind: Doctor Appointment Reminder System" -ForegroundColor Green
Write-Host "  ระบบแจ้งเตือนนัดแพทย์ & จัดการสุขภาพครอบครัว" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan

$runtimeNode = "C:\Users\winner\AppData\Roaming\Antigravity\bin\agy-node.cmd"

if (Test-Path $runtimeNode) {
    Write-Host "[1/2] เริ่มต้นระบบเซิร์ฟเวอร์และเปิดหน้าเว็บ..." -ForegroundColor White
    Start-Process "http://localhost:3000"
    & $runtimeNode server.js
} else {
    Start-Process "http://localhost:3000"
    node server.js
}