
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir
)

$ErrorActionPreference = "Stop"

$taskName = "ER Capture Agent"
$installDir = [System.IO.Path]::GetFullPath($InstallDir)
$runner = Join-Path $installDir "run-agent.ps1"
$stateFile = Join-Path $installDir "update-state.json"

try {
    Write-Host "[update] Finalizando atualizacao..."

    # Sem registro anterior, nao inicia o Agent automaticamente.
    if (-not (Test-Path -LiteralPath $stateFile)) {
        Write-Host "[update] Nenhum estado anterior encontrado."
        exit 0
    }

    $state = Get-Content -LiteralPath $stateFile -Raw |
        ConvertFrom-Json

    # Confirma que o registro pertence a esta instalacao.
    if (-not [string]::Equals(
        [string]$state.InstallDir,
        $installDir,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "O registro da atualizacao pertence a outra pasta."
    }

    if (-not $state.WasRunning) {
        Write-Host "[update] Agent estava parado. Mantendo desligado."
        Remove-Item -LiteralPath $stateFile -Force
        exit 0
    }

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop

    $matchesInstall = @(
        $task.Actions | Where-Object {
            $_.Arguments -and
            $_.Arguments.Contains($runner)
        }
    ).Count -gt 0

    if (-not $matchesInstall) {
        throw "A tarefa aponta para outra instalacao."
    }

    if ($task.State -ne "Running") {
        Write-Host "[update] Reiniciando ER Capture Agent..."
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }

    Write-Host "[update] Reinicio solicitado com sucesso."

    # Apaga o estado somente apos solicitar o reinicio.
    Remove-Item -LiteralPath $stateFile -Force

    exit 0
}
catch {
    Write-Host "[update] ERRO: $($_.Exception.Message)" -ForegroundColor Red

    # Preserva o arquivo de estado para permitir recuperacao.
    exit 1
}
