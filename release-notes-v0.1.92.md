# Device State Console v0.1.92

## Highlights

- Add the Windows `观澜` desktop agent with setup-based install, update, repair,
  uninstall, startup registration, and tray controls.
- Add per-device monitoring charts for CPU, memory, disks, network adapters,
  GPUs, and fans, including timestamps, hover values, and dynamic axes.
- Use Windows processor performance counters for CPU boost frequencies, with
  LibreHardwareMonitor and NVIDIA `nvidia-smi` paths for current hardware clocks.
- Add real-time viewer presence handling and device-level metric configuration.
- Expand Windows agent recovery, control-stream, packaging, and installer
  verification tooling.
- Remove development-machine addresses and fixed credentials from public source
  defaults; strengthen ignore rules for secrets, local configuration, build
  output, and temporary artifacts.

## Windows Assets

| Asset | SHA-256 |
| --- | --- |
| `DeviceStateConsoleAgent-setup-0.1.92.exe` | `0E69CE262F77E7ACAC4D29E0EDE2F0A7EB4BDA100D0F4C460DB15619A2DDD539` |
| `DeviceStateConsoleAgent-update-0.1.92.zip` | `AF57D3EB0E381242EB3C0964E35649AE44B23405AA79A860246D3B696A8476B5` |

## Verification

- `pnpm typecheck`
- `go build ./...`
- `dotnet build windows-agent\DeviceStateConsoleAgent.WinUI\DeviceStateConsoleAgent.WinUI.csproj -c Debug -p:Platform=x64 --no-restore`
- `android\gradlew.bat -p android assembleDebug`
