
#define MyAppName "ER Capture Agent"
#define MyAppVersion "1.2.0"
#define MyAppPublisher "ER"
#define MyAppExeName "node.exe"

[Setup]
AppId={{8AF02746-C2A1-47C8-B73C-19E2B68A35F1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher={#MyAppPublisher}

VersionInfoVersion=1.2.0.0
VersionInfoCompany=ER
VersionInfoDescription=ER Capture Agent
VersionInfoProductName=ER Capture Agent
VersionInfoProductVersion=1.2.0

DefaultDirName={localappdata}\ER Capture Agent
UsePreviousAppDir=yes

CloseApplications=no
RestartApplications=no

DisableProgramGroupPage=yes
PrivilegesRequired=lowest

OutputDir=output
OutputBaseFilename=ER-Capture-Agent-Setup-v1.2

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
; Arquivos do Agent.
; Credenciais, logs e gravacoes existentes nao sao incluidos no pacote.
Source: "payload\*"; DestDir: "{app}"; Excludes: "agent-credentials.json,agent-credentials.backup.json,agent.log,storage,storage\*,*.log,update-state.json"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "assets\er-agent.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "assets\er-logo.png"; DestDir: "{app}"; Flags: ignoreversion

; Scripts temporarios utilizados somente durante a atualizacao.
Source: "prepare-update.ps1"; Flags: dontcopy
Source: "finish-update.ps1"; Flags: dontcopy

[Run]
; Oferece o pareamento somente quando nao existem credenciais.
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\pair-agent.ps1"""; WorkingDir: "{app}"; Description: "Conectar este computador à arena"; Flags: postinstall waituntilterminated skipifsilent; Check: NeedsPairing

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-agent.ps1"""; WorkingDir: "{app}"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveERAgentTask"

[Code]
var
  UpdatePrepared: Boolean;
  UpdateFinished: Boolean;

function NeedsPairing(): Boolean;
begin
  Result :=
    not FileExists(
      ExpandConstant('{app}\agent-credentials.json')
    );
end;

function RunUpdateScript(
  ScriptName: String;
  InstallDir: String
): Boolean;
var
  ScriptPath: String;
  Params: String;
  ResultCode: Integer;
begin
  Result := False;

  try
    ExtractTemporaryFile(ScriptName);
  except
    Log('Falha ao extrair script: ' + ScriptName);
    Exit;
  end;

  ScriptPath :=
    ExpandConstant('{tmp}\') + ScriptName;

  if not FileExists(ScriptPath) then
  begin
    Log('Script nao encontrado: ' + ScriptPath);
    Exit;
  end;

  Params :=
    '-NoProfile -ExecutionPolicy Bypass -File "' +
    ScriptPath +
    '" -InstallDir "' +
    InstallDir +
    '"';

  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Params,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Log('Falha ao executar: ' + ScriptName);
    Exit;
  end;

  Result := ResultCode = 0;

  if not Result then
    Log(
      'Script ' + ScriptName +
      ' retornou codigo ' + IntToStr(ResultCode)
    );
end;

function PrepareToInstall(
  var NeedsRestart: Boolean
): String;
var
  InstallDir: String;
begin
  Result := '';

  UpdatePrepared := False;
  UpdateFinished := False;

  InstallDir := ExpandConstant('{app}');

  // Numa instalacao nova nao existe Agent anterior para parar.
  if not FileExists(
    AddBackslash(InstallDir) + 'run-agent.ps1'
  ) then
  begin
    Log('Instalacao nova: preparacao nao necessaria.');
    Exit;
  end;

  Log('Preparando atualizacao em: ' + InstallDir);

  // Ativa a recuperacao antes da preparacao.
  // Se o script parar o Agent e depois falhar,
  // DeinitializeSetup tentara restaurar seu estado.
  UpdatePrepared := True;

  if not RunUpdateScript(
    'prepare-update.ps1',
    InstallDir
  ) then
  begin
    Result :=
      'Nao foi possivel preparar a atualizacao do ER Capture Agent.' +
      Chr(13) + Chr(10) +
      'Nenhum arquivo novo sera instalado.' +
      Chr(13) + Chr(10) +
      'Verifique se o Agent esta executando e tente novamente.';

    Exit;
  end;

  UpdatePrepared := True;

  Log('Preparacao da atualizacao concluida.');
end;

procedure FinishAgentUpdate();
var
  InstallDir: String;
begin
  if not UpdatePrepared then
    Exit;

  if UpdateFinished then
    Exit;

  InstallDir := ExpandConstant('{app}');

  if RunUpdateScript(
    'finish-update.ps1',
    InstallDir
  ) then
  begin
    UpdateFinished := True;
    Log('Finalizacao da atualizacao concluida.');
  end
  else
  begin
    Log('Falha ao finalizar atualizacao.');

    MsgBox(
      'O instalador nao conseguiu confirmar a finalizacao ' +
      'da atualizacao do ER Capture Agent.' +
      Chr(13) + Chr(10) + Chr(13) + Chr(10) +
      'Verifique a tarefa agendada ER Capture Agent ' +
      'antes de continuar.',
      mbError,
      MB_OK
    );
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    FinishAgentUpdate();
  end;
end;

procedure DeinitializeSetup();
begin
  // Tenta recuperar o estado anterior mesmo se a
  // instalacao terminar antecipadamente ou for cancelada.
  if UpdatePrepared and not UpdateFinished then
  begin
    Log('Tentando recuperar estado do Agent ao sair.');
    FinishAgentUpdate();
  end;
end;




