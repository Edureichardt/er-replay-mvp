$ErrorActionPreference = "SilentlyContinue"
schtasks /End /TN "ER Capture Agent" | Out-Null
schtasks /Delete /TN "ER Capture Agent" /F | Out-Host
Write-Host "Inicializacao automatica do ER Capture Agent removida."
