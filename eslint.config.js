import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "tmp/**", "coverage/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
);
