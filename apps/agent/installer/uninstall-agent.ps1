$ErrorActionPreference = "SilentlyContinue"

$taskName = "ER Capture Agent"
$installDir = $PSScriptRoot

# Para e remove a tarefa agendada
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Encerra somente processos pertencentes ao ER Capture Agent
$processes = Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and
    $_.ExecutablePath.StartsWith(
        $installDir,
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

foreach ($process in $processes) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2
