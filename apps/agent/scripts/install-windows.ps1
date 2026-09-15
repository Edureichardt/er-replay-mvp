$ErrorActionPreference = "Stop"

$agentDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $agentDir "..\..")).Path
$envFile = Join-Path $agentDir ".env"

if (!(Test-Path $envFile)) {
  throw "Crie apps\agent\.env antes de instalar o ER Capture Agent."
}

Set-Location $repoRoot
npm run build:agent
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o ER Capture Agent." }

$node = (Get-Command node -ErrorAction Stop).Source
$runner = Join-Path $agentDir "run-agent-hidden.ps1"
$log = Join-Path $agentDir "agent.log"
$taskName = "ER Capture Agent"

# O runner evita colocar caminhos com espacos diretamente no comando da tarefa.
@"
`$ErrorActionPreference = "Continue"
Set-Location -LiteralPath '$($agentDir.Replace("'", "''"))'
& '$($node.Replace("'", "''"))' 'dist/index.js' *>> '$($log.Replace("'", "''"))'
"@ | Set-Content -Encoding UTF8 $runner

# Usa a API nativa do Agendador de Tarefas, que trata corretamente caminhos com espacos.
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runner)

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Inicia automaticamente o ER Capture Agent ao entrar no Windows." `
    -Force | Out-Null

  $created = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2

  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  Write-Host ""
  Write-Host "ER Capture Agent instalado com sucesso." -ForegroundColor Green
  Write-Host "Tarefa: $($created.TaskName)"
  Write-Host "Estado: $($created.State)"
  Write-Host "Ultimo resultado: $($info.LastTaskResult)"
  Write-Host "Log: $log"
  Write-Host "Ele iniciara automaticamente quando este usuario entrar no Windows."
} catch {
  throw "Nao foi possivel instalar a inicializacao automatica do ER Capture Agent: $($_.Exception.Message)"
}
