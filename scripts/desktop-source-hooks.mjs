// Test-only resolution of the NodeNext source graph; no dist/ or deliverable is
// produced. Packaged main/preload remain tested separately against CI builds.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
process.env.DSC_DESKTOP_TEST_SOURCE = "1";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.includes("/apps/desktop/src/")) {
      const source = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(source))) return next(source.href, context);
    }
    return next(specifier, context);
  }
});
