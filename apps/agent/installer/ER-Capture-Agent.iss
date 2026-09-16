#define MyAppName "ER Capture Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "ER"
#define MyAppExeName "node.exe"

[Setup]
AppId={{8AF02746-C2A1-47C8-B73C-19E2B68A35F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}
VersionInfoVersion=1.0.0.0
VersionInfoCompany=ER
VersionInfoDescription=ER Capture Agent
VersionInfoProductName=ER Capture Agent
VersionInfoProductVersion=1.0.0
DefaultDirName={localappdata}\ER Capture Agent
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=output
OutputBaseFilename=ER-Capture-Agent-Setup-v1.0
SetupIconFile=assets\er-agent.ico
UninstallDisplayIcon={app}\er-agent.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=ER Capture Agent
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "payload\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "assets\er-agent.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "assets\er-logo.png"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\pair-agent.ps1"""; WorkingDir: "{app}"; Description: "Conectar este computador à arena"; Flags: postinstall waituntilterminated

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-agent.ps1"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveERAgentTask"
