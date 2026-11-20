// Builds the release asset: the whole server (dependencies included) as ONE file, so a
// developer machine needs nothing but Node.js, and the self-updater only downloads one file.
//   node scripts/bundle.mjs            version from package.json
//   RELEASE_VERSION=0.2.17 node ...    version set by the release workflow
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const version = process.env.RELEASE_VERSION ?? JSON.parse(readFileSync("package.json", "utf8")).version;
await build({
  entryPoints: ["server/src/index.ts"],
  outfile: "dist/rjtech-mcp-sap-abap.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  define: { __RJTECH_VERSION__: JSON.stringify(version) },
  // Some bundled dependencies are CommonJS and call require(); give them one.
  banner: { js: "import { createRequire as __rjCreateRequire } from 'node:module'; const require = __rjCreateRequire(import.meta.url);" },
  legalComments: "eof",
  logLevel: "warning",
});
console.log(`Built dist/rjtech-mcp-sap-abap.mjs (v${version})`);
