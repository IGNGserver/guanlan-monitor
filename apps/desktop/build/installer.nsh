!define DSC_LEGACY_INNO_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\{E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A}_is1"
!define DSC_LEGACY_ELECTRON_APP_KEY "Software\26118358-b500-54e1-881b-7e549a465667"
!define DSC_LEGACY_ELECTRON_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\26118358-b500-54e1-881b-7e549a465667"

!macro customInit
  SetRegView 64
  StrCpy $INSTDIR "$PROGRAMFILES64\DeviceStateConsoleAgent"

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
  Delete "$SMPROGRAMS\卸载 观澜.lnk"
  Delete "$SMPROGRAMS\DeviceStateConsoleAgent.lnk"
  Delete "$SMPROGRAMS\卸载 DeviceStateConsoleAgent.lnk"
  Delete "$DESKTOP\DeviceStateConsoleAgent.lnk"
!macroend
