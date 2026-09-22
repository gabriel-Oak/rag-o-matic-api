import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { defineConfig, type Plugin } from "vitest/config";

const tsconfigRaw = readFileSync(
  fileURLToPath(new URL("./tsconfig.json", import.meta.url)),
  "utf8",
);

// vite 8's default TS transform (oxc) does not support TS legacy decorators
// (tsconfig "experimentalDecorators"), so compile TS with esbuild first.
// That way @controller/@get etc. are transformed before oxc sees the file.
function esbuildLegacyDecorators(): Plugin {
  return {
    name: "esbuild-legacy-decorators",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0];
      if (id.includes("node_modules") || !/\.(ts|tsx)$/.test(file)) return;
      const result = await esbuild.transform(code, {
        loader: file.endsWith(".tsx") ? "tsx" : "ts",
        tsconfigRaw,
        sourcemap: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  plugins: [esbuildLegacyDecorators()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
