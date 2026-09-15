$ErrorActionPreference = "Continue"
Set-Location -LiteralPath 'C:\Users\eduardo\Desktop\ER Replay MVP\apps\agent'
& 'C:\Program Files\nodejs\node.exe' 'dist/index.js' *>> 'C:\Users\eduardo\Desktop\ER Replay MVP\apps\agent\agent.log'
