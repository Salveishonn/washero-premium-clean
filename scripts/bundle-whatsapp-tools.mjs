#!/usr/bin/env node
/**
 * Bundle whatsapp-tools (shared with botmaker-tools) into gzip+base64 for
 * private.edge_fn_bundles, matching scripts/bundle-create-admin-booking.mjs.
 *
 * Usage:
 *   node scripts/bundle-whatsapp-tools.mjs
 *   # upsert dist/whatsapp-tools.bundle.b64 into private.edge_fn_bundles
 *   # deploy dist/whatsapp-tools.loader.ts as both whatsapp-tools and botmaker-tools
 */
import { gzipSync } from "zlib";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
const bundleJs = join(outDir, "whatsapp-tools.bundle.js");

const built = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild",
    "supabase/functions/whatsapp-tools/index.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    "--minify",
    "--external:https:*",
    "--external:npm:*",
    "--external:node:*",
    "--external:jsr:*",
    `--outfile=${bundleJs}`,
  ],
  { cwd: root, encoding: "utf8" },
);
if (built.status !== 0) {
  console.error(built.stdout);
  console.error(built.stderr);
  process.exit(built.status ?? 1);
}

let code = readFileSync(bundleJs, "utf8");
const importRe =
  /^import\s*\{([^}]*)\}\s*from\s*"https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";\s*/m;
const importMatch = code.match(importRe);
const aliasMatch = importMatch?.[1]?.match(/createClient(?:\s+as\s+(\w+))?/);
const bundledAlias = aliasMatch?.[1] || "createClient";
code = code.replace(importRe, "");
// Production v9 loaders eval `var gr=globalThis.__waToolsClient;` — pin the
// minified createClient identifier so a rebuild does not 500 the live function.
const clientAlias = "gr";
function unusedIdent(src, prefix = "waGr") {
  let i = 0;
  while (new RegExp(`\\b${prefix}${i}\\b`).test(src)) i += 1;
  return `${prefix}${i}`;
}
if (bundledAlias !== clientAlias) {
  // esbuild may already have assigned `gr` to another binding (e.g. a tool
  // object). Evacuate those first or eval overwrites createClient and 500s
  // with `TypeError: gr is not a function`.
  if (new RegExp(`\\b${clientAlias}\\b`).test(code)) {
    const spare = unusedIdent(code);
    code = code.replace(new RegExp(`\\b${clientAlias}\\b`, "g"), spare);
  }
  code = code.replace(new RegExp(`\\b${bundledAlias}\\b`, "g"), clientAlias);
}
const grAssignments = [...code.matchAll(/\bgr\s*=/g)];
if (grAssignments.length > 0) {
  console.error("bundle still assigns to gr; refusing to write a colliding payload");
  process.exit(1);
}

const b64 = gzipSync(Buffer.from(code, "utf8"), { level: 9 }).toString("base64");
writeFileSync(join(outDir, "whatsapp-tools.bundle.js"), code);
writeFileSync(join(outDir, "whatsapp-tools.bundle.b64"), b64);

const loader = `const b64=await (async()=>{
  const url=Deno.env.get("SUPABASE_URL")!;
  const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res=await fetch(\`\${url}/rest/v1/rpc/get_edge_fn_bundle\`,{
    method:"POST",
    headers:{apikey:key,Authorization:\`Bearer \${key}\`,"Content-Type":"application/json"},
    body:JSON.stringify({p_name:"whatsapp-tools"})
  });
  if(!res.ok) throw new Error(\`bundle fetch \${res.status} \${await res.text()}\`);
  const payload=await res.json();
  if(typeof payload!=="string"||!payload) throw new Error("bundle missing");
  return payload;
})();
import { createClient as ${clientAlias} } from "https://esm.sh/@supabase/supabase-js@2.45.4";
globalThis.__waToolsClient = ${clientAlias};
const binary=atob(b64);
const bin=new Uint8Array(binary.length);
for(let i=0;i<binary.length;i++)bin[i]=binary.charCodeAt(i);
const stream=new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
const code=await new Response(stream).text();
(0,eval)("var ${clientAlias}=globalThis.__waToolsClient;" + code);
`;

writeFileSync(join(outDir, "whatsapp-tools.loader.ts"), loader);
writeFileSync(join(outDir, "whatsapp-tools.deno.json"), `${JSON.stringify({ imports: {} }, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      bundleBytes: code.length,
      b64Chars: b64.length,
      hasConversationState: code.includes("whatsapp_conversation_state"),
      hasPaymentLink: code.includes("get_payment_link"),
      hasSuggestAddresses: code.includes("suggest_addresses"),
      hasBankTransfer: code.includes("get_bank_transfer_details"),
      hasEnforceCoverage: code.includes("enforce_coverage:!0") || code.includes("enforce_coverage: true"),
      hasDenoServe: code.includes("Deno.serve"),
      clientAlias,
      strippedCreateClientImport: !code.includes("esm.sh/@supabase/supabase-js"),
      outDir,
    },
    null,
    2,
  ),
);
