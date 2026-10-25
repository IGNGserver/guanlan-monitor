import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const iconSource = new URL("../branding/icon.png", import.meta.url);
export const ICON_VERSION = createHash("sha256").update(readFileSync(iconSource)).update("guanlan-icons-v1").digest("hex").slice(0, 12);
export const iconPath = (name) => `/icons/${ICON_VERSION}/${name}.png`;
export const iconSpecs = [
  ...[192, 512, 1024].flatMap((size) => [
    { name: `icon-${size}`, size, purpose: "any" },
    { name: `icon-${size}-maskable`, size, purpose: "maskable" }
  ]),
  ...[180, 167, 152].map((size) => ({ name: `apple-touch-icon-${size}`, size, purpose: "apple" }))
];
