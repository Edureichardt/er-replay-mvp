$ErrorActionPreference = "Continue"

$dir = $PSScriptRoot
Set-Location -LiteralPath $dir

# Faz o Agent encontrar ffmpeg.exe/ffprobe.exe embutidos no instalador.
$env:PATH = "$dir;$env:PATH"

& (Join-Path $dir "node.exe") (Join-Path $dir "dist\index.js") *>> (Join-Path $dir "agent.log")
