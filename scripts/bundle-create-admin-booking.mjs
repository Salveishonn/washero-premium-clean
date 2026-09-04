#!/usr/bin/env node
/**
 * Bundle create-admin-booking + shared deps into a single ESM file, gzip+base64 it,
 * and write a Deno loader that fetches the payload from private.edge_fn_bundles
 * (via get_edge_fn_bundle) at runtime.
 *
 * Usage:
 *   node scripts/bundle-create-admin-booking.mjs
 *   # then upsert private.edge_fn_bundles payload from dist/create-admin-booking.bundle.b64
 *   # and deploy dist/create-admin-booking.loader.ts as the edge function entrypoint
 */
import * as esbuild from "esbuild";
import { gzipSync } from "zlib";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, "supabase/functions/create-admin-booking/index.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  external: ["https://esm.sh/*", "https://deno.land/*", "npm:*", "jsr:*"],
  absWorkingDir: root,
  logLevel: "info",
});

const code = result.outputFiles[0].text;
const b64 = gzipSync(Buffer.from(code, "utf8"), { level: 9 }).toString("base64");

writeFileSync(join(outDir, "create-admin-booking.bundle.js"), code);
writeFileSync(join(outDir, "create-admin-booking.bundle.b64"), b64);

const loader = `const b64=await (async()=>{
  const url=Deno.env.get("SUPABASE_URL")!;
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res=await fetch(\`\${url}/rest/v1/rpc/get_edge_fn_bundle\`,{
    method:"POST",
    headers:{apikey:key,Authorization:\`Bearer \${key}\`,"Content-Type":"application/json"},
    body:JSON.stringify({p_name:"create-admin-booking"})
  });
  if(!res.ok) throw new Error(\`bundle fetch \${res.status} \${await res.text()}\`);
  const payload=await res.json();
  if(typeof payload!=="string"||!payload) throw new Error("bundle missing");
  return payload;
})();
import { createClient as ot } from "https://esm.sh/@supabase/supabase-js@2.45.4";
globalThis.__cabClient = ot;
const binary=atob(b64);
const bin=new Uint8Array(binary.length);
for(let i=0;i<binary.length;i++)bin[i]=binary.charCodeAt(i);
const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
const code=await new Response(stream).text();
(0,eval)("var ot=globalThis.__cabClient;" + code);
`;

writeFileSync(join(outDir, "create-admin-booking.loader.ts"), loader);
writeFileSync(join(outDir, "create-admin-booking.deno.json"), `${JSON.stringify({ imports: {} }, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      bundleBytes: code.length,
      b64Chars: b64.length,
      hasPriceOverride: code.includes("price_override"),
      hasSkipSlotChecks: code.includes("p_skip_slot_checks"),
      outDir,
    },
    null,
    2,
  ),
);
