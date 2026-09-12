#!/usr/bin/env node
/**
 * Repoint Washero n8n HTTP nodes to production whatsapp-tools.
 * Does not touch Vuelto workflows.
 *
 * Requires N8N_API_KEY. Dry-run by default; pass --apply to PUT the workflows.
 *
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-cutover.mjs
 *   N8N_API_KEY=... node scripts/n8n-whatsapp-cutover.mjs --apply
 */
const BASE = process.env.N8N_BASE_URL?.replace(/\/$/, "") || "https://n8n.flynnpedroa.engineer";
const KEY = process.env.N8N_API_KEY || "";
const APPLY = process.argv.includes("--apply");
const PROD = "https://domslcbxgqbylmciqrxt.supabase.co/functions/v1/whatsapp-tools";
const LEGACY_HOST = "apiwashero.flynnpedroa.engineer";

const WASHERO_WORKFLOWS = {
  inbound: "NWK9Nqajvkt35Zso",
  outbound: "xLrRt4VrVGgFYwko",
};
const VUELTO_WORKFLOWS = {
  inbound: "3Y3isgG7UDW6IeD1",
  outbound: "Ou4OxoMhICKx1UMg",
};

if (!KEY) {
  console.error("N8N_API_KEY is required");
  process.exit(1);
}

async function n8n(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "X-N8N-API-KEY": KEY,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  }
  return body;
}

function httpUrls(workflow) {
  const nodes = workflow.nodes || [];
  return nodes
    .filter((n) => String(n.type || "").includes("httpRequest"))
    .map((n) => ({
      name: n.name,
      url: n.parameters?.url || n.parameters?.options?.url || "",
      credential: n.credentials?.httpHeaderAuth?.name || n.credentials?.httpHeaderAuth?.id || "",
    }));
}

function patchWasheroUrls(workflow) {
  let changed = 0;
  for (const node of workflow.nodes || []) {
    if (!String(node.type || "").includes("httpRequest")) continue;
    const url = node.parameters?.url;
    if (typeof url === "string" && url.includes(LEGACY_HOST) && url.includes("whatsapp-tools")) {
      node.parameters.url = PROD;
      changed += 1;
    }
  }
  return changed;
}

const inbound = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.inbound}`);
const outbound = await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.outbound}`);
let vueltoInbound = null;
let vueltoOutbound = null;
try {
  vueltoInbound = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.inbound}`);
  vueltoOutbound = await n8n(`/api/v1/workflows/${VUELTO_WORKFLOWS.outbound}`);
} catch (err) {
  console.warn("Vuelto workflow fetch skipped:", String(err.message || err));
}

const report = {
  apply: APPLY,
  productionToolsUrl: PROD,
  washero: {
    inbound: httpUrls(inbound),
    outbound: httpUrls(outbound),
  },
  vuelto: {
    inbound: vueltoInbound ? httpUrls(vueltoInbound) : null,
    outbound: vueltoOutbound ? httpUrls(vueltoOutbound) : null,
  },
};

const inboundChanges = patchWasheroUrls(inbound);
const outboundChanges = patchWasheroUrls(outbound);
report.pendingChanges = { inbound: inboundChanges, outbound: outboundChanges };

if (APPLY) {
  if (inboundChanges) {
    await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.inbound}`, {
      method: "PUT",
      body: JSON.stringify(inbound),
    });
  }
  if (outboundChanges) {
    await n8n(`/api/v1/workflows/${WASHERO_WORKFLOWS.outbound}`, {
      method: "PUT",
      body: JSON.stringify(outbound),
    });
  }
  report.applied = true;
}

console.log(JSON.stringify(report, null, 2));
