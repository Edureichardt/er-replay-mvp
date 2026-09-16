$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dir = $PSScriptRoot
$credentials = Join-Path $dir "agent-credentials.json"
$node = Join-Path $dir "node.exe"
$entry = Join-Path $dir "dist\index.js"
$taskName = "ER Capture Agent"

function Install-AgentTask {
  $runner = Join-Path $dir "run-agent.ps1"

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

  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Inicia automaticamente o ER Capture Agent." `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $taskName
}

$form = New-Object Windows.Forms.Form
$form.Text = "ER Capture Agent"
$form.ClientSize = New-Object Drawing.Size(520,330)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [Drawing.Color]::FromArgb(26,18,38)

$title = New-Object Windows.Forms.Label
$title.Text = "ER CAPTURE AGENT"
$title.ForeColor = [Drawing.Color]::White
$title.Font = New-Object Drawing.Font("Segoe UI",18,[Drawing.FontStyle]::Bold)
$title.Location = New-Object Drawing.Point(32,24)
$title.AutoSize = $true
$form.Controls.Add($title)

$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = "Conecte este computador a sua arena"
$subtitle.ForeColor = [Drawing.Color]::Gainsboro
$subtitle.Font = New-Object Drawing.Font("Segoe UI",10)
$subtitle.Location = New-Object Drawing.Point(35,67)
$subtitle.AutoSize = $true
$form.Controls.Add($subtitle)

$label = New-Object Windows.Forms.Label
$label.Text = "Codigo de pareamento"
$label.ForeColor = [Drawing.Color]::White
$label.Location = New-Object Drawing.Point(35,108)
$label.AutoSize = $true
$form.Controls.Add($label)

$code = New-Object Windows.Forms.TextBox
$code.Location = New-Object Drawing.Point(38,134)
$code.Size = New-Object Drawing.Size(440,34)
$code.Font = New-Object Drawing.Font("Consolas",14,[Drawing.FontStyle]::Bold)
$code.CharacterCasing = "Upper"
$form.Controls.Add($code)

$status = New-Object Windows.Forms.Label
$status.Text = "Gere um codigo no painel Developer e cole aqui."
$status.ForeColor = [Drawing.Color]::Silver
$status.Location = New-Object Drawing.Point(38,188)
$status.Size = New-Object Drawing.Size(440,42)
$form.Controls.Add($status)

$button = New-Object Windows.Forms.Button
$button.Text = "CONECTAR A ARENA"
$button.Location = New-Object Drawing.Point(38,250)
$button.Size = New-Object Drawing.Size(440,46)
$button.Font = New-Object Drawing.Font("Segoe UI",10,[Drawing.FontStyle]::Bold)
$form.Controls.Add($button)

if (Test-Path $credentials) {
  try {
    Install-AgentTask
    $status.Text = "Agent ja pareado. Inicializacao automatica ativada."
    $status.ForeColor = [Drawing.Color]::LightGreen
    $code.Enabled = $false
    $button.Text = "CONCLUIR"
    $button.Add_Click({ $form.Close() })
  } catch {
    $status.Text = $_.Exception.Message
    $status.ForeColor = [Drawing.Color]::Salmon
  }
} else {
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
    $status.Text = "Pareando este computador..."
    $status.ForeColor = [Drawing.Color]::Silver
    $form.Refresh()

    try {
      # O codigo fica apenas na memoria deste processo.
      # dotenv nao sobrescreve esta variavel, entao o Agent a recebe sem grava-la no disco.
      $env:PAIRING_CODE = $pairing
      $env:PATH = "$dir;$env:PATH"

      $process = Start-Process `
        -FilePath $node `
        -ArgumentList "`"$entry`"" `
        -WorkingDirectory $dir `
        -WindowStyle Hidden `
        -PassThru

      $paired = $false

      for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        [Windows.Forms.Application]::DoEvents()

        if (Test-Path $credentials) {
          $paired = $true
          break
        }

        if ($process.HasExited) {
          break
        }
      }

      if (!$process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }

      Remove-Item Env:\PAIRING_CODE -ErrorAction SilentlyContinue

      if (!$paired) {
        throw "Nao foi possivel parear. Gere um novo codigo no painel Developer e tente novamente."
      }

      Install-AgentTask

      $status.Text = "Agent conectado. Inicializacao automatica ativada."
      $status.ForeColor = [Drawing.Color]::LightGreen
      $button.Text = "CONCLUIR"
      $button.Enabled = $true

      # Remove handlers anteriores e transforma o botao em fechar.
      $button.Add_Click({ $form.Close() })
    }
    catch {
      Remove-Item Env:\PAIRING_CODE -ErrorAction SilentlyContinue
      $status.Text = $_.Exception.Message
      $status.ForeColor = [Drawing.Color]::Salmon
      $code.Enabled = $true
      $button.Enabled = $true
    }
  })
}

[void]$form.ShowDialog()
