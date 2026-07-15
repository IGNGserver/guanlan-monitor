#define MyAppName "观澜"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "观澜"
#define MyAppExeName "DeviceStateConsoleAgent.WinUI.exe"
#define MyAppIconName "app-icon.ico"
#define MyAppSourceDir "C:\build\DeviceStateConsoleAgent"
#define MyAppOutputDir "C:\build\installer"
#define MyAppOutputBaseFilename "DeviceStateConsoleAgent-setup-0.1.0"
#define MyAppId "{{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}"
#define MyAppInstallDirName "DeviceStateConsoleAgent"
#define MyAppConfigDirName "DeviceStateConsoleAgent"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppInstallDirName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir={#MyAppOutputDir}
OutputBaseFilename={#MyAppOutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
PrivilegesRequired=admin
UsePreviousAppDir=yes
DisableDirPage=auto
CloseApplications=force
RestartApplications=no
SetupLogging=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile={#MyAppSourceDir}\{#MyAppIconName}
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoDescription={#MyAppName} Setup
VersionInfoVersion={#MyAppVersion}

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: unchecked
Name: "autostart"; Description: "开机自动启动"; GroupDescription: "附加任务:"; Flags: unchecked

[Files]
Source: "{#MyAppSourceDir}\*"; DestDir: "{app}"; Excludes: "repair\*"; Flags: ignoreversion recursesubdirs createallsubdirs
;__REPAIR_SETUP_FILE__

; Remove files left by pre-self-contained builds when upgrading in place.
[InstallDelete]
Type: files; Name: "{app}\install-windows-app-runtime.ps1"
Type: files; Name: "{autoprograms}\DeviceStateConsoleAgent.lnk"
Type: files; Name: "{autoprograms}\卸载 DeviceStateConsoleAgent.lnk"
Type: files; Name: "{autodesktop}\DeviceStateConsoleAgent.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autoprograms}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"; IconFilename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\start-agent.vbs"; IconFilename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#MyAppName}"; ValueData: """{sys}\wscript.exe"" ""{app}\start-agent.vbs"" --minimized"; Flags: uninsdeletevalue; Tasks: autostart; Check: IsNewInstallCheck
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "DeviceStateConsoleAgent"; Flags: deletevalue

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install-dotnet-runtime.ps1"""; StatusMsg: "正在校验 .NET Desktop Runtime 8..."; Flags: runhidden waituntilterminated
Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-agent.vbs"""; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
Type: files; Name: "{app}\agent-ui.config.json"

[Code]
var
  RemoveLocalConfigOnUninstall: Boolean;
  RemoveLocalConfigDecisionProvided: Boolean;
  ExistingInstallDetected: Boolean;

function IsExistingInstall(): Boolean;
var
  InstalledVersion: string;
begin
  { The installer runs on 64-bit Windows. Query the 64-bit uninstall hive
    explicitly, otherwise Inno can read the 32-bit registry view and mistake
    an existing installation for a first install. }
  Result := RegQueryStringValue(
    HKLM64,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}_is1',
    'DisplayVersion',
    InstalledVersion
  );
  if not Result then
  begin
    Result := RegQueryStringValue(
      HKCU64,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}_is1',
      'DisplayVersion',
      InstalledVersion
    );
  end;

  if Result then
    Log('Existing 64-bit 观澜 installation detected: ' + InstalledVersion)
  else
    Log('No existing 64-bit 观澜 installation detected.');
end;

procedure InitializeWizard();
begin
  ExistingInstallDetected := IsExistingInstall();
  if ExistingInstallDetected then
  begin
    WizardForm.Caption := '更新 {#MyAppName}';
    WizardForm.WelcomeLabel1.Caption := '更新 {#MyAppName}';
    WizardForm.WelcomeLabel2.Caption :=
      '检测到本机已安装 {#MyAppName}。继续后将保留现有配置并更新程序文件。';
    if not WizardSilent() then
    begin
      MsgBox(
        '检测到本机已安装 {#MyAppName}。' + #13#10#13#10 +
        '本次将执行更新，保留现有配置、快捷方式和开机启动设置。',
        mbInformation,
        MB_OK
      );
    end;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := IsExistingInstall() and (PageID = wpSelectTasks);
end;

function IsNewInstallCheck(): Boolean;
begin
  Result := not ExistingInstallDetected;
end;

function InitializeUninstall(): Boolean;
var
  Response: Integer;
  ErrorCode: Integer;
  RepairSetupPath: string;
begin
  Result := True;
  if UninstallSilent() then
    exit;

  Response := MsgBox(
    '请选择要执行的操作：' + #13#10#13#10 +
    '“是”：修复安装并保留当前配置' + #13#10 +
    '“否”：卸载 {#MyAppName}' + #13#10 +
    '“取消”：返回，不执行任何操作',
    mbConfirmation,
    MB_YESNOCANCEL
  );

  if Response = IDCANCEL then
  begin
    Result := False;
    exit;
  end;

  if Response = IDYES then
  begin
    RepairSetupPath := ExpandConstant('{app}\repair\DeviceStateConsoleAgent-setup.exe');
    if not FileExists(RepairSetupPath) then
    begin
      MsgBox('修复安装包不存在，请使用同版本或更新版本的安装包执行更新/修复。', mbError, MB_OK);
      Result := False;
      exit;
    end;

    if not ShellExec('', RepairSetupPath, '/UPDATE', '', SW_SHOWNORMAL, ewNoWait, ErrorCode) then
    begin
      MsgBox('无法启动修复安装程序。', mbError, MB_OK);
    end;
    Result := False;
  end;
end;

function GetLocalConfigDir(): string;
begin
  Result := ExpandConstant('{localappdata}\{#MyAppConfigDirName}');
end;

function GetUninstallConfigMode(): string;
var
  RawValue: string;
begin
  RawValue := Trim(Lowercase(ExpandConstant('{param:uninstallconfig|}')));
  Result := RawValue;
end;

procedure InitializeUninstallProgressForm();
var
  UninstallConfigMode: string;
begin
  RemoveLocalConfigOnUninstall := False;
  RemoveLocalConfigDecisionProvided := False;
  UninstallConfigMode := GetUninstallConfigMode();
  if UninstallConfigMode = 'delete' then
  begin
    RemoveLocalConfigOnUninstall := True;
    RemoveLocalConfigDecisionProvided := True;
  end
  else if (UninstallConfigMode = 'keep') or (UninstallConfigMode = 'retain') then
  begin
    RemoveLocalConfigOnUninstall := False;
    RemoveLocalConfigDecisionProvided := True;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Response: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    if DirExists(GetLocalConfigDir()) and (not RemoveLocalConfigDecisionProvided) then
    begin
      if UninstallSilent() then
      begin
        RemoveLocalConfigOnUninstall := False;
        RemoveLocalConfigDecisionProvided := True;
      end
      else
      begin
        Response := MsgBox(
          '检测到本地配置目录：' + #13#10 +
          GetLocalConfigDir() + #13#10#13#10 +
          '是否在卸载时一并删除这些本地配置与同步状态文件？' + #13#10 +
          '选择“否”将保留连接信息、首选项和待推送状态，便于后续重新安装后继续使用。',
          mbConfirmation,
          MB_YESNO or MB_DEFBUTTON2
        );
        RemoveLocalConfigOnUninstall := (Response = IDYES);
      end;
    end;
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    if RemoveLocalConfigOnUninstall and DirExists(GetLocalConfigDir()) then
    begin
      DelTree(GetLocalConfigDir(), True, True, True);
    end;
  end;
end;
