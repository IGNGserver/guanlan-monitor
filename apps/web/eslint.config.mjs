import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
const compat = new FlatCompat({ baseDirectory: fileURLToPath(new URL(".", import.meta.url)) });
export default [
  { ignores: [".next/**", "public/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];
