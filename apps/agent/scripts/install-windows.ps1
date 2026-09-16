$ErrorActionPreference = "Stop"

$agentDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $agentDir "..\..")).Path
$envFile = Join-Path $agentDir ".env"
$credentialsFile = Join-Path $agentDir "agent-credentials.json"
$taskName = "ER Capture Agent"
$apiUrl = "https://er-replay-api.onrender.com"

Write-Host ""
Write-Host "ER CAPTURE AGENT - INSTALACAO" -ForegroundColor Magenta
Write-Host ""

if (!(Test-Path $credentialsFile)) {
  $pairingCode = (Read-Host "Cole o codigo de pareamento gerado no painel Developer").Trim()
  if ([string]::IsNullOrWhiteSpace($pairingCode)) { throw "Codigo de pareamento vazio." }

  @"
API_URL=$apiUrl
PAIRING_CODE=$pairingCode
STORAGE_ROOT=./storage
AGENT_CREDENTIALS=./agent-credentials.json
"@ | Set-Content -Encoding UTF8 $envFile
} else {
  @"
API_URL=$apiUrl
STORAGE_ROOT=./storage
AGENT_CREDENTIALS=./agent-credentials.json
"@ | Set-Content -Encoding UTF8 $envFile
  Write-Host "Este computador ja possui credencial de Agent." -ForegroundColor Yellow
}

Set-Location $repoRoot
npm run build:agent
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o ER Capture Agent." }

$node = (Get-Command node -ErrorAction Stop).Source
$entry = Join-Path $agentDir "dist\index.js"

# Primeiro boot: deixa o proprio Agent consumir o PAIRING_CODE e criar agent-credentials.json.
if (!(Test-Path $credentialsFile)) {
  Write-Host "Pareando este computador..." -ForegroundColor Cyan
  $p = Start-Process -FilePath $node -ArgumentList "`"$entry`"" -WorkingDirectory $agentDir -WindowStyle Hidden -PassThru
  $paired = $false
  for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $credentialsFile) { $paired = $true; break }
    if ($p.HasExited) { break }
  }
  if (!$p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  if (!$paired) { throw "Pareamento nao concluido. Gere um novo codigo no painel e tente novamente." }

  # O codigo e de uso unico; nao fica armazenado depois do pareamento.
  @"
API_URL=$apiUrl
STORAGE_ROOT=./storage
AGENT_CREDENTIALS=./agent-credentials.json
"@ | Set-Content -Encoding UTF8 $envFile
  Write-Host "Pareamento concluido." -ForegroundColor Green
}

$runner = Join-Path $agentDir "run-agent-hidden.ps1"
$log = Join-Path $agentDir "agent.log"
@"
`$ErrorActionPreference = "Continue"
Set-Location -LiteralPath '$($agentDir.Replace("'", "''"))'
& '$($node.Replace("'", "''"))' 'dist/index.js' *>> '$($log.Replace("'", "''"))'
"@ | Set-Content -Encoding UTF8 $runner

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runner)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Inicia automaticamente o ER Capture Agent ao entrar no Windows." -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2

$created = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
Write-Host ""
Write-Host "ER Capture Agent instalado e pareado com sucesso." -ForegroundColor Green
Write-Host "Tarefa: $($created.TaskName)"
Write-Host "Estado: $($created.State)"
Write-Host "Ultimo resultado: $($info.LastTaskResult)"
Write-Host "Log: $log"
Write-Host "Ele iniciara automaticamente quando este usuario entrar no Windows."
