param(
  [string]$ApiUrl = "https://er-replay-api.onrender.com"
)

$ErrorActionPreference = "Stop"

$installerDir = $PSScriptRoot
$agentDir = (Resolve-Path (Join-Path $installerDir "..")).Path
$repoRoot = (Resolve-Path (Join-Path $agentDir "..\..")).Path
$payload = Join-Path $installerDir "payload"
$output = Join-Path $installerDir "output"
$iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

Write-Host ""
Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "   ER CAPTURE AGENT - GERANDO SETUP.EXE" -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta
Write-Host ""

if (!(Test-Path $iscc)) {
  throw "Inno Setup 6 nao encontrado em $iscc"
}

Set-Location $repoRoot

Write-Host "[1/5] Compilando Agent..." -ForegroundColor Cyan
npm run build:agent
if ($LASTEXITCODE -ne 0) { throw "Falha no build do Agent." }

Write-Host "[2/5] Preparando arquivos..." -ForegroundColor Cyan
Remove-Item $payload -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $payload | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $payload "node_modules") | Out-Null

Copy-Item (Join-Path $agentDir "dist") (Join-Path $payload "dist") -Recurse

Write-Host "[3/5] Embutindo Node e FFmpeg..." -ForegroundColor Cyan
$node = (Get-Command node -ErrorAction Stop).Source
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
Copy-Item $node (Join-Path $payload "node.exe")
Copy-Item $ffmpeg (Join-Path $payload "ffmpeg.exe")

$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if ($ffprobe) {
  Copy-Item $ffprobe.Source (Join-Path $payload "ffprobe.exe")
}

# O Agent atual usa dotenv como dependencia de runtime.
$dotenv = Join-Path $repoRoot "node_modules\dotenv"
if (!(Test-Path $dotenv)) {
  $dotenv = Join-Path $agentDir "node_modules\dotenv"
}
if (!(Test-Path $dotenv)) {
  throw "dotenv nao encontrado. Rode npm install na raiz do projeto."
}
Copy-Item $dotenv (Join-Path $payload "node_modules\dotenv") -Recurse

@"
API_URL=$ApiUrl
STORAGE_ROOT=./storage
AGENT_CREDENTIALS=./agent-credentials.json
"@ | Set-Content -Encoding UTF8 (Join-Path $payload ".env")

Copy-Item (Join-Path $installerDir "pair-agent.ps1") $payload
Copy-Item (Join-Path $installerDir "run-agent.ps1") $payload
Copy-Item (Join-Path $installerDir "uninstall-agent.ps1") $payload

Write-Host "[4/5] Validando payload..." -ForegroundColor Cyan
$required = @(
  "node.exe",
  "ffmpeg.exe",
  ".env",
  "dist\index.js",
 "pair-agent.ps1",
"run-agent.ps1",
"uninstall-agent.ps1",
"node_modules\dotenv\package.json"
)
foreach ($item in $required) {
  if (!(Test-Path (Join-Path $payload $item))) {
    throw "Arquivo obrigatorio ausente no instalador: $item"
  }
}

Write-Host "[5/5] Compilando Setup.exe..." -ForegroundColor Cyan
& $iscc (Join-Path $installerDir "ER-Capture-Agent.iss")
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar com Inno Setup." }

$setup = Join-Path $output "ER-Capture-Agent-Setup-v1.0.exe"
if (!(Test-Path $setup)) { throw "ER-Capture-Agent-Setup-v1.0.exe nao foi gerado." }

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "              SETUP PRONTO" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host $setup -ForegroundColor Green
Write-Host ""
