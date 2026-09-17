!include "FileFunc.nsh"

!define DSC_LEGACY_INNO_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}_is1"
!define DSC_LEGACY_ELECTRON_APP_KEY "Software\26118358-b500-54e1-881b-7e549a465667"
!define DSC_LEGACY_ELECTRON_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\26118358-b500-54e1-881b-7e549a465667"
!define DSC_WINDOW_TITLE "观澜 · 设备状态控制台"
!define DSC_HARDWARE_SENSOR_TASK "DeviceStateConsoleHardwareSensors"
!define DSC_PAWNIO_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO"

; Machine-scope agent service. The desktop app is only the control plane; this
; service keeps collecting and uploading with nobody logged in.
!define DSC_AGENT_CLI_NAME "guanlan-agent.exe"
!define DSC_AGENT_CLI_LEGACY_NAME "device-state-console-agent-backend.exe"

!macro customHeader
!ifndef BUILD_UNINSTALLER
  Var DSC_PREINSTALL_STATE
  Var DSC_RESTORE_LAUNCHED
  Var DSC_PAWNIO_STATE
  Var DSC_PAWNIO_VERSION
  Var DSC_HUB
  Var DSC_KEY
  Var DSC_DEVICE
  Var DSC_HOSTNAME
  Var DSC_VERIFY
  Var DSC_SERVICE
  Var DSC_CONFIG_DIR

  Function DSC_DetectPawnIO
    StrCpy $DSC_PAWNIO_STATE ""
    StrCpy $DSC_PAWNIO_VERSION ""
    StrCpy $1 ""

    ; PawnIO is a shared system driver. Preserve a valid installation owned by
    ; PawnIO itself or another application instead of treating it as an error.
    SetRegView 64
    ReadRegStr $DSC_PAWNIO_VERSION HKLM "${DSC_PAWNIO_UNINSTALL_KEY}" "DisplayVersion"
    ReadRegStr $1 HKLM "${DSC_PAWNIO_UNINSTALL_KEY}" "InstallLocation"
    ${If} $1 != ""
      IfFileExists "$1\uninstall.exe" 0 dsc_detect_pawnio_32
      StrCpy $DSC_PAWNIO_STATE "registered"
      Goto dsc_detect_pawnio_service
    ${EndIf}

dsc_detect_pawnio_32:
    SetRegView 32
    ReadRegStr $DSC_PAWNIO_VERSION HKLM "${DSC_PAWNIO_UNINSTALL_KEY}" "DisplayVersion"
    ReadRegStr $1 HKLM "${DSC_PAWNIO_UNINSTALL_KEY}" "InstallLocation"
    ${If} $1 != ""
      IfFileExists "$1\uninstall.exe" 0 dsc_detect_pawnio_service
      StrCpy $DSC_PAWNIO_STATE "registered"
    ${EndIf}

dsc_detect_pawnio_service:
    SetRegView 64
    nsExec::Exec '"$SYSDIR\sc.exe" query PawnIO'
    Pop $0
    ${If} $0 == 0
      StrCpy $DSC_PAWNIO_STATE "service"
    ${EndIf}
    SetRegView 64
  FunctionEnd

  Function DSC_CapturePreInstallState
    StrCpy $DSC_PREINSTALL_STATE "not_started"
    StrCpy $DSC_RESTORE_LAUNCHED "0"

    ; A hidden BrowserWindow still has a native handle, so visibility
    ; distinguishes a visible window from an app that is sitting in the tray.
    FindWindow $0 "" "${DSC_WINDOW_TITLE}"
    ${If} $0 != 0
      System::Call 'user32::IsWindowVisible(i r0)i.r1'
      ${If} $1 <> 0
        StrCpy $DSC_PREINSTALL_STATE "window"
      ${Else}
        StrCpy $DSC_PREINSTALL_STATE "tray"
      ${EndIf}
    ${EndIf}
  FunctionEnd

  Function DSC_StartApp
    ${If} $DSC_RESTORE_LAUNCHED == "1"
      Return
    ${EndIf}

    ${If} $DSC_PREINSTALL_STATE == "window"
      StrCpy $0 "--dsc-installer-restore=window"
    ${ElseIf} $DSC_PREINSTALL_STATE == "tray"
      StrCpy $0 "--dsc-installer-restore=tray"
    ${ElseIf} ${isUpdated}
      StrCpy $0 "--updated"
    ${Else}
      StrCpy $0 ""
    ${EndIf}

    ${StdUtils.ExecShellAsUser} $1 "$launchLink" "open" "$0"
    StrCpy $DSC_RESTORE_LAUNCHED "1"
  FunctionEnd

  Function DSC_ShowFinishPage
    ${If} $DSC_PREINSTALL_STATE == "window"
    ${OrIf} $DSC_PREINSTALL_STATE == "tray"
      ; Running/tray launches are automatic; do not ask the user again.
      GetDlgItem $0 $HWNDPARENT 1203
      ShowWindow $0 ${SW_HIDE}
      Call DSC_StartApp
      Quit
    ${EndIf}
  FunctionEnd
!endif
!macroend

!macro customFinishPage
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "DSC_StartApp"
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW "DSC_ShowFinishPage"
  !insertmacro MUI_PAGE_FINISH
  !ifdef MUI_PAGE_CUSTOMFUNCTION_SHOW
    !undef MUI_PAGE_CUSTOMFUNCTION_SHOW
  !endif
  !ifdef MUI_FINISHPAGE_RUN_FUNCTION
    !undef MUI_FINISHPAGE_RUN_FUNCTION
  !endif
  !ifdef MUI_FINISHPAGE_RUN
    !undef MUI_FINISHPAGE_RUN
  !endif
!endif
!macroend

!macro customInit
  SetRegView 64
  StrCpy $INSTDIR "$PROGRAMFILES64\DeviceStateConsoleAgent"

  ; Capture the app state before the cleanup commands terminate its process.
  Call DSC_CapturePreInstallState

  ; Stop the elevated hardware sensor helper before replacing the bundled
  ; collector executable during an upgrade.
  nsExec::Exec '"$SYSDIR\schtasks.exe" /End /TN "${DSC_HARDWARE_SENSOR_TASK}"'
  Pop $0

  ; Stop the machine-scope service before touching its binary: the running
  ; service process holds bin\guanlan-agent.exe open, which would block an
  ; in-place upgrade.
  nsExec::Exec '"$SYSDIR\sc.exe" stop GuanlanAgent'
  Pop $0
  nsExec::Exec '"$SYSDIR\schtasks.exe" /End /TN GuanlanAgent'
  Pop $0

  ; nsExec runs the console utility without opening a visible taskkill window.
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "guanlan-agent.exe"'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "DeviceStateConsoleAgent.WinUI.exe"'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "windows-agent-backend.exe"'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "device-state-console-agent.exe"'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "Device State Console.exe"'
  Pop $0
  nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "观澜.exe"'
  Pop $0
  Sleep 500

  ; Unattended installation switches. Values that contain a slash (any URL) must
  ; be quoted, because GetOptions ends an unquoted value at the next "/".
  ;   /HUB="https://hub.example.com" /KEY="..." /DEVICE=node-01
  ;   /HOSTNAME="节点 01" /SERVICE=0 /VERIFY=60
  ClearErrors
  ${GetOptions} $CMDLINE "/HUB=" $DSC_HUB
  ${GetOptions} $CMDLINE "/KEY=" $DSC_KEY
  ${GetOptions} $CMDLINE "/DEVICE=" $DSC_DEVICE
  ${GetOptions} $CMDLINE "/HOSTNAME=" $DSC_HOSTNAME
  ${GetOptions} $CMDLINE "/VERIFY=" $DSC_VERIFY
  ${GetOptions} $CMDLINE "/SERVICE=" $DSC_SERVICE
  ClearErrors
!macroend

!macro customInstall
  SetRegView 64

  ; LibreHardwareMonitor needs the bundled PawnIO kernel driver for CPU
  ; package sensors on Windows. The setup is already running elevated, so
  ; install it silently before the desktop app is launched. PawnIO is shared
  ; system-wide, so a verified existing installation must be left intact.
  Call DSC_DetectPawnIO
  ${If} $DSC_PAWNIO_STATE != ""
    DetailPrint "PawnIO $DSC_PAWNIO_VERSION is already installed; keeping the existing system driver."
    Goto dsc_skip_pawnio_install
  ${EndIf}
  IfFileExists "$INSTDIR\resources\agent\windows-hardware\pawnio\PawnIO_setup.exe" 0 dsc_skip_pawnio_install
  nsExec::Exec '"$INSTDIR\resources\agent\windows-hardware\pawnio\PawnIO_setup.exe" -install -silent'
  Pop $0
  ${If} $0 == 3010
    ; PawnIO 2.2.0 documents 3010 as a successful install that needs reboot.
    SetRebootFlag true
    DetailPrint "PawnIO installed successfully; Windows must be restarted to load the driver."
  ${ElseIf} $0 == 183
    ; ERROR_ALREADY_EXISTS is safe only when a valid shared installation can
    ; be observed after the setup attempt. Do not blanket-ignore exit 183.
    Call DSC_DetectPawnIO
    ${If} $DSC_PAWNIO_STATE == ""
      MessageBox MB_ICONSTOP|MB_OK "PawnIO 硬件传感器驱动安装失败（错误码 183），且未检测到可用的已安装驱动。安装已中止。"
      Abort
    ${EndIf}
    DetailPrint "PawnIO is already installed; keeping the existing system driver."
  ${ElseIf} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "PawnIO 硬件传感器驱动安装失败（错误码 $0）。安装已中止。"
    Abort
  ${EndIf}
dsc_skip_pawnio_install:

  ; CPU package sensors require the bundled LHM probe to run with the SYSTEM
  ; token. The helper only writes a short-lived sensor cache; the normal
  ; desktop Agent remains responsible for config, upload, and UI control.
  IfFileExists "$INSTDIR\resources\agent\device-state-console-agent.exe" 0 dsc_skip_hardware_sensor_helper
  nsExec::Exec '"$INSTDIR\resources\agent\device-state-console-agent.exe" install-hardware-helper'
  Pop $0
dsc_skip_hardware_sensor_helper:

  ; Remove the old Inno Setup registration after the new installer owns this path.
  DeleteRegKey HKLM "${DSC_LEGACY_INNO_UNINSTALL_KEY}"
  DeleteRegKey HKCU "${DSC_LEGACY_INNO_UNINSTALL_KEY}"

  ; Remove the previous Electron installation that used a different directory.
  Delete "$SMPROGRAMS\Device State Console.lnk"
  Delete "$SMPROGRAMS\卸载 Device State Console.lnk"
  Delete "$DESKTOP\Device State Console.lnk"
  ReadRegStr $0 HKLM "${DSC_LEGACY_ELECTRON_APP_KEY}" "InstallLocation"
  ${If} $0 == "$PROGRAMFILES64\Device State Console"
    ${If} $0 != $INSTDIR
      RMDir /r "$0"
    ${EndIf}
  ${EndIf}
  DeleteRegKey HKLM "${DSC_LEGACY_ELECTRON_UNINSTALL_KEY}"
  DeleteRegKey HKLM "${DSC_LEGACY_ELECTRON_APP_KEY}"
  DeleteRegKey HKCU "${DSC_LEGACY_ELECTRON_UNINSTALL_KEY}"
  DeleteRegKey HKCU "${DSC_LEGACY_ELECTRON_APP_KEY}"

  ; Remove legacy WinUI program files while preserving LocalAppData configuration.
  Delete "$INSTDIR\unins000.exe"
  Delete "$INSTDIR\unins001.exe"
  Delete "$INSTDIR\DeviceStateConsoleAgent.WinUI.exe"
  Delete "$INSTDIR\DeviceStateConsoleAgent.WinUI.dll"
  Delete "$INSTDIR\DeviceStateConsoleAgent.WinUI.deps.json"
  Delete "$INSTDIR\DeviceStateConsoleAgent.WinUI.runtimeconfig.json"
  Delete "$INSTDIR\start-agent.cmd"
  Delete "$INSTDIR\start-agent.ps1"
  Delete "$INSTDIR\start-agent.vbs"
  Delete "$INSTDIR\install-dotnet-runtime.ps1"
  Delete "$INSTDIR\install-windows-app-runtime.ps1"
  RMDir /r "$INSTDIR\backend"
  RMDir /r "$INSTDIR\runtime"

  ; Keep the previous Chinese uninstall shortcut flow.
  Delete "$SMPROGRAMS\卸载 观澜.lnk"
  CreateShortCut "$SMPROGRAMS\卸载 观澜.lnk" "$INSTDIR\${UNINSTALL_FILENAME}" "" "$INSTDIR\${UNINSTALL_FILENAME}" 0

  ; ---------------------------------------------------------------------------
  ; Machine-scope agent service (this is what makes the product usable on a host
  ; with no interactive session).
  ; ---------------------------------------------------------------------------
  ReadEnvStr $DSC_CONFIG_DIR "ProgramData"
  ${If} $DSC_CONFIG_DIR == ""
    StrCpy $DSC_CONFIG_DIR "C:\ProgramData"
  ${EndIf}
  StrCpy $DSC_CONFIG_DIR "$DSC_CONFIG_DIR\Guanlan"

  ; Unattended installations must be auditable after the fact: a silent run
  ; leaves no visible output, so record what the installer parsed and what each
  ; configuration step returned. The access key is deliberately never written.
  CreateDirectory "$DSC_CONFIG_DIR"
  ClearErrors
  FileOpen $8 "$DSC_CONFIG_DIR\install-report.txt" w
  ${IfNot} ${Errors}
    FileWrite $8 "installDir=$INSTDIR$\r$\n"
    FileWrite $8 "configDir=$DSC_CONFIG_DIR$\r$\n"
    FileWrite $8 "hub=$DSC_HUB$\r$\n"
    FileWrite $8 "deviceId=$DSC_DEVICE$\r$\n"
    FileWrite $8 "hostname=$DSC_HOSTNAME$\r$\n"
    FileWrite $8 "serviceSwitch=$DSC_SERVICE$\r$\n"
    FileWrite $8 "verifySeconds=$DSC_VERIFY$\r$\n"
    ${If} $DSC_KEY == ""
      FileWrite $8 "keyProvided=no$\r$\n"
    ${Else}
      FileWrite $8 "keyProvided=yes$\r$\n"
    ${EndIf}
    FileClose $8
  ${EndIf}

  CreateDirectory "$INSTDIR\bin"
  IfFileExists "$INSTDIR\resources\agent\${DSC_AGENT_CLI_NAME}" dsc_agent_cli_found
  IfFileExists "$INSTDIR\resources\agent\${DSC_AGENT_CLI_LEGACY_NAME}" 0 dsc_agent_cli_missing
  CopyFiles /SILENT "$INSTDIR\resources\agent\${DSC_AGENT_CLI_LEGACY_NAME}" "$INSTDIR\bin\${DSC_AGENT_CLI_NAME}"
  Goto dsc_agent_cli_ready
dsc_agent_cli_found:
  CopyFiles /SILENT "$INSTDIR\resources\agent\${DSC_AGENT_CLI_NAME}" "$INSTDIR\bin\${DSC_AGENT_CLI_NAME}"
  Goto dsc_agent_cli_ready
dsc_agent_cli_missing:
  DetailPrint "Bundled agent CLI is missing; the machine-scope service was not installed."
  Goto dsc_skip_agent_service
dsc_agent_cli_ready:

  ${If} $DSC_SERVICE != "0"
    ; bin\ holds the CLI; the collector lives in resources\agent, so the
    ; service must be told which directory to supervise.
    nsExec::ExecToLog '"$INSTDIR\bin\${DSC_AGENT_CLI_NAME}" service install --config-root "$DSC_CONFIG_DIR" --bundle-root "$INSTDIR\resources\agent"'
    Pop $0
    ClearErrors
    FileOpen $8 "$DSC_CONFIG_DIR\install-report.txt" a
    ${IfNot} ${Errors}
      FileWrite $8 "serviceInstallExit=$0$\r$\n"
      FileClose $8
    ${EndIf}
    ${If} $0 != 0
      DetailPrint "Machine-scope service installation returned $0."
    ${EndIf}
  ${EndIf}

  ${If} $DSC_HUB != ""
    ; The access key goes through a temporary file so it never appears in the
    ; process list, and is deleted immediately after being stored.
    ClearErrors
    FileOpen $9 "$PLUGINSDIR\dsc-agent-key.txt" w
    ${If} ${Errors}
      DetailPrint "Could not stage the access key; skipping unattended configuration."
    ${Else}
      FileWrite $9 "$DSC_KEY"
      FileClose $9
      nsExec::ExecToLog '"$INSTDIR\bin\${DSC_AGENT_CLI_NAME}" config set --config-root "$DSC_CONFIG_DIR" --hub "$DSC_HUB" --device-id "$DSC_DEVICE" --hostname "$DSC_HOSTNAME" --key-file "$PLUGINSDIR\dsc-agent-key.txt"'
      Pop $0
      Delete "$PLUGINSDIR\dsc-agent-key.txt"
      ClearErrors
      FileOpen $8 "$DSC_CONFIG_DIR\install-report.txt" a
      ${IfNot} ${Errors}
        FileWrite $8 "configSetExit=$0$\r$\n"
        FileClose $8
      ${EndIf}
      ${If} $0 != 0
        ; The caller asked for an unattended configuration, so failing to apply
        ; it must not look like success.
        DetailPrint "Unattended configuration failed with code $0."
        SetErrorLevel 4
        ${IfNot} ${Silent}
          MessageBox MB_ICONSTOP|MB_OK "观澜已安装，但自动配置失败（错误码 $0）。请以管理员身份执行 guanlan-agent config set 完成配置。"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${If} $DSC_VERIFY != ""
    nsExec::ExecToLog '"$INSTDIR\bin\${DSC_AGENT_CLI_NAME}" wait-for-upload --timeout "$DSC_VERIFY"'
    Pop $0
    ClearErrors
    FileOpen $8 "$DSC_CONFIG_DIR\install-report.txt" a
    ${IfNot} ${Errors}
      FileWrite $8 "verifyExit=$0$\r$\n"
      FileClose $8
    ${EndIf}
    ${If} $0 != 0
      ; Automation (Intune/SCCM/Ansible) branches on the exit code; an
      ; interactive user gets a visible explanation instead.
      SetErrorLevel 3
      IfSilent dsc_verify_done
      MessageBox MB_ICONEXCLAMATION|MB_OK "观澜已安装并注册为系统服务，但在 $DSC_VERIFY 秒内没有确认到首次上报。请检查中枢地址与访问密钥，或稍后在应用中查看诊断。"
    ${EndIf}
  ${EndIf}
dsc_verify_done:
dsc_skip_agent_service:
!macroend

!macro customUnInstall
  ; The service must be stopped and deleted while its executable still exists.
  IfFileExists "$INSTDIR\bin\${DSC_AGENT_CLI_NAME}" 0 dsc_skip_agent_service_uninstall
  nsExec::ExecToLog '"$INSTDIR\bin\${DSC_AGENT_CLI_NAME}" service uninstall'
  Pop $0
dsc_skip_agent_service_uninstall:

  ; Configuration is preserved by default; /REMOVECONFIG deletes it explicitly.
  ClearErrors
  ${GetOptions} $CMDLINE "/REMOVECONFIG" $0
  ${IfNot} ${Errors}
    ReadEnvStr $0 "ProgramData"
    ${If} $0 == ""
      StrCpy $0 "C:\ProgramData"
    ${EndIf}
    RMDir /r "$0\Guanlan"
  ${EndIf}

  IfFileExists "$INSTDIR\resources\agent\device-state-console-agent.exe" 0 dsc_skip_hardware_sensor_helper_uninstall
  nsExec::Exec '"$INSTDIR\resources\agent\device-state-console-agent.exe" uninstall-hardware-helper'
  Pop $0
dsc_skip_hardware_sensor_helper_uninstall:
  Delete "$SMPROGRAMS\卸载 观澜.lnk"
  Delete "$SMPROGRAMS\DeviceStateConsoleAgent.lnk"
  Delete "$SMPROGRAMS\卸载 DeviceStateConsoleAgent.lnk"
  Delete "$DESKTOP\DeviceStateConsoleAgent.lnk"
!macroend
