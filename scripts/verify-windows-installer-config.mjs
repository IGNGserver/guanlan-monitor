import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(root, "apps", "desktop", "package.json");
const installerPath = path.join(root, "apps", "desktop", "build", "installer.nsh");
const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"));
const installer = fs.readFileSync(installerPath, "utf8");
const nsis = desktopPackage.build?.nsis ?? {};

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
  [installer.includes("!macro customInstall"), "The installer migration hook must be present."],
  [installer.includes("!macro customUnInstall"), "The uninstall cleanup hook must be present."],
  [installer.includes("DeleteRegKey"), "The obsolete installer registrations must be cleaned."],
];

for (const [condition, message] of checks) {
  if (!condition) {
    throw new Error(message);
  }
}

console.log("Windows installer compatibility check passed.");
