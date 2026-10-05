import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * The shared workspace is rendered by both the Web and Electron shells, yet its
 * `lint` used to be `tsc` alone. A hook called after an early return in
 * DevicesPage shipped that way and could tear the console down on a retry.
 * Hook ordering is an error here; dependency lists and accessibility are
 * reported so they surface in review.
 */
export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" }
    },
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      ...jsxA11y.flatConfigs.recommended.rules,
      // Reported, not failing: each current hit is a deliberate pattern — focus
      // moved into a dialog or palette as it opens, Escape handled on a sheet
      // container, a scrim that closes on click, and the combobox whose options
      // are reached through aria-activedescendant rather than tab stops.
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/aria-activedescendant-has-tabindex": "warn"
    }
  }
];
