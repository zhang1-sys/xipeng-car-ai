$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontendDir = Join-Path $repoRoot "frontend"
$backendDir = Join-Path $repoRoot "backend"

$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3010" }
$backendPort = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "3001" }
$apiUrl = "http://127.0.0.1:$backendPort"

Write-Host "Starting backend on $backendPort ..."
$backendCmd = "$env:PORT='$backendPort'; Set-Location '$repoRoot'; node backend\\server.js"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd | Out-Null

Start-Sleep -Seconds 2

Write-Host "Starting frontend on $frontendPort ..."
$frontendCmd = "$env:NEXT_PUBLIC_API_URL='$apiUrl'; Set-Location '$frontendDir'; npm run dev -- --hostname 0.0.0.0 --port $frontendPort"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd | Out-Null

Write-Host ""
Write-Host "Frontend: http://127.0.0.1:$frontendPort"
Write-Host "Frontend: http://localhost:$frontendPort"
Write-Host "Backend : http://127.0.0.1:$backendPort/health"
Write-Host ""
Write-Host "If the browser does not open automatically, paste the frontend URL into your browser."
