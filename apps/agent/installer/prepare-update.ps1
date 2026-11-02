
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$taskName = "ER Capture Agent"
$installDir = [System.IO.Path]::GetFullPath($InstallDir)
$runner = Join-Path $installDir "run-agent.ps1"
$nodeExe = Join-Path $installDir "node.exe"
$stateFile = Join-Path $installDir "update-state.json"

function Get-AgentProcesses {
    @(
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object {
                $_.ExecutablePath -and
                [string]::Equals(
                    $_.ExecutablePath,
                    $nodeExe,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            }
    )
}

try {
    Write-Host "[update] Verificando ER Capture Agent..."

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

    $wasRunning = $false

    if ($task) {
        $actions = @($task.Actions)

        $matchesInstall = @(
            $actions | Where-Object {
                $_.Arguments -and
                $_.Arguments.Contains($runner)
            }
        ).Count -gt 0

        if (-not $matchesInstall) {
            throw "A tarefa aponta para outra instalacao. Atualizacao cancelada."
        }

        $wasRunning = ($task.State -eq "Running")
    }

    $state = @{
        WasRunning = $wasRunning
        InstallDir = $installDir
        SavedAt = (Get-Date).ToString("o")
    }

    # Registra o estado para a etapa posterior da instalacao.
    $state |
        ConvertTo-Json |
        Set-Content -LiteralPath $stateFile -Encoding UTF8

    if ($wasRunning) {
        Write-Host "[update] Parando tarefa agendada..."
        Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }

    # Confirma que o Node pertencente a esta instalacao terminou.
    $deadline = (Get-Date).AddSeconds(15)

    do {
        $processes = @(Get-AgentProcesses)

        if ($processes.Count -eq 0) {
            Write-Host "[update] Agent parado. Atualizacao liberada."
            exit 0
        }

        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "O processo Node continua ativo. Atualizacao cancelada."
}
catch {
    Write-Host "[update] ERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
