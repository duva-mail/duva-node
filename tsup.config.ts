import { defineConfig } from "tsup";

// Double publication (ESM + CommonJS) : `module`/`main`/`exports` de package.json en dépendent.
// `dts: true` régénère les `.d.ts` publiés depuis `src/`, indépendamment de `generated/` (généré
// à part, voir `npm run generate`).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node22",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
