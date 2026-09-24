import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard for the Debian package configuration of the unified desktop app.
 *
 * The Linux package is the only supported way to install the product on a host
 * with no desktop session, so it must always register the machine-scope service
 * and must never rely on a graphical session.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopPackagePath = path.join(root, "apps", "desktop", "package.json");
const afterInstallPath = path.join(root, "apps", "desktop", "build", "linux", "after-install.sh");
const afterRemovePath = path.join(root, "apps", "desktop", "build", "linux", "after-remove.sh");

const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, "utf8"));
const build = desktopPackage.build ?? {};
const linux = build.linux ?? {};
const deb = build.deb ?? {};
const afterInstall = fs.readFileSync(afterInstallPath, "utf8");
const afterRemove = fs.readFileSync(afterRemovePath, "utf8");

const checks = [
  [linux.target?.includes("deb") === true, "The Linux target must remain the Debian package."],
  [linux.executableName === "guanlan", "The Linux executable name must be ASCII (guanlan), not the CJK product name."],
  [deb.packageName === "guanlan-desktop", "The Debian package name must be an ASCII identifier."],
  [deb.afterInstall === "build/linux/after-install.sh", "The Debian package must run the service registration script."],
  [deb.afterRemove === "build/linux/after-remove.sh", "The Debian package must run the service removal script."],
  [Array.isArray(deb.depends) && deb.depends.length > 0, "The Debian package must declare explicit runtime dependencies."],
  [afterInstall.includes("service install"), "The postinst must install the machine-scope service."],
  [afterInstall.includes("--config-root"), "The postinst must target the machine-scope configuration directory."],
  [afterInstall.includes("GUANLAN_HUB"), "The postinst must support unattended configuration."],
  [afterInstall.includes("--key-file"), "The postinst must pass the access key through a file, never through argv."],
  [afterRemove.includes("service uninstall"), "The postrm must remove the service before its files disappear."],
  [afterRemove.includes("purge"), "The postrm must only delete configuration on purge."],
  [
    !/graphical-session|WantedBy=default\.target|systemctl --user/.test(afterInstall + afterRemove),
    "The Linux integration must never depend on a graphical session or a user-level unit.",
  ],
  [
    !/\$\{[a-zA-Z]+\}/.test(afterInstall) && !/\$\{[a-zA-Z]+\}/.test(afterRemove),
    "Maintainer scripts must not contain a bare dollar-brace macro: electron-builder substitutes those and aborts the build.",
  ],
];

for (const [condition, message] of checks) {
  if (!condition) {
    throw new Error(message);
  }
}

for (const [label, file, script] of [
  ["after-install.sh", afterInstallPath, afterInstall],
  ["after-remove.sh", afterRemovePath, afterRemove],
]) {
  const bytes = fs.readFileSync(file);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${label} must not contain a UTF-8 BOM.`);
  }
  if (bytes.includes(0x0d)) {
    throw new Error(`${label} must use LF line endings.`);
  }
  if (!script.startsWith("#!/bin/bash")) {
    throw new Error(`${label} must start with a bash shebang.`);
  }
}

const mode = fs.statSync(afterInstallPath).mode & 0o777;
if ((mode & 0o111) === 0) {
  throw new Error("after-install.sh must be executable.");
}

console.log("Linux package configuration check passed.");
