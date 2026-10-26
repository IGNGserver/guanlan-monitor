import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { iconSource, ICON_VERSION, iconPath, iconSpecs } from "./pwa-icons.mjs";

const publicRoot = new URL("../public/", import.meta.url);
await mkdir(new URL(`icons/${ICON_VERSION}/`, publicRoot), { recursive: true });
const source = await readFile(iconSource);
for (const spec of iconSpecs) {
  // Maskable artwork is generated independently with the entire brand mark
  // inside the platform's central safe area. Every PNG has an opaque canvas.
  const image = spec.purpose === "maskable"
    ? sharp({ create: { width: spec.size, height: spec.size, channels: 3, background: "#1c222d" } })
      .composite([{ input: await sharp(source).resize(Math.round(spec.size * .8), Math.round(spec.size * .8)).flatten({ background: "#1c222d" }).removeAlpha().png().toBuffer(), gravity: "centre" }])
    : sharp(source).resize(spec.size, spec.size).flatten({ background: "#1c222d" });
  const bytes = await image.removeAlpha().png().toBuffer();
  await writeFile(new URL(iconPath(spec.name).slice(1), publicRoot), bytes);
  const alias = spec.purpose === "apple" ? `apple-touch-icon-${spec.size}.png` : `${spec.name}.png`;
  await writeFile(new URL(alias, publicRoot), bytes);
  if (spec.name === "apple-touch-icon-180") await writeFile(new URL("apple-touch-icon.png", publicRoot), bytes);
}
const manifest = JSON.parse(await readFile(new URL("manifest.json", publicRoot), "utf8"));
manifest.icons = iconSpecs.filter((spec) => spec.purpose !== "apple").map((spec) => ({
  src: iconPath(spec.name), sizes: `${spec.size}x${spec.size}`, type: "image/png", purpose: spec.purpose
}));
await writeFile(new URL("manifest.webmanifest", publicRoot), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Prepared Guanlan opaque PWA icons: ${ICON_VERSION}`);
