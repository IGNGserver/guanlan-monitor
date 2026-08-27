!define DSC_LEGACY_INNO_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}_is1"
!define DSC_LEGACY_ELECTRON_APP_KEY "Software\26118358-b500-54e1-881b-7e549a465667"
!define DSC_LEGACY_ELECTRON_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\26118358-b500-54e1-881b-7e549a465667"
!define DSC_WINDOW_TITLE "观澜 · 设备状态控制台"
!define DSC_HARDWARE_SENSOR_TASK "DeviceStateConsoleHardwareSensors"

!macro customHeader
!ifndef BUILD_UNINSTALLER
  Var DSC_PREINSTALL_STATE
  Var DSC_RESTORE_LAUNCHED

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

  ; nsExec runs the console utility without opening a visible taskkill window.
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
!macroend

!macro customInstall
  SetRegView 64

  ; LibreHardwareMonitor needs the bundled PawnIO kernel driver for CPU
  ; package sensors on Windows. The setup is already running elevated, so
  ; install it silently before the desktop app is launched. Existing
  ; installations are left intact when PawnIO reports that it is already
  ; installed.
  IfFileExists "$INSTDIR\resources\agent\windows-hardware\pawnio\PawnIO_setup.exe" 0 dsc_skip_pawnio_install
  nsExec::Exec '"$INSTDIR\resources\agent\windows-hardware\pawnio\PawnIO_setup.exe" -install -silent'
  Pop $0
  ${If} $0 != 0
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
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\resources\agent\device-state-console-agent.exe" 0 dsc_skip_hardware_sensor_helper_uninstall
  nsExec::Exec '"$INSTDIR\resources\agent\device-state-console-agent.exe" uninstall-hardware-helper'
  Pop $0
dsc_skip_hardware_sensor_helper_uninstall:
  Delete "$SMPROGRAMS\卸载 观澜.lnk"
  Delete "$SMPROGRAMS\DeviceStateConsoleAgent.lnk"
  Delete "$SMPROGRAMS\卸载 DeviceStateConsoleAgent.lnk"
  Delete "$DESKTOP\DeviceStateConsoleAgent.lnk"
!macroend
