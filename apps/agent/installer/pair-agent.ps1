
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dir = $PSScriptRoot
$credentials = Join-Path $dir "agent-credentials.json"
$node = Join-Path $dir "node.exe"
$entry = Join-Path $dir "dist\index.js"
$runner = Join-Path $dir "run-agent.ps1"
$taskName = "ER Capture Agent"

function Get-AgentTask {
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Install-AgentTask {
    if (Get-AgentTask) {
        return
    }

    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument (
            '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $runner
        )

    $trigger = New-ScheduledTaskTrigger `
        -AtLogOn `
        -User $env:USERNAME

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -ExecutionTimeLimit ([TimeSpan]::Zero)

    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $taskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description "Inicia automaticamente o ER Capture Agent." `
        -Force | Out-Null
}

function Test-AgentTaskTarget {
    $task = Get-AgentTask

    if (!$task) {
        return
    }

    $expected = [System.IO.Path]::GetFullPath($runner)

    $matchesRunner = $false

    foreach ($action in $task.Actions) {
        if ($action.Arguments -and
            $action.Arguments.Contains($expected)) {
            $matchesRunner = $true
        }
    }

    if (!$matchesRunner) {
        throw (
            "A tarefa ER Capture Agent aponta para outra pasta. " +
            "Abra o Gerenciador da instalacao correta."
        )
    }
}

function Stop-AgentTaskIfRunning {
    $task = Get-AgentTask

    if ($task -and $task.State -eq "Running") {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop

        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 500

            $task = Get-AgentTask

            if (!$task -or $task.State -ne "Running") {
                break
            }
        }

        if ($task -and $task.State -eq "Running") {
            throw "Nao foi possivel parar a tarefa do Agent."
        }
    }
}

function Start-AgentTask {
    Install-AgentTask
    Test-AgentTaskTarget

    $task = Get-AgentTask

    if ($task.State -ne "Running") {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
    }
}

function Test-AgentProcesses {
    $processes = Get-CimInstance Win32_Process `
        -Filter "Name = 'node.exe'" `
        -ErrorAction Stop

    foreach ($item in $processes) {
        if (!$item.CommandLine) {
            continue
        }

        $command = $item.CommandLine

        if ($command.Contains($entry) -or
            ($command.Contains("dist\index.js") -and
             $command.Contains($dir))) {
            return $true
        }
    }

    return $false
}

$form = New-Object Windows.Forms.Form
$form.Text = "ER Capture Agent"
$form.ClientSize = New-Object Drawing.Size(520, 350)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(26, 18, 38)

$title = New-Object Windows.Forms.Label
$title.Text = "ER CAPTURE AGENT"
$title.ForeColor = [Drawing.Color]::White
$title.Font = New-Object Drawing.Font(
    "Segoe UI", 18, [Drawing.FontStyle]::Bold
)
$title.Location = New-Object Drawing.Point(32, 24)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = "Conecte este computador a sua arena"
$subtitle.ForeColor = [Drawing.Color]::Gainsboro
$subtitle.Font = New-Object Drawing.Font("Segoe UI", 10)
$subtitle.Location = New-Object Drawing.Point(35, 67)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

$label = New-Object Windows.Forms.Label
$label.Text = "Codigo de pareamento"
$label.ForeColor = [Drawing.Color]::White
$label.Location = New-Object Drawing.Point(35, 108)
$label.AutoSize = $true
$form.Controls.Add($label)

$code = New-Object Windows.Forms.TextBox
$code.Location = New-Object Drawing.Point(38, 134)
$code.Size = New-Object Drawing.Size(440, 34)
$code.Font = New-Object Drawing.Font(
    "Consolas", 14, [Drawing.FontStyle]::Bold
)
$code.CharacterCasing = "Upper"
$form.Controls.Add($code)

$status = New-Object Windows.Forms.Label
$status.ForeColor = [Drawing.Color]::Silver
$status.Location = New-Object Drawing.Point(38, 188)
$status.Size = New-Object Drawing.Size(440, 52)
$form.Controls.Add($status)

$button = New-Object Windows.Forms.Button
$button.Text = "CONECTAR / TROCAR CODIGO"
$button.Location = New-Object Drawing.Point(38, 258)
$button.Size = New-Object Drawing.Size(440, 46)
$button.Font = New-Object Drawing.Font(
    "Segoe UI", 10, [Drawing.FontStyle]::Bold
)
$form.Controls.Add($button)

if (Test-Path -LiteralPath $credentials) {
    $status.Text = (
        "Agent ja pareado. Informe um novo codigo " +
        "somente se quiser trocar a conexao."
    )
    $status.ForeColor = [Drawing.Color]::LightGreen
} else {
    $status.Text = (
        "Gere um codigo no painel Developer e cole aqui."
    )
}

$button.Add_Click({
    $pairing = $code.Text.Trim()

    if ([string]::IsNullOrWhiteSpace($pairing)) {
        [Windows.Forms.MessageBox]::Show(
            "Digite o codigo de pareamento.",
            "ER Capture Agent"
        ) | Out-Null
        return
    }

    $button.Enabled = $false
    $code.Enabled = $false

    $status.Text = "Preparando pareamento..."
    $status.ForeColor = [Drawing.Color]::Silver
    $form.Refresh()

    $id = [guid]::NewGuid().ToString("N")

    $pendingCredentials = Join-Path $dir (
        "agent-credentials.pending-$id.json"
    )

    $backup = Join-Path $dir (
        "agent-credentials.backup-$id.json"
    )

    $hadCredentials = Test-Path -LiteralPath $credentials

    $paired = $false
    $committed = $false
    $taskWasRunning = $false
    $taskStopped = $false
    $process = $null

    $previousPairingCode = [Environment]::GetEnvironmentVariable(
        "PAIRING_CODE", "Process"
    )

    $previousCredentialsPath = [Environment]::GetEnvironmentVariable(
        "AGENT_CREDENTIALS", "Process"
    )

    $previousPath = $env:PATH

    try {
        if (!(Test-Path -LiteralPath $node)) {
            throw "node.exe nao encontrado."
        }

        if (!(Test-Path -LiteralPath $entry)) {
            throw "Agent compilado nao encontrado."
        }

        if (!(Test-Path -LiteralPath $runner)) {
            throw "run-agent.ps1 nao encontrado."
        }

        Test-AgentTaskTarget

        $existingTask = Get-AgentTask

        if ($existingTask) {
            $taskWasRunning = (
                $existingTask.State -eq "Running"
            )
        }

        # Nao parear enquanto outro processo do mesmo Agent
        # estiver executando fora do controle desta janela.
        if (Test-AgentProcesses) {
            throw (
                "Ja existe um processo do Agent nesta pasta. " +
                "Encerre-o antes de trocar o codigo."
            )
        }

        # Salva uma copia das credenciais anteriores.
        if ($hadCredentials) {
            Copy-Item `
                -LiteralPath $credentials `
                -Destination $backup `
                -ErrorAction Stop
        }

        # O novo pareamento usa arquivo separado.
        # O codigo nao e gravado no disco.
        $env:PAIRING_CODE = $pairing
        $env:AGENT_CREDENTIALS = $pendingCredentials
        $env:PATH = "$dir;$previousPath"

        $status.Text = "Validando codigo com o servidor..."
        $form.Refresh()

        $process = Start-Process `
            -FilePath $node `
            -ArgumentList ('"{0}"' -f $entry) `
            -WorkingDirectory $dir `
            -WindowStyle Hidden `
            -PassThru `
            -ErrorAction Stop

        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 1
            [Windows.Forms.Application]::DoEvents()

            if (Test-Path -LiteralPath $pendingCredentials) {
                try {
                    $content = Get-Content `
                        -LiteralPath $pendingCredentials `
                        -Raw `
                        -ErrorAction Stop

                    $parsed = $content | ConvertFrom-Json `
                        -ErrorAction Stop

                    if ($parsed.token -and $parsed.agentId) {
                        $paired = $true
                        break
                    }
                }
                catch {
                    # O arquivo pode estar sendo escrito.
                }
            }

            $process.Refresh()

            if ($process.HasExited) {
                break
            }
        }

        if (!$paired) {
            throw (
                "Pareamento nao confirmado. " +
                "Verifique o codigo e tente novamente."
            )
        }

        # Encerra o processo temporario antes de iniciar
        # o Agent definitivo.
        $process.Refresh()

        if (!$process.HasExited) {
            Stop-Process `
                -Id $process.Id `
                -Force `
                -ErrorAction Stop

            $process.WaitForExit(5000) | Out-Null
        }

        # Confirma que o processo temporario terminou.
        $process.Refresh()

        if (!$process.HasExited) {
            throw "Nao foi possivel encerrar o pareamento temporario."
        }

        # Limpa as variaveis temporarias antes de iniciar
        # a tarefa definitiva.
        [Environment]::SetEnvironmentVariable(
            "PAIRING_CODE", $previousPairingCode, "Process"
        )

        [Environment]::SetEnvironmentVariable(
            "AGENT_CREDENTIALS", $previousCredentialsPath, "Process"
        )

        $env:PATH = $previousPath

        $status.Text = "Aplicando novo pareamento..."
        $form.Refresh()

        # Para a tarefa somente depois que o novo codigo
        # ja foi validado.
        if ($taskWasRunning) {
            Stop-AgentTaskIfRunning
            $taskStopped = $true
        }

        # Instala as novas credenciais.
        Copy-Item `
            -LiteralPath $pendingCredentials `
            -Destination $credentials `
            -Force `
            -ErrorAction Stop

        $committed = $true

        # Cria a tarefa se necessario e inicia o Agent.
        Start-AgentTask

        $status.Text = (
            "Novo pareamento aplicado! " +
            "Inicializacao automatica configurada."
        )

        $status.ForeColor = [Drawing.Color]::LightGreen

        # O backup so e removido apos a etapa de
        # inicializacao nao apresentar erro.
        if (Test-Path -LiteralPath $backup) {
            Remove-Item `
                -LiteralPath $backup `
                -Force `
                -ErrorAction SilentlyContinue
        }

        $code.Clear()
    }
    catch {
        $message = $_.Exception.Message

        # Se ja substituimos as credenciais e houve erro,
        # tentamos restaurar a configuracao anterior.
        if ($committed -and $hadCredentials -and
            (Test-Path -LiteralPath $backup)) {

            try {
                Copy-Item `
                    -LiteralPath $backup `
                    -Destination $credentials `
                    -Force `
                    -ErrorAction Stop
            }
            catch {
                $message += (
                    " Falha ao restaurar credenciais. " +
                    "O backup foi preservado."
                )
            }
        }

        if ($committed -and !$hadCredentials) {
            Remove-Item `
                -LiteralPath $credentials `
                -Force `
                -ErrorAction SilentlyContinue
        }

        # Se a tarefa foi interrompida, tenta
        # recuperar o Agent anterior.
        if ($taskStopped -and $hadCredentials) {
            try {
                Start-AgentTask
            }
            catch {
                $message += (
                    " Nao foi possivel reiniciar o Agent anterior."
                )
            }
        }

        $status.Text = $message
        $status.ForeColor = [Drawing.Color]::Salmon
    }
    finally {
        # Nunca deixa o codigo ou caminho temporario
        # no ambiente do Gerenciador.
        [Environment]::SetEnvironmentVariable(
            "PAIRING_CODE", $previousPairingCode, "Process"
        )

        [Environment]::SetEnvironmentVariable(
            "AGENT_CREDENTIALS", $previousCredentialsPath, "Process"
        )

        $env:PATH = $previousPath

        if ($process) {
            try {
                $process.Refresh()

                if (!$process.HasExited) {
                    Stop-Process `
                        -Id $process.Id `
                        -Force `
                        -ErrorAction SilentlyContinue
                }
            }
            catch {}
        }

        if (Test-Path -LiteralPath $pendingCredentials) {
            Remove-Item `
                -LiteralPath $pendingCredentials `
                -Force `
                -ErrorAction SilentlyContinue
        }

        # Mantem o backup quando houve falha de recuperacao.
        # Em caso de sucesso, ele ja foi removido.
        $code.Enabled = $true
        $button.Enabled = $true
    }
})

[void]$form.ShowDialog()
