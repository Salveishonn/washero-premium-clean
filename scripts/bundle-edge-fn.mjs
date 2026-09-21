#!/usr/bin/env node
/**
 * Bundle a supabase/functions/<name>/index.ts tree into a single minified ESM file
 * for deploy_edge_function (same layout production already uses).
 *
 * Usage: node scripts/bundle-edge-fn.mjs <function-name> [...]
 */
import * as esbuild from "esbuild";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("usage: node scripts/bundle-edge-fn.mjs <function-name> [...]");
  process.exit(1);
}

const outDir = join(root, "dist/edge-fns");
mkdirSync(outDir, { recursive: true });

const summary = [];
for (const name of names) {
  const entry = join(root, "supabase/functions", name, "index.ts");
  if (!existsSync(entry)) {
    throw new Error(`missing ${entry}`);
  }
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: true,
    external: ["https://esm.sh/*", "https://deno.land/*", "npm:*", "jsr:*"],
    absWorkingDir: root,
    logLevel: "warning",
  });
  const code = result.outputFiles[0].text;
  const denoSrc = join(root, "supabase/functions", name, "deno.json");
  const denoJson = existsSync(denoSrc)
    ? readFileSync(denoSrc, "utf8")
    : `${JSON.stringify({ imports: {} }, null, 2)}\n`;
  writeFileSync(join(outDir, `${name}.js`), code);
  writeFileSync(join(outDir, `${name}.deno.json`), denoJson);
  summary.push({
    name,
    bytes: Buffer.byteLength(code, "utf8"),
    hasCloudApi: code.includes("graph.facebook.com"),
    hasSessionFallback: code.includes("cloud template missing"),
    hasHttp200Always: name === "operator-send-whatsapp-message" &&
      code.includes("sendFailureMessage") && !code.includes("o.ok?200:502"),
  });
}

console.log(JSON.stringify(summary, null, 2));
