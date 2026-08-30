import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(root, "apps", "desktop", "package.json");
const installerPath = path.join(root, "apps", "desktop", "build", "installer.nsh");
const releaseWorkflowPath = path.join(root, ".github", "workflows", "release-test.yml");
const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"));
const installer = fs.readFileSync(installerPath, "utf8");
const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, "utf8");
const nsis = desktopPackage.build?.nsis ?? {};
const pawnIoDetectionIndex = installer.indexOf("Call DSC_DetectPawnIO");
const pawnIoSetupIndex = installer.indexOf('PawnIO_setup.exe" -install -silent');

const checks = [
  [desktopPackage.build?.productName === "观澜", "Electron product name must remain 观澜."],
  [desktopPackage.build?.appId === "org.igng.devicestateconsole", "Electron appId must remain stable."],
  [String(nsis.guid).toUpperCase() === "E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A", "NSIS GUID must match the previous installer."],
  [nsis.oneClick === false, "The installer must remain an assisted installer."],
  [nsis.perMachine === true, "The installer must be per-machine."],
  [nsis.allowToChangeInstallationDirectory === false, "The installation directory must be fixed."],
  [nsis.runAfterFinish === true, "The installer must retain the post-install launch flow."],
  [nsis.include === "build/installer.nsh", "The compatibility NSIS include must be enabled."],
  [nsis.shortcutName === "观澜", "The shortcut name must remain 观澜."],
  [nsis.createStartMenuShortcut === true, "The Start Menu shortcut must be enabled."],
  [installer.includes("DeviceStateConsoleAgent"), "The legacy installation directory must be referenced."],
  [installer.includes("E7EC0D43-10D7-4D88-BB80-6F1E901C3E7A"), "The legacy Inno GUID must be referenced."],
  [installer.includes("$PROGRAMFILES64\\DeviceStateConsoleAgent"), "The previous fixed Program Files path must be enforced."],
  [installer.includes("$PROGRAMFILES64\\Device State Console"), "The current incorrect Electron path must be migrated."],
  [installer.includes("!macro customInit"), "The installer initialization hook must be present."],
  [installer.includes("!define DSC_WINDOW_TITLE") && installer.includes("FindWindow $0 \"\" \"${DSC_WINDOW_TITLE}\""), "The installer must detect the existing Guanlan window."],
  [installer.includes("IsWindowVisible"), "The installer must distinguish a visible window from a tray-only instance."],
  [installer.includes("GetDlgItem $0 $HWNDPARENT 1203"), "The installer must hide the finish-page launch checkbox through the NSIS dialog handle."],
  [installer.includes("nsExec::Exec"), "Process cleanup must use the hidden nsExec runner."],
  [installer.includes("resources\\agent\\windows-hardware\\pawnio\\PawnIO_setup.exe") && installer.includes("-install -silent"), "The Windows GUI installer must install the bundled PawnIO driver silently."],
  [installer.includes("Function DSC_DetectPawnIO") && installer.includes('"$SYSDIR\\sc.exe" query PawnIO') && installer.includes("DSC_PAWNIO_UNINSTALL_KEY") && installer.includes('IfFileExists "$1\\uninstall.exe"'), "The installer must verify an existing shared PawnIO service or official installation before invoking setup."],
  [pawnIoDetectionIndex >= 0 && pawnIoSetupIndex >= 0 && pawnIoDetectionIndex < pawnIoSetupIndex, "The existing PawnIO check must run before the bundled setup."],
  [installer.includes('${If} $0 == 3010') && installer.includes("SetRebootFlag true"), "PawnIO reboot-required success must not abort the installer."],
  [installer.includes('${ElseIf} $0 == 183') && installer.includes('Call DSC_DetectPawnIO\n    ${If} $DSC_PAWNIO_STATE == ""'), "PawnIO ERROR_ALREADY_EXISTS must be accepted only after an installed-driver check."],
  [installer.includes('${ElseIf} $0 != 0\n    MessageBox MB_ICONSTOP|MB_OK') && installer.includes("    Abort\n  ${EndIf}\ndsc_skip_pawnio_install:"), "Unrecognized PawnIO installation failures must abort the installer."],
  [releaseWorkflow.includes("Silently install, reinstall and verify Windows GUI setup") && releaseWorkflow.includes("$reinstaller = Start-Process"), "The Windows release job must exercise silent reinstallation over an existing PawnIO installation."],
  [!/(?<!:)\b(?:ExecWait|Exec)\s+['"][^'\n]*taskkill\\.exe/i.test(installer), "taskkill must not be launched through a visible Exec/ExecWait command."],
  [installer.includes("!macro customInstall"), "The installer migration hook must be present."],
  [installer.includes("!macro customFinishPage\n!ifndef BUILD_UNINSTALLER"), "The installer finish page customization must be scoped at macro expansion time."],
  [installer.includes("!undef MUI_FINISHPAGE_RUN\n  !endif\n!endif\n!macroend"), "The installer finish page conditional must be closed before the macro ends."],
  [installer.includes("--dsc-installer-restore=window"), "The installer must restore a previously visible window."],
  [installer.includes("--dsc-installer-restore=tray"), "The installer must restore a previously tray-only instance."],
  [installer.includes("!macro customUnInstall"), "The uninstall cleanup hook must be present."],
  [installer.includes("DeleteRegKey"), "The obsolete installer registrations must be cleaned."],
];

for (const [condition, message] of checks) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log("Windows installer compatibility check passed.");
