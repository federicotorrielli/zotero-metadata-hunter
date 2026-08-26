// Flat config. ESLint 9 dropped .eslintrc, and the old `--ext` flag with it.
// Written against the parser and plugin directly, so the project does not need
// the extra unified `typescript-eslint` wrapper package.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["build/**", "node_modules/**", "addon/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Zotero exposes no types, so `any` is unavoidable at every boundary.
      "@typescript-eslint/no-explicit-any": "off",
      // Match the project convention of prefixing deliberate non-uses with _.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
];
